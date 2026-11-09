"""M23 Task 1: the Work section contract (request bodies, seams, keep-on-top host, the folder
watch's names, settings keys, event kinds) and the synthetic fixtures (``space-work-m23`` and
``monitoring``).

Checks signatures, constants, models, the seams and the fixtures only, never a stub's empty
behaviour (the stubs are filled by later tasks).
"""

from __future__ import annotations

import inspect
import json
import re
from datetime import UTC, datetime
from pathlib import Path

import m23_helpers
import pytest
from pydantic import ValidationError

from objectapp import (
    alertwatch,
    api_work_section,
    server,
    settings,
    windowhost,
    workseams,
    writeorigin,
)
from objectapp.space import Space
from objectapp.watcher import ChangeEvent
from objectapp.worksection_model import (
    AgentActsRequest,
    AgentRetryRequest,
    CaptureRequestModel,
    ClientOnly,
    FocusRequest,
    GeneralFloorRequest,
)
from objectapp.workseams import (
    AGENT_LATER,
    CAPTURE_LATER,
    NoAgent,
    NoCaptures,
    SeamRefused,
    SeamUnavailable,
    WorkSeams,
    build_seams,
)

HERE = Path(__file__).resolve().parent
OVERLAY = HERE / "fixtures" / "space-work-m23"
MONITORING = HERE / "fixtures" / "monitoring"
NOW = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)


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


def _params(fn) -> list[str]:
    return list(inspect.signature(fn).parameters)


def test_models_and_constants() -> None:
    assert AGENT_LATER == "The agent loop comes with M24."
    assert CAPTURE_LATER == "Saving a brain dump comes with M24."
    assert windowhost.KEEP_ON_TOP_LATER == "Keep on top needs the Object window."
    assert writeorigin.ALERTS == "alerts"
    assert alertwatch.POLL_SECONDS == 60.0
    assert alertwatch.DEFAULT_INTERVAL_MIN == 1440
    assert alertwatch.MAX_ALERTS_PER_FILE == 200
    assert alertwatch.MAX_FIELD == 1200

    f = FocusRequest(day="2026-11-05", lines=["Clear the jams"], baseVersion="v1", clientId="c")
    assert (f.day, f.lines, f.baseVersion, f.clientId) == ("2026-11-05", ["Clear the jams"], "v1", "c")
    assert FocusRequest(day="2026-11-05", lines=[]).baseVersion is None
    g = GeneralFloorRequest(op="collect", itemId="a1b2c3", itemRev="r", found="E-12")
    assert (g.op, g.itemId, g.itemRev, g.found, g.place, g.what) == ("collect", "a1b2c3", "r", "E-12", None, None)
    for op in ("add", "edit", "collect", "uncollect", "remove"):
        assert GeneralFloorRequest(op=op).op == op
    with pytest.raises(ValidationError):
        GeneralFloorRequest(op="burn")
    c = CaptureRequestModel(text="Spooler again", fromView="now")
    assert (c.text, c.fromView, c.linkedPath, c.clientId) == ("Spooler again", "now", None, None)
    assert AgentActsRequest(on=True).on is True
    with pytest.raises(ValidationError):
        AgentActsRequest()
    assert AgentRetryRequest(id="q1").id == "q1"
    assert ClientOnly().clientId is None and ClientOnly(clientId="x").clientId == "x"

    # The stubs' signatures (later tasks fill them; their behaviour is tested there).
    assert _params(api_work_section.router) == ["ctx", "service", "seams", "watch"]
    assert _params(alertwatch.AlertWatch.__init__) == [
        "self", "space", "folder", "intervals", "announce", "poll_seconds",
    ]
    init = inspect.signature(alertwatch.AlertWatch.__init__).parameters
    assert init["poll_seconds"].default == alertwatch.POLL_SECONDS
    assert all(init[k].kind is inspect.Parameter.KEYWORD_ONLY
               for k in ("folder", "intervals", "announce", "poll_seconds"))
    for name in ("start", "stop", "scan_once", "sources"):
        assert _params(getattr(alertwatch.AlertWatch, name)) == ["self"], name
    assert _params(alertwatch.read_alert_file) == ["path"]
    assert _params(alertwatch.is_stale) == ["generated", "interval_min", "now"]
    report = alertwatch.AlertScanReport(files=1, created=2, updated=3, cleared=4, unchanged=5, errors=["x"])
    assert (report.files, report.created, report.updated, report.cleared, report.unchanged,
            report.errors) == (1, 2, 3, 4, 5, ["x"])
    assert alertwatch.is_stale(None, 15, NOW)
    assert not alertwatch.is_stale(datetime(2026, 11, 5, 9, 50, tzinfo=UTC), 15, NOW)
    assert alertwatch.is_stale(datetime(2026, 11, 5, 9, 29, tzinfo=UTC), 15, NOW)
    assert _params(build_seams) == ["space", "service"]


