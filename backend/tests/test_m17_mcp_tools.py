"""M17 Task 5: the expanded ``objectapp-mcp``, driven in process against the app's own routes.

The fixture is a synthetic space (`full_space_dir` plus a few pages): ``Pages/Open.md``, which
anyone may read, ``Pages/Secret.md`` (tagged "Exclude from AI", its body holds
``SECRET-MARKER`` and mentions Open), a Task template, two whiteboards (one excluded), a
collection holding both pages, a saved query and a second, custom type with one visible and
one excluded object.
"""

from __future__ import annotations

import asyncio
import json
import re
import shutil
import time
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from mcp.server.mcpserver.exceptions import ToolError
from objectapp import toolcatalog, v1guard
from objectapp.mcp_server import ApiError, ObjectClient, build_server
from objectapp.server import create_app
from objectapp.space import Space

NOW = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)
FIXTURES = Path(__file__).parent / "fixtures"
MARKER = "SECRET-MARKER"
OPEN = "Pages/Open.md"
SECRET = "Pages/Secret.md"
MENTIONER = "Pages/Mentioner.md"
CRLF = "Pages/Crlf.md"
TEMPLATE = "Templates/Tasks/Bug report.md"
SECRET_PROJECT = "Projects/Secret project.md"

STAMP = "createdAt: 2026-04-01T08:00:00.000Z\nlastUpdated: 2026-04-01T08:00:00.000Z\n"
FILES = {
    OPEN: (
        "---\ntype: 'Page'\ntitle: Open\n" + STAMP
        + "tags: ['[[Docs]]', '[[Keep]]']\ncollections: ['Reading', 'Extra']\n---\n\nA page anyone may read.\n"
    ),
    SECRET: (
        "---\ntype: 'Page'\ntitle: Secret\n" + STAMP
        + "tags: ['[[Exclude from AI]]']\ncollections: ['Reading']\n---\n\n"
        + f"Open is mentioned here. {MARKER}\n"
    ),
    MENTIONER: "---\ntype: 'Page'\ntitle: Mentioner\n" + STAMP + "---\n\nSee Open for the details.\n",
    SECRET_PROJECT: (
        "---\ntype: 'Project'\ntitle: Secret project\n" + STAMP
        + f"budget: 7\nexcludeFromAI: true\n---\n\n{MARKER}\n"
    ),
}


class Env:
    def __init__(self, root: Path, space: Space, http: TestClient) -> None:
        self.root = root
        self.space = space
        self.http = http
        self.rw = _client(http, "read-write")
        self.ro = _client(http, "read")
        self.server = build_server(self.rw, write=True)
        self.read_server = build_server(self.ro, write=False)
        board = http.post("/api/whiteboards", json={"title": "Board"}).json()
        self.board = board["path"]
        hidden = http.post("/api/whiteboards", json={"title": "Hidden board"}).json()["path"]
        p = root / hidden
        p.write_text(p.read_text(encoding="utf-8").replace("\n---", "\nexcludeFromAI: true\n---", 1), encoding="utf-8")
        space.rescan_file(hidden)
        self.hidden_board = hidden
        res = http.post("/api/collections", json={"name": "Reading", "typeIds": ["page"]})
        assert res.status_code == 201, res.text
        self.collection = res.json()["id"]
        res = http.post("/api/queries", json={"name": "All pages"})
        assert res.status_code == 201, res.text
        self.query = res.json()["id"]

    def call(self, tool: str, /, **args: Any) -> Any:
        return _call(self.server, tool, **args)

    def bytes_of(self, rel: str) -> bytes:
        return (self.root / rel).read_bytes()


