"""M19 Task 5: outside MCP servers in every agent run, and the Tools tab's server groups.

M17's `build_run` is run with real agent folders under conftest's temp ``OBJECT_STATE_DIR``.
Every server, secret and tool name is synthetic; nothing here starts a server or the CLI.
"""

from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path
from typing import Any

import fake_claude
import pytest
from fastapi.testclient import TestClient
from objectapp import agentrun, appstate, mcpgateway, secretstore, toolcatalog
from objectapp.agentmodel import AgentInput
from objectapp.agentrun import RunScope, build_run, contributors, fence_rules
from objectapp.agents import AgentRecord, AgentRegistry
from objectapp.mcpgateway import (
    TOOL_CACHE,
    ToolCache,
    folder_key,
    gateway_key,
    install,
    probe_targets,
    server_groups,
    tool_id,
)
from objectapp.mcpmodel import McpServerInput
from objectapp.mcpprobe import ProbeResult
from objectapp.mcpstore import McpStore
from objectapp.secretstore import SecretStore

TOKEN = "tok-secret-7M2K"
ENV_SECRET = "s3cret-env-Q4Z81"
HEADER_SECRET = "s3cret-header-W9P3"
BEARER_SECRET = "s3cret-bearer-L5T7"
VAR_SECRET = "s3cret-var-H2N6"
SECRETS = (ENV_SECRET, HEADER_SECRET, BEARER_SECRET, VAR_SECRET)
CLASH_NOTE = "Skipped the MCP server 'gh': this agent's folder has one with the same name."
MISSING_NOTE = "Skipped the MCP server '{}': a secret is missing. Set it again in Settings."


@pytest.fixture(autouse=True)
def installed():
    """`install()`, undone afterwards: M17's contributors, `GROUP_PROVIDERS` and `SECRET_LOOKUP`."""
    saved_contributors = dict(agentrun._contributors)
    saved_providers = list(toolcatalog.GROUP_PROVIDERS)
    saved_lookup = agentrun.SECRET_LOOKUP
    install()
    TOOL_CACHE.clear()
    yield
    TOOL_CACHE.clear()
    agentrun._contributors.clear()
    agentrun._contributors.update(saved_contributors)
    toolcatalog.GROUP_PROVIDERS[:] = saved_providers
    agentrun.SECRET_LOOKUP = saved_lookup


@pytest.fixture
def env(tmp_path: Path) -> dict[str, Any]:
    state = appstate.state_dir()
    state.mkdir(parents=True, exist_ok=True)
    space = tmp_path / "My Notes"
    space.mkdir()
    return {"state": state, "space": space, "tmp": tmp_path}


_made: list[Path] = []


@pytest.fixture(autouse=True)
def _cleanup():
    yield
    while _made:
        shutil.rmtree(_made.pop(), ignore_errors=True)


def _agent(name: str = "Researcher", tools_off: list[str] | None = None,
           mcp: dict[str, Any] | None = None) -> AgentRecord:
    reg = AgentRegistry()
    rec = reg.create(AgentInput(name=name, toolsOff=tools_off), "Be curious.")
    if mcp is not None:
        (rec.folder / ".mcp.json").write_text(json.dumps({"mcpServers": mcp}), encoding="utf-8")
    return reg.get(rec.id)


def _with_off(rec: AgentRecord, off: list[str]) -> AgentRecord:
    return AgentRecord(**{**rec.__dict__, "data": {**rec.data, "toolsOff": off}})


def _scope(env: dict[str, Any], agent: AgentRecord, purpose: str = "chat", write: bool = True) -> RunScope:
    return RunScope(
        agent=agent, space_root=env["space"], space_name="Notes", api_url="http://127.0.0.1:8765",
        token=TOKEN, write=write, chat_id="01JC7ZK3T9Q4M2X8B5N6R1V0WF", purpose=purpose, state=env["state"],
    )


def _build(scope: RunScope) -> agentrun.RunCommand:
    cmd = build_run(scope, claude="claude", model=None, resume=None)
    _made.append(cmd.tmp)
    return cmd


def _value(args: list[str], flag: str) -> list[str]:
    return [p for p in args[args.index(flag) + 1].split(",") if p]


