"""M16 Task 3: ``tool`` events carry the call's input and, by id, its result.

Unit tests feed stream-json dicts to `ai.StreamParser`; route tests run against the fake
``claude`` (``claudePath`` points at ``backend/tests/fake_claude.py``, ``OBJECT_STATE_DIR``
is a temp folder, see conftest). No test starts a real model.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fake_claude import install
from fastapi.testclient import TestClient
from objectapp import ai
from objectapp import settings as device_settings
from objectapp.ai import ELLIPSIS, TOOL_INPUT_STRING_CAP, TOOL_RESULT_CAP, StreamParser
from objectapp.server import create_app
from objectapp.space import Space

NOW = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)


# -- stream-json builders ------------------------------------------------------------------


def _call(tid: str = "toolu_1", name: str = "mcp__object__search", input_: object = None,
          msg_id: str = "msg_1") -> dict:
    block = {"type": "tool_use", "id": tid, "name": name,
             "input": {"query": "rack"} if input_ is None else input_}
    return {"type": "assistant", "message": {"id": msg_id, "role": "assistant", "content": [block]}}


def _result(tid: str = "toolu_1", content: object = "[]", is_error: bool | None = None) -> dict:
    block: dict = {"type": "tool_result", "tool_use_id": tid, "content": content}
    if is_error is not None:
        block["is_error"] = is_error
    return {"type": "user", "message": {"role": "user", "content": [block]}}


# -- unit tests ------------------------------------------------------------------------------


def test_tool_call_event_has_id_name_input() -> None:
    p = StreamParser()
    assert p.feed(_call()) == [{"type": "tool", "id": "toolu_1", "name": "search", "input": {"query": "rack"}}]


def test_tool_result_event_follows_by_id() -> None:
    p = StreamParser()
    p.feed(_call())
    assert p.feed(_result()) == [
        {"type": "tool", "id": "toolu_1", "name": "search", "input": None, "result": "[]", "isError": False}
    ]


def test_result_blocks_are_joined() -> None:
    p = StreamParser()
    p.feed(_call())
    content = [{"type": "text", "text": "a"}, {"type": "image", "source": {}}, {"type": "text", "text": "b"}]
    (event,) = p.feed(_result(content=content))
    assert event["result"] == "a\n[image]\nb"
    assert ai.short_result([{"type": "document"}]) == "[document]"


def test_error_result_is_flagged() -> None:
    p = StreamParser()
    p.feed(_call())
    (event,) = p.feed(_result(content="nope", is_error=True))
    assert event["isError"] is True and event["result"] == "nope"


def test_caps() -> None:
    p = StreamParser()
    long = "x" * 5_000
    (call,) = p.feed(_call(input_={"outer": {"items": [long, 3]}, "q": "short"}))
    cut = call["input"]["outer"]["items"][0]
    assert cut == "x" * TOOL_INPUT_STRING_CAP + ELLIPSIS
    assert len(cut) == 1_001 and call["input"]["outer"]["items"][1] == 3
    assert call["input"]["q"] == "short"
    (res,) = p.feed(_result(content="y" * 100_000))
    assert res["result"] == "y" * TOOL_RESULT_CAP + ELLIPSIS
    assert len(res["result"]) == 4_001
    assert ai.short_input("x" * 2_000) is None


def test_unknown_or_repeated_result_is_dropped() -> None:
    p = StreamParser()
    assert p.feed(_result(tid="toolu_9")) == []
    p.feed(_call())
    assert len(p.feed(_result())) == 1
    assert p.feed(_result()) == []
    # The final assistant message repeats the call: no second call event.
    assert p.feed(_call()) == []


def test_other_tools_keep_their_names() -> None:
    p = StreamParser()
    (read,) = p.feed(_call(tid="t_a", name="Read", input_={"file_path": "a.md"}))
    assert read["name"] == "Read"
    (mcp,) = p.feed(_call(tid="t_b", name="mcp__srv__lookup", input_={"k": 1}))
    assert mcp["name"] == "mcp__srv__lookup"
    (bad,) = p.feed(_call(tid="t_c", name="Read", input_=["not", "a", "dict"]))
    assert bad["input"] is None
    (res,) = p.feed(_result(tid="t_b", content="ok"))
    assert res["name"] == "mcp__srv__lookup"


def test_short_helpers_are_public() -> None:
    assert {"short_input", "short_result", "TOOL_INPUT_STRING_CAP", "TOOL_RESULT_CAP", "ELLIPSIS"} <= set(ai.__all__)
    assert (TOOL_INPUT_STRING_CAP, TOOL_RESULT_CAP, ELLIPSIS) == (1_000, 4_000, "…")


# -- over HTTP, with the fake CLI --------------------------------------------------------------


def _set(**patch) -> None:
    _data, revision = device_settings.read()
    device_settings.patch(patch, revision)


@pytest.fixture
def fake(tmp_path: Path, monkeypatch) -> dict:
    path = install(tmp_path / "bin")
    log = tmp_path / "claude-log.jsonl"
    monkeypatch.setenv("FAKE_CLAUDE_LOG", str(log))
    monkeypatch.delenv("FAKE_CLAUDE_VERSION_FAIL", raising=False)
    _set(claudePath=str(path))
    return {"path": path, "log": log}


@pytest.fixture
def client(space_dir: Path, fake) -> TestClient:
    space = Space(space_dir)
    space.clock = lambda: NOW
    app = create_app(space, None, watch=False)
    app.state.hub.publish = lambda _event: None
    return TestClient(app)


def _frames(raw: str) -> list[dict]:
    out = []
    for frame in raw.split("\n\n"):
        data = [line[5:].lstrip(" ") for line in frame.split("\n") if line.startswith("data:")]
        if data:
            out.append(json.loads("\n".join(data)))
    return out


def _chat(client: TestClient, prompt: str) -> list[dict]:
    body = {"mode": "chat", "prompt": prompt, "contextPaths": [], "history": []}
    res = client.post("/api/ai/chat", json=body)
    assert res.status_code == 200, res.text
    return _frames(res.text)


def test_tool_results_never_reach_text(client) -> None:
    events = _chat(client, "FAKE:tool find alpha")
    kinds = [e["type"] for e in events]
    first_tool = kinds.index("tool")
    assert kinds[0] == "session" and kinds[-1] == "done"
    assert "text" in kinds[:first_tool]
    assert kinds[first_tool : first_tool + 2] == ["tool", "tool"]
    assert "text" in kinds[first_tool + 2 : -1]
    assert kinds.count("tool") == 2
    call, result = events[first_tool], events[first_tool + 1]
    assert call == {"type": "tool", "id": "toolu_1", "name": "search", "input": {"query": "alpha"}}
    assert result == {"type": "tool", "id": "toolu_1", "name": "search", "input": None,
                      "result": "[]", "isError": False}
    text = "".join(e["text"] for e in events if e["type"] == "text")
    assert text == "Let me look.\n\nHello from the fake claude."
    assert events[-1]["text"] == "Hello from the fake claude."


def test_tool_error_over_http(client) -> None:
    events = _chat(client, "FAKE:toolerror find alpha")
    results = [e for e in events if e["type"] == "tool" and "result" in e]
    assert len(results) == 1
    assert results[0]["isError"] is True
    assert results[0]["result"] == "Search failed: index busy"
    assert "Search failed" not in "".join(e["text"] for e in events if e["type"] == "text")
