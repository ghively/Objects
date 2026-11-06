"""M23 Task 4: Wins from steps, closed items and Object's own version history.

Run on a copy of the overlay space (``m23_helpers.copy_space``) with the clock at
2026-11-05T10:00Z, the space time zone UTC and ``OBJECT_STATE_DIR`` in ``tmp_path``.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime
from pathlib import Path

import m23_helpers
import pytest

from objectapp import workwins
from objectapp.history import HistoryStore
from objectapp.space import Space

NOW = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)
FIRMWARE = "Tasks/Scanner firmware.md"
PAT = "People/Pat Example.md"
WAITING = "Tasks/Waiting on Pat.md"
LAST_WEEK = "Tasks/Last week fix.md"


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
    if not root.exists():
        return out
    for dirpath, _dirs, files in os.walk(root):
        if ".object-cache" in Path(dirpath).relative_to(root).parts:
            continue
        for f in files:
            p = Path(dirpath) / f
            out[p.relative_to(root).as_posix()] = p.read_bytes()
    return out


def _at(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 11, day, hour, minute, tzinfo=UTC)


def _snap(history: HistoryStore, space: Space, rel: str, at: datetime) -> None:
    data = (space.root / rel).read_bytes()
    assert history.snapshot(rel, data, at, force=True) is not None


def test_changed_keys_by_day(space: Space, state: Path) -> None:
    history = HistoryStore(space.root)
    lo, hi = datetime(2026, 10, 23, tzinfo=UTC), datetime(2026, 11, 6, tzinfo=UTC)

    # An empty state dir: nothing, and no folder is made.
    assert history.changed_keys_by_day(lo, hi, UTC) == {}
    assert not state.exists() or not (state / "history").exists()

    _snap(history, space, FIRMWARE, _at(4, 9))
    _snap(history, space, FIRMWARE, _at(4, 12))
    _snap(history, space, FIRMWARE, _at(4, 18))
    _snap(history, space, PAT, _at(5, 8))
    k1 = history.key_for(FIRMWARE, space.get(FIRMWARE).id)
    k2 = history.key_for(PAT, space.get(PAT).id)
    assert k1 != k2
    assert history.changed_keys_by_day(lo, hi, UTC) == {"2026-11-04": {k1}, "2026-11-05": {k2}}
    # Bounds: hi is exclusive.
    assert history.changed_keys_by_day(lo, _at(5, 0), UTC) == {"2026-11-04": {k1}}

    # An index that isn't JSON is skipped.
    bad = history.dir / "path-0000000000000000"
    bad.mkdir(parents=True)
    (bad / "index.json").write_bytes(b"{not json")
    assert history.changed_keys_by_day(lo, hi, UTC) == {"2026-11-04": {k1}, "2026-11-05": {k2}}

    # Without an id the key is read from the file; a path with no id gives the path key.
    assert history.key_for(FIRMWARE, None) == k1


def test_wins_counts(space: Space, state: Path) -> None:
    history = HistoryStore(space.root)
    # Waiting on Pat: a history entry and (below) a lastUpdated on the same day count once.
    _snap(history, space, WAITING, _at(5, 8))
    raw = (space.root / WAITING).read_bytes().replace(
        b"lastUpdated: 2026-10-25T09:00:00.000Z", b"lastUpdated: 2026-11-05T08:00:00.000Z"
    )
    (space.root / WAITING).write_bytes(raw)
    space = Space(space.root)
    space.clock = lambda: NOW
    space.tz = UTC
    service = m23_helpers.service(space)

    out = workwins.wins(space, service, history, days=14)
    days = out["days"]
    assert len(days) == 14
    assert days[0]["day"] == "2026-10-23"
    assert days[-1]["day"] == "2026-11-05"
    by_day = {d["day"]: d for d in days}

    assert by_day["2026-11-03"]["stepsDone"] == 1  # Scanner firmware's Flash the floor units
    assert by_day["2026-11-04"]["stepsDone"] == 1  # Printer's answered Question
    assert by_day["2026-10-30"]["itemsClosed"] == 1  # Last week fix
    assert sum(d["itemsClosed"] for d in days) == 1  # Old cleanup is older than 14 days
    assert out["stepsDone"] == sum(d["stepsDone"] for d in days) == 2
    assert out["itemsClosed"] == 1

    # 2026-11-05: Waiting on Pat (history + lastUpdated, once) and the daily note.
    today_paths = {s.path for s in space.list() if (s.lastUpdated or "").startswith("2026-11-05")}
    assert WAITING in today_paths
    assert by_day["2026-11-05"]["objectsChanged"] == len(today_paths)
    assert out["objectsChanged"] >= by_day["2026-11-05"]["objectsChanged"]

    got = out["got"]
    assert [g["at"] for g in got] == sorted((g["at"] for g in got), reverse=True)
    step = next(g for g in got if g["path"] == FIRMWARE)
    assert step["kind"] == "step"
    assert step["text"] == "Step 1: Flash the floor units"
    assert step["title"] == "Scanner firmware"
    closed = next(g for g in got if g["path"] == LAST_WEEK)
    assert closed["kind"] == "closed"
    assert closed["text"] == "Closed"
    assert not any(g["path"] == "Tasks/Old cleanup.md" for g in got)


def test_wins_days_window(space: Space, state: Path) -> None:
    out = workwins.wins(space, m23_helpers.service(space), HistoryStore(space.root), days=3)
    assert [d["day"] for d in out["days"]] == ["2026-11-03", "2026-11-04", "2026-11-05"]
    assert out["itemsClosed"] == 0
    assert out["stepsDone"] == 2


def test_wins_reads_write_nothing(space: Space, state: Path) -> None:
    history = HistoryStore(space.root)
    before_space = _snapshot(space.root)
    before_state = _snapshot(state)
    workwins.wins(space, m23_helpers.service(space), history, days=14)
    workwins.wins(space, m23_helpers.service(space), history, days=1)
    assert _snapshot(space.root) == before_space
    assert _snapshot(state) == before_state
    assert not (state / "history").exists()
