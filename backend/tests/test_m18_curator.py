"""M18 Task 8: the curator marks, archives and tidies skills while Object is idle.

The deterministic pass is tested on a plain agent folder with a clock the test sets and
``usage.json`` dates the test writes. The idle clock, the busy check and the consolidation run use
the app served on 127.0.0.1 (uvicorn in a thread, so the MCP servers the fake ``claude`` starts can
reach it) with ``OBJECT_CLOCK_FILE`` moving the space's clock. ``OBJECT_STATE_DIR`` is a temp
folder (conftest); fixtures are synthetic.
"""

from __future__ import annotations

import asyncio
import json
import socket
import threading
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
import uvicorn
from fake_claude import install
from fastapi.testclient import TestClient
from objectapp import agentskills, curator, ledger, learnundo
from objectapp import settings as device_settings
from objectapp.agentmodel import AgentInput
from objectapp.agents import AgentRegistry
from objectapp.curator import CONSOLIDATE_PROMPT, Curator, CuratorBusy, IdleClock, deterministic_pass, due
from objectapp.learningmodel import ARCHIVE_DIR, LEARNING_DEFAULTS, USAGE_FILE
from objectapp.reviews import ReviewRunner
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.tokens import TokenStore

CURATOR_LINE = "Tidy up your skills."
CHAT_SOURCE = {"kind": "chat", "agentId": "a", "chatId": None, "run": None}
SKILL_TOOLS = {f"mcp__object-agent__{t}" for t in ("skills_list", "skill_view", "skill_manage")}
NOW = datetime(2026, 11, 6, 9, 0, tzinfo=UTC)


def _iso(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _make(folder: Path, name: str, body: str = "Body\n") -> None:
    agentskills.manage(folder, "create", name=name, source=CHAT_SOURCE, memo_key=None,
                       description=f"About {name}", content=body)


def _set_usage(folder: Path, name: str, **fields) -> None:
    path = folder / USAGE_FILE
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"v": 1, "skills": {}}
    entry = data.setdefault("skills", {}).setdefault(name, {})
    entry.update(fields)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")


def _unused_since(folder: Path, name: str, days: float, now: datetime = NOW) -> None:
    _set_usage(folder, name, lastUsed=_iso(now - timedelta(days=days)))


def _state(folder: Path, name: str) -> str:
    for info in agentskills.list_skills(folder, archived=True):
        if info.name == name:
            return info.state
    raise AssertionError(f"no skill {name}")


def _curator_entries(folder: Path) -> list[dict]:
    return [e for e in ledger.entries(folder, limit=1000) if e.get("source", {}).get("kind") == "curator"]


@pytest.fixture
def folder(tmp_path: Path) -> Path:
    f = tmp_path / "agent"
    f.mkdir()
    return f


# -- the deterministic pass --------------------------------------------------------------------------


def test_stale_then_archived(folder: Path) -> None:
    for name in ("thirteen", "fourteen", "thirty"):
        _make(folder, name)
    _unused_since(folder, "thirteen", 13)
    _unused_since(folder, "fourteen", 14)
    _unused_since(folder, "thirty", 30)

    made = deterministic_pass(folder, NOW, run_id="RUN1")
    by_skill = {e["skill"]: e for e in made}
    assert set(by_skill) == {"fourteen", "thirty"}
    assert by_skill["fourteen"]["action"] == "stale"
    assert by_skill["fourteen"]["source"]["kind"] == "curator"
    assert by_skill["fourteen"]["source"]["run"] == "RUN1"
    assert by_skill["thirty"]["action"] == "archive"
    assert _state(folder, "thirteen") == "active"
    assert _state(folder, "fourteen") == "stale"
    assert _state(folder, "thirty") == "archived"
    assert (folder / ARCHIVE_DIR / "thirty" / "SKILL.md").is_file()
    assert [e["id"] for e in ledger.entries(folder, run="RUN1")] != []

    # a second pass at the same instant changes nothing more
    assert deterministic_pass(folder, NOW, run_id="RUN2") == []
    # the stale one is archived at 30 days
    later = deterministic_pass(folder, NOW + timedelta(days=16), run_id="RUN3")
    assert sorted((e["skill"], e["action"]) for e in later) == [("fourteen", "archive"), ("thirteen", "stale")]