@pytest.fixture
def env(full_space_dir: Path, monkeypatch) -> Env:
    monkeypatch.setenv("OBJECT_FAKE_NOTIFY_FILE", str(full_space_dir.parent / "notified.jsonl"))
    for rel, text in FILES.items():
        (full_space_dir / rel).write_text(text, encoding="utf-8", newline="")
    (full_space_dir / CRLF).write_bytes(
        b"\xef\xbb\xbf---\r\ntype: 'Page'\r\ntitle: Crlf\r\n"
        + STAMP.replace("\n", "\r\n").encode()
        + b"---\r\n\r\nOld line one.\r\nOld line two.\r\n"
    )
    space = Space(full_space_dir)
    space.clock = lambda: NOW
    app = create_app(space, None, watch=False)
    app.state.hub.publish = lambda _e: None
    return Env(full_space_dir, space, TestClient(app))


def _client(http: TestClient, scope: str, name: str = "agent") -> ObjectClient:
    res = http.post("/api/integrations/tokens", json={"name": name, "scope": scope})
    assert res.status_code == 201, res.text
    return ObjectClient("http://testserver", res.json()["secret"], http)


def _call(server, tool: str, /, **args: Any) -> Any:
    try:
        result = asyncio.run(server.call_tool(tool, args))
    except ToolError as exc:
        raise ApiError(_plain(str(exc))) from exc
    if result.is_error:
        raise ApiError(_plain(" ".join(getattr(c, "text", "") for c in result.content)))
    if result.structured_content is not None:
        out = result.structured_content
        return out.get("result", out) if set(out) == {"result"} else out
    return json.loads(result.content[0].text)


def _plain(message: str) -> str:
    """The app's answer without the MCP server's "Error executing tool <name>: " lead-in."""
    return re.sub(r"^Error executing tool \w+: ", "", message)


def _names(server) -> list[str]:
    return [t.name for t in asyncio.run(server.list_tools())]


def _extra(message: str) -> dict[str, Any]:
    """The JSON the client adds to an error's text (a 428's ``affected``, ``hiddenCount``)."""
    return json.loads(message[message.rindex(" {") + 1 :])


# -- the tool lists and the guards -------------------------------------------------------


def test_tool_lists(env: Env) -> None:
    assert sorted(_names(env.server)) == sorted(toolcatalog.OBJECT_READ + toolcatalog.OBJECT_WRITE)
    assert sorted(_names(build_server(env.ro, write=False))) == sorted(toolcatalog.OBJECT_READ)
    tools = {t.name: t for t in asyncio.run(env.server.list_tools())}
    for name in ("delete_type", "delete_collection", "delete_query", "merge", "write_body"):
        assert tools[name].annotations.destructive_hint is True
    for name in toolcatalog.OBJECT_READ:
        assert tools[name].annotations.read_only_hint is True


def test_write_guards(env: Env) -> None:
    assert v1guard.WRITE_GUARDS == []
    blocked = _client(env.http, "read-write", name="blocked")

    def no_for_blocked(token, _request) -> str | None:
        return "No." if token.name == "blocked" else None

    v1guard.WRITE_GUARDS.append(no_for_blocked)
    try:
        server = build_server(blocked, write=True)
        with pytest.raises(ApiError, match=r"403: No\."):
            _call(server, "create_tag", name="Blocked tag")
        with pytest.raises(ApiError, match=r"403: No\."):
            _call(server, "create_task", title="Blocked task")  # M11's routes too
        assert _call(server, "read", path=OPEN)["title"] == "Open"
        assert _call(server, "type_definition", type="Page")["id"] == "page"
        assert env.call("create_tag", name="Allowed tag")["created"] is True
    finally:
        v1guard.WRITE_GUARDS.remove(no_for_blocked)
    assert v1guard.WRITE_GUARDS == []