def _cmd_server(name: str, **kw: Any) -> McpServerInput:
    base: dict[str, Any] = {"name": name, "kind": "command", "command": "python", "args": ["srv.py"]}
    return McpServerInput(**{**base, **kw})


def _url_server(name: str, **kw: Any) -> McpServerInput:
    base: dict[str, Any] = {"name": name, "kind": "url", "url": "https://host.example/mcp"}
    return McpServerInput(**{**base, **kw})


def _probe(*names: str, ok: bool = True, error: str | None = None) -> ProbeResult:
    return ProbeResult(ok, tuple((n, f"{n} tool") for n in names), error, 5, "2026-11-06T09:00:00.000Z")


def _record(name: str):
    return next(r for r in McpStore().list() if r.data["name"] == name)


def _servers(cmd: agentrun.RunCommand) -> dict[str, Any]:
    return cmd.mcp_config["mcpServers"]


# -- install ---------------------------------------------------------------------------------


def test_install_is_idempotent() -> None:
    from objectapp import learnhooks

    learnhooks.install()
    install()
    install()
    listed = [(order, name) for order, name, _fn in contributors()]
    assert [n for _o, n in listed].count("gateway") == 1
    assert [n for _o, n in listed].count("gateway-tools") == 1
    assert (35, "gateway") in listed and (62, "gateway-tools") in listed
    names = [n for _o, n in listed]
    assert names.index("tools") < names.index("gateway-tools") < names.index("review-tools")
    assert names.index("object-mcp") < names.index("gateway") < names.index("agent-mcp")
    assert toolcatalog.GROUP_PROVIDERS.count(server_groups) == 1
    assert agentrun.SECRET_LOOKUP is secretstore.lookup_var


def test_tool_id_follows_the_cli() -> None:
    assert tool_id("fake", "echo") == "mcp__fake__echo"
    assert tool_id("odd-srv", "get-item.v2") == "mcp__odd-srv__get-item_v2"


def test_tool_cache_is_memory_only() -> None:
    cache = ToolCache()
    assert cache.get("gw:x:1") is None
    result = _probe("echo")
    cache.put("gw:x:1", result)
    assert cache.get("gw:x:1") is result


# -- the run ---------------------------------------------------------------------------------


def test_enabled_servers_join_the_run(env) -> None:
    store = McpStore()
    store.create(_cmd_server("alpha", env=[{"key": "API_KEY", "value": ENV_SECRET, "secret": True}]))
    store.create(_url_server("beta", bearer=BEARER_SECRET, bearerAction="set"))
    store.create(_cmd_server("gamma", enabled=False))
    cmd = _build(_scope(env, _agent()))
    servers = _servers(cmd)
    assert {"object", "object-agent", "alpha", "beta"} <= set(servers)
    assert "gamma" not in servers
    assert "--strict-mcp-config" in cmd.args
    allowed = _value(cmd.args, "--allowedTools")
    assert allowed.count("mcp__alpha") == 1 and allowed.count("mcp__beta") == 1
    assert "mcp__gamma" not in allowed
    gateway_env = {k: v for k, v in cmd.env.items() if k.startswith("OBJECT_MCP_")}
    assert sorted(gateway_env.values()) == sorted([ENV_SECRET, BEARER_SECRET])
    assert servers["alpha"]["env"]["API_KEY"].startswith("${OBJECT_MCP_")
    assert servers["beta"]["headers"]["Authorization"].startswith("Bearer ${OBJECT_MCP_")


