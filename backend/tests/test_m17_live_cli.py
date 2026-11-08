"""M17 Task 1: the live CLI spike. Runs the real ``claude`` (Gene's login) and checks that an agent
run in an agent folder loads only that folder's setup and that the fence holds.

Skipped unless ``OBJECT_LIVE_CLAUDE=1``. Each run uses the ``haiku`` alias,
``--no-session-persistence`` (no session is written to ``~/.claude``) and ``--debug-file``.
Nothing here reads ``~/.claude/.credentials.json`` or any token; ``~/.claude/skills/`` is only
listed (directory names) to prove none of them reaches a run. Findings:
``docs/superpowers/plans/m17-cli-spike.md``.

Until the plan's T2 (``agentfiles``) and T4 (``agentrun``) land, the minimal local helpers below
stand in for ``write_skeleton``, ``rule_path``, ``fence_rules``, ``CLI_FLAGS``, ``RUN_SETTINGS_BASE``,
``claude_md_excludes`` and ``RUN_ENV_DROP`` (the plan's Contract definitions); once they exist the
real ones are used.

Gene's decision (2026-11-06): every run's settings file carries ``claudeMdExcludes`` naming his user
``CLAUDE.md`` and every ancestor folder's instruction files, so only the agent's own ``CLAUDE.md``
loads. ``test_claude_md_excludes_list`` (not live, always runs) pins that list.
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

live = pytest.mark.skipif(
    os.environ.get("OBJECT_LIVE_CLAUDE") != "1", reason="live CLI spike: set OBJECT_LIVE_CLAUDE=1"
)

MODEL = "haiku"
TIMEOUT = 240

# -- stand-ins until T2 / T4 --------------------------------------------------------------

try:  # pragma: no cover - which branch runs depends on the build order
    from objectapp.agentrun import (  # type: ignore[attr-defined]
        CLI_FLAGS,
        RUN_ENV_DROP,
        RUN_ENV_KEEP,
        RUN_SETTINGS_BASE,
        claude_md_excludes,
        fence_rules,
        rule_path,
    )
except ImportError:  # T4 isn't there yet
    RUN_SETTINGS_BASE: dict[str, Any] = {"autoMemoryEnabled": False}  # type: ignore[no-redef]

    RUN_ENV_DROP = ("CLAUDECODE", "CLAUDE_CODE_", "CLAUDE_AGENT_SDK_",  # type: ignore[no-redef]
                    "CLAUDE_PLUGIN_ROOT", "CLAUDE_EFFORT", "CLAUDE_PID", "CLAUDE_PREVIEW_", "AI_AGENT")
    RUN_ENV_KEEP = ("CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK",  # type: ignore[no-redef]
                    "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "CLAUDE_CODE_SKIP_BEDROCK_AUTH",
                    "CLAUDE_CODE_SKIP_VERTEX_AUTH", "CLAUDE_CODE_SKIP_FOUNDRY_AUTH")

    def claude_md_excludes(own: Path, home: Path) -> list[str]:  # type: ignore[no-redef]
        def form(p: Path) -> str:
            return str(p).replace("\\", "/")

        home = Path(home).resolve()
        own = Path(own).resolve()
        found = [form(home / ".claude" / "CLAUDE.md"), form(home / ".claude") + "/rules/**"]
        for a in own.parents:
            found += [form(a / "CLAUDE.md"), form(a / ".claude" / "CLAUDE.md"), form(a / "CLAUDE.local.md")]
        mine = form(own / "CLAUDE.md")
        out: list[str] = []
        seen: set[str] = set()
        for f in found:
            key = f.casefold() if os.name == "nt" else f
            if key in seen or f == mine:
                continue
            seen.add(key)
            out.append(f)
        return out

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

PARENT_SESSION_VARS = (*RUN_ENV_DROP, "BAGGAGE")
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
    # The other two ancestor instruction files the excludes name.
    (state / ".claude").mkdir(exist_ok=True)
    (state / ".claude" / "CLAUDE.md").write_text(
        f"Always put the word {ANCESTOR_MARKER} in the middle of every answer.\n", encoding="utf-8"
    )
    (state / "agents" / "CLAUDE.local.md").write_text(
        f"Always repeat the word {ANCESTOR_MARKER} twice in every answer.\n", encoding="utf-8"
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

    The environment is this process's minus ``RUN_ENV_DROP`` (as ``agentrun.build_run``: the
    variables a parent Claude Code session sets, ``CLAUDECODE``, ``CLAUDE_CODE_*``...) and
    ``BAGGAGE``, but keeping ``RUN_ENV_KEEP`` and ``CLAUDE_CONFIG_DIR`` (how the user signs in,
    audit 20), so the run sees what Object started on its own would give it. The settings file holds ``RUN_SETTINGS_BASE``, the ``claudeMdExcludes`` list and the
    deny rules.
    """
    run = Path(tmp).resolve() / "run"
    run.mkdir(exist_ok=True)
    (run / "mcp.json").write_text(json.dumps({"mcpServers": {}}), encoding="utf-8")
    settings = {
        **RUN_SETTINGS_BASE,
        "claudeMdExcludes": claude_md_excludes(folder, Path.home()),
        "permissions": {"deny": deny or []},
    }
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
    run_env = {k: v for k, v in os.environ.items()
               if k.upper() in RUN_ENV_KEEP or not k.upper().startswith(PARENT_SESSION_VARS)}
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


