import difflib
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from objectapp import __main__ as launcher
from objectapp.server import create_app
from objectapp.space import Conflict, ReadOnly, Space

_LAST_UPDATED_RE = re.compile(r"^lastUpdated: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
_ID_RE = re.compile(r"^id: [0-9A-HJKMNP-TV-Z]{26}$")


@pytest.fixture
def space(space_dir: Path) -> Space:
    return Space(space_dir)


@pytest.fixture
def client(space: Space) -> TestClient:
    return TestClient(create_app(space, None))


def _get(client: TestClient, path: str) -> dict:
    r = client.get("/api/object", params={"path": path})
    assert r.status_code == 200, r.text
    return r.json()


def _put(client: TestClient, path: str, body: str, version: str):
    return client.put(
        "/api/object/body", json={"path": path, "body": body, "baseVersion": version}
    )


def test_get_space_objects_and_object(client: TestClient):
    r = client.get("/api/space")
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "space-sample"
    assert {t["name"] for t in data["types"]} >= {"Task", "Person", "Server", "DailyNote", "Page"}
    assert all("propertyDefinitions" in t for t in data["types"])

    tasks = client.get("/api/objects", params={"type": "task"}).json()
    assert [o["path"] for o in tasks] == ["Tasks/Fix printer.md", "Tasks/Write docs.md"]
    assert set(tasks[0]) >= {"path", "id", "type", "title", "readOnly", "tags"}
    assert len(client.get("/api/objects").json()) > len(tasks)

    obj = _get(client, "Tasks/Write docs.md")
    assert obj["summary"]["title"] == "Write docs"
    assert obj["frontmatter"]["status"] == "Not Started"
    assert obj["body"] == "\nWrite the user guide. See [[Ada Lovelace]].\n"
    assert len(obj["version"]) == 64


def test_get_object_errors(client: TestClient):
    assert client.get("/api/object", params={"path": "Tasks/Nope.md"}).status_code == 404
    assert client.get("/api/object", params={"path": "../outside.md"}).status_code == 400


def test_resolve(client: TestClient):
    r = client.get("/api/resolve", params={"link": "Alpha", "from": "Pages/x.md"})
    assert r.status_code == 200 and r.json() == {"path": "Pages/Alpha.md"}
    r = client.get("/api/resolve", params={"link": "Ada Lovelace"})
    assert r.json() == {"path": "People/Ada Lovelace.md"}
    assert client.get("/api/resolve", params={"link": "No such thing"}).status_code == 404


def test_save_identical_body_writes_nothing(client: TestClient, space_dir: Path):
    target = space_dir / "Tasks" / "Write docs.md"
    before = (target.read_bytes(), target.stat().st_mtime_ns)
    obj = _get(client, "Tasks/Write docs.md")

    r = _put(client, "Tasks/Write docs.md", obj["body"], obj["version"])

    assert r.status_code == 200
    assert r.json() == {"version": obj["version"]}
    assert (target.read_bytes(), target.stat().st_mtime_ns) == before


def test_save_sets_lastUpdated_and_id(client: TestClient, space_dir: Path):
    target = space_dir / "Tasks" / "Write docs.md"
    old_lines = target.read_text(encoding="utf-8").splitlines()
    obj = _get(client, "Tasks/Write docs.md")
    new_body = obj["body"].replace("Write the user guide.", "Write the admin guide.")

    r = _put(client, "Tasks/Write docs.md", new_body, obj["version"])

    assert r.status_code == 200, r.text
    new_lines = target.read_text(encoding="utf-8").splitlines()
    removed = [l[1:] for l in difflib.ndiff(old_lines, new_lines) if l.startswith("- ")]
    added = [l[1:].lstrip() for l in difflib.ndiff(old_lines, new_lines) if l.startswith("+ ")]
    assert sorted(l.strip() for l in removed) == sorted(
        ["lastUpdated: 2026-03-02T10:00:00.000Z", "Write the user guide. See [[Ada Lovelace]]."]
    )
    assert len(added) == 3
    assert "Write the admin guide. See [[Ada Lovelace]]." in added
    assert any(_LAST_UPDATED_RE.match(l) for l in added)
    assert new_lines[0] == "---" and _ID_RE.match(new_lines[1]), new_lines[:3]
    # The id went in first and lastUpdated stayed in its own place.
    assert new_lines.index(next(l for l in new_lines if l.startswith("lastUpdated:"))) == 6

    after = _get(client, "Tasks/Write docs.md")
    assert after["version"] == r.json()["version"] != obj["version"]
    assert after["body"] == new_body
    assert after["summary"]["id"] == new_lines[1][4:]


def test_second_save_keeps_existing_id(client: TestClient, space_dir: Path):
    obj = _get(client, "Tasks/Write docs.md")
    v1 = _put(client, "Tasks/Write docs.md", obj["body"] + "one\n", obj["version"]).json()
    first_id = _get(client, "Tasks/Write docs.md")["summary"]["id"]
    _put(client, "Tasks/Write docs.md", obj["body"] + "two\n", v1["version"])
    text = (space_dir / "Tasks" / "Write docs.md").read_text(encoding="utf-8")
    assert text.count("\nid: ") == 1
    assert _get(client, "Tasks/Write docs.md")["summary"]["id"] == first_id


def test_save_preserves_crlf(client: TestClient, space_dir: Path):
    target = space_dir / "Tasks" / "Fix printer.md"
    obj = _get(client, "Tasks/Fix printer.md")
    assert "\r" not in obj["body"]

    r = _put(client, "Tasks/Fix printer.md", obj["body"] + "Call the vendor.\n", obj["version"])

    assert r.status_code == 200, r.text
    data = target.read_bytes()
    lines = data.split(b"\n")
    assert lines[-1] == b""  # trailing newline kept
    assert all(line.endswith(b"\r") for line in lines[:-1])
    assert b"Call the vendor.\r\n" in data


def test_save_preserves_bom_and_missing_trailing_newline(space: Space, space_dir: Path):
    target = space_dir / "Pages" / "Bom.md"
    target.write_bytes(b"\xef\xbb\xbf---\r\ntitle: Bom\r\n---\r\nno newline at end")
    space.rescan_file("Pages/Bom.md")
    _, _, version = space.read("Pages/Bom.md")

    space.save_body("Pages/Bom.md", "edited, still no newline", version)

    data = target.read_bytes()
    assert data.startswith(b"\xef\xbb\xbf---\r\n")
    assert data.endswith(b"---\r\nedited, still no newline")
    assert b"\n" not in data.replace(b"\r\n", b"")


def test_conflict_on_stale_version(client: TestClient, space_dir: Path):
    target = space_dir / "Tasks" / "Write docs.md"
    obj = _get(client, "Tasks/Write docs.md")
    disk = target.read_bytes().replace(b"Write the user guide.", b"Edited elsewhere.")
    target.write_bytes(disk)

    r = _put(client, "Tasks/Write docs.md", obj["body"] + "mine\n", obj["version"])

    assert r.status_code == 409
    current = r.json()["currentVersion"]
    assert current != obj["version"] and len(current) == 64
    assert target.read_bytes() == disk


def test_conflict_and_readonly_exceptions(space: Space, space_dir: Path):
    with pytest.raises(Conflict) as exc:
        space.save_body("Tasks/Write docs.md", "x\n", "0" * 64)
    assert exc.value.current_version == space.read("Tasks/Write docs.md")[2]
    with pytest.raises(ReadOnly):
        space.save_body("Pages/Broken.md", "x\n", space.read("Pages/Broken.md")[2])


@pytest.mark.parametrize("path", ["Pages/Broken.md", "Pages/Bad yaml.md"])
def test_readonly_broken_frontmatter(client: TestClient, space_dir: Path, path: str):
    target = space_dir / path
    before = (target.read_bytes(), target.stat().st_mtime_ns)
    obj = _get(client, path)
    assert obj["summary"]["readOnly"] is True

    r = _put(client, path, obj["body"] + "edit\n", obj["version"])

    assert r.status_code == 423
    assert r.json()["reason"]
    assert (target.read_bytes(), target.stat().st_mtime_ns) == before


def test_save_without_frontmatter_adds_id_and_lastUpdated(client: TestClient, space_dir: Path):
    target = space_dir / "Pages" / "Notes.md"
    old = target.read_text(encoding="utf-8")
    obj = _get(client, "Pages/Notes.md")

    r = _put(client, "Pages/Notes.md", obj["body"] + "More.\n", obj["version"])

    assert r.status_code == 200, r.text
    lines = target.read_text(encoding="utf-8").splitlines(keepends=True)
    assert lines[0] == "---\n" and _ID_RE.match(lines[1].rstrip("\n"))
    assert _LAST_UPDATED_RE.match(lines[2].rstrip("\n")) and lines[3] == "---\n"
    assert "".join(lines[4:]) == old + "More.\n"


def test_save_bad_requests(client: TestClient):
    assert _put(client, "Tasks/Nope.md", "x", "0" * 64).status_code == 404
    assert _put(client, "../x.md", "x", "0" * 64).status_code == 400
    assert client.put("/api/object/body", json={"path": "Tasks/Write docs.md"}).status_code == 422


def test_save_refreshes_summary(client: TestClient):
    obj = _get(client, "Tasks/Write docs.md")
    _put(client, "Tasks/Write docs.md", obj["body"] + "x\n", obj["version"])
    listed = {o["path"]: o for o in client.get("/api/objects", params={"type": "task"}).json()}
    assert listed["Tasks/Write docs.md"]["id"] is not None
    assert listed["Tasks/Write docs.md"]["lastUpdated"] != "2026-03-02T10:00:00.000Z"


def test_static_files_served(space: Space, tmp_path: Path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>Object</title>", encoding="utf-8")
    c = TestClient(create_app(space, dist))
    r = c.get("/")
    assert r.status_code == 200 and "<title>Object</title>" in r.text
    assert c.get("/api/space").status_code == 200


def test_binds_localhost_only(space_dir: Path):
    config = launcher.build_server_config(Space(space_dir), port=8790, static_dir=None)
    assert config.host == "127.0.0.1"
    assert config.port == 8790


def test_reveal_opens_file_manager(client: TestClient, space_dir: Path, monkeypatch):
    from objectapp import server

    calls: list[Path] = []
    monkeypatch.setattr(server, "reveal_in_file_manager", lambda p: calls.append(p))

    r = client.post("/api/reveal", json={"path": "Tasks/Write docs.md"})
    assert r.status_code == 200, r.text
    assert calls == [space_dir / "Tasks" / "Write docs.md"]

    assert client.post("/api/reveal", json={"path": "../outside.md"}).status_code == 400
    assert client.post("/api/reveal", json={"path": "Tasks/Nope.md"}).status_code == 404
    assert len(calls) == 1


def test_save_keeps_each_untouched_lines_own_ending(space: Space, space_dir: Path):
    target = space_dir / "Pages" / "Mixed.md"
    original = b"---\r\ntype: Page\r\ntitle: M\r\n---\r\nline a\r\nline b\nline c\r\n"
    target.write_bytes(original)
    space.rescan_file("Pages/Mixed.md")
    of, _fm, version = space.read("Pages/Mixed.md")

    space.save_body("Pages/Mixed.md", of.body + "line d\n", version)

    old_lines = original.decode().splitlines(keepends=True)
    new_lines = target.read_bytes().decode().splitlines(keepends=True)
    diff = [
        line
        for line in difflib.ndiff(old_lines, new_lines)
        if line.startswith(("+ ", "- "))
    ]
    added = sorted(line[2:] for line in diff if line.startswith("+ "))
    removed = [line for line in diff if line.startswith("- ")]
    assert removed == []
    assert added[0].startswith("id: ") and added[0].endswith("\r\n")
    assert added[1].startswith("lastUpdated: ") and added[1].endswith("\r\n")
    assert added[2] == "line d\r\n"
    assert len(added) == 3
    assert b"line b\nline c\r\n" in target.read_bytes()


def test_fence_with_trailing_whitespace_opens_read_only(client: TestClient, space_dir: Path):
    target = space_dir / "Pages" / "Spaced fence.md"
    original = b"--- \ntype: Page\n---\nbody\n"
    target.write_bytes(original)
    obj = _get(client, "Pages/Spaced fence.md")
    assert obj["summary"]["readOnly"] is True
    assert "trailing whitespace" in obj["summary"]["readOnlyReason"]

    r = _put(client, "Pages/Spaced fence.md", obj["body"] + "X\n", obj["version"])

    assert r.status_code == 423
    assert target.read_bytes() == original


def test_external_write_during_save_is_a_conflict(space: Space, space_dir: Path, monkeypatch):
    from objectapp import space as space_mod

    target = space_dir / "Tasks" / "Write docs.md"
    of, _fm, version = space.read("Tasks/Write docs.md")
    external = target.read_bytes() + b"written elsewhere mid-save\n"
    real_stamp = space_mod.now_stamp

    def stamp_after_external_write() -> str:
        # Runs after save_body has checked the version but before it writes.
        target.write_bytes(external)
        return real_stamp()

    monkeypatch.setattr(space_mod, "now_stamp", stamp_after_external_write)

    with pytest.raises(Conflict) as exc:
        space.save_body("Tasks/Write docs.md", of.body + "mine\n", version)

    assert target.read_bytes() == external
    assert exc.value.current_version == space_mod.version_of(external)
    assert not [p for p in target.parent.iterdir() if p.name.endswith(".tmp")]
    assert "Tasks/Write docs.md" not in space.own_writes


def test_non_utf8_file_opens_read_only_and_is_never_written(client: TestClient, space_dir: Path):
    target = space_dir / "Pages" / "Latin1.md"
    original = b"---\ntype: Page\ntitle: Caf\xe9\n---\nna\xefve body\n"
    target.write_bytes(original)

    obj = _get(client, "Pages/Latin1.md")

    assert obj["summary"]["readOnly"] is True
    assert "UTF-8" in obj["summary"]["readOnlyReason"]
    assert obj["body"] == "na�ve body\n"
    assert obj["summary"]["title"] == "Caf�"
    assert client.get("/api/objects").status_code == 200
    r = _put(client, "Pages/Latin1.md", obj["body"] + "x\n", obj["version"])
    assert r.status_code == 423
    assert target.read_bytes() == original


def test_save_announces_change_with_client_origin(space: Space):
    import time

    app = create_app(space, None, watch=False)
    published = []
    app.state.hub.publish = published.append
    with TestClient(app) as c:
        obj = _get(c, "Tasks/Write docs.md")
        r = c.put(
            "/api/object/body",
            json={
                "path": "Tasks/Write docs.md",
                "body": obj["body"] + "more\n",
                "baseVersion": obj["version"],
                "clientId": "window-1",
            },
        )
        assert r.status_code == 200, r.text
        deadline = time.monotonic() + 2
        while not published and time.monotonic() < deadline:
            time.sleep(0.01)
        # An unchanged body writes nothing and announces nothing.
        same = _put(c, "Tasks/Write docs.md", obj["body"] + "more\n", r.json()["version"])
        assert same.status_code == 200
        time.sleep(0.05)

    assert len(published) == 1
    ev = published[0]
    assert (ev.kind, ev.path, ev.version, ev.origin) == (
        "changed",
        "Tasks/Write docs.md",
        r.json()["version"],
        "window-1",
    )
