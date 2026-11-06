"""M21 Task 3: agent schedules run as headless chats of their agent (`schedulerun`), saved as AI
Chat objects, announced with a notification, and owed to the catch-up when the space closes.

The space is a copy of the synthetic ``space-m8`` (`m14support.m14_space`), in UTC, on a settable
clock starting Monday 2026-11-09 08:59 UTC. ``OBJECT_STATE_DIR`` is a temp folder (conftest); the
fake ``claude`` stands in for the CLI and the fake notifier for the OS one.
"""

from __future__ import annotations

import contextlib
import json
import os
import time
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fake_claude import install
from fastapi.testclient import TestClient
from m14support import Clock, m14_space

from objectapp import agentrun, aichat, schedulerun, transcripts
from objectapp import settings as device_settings
from objectapp.agentmodel import SESSIONS_DIR, AgentInput
from objectapp.agents import AgentRegistry
from objectapp.agentschedules import INDEX_FILE, ScheduleIndex
from objectapp.appstate import state_dir
from objectapp.automations import TURNED_OFF
from objectapp.reviews import ReviewRunner
from objectapp.schedulerun import AgentJob
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.tokens import TokenStore

START = datetime(2026, 11, 9, 8, 59, tzinfo=UTC)  # a Monday
DUE = datetime(2026, 11, 9, 9, 0, 30, tzinfo=UTC)
OCCURRENCE = "2026-11-09T09:00:00.000Z"


def _set(**patch: Any) -> None:
    _data, revision = device_settings.read()
    device_settings.patch(patch, revision)


@pytest.fixture
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    root = m14_space(tmp_path)
    claude = install(tmp_path / "bin")
    log = tmp_path / "claude-log.jsonl"
    notified = tmp_path / "notified.jsonl"
    monkeypatch.setenv("FAKE_CLAUDE_LOG", str(log))
    monkeypatch.setenv("OBJECT_FAKE_NOTIFY_FILE", str(notified))
    _set(claudePath=str(claude))
    researcher = AgentRegistry().create(AgentInput(name="Researcher"), "Dig.\n")
    return {"root": root, "claude": claude, "log": log, "go": Path(str(log) + ".go"), "notified": notified,
            "researcher": researcher, "clock": Clock(START)}


@contextlib.contextmanager
def opened(env: dict[str, Any]) -> Iterator[TestClient]:
    space = Space(env["root"])
    space.clock = env["clock"]
    space.tz = UTC
    app = create_app(space, watch=False)
    app.state.automations.scheduler.interval = 3600  # the tests tick it themselves
    with TestClient(app) as client:
        client.get("/api/space")  # a request the idle clock sees: the app learns its base URL
        yield client


def schedule(agent_id: str, prompt: str = "Review {date:YYYY-MM-DD}", **over: Any) -> dict[str, Any]:
    rule: dict[str, Any] = {
        "name": "Weekly review",
        "trigger": {"kind": "schedule", "repeat": "every week on monday", "time": "09:00", "start": "2026-11-09"},
        "actions": [{"kind": "runAgent", "agentId": agent_id, "prompt": prompt, "model": None}],
    }
    rule.update(over)
    return rule


def create(client: TestClient, rule: dict[str, Any]) -> dict[str, Any]:
    res = client.post("/api/automations", json={"rule": rule})
    assert res.status_code == 201, res.text
    return res.json()


def tick(client: TestClient) -> dict[str, Any]:
    res = client.post("/api/_test/tick")
    assert res.status_code == 200, res.text
    return res.json()


def idle(client: TestClient) -> None:
    assert client.post("/api/_test/agent-schedules/idle").json() == {"idle": True}


def runs_of(client: TestClient, rule_id: str) -> list[dict[str, Any]]:
    res = client.get(f"/api/automations/{rule_id}/runs")
    assert res.status_code == 200, res.text
    return res.json()["runs"]


def fake_runs(log: Path) -> list[dict[str, Any]]:
    if not log.exists():
        return []
    return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines() if line]


def wait_runs(log: Path, count: int, timeout: float = 30) -> list[dict[str, Any]]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        found = fake_runs(log)
        if len(found) >= count:
            return found
        time.sleep(0.05)
    raise AssertionError(f"expected {count} runs, saw {len(fake_runs(log))}")