def test_never_touched(folder: Path, monkeypatch) -> None:
    for name in ("pinned", "scheduled", "young"):
        _make(folder, name)
    agentskills.set_pinned(folder, "pinned", True, source={"kind": "user"})
    agentskills.user_create(folder, "no-created-by", "Gene's own", "Mine\n")
    explicit = folder / ".claude" / "skills" / "by-user"
    explicit.mkdir(parents=True)
    (explicit / "SKILL.md").write_text("---\nname: by-user\ndescription: Gene's\ncreated_by: user\n---\nX\n",
                                       encoding="utf-8")
    for name in ("pinned", "scheduled", "no-created-by", "by-user"):
        _unused_since(folder, name, 40)
    _set_usage(folder, "young", lastUsed=None, createdAt=_iso(NOW - timedelta(days=13)))
    monkeypatch.setattr(agentskills, "SCHEDULE_SKILLS", lambda f: {"scheduled"})

    assert deterministic_pass(folder, NOW, run_id="R") == []
    assert _curator_entries(folder) == []
    for name in ("pinned", "scheduled", "no-created-by", "by-user", "young"):
        assert _state(folder, name) == "active"

    # the never-used one counts from its createdAt: stale at 14 days, archived at 30
    made = deterministic_pass(folder, NOW + timedelta(days=1), run_id="R2")
    assert [(e["skill"], e["action"]) for e in made] == [("young", "stale")]
    made = deterministic_pass(folder, NOW + timedelta(days=17), run_id="R3")
    assert [(e["skill"], e["action"]) for e in made] == [("young", "archive")]
    for name in ("pinned", "scheduled", "no-created-by", "by-user"):
        assert _state(folder, name) == "active"


def test_schedule_hook_that_raises_touches_nothing(folder: Path, monkeypatch) -> None:
    _make(folder, "old")
    _unused_since(folder, "old", 40)

    def broken(_folder):
        raise OSError("the schedule index can't be read")

    monkeypatch.setattr(agentskills, "SCHEDULE_SKILLS", broken)
    assert deterministic_pass(folder, NOW, run_id="R") == []
    assert _curator_entries(folder) == []
    assert _state(folder, "old") == "active"


def test_a_skill_with_no_date_gets_created_at(folder: Path) -> None:
    _make(folder, "dateless")
    _set_usage(folder, "dateless", createdAt=None, lastUsed=None)
    assert deterministic_pass(folder, NOW, run_id="R") == []
    usage = json.loads((folder / USAGE_FILE).read_text(encoding="utf-8"))
    assert usage["skills"]["dateless"]["createdAt"] == _iso(NOW)


def test_native_skill_use_counts_as_use(folder: Path, monkeypatch) -> None:
    now = datetime.now(UTC)
    _make(folder, "native")
    _set_usage(folder, "native", createdAt=_iso(now - timedelta(days=40)), lastUsed=None)
    with monkeypatch.context() as m:
        m.setattr(agentskills, "_clock", lambda: now - timedelta(days=10))
        agentskills.record_use(folder, "native", "run-token")  # the CLI's own Skill tool
    agentskills.MEMO.forget("run-token")
    usage = json.loads((folder / USAGE_FILE).read_text(encoding="utf-8"))
    assert usage["skills"]["native"]["uses"] == 1
    assert deterministic_pass(folder, now, run_id="R") == []
    assert _state(folder, "native") == "active"


def test_stale_used_again_is_active(folder: Path) -> None:
    now = datetime.now(UTC)
    _make(folder, "again")
    _unused_since(folder, "again", 20, now)
    assert [e["action"] for e in deterministic_pass(folder, now, run_id="R")] == ["stale"]
    assert _state(folder, "again") == "stale"
    agentskills.view(folder, "again", memo_key="k")
    agentskills.MEMO.forget("k")
    assert _state(folder, "again") == "active"
    assert deterministic_pass(folder, now, run_id="R2") == []
    assert _state(folder, "again") == "active"


def test_due() -> None:
    on = dict(LEARNING_DEFAULTS)
    never: dict = {}
    assert not due(on, never, NOW, timedelta(hours=1, minutes=59), False)
    assert due(on, never, NOW, timedelta(hours=2), False)
    ran = {"curator": {"lastRunAt": _iso(NOW - timedelta(days=6))}}
    assert not due(on, ran, NOW, timedelta(hours=3), False)
    ran = {"curator": {"lastRunAt": _iso(NOW - timedelta(days=7))}}
    assert due(on, ran, NOW, timedelta(hours=3), False)
    assert not due({**on, "curator": False}, never, NOW, timedelta(days=30), False)
    assert not due(on, never, NOW, timedelta(days=30), True)
    # the settable numbers
    assert due({**on, "curatorIdleHours": 1}, never, NOW, timedelta(hours=1), False)
    ran = {"curator": {"lastRunAt": _iso(NOW - timedelta(days=1))}}
    assert due({**on, "curatorEveryDays": 1}, ran, NOW, timedelta(hours=3), False)


