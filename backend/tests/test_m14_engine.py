"""M14: triggered runs (the queue and worker), the loop guard, conditions, the nine actions,
409 retries, button runs and the run log."""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest
from m14support import (
    DAILY,
    NEW_TAG,
    OLD_TAG,
    PAY_RENT,
    REPORT,
    STRETCH,
    m14_space,
    served,
    status_rule,
)
from objectapp.automations import CHANGED, MAX_RUNS, NO_TAG, NO_TEMPLATE, run_log_path
from objectapp.frontmatter import parse_fm
from objectapp.objfile import split_object
from objectapp.space import Conflict


@pytest.fixture
def root(tmp_path: Path) -> Path:
    return m14_space(tmp_path)


def fm(s, path: str) -> dict:
    return parse_fm(split_object(s.text(path)).frontmatter_src or "")


def created_rule(actions, scope=None, **over):
    return {
        "name": "On create",
        "trigger": {"kind": "objectCreated", "scope": scope or {"kind": "type", "id": "task"}},
        "actions": actions,
        **over,
    }


def button_rule(actions, scope=None, **over):
    return {"name": "Button", "trigger": {"kind": "button", "scope": scope}, "actions": actions, **over}


# -- property changes and the loop guard ------------------------------------------------------


def test_status_to_done_stamps_the_day_once(root, monkeypatch, tmp_path):
    with served(root, monkeypatch, tmp_path) as s:
        rule = s.create(status_rule())
        s.props(REPORT, {"status": "Next Up"})  # changes, but not to Done
        s.idle()
        assert s.runs(rule["id"]) == []
        before = s.text(REPORT)
        s.props(REPORT, {"status": "Done"})
        s.idle()
        after = fm(s, REPORT)
        assert after["doneOn"] == "2026-11-02"
        runs = s.runs(rule["id"])
        assert len(runs) == 1
        run = runs[0]
        assert run["status"] == "ok" and run["trigger"] == {
            "kind": "propertyChanged", "path": REPORT, "scheduledFor": None, "catchUp": False,
        }  # fmt: skip
        assert run["actions"] == [
            {"index": 0, "kind": "setProperty", "status": "ok", "path": REPORT, "detail": None}
        ]
        # Only the rule's own line (and the stamps) changed.
        old_lines = before.splitlines()
        new_lines = s.text(REPORT).splitlines()
        added = [x for x in new_lines if x not in old_lines]
        # status, the stamp, and what the Task's own completion hook writes; nothing else.
        assert sorted(x.split(":")[0] for x in added) == ["completed", "doneOn", "status"]
        assert "doneOn: 2026-11-02" in added and "status: Done" in added
        assert len(new_lines) == len(old_lines) + 2
        # Done again is no change: nothing runs.
        s.props(REPORT, {"status": "Done"})
        s.idle()
        assert len(s.runs(rule["id"])) == 1
        assert s.client.get(f"/api/automations/{rule['id']}").json()["lastRun"]["id"] == run["id"]


def test_a_rule_matching_its_own_write_runs_once_per_user_write(root, monkeypatch, tmp_path):
    with served(root, monkeypatch, tmp_path) as s:
        rule = s.create({
            "name": "Bounce",
            "trigger": {"kind": "propertyChanged", "scope": {"kind": "type", "id": "task"},
                        "propertyKey": "priority", "to": None},
            "actions": [{"kind": "setProperty", "key": "priority", "value": "Low"}],
        })  # fmt: skip
        s.props(REPORT, {"priority": "High"})
        s.idle()
        time.sleep(0.2)
        s.idle()
        assert len(s.runs(rule["id"])) == 1
        assert fm(s, REPORT)["priority"] == "Low"