def test_read_token_cannot_write(env: Env) -> None:
    hdr = env.ro.headers
    writes: list[tuple[str, str, dict[str, Any] | None]] = [
        ("POST", "/api/v1/object/body", {"path": OPEN, "version": "v", "body": "x"}),
        ("POST", "/api/v1/daily-notes", {"date": "2026-11-20"}),
        ("POST", "/api/v1/object/duplicate", {"path": OPEN}),
        ("POST", "/api/v1/object/change-type", {"path": OPEN, "version": "v", "type": "Project"}),
        ("POST", "/api/v1/object/merge", {"source": OPEN, "target": MENTIONER, "sourceVersion": "v", "targetVersion": "v"}),
        ("POST", "/api/v1/references/link", {"path": MENTIONER, "version": "v", "target": OPEN, "start": 4, "end": 8, "text": "Open"}),
        ("POST", "/api/v1/tags/ensure", {"name": "X"}),
        ("POST", "/api/v1/types", {"name": "Book", "pluralName": "Books"}),
        ("PUT", "/api/v1/types/page", {"revision": "", "type": {}}),
        ("POST", "/api/v1/types/page/properties/x/change-kind", {"toKind": "text", "revision": ""}),
        ("DELETE", "/api/v1/types/project", None),
        ("POST", "/api/v1/collections", {"name": "C"}),
        ("PUT", f"/api/v1/collections/{env.collection}", {"revision": "", "collection": {}}),
        ("DELETE", f"/api/v1/collections/{env.collection}", None),
        ("POST", "/api/v1/queries", {"name": "Q"}),
        ("PUT", f"/api/v1/queries/{env.query}", {"revision": "", "query": {}}),
        ("DELETE", f"/api/v1/queries/{env.query}", None),
        ("POST", "/api/v1/whiteboards", {"title": "W"}),
        ("PUT", "/api/v1/whiteboard", {"path": env.board, "revision": "", "board": {}}),
        ("POST", "/api/v1/automations", {"rule": {}}),
        ("POST", "/api/v1/automations/x/run", {"path": OPEN}),
        ("POST", "/api/v1/import/start", {"previewId": "x", "target": {"kind": "currentSpace"}}),
        ("POST", "/api/v1/trash/x/restore", None),
        ("POST", "/api/v1/history/restore", {"path": OPEN, "versionId": "x", "version": "v"}),
    ]
    before = {p: p.read_bytes() for p in env.root.rglob("*") if p.is_file()}
    for method, url, body in writes:
        res = env.http.request(method, url, headers=hdr, json=body)
        assert res.status_code == 403, (method, url, res.text)
        assert res.json()["detail"] == "This token can only read."
    assert {p: p.read_bytes() for p in env.root.rglob("*") if p.is_file()} == before
    with pytest.raises(ApiError, match="403"):
        _call(build_server(env.ro, write=True), "write_body", path=OPEN, version="v", body="x")


def test_never_offered(env: Env) -> None:
    names = set(_names(env.server))
    for word in ("purge", "delete_forever", "empty_trash", "settings", "space", "token", "template", "export"):
        assert not any(word in n for n in names), word
    source = (Path(__file__).parents[1] / "objectapp" / "api_v1_tools.py").read_text(encoding="utf-8")
    assert "purge" not in source and "settings" not in source
    routes = [r.path for r in env.http.app.routes if getattr(r, "path", "").startswith("/api/v1/")]
    assert not any(seg in p for p in routes for seg in ("/settings", "/spaces", "/integrations", "/tokens"))
    assert not any(p == "/api/v1/trash" and "DELETE" in r.methods for r in env.http.app.routes
                   for p in [getattr(r, "path", "")])


# -- writes keep the app's safety -----------------------------------------------------


