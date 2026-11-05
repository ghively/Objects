"""M14: the rule store and its routes (validation, revisions, read-only files), the trash,
the watcher's automations folder."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from m14support import REPORT, m14_space, served, status_rule
from objectapp.automations import run_log_path
from objectapp.watcher import SpaceWatcher


@pytest.fixture
def root(tmp_path: Path) -> Path:
    return m14_space(tmp_path)


def rule_file(root: Path, rule_id: str) -> Path:
    return root / ".object" / "automations" / f"{rule_id}.json"


def test_create_stores_one_file_with_the_model_keys(root, monkeypatch, tmp_path):
    with served(root, monkeypatch, tmp_path) as s:
        made = s.create(status_rule(name="  Stamp   completion ", id="ignored", lastRun={"x": 1}))
        assert made["name"] == "Stamp completion" and made["readOnlyReason"] is None
        assert made["createdAt"] == "2026-11-02T08:00:00.000Z" and made["lastRun"] is None
        data = json.loads(rule_file(root, made["id"]).read_text(encoding="utf-8"))
        assert data["schemaVersion"] == 1 and data["enabled"] is True
        assert not {"id", "revision", "readOnlyReason", "lastRun"} & data.keys()
        assert [r["id"] for r in s.client.get("/api/automations").json()] == [made["id"]]
        assert s.client.get("/api/automations/01JNOPE0000000000000000000").status_code == 404


@pytest.mark.parametrize(
    "rule, words",
    [
        (status_rule(trigger={"kind": "propertyChanged", "scope": {"kind": "type", "id": "nope"},
                              "propertyKey": "status"}), "nope"),
        (status_rule(trigger={"kind": "propertyChanged", "scope": {"kind": "type", "id": "task"},
                              "propertyKey": "nothing"}), "isn't a property"),
        (status_rule(trigger={"kind": "propertyChanged", "scope": {"kind": "type", "id": "task"},
                              "propertyKey": "createdAt"}), "can't start"),
        (status_rule(actions=[{"kind": "setProperty", "key": "priority", "value": "Urgent"}]), "Action 1"),
        (status_rule(actions=[{"kind": "setProperty", "key": "priority", "now": True}]), "isn't a date"),
        (status_rule(actions=[{"kind": "setProperty", "key": "title", "value": "x"}]), "can't be set"),
        (status_rule(actions=[{"kind": "clearProperty", "key": "missing"}]), "isn't a property"),
        (status_rule(actions=[]), ""),
        ({"name": "S", "trigger": {"kind": "schedule", "repeat": "whenever", "start": "2026-11-02"},
          "actions": [{"kind": "notify", "title": "", "body": "x"}]}, "repeat"),
        ({"name": "S", "trigger": {"kind": "schedule", "repeat": "every day after completion",
                                   "start": "2026-11-02"},
          "actions": [{"kind": "notify", "title": "", "body": "x"}]}, "after completion"),
        ({"name": "S", "trigger": {"kind": "schedule", "repeat": "every day", "start": "2026-11-02"},
          "actions": [{"kind": "addTag", "tagId": "x"}]}, "no object"),
        (status_rule(actions=[{"kind": "createFromTemplate", "typeId": "page", "templateId": "01JNOPE"}]),
         "no template"),
        (status_rule(actions=[{"kind": "createFromTemplate", "typeId": "page", "relateVia": "title"}]),
         "isn't a relation"),
        (status_rule(name="   "), ""),
    ],
)  # fmt: skip
def test_invalid_rules_are_refused_plainly(root, monkeypatch, tmp_path, rule, words):
    with served(root, monkeypatch, tmp_path) as s:
        res = s.client.post("/api/automations", json={"rule": rule})
        assert res.status_code == 422, res.text
        assert isinstance(res.json()["detail"], str) and words in res.json()["detail"]
        assert not (root / ".object" / "automations").exists()


def test_a_schedule_repeat_is_stored_canonical(root, monkeypatch, tmp_path):
    with served(root, monkeypatch, tmp_path) as s:
        made = s.create({"name": "S", "trigger": {"kind": "schedule", "repeat": "Every Week",
                                                  "start": "2026-11-02"},
                         "actions": [{"kind": "notify", "title": "", "body": "x"}]})  # fmt: skip
        assert made["trigger"]["repeat"] == "every week" and made["trigger"]["time"] == "09:00"


def test_save_checks_the_revision_and_keeps_what_it_does_not_know(root, monkeypatch, tmp_path):
    with served(root, monkeypatch, tmp_path) as s:
        made = s.create(status_rule())
        f = rule_file(root, made["id"])
        data = json.loads(f.read_text(encoding="utf-8"))
        data["futureKey"] = {"kept": True}
        f.write_text(json.dumps(data), encoding="utf-8")
        current = s.client.get(f"/api/automations/{made['id']}").json()
        res = s.client.put(f"/api/automations/{made['id']}", json={
            "rule": status_rule(name="Renamed"), "baseRevision": made["revision"]})
        assert res.status_code == 409 and res.json()["currentRevision"] == current["revision"]
        res = s.client.put(f"/api/automations/{made['id']}", json={
            "rule": status_rule(name="Renamed", createdAt="1999-01-01T00:00:00.000Z"),
            "baseRevision": current["revision"]})
        assert res.status_code == 200, res.text
        saved = json.loads(f.read_text(encoding="utf-8"))
        assert saved["name"] == "Renamed" and saved["futureKey"] == {"kept": True}
        assert saved["createdAt"] == "2026-11-02T08:00:00.000Z"
        res = s.client.put(f"/api/automations/{made['id']}", json={
            "rule": status_rule(actions=[]), "baseRevision": res.json()["rule"]["revision"]})
        assert res.status_code == 422
        assert s.client.put("/api/automations/01JNOPE0000000000000000000", json={
            "rule": status_rule(), "baseRevision": ""}).status_code == 404


def test_unreadable_and_newer_files_are_read_only(root, monkeypatch, tmp_path):
    folder = root / ".object" / "automations"
    folder.mkdir(parents=True)
    (folder / "01JBROKEN00000000000000000.json").write_text("{nope", encoding="utf-8")
    (folder / "01JNEWER000000000000000000.json").write_text(json.dumps(
        {**status_rule(), "schemaVersion": 3, "trigger": {"kind": "somethingNew"}}), encoding="utf-8")
    before = {p.name: p.read_bytes() for p in folder.iterdir()}
    with served(root, monkeypatch, tmp_path) as s:
        listed = {r["id"]: r for r in s.client.get("/api/automations").json()}
        assert listed["01JBROKEN00000000000000000"]["enabled"] is False
        assert listed["01JNEWER000000000000000000"]["readOnlyReason"].startswith("This automation was made")
        for rid in listed:
            res = s.client.put(f"/api/automations/{rid}", json={
                "rule": status_rule(), "baseRevision": listed[rid]["revision"]})
            assert res.status_code == 423 and res.json()["reason"] == listed[rid]["readOnlyReason"]
            res = s.client.post(f"/api/automations/{rid}/run", json={"path": REPORT})
            assert res.status_code == 423
        assert s.client.delete("/api/automations/01JBROKEN00000000000000000").status_code == 423
    assert {p.name: p.read_bytes() for p in folder.iterdir()} == before


def test_delete_goes_to_the_trash_and_comes_back(root, monkeypatch, tmp_path):
    with served(root, monkeypatch, tmp_path) as s:
        made = s.create(status_rule())
        s.props(REPORT, {"status": "Done"})
        s.idle()
        assert run_log_path(root, made["id"]).exists()
        res = s.client.delete(f"/api/automations/{made['id']}")
        trash_id = res.json()["trashId"]
        assert not rule_file(root, made["id"]).exists()
        assert s.client.get("/api/automations").json() == []
        items = [i for i in s.client.get("/api/trash").json() if i["kind"] == "automation"]
        assert [(i["id"], i["automationId"], i["title"]) for i in items] == [
            (trash_id, made["id"], "Stamp completion")
        ]
        assert items[0]["originalPath"] == f".object/automations/{made['id']}.json"
        res = s.client.post(f"/api/trash/{trash_id}/restore")
        assert res.status_code == 200 and res.json()["automationIds"] == [made["id"]]
        back = s.client.get(f"/api/automations/{made['id']}").json()
        assert back["name"] == "Stamp completion" and len(s.runs(made["id"])) == 1
        # Restoring onto an id that came back by other means is a 409.
        trash_id = s.client.delete(f"/api/automations/{made['id']}").json()["trashId"]
        rule_file(root, made["id"]).write_text(json.dumps(status_rule()), encoding="utf-8")
        res = s.client.post(f"/api/trash/{trash_id}/restore")
        assert res.status_code == 409 and "another automation" in res.json()["detail"]
        # Purging forgets the run log too.
        rule_file(root, made["id"]).unlink()
        assert s.client.delete(f"/api/trash/{trash_id}").status_code == 200
        assert not run_log_path(root, made["id"]).exists()


def test_the_watcher_names_rule_files_automations(root, monkeypatch, tmp_path):
    with served(root, monkeypatch, tmp_path) as s:
        made = s.create(status_rule())
        watcher = SpaceWatcher(s.space, lambda ev: None)
        rel = f".object/automations/{made['id']}.json"
        assert watcher._refresh_definition(rel) is None  # the app's own write
        f = rule_file(root, made["id"])
        f.write_text(f.read_text(encoding="utf-8").replace("Stamp completion", "Edited"), encoding="utf-8")
        ev = watcher._refresh_definition(rel)
        assert ev is not None and (ev.kind, ev.path) == ("automations", made["id"])
        assert s.client.get(f"/api/automations/{made['id']}").json()["name"] == "Edited"
