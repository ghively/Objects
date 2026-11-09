"""Version control and backup (2026-11-08): `vcs`, `vcsservice` and the ``/api/vcs`` routes.

Real git in temporary folders; a local bare repository stands in for GitHub/GitLab. The user's
git config is replaced by an empty one (``GIT_CONFIG_GLOBAL``), so the commits' author is
Object's fallback and no global hook, signing or default branch leaks in. The state dir is the
autouse per-test ``OBJECT_STATE_DIR``.
"""

from __future__ import annotations

import os
import subprocess
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp import vcs
from objectapp.appstate import state_dir
from objectapp.history import HistoryStore
from objectapp.server import create_app
from objectapp.space import Space, version_of
from objectapp.spaceconfig import space_id
from objectapp.vcsservice import STATE_IGNORE, VcsRefused, VcsService, commit_message

pytestmark = pytest.mark.skipif(not vcs.available(), reason="git is not installed")

PAGE = "Pages/Source note.md"


@pytest.fixture(autouse=True)
def _plain_git(tmp_path_factory, monkeypatch):
    cfg = tmp_path_factory.mktemp("gitcfg") / "gitconfig"
    cfg.write_text("")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(cfg))
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    monkeypatch.delenv(vcs.GIT_ENV, raising=False)


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


def git(root: Path, *args: str, check: bool = True) -> str:
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    res = subprocess.run(
        ["git", "-c", "user.name=Other", "-c", "user.email=other@example.com", *args],
        cwd=root, capture_output=True, text=True, env=env, check=False,
    )
    if check and res.returncode != 0:
        raise AssertionError(f"git {args}: {res.stderr}")
    return res.stdout


def count(root: Path) -> int:
    return int(git(root, "rev-list", "--count", "HEAD").strip())


@pytest.fixture
def space(m8_space_dir: Path) -> Space:
    return Space(m8_space_dir)


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def service(space: Space, clock: Clock) -> VcsService:
    return VcsService(space, clock=clock)


@pytest.fixture
def bare(tmp_path: Path) -> Path:
    path = tmp_path / "remote.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(path)], check=True)
    return path


# -- turning it on ---------------------------------------------------------------------------


def test_opening_a_space_writes_nothing(m8_space_dir: Path):
    before = sorted(p.relative_to(m8_space_dir) for p in m8_space_dir.rglob("*"))
    app = create_app(Space(m8_space_dir), watch=False)
    with TestClient(app) as c:
        r = c.get("/api/vcs/status")
        assert r.status_code == 200
        body = r.json()
        assert body["enabled"] is False and body["gitAvailable"] is True
    after = sorted(p.relative_to(m8_space_dir) for p in m8_space_dir.rglob("*"))
    assert before == after
    assert not (m8_space_dir / ".git").exists()


def test_enable_inits_ignores_cache_and_makes_the_first_commit(space: Space, service: VcsService):
    (space.root / ".object-cache").mkdir()
    (space.root / ".object-cache" / "index.db").write_bytes(b"cache")
    service.enable_space()
    root = space.root
    assert (root / ".git").is_dir()
    ignore = (root / ".gitignore").read_text()
    assert ".object-cache/" in ignore and vcs.MANAGED_START in ignore
    assert ".object/" not in ignore.replace(".object-cache/", "")
    assert git(root, "log", "--format=%s").strip() == "Object: start version control"
    assert git(root, "log", "--format=%an <%ae>").strip() == "Object <object@localhost>"
    tracked = git(root, "ls-files").splitlines()
    assert PAGE in tracked and ".gitignore" in tracked
    assert ".object/space.json" in tracked
    assert not any(p.startswith(".object-cache") for p in tracked)
    assert space_id(root) is not None
    assert git(root, "status", "--porcelain").strip() == ""


def test_author_comes_from_the_users_git_config(space: Space, service: VcsService, tmp_path_factory, monkeypatch):
    cfg = tmp_path_factory.mktemp("gitcfg2") / "gitconfig"
    cfg.write_text("[user]\n\tname = Gene Test\n\temail = gene@example.com\n")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(cfg))
    service.enable_space()
    assert git(space.root, "log", "--format=%an <%ae>").strip() == "Gene Test <gene@example.com>"


