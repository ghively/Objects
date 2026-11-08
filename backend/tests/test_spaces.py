"""M7 Task 4: the spaces registry, creating, opening, removing and switching spaces."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp import __main__ as launcher
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.spaces import Registry, SpaceNameProblem, create_space


@pytest.fixture
def state(tmp_path: Path, monkeypatch) -> Path:
    path = tmp_path / "state"
    monkeypatch.setenv("OBJECT_STATE_DIR", str(path))
    return path


def _tree(root: Path) -> dict[str, str]:
    if not root.exists():
        return {}
    return {
        p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def _folder(tmp_path: Path, name: str, space_name: str | None = None) -> Path:
    root = tmp_path / name
    root.mkdir()
    if space_name is not None:
        (root / ".object").mkdir()
        (root / ".object" / "space.json").write_text(
            json.dumps({"name": space_name, "icon": "ph-star"}), encoding="utf-8"
        )
    return root


def _client(root: Path, on_switch=None) -> TestClient:
    return TestClient(create_app(Space(root), watch=False, on_switch=on_switch))


# -- the registry ---------------------------------------------------------------


def test_registry_register_list_remove(tmp_path: Path, state: Path):
    a = _folder(tmp_path, "alpha", "Alpha space")
    b = _folder(tmp_path, "beta")
    reg = Registry(state)
    assert reg.list() == [] and reg.last_opened() is None
    assert not state.exists()  # reading never creates anything

    reg.register(a, datetime(2026, 10, 1, 9, 0, tzinfo=UTC))
    reg.register(b, datetime(2026, 10, 2, 9, 0, tzinfo=UTC))
    reg.register(a, datetime(2026, 10, 3, 9, 0, tzinfo=UTC))  # moves lastOpened, keeps order

    entries = reg.list(current=b)
    assert [e.path for e in entries] == [str(a.resolve()), str(b.resolve())]
    assert entries[0].name == "Alpha space" and entries[0].icon == "ph-star"
    assert entries[1].name == "beta" and entries[1].icon is None
    assert [e.current for e in entries] == [False, True]
    assert entries[0].lastOpened == "2026-10-03T09:00:00Z"
    assert reg.last_opened() == a.resolve()

    data = json.loads((state / "spaces.json").read_text(encoding="utf-8"))
    assert data["lastOpened"] == str(a.resolve())
    assert [s["path"] for s in data["spaces"]] == [str(a.resolve()), str(b.resolve())]

    reg.remove(a)
    assert [e.path for e in reg.list()] == [str(b.resolve())]
    assert reg.last_opened() is None
    assert a.is_dir() and (a / ".object" / "space.json").is_file()


def test_registry_missing_folder_flagged(tmp_path: Path, state: Path):
    gone = _folder(tmp_path, "gone")
    reg = Registry(state)
    reg.register(gone)
    gone.rmdir()
    before = _tree(state)
    [entry] = reg.list()
    assert entry.missing is True and entry.name == "gone"
    assert _tree(state) == before  # listing never writes


def test_registry_unreadable_file_reads_empty_and_is_replaced(tmp_path: Path, state: Path):
    state.mkdir()
    (state / "spaces.json").write_text("{not json", encoding="utf-8")
    reg = Registry(state)
    assert reg.list() == [] and reg.last_opened() is None
    root = _folder(tmp_path, "s")
    reg.register(root)
    assert [e.path for e in reg.list()] == [str(root.resolve())]


def test_current_space_always_listed(tmp_path: Path, state: Path):
    root = _folder(tmp_path, "here")
    entries = Registry(state).list(current=root)
    assert [(e.path, e.current) for e in entries] == [(str(root.resolve()), True)]
    assert not state.exists()


# -- creating a space -----------------------------------------------------------


def test_create_space_writes_only_space_json(tmp_path: Path, state: Path):
    loc = _folder(tmp_path, "loc")
    path = create_space("  Field notes: 2026 ", loc)
    assert path == loc.resolve() / "Field notes"
    assert _tree(loc) == {
        "Field notes/.object/space.json": hashlib.sha256(
            (json.dumps({"name": "Field notes: 2026"}, indent=2) + "\n").encode()
        ).hexdigest()
    }
    assert [p.name for p in path.iterdir()] == [".object"]

    cur = _folder(tmp_path, "current")
    client = _client(cur)
    resp = client.post("/api/spaces", json={"name": "Second", "location": str(loc)})
    assert resp.status_code == 201
    created = Path(resp.json()["path"])
    assert created == loc.resolve() / "Second"
    assert _tree(created).keys() == {".object/space.json"}
    listed = client.get("/api/spaces").json()["spaces"]
    assert str(created) in [s["path"] for s in listed]
    assert next(s for s in listed if s["path"] == str(created))["name"] == "Second"


def test_create_space_refuses_existing_folder(tmp_path: Path, state: Path):
    loc = _folder(tmp_path, "loc")
    existing = loc / "Taken"
    existing.mkdir()
    (existing / "note.md").write_bytes(b"# keep\r\n")
    before = _tree(loc)
    with pytest.raises(FileExistsError):
        create_space("Taken", loc)
    resp = _client(_folder(tmp_path, "cur")).post(
        "/api/spaces", json={"name": "Taken", "location": str(loc)}
    )
    assert resp.status_code == 409
    assert _tree(loc) == before
    assert not (existing / ".object").exists()


def test_create_space_bad_location_404_bad_name_422(tmp_path: Path, state: Path):
    loc = _folder(tmp_path, "loc")
    client = _client(_folder(tmp_path, "cur"))
    a_file = tmp_path / "file.txt"
    a_file.write_text("x")
    for bad in (str(tmp_path / "nowhere"), str(a_file), ""):
        assert client.post("/api/spaces", json={"name": "N", "location": bad}).status_code == 404
    for name in ("", "   ", "x" * 121):
        assert client.post("/api/spaces", json={"name": name, "location": str(loc)}).status_code == 422
    with pytest.raises(SpaceNameProblem):
        create_space(" ", loc)
    assert list(loc.iterdir()) == []
    assert not (tmp_path / "nowhere").exists()


# -- removing, opening, switching -------------------------------------------------


def test_remove_space_keeps_folder(tmp_path: Path, state: Path):
    cur = _folder(tmp_path, "cur")
    other = _folder(tmp_path, "other", "Other")
    (other / "a.md").write_bytes(b"hello\n")
    before = _tree(other)
    client = _client(cur)
    assert client.post("/api/spaces/open", json={"path": str(other)}).status_code == 200
    resp = client.delete("/api/spaces", params={"path": str(other)})
    assert resp.status_code == 200 and resp.json() == {"ok": True}
    paths = [s["path"] for s in client.get("/api/spaces").json()["spaces"]]
    assert str(other.resolve()) not in paths
    assert _tree(other) == before


def test_remove_current_space_409(tmp_path: Path, state: Path):
    cur = _folder(tmp_path, "cur")
    Registry(state).register(cur)
    client = _client(cur)
    assert client.delete("/api/spaces", params={"path": str(cur)}).status_code == 409
    assert [s["path"] for s in client.get("/api/spaces").json()["spaces"]] == [str(cur.resolve())]


def test_open_space_registers_existing_folder(tmp_path: Path, state: Path):
    cur = _folder(tmp_path, "cur")
    other = _folder(tmp_path, "other", "Other space")
    before = _tree(other)
    client = _client(cur)
    resp = client.post("/api/spaces/open", json={"path": str(other)})
    assert resp.status_code == 200 and resp.json() == {"path": str(other.resolve())}
    spaces = client.get("/api/spaces").json()["spaces"]
    entry = next(s for s in spaces if s["path"] == str(other.resolve()))
    assert entry == {
        "path": str(other.resolve()),
        "name": "Other space",
        "icon": "ph-star",
        "current": False,
        "missing": False,
        "lastOpened": entry["lastOpened"],
    }
    assert entry["lastOpened"] is None  # listed, but never opened
    assert next(s for s in spaces if s["path"] == str(cur.resolve()))["current"] is True
    assert _tree(other) == before
    missing = client.post("/api/spaces/open", json={"path": str(tmp_path / "nope")})
    assert missing.status_code == 404


def test_open_and_create_routes_leave_last_opened(tmp_path: Path, state: Path):
    cur = _folder(tmp_path, "cur")
    other = _folder(tmp_path, "other", "Other space")
    loc = _folder(tmp_path, "loc")
    Registry(state).register(cur, datetime(2026, 10, 1, 9, 0, tzinfo=UTC))
    before = Registry(state)._load()
    client = _client(cur)
    assert client.post("/api/spaces/open", json={"path": str(other)}).status_code == 200
    assert client.post("/api/spaces", json={"name": "New", "location": str(loc)}).status_code == 201
    reg = Registry(state)
    assert reg.last_opened() == cur.resolve()
    after = reg._load()
    assert after["lastOpened"] == before["lastOpened"]
    stamps = {i["path"]: i["lastOpened"] for i in after["spaces"]}
    assert stamps[str(cur.resolve())] == before["spaces"][0]["lastOpened"]
    assert stamps[str(other.resolve())] is None
    assert stamps[str((loc / "New").resolve())] is None
    # Opening an already-listed space again changes nothing either.
    assert client.post("/api/spaces/open", json={"path": str(cur)}).status_code == 200
    assert Registry(state)._load() == after


def test_switch_rejects_non_folder(tmp_path: Path, state: Path):
    calls: list[Path] = []
    client = _client(_folder(tmp_path, "cur"), on_switch=calls.append)
    a_file = tmp_path / "f.md"
    a_file.write_text("x")
    for bad in (str(tmp_path / "missing"), str(a_file), ""):
        assert client.post("/api/spaces/switch", json={"path": bad}).status_code == 404
    assert calls == []


def test_switch_route_calls_host_after_response(tmp_path: Path, state: Path):
    other = _folder(tmp_path, "other")
    calls: list[Path] = []
    client = _client(_folder(tmp_path, "cur"), on_switch=calls.append)
    resp = client.post("/api/spaces/switch", json={"path": str(other)})
    assert resp.status_code == 202 and resp.json() == {"path": str(other.resolve())}
    # Starlette runs the background task once the response has been sent.
    assert calls == [other.resolve()]


def test_switch_without_launcher_503(tmp_path: Path, state: Path):
    other = _folder(tmp_path, "other")
    resp = _client(_folder(tmp_path, "cur")).post("/api/spaces/switch", json={"path": str(other)})
    assert resp.status_code == 503
    assert resp.json()["detail"] == "Switching spaces needs the Object launcher."


def test_spaces_routes_get_writes_nothing(blocks_space_dir: Path, state: Path):
    cur = blocks_space_dir
    before = _tree(cur)
    client = _client(cur)
    client.get("/api/spaces")
    client.get("/api/spaces")
    assert _tree(cur) == before and not state.exists()


# -- start-up ---------------------------------------------------------------------


def _write_settings(state: Path, data: dict) -> None:
    state.mkdir(parents=True, exist_ok=True)
    (state / "settings.json").write_text(json.dumps(data), encoding="utf-8")


def test_startup_space_choice(tmp_path: Path, state: Path):
    given = _folder(tmp_path, "given")
    specific = _folder(tmp_path, "specific")
    last = _folder(tmp_path, "last")

    # Nothing known: the parser error.
    assert launcher.startup_root(None) is None
    with pytest.raises(SystemExit) as exc:
        launcher.main([])
    assert exc.value.code == 2

    Registry(state).register(last)
    assert launcher.startup_root(None) == last.resolve()

    _write_settings(state, {"startupSpace": "specific", "startupSpacePath": str(specific)})
    assert launcher.startup_root(None) == specific.resolve()

    assert launcher.startup_root(given) == given.resolve()  # --space wins

    # A specific folder that is gone falls back to the last opened one.
    _write_settings(state, {"startupSpace": "specific", "startupSpacePath": str(tmp_path / "x")})
    assert launcher.startup_root(None) == last.resolve()
    # The last opened folder gone too: nothing.
    last.rmdir()
    assert launcher.startup_root(None) is None


def test_startup_main_refuses_missing_space(tmp_path: Path, state: Path, capsys):
    with pytest.raises(SystemExit):
        launcher.main(["--space", str(tmp_path / "nope")])
    assert "is not a folder." in capsys.readouterr().err


def test_startup_parser_error_message(state: Path, capsys):
    with pytest.raises(SystemExit):
        launcher.main([])
    assert "Pass --space PATH the first time." in capsys.readouterr().err


def test_startup_on_a_taken_port_exits_with_a_message(
    blocks_space_dir: Path, state: Path, monkeypatch, capsys
):
    """Audit 2026-11-01: a second launch must not open a window on a URL it doesn't serve."""
    import socket

    opened: list[str] = []
    monkeypatch.setattr(launcher.webbrowser, "open", opened.append)
    with socket.socket() as taken:
        taken.bind(("127.0.0.1", 0))
        taken.listen()
        port = taken.getsockname()[1]
        with pytest.raises(SystemExit) as exc:
            launcher.main(["--space", str(blocks_space_dir), "--port", str(port), "--browser"])
    assert exc.value.code == 1
    err = capsys.readouterr().err
    assert f"port {port} is already in use" in err and "--port" in err
    assert opened == []


