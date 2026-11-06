"""M17 Task 1: the live CLI spike. Runs the real ``claude`` (Gene's login) and checks that an agent
run in an agent folder loads only that folder's setup and that the fence holds.

Skipped unless ``OBJECT_LIVE_CLAUDE=1``. Each run uses the ``haiku`` alias,
``--no-session-persistence`` (no session is written to ``~/.claude``) and ``--debug-file``.
Nothing here reads ``~/.claude/.credentials.json`` or any token; ``~/.claude/skills/`` is only
listed (directory names) to prove none of them reaches a run. Findings:
``docs/superpowers/plans/m17-cli-spike.md``.

Until the plan's T2 (``agentfiles``) and T4 (``agentrun``) land, the minimal local helpers below
stand in for ``write_skeleton``, ``rule_path``, ``fence_rules`` and ``CLI_FLAGS``; once they exist
the real ones are used.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

from objectapp import agentmodel, toolcatalog
from objectapp.jsonstore import dump_json

pytestmark = pytest.mark.skipif(
    os.environ.get("OBJECT_LIVE_CLAUDE") != "1", reason="live CLI spike: set OBJECT_LIVE_CLAUDE=1"
)

MODEL = "haiku"
TIMEOUT = 240

RUN_SETTINGS: dict[str, Any] = {"autoMemoryEnabled": False}
"""What the spike found a run's settings file must hold besides the fence (m17-cli-spike.md)."""

# -- stand-ins until T2 / T4 --------------------------------------------------------------

try:  # pragma: no cover - which branch runs depends on the build order
    from objectapp.agentrun import CLI_FLAGS, fence_rules, rule_path  # type: ignore[attr-defined]
except ImportError:  # T4 isn't there yet
    CLI_FLAGS = ("-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
                 "--setting-sources", "project,local", "--no-chrome",
                 "--permission-mode", "dontAsk", "--permission-prompts", "none", "--strict-mcp-config",
                 "--tools", "default")

    def rule_path(p: Path) -> str:
        text = str(Path(p).resolve()).replace("\\", "/").rstrip("/")
        if len(text) > 1 and text[1] == ":":
            return "//" + text[0].lower() + text[2:]
        return "/" + text

    def fence_rules(folders: list[Path], own: Path, state: Path, home: Path) -> list[str]:
        rules: list[str] = []
        for f in folders:
            rp = rule_path(f)
            rules += [f"Read({rp}/**)", f"Edit({rp}/**)"]
        o = rule_path(own)
        rules += [f"Edit({o}/CLAUDE.md)", f"Edit({o}/.claude/**)", f"Edit({o}/.object-agent/**)"]
        s = rule_path(state)
        rules += [f"Read({s}/*)", f"Edit({s}/*)", f"Read({s}/automation-logs-*/**)"]
        h = rule_path(home)
        rules += [f"Read({h}/.claude/.credentials.json)", f"Edit({h}/.claude/**)", f"Edit({h}/.claude.json)"]
        return rules

try:  # pragma: no cover
    from objectapp.agentfiles import write_skeleton  # type: ignore[attr-defined]
except ImportError:  # T2 isn't there yet

    def write_skeleton(folder: Path, data: dict[str, Any], instructions: str) -> None:
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "CLAUDE.md").write_text(instructions, encoding="utf-8")
        (folder / ".claude").mkdir(exist_ok=True)
        deny: list[str] = []
        for entry in toolcatalog.BUILTINS:
            if entry.id in data.get("toolsOff", []):
                deny += list(entry.cli)
        deny += ["Edit(./CLAUDE.md)", "Edit(./.claude/**)", "Edit(./.object-agent/**)"]
        (folder / ".claude" / "settings.json").write_bytes(dump_json({"permissions": {"deny": deny}}))
        (folder / ".object-agent" / "sessions").mkdir(parents=True, exist_ok=True)
        (folder / ".object-agent" / "agent.json").write_bytes(dump_json(data))
        (folder / ".gitignore").write_text(agentmodel.GITIGNORE, encoding="utf-8")


# -- running the real CLI ---------------------------------------------------------------------

