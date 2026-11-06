"""M10: the AI assistant's back end (`ai`, `aichat`, `api_ai`), run against a fake ``claude``.

No test here starts a real model: `fake_claude.install` writes a launcher for
``backend/tests/fake_claude.py`` and the ``claudePath`` setting points at it.
"""

from __future__ import annotations

import ast
import asyncio
import json
import os
import sys
import threading
import time
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fake_claude import EXPIRED_SESSION, install
from fastapi.testclient import TestClient
from objectapp import ai, aichat
from objectapp import settings as device_settings
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.tokens import TokenStore

NOW = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)
SESSION_A = "0f8fad5b-d9cb-469f-a165-70867728950e"
SESSION_B = "7c9e6679-7425-40de-944b-e07fc1f90ae7"
SESSION_C = "16fd2706-8baf-433b-82eb-8c7fada847da"
BACKEND = Path(__file__).resolve().parents[1] / "objectapp"


# -- helpers ----------------------------------------------------------------------------


def _set(**patch) -> None:
    _data, revision = device_settings.read()
    device_settings.patch(patch, revision)


@pytest.fixture
def fake(tmp_path: Path, monkeypatch) -> dict:
    """The fake CLI as the ``claudePath`` setting, logging each run to a file."""
    path = install(tmp_path / "bin")
    log = tmp_path / "claude-log.jsonl"
    monkeypatch.setenv("FAKE_CLAUDE_LOG", str(log))
    monkeypatch.delenv("FAKE_CLAUDE_VERSION_FAIL", raising=False)
    _set(claudePath=str(path))
    return {"path": path, "log": log}


def _runs(log: Path) -> list[dict]:
    if not log.exists():
        return []
    return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines() if line]


def _app(root: Path):
    space = Space(root)
    space.clock = lambda: NOW
    app = create_app(space, None, watch=False)
    published: list = []
    app.state.hub.publish = published.append
    return space, app, published


@pytest.fixture
def api(space_dir: Path, fake):
    space, app, published = _app(space_dir)
    return space, TestClient(app), published


def _frames(raw: str) -> list[dict]:
    assert "\r" not in raw
    out = []
    for frame in raw.split("\n\n"):
        data = [line[5:].lstrip(" ") for line in frame.split("\n") if line.startswith("data:")]
        if data:
            out.append(json.loads("\n".join(data)))
    return out


def _chat(client: TestClient, prompt: str = "Hi", **extra) -> list[dict]:
    """M10's events of a turn: M17's leading ``chat`` event (checked here) is left out."""
    body = {"mode": "chat", "prompt": prompt, "contextPaths": [], "history": [], **extra}
    res = client.post("/api/ai/chat", json=body)
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("text/event-stream")
    events = _frames(res.text)
    if events and events[0]["type"] == "chat":
        assert events[0]["agentId"] == "assistant" and len(events[0]["chatId"]) == 26
        return events[1:]
    return events


def _done(events: list[dict]) -> dict:
    assert events[-1]["type"] == "done", events
    return events[-1]


def _alive(pid: int) -> bool:
    if os.name == "nt":  # pragma: no cover - Windows
        import subprocess

        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}"], capture_output=True, text=True, check=False)
        return str(pid) in out.stdout
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    # A zombie still answers kill(0); it no longer runs.
    try:
        stat = Path(f"/proc/{pid}/stat").read_text()
        return stat.split(")")[-1].split()[0] != "Z"
    except OSError:
        return True


def _snapshot(root: Path) -> dict[str, bytes]:
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*") if p.is_file()}


# -- status ---------------------------------------------------------------------------


def test_status_found(api, fake) -> None:
    _space, client, _ = api
    body = client.get("/api/ai/status").json()
    assert body == {
        "available": True,
        "reason": "ok",
        "claudePath": str(fake["path"]),
        "version": "9.9.9 (Claude Code, fake)",
        "message": None,
    }


def test_status_not_found(api, tmp_path: Path, monkeypatch) -> None:
    _space, client, _ = api
    _set(claudePath=str(tmp_path / "nowhere" / "claude"))
    body = client.get("/api/ai/status").json()
    assert body["available"] is False and body["reason"] == "notFound"
    assert body["claudePath"] == str(tmp_path / "nowhere" / "claude")
    assert body["message"]
    _set(claudePath=None)
    monkeypatch.setattr(ai.shutil, "which", lambda _name: None)
    body = client.get("/api/ai/status").json()
    assert body["reason"] == "notFound" and body["claudePath"] is None


