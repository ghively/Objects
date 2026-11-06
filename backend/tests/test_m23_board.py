"""M23 Task 2: the work board (``workboard``) and the general floor list (``workfloor``).

Run on a copy of the overlay space (``m23_helpers.copy_space``) with the clock at
2026-11-05T10:00Z and the space time zone UTC.
"""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path

import m23_helpers
import pytest

from objectapp import workboard, workfloor
from objectapp.propvalues import InvalidValue
from objectapp.space import Space
from objectapp.workservice import FLOOR_NEEDS, FloorItemChanged

NOW = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)
WAITING = "Tasks/Waiting on Pat.md"
FIRMWARE = "Tasks/Scanner firmware.md"
SCANNER = "Projects/Scanner rollout.md"
OLD = "Tasks/Old cleanup.md"


@pytest.fixture
def state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "state"
    monkeypatch.setenv("OBJECT_STATE_DIR", str(path))
    return path


@pytest.fixture
def space(tmp_path: Path, state: Path) -> Space:
    s = Space(m23_helpers.copy_space(tmp_path))
    s.clock = lambda: NOW
    s.tz = UTC
    return s


def _snapshot(root: Path) -> dict[str, bytes]:
    out: dict[str, bytes] = {}
    for dirpath, _dirs, files in os.walk(root):
        if ".object-cache" in Path(dirpath).relative_to(root).parts:
            continue
        for f in files:
            p = Path(dirpath) / f
            out[p.relative_to(root).as_posix()] = p.read_bytes()
    return out


def _listing(root: Path) -> list[str]:
    if not root.exists():
        return []
    return sorted(p.relative_to(root).as_posix() for p in root.rglob("*"))


def test_board_items_and_extras(space: Space) -> None:
    service = m23_helpers.service(space)
    b = workboard.board(space, service, "active")
    assert [i["path"] for i in b["items"]] == [i["path"] for i in service.items("active")]
    assert set(b) >= {"items", "now", "today", "timeZone"}
    assert b["today"] == "2026-11-05"
    by = {i["path"]: i for i in b["items"]}
    waiting = by[WAITING]
    assert waiting["deadline"] == "2026-11-12"
    assert waiting["blockedOnPeople"] == [{"path": "People/Pat Example.md", "title": "Pat Example"}]

    m23_helpers.add_project_work_fields(space)
    b = workboard.board(space, service, "active")
    by = {i["path"]: i for i in b["items"]}
    firmware = by[FIRMWARE]
    assert firmware["projectPath"] == SCANNER
    assert len(firmware["steps"]) == 2
    assert by[SCANNER]["isProject"] is True
    assert firmware["isProject"] is False
    for item in b["items"]:
        assert isinstance(item["typeName"], str) and item["typeName"]
        assert isinstance(item["floorItems"], list)
        assert "hypothesis" in item
        for key in ("fields", "activity", "workNotes", "resolution", "verified", "assumed",
                    "toRaiseConfidence", "findings", "confidenceReason"):
            assert key not in item, (item["path"], key)
    assert firmware["typeName"] == "Task"


def test_board_all_scope(space: Space) -> None:
    service = m23_helpers.service(space)
    active = {i["path"] for i in workboard.board(space, service, "active")["items"]}
    every = [i["path"] for i in workboard.board(space, service, "all")["items"]]
    assert OLD not in active
    assert OLD in every
    assert every == [i["path"] for i in service.items("all")]


def test_board_reads_write_nothing(space: Space, state: Path) -> None:
    m23_helpers.add_project_work_fields(space)
    service = m23_helpers.service(space)
    before = _snapshot(space.root)
    objects = _listing(space.root / ".object")
    states = _listing(state)
    workboard.board(space, service, "active")
    workboard.board(space, service, "all")
    workfloor.general_floor(space)
    assert _snapshot(space.root) == before
    assert _listing(space.root / ".object") == objects
    assert _listing(state) == states


def test_general_floor_ops(space: Space) -> None:
    floor_file = space.root / ".object" / "work" / "floor.json"
    assert workfloor.general_floor(space) == {"items": [], "revision": ""}
    assert not floor_file.exists()

    out = workfloor.general_floor_op(space, "add", place="Line 3", what="Photo of the panel")
    assert floor_file.is_file()
    stored = json.loads(floor_file.read_text("utf-8"))
    assert stored["schemaVersion"] == 1 and len(stored["items"]) == 1
    [item] = out["items"]
    assert len(item["id"]) == 6
    assert item["place"] == "Line 3" and item["what"] == "Photo of the panel"
    assert out["revision"] and out == workfloor.general_floor(space)

    out = workfloor.general_floor_op(space, "collect", item_id=item["id"], item_rev=item["rev"],
                                     found="E-12")
    [item] = out["items"]
    assert item["collected"] == "2026-11-05" and item["found"] == "E-12"

    stale = item["rev"]
    out = workfloor.general_floor_op(space, "uncollect", item_id=item["id"], item_rev=item["rev"])
    [item] = out["items"]
    assert item["collected"] is None and item["found"] == "E-12"

    with pytest.raises(FloorItemChanged):
        workfloor.general_floor_op(space, "remove", item_id=item["id"], item_rev=stale)

    out = workfloor.general_floor_op(space, "edit", item_id=item["id"], item_rev=item["rev"],
                                     place="Line 4")
    [item] = out["items"]
    assert item["place"] == "Line 4" and item["what"] == "Photo of the panel"

    out = workfloor.general_floor_op(space, "remove", item_id=item["id"], item_rev=item["rev"])
    assert out["items"] == []

    with pytest.raises(InvalidValue, match=FLOOR_NEEDS):
        workfloor.general_floor_op(space, "add")

    for n in range(50):
        workfloor.general_floor_op(space, "add", what=f"Thing {n}")
    with pytest.raises(InvalidValue, match="At most 50 floor items."):
        workfloor.general_floor_op(space, "add", what="One too many")
    assert len(workfloor.general_floor(space)["items"]) == 50
