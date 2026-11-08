"""M17 Task 4: the turn runner (``agentrun``) and its use by ``ai.run_turn``.

`build_run` is checked on its arguments, environment and files; the fake ``claude``
(``backend/tests/fake_claude.py``) runs it end to end. ``OBJECT_STATE_DIR`` is a temp folder
(conftest); nothing here writes outside ``tmp_path`` and the system temp folder.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest
from fake_claude import install
from objectapp import agentrun, ai, toolcatalog
from objectapp.agentmodel import DEFAULT_AGENT_ID, PROTECTED, SELF_LOADED
from objectapp.agentrun import (
    CLI_FLAGS,
    NESTED_MESSAGE,
    OBJECT_GUIDANCE,
    PROPOSAL_GUIDANCE,
    RUN_ENV_DROP,
    RunParts,
    RunRefused,
    RunScope,
    add_contributor,
    build_run,
    contributors,
    fence_folders,
    fence_rules,
    nesting_problem,
    rule_path,
)
from objectapp.spaces import Registry

SECRET = "tok-secret-5Z8Q"
WINDOWS = os.name == "nt"


@dataclass
class FakeAgent:
    """The fields of T2's ``AgentRecord`` the runner reads."""

    id: str
    folder: Path
    data: dict[str, Any] = field(default_factory=dict)
    revision: str | None = None
    default: bool = False
    exists: bool = True
    missing: bool = False
    in_state_dir: bool = True
    read_only_reason: str | None = None


@pytest.fixture
def env(tmp_path: Path, monkeypatch) -> dict[str, Any]:
    state = tmp_path / "state"
    state.mkdir()
    monkeypatch.setenv("OBJECT_STATE_DIR", str(state))
    space = tmp_path / "My Notes"
    space.mkdir()
    folder = state / "agents" / "Researcher"
    (folder / ".claude").mkdir(parents=True)
    others: list[Path] = []
    monkeypatch.setattr(agentrun, "_local_agent_folders", lambda s: list(others))
    return {"state": state, "space": space, "folder": folder, "others": others, "tmp": tmp_path}


def _agent(folder: Path, **data: Any) -> FakeAgent:
    base = {"name": "Researcher", "toolsOff": ["Bash"]}
    base.update(data)
    return FakeAgent(id="01JC7ZK3T9Q4M2X8B5N6R1V0WE", folder=folder, data=base)


def _scope(env: dict[str, Any], *, write: bool = True, purpose: str = "chat",
           agent: FakeAgent | None = None, space: Path | None = None) -> RunScope:
    return RunScope(
        agent=agent or _agent(env["folder"]),
        space_root=space or env["space"],
        space_name="Notes",
        api_url="http://127.0.0.1:8765",
        token=SECRET,
        write=write,
        chat_id="01JC7ZK3T9Q4M2X8B5N6R1V0WF",
        purpose=purpose,
        state=env["state"],
    )


def _build(scope: RunScope, **kw: Any) -> agentrun.RunCommand:
    cmd = build_run(scope, claude="claude", model=kw.get("model"), resume=kw.get("resume"))
    _made.append(cmd.tmp)
    return cmd


_made: list[Path] = []


@pytest.fixture(autouse=True)
def _cleanup():
    yield
    while _made:
        shutil.rmtree(_made.pop(), ignore_errors=True)


def _value(args: list[str], flag: str) -> str:
    return args[args.index(flag) + 1]


def _form(p: Path) -> str:
    return str(p).replace("\\", "/")


# -- what the run loads -------------------------------------------------------------------------


def test_run_loads_only_project_and_local_settings(env, monkeypatch) -> None:
    config = env["tmp"] / "elsewhere"
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(config))
    cmd = _build(_scope(env))
    i = cmd.args.index("--setting-sources")
    assert cmd.args[i : i + 2] == ["--setting-sources", "project,local"]
    for a in cmd.args:
        assert a != "user"
        assert "user" not in a.split(","), a
    assert _value(cmd.args, "--setting-sources") == "project,local"
    # Audit 20: the user's config dir (where their login lives) is kept, and its CLAUDE.md, rules
    # and credentials are kept out of the run as ~/.claude's are.
    assert cmd.env["CLAUDE_CONFIG_DIR"] == str(config)
    form = str(config.resolve()).replace("\\", "/")
    excludes = cmd.run_settings["claudeMdExcludes"]
    assert form + "/CLAUDE.md" in excludes and form + "/rules/**" in excludes
    deny = cmd.run_settings["permissions"]["deny"]
    rp = rule_path(config.resolve())
    assert f"Read({rp}/.credentials.json)" in deny and f"Edit({rp}/**)" in deny
    assert cmd.cwd == env["folder"].resolve()


