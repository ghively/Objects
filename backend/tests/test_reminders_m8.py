"""M8 Task 12: reminders on any date property that supports them.

`space-m8`: ``Tasks/Submit report.md`` has ``deadline: 2026-10-29`` and
``reminders: {deadline: 1 day before at 09:00}``; the fixture's Task type gives
``deadline`` ``supportsReminders``. The space's zone is UTC here.
"""

from __future__ import annotations

import difflib
import json
import os
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp import reminders
from objectapp.api_tasks import set_map_entry
from objectapp.reminders import Ledger, ReminderScheduler, due
from objectapp.server import create_app
from objectapp.space import Space

REPORT = "Tasks/Submit report.md"
DEADLINE_TRIGGER = datetime(2026, 10, 28, 9, 0, tzinfo=UTC)  # 1 day before 2026-10-29, 09:00 UTC
NOW = datetime(2026, 10, 27, 10, 0, tzinfo=UTC)


class FakeNotifier:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    def send(self, title: str, body: str) -> None:
        self.sent.append((title, body))


def _space(root: Path, now: datetime = NOW) -> Space:
    space = Space(root)
    space.clock = lambda: now
    space.tz = UTC
    return space


def _write(root: Path, rel: str, text: str, crlf: bool = False) -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    data = text.replace("\n", "\r\n") if crlf else text
    path.write_bytes(data.encode("utf-8"))


def _changed(before: bytes, after: bytes) -> tuple[list[str], list[str]]:
    """(removed lines, added lines), ``lastUpdated`` lines left out."""
    a = before.decode("utf-8").splitlines(keepends=True)
    b = after.decode("utf-8").splitlines(keepends=True)
    removed: list[str] = []
    added: list[str] = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes():
        if op != "equal":
            removed += [x for x in a[i1:i2] if not x.startswith("lastUpdated:")]
            added += [x for x in b[j1:j2] if not x.startswith("lastUpdated:")]
    return removed, added


@pytest.fixture
def client(m8_space_dir: Path):
    space = _space(m8_space_dir)
    app = create_app(space, watch=False)
    with TestClient(app) as c:
        c.space = space  # type: ignore[attr-defined]
        yield c


def _version(client: TestClient, rel: str) -> str:
    r = client.get("/api/object", params={"path": rel})
    assert r.status_code == 200, r.text
    return r.json()["version"]


def _put(client: TestClient, rel: str, key: str, remind: str | None, **more):
    body = {"path": rel, "key": key, "remind": remind, "baseVersion": _version(client, rel), **more}
    return client.put("/api/tasks/reminder", json=body)


# -- the scheduler --------------------------------------------------------------------


def test_deadline_reminder_fires_once(m8_space_dir: Path, tmp_path: Path, monkeypatch):
    clock = tmp_path / "clock.txt"
    notify = tmp_path / "notify.jsonl"
    clock.write_text("2026-10-28T09:00:30Z", encoding="utf-8")
    monkeypatch.setenv("OBJECT_CLOCK_FILE", str(clock))
    monkeypatch.setenv("OBJECT_FAKE_NOTIFY_FILE", str(notify))
    space = Space(m8_space_dir)
    space.tz = UTC
    with TestClient(create_app(space, watch=False)) as c:
        # The scheduler thread checks once at start-up too; whichever check runs first fires it.
        first = c.post("/api/_test/tick").json()["fired"]
        if first:
            assert [(f["path"], f["title"], f["body"]) for f in first] == [
                (REPORT, "Submit report", "Due 2026-10-29")
            ]
            assert datetime.fromisoformat(first[0]["trigger"]) == DEADLINE_TRIGGER
        assert c.post("/api/_test/tick").json()["fired"] == []
    # A restart (a new scheduler, the same ledger) doesn't fire it again.
    space2 = Space(m8_space_dir)
    space2.tz = UTC
    with TestClient(create_app(space2, watch=False)) as c:
        assert c.post("/api/_test/tick").json()["fired"] == []
    lines = notify.read_text(encoding="utf-8").splitlines()
    assert [json.loads(x) for x in lines] == [{"title": "Submit report", "body": "Due 2026-10-29"}]