def test_write_body_version_checked(env: Env) -> None:
    before = env.bytes_of(CRLF)
    read = env.call("read", path=CRLF)
    out = env.call("write_body", path=CRLF, version=read["version"], body="New line one.\nNew line two.\n")
    after = env.bytes_of(CRLF)
    assert after.startswith(b"\xef\xbb\xbf")
    _bom, fm_before, _ = before.split(b"---\r\n", 2)
    _bom, fm_after, body_after = after.split(b"---\r\n", 2)

    def kept(fm: bytes) -> list[bytes]:
        # All but the lastUpdated stamp and the `id:` line the app gives an object on its
        # first write.
        return [x for x in fm.split(b"\r\n") if not x.startswith((b"lastUpdated:", b"id:"))]

    assert kept(fm_after) == kept(fm_before)
    assert body_after == b"New line one.\r\nNew line two.\r\n"
    assert b"\n" not in after.replace(b"\r\n", b"")
    with pytest.raises(ApiError) as stale:
        env.call("write_body", path=CRLF, version=read["version"], body="again")
    assert str(stale.value).startswith("Conflict:")
    assert env.bytes_of(CRLF) == after
    assert out["version"] != read["version"]
    assert len(env.call("version_history", path=CRLF)["versions"]) == 1


def test_open_daily_note(env: Env) -> None:
    first = env.call("open_daily_note", date="2026-11-20")
    assert first["created"] is True and (env.root / first["path"]).is_file()
    again = env.call("open_daily_note", date="2026-11-20")
    assert again == {"path": first["path"], "version": again["version"], "created": False}
    assert again["version"]


def test_types_collections_queries_round_trip(env: Env) -> None:
    made = env.call("create_type", name="Book", plural_name="Books")
    tid = made["id"]
    t = env.call("type_definition", type="Book")
    assert t["id"] == tid and t["revision"]
    t["propertyDefinitions"] = [*t.get("propertyDefinitions", []), {
        "id": "author", "key": "author", "name": "Author", "type": "text", "description": "",
        "icon": None, "visibility": "alwaysShow", "options": {},
    }]  # fmt: skip
    saved = env.call("edit_type", type_id=tid, revision=t["revision"], type=t)
    t = env.call("type_definition", type=tid)
    for p in t["propertyDefinitions"]:
        if p["id"] == "author":
            p["name"] = "Writer"
    saved = env.call("edit_type", type_id=tid, revision=t["revision"], type=t)
    assert "Writer" in [p["name"] for p in saved["type"]["propertyDefinitions"]]
    with pytest.raises(ApiError, match="Conflict: .* Current revision: "):
        env.call("edit_type", type_id=tid, revision=t["revision"], type=t)
    t = env.call("type_definition", type=tid)
    kind = env.call("change_property_kind", type_id=tid, property_id="author", to_kind="number", revision=t["revision"])
    assert kind["newPropertyId"]
    book = env.call("create_object", type="Book", title="A book")["path"]
    with pytest.raises(ApiError, match="428") as ask:
        env.call("delete_type", type_id=tid)
    assert _extra(str(ask.value)) == {"affected": 1, "hiddenCount": 0}
    assert (env.root / book).is_file()
    gone = env.call("delete_type", type_id=tid, confirm=True)
    assert book in gone["paths"] and not (env.root / book).exists()
    assert any(i["kind"] == "type" and i["type"] == tid for i in env.call("trash")["items"])

    q = env.call("create_query", name="Books", definition={"structures": [{"id": "page"}]})
    got = env.call("saved_query", query_id=q["id"])
    assert got["revision"]
    edited = env.call("edit_query", query_id=q["id"], revision=got["revision"], query={**got, "name": "Books 2"})
    assert edited["query"]["name"] == "Books 2"
    with pytest.raises(ApiError, match="Conflict"):
        env.call("edit_query", query_id=q["id"], revision=got["revision"], query=got)
    assert env.call("delete_query", query_id=q["id"])["trashId"]
    assert any(i["kind"] == "query" for i in env.call("trash")["items"])

    c = env.call("create_collection", name="Shelf", type_ids=["Page"])
    got = env.call("collection", collection_id=c["id"])
    assert got["revision"] and got["name"] == "Shelf"
    edited = env.call("edit_collection", collection_id=c["id"], revision=got["revision"], collection={**got, "name": "Shelf 2"})
    assert edited["collection"]["name"] == "Shelf 2"
    with pytest.raises(ApiError, match="428") as ask:
        env.call("delete_collection", collection_id=c["id"])
    assert _extra(str(ask.value)) == {"affected": 0, "hiddenCount": 0}
    assert env.call("delete_collection", collection_id=c["id"], confirm=True)["trashId"]
    assert any(i["kind"] == "collection" for i in env.call("trash")["items"])