def test_secret_values_never_in_files_args_or_logs(env, caplog) -> None:
    caplog.set_level(logging.DEBUG)
    store = McpStore()
    store.create(_cmd_server("alpha", env=[{"key": "API_KEY", "value": ENV_SECRET, "secret": True}]))
    store.create(_url_server("beta", headers=[{"name": "X-Api-Key", "value": HEADER_SECRET, "secret": True}],
                             bearer=BEARER_SECRET, bearerAction="set"))
    SecretStore().set("var:GH_TOKEN", VAR_SECRET)
    agent = _agent(mcp={"gh": {"command": "gh-mcp", "env": {"GH_TOKEN": "${GH_TOKEN}"}}})
    parts = agentrun.RunParts()
    scope = _scope(env, agent)
    for _order, _name, fn in contributors():
        fn(scope, parts)
    cmd = _build(scope)
    assert set(_servers(cmd)) >= {"alpha", "beta", "gh"}
    files = [p for p in cmd.tmp.rglob("*") if p.is_file()]
    assert {p.name for p in files} >= {"mcp.json", "run-settings.json", "append.md"}
    folder_files = [p for p in Path(agent.folder).rglob("*") if p.is_file()]
    assert any(p.name == "agent.json" for p in folder_files)
    for secret in SECRETS:
        for p in [*files, *folder_files]:
            assert secret not in p.read_text(encoding="utf-8", errors="replace"), p
        assert not any(secret in a for a in cmd.args)
        assert not any(secret in n for n in parts.notes)
        assert secret not in caplog.text
        assert secret not in json.dumps(cmd.mcp_config) and secret not in json.dumps(cmd.run_settings)
        assert secret in cmd.env.values()
    assert cmd.env["GH_TOKEN"] == VAR_SECRET


def test_switches_filter_the_run(env) -> None:
    McpStore().create(_cmd_server("fake"))
    rec = _record("fake")
    TOOL_CACHE.put(gateway_key(rec), _probe("echo", "add"))
    cmd = _build(_scope(env, _agent(tools_off=["mcp__fake__add"])))
    assert "fake" in _servers(cmd)
    assert "mcp__fake__add" in _value(cmd.args, "--disallowedTools")
    assert "mcp__fake" in _value(cmd.args, "--allowedTools")

    both = ["mcp__fake__add", "mcp__fake__echo"]
    agent = _agent("Second", tools_off=both)
    cmd = _build(_scope(env, agent))
    assert "fake" not in _servers(cmd)

    TOOL_CACHE.clear()  # after a restart: nothing known yet
    cmd = _build(_scope(env, agent))
    assert "fake" in _servers(cmd)
    disallowed = _value(cmd.args, "--disallowedTools")
    assert "mcp__fake__add" in disallowed and "mcp__fake__echo" in disallowed
    allowed = _value(cmd.args, "--allowedTools")
    # A tool the cache doesn't know is in neither list: allowed through the whole server.
    assert "mcp__fake__whoami" not in allowed and "mcp__fake__whoami" not in disallowed
    assert "mcp__fake" in allowed


def test_folder_server_off_tools_are_denied(env) -> None:
    agent = _agent(tools_off=["mcp__gh__create_issue"], mcp={"gh": {"command": "gh-mcp"}})
    cmd = _build(_scope(env, agent))
    assert "mcp__gh__create_issue" in _value(cmd.args, "--disallowedTools")
    assert _value(cmd.args, "--allowedTools").count("mcp__gh") == 1

    whole = _with_off(agent, ["mcp__gh"])
    cmd = _build(_scope(env, whole))
    assert "mcp__gh" in _value(cmd.args, "--disallowedTools")
    assert "mcp__gh" not in _value(cmd.args, "--allowedTools")


def test_disabled_and_clashing_servers_left_out(env) -> None:
    store = McpStore()
    store.create(_cmd_server("gh"))
    store.create(_cmd_server("keyed", env=[{"key": "API_KEY", "value": ENV_SECRET, "secret": True}]))
    store.create(_cmd_server("plain"))
    agent = _agent(mcp={"gh": {"command": "gh-folder-mcp"}})
    parts = agentrun.RunParts()
    scope = _scope(env, agent)
    for _order, _name, fn in contributors():
        fn(scope, parts)
    assert parts.mcp_servers["gh"] == {"command": "gh-folder-mcp"}
    assert CLASH_NOTE in parts.notes
    assert "keyed" in parts.mcp_servers and "plain" in parts.mcp_servers

    keyed = _record("keyed")
    SecretStore().delete_prefix(f"mcp:{keyed.data['id']}:")
    parts = agentrun.RunParts()
    for _order, _name, fn in contributors():
        fn(scope, parts)
    assert "keyed" not in parts.mcp_servers
    assert MISSING_NOTE.format("keyed") in parts.notes
    assert "plain" in parts.mcp_servers and parts.mcp_servers["gh"] == {"command": "gh-folder-mcp"}