def test_two_rules_that_trigger_each_other_run_once_each(root, monkeypatch, tmp_path):
    with served(root, monkeypatch, tmp_path) as s:
        a = s.create({
            "name": "A",
            "trigger": {"kind": "propertyChanged", "scope": {"kind": "type", "id": "task"},
                        "propertyKey": "priority", "to": None},
            "actions": [{"kind": "setProperty", "key": "status", "value": "Next Up"}],
        })  # fmt: skip
        b = s.create({
            "name": "B",
            "trigger": {"kind": "propertyChanged", "scope": {"kind": "type", "id": "task"},
                        "propertyKey": "status", "to": None},
            "actions": [{"kind": "setProperty", "key": "priority", "value": "Medium"}],
        })  # fmt: skip
        s.props(REPORT, {"priority": "High"})  # A runs; its status write starts nothing
        s.idle()
        assert (len(s.runs(a["id"])), len(s.runs(b["id"]))) == (1, 0)
        s.props(REPORT, {"priority": "Low", "status": "On Hold"})  # both fire, once each
        s.idle()
        assert (len(s.runs(a["id"])), len(s.runs(b["id"]))) == (2, 1)
        # A rule's relation syncs and tag creates trigger nothing either.
        c = s.create({
            "name": "C",
            "trigger": {"kind": "propertyChanged", "scope": {"kind": "type", "id": "task"},
                        "propertyKey": "notes", "to": None},
            "actions": [{"kind": "notify", "title": "notes", "body": ""}],
        })  # fmt: skip
        d = s.create(created_rule(
            [{"kind": "createFromTemplate", "typeId": "page", "templateId": "none",
              "title": "Notes for {title}", "relateVia": "related"}],
            scope={"kind": "type", "id": "task"},
        ))  # fmt: skip
        res = s.client.post("/api/objects", json={"typeId": "task", "title": "Plan"})
        assert res.status_code == 201
        task = res.json()["path"]
        s.idle()
        assert len(s.runs(d["id"])) == 1 and s.runs(c["id"]) == []
        notes = fm(s, task).get("notes")
        assert notes == ["[[Notes for Plan]]"]  # the sync wrote the other side


def test_conditions_gate_runs_and_misses_are_not_logged(root, monkeypatch, tmp_path):
    with served(root, monkeypatch, tmp_path) as s:
        rule = s.create(status_rule(conditions={
            "type": "filterGroup", "operator": "and",
            "elements": [{"type": "filter", "propertyId": "priority", "option": "contains",
                          "referenceValue": ["high"]}],
        }))  # fmt: skip
        s.props(REPORT, {"status": "Done"})
        s.idle()
        assert s.runs(rule["id"]) == [] and "doneOn" not in fm(s, REPORT)
        s.props(REPORT, {"status": "In Progress", "priority": "High"})
        s.props(REPORT, {"status": "Done"})
        s.idle()
        assert len(s.runs(rule["id"])) == 1 and fm(s, REPORT)["doneOn"] == "2026-11-02"


def test_disabled_and_read_only_rules_never_run(root, monkeypatch, tmp_path):
    with served(root, monkeypatch, tmp_path) as s:
        off = s.create(status_rule(enabled=False))
        folder = root / ".object" / "automations"
        (folder / "01JZZZZZZZZZZZZZZZZZZZZZZZ.json").write_text(
            json.dumps({**status_rule(), "schemaVersion": 2}), encoding="utf-8"
        )
        (folder / "01JZZZZZZZZZZZZZZZZZZZZZZY.json").write_text("{nope", encoding="utf-8")
        listed = {r["id"]: r for r in s.client.get("/api/automations").json()}
        assert listed["01JZZZZZZZZZZZZZZZZZZZZZZZ"]["readOnlyReason"] == (
            "This automation was made by a newer version of Object."
        )
        assert listed["01JZZZZZZZZZZZZZZZZZZZZZZY"]["readOnlyReason"] == "This automation can't be read."
        s.props(REPORT, {"status": "Done"})
        s.idle()
        assert "doneOn" not in fm(s, REPORT)
        assert s.runs(off["id"]) == []
        assert not run_log_path(root, "01JZZZZZZZZZZZZZZZZZZZZZZZ").exists()


# -- creation, tags, daily notes, collections -----------------------------------------------


