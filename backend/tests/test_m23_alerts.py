"""M23 Task 5: the Alert type (``alerttype``) and the monitoring folder watch (``alertwatch``).

Run on a copy of the overlay space and of ``fixtures/monitoring`` with the clock at
2026-11-05T10:00Z, the space time zone UTC and ``OBJECT_STATE_DIR`` in ``tmp_path``. The
watch runs no thread here: every scan is a `scan_once` call.
"""

from __future__ import annotations

import json
import os
import shutil
from datetime import UTC, datetime
from pathlib import Path

import m23_helpers
import pytest
from objectapp import alerttype, alertwatch
from objectapp.alertwatch import AlertWatch
from objectapp.space import Space
from objectapp.watcher import ChangeEvent

NOW = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)


@pytest.fixture
def state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "state"
    monkeypatch.setenv("OBJECT_STATE_DIR", str(path))
    return path


class Clock:
    def __init__(self) -> None:
        self.now = NOW

    def __call__(self) -> datetime:
        return self.now


def _open(root: Path, clock: Clock) -> Space:
    s = Space(root)
    s.clock = clock
    s.tz = UTC
    return s


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def root(tmp_path: Path, state: Path) -> Path:
    return m23_helpers.copy_space(tmp_path)


@pytest.fixture
def space(root: Path, clock: Clock) -> Space:
    return _open(root, clock)


@pytest.fixture
def mon(tmp_path: Path) -> Path:
    return m23_helpers.monitoring(tmp_path)


def _watch(
    space: Space, mon: Path | None, events: list | None = None, intervals=None
) -> AlertWatch:
    return AlertWatch(
        space,
        folder=lambda: mon,
        intervals=(lambda: intervals or {}),
        announce=(events.append if events is not None else (lambda _e: None)),
    )


def _snapshot(root: Path) -> dict[str, bytes]:
    out: dict[str, bytes] = {}
    for dirpath, _dirs, files in os.walk(root):
        if ".object-cache" in Path(dirpath).relative_to(root).parts:
            continue
        for f in files:
            p = Path(dirpath) / f
            out[p.relative_to(root).as_posix()] = p.read_bytes()
    return out


def _tree(path: Path) -> dict[str, bytes]:
    if not path.exists():
        return {}
    return {
        p.relative_to(path).as_posix(): p.read_bytes()
        for p in path.rglob("*")
        if p.is_file()
    }


def _by_key(space: Space) -> dict[str, tuple[str, dict]]:
    t = alerttype.alert_type(space)
    assert t is not None
    out = {}
    for s in space.list(t.id):
        _of, fm, _v = space.read(s.path)
        out[fm["alertKey"]] = (s.path, fm)
    return out


def _write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


# -- the type -------------------------------------------------------------------


def test_ensure_alert_type(space: Space, root: Path) -> None:
    assert alerttype.alert_type(space) is None
    assert alerttype.is_alert_type(space.type_by_id("task")) is False
    assert alerttype.is_alert_type(None) is False

    t, created = alerttype.ensure_alert_type(space)
    assert created is True
    assert t.name == "Alert" and t.pluralName == "Alerts"
    assert alerttype.is_alert_type(t)
    stored = json.loads(
        (root / ".object" / "types" / f"{t.id}.json").read_text("utf-8")
    )
    keys = [p["key"] for p in stored["propertyDefinitions"]]
    alert_keys = [f.key for f in alerttype.ALERT_FIELDS]
    assert alert_keys == [
        "alertSource", "severity", "message", "raisedAt", "clearedAt", "link", "alertKey",
    ]  # fmt: skip
    assert [k for k in keys if k in alert_keys] == alert_keys
    defs = {p["key"]: p for p in stored["propertyDefinitions"]}
    assert defs["alertKey"]["visibility"] == "hidden"
    assert defs["severity"]["type"] == "label"
    assert [o["text"] for o in defs["severity"]["options"]["set"]] == [
        "Critical", "Warning", "Info",
    ]  # fmt: skip
    assert defs["raisedAt"]["type"] == "datetime"
    assert defs["raisedAt"]["options"]["constraints"]["resolutionPreference"] == "time"
    assert defs["link"]["type"] == "url"

    before = _snapshot(root)
    again, created2 = alerttype.ensure_alert_type(space)
    assert created2 is False
    assert again.id == t.id
    assert _snapshot(root) == before