def test_purposes_without_gateway(env) -> None:
    McpStore().create(_cmd_server("alpha", env=[{"key": "API_KEY", "value": ENV_SECRET, "secret": True}]))
    agent = _agent()
    for purpose in ("proposal", "review", "curator"):
        cmd = _build(_scope(env, agent, purpose=purpose, write=False))
        assert "alpha" not in _servers(cmd), purpose
        assert not any(k.startswith("OBJECT_MCP_") for k in cmd.env), purpose
    for purpose in ("chat", "delegate", "schedule"):
        cmd = _build(_scope(env, agent, purpose=purpose))
        assert "alpha" in _servers(cmd), purpose
        assert any(k.startswith("OBJECT_MCP_") for k in cmd.env), purpose


def test_folder_vars_resolve_from_secrets(env, monkeypatch) -> None:
    agent = _agent(mcp={"gh": {"command": "gh-mcp", "env": {"GH_TOKEN": "${GH_TOKEN}"}}})
    reg = AgentRegistry()
    assert reg.get(agent.id).to_api({})["mcpServers"] == [{"name": "gh", "missingVars": ["GH_TOKEN"], "usable": False}]
    SecretStore().set("var:GH_TOKEN", VAR_SECRET)
    assert reg.get(agent.id).to_api({})["mcpServers"] == [{"name": "gh", "missingVars": [], "usable": True}]
    cmd = _build(_scope(env, reg.get(agent.id)))
    assert "gh" in _servers(cmd)
    assert cmd.env["GH_TOKEN"] == VAR_SECRET
    assert VAR_SECRET not in json.dumps(cmd.mcp_config)

    home_var = "USERPROFILE"
    monkeypatch.setenv(home_var, str(env["tmp"]))
    other = _agent("Homer", mcp={"home": {"command": "home-mcp", "args": ["${" + home_var + "}"]}})
    assert reg.get(other.id).to_api({})["mcpServers"] == [{"name": "home", "missingVars": [], "usable": True}]


# -- the Tools tab ---------------------------------------------------------------------------


def _group(groups, gid: str):
    return next(g for g in groups if g.id == gid)


def test_server_groups(env) -> None:
    store = McpStore()
    store.create(_cmd_server("fake"))
    store.create(_cmd_server("off", enabled=False))
    agent = _agent(tools_off=["mcp__fake__add"], mcp={"gh": {"command": "gh-mcp"}})
    groups = server_groups(agent)
    assert [g.id for g in groups] == ["mcp:gh", "mcp:fake", "mcp:off"]
    gh = _group(groups, "mcp:gh")
    assert gh.label == "gh · this agent's folder"
    assert gh.server["source"] == "folder" and gh.server["status"] == "unknown"
    assert [t.id for t in gh.tools] == ["mcp__gh"]
    fake = _group(groups, "mcp:fake")
    assert fake.label == "fake" and fake.server["status"] == "unknown" and fake.tools == ()
    assert fake.server["serverId"] == _record("fake").data["id"]
    assert _group(groups, "mcp:off").server["status"] == "disabled"

    TOOL_CACHE.put(gateway_key(_record("fake")), _probe("echo", "add"))
    out = toolcatalog.groups_out(server_groups(agent), agent.data["toolsOff"])
    fake_out = next(g for g in out if g["id"] == "mcp:fake")
    assert [(t["id"], t["on"]) for t in fake_out["tools"]] == [("mcp__fake__add", False), ("mcp__fake__echo", True)]
    assert fake_out["server"]["status"] == "ok" and fake_out["server"]["fetchedAt"]

    key = next(k for k in probe_targets(agent) if k.startswith("folder:"))
    TOOL_CACHE.put(key, _probe("create_issue", "list_issues"))
    whole_off = _with_off(agent, ["mcp__gh"])
    gh = _group(server_groups(whole_off), "mcp:gh")
    assert [t.id for t in gh.tools] == ["mcp__gh", "mcp__gh__create_issue", "mcp__gh__list_issues"]
    assert gh.server["status"] == "ok"
    gh_on = _group(server_groups(agent), "mcp:gh")
    assert [t.id for t in gh_on.tools] == ["mcp__gh__create_issue", "mcp__gh__list_issues"]

    TOOL_CACHE.put(gateway_key(_record("fake")), _probe(ok=False, error="The server answered 500."))
    failed = _group(server_groups(agent), "mcp:fake")
    assert failed.server["status"] == "error" and failed.server["error"] == "The server answered 500."

    needy = _agent("Needy", mcp={"gh": {"command": "gh-mcp", "env": {"GH_TOKEN": "${GH_TOKEN}"}}})
    gh = _group(server_groups(needy), "mcp:gh")
    assert gh.server["status"] == "needsSecrets" and gh.server["missingVars"] == ["GH_TOKEN"]