def test_seam_defaults(space: Space) -> None:
    status = NoAgent().status(space, [{"turn": "agent"}, {"turn": "you"}])
    assert status == {
        "available": False, "agentName": None, "actsOnApprovals": False, "carrying": 1,
        "rows": [], "note": AGENT_LATER,
    }
    for call in (lambda: NoAgent().set_acts(space, True), lambda: NoAgent().retry(space, "q1")):
        with pytest.raises(SeamUnavailable) as exc:
            call()
        assert exc.value.detail == AGENT_LATER
    with pytest.raises(SeamUnavailable) as exc:
        NoCaptures().save(space, CaptureRequestModel(text="x", fromView="now"), NOW)
    assert exc.value.detail == CAPTURE_LATER
    assert NoCaptures().list(space, "needsYou") == []

    seams = build_seams(space, m23_helpers.service(space))
    assert isinstance(seams, WorkSeams)
    # M24 fills `build_seams` with its own seams (NoAgent / NoCaptures stay as M23's defaults).
    assert type(seams.agent).__name__ == "AgentSeam" and type(seams.captures).__name__ == "CaptureSeam"

    refused = SeamRefused(409, "x")
    assert (refused.status, refused.detail) == (409, "x")
    assert issubclass(workseams.SeamRefused, Exception)

    windowhost.set_opener(None)
    try:
        assert windowhost.can_open() is False
        with pytest.raises(SeamUnavailable) as exc:
            windowhost.open_window("x")
        assert exc.value.detail == windowhost.KEEP_ON_TOP_LATER
        opened: list[str] = []
        windowhost.set_opener(opened.append)
        assert windowhost.can_open() is True
        windowhost.open_window("http://127.0.0.1:1/?mini=work")
        assert opened == ["http://127.0.0.1:1/?mini=work"]
    finally:
        windowhost.set_opener(None)

    assert ChangeEvent("workQueue", "x", None).kind == "workQueue"
    assert ChangeEvent("work", "floor", "r").kind == "work"
    assert {"work", "workQueue"} <= {e.kind for e in server.RESYNC_EVENTS}
    assert all(e.path == "*" and e.version is None for e in server.RESYNC_EVENTS)


def test_settings_keys(state: Path) -> None:
    assert settings.DEFAULTS["workAlertFolder"] is None
    assert settings.DEFAULTS["workAlertIntervals"] == {}
    merged, _rev = settings.read()
    assert merged["workAlertFolder"] is None and merged["workAlertIntervals"] == {}

    with pytest.raises(settings.SettingsProblem) as exc:
        settings.patch({"workAlertFolder": "relative/monitoring"}, None)
    assert exc.value.message == "Pick a folder (a full path)."
    with pytest.raises(settings.SettingsProblem) as exc:
        settings.patch({"workAlertFolder": "C:\\" + "x" * 500}, None)
    assert exc.value.message == "Pick a folder (a full path)."
    for bad in ({"printer-watch": 0}, {"printer-watch": 10081}, {"printer-watch": 1.5},
                {"printer-watch": True}, {"": 15}, {f"s{i}": 15 for i in range(51)}, []):
        with pytest.raises(settings.SettingsProblem) as exc:
            settings.patch({"workAlertIntervals": bad}, None)
        assert exc.value.message == "Intervals are whole minutes from 1 to 10080.", bad
    # Other keys keep the built messages: an unknown key, and a bad value.
    with pytest.raises(settings.SettingsProblem) as exc:
        settings.patch({"nope": 1}, None)
    assert exc.value.message == 'There is no setting named "nope".'
    with pytest.raises(settings.SettingsProblem) as exc:
        settings.patch({"monochromeTags": "true"}, None)
    assert exc.value.message == "The setting \"monochromeTags\" can't be saved."
    assert not state.exists()  # nothing was written

    folder = str(state.parent / "monitoring")
    merged, _rev = settings.patch({"workAlertFolder": folder, "workAlertIntervals": {"printer-watch": 15}}, None)
    assert merged["workAlertFolder"] == folder
    assert merged["workAlertIntervals"] == {"printer-watch": 15}
    merged, _rev = settings.patch({"workAlertFolder": None, "workAlertIntervals": {}}, _rev)
    assert merged["workAlertFolder"] is None and merged["workAlertIntervals"] == {}


