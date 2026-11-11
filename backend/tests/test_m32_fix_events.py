"""M32 fix pass, finding 5: when the Work default flips because of the data, the windows are told.

The default follows the space's data, so a write other than ``PUT /api/space`` can move it: a
Ticket ID put on a task, the last one removed, a task deleted, a file changed outside the app.
The types (their ticket and work fields) and the saved searches (Tickets) change in memory then;
the event stream carries ``types`` and ``queries`` as ``PUT /api/space`` sends them. With Work off
a value that comes or goes changes what a type lists: ``types`` is sent. Synthetic data only.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.spaces import create_space
from objectapp.workfields import FIELD_KEYS
from objectapp.workview import TICKETS_ID

TYPES = ("types", "*")
QUERIES = ("queries", TICKETS_ID)


class Stream:
    """The app with what it publishes to the event stream recorded."""

    def __init__(self, root: Path, watch: bool = False) -> None:
        self.root = root
        self.space = Space(root)
        app = create_app(self.space, None, watch=watch)
        self.events: list[tuple[str, str | None]] = []
        real = app.state.hub.publish
        app.state.hub.publish = lambda e: (self.events.append((e.kind, e.path)), real(e))[1]
        self._ctx = TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 50000))
        self.c = self._ctx.__enter__()

    def close(self) -> None:
        self._ctx.__exit__(None, None, None)

    def wait(self, *wanted: tuple[str, str | None], timeout: float = 15.0) -> list[tuple[str, str | None]]:
        """The events published since the last `clear`, once they hold every one of ``wanted``."""
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if all(w in self.events for w in wanted):
                break
            time.sleep(0.02)
        time.sleep(0.1)  # let a straggler in, so "not sent" is a fair claim
        return list(self.events)

    def clear(self) -> None:
        time.sleep(0.1)
        self.events.clear()

    def work_on(self) -> bool:
        return self.c.get("/api/space").json()["workOn"]

    def task_keys(self) -> set[str]:
        task = next(t for t in self.c.get("/api/space").json()["types"] if t["id"] == "task")
        return {p["key"] for p in task["propertyDefinitions"]} & FIELD_KEYS

    def set(self, path: str, updates: dict, remove: tuple[str, ...] = ()) -> None:
        o = self.c.get("/api/object", params={"path": path}).json()
        r = self.c.put(
            "/api/object/properties",
            json={"path": path, "updates": updates, "remove": list(remove), "baseVersion": o["version"]},
        )
        assert r.status_code == 200, r.text


@pytest.fixture
def streams():
    made: list[Stream] = []

    def make(root: Path, watch: bool = False) -> Stream:
        made.append(Stream(root, watch))
        return made[-1]

    yield make
    for s in made:
        s.close()


@pytest.fixture
def plain(tmp_path: Path) -> Path:
    return create_space("Notes", tmp_path)


def test_a_property_write_that_flips_the_default_is_announced(plain: Path, streams):
    s = streams(plain)
    rel = s.c.post("/api/objects", json={"typeId": "task", "title": "Printer"}).json()["path"]
    assert s.work_on() is False
    s.clear()
    s.set(rel, {"ticketId": "INC0012345"})
    got = s.wait(TYPES, QUERIES)
    assert ("changed", rel) in got and TYPES in got and QUERIES in got
    assert s.work_on() is True and s.task_keys() == FIELD_KEYS
    # a window that reads the types after the event saves the Task without being refused
    task = next(t for t in s.c.get("/api/space").json()["types"] if t["id"] == "task")
    rev = task.pop("revision")
    task["color"] = "red"
    assert s.c.put("/api/types/task", json={"type": task, "baseRevision": rev}).status_code == 200
    # and off again
    s.clear()
    s.set(rel, {}, remove=("ticketId",))
    got = s.wait(TYPES, QUERIES)
    assert TYPES in got and QUERIES in got and s.work_on() is False


def test_a_write_that_leaves_the_default_alone_announces_nothing_more(plain: Path, streams):
    s = streams(plain)
    rel = s.c.post("/api/objects", json={"typeId": "page", "title": "Printer"}).json()["path"]
    s.clear()
    s.set(rel, {"ticketId": "INC0012345"})  # a Ticket ID on a Note is no work data
    s.set(rel, {"description": "plain"})
    got = s.wait(("changed", rel))
    assert [e for e in got if e[0] in ("types", "queries")] == []
    assert s.work_on() is False


def test_deleting_the_last_task_with_ticket_data_is_announced(plain: Path, streams):
    s = streams(plain)
    rel = s.c.post("/api/objects", json={"typeId": "task", "title": "Printer"}).json()["path"]
    s.set(rel, {"ticketId": "INC0012345"})
    assert s.work_on() is True
    s.clear()
    r = s.c.request("DELETE", "/api/object", params={"path": rel})
    assert r.status_code == 200, r.text
    got = s.wait(TYPES, QUERIES)
    assert TYPES in got and QUERIES in got and s.work_on() is False


def test_making_the_capture_type_is_announced(plain: Path, streams):
    s = streams(plain)
    s.clear()
    r = s.c.post("/api/work/captures", json={"text": "remember the milk", "fromView": "today"})
    assert r.status_code == 201, r.text
    got = s.wait(TYPES, QUERIES)
    assert TYPES in got and QUERIES in got and s.work_on() is True


def test_the_switch_set_by_hand_is_announced_once(plain: Path, streams):
    s = streams(plain)
    s.clear()
    rev = s.c.get("/api/space").json()["revision"]
    r = s.c.put("/api/space", json={"patch": {"workEnabled": True}, "baseRevision": rev})
    assert r.status_code == 200
    got = s.wait(TYPES, QUERIES)
    assert got.count(TYPES) == 1 and got.count(QUERIES) == 1
    s.clear()
    rev = s.c.get("/api/space").json()["revision"]
    s.c.put("/api/space", json={"patch": {"name": "Renamed"}, "baseRevision": rev})
    assert [e for e in s.wait() if e[0] in ("types", "queries")] == []


def test_with_work_off_a_value_that_changes_what_the_task_lists_is_announced(plain: Path, streams):
    path = plain / ".object" / "space.json"
    path.write_text(json.dumps({**json.loads(path.read_text("utf-8")), "workEnabled": False}), "utf-8")
    s = streams(plain)
    rel = s.c.post("/api/objects", json={"typeId": "task", "title": "Printer"}).json()["path"]
    s.clear()
    s.set(rel, {"requester": "Pat"})
    got = s.wait(TYPES)
    assert TYPES in got and QUERIES not in got  # the switch did not move: Tickets stays unlisted
    assert s.task_keys() == {"requester"} and s.work_on() is False
    s.clear()
    s.set(rel, {}, remove=("requester",))
    assert TYPES in s.wait(TYPES) and s.task_keys() == set()


def test_a_file_changed_outside_the_app_that_flips_the_default_is_announced(plain: Path, streams):
    s = streams(plain, watch=True)
    assert s.work_on() is False
    time.sleep(0.5)  # the watcher is up
    s.clear()
    (plain / "Tasks").mkdir(exist_ok=True)
    (plain / "Tasks" / "Outside.md").write_text(
        "---\ntype: 'Task'\ntitle: 'Outside'\nticketId: 'INC0012345'\n---\n", "utf-8", newline="\n"
    )
    got = s.wait(TYPES, QUERIES, timeout=30)
    assert TYPES in got and QUERIES in got
    assert s.work_on() is True