def test_a_creation_rule_tags_and_appends_to_the_daily_note(root, monkeypatch, tmp_path):
    with served(root, monkeypatch, tmp_path) as s:
        rule = s.create(created_rule([
            {"kind": "addTag", "tagId": NEW_TAG},
            {"kind": "appendToDailyNote", "text": "- Created {link} on {date:YYYY-MM-DD}"},
        ]))  # fmt: skip
        res = s.client.post("/api/objects", json={"typeId": "task", "title": "Buy milk"})
        task = res.json()["path"]
        s.idle()
        assert fm(s, task)["tags"] == ["New tag"]
        note = "DailyNotes/2026-11-02.md"
        assert s.text(note).endswith("- Created [[Buy milk]] on 2026-11-02\n")
        run = s.runs(rule["id"])[0]
        assert [a["path"] for a in run["actions"]] == [task, note]
        # A second create appends one more line: no blank line between.
        s.client.post("/api/objects", json={"typeId": "task", "title": "Buy bread"})
        s.idle()
        body = split_object(s.text(note)).body
        assert body.endswith("on 2026-11-02\n- Created [[Buy bread]] on 2026-11-02\n")
        assert "\n\n- Created [[Buy bread]]" not in body


def test_appending_keeps_crlf_and_adds_a_line_break_first(root, monkeypatch, tmp_path):
    p = root / DAILY
    p.write_bytes(p.read_bytes().replace(b"\n", b"\r\n").rstrip(b"\r\n") + b"\r\nLast line")
    with served(root, monkeypatch, tmp_path, now=__import__("datetime").datetime(
            2026, 10, 27, 12, 0, tzinfo=__import__("datetime").UTC)) as s:  # fmt: skip
        s.create(created_rule([{"kind": "appendToDailyNote", "text": "one\ntwo"}]))
        s.client.post("/api/objects", json={"typeId": "task", "title": "X"})
        s.idle()
        data = p.read_bytes()
        assert data.endswith(b"\r\nLast line\r\none\r\ntwo\r\n")
        assert b"\n" not in data.replace(b"\r\n", b"")


def test_tag_and_collection_actions(root, monkeypatch, tmp_path):
    with served(root, monkeypatch, tmp_path) as s:
        rule = s.create(button_rule([
            {"kind": "addTag", "tagId": NEW_TAG},
            {"kind": "addTag", "tagId": NEW_TAG},  # a no-op is ok
            {"kind": "removeTag", "tagId": OLD_TAG},
            {"kind": "addTag", "tagId": "01JNOSUCHTAG0000000000000X"},
            {"kind": "addToCollection", "collectionId": "reading-list"},
        ]))  # fmt: skip
        page = s.client.post("/api/objects", json={"typeId": "page", "title": "P"}).json()["path"]
        s.props(page, {"tags": ["Old tag", "Other"]})
        run = s.client.post(f"/api/automations/{rule['id']}/run", json={"path": page}).json()
        assert [a["status"] for a in run["actions"]] == ["ok", "ok", "ok", "failed", "ok"]
        assert run["actions"][3]["detail"] == NO_TAG and run["status"] == "failed"
        after = fm(s, page)
        assert after["tags"] == ["Other", "New tag"] and after["collections"] == ["Reading list"]
        # A Task can't join a page-only collection: that action fails, the rest go through.
        run = s.client.post(f"/api/automations/{rule['id']}/run", json={"path": REPORT}).json()
        assert run["actions"][4]["status"] == "failed"
        assert fm(s, REPORT)["tags"] == ["New tag"]