def notifications(env: dict[str, Any]) -> list[dict[str, str]]:
    p: Path = env["notified"]
    return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines()] if p.exists() else []


def chats(folder: Path) -> list[list[dict[str, Any]]]:
    sessions = Path(folder) / SESSIONS_DIR
    if not sessions.is_dir():
        return []
    return [transcripts.raw_lines(folder, p.stem) for p in sorted(sessions.glob("*.jsonl"))]


def chat_objects(root: Path) -> dict[str, str]:
    """Every AI Chat object's path -> its text."""
    out = {}
    for p in root.rglob("*.md"):
        text = p.read_text(encoding="utf-8")
        if "type: AI Chat" in text or "type: 'AI Chat'" in text or 'type: "AI Chat"' in text:
            out[p.relative_to(root).as_posix()] = text
    return out


def _alive(pid: int) -> bool:
    if os.name == "nt":  # pragma: no cover - Windows
        import subprocess

        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}"], capture_output=True, text=True, check=False)
        return str(pid) in out.stdout
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def _gone(pid: int, within: float) -> bool:
    deadline = time.monotonic() + within
    while time.monotonic() < deadline:
        if not _alive(pid):
            return True
        time.sleep(0.1)
    return not _alive(pid)


# -- a due occurrence ----------------------------------------------------------------------------


def test_due_occurrence_runs_as_a_chat(env) -> None:
    researcher = env["researcher"]
    with opened(env) as client:
        rule = create(client, schedule(researcher.id))
        env["clock"].now = DUE
        assert tick(client)["automationRuns"] == []
        idle(client)
        runs = runs_of(client, rule["id"])
    found = fake_runs(env["log"])
    assert len(found) == 1
    run = found[0]
    assert Path(run["cwd"]).resolve() == Path(researcher.folder).resolve()
    assert "Review 2026-11-09" in run["prompt"]
    assert schedulerun.SCHEDULE_GUIDANCE in run["appendPrompt"]

    [lines] = chats(researcher.folder)
    header = lines[0]
    assert header["schedule"] == {"ruleId": rule["id"], "name": "Weekly review", "scheduledFor": OCCURRENCE,
                                  "catchUp": False}
    kinds = [line["type"] for line in lines[1:]]
    assert "user" in kinds and "assistant" in kinds and kinds[-1] == "object"
    reply = next(line["text"] for line in lines if line["type"] == "assistant")
    listed = transcripts.list_chats(researcher.folder)
    assert listed[0]["schedule"]["ruleId"] == rule["id"]

    objects = chat_objects(env["root"])
    assert len(objects) == 1
    [(path, text)] = objects.items()
    assert "Weekly review 2026-11-09" in path
    assert "agent: Researcher" in text
    assert reply.strip() and reply.strip().splitlines()[0] in text
    assert lines[-1]["path"] == path

    assert len(runs) == 1 and runs[0]["status"] == "ok"
    assert runs[0]["trigger"]["scheduledFor"] == OCCURRENCE
    assert runs[0]["actions"] == [{"index": 0, "kind": "runAgent", "status": "ok", "path": path,
                                   "detail": "Saved the chat."}]
    assert notifications(env) == [{"title": "Weekly review", "body": " ".join(reply.split())[:200]}]


def test_run_uses_write_tools_and_agent_token(env, monkeypatch) -> None:
    made: list[dict[str, Any]] = []
    real = TokenStore.ephemeral

    def spy(self, name, scope="read", **kw):
        record, secret = real(self, name, scope, **kw)
        made.append({"name": name, "scope": scope, "secret": secret, **kw})
        return record, secret

    monkeypatch.setattr(TokenStore, "ephemeral", spy)
    researcher = env["researcher"]
    with opened(env) as client:
        create(client, schedule(researcher.id))
        env["clock"].now = DUE
        tick(client)
        idle(client)
    [run] = fake_runs(env["log"])
    assert "mcp__object__write_body" in run["allowed"]
    assert "--read-only" not in run["mcpConfig"]["mcpServers"]["object"]["args"]
    mine = [m for m in made if m["secret"] == run["token"]]
    assert len(mine) == 1
    assert mine[0]["scope"] == "read-write"
    assert mine[0]["agent"] == researcher.id
    assert mine[0]["name"] == "Researcher"
    assert run["url"] == "http://testserver"


