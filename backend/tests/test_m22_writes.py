"""M22 Task 7: the work service (``workservice.WorkService``) and its reads (``workread``).

Every work write is one ``Space.write_work`` call: the step list (or the fields) plus the
Activity / Work notes lines, in one stamped write. Run on a copy of ``space-work`` with the
clock at 2026-11-05T10:00Z and the space time zone UTC.
"""

from __future__ import annotations

import difflib
import logging
import shutil
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.automations import check_rule
from objectapp.propvalues import InvalidValue
from objectapp.server import create_app
from objectapp.space import Conflict, Space
from objectapp.workfields import is_work_type, with_work_fields
from objectapp.workrules import IllegalMove
from objectapp.workservice import (
    Actor,
    FloorItemChanged,
    NotWorkItem,
    StepChanged,
    WorkNotice,
    WorkService,
    add_work_listener,
)
from objectapp.workvalues import UnreadableList

FIXTURE = Path(__file__).parent / "fixtures" / "space-work"
NOW = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)
PRINTER = "Tasks/Printer jams on line 3.md"
BADGE = "Tasks/Badge reader audit.md"
TONER = "Tasks/Order toner.md"
PARKED = "Tasks/Parked thing.md"
DESK = "Tasks/Desk closed it.md"
HAND = "Tasks/Hand edited.md"
LAST_WEEK = "Tasks/Last week fix.md"
OLD = "Tasks/Old cleanup.md"
SCANNER = "Projects/Scanner rollout.md"
GENE = Actor("user", "Gene")
AGENT = Actor("agent", "Work")
SPOOLER = "Restart the print spooler on PRN-TEST-01"