def test_delete_type_counts_only_visible_objects(env: Env) -> None:
    secret = env.bytes_of(SECRET_PROJECT)
    with pytest.raises(ApiError, match="428") as ask:
        env.call("delete_type", type_id="Project")
    assert _extra(str(ask.value)) == {"affected": 1, "hiddenCount": 1}
    assert MARKER not in str(ask.value) and "Secret project" not in str(ask.value)
    assert env.bytes_of(SECRET_PROJECT) == secret


def test_remove_tags_and_collections(env: Env) -> None:
    before = env.bytes_of(OPEN).decode().splitlines()
    v = env.call("read", path=OPEN)["version"]
    v = env.call("remove_tags", path=OPEN, version=v, tags=["docs"])["version"]
    v = env.call("remove_from_collection", path=OPEN, version=v, collections=["Extra"])["version"]
    # A property write also gives the object its `id:` line (the app's rule, M11's writes too).
    after = [line for line in env.bytes_of(OPEN).decode().splitlines() if not line.startswith("id: ")]
    assert len(before) == len(after)
    changed = {a.split(":", 1)[0] for a, b in zip(before, after, strict=True) if a != b}
    assert changed <= {"tags", "collections", "lastUpdated"} and {"tags", "collections"} <= changed
    text = "\n".join(after)
    assert "[[Keep]]" in text and "[[Docs]]" not in text
    assert "Reading" in text and "Extra" not in text


def test_merge_link_duplicate_change_type(env: Env) -> None:
    copy = env.call("duplicate", path=OPEN)
    assert (env.root / copy["path"]).is_file() and copy["path"] != OPEN
    moved = env.call("change_type", path=copy["path"], version=copy["version"], type="Project")
    assert moved["path"].startswith("Projects/") and not (env.root / copy["path"]).exists()

    mentions = env.call("unlinked_mentions", path=OPEN)["mentions"]
    entry = next(m for m in mentions if m["path"] == MENTIONER)
    occ = entry["occurrences"][0]
    linked = env.call(
        "link_mention", path=MENTIONER, version=entry["version"], target=OPEN,
        start=occ["start"], end=occ["end"], text=occ["text"],
    )
    assert linked["version"] and "[[Open]]" in env.bytes_of(MENTIONER).decode()

    a = env.call("create_object", type="Page", title="Merge source", body="From the source.")
    b = env.call("create_object", type="Page", title="Merge target", body="In the target.")
    merged = env.call("merge", source=a["path"], target=b["path"], source_version=a["version"], target_version=b["version"])
    assert merged and not (env.root / a["path"]).exists()
    assert "From the source." in env.bytes_of(b["path"]).decode()
    assert any(i["originalPath"] == a["path"] for i in env.call("trash")["items"])


def test_whiteboard(env: Env) -> None:
    board = env.call("read_whiteboard", path=env.board)
    assert board["revision"] is not None
    with pytest.raises(ApiError, match="Conflict"):
        env.call("edit_whiteboard", path=env.board, revision="stale", board=board["board"])
    made = env.call("create_whiteboard", title="Second board")
    assert (env.root / made["path"]).is_file()


