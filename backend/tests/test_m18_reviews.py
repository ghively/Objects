"""M18 Task 7: background reviews after replies, and "Learn from this chat" (run with the fake
``claude``).

The app is served on 127.0.0.1 (uvicorn in a thread), so the MCP servers the fake starts from a
run's ``--mcp-config`` can reach it the way the real CLI's would. ``OBJECT_STATE_DIR`` is a temp
folder (conftest); the space is a copy of ``space-sample``.
"""

from __future__ import annotations

import json
import socket
import threading
import time
from pathlib import Path

import httpx
import pytest
import uvicorn
from fake_claude import EXPIRED_SESSION, install
from objectapp import agentskills, ai, ledger, reviews, toolcatalog, transcripts
from objectapp import settings as device_settings
from objectapp.agents import AgentRegistry
from objectapp.reviews import (
    BOTH_PROMPT,
    Counters,
    ReviewBusy,
    counters,
    due_kinds,
    review_tools,
    summary_text,
)
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.tokens import TokenStore

REVIEW_LINE = "Look back over this chat."
AGENT = "mcp__object-agent__"
WRITE_TOOLS = [f"mcp__object__{t}" for t in toolcatalog.OBJECT_WRITE]
READ_TOOLS = [f"mcp__object__{t}" for t in toolcatalog.OBJECT_READ]
BUILTIN_CLI = [n for e in toolcatalog.BUILTINS for n in e.cli]
OFF = {"memoryReviewEvery": 0, "skillReviewEvery": 0}


# -- the live app ----------------------------------------------------------------------------------


class Live:
    """The app served on a free loopback port, with the fake claude as its CLI."""

    def __init__(self, space_dir: Path, fake: dict) -> None:
        self.space_dir = space_dir
        self.fake = fake
        self.events: list = []
        self._start()

    def _start(self) -> None:
        self.app = create_app(Space(self.space_dir), None, watch=False)
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

    def stop(self) -> None:
        self.runner.wait_idle(60)
        self.http.close()
        self.server.should_exit = True
        self.thread.join(30)

    def restart(self) -> None:
        self.stop()
        self._start()

    @property
    def runner(self) -> reviews.ReviewRunner:
        return self.app.state.reviews

    def create(self, name: str = "Researcher", **agent) -> str:
        res = self.http.post("/api/agents", json={"agent": {"name": name, **agent}, "instructions": "Dig."})
        assert res.status_code == 201, res.text
        return res.json()["id"]

    def agent(self, agent_id: str):
        return AgentRegistry().get(agent_id)

    def chat(self, prompt: str, agent_id: str, chat_id: str | None = None, session_id: str | None = None,
             **extra) -> dict:
        body = {"mode": "chat", "prompt": prompt, "contextPaths": [], "history": [], "agentId": agent_id,
                "chatId": chat_id, "sessionId": session_id, **extra}
        res = self.http.post("/api/ai/chat", json=body)
        assert res.status_code == 200, res.text
        frames = _frames(res.text)
        assert frames[-1]["type"] == "done", frames[-1]
        return {"chatId": frames[0]["chatId"], "sessionId": frames[-1].get("sessionId"), "frames": frames}

    def idle(self) -> None:
        assert self.runner.wait_idle(60)

    def runs(self) -> list[dict]:
        log = self.fake["log"]
        if not log.exists():
            return []
        return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines() if line]

    def review_runs(self) -> list[dict]:
        return [r for r in self.runs() if REVIEW_LINE in r["prompt"]]

    def chat_runs(self) -> list[dict]:
        return [r for r in self.runs() if REVIEW_LINE not in r["prompt"]]

    def learning_events(self) -> list:
        return [e for e in self.events if e.kind == "agentLearning"]


def _frames(raw: str) -> list[dict]:
    out = []
    for frame in raw.replace("\r\n", "\n").split("\n\n"):
        data = [line[5:].lstrip(" ") for line in frame.split("\n") if line.startswith("data:")]
        if data:
            out.append(json.loads("\n".join(data)))
    return out


