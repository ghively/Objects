"""M11: the local API (`api_v1`), its tokens (`tokens`) and helpers (`apiquery`)."""

from __future__ import annotations

import time
from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.apiquery import (
    Matcher,
    append_to_section,
    is_excluded,
    outline,
    parse_since,
    read_section,
    replace_section,
)
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.tokens import ActivityLog, TokenStore

NOW = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)


# -- tokens ---------------------------------------------------------------------------


def test_token_create_verify_revoke(tmp_path: Path) -> None:
    store = TokenStore(tmp_path / "space", tmp_path / "state")
    record, secret = store.create("Claude Code", "read")
    assert secret.startswith("obj_") and len(secret) > 40
    assert "hash" not in record.to_api()
    saved = (tmp_path / "state" / "api-tokens.json").read_text(encoding="utf-8")
    assert secret not in saved  # only the hash is stored
    assert store.verify(secret).id == record.id
    assert store.verify(secret + "x") is None
    assert store.verify("") is None
    assert store.verify(secret).lastUsedAt is not None
    assert store.revoke(record.id) is True
    assert store.verify(secret) is None
    assert store.revoke(record.id) is False


def test_token_is_bound_to_its_space(tmp_path: Path) -> None:
    a = TokenStore(tmp_path / "a", tmp_path / "state")
    b = TokenStore(tmp_path / "b", tmp_path / "state")
    _rec, secret = a.create("one", "read-write")
    assert b.verify(secret) is None
    assert b.list() == [] and len(a.list()) == 1


@pytest.mark.parametrize(("name", "scope"), [("", "read"), ("x" * 61, "read"), ("ok", "admin")])
def test_token_create_refuses_bad_input(tmp_path: Path, name: str, scope: str) -> None:
    with pytest.raises(ValueError):
        TokenStore(tmp_path, tmp_path / "state").create(name, scope)


def test_activity_log_filters_by_space_and_time(tmp_path: Path) -> None:
    store = TokenStore(tmp_path / "a", tmp_path / "state")
    rec, _ = store.create("bot", "read-write")
    log = ActivityLog(tmp_path / "a", tmp_path / "state")
    other = ActivityLog(tmp_path / "b", tmp_path / "state")
    log.add(rec, "create", "Pages/A.md")
    other.add(rec, "create", "Pages/B.md")
    entries = log.since(None)
    assert [e["path"] for e in entries] == ["Pages/A.md"]
    assert entries[0]["token"] == "bot" and "space" not in entries[0]
    assert log.since("2999-01-01") == []


# -- apiquery -------------------------------------------------------------------------


def test_is_excluded() -> None:
    assert is_excluded({"excludeFromAI": True}, [])
    assert is_excluded({"excludeFromAI": "yes"}, [])
    assert is_excluded({}, ["[[Exclude from AI]]"])
    assert is_excluded(None, ["exclude FROM ai"])
    assert not is_excluded({"excludeFromAI": False}, ["AI"])


def _f(prop: str, option: str, ref=None) -> dict:
    return {"type": "filter", "propertyId": prop, "option": option, "referenceValue": ref}


def _g(*elements, op: str = "and") -> dict:
    return {"type": "filterGroup", "operator": op, "elements": list(elements)}


def test_matcher_text_list_number_checkbox() -> None:
    today = date(2026, 11, 5)
    row = {"status": "In Progress", "tags": ["Math", "Docs"], "n": 3, "done": True, "x": ""}
    assert Matcher(_g(_f("status", "is", "in progress")), today).matches(row)
    assert not Matcher(_g(_f("status", "isNot", "In Progress")), today).matches(row)
    assert Matcher(_g(_f("tags", "contains", ["docs"])), today).matches(row)
    assert Matcher(_g(_f("tags", "notContains", ["Art"])), today).matches(row)
    assert Matcher(_g(_f("n", "greater", 2), _f("n", "smallerEqual", 3)), today).matches(row)
    assert Matcher(_g(_f("done", "isChecked")), today).matches(row)
    assert Matcher(_g(_f("x", "isEmpty")), today).matches(row)
    assert Matcher(_g(_f("n", "equal", 9), _f("done", "isChecked"), op="or"), today).matches(row)
    assert not Matcher(_g(_f("n", "equal", 9), _f("done", "isNotChecked"), op="or"), today).matches(row)


def test_matcher_dates_and_unsupported() -> None:
    today = date(2026, 11, 5)
    row = {"due": {"start": "2026-11-03", "resolution": "day"}}
    assert Matcher(_g(_f("due", "isBefore", {"relative": "today"})), today).matches(row)
    assert Matcher(_g(_f("due", "is", {"relative": "thisWeek"})), today).matches(row)
    assert Matcher(_g(_f("due", "isOnOrAfter", {"exactDate": "2026-11-03"})), today).matches(row)
    assert not Matcher(_g(_f("due", "isAfter", {"relative": "today"})), today).matches(row)
    assert Matcher(_g(_f("due", "isBefore", {"relative": "overdue"})), today).matches(row)
    m = Matcher(_g(_f("due", "frobnicate", 1)), today)
    assert m.matches(row) and m.unsupported == {"frobnicate"}