def test_a_collection_scope_fires_on_create_and_when_added(root, monkeypatch, tmp_path):
    with served(root, monkeypatch, tmp_path) as s:
        rule = s.create(created_rule(
            [{"kind": "notify", "title": "", "body": "{title} joined"}],
            scope={"kind": "collection", "id": "reading-list"},
        ))  # fmt: skip
        page = s.client.post("/api/objects", json={"typeId": "page", "title": "Essay"}).json()["path"]
        s.idle()
        assert s.runs(rule["id"]) == []
        s.props(page, {"collections": ["Reading list"]})
        s.props(page, {"description": "still in it"})
        s.idle()
        assert len(s.runs(rule["id"])) == 1
        assert s.notifications() == [{"title": "On create", "body": "Essay joined"}]
        s.client.post("/api/objects", json={
            "typeId": "page", "title": "Book", "values": {"collections": ["Reading list"]}})
        s.idle()
        assert len(s.runs(rule["id"])) == 2


def test_notifications_obey_the_switch(root, monkeypatch, tmp_path):
    (root / ".object" / "ui.json").write_text(json.dumps({"reminders": {"enabled": False}}), encoding="utf-8")
    with served(root, monkeypatch, tmp_path) as s:
        rule = s.create(button_rule([{"kind": "notify", "title": "Hi", "body": "{title}"}]))
        run = s.client.post(f"/api/automations/{rule['id']}/run", json={"path": REPORT}).json()
        assert run["actions"][0]["status"] == "skipped" and s.notifications() == []


# -- create from template -------------------------------------------------------------------


def test_create_from_template_relates_back_and_fails_plainly(root, monkeypatch, tmp_path):
    with served(root, monkeypatch, tmp_path) as s:
        tmpl = s.client.post("/api/types/page/templates", json={"name": "Meeting notes"})
        assert tmpl.status_code == 201, tmpl.text
        tpath = tmpl.json()["path"]
        tid = fm(s, tpath)["id"]
        rule = s.create(button_rule([{
            "kind": "createFromTemplate", "typeId": "page", "templateId": tid,
            "title": "Notes {date:YYYY-MM-DD} for {title}", "relateVia": "related",
        }]))  # fmt: skip
        run = s.client.post(f"/api/automations/{rule['id']}/run", json={"path": REPORT}).json()
        assert run["status"] == "ok"
        made = run["actions"][0]["path"]
        assert fm(s, made)["title"] == "Notes 2026-11-02 for Submit report"
        assert fm(s, made)["related"] == ["[[Submit report]]"]
        assert fm(s, REPORT)["notes"] == ["[[Notes 2026-11-02 for Submit report]]"]
        # The template goes: the action fails with a plain message; the rule is untouched.
        version = s.client.get("/api/object", params={"path": tpath}).json()["version"]
        s.client.delete("/api/object", params={"path": tpath, "baseVersion": version})
        run = s.client.post(f"/api/automations/{rule['id']}/run", json={"path": REPORT}).json()
        assert run["status"] == "failed" and run["actions"][0]["detail"] == NO_TEMPLATE
        assert s.client.get(f"/api/automations/{rule['id']}").json()["enabled"] is True


# -- conflicts --------------------------------------------------------------------------------


def test_a_conflict_retries_once_then_fails(root, monkeypatch, tmp_path):
    with served(root, monkeypatch, tmp_path) as s:
        rule = s.create(button_rule([{"kind": "setProperty", "key": "priority", "value": "High"}]))
        real = s.space.update_properties
        calls = {"n": 0}

        def flaky(path, updates, base_version, remove=()):
            calls["n"] += 1
            if calls["n"] <= limit:
                raise Conflict("elsewhere")
            return real(path, updates, base_version, remove)

        limit = 1
        monkeypatch.setattr(s.space, "update_properties", flaky)
        run = s.client.post(f"/api/automations/{rule['id']}/run", json={"path": REPORT}).json()
        assert run["status"] == "ok" and calls["n"] == 2
        limit, calls["n"] = 2, 0
        run = s.client.post(f"/api/automations/{rule['id']}/run", json={"path": REPORT}).json()
        assert run["status"] == "failed" and run["actions"][0]["detail"] == CHANGED