@pytest.fixture
def fake(tmp_path: Path, monkeypatch) -> dict:
    path = install(tmp_path / "bin")
    log = tmp_path / "claude-log.jsonl"
    monkeypatch.setenv("FAKE_CLAUDE_LOG", str(log))
    _data, revision = device_settings.read()
    device_settings.patch({"claudePath": str(path)}, revision)
    return {"path": str(path), "log": log}


@pytest.fixture
def live(space_dir: Path, fake):
    env = Live(space_dir, fake)
    try:
        yield env
    finally:
        env.stop()


@pytest.fixture
def turn_events(monkeypatch) -> list[dict]:
    """Every review run's events (`ai.run_turn` wrapped), with the run's concurrency."""
    seen: list[dict] = []
    state = {"active": 0, "max": 0}
    real = ai.run_turn

    async def spy(turn):
        review = (turn.prompt_resume or turn.prompt_fresh or "").startswith(REVIEW_LINE)
        if review:
            state["active"] += 1
            state["max"] = max(state["max"], state["active"])
        try:
            async for event in real(turn):
                if review:
                    seen.append(event)
                yield event
        finally:
            if review:
                state["active"] -= 1

    monkeypatch.setattr(ai, "run_turn", spy)
    monkeypatch.setattr(reviews, "_spy_state", state, raising=False)  # test_concurrency_cap reads it
    return seen


def _actions(monkeypatch, *calls: tuple[str, str, dict]) -> None:
    monkeypatch.setenv("FAKE_CLAUDE_REVIEW_ACTIONS",
                       json.dumps([{"server": s, "tool": t, "args": a} for s, t, a in calls]))


def _results(events: list[dict]) -> list[str]:
    return [str(e.get("result") or "") for e in events if e.get("type") == "tool" and "result" in e]


# -- counters and kinds ----------------------------------------------------------------------------


def test_counters() -> None:
    users = [{"type": "user", "text": f"m{i}"} for i in range(10)]
    assert counters(users) == Counters(user_turns=10, tool_calls=0)
    with_memory = [*users[:4], {"type": "tool", "name": "mcp__object-agent__memory"}, *users[4:]]
    assert counters(with_memory).user_turns == 6
    assert counters([*users[:4], {"type": "tool", "name": "memory"}, *users[4:]]).user_turns == 6  # short name
    tools = [{"type": "tool", "name": "search"} for _ in range(3)]
    lines = [*users[:3], *tools, {"type": "review", "id": "R", "state": "running", "kinds": ["memory"]}, users[3]]
    c = counters(lines)
    assert c.user_turns == 1 and c.tool_calls == 3
    lines = [*tools, {"type": "tool", "name": "skill_manage"}, *tools[:2]]
    assert counters(lines).tool_calls == 2
    lines = [*tools, {"type": "review", "id": "R", "state": "running", "kinds": ["skills"]}, tools[0]]
    assert counters(lines).tool_calls == 1
    # an end line doesn't reset anything
    lines = [*users[:2], {"type": "review", "id": "R", "state": "done", "kinds": ["memory"]}]
    assert counters(lines).user_turns == 2


def test_due_kinds() -> None:
    defaults = {"memoryReviewEvery": 10, "skillReviewEvery": 10}
    assert due_kinds(Counters(10, 10), defaults) == ["memory", "skills"]
    assert due_kinds(Counters(9, 10), defaults) == ["skills"]
    assert due_kinds(Counters(10, 9), defaults) == ["memory"]
    assert due_kinds(Counters(9, 9), defaults) == []
    assert due_kinds(Counters(500, 0), {"memoryReviewEvery": 0, "skillReviewEvery": 10}) == []


def test_summary_text() -> None:
    def e(target, action):
        return {"target": target, "action": action}

    assert summary_text([e("memory", "add"), e("skill", "patch")]) == "Saved 1 memory, updated 1 skill"
    assert summary_text([]) == "Nothing new to learn"
    assert summary_text([e("memory", "add"), e("user", "add"), e("user", "replace"), e("skill", "create"),
                         e("skill", "create"), e("skill", "archive")]) == (
        "Saved 2 memories, changed 1 memory, created 2 skills, archived 1 skill")
    assert summary_text([e("skill", "write_file"), e("skill", "remove_file")]) == "Updated 2 skills"
    assert summary_text([e("skill", "pin")]) == "Nothing new to learn"