# -- the curator on its own ----------------------------------------------------------------------------


class Clock:
    def __init__(self, at: datetime) -> None:
        self.at = at

    def __call__(self) -> datetime:
        return self.at


def _curator(space_dir: Path, clock: Clock, events: list) -> Curator:
    idle = IdleClock(clock)
    runner = ReviewRunner(events.append, space_dir, "space-sample")
    return Curator(events.append, idle, runner, space_dir, "space-sample", clock, lambda: None)


def test_tick_runs_each_due_agent_once(space_dir: Path) -> None:
    reg = AgentRegistry()
    one = reg.create(AgentInput(name="One"), "One.\n")
    two = reg.create(AgentInput(name="Two"), "Two.\n")
    reg.create(AgentInput(name="Off", learning={"curator": False}), "Off.\n")
    default = reg.list()[0]
    assert default.default and not default.exists
    clock = Clock(datetime.now(UTC).replace(microsecond=0))
    events: list = []
    cur = _curator(space_dir, clock, events)
    assert asyncio.run(cur.tick()) == []  # not idle yet
    clock.at += timedelta(hours=3)
    assert sorted(asyncio.run(cur.tick())) == sorted([one.id, two.id])
    for agent in (one, two):
        usage = json.loads((agent.folder / USAGE_FILE).read_text(encoding="utf-8"))
        assert usage["curator"]["lastRunAt"] == _iso(clock.at)
        assert cur.state(reg.get(agent.id))["lastRunAt"] == _iso(clock.at)
        assert cur.state(reg.get(agent.id))["nextDueAt"] == _iso(clock.at + timedelta(days=7))
    assert asyncio.run(cur.tick()) == []
    assert not default.folder.exists()
    assert any(e.kind == "agentLearning" and e.path == one.id for e in events)


def test_hidden_ai_skips_ticks(space_dir: Path) -> None:
    one = AgentRegistry().create(AgentInput(name="One"), "One.\n")
    clock = Clock(datetime.now(UTC))
    cur = _curator(space_dir, clock, [])
    clock.at += timedelta(hours=3)
    _data, revision = device_settings.read()
    device_settings.patch({"aiHidden": True}, revision)
    assert asyncio.run(cur.tick()) == []
    assert not (one.folder / USAGE_FILE).exists()
    _data, revision = device_settings.read()
    device_settings.patch({"aiHidden": False}, revision)
    assert asyncio.run(cur.tick()) == [one.id]


def test_curator_cannot_archive_protected(space_dir: Path, monkeypatch) -> None:
    app = create_app(Space(space_dir), None, watch=False)
    agent = AgentRegistry().create(AgentInput(name="Researcher"), "Dig.\n")
    for name in ("pinned", "scheduled", "plain"):
        _make(agent.folder, name)
    agentskills.set_pinned(agent.folder, "pinned", True, source={"kind": "user"})
    _rec, secret = TokenStore(space_dir).ephemeral(
        "Researcher", "read", agent=agent.id, purpose="curator", run="C1", budget=40,
        tools=("skills_list", "skill_view", "skill_manage"),
    )
    h = {"Authorization": f"Bearer {secret}"}
    try:
        with TestClient(app) as http:
            def archive(name: str):
                return http.post("/api/v1/agent/skills/manage", json={"action": "archive", "name": name}, headers=h)

            res = archive("pinned")
            assert res.status_code == 422
            assert "The curator doesn't change pinned skills or skills you wrote." in res.text
            monkeypatch.setattr(agentskills, "SCHEDULE_SKILLS", lambda f: {"scheduled"})
            res = archive("scheduled")
            assert res.status_code == 422
            assert "The curator doesn't change skills a schedule uses." in res.text

            def broken(_folder):
                raise OSError("unreadable")

            monkeypatch.setattr(agentskills, "SCHEDULE_SKILLS", broken)
            res = archive("plain")
            assert res.status_code == 422
            assert "The curator doesn't change skills a schedule uses." in res.text
            for name in ("pinned", "scheduled", "plain"):
                assert _state(agent.folder, name) == "active"
    finally:
        TokenStore.drop_ephemeral(secret)


# -- the live app ----------------------------------------------------------------------------------