def test_status_uses_path_when_no_setting(api, fake, monkeypatch) -> None:
    _space, client, _ = api
    _set(claudePath=None)
    monkeypatch.setattr(ai.shutil, "which", lambda name: str(fake["path"]) if name == "claude" else None)
    assert client.get("/api/ai/status").json()["reason"] == "ok"


def test_status_error(api, monkeypatch) -> None:
    _space, client, _ = api
    monkeypatch.setenv("FAKE_CLAUDE_VERSION_FAIL", "1")
    body = client.get("/api/ai/status").json()
    assert body["available"] is False and body["reason"] == "error"
    assert "broken install" in body["message"]


# -- a turn ---------------------------------------------------------------------------


def test_chat_turn_streams_session_text_done(api, fake) -> None:
    _space, client, _ = api
    events = _chat(client, "Hello there")
    kinds = [e["type"] for e in events]
    assert kinds[0] == "session" and kinds[-1] == "done"
    assert "text" in kinds
    session = events[0]["sessionId"]
    text = "".join(e["text"] for e in events if e["type"] == "text")
    assert text == "Hello from the fake claude."
    done = _done(events)
    assert done == {
        "type": "done",
        "text": "Hello from the fake claude.",
        "sessionId": session,
        "proposal": None,
        "skipped": [],
    }
    (run,) = _runs(fake["log"])
    assert "Hello there" in run["prompt"]


def test_tool_use_and_text_are_not_repeated(api) -> None:
    _space, client, _ = api
    events = _chat(client, "FAKE:tool find alpha")
    assert {"type": "tool", "id": "toolu_1", "name": "search", "input": {"query": "alpha"}} in events
    text = "".join(e["text"] for e in events if e["type"] == "text")
    assert text == "Let me look.\n\nHello from the fake claude."
    assert _done(events)["text"] == "Hello from the fake claude."


def test_cli_flags_config_and_cwd(api, fake, space_dir: Path) -> None:
    """M17: a chat turn is the default agent's run, in its folder, with Object's tools."""
    from objectapp import agentrun, toolcatalog
    from objectapp.appstate import state_dir

    _space, client, _ = api
    _set(aiModel="sonnet")
    _chat(client, "Hi", sessionId=SESSION_A)
    (run,) = _runs(fake["log"])
    argv = run["argv"]
    assert argv[0] == "-p" or "-p" in argv
    i = argv.index("--output-format")
    assert argv[i + 1] == "stream-json" and "--verbose" in argv
    assert argv[argv.index("--model") + 1] == "sonnet"
    assert argv[argv.index("--resume") + 1] == SESSION_A
    assert "--strict-mcp-config" in argv
    assert argv[argv.index("--setting-sources") + 1] == "project,local"
    allowed = set(argv[argv.index("--allowedTools") + 1].split(","))
    assert {f"mcp__object__{t}" for t in toolcatalog.OBJECT_READ + toolcatalog.OBJECT_WRITE} <= allowed
    denied = set(argv[argv.index("--disallowedTools") + 1].split(","))
    assert {"Bash", "PowerShell"} <= denied  # the shell is off by default
    server = run["mcpConfig"]["mcpServers"]["object"]
    assert server["command"] == sys.executable
    assert server["args"] == ["-m", "objectapp.mcp_server"]
    assert server["env"]["OBJECT_API_URL"] == "http://testserver"
    # The secret travels in the environment, never in the config file.
    assert server["env"]["OBJECT_API_TOKEN"] == "${OBJECT_API_TOKEN}"
    assert run["mcpConfig"]["mcpServers"]["object-agent"]["args"] == ["-m", "objectapp.agent_mcp"]
    assert run["token"].startswith("obj_") and run["url"] == "http://testserver"
    cwd = Path(run["cwd"]).resolve()
    assert cwd == (state_dir() / "agents" / "Assistant").resolve()
    assert space_dir.resolve() not in (cwd, *cwd.parents)
    assert run["appendPrompt"].startswith(agentrun.OBJECT_GUIDANCE.format(agent="Assistant", space=_space.name)[:40])
    deny = run["runSettings"]["permissions"]["deny"]
    assert f"Read({agentrun.rule_path(space_dir.resolve())}/**)" in deny
    config_file = Path(argv[argv.index("--mcp-config") + 1])
    assert not config_file.exists() and not config_file.parent.exists()  # removed after the turn