PARENT_SESSION_VARS = ("CLAUDE_CONFIG_DIR", "CLAUDECODE", "CLAUDE_CODE_", "CLAUDE_AGENT_SDK_", "CLAUDE_PLUGIN_ROOT",
                      "CLAUDE_EFFORT", "CLAUDE_PID", "CLAUDE_PREVIEW_", "AI_AGENT", "BAGGAGE")
SOUL_MARKER = "SOUL-MARKER-7Q2"
ANCESTOR_MARKER = "ANCESTOR-MARKER-5K9"


def _claude() -> str:
    found = shutil.which("claude")
    if not found:
        pytest.skip("claude is not on PATH")
    return found


def _agent_data(name: str = "Spike") -> dict[str, Any]:
    return {
        "schemaVersion": 1, "id": "01JC7ZK3T9Q4M2X8B5N6R1V0WE", "name": name, "icon": "ph-robot",
        "color": None, "description": "", "model": None, "toolsOff": toolcatalog.default_off(),
        "learning": None, "createdAt": "2026-11-06T09:00:00.000Z", "updatedAt": "2026-11-06T09:00:00.000Z",
    }


def make_agent(tmp: Path, soul: str = "", tools_off: list[str] | None = None) -> tuple[Path, Path]:
    """A temp state dir (with a planted ancestor CLAUDE.md) and an agent folder in it.

    The temp folder is resolved first: Windows hands out ``%TEMP%`` in its 8.3 form
    (``C:/Users/GENEHI~1/...``), which the CLI does not match against the home folder, while the
    real state dir (``%LOCALAPPDATA%``) is a long path.
    """
    state = Path(tmp).resolve() / "state"
    state.mkdir(parents=True, exist_ok=True)
    # An ancestor folder's CLAUDE.md: it must not reach the run.
    (state / "CLAUDE.md").write_text(
        f"Always end every answer with the word {ANCESTOR_MARKER}.\n", encoding="utf-8"
    )
    (state / "agents").mkdir(exist_ok=True)
    (state / "agents" / "CLAUDE.md").write_text(
        f"Always start every answer with the word {ANCESTOR_MARKER}.\n", encoding="utf-8"
    )
    folder = state / "agents" / "Spike"
    data = _agent_data()
    if tools_off is not None:
        data["toolsOff"] = tools_off
    write_skeleton(folder, data, soul or f"You are Spike. When asked for your marker, answer {SOUL_MARKER}.\n")
    return state, folder


def run_live(
    tmp: Path,
    folder: Path,
    prompt: str,
    *,
    deny: list[str] | None = None,
    allowed: list[str] | None = None,
    disallowed: list[str] | None = None,
    env: dict[str, str] | None = None,
) -> tuple[list[dict[str, Any]], str]:
    """One real ``claude -p`` run in `folder`; (stream events, debug log text).

    The environment is this process's minus ``CLAUDE_CONFIG_DIR`` (as ``agentrun.build_run``)
    and minus the variables a parent Claude Code session sets (``CLAUDECODE``,
    ``CLAUDE_CODE_*``...), so the run sees what Object started on its own would give it.
    """
    run = Path(tmp).resolve() / "run"
    run.mkdir(exist_ok=True)
    (run / "mcp.json").write_text(json.dumps({"mcpServers": {}}), encoding="utf-8")
    settings = {**RUN_SETTINGS, "permissions": {"deny": deny or []}}
    (run / "run-settings.json").write_text(json.dumps(settings), encoding="utf-8")
    (run / "append.md").write_text("You are running inside Object's test.", encoding="utf-8")
    lists = toolcatalog.run_tool_lists(toolcatalog.default_off(), write=False, folder_servers=[])
    debug = run / "debug.log"
    args = [
        _claude(), *CLI_FLAGS,
        "--mcp-config", str(run / "mcp.json"),
        "--settings", str(run / "run-settings.json"),
        "--append-system-prompt-file", str(run / "append.md"),
        "--allowedTools", ",".join(allowed if allowed is not None else lists.allowed),
        "--disallowedTools", ",".join(disallowed if disallowed is not None else lists.disallowed),
        "--model", MODEL, "--no-session-persistence", "--debug-file", str(debug),
    ]
    run_env = {k: v for k, v in os.environ.items() if not k.startswith(PARENT_SESSION_VARS)}
    run_env.update(env or {})
    res = subprocess.run(
        args, input=prompt, capture_output=True, text=True, encoding="utf-8", errors="replace",
        cwd=folder, env=run_env, timeout=TIMEOUT,
    )
    events = []
    for line in res.stdout.splitlines():
        try:
            events.append(json.loads(line))
        except ValueError:
            continue
    log = debug.read_text(encoding="utf-8", errors="replace") if debug.exists() else ""
    if not any(e.get("type") == "result" for e in events):
        raise AssertionError(f"no result (exit {res.returncode}): {res.stderr[-2000:]}")
    return events, log