def test_a_retry_follows_a_rename_by_the_objects_id(root, monkeypatch, tmp_path):
    # Review M14 #3 (backstop): a rename between the run's read and its write moves the file;
    # the retry finds the object by its id instead of failing with "no longer exists".
    with served(root, monkeypatch, tmp_path) as s:
        rule = s.create(button_rule([{"kind": "setProperty", "key": "priority", "value": "High"}]))
        real = s.space.update_properties
        calls = {"n": 0}

        def renamed_meanwhile(path, updates, base_version, remove=()):
            calls["n"] += 1
            if calls["n"] == 1:
                v = s.space.read(path)[2]
                s.space.rename_object(path, "Report moved", v)
            return real(path, updates, base_version, remove)

        monkeypatch.setattr(s.space, "update_properties", renamed_meanwhile)
        run = s.client.post(f"/api/automations/{rule['id']}/run", json={"path": REPORT}).json()
        assert calls["n"] == 2
        assert run["status"] == "ok" and run["actions"][0]["path"] == "Tasks/Report moved.md"
        assert fm(s, "Tasks/Report moved.md")["priority"] == "High"


# -- buttons ------------------------------------------------------------------------------------


def test_button_refusals(root, monkeypatch, tmp_path):
    with served(root, monkeypatch, tmp_path) as s:
        auto = s.create(status_rule())
        task_only = s.create(button_rule([{"kind": "notify", "title": "t", "body": ""}],
                                         scope={"kind": "type", "id": "task"}))  # fmt: skip
        off = s.create(button_rule([{"kind": "notify", "title": "t", "body": ""}], enabled=False))
        tmpl = s.client.post("/api/types/task/templates", json={"name": "T"}).json()["path"]
        post = lambda rid, path: s.client.post(f"/api/automations/{rid}/run", json={"path": path})
        assert post(auto["id"], REPORT).status_code == 422
        assert post(off["id"], REPORT).json()["detail"] == "This automation is turned off."
        assert post(task_only["id"], "Pages/Day links.md").status_code == 422
        assert post(task_only["id"], tmpl).status_code == 422
        assert post(task_only["id"], "Tasks/Nope.md").status_code == 404
        assert post("01JNOPE0000000000000000000", REPORT).status_code == 404
        assert post(task_only["id"], REPORT).status_code == 200


def test_a_press_that_misses_the_conditions_is_logged_skipped(root, monkeypatch, tmp_path):
    with served(root, monkeypatch, tmp_path) as s:
        rule = s.create(button_rule(
            [{"kind": "setProperty", "key": "priority", "value": "High"}],
            conditions={"type": "filterGroup", "operator": "and", "elements": [
                {"type": "filter", "propertyId": "status", "option": "contains", "referenceValue": ["done"]}]},
        ))  # fmt: skip
        before = s.text(REPORT)
        run = s.client.post(f"/api/automations/{rule['id']}/run", json={"path": REPORT}).json()
        assert run["status"] == "skipped" and s.text(REPORT) == before
        assert s.runs(rule["id"])[0]["id"] == run["id"]


# -- the run log ------------------------------------------------------------------------------


def test_the_log_keeps_the_newest_200_and_limit_reads_fewer(root, monkeypatch, tmp_path):
    with served(root, monkeypatch, tmp_path) as s:
        rule = s.create(button_rule([{"kind": "notify", "title": "t", "body": ""}]))
        lr = s.engine.rules.get(rule["id"])
        for _ in range(MAX_RUNS + 5):
            s.engine._log(s.engine._new_run(lr, "button", REPORT, None, False))
        s.engine.flush_logs()
        runs = s.runs(rule["id"])
        assert len(runs) == MAX_RUNS
        assert s.client.get(f"/api/automations/{rule['id']}/runs?limit=3").json()["runs"] == runs[:3]
        assert s.client.get(f"/api/automations/{rule['id']}/runs?limit=0").status_code == 422
        assert s.client.get(f"/api/automations/{rule['id']}/runs?limit=201").status_code == 422
        assert s.client.get("/api/automations/01JNOPE0000000000000000000/runs").status_code == 404
        assert not (root / ".object" / "automation-logs").exists()  # never in the space