def test_enable_adopts_an_existing_repository_and_keeps_its_history(space: Space, service: VcsService):
    root = space.root
    git(root, "init", "-q", "-b", "trunk")
    (root / ".gitignore").write_text("my-private/\n")
    git(root, "add", "-A")
    git(root, "commit", "-qm", "Gene's own first commit")
    first = git(root, "rev-parse", "HEAD").strip()
    (root / "Pages" / "New page.md").write_text("# New\n")
    service.enable_space()
    assert git(root, "rev-parse", "--abbrev-ref", "HEAD").strip() == "trunk"
    assert git(root, "rev-list", "--max-parents=0", "HEAD").strip() == first
    assert count(root) == 2
    ignore = (root / ".gitignore").read_text()
    assert ignore.startswith("my-private/\n") and ".object-cache/" in ignore
    assert "Object: add 1 object (New page)" in git(root, "log", "-1", "--format=%s")


def test_enable_refuses_a_folder_tracked_by_a_parent_repository(tmp_path: Path, m8_space_dir: Path):
    outer = tmp_path / "outer"
    outer.mkdir()
    inner = outer / "space"
    import shutil

    shutil.copytree(m8_space_dir, inner)
    git(outer, "init", "-q")
    git(outer, "add", "-A")
    git(outer, "commit", "-qm", "outer")
    service = VcsService(Space(inner))
    with pytest.raises(VcsRefused) as info:
        service.enable_space()
    assert "part of the git repository" in info.value.message
    assert not (inner / ".git").exists()


def test_git_missing_keeps_it_off(m8_space_dir: Path, monkeypatch):
    monkeypatch.setenv(vcs.GIT_ENV, str(m8_space_dir / "no-git-here"))
    app = create_app(Space(m8_space_dir), watch=False)
    with TestClient(app) as c:
        assert c.get("/api/vcs/status").json()["gitAvailable"] is False
        r = c.post("/api/vcs/enable", json={"target": "space"})
        assert r.status_code == 422
        assert r.json()["detail"] == "Git isn't installed on this device, so version control stays off."
    assert not (m8_space_dir / ".git").exists()


# -- committing ------------------------------------------------------------------------------


def test_commit_waits_for_a_quiet_spell_and_app_writes_reset_it(space: Space, service: VcsService, clock: Clock):
    service.enable_space()
    root = space.root
    t = service.space_target()
    (root / PAGE).write_text("Edited once.\n")
    service.tick()  # sees the change
    clock.advance(100)
    service.tick()
    assert count(root) == 1
    service.touch()  # an app write: the wait starts again
    clock.advance(100)
    service.tick()
    assert count(root) == 1
    clock.advance(25)
    service.tick()
    assert count(root) == 2
    assert git(root, "log", "-1", "--format=%s").strip() == "Object: edit 1 object (Source note)"
    assert t.warning is None


def test_external_edits_adds_and_deletes_are_committed(space: Space, service: VcsService, clock: Clock):
    service.enable_space()
    root = space.root
    (root / "Pages" / "Brand new.md").write_text("# Brand new\n")
    (root / PAGE).unlink()
    service.tick()
    clock.advance(121)
    service.tick()
    assert count(root) == 2
    names = git(root, "show", "--name-status", "--format=", "HEAD")
    assert "A\tPages/Brand new.md" in names and f"D\t{PAGE}" in names
    assert git(root, "status", "--porcelain").strip() == ""


def test_cache_and_temp_files_are_never_committed(space: Space, service: VcsService, clock: Clock):
    service.enable_space()
    root = space.root
    (root / ".object-cache").mkdir(exist_ok=True)
    (root / ".object-cache" / "search.db").write_bytes(b"x")
    (root / "Pages" / ".Source note.md.ab12cd34.tmp").write_bytes(b"half a write")
    assert service.commit_now(service.space_target()) is None
    assert ".object-cache" not in git(root, "ls-files")


