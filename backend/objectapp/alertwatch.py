"""The monitoring folder watch (M23): every ``*.json`` in the alert folder becomes Alert objects.

The file format is the old dashboard's monitoring contract (ported, so today's scripts keep
working unchanged): each ``*.json`` is one job's latest result,
``{source, generated, ok, error, intervalMinutes?, alerts: [{key, severity, title, detail,
host, since, due, link}]}``, read as ``utf-8-sig``. `read_alert_file` never raises.

One Alert object per ``alertKey = "{source}|{key or title}"``, updated in place (one
`update_properties` write with only the changed keys); a key that leaves a file that read
fine gets Cleared at (once), a re-raised one has it cleared. A file whose
``(mtime_ns, size, sha256)`` matches the state file's entry is skipped, so a scan of
unchanged files writes nothing, and the state file (``<state dir>/work-alerts-<hash>.json``)
makes a restart see what the last scan saw. Writes carry ``writeorigin.ALERTS`` and are
announced through ``announce``: the scan thread is no request, and the file watcher is
silent about the app's own writes.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

from . import alerttype, writeorigin
from .appstate import space_key, state_dir
from .jsonstore import dump_json
from .propvalues import decode_value
from .textfile import atomic_write
from .typemodel import type_revision
from .watcher import ChangeEvent

if TYPE_CHECKING:
    from .space import Space
    from .typemodel import TypeDefinition

__all__ = [
    "DEFAULT_INTERVAL_MIN",
    "MAX_ALERTS_PER_FILE",
    "MAX_FIELD",
    "POLL_SECONDS",
    "AlertScanReport",
    "AlertWatch",
    "alerts_view",
    "is_stale",
    "read_alert_file",
]

_log = logging.getLogger(__name__)

POLL_SECONDS = 60.0
DEFAULT_INTERVAL_MIN = 1440
MAX_ALERTS_PER_FILE = 200
MAX_FIELD = 1200

_SCHEMA = 1
_SEVERITY = {"crit": "Critical", "warn": "Warning", "info": "Info"}
_SEVERITY_ORDER = {"Critical": 0, "Warning": 1, "Info": 2}
# Ported: a secret's value after its name and ``:``, ``=`` or ``|`` is redacted.
_SECRET = re.compile(
    r"(?i)\b(password|passwd|pwd|secret|api[_ -]?key|token|apikey|client[_ -]?secret)\b"
    r"(\s*[:=|]\s*)(\S+)"
)
_HTTP = re.compile(r"(?i)^https?://")


@dataclass
class AlertScanReport:
    files: int = 0
    created: int = 0
    updated: int = 0
    cleared: int = 0
    unchanged: int = 0
    errors: list[str] = field(default_factory=list)


# -- reading a file ----------------------------------------------------------------


def _clean(v: Any) -> str:
    """Text of a field, secrets redacted, cut to `MAX_FIELD` (ported)."""
    if v is None:
        return ""
    if isinstance(v, str):
        s = v
    elif isinstance(v, (dict, list)):
        s = json.dumps(v, ensure_ascii=False)
    else:
        s = str(v)
    return _SECRET.sub(lambda m: f"{m.group(1)}{m.group(2)}[redacted]", s)[:MAX_FIELD]


def _alert(a: Any) -> dict[str, str]:
    if not isinstance(a, dict):
        a = {"title": str(a)}
    raw_sev = str(a.get("severity") or "").strip().lower()
    keys = ("key", "title", "detail", "host", "since", "due", "link")
    out = {k: _clean(a.get(k)).strip() for k in keys}
    out["severity"] = _SEVERITY.get(
        raw_sev, "Warning"
    )  # unknown: shown rather than hidden
    out["link"] = (
        out["link"].removeprefix("[[").removesuffix("]]").split("|")[0].strip()
    )
    return out


def _interval(v: Any) -> int | None:
    if isinstance(v, bool) or not isinstance(v, int):
        return None
    return v if 1 <= v <= 10080 else None


def _unreadable(name: str, stem: str, reason: object) -> dict:
    return {
        "source": stem,
        "file": name,
        "generated": None,
        "ok": False,
        "error": f"Can't read {name}: {reason}"[:MAX_FIELD],
        "intervalMinutes": None,
        "alerts": [],
        "readable": False,
    }


def _parse_json(path: Path, data: bytes) -> dict:
    try:
        value = json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError) as exc:
        return _unreadable(path.name, path.stem, exc)
    if not isinstance(value, dict):
        return _unreadable(path.name, path.stem, "not a JSON object")
    raw = value.get("alerts") if isinstance(value.get("alerts"), list) else []
    return {
        "source": _clean(value.get("source")).strip() or path.stem,
        "file": path.name,
        "generated": _clean(value.get("generated")).strip() or None,
        "ok": value.get("ok") is True,
        "error": _clean(value.get("error")).strip() or None,
        "intervalMinutes": _interval(value.get("intervalMinutes")),
        "alerts": [_alert(a) for a in raw[:MAX_ALERTS_PER_FILE]],
        "readable": True,
    }


def read_alert_file(path: Path) -> dict:
    """The ported monitoring-file reader; never raises.

    ``{source, file, generated, ok, error, intervalMinutes, alerts, readable}``; a file that
    can't be read or isn't a JSON object has ``error`` ``"Can't read {name}: {reason}"``
    and ``readable`` False. Severities come back as Critical / Warning / Info.
    """
    path = Path(path)
    try:
        data = path.read_bytes()
    except OSError as exc:
        return _unreadable(path.name, path.stem, exc.strerror or exc)
    return _parse_json(path, data)


def _parse_instant(text: Any) -> datetime | None:
    if not isinstance(text, str) or not text.strip():
        return None
    try:
        dt = datetime.fromisoformat(text.strip())
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _fmt(dt: datetime) -> str:
    dt = dt.astimezone(UTC)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _instant(dt: datetime) -> dict[str, str]:
    return {"start": _fmt(dt), "resolution": "time"}


def is_stale(generated: datetime | None, interval_min: int, now: datetime) -> bool:
    """True when nothing was generated or it is older than twice the interval."""
    return generated is None or now - generated > timedelta(minutes=2 * interval_min)


# -- alert values ------------------------------------------------------------------


def _alert_key(source: str, a: dict[str, str]) -> str:
    return f"{source}|{a['key'] or a['title']}"


def _wanted(source: str, a: dict[str, str]) -> dict[str, Any]:
    """The Alert's values in API form (``raisedAt`` None when ``since`` doesn't parse)."""
    message = ": ".join(p for p in (a["host"], a["detail"]) if p)
    link: str | None = a["link"] or None
    if link and not _HTTP.match(link):
        message = f"{message} See: {link}".strip()
        link = None
    since = _parse_instant(a["since"])
    return {
        "alertSource": source,
        "severity": a["severity"],
        "message": message or None,
        "raisedAt": _instant(since) if since else None,
        "link": link,
    }


def _date_start(v: Any) -> str | None:
    return v.get("start") if isinstance(v, dict) else None


_ALERT_KEYS = (
    "alertSource",
    "severity",
    "message",
    "raisedAt",
    "clearedAt",
    "link",
    "alertKey",
)


def _current(t: TypeDefinition, fm: dict) -> dict[str, Any]:
    """The object's alert values in API form (Severity as its one text)."""
    out: dict[str, Any] = {}
    for key in _ALERT_KEYS:
        pdef = t.prop(key)
        out[key] = (
            decode_value(pdef, fm.get(key), fm) if pdef is not None else fm.get(key)
        )
    sev = out["severity"]
    out["severity"] = sev[0] if isinstance(sev, list) and sev else None
    return out