def test_matcher_this_week_follows_the_week_start() -> None:
    # Sunday 8 Nov 2026: Monday weeks run 2-8 Nov, Sunday weeks 8-14 Nov.
    sunday = date(2026, 11, 8)
    wed = {"due": {"start": "2026-11-04", "resolution": "day"}}
    tue = {"due": {"start": "2026-11-10", "resolution": "day"}}
    this_week = _g(_f("due", "is", {"relative": "thisWeek"}))
    assert Matcher(this_week, sunday).matches(wed)  # Monday by default
    assert not Matcher(this_week, sunday).matches(tue)
    assert Matcher(this_week, sunday, week_start="monday").matches(wed)
    assert not Matcher(this_week, sunday, week_start="sunday").matches(wed)
    assert Matcher(this_week, sunday, week_start="sunday").matches(tue)


def test_parse_since() -> None:
    assert parse_since("2026-11-05") == "2026-11-05"
    assert parse_since("2026-11-05T10:00:00Z") == "2026-11-05T10:00:00"
    assert parse_since("nope") is None
    assert parse_since(None) is None


BODY = "Intro\n\n## Plan\n\nStep one\n\n### Detail\n\nMore\n\n## Notes\n\n```\n## not a heading\n```\n"


def test_sections() -> None:
    assert [h["text"] for h in outline(BODY)] == ["Plan", "Detail", "Notes"]
    assert read_section(BODY, "plan") == "## Plan\n\nStep one\n\n### Detail\n\nMore\n\n"
    assert read_section(BODY, "Missing") is None
    replaced = replace_section(BODY, "Detail", "Less")
    assert "### Detail\nLess\n\n## Notes" in replaced
    assert replaced.startswith("Intro\n\n## Plan\n\nStep one\n\n")
    appended = append_to_section(BODY, "Plan", "- step two")
    assert "More\n\n- step two\n\n## Notes" in appended
    assert append_to_section(BODY, None, "End").endswith("```\n\nEnd\n")
    assert append_to_section("", None, "Only") == "Only\n"


def test_sections_keep_crlf() -> None:
    body = "## A\r\n\r\none\r\n\r\n## B\r\n"
    out = append_to_section(body, "A", "two")
    assert out == "## A\r\n\r\none\r\n\r\ntwo\r\n\r\n## B\r\n"
    assert "\n" not in out.replace("\r\n", "")


# -- routes ---------------------------------------------------------------------------


@pytest.fixture
def api(space_dir: Path):
    space = Space(space_dir)
    space.clock = lambda: NOW
    app = create_app(space, None, watch=False)
    published: list = []
    app.state.hub.publish = published.append
    client = TestClient(app)
    return space, client, published


def _token(client: TestClient, scope: str = "read-write", name: str = "agent") -> dict:
    res = client.post("/api/integrations/tokens", json={"name": name, "scope": scope})
    assert res.status_code == 201, res.text
    return {"Authorization": f"Bearer {res.json()['secret']}"}


def test_token_routes(api) -> None:
    _space, client, _ = api
    res = client.post("/api/integrations/tokens", json={"name": "Claude", "scope": "read"})
    body = res.json()
    assert res.status_code == 201
    cfg = body["mcpConfig"]["mcpServers"]["object"]
    assert cfg["env"]["OBJECT_API_TOKEN"] == body["secret"]
    assert "objectapp-mcp" in cfg["args"]
    listed = client.get("/api/integrations/tokens").json()
    assert [t["name"] for t in listed["tokens"]] == ["Claude"]
    assert "secret" not in listed["tokens"][0] and "hash" not in listed["tokens"][0]
    assert client.post("/api/integrations/tokens", json={"name": "x", "scope": "root"}).status_code == 422
    tid = body["token"]["id"]
    assert client.delete(f"/api/integrations/tokens/{tid}").status_code == 200
    assert client.delete(f"/api/integrations/tokens/{tid}").status_code == 404
    hdr = {"Authorization": f"Bearer {body['secret']}"}
    assert client.get("/api/v1/schema", headers=hdr).status_code == 401


def test_v1_needs_a_token(api) -> None:
    _space, client, _ = api
    assert client.get("/api/v1/schema").status_code == 401
    assert client.get("/api/v1/schema", headers={"Authorization": "Bearer obj_nope"}).status_code == 401