def test_entries_staged_by_another_program_are_left_alone(space: Space, service: VcsService):
    service.enable_space()
    root = space.root
    (root / "Pages" / "Staged elsewhere.md").write_text("staged by someone else\n")
    git(root, "add", "Pages/Staged elsewhere.md")
    (root / PAGE).write_text("Object's own edit.\n")
    t = service.space_target()
    sha = service.commit_now(t)
    assert sha is not None
    committed = git(root, "show", "--name-only", "--format=", "HEAD").split()
    assert committed == ["Pages/Source", "note.md"] or committed == [PAGE] or PAGE in " ".join(committed)
    assert "Staged elsewhere" not in " ".join(committed)
    assert git(root, "diff", "--cached", "--name-only").strip() == "Pages/Staged elsewhere.md"
    assert t.warning is not None and "staged by another program" in t.warning


def test_a_fresh_index_lock_is_waited_for_never_deleted(space: Space, service: VcsService, monkeypatch):
    service.enable_space()
    root = space.root
    lock = root / ".git" / "index.lock"
    (root / PAGE).write_text("Edit while locked.\n")
    lock.write_bytes(b"")

    def release() -> None:
        time.sleep(1.0)
        lock.unlink()

    threading.Thread(target=release).start()
    assert service.commit_now(service.space_target()) is not None
    assert count(root) == 2

    # A lock that stays: the commit gives up with a sentence and the lock is still there.
    monkeypatch.setattr(vcs, "LOCK_WAIT_SECONDS", 0.5)
    (root / PAGE).write_text("Another edit.\n")
    lock.write_bytes(b"")
    with pytest.raises(VcsRefused) as info:
        service.commit_now(service.space_target())
    assert "index.lock" in info.value.message
    assert lock.exists()
    lock.unlink()


def test_no_commit_during_a_merge(space: Space, service: VcsService):
    service.enable_space()
    root = space.root
    git_dir = root / ".git"
    (git_dir / "MERGE_HEAD").write_text(git(root, "rev-parse", "HEAD"))
    (root / PAGE).write_text("Mid-merge edit.\n")
    t = service.space_target()
    assert service.commit_now(t) is None
    assert "merge" in (t.warning or "")


def test_commit_message_summarises_titles():
    changes = [vcs.Change(" ", "M", f"Pages/Note {i}.md") for i in range(5)] + [vcs.Change("?", "?", "Attachments/a.png")]
    msg = commit_message(changes)
    assert msg.splitlines()[0] == "Object: edit 5 objects (Note 0, Note 1, Note 2, …) and 1 other file"
    assert "M Pages/Note 0.md" in msg and "A Attachments/a.png" in msg


def test_app_writes_commit_through_the_api_and_on_shutdown(space: Space):
    app = create_app(space, watch=False)
    with TestClient(app) as c:
        assert c.post("/api/vcs/enable", json={"target": "space"}).status_code == 200
        obj = c.get("/api/object", params={"path": PAGE}).json()
        r = c.put("/api/object/body", json={"path": PAGE, "body": "Saved in the app.\n", "baseVersion": obj["version"]})
        assert r.status_code == 200
        status = c.get("/api/vcs/status").json()
        assert status["pending"] == 1 and status["remote"] is None and status["error"] is None
    # Closing the app (a space switch, quitting) commits what was pending.
    assert count(space.root) == 2
    assert "Source note" in git(space.root, "log", "-1", "--format=%s")


# -- remotes ---------------------------------------------------------------------------------


def test_no_remote_by_default_and_push_now_says_so(space: Space, service: VcsService):
    service.enable_space()
    t = service.space_target()
    st = service.status(t)
    assert st["remote"] is None and st["error"] is None
    with pytest.raises(VcsRefused) as info:
        service.push_now(t)
    assert info.value.message == "No remote is set for this space."


def test_push_now_and_ahead_behind(space: Space, service: VcsService, bare: Path):
    service.enable_space()
    t = service.space_target()
    service.set_remote(t, str(bare), "main", None)
    st = service.status(t)
    assert st["remote"]["neverPushed"] is True and st["remote"]["url"] == str(bare)
    service.push_now(t)
    assert git(bare, "rev-parse", "main").strip() == git(space.root, "rev-parse", "HEAD").strip()
    st = service.status(t)
    assert st["remote"]["ahead"] == 0 and st["remote"]["behind"] == 0 and st["remote"]["lastPush"]
    (space.root / PAGE).write_text("Ahead by one.\n")
    service.commit_now(t)
    assert service.status(t)["remote"]["ahead"] == 1