def test_run_settings_keep_user_instructions_out(env) -> None:
    def extra(scope: RunScope, parts: RunParts) -> None:
        parts.settings["permissions"] = {"deny": ["Read(//x/**)"], "ask": []}
        parts.settings["claudeMdExcludes"] = ["/extra/CLAUDE.md"]
        parts.settings["outputStyle"] = "plain"

    add_contributor("zz-test-extra", 99, extra)
    try:
        cmd = _build(_scope(env))
    finally:
        agentrun._contributors.pop("zz-test-extra", None)
    rs = cmd.run_settings
    assert rs["autoMemoryEnabled"] is False
    ex = rs["claudeMdExcludes"]
    home = Path.home().resolve()
    own = env["folder"].resolve()
    assert _form(home / ".claude" / "CLAUDE.md") in ex
    for a in own.parents:
        for name in ("CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"):
            want = _form(a / name)
            assert any(t.casefold() == want.casefold() for t in ex) if WINDOWS else want in ex, want
    assert _form(own / "CLAUDE.md") not in ex
    assert "/extra/CLAUDE.md" in ex
    deny = rs["permissions"]["deny"]
    assert "Read(//x/**)" in deny
    rp = rule_path(env["space"].resolve())
    assert f"Read({rp}/**)" in deny and f"Edit({rp}/**)" in deny
    assert rs["permissions"]["ask"] == []
    assert rs["outputStyle"] == "plain"
    on_disk = json.loads((cmd.tmp / "run-settings.json").read_text(encoding="utf-8"))
    assert on_disk == rs
    assert _value(cmd.args, "--settings") == str(cmd.tmp / "run-settings.json")


def test_run_env_drops_parent_session_vars(env, monkeypatch) -> None:
    session = ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SSE_PORT", "CLAUDE_CODE_USE_CCR_V2",
               "CLAUDE_AGENT_SDK_VERSION", "AI_AGENT")
    sign_in = ("CLAUDE_CONFIG_DIR", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK",
               "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY")
    for name in (*session, *sign_in):
        monkeypatch.setenv(name, "1")
    cmd = _build(_scope(env))
    for name in session:
        assert name not in cmd.env
    for name in sign_in:  # audit 20: how the user signs in to Claude Code reaches every turn
        assert cmd.env[name] == "1", name
    assert not any(k.upper().startswith(RUN_ENV_DROP) for k in cmd.env if k not in agentrun.RUN_ENV_KEEP)
    different = {k for k, v in agentrun.run_base_env().items() if cmd.env.get(k) != v}
    assert different <= {"OBJECT_API_URL", "MCP_TOOL_TIMEOUT"}, different  # set by the run itself
    assert "PATH" in {k.upper() for k in cmd.env}
    assert cmd.env["OBJECT_API_URL"] == "http://127.0.0.1:8765"
    # Audit 7: every stdio server inherits the CLI's environment, so the token isn't in it.
    assert "OBJECT_API_TOKEN" not in cmd.env and SECRET not in cmd.env.values()


def test_cli_flags(env) -> None:
    cmd = _build(_scope(env))
    assert cmd.args[0] == "claude"
    assert cmd.args[1 : 1 + len(CLI_FLAGS)] == list(CLI_FLAGS)
    assert _value(cmd.args, "--permission-mode") == "dontAsk"
    assert _value(cmd.args, "--permission-prompts") == "none"
    assert "--strict-mcp-config" in cmd.args
    assert _value(cmd.args, "--tools") == "default"
    assert "--model" not in cmd.args and "--resume" not in cmd.args
    cmd2 = _build(_scope(env), model="haiku", resume="0f8fad5b-d9cb-469f-a165-70867728950e")
    assert _value(cmd2.args, "--model") == "haiku"
    assert _value(cmd2.args, "--resume") == "0f8fad5b-d9cb-469f-a165-70867728950e"