def _init(events: list[dict[str, Any]]) -> dict[str, Any]:
    return next(e for e in events if e.get("type") == "system" and e.get("subtype") == "init")


def _final(events: list[dict[str, Any]]) -> str:
    return str(next(e for e in events if e.get("type") == "result").get("result") or "")


def _tool_calls(events: list[dict[str, Any]]) -> list[tuple[dict[str, Any], dict[str, Any] | None]]:
    """Each built-in ``tool_use`` with its ``tool_result`` (by id)."""
    uses: dict[str, dict[str, Any]] = {}
    results: dict[str, dict[str, Any]] = {}
    for e in events:
        msg = e.get("message") if isinstance(e.get("message"), dict) else None
        for block in (msg or {}).get("content") or []:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use":
                uses[str(block.get("id"))] = block
            elif block.get("type") == "tool_result":
                results[str(block.get("tool_use_id"))] = block
    return [(u, results.get(i)) for i, u in uses.items()]


def _result_text(block: dict[str, Any] | None) -> str:
    if block is None:
        return ""
    content = block.get("content")
    if isinstance(content, list):
        return " ".join(str(c.get("text", "")) for c in content if isinstance(c, dict))
    return str(content or "")


def _norm(text: str) -> str:
    return text.replace("\\\\", "/").replace("\\", "/").casefold()


def _home() -> Path:
    return Path.home()


# -- the checks -------------------------------------------------------------------------------


PROBE = (
    "Without using any tool: first say your marker. Then list the full path of every instruction file "
    "(CLAUDE.md or similar) whose contents were given to you in this conversation, one per line, exactly as "
    "the path is written in your context."
)


def test_user_setup_never_reaches_a_run(tmp_path: Path) -> None:
    state, folder = make_agent(tmp_path)
    events, log = run_live(tmp_path, folder, PROBE)
    init = _init(events)
    print("init:", json.dumps({k: init.get(k) for k in ("tools", "mcp_servers", "slash_commands", "skills",
                                                         "plugins", "model", "permissionMode", "cwd")}, indent=1))
    print("answer:", _final(events))
    # The CLI's own built-in plugins (``...@builtin``, carried in its binary) are not Gene's setup;
    # none of his installed plugins may load.
    assert not [p for p in init.get("plugins") or [] if not str(p.get("source", "")).endswith("@builtin")]
    user_skills = set()
    skills_dir = _home() / ".claude" / "skills"
    if skills_dir.is_dir():
        user_skills = {p.name for p in skills_dir.iterdir() if p.is_dir()}
    commands = [str(c) for c in (init.get("slash_commands") or []) + (init.get("skills") or [])]
    assert not [c for c in commands if c in user_skills or ":" in c], commands
    servers = {str(s.get("name")) for s in init.get("mcp_servers") or [] if isinstance(s, dict)}
    assert servers <= {"object", "object-agent"}, servers
    # The soul arrives; neither Gene's user CLAUDE.md nor an ancestor folder's does.
    answer = _final(events)
    listed = _norm(answer)
    assert SOUL_MARKER in answer, answer
    assert _norm(str(folder / "CLAUDE.md")) in listed, answer
    assert _norm(str(_home() / ".claude" / "CLAUDE.md")) not in listed, answer
    assert _norm(str(state / "CLAUDE.md")) not in listed and _norm(str(state / "agents" / "CLAUDE.md")) not in listed
    assert ANCESTOR_MARKER not in answer, answer
    text = _norm(log)
    home = _norm(str(_home()))
    for bad in (f"{home}/.claude/claude.md", f"{home}/.claude/settings.json", f"{home}/.claude/rules"):
        assert not [ln for ln in text.splitlines() if bad in ln and "load" in ln], bad
    assert "replacing all deny rules for destination 'usersettings' with 0 rule(s)" in text
    assert "registered 0 hooks" in text
    assert not re.search(r"/\.claude/projects/[^\s]*/memory", text), "auto-memory folder named in the debug log"
    assert "user: 0" in text and "project=[]" in text  # no skill from ~/.claude/skills