def test_automations_and_import(env: Env, tmp_path: Path) -> None:
    rule = {"name": "Button", "trigger": {"kind": "button", "scope": None},
            "actions": [{"kind": "notify", "title": "Hi", "body": "{title}"}]}  # fmt: skip
    res = env.http.post("/api/v1/automations", headers=env.rw.headers, json={"rule": rule})
    assert res.status_code == 201, res.text
    made = env.call("create_automation", rule={**rule, "name": "Button 2"})
    assert made["id"]
    assert {r["id"] for r in env.call("automations")["automations"]} >= {made["id"], res.json()["id"]}
    run = env.call("run_automation", rule_id=made["id"], path=OPEN)
    assert run["actions"]

    vault = tmp_path / "vault"
    shutil.copytree(FIXTURES / "import-obsidian", vault)
    vault_before = {p: p.read_bytes() for p in vault.rglob("*") if p.is_file()}
    space_before = {p: p.read_bytes() for p in env.root.rglob("*.md")}
    preview = env.call("import_preview", path=str(vault))
    assert preview["previewId"] and preview["counts"]
    assert {p: p.read_bytes() for p in vault.rglob("*") if p.is_file()} == vault_before
    assert {p: p.read_bytes() for p in env.root.rglob("*.md")} == space_before
    dest = tmp_path / "dest"
    dest.mkdir()
    started = env.call(
        "start_import", preview_id=preview["previewId"],
        target={"kind": "newSpace", "name": "Imported", "location": str(dest)},
    )
    deadline = time.monotonic() + 20
    status = env.call("import_status", job_id=started["jobId"])
    while status.get("state") in ("queued", "running") and time.monotonic() < deadline:
        time.sleep(0.05)
        status = env.call("import_status", job_id=started["jobId"])
    assert status["id"] == started["jobId"]
    assert (dest / "Imported").is_dir()


def test_import_from_a_space_folder_is_refused(env: Env) -> None:
    for path in (env.root, env.root / "Pages"):
        with pytest.raises(ApiError, match="422: Importing from a space folder isn't available to agents."):
            env.call("import_preview", path=str(path))
    # The folders the run fence closes: other agents' folders, the agent trash, the state dir.
    from objectapp.appstate import state_dir

    state = state_dir()
    other = state / "agents" / "Other"
    (other / ".object-agent" / "memory").mkdir(parents=True)
    (other / "CLAUDE.md").write_text("Other agent's soul.", encoding="utf-8")
    trashed = state / "agents" / ".trash" / "Gone"
    trashed.mkdir(parents=True)
    for path in (other, other / ".object-agent" / "memory", trashed, state / "agents" / ".trash", state):
        with pytest.raises(ApiError, match="422: Importing from an agent folder isn't available to agents."):
            env.call("import_preview", path=str(path))


def test_trash_and_versions(env: Env) -> None:
    made = env.call("create_object", type="Page", title="Gone soon", body="Some text.")
    env.call("move_to_trash", path=made["path"], version=made["version"])
    entry = next(i for i in env.call("trash")["items"] if i["originalPath"] == made["path"])
    back = env.call("restore_from_trash", trash_id=entry["id"])
    assert made["path"] in back["paths"] and (env.root / made["path"]).is_file()

    read = env.call("read", path=OPEN)
    first = env.call("write_body", path=OPEN, version=read["version"], body="Changed text.\n")
    versions = env.call("version_history", path=OPEN)["versions"]
    assert versions
    old = env.call("read_version", path=OPEN, version_id=versions[0]["id"])
    assert "A page anyone may read." in json.dumps(old)
    restored = env.call("restore_version", path=OPEN, version_id=versions[0]["id"], version=first["version"])
    assert restored["version"] and "A page anyone may read." in env.bytes_of(OPEN).decode()
    with pytest.raises(ApiError, match="Conflict"):
        env.call("restore_version", path=OPEN, version_id=versions[0]["id"], version=first["version"])
    actions = {e["action"] for e in env.call("changes_since")["activity"]}
    assert {"restore", "body", "restore-version"} <= actions


# -- "Exclude from AI" keeps its promise ------------------------------------------------


