"""M8 Task 8: deleting a space folder (to the trash, or permanently after a 428)."""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp import spaces as spaces_mod
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.spaces import Registry


@pytest.fixture
def state(tmp_path: Path, monkeypatch) -> Path:
    path = tmp_path / "state"
    monkeypatch.setenv("OBJECT_STATE_DIR", str(path))
    return path


@pytest.fixture
def fake_trash(tmp_path: Path, monkeypatch) -> Path:
    log = tmp_path / "trash.log"
    monkeypatch.setenv("OBJECT_FAKE_TRASH_FILE", str(log))
    return log


def _space(tmp_path: Path, name: str) -> Path:
    root = tmp_path / name
    (root / ".capacities").mkdir(parents=True)
    (root / ".capacities" / "space.json").write_text(json.dumps({"name": name}), encoding="utf-8")
    (root / "Pages").mkdir()
    (root / "Pages" / "Note.md").write_bytes(b"---\r\ntitle: Note\r\n---\r\nBody\r\n")
    return root


def _client(current: Path) -> TestClient:
    return TestClient(create_app(Space(current), watch=False))


def _registered(state: Path) -> list[str]:
    return [e.path for e in Registry(state).list()]


def test_delete_space_refuses_current_409(tmp_path: Path, state: Path, fake_trash: Path):
    current = _space(tmp_path, "current")
    Registry(state).register(current, touch=False)
    with _client(current) as client:
        r = client.post("/api/spaces/delete", json={"path": str(current)})
        assert r.status_code == 409
        # a folder holding the current space is refused too
        r = client.post("/api/spaces/delete", json={"path": str(tmp_path)})
        assert r.status_code == 409
        r = client.post("/api/spaces/delete", json={"path": str(current), "permanent": True})
        assert r.status_code == 409
    assert (current / "Pages" / "Note.md").is_file()
    assert _registered(state) == [str(current.resolve())]
    assert not fake_trash.exists()


def test_delete_space_refuses_unregistered_or_plain_folder_404(
    tmp_path: Path, state: Path, fake_trash: Path
):
    current = _space(tmp_path, "current")
    unregistered = _space(tmp_path, "unregistered")
    plain = tmp_path / "plain"
    plain.mkdir()
    (plain / "keep.txt").write_text("x", encoding="utf-8")
    Registry(state).register(plain, touch=False)  # registered, but no .capacities/
    with _client(current) as client:
        for path, permanent in ((unregistered, False), (plain, False), (plain, True),
                                (tmp_path / "nope", False), ("", False)):
            r = client.post("/api/spaces/delete", json={"path": str(path), "permanent": permanent})
            assert r.status_code == 404, (path, r.text)
    assert (unregistered / "Pages" / "Note.md").is_file()
    assert (plain / "keep.txt").is_file()
    assert not fake_trash.exists()


def test_delete_space_trashes_by_default(tmp_path: Path, state: Path, fake_trash: Path):
    current = _space(tmp_path, "current")
    other = _space(tmp_path, "other")
    reg = Registry(state)
    reg.register(current, touch=False)
    reg.register(other)
    before_state = sorted(p.relative_to(state).as_posix() for p in state.rglob("*"))
    with _client(current) as client:
        r = client.post("/api/spaces/delete", json={"path": str(other)})
        assert r.status_code == 200, r.text
        assert r.json() == {"trashed": True}
        listed = client.get("/api/spaces").json()["spaces"]
    assert not other.exists()
    assert fake_trash.read_text(encoding="utf-8").splitlines() == [str(other.resolve())]
    trashed = state / "fake-trash" / "other"
    assert (trashed / "Pages" / "Note.md").read_bytes() == b"---\r\ntitle: Note\r\n---\r\nBody\r\n"
    assert [s["path"] for s in listed] == [str(current.resolve())]
    assert Registry(state).last_opened() is None  # it was the registry's lastOpened
    # nothing else in the state dir was deleted
    after_state = {p.relative_to(state).as_posix() for p in state.rglob("*")}
    assert set(before_state) <= after_state
    assert current.is_dir() and (current / "Pages" / "Note.md").is_file()


def test_permanent_delete_needs_428_then_rechecks_folder(
    tmp_path: Path, state: Path, monkeypatch
):
    monkeypatch.setenv("OBJECT_FAKE_TRASH_FILE", "unavailable")
    current = _space(tmp_path, "current")
    other = _space(tmp_path, "other")
    swapped = _space(tmp_path, "swapped")
    reg = Registry(state)
    for root in (current, other, swapped):
        reg.register(root, touch=False)
    with _client(current) as client:
        r = client.post("/api/spaces/delete", json={"path": str(other)})
        assert r.status_code == 428, r.text
        assert other.is_dir() and (other / "Pages" / "Note.md").is_file()
        assert str(other.resolve()) in _registered(state)

        r = client.post("/api/spaces/delete", json={"path": str(other), "permanent": True})
        assert r.status_code == 200, r.text
        assert r.json() == {"trashed": False}
        assert not other.exists()
        assert str(other.resolve()) not in _registered(state)

        # a folder swapped in between the check and the delete is refused
        def swap(path: Path) -> None:
            shutil.move(str(path), str(tmp_path / "moved-away"))
            _space(tmp_path, "swapped")

        monkeypatch.setattr(spaces_mod, "_before_permanent_delete", swap)
        r = client.post("/api/spaces/delete", json={"path": str(swapped), "permanent": True})
        assert r.status_code == 404, r.text
    assert (swapped / "Pages" / "Note.md").is_file()
    assert (tmp_path / "moved-away" / "Pages" / "Note.md").is_file()
    assert str(swapped.resolve()) in _registered(state)
    assert current.is_dir()