def test_no_model_or_resume_flags_by_default(api, fake) -> None:
    _space, client, _ = api
    _chat(client)
    (run,) = _runs(fake["log"])
    assert "--model" not in run["argv"] and "--resume" not in run["argv"]


def test_expired_session_retries_fresh_with_history(api, fake) -> None:
    _space, client, _ = api
    history = [
        {"role": "user", "text": "Earlier question about llamas", "at": "2026-11-05T10:00:00Z"},
        {"role": "assistant", "text": "Earlier answer", "at": "2026-11-05T10:00:01Z"},
    ]
    events = _chat(client, "Next", sessionId=EXPIRED_SESSION, history=history)
    first, second = _runs(fake["log"])
    assert "--resume" in first["argv"] and "Earlier question" not in first["prompt"]
    assert "--resume" not in second["argv"] and "Earlier question about llamas" in second["prompt"]
    done = _done(events)
    assert done["sessionId"] and done["sessionId"] != EXPIRED_SESSION
    assert not [e for e in events if e["type"] == "error"]


def test_history_is_sent_only_without_a_session(api, fake) -> None:
    _space, client, _ = api
    history = [{"role": "user", "text": "Older words", "at": "2026-11-05T10:00:00Z"}]
    _chat(client, "Now", history=history)
    _chat(client, "Now", history=history, sessionId=SESSION_B)
    fresh, resumed = _runs(fake["log"])
    assert "Older words" in fresh["prompt"] and "Older words" not in resumed["prompt"]


@pytest.mark.parametrize(
    ("prompt", "needle"),
    [("FAKE:fail", "something broke"), ("FAKE:error", "Something went wrong in the fake")],
)
def test_failures_answer_an_error_event(api, prompt: str, needle: str) -> None:
    _space, client, _ = api
    events = _chat(client, prompt)
    assert events[-1]["type"] == "error" and needle in events[-1]["message"]
    assert not [e for e in events if e["type"] == "done"]


def test_not_signed_in_says_how_to_sign_in(api) -> None:
    _space, client, _ = api
    events = _chat(client, "FAKE:auth")
    msg = events[-1]["message"]
    assert events[-1]["type"] == "error"
    assert "sign in" in msg.lower() and "claude" in msg


def test_missing_cli_answers_an_error_event(api, tmp_path: Path) -> None:
    _space, client, _ = api
    _set(claudePath=str(tmp_path / "nope"))
    events = _chat(client)
    assert events == [{"type": "error", "message": events[0]["message"]}]
    assert "not found" in events[0]["message"].lower()


def test_ai_hidden_refuses_the_chat(api) -> None:
    _space, client, _ = api
    _set(aiHidden=True)
    res = client.post("/api/ai/chat", json={"mode": "chat", "prompt": "x", "contextPaths": [], "history": []})
    assert res.status_code == 403


def test_bad_mode_is_422(api) -> None:
    _space, client, _ = api
    res = client.post("/api/ai/chat", json={"mode": "nope", "prompt": "x", "contextPaths": [], "history": []})
    assert res.status_code == 422


# -- proposals ------------------------------------------------------------------------


def test_tag_proposal(api) -> None:
    _space, client, _ = api
    for mode in ("tagBlock", "tagObject"):
        events = _chat(client, "FAKE:tags", mode=mode, block="Some block", blockPath="Pages/Notes.md", contextPaths=["People/Ada Lovelace.md"])
        assert _done(events)["proposal"] == {"kind": "tags", "tags": ["Math", "history", "Ideas"]}


def test_tag_prompt_lists_existing_tags(api, fake) -> None:
    _space, client, _ = api
    _chat(client, "", mode="tagBlock", block="A block about docs", blockPath="Pages/Notes.md")
    (run,) = _runs(fake["log"])
    assert "Docs" in run["prompt"] and "A block about docs" in run["prompt"]
    assert "```json" in run["prompt"]


def test_autofill_proposal_keeps_only_empty_properties(api, fake) -> None:
    _space, client, _ = api
    events = _chat(client, "FAKE:props", mode="autofill", contextPaths=["People/Ada Lovelace.md"])
    assert _done(events)["proposal"] == {"kind": "properties", "values": {"description": "A mathematician."}}
    (run,) = _runs(fake["log"])
    assert "description" in run["prompt"]