# -- when a review runs ----------------------------------------------------------------------------


def test_review_after_the_tenth_turn(live: Live) -> None:
    agent_id = live.create()
    chat_id = session = None
    for i in range(9):
        out = live.chat(f"Turn {i}", agent_id, chat_id, session)
        chat_id, session = out["chatId"], out["sessionId"]
    live.idle()
    assert live.review_runs() == [] and live.runner.statuses(live.agent(agent_id), chat_id) == []

    body = {"mode": "chat", "prompt": "Turn 9", "contextPaths": [], "history": [], "agentId": agent_id,
            "chatId": chat_id, "sessionId": session}
    reviews_when_done = None
    with live.http.stream("POST", "/api/ai/chat", json=body) as res:
        buffer = ""
        for chunk in res.iter_text():
            buffer += chunk
            frames = _frames(buffer)
            if frames and frames[-1]["type"] == "done" and reviews_when_done is None:
                reviews_when_done = len(live.review_runs())
                session = frames[-1]["sessionId"]
    assert reviews_when_done == 0  # the reply was shown before the review started
    live.idle()
    (run,) = live.review_runs()
    assert run["forkSession"] is True and run["noSessionPersistence"] is True
    assert run["resume"] == session
    assert run["prompt"].startswith(REVIEW_LINE)
    assert run["appendPrompt"] == live.chat_runs()[-1]["appendPrompt"]
    (status,) = live.runner.statuses(live.agent(agent_id), chat_id)
    assert status.state == "done" and status.kinds == ["memory"] and status.trigger == "auto"


def test_review_tool_lists_by_kind(live: Live) -> None:
    allowed, disallowed = review_tools(["memory"], [])
    assert f"{AGENT}memory" in allowed and set(READ_TOOLS) <= set(allowed)
    allowed, disallowed = review_tools(["skills"], [])
    assert {f"{AGENT}skills_list", f"{AGENT}skill_view", f"{AGENT}skill_manage"} <= set(allowed)
    assert f"{AGENT}memory" in disallowed and f"{AGENT}memory" not in allowed
    for kinds in (["memory"], ["skills"], ["memory", "skills"]):
        allowed, disallowed = review_tools(kinds, [])
        for name in [*BUILTIN_CLI, "Skill", f"{AGENT}session_search", f"{AGENT}agent_info", *WRITE_TOOLS]:
            assert name in disallowed and name not in allowed, name
        assert "ToolSearch" not in allowed and "ToolSearch" not in disallowed
    allowed, disallowed = review_tools(["skills"], [f"{AGENT}skill_manage", "mcp__object__search"])
    assert f"{AGENT}skill_manage" not in allowed and f"{AGENT}skill_manage" in disallowed
    assert "mcp__object__search" not in allowed

    # Through a real run: a memory review of an agent with a folder MCP server.
    agent_id = live.create(learning={"memoryReviewEvery": 1, "skillReviewEvery": 0},
                           toolsOff=[f"{AGENT}skill_manage"])
    folder = live.agent(agent_id).folder
    (folder / ".mcp.json").write_text(json.dumps({"mcpServers": {"notes": {"command": "notes-server"}}}),
                                      encoding="utf-8")
    live.chat("Hi", agent_id)
    live.idle()
    (chat_run,) = live.chat_runs()
    assert "notes" in chat_run["mcpConfig"]["mcpServers"]
    (run,) = live.review_runs()
    assert set(run["mcpConfig"]["mcpServers"]) == {"object", "object-agent"}
    assert "--read-only" in run["mcpConfig"]["mcpServers"]["object"]["args"]
    assert f"{AGENT}memory" in run["allowed"] and f"{AGENT}skills_list" in run["allowed"]
    assert f"{AGENT}skill_manage" not in run["allowed"] and f"{AGENT}skill_manage" in run["disallowed"]
    assert "mcp__notes" not in run["allowed"]
    for name in [*BUILTIN_CLI, "Skill", f"{AGENT}session_search", *WRITE_TOOLS]:
        assert name in run["disallowed"] and name not in run["allowed"], name
    assert not [n for n in run["allowed"] if not n.startswith("mcp__")]