def test_server_groups_folder_name_wins(env) -> None:
    McpStore().create(_cmd_server("gh"))
    agent = _agent(mcp={"gh": {"command": "gh-mcp"}})
    groups = server_groups(agent)
    assert [g.id for g in groups] == ["mcp:gh"] and groups[0].server["source"] == "folder"


def test_tools_route_uses_provider_groups(space_dir: Path) -> None:
    from objectapp.server import create_app
    from objectapp.space import Space

    app = create_app(Space(space_dir), None, watch=False)
    with TestClient(app) as client:
        made = client.post("/api/agents", json={"agent": {"name": "Researcher"}, "instructions": "x"}).json()
        folder = Path(made["folder"])
        (folder / ".mcp.json").write_text(json.dumps({"mcpServers": {"gh": {"command": "gh-mcp"}}}), encoding="utf-8")
        body = {"agent": {"name": "Researcher", "toolsOff": ["Read", "mcp__gh"]}, "baseRevision": made["revision"]}
        assert client.put(f"/api/agents/{made['id']}", json=body).status_code == 200
        rec = AgentRegistry().get(made["id"])
        key = next(k for k in probe_targets(rec) if k.startswith("folder:"))
        TOOL_CACHE.put(key, _probe("create_issue"))
        groups = client.get(f"/api/agents/{made['id']}/tools").json()["groups"]
    ids = [g["id"] for g in groups]
    assert ids.count("mcp:gh") == 1 and ids[-1] == "mcp:gh"
    gh = groups[-1]
    assert gh["label"] == "gh · this agent's folder" and gh["server"]["source"] == "folder"
    assert [(t["id"], t["on"]) for t in gh["tools"]] == [("mcp__gh", False), ("mcp__gh__create_issue", True)]
    assert all(g["server"] is None for g in groups[:-1])


def test_probe_targets(env) -> None:
    store = McpStore()
    store.create(_cmd_server("fake", env=[{"key": "API_KEY", "value": ENV_SECRET, "secret": True}]))
    store.create(_cmd_server("off", enabled=False))
    store.create(_cmd_server("keyed", env=[{"key": "API_KEY", "value": ENV_SECRET, "secret": True}]))
    SecretStore().delete_prefix(f"mcp:{_record('keyed').data['id']}:")
    agent = _agent(mcp={"gh": {"command": "gh-mcp"},
                        "needy": {"command": "needy-mcp", "env": {"NEED": "${NEED_TOKEN}"}}})
    targets = probe_targets(agent)
    fake = _record("fake")
    assert set(targets) == {folder_key(agent.id, "gh", {"command": "gh-mcp"}), gateway_key(fake)}
    folder_entry, folder_env, folder_cwd = next(v for k, v in targets.items() if k.startswith("folder:"))
    assert folder_entry == {"command": "gh-mcp"} and folder_env == {} and folder_cwd == Path(agent.folder)
    entry, gw_env, cwd = targets[gateway_key(fake)]
    assert cwd is None and list(gw_env.values()) == [ENV_SECRET]
    assert ENV_SECRET not in json.dumps(entry)

    store.save(fake.data["id"], _cmd_server("fake", args=["other.py"],
                                            env=[{"key": "API_KEY", "value": None, "secret": True}]), fake.revision)
    edited = _record("fake")
    assert gateway_key(edited) != gateway_key(fake)
    assert gateway_key(edited) in probe_targets(agent)


def test_fence_covers_the_state_files(env) -> None:
    state = Path(env["state"]).resolve()
    own = state / "agents" / "Researcher"
    rules = fence_rules([], own, state, Path.home())
    for name in ("secrets.json", "mcp-servers.json"):
        target = str(state / name)
        assert fake_claude._denied("Read", target, rules), name
        assert fake_claude._denied("Edit", target, rules), name