def test_permanent_delete_refuses_folder_replaced_after_428(
    tmp_path: Path, state: Path, monkeypatch
):
    """The 428 names the folder; a folder swapped in before the confirm is refused (409)."""
    monkeypatch.setenv("OBJECT_FAKE_TRASH_FILE", "unavailable")
    current = _space(tmp_path, "current")
    other = _space(tmp_path, "other")
    Registry(state).register(other, touch=False)
    with _client(current) as client:
        r = client.post("/api/spaces/delete", json={"path": str(other)})
        assert r.status_code == 428, r.text
        token = r.json()["folder"]
        st = os.stat(other)
        assert token == f"{st.st_dev}:{st.st_ino}"

        # the user replaces the folder between the 428 and the confirm
        shutil.move(str(other), str(tmp_path / "original"))
        _space(tmp_path, "other")
        (other / "Pages" / "Replacement.md").write_bytes(b"keep me\n")
        assert os.stat(other).st_ino != st.st_ino

        r = client.post(
            "/api/spaces/delete", json={"path": str(other), "permanent": True, "folder": token}
        )
        assert r.status_code == 409, r.text
    assert (other / "Pages" / "Replacement.md").read_bytes() == b"keep me\n"
    assert (other / "Pages" / "Note.md").is_file()
    assert (tmp_path / "original" / "Pages" / "Note.md").is_file()
    assert str(other.resolve()) in _registered(state)


def test_permanent_delete_with_matching_token_deletes(tmp_path: Path, state: Path, monkeypatch):
    monkeypatch.setenv("OBJECT_FAKE_TRASH_FILE", "unavailable")
    current = _space(tmp_path, "current")
    other = _space(tmp_path, "other")
    Registry(state).register(other, touch=False)
    with _client(current) as client:
        token = client.post("/api/spaces/delete", json={"path": str(other)}).json()["folder"]
        r = client.post(
            "/api/spaces/delete", json={"path": str(other), "permanent": True, "folder": token}
        )
        assert r.status_code == 200, r.text
        assert r.json() == {"trashed": False}
    assert not other.exists()


def test_permanent_delete_os_failure_is_503(tmp_path: Path, state: Path, monkeypatch):
    """Audit 2026-11-01: a file-system failure answers 503 like the rest of the app, not 500."""
    monkeypatch.setenv("OBJECT_FAKE_TRASH_FILE", "unavailable")
    current = _space(tmp_path, "current")
    other = _space(tmp_path, "other")
    Registry(state).register(other, touch=False)

    def busy(_path):
        raise PermissionError(13, "Permission denied")

    monkeypatch.setattr(spaces_mod.shutil, "rmtree", busy)
    with _client(current) as client:
        r = client.post("/api/spaces/delete", json={"path": str(other), "permanent": True})
        assert r.status_code == 503, r.text
        assert "Permission denied" in r.json()["detail"]
    assert other.is_dir()


def test_permanent_recheck_refuses_folder_that_lost_capacities(
    tmp_path: Path, state: Path, monkeypatch
):
    current = _space(tmp_path, "current")
    other = _space(tmp_path, "other")
    Registry(state).register(other, touch=False)
    monkeypatch.setattr(
        spaces_mod, "_before_permanent_delete", lambda p: shutil.rmtree(p / ".capacities")
    )
    with _client(current) as client:
        r = client.post("/api/spaces/delete", json={"path": str(other), "permanent": True})
        assert r.status_code == 404
    assert (other / "Pages" / "Note.md").is_file()


def test_real_trash_failure_maps_to_unavailable(tmp_path: Path, state: Path, monkeypatch):
    """Without the fake, `send2trash`'s permission error is the 428 case and nothing moves."""
    monkeypatch.delenv("OBJECT_FAKE_TRASH_FILE", raising=False)
    import send2trash
    from send2trash.exceptions import TrashPermissionError

    def refuse(path):
        raise TrashPermissionError(path)

    monkeypatch.setattr(send2trash, "send2trash", refuse)
    current = _space(tmp_path, "current")
    other = _space(tmp_path, "other")
    Registry(state).register(other, touch=False)
    with _client(current) as client:
        r = client.post("/api/spaces/delete", json={"path": str(other)})
        assert r.status_code == 428
    assert (other / "Pages" / "Note.md").is_file()


def test_delete_route_writes_nothing_in_current_space(tmp_path: Path, state: Path, fake_trash):
    current = _space(tmp_path, "current")
    other = _space(tmp_path, "other")
    Registry(state).register(other, touch=False)
    snapshot = {
        p.relative_to(current).as_posix(): (p.read_bytes(), os.stat(p).st_mtime_ns)
        for p in current.rglob("*") if p.is_file()
    }
    with _client(current) as client:
        assert client.post("/api/spaces/delete", json={"path": str(other)}).status_code == 200
    after = {
        p.relative_to(current).as_posix(): (p.read_bytes(), os.stat(p).st_mtime_ns)
        for p in current.rglob("*") if p.is_file() and ".capacities/types" not in p.as_posix()
    }
    for rel, value in after.items():
        if rel in snapshot:
            assert snapshot[rel] == value