def test_mcp_config(env) -> None:
    cmd = _build(_scope(env))
    servers = cmd.mcp_config["mcpServers"]
    assert servers["object"]["args"] == ["-m", "objectapp.mcp_server"]
    assert servers["object-agent"]["args"] == ["-m", "objectapp.agent_mcp"]
    for name in ("object", "object-agent"):
        assert servers[name]["command"] == sys.executable
        assert servers[name]["env"]["OBJECT_API_TOKEN"] == SECRET  # Object's own servers only (audit 7)
        assert servers[name]["env"]["OBJECT_API_URL"] == "http://127.0.0.1:8765"
    assert json.loads((cmd.tmp / "mcp.json").read_text(encoding="utf-8")) == cmd.mcp_config
    assert _value(cmd.args, "--mcp-config") == str(cmd.tmp / "mcp.json")
    ro = _build(_scope(env, write=False, purpose="proposal"))
    assert ro.mcp_config["mcpServers"]["object"]["args"] == ["-m", "objectapp.mcp_server", "--read-only"]
    for c in (cmd, ro):
        assert "OBJECT_API_TOKEN" not in c.env
        assert SECRET not in json.dumps({k: v for k, v in c.mcp_config["mcpServers"].items()
                                          if k not in ("object", "object-agent")})
        for name in ("run-settings.json", "append.md"):
            assert SECRET not in (c.tmp / name).read_text(encoding="utf-8"), name
        assert SECRET not in " ".join(c.args)


def test_folder_servers(env, monkeypatch) -> None:
    mcp = {"mcpServers": {
        "plain": {"command": "node", "args": ["srv.js"]},
        "gh": {"command": "gh-mcp", "env": {"GH_TOKEN": "${GH_TOKEN}"}},
        "object": {"command": "x"},
        "my server": {"command": "y"},
    }}
    (env["folder"] / ".mcp.json").write_text(json.dumps(mcp), encoding="utf-8")
    parts = RunParts()
    agentrun._folder_mcp(_scope(env), parts)
    assert "plain" in parts.mcp_servers and "gh" not in parts.mcp_servers
    assert "my server" not in parts.mcp_servers and "object" not in parts.mcp_servers
    assert any("gh" in n and "GH_TOKEN" in n for n in parts.notes)
    assert any("my server" in n for n in parts.notes) and any('"object"' in n for n in parts.notes)
    cmd = _build(_scope(env))
    assert cmd.mcp_config["mcpServers"]["object"]["args"][1] == "objectapp.mcp_server"
    assert "mcp__plain" in _value(cmd.args, "--allowedTools").split(",")
    assert "mcp__gh" not in _value(cmd.args, "--allowedTools").split(",")

    monkeypatch.setattr(agentrun, "SECRET_LOOKUP", lambda name: "gh-value-9" if name == "GH_TOKEN" else None)
    cmd = _build(_scope(env))
    # Audit 7: the value is filled into the server's own entry, never the CLI's environment.
    assert cmd.mcp_config["mcpServers"]["gh"]["env"]["GH_TOKEN"] == "gh-value-9"
    assert "gh-value-9" not in cmd.env.values()
    assert "gh-value-9" not in json.dumps(cmd.mcp_config["mcpServers"]["plain"])
    assert "mcp__gh" in _value(cmd.args, "--allowedTools").split(",")


def test_outside_stdio_servers_dont_inherit_the_claude_sign_in(env, monkeypatch) -> None:
    """Review of audit 20: the CLI hands its environment (with how the user signs in to Claude
    Code) to every stdio server; each outside one gets those names set empty in its own env,
    unless its config sets the name itself. Object's own servers and remote ones are left alone."""
    names = (*agentrun.RUN_ENV_KEEP, "ANTHROPIC_API_KEY")
    for name in names:
        monkeypatch.setenv(name, "sign-in-7")
    mcp = {"mcpServers": {
        "plain": {"command": "node", "args": ["srv.js"]},
        "own-key": {"type": "stdio", "command": "x", "env": {"ANTHROPIC_API_KEY": "its-own", "A": "1"}},
        "remote": {"type": "http", "url": "https://example.test/mcp"},
    }}
    (env["folder"] / ".mcp.json").write_text(json.dumps(mcp), encoding="utf-8")
    cmd = _build(_scope(env))
    servers = cmd.mcp_config["mcpServers"]
    for name in names:
        assert cmd.env[name] == "sign-in-7"  # the CLI itself still signs in
        assert servers["plain"]["env"][name] == "", name
    assert servers["own-key"]["env"]["ANTHROPIC_API_KEY"] == "its-own"
    assert servers["own-key"]["env"]["A"] == "1"
    assert all(servers["own-key"]["env"][n] == "" for n in agentrun.RUN_ENV_KEEP)
    assert servers["remote"] == mcp["mcpServers"]["remote"]
    for own in ("object", "object-agent"):
        assert set(servers[own]["env"]) == {"OBJECT_API_URL", "OBJECT_API_TOKEN"}
    assert json.loads((cmd.tmp / "mcp.json").read_text(encoding="utf-8")) == cmd.mcp_config
    assert "sign-in-7" not in json.dumps(servers)