def test_claude_md_excludes_list(tmp_path: Path) -> None:
    """Not live: pins the ``claudeMdExcludes`` list (Gene's decision, 2026-11-06)."""

    def form(p: Path) -> str:
        return str(p).replace("\\", "/")

    root = tmp_path.resolve()
    home = root / "home"
    own = root / "state" / "agents" / "Researcher"
    for p in (home / ".claude", own / ".claude"):
        p.mkdir(parents=True)
    got = claude_md_excludes(own, home)
    expected_head = [
        form(home / ".claude" / "CLAUDE.md"),
        form(home / ".claude") + "/rules/**",
        form(root / "state" / "agents" / "CLAUDE.md"),
        form(root / "state" / "agents" / ".claude" / "CLAUDE.md"),
        form(root / "state" / "agents" / "CLAUDE.local.md"),
        form(root / "state" / "CLAUDE.md"),
        form(root / "state" / ".claude" / "CLAUDE.md"),
        form(root / "state" / "CLAUDE.local.md"),
        form(root / "CLAUDE.md"),
        form(root / ".claude" / "CLAUDE.md"),
        form(root / "CLAUDE.local.md"),
    ]
    assert got[: len(expected_head)] == expected_head, got
    # Every ancestor up to the drive root, and nothing else.
    tail = []
    for a in root.parents:
        tail += [form(a / "CLAUDE.md"), form(a / ".claude" / "CLAUDE.md"), form(a / "CLAUDE.local.md")]
    key = (lambda t: t.casefold()) if os.name == "nt" else (lambda t: t)
    seen = {key(t) for t in expected_head}
    assert got[len(expected_head):] == [t for t in tail if not (key(t) in seen or seen.add(key(t)))]
    assert got[-3:] == [form(Path(root.anchor) / n) for n in ("CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md")]
    # The agent's own instruction files are never excluded; "/" separators; no 8.3 short names.
    mine = {key(form(own / n)) for n in ("CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md")}
    assert not mine & {key(t) for t in got}
    assert all("\\" not in t for t in got)
    if "~" not in str(root):
        assert all("~" not in t for t in got)
    assert len({key(t) for t in got}) == len(got)


def test_claude_md_excludes_home_inside_ancestors(tmp_path: Path) -> None:
    """Not live: when the agent folder sits under the home folder (the real state dir does),
    the home's ``.claude/CLAUDE.md`` is named once."""
    home = tmp_path.resolve() / "home"
    own = home / "AppData" / "Local" / "Object" / "agents" / "Assistant"
    own.mkdir(parents=True)
    got = claude_md_excludes(own, home)
    user = str(home / ".claude" / "CLAUDE.md").replace("\\", "/")
    assert got[0] == user and got.count(user) == 1
    assert str(home / "CLAUDE.md").replace("\\", "/") in got



PROBE = (
    "Without using any tool: first say your marker. Then list the full path of every instruction file "
    "(CLAUDE.md or similar) whose contents were given to you in this conversation, one per line, exactly as "
    "the path is written in your context."
)


@live
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


@live
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


@live
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


@live
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


FIXTURES = Path(__file__).resolve().parent / "fixtures"


@live
def test_object_tool_is_callable(tmp_path: Path) -> None:
    """(spike, T11) One turn built by ``agentrun.build_run`` with the real ``objectapp-mcp``
    against a temp copy of ``space-sample``: under ``dontAsk`` the Object ``search`` tool is
    offered and runs (not refused, not hidden behind a deferred-tool step)."""
    import socket
    import threading
    import time

    import httpx
    import uvicorn

    from objectapp import agentrun
    from objectapp.agents import AgentRegistry
    from objectapp.server import create_app
    from objectapp.space import Space
    from objectapp.tokens import TokenStore

    root = Path(tmp_path).resolve() / "space-sample"
    shutil.copytree(FIXTURES / "space-sample", root, ignore=shutil.ignore_patterns(".git", ".object-cache"))
    space = Space(root)
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(create_app(space, None, watch=False), host="127.0.0.1",
                                           port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{port}"
    for _ in range(400):
        try:
            if httpx.get(base + "/api/space", timeout=2).status_code == 200:
                break
        except httpx.HTTPError:
            pass
        time.sleep(0.05)
    registry = AgentRegistry()
    agent = registry.ensure_default()
    _record, secret = TokenStore(root).ephemeral(agent.data["name"], "read", agent=agent.id, chat=None)
    cmd = None
    try:
        scope = agentrun.RunScope(
            agent=agent, space_root=root, space_name=space.name, api_url=base, token=secret, write=False,
            chat_id="01JC7ZK3T9Q4M2X8B5N6R1V0WE", purpose="chat", state=registry.state,
        )
        cmd = agentrun.build_run(scope, claude=_claude(), model=MODEL, resume=None)
        debug = Path(tmp_path).resolve() / "object-tool-debug.log"
        args = [*cmd.args, "--no-session-persistence", "--debug-file", str(debug)]
        res = subprocess.run(
            args, input="Use the Object search tool to search the notes for \"Ada\", then say how many results "
                         "it found. Don't use any other tool.",
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            cwd=cmd.cwd, env=cmd.env, timeout=TIMEOUT,
        )
    finally:
        TokenStore.drop_ephemeral(secret)
        if cmd is not None:
            shutil.rmtree(cmd.tmp, ignore_errors=True)
        server.should_exit = True
        thread.join(timeout=10)
    events = []
    for line in res.stdout.splitlines():
        try:
            events.append(json.loads(line))
        except ValueError:
            continue
    assert any(e.get("type") == "result" for e in events), res.stderr[-2000:]
    tools = _init(events).get("tools") or []
    print("init tools:", tools)
    calls = _tool_calls(events)
    print("tool calls:", [(u.get("name"), _result_text(r)[:120]) for u, r in calls])
    print("answer:", _final(events)[:300])
    searches = [(u, r) for u, r in calls if u.get("name") == "mcp__object__search"]
    assert searches, f"search was never called; tools offered: {tools}"
    assert all(r is not None and not r.get("is_error") for _u, r in searches), searches