def test_startup_writes_only_registry_outside_space(
    blocks_space_dir: Path, state: Path, monkeypatch
):
    root = blocks_space_dir
    before = _tree(root)

    ran: list[Path] = []
    monkeypatch.setattr(launcher.uvicorn.Server, "run", lambda self, *a, **k: ran.append(self))
    host = launcher.SpaceHost(port=0, static_dir=None)
    host.run(root)

    assert len(ran) == 1 and host.root == root.resolve()
    assert _tree(root) == before
    assert sorted(_tree(state)) == ["spaces.json"]
    assert Registry(state).last_opened() == root.resolve()


def test_build_server_config_passes_on_switch(tmp_path: Path, state: Path):
    root = _folder(tmp_path, "s")
    calls: list[Path] = []
    config = launcher.build_server_config(Space(root), 0, None, on_switch=calls.append)
    assert config.host == "127.0.0.1"
    other = _folder(tmp_path, "o")
    resp = TestClient(config.app).post("/api/spaces/switch", json={"path": str(other)})
    assert resp.status_code == 202 and calls == [other.resolve()]
    # Three positional arguments still work (the acceptance scripts call it so).
    plain = launcher.build_server_config(Space(root), 0, None)
    assert TestClient(plain.app).post("/api/spaces/switch", json={"path": str(other)}).status_code == 503