def test_text_proposal(api) -> None:
    _space, client, _ = api
    events = _chat(client, "FAKE:text", mode="rephrase", block="a unclear sentence", blockPath="Pages/Notes.md")
    assert _done(events)["proposal"] == {"kind": "text", "text": "A clearer sentence.\nSecond line."}


def test_malformed_proposal_is_null(api) -> None:
    _space, client, _ = api
    events = _chat(client, "FAKE:badjson", mode="tagBlock", block="b", blockPath="Pages/Notes.md")
    assert _done(events)["proposal"] is None
    events = _chat(client, "FAKE:tags", mode="chat")
    assert _done(events)["proposal"] is None  # chat proposes nothing


def test_parse_proposal_unit() -> None:
    p = ai.parse_proposal
    assert p("tagBlock", 'x\n```json\n{"tags": ["a", "#b", "", 3, "A"]}\n```') == {"kind": "tags", "tags": ["a", "b"]}
    assert p("tagBlock", '```json\n{"tags": ["1","2","3","4","5","6"]}\n```')["tags"] == ["1", "2", "3", "4", "5"]
    assert p("tagBlock", '```json\n{"tags": []}\n```') is None
    assert p("tagBlock", '```json\n["a"]\n```') is None
    assert p("tagBlock", "no block") is None
    # the last block wins
    two = '```json\n{"tags": ["first"]}\n```\nthen\n```json\n{"tags": ["second"]}\n```'
    assert p("tagObject", two) == {"kind": "tags", "tags": ["second"]}
    assert p("autofill", '```json\n{"values": {"a": 1, "b": "x"}}\n```') == {
        "kind": "properties", "values": {"a": 1, "b": "x"}}
    assert p("autofill", '```json\n{"values": {"a": 1}}\n```', allowed_keys={"b"}) is None
    assert p("autofill", '```json\n{"values": "x"}\n```') is None
    assert p("rephrase", "```text\nNew words\n```") == {"kind": "text", "text": "New words"}
    assert p("rephrase", "````text\nhas ``` inside\n````") == {"kind": "text", "text": "has ``` inside"}
    assert p("rephrase", "nothing fenced") is None
    assert p("chat", "```text\nx\n```") is None
    assert p("askBlock", '```json\n{"tags": ["a"]}\n```') is None


# -- context --------------------------------------------------------------------------


def test_excluded_and_template_pages_never_reach_the_prompt(full_space_dir: Path, fake) -> None:
    alpha = full_space_dir / "Pages" / "Alpha.md"
    alpha.write_text(
        alpha.read_text(encoding="utf-8").replace("title: Alpha", "title: Alpha\nexcludeFromAI: true"),
        encoding="utf-8",
    )
    _space, app, _ = _app(full_space_dir)
    client = TestClient(app)
    paths = ["Pages/Alpha.md", "Templates/Tasks/Bug report.md", "People/Ada Lovelace.md", "Pages/Nope.md"]
    events = _chat(client, "Summarise", contextPaths=paths)
    done = _done(events)
    assert done["skipped"] == [
        {"path": "Pages/Alpha.md", "reason": "excluded"},
        {"path": "Templates/Tasks/Bug report.md", "reason": "template"},
        {"path": "Pages/Nope.md", "reason": "missing"},
    ]
    (run,) = _runs(fake["log"])
    assert "first published algorithm" in run["prompt"]
    assert "collides with the server" not in run["prompt"]
    assert "Steps to reproduce" not in run["prompt"]


def test_tag_excluded_page_is_skipped(space_dir: Path, fake) -> None:
    ada = space_dir / "People" / "Ada Lovelace.md"
    ada.write_text(ada.read_text(encoding="utf-8").replace("tags: [Math]", "tags: [Math, Exclude from AI]"),
                   encoding="utf-8")
    _space, app, _ = _app(space_dir)
    events = _chat(TestClient(app), "x", contextPaths=["People/Ada Lovelace.md"])
    assert _done(events)["skipped"] == [{"path": "People/Ada Lovelace.md", "reason": "excluded"}]
    assert "first published algorithm" not in _runs(fake["log"])[0]["prompt"]


