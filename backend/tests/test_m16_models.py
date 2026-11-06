"""M16 Task 2: the model list route and a model pick per chat, run against the fake ``claude``.

No test here starts a real model: the ``claudePath`` setting points at
``backend/tests/fake_claude.py`` and ``OBJECT_STATE_DIR`` is a temp folder (conftest).
"""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fake_claude import install
from fastapi.testclient import TestClient
from objectapp import settings as device_settings
from objectapp.aimodels import BAD_MODEL, MODEL_PATTERN, MODELS
from objectapp.server import create_app
from objectapp.space import Space

NOW = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)
SESSION_S = "0f8fad5b-d9cb-469f-a165-70867728950e"


# -- helpers (copied from test_m10_ai.py) -----------------------------------------------


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


@pytest.fixture
def api(space_dir: Path, fake):
    space = Space(space_dir)
    space.clock = lambda: NOW
    app = create_app(space, None, watch=False)
    app.state.hub.publish = lambda _event: None
    return space, TestClient(app)


def _frames(raw: str) -> list[dict]:
    out = []
    for frame in raw.split("\n\n"):
        data = [line[5:].lstrip(" ") for line in frame.split("\n") if line.startswith("data:")]
        if data:
            out.append(json.loads("\n".join(data)))
    return out


def _post(client: TestClient, prompt: str = "Hi", **extra):
    body = {"mode": "chat", "prompt": prompt, "contextPaths": [], "history": [], **extra}
    return client.post("/api/ai/chat", json=body)


def _chat(client: TestClient, prompt: str = "Hi", **extra) -> list[dict]:
    res = _post(client, prompt, **extra)
    assert res.status_code == 200, res.text
    return _frames(res.text)


def _model(run: dict) -> str | None:
    argv = run["argv"]
    return argv[argv.index("--model") + 1] if "--model" in argv else None


# -- the route --------------------------------------------------------------------------


def test_models_route_lists_the_constant(api) -> None:
    _space, client = api
    res = client.get("/api/ai/models")
    assert res.status_code == 200
    body = res.json()
    assert body["models"] == [asdict(m) for m in MODELS]
    assert body["pattern"] == MODEL_PATTERN
    _set(aiHidden=True)
    hidden = client.get("/api/ai/models")
    assert hidden.status_code == 200 and hidden.json() == body


# -- the model a turn runs on -------------------------------------------------------------


def test_chat_pick_passes_model_flag(api, fake) -> None:
    _space, client = api
    _set(aiModel="sonnet")
    _chat(client, model="claude-opus-5-5")
    (run,) = _runs(fake["log"])
    assert _model(run) == "claude-opus-5-5"
    assert "sonnet" not in run["argv"]


def test_default_pick_uses_the_setting_then_nothing(api, fake) -> None:
    _space, client = api
    _set(aiModel="sonnet")
    _chat(client)
    _set(aiModel=None)
    _chat(client, model=None)
    _chat(client, model="")
    first, second, third = _runs(fake["log"])
    assert _model(first) == "sonnet" and first["model"] == "sonnet"
    assert "--model" not in second["argv"] and second["model"] is None
    assert "--model" not in third["argv"]


def test_custom_model_id_passes_through(api, fake) -> None:
    _space, client = api
    _chat(client, model="claude-opus-5-5[1m]")
    (run,) = _runs(fake["log"])
    assert _model(run) == "claude-opus-5-5[1m]"


@pytest.mark.parametrize("bad", ["-p", "--dangerously-skip-permissions", "a b", "$(x)", "x" * 81])
def test_bad_model_is_422_and_cli_not_run(api, fake, bad: str) -> None:
    _space, client = api
    res = _post(client, model=bad)
    assert res.status_code == 422
    assert res.json()["detail"] == "That isn't a model name." == BAD_MODEL
    assert _runs(fake["log"]) == []


def test_model_change_mid_chat_resumes_with_new_model(api, fake) -> None:
    _space, client = api
    events = _chat(client, model="sonnet")
    session = events[-1]["sessionId"]
    assert session
    _chat(client, "Next", sessionId=session, model="claude-haiku-5-5")
    first, second = _runs(fake["log"])
    assert _model(first) == "sonnet"
    argv = second["argv"]
    assert argv[argv.index("--resume") + 1] == session
    assert _model(second) == "claude-haiku-5-5"


def test_resume_refused_after_model_change_replays_history(api, fake) -> None:
    _space, client = api
    history = [
        {"role": "user", "text": "Earlier question about llamas", "at": "2026-11-05T10:00:00Z"},
        {"role": "assistant", "text": "Earlier answer about alpacas", "at": "2026-11-05T10:00:01Z"},
    ]
    events = _chat(client, "FAKE:modelswitch next", sessionId=SESSION_S, model="opus", history=history)
    first, second = _runs(fake["log"])
    assert first["argv"][first["argv"].index("--resume") + 1] == SESSION_S
    assert _model(first) == "opus"
    assert "--resume" not in second["argv"] and _model(second) == "opus"
    assert "Earlier question about llamas" in second["prompt"]
    assert "Earlier answer about alpacas" in second["prompt"]
    assert events[-1]["type"] == "done"
    assert not [e for e in events if e["type"] == "error"]


def test_settings_and_chat_share_the_model_rule(api) -> None:
    _space, client = api
    revision = client.get("/api/settings").json()["revision"]
    bad = client.put("/api/settings", json={"patch": {"aiModel": "a b"}, "baseRevision": revision})
    assert bad.status_code == 422
    good = client.put("/api/settings", json={"patch": {"aiModel": "claude-opus-5-5[1m]"}, "baseRevision": revision})
    assert good.status_code == 200, good.text
    assert good.json()["settings"]["aiModel"] == "claude-opus-5-5[1m]"
    assert _post(client, model="a b").status_code == 422


# -- the saved chat ---------------------------------------------------------------------


def test_saved_chat_keeps_markdown_source(api, space_dir: Path) -> None:
    _space, client = api
    source = "# Title\n\n**bold** and `x`\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [ ] task\n\n$x^2$"
    messages = [
        {"role": "user", "text": "Show me Markdown", "at": "2026-11-05T12:00:00.000Z"},
        {"role": "assistant", "text": source, "at": "2026-11-05T12:00:01.000Z"},
    ]
    res = client.post("/api/ai/chat/save", json={"title": "Markdown", "contextPaths": [], "sessionId": None,
                                                 "messages": messages, "clientId": "win-1"})
    assert res.status_code == 200, res.text
    path = res.json()["path"]
    loaded = client.get("/api/ai/chat", params={"path": path}).json()
    assert loaded["messages"] == messages
    assert source in (space_dir / path).read_text(encoding="utf-8")