@pytest.fixture
def space(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Space:
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    root = tmp_path / "space"
    shutil.copytree(FIXTURE, root)
    s = Space(root)
    s.clock = lambda: NOW
    s.tz = UTC
    return s


@pytest.fixture
def svc(space: Space) -> WorkService:
    return WorkService(space, jira_site=lambda: None, user_name=lambda: "Gene")


def _bytes(space: Space, rel: str) -> bytes:
    return (space.root / rel).read_bytes()


def _diff(before: bytes, after: bytes) -> tuple[list[bytes], list[bytes]]:
    a, b = before.splitlines(keepends=True), after.splitlines(keepends=True)
    removed: list[bytes] = []
    added: list[bytes] = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes():
        if op != "equal":
            removed += a[i1:i2]
            added += b[j1:j2]
    return removed, added


def _step(item: dict, n: int) -> dict:
    return item["steps"][n - 1]


def _by_title(items: list[dict]) -> dict[str, dict]:
    return {i["title"]: i for i in items}


def _add_work_fields_to_project(space: Space) -> None:
    project, rev = space.refresh_type("project")
    new, _added, _skipped = with_work_fields(project, space.types)
    space.save_type(new, rev)
    assert is_work_type(space.type_by_id("project"))


# -- reads ----------------------------------------------------------------------------------------


def test_items_active_scope(space: Space, svc: WorkService):
    before = {p: _bytes(space, p) for p in (PRINTER, BADGE, TONER, PARKED, DESK, HAND)}
    items = _by_title(svc.items())
    assert set(items) == {
        "Printer jams on line 3", "Badge reader audit", "Order toner", "Last week fix",
        "Parked thing", "Desk closed it", "Hand edited",
    }
    everything = _by_title(svc.items("all"))
    assert set(everything) == set(items) | {"Old cleanup"}

    printer = items["Printer jams on line 3"]
    assert printer["turn"] == "approve" and printer["current"]["n"] == 2
    assert printer["current"]["text"] == SPOOLER
    assert printer["stage"] == "doing" and printer["stepCount"] == 3
    assert printer["stepsFinished"] == 1
    assert printer["ticket"]["deskPriority"] == "Medium"
    assert printer["ticket"]["system"] == "ServiceNow"
    assert printer["ticket"]["id"] == "INC0012345"
    assert printer["priority"] == "High" and printer["rank"] == 1 and printer["area"] == "Printers"
    assert printer["lastActivity"]["at"] == "2026-11-04 15:10"
    assert items["Parked thing"]["turn"] == "parked"
    desk = items["Desk closed it"]
    assert desk["turn"] == "close" and desk["deskSays"] == "Resolved"
    assert desk["status"] == "In Progress"
    assert items["Order toner"]["turn"] == "none" and items["Order toner"]["ticket"] is None
    assert items["Order toner"]["stage"] == "ready"
    last = items["Last week fix"]
    assert last["done"] and last["recentlyDone"] and last["stage"] == "done"
    assert last["doneAt"] == "2026-10-30T09:00:00.000Z"
    badge = items["Badge reader audit"]
    assert badge["ticket"]["system"] == "Jira"  # inferred for display
    assert items["Hand edited"]["problems"]
    # sorted by rank (none last), then title
    assert [i["title"] for i in svc.items()][0] == "Printer jams on line 3"
    # nothing was written
    assert {p: _bytes(space, p) for p in before} == before
    assert "system" not in space.read(BADGE)[1]


def test_item_reads(space: Space, svc: WorkService):
    item = svc.item(PRINTER)
    assert [s["id"] for s in item["steps"]] == ["q4m2xa", "r8k1pd", "t2n7vc"]
    assert [s["current"] for s in item["steps"]] == [False, True, False]
    assert _step(item, 2)["actions"] == ["approve", "decline"]
    assert _step(item, 3)["actions"] == []
    assert item["verified"] == ["The spooler log shows 3 crashes on 2026-11-03"]
    assert item["hypothesis"].startswith("The print spooler")
    assert item["activity"][0]["at"] == "2026-11-04 15:10"  # newest first
    assert item["workNotes"][0]["who"] == "Gene"
    assert item["resolution"] is not None
    assert "Verification: Spooler restarted, 20 test prints clean" in item["resolution"]["closeNotes"]
    assert item["fields"]["ticketId"] == "INC0012345"
    assert svc.item(TONER)["resolution"] is None
    with pytest.raises(NotWorkItem, match="This object has no work fields."):
        svc.item(SCANNER)
    with pytest.raises(KeyError):
        svc.item("Tasks/Nope.md")


# -- one write, only its own lines ----------------------------------------------------------------


def test_step_action_diff_is_steps_stamp_and_two_body_lines(space: Space, svc: WorkService):
    snapshots: list[str] = []
    space.before_write = lambda rel, data, oid: snapshots.append(rel)
    before = _bytes(space, PRINTER)
    rev = _step(svc.item(PRINTER), 2)["rev"]
    res = svc.step(PRINTER, "r8k1pd", rev, "approve", GENE, not_before="2026-11-06T07:00:00Z")
    after = _bytes(space, PRINTER)
    activity = (
        '- 2026-11-05 10:00 Gene APPROVED step 2 "Restart the print spooler on PRN-TEST-01" '
        "(not before 2026-11-06 07:00)\n"
    ).encode()
    note = b'- [2026-11-05] Gene: approved step 2 "Restart the print spooler on PRN-TEST-01"\n'
    removed, added = _diff(before, after)
    assert removed == [b"lastUpdated: 2026-11-04T15:10:00.000Z\n", b"    state: open\n"]
    assert added == [
        b"lastUpdated: 2026-11-05T10:00:00.000Z\n",
        b"    state: approved\n",
        b"    notBefore: 2026-11-06T07:00:00.000Z\n",
        b"    approvedAt: 2026-11-05T10:00:00.000Z\n",
        activity,
        note,
    ]
    # the Activity line goes directly under the last one; Wrap-up is untouched
    lines = after.split(b"\n")
    i = lines.index(activity.rstrip(b"\n"))
    assert lines[i - 1].startswith(b"- 2026-11-04 15:10 Gene answered step 1")
    assert after.endswith(b"## Wrap-up\n\nResult:: Spooler restarted, 20 test prints clean\n"
                          b"Prevention:: none needed\n")
    assert snapshots == [PRINTER]
    assert res["activity"] == activity.decode()[2:].rstrip("\n")
    assert res["workNote"] == note.decode()[2:].rstrip("\n")
    assert res["version"] == space.read(PRINTER)[2]
    assert _step(res["item"], 2)["state"] == "approved"
    assert res["frontmatter"]["lastUpdated"] and "## Activity" in res["body"]

    # The CRLF+BOM Badge file: `done` on step 1 keeps both, makes `## Activity`, no Work notes.
    before = _bytes(space, BADGE)
    rev = _step(svc.item(BADGE), 1)["rev"]
    res = svc.step(BADGE, "b7c2nd", rev, "done", GENE)
    after = _bytes(space, BADGE)
    assert after.startswith(b"\xef\xbb\xbf") and b"\n" not in after.replace(b"\r\n", b"")
    removed, added = _diff(before, after)
    assert removed == [b"lastUpdated: 2026-11-02T09:00:00.000Z\r\n", b"    state: open\r\n"]
    assert added[:3] == [
        b"lastUpdated: 2026-11-05T10:00:00.000Z\r\n",
        b"    state: done\r\n",
        b"    doneAt: 2026-11-05T10:00:00.000Z\r\n",
    ]
    tail = b"".join(added[3:])
    assert tail.endswith(
        b"## Activity\r\n\r\n"
        b'- 2026-11-05 10:00 Gene marked done step 1 "List the badge readers at the east door"\r\n'
    )
    assert b"Work notes" not in after and res["workNote"] is None
    assert snapshots == [PRINTER, BADGE]


# -- the gate -------------------------------------------------------------------------------------

GATE_CASES = [
    ("agent approve", PRINTER, 2, "approve", AGENT, {}, "Only you can do this to a step."),
    ("agent decline", PRINTER, 2, "decline", AGENT, {}, "Only you can do this to a step."),
    ("agent reopen", PRINTER, 1, "reopen", AGENT, {}, "Only you can do this to a step."),
    ("agent answer", PARKED, 1, "answer", AGENT, {"text": "Night"},
     "Only you can do this to a step."),
    ("user complete", PRINTER, 2, "complete", GENE, {"text": "done"},
     "Only the agent reports a step's result."),
    ("user done on approve", PRINTER, 2, "done", GENE, {},
     "Only the agent marks an Approve step done."),
]


@pytest.mark.parametrize(
    ("path", "n", "action", "actor", "extra", "message"),
    [c[1:] for c in GATE_CASES],
    ids=[c[0] for c in GATE_CASES],
)
def test_gate_cannot_be_bypassed(space, svc, path, n, action, actor, extra, message):
    before = _bytes(space, path)
    step = _step(svc.item(path), n)
    with pytest.raises(IllegalMove) as exc:
        svc.step(path, step["id"], step["rev"], action, actor, **extra)
    assert str(exc.value) == message
    assert _bytes(space, path) == before


RESHAPE = "Agents can't move or remove an Approve step, or change a step to or from Approve."
GATE_OP_CASES = [
    ("agent turns the open Approve step into an Agent step",
     {"op": "edit", "stepId": "r8k1pd", "kind": "agent"}, RESHAPE),
    ("agent turns the open Approve step into a Do step",
     {"op": "edit", "stepId": "r8k1pd", "kind": "do"}, RESHAPE),
    ("agent removes the open Approve step", {"op": "remove", "stepId": "r8k1pd"}, RESHAPE),
    ("agent moves the open Approve step last",
     {"op": "move", "stepId": "r8k1pd", "before": None}, RESHAPE),
    ("agent moves its step ahead of the Approve step",
     {"op": "move", "stepId": "t2n7vc", "before": "r8k1pd"},
     "Agents can't put an Agent step ahead of an Approve step."),
    ("agent adds a step ahead of the Approve step",
     {"op": "add", "kind": "agent", "text": "Restart it", "before": "r8k1pd"},
     "Agents can't put an Agent step ahead of an Approve step."),
]


@pytest.mark.parametrize("op, message", [c[1:] for c in GATE_OP_CASES],
                         ids=[c[0] for c in GATE_OP_CASES])
def test_gate_cannot_be_bypassed_with_step_ops(space, svc, op, message):
    before = _bytes(space, PRINTER)
    item = svc.item(PRINTER)
    if "stepId" in op:
        op = {**op, "stepRev": next(s["rev"] for s in item["steps"] if s["id"] == op["stepId"])}
    with pytest.raises(IllegalMove) as exc:
        svc.edit_steps(PRINTER, [op], AGENT)
    assert str(exc.value) == message
    assert _bytes(space, PRINTER) == before
    # ... and so the agent still can't finish the step Gene hasn't approved.
    s2 = _step(svc.item(PRINTER), 2)
    with pytest.raises(IllegalMove):
        svc.step(PRINTER, s2["id"], s2["rev"], "complete", AGENT, text="Restarted")
    assert _bytes(space, PRINTER) == before


def _v1(space: Space) -> tuple[TestClient, dict[str, str]]:
    client = TestClient(create_app(space, None, watch=False))
    tok = client.post("/api/integrations/tokens", json={"name": "Work", "scope": "read-write"})
    return client, {"Authorization": f"Bearer {tok.json()['secret']}"}


def _app_step(client: TestClient, n: int, action: str) -> None:
    s = _step(client.get("/api/work/item", params={"path": PRINTER}).json(), n)
    res = client.post("/api/work/step", json={"path": PRINTER, "stepId": s["id"], "stepRev": s["rev"],
                                              "action": action})
    assert res.status_code == 200, res.text


def test_gate_cannot_be_bypassed_by_version_restore(space: Space):
    from objectapp.history import HistoryStore

    client, hdr = _v1(space)
    _app_step(client, 2, "approve")  # keeps the open version
    space.clock = lambda: datetime(2026, 11, 5, 10, 30, tzinfo=UTC)
    _app_step(client, 2, "reopen")  # Gene withdraws: keeps the approved version
    store = HistoryStore(space.root)
    versions = {v["id"]: store.content(PRINTER, v["id"])["text"] for v in store.versions(PRINTER)}
    approved = next(i for i, t in versions.items() if "state: approved" in t)
    still_open = next(i for i, t in versions.items() if "state: approved" not in t)
    before = _bytes(space, PRINTER)
    v = space.read(PRINTER)[2]
    res = client.post("/api/v1/history/restore",
                      json={"path": PRINTER, "versionId": approved, "version": v}, headers=hdr)
    assert res.status_code == 422 and res.json()["detail"] == "Steps change with the step actions."
    assert _bytes(space, PRINTER) == before
    # A version that brings back no approval restores as before.
    res = client.post("/api/v1/history/restore",
                      json={"path": PRINTER, "versionId": still_open, "version": v}, headers=hdr)
    assert res.status_code == 200, res.text
    # Gene's own restore is unchanged.
    v = space.read(PRINTER)[2]
    res = client.post("/api/history/restore", json={"path": PRINTER, "id": approved, "baseVersion": v})
    assert res.status_code == 200, res.text
    assert "state: approved" in space.read(PRINTER)[0].frontmatter_src


def test_gate_cannot_be_bypassed_by_duplicate(space: Space):
    client, hdr = _v1(space)
    # No approval to copy: the agent may duplicate.
    res = client.post("/api/v1/object/duplicate", json={"path": PRINTER}, headers=hdr)
    assert res.status_code == 201, res.text
    _app_step(client, 2, "approve")
    before = sorted(p.name for p in (space.root / "Tasks").iterdir())
    res = client.post("/api/v1/object/duplicate", json={"path": PRINTER}, headers=hdr)
    assert res.status_code == 422 and res.json()["detail"] == "Steps change with the step actions."
    assert sorted(p.name for p in (space.root / "Tasks").iterdir()) == before
    # Gene's own duplicate is unchanged.
    res = client.post("/api/object/duplicate", json={"path": PRINTER})
    assert res.status_code == 201, res.text


def test_gate_approved_text_edit(space: Space, svc: WorkService):
    step = _step(svc.item(PRINTER), 2)
    svc.step(PRINTER, step["id"], step["rev"], "approve", GENE)
    before = _bytes(space, PRINTER)
    step = _step(svc.item(PRINTER), 2)
    with pytest.raises(IllegalMove, match="Withdraw the approval before changing this step."):
        svc.edit_steps(
            PRINTER,
            [{"op": "edit", "stepId": step["id"], "stepRev": step["rev"], "text": "Reboot it"}],
            GENE,
        )
    assert _bytes(space, PRINTER) == before


def test_gate_generic_paths(space: Space, tmp_path: Path):
    app = create_app(space, None, watch=False)
    client = TestClient(app)
    before = _bytes(space, PRINTER)
    v = space.read(PRINTER)[2]
    steps = [{"kind": "do", "text": "x"}]
    res = client.put(
        "/api/object/properties", json={"path": PRINTER, "updates": {"steps": steps}, "baseVersion": v}
    )
    assert res.status_code == 422 and res.json()["detail"] == "Steps change with the step actions."
    tok = client.post("/api/integrations/tokens", json={"name": "Work", "scope": "read-write"})
    hdr = {"Authorization": f"Bearer {tok.json()['secret']}"}
    res = client.post(
        "/api/v1/object/properties",
        json={"path": PRINTER, "version": v, "set": {"steps": steps}},
        headers=hdr,
    )
    assert res.status_code == 422 and "Steps change with the step actions." in res.text
    rule = {
        "name": "Touch steps",
        "trigger": {"kind": "propertyChanged", "scope": {"kind": "type", "id": "task"},
                    "propertyKey": "status"},
        "actions": [{"kind": "setProperty", "key": "steps", "value": steps}],
    }
    with pytest.raises(InvalidValue):
        check_rule(space, rule)
    res = client.post(
        "/api/objects",
        json={"typeId": "task", "title": "Sneaky",
              "values": {"steps": [{"kind": "approve", "state": "approved", "text": "x"}]}},
    )
    assert res.status_code == 422 and res.json()["detail"] == "New steps start open."
    assert not (space.root / "Tasks" / "Sneaky.md").exists()
    assert _bytes(space, PRINTER) == before


# -- revisions ------------------------------------------------------------------------------------


def test_stale_step_is_refused(space: Space, svc: WorkService):
    item = svc.item(PRINTER)
    s2 = _step(item, 2)
    svc.step(PRINTER, s2["id"], s2["rev"], "approve", GENE)
    before = _bytes(space, PRINTER)
    with pytest.raises(StepChanged) as exc:
        svc.step(PRINTER, s2["id"], s2["rev"], "approve", GENE)
    assert str(exc.value) == "This step changed. Look again."
    assert exc.value.step is not None and exc.value.step["state"] == "approved"
    assert exc.value.step["id"] == "r8k1pd"
    assert exc.value.current_version == space.read(PRINTER)[2]
    assert _bytes(space, PRINTER) == before
    with pytest.raises(StepChanged):
        svc.step(PRINTER, "zzzzzz", "000000000000", "approve", GENE)

    # another step with its own fresh rev still lands, although the version changed
    s1 = _step(item, 1)  # read before the approve: its rev is still good
    res = svc.step(PRINTER, s1["id"], s1["rev"], "reopen", GENE)
    assert _step(res["item"], 1)["state"] == "open"


def test_agent_completes_and_fails(space: Space, svc: WorkService):
    s2 = _step(svc.item(PRINTER), 2)
    svc.step(PRINTER, s2["id"], s2["rev"], "approve", GENE)
    s2 = _step(svc.item(PRINTER), 2)
    res = svc.step(PRINTER, s2["id"], s2["rev"], "complete", AGENT, text="Spooler restarted")
    assert _step(res["item"], 2)["state"] == "done"
    assert _step(res["item"], 2)["result"] == "Spooler restarted"
    assert res["activity"] == "2026-11-05 10:00 Work completed step 2: Spooler restarted"
    assert res["item"]["turn"] == "agent"  # step 3 is an Agent step

    s3 = _step(res["item"], 3)
    svc.step(PRINTER, s3["id"], s3["rev"], "run", GENE)
    s3 = _step(svc.item(PRINTER), 3)
    res = svc.step(PRINTER, s3["id"], s3["rev"], "fail", AGENT, text="The log is locked",
                   ask="Who can unlock the spooler log?")
    item = res["item"]
    assert [s["kind"] for s in item["steps"]] == ["question", "approve", "question", "agent"]
    assert _step(item, 3)["text"] == "Who can unlock the spooler log?"
    assert _step(item, 4)["state"] == "open" and _step(item, 4)["result"] == "The log is locked"
    assert item["turn"] == "you"
    assert res["activity"] == "2026-11-05 10:00 Work could not do step 3: The log is locked"


def test_hand_edited_list(space: Space, svc: WorkService):
    item = svc.item(HAND)
    assert item["problems"] and any("maybe" in p for p in item["problems"])
    assert item["stepsUnreadable"] is True  # fix pass H: the UI offers no step actions
    assert all(s["actions"] == [] for s in item["steps"]) and item["current"]["actions"] == []
    before = _bytes(space, HAND)
    s1 = _step(item, 1)
    with pytest.raises(UnreadableList):
        svc.step(HAND, s1["id"], s1["rev"], "done", GENE)
    with pytest.raises(UnreadableList):
        svc.edit_steps(HAND, [{"op": "add", "kind": "do", "text": "More"}], GENE)
    assert _bytes(space, HAND) == before


def test_ids_assigned_on_first_write(space: Space, svc: WorkService):
    path = space.root / HAND
    text = path.read_text(encoding="utf-8").replace(
        "  - kind: maybe\n    text: Ask about the night shift\n", ""
    )
    path.write_text(text, encoding="utf-8", newline="")
    space.rescan_file(HAND)
    item = svc.item(HAND)
    assert not item["problems"] and item["stepsUnreadable"] is False
    assert [s["id"] for s in item["steps"]] == ["@1", "@2"]
    res = svc.edit_steps(HAND, [{"op": "add", "kind": "do", "text": "Swap the cable"}], GENE)
    ids = [s["id"] for s in res["item"]["steps"]]
    assert len(ids) == 3 and all(not i.startswith("@") and len(i) == 6 for i in ids)
    assert len(set(ids)) == 3
    assert res["activity"] == '2026-11-05 10:00 Gene added step 3 [Do] "Swap the cable"'
    fm = space.read(HAND)[1]
    assert fm["steps"][1]["owner"] == "line lead"  # unknown keys survive
    body = space.read(HAND)[0].body
    assert body.count("- 2026-11-05 10:00 ") == 1

    # several ops in one write: one line, `who` only first; an `@n` ref is refused as stale now
    s1, s2 = res["item"]["steps"][0], res["item"]["steps"][1]
    res = svc.edit_steps(
        HAND,
        [
            {"op": "edit", "stepId": s1["id"], "stepRev": s1["rev"], "text": "Check the cable"},
            {"op": "move", "stepId": s2["id"], "stepRev": s2["rev"], "before": s1["id"]},
        ],
        GENE,
    )
    assert res["activity"] == (
        '2026-11-05 10:00 Gene edited step 1: "Check the cable"; '
        'moved step "Who reloads the labels?" to 1'
    )
    with pytest.raises(StepChanged):
        svc.edit_steps(HAND, [{"op": "remove", "stepId": "@1", "stepRev": "000000000000"}], GENE)


# -- fields, close, notes, floor ------------------------------------------------------------------


def test_fields_write_and_activity(space: Space, svc: WorkService):
    v = space.read(BADGE)[2]
    res = svc.fields(BADGE, v, {"rank": 2, "blockedOn": "Waiting on facilities"}, [], GENE)
    fm = space.read(BADGE)[1]
    assert fm["rank"] == 2 and fm["blockedOn"] == "Waiting on facilities"
    assert res["activity"] == (
        "2026-11-05 10:00 Gene set Rank to 2; set Blocked on to Waiting on facilities"
    )
    assert _bytes(space, BADGE).startswith(b"\xef\xbb\xbf")

    # unchanged values write nothing
    v = res["version"]
    again = svc.fields(BADGE, v, {"rank": 2}, [], GENE)
    assert again["version"] == v

    res = svc.fields(BADGE, v, {"deskPriority": "Moderate"}, [], GENE)
    assert space.read(BADGE)[1]["deskPriority"] == "Medium"
    v = res["version"]

    res = svc.fields(BADGE, v, {"area": "Scanners"}, [], GENE)
    assert space.read(BADGE)[1]["area"] == "Scanners"
    area = space.type_by_id("task").prop("area")
    assert "Scanners" in [o["text"] for o in area.options["set"]]
    v = res["version"]

    res = svc.fields(BADGE, v, {}, ["blockedOn"], GENE)
    assert "blockedOn" not in space.read(BADGE)[1] or space.read(BADGE)[1]["blockedOn"] is None
    assert res["activity"].endswith("Gene cleared Blocked on")

    with pytest.raises(InvalidValue, match='The field "status" isn\'t a work field.'):
        svc.fields(BADGE, res["version"], {"status": "Done"}, [], GENE)
    with pytest.raises(InvalidValue, match='The field "steps" isn\'t a work field.'):
        svc.fields(BADGE, res["version"], {"steps": []}, [], GENE)
    with pytest.raises(Conflict):
        svc.fields(BADGE, v, {"rank": 3}, [], GENE)


def test_close_and_resolution(space: Space, svc: WorkService):
    v = space.read(PRINTER)[2]
    res = svc.close(PRINTER, v, GENE)
    fm = space.read(PRINTER)[1]
    assert fm["status"] == "Done" and fm["completed"] == "2026-11-05T10:00:00.000Z"
    assert res["activity"] == "2026-11-05 10:00 Gene closed the item"
    assert res["item"]["resolution"] is not None and res["item"]["done"]
    with pytest.raises(InvalidValue, match="This item is already done."):
        svc.close(PRINTER, res["version"], GENE)

    _add_work_fields_to_project(space)
    v = space.read(SCANNER)[2]
    res = svc.close(SCANNER, v, GENE)
    fm = space.read(SCANNER)[1]
    assert fm["status"] == "Completed" and fm["completed"] == "2026-11-05T10:00:00.000Z"


def test_note_request_log(space: Space, svc: WorkService):
    res = svc.note(BADGE, "note", "The east door reader is offline", GENE)
    assert res["activity"] == "2026-11-05 10:00 Gene added a note: The east door reader is offline"
    assert res["workNote"] == "[2026-11-05] Gene: note: The east door reader is offline"
    res = svc.note(BADGE, "request", "Pull the reader logs", GENE)
    assert res["activity"] == "2026-11-05 10:00 Gene asked the agent to act: Pull the reader logs"
    assert res["workNote"] == "[2026-11-05] Gene: request: Pull the reader logs"
    res = svc.log(BADGE, "read the reader logs", AGENT)
    assert res["activity"] == "2026-11-05 10:00 Work read the reader logs"
    assert res["workNote"] is None
    item = res["item"]
    assert len(item["activity"]) == 3 and len(item["workNotes"]) == 2
    assert item["activity"][0]["text"] == "Work read the reader logs"
    with pytest.raises(InvalidValue, match="A note needs text."):
        svc.note(BADGE, "note", "   ", GENE)
    assert _bytes(space, BADGE).startswith(b"\xef\xbb\xbf")


def test_floor_ops(space: Space, svc: WorkService):
    res = svc.floor(BADGE, "add", GENE, place="East door", what="Photo of the reader")
    assert res["activity"] == (
        "2026-11-05 10:00 Gene added a floor item: East door | Photo of the reader"
    )
    item = res["item"]["floorItems"][0]
    assert item["collected"] is None and len(item["id"]) == 6
    res = svc.floor(BADGE, "collect", GENE, item_id=item["id"], item_rev=item["rev"],
                    found="Red light blinking")
    collected = res["item"]["floorItems"][0]
    assert collected["collected"] == "2026-11-05" and collected["found"] == "Red light blinking"
    assert res["activity"].endswith(
        "Gene collected East door | Photo of the reader: Red light blinking"
    )
    with pytest.raises(FloorItemChanged) as exc:
        svc.floor(BADGE, "uncollect", GENE, item_id=item["id"], item_rev=item["rev"])
    assert str(exc.value) == "This floor item changed. Look again."
    res = svc.floor(BADGE, "uncollect", GENE, item_id=collected["id"], item_rev=collected["rev"])
    item = res["item"]["floorItems"][0]
    assert item["collected"] is None
    assert res["activity"].endswith("Gene un-ticked East door | Photo of the reader")
    res = svc.floor(BADGE, "edit", GENE, item_id=item["id"], item_rev=item["rev"],
                    what="Photo of the panel")
    item = res["item"]["floorItems"][0]
    assert res["activity"].endswith("Gene edited a floor item: East door | Photo of the panel")
    res = svc.floor(BADGE, "remove", GENE, item_id=item["id"], item_rev=item["rev"])
    assert res["item"]["floorItems"] == []
    assert res["activity"].endswith("Gene removed a floor item: East door | Photo of the panel")
    assert "floorItems" not in space.read(BADGE)[1]


def test_listeners_get_notices(space: Space, svc: WorkService, caplog):
    seen: list[WorkNotice] = []
    unsubscribe = add_work_listener(lambda s, n: seen.append(n))

    def boom(_s, _n):
        raise RuntimeError("listener failed")

    unsubscribe_boom = add_work_listener(boom)
    try:
        s2 = _step(svc.item(PRINTER), 2)
        with caplog.at_level(logging.ERROR):
            res = svc.step(PRINTER, s2["id"], s2["rev"], "approve", GENE,
                           not_before="2026-11-06T07:00:00Z")
        assert res["version"]
        assert "listener failed" in caplog.text
    finally:
        unsubscribe()
        unsubscribe_boom()
    assert len(seen) == 1
    n = seen[0]
    assert (n.event, n.before, n.after, n.by) == ("approve", "open", "approved", GENE)
    assert n.not_before == "2026-11-06T07:00:00.000Z"
    assert n.step_id == "r8k1pd" and n.n == 2 and n.kind == "approve"
    assert n.step_text == SPOOLER and n.path == PRINTER
    assert n.object_id == "01KM2200000000000000000001" and n.version == res["version"]
    assert n.at == NOW
    svc.note(PRINTER, "note", "after unsubscribe", GENE)
    assert len(seen) == 1


def test_14_day_rule_moves_items_out(space: Space, svc: WorkService):
    space.clock = lambda: datetime(2026, 11, 14, 10, 0, tzinfo=UTC)
    assert "Last week fix" not in _by_title(svc.items())
    assert "Last week fix" in _by_title(svc.items("all"))


def test_withdraw_logs_withdrew(space: Space, svc: WorkService):
    """Fix pass H: Withdraw (reopen of an approved Approve step) logs a withdrawal, not a reopen."""
    s2 = _step(svc.item(PRINTER), 2)
    svc.step(PRINTER, s2["id"], s2["rev"], "approve", GENE)
    s2 = _step(svc.item(PRINTER), 2)
    res = svc.step(PRINTER, s2["id"], s2["rev"], "reopen", GENE)
    assert "Gene withdrew the approval of step 2" in res["activity"]
    assert "reopened" not in res["activity"]
    s2 = _step(res["item"], 2)
    res = svc.step(PRINTER, s2["id"], s2["rev"], "decline", GENE, text="no")
    s2 = _step(res["item"], 2)
    res = svc.step(PRINTER, s2["id"], s2["rev"], "reopen", GENE)
    assert "Gene reopened step 2" in res["activity"]
