"""M18 Task 1: the live CLI check of the flags a review adds (``--fork-session``,
``--no-session-persistence``). Runs the real ``claude`` (Gene's login).

Skipped unless ``OBJECT_LIVE_CLAUDE=1``. It uses M17's live setup (`test_m17_live_cli`'s
`make_agent`: a temp agent folder under a temp state dir, its long path, the parent-session
variables removed) with M17's ``CLI_FLAGS`` and the ``haiku`` alias.

Tests never write to ``~/.claude``, so no live test can make a session to resume. The check is
limited to what runs without one: resuming a random session id with the review's flags must fail
with the CLI's unknown-session answer, not "unknown option" and not a refusal of the flag
combination. The fork's real behaviour (the chat's session unchanged after a review) is a hand
check for Gene in ``m18-acceptance.md``. Findings: ``docs/superpowers/plans/m18-cli-notes.md``.
"""

from __future__ import annotations

import json
import os
import subprocess
import uuid
from pathlib import Path

import pytest
from test_m17_live_cli import (
    CLI_FLAGS,
    MODEL,
    PARENT_SESSION_VARS,
    RUN_SETTINGS_BASE,
    TIMEOUT,
    _claude,
    claude_md_excludes,
    make_agent,
)

from objectapp import toolcatalog

live = pytest.mark.skipif(
    os.environ.get("OBJECT_LIVE_CLAUDE") != "1", reason="live CLI check: set OBJECT_LIVE_CLAUDE=1"
)

UNKNOWN_SESSION = "No conversation found with session ID"
"""The CLI's answer for a ``--resume`` id it doesn't know (2.1.317; also what the fake says)."""


def _run(tmp: Path, folder: Path, extra: list[str]) -> subprocess.CompletedProcess[str]:
    run = Path(tmp).resolve() / "run"
    run.mkdir(exist_ok=True)
    (run / "mcp.json").write_text(json.dumps({"mcpServers": {}}), encoding="utf-8")
    settings = {
        **RUN_SETTINGS_BASE,
        "claudeMdExcludes": claude_md_excludes(folder, Path.home()),
        "permissions": {"deny": []},
    }
    (run / "run-settings.json").write_text(json.dumps(settings), encoding="utf-8")
    (run / "append.md").write_text("You are running inside Object's test.", encoding="utf-8")
    lists = toolcatalog.run_tool_lists(toolcatalog.default_off(), write=False, folder_servers=[])
    args = [
        _claude(), *CLI_FLAGS,
        "--mcp-config", str(run / "mcp.json"),
        "--settings", str(run / "run-settings.json"),
        "--append-system-prompt-file", str(run / "append.md"),
        "--allowedTools", ",".join(lists.allowed),
        "--disallowedTools", ",".join(lists.disallowed),
        "--model", MODEL, *extra,
    ]
    run_env = {k: v for k, v in os.environ.items() if not k.startswith(PARENT_SESSION_VARS)}
    return subprocess.run(
        args, input="Look back over this chat.", capture_output=True, text=True, encoding="utf-8",
        errors="replace", cwd=folder, env=run_env, timeout=TIMEOUT,
    )


@live
def test_fork_flags_parse(tmp_path: Path) -> None:
    _state, folder = make_agent(tmp_path)
    missing = str(uuid.uuid4())
    res = _run(tmp_path, folder, ["--resume", missing, "--fork-session", "--no-session-persistence"])
    out = res.stdout + "\n" + res.stderr
    lowered = out.lower()
    assert res.returncode != 0, out[-2000:]
    assert "unknown option" not in lowered, out[-2000:]
    assert "cannot be used with" not in lowered and "can only be used" not in lowered, out[-2000:]
    assert UNKNOWN_SESSION in out, out[-2000:]