def _secret_trashed(env: Env) -> str:
    """Secret moved to the trash by the app's own window; its trash id."""
    version = env.http.get("/api/object", params={"path": SECRET}).json()["version"]
    res = env.http.delete("/api/object", params={"path": SECRET, "baseVersion": version})
    assert res.status_code == 200, res.text
    return res.json()["trashId"]


def _hidden_cases() -> dict[str, Callable[[Env], list[Any]]]:
    """Each case calls tools with Secret (or the template, or the excluded board) and returns
    the answers (or error texts) it got; each must show nothing of them."""

    def attempt(env: Env, name: str, /, **args: Any) -> Any:
        try:
            return env.call(name, **args)
        except ApiError as exc:
            return str(exc)

    def not_found(env: Env, name: str, /, **args: Any) -> str:
        out = attempt(env, name, **args)
        assert isinstance(out, str) and out.startswith("404"), (name, out)
        return out

    def trash_listing(env: Env) -> list[Any]:
        tid = _secret_trashed(env)
        listed = env.call("trash")
        assert tid not in [i["id"] for i in listed["items"]]
        restore = not_found(env, "restore_from_trash", trash_id=tid)
        assert (env.root / ".object" / "trash" / f"{tid}.md").is_file()
        assert not (env.root / SECRET).exists()
        return [listed, restore]

    def mentions(env: Env) -> list[Any]:
        found = env.call("unlinked_mentions", path=OPEN)
        paths = [m["path"] for m in found["mentions"]]
        assert MENTIONER in paths and SECRET not in paths
        return [found]

    def delete_type_affected(env: Env) -> list[Any]:
        out = attempt(env, "delete_type", type_id="Project")
        assert _extra(out) == {"affected": 1, "hiddenCount": 1}
        return [out]

    def edit_type_affected(env: Env) -> list[Any]:
        # Removing Budget takes a value from the visible "Object app" and from the excluded
        # Secret project: the 428 counts only the first.
        secret = env.bytes_of(SECRET_PROJECT)
        t = env.call("type_definition", type="Project")
        t["propertyDefinitions"] = [p for p in t["propertyDefinitions"] if p["key"] != "budget"]
        out = attempt(env, "edit_type", type_id=t["id"], revision=t["revision"], type=t)
        assert isinstance(out, str) and out.startswith("428"), out
        assert _extra(out) == {"affected": 1, "hiddenCount": 1}
        assert "removes values from 1 object." in out and "2 objects" not in out
        assert env.bytes_of(SECRET_PROJECT) == secret
        return [out]

    def delete_collection_lists(env: Env) -> list[Any]:
        ask = attempt(env, "delete_collection", collection_id=env.collection)
        assert _extra(ask) == {"affected": 1, "hiddenCount": 1}
        done = env.call("delete_collection", collection_id=env.collection, confirm=True)
        assert SECRET not in done["removedFrom"] + done["deleted"] and done["hiddenCount"] == 1
        return [ask, done]

    def merge_either_side(env: Env) -> list[Any]:
        v = env.call("read", path=OPEN)["version"]
        return [
            not_found(env, "merge", source=SECRET, target=OPEN, source_version="x", target_version=v),
            not_found(env, "merge", source=OPEN, target=SECRET, source_version=v, target_version="x"),
        ]

    def history(env: Env) -> list[Any]:
        return [
            not_found(env, "version_history", path=SECRET),
            not_found(env, "read_version", path=SECRET, version_id="01JC7ZK3T9Q4M2X8B5N6R1V0WE"),
            not_found(env, "restore_version", path=SECRET, version_id="x", version="x"),
            not_found(env, "version_history", path=TEMPLATE),
        ]

    def board(env: Env) -> list[Any]:
        return [
            not_found(env, "read_whiteboard", path=env.hidden_board),
            not_found(env, "edit_whiteboard", path=env.hidden_board, revision="", board={}),
        ]

    def writes_by_path(env: Env) -> list[Any]:
        out = []
        for path in (SECRET, TEMPLATE):
            out += [
                not_found(env, "write_body", path=path, version="x", body="x"),
                not_found(env, "remove_tags", path=path, version="x", tags=["x"]),
                not_found(env, "remove_from_collection", path=path, version="x", collections=["Reading"]),
                not_found(env, "duplicate", path=path),
                not_found(env, "change_type", path=path, version="x", type="Project"),
            ]
        v = env.call("read", path=MENTIONER)["version"]
        out.append(not_found(env, "link_mention", path=SECRET, version="x", target=OPEN, start=0, end=4, text="Open"))
        out.append(not_found(env, "link_mention", path=MENTIONER, version=v, target=SECRET, start=4, end=8, text="Open"))
        rule = env.call("create_automation", rule={
            "name": "Button", "trigger": {"kind": "button", "scope": None},
            "actions": [{"kind": "notify", "title": "Hi", "body": "{title}"}],
        })  # fmt: skip
        out.append(not_found(env, "run_automation", rule_id=rule["id"], path=SECRET))
        return out

    def automation_lifting_exclusion(env: Env) -> list[Any]:
        tag_id = "01JBQ4Z7S3N8V2K5D9X6T10099"
        (env.root / "Tags").mkdir(exist_ok=True)
        (env.root / "Tags" / "Exclude from AI.md").write_text(
            f"---\nid: {tag_id}\ntype: 'Tag'\ntitle: Exclude from AI\n" + STAMP + "---\n", encoding="utf-8"
        )
        env.space.rescan_file("Tags/Exclude from AI.md")
        trigger = {"kind": "propertyChanged", "scope": {"kind": "type", "id": "page"}, "propertyKey": "title"}
        out = []
        for action in (
            {"kind": "removeTag", "tagId": tag_id},
            {"kind": "setProperty", "key": "tags", "value": []},
            {"kind": "clearProperty", "key": "tags"},
            {"kind": "setProperty", "key": "excludeFromAI", "value": False},
        ):
            got = attempt(env, "create_automation", rule={"name": "Lift", "trigger": trigger, "actions": [action]})
            assert got == "422: An automation made by an agent can't remove “Exclude from AI” or change tags.", got
            out.append(got)
        assert "Lift" not in json.dumps(env.call("automations"))
        # The same rule with a harmless action is accepted, so the refusal is ours.
        ok = env.call("create_automation", rule={"name": "Keep", "trigger": trigger,
                                                 "actions": [{"kind": "addTag", "tagId": tag_id}]})
        assert ok["id"]
        return out

    return {
        "automation": automation_lifting_exclusion,
        "trash": trash_listing,
        "unlinked_mentions": mentions,
        "delete_type": delete_type_affected,
        "edit_type": edit_type_affected,
        "delete_collection": delete_collection_lists,
        "merge": merge_either_side,
        "history": history,
        "whiteboard": board,
        "writes_by_path": writes_by_path,
    }


HIDDEN_CASES = _hidden_cases()


@pytest.mark.parametrize("case", sorted(HIDDEN_CASES))
def test_no_tool_reveals_an_excluded_page(env: Env, case: str) -> None:
    secret_before = env.bytes_of(SECRET)
    board_before = env.bytes_of(env.hidden_board)
    template_before = env.bytes_of(TEMPLATE)
    answers = HIDDEN_CASES[case](env)
    text = json.dumps(answers, default=str)
    assert MARKER not in text
    assert "Secret project" not in text
    if case == "trash":
        return  # Secret is in the trash (moved by the app's window, not a tool)
    if case != "delete_collection":  # the confirmed delete takes Secret out of the collection
        assert env.bytes_of(SECRET) == secret_before
    assert env.bytes_of(env.hidden_board) == board_before
    assert env.bytes_of(TEMPLATE) == template_before