def test_guidance_appended(env) -> None:
    cmd = _build(_scope(env))
    assert OBJECT_GUIDANCE.format(agent="Researcher", space="Notes") in cmd.append
    assert '"Notes"' in cmd.append
    assert _value(cmd.args, "--append-system-prompt-file") == str(cmd.tmp / "append.md")
    assert (cmd.tmp / "append.md").read_text(encoding="utf-8") == cmd.append
    ro = _build(_scope(env, write=False, purpose="proposal"))
    assert PROPOSAL_GUIDANCE.format(agent="Researcher", space="Notes") in ro.append
    assert "the user applies what you suggest" in ro.append
    assert "the user applies what you suggest" not in cmd.append


def test_contributor_order(env) -> None:
    def mem(scope: RunScope, parts: RunParts) -> None:
        parts.append_prompt.append("MEM")

    def gw(scope: RunScope, parts: RunParts) -> None:
        parts.mcp_servers["gw"] = {"command": "gw"}

    def gw2(scope: RunScope, parts: RunParts) -> None:
        parts.mcp_servers["gw2"] = {"command": "gw2"}

    saved = dict(agentrun._contributors)  # M18 registers its own contributors; put them back after
    add_contributor("memory-snapshot", 10, mem)
    add_contributor("gateway", 35, gw)
    try:
        cmd = _build(_scope(env))
        assert cmd.append.index("MEM") < cmd.append.index("You are Researcher")
        assert cmd.append.startswith("MEM\n\n")
        assert "gw" in cmd.mcp_config["mcpServers"] and "object" in cmd.mcp_config["mcpServers"]
        add_contributor("gateway", 35, gw2)
        assert [n for _, n, _ in contributors()].count("gateway") == 1
        cmd = _build(_scope(env))
        assert "gw2" in cmd.mcp_config["mcpServers"] and "gw" not in cmd.mcp_config["mcpServers"]
        orders = [(o, n) for o, n, _ in contributors()]
        assert orders == sorted(orders)
        assert ("memory-snapshot" in [n for _, n in orders])
    finally:
        agentrun._contributors.clear()
        agentrun._contributors.update(saved)
    m17 = {"folder-mcp", "object-mcp", "agent-mcp", "guidance", "tools", "fence"}
    assert [(o, n) for o, n, _ in contributors() if n in m17] == [
        (20, "folder-mcp"), (30, "object-mcp"), (40, "agent-mcp"), (50, "guidance"), (60, "tools"), (70, "fence"),
    ]


# -- the fence ----------------------------------------------------------------------------------


@pytest.mark.skipif(not WINDOWS, reason="Windows paths")
def test_rule_path_windows() -> None:
    assert rule_path(Path("C:/Users/Gene/My Notes")) == "//c/Users/Gene/My Notes"
    assert rule_path(Path("D:\\a,b\\Ünïcode\\")) == "//d/a,b/Ünïcode"


def test_rule_path_forms() -> None:
    assert rule_path(Path("/home/x")) == "//home/x"
    assert rule_path(Path("/home/x/")) == "//home/x"


def _junction(link: Path, target: Path) -> bool:
    try:
        if WINDOWS:
            import _winapi

            _winapi.CreateJunction(str(target), str(link))
        else:
            link.symlink_to(target, target_is_directory=True)
    except (OSError, AttributeError):
        return False
    return True