def _changes(cur: dict[str, Any], want: dict[str, Any]) -> dict[str, Any]:
    updates: dict[str, Any] = {}
    for key in ("alertSource", "severity", "message", "link"):
        if (cur.get(key) or None) != (want[key] or None):
            updates[key] = want[key]
    raised = want["raisedAt"]
    if raised is not None and _date_start(cur.get("raisedAt")) != raised["start"]:
        updates["raisedAt"] = raised
    return updates


# -- the watch ---------------------------------------------------------------------


def _state_path(space: Space) -> Path:
    return state_dir() / f"work-alerts-{space_key(space.root)}.json"


class AlertWatch:
    """Scans the alert folder every `poll_seconds` on a daemon thread; idle without a folder."""

    def __init__(
        self,
        space: Space,
        *,
        folder: Callable[[], Path | None],
        intervals: Callable[[], dict[str, int]],
        announce: Callable[[ChangeEvent], None] = lambda _e: None,
        poll_seconds: float = POLL_SECONDS,
    ) -> None:
        self.space = space
        self.folder = folder
        self.intervals = intervals
        self.announce = announce
        self.poll_seconds = poll_seconds
        self._scan_lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # -- the thread ----------------------------------------------------------------

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run, name="object-alert-watch", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        thread, self._thread = self._thread, None
        if thread is not None:
            thread.join(timeout=1.0)

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                if self.current_folder() is not None:
                    self.scan_once()
            except Exception:  # noqa: BLE001 - one bad scan never ends the watch
                _log.warning("The alert folder scan failed", exc_info=True)
            self._stop.wait(self.poll_seconds)

    # -- settings and state --------------------------------------------------------

    def current_folder(self) -> Path | None:
        """The alert folder now (None when unset or the setting can't be read)."""
        try:
            f = self.folder()
        except Exception:  # noqa: BLE001
            return None
        return Path(f) if f else None

    def _intervals(self) -> dict[str, int]:
        try:
            got = self.intervals() or {}
        except Exception:  # noqa: BLE001
            return {}
        return got if isinstance(got, dict) else {}

    def _load_state(self) -> dict:
        try:
            data = json.loads(_state_path(self.space).read_bytes().decode("utf-8"))
        except (OSError, ValueError):
            return {}
        if not isinstance(data, dict) or not isinstance(data.get("files"), dict):
            return {}
        return data

    def _save_state(self, state: dict) -> None:
        path = _state_path(self.space)
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(path, dump_json(state))

    def sources(self) -> list[dict]:
        """`AlertSourceStatus` per file of the last scan (read from the state file; never writes)."""
        folder = self.current_folder()
        state = self._load_state()
        if folder is None or not state or state.get("folder") != str(folder):
            return []
        now = self.space.clock()
        intervals = self._intervals()
        out = []
        for name, e in sorted(state["files"].items()):
            if not isinstance(e, dict):
                continue
            source = str(e.get("source") or Path(name).stem)
            interval = (
                _interval(e.get("intervalMinutes"))
                or _interval(intervals.get(source))
                or DEFAULT_INTERVAL_MIN
            )
            readable = e.get("readable") is True
            stale = not readable or is_stale(
                _parse_instant(e.get("generated")), interval, now
            )
            out.append(
                {
                    "source": source,
                    "file": name,
                    "generated": e.get("generated"),
                    "ok": readable and e.get("ok") is True,
                    "error": e.get("error"),
                    "stale": stale,
                    "staleAfterMinutes": 2 * interval,
                }
            )
        # Problems first (ported), then by source.
        out.sort(key=lambda s: (s["ok"] and not s["stale"], s["source"]))
        return out

    # -- scanning ------------------------------------------------------------------

    def _index(self, t: TypeDefinition | None) -> dict[str, tuple[str, dict[str, Any]]]:
        """alertKey -> (path, current values) over the alert type's objects."""
        out: dict[str, tuple[str, dict[str, Any]]] = {}
        if t is None:
            return out
        for s in self.space.list(t.id):
            try:
                _of, fm, _v = self.space.read(s.path)
            except (KeyError, OSError):
                continue
            key = fm.get("alertKey")
            if isinstance(key, str) and key and key not in out:
                out[key] = (s.path, _current(t, fm))
        return out

    def scan_once(self) -> AlertScanReport:
        with self._scan_lock:
            return self._scan()

    def _scan(self) -> AlertScanReport:
        report = AlertScanReport()
        folder = self.current_folder()
        if folder is None:
            return report
        if not folder.is_dir():
            report.errors.append(f"Can't read {folder}: not a folder")
            return report
        old = self._load_state()
        old_files: dict[str, dict] = (
            old["files"] if old.get("folder") == str(folder) else {}
        )
        files = sorted(p for p in folder.glob("*.json") if p.is_file())
        report.files = len(files)

        new_files: dict[str, dict] = {}
        changed: list[
            tuple[str, dict]
        ] = []  # (file name, read result): readable, changed
        for p in files:
            prev = old_files.get(p.name)
            prev = prev if isinstance(prev, dict) else None
            sig: list | None = None
            try:
                st = p.stat()
                data = p.read_bytes()
            except OSError as exc:
                got = _unreadable(p.name, p.stem, exc.strerror or exc)
            else:
                sig = [st.st_mtime_ns, st.st_size, hashlib.sha256(data).hexdigest()]
                if prev is not None and prev.get("sig") == sig:
                    report.unchanged += 1
                    new_files[p.name] = prev
                    continue
                got = _parse_json(p, data)
            if not got["readable"]:
                # Its alerts are left as they are; its keys stay this file's.
                report.errors.append(got["error"])
                new_files[p.name] = {
                    "sig": sig,
                    "source": (prev or {}).get("source") or got["source"],
                    "generated": None,
                    "ok": False,
                    "error": got["error"],
                    "intervalMinutes": (prev or {}).get("intervalMinutes"),
                    "readable": False,
                    "keys": list((prev or {}).get("keys") or []),
                }
                continue
            keys: list[str] = []
            for a in got["alerts"]:
                k = _alert_key(got["source"], a)
                if k not in keys:
                    keys.append(k)
            new_files[p.name] = {
                "sig": sig,
                "source": got["source"],
                "generated": got["generated"],
                "ok": got["ok"],
                "error": got["error"],
                "intervalMinutes": got["intervalMinutes"],
                "readable": True,
                "keys": keys,
            }
            changed.append((p.name, got))

        if changed:
            self._apply(report, changed, old_files, new_files)

        state = {"schemaVersion": _SCHEMA, "folder": str(folder), "files": new_files}
        if state != old:
            try:
                self._save_state(state)
            except OSError as exc:
                report.errors.append(f"Can't save the alert watch state: {exc}")
        return report

    def _apply(
        self,
        report: AlertScanReport,
        changed: list[tuple[str, dict]],
        old_files: dict[str, dict],
        new_files: dict[str, dict],
    ) -> None:
        space = self.space
        now = space.clock()
        t = alerttype.alert_type(space)
        index = self._index(t)
        seen: set[str] = set()
        for e in new_files.values():
            seen.update(e.get("keys") or [])

        with writeorigin.acting_as(writeorigin.ALERTS):
            for name, got in changed:
                source = got["source"]
                done: set[str] = set()
                for a in got["alerts"]:
                    key = _alert_key(source, a)
                    if key in done:
                        continue
                    done.add(key)
                    want = _wanted(source, a)
                    try:
                        if key in index:
                            path, cur = index[key]
                            updates = _changes(cur, want)
                            remove = ["clearedAt"] if cur.get("clearedAt") else []
                            if updates or remove:
                                self._update(path, updates, remove)
                                report.updated += 1
                        else:
                            if t is None:
                                t, created = alerttype.ensure_alert_type(space)
                                if created:
                                    self._announce_type(t.id)
                            self._create(t, key, a, want, now)
                            report.created += 1
                    except Exception as exc:  # noqa: BLE001 - one alert never stops the scan
                        _log.warning(
                            "Alert %s could not be written", key, exc_info=True
                        )
                        report.errors.append(f"Can't write {key}: {exc}"[:MAX_FIELD])

                # Keys that left this file (which read fine) get Cleared at, once.
                prev = old_files.get(name)
                if isinstance(prev, dict):
                    gone = set(prev.get("keys") or [])
                else:  # no record of this file (a lost state file): its source's alerts
                    gone = {
                        k
                        for k, (_p, cur) in index.items()
                        if cur.get("alertSource") == source
                    }
                for key in sorted(gone - seen):
                    if key not in index:
                        continue
                    path, cur = index[key]
                    if cur.get("clearedAt"):
                        continue
                    try:
                        self._update(path, {"clearedAt": _instant(now)}, [])
                        report.cleared += 1
                    except Exception as exc:  # noqa: BLE001
                        _log.warning(
                            "Alert %s could not be cleared", key, exc_info=True
                        )
                        report.errors.append(f"Can't write {key}: {exc}"[:MAX_FIELD])

    def _announce(self, event: ChangeEvent) -> None:
        try:
            self.announce(event)
        except Exception:  # noqa: BLE001
            _log.warning("Announcing an alert write failed", exc_info=True)

    def _announce_type(self, type_id: str) -> None:
        revision = type_revision(self.space.root, type_id) or None
        self._announce(
            ChangeEvent("types", type_id, revision, origin=writeorigin.ALERTS)
        )

    def _create(
        self,
        t: TypeDefinition,
        key: str,
        a: dict[str, str],
        want: dict[str, Any],
        now: datetime,
    ) -> None:
        values = {k: v for k, v in want.items() if v is not None}
        if want["raisedAt"] is None:
            values["raisedAt"] = _instant(now)
        values["alertKey"] = key
        path, version = self.space.create_object(
            t.id, a["title"] or "(no title)", values=values
        )
        self._announce(ChangeEvent("created", path, version, origin=writeorigin.ALERTS))

    def _update(self, path: str, updates: dict[str, Any], remove: list[str]) -> None:
        _of, _fm, version = self.space.read(path)
        result = self.space.update_properties(path, updates, version, remove=remove)
        self._announce(
            ChangeEvent("changed", path, result.version, origin=writeorigin.ALERTS)
        )