class Live:
    """The app served on a free loopback port, with the fake claude and a clock file."""

    def __init__(self, space_dir: Path, fake: dict, clock_file: Path) -> None:
        self.fake = fake
        self.clock_file = clock_file
        self.start = datetime.now(UTC)
        self.set_clock(self.start)
        self.app = create_app(Space(space_dir), None, watch=False)
        self.events: list = []
        self.app.state.hub.publish = self.events.append
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        self.server = uvicorn.Server(uvicorn.Config(self.app, host="127.0.0.1", port=port, log_level="warning"))
        self.thread = threading.Thread(target=self.server.run, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{port}"
        self.http = httpx.Client(base_url=self.base, timeout=120)
        for _ in range(400):
            try:
                if self.http.get("/api/space").status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(0.05)
        raise AssertionError("the app didn't start")

    def set_clock(self, at: datetime) -> None:
        self.clock_file.write_text(_iso(at), encoding="utf-8")

    def later(self, **delta) -> None:
        self.set_clock(self.start + timedelta(**delta))

    @property
    def curator(self) -> Curator:
        return self.app.state.curator

    def tick(self) -> list[str]:
        res = self.http.post("/api/_test/curator/tick")
        assert res.status_code == 200, res.text
        return res.json()["agents"]

    def create(self, name: str = "Researcher") -> str:
        res = self.http.post("/api/agents", json={"agent": {"name": name}, "instructions": "Dig."})
        assert res.status_code == 201, res.text
        return res.json()["id"]

    def agent(self, agent_id: str):
        return AgentRegistry().get(agent_id)

    def set_learning(self, agent_id: str, **learning) -> None:
        state = self.http.get(f"/api/agents/{agent_id}/learning").json()
        res = self.http.put(f"/api/agents/{agent_id}/learning",
                            json={"learning": learning, "baseRevision": state["revision"]})
        assert res.status_code == 200, res.text

    def runs(self) -> list[dict]:
        log = self.fake["log"]
        if not log.exists():
            return []
        return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines() if line]

    def curator_runs(self) -> list[dict]:
        return [r for r in self.runs() if CURATOR_LINE in r["prompt"]]

    def stop(self) -> None:
        self.http.close()
        self.server.should_exit = True
        self.thread.join(30)


@pytest.fixture
def fake(tmp_path: Path, monkeypatch) -> dict:
    path = install(tmp_path / "bin")
    log = tmp_path / "claude-log.jsonl"
    monkeypatch.setenv("FAKE_CLAUDE_LOG", str(log))
    _data, revision = device_settings.read()
    device_settings.patch({"claudePath": str(path)}, revision)
    return {"path": str(path), "log": log}


@pytest.fixture
def live(space_dir: Path, fake, tmp_path: Path, monkeypatch):
    clock_file = tmp_path / "clock.txt"
    monkeypatch.setenv("OBJECT_CLOCK_FILE", str(clock_file))
    monkeypatch.setenv("OBJECT_FAKE_NOTIFY_FILE", str(tmp_path / "notified.jsonl"))
    monkeypatch.setattr(curator, "CURATOR_TICK", 3600.0)  # only the test hook ticks
    env = Live(space_dir, fake, clock_file)
    try:
        yield env
    finally:
        env.stop()


def test_idle_clock_ignores_events_and_test_routes(live: Live) -> None:
    agent_id = live.create()
    live.later(hours=3)
    with live.http.stream("GET", "/api/events", timeout=httpx.Timeout(5.0, read=0.5)) as res:
        assert res.status_code == 200
    assert live.app.state.idle.idle_for() >= timedelta(hours=3)
    assert live.tick() == [agent_id]

    # a request an hour before the tick makes it not idle (and the next run isn't due either way)
    live.later(days=8, hours=2)
    assert live.http.get("/api/agents").status_code == 200
    live.later(days=8, hours=3)
    assert live.app.state.idle.idle_for() == timedelta(hours=1)
    assert live.tick() == []
    live.later(days=8, hours=4)
    assert live.tick() == [agent_id]


def test_busy_while_a_turn_runs(live: Live) -> None:
    agent_id = live.create()
    body = {"mode": "chat", "prompt": "FAKE:wait", "contextPaths": [], "history": [], "agentId": agent_id,
            "chatId": None, "sessionId": None}
    out: dict = {}

    def turn() -> None:
        out["res"] = live.http.post("/api/ai/chat", json=body)

    t = threading.Thread(target=turn)
    t.start()
    try:
        for _ in range(400):
            if live.runs():
                break
            time.sleep(0.05)
        assert live.runs(), "the turn didn't start"
        live.later(hours=3)
        assert live.tick() == []  # a turn runs: busy
    finally:
        Path(str(live.fake["log"]) + ".go").write_text("go", encoding="utf-8")
        t.join(60)
    assert out["res"].status_code == 200
    assert live.tick() == [agent_id]