def test_context_is_capped(space_dir: Path, monkeypatch) -> None:
    space = Space(space_dir)
    monkeypatch.setattr(ai, "MAX_CONTEXT_CHARS", 40)
    pack = ai.gather_context(space, ["People/Ada Lovelace.md", "Pages/Notes.md"])
    assert pack.truncated
    assert sum(len(p.text) for p in pack.pages) <= 40
    assert pack.skipped == [{"path": "Pages/Notes.md", "reason": "tooLong"}]  # left out entirely by the cap
    prompt = ai.build_prompt("chat", "q", pack)
    assert "cut" in prompt.lower()


def _exclude_ada(space_dir: Path) -> None:
    ada = space_dir / "People" / "Ada Lovelace.md"
    ada.write_text(ada.read_text(encoding="utf-8").replace("tags: [Math]", "tags: [Math, Exclude from AI]"),
                   encoding="utf-8")


def test_block_of_an_excluded_page_is_refused(space_dir: Path, fake) -> None:
    _exclude_ada(space_dir)
    _space, app, _ = _app(space_dir)
    client = TestClient(app)
    secret = "Wrote the first published algorithm."
    for extra in ({"blockPath": "People/Ada Lovelace.md"}, {}, {"blockPath": "Pages/Nope.md"}):
        events = _chat(client, "", mode="askBlock", block=secret, **extra)
        assert events == [{"type": "error", "message": "This page is excluded from AI, so its text can't be sent."}]
    assert _runs(fake["log"]) == []  # the CLI never started


def test_block_of_a_template_is_refused(full_space_dir: Path, fake) -> None:
    _space, app, _ = _app(full_space_dir)
    events = _chat(TestClient(app), "", mode="rephrase", block="Steps to reproduce",
                   blockPath="Templates/Tasks/Bug report.md")
    assert [e["type"] for e in events] == ["error"]
    assert _runs(fake["log"]) == []


def test_block_of_a_visible_page_or_an_answer_is_sent(api, fake) -> None:
    _space, client, _ = api
    _done(_chat(client, "", mode="askBlock", block="Block words", blockPath="Pages/Notes.md"))
    history = [{"role": "assistant", "text": "An earlier answer", "at": "2026-11-05T10:00:00Z"}]
    _done(_chat(client, "", mode="rephrase", block="An earlier answer", history=history))
    first, second = _runs(fake["log"])
    assert "Block words" in first["prompt"] and "An earlier answer" in second["prompt"]


def test_relations_to_excluded_pages_are_left_out(full_space_dir: Path, fake) -> None:
    _exclude_ada(full_space_dir)
    _space, app, _ = _app(full_space_dir)
    _done(_chat(TestClient(app), "x", contextPaths=["Projects/Object app.md"]))
    prompt = _runs(fake["log"])[0]["prompt"]
    assert "Lead: Ada Lovelace" not in prompt
    assert "Members: Alpha" in prompt and "Members: Ada" not in prompt


def test_history_is_capped_keeping_the_newest(api, fake, monkeypatch) -> None:
    from objectapp import api_ai

    _space, client, _ = api
    history = [{"role": "user", "text": f"message-{i:03d}", "at": ""} for i in range(150)]
    _chat(client, "Now", history=history)
    prompt = _runs(fake["log"])[0]["prompt"]
    assert "message-149" in prompt and "message-050" in prompt and "message-049" not in prompt
    monkeypatch.setattr(api_ai, "MAX_TEXT", 25)
    big = [{"role": "user", "text": "old-" + "x" * 20, "at": ""}, {"role": "user", "text": "newest-words", "at": ""}]
    _chat(client, "Now", history=big)
    prompt = _runs(fake["log"])[1]["prompt"]
    assert "newest-words" in prompt and "old-" not in prompt


def test_a_session_id_that_is_not_a_uuid_is_ignored(api, fake, space_dir: Path) -> None:
    _space, client, _ = api
    _chat(client, "Hi", sessionId="--help")
    _chat(client, "Hi", sessionId=f"{SESSION_A} --x")
    for run in _runs(fake["log"]):
        assert "--resume" not in run["argv"]
    _code, made = _save(client, title="Bad session", sessionId=SESSION_A)
    p = space_dir / made["path"]
    p.write_text(p.read_text(encoding="utf-8").replace(f"session: {SESSION_A}", "session: '-x'"), encoding="utf-8")
    assert client.get("/api/ai/chat", params={"path": made["path"]}).json()["sessionId"] is None
    _code, made2 = _save(client, title="Bad session two", sessionId="not-a-uuid")
    assert client.get("/api/ai/chat", params={"path": made2["path"]}).json()["sessionId"] is None