# -- the view ----------------------------------------------------------------------


def alerts_view(space: Space, watch: AlertWatch) -> dict:
    """`WorkAlerts`: the Alert objects (active first; Critical, Warning, Info; newest raised
    first), the sources of the last scan, counts of the active ones, the folder and whether
    the type exists. Reads only."""
    t = alerttype.alert_type(space)
    rows: list[dict[str, Any]] = []
    if t is not None:
        for s in space.list(t.id):
            try:
                _of, fm, _v = space.read(s.path)
            except (KeyError, OSError):
                continue
            cur = _current(t, fm)
            severity = (
                cur["severity"] if cur["severity"] in _SEVERITY_ORDER else "Warning"
            )
            cleared = _date_start(cur["clearedAt"])
            rows.append(
                {
                    "path": s.path,
                    "title": s.title,
                    "source": cur["alertSource"],
                    "severity": severity,
                    "message": cur["message"],
                    "raisedAt": _date_start(cur["raisedAt"]),
                    "clearedAt": cleared,
                    "link": cur["link"],
                    "active": not cleared,
                }
            )
    rows.sort(key=lambda r: r["raisedAt"] or "", reverse=True)
    rows.sort(key=lambda r: (not r["active"], _SEVERITY_ORDER[r["severity"]]))
    counts = {"Critical": 0, "Warning": 0, "Info": 0}
    for r in rows:
        if r["active"]:
            counts[r["severity"]] += 1
    folder = watch.current_folder()
    return {
        "alerts": rows,
        "sources": watch.sources(),
        "counts": counts,
        "folder": str(folder) if folder is not None else None,
        "typeExists": t is not None,
    }
