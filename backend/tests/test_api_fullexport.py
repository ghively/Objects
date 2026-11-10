"""M31 item 1: the Full Export routes (`api_fullexport`): a manual export of the open space or of
every registered space as a background job with progress, its refusals, and the automated
export's status."""

from __future__ import annotations

import hashlib
import json
import shutil
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp import fullexport
from objectapp.appstate import state_dir
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.spaces import Registry

FIXTURES = Path(__file__).parent / "fixtures"


def _tree(root: Path) -> dict[str, str]:
    return {
        p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


@pytest.fixture
def spaces(tmp_path: Path) -> tuple[Path, Path]:
    one = tmp_path / "spaces" / "One"
    two = tmp_path / "spaces" / "Two"
    shutil.copytree(FIXTURES / "space-sample", one)
    shutil.copytree(FIXTURES / "space-whiteboard", two)
    (one / ".object").mkdir(exist_ok=True)
    (one / ".object" / "space.json").write_text(json.dumps({"name": "First space"}), "utf-8")
    reg = Registry(state_dir())
    reg.register(one)
    reg.register(two)
    return one, two


@pytest.fixture
def client(spaces: tuple[Path, Path]):
    app = create_app(Space(spaces[0]), None, watch=False)
    app.state.hub.publish = lambda _e: None
    with TestClient(app) as c:
        yield c


def _wait(c: TestClient, job_id: str) -> dict:
    for _ in range(500):
        job = c.get(f"/api/full-export/jobs/{job_id}").json()
        if job["state"] != "running":
            return job
        time.sleep(0.02)
    raise AssertionError("the export did not finish")


def test_export_this_space(client: TestClient, spaces, tmp_path: Path):
    one, two = spaces
    before = (_tree(one), _tree(two))
    dest = tmp_path / "out"
    dest.mkdir()
    res = client.post(
        "/api/full-export",
        json={"scope": "current", "folder": str(dest), "media": True, "wikilinks": True, "titleHeading": False},
    )
    assert res.status_code == 202
    job = res.json()["job"]
    assert job["state"] == "running" and job["scope"] == "current"
    done = _wait(client, job["id"])
    assert done["state"] == "done", done
    result = done["result"]
    top = Path(result["folder"])
    assert top.parent == dest.resolve() and top.name.startswith("Object export First space ")
    assert [s["name"] for s in result["spaces"]] == ["First space"]
    assert result["objects"] > 0 and result["media"] >= 1
    assert done["done"] == done["total"] == result["objects"] + result["media"]
    assert (top / "First space" / "Pages" / "Alpha.md").read_bytes() == (one / "Pages" / "Alpha.md").read_bytes()
    assert (top / "First space" / "Attachments" / "cover.png").is_file()
    assert (_tree(one), _tree(two)) == before


def test_export_all_spaces(client: TestClient, spaces, tmp_path: Path):
    dest = tmp_path / "out"
    dest.mkdir()
    res = client.post("/api/full-export", json={"scope": "all", "folder": str(dest), "media": False})
    done = _wait(client, res.json()["job"]["id"])
    assert done["state"] == "done", done
    top = Path(done["result"]["folder"])
    assert top.name.startswith("Object export All Spaces ")
    assert sorted(p.name for p in top.iterdir()) == ["First space", "Two"]
    assert done["result"]["media"] == 0


def test_options_and_folder_default_to_the_settings(client: TestClient, tmp_path: Path):
    dest = tmp_path / "out"
    dest.mkdir()
    revision = client.get("/api/settings").json().get("revision")
    patched = client.put(
        "/api/settings",
        json={"patch": {"fullExportFolder": str(dest), "fullExportTitleHeading": True, "fullExportMedia": False}, "baseRevision": revision},
    )
    assert patched.status_code == 200, patched.text
    done = _wait(client, client.post("/api/full-export", json={"scope": "current"}).json()["job"]["id"])
    assert done["state"] == "done", done
    top = Path(done["result"]["folder"])
    assert b"# Alpha" in (top / "First space" / "Pages" / "Alpha.md").read_bytes()
    assert not (top / "First space" / "Attachments").exists()


def test_refusals(client: TestClient, spaces, tmp_path: Path):
    one, two = spaces
    assert client.post("/api/full-export", json={"scope": "some", "folder": str(tmp_path)}).status_code == 422
    for folder, words in (
        ("", "Pick a folder for the export."),
        ("relative", "Pick a folder (a full path)."),
        (str(tmp_path / "missing"), "isn't there"),
        (str(one / "Pages"), "outside your spaces"),
        (str(two), "outside your spaces"),
    ):
        res = client.post("/api/full-export", json={"scope": "current", "folder": folder})
        assert res.status_code == 422, folder
        assert words in res.json()["detail"]
    assert client.get("/api/full-export/jobs/nope").status_code == 404


def test_one_export_at_a_time(client: TestClient, tmp_path: Path):
    dest = tmp_path / "out"
    dest.mkdir()
    with fullexport._RUN_LOCK:
        res = client.post("/api/full-export", json={"scope": "current", "folder": str(dest)})
    assert res.status_code == 409
    assert res.json()["detail"] == "An export is running. Wait for it to finish."


def test_status_shows_the_automated_export(client: TestClient, tmp_path: Path):
    st = client.get("/api/full-export/status").json()
    assert st["running"] is None
    auto = st["auto"]
    assert auto["enabled"] is False and auto["lastRun"] is None and auto["blocked"] is None
    revision = client.get("/api/settings").json().get("revision")
    client.put("/api/settings", json={"patch": {"fullExportAuto": True}, "baseRevision": revision})
    auto = client.get("/api/full-export/status").json()["auto"]
    assert auto["enabled"] is True and auto["blocked"] == "Pick a folder for the automated exports."
    assert auto["interval"] == "daily" and auto["scope"] == "current"