def test_a_turn_writes_no_file(api, space_dir: Path, fake) -> None:
    _space, client, published = api
    before = _snapshot(space_dir)
    with client:
        _chat(client, "FAKE:tool hi", contextPaths=["People/Ada Lovelace.md", "Pages/Alpha.md"])
        _chat(client, "FAKE:tags", mode="tagObject", contextPaths=["People/Ada Lovelace.md"])
        _wait(published, 4)
    assert _snapshot(space_dir) == before
    # M17: only the transcripts are written (in the agent's folder), announced as agentChats.
    assert published and {e.kind for e in published} == {"agentChats"}


# -- the token ------------------------------------------------------------------------


def test_ephemeral_token_unit(tmp_path: Path) -> None:
    store = TokenStore(tmp_path / "space", tmp_path / "state")
    record, secret = store.ephemeral("AI assistant")
    assert record.scope == "read" and record.name == "AI assistant"
    assert store.verify(secret) is record
    assert store.list() == []
    assert TokenStore(tmp_path / "other", tmp_path / "state").verify(secret) is None
    assert not (tmp_path / "state").exists()  # nothing written
    assert TokenStore.drop_ephemeral(secret) is True
    assert store.verify(secret) is None
    assert TokenStore.drop_ephemeral(secret) is False


def test_turn_token_works_during_the_turn_only(space_dir: Path, fake) -> None:
    from objectapp.appstate import state_dir

    _space, app, _ = _app(space_dir)
    client = TestClient(app)
    log: Path = fake["log"]
    answers: list = []
    with client:
        # M17: a chat turn's token is read-write, so the no-write check runs on a proposal turn.
        worker = threading.Thread(target=lambda: answers.append(_chat(client, "FAKE:wait", mode="tagObject")))
        worker.start()
        deadline = time.monotonic() + 20
        while not _runs(log) and time.monotonic() < deadline:
            time.sleep(0.05)
        token = _runs(log)[0]["token"]
        hdr = {"Authorization": f"Bearer {token}"}
        who = client.get("/api/v1/whoami", headers=hdr)
        assert who.status_code == 200, who.text
        assert who.json()["name"] == "Assistant" and who.json()["scope"] == "read"
        made = client.post("/api/v1/objects", headers=hdr, json={"type": "Page", "title": "AI wrote"})
        assert made.status_code == 403
        files = [
            p for base in (space_dir, state_dir()) for p in base.rglob("*")
            if p.is_file() and token.encode() in p.read_bytes()
        ]
        assert files == []
        Path(str(log) + ".go").write_text("go", encoding="utf-8")
        worker.join(30)
        assert answers and answers[0][-1]["type"] == "done"
        assert client.get("/api/v1/whoami", headers=hdr).status_code == 401
    assert not (space_dir / "Pages" / "AI wrote.md").exists()


# -- timeout and cancel ---------------------------------------------------------------


def test_timeout_kills_the_process(api, fake, monkeypatch) -> None:
    _space, client, _ = api
    monkeypatch.setattr(ai, "TURN_TIMEOUT", 1.5)
    started = time.monotonic()
    events = _chat(client, "FAKE:sleep")
    assert time.monotonic() - started < 20
    assert events[-1]["type"] == "error" and "took too long" in events[-1]["message"]
    (run,) = _runs(fake["log"])
    assert not _alive(run["pid"])


def _plain_run(claude: str, cwd: Path):
    """A bare `RunCommand` for `Turn.run` (M17 made it required)."""
    import tempfile

    from objectapp.agentrun import RunCommand

    def run(resume: str | None) -> RunCommand:
        tmp = Path(tempfile.mkdtemp(prefix="object-test-run-"))
        args = [claude, "-p", "--output-format", "stream-json"] + (["--resume", resume] if resume else [])
        return RunCommand(args=args, cwd=cwd, env=dict(os.environ), tmp=tmp, mcp_config={},
                          run_settings={}, append="")

    return run