def test_schedule_run_skips_reviews(env, monkeypatch) -> None:
    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(ReviewRunner, "after_turn", lambda self, **kw: calls.append(kw))
    scopes: list[agentrun.RunScope] = []
    real_build = agentrun.build_run

    def build_spy(scope, **kw):
        scopes.append(scope)
        return real_build(scope, **kw)

    monkeypatch.setattr(agentrun, "build_run", build_spy)
    made: list[dict[str, Any]] = []
    real = TokenStore.ephemeral

    def spy(self, name, scope="read", **kw):
        made.append({"name": name, "scope": scope, **kw})
        return real(self, name, scope, **kw)

    monkeypatch.setattr(TokenStore, "ephemeral", spy)
    reg = AgentRegistry()
    researcher = env["researcher"]
    reg.save(researcher.id, AgentInput(name="Researcher", learning={"memoryReviewEvery": 1, "skillReviewEvery": 1}),
             reg.get(researcher.id).revision)
    with opened(env) as client:
        rule = create(client, schedule(researcher.id, prompt="FAKE:tool\nFAKE:tool\nFAKE:tool\nReview"))
        env["clock"].now = DUE
        tick(client)
        idle(client)
        assert calls == []
        assert scopes and all(s.purpose == "schedule" for s in scopes)
        assert [m["purpose"] for m in made] == ["schedule"]
        [lines] = chats(researcher.folder)
        assert not any(line["type"] == "review" for line in lines)

        # The hook is read at call time.
        monkeypatch.setattr(schedulerun, "PURPOSE_FOR",
                            lambda space, rule_id: "other" if rule_id == rule["id"] else "schedule")
        scopes.clear()
        made.clear()
        env["clock"].now = DUE + timedelta(days=7, minutes=-2)
        tick(client)  # a gap of a week owes instead of running: tick just before the next one
        client.post("/api/automations/catch-up", json={"ruleId": rule["id"], "choice": "skip"})
        env["clock"].now = DUE + timedelta(days=7)
        tick(client)
        idle(client)
        assert scopes and all(s.purpose == "other" for s in scopes)
        assert [m["purpose"] for m in made] == ["other"]
        assert calls == []

        # A normal chat turn with the same settings does reach the review hook.
        res = client.post("/api/ai/chat", json={"mode": "chat", "prompt": "Hi", "agentId": researcher.id})
        assert res.status_code == 200
        assert len(calls) == 1 and calls[0]["purpose"] == "chat"


@pytest.mark.parametrize("case", ["fail", "hidden", "noclaude", "unlisted"])
def test_failures_are_logged_and_notified(env, case) -> None:
    researcher = env["researcher"]
    prompt = "FAKE:fail Review" if case == "fail" else "Review"
    with opened(env) as client:
        rule = create(client, schedule(researcher.id, prompt=prompt))
        if case == "hidden":
            _set(aiHidden=True)
        elif case == "noclaude":
            _set(claudePath=str(env["root"] / "no-such-claude.cmd"))
        elif case == "unlisted":
            AgentRegistry().unregister(researcher.id)
        env["clock"].now = DUE
        tick(client)
        idle(client)
        runs = runs_of(client, rule["id"])
    from objectapp import ai

    expected = {"hidden": schedulerun.HIDDEN, "noclaude": ai.NOT_FOUND,
                "unlisted": "That agent isn't listed any more."}.get(case)
    assert len(runs) == 1 and runs[0]["status"] == "failed"
    detail = runs[0]["actions"][0]["detail"]
    if expected is not None:
        assert detail == expected
    else:
        assert detail
    [note] = notifications(env)
    assert note["title"] == "Weekly review" and note["body"].startswith("Failed: ")
    assert chat_objects(env["root"]) == {}
    if case == "fail":
        [lines] = chats(researcher.folder)
        assert lines[-1]["type"] == "error"
    else:
        assert fake_runs(env["log"]) == []
        assert chats(researcher.folder) == []


