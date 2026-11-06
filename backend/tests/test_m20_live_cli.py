"""M20 Task 1: the live CLI spike for the MCP tool-call timeout. Runs the real ``claude`` (Gene's login).

Skipped unless ``OBJECT_LIVE_CLAUDE=1``. It uses M17's live setup (`test_m17_live_cli`'s
`make_agent`: a temp agent folder under a temp ``OBJECT_STATE_DIR``, its long path, the
parent-session variables removed) with M17's ``CLI_FLAGS``, ``--model haiku`` and
``--no-session-persistence``, and a test MCP server (stdio, written into the test's temp folder)
whose one tool ``slow`` sleeps 45 seconds and answers "slow done".

The question: does the CLI honour ``MCP_TOOL_TIMEOUT`` (milliseconds)? M20's "delegation"
contributor sets it on every agent run to ``DELEGATE_TIMEOUT + 60`` seconds, so a long
``delegate`` call isn't cut by the CLI. Nothing reads ``~/.claude`` or any token.

Findings: ``docs/superpowers/plans/m20-spike.md``.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import pytest
from test_m17_live_cli import (
    CLI_FLAGS,
    MODEL,
    PARENT_SESSION_VARS,
    RUN_SETTINGS_BASE,
    _claude,
    _result_text,
    _tool_calls,
    claude_md_excludes,
    make_agent,
)

live = pytest.mark.skipif(
    os.environ.get("OBJECT_LIVE_CLAUDE") != "1", reason="live CLI spike: set OBJECT_LIVE_CLAUDE=1"
)

HERE = Path(__file__).resolve().parent
SLOW_SECONDS = 45
RUN_TIMEOUT = 300

SLOW_SERVER = f'''\
"""A stdio MCP server for the M20 spike: one tool, ``slow``, that sleeps {SLOW_SECONDS} s."""
import time

from mcp.server.mcpserver import MCPServer

server = MCPServer(name="spike")


def slow() -> str:
    """Wait a while, then answer."""
    time.sleep({SLOW_SECONDS})
    return "slow done"


server.add_tool(slow, name="slow")
server.run("stdio")
'''


@pytest.fixture
def agent(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    state, folder = make_agent(tmp_path)
    monkeypatch.setenv("OBJECT_STATE_DIR", str(state))
    return folder


def run_slow(tmp: Path, folder: Path, timeout_ms: int) -> tuple[list[dict[str, Any]], float]:
    """One real ``claude -p`` run that calls ``mcp__spike__slow`` once; (events, seconds taken)."""
    run = Path(tmp).resolve() / f"run-{timeout_ms}"
    run.mkdir(exist_ok=True)
    script = run / "slow_server.py"
    script.write_text(SLOW_SERVER, encoding="utf-8")
    servers = {"spike": {"type": "stdio", "command": sys.executable, "args": [str(script)], "env": {}}}
    (run / "mcp.json").write_text(json.dumps({"mcpServers": servers}), encoding="utf-8")
    settings = {**RUN_SETTINGS_BASE, "claudeMdExcludes": claude_md_excludes(folder, Path.home()),
                "permissions": {"deny": []}}
    (run / "run-settings.json").write_text(json.dumps(settings), encoding="utf-8")
    (run / "append.md").write_text("You are running inside Object's test. Use the tools you are asked to use.",
                                   encoding="utf-8")
    args = [
        _claude(), *CLI_FLAGS,
        "--mcp-config", str(run / "mcp.json"),
        "--settings", str(run / "run-settings.json"),
        "--append-system-prompt-file", str(run / "append.md"),
        "--allowedTools", "mcp__spike",
        "--disallowedTools", "Bash,PowerShell",
        "--model", MODEL, "--no-session-persistence",
    ]
    run_env = {k: v for k, v in os.environ.items() if not k.startswith(PARENT_SESSION_VARS)}
    run_env["MCP_TOOL_TIMEOUT"] = str(timeout_ms)
    prompt = ("Call the tool mcp__spike__slow exactly once, with no arguments, and wait for it. "
              "Do not call it again, whatever it answers. Then answer with the tool's answer, or with the word "
              "FAILED and the error text if it failed.")
    started = time.monotonic()
    res = subprocess.run(args, input=prompt, capture_output=True, text=True, encoding="utf-8", errors="replace",
                         cwd=folder, env=run_env, timeout=RUN_TIMEOUT)
    took = time.monotonic() - started
    events = []
    for line in res.stdout.splitlines():
        try:
            events.append(json.loads(line))
        except ValueError:
            continue
    if not any(e.get("type") == "result" for e in events):
        raise AssertionError(f"no result (exit {res.returncode}): {res.stderr[-2000:]}")
    return events, took


def slow_calls(events: list[dict[str, Any]]) -> list[tuple[str, bool]]:
    """(result text, is_error) per ``mcp__spike__slow`` call; a structured ``{"result"}`` is unwrapped."""
    out = []
    for u, r in _tool_calls(events):
        if u.get("name") != "mcp__spike__slow":
            continue
        text = _result_text(r)
        try:
            data = json.loads(text)
        except ValueError:
            data = None
        if isinstance(data, dict) and set(data) == {"result"}:
            text = str(data["result"])
        out.append((text, bool((r or {}).get("is_error"))))
    return out


def finding(name: str, value: Any) -> None:
    """Spike findings go to stdout (``pytest -s``)."""
    print(f"FINDING {name}: {json.dumps(value)}")


@live
def test_mcp_tool_timeout_is_honoured(tmp_path: Path, agent: Path) -> None:
    version = subprocess.run([_claude(), "--version"], capture_output=True, text=True, timeout=30).stdout.strip()
    finding("cli.version", version)

    short, short_took = run_slow(tmp_path, agent, 20_000)
    short_calls = slow_calls(short)
    finding("timeout.20000.calls", short_calls)
    finding("timeout.20000.seconds", round(short_took, 1))
    assert short_calls, "the model didn't call mcp__spike__slow"
    text, is_error = short_calls[0]
    assert is_error and "slow done" not in text
    assert "timed out" in text.lower() or "timeout" in text.lower()

    long, long_took = run_slow(tmp_path, agent, 120_000)
    long_calls = slow_calls(long)
    finding("timeout.120000.calls", long_calls)
    finding("timeout.120000.seconds", round(long_took, 1))
    assert long_calls, "the model didn't call mcp__spike__slow"
    assert long_calls[0] == ("slow done", False)
    assert long_took >= SLOW_SECONDS


def test_spike_findings_doc_exists() -> None:
    """Not live: the finding the later tasks build on is written down."""
    doc = HERE.parents[1] / "docs" / "superpowers" / "plans" / "m20-spike.md"
    text = doc.read_text(encoding="utf-8")
    for heading in ("CLI version", "MCP_TOOL_TIMEOUT", "Result"):
        assert heading in text