def test_read_token_cannot_write(api) -> None:
    _space, client, _ = api
    hdr = _token(client, "read")
    assert client.get("/api/v1/schema", headers=hdr).status_code == 200
    res = client.post("/api/v1/objects", headers=hdr, json={"type": "Page", "title": "X"})
    assert res.status_code == 403


def test_cross_origin_write_is_refused(api) -> None:
    _space, client, _ = api
    hdr = _token(client) | {"Origin": "http://evil.example"}
    res = client.post("/api/v1/objects", headers=hdr, json={"type": "Page", "title": "X"})
    assert res.status_code == 403


def test_schema_and_reads_never_write(api, space_dir: Path) -> None:
    space, client, published = api
    hdr = _token(client, "read")
    before = {p: p.read_bytes() for p in space_dir.rglob("*.md")}
    schema = client.get("/api/v1/schema", headers=hdr).json()
    task = next(t for t in schema["types"] if t["name"] == "Task")
    status = next(p for p in task["properties"] if p["id"] == "status")
    assert "In Progress" in status["options"]
    peek = client.get("/api/v1/object/peek", headers=hdr, params={"path": "People/Ada Lovelace.md"}).json()
    assert peek["title"] == "Ada Lovelace" and peek["outline"] == [{"level": 1, "text": "Ada Lovelace"}]
    full = client.get("/api/v1/object", headers=hdr, params={"path": "People/Ada Lovelace.md"}).json()
    assert "first published algorithm" in full["body"]
    sec = client.get(
        "/api/v1/object", headers=hdr, params={"path": "People/Ada Lovelace.md", "section": "ada lovelace"}
    )
    assert sec.status_code == 200
    missing = client.get(
        "/api/v1/object", headers=hdr, params={"path": "People/Ada Lovelace.md", "section": "Nope"}
    )
    assert missing.status_code == 404
    assert client.get("/api/v1/object", headers=hdr, params={"path": "Pages/Nope.md"}).status_code == 404
    assert client.get("/api/v1/object", headers=hdr, params={"path": "../x.md"}).status_code == 400
    bl = client.get("/api/v1/object/backlinks", headers=hdr, params={"path": "Pages/Alpha.md"})
    assert bl.status_code == 200
    assert client.get("/api/v1/daily-note", headers=hdr, params={"date": "2026-10-23"}).json() == {
        "path": "DailyNotes/2026-10-23.md"
    }
    assert client.get("/api/v1/daily-note", headers=hdr, params={"date": "2026-10-24"}).status_code == 404
    found = client.get("/api/v1/search", headers=hdr, params={"q": "printer"}).json()
    assert any(r["path"] == "Tasks/Fix printer.md" for r in found["results"])
    ch = client.get("/api/v1/changes", headers=hdr, params={"since": "2026-03-01"}).json()
    assert "Tasks/Fix printer.md" in [o["path"] for o in ch["objects"]]
    assert client.get("/api/v1/changes", headers=hdr, params={"since": "bad"}).status_code == 422
    after = {p: p.read_bytes() for p in space_dir.rglob("*.md")}
    assert before == after
    assert published == []


def test_query_filters_and_sorts(api) -> None:
    _space, client, _ = api
    hdr = _token(client, "read")
    res = client.post(
        "/api/v1/query",
        headers=hdr,
        json={
            "typeIds": ["Task"],
            "filterGroup": _g(_f("status", "is", "In Progress")),
            "sort": {"propertyId": "title"},
        },
    ).json()
    assert [r["title"] for r in res["rows"]] == ["Fix printer"]
    assert res["total"] == 1 and res["unsupported"] == []
    every = client.post("/api/v1/query", headers=hdr, json={"typeIds": ["Task"], "limit": 1}).json()
    assert len(every["rows"]) == 1 and every["total"] >= 2
    assert client.post("/api/v1/query", headers=hdr, json={"typeIds": ["Nope"]}).status_code == 422


def test_excluded_objects_are_invisible(api, space_dir: Path) -> None:
    space, client, _ = api
    p = space_dir / "Pages" / "Alpha.md"
    p.write_text(p.read_text(encoding="utf-8").replace("title: Alpha", "title: Alpha\nexcludeFromAI: true"), encoding="utf-8")
    fresh = Space(space_dir)
    fresh.clock = lambda: NOW
    app = create_app(fresh, None, watch=False)
    app.state.hub.publish = lambda _e: None
    c = TestClient(app)
    hdr = _token(c)
    assert c.get("/api/v1/object", headers=hdr, params={"path": "Pages/Alpha.md"}).status_code == 404
    rows = c.post("/api/v1/query", headers=hdr, json={"typeIds": ["Page"]}).json()["rows"]
    assert "Pages/Alpha.md" not in [r["path"] for r in rows]
    found = c.get("/api/v1/search", headers=hdr, params={"q": "Alpha"}).json()["results"]
    assert "Pages/Alpha.md" not in [r.get("path") for r in found]
    res = c.post(
        "/api/v1/object/trash", headers=hdr, json={"path": "Pages/Alpha.md", "version": "x"}
    )
    assert res.status_code == 404
    assert p.exists()


