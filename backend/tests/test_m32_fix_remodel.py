"""M32 fix pass: a space remodelled from a space where Work is on is a space where Work is on.

An import that makes a NEW space from an Object space (`POST /api/import/start`, ``target:
newSpace``) carries the source's Work state into the new space, in the ``space.json`` the new
space is created with: ``workEnabled: true`` when Work is on in the source (its stored switch, the
IT starter's marker, or its data), ``workEnabled: false`` when the source stores the switch off,
nothing otherwise. Without it the new space read Work off, and (the fields rule of this fix pass)
its carried types listed none of their unchanged ticket and work fields, though their files held
them all. The source is never written, and an import into an existing space leaves that space's
switch alone. Synthetic data only.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from m15_helpers import FIXTURES, snapshot, wait_job
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.spaces import create_space
from objectapp.workfields import FIELD_KEYS


@pytest.fixture(autouse=True)
def _state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))


def _config(root: Path) -> dict:
    return json.loads((root / ".object" / "space.json").read_text("utf-8"))


def _set_config(root: Path, **keys) -> None:
    path = root / ".object" / "space.json"
    path.write_text(json.dumps({**json.loads(path.read_text("utf-8")), **keys}), "utf-8")


def _work_space(parent: Path) -> Path:
    """A copy of ``space-work`` (its tasks hold ticket and work values) with the ``space.json``
    a space gets on its first edit (the fixture has none, and a remodel reads a folder as an
    Object space by that file)."""
    root = parent / "Work"
    shutil.copytree(FIXTURES / "space-work", root)
    (root / ".object" / "space.json").write_text(json.dumps({"name": "Work"}), "utf-8")
    return root


def _stored_keys(root: Path, type_id: str) -> list[str]:
    data = json.loads((root / ".object" / "types" / f"{type_id}.json").read_text("utf-8"))
    return [p["key"] for p in data["propertyDefinitions"]]


def _remodel(client: TestClient, source: Path, out: Path, name: str = "Remodel") -> Path:
    """Import the Object space at ``source`` into a new space, as "Remodel this space" does."""
    r = client.post("/api/import/preview",
                    json={"source": {"path": str(source)}, "target": "newSpace", "keepAsSources": False})
    assert r.status_code == 200, r.text
    pv = r.json()
    out.mkdir(exist_ok=True)
    r = client.post("/api/import/start", json={
        "previewId": pv["previewId"], "mapping": pv["mapping"], "keepAsSources": False,
        "target": {"kind": "newSpace", "name": name, "location": str(out)}})
    assert r.status_code == 202, r.text
    job = wait_job(client, r.json()["jobId"])
    assert job["phase"] == "done", job
    return out / name


def _info(root: Path) -> dict:
    with TestClient(create_app(Space(root), watch=False)) as c:
        return c.get("/api/space").json()


def test_a_remodel_of_a_space_with_work_on_by_its_starter_marker_reads_work_on(tmp_path: Path):
    root = tmp_path / "IT ops"
    shutil.copytree(FIXTURES / "space-itops", root)
    assert _config(root) == {"name": "IT ops test", "setup": "itops"}  # made before M32: the marker only
    source = Space(root)
    assert source.work_on() is True
    before = snapshot(root)
    with TestClient(create_app(source, watch=False)) as client:
        new = _remodel(client, root, tmp_path / "out")
    # the new space was created with the switch on; it was not made by the starter
    assert _config(new)["workEnabled"] is True and _config(new)["setup"] == "blank"
    info = _info(new)
    assert info["workOn"] is True and info["workEnabled"] is True
    # so its carried types list what the source's list (and their files hold the same)
    incident = next(t for t in info["types"] if t["id"] == "incident")
    listed = [p["key"] for p in incident["propertyDefinitions"]]
    assert listed == [p.key for p in Space(root).type_by_id("incident").propertyDefinitions]
    assert _stored_keys(new, "incident") == _stored_keys(root, "incident")
    assert snapshot(root) == before  # the source folder is byte for byte as it was


def test_a_remodel_of_a_space_with_work_on_by_its_data_reads_work_on(tmp_path: Path):
    root = _work_space(tmp_path)
    assert "workEnabled" not in _config(root) and _config(root).get("setup") != "itops"
    source = Space(root)
    assert source.work_on() is True  # its tasks hold ticket and work values
    before = snapshot(root)
    with TestClient(create_app(source, watch=False)) as client:
        new = _remodel(client, root, tmp_path / "out")
    assert _config(new)["workEnabled"] is True
    info = _info(new)
    assert info["workOn"] is True
    task = next(t for t in info["types"] if t["id"] == "task")
    assert {p["key"] for p in task["propertyDefinitions"]} >= FIELD_KEYS
    assert snapshot(root) == before


def test_a_remodel_of_a_space_with_the_switch_stored_on_reads_work_on(tmp_path: Path):
    root = create_space("Plain", tmp_path)
    _set_config(root, workEnabled=True)
    source = Space(root)
    source.create_object("page", "A note")
    before = snapshot(root)
    with TestClient(create_app(source, watch=False)) as client:
        new = _remodel(client, root, tmp_path / "out")
    assert _config(new)["workEnabled"] is True and _info(new)["workOn"] is True
    assert snapshot(root) == before


def test_a_remodel_of_a_space_with_work_off_gives_a_space_with_work_off(tmp_path: Path):
    root = create_space("Plain", tmp_path)
    source = Space(root)
    source.create_object("page", "A note")
    source.create_object("task", "Buy milk")
    assert source.work_on() is False
    before = snapshot(root)
    with TestClient(create_app(source, watch=False)) as client:
        new = _remodel(client, root, tmp_path / "out")
    assert "workEnabled" not in _config(new)  # nothing to carry: the default stays the default
    info = _info(new)
    assert info["workOn"] is False and info["workEnabled"] is None
    task = next(t for t in info["types"] if t["id"] == "task")
    assert {p["key"] for p in task["propertyDefinitions"]} & FIELD_KEYS == set()
    assert snapshot(root) == before


def test_a_switch_the_user_set_off_is_carried_though_the_notes_hold_ticket_data(tmp_path: Path):
    root = _work_space(tmp_path)
    _set_config(root, workEnabled=False)
    source = Space(root)
    assert source.work_on() is False
    printer = "Tasks/Printer jams on line 3.md"
    before = snapshot(root)
    with TestClient(create_app(source, watch=False)) as client:
        new = _remodel(client, root, tmp_path / "out")
    assert _config(new)["workEnabled"] is False
    new_space = Space(new)
    assert new_space.work_on() is False
    # no value was lost on the way: the ticket and work values of the task are all there
    want, have = source.read(printer)[1], new_space.read(printer)[1]
    for key in sorted(FIELD_KEYS & want.keys()):
        assert have.get(key) == want[key], key
    assert snapshot(root) == before


def test_an_import_into_an_existing_space_leaves_its_switch_alone(tmp_path: Path):
    """The source is a space with Work on; the target is the open space, where Work is off."""
    source_root = tmp_path / "IT ops"
    shutil.copytree(FIXTURES / "space-itops", source_root)
    target_root = create_space("Mine", tmp_path)
    target = Space(target_root)
    before_source = snapshot(source_root)
    with TestClient(create_app(target, watch=False)) as client:
        r = client.post("/api/import/preview",
                        json={"source": {"path": str(source_root)}, "target": "currentSpace", "keepAsSources": False})
        assert r.status_code == 200, r.text
        pv = r.json()
        r = client.post("/api/import/start", json={
            "previewId": pv["previewId"], "mapping": pv["mapping"], "keepAsSources": False,
            "target": {"kind": "currentSpace"}})
        assert r.status_code == 202, r.text
        assert wait_job(client, r.json()["jobId"])["phase"] == "done"
        info = client.get("/api/space").json()
    assert "workEnabled" not in _config(target_root) and _config(target_root)["setup"] == "blank"
    assert info["workEnabled"] is None
    assert snapshot(source_root) == before_source


def test_a_source_that_is_not_a_space_stores_no_switch(tmp_path: Path):
    notes = tmp_path / "notes"
    notes.mkdir()
    (notes / "One.md").write_text("# One\n\nSome text.\n", "utf-8")
    host = create_space("Host", tmp_path)
    with TestClient(create_app(Space(host), watch=False)) as client:
        new = _remodel(client, notes, tmp_path / "out", "From a folder")
    assert set(_config(new)) <= {"name", "setup", "spaceId"}


def test_create_space_stores_the_switch_it_is_given(tmp_path: Path):
    assert _config(create_space("A", tmp_path, work=True)) == {"name": "A", "setup": "blank", "workEnabled": True}
    assert _config(create_space("B", tmp_path, work=False)) == {"name": "B", "setup": "blank", "workEnabled": False}
    assert _config(create_space("C", tmp_path)) == {"name": "C", "setup": "blank"}
    assert _config(create_space("D", tmp_path, setup="itops"))["workEnabled"] is True
