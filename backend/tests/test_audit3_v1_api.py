"""Audit 2026-11-07, lane B: the HTTP API and the v1 local API (findings 4, 12, 22-25)."""

from __future__ import annotations

import os
import sys
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.tokens import TokenStore

REPLACED = "Pages/Caf� notes.md"


def _env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))


def _bearer(space_dir: Path, scope: str) -> dict[str, str]:
    _record, secret = TokenStore(space_dir).create(scope, scope)
    return {"Authorization": f"Bearer {secret}"}


# -- 4: a file name that is not UTF-8 -----------------------------------------------------


@pytest.fixture
def undecodable(space_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """A space holding ``Pages/Caf\\xe9 notes.md`` (Latin-1 bytes) that links to Alpha."""
    if sys.platform != "linux":
        pytest.skip("only Linux file systems take a file name that is not UTF-8")
    _env(tmp_path, monkeypatch)
    raw = os.fsencode(space_dir) + b"/Pages/Caf\xe9 notes.md"
    try:
        with open(raw, "wb") as f:
            f.write(
                b"---\ntype: Page\ntitle: Cafe notes\nrelated:\n  - '[[Alpha]]'\n"
                b"lastUpdated: 2026-11-06T10:00:00.000Z\n---\nBody mentions [[Alpha]] and cafe.\n"
            )
    except OSError:
        pytest.skip("this file system refuses a file name that is not UTF-8")
    with TestClient(
        create_app(Space(space_dir), watch=False), raise_server_exceptions=False
    ) as c:
        deadline = time.monotonic() + 30
        while c.get("/api/search", params={"q": "zzz"}).json().get("partial"):
            assert time.monotonic() < deadline, "the search index did not finish its sync"
            time.sleep(0.05)
        yield c, _bearer(space_dir, "read-write")


def test_undecodable_name_does_not_break_search_or_v1_reads(undecodable):
    c, h = undecodable
    r = c.get("/api/search", params={"q": "Cafe"})
    assert r.status_code == 200, r.text
    assert REPLACED in [x["path"] for x in r.json()["results"]]
    r = c.get("/api/v1/search", params={"q": "Cafe"}, headers=h)
    assert r.status_code == 200, r.text
    assert REPLACED in [x["path"] for x in r.json()["results"]]
    r = c.post("/api/v1/query", json={"typeIds": ["page"]}, headers=h)
    assert r.status_code == 200, r.text
    assert REPLACED in [x["path"] for x in r.json()["rows"]]
    r = c.get("/api/v1/changes", headers=h)
    assert r.status_code == 200, r.text
    assert REPLACED in [x["path"] for x in r.json()["objects"]]
    r = c.get("/api/v1/object/backlinks", params={"path": "Pages/Alpha.md"}, headers=h)
    assert r.status_code == 200, r.text
    assert REPLACED in [x["path"] for x in r.json()["backlinks"]]
    r = c.get("/api/v1/references", params={"path": "Pages/Alpha.md"}, headers=h)
    assert r.status_code == 200, r.text


# -- 12: an empty or blank import-scan path -----------------------------------------------


@pytest.fixture
def client(space_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _env(tmp_path, monkeypatch)
    with TestClient(
        create_app(Space(space_dir), watch=False), raise_server_exceptions=False
    ) as c:
        yield c


@pytest.mark.parametrize("blank", ["", "   ", '""', ' "" '])
def test_blank_scan_path_is_not_the_working_directory(
    client: TestClient, space_dir: Path, tmp_path: Path, monkeypatch, blank: str
):
    cwd = tmp_path / "cwd"
    (cwd / "sub").mkdir(parents=True)
    (cwd / "sub" / "creds.txt").write_text("password = hunter2\n")
    monkeypatch.chdir(cwd)
    r = client.post("/api/import/scan", json={"path": blank})
    assert r.status_code == 404, r.text
    assert r.json() == {"error": "No such file or folder"}
    for scope in ("read", "read-write"):
        h = _bearer(space_dir, scope)
        r = client.post("/api/v1/import/scan", json={"path": blank}, headers=h)
        assert r.status_code in (403, 404), r.text  # 403: a read token may not scan (#24)
        assert "creds.txt" not in r.text
    assert not (space_dir / ".object" / "imports").exists()


# -- 22: two TokenStores on the same file ---------------------------------------------------


def test_token_stores_sharing_a_file_lose_nothing(tmp_path: Path, monkeypatch):
    """Each router makes its own `TokenStore`; their writes must not overwrite each other."""
    from objectapp import tokens as tk

    real_load = tk.TokenStore._load

    def slow_load(self):  # widen the read-modify-write window
        out = real_load(self)
        time.sleep(0.002)
        return out

    monkeypatch.setattr(tk.TokenStore, "_load", slow_load)
    root, state = tmp_path / "space", tmp_path / "state"
    root.mkdir()
    keeper, keeper_secret = TokenStore(root, state).create("keeper", "read")
    stores = [TokenStore(root, state) for _ in range(4)]
    made: list[tuple[str, str]] = []
    errors: list[BaseException] = []
    lock = threading.Lock()

    def churn(store: TokenStore, n: int) -> None:
        try:
            for i in range(n):
                record, secret = store.create(f"t{id(store)}-{i}", "read-write")
                if i % 2:
                    assert store.revoke(record.id)
                else:
                    with lock:
                        made.append((record.id, secret))
                assert store.verify(keeper_secret) is not None
        except BaseException as exc:  # noqa: BLE001 - reported below
            errors.append(exc)

    threads = [
        threading.Thread(target=churn, args=(s, 10)) for s in stores
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    fresh = TokenStore(root, state)
    ids = {t.id for t in fresh.list()}
    assert ids == {keeper.id, *(i for i, _s in made)}
    for _id, secret in made:
        assert fresh.verify(secret) is not None
    assert [p.name for p in state.iterdir()] == ["api-tokens.json"]  # no temp file left


# -- 23: "Exclude from AI" paths in the values of visible objects ----------------------------


SECRET = "Pages/Secret.md"
LINKER = "Pages/Linker.md"


@pytest.fixture
def hidden_space(space_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _env(tmp_path, monkeypatch)
    (space_dir / SECRET).write_text(
        "---\nid: secret1\ntype: Page\ntitle: Secret\nexcludeFromAI: true\nrelated:\n"
        "  - '[[Alpha]]'\nlastUpdated: 2026-11-06T10:00:00.000Z\n---\nThe secret body.\n",
        encoding="utf-8",
    )
    (space_dir / LINKER).write_text(
        "---\nid: linker1\ntype: Page\ntitle: Linker\nrelated:\n  - '[[Secret]]'\n  - '[[Alpha]]'\n"
        "lastUpdated: 2026-11-06T10:00:00.000Z\n---\nA body about quillwort.\n",
        encoding="utf-8",
    )
    with TestClient(
        create_app(Space(space_dir), watch=False), raise_server_exceptions=False
    ) as c:
        deadline = time.monotonic() + 30
        while c.get("/api/search", params={"q": "zzz"}).json().get("partial"):
            assert time.monotonic() < deadline, "the search index did not finish its sync"
            time.sleep(0.05)
        yield c, space_dir


def _no_secret(value) -> None:
    text = repr(value)
    assert SECRET not in text and "Secret" not in text, text


def test_values_of_visible_objects_leave_out_hidden_paths(hidden_space):
    c, space_dir = hidden_space
    h = _bearer(space_dir, "read")
    r = c.get("/api/v1/object/peek", params={"path": LINKER}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["values"]["related"] == [{"target": "Alpha", "path": "Pages/Alpha.md"}]
    _no_secret(r.json())
    r = c.get("/api/v1/object", params={"path": LINKER}, headers=h)
    assert r.json()["values"]["related"] == [{"target": "Alpha", "path": "Pages/Alpha.md"}]
    _no_secret(r.json()["values"])
    r = c.post("/api/v1/query", json={"typeIds": ["page"]}, headers=h)
    rows = {x["path"]: x for x in r.json()["rows"]}
    assert SECRET not in rows
    _no_secret(rows[LINKER]["values"])
    _no_secret(rows["Pages/Alpha.md"]["values"])  # its backlinks
    r = c.get("/api/v1/object/peek", params={"path": "Pages/Alpha.md"}, headers=h)
    _no_secret(r.json()["values"])
    # Search: Linker is found by its body; its properties snippet would name Secret.
    r = c.get("/api/v1/search", params={"q": "quillwort secret"}, headers=h)
    assert r.status_code == 200
    _no_secret(r.json())
    r = c.get("/api/v1/search", params={"q": "secret"}, headers=h)
    _no_secret(r.json())
    # The app's own search (no token) still shows everything.
    r = c.get("/api/search", params={"q": "secret"})
    assert SECRET in [x["path"] for x in r.json()["results"]]


def test_changes_leave_out_hidden_old_paths_and_sources(hidden_space):
    c, space_dir = hidden_space
    from objectapp.tokens import ActivityLog

    record, secret = TokenStore(space_dir).create("rw", "read-write")
    log = ActivityLog(space_dir)
    log.add(record, "rename", LINKER, oldPath=SECRET)
    log.add(record, "merge", LINKER, source=SECRET)
    log.add(record, "rename", LINKER, oldPath="Pages/Old linker.md")
    r = c.get("/api/v1/changes", headers={"Authorization": f"Bearer {secret}"})
    assert r.status_code == 200, r.text
    activity = r.json()["activity"]
    _no_secret(activity)
    assert "Pages/Old linker.md" in [e.get("oldPath") for e in activity]


def test_work_item_fields_leave_out_a_hidden_project(tmp_path: Path, monkeypatch):
    import shutil

    _env(tmp_path, monkeypatch)
    root = tmp_path / "space"
    shutil.copytree(Path(__file__).parent / "fixtures" / "space-work", root)
    project = root / "Projects" / "Scanner rollout.md"
    project.write_text(
        project.read_text(encoding="utf-8").replace("\n---\n", "\nexcludeFromAI: true\n---\n", 1),
        encoding="utf-8",
    )
    task = root / "Tasks" / "Order toner.md"
    task.write_text(
        task.read_text(encoding="utf-8").replace(
            "\n---\n", "\nproject:\n  - '[[Scanner rollout]]'\n---\n", 1
        ),
        encoding="utf-8",
    )
    with TestClient(create_app(Space(root), watch=False), raise_server_exceptions=False) as c:
        h = _bearer(root, "read")
        r = c.get("/api/v1/work/item", params={"path": "Tasks/Order toner.md"}, headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["projectPath"] is None
        assert "Scanner rollout" not in repr(r.json()["fields"]), r.json()["fields"]
        r = c.get("/api/work/item", params={"path": "Tasks/Order toner.md"})  # the app's own
        if r.status_code == 200:
            assert "Scanner rollout" in repr(r.json())


# -- review: the activity log of every server instance on one file -------------------------------


def _activity_record():
    from objectapp.tokens import TokenRecord

    return TokenRecord(id="t", name="n", scope="read-write", space="s", hash="h", createdAt="x")


def test_activity_logs_on_one_file_take_turns(tmp_path: Path):
    """Two ActivityLogs (the v1 router's and a guard's) on one file: one's append-and-trim finishes
    before the other's starts, so a trim can't drop a line written meanwhile."""
    from objectapp.tokens import ActivityLog

    (tmp_path / "space").mkdir()
    a, b = ActivityLog(tmp_path / "space", tmp_path), ActivityLog(tmp_path / "space", tmp_path)
    in_trim, release = threading.Event(), threading.Event()
    trim = a._trim

    def slow_trim() -> None:
        in_trim.set()
        release.wait(5)
        trim()

    a._trim = slow_trim  # type: ignore[method-assign]
    ta = threading.Thread(target=a.add, args=(_activity_record(), "edit", "A.md"))
    ta.start()
    assert in_trim.wait(5)
    tb = threading.Thread(target=b.add, args=(_activity_record(), "edit", "B.md"))
    tb.start()
    time.sleep(0.3)
    waited = tb.is_alive()
    release.set()
    ta.join(5)
    tb.join(5)
    assert waited, "the second log wrote while the first was in its trim"
    assert [e["path"] for e in a.since(None)] == ["A.md", "B.md"]


def test_activity_trim_needs_no_fixed_temp_name(tmp_path: Path, monkeypatch):
    """The trim wrote a fixed ``api-activity.jsonl.tmp``: two at once shared it, and a stray one
    (here a folder) stopped every trim. It writes through a temp file of its own."""
    from objectapp import tokens
    from objectapp.tokens import ActivityLog

    monkeypatch.setattr(tokens, "ACTIVITY_KEEP", 3)
    (tmp_path / "space").mkdir()
    (tmp_path / "api-activity.jsonl.tmp").mkdir()
    log = ActivityLog(tmp_path / "space", tmp_path)
    for i in range(7):
        log.add(_activity_record(), "edit", f"{i}.md")
    assert [e["path"] for e in log.since(None)] == ["4.md", "5.md", "6.md"]