def test_fence_rules_cover_awkward_paths(env) -> None:
    tmp = env["tmp"]
    names = ["My Notes 2", "a,b", "Ünïcode", "MixedCase"]
    folders = []
    for n in names:
        (tmp / n).mkdir()
        folders.append(tmp / n)
    given = [*folders[:3], Path(str(folders[3]).lower()) if WINDOWS else folders[3]]
    given.append(Path(str(tmp / "My Notes 2") + os.sep))  # trailing slash: a duplicate
    target = tmp / "Linked Space"
    target.mkdir()
    linked = _junction(tmp / "link-to-space", target)
    if linked:
        given.append(tmp / "link-to-space")
    for p in given:
        Registry(env["state"]).register(p, touch=False)
    cmd = _build(_scope(env))
    deny = cmd.run_settings["permissions"]["deny"]
    key = (lambda t: t.casefold()) if WINDOWS else (lambda t: t)
    deny_keys = {key(r) for r in deny}
    for f in [*folders, target] if linked else folders:
        rp = rule_path(f.resolve())
        assert key(f"Read({rp}/**)") in deny_keys, rp
        assert key(f"Edit({rp}/**)") in deny_keys, rp
    if linked:  # the registry keeps resolved paths: a registered link is fenced at its target
        assert not any("link-to-space" in r for r in deny)
        # A space opened through the link is fenced under the link path and its target.
        via = _build(_scope(env, space=tmp / "link-to-space")).run_settings["permissions"]["deny"]
        via_keys = {key(r) for r in via}
        for p in (Path(os.path.abspath(tmp / "link-to-space")), target.resolve()):
            assert key(f"Read({rule_path(p)}/**)") in via_keys and key(f"Edit({rule_path(p)}/**)") in via_keys
    for f in folders:
        assert not any(_form(f) in t for t in cmd.args)  # path rules never reach the command line
    assert all("(" not in t for t in _value(cmd.args, "--disallowedTools").split(","))
    own = rule_path(env["folder"].resolve())
    for p in (*PROTECTED, *SELF_LOADED):
        assert f"Edit({own}/{p})" in deny
    assert f"Edit({own}/.mcp.json)" in deny and f"Edit({own}/CLAUDE.local.md)" in deny
    st = rule_path(env["state"].resolve())
    assert {f"Read({st}/*)", f"Edit({st}/*)", f"Read({st}/automation-logs-*/**)"} <= set(deny)
    home = rule_path(Path.home().resolve())
    assert {f"Read({home}/.claude/.credentials.json)", f"Edit({home}/.claude/**)",
            f"Edit({home}/.claude.json)"} <= set(deny)
    assert len(deny) == len(set(deny))


def test_fence_rules_shape(tmp_path: Path) -> None:
    rules = fence_rules([tmp_path / "S"], tmp_path / "A", tmp_path / "st", tmp_path / "h")
    s = rule_path((tmp_path / "S").resolve())
    assert rules[:2] == [f"Read({s}/**)", f"Edit({s}/**)"]
    assert len(rules) == 2 + 5 + 3 + 4 + 3  # + history and fake-trash (audit 3)


def test_fake_write_to_own_server_and_local_files_is_denied(env) -> None:
    """The agent's own .mcp.json and CLAUDE.local.md load on its next turn: Write is denied on
    them, so a prompt-injected Write can't add a server or rewrite the soul."""
    from fake_claude import __file__ as fake_path

    folder = env["folder"]
    cmd = _build(_scope(env))
    settings = cmd.tmp / "run-settings.json"
    assert settings.is_file()
    prompt = "\n".join([
        f"FAKE:write:{folder / '.mcp.json'}",
        f"FAKE:write:{folder / 'CLAUDE.local.md'}",
        f"FAKE:write:{folder / 'notes.md'}",
    ])
    run_env = {k: v for k, v in os.environ.items() if k != "FAKE_CLAUDE_LOG"}
    import subprocess

    res = subprocess.run(
        [sys.executable, fake_path, "-p", "--output-format", "stream-json", "--settings", str(settings)],
        input=prompt, capture_output=True, text=True, encoding="utf-8", cwd=folder, env=run_env, timeout=60,
    )
    assert res.returncode == 0, res.stderr
    results = [
        b for line in res.stdout.splitlines() if line.strip()
        for e in [json.loads(line)] if e.get("type") == "user"
        for b in e["message"]["content"] if b.get("type") == "tool_result"
    ]
    assert [r.get("content") for r in results] == [
        "Permission to use Write has been denied.", "Permission to use Write has been denied.", "wrote",
    ]


def test_fence_covers_the_cache_dir_override(env, monkeypatch) -> None:
    cache = env["tmp"] / "cache-override"
    cache.mkdir()
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(cache))
    deny = _build(_scope(env)).run_settings["permissions"]["deny"]
    rp = rule_path(cache.resolve())
    assert f"Read({rp}/**)" in deny and f"Edit({rp}/**)" in deny
    monkeypatch.delenv("OBJECT_CACHE_DIR")
    deny = _build(_scope(env)).run_settings["permissions"]["deny"]
    assert f"Read({rp}/**)" not in deny