def test_ensure_alert_type_when_alert_is_taken(space: Space) -> None:
    space.create_type("Alert", "Alarms")
    t, created = alerttype.ensure_alert_type(space)
    assert created is True
    assert t.name == "Monitoring alert" and t.pluralName == "Monitoring alerts"
    assert alerttype.alert_type(space).id == t.id


# -- the reader -----------------------------------------------------------------


def test_read_alert_file(mon: Path) -> None:
    data = alertwatch.read_alert_file(mon / "printer-watch.json")
    assert data["source"] == "printer-watch" and data["ok"] is True
    assert data["intervalMinutes"] == 15
    toner = data["alerts"][1]
    assert toner["detail"] == "token: [redacted] seen"
    assert toner["link"] == "Order toner"
    broken = alertwatch.read_alert_file(mon / "broken.json")
    assert broken["error"].startswith("Can't read broken.json: ")
    assert broken["alerts"] == [] and broken["ok"] is False
    missing = alertwatch.read_alert_file(mon / "nope.json")
    assert missing["error"].startswith("Can't read nope.json: ")
    (mon / "list.json").write_text("[1, 2]", encoding="utf-8")
    assert "not a JSON object" in alertwatch.read_alert_file(mon / "list.json")["error"]
    (mon / "odd.json").write_text(
        json.dumps(
            {
                "alerts": [{"severity": "loud", "title": "", "detail": "pwd=hunter2"}]
                * 300
            }
        ),
        encoding="utf-8",
    )
    odd = alertwatch.read_alert_file(mon / "odd.json")
    assert odd["source"] == "odd"
    assert len(odd["alerts"]) == 200
    assert odd["alerts"][0]["severity"] == "Warning"
    assert odd["alerts"][0]["detail"] == "pwd=[redacted]"


# -- scanning -------------------------------------------------------------------


def test_scan_creates_alerts(space: Space, mon: Path) -> None:
    report = _watch(space, mon).scan_once()
    assert report.files == 3
    assert report.created == 2
    assert len(report.errors) == 1 and report.errors[0].startswith(
        "Can't read broken.json: "
    )
    alerts = _by_key(space)
    assert set(alerts) == {"printer-watch|tray-2", "printer-watch|toner"}
    path, fm = alerts["printer-watch|tray-2"]
    assert space.get(path).title == "Tray 2 jammed"
    assert fm["alertSource"] == "printer-watch"
    assert fm["severity"] == "Critical"
    assert fm["message"].startswith("PRN-TEST-01: ")
    assert fm["raisedAt"] == "2026-11-05T09:40:00.000Z"
    assert fm["link"] == "https://example.org/prn"
    assert not fm.get("clearedAt")
    _tp, toner = alerts["printer-watch|toner"]
    assert "token: [redacted]" in toner["message"]
    assert "abc123" not in toner["message"]
    assert toner["message"].endswith("See: Order toner")
    assert toner["severity"] == "Warning"
    assert not toner.get("link")


def test_scan_announces(space: Space, mon: Path) -> None:
    events: list[ChangeEvent] = []
    watch = _watch(space, mon, events)
    watch.scan_once()
    kinds = [e.kind for e in events]
    assert kinds.count("types") == 1
    assert kinds.count("created") == 2
    assert all(e.origin == "alerts" for e in events)
    t = alerttype.alert_type(space)
    assert next(e for e in events if e.kind == "types").path == t.id
    created = {e.path for e in events if e.kind == "created"}
    assert created == {p for p, _fm in _by_key(space).values()}
    events.clear()
    watch.scan_once()
    assert events == []


