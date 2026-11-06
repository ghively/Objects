"""M22 Task 6: ``Space.write_work`` (the one stamped work write), the work hooks inside
``update_properties``, the Task type topped up with the work fields in memory, and the
virtual Tickets view."""

from __future__ import annotations

import difflib
import json
import shutil
from datetime import UTC, datetime
from pathlib import Path

import pytest
from objectapp import space as space_module
from objectapp.frontmatter import set_keys
from objectapp.propvalues import InvalidValue
from objectapp.queries import QueryDef
from objectapp.space import Conflict, Space, WorkWriteOutcome
from objectapp.workfields import FIELD_KEYS, is_work_type, with_work_fields
from objectapp.workrules import IllegalMove
from objectapp.workvalues import encode_steps, read_steps_strict
from objectapp.workview import TICKETS_ID, api_extra, tickets_default

FIXTURE = Path(__file__).parent / "fixtures" / "space-work"
NOW = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)
PRINTER = "Tasks/Printer jams on line 3.md"
BADGE = "Tasks/Badge reader audit.md"
TONER = "Tasks/Order toner.md"
SCANNER = "Projects/Scanner rollout.md"
LINE = '- 2026-11-05 10:00 Gene added a note: test'


@pytest.fixture
def space(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Space:
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_CLOCK_FILE", str(tmp_path / "clock.txt"))
    root = tmp_path / "space"
    shutil.copytree(FIXTURE, root)
    s = Space(root)
    s.clock = lambda: NOW
    s.tz = UTC
    return s


def _diff(before: bytes, after: bytes) -> tuple[list[bytes], list[bytes]]:
    """(removed lines, added lines), from a line diff of the two files' bytes."""
    a, b = before.splitlines(keepends=True), after.splitlines(keepends=True)
    removed: list[bytes] = []
    added: list[bytes] = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes():
        if op != "equal":
            removed += a[i1:i2]
            added += b[j1:j2]
    return removed, added


def _append_body(line: str):
    def body(text: str, fm: dict) -> str:
        assert isinstance(fm, dict) and "steps" in fm
        return text.rstrip("\n") + "\n" + line + "\n"

    return body


def _approve_step_2(fm: dict) -> dict:
    # As the work service does: read with the codec, change, encode.
    steps = read_steps_strict(fm["steps"])
    steps[1].state = "approved"
    steps[1].approvedAt = "2026-11-05T10:00:00.000Z"
    return {"steps": encode_steps(steps)}


# -- write_work ---------------------------------------------------------------------------------


def test_write_work_is_one_stamped_write(space: Space, monkeypatch: pytest.MonkeyPatch):
    snapshots: list[str] = []
    notices: list = []
    replaces: list[str] = []
    space.before_write = lambda rel, data, oid: snapshots.append(rel)
    space.after_write = notices.append
    real_replace = space_module.os.replace

    def counting_replace(src, dst):
        replaces.append(str(dst))
        return real_replace(src, dst)

    monkeypatch.setattr(space_module.os, "replace", counting_replace)

    path = space.root / PRINTER
    before = path.read_bytes()
    v = space.read(PRINTER)[2]
    out = space.write_work(PRINTER, v, raw=_approve_step_2, body=_append_body(LINE))
    assert isinstance(out, WorkWriteOutcome)
    assert len(snapshots) == 1 and len(notices) == 1 and len(replaces) == 1
    after = path.read_bytes()
    assert out.version != v and out.frontmatter["steps"][1]["state"] == "approved"
    assert LINE in out.body
    # Only the stamp, the step's state (+ approvedAt) and the appended body line changed.
    removed, added = _diff(before, after)
    assert removed == [b"lastUpdated: 2026-11-04T15:10:00.000Z\n", b"    state: open\n"]
    assert sorted(added) == sorted([
        b"lastUpdated: 2026-11-05T10:00:00.000Z\n",
        b"    state: approved\n",
        b"    approvedAt: 2026-11-05T10:00:00.000Z\n",
        (LINE + "\n").encode(),
    ])
    assert after.rstrip().endswith(LINE.encode())


def test_write_work_keeps_crlf_and_bom(space: Space):
    path = space.root / BADGE
    before = path.read_bytes()
    assert before.startswith(b"\xef\xbb\xbf") and b"\r\n" in before

    def done(fm: dict) -> dict:
        steps = read_steps_strict(fm["steps"])
        steps[0].state = "done"
        return {"steps": encode_steps(steps)}

    space.write_work(BADGE, None, raw=done, body=_append_body(LINE))
    after = path.read_bytes()
    assert after.startswith(b"\xef\xbb\xbf")
    assert b"\n" not in after.replace(b"\r\n", b"")
    removed, added = _diff(before, after)
    assert removed == [b"lastUpdated: 2026-11-02T09:00:00.000Z\r\n", b"    state: open\r\n"]
    assert sorted(added) == sorted(
        [b"lastUpdated: 2026-11-05T10:00:00.000Z\r\n", b"    state: done\r\n",
         (LINE + "\r\n").encode()]
    )


def test_write_work_none_removes_a_key(space: Space):
    space.write_work(BADGE, None, raw=lambda fm: {"steps": None})
    _of, fm, _v = space.read(BADGE)
    assert "steps" not in fm


def test_write_work_that_changes_nothing_writes_nothing(space: Space):
    path = space.root / PRINTER
    before = path.read_bytes()
    v = space.read(PRINTER)[2]
    out = space.write_work(PRINTER, v, raw=lambda fm: {}, body=lambda text, fm: text)
    assert out.version == v and path.read_bytes() == before


def test_write_work_aborts_cleanly(space: Space):
    snapshots: list[str] = []
    space.before_write = lambda rel, data, oid: snapshots.append(rel)
    path = space.root / PRINTER
    before = path.read_bytes()
    own = dict(space.own_writes)
    v = space.read(PRINTER)[2]

    def refuse(fm: dict) -> dict:
        raise IllegalMove("Finish the steps before this one first.")

    with pytest.raises(IllegalMove):
        space.write_work(PRINTER, v, raw=refuse)
    with pytest.raises(IllegalMove):
        space.write_work(PRINTER, v, raw=_approve_step_2, body=lambda b, fm: refuse(fm))
    assert path.read_bytes() == before and snapshots == [] and space.own_writes == own
    with pytest.raises(Conflict):
        space.write_work(PRINTER, "stale", raw=_approve_step_2)
    assert path.read_bytes() == before


def test_write_work_updates_go_through_the_hooks(space: Space):
    # updates are encoded as update_properties does (gated kinds allowed: open steps only).
    v = space.read(TONER)[2]
    out = space.write_work(
        TONER, v, updates={"steps": [{"kind": "do", "text": "Order toner for line 3"}],
                           "ticketId": "OPS-9"},
    )
    assert out.frontmatter["steps"][0]["text"] == "Order toner for line 3"
    assert out.frontmatter["system"] == "Jira"
    with pytest.raises(InvalidValue, match="New steps start open."):
        space.write_work(
            TONER, None, updates={"steps": [{"kind": "do", "state": "done", "text": "x"}]}
        )


# -- hooks ----------------------------------------------------------------------------------------


def test_update_properties_refuses_steps(space: Space):
    path = space.root / BADGE
    before = path.read_bytes()
    v = space.read(BADGE)[2]
    with pytest.raises(InvalidValue, match="Steps change with the step actions."):
        space.update_properties(BADGE, {"steps": [{"kind": "do", "text": "x"}]}, v)
    with pytest.raises(InvalidValue, match="Steps change with the step actions."):
        space.update_properties(BADGE, {}, v, remove=["steps"])
    assert path.read_bytes() == before


def test_system_inferred_on_property_write(space: Space):
    v = space.read(BADGE)[2]
    space.update_properties(BADGE, {"ticketId": "OPS-124"}, v)
    _of, fm, v = space.read(BADGE)
    assert fm["ticketId"] == "OPS-124" and fm["system"] == "Jira"

    # A System given in the same update wins.
    v = space.read(TONER)[2]
    space.update_properties(TONER, {"ticketId": "OPS-5", "system": ["ServiceNow"]}, v)
    assert space.read(TONER)[1]["system"] == "ServiceNow"

    # A System already set is left alone.
    v = space.read(PRINTER)[2]
    space.update_properties(PRINTER, {"ticketId": "OPS-77"}, v)
    assert space.read(PRINTER)[1]["system"] == "ServiceNow"


def test_no_system_for_a_non_work_type(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    root = tmp_path / "space"
    shutil.copytree(FIXTURE, root)
    (root / "Pages").mkdir(exist_ok=True)
    (root / "Pages" / "Note.md").write_text(
        "---\ntype: Page\ntitle: Note\n---\nText.\n", encoding="utf-8"
    )
    s = Space(root)
    s.clock = lambda: NOW
    assert not is_work_type(s.type_by_id("page"))
    v = s.read("Pages/Note.md")[2]
    s.update_properties("Pages/Note.md", {"ticketId": "OPS-1"}, v)
    fm = s.read("Pages/Note.md")[1]
    assert fm["ticketId"] == "OPS-1" and "system" not in fm


def _add_work_fields_to_project(space: Space) -> None:
    project, rev = space.refresh_type("project")
    assert project is not None and not is_work_type(project)
    new, added, skipped = with_work_fields(project, space.types)
    assert "completed" in added and skipped == []
    space.save_type(new, rev)
    assert is_work_type(space.type_by_id("project"))


def test_completed_stamp_for_projects(space: Space):
    _add_work_fields_to_project(space)
    v = space.read(SCANNER)[2]
    space.update_properties(SCANNER, {"status": ["Completed"]}, v)
    _of, fm, v = space.read(SCANNER)
    assert fm["status"] == "Completed" and fm["completed"] == "2026-11-05T10:00:00.000Z"
    space.update_properties(SCANNER, {"status": ["In Progress"]}, v)
    assert "completed" not in space.read(SCANNER)[1]

    # A Task still uses the Task hook: one `completed` line, not two.
    v = space.read(BADGE)[2]
    space.update_properties(BADGE, {"status": ["Done"]}, v)
    text = (space.root / BADGE).read_bytes().decode("utf-8-sig")
    assert text.count("completed:") == 1


def test_completed_stamp_through_write_work(space: Space):
    _add_work_fields_to_project(space)
    v = space.read(SCANNER)[2]
    space.write_work(SCANNER, v, updates={"status": ["Completed"]})
    assert space.read(SCANNER)[1]["completed"] == "2026-11-05T10:00:00.000Z"


# -- topping up -----------------------------------------------------------------------------------


def _types_dir(space: Space) -> dict[str, bytes]:
    d = space.root / ".object" / "types"
    return {p.name: p.read_bytes() for p in sorted(d.iterdir())}


def test_task_type_topped_up_without_writing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    root = tmp_path / "space"
    shutil.copytree(FIXTURE, root)
    before = {p.name: p.read_bytes() for p in sorted((root / ".object" / "types").iterdir())}
    s = Space(root)
    s.clock = lambda: NOW
    task = s.type_by_id("task")
    assert task is not None and is_work_type(task)
    keys = {p.key for p in task.propertyDefinitions}
    assert FIELD_KEYS <= keys
    assert task.prop("project").options.get("allowedTypes") == ["project"]
    assert _types_dir(s) == before

    # refresh_type after an outside edit still tops up.
    task_file = root / ".object" / "types" / "task.json"
    data = json.loads(task_file.read_text(encoding="utf-8"))
    data["description"] = "Edited by hand."
    task_file.write_text(json.dumps(data, indent=2), encoding="utf-8")
    t, rev = s.refresh_type("task")
    assert t is not None and is_work_type(t) and t.description == "Edited by hand."

    # Saving any Task type change writes them (M4's rule).
    t.description = "Saved."
    s.save_type(t, rev)
    saved = json.loads(task_file.read_text(encoding="utf-8"))
    saved_keys = {p["key"] for p in saved["propertyDefinitions"]}
    assert FIELD_KEYS <= saved_keys
    assert is_work_type(s.type_by_id("task"))


# -- the Tickets view -----------------------------------------------------------------------------


def _tickets(space: Space):
    return next((q for q in space.list_queries() if q.id == TICKETS_ID), None)


def test_tickets_view_virtual(space: Space):
    queries_dir = space.root / ".object" / "queries"
    q = _tickets(space)
    assert q is not None
    assert q.name == "Tickets" and q.definition["structures"] == [{"id": "task"}]
    assert q.definition["filterGroup"]["elements"] == [
        {"type": "filter", "propertyId": "ticketId", "option": "isNotEmpty"}
    ]
    assert api_extra(q) == {"builtIn": "tickets"}
    assert not (queries_dir / f"{TICKETS_ID}.json").exists()
    assert space.query_revision(TICKETS_ID) == ""

    _add_work_fields_to_project(space)
    q = _tickets(space)
    assert q.definition["structures"] == [{"id": "project"}, {"id": "task"}]
    assert not (queries_dir / f"{TICKETS_ID}.json").exists()

    # Saving with base "" creates the file, with empty structures.
    q.view = {"viewDefinition": {"dataViewLayout": "table"}}
    saved, rev = space.save_query(q, "")
    assert saved.definition["structures"] == [{"id": "project"}, {"id": "task"}]
    assert rev
    stored = json.loads((queries_dir / f"{TICKETS_ID}.json").read_text(encoding="utf-8"))
    assert stored["definition"]["structures"] == []
    assert "builtIn" not in stored
    assert stored["view"]["viewDefinition"]["dataViewLayout"] == "table"
    again = _tickets(space)
    assert again.definition["structures"] == [{"id": "project"}, {"id": "task"}]
    assert again.view["viewDefinition"]["dataViewLayout"] == "table"
    # A later save is a normal one.
    again.name = "Tickets"
    _saved, rev2 = space.save_query(again, rev)
    assert rev2

    with pytest.raises(InvalidValue, match="The Tickets view is built in."):
        space.delete_query(TICKETS_ID)
    assert (queries_dir / f"{TICKETS_ID}.json").exists()


def test_tickets_default_shape():
    d = tickets_default()
    assert d["id"] == TICKETS_ID and d["name"] == "Tickets" and d["titleIsCustom"] is True
    assert d["icon"] == {"type": "iconify", "val": "ph-ticket"}
    assert d["description"] == "Every work item with a Ticket ID."
    assert d["definition"]["structures"] == []
    assert d["definition"]["sorts"] == [{"propertyId": "deskUpdated", "option": "descending"}]
    assert d["definition"]["groupBy"] == {"groups": [{"propertyId": "deskStatus", "option": "label"}]}
    assert d["view"] == {"viewDefinition": {"dataViewLayout": "list"}}


def test_no_tickets_view_without_a_work_type(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    root = tmp_path / "space"
    (root / ".object").mkdir(parents=True)
    (root / "Note.md").write_text("---\ntype: Page\ntitle: Note\n---\n", encoding="utf-8")
    s = Space(root)
    # A space without the basic Task type has no work type.
    assert not any(is_work_type(t) for t in s.types)
    assert _tickets(s) is None
    with pytest.raises(KeyError):
        s.save_query(QueryDef.from_json(tickets_default(), TICKETS_ID), "")
    assert not (root / ".object" / "queries").exists()


def test_set_keys_renders_steps_block_style():
    # write_work hands raw lists to set_keys: block style, indented 2 under the key.
    out = set_keys("title: x\n", {"steps": [{"id": "abcdef", "kind": "do", "state": "open",
                                             "text": "Do it"}]})
    assert "steps:\n  - id: abcdef\n    kind: do\n" in out