def test_a_users_save_is_not_slowed_by_rules(root, monkeypatch, tmp_path):
    with served(root, monkeypatch, tmp_path) as s:
        s.create(status_rule())
        gate = __import__("threading").Event()
        real = s.engine._handle

        def slow(notice):
            gate.wait(5)
            real(notice)

        monkeypatch.setattr(s.engine, "_handle", slow)
        t0 = time.monotonic()
        s.props(REPORT, {"status": "Done"})
        assert time.monotonic() - t0 < 2  # answered while the rule waits on the worker
        assert "doneOn" not in fm(s, REPORT)
        gate.set()
        s.idle()
        assert fm(s, REPORT)["doneOn"] == "2026-11-02"


def test_external_edits_trigger_nothing(root, monkeypatch, tmp_path):
    with served(root, monkeypatch, tmp_path, watch=True) as s:
        rule = s.create(status_rule())
        created = s.create(created_rule([{"kind": "notify", "title": "new", "body": ""}]))
        p = root / REPORT
        p.write_bytes(p.read_bytes().replace(b"status: In Progress", b"status: Done"))
        (root / "Tasks" / "From git.md").write_text("---\ntype: Task\ntitle: From git\n---\n", encoding="utf-8")
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if s.space.get(REPORT) and "Tasks/From git.md" in {x.path for x in s.space.list()}:
                with s.space._lock:
                    if s.space._raw[REPORT].fm.get("status") == "Done":
                        break
            time.sleep(0.05)
        time.sleep(0.3)
        s.idle()
        assert s.runs(rule["id"]) == [] and s.runs(created["id"]) == []
        assert "doneOn" not in fm(s, REPORT) and s.notifications() == []


def test_a_stale_object_path_follows_a_rename(root, monkeypatch, tmp_path):
    with served(root, monkeypatch, tmp_path) as s:
        rule = s.create({
            "name": "On title",
            "trigger": {"kind": "propertyChanged", "scope": {"kind": "type", "id": "task"},
                        "propertyKey": "title", "to": None},
            "actions": [{"kind": "setProperty", "key": "priority", "value": "High"}],
        })  # fmt: skip
        version = s.client.get("/api/object", params={"path": REPORT}).json()["version"]
        res = s.client.post("/api/object/rename", json={
            "path": REPORT, "title": "Report", "baseVersion": version})
        assert res.status_code == 200, res.text
        s.idle()
        run = s.runs(rule["id"])[0]
        assert run["status"] == "ok" and fm(s, "Tasks/Report.md")["priority"] == "High"



@pytest.mark.parametrize("path", [PAY_RENT, STRETCH])
def test_completing_a_repeating_task_fires_changes_to_done(root, monkeypatch, tmp_path, path):
    # Review M14 #4: completing a repeating Task resets its status and moves its date in the
    # same write; "Status changes to Done" and "Status changes" still fire, once.
    with served(root, monkeypatch, tmp_path) as s:
        to_done = s.create(status_rule())
        any_change = s.create(status_rule(
            name="Any status change",
            trigger={"kind": "propertyChanged", "scope": {"kind": "type", "id": "task"},
                     "propertyKey": "status", "to": None},
            actions=[{"kind": "notify", "title": "", "body": "{title}"}],
        ))  # fmt: skip
        res = s.props(path, {"status": "Done"})
        assert res["task"]["advanced"] is True
        s.idle()
        assert fm(s, path)["status"] == "Not Started"
        assert [r["status"] for r in s.runs(to_done["id"])] == ["ok"]
        assert [r["status"] for r in s.runs(any_change["id"])] == ["ok"]
        assert fm(s, path)["doneOn"] == "2026-11-02"
        # A later edit of another key fires neither.
        s.props(path, {"priority": "High"})
        s.idle()
        assert len(s.runs(to_done["id"])) == 1 and len(s.runs(any_change["id"])) == 1