def test_review_token_refuses_tools_outside_its_set(live: Live, monkeypatch, turn_events) -> None:
    agent_id = live.create(learning={"memoryReviewEvery": 0, "skillReviewEvery": 1})
    _actions(monkeypatch, ("object-agent", "memory", {"action": "add", "target": "memory", "content": "X"}))
    monkeypatch.setenv("FAKE_CLAUDE_REVIEW_SLEEP", "4")
    secrets: list[tuple] = []
    real = TokenStore.ephemeral

    def spy(self, name, scope="read", **kw):
        out = real(self, name, scope, **kw)
        if kw.get("purpose") == "review":
            secrets.append(out)
        return out

    monkeypatch.setattr(TokenStore, "ephemeral", spy)
    live.chat("FAKE:tool", agent_id)  # one tool call: the skills review is due
    deadline = time.monotonic() + 30
    while not secrets and time.monotonic() < deadline:
        time.sleep(0.05)
    (record, secret) = secrets[0]
    assert record.tools == ("skills_list", "skill_view", "skill_manage") and record.budget == 16
    res = live.http.post("/api/v1/agent/memory", headers={"Authorization": f"Bearer {secret}"},
                         json={"action": "add", "target": "memory", "content": "Y"})
    assert res.status_code == 403 and res.json()["detail"] == "This run can't use memory."
    live.idle()
    (run,) = live.review_runs()
    assert run["prompt"].startswith(REVIEW_LINE) and "skill_view" in run["prompt"]
    assert any("Permission to use mcp__object-agent__memory has been denied." in r for r in _results(turn_events))
    folder = live.agent(agent_id).folder
    assert not (folder / ".object-agent" / "memory" / "MEMORY.md").exists()
    assert ledger.entries(folder) == []


def test_seventeenth_step_is_refused(live: Live, monkeypatch, turn_events) -> None:
    agent_id = live.create(learning={"memoryReviewEvery": 1, "skillReviewEvery": 0})
    _actions(monkeypatch, *[("object-agent", "skills_list", {})] * 17)
    live.chat("Hi", agent_id)
    live.idle()
    results = _results(turn_events)
    assert len(results) == 17
    assert all("This run has used" not in r for r in results[:16])
    assert "This run has used its 16 tool steps." in results[16]


def test_review_summary_and_lines(live: Live, monkeypatch) -> None:
    agent_id = live.create(learning={"memoryReviewEvery": 1, "skillReviewEvery": 0})
    _actions(
        monkeypatch,
        ("object-agent", "memory", {"action": "add", "target": "memory", "content": "Rack A is in room 2"}),
        ("object-agent", "skill_manage", {"action": "create", "name": "rack-labels", "description": "Label racks",
                                          "content": "# Steps\nLabels go on the left."}),
        ("object-agent", "skill_view", {"name": "rack-labels"}),
        ("object-agent", "skill_manage", {"action": "patch", "name": "rack-labels", "old_string": "left",
                                          "new_string": "right"}),
    )
    out = live.chat("Where is rack A?", agent_id)
    live.idle()
    lines = [r for r in transcripts.raw_lines(live.agent(agent_id).folder, out["chatId"]) if r["type"] == "review"]
    start, end = lines
    assert start["state"] == "running" and start["kinds"] == ["memory"] and start["trigger"] == "auto"
    assert end["id"] == start["id"] and end["state"] == "done" and end["message"] is None
    assert end["summary"] == "Saved 1 memory, created 1 skill, updated 1 skill"
    folder = live.agent(agent_id).folder
    made = ledger.entries(folder, run=start["id"])
    assert len(end["entryIds"]) == 3 and set(end["entryIds"]) == {e["id"] for e in made}
    assert all(e["source"]["kind"] == "review" for e in made)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        ids = [e.version for e in live.learning_events() if e.path == agent_id]
        if ids.count(start["id"]) >= 2:
            break
        time.sleep(0.02)
    assert ids.count(start["id"]) == 2  # start and end
    item = [i for i in transcripts.read(folder, out["chatId"])["items"] if i["type"] == "learning"]
    assert item and item[0]["summary"] == end["summary"]