def test_push_timer(space: Space, service: VcsService, clock: Clock, bare: Path):
    service.enable_space()
    t = service.space_target()
    service.set_remote(t, str(bare), "main", True)
    (space.root / PAGE).write_text("To be pushed.\n")
    service.tick()
    clock.advance(121)
    service.tick()  # commits
    assert git(bare, "branch", "--list").strip() == ""
    clock.advance(601)
    service.tick()  # pushes
    assert git(bare, "rev-parse", "main").strip() == git(space.root, "rev-parse", "HEAD").strip()


def test_auto_push_off_never_pushes_on_its_own(space: Space, service: VcsService, clock: Clock, bare: Path):
    service.enable_space()
    t = service.space_target()
    service.set_remote(t, str(bare), "main", False)
    clock.advance(10_000)
    service.tick()
    assert git(bare, "branch", "--list").strip() == ""


def test_remote_address_is_checked(space: Space, service: VcsService):
    service.enable_space()
    t = service.space_target()
    for bad in ("--upload-pack=touch /tmp/x", "ext::sh -c touch% /tmp/pwned", "two\nlines"):
        with pytest.raises(VcsRefused):
            service.set_remote(t, bad, None, None)
    with pytest.raises(VcsRefused):
        service.set_remote(t, "https://example.com/r.git", "-bad", None)


def _clone_and_commit(bare: Path, where: Path, rel: str, text: str) -> None:
    subprocess.run(["git", "clone", "-q", str(bare), str(where)], check=True)
    (where / rel).write_text(text)
    git(where, "add", "-A")
    git(where, "commit", "-qm", "Edited on another machine")
    git(where, "push", "-q", "origin", "HEAD:main")


def test_fetch_fast_forwards_a_clean_space(space: Space, service: VcsService, bare: Path, tmp_path: Path):
    seen: list[list[str]] = []
    service.on_restored = lambda _t, changed: seen.append(changed)
    service.enable_space()
    t = service.space_target()
    service.set_remote(t, str(bare), "main", None)
    service.push_now(t)
    _clone_and_commit(bare, tmp_path / "laptop", PAGE, "From the laptop.\n")
    state = service.fetch(t)
    assert state.get("pulled") == 1
    assert (space.root / PAGE).read_text() == "From the laptop.\n"
    assert seen == [[PAGE]]


def test_fetch_never_merges_into_a_dirty_space(space: Space, service: VcsService, bare: Path, tmp_path: Path):
    service.enable_space()
    t = service.space_target()
    service.set_remote(t, str(bare), "main", None)
    service.push_now(t)
    _clone_and_commit(bare, tmp_path / "laptop", PAGE, "From the laptop.\n")
    (space.root / "Pages" / "Local only.md").write_text("Not committed yet.\n")
    state = service.fetch(t)
    assert state["behind"] == 1 and "blocked" in state
    assert (space.root / PAGE).read_text() != "From the laptop.\n"


def test_diverged_remote_is_refused_and_left_alone(space: Space, service: VcsService, bare: Path, tmp_path: Path):
    service.enable_space()
    t = service.space_target()
    service.set_remote(t, str(bare), "main", None)
    service.push_now(t)
    _clone_and_commit(bare, tmp_path / "laptop", "Pages/Laptop.md", "Laptop page.\n")
    remote_head = git(bare, "rev-parse", "main").strip()
    (space.root / PAGE).write_text("Desktop edit.\n")
    service.commit_now(t)
    state = service.fetch(t)
    assert state["diverged"] is True and state["ahead"] == 1 and state["behind"] == 1
    assert not (space.root / "Pages" / "Laptop.md").exists()
    with pytest.raises(VcsRefused) as info:
        service.push_now(t)
    assert "diverged" in info.value.message
    assert git(bare, "rev-parse", "main").strip() == remote_head  # never forced
    assert service.status(t)["remote"]["diverged"] is True


def test_open_fetches_and_fast_forwards(space: Space, service: VcsService, bare: Path, tmp_path: Path):
    service.enable_space()
    t = service.space_target()
    service.set_remote(t, str(bare), "main", None)
    service.push_now(t)
    _clone_and_commit(bare, tmp_path / "laptop", PAGE, "Pulled on open.\n")
    fresh = VcsService(Space(space.root))
    fresh._sync_on_open()
    assert (space.root / PAGE).read_text() == "Pulled on open.\n"