def test_fence_covers_version_history_and_deleted_spaces(env) -> None:
    """Audit 3: saved versions (``<state>/history``) and deleted spaces (``<state>/fake-trash``)
    are fenced at every depth, while the agent's own folder under ``<state>/agents`` stays open."""
    import fake_claude

    state = env["state"].resolve()
    deny = _build(_scope(env)).run_settings["permissions"]["deny"]
    for target in (state / "history" / "0123abcd" / "Notes%2FSecret.md" / "20261107T120000Z.md",
                   state / "history" / "0123abcd" / "index.json",
                   state / "fake-trash" / "Old Space" / "Secret.md"):
        assert fake_claude._denied("Read", str(target), deny), target
        assert fake_claude._denied("Edit", str(target), deny), target
        assert fake_claude._denied("Grep", str(target.parent), deny), target
    mine = env["folder"].resolve() / "notes" / "draft.md"
    assert not fake_claude._denied("Read", str(mine), deny)
    assert not fake_claude._denied("Edit", str(mine), deny)


def test_fence_covers_the_runs_own_temp_folder(env) -> None:
    """Review of audit 7: the run's temp folder holds mcp.json with the servers' secrets; the file
    tools are denied on it, by its given and its resolved path."""
    import fake_claude

    cmd = _build(_scope(env))
    deny = cmd.run_settings["permissions"]["deny"]
    assert json.loads((cmd.tmp / "run-settings.json").read_text(encoding="utf-8")) == cmd.run_settings
    for tmp in (Path(os.path.abspath(cmd.tmp)), cmd.tmp.resolve()):
        for tool in ("Read", "Edit", "Write"):
            assert fake_claude._denied(tool, str(tmp / "mcp.json"), deny), (tool, tmp)
        for tool in ("Grep", "Glob"):
            assert fake_claude._denied(tool, str(tmp), deny), (tool, tmp)


def test_stale_run_folders_are_swept_at_the_next_run(env, monkeypatch) -> None:
    """A run folder left behind (Object stopped mid-run) holds secrets: the next run removes every
    ``object-agent-run-*`` folder older than a day, and nothing else."""
    import tempfile
    import time

    temp = env["tmp"] / "temp"
    temp.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(temp))
    old = time.time() - 2 * 86400
    stale, fresh, other = temp / "object-agent-run-old1", temp / "object-agent-run-new1", temp / "other-old"
    for d in (stale, fresh, other):
        d.mkdir()
        (d / "mcp.json").write_text("{}", encoding="utf-8")
    stale_file = temp / "object-agent-run-file"
    stale_file.write_text("x", encoding="utf-8")
    for p in (stale, stale / "mcp.json", other, stale_file):
        os.utime(p, (old, old))
    cmd = _build(_scope(env))
    assert cmd.tmp.parent == temp and cmd.tmp.is_dir()
    assert not stale.exists()
    assert fresh.is_dir() and other.is_dir() and stale_file.is_file()


def test_fence_folders(env) -> None:
    state = env["state"]
    reg_a = env["tmp"] / "Space A"
    reg_a.mkdir()
    Registry(state).register(reg_a, touch=False)
    other = state / "agents" / "Other"
    other.mkdir(parents=True)
    agents = [other, env["folder"]]
    if WINDOWS:
        agents.append(Path(str(other).upper()))
    scope = _scope(env)  # the open space (My Notes) isn't registered
    spaces = [Path(e.path) for e in Registry(state).list(current=env["space"])]
    got = fence_folders(scope, spaces, agents)
    keys = [os.path.normcase(str(p)) for p in got]
    assert len(keys) == len(set(keys))
    for want in (reg_a, env["space"], other, state / "agents" / ".trash"):
        assert os.path.normcase(str(want.resolve())) in keys
    assert os.path.normcase(str(env["folder"].resolve())) not in keys
    assert all(p.is_absolute() for p in got)
    # The open space is fenced even when it was passed in by scope only.
    got2 = fence_folders(scope, [], [])
    assert os.path.normcase(str(env["space"].resolve())) in [os.path.normcase(str(p)) for p in got2]


def test_fence_uses_the_agent_registry(env) -> None:
    other = env["state"] / "agents" / "Other"
    other.mkdir(parents=True)
    env["others"].extend([other, env["folder"]])
    deny = _build(_scope(env)).run_settings["permissions"]["deny"]
    assert f"Read({rule_path(other.resolve())}/**)" in deny
    assert f"Read({rule_path(env['folder'].resolve())}/**)" not in deny


