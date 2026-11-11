"""M32 fix pass, finding 6: a Project marked done still gets ``completed`` with Work off.

A work type other than the basic Task (a Project the basic set made before M32, a type that got
"Add work fields") stamps ``completed`` when its status crosses into the done stage and clears it
on reopen, whatever the Work switch says, as before M32. Only the System inferred from a Ticket ID
is left out of a plain property write while Work is off. The basic Task's own stamp (the Task
hook) is unaffected. Synthetic data only.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from objectapp.basicsetup import basic_types
from objectapp.space import Space
from objectapp.spaces import create_space
from objectapp.typemodel import write_type_json
from objectapp.workfields import is_work_type


def _set_config(root: Path, **keys) -> None:
    path = root / ".object" / "space.json"
    path.write_text(json.dumps({**json.loads(path.read_text("utf-8")), **keys}), "utf-8")


@pytest.fixture
def old_basic(tmp_path: Path) -> Path:
    """A space the basic set made before M32: Project's file holds the work fields and
    ``completed`` (`basic_types(work=True)` is that shape)."""
    root = create_space("Old basic", tmp_path, setup="basic")
    project = next(t for t in basic_types(work=True) if t.id == "project")
    (root / ".object" / "types" / "project.json").unlink()
    write_type_json(root, project, "")
    return root


def _status(sp: Space, rel: str, value: str) -> dict:
    sp.update_properties(rel, {"status": [value]}, sp.read(rel)[2])
    return sp.read(rel)[1]


def test_a_project_marked_done_is_stamped_completed_with_work_off(old_basic: Path):
    sp = Space(old_basic)
    assert sp.work_on() is False
    project = sp.type_by_id("project")
    assert not is_work_type(project) and sp._is_work_kind(project)  # its Steps are not listed
    rel, _version = sp.create_object("project", "Garden")
    fm = _status(sp, rel, "Completed")
    assert fm["status"] == "Completed" and fm.get("completed")
    # reopened: the stamp is cleared, as before M32
    fm = _status(sp, rel, "Planned")
    assert fm["status"] == "Planned" and "completed" not in fm
    # done again, then reopened by removing the status
    assert _status(sp, rel, "Completed").get("completed")
    sp.update_properties(rel, {}, sp.read(rel)[2], remove=["status"])
    assert "completed" not in sp.read(rel)[1]


def test_the_switch_set_off_by_hand_keeps_the_stamp_too(old_basic: Path):
    _set_config(old_basic, workEnabled=True)
    sp = Space(old_basic)
    rel, _version = sp.create_object("project", "Garden")
    assert _status(sp, rel, "Completed").get("completed")  # Work on: as before
    _set_config(old_basic, workEnabled=False)
    assert sp.work_on() is False
    assert "completed" not in _status(sp, rel, "In Progress")
    assert _status(sp, rel, "Completed").get("completed")


def test_a_completed_the_caller_sets_is_kept(old_basic: Path):
    sp = Space(old_basic)
    rel, _version = sp.create_object("project", "Garden")
    when = {"start": "2026-01-02T03:04:05.000Z", "resolution": "time"}
    sp.update_properties(rel, {"status": ["Completed"], "completed": when}, sp.read(rel)[2])
    assert str(sp.read(rel)[1]["completed"]).startswith("2026-01-02")


def test_the_system_is_still_not_inferred_with_work_off(old_basic: Path):
    sp = Space(old_basic)
    rel, _version = sp.create_object("project", "Garden")
    _set_config(old_basic, workEnabled=False)  # a Ticket ID on a Project would turn the default on
    sp.update_properties(rel, {"ticketId": "ABC-12"}, sp.read(rel)[2])
    assert "system" not in sp.read(rel)[1]
    _set_config(old_basic, workEnabled=True)
    rel2, version = sp.create_object("project", "Shed")
    sp.update_properties(rel2, {"ticketId": "ABC-13"}, version)
    assert sp.read(rel2)[1]["system"] == "Jira"


def test_a_project_without_the_work_fields_is_not_stamped(tmp_path: Path):
    """The basic set's Project made with Work off has no Steps and no ``completed``: not a work
    type, so nothing is stamped (unchanged)."""
    root = create_space("New basic", tmp_path, setup="basic")
    sp = Space(root)
    assert not sp._is_work_kind(sp.type_by_id("project"))
    rel, _version = sp.create_object("project", "Garden")
    assert "completed" not in _status(sp, rel, "Completed")


def test_the_basic_tasks_own_stamp_is_unaffected(tmp_path: Path):
    root = create_space("Notes", tmp_path)
    sp = Space(root)
    assert sp.work_on() is False
    rel, _version = sp.create_object("task", "Buy milk")
    fm = _status(sp, rel, "Done")
    first = fm.get("completed")
    assert first and fm["status"] == "Done"
    assert "completed" not in _status(sp, rel, "Not Started")
    _set_config(root, workEnabled=True)
    assert _status(sp, rel, "Done").get("completed")
    assert "completed" not in _status(sp, rel, "In Progress")