def test_folder_hook_runs(tmp_path: Path) -> None:
    state, folder = make_agent(tmp_path)
    marker = tmp_path / "hook-ran"
    script = tmp_path / "hook.py"
    script.write_text(
        f"from pathlib import Path\nPath({str(marker)!r}).write_text('ran', encoding='utf-8')\n", encoding="utf-8"
    )
    settings = json.loads((folder / ".claude" / "settings.json").read_text(encoding="utf-8"))
    import sys

    settings["hooks"] = {
        "SessionStart": [{"hooks": [{"type": "command", "command": f'"{sys.executable}" "{script}"'}]}]
    }
    (folder / ".claude" / "settings.json").write_bytes(dump_json(settings))
    run_live(tmp_path, folder, "Say hi.")
    assert marker.exists()


def test_fence_is_enforced(tmp_path: Path) -> None:
    state, folder = make_agent(tmp_path)
    space = tmp_path / "My Notes, space"
    space.mkdir()
    secret_text = "FENCED-SECRET-3X8"
    (space / "secret.md").write_text(f"The code is {secret_text}.\n", encoding="utf-8")
    open_dir = tmp_path / "open"
    open_dir.mkdir()
    (open_dir / "visible.md").write_text("The open code is VISIBLE-OK-4P1.\n", encoding="utf-8")
    deny = fence_rules([space], folder, state, _home())
    print("deny:", deny)
    prompt = (
        "Use your tools, one call each, in this order, and do not use any other tool:\n"
        f"1. Read the file {space / 'secret.md'}\n"
        f"2. Grep for the pattern 'code' in the folder {space}\n"
        f"3. Glob for '**/*.md' in the folder {space}\n"
        f"4. Read the file {open_dir / 'visible.md'}\n"
        "Then say which calls succeeded."
    )
    events, _log = run_live(tmp_path, folder, prompt, deny=deny)
    calls = _tool_calls(events)
    for use, result in calls:
        print(use.get("name"), json.dumps(use.get("input")), "->", _result_text(result)[:200])
    seen = {}
    for use, result in calls:
        inp = json.dumps(use.get("input") or {})
        if "My Notes, space" in inp or "My Notes, space".replace(" ", "\\u0020") in inp:
            seen.setdefault(str(use.get("name")), []).append(result)
    for tool in ("Read", "Grep", "Glob"):
        assert tool in seen, f"{tool} wasn't tried on the space: {[u.get('name') for u, _ in calls]}"
        for result in seen[tool]:
            assert result is not None and result.get("is_error") is True, (tool, result)
            assert "permission" in _result_text(result).lower() or "denied" in _result_text(result).lower()
    assert secret_text not in json.dumps(events)
    open_reads = [r for u, r in calls if u.get("name") == "Read" and "visible.md" in json.dumps(u.get("input"))]
    assert open_reads and not open_reads[0].get("is_error") and "VISIBLE-OK-4P1" in _result_text(open_reads[0])


def test_builtin_names(tmp_path: Path) -> None:
    state, folder = make_agent(tmp_path, tools_off=[])
    events, _ = run_live(tmp_path, folder, "Say hi.", allowed=["Skill"], disallowed=[])
    tools = _init(events).get("tools") or []
    print("init tools:", tools)
    missing = [entry.id for entry in toolcatalog.BUILTINS if not set(entry.cli) & set(tools)]
    print("rows with no tool in this run:", missing)
    # 2.1.317 lists its to-do tools (TaskCreate...) only in some runs (m17-cli-spike.md).
    assert set(missing) <= {"TodoWrite"}, missing
    for name in toolcatalog.ALWAYS_ALLOWED:
        assert name in tools