def test_nothing_new_to_learn(live: Live) -> None:
    agent_id = live.create(learning={"memoryReviewEvery": 1, "skillReviewEvery": 0})
    out = live.chat("Hi", agent_id)
    live.idle()
    (status,) = live.runner.statuses(live.agent(agent_id), out["chatId"])
    assert status.state == "done" and status.summary == "Nothing new to learn" and status.entry_ids == []


def test_review_forks_and_leaves_the_chat_alone(live: Live) -> None:
    agent_id = live.create(learning={"memoryReviewEvery": 1, "skillReviewEvery": 0})
    first = live.chat("Hi", agent_id)
    live.idle()
    folder = live.agent(agent_id).folder
    lines = transcripts.raw_lines(folder, first["chatId"])
    after_turn = [i for i, line in enumerate(lines) if line["type"] == "assistant"][-1]
    assert [line["type"] for line in lines[after_turn + 1:]] == ["review", "review"]
    assert lines[after_turn]["sessionId"] == first["sessionId"]
    (review,) = live.review_runs()
    assert review["resume"] == first["sessionId"] and review["forkSession"]
    live.chat("Again", agent_id, first["chatId"], first["sessionId"])
    assert live.chat_runs()[-1]["resume"] == first["sessionId"]
    last = [line for line in transcripts.raw_lines(folder, first["chatId"]) if line["type"] == "assistant"][-1]
    assert last["sessionId"] == first["sessionId"]  # the fake keeps a resumed (unforked) session


def test_review_model(live: Live) -> None:
    plain = live.create(learning={"memoryReviewEvery": 1, "skillReviewEvery": 0})
    live.chat("Hi", plain, model="sonnet")
    live.idle()
    assert live.review_runs()[-1]["model"] == "sonnet"
    own = live.create("Other", learning={"memoryReviewEvery": 1, "skillReviewEvery": 0, "reviewModel": "haiku"})
    live.chat("Hi", own, model="sonnet")
    live.idle()
    assert live.review_runs()[-1]["model"] == "haiku"


def test_fresh_replay_when_resume_fails(live: Live) -> None:
    agent_id = live.create(learning=OFF)
    agent = live.agent(agent_id)
    chat_id = transcripts.new_chat_id()
    transcripts.start(agent.folder, chat_id, agent_id=agent_id, title="Racks", space_name="space-sample",
                      space_key="k", created_at="2026-11-05T09:00:00.000Z")
    transcripts.append(agent.folder, chat_id, [
        {"type": "user", "text": "Where do rack labels go?", "at": "2026-11-05T09:00:00.000Z"},
        {"type": "assistant", "text": "On the left side.", "at": "2026-11-05T09:00:01.000Z",
         "model": None, "sessionId": EXPIRED_SESSION},
    ])
    live.runner.learn_now(agent=agent, chat_id=chat_id, api_url=live.base, claude=live.fake["path"])
    live.idle()
    first, second = live.review_runs()
    assert first["resume"] == EXPIRED_SESSION and first["forkSession"]
    assert second["resume"] is None and not second["forkSession"] and second["noSessionPersistence"]
    for text in ("Where do rack labels go?", "On the left side.", REVIEW_LINE):
        assert text in second["prompt"]
    (status,) = live.runner.statuses(agent, chat_id)
    assert status.state == "done"