def test_closing_the_stream_kills_the_process(space_dir: Path, fake, tmp_path: Path) -> None:
    space = Space(space_dir)
    turn = ai.Turn(
        run=_plain_run(str(fake["path"]), tmp_path),
        claude=str(fake["path"]),
        mode="chat",
        prompt_resume=None,
        prompt_fresh="FAKE:sleep",
        session_id=None,
        model=None,
        api_url="http://127.0.0.1:9",
        token="obj_x",
    )

    async def go() -> dict:
        gen = ai.run_turn(turn)
        first = await gen.__anext__()
        await gen.aclose()
        return first

    first = asyncio.run(go())
    assert first["type"] == "session"
    (run,) = _runs(fake["log"])
    deadline = time.monotonic() + 5
    while _alive(run["pid"]) and time.monotonic() < deadline:
        time.sleep(0.05)
    assert not _alive(run["pid"])
    assert space.root.is_dir()


# -- no network -----------------------------------------------------------------------


@pytest.mark.parametrize("module", [
    "ai.py", "aichat.py", "api_ai.py", "aimodels.py",
    "agentmodel.py", "toolcatalog.py", "agents.py", "agentfiles.py", "transcripts.py", "agentrun.py", "api_agents.py",
])
def test_ai_modules_use_no_network_client(module: str) -> None:
    tree = ast.parse((BACKEND / module).read_text(encoding="utf-8"))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            names.add(node.module.split(".")[0])
    banned = {"httpx", "urllib", "urllib3", "requests", "socket", "http", "aiohttp", "ssl", "websockets"}
    assert not names & banned, names & banned


# -- saved chats ----------------------------------------------------------------------

MESSAGES = [
    {"role": "user", "text": "What is in my notes about Ada?", "at": "2026-11-05T12:00:00.000Z"},
    {
        "role": "assistant",
        "text": "Here is code:\n\n```md\n## You\nnot a heading\n## Claude\n```\n\nDone.",
        "at": "2026-11-05T12:00:05.000Z",
    },
    {"role": "user", "text": "## Claude\nliteral heading line\n\\## You", "at": "2026-11-05T12:01:00.000Z"},
]


def _save(client: TestClient, **body) -> tuple[int, dict]:
    req = {"title": "", "contextPaths": [], "sessionId": None, "messages": MESSAGES, "clientId": "win-1", **body}
    res = client.post("/api/ai/chat/save", json=req)
    return res.status_code, res.json()


def _wait(published: list, count: int) -> None:
    deadline = time.monotonic() + 5
    while len(published) < count and time.monotonic() < deadline:
        time.sleep(0.01)


def test_save_creates_the_type_and_the_chat(api, space_dir: Path) -> None:
    space, client, published = api
    assert not (space_dir / ".object" / "types" / "ai-chat.json").exists()
    with client:
        code, made = _save(
            client, contextPaths=["People/Ada Lovelace.md", "Pages/Nope.md"], sessionId=SESSION_A
        )
        assert code == 200, made
        _wait(published, 3)
    path = made["path"]
    assert path.startswith("AI Chats/") and path.endswith(".md")
    assert (space_dir / ".object" / "types" / "ai-chat.json").is_file()
    t = space.type_by_id("ai-chat")
    assert t.name == "AI Chat" and t.pluralName == "AI Chats"
    props = {p.key: p for p in t.propertyDefinitions}
    assert props["context"].type == "entity" and props["context"].options["isArray"] is True
    assert props["context"].name == "Context"
    assert props["session"].type == "text" and props["session"].name == "Session"
    text = (space_dir / path).read_text(encoding="utf-8")
    assert "type: 'AI Chat'" in text and f"session: {SESSION_A}" in text
    assert "Ada Lovelace" in text.split("---")[1]
    assert "## You" in text and "## Claude" in text
    assert {e.origin for e in published} == {"win-1"}
    assert {e.kind for e in published} >= {"types", "created"}
    loaded = client.get("/api/ai/chat", params={"path": path}).json()
    assert loaded["contextPaths"] == ["People/Ada Lovelace.md"]
    assert loaded["title"] == "What is in my notes about Ada?"
    assert loaded["version"] == made["version"]


def test_load_round_trips_messages(api) -> None:
    _space, client, _ = api
    _code, made = _save(client, title="Round trip", sessionId=SESSION_C)
    loaded = client.get("/api/ai/chat", params={"path": made["path"]}).json()
    assert loaded["messages"] == MESSAGES
    assert loaded["sessionId"] == SESSION_C and loaded["title"] == "Round trip"
    assert loaded["path"] == made["path"] and loaded["contextPaths"] == []