def test_nested_agent_and_space_refuse_to_run(env) -> None:
    space = env["space"]
    inside = space / "Agents" / "Helper"
    (inside / ".claude").mkdir(parents=True)
    tmp_before = set(Path(os.environ.get("TEMP", "/tmp")).glob("object-agent-run-*")) if WINDOWS else None
    with pytest.raises(RunRefused) as e:
        build_run(_scope(env, agent=_agent(inside)), claude="claude", model=None, resume=None)
    assert e.value.message == NESTED_MESSAGE == "An agent folder can't be inside a space folder or hold one."
    holder = env["tmp"] / "Holder"
    inner_space = holder / "Notes"
    inner_space.mkdir(parents=True)
    with pytest.raises(RunRefused) as e:
        build_run(_scope(env, agent=_agent(holder), space=inner_space), claude="claude", model=None, resume=None)
    assert e.value.message == NESTED_MESSAGE
    # A registered space (not the open one) counts too.
    Registry(env["state"]).register(inner_space, touch=False)
    with pytest.raises(RunRefused):
        build_run(_scope(env, agent=_agent(holder)), claude="claude", model=None, resume=None)
    if tmp_before is not None:
        assert set(Path(os.environ.get("TEMP", "/tmp")).glob("object-agent-run-*")) <= tmp_before
    assert nesting_problem(env["folder"], [space]) is None
    if WINDOWS:
        assert nesting_problem(Path(str(inside).upper()), [space]) == NESTED_MESSAGE


def test_nested_agent_names_what_it_hit(env) -> None:
    """Audit 13: an agent inside another agent's folder, inside the agent trash, or that is the
    agents folder itself, is refused with a message that says which."""
    from objectapp.agentrun import NESTED_AGENT, NESTED_AGENTS_DIR, NESTED_TRASH

    outer = env["state"] / "agents" / "Outer"
    inner = outer / "Inner"
    (inner / ".claude").mkdir(parents=True)
    env["others"].extend([outer, inner])
    for agent, message in ((inner, NESTED_AGENT), (outer, NESTED_AGENT),
                           (env["state"] / "agents" / ".trash" / "Old", NESTED_TRASH),
                           (env["state"] / "agents", NESTED_AGENTS_DIR)):
        agent.mkdir(parents=True, exist_ok=True)
        with pytest.raises(RunRefused) as e:
            build_run(_scope(env, agent=_agent(agent)), claude="claude", model=None, resume=None)
        assert e.value.message == message, agent


# -- tool switches ------------------------------------------------------------------------------


def test_tool_switches_reach_the_args(env) -> None:
    cmd = _build(_scope(env, agent=_agent(env["folder"], toolsOff=["Bash"])))
    dis = _value(cmd.args, "--disallowedTools").split(",")
    allowed = _value(cmd.args, "--allowedTools").split(",")
    assert "Bash" in dis and "PowerShell" in dis
    assert "Bash" not in allowed
    cmd = _build(_scope(env, agent=_agent(env["folder"], toolsOff=[])))
    allowed = _value(cmd.args, "--allowedTools").split(",")
    assert "Bash" in allowed and "PowerShell" in allowed
    assert "mcp__object__create_object" in allowed and "mcp__object-agent__agent_info" in allowed
    writes = [f"mcp__object__{t}" for t in toolcatalog.OBJECT_WRITE]
    cmd = _build(_scope(env, agent=_agent(env["folder"], toolsOff=writes)))
    allowed = _value(cmd.args, "--allowedTools").split(",")
    assert not any(a in allowed for a in writes)
    assert "mcp__object__read" in allowed
    ro = _build(_scope(env, write=False, purpose="proposal", agent=_agent(env["folder"], toolsOff=[])))
    assert not any(a in _value(ro.args, "--allowedTools").split(",") for a in writes)
    assert set(writes) <= set(_value(ro.args, "--disallowedTools").split(","))


def test_default_agent_name_in_guidance(env) -> None:
    agent = FakeAgent(id=DEFAULT_AGENT_ID, folder=env["folder"], data={"name": "Assistant", "toolsOff": ["Bash"]},
                      default=True)
    assert "You are Assistant," in _build(_scope(env, agent=agent)).append


# -- ai.py --------------------------------------------------------------------------------------