def test_snapshot_frozen_per_chat(live: Live) -> None:
    agent_id = live.create(learning=OFF)
    add = json.dumps({"action": "add", "target": "memory", "content": "NEW"})
    first = live.chat(f"FAKE:mcp:object-agent:memory:{add}", agent_id)
    folder = live.agent(agent_id).folder
    assert "NEW" in (folder / ".object-agent" / "memory" / "MEMORY.md").read_text(encoding="utf-8")
    chat_id, session = first["chatId"], first["sessionId"]
    live.chat("Next", agent_id, chat_id, session)
    assert "NEW" not in live.chat_runs()[-1]["appendPrompt"]
    live.runner.learn_now(agent=live.agent(agent_id), chat_id=chat_id, api_url=live.base,
                          claude=live.fake["path"])
    live.idle()
    assert "NEW" not in live.review_runs()[-1]["appendPrompt"]

    live.restart()
    live.chat("After a restart", agent_id, chat_id, session)
    assert "NEW" not in live.chat_runs()[-1]["appendPrompt"]
    before = len(live.chat_runs())
    live.chat("Replayed", agent_id, chat_id, EXPIRED_SESSION)  # resume fails, then a fresh replay
    replays = live.chat_runs()[before:]
    assert len(replays) == 2 and replays[1]["resume"] is None
    assert all("NEW" not in r["appendPrompt"] for r in replays)

    live.chat("A new chat", agent_id)
    assert "NEW" in live.chat_runs()[-1]["appendPrompt"]
    memory_lines = [line for line in transcripts.raw_lines(folder, chat_id) if line["type"] == "memory"]
    assert len(memory_lines) == 1


def test_next_turn_runs_while_a_review_runs(live: Live, monkeypatch) -> None:
    monkeypatch.setenv("FAKE_CLAUDE_REVIEW_SLEEP", "5")
    agent_id = live.create(learning={"memoryReviewEvery": 1, "skillReviewEvery": 0})
    first = live.chat("Hi", agent_id)
    deadline = time.monotonic() + 30
    while not live.review_runs() and time.monotonic() < deadline:
        time.sleep(0.05)
    started = time.monotonic()
    live.chat("Again", agent_id, first["chatId"], first["sessionId"])
    assert time.monotonic() - started < 5 and live.runner.busy()  # the review still sleeps
    live.idle()
    assert len(live.review_runs()) == 1  # no second review for that chat while one ran
    (status,) = live.runner.statuses(live.agent(agent_id), first["chatId"])
    assert status.state == "done"


def test_review_failure_is_shown_not_raised(live: Live, monkeypatch) -> None:
    monkeypatch.setenv("FAKE_CLAUDE_REVIEW_FAIL", "1")
    agent_id = live.create(learning={"memoryReviewEvery": 1, "skillReviewEvery": 0})
    first = live.chat("Hi", agent_id)
    live.idle()
    (status,) = live.runner.statuses(live.agent(agent_id), first["chatId"])
    assert status.state == "failed" and status.message and status.summary is None
    out = live.chat("Again", agent_id, first["chatId"], first["sessionId"])
    assert out["frames"][-1]["type"] == "done"


def test_only_chat_turns_trigger_reviews(live: Live) -> None:
    agent_id = live.create()
    chat_id = None
    for _ in range(10):
        out = live.chat("FAKE:tags", agent_id, chat_id, mode="tagObject", contextPaths=["People/Ada Lovelace.md"])
        chat_id = out["chatId"]
    live.idle()
    assert live.review_runs() == []
    agent = live.agent(agent_id)
    assert reviews.counters(transcripts.raw_lines(agent.folder, chat_id)).user_turns == 10
    for mode, purpose in (("chat", "schedule"), ("chat", "delegate"), ("chat", "proposal"), ("tagObject", "chat")):
        assert live.runner.after_turn(agent=agent, chat_id=chat_id, mode=mode, purpose=purpose, chat_model=None,
                                      session_id=None, api_url=live.base, claude=live.fake["path"]) is None
    assert live.review_runs() == []