def test_done_suppresses_only_tasks(m8_space_dir: Path):
    # A done Task's deadline doesn't fire.
    text = (m8_space_dir / REPORT).read_text(encoding="utf-8")
    (m8_space_dir / REPORT).write_text(text.replace("status: In Progress", "status: Done"), encoding="utf-8")
    # A Person with a reminder-capable date and a `status`-like text fires regardless.
    _add_birthday(m8_space_dir)
    _write(
        m8_space_dir,
        "People/Grace.md",
        "---\nid: 01JC8M8000000000000000G001\ntype: 'Person'\ntitle: Grace\n"
        "lastUpdated: 2026-10-01T08:00:00.000Z\nbirthday: 2026-10-29\nstatus: Done\n"
        "reminders:\n  birthday: on the day at 08:00\n---\n",
    )
    space = _space(m8_space_dir, datetime(2026, 10, 29, 8, 0, 10, tzinfo=UTC))
    sched = ReminderScheduler(space, FakeNotifier(), ledger=Ledger(Path(os.environ["OBJECT_STATE_DIR"]) / "l.json"))
    fired = sched.tick()
    assert [(d.path, d.body) for d in fired] == [("People/Grace.md", "Due today")]
    assert fired[0].key == "01JC8M8000000000000000G001|birthday|2026-10-29|2026-10-29T08:00:00.000Z"


def _add_birthday(root: Path, supports: bool = True) -> None:
    """Give the fixture's Person type a ``birthday`` date (with ``supportsReminders`` when asked)."""
    path = root / ".capacities/types/person.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["propertyDefinitions"] = [p for p in data["propertyDefinitions"] if p["key"] != "birthday"]
    constraints = {"resolutionPreference": "day", "endTimeSettings": "notAllowed"}
    if supports:
        constraints["supportsReminders"] = True
    data["propertyDefinitions"].append(
        {
            "id": "birthday",
            "key": "birthday",
            "name": "Birthday",
            "type": "datetimeSimple",
            "description": "",
            "icon": {"type": "iconify", "val": "ph-calendar"},
            "visibility": "alwaysShow",
            "options": {"constraints": constraints},
        }
    )
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def test_unsupported_property_entry_ignored(m8_space_dir: Path):
    _add_birthday(m8_space_dir, supports=False)
    _write(
        m8_space_dir,
        "People/Grace.md",
        "---\ntype: 'Person'\ntitle: Grace\nbirthday: 2026-10-29\n"
        "reminders:\n  birthday: on the day at 08:00\n---\n",
    )
    space = _space(m8_space_dir)
    assert [t for t in reminders.task_infos(space) if t.path == "People/Grace.md"] == []


def test_m4_date_reminders_unchanged(calendar_space_dir: Path):
    """Regression guard (green from the start): M4's Task `date` + `remind` and its ledger key."""
    space = _space(calendar_space_dir, datetime(2026, 10, 23, 8, 15, tzinfo=UTC))
    ledger = Ledger(Path(os.environ["OBJECT_STATE_DIR"]) / "m4.json")
    items = {d.path: d for d in due(space, datetime(2026, 10, 23, 8, 0, tzinfo=UTC), space.clock(), ledger)}
    dentist = items["Tasks/Call dentist.md"]
    info = next(t for t in reminders.task_infos(space) if t.path == "Tasks/Call dentist.md")
    assert info.key == "date" and info.legacy
    assert dentist.key == f"{info.key_id}|{info.date['start']}|2026-10-23T08:15:00.000Z"