@pytest.fixture
def fake(tmp_path: Path, monkeypatch) -> dict[str, Any]:
    path = install(tmp_path / "bin")
    log = tmp_path / "claude-log.jsonl"
    monkeypatch.setenv("FAKE_CLAUDE_LOG", str(log))
    return {"claude": str(path), "log": log}


def _runs(log: Path) -> list[dict]:
    if not log.exists():
        return []
    return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines() if line.strip()]


def _plain_run(claude: str):
    """A bare `RunCommand` (T7 made `Turn.run` required)."""
    import tempfile

    def run(resume: str | None) -> agentrun.RunCommand:
        tmp = Path(tempfile.mkdtemp(prefix="object-test-run-"))
        return agentrun.RunCommand(args=[claude, "-p", "--output-format", "stream-json"], cwd=tmp,
                                   env=dict(os.environ), tmp=tmp, mcp_config={}, run_settings={}, append="")

    return run


def _turn(claude: str, prompt: str, **kw: Any) -> ai.Turn:
    kw.setdefault("run", _plain_run(claude))
    return ai.Turn(claude=claude, mode="chat", prompt_resume=None, prompt_fresh=prompt, session_id=None,
                   model=None, api_url="http://127.0.0.1:1", token="t", **kw)


def _collect(turn: ai.Turn) -> list[dict]:
    async def go() -> list[dict]:
        return [e async for e in ai.run_turn(turn)]

    return asyncio.run(go())


def test_turn_timeout_is_per_turn(fake) -> None:
    assert ai.TURN_TIMEOUT == 300
    assert _turn(fake["claude"], "Hi").timeout == ai.TURN_TIMEOUT == 300
    import time

    start = time.monotonic()
    events = _collect(_turn(fake["claude"], "FAKE:wait", timeout=1.0))
    took = time.monotonic() - start
    assert events[-1]["type"] == "error"
    assert "took too long (over 1 seconds)" in events[-1]["message"]
    assert took < 15


def test_prompt_without_intro() -> None:
    pack = ai.ContextPack()
    assert ai._INTRO in ai.build_prompt("chat", "Hi", pack)
    text = ai.build_prompt("chat", "Hi", pack, intro=False)
    assert ai._INTRO not in text
    assert text.startswith(ai._INSTRUCTIONS["chat"])


def test_agent_tools_short_names() -> None:
    p = ai.StreamParser()
    out = p.feed({"type": "assistant", "message": {"id": "m1", "content": [
        {"type": "tool_use", "id": "toolu_9", "name": "mcp__object-agent__agent_info", "input": {}},
        {"type": "tool_use", "id": "toolu_8", "name": "mcp__object__search", "input": {}},
        {"type": "tool_use", "id": "toolu_7", "name": "mcp__gh__issues", "input": {}},
    ]}})
    assert [e["name"] for e in out] == ["agent_info", "search", "mcp__gh__issues"]


def test_attempt_uses_the_run_command(env, fake) -> None:
    scope = _scope(env)
    made: list[agentrun.RunCommand] = []

    def run(resume: str | None) -> agentrun.RunCommand:
        cmd = build_run(scope, claude=fake["claude"], model=None, resume=resume)
        made.append(cmd)
        return cmd

    events = _collect(_turn(fake["claude"], "FAKE:tool please", run=run))
    assert events[-1]["type"] == "done", events
    entry = _runs(fake["log"])[-1]
    assert os.path.normcase(entry["cwd"]) == os.path.normcase(str(env["folder"].resolve()))
    assert entry["settingSources"] == "project,local"
    assert entry["token"] == SECRET
    assert entry["runSettings"]["autoMemoryEnabled"] is False
    assert "You are Researcher" in (entry["appendPrompt"] or "")
    assert made and not made[0].tmp.exists()
    tools = [e for e in events if e["type"] == "tool"]
    assert len(tools) == 2 and tools[0]["id"] == tools[1]["id"]
    assert tools[0]["name"] == "search" and "result" in tools[1]


def test_refused_run_is_an_error_event(env, fake) -> None:
    inside = env["space"] / "Helper"
    inside.mkdir()
    scope = _scope(env, agent=_agent(inside))

    def run(resume: str | None) -> agentrun.RunCommand:
        return build_run(scope, claude=fake["claude"], model=None, resume=resume)

    events = _collect(_turn(fake["claude"], "Hi", run=run))
    assert events == [{"type": "error", "message": NESTED_MESSAGE}]
    assert _runs(fake["log"]) == []