def test_learn_now(live: Live, monkeypatch) -> None:
    monkeypatch.setenv("FAKE_CLAUDE_REVIEW_SLEEP", "3")
    agent_id = live.create(learning=OFF)
    out = live.chat("Hi", agent_id)
    live.idle()
    assert live.review_runs() == []
    agent = live.agent(agent_id)
    status = live.runner.learn_now(agent=agent, chat_id=out["chatId"], api_url=live.base, claude=live.fake["path"])
    assert status.trigger == "manual" and status.kinds == ["memory", "skills"] and status.state == "running"
    with pytest.raises(ReviewBusy):
        live.runner.learn_now(agent=agent, chat_id=out["chatId"], api_url=live.base, claude=live.fake["path"])
    live.idle()
    (run,) = live.review_runs()
    assert run["prompt"] == BOTH_PROMPT and f"{AGENT}memory" in run["allowed"]
    (done,) = live.runner.statuses(agent, out["chatId"])
    assert done.id == status.id and done.state == "done" and done.trigger == "manual"
    with pytest.raises(FileNotFoundError):
        live.runner.learn_now(agent=agent, chat_id=transcripts.new_chat_id(), api_url=live.base,
                              claude=live.fake["path"])


# -- the CLI's own Skill tool ----------------------------------------------------------------------


def _make_skill(folder: Path) -> None:
    agentskills.manage(folder, "create", name="rack-labels", source={"kind": "chat"}, memo_key="setup",
                       description="Label racks", content="# Steps\nLabels go on the left.")
    agentskills.MEMO.forget("setup")


def test_native_skill_tool_bumps_usage(live: Live, monkeypatch) -> None:
    agent_id = live.create(learning=OFF)
    folder = live.agent(agent_id).folder
    _make_skill(folder)
    marked: list[tuple[str, str]] = []
    real = agentskills.RunMemo.mark_read

    def spy(self, key, name):
        marked.append((key, name))
        return real(self, key, name)

    monkeypatch.setattr(agentskills.RunMemo, "mark_read", spy)
    live.chat("FAKE:skilltool:rack-labels", agent_id)
    (info,) = agentskills.list_skills(folder)
    assert info.uses == 1 and info.last_used
    assert marked and marked[-1][1] == "rack-labels" and marked[-1][0].startswith("ephemeral-")

    # The read the Skill tool counts as lets that run patch without skill_view.
    event = {"type": "tool", "id": "toolu_1", "name": "Skill", "input": {"skill": "rack-labels"}}
    reviews.watch(event, folder=folder, memo_key="run-k")
    agentskills.manage(folder, "patch", name="rack-labels", source={"kind": "chat"}, memo_key="run-k",
                       old_string="left", new_string="right")
    agentskills.MEMO.forget("run-k")
    with pytest.raises(agentskills.SkillError):
        agentskills.manage(folder, "patch", name="rack-labels", source={"kind": "chat"}, memo_key="run-k",
                           old_string="right", new_string="left")
    reviews.watch({"type": "tool", "name": "Skill", "input": {"skill": "Not A Name"}}, folder=folder, memo_key="x")
    reviews.watch({"type": "tool", "name": "Read", "input": {"skill": "rack-labels"}}, folder=folder, memo_key="y")
    assert not agentskills.MEMO.was_read("y", "rack-labels")


def test_memo_dropped_with_the_token(live: Live, monkeypatch) -> None:
    agent_id = live.create(learning=OFF)
    folder = live.agent(agent_id).folder
    _make_skill(folder)
    made: list = []
    real = TokenStore.ephemeral

    def spy(self, name, scope="read", **kw):
        out = real(self, name, scope, **kw)
        made.append(out[0])
        return out

    monkeypatch.setattr(TokenStore, "ephemeral", spy)
    live.chat("FAKE:skilltool:rack-labels", agent_id)
    (record,) = made
    assert agentskills.list_skills(folder)[0].uses == 1
    assert not agentskills.MEMO.was_read(record.id, "rack-labels")


def test_concurrency_cap(live: Live, monkeypatch, turn_events) -> None:
    monkeypatch.setenv("FAKE_CLAUDE_REVIEW_SLEEP", "3")
    ids = [live.create(name, learning={"memoryReviewEvery": 1, "skillReviewEvery": 0})
           for name in ("Ann", "Bea", "Cy")]
    threads = [threading.Thread(target=live.chat, args=("Hi", agent_id)) for agent_id in ids]
    for t in threads:
        t.start()
    for t in threads:
        t.join(60)
    live.idle()
    assert len(live.review_runs()) == 3
    assert reviews._spy_state["max"] == 2  # type: ignore[attr-defined]