# -- history and restore ---------------------------------------------------------------------


def _three_commits(space: Space, service: VcsService) -> tuple[str, str]:
    service.enable_space()
    t = service.space_target()
    first = git(space.root, "rev-parse", "HEAD").strip()
    (space.root / PAGE).write_text("Second state.\n")
    service.commit_now(t)
    (space.root / "Pages" / "Added later.md").write_text("# Added later\n")
    (space.root / PAGE).write_text("Third state.\n")
    service.commit_now(t)
    return first, git(space.root, "rev-parse", "HEAD").strip()


def test_restore_space_is_a_new_commit(space: Space, service: VcsService):
    original = (space.root / PAGE).read_bytes()
    first, head = _three_commits(space, service)
    (space.root / "Pages" / "Pending.md").write_text("Not committed when restoring.\n")
    result = service.restore_space(service.space_target(), first[:9])
    root = space.root
    assert (root / PAGE).read_bytes() == original
    assert not (root / "Pages" / "Added later.md").exists()
    assert not (root / "Pages" / "Pending.md").exists()
    # Nothing was rewritten: the old commits are still there, plus the pending one and the restore.
    assert count(root) == 5
    assert subprocess.run(["git", "merge-base", "--is-ancestor", head, "HEAD"], cwd=root).returncode == 0
    assert git(root, "log", "-1", "--format=%s").startswith(f"Object: restore to {first[:7]}")
    assert "Pending.md" in git(root, "show", "--name-only", "--format=", "HEAD~1")
    assert set(result["changed"]) >= {PAGE, "Pages/Added later.md", "Pages/Pending.md"}
    assert space_id(root) is not None


def test_restore_route_reloads_the_space_and_lists_history(space: Space):
    original = (space.root / PAGE).read_text()
    app = create_app(space, watch=False)
    with TestClient(app) as c:
        c.post("/api/vcs/enable", json={"target": "space"})
        first = c.get("/api/vcs/log").json()["commits"][0]
        obj = c.get("/api/object", params={"path": PAGE}).json()
        c.put("/api/object/body", json={"path": PAGE, "body": "Changed in the app.\n", "baseVersion": obj["version"]})
        c.post("/api/object/rename", json={"path": PAGE, "title": "Renamed note", "baseVersion": c.get("/api/object", params={"path": PAGE}).json()["version"]})
        assert c.post("/api/vcs/commit", json={"target": "space"}).json()["commit"]
        log = c.get("/api/vcs/log").json()
        assert len(log["commits"]) == 2 and log["more"] is False
        files = {f["path"] for f in log["commits"][0]["files"]}
        assert "Pages/Renamed note.md" in files
        diff = c.get("/api/vcs/diff", params={"sha": log["commits"][0]["sha"]}).json()["files"]
        assert any("+Changed in the app." in f["diff"] for f in diff)
        r = c.post("/api/vcs/restore", json={"sha": first["sha"]})
        assert r.status_code == 200, r.text
        assert r.json()["commit"]
        assert (space.root / PAGE).read_text() == original
        assert c.get("/api/object", params={"path": PAGE}).status_code == 200
        assert c.get("/api/object", params={"path": "Pages/Renamed note.md"}).status_code == 404
        assert c.post("/api/vcs/restore", json={"sha": "0000000"}).status_code == 404


def test_file_versions_and_file_restore(space: Space):
    app = create_app(space, watch=False)
    with TestClient(app) as c:
        c.post("/api/vcs/enable", json={"target": "space"})
        original = (space.root / PAGE).read_bytes()
        obj = c.get("/api/object", params={"path": PAGE}).json()
        c.put("/api/object/body", json={"path": PAGE, "body": "Second body.\n", "baseVersion": obj["version"]})
        c.post("/api/vcs/commit", json={"target": "space"})
        versions = c.get("/api/vcs/file-log", params={"path": PAGE}).json()["versions"]
        assert len(versions) == 2
        oldest = versions[-1]
        text = c.get("/api/vcs/file", params={"path": PAGE, "sha": oldest["sha"]}).json()["text"]
        assert "Second body." not in text
        current = c.get("/api/object", params={"path": PAGE}).json()["version"]
        assert c.post("/api/vcs/file-restore", json={"path": PAGE, "sha": oldest["sha"], "baseVersion": "stale"}).status_code == 409
        r = c.post("/api/vcs/file-restore", json={"path": PAGE, "sha": oldest["sha"], "baseVersion": current})
        assert r.status_code == 200, r.text
        assert r.json()["commit"]
        assert (space.root / PAGE).read_bytes() == original
        assert version_of(original) == r.json()["version"]
        assert git(space.root, "log", "-1", "--format=%s").startswith('Object: restore "Source note" to')
        assert git(space.root, "status", "--porcelain").strip() == ""