def test_ledger_keys_distinct_per_property(m8_space_dir: Path):
    _write(
        m8_space_dir,
        "Tasks/Two reminders.md",
        "---\nid: 01JC8M8000000000000000T002\ntype: 'Task'\ntitle: Two reminders\n"
        "lastUpdated: 2026-10-01T08:00:00.000Z\nstatus: Not Started\n"
        "date: 2026-10-29\nremind: 1 day before at 09:00\n"
        "deadline: 2026-10-29\nreminders:\n  deadline: 1 day before at 09:00\n---\n",
    )
    space = _space(m8_space_dir, datetime(2026, 10, 28, 9, 0, 5, tzinfo=UTC))
    sched = ReminderScheduler(space, FakeNotifier(), ledger=Ledger(Path(os.environ["OBJECT_STATE_DIR"]) / "k.json"))
    fired = [d for d in sched.tick() if d.path == "Tasks/Two reminders.md"]
    keys = sorted(d.key for d in fired)
    assert keys == [
        "01JC8M8000000000000000T002|2026-10-29|2026-10-28T09:00:00.000Z",
        "01JC8M8000000000000000T002|deadline|2026-10-29|2026-10-28T09:00:00.000Z",
    ]
    assert sched.tick(datetime(2026, 10, 28, 9, 0, 40, tzinfo=UTC)) == []


def test_task_date_entry_in_map_ignored(m8_space_dir: Path):
    """The Task `date` keeps M4's `remind`: a `reminders.date` entry on a Task is ignored."""
    _write(
        m8_space_dir,
        "Tasks/Map date.md",
        "---\ntype: 'Task'\ntitle: Map date\ndate: 2026-10-29\nreminders:\n  date: 1 day before at 09:00\n---\n",
    )
    space = _space(m8_space_dir)
    assert [t for t in reminders.task_infos(space) if t.path == "Tasks/Map date.md"] == []


# -- the route ------------------------------------------------------------------------


def test_reminder_needs_supports_reminders_422(client: TestClient, m8_space_dir: Path):
    before = (m8_space_dir / REPORT).read_bytes()
    for key in ("completed", "status", "nope", "title"):
        r = _put(client, REPORT, key, "on the day at 09:00")
        assert r.status_code == 422, (key, r.text)
    assert (m8_space_dir / REPORT).read_bytes() == before
    body = {"path": "Tasks/Missing.md", "key": "deadline", "remind": None, "baseVersion": "x"}
    assert client.put("/api/tasks/reminder", json=body).status_code == 404


def test_remind_must_fit_resolution_422(client: TestClient, m8_space_dir: Path):
    before = (m8_space_dir / REPORT).read_bytes()
    for text in ("15 minutes before", "at time", "soon", "1 day before at 25:00"):
        r = _put(client, REPORT, "deadline", text)
        assert r.status_code == 422, (text, r.text)
    assert (m8_space_dir / REPORT).read_bytes() == before


def test_set_and_clear_reminder_changes_one_line(client: TestClient, m8_space_dir: Path):
    path = m8_space_dir / REPORT
    before = path.read_bytes()
    r = _put(client, REPORT, "deadline", "On the day at 08:00", clientId="c1")
    assert r.status_code == 200, r.text
    assert r.json()["frontmatter"]["reminders"] == {"deadline": "on the day at 08:00"}
    after = path.read_bytes()
    assert _changed(before, after) == (
        ["  deadline: 1 day before at 09:00\n"],
        ["  deadline: on the day at 08:00\n"],
    )
    # Clearing the last entry removes the key.
    r = _put(client, REPORT, "deadline", None)
    assert r.status_code == 200, r.text
    assert "reminders" not in r.json()["frontmatter"]
    removed, added = _changed(after, path.read_bytes())
    assert removed == ["reminders:\n", "  deadline: on the day at 08:00\n"] and added == []
    # Setting it again appends the map.
    cleared = path.read_bytes()
    r = _put(client, REPORT, "deadline", "2 days before at 07:30")
    assert r.status_code == 200, r.text
    removed, added = _changed(cleared, path.read_bytes())
    assert removed == [] and added == ["reminders:\n", "  deadline: 2 days before at 07:30\n"]