def test_unexpected_error_is_logged_and_notified(env, monkeypatch) -> None:
    """A run that raises something other than a refusal (here the transcript can't be written) is
    logged failed with its message and notified, never lost unseen."""
    def broken(*_a: Any, **_k: Any) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(transcripts, "start", broken)
    with opened(env) as client:
        rule = create(client, schedule(env["researcher"].id))
        env["clock"].now = DUE
        tick(client)
        idle(client)
        runs = runs_of(client, rule["id"])
    assert [r["status"] for r in runs] == ["failed"]
    assert runs[0]["actions"][0]["detail"] == "disk full"
    [note] = notifications(env)
    assert note["body"] == "Failed: disk full"
    assert chat_objects(env["root"]) == {}


def test_job_that_raises_is_still_logged(env, monkeypatch) -> None:
    """The backstop: should the whole job raise, the worker logs a failed run for it."""
    def boom(*_a: Any, **_k: Any) -> Any:
        raise RuntimeError("broken run")

    monkeypatch.setattr(schedulerun, "run_schedule", boom)
    with opened(env) as client:
        rule = create(client, schedule(env["researcher"].id))
        env["clock"].now = DUE
        tick(client)
        idle(client)
        runs = runs_of(client, rule["id"])
    assert [r["status"] for r in runs] == ["failed"]
    assert runs[0]["actions"][0] == {"index": 0, "kind": "runAgent", "status": "failed", "path": None,
                                     "detail": "broken run"}


def test_notifications_off(env) -> None:
    ui = env["root"] / ".object" / "ui.json"
    data = json.loads(ui.read_text(encoding="utf-8")) if ui.exists() else {}
    data["reminders"] = {"enabled": False}
    ui.write_text(json.dumps(data), encoding="utf-8")
    with opened(env) as client:
        rule = create(client, schedule(env["researcher"].id))
        env["clock"].now = DUE
        tick(client)
        idle(client)
        runs = runs_of(client, rule["id"])
    assert runs[0]["status"] == "ok"
    assert notifications(env) == []


# -- catch-up and closing ------------------------------------------------------------------------


def test_catch_up_runs_each_once_with_its_date(env) -> None:
    researcher = env["researcher"]
    with opened(env) as client:
        rule = create(client, schedule(researcher.id))
        env["clock"].now = DUE
        tick(client)
        idle(client)
    env["clock"].now = datetime(2026, 11, 30, 10, 0, tzinfo=UTC)
    with opened(env) as client:
        items = client.get("/api/automations/catch-up").json()["items"]
        assert [(i["ruleId"], i["count"]) for i in items] == [(rule["id"], 3)]
        started = time.monotonic()
        res = client.post("/api/automations/catch-up", json={"ruleId": rule["id"], "choice": "all"})
        assert time.monotonic() - started < 2
        assert res.json() == {"runs": [], "queued": 3}
        idle(client)
        assert client.get("/api/automations/catch-up").json()["items"] == []
        res = client.post("/api/automations/catch-up", json={"ruleId": rule["id"], "choice": "all"})
        assert res.status_code == 404
    titles = sorted(p for p in chat_objects(env["root"]))
    for day in ("2026-11-16", "2026-11-23", "2026-11-30"):
        assert sum(day in p for p in titles) == 1, titles
    later = [lines for lines in chats(researcher.folder) if lines[0]["schedule"]["catchUp"]]
    assert len(later) == 3
    assert len(fake_runs(env["log"])) == 4


def test_jobs_never_block_tick_or_answer(env) -> None:
    with opened(env) as client:
        agent_rule = create(client, schedule(env["researcher"].id, prompt="FAKE:wait Review"))
        notify_rule = create(client, schedule(env["researcher"].id, name="Ping", actions=[
            {"kind": "notify", "title": "Ping", "body": "Hello"}]))
        env["clock"].now = DUE
        started = time.monotonic()
        answer = tick(client)
        assert time.monotonic() - started < 2
        assert [r["ruleId"] for r in answer["automationRuns"]] == [notify_rule["id"]]
        assert answer["agentJobs"] == 1
        wait_runs(env["log"], 1)
        assert runs_of(client, notify_rule["id"])[0]["status"] == "ok"
        assert runs_of(client, agent_rule["id"]) == []  # still waiting
        env["go"].write_text("go", encoding="utf-8")
        idle(client)
        assert runs_of(client, agent_rule["id"])[0]["status"] == "ok"