def _texts(root: Path) -> dict[str, str]:
    return {
        p.relative_to(root).as_posix(): p.read_bytes().decode("utf-8-sig")
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def test_fixtures_are_synthetic() -> None:
    overlay = _texts(OVERLAY)
    assert set(overlay) == {
        ".object/types/meeting.json", ".object/types/person.json", ".object/types/dailynote.json",
        "DailyNotes/2026-11-05.md", "Meetings/Line 3 standup.md", "Meetings/Vendor call.md",
        "Meetings/Tomorrow sync.md", "People/Pat Example.md", "Tasks/Waiting on Pat.md",
        "Tasks/Scanner firmware.md",
    }  # fmt: skip
    monitoring = _texts(MONITORING)
    assert set(monitoring) == {"printer-watch.json", "backup-check.json", "broken.json", "history.jsonl"}
    board = (HERE.parent.parent / "frontend" / "src" / "work" / "__fixtures__" / "board.json").read_text("utf-8")
    everything = "\n".join([*overlay.values(), *monitoring.values(), board])

    # No real ticket, host, person, company, address or monitoring job.
    assert not re.search(r"(?i)cpi|card ?group|@[a-z0-9-]+\.[a-z]", everything)
    assert set(re.findall(r"\b[A-Z]{2,}-[A-Z]+-\d+\b", everything)) <= {"PRN-TEST-01"}
    assert set(re.findall(r"\b(?:INC|RITM|SCTASK|CHG)\d+\b", everything)) <= {"INC0012345", "INC0012346"}
    assert set(re.findall(r"https?://[^\s\"']+", everything)) <= {"https://example.org/prn"}
    assert {json.loads(monitoring[f])["source"] for f in ("printer-watch.json", "backup-check.json")} == {
        "printer-watch", "backup-check",
    }
    assert set(re.findall(r"(?m)^- \d{4}-\d\d-\d\d \d\d:\d\d (\S+) ", everything)) <= {"Gene"}
    people = {p for p in overlay if p.startswith("People/")}
    assert people == {"People/Pat Example.md"}

    # The daily note is CRLF with a UTF-8 BOM; every other object file is LF.
    raw = (OVERLAY / "DailyNotes" / "2026-11-05.md").read_bytes()
    assert raw.startswith(b"\xef\xbb\xbf---\r\n")
    assert b"\r\n" in raw and raw.count(b"\n") == raw.count(b"\r\n")
    for rel in overlay:
        if rel.endswith(".md") and rel != "DailyNotes/2026-11-05.md":
            data = (OVERLAY / rel).read_bytes()
            assert b"\r" not in data and not data.startswith(b"\xef\xbb\xbf"), rel

    # The pieces later tasks rely on.
    note = overlay["DailyNotes/2026-11-05.md"].replace("\r\n", "\n")
    assert "type: DailyNote" in note and "date: 2026-11-05" in note
    assert note.index("## Plan") < note.index("## Focus") < note.index("## Notes")
    focus = note[note.index("## Focus"):note.index("## Notes")]
    assert "Keep it to three." in focus
    assert [ln for ln in focus.splitlines() if ln.startswith("- ")] == [
        "- Clear the jams on [[Printer jams on line 3]]", "- [ ] Finish [[Scanner rollout]]", "- Plan next week",
    ]
    assert "date: 2026-11-05T09:00:00.000Z -> 2026-11-05T09:30:00.000Z" in overlay["Meetings/Line 3 standup.md"]
    assert "date: 2026-11-05T13:00:00.000Z\n" in overlay["Meetings/Vendor call.md"]
    assert "date: 2026-11-06T09:00:00.000Z" in overlay["Meetings/Tomorrow sync.md"]
    pat = overlay["Tasks/Waiting on Pat.md"]
    for needle in ('blockedOn: "[[Pat Example]] to send the badge list"', "deadline: 2026-11-12",
                   "lastUpdated: 2026-10-25T09:00:00.000Z", "text: Collect the badge list", "## Activity"):
        assert needle in pat, needle
    firmware = overlay["Tasks/Scanner firmware.md"]
    for needle in ('project: "[[Scanner rollout]]"', "area: Scanners", "rank: 2",
                   "lastUpdated: 2026-11-03T09:00:00.000Z", "text: Flash the floor units",
                   "doneAt: 2026-11-03T08:30:00.000Z", "text: Which firmware build is on the floor units?"):
        assert needle in firmware, needle
    for type_id in ("meeting", "person", "dailynote"):
        assert json.loads(overlay[f".object/types/{type_id}.json"])["id"] == type_id

    printer = json.loads(monitoring["printer-watch.json"])
    assert printer["ok"] is True and printer["intervalMinutes"] == 15
    assert [a["key"] for a in printer["alerts"]] == ["tray-2", "toner"]
    assert printer["alerts"][1]["detail"] == "token: abc123 seen"
    assert printer["alerts"][1]["link"] == "[[Order toner]]"
    backup = json.loads(monitoring["backup-check.json"])
    assert backup["ok"] is False and backup["error"] == "share unreachable" and backup["alerts"] == []
    with pytest.raises(ValueError):
        json.loads(monitoring["broken.json"])


def test_helpers(tmp_path: Path, state: Path) -> None:
    root = m23_helpers.copy_space(tmp_path)
    assert (root / "Tasks" / "Printer jams on line 3.md").is_file()  # M22's space-work
    assert (root / "Tasks" / "Waiting on Pat.md").is_file()  # the overlay
    mon = m23_helpers.monitoring(tmp_path)
    assert sorted(p.name for p in mon.iterdir()) == sorted(p.name for p in MONITORING.iterdir())
    space = Space(root)
    space.clock = lambda: NOW
    space.tz = UTC
    svc = m23_helpers.service(space)
    titles = {i["title"] for i in svc.items("active")}
    assert {"Waiting on Pat", "Scanner firmware", "Printer jams on line 3"} <= titles
    assert "Scanner rollout" not in titles
    m23_helpers.add_project_work_fields(space)
    assert "Scanner rollout" in {i["title"] for i in svc.items("active")}