# -- agents and settings ---------------------------------------------------------------------


def test_agents_and_settings_never_commit_secrets(service: VcsService):
    root = state_dir()
    root.mkdir(parents=True, exist_ok=True)
    (root / "settings.json").write_text('{"theme": "dark"}\n')
    (root / "secrets.json").write_text('{"k": "SECRET"}\n')
    (root / "api-tokens.json").write_text('{"t": "TOKEN"}\n')
    agent = root / "agents" / "helper"
    (agent / ".object-agent" / "sessions").mkdir(parents=True)
    (agent / ".object-agent" / "sessions" / "s1.json").write_text("{}")
    (agent / "CLAUDE.md").write_text("# Helper\n")
    (agent / ".mcp.json").write_text('{"env": {"TOKEN": "x"}}')
    (root / "history" / "abc").mkdir(parents=True)
    (root / "history" / "abc" / "index.json").write_text("[]")
    t = service.enable_state()
    tracked = git(root, "ls-files").splitlines()
    assert "settings.json" in tracked and "agents/helper/CLAUDE.md" in tracked
    for secret in ("secrets.json", "api-tokens.json", "agents/helper/.mcp.json"):
        assert secret not in tracked
    assert not any(p.startswith("history/") or "/sessions/" in p for p in tracked)
    # Even with the managed block gone from .gitignore, a secret file never goes in.
    (root / ".gitignore").write_text("")
    (root / "my-token.txt").write_text("TOKEN")
    (root / "settings.json").write_text('{"theme": "light"}\n')
    service.commit_now(t)
    tracked = git(root, "ls-files").splitlines()
    assert "my-token.txt" not in tracked and "secrets.json" not in tracked
    every = git(root, "log", "--all", "--name-only", "--format=")
    assert "secrets.json" not in every and "token" not in every.replace("api-tokens", "")
    assert all(line in STATE_IGNORE for line in ["secrets.json", "history/"])


# -- the M8 history key ------------------------------------------------------------------------


def test_history_moves_to_the_space_id(space: Space, service: VcsService):
    import hashlib

    legacy = state_dir() / "history" / hashlib.sha1(str(space.root).encode()).hexdigest()[:16]
    (legacy / "path-x").mkdir(parents=True)
    (legacy / "path-x" / "index.json").write_text("[]")
    store = HistoryStore(space.root)
    assert store.dir == legacy  # no id yet: the old folder is read
    service.enable_space()
    sid = space_id(space.root)
    assert store.dir == state_dir() / "history" / sid
    assert (store.dir / "path-x" / "index.json").is_file() and not legacy.exists()


def test_type_saves_keep_a_version(space: Space):
    app = create_app(space, watch=False)
    with TestClient(app) as c:
        types = c.get("/api/space").json()["types"]
        page = next(t for t in types if t["id"] == "page")
        rel = ".object/types/page.json"
        before = (space.root / rel).read_bytes() if (space.root / rel).exists() else None
        r = c.put(f"/api/types/{page['id']}", json={"type": {**page, "pluralName": "Pagez"}, "baseRevision": page["revision"]})
        assert r.status_code == 200, r.text
        versions = c.get("/api/history/definition", params={"path": rel}).json()["versions"]
        if before is not None:
            assert len(versions) == 1
            text = c.get("/api/history/definition/version", params={"path": rel, "id": versions[0]["id"]}).json()["text"]
            assert "Pagez" not in text
        assert c.get("/api/history/definition", params={"path": "Pages/x.md"}).status_code == 400