def test_stop_reowes_queued_and_running(env) -> None:
    researcher = env["researcher"]
    with opened(env) as client:
        first = create(client, schedule(researcher.id, prompt="FAKE:wait Review", name="A first"))
        second = create(client, schedule(researcher.id, name="B second"))
        env["clock"].now = DUE
        answer = tick(client)
        assert answer["agentJobs"] == 2
        [run] = wait_runs(env["log"], 1)
    # The app stopped (lifespan exit) while the first waited.
    assert _gone(run["pid"], 10)
    with opened(env) as client:
        assert client.post("/api/_test/agent-schedules/idle").json() == {"idle": True}
        first_runs = runs_of(client, first["id"])
        assert [r["status"] for r in first_runs] == ["failed"]
        assert first_runs[0]["actions"][0]["detail"] == schedulerun.STOPPED
        assert runs_of(client, second["id"]) == []
        items = {i["ruleId"]: i["count"] for i in client.get("/api/automations/catch-up").json()["items"]}
        assert items == {first["id"]: 1, second["id"]: 1}
    assert len(fake_runs(env["log"])) == 1  # nothing ran on start


def test_rescheduled_rule_owes_nothing_on_stop(env) -> None:
    """An occurrence queued under the old trigger isn't owed back once the rule was rescheduled."""
    researcher = env["researcher"]
    with opened(env) as client:
        first = create(client, schedule(researcher.id, prompt="FAKE:wait Review", name="A first"))
        second = create(client, schedule(researcher.id, name="B second"))
        env["clock"].now = DUE
        assert tick(client)["agentJobs"] == 2
        wait_runs(env["log"], 1)
        body = {k: v for k, v in second.items() if k not in ("id", "revision", "readOnlyReason", "lastRun")}
        moved = {**body["trigger"], "time": "10:00"}
        res = client.put(f"/api/automations/{second['id']}",
                         json={"rule": {**body, "trigger": moved}, "baseRevision": second["revision"]})
        assert res.status_code == 200, res.text
    with opened(env) as client:
        idle(client)
        items = {i["ruleId"]: i["count"] for i in client.get("/api/automations/catch-up").json()["items"]}
        assert items == {first["id"]: 1}
        assert runs_of(client, second["id"]) == []


def test_sleep_gap_owes(env) -> None:
    with opened(env) as client:
        rule = create(client, schedule(env["researcher"].id))
        tick(client)
        env["clock"].now = START + timedelta(hours=3)
        answer = tick(client)
        assert answer["automationRuns"] == [] and answer["agentJobs"] == 0
        items = client.get("/api/automations/catch-up").json()["items"]
        assert [(i["ruleId"], i["count"]) for i in items] == [(rule["id"], 1)]
    assert fake_runs(env["log"]) == []


@pytest.mark.parametrize("how", ["off", "deleted"])
def test_off_or_deleted_rule_is_skipped(env, how) -> None:
    researcher = env["researcher"]
    with opened(env) as client:
        create(client, schedule(researcher.id, prompt="FAKE:wait Review", name="A first"))
        second = create(client, schedule(researcher.id, name="B second"))
        env["clock"].now = DUE
        tick(client)
        wait_runs(env["log"], 1)
        if how == "off":
            body = {k: v for k, v in second.items() if k not in ("id", "revision", "readOnlyReason", "lastRun")}
            res = client.put(f"/api/automations/{second['id']}",
                             json={"rule": {**body, "enabled": False}, "baseRevision": second["revision"]})
            assert res.status_code == 200, res.text
        else:
            assert client.delete(f"/api/automations/{second['id']}").status_code == 200
        env["go"].write_text("go", encoding="utf-8")
        idle(client)
        if how == "off":
            runs = runs_of(client, second["id"])
            assert [r["status"] for r in runs] == ["skipped"]
            assert runs[0]["actions"][0]["detail"] == TURNED_OFF
        else:
            from objectapp.automations import run_log_path

            assert not run_log_path(env["root"], second["id"]).exists()
    assert len(fake_runs(env["log"])) == 1