def test_consolidation_run(live: Live, monkeypatch) -> None:
    agent_id = live.create()
    live.set_learning(agent_id, consolidate=True)
    folder = live.agent(agent_id).folder
    _make(folder, "broad-skill", "Broad body\n")
    _make(folder, "narrow-skill", "Narrow body\n")
    broad_before = (folder / ".claude" / "skills" / "broad-skill" / "SKILL.md").read_bytes()
    monkeypatch.setenv("FAKE_CLAUDE_CURATOR_ACTIONS", json.dumps([
        {"server": "object-agent", "tool": "skills_list", "args": {}},
        {"server": "object-agent", "tool": "skill_view", "args": {"name": "broad-skill"}},
        {"server": "object-agent", "tool": "skill_manage",
         "args": {"action": "patch", "name": "broad-skill", "old_string": "Broad body",
                  "new_string": "Broad body, with the narrow steps"}},
        {"server": "object-agent", "tool": "skill_manage",
         "args": {"action": "archive", "name": "narrow-skill", "absorbed_into": "broad-skill"}},
    ]))
    live.later(hours=3)
    assert live.tick() == [agent_id]

    (run,) = live.curator_runs()
    assert run["prompt"].startswith(CONSOLIDATE_PROMPT.splitlines()[0])
    assert run["noSessionPersistence"] is True
    assert run["resume"] is None
    assert set(run["allowed"]) == SKILL_TOOLS
    assert "mcp__object-agent__memory" in run["disallowed"]
    assert "Skill" in run["disallowed"]

    archived = {s.name: s for s in agentskills.list_skills(folder, archived=True) if s.state == "archived"}
    assert archived["narrow-skill"].absorbed_into == "broad-skill"
    assert "with the narrow steps" in (folder / ".claude" / "skills" / "broad-skill" / "SKILL.md").read_text(
        encoding="utf-8")

    usage = json.loads((folder / USAGE_FILE).read_text(encoding="utf-8"))
    report = usage["curator"]["report"]
    assert report["text"] == "Hello from the fake claude."
    assert usage["curator"]["lastRunAt"] is not None
    state = live.http.get(f"/api/agents/{agent_id}/learning").json()
    assert state["curator"]["report"]["text"] == "Hello from the fake claude."
    assert state["curator"]["report"]["runId"] == report["runId"]

    made = ledger.entries(folder, run=report["runId"])
    assert {(e["skill"], e["action"]) for e in made} == {("broad-skill", "patch"), ("narrow-skill", "archive")}
    assert all(e["source"]["kind"] == "curator" for e in made)
    for entry in made:  # newest first
        learnundo.undo(folder, entry["id"], source={"kind": "undo", "agentId": agent_id})
    assert _state(folder, "narrow-skill") == "active"
    assert (folder / ".claude" / "skills" / "broad-skill" / "SKILL.md").read_bytes() == broad_before


def test_tidy_now(live: Live, monkeypatch) -> None:
    agent_id = live.create()
    folder = live.agent(agent_id).folder
    _make(folder, "broad-skill")
    _make(folder, "narrow-skill")
    monkeypatch.setenv("FAKE_CLAUDE_CURATOR_ACTIONS", json.dumps([
        {"server": "object-agent", "tool": "skill_manage",
         "args": {"action": "archive", "name": "narrow-skill", "absorbed_into": "broad-skill"}},
    ]))
    agent = live.agent(agent_id)
    assert agent.data.get("learning") is None or not agent.data["learning"].get("consolidate")

    async def twice() -> dict:
        out = await live.curator.tidy_now(agent, live.base)
        assert live.curator.state(agent)["running"] is True
        with pytest.raises(CuratorBusy):
            await live.curator.tidy_now(agent, live.base)
        assert await live.curator.wait_tidy(60)
        return out

    out = asyncio.run(twice())  # no idle time needed, consolidate off
    assert len(live.curator_runs()) == 1
    usage = json.loads((folder / USAGE_FILE).read_text(encoding="utf-8"))
    assert usage["curator"]["report"]["runId"] == out["runId"]
    assert usage["curator"]["lastRunAt"] is None  # Tidy up now isn't a scheduled run
    assert _state(folder, "narrow-skill") == "archived"
    assert live.curator.state(agent)["running"] is False