def _wait(published: list, count: int) -> None:
    deadline = time.monotonic() + 5
    while len(published) < count and time.monotonic() < deadline:
        time.sleep(0.01)


def test_writes_announce_and_log(api, space_dir: Path) -> None:
    space, client, published = api
    with client:
        _writes(client, space_dir, published)


def _writes(client: TestClient, space_dir: Path, published: list) -> None:
    hdr = _token(client, name="Claude Code")
    made = client.post(
        "/api/v1/objects",
        headers=hdr,
        json={"type": "Page", "title": "From agent", "body": "## Ideas\n\n- one\n"},
    )
    assert made.status_code == 201, made.text
    path, version = made.json()["path"], made.json()["version"]
    assert (space_dir / path).read_text(encoding="utf-8").rstrip().endswith("- one")
    _wait(published, 2)
    assert {e.origin for e in published} == {"api:Claude Code"}

    stale = client.post(
        "/api/v1/object/section",
        headers=hdr,
        json={"path": path, "version": "stale", "heading": "Ideas", "text": "- two"},
    )
    assert stale.status_code == 409 and stale.json()["currentVersion"] == version

    sec = client.post(
        "/api/v1/object/section",
        headers=hdr,
        json={"path": path, "version": version, "heading": "Ideas", "text": "- two"},
    )
    assert sec.status_code == 200, sec.text
    version = sec.json()["version"]
    assert "- one\n- two" in (space_dir / path).read_text(encoding="utf-8").replace("\n\n- two", "\n- two")

    props = client.post(
        "/api/v1/object/properties",
        headers=hdr,
        json={"path": path, "version": version, "add": {"tags": ["Docs"]}},
    )
    assert props.status_code == 200, props.text
    version = props.json()["version"]
    again = client.post(
        "/api/v1/object/properties",
        headers=hdr,
        json={"path": path, "version": version, "add": {"tags": ["Docs"]}},
    ).json()
    assert again["version"] == version  # adding a tag it has changes nothing

    ren = client.post(
        "/api/v1/object/rename", headers=hdr, json={"path": path, "version": version, "title": "Renamed"}
    )
    assert ren.status_code == 200, ren.text
    new_path, version = ren.json()["path"], ren.json()["version"]
    assert new_path.endswith("Renamed.md")

    gone = client.post("/api/v1/object/trash", headers=hdr, json={"path": new_path, "version": version})
    assert gone.status_code == 200 and gone.json()["trashId"]
    assert not (space_dir / new_path).exists()

    _wait(published, 6)
    log = client.get("/api/v1/changes", headers=hdr).json()["activity"]
    assert [e["action"] for e in log] == ["create", "section-append", "properties", "rename", "trash"]
    assert {e["token"] for e in log} == {"Claude Code"}
    kinds = [e.kind for e in published]
    assert kinds[0] == "created" and "renamed" in kinds and kinds[-1] == "deleted"


def test_replace_section_and_bad_mode(api, space_dir: Path) -> None:
    _space, client, _ = api
    hdr = _token(client)
    path = "People/Ada Lovelace.md"
    version = client.get("/api/v1/object", headers=hdr, params={"path": path}).json()["version"]
    bad = client.post(
        "/api/v1/object/section", headers=hdr, json={"path": path, "version": version, "mode": "x", "text": "t"}
    )
    assert bad.status_code == 422
    res = client.post(
        "/api/v1/object/section",
        headers=hdr,
        json={"path": path, "version": version, "mode": "replace", "heading": "Ada Lovelace", "text": "Mathematician."},
    )
    assert res.status_code == 200, res.text
    text = (space_dir / path).read_text(encoding="utf-8")
    assert "# Ada Lovelace\nMathematician.\n" in text and "algorithm" not in text
    assert "website: https://example.org/ada" in text


def test_run_saved_query(m8_space_dir: Path) -> None:
    space = Space(m8_space_dir)
    space.clock = lambda: NOW
    app = create_app(space, None, watch=False)
    app.state.hub.publish = lambda _e: None
    c = TestClient(app)
    hdr = _token(c, "read")
    res = c.post("/api/v1/queries/open-tasks/run", headers=hdr, json={})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["query"] == {"id": "open-tasks", "name": "Open tasks"}
    assert body["rows"] and {r["type"] for r in body["rows"]} == {"task"}
    assert body["unsupported"] == []
    assert c.post("/api/v1/queries/nope/run", headers=hdr, json={}).status_code == 404