def test_stale_reminder_409(client: TestClient, m8_space_dir: Path):
    body = {"path": REPORT, "key": "deadline", "remind": None, "baseVersion": "stale"}
    before = (m8_space_dir / REPORT).read_bytes()
    r = client.put("/api/tasks/reminder", json=body)
    assert r.status_code == 409 and r.json()["currentVersion"]
    assert (m8_space_dir / REPORT).read_bytes() == before


def test_task_date_writes_m4_remind(client: TestClient, m8_space_dir: Path):
    _write(m8_space_dir, "Tasks/Plain.md", "---\ntype: 'Task'\ntitle: Plain\ndate: 2026-10-29\n---\nBody\n")
    client.space.rescan_file("Tasks/Plain.md")  # type: ignore[attr-defined]
    r = _put(client, "Tasks/Plain.md", "date", "1 day before at 09:00")
    assert r.status_code == 200, r.text
    fm = r.json()["frontmatter"]
    assert fm["remind"] == "1 day before at 09:00" and "reminders" not in fm
    r = _put(client, "Tasks/Plain.md", "date", None)
    assert r.status_code == 200 and "remind" not in r.json()["frontmatter"]


def test_other_entries_and_crlf_kept(m8_space_dir: Path):
    _add_birthday(m8_space_dir)
    rel = "People/Grace.md"
    _write(
        m8_space_dir,
        rel,
        "---\nid: 01JC8M8000000000000000G002\ntype: 'Person'\ntitle: Grace\nbirthday: 2026-10-29\n"
        "reminders:\n  birthday: on the day at 08:00\n  other: keep me  # a comment\n"
        "tags: [Old tag]\n---\nBody\n",
        crlf=True,
    )
    with TestClient(create_app(_space(m8_space_dir), watch=False)) as client:
        _crlf_steps(client, m8_space_dir, rel)


def _crlf_steps(client: TestClient, m8_space_dir: Path, rel: str) -> None:
    path = m8_space_dir / rel
    before = path.read_bytes()
    r = _put(client, rel, "birthday", None)
    assert r.status_code == 200, r.text
    after = path.read_bytes()
    assert b"\r\n" in after and b"\n" not in after.replace(b"\r\n", b"")
    assert _changed(before, after) == (["  birthday: on the day at 08:00\r\n"], [])
    r = _put(client, rel, "birthday", "1 day before at 18:00")
    assert r.status_code == 200, r.text
    assert _changed(after, path.read_bytes()) == ([], ["  birthday: 1 day before at 18:00\r\n"])
    assert r.json()["frontmatter"]["reminders"] == {"other": "keep me", "birthday": "1 day before at 18:00"}


# -- the frontmatter helper -----------------------------------------------------------


@pytest.mark.parametrize(
    ("src", "entry", "value", "expected"),
    [
        ("a: 1\n", "deadline", "at time", "a: 1\nreminders:\n  deadline: at time\n"),
        ("a: 1\n", "deadline", None, "a: 1\n"),
        ("reminders:\n  x: 1\nb: 2\n", "y", "on the day at 09:00", "reminders:\n  x: 1\n  y: on the day at 09:00\nb: 2\n"),
        ("reminders:\n    x: a\n    y: b\nb: 2\n", "x", None, "reminders:\n    y: b\nb: 2\n"),
        ("reminders:\n  x: a\n\nb: 2\n", "x", None, "\nb: 2\n"),
        ("reminders: {x: a}\n", "y", "b", "reminders:\n  x: a\n  y: b\n"),
        ("reminders: nope\n", "y", "b", "reminders:\n  y: b\n"),
    ],
)
def test_set_map_entry(src: str, entry: str, value: str | None, expected: str):
    assert set_map_entry(src, "reminders", entry, value) == expected
