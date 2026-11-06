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
from objectapp.agentmodel import DEFAULT_AGENT_ID, PROTECTED
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
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(env["tmp"] / "elsewhere"))
    cmd = _build(_scope(env))
    i = cmd.args.index("--setting-sources")
    assert cmd.args[i : i + 2] == ["--setting-sources", "project,local"]
    for a in cmd.args:
        assert a != "user"
        assert "user" not in a.split(","), a
    assert _value(cmd.args, "--setting-sources") == "project,local"
    assert "CLAUDE_CONFIG_DIR" not in cmd.env
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
    for name in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_AGENT_SDK_VERSION", "AI_AGENT"):
        monkeypatch.setenv(name, "1")
    cmd = _build(_scope(env))
    for name in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_AGENT_SDK_VERSION", "AI_AGENT"):
        assert name not in cmd.env
    assert not any(k.upper().startswith(RUN_ENV_DROP) for k in cmd.env)
    assert "PATH" in {k.upper() for k in cmd.env}
    assert cmd.env["OBJECT_API_URL"] == "http://127.0.0.1:8765"
    assert cmd.env["OBJECT_API_TOKEN"] == SECRET


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
        assert servers[name]["env"]["OBJECT_API_TOKEN"] == "${OBJECT_API_TOKEN}"
        assert servers[name]["env"]["OBJECT_API_URL"] == "http://127.0.0.1:8765"
    assert json.loads((cmd.tmp / "mcp.json").read_text(encoding="utf-8")) == cmd.mcp_config
    assert _value(cmd.args, "--mcp-config") == str(cmd.tmp / "mcp.json")
    ro = _build(_scope(env, write=False, purpose="proposal"))
    assert ro.mcp_config["mcpServers"]["object"]["args"] == ["-m", "objectapp.mcp_server", "--read-only"]
    for c in (cmd, ro):
        assert c.env["OBJECT_API_TOKEN"] == SECRET
        for f in c.tmp.rglob("*"):
            if f.is_file():
                assert SECRET not in f.read_text(encoding="utf-8"), f
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
    assert cmd.mcp_config["mcpServers"]["gh"]["env"]["GH_TOKEN"] == "${GH_TOKEN}"
    assert cmd.env["GH_TOKEN"] == "gh-value-9"
    assert "gh-value-9" not in (cmd.tmp / "mcp.json").read_text(encoding="utf-8")
    assert "mcp__gh" in _value(cmd.args, "--allowedTools").split(",")


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
        agentrun._contributors.pop("memory-snapshot", None)
        agentrun._contributors.pop("gateway", None)
    assert [(o, n) for o, n, _ in contributors()] == [
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
    if linked:
        assert not any("link-to-space" in r for r in deny)
    for f in folders:
        assert not any(_form(f) in t for t in cmd.args)  # path rules never reach the command line
    assert all("(" not in t for t in _value(cmd.args, "--disallowedTools").split(","))
    own = rule_path(env["folder"].resolve())
    for p in PROTECTED:
        assert f"Edit({own}/{p})" in deny
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
    assert len(rules) == 2 + 3 + 3 + 3


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