def test_a_new_object_gets_its_text_in_the_creating_write(root, monkeypatch, tmp_path):
    # Review M14 #2: "Move to new page" and "Create page from paste" create the page with its
    # text in one write, so a creation rule's write can't make a later body save a 409.
    with served(root, monkeypatch, tmp_path) as s:
        rule = s.create(created_rule([{"kind": "addTag", "tagId": NEW_TAG}], scope={"kind": "type", "id": "page"}))
        for i in range(5):
            res = s.client.post("/api/objects", json={
                "typeId": "page", "templateId": "none", "body": f"moved text {i}\r\n"})  # fmt: skip
            assert res.status_code == 201, res.text
            path = res.json()["path"]
            s.idle()
            assert split_object(s.text(path)).body == f"moved text {i}\n"
            assert fm(s, path)["tags"] == ["New tag"]
        assert len(s.runs(rule["id"])) == 5
        # appendBody goes below the body the object would get: none here (M32: a titled
        # object's body no longer opens with "# Parent"), so it is the whole body.
        res = s.client.post("/api/objects", json={
            "typeId": "page", "title": "Parent", "templateId": "none", "appendBody": "- child"})  # fmt: skip
        assert split_object(s.text(res.json()["path"])).body == "- child\n"
        res = s.client.post("/api/objects", json={"typeId": "page", "templateId": "none", "appendBody": "x"})
        assert split_object(s.text(res.json()["path"])).body == "x\n"


def test_quitting_drops_queued_runs_and_waits_only_so_long(root, monkeypatch, tmp_path):
    # Review M14 #8a: on quit the run in progress finishes, the queued ones are dropped, and the
    # wait for the worker is bounded.
    import threading

    with served(root, monkeypatch, tmp_path) as s:
        s.create(status_rule())
        started, gate = threading.Event(), threading.Event()
        handled: list[str] = []
        real = s.engine._handle

        def slow(notice):
            handled.append(notice.after.get("priority"))
            started.set()
            gate.wait(10)
            real(notice)

        monkeypatch.setattr(s.engine, "_handle", slow)
        for p in ("Low", "Medium", "High"):
            s.props(REPORT, {"priority": p})
        assert started.wait(5)
        s.engine.stop_wait = 0.3
        t0 = time.monotonic()
        s.engine.stop()
        assert time.monotonic() - t0 < 3  # bounded, though the run in progress still waits
        gate.set()
        time.sleep(0.3)
        assert handled == ["Low"]  # the two queued runs never started
        assert s.engine._busy == 0


def test_this_week_in_a_sunday_start_space_is_the_views_week(root, monkeypatch, tmp_path):
    # Weeks follow the "Start of the week" setting everywhere (2026-11-08): on a Sunday-start
    # space, seen from Sunday 8 Nov, "this week" is 8-14 Nov, as the calendar and views show it.
    from datetime import UTC, datetime

    (root / ".object" / "ui.json").write_text(json.dumps({"calendar": {"weekStart": "sunday"}}), encoding="utf-8")
    sunday = datetime(2026, 11, 8, 12, 0, tzinfo=UTC)
    with served(root, monkeypatch, tmp_path, now=sunday) as s:
        s.props(REPORT, {"date": {"start": "2026-11-04", "resolution": "day"}})  # Wednesday: last week
        rule = s.create(button_rule(
            [{"kind": "setProperty", "key": "priority", "value": "High"}],
            conditions={"type": "filterGroup", "operator": "and", "elements": [
                {"type": "filter", "propertyId": "date", "option": "is",
                 "referenceValue": {"relative": "thisWeek"}}]},
        ))  # fmt: skip
        run = s.client.post(f"/api/automations/{rule['id']}/run", json={"path": REPORT}).json()
        assert run["status"] != "ok", run
        assert fm(s, REPORT).get("priority") != "High"
        s.props(REPORT, {"date": {"start": "2026-11-10", "resolution": "day"}})  # Tuesday: this week
        run = s.client.post(f"/api/automations/{rule['id']}/run", json={"path": REPORT}).json()
        assert run["status"] == "ok", run
        assert fm(s, REPORT)["priority"] == "High"