def test_second_save_replaces_messages_and_stale_is_409(api, space_dir: Path) -> None:
    _space, client, _ = api
    _code, made = _save(client, title="Chat A")
    more = [*MESSAGES, {"role": "assistant", "text": "Another answer", "at": "2026-11-05T12:02:00.000Z"}]
    code, saved = _save(client, title="Chat A", path=made["path"], baseVersion=made["version"],
                        messages=more, sessionId=SESSION_B, contextPaths=["People/Ada Lovelace.md"])
    assert code == 200, saved
    assert saved["path"] == made["path"] and saved["version"] != made["version"]
    loaded = client.get("/api/ai/chat", params={"path": made["path"]}).json()
    assert loaded["messages"] == more and loaded["sessionId"] == SESSION_B
    assert loaded["contextPaths"] == ["People/Ada Lovelace.md"]
    before = (space_dir / made["path"]).read_bytes()
    code, stale = _save(client, title="Chat A", path=made["path"], baseVersion=made["version"], messages=MESSAGES)
    assert code == 409 and stale["currentVersion"] == saved["version"]
    assert (space_dir / made["path"]).read_bytes() == before
    assert len(list((space_dir / "AI Chats").glob("*.md"))) == 1


def test_save_keeps_crlf(api, space_dir: Path) -> None:
    _space, client, _ = api
    _code, made = _save(client, title="Line endings")
    p = space_dir / made["path"]
    p.write_bytes(p.read_bytes().replace(b"\n", b"\r\n"))
    version = client.get("/api/ai/chat", params={"path": made["path"]}).json()["version"]
    code, saved = _save(client, title="Line endings", path=made["path"], baseVersion=version,
                        messages=MESSAGES[:1])
    assert code == 200, saved
    data = p.read_bytes()
    assert b"\r\n" in data and b"\n" not in data.replace(b"\r\n", b"")


def test_title_defaults_to_the_first_user_message(api) -> None:
    _space, client, _ = api
    long = "word " * 40
    _code, made = _save(client, messages=[{"role": "user", "text": long, "at": "2026-11-05T12:00:00.000Z"}])
    title = client.get("/api/ai/chat", params={"path": made["path"]}).json()["title"]
    assert 0 < len(title) <= 61 and title.startswith("word word")


def test_rename_on_a_new_title(api, space_dir: Path) -> None:
    _space, client, _ = api
    _code, made = _save(client, title="Old name")
    code, saved = _save(client, title="New name", path=made["path"], baseVersion=made["version"])
    assert code == 200, saved
    assert saved["path"].endswith("New name.md") and (space_dir / saved["path"]).is_file()
    assert client.get("/api/ai/chat", params={"path": saved["path"]}).json()["title"] == "New name"


def test_load_errors(api) -> None:
    _space, client, _ = api
    assert client.get("/api/ai/chat", params={"path": "AI Chats/Nope.md"}).status_code == 404
    assert client.get("/api/ai/chat", params={"path": "../x.md"}).status_code == 400


def test_save_refuses_bad_messages(api) -> None:
    _space, client, _ = api
    code, _ = _save(client, messages=[{"role": "robot", "text": "x", "at": ""}])
    assert code == 422


def test_existing_ai_chat_type_is_reused(space_dir: Path, fake) -> None:
    space, app, _ = _app(space_dir)
    space.create_type("AI Chat", "AI Chats")
    client = TestClient(app)
    code, made = _save(client, title="Reuse")
    assert code == 200, made
    t = space.type_by_id("ai-chat")
    assert {"context", "session"} <= {p.key for p in t.propertyDefinitions}
    assert [x.name for x in space.types].count("AI Chat") == 1


def test_markdown_format_unit() -> None:
    body = aichat.render_body("T", MESSAGES)
    assert body.startswith("# T\n")
    assert aichat.parse_body(body) == MESSAGES
    # an unclosed fence in a message doesn't swallow the messages after it
    msgs = [
        {"role": "user", "text": "open\n```\ncode", "at": "2026-11-05T12:00:00.000Z"},
        {"role": "assistant", "text": "after", "at": "2026-11-05T12:00:01.000Z"},
    ]
    parsed = aichat.parse_body(aichat.render_body("T", msgs))
    assert [m["role"] for m in parsed] == ["user", "assistant"] and parsed[1]["text"] == "after"
    # a hand-written chat without time lines still reads
    assert aichat.parse_body("## You\nhi\n\n## Claude\nhello\n") == [
        {"role": "user", "text": "hi", "at": ""},
        {"role": "assistant", "text": "hello", "at": ""},
    ]
