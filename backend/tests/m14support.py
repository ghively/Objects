"""Shared set-up for the M14 automation tests (not a test module).

`m14_space` copies the synthetic ``space-m8`` fixture into a temporary folder (never opening
the fixture itself) and adds what the rules need: a day-resolution ``doneOn`` date on Task,
and a two-way relation (Page ``related`` <-> Task ``notes``). `served` runs the app with its
lifespan (the engine's worker and scheduler), a settable clock, UTC, the fake notifier and a
schedule thread too slow to interfere: the tests tick it themselves.
"""

from __future__ import annotations

import contextlib
import json
import shutil
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from objectapp.server import create_app
from objectapp.space import Space

FIXTURES = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 11, 2, 8, 0, tzinfo=UTC)  # a Monday
NEW_TAG = "01JC8M80000000000000000019"  # Tags/New tag.md
OLD_TAG = "01JC8M80000000000000000018"  # Tags/Old tag.md
PAY_RENT = "Tasks/Pay rent.md"
STRETCH = "Tasks/Stretch.md"  # repeats after completion: Done resets its status
REPORT = "Tasks/Submit report.md"  # In Progress, no repeat
DAILY = "DailyNotes/2026-10-27.md"


def m14_space(tmp_path: Path) -> Path:
    root = tmp_path / "space-m14"
    shutil.copytree(FIXTURES / "space-m8", root)
    task_file = root / ".object" / "types" / "task.json"
    task = json.loads(task_file.read_text(encoding="utf-8"))
    task["propertyDefinitions"] += [
        {
            "id": "doneOn", "key": "doneOn", "name": "Done on", "type": "datetime",
            "description": "", "icon": None, "visibility": "alwaysShow",
            "options": {"constraints": {"resolutionPreference": "day"}},
        },
        {
            "id": "notes", "key": "notes", "name": "Notes", "type": "entity",
            "description": "", "icon": None, "visibility": "alwaysShow",
            "options": {"isArray": True, "allowedTypes": ["page"], "hasFixedSet": False,
                        "fixedSet": [], "propertySyncing": {"propertyIds": ["related"]}},
        },
    ]  # fmt: skip
    task_file.write_text(json.dumps(task, indent=2) + "\n", encoding="utf-8")
    page_file = root / ".object" / "types" / "page.json"
    page = json.loads(page_file.read_text(encoding="utf-8"))
    for p in page["propertyDefinitions"]:
        if p["key"] == "related":
            p["options"]["propertySyncing"] = {"propertyIds": ["notes"]}
    page_file.write_text(json.dumps(page, indent=2) + "\n", encoding="utf-8")
    return root


class Clock:
    def __init__(self, now: datetime = NOW) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


@dataclass
class Served:
    space: Space
    client: TestClient
    clock: Clock
    notified: Path

    @property
    def engine(self):
        return self.client.app.state.automations  # type: ignore[attr-defined]

    def idle(self) -> None:
        assert self.client.post("/api/_test/automations/idle").json() == {"idle": True}

    def create(self, rule: dict[str, Any], status: int = 201) -> dict[str, Any]:
        res = self.client.post("/api/automations", json={"rule": rule})
        assert res.status_code == status, res.text
        return res.json()

    def runs(self, rule_id: str) -> list[dict[str, Any]]:
        res = self.client.get(f"/api/automations/{rule_id}/runs")
        assert res.status_code == 200, res.text
        return res.json()["runs"]

    def props(self, path: str, updates: dict[str, Any]) -> dict[str, Any]:
        version = self.client.get("/api/object", params={"path": path}).json()["version"]
        res = self.client.put(
            "/api/object/properties",
            json={"path": path, "updates": updates, "baseVersion": version},
        )
        assert res.status_code == 200, res.text
        return res.json()

    def text(self, path: str) -> str:
        return (self.space.root / path).read_bytes().decode("utf-8")

    def notifications(self) -> list[dict[str, str]]:
        if not self.notified.exists():
            return []
        return [json.loads(x) for x in self.notified.read_text(encoding="utf-8").splitlines()]


@contextlib.contextmanager
def served(root: Path, monkeypatch, tmp_path: Path, now: datetime = NOW, watch: bool = False) -> Iterator[Served]:
    notified = tmp_path / "notified.jsonl"
    monkeypatch.setenv("OBJECT_FAKE_NOTIFY_FILE", str(notified))
    space = Space(root)
    clock = Clock(now)
    space.clock = clock
    space.tz = UTC
    app = create_app(space, watch=watch)
    app.state.automations.scheduler.interval = 3600  # the tests tick it themselves
    with TestClient(app) as client:
        yield Served(space, client, clock, notified)


def status_rule(**over: Any) -> dict[str, Any]:
    """"When a Task's status changes to Done, stamp Done on with today" (our example)."""
    rule = {
        "name": "Stamp completion",
        "trigger": {
            "kind": "propertyChanged",
            "scope": {"kind": "type", "id": "task"},
            "propertyKey": "status",
            "to": {"type": "filter", "propertyId": "status", "option": "contains", "referenceValue": ["done"]},
        },
        "actions": [{"kind": "setProperty", "key": "doneOn", "now": True}],
    }
    rule.update(over)
    return rule