def test_duplicate_submit_is_ignored(env) -> None:
    with opened(env) as client:
        rule = create(client, schedule(env["researcher"].id, prompt="FAKE:wait Review"))
        jobs = client.app.state.automations.agent_jobs  # type: ignore[attr-defined]
        job = AgentJob(rule["id"], datetime(2026, 11, 9, 9, 0, tzinfo=UTC), False)
        assert jobs.submit(job) is True
        assert jobs.submit(job) is False
        wait_runs(env["log"], 1)
        assert jobs.submit(job) is False  # running now
        env["go"].write_text("go", encoding="utf-8")
        idle(client)


def test_used_skills_recorded(env) -> None:
    researcher = env["researcher"]
    with opened(env) as client:
        rule = create(client, schedule(researcher.id, prompt="FAKE:skilltool:weekly-report\nReview"))
        env["clock"].now = DUE
        tick(client)
        idle(client)
    [entry] = [e for e in ScheduleIndex().entries(researcher.id) if e["ruleId"] == rule["id"]]
    assert entry["usedSkills"] == ["weekly-report"]


def _space_files(root: Path) -> dict[str, tuple[bytes, int]]:
    return {p.relative_to(root).as_posix(): (p.read_bytes(), p.stat().st_mtime_ns)
            for p in sorted(root.rglob("*"))
            if p.is_file() and ".object-cache" not in p.relative_to(root).parts}


def test_open_writes_nothing(env) -> None:
    researcher = env["researcher"]
    with opened(env) as client:
        create(client, schedule(researcher.id))
        create(client, schedule("assistant", name="Daily", trigger={
            "kind": "schedule", "repeat": "every day", "time": "07:00", "start": "2026-11-09"}))
        env["clock"].now = DUE
        tick(client)
        idle(client)
    index = state_dir() / INDEX_FILE
    assert index.exists()
    before = _space_files(env["root"])
    index_mtime = index.stat().st_mtime_ns
    time.sleep(0.05)
    space = Space(env["root"])
    space.clock = env["clock"]
    space.tz = UTC
    app = create_app(space, watch=False)
    app.state.automations.scheduler.interval = 3600
    with TestClient(app):
        pass
    assert _space_files(env["root"]) == before
    assert index.stat().st_mtime_ns == index_mtime


def test_save_route_unchanged(env) -> None:
    events: list[Any] = []
    with opened(env) as client:
        hub = client.app.state.hub  # type: ignore[attr-defined]
        real = hub.publish
        hub.publish = lambda e: (events.append(e), real(e))[1]
        res = client.post("/api/ai/chat/save", json={
            "title": "", "messages": [{"role": "user", "text": "Hello there", "at": "2026-11-09T08:00:00.000Z"},
                                      {"role": "assistant", "text": "Hi.", "at": "2026-11-09T08:00:01.000Z"}],
            "clientId": "c1", "agentId": env["researcher"].id,
        })
        assert res.status_code == 200, res.text
        body = res.json()
        assert set(body) == {"path", "version"}
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline and not any(e.kind == "changed" for e in events):
            time.sleep(0.05)
    kinds = [(e.kind, e.origin) for e in events if e.kind in ("types", "created", "changed")]
    assert ("created", "c1") in kinds and ("changed", "c1") in kinds and ("types", "c1") in kinds
    text = (env["root"] / body["path"]).read_text(encoding="utf-8")
    assert "agent: Researcher" in text and "Hello there" in text


def test_chat_title_fits() -> None:
    title = schedulerun.chat_title("x" * 70, datetime(2026, 11, 9, 9, 0, tzinfo=UTC), UTC)
    assert len(title) <= aichat.TITLE_MAX
    assert title.endswith(" 2026-11-09")
    assert schedulerun.chat_title("Weekly review", datetime(2026, 11, 9, 23, 30, tzinfo=UTC), UTC) == (
        "Weekly review 2026-11-09")


def test_contributor_installed() -> None:
    schedulerun.install()
    schedulerun.install()
    names = [name for _o, name, _fn in agentrun.contributors()]
    assert names.count("schedule-guidance") == 1