def test_rescan_and_restart_write_nothing(
    space: Space, root: Path, mon: Path, state: Path
) -> None:
    watch = _watch(space, mon)
    watch.scan_once()
    before, before_state = _snapshot(root), _tree(state)

    again = watch.scan_once()
    assert again.unchanged == 3
    assert again.created == again.updated == again.cleared == 0
    assert _snapshot(root) == before
    assert _tree(state) == before_state

    restarted = _watch(_open(root, Clock()), mon).scan_once()
    assert restarted.unchanged == 3
    assert restarted.created == restarted.updated == 0
    assert _snapshot(root) == before

    # Touching the file without changing its alerts updates nothing.
    f = mon / "printer-watch.json"
    st = f.stat()
    os.utime(f, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    touched = watch.scan_once()
    assert touched.created == touched.updated == touched.cleared == 0
    assert _snapshot(root) == before


def test_cleared_and_reraised(
    space: Space, root: Path, mon: Path, clock: Clock
) -> None:
    watch = _watch(space, mon)
    watch.scan_once()
    f = mon / "printer-watch.json"
    original = json.loads(f.read_text("utf-8"))

    without = dict(original, alerts=[original["alerts"][0]])
    _write_json(f, without)
    clock.now = datetime(2026, 11, 5, 10, 5, tzinfo=UTC)
    before = _snapshot(root)
    report = watch.scan_once()
    assert report.cleared == 1 and report.updated == 0 and report.created == 0
    after = _snapshot(root)
    changed = [k for k in after if after[k] != before.get(k)]
    toner_path, toner = _by_key(space)["printer-watch|toner"]
    assert changed == [toner_path]
    assert toner["clearedAt"] == "2026-11-05T10:05:00.000Z"

    again = watch.scan_once()
    assert again.cleared == again.updated == 0
    assert _snapshot(root) == after

    _write_json(f, original)
    back = watch.scan_once()
    assert back.updated == 1 and back.created == 0
    assert not _by_key(space)["printer-watch|toner"][1].get("clearedAt")

    # A severity change updates only severity (and lastUpdated).
    _tray_path, tray_before = _by_key(space)["printer-watch|tray-2"]
    changed_sev = json.loads(json.dumps(original))
    changed_sev["alerts"][0]["severity"] = "info"
    _write_json(f, changed_sev)
    report = watch.scan_once()
    assert report.updated == 1
    _p, tray_after = _by_key(space)["printer-watch|tray-2"]
    diff = {
        k
        for k in {*tray_before, *tray_after}
        if tray_before.get(k) != tray_after.get(k)
    }
    assert diff == {"severity", "lastUpdated"}
    assert tray_after["severity"] == "Info"


def test_unreadable_file_keeps_its_alerts(space: Space, root: Path, mon: Path) -> None:
    watch = _watch(space, mon)
    watch.scan_once()
    before = _snapshot(root)
    (mon / "printer-watch.json").write_text("{oops", encoding="utf-8")
    report = watch.scan_once()
    assert report.cleared == report.updated == report.created == 0
    assert any(e.startswith("Can't read printer-watch.json: ") for e in report.errors)
    assert _snapshot(root) == before
    src = next(s for s in watch.sources() if s["file"] == "printer-watch.json")
    assert src["stale"] is True and src["ok"] is False
    assert src["error"].startswith("Can't read printer-watch.json: ")
    for _path, fm in _by_key(space).values():
        assert not fm.get("clearedAt")


def test_stale_sources(space: Space, mon: Path, clock: Clock, tmp_path: Path) -> None:
    watch = _watch(space, mon)
    watch.scan_once()

    def by_source(w: AlertWatch) -> dict[str, dict]:
        return {s["source"]: s for s in w.sources()}

    s = by_source(watch)
    assert s["printer-watch"]["stale"] is False
    assert s["printer-watch"]["staleAfterMinutes"] == 30
    assert s["printer-watch"]["generated"] == "2026-11-05T09:50:00Z"
    assert s["backup-check"]["stale"] is True
    assert s["backup-check"]["ok"] is False
    assert s["backup-check"]["error"] == "share unreachable"
    assert s["backup-check"]["staleAfterMinutes"] == 2880
    assert set(s["broken"]) >= {
        "source",
        "file",
        "generated",
        "ok",
        "error",
        "stale",
        "staleAfterMinutes",
    }

    clock.now = datetime(2026, 11, 5, 10, 31, tzinfo=UTC)
    assert by_source(watch)["printer-watch"]["stale"] is True

    clock.now = NOW
    week = _watch(space, mon, intervals={"backup-check": 10080, "printer-watch": 1})
    assert by_source(week)["backup-check"]["stale"] is False
    # intervalMinutes in the file beats the setting.
    assert by_source(week)["printer-watch"]["stale"] is False
    assert by_source(week)["printer-watch"]["staleAfterMinutes"] == 30

    assert alertwatch.is_stale(None, 15, NOW) is True
    assert (
        alertwatch.is_stale(datetime(2026, 11, 5, 9, 31, tzinfo=UTC), 15, NOW) is False
    )
    assert (
        alertwatch.is_stale(datetime(2026, 11, 5, 9, 29, tzinfo=UTC), 15, NOW) is True
    )


def test_alerts_view_reads_only(
    space: Space, root: Path, mon: Path, state: Path
) -> None:
    none = alertwatch.alerts_view(space, _watch(space, None))
    assert none == {
        "alerts": [],
        "sources": [],
        "counts": {"Critical": 0, "Warning": 0, "Info": 0},
        "folder": None,
        "typeExists": False,
    }
    watch = _watch(space, mon)
    watch.scan_once()
    # Clear toner so the view shows an inactive row last.
    f = mon / "printer-watch.json"
    data = json.loads(f.read_text("utf-8"))
    data["alerts"].append(
        {
            "key": "door",
            "severity": "warn",
            "title": "Door open",
            "since": "2026-11-05T09:55:00Z",
        }
    )
    _write_json(f, data)
    watch.scan_once()
    data["alerts"] = [a for a in data["alerts"] if a["key"] != "toner"]
    _write_json(f, data)
    watch.scan_once()

    before, before_state = _snapshot(root), _tree(state)
    view = alertwatch.alerts_view(space, watch)
    assert _snapshot(root) == before and _tree(state) == before_state
    assert view["folder"] == str(mon)
    assert view["typeExists"] is True
    assert [a["title"] for a in view["alerts"]] == [
        "Tray 2 jammed",
        "Door open",
        "Toner low",
    ]
    assert [a["active"] for a in view["alerts"]] == [True, True, False]
    assert view["counts"] == {"Critical": 1, "Warning": 1, "Info": 0}
    tray = view["alerts"][0]
    assert tray["severity"] == "Critical"
    assert tray["source"] == "printer-watch"
    assert tray["raisedAt"] == "2026-11-05T09:40:00.000Z"
    assert tray["clearedAt"] is None
    assert tray["link"] == "https://example.org/prn"
    assert tray["path"].endswith(".md")
    assert view["alerts"][2]["clearedAt"] is not None
    assert {s["source"] for s in view["sources"]} == {
        "printer-watch",
        "backup-check",
        "broken",
    }


def test_no_alerts_no_type(space: Space, root: Path, tmp_path: Path) -> None:
    only = tmp_path / "only"
    only.mkdir()
    shutil.copy(m23_helpers.FIXTURES / "monitoring" / "backup-check.json", only)
    before = _snapshot(root)
    report = _watch(space, only).scan_once()
    assert report.files == 1 and report.created == 0
    assert alerttype.alert_type(space) is None
    assert _snapshot(root) == before


def test_no_folder_scans_nothing(space: Space, state: Path) -> None:
    report = _watch(space, None).scan_once()
    assert report.files == 0 and report.created == 0
    assert not state.exists()


def test_thread_starts_and_stops(space: Space, mon: Path) -> None:
    watch = AlertWatch(space, folder=lambda: mon, intervals=dict, poll_seconds=0.05)
    watch.start()
    try:
        import time

        deadline = time.monotonic() + 10
        while alerttype.alert_type(space) is None and time.monotonic() < deadline:
            time.sleep(0.05)
    finally:
        t0 = datetime.now(UTC)
        watch.stop()
        assert (datetime.now(UTC) - t0).total_seconds() < 1.5
    assert len(_by_key(space)) == 2


def test_redaction_covers_compound_keys_json_and_whole_values() -> None:
    c = alertwatch._clean
    assert c("db_password=x") == "db_password=[redacted]"
    assert c("access_token: abc") == "access_token: [redacted]"
    assert c({"password": "abc def"}) == '{"password": [redacted]}'
    assert c({"api_key": "k1"}) == '{"api_key": [redacted]}'
    assert c("password: two words here") == "password: [redacted]"
    assert c("login failed, password: two words here; retry") == (
        "login failed, password: [redacted]; retry"
    )
    assert c("token: abc seen") == "token: [redacted] seen"
    assert c("line one\nsecret=abc\nline three") == "line one\nsecret=[redacted]\nline three"
    assert c("nothing to hide here") == "nothing to hide here"


def test_deleted_file_clears_its_alerts(space: Space, mon: Path, clock: Clock) -> None:
    watch = _watch(space, mon)
    watch.scan_once()
    assert not any(fm.get("clearedAt") for _p, fm in _by_key(space).values()
                   if fm["alertKey"].startswith("printer-watch|"))
    (mon / "printer-watch.json").unlink()
    clock.now = datetime(2026, 11, 5, 10, 5, tzinfo=UTC)
    report = watch.scan_once()
    assert report.cleared == 2
    mine = [fm for _p, fm in _by_key(space).values() if fm["alertKey"].startswith("printer-watch|")]
    assert mine and all(fm["clearedAt"] == "2026-11-05T10:05:00.000Z" for fm in mine)
    assert all(s["file"] != "printer-watch.json" for s in watch.sources())
    again = watch.scan_once()
    assert again.cleared == 0


def test_failed_apply_is_retried(space: Space, root: Path, mon: Path) -> None:
    watch = _watch(space, mon)
    real = watch._create
    boom = {"on": True}

    def create(*a, **k):
        if boom["on"]:
            raise OSError("disk says no")
        return real(*a, **k)

    watch._create = create  # type: ignore[method-assign]
    first = watch.scan_once()
    assert first.created == 0 and any("Can't write" in e for e in first.errors)
    boom["on"] = False
    second = watch.scan_once()
    assert second.created > 0
    assert any(k.startswith("printer-watch|") for k in _by_key(space))


def test_ensure_alert_type_repairs_a_bare_type(space: Space) -> None:
    real = space.save_type
    calls = {"n": 0}

    def flaky(*a, **k):
        calls["n"] += 1
        if calls["n"] == 1:
            raise OSError("disk says no")
        return real(*a, **k)

    space.save_type = flaky  # type: ignore[method-assign]
    with pytest.raises(OSError):
        alerttype.ensure_alert_type(space)
    t, created = alerttype.ensure_alert_type(space)
    assert created is True and t.name == "Alert"
    assert alerttype.is_alert_type(t)
    assert [x.name for x in space.types if "lert" in x.name] == ["Alert"]


def test_ensure_alert_type_is_serialised(space: Space) -> None:
    import threading

    results: list = []
    threads = [
        threading.Thread(target=lambda: results.append(alerttype.ensure_alert_type(space)))
        for _ in range(4)
    ]
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    assert len(results) == 4
    assert sum(1 for _t, created in results if created) == 1
    assert [x.name for x in space.types if "lert" in x.name] == ["Alert"]
