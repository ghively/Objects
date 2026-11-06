"""M19 Task 1: the live CLI spike for the MCP gateway. Runs the real ``claude`` (Gene's login).

Skipped unless ``OBJECT_LIVE_CLAUDE=1``. It uses M17's live setup (`test_m17_live_cli`'s
`make_agent`: a temp agent folder under a temp ``OBJECT_STATE_DIR``, its long path, the
parent-session variables removed) with M17's ``CLI_FLAGS``, ``--model haiku`` and
``--no-session-persistence``, and a hand-built ``--mcp-config`` file naming the fake MCP server
(`fake_mcp_server`). Secret values (synthetic ``s3cret-...`` strings) go only into the CLI's
environment; the config holds ``${OBJECT_MCP_...}`` references. Tests compare the values a tool
answers and never print them. Nothing reads ``~/.claude`` or any token.

Findings: ``docs/superpowers/plans/m19-cli-spike.md``.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from test_m17_live_cli import (
    CLI_FLAGS,
    MODEL,
    PARENT_SESSION_VARS,
    RUN_SETTINGS_BASE,
    TIMEOUT,
    _claude,
    _init,
    _result_text,
    _tool_calls,
    claude_md_excludes,
    make_agent,
)

import fake_mcp_server

live = pytest.mark.skipif(
    os.environ.get("OBJECT_LIVE_CLAUDE") != "1", reason="live CLI spike: set OBJECT_LIVE_CLAUDE=1"
)

HERE = Path(__file__).resolve().parent
FAKE_MCP = HERE / "fake_mcp_server.py"


@pytest.fixture
def agent(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    state, folder = make_agent(tmp_path)
    monkeypatch.setenv("OBJECT_STATE_DIR", str(state))
    return folder


@pytest.fixture
def remote() -> Iterator[dict[str, str]]:
    """The fake's HTTP and SSE modes, each requiring its own bearer token."""
    tokens = {"http": "s3cret-live-http-T2", "sse": "s3cret-live-sse-T3"}
    urls: dict[str, str] = {}
    stops = []
    try:
        for mode, token in tokens.items():
            url, stop = fake_mcp_server.serve_in_thread(mode, require_bearer=token)
            urls[mode] = url
            stops.append(stop)
        yield {**urls, "httpToken": tokens["http"], "sseToken": tokens["sse"]}
    finally:
        for stop in stops:
            stop()


def stdio_entry(*extra: str, env: dict[str, str] | None = None) -> dict[str, Any]:
    return {"type": "stdio", "command": sys.executable, "args": [str(FAKE_MCP), *extra], "env": env or {}}


def run_mcp(
    tmp: Path,
    folder: Path,
    servers: dict[str, Any],
    prompt: str,
    *,
    allowed: list[str],
    disallowed: list[str] | None = None,
    env: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """One real ``claude -p`` run in `folder` with `servers` as its only ``--mcp-config``."""
    run = Path(tmp).resolve() / "run"
    run.mkdir(exist_ok=True)
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
        "--allowedTools", ",".join(allowed),
        "--disallowedTools", ",".join(disallowed or ["Bash", "PowerShell"]),
        "--model", MODEL, "--no-session-persistence",
    ]
    run_env = {k: v for k, v in os.environ.items() if not k.startswith(PARENT_SESSION_VARS)}
    run_env.update(env or {})
    res = subprocess.run(args, input=prompt, capture_output=True, text=True, encoding="utf-8", errors="replace",
                         cwd=folder, env=run_env, timeout=TIMEOUT)
    events = []
    for line in res.stdout.splitlines():
        try:
            events.append(json.loads(line))
        except ValueError:
            continue
    if not any(e.get("type") == "result" for e in events):
        raise AssertionError(f"no result (exit {res.returncode}): {res.stderr[-2000:]}")
    return events


def statuses(events: list[dict[str, Any]]) -> dict[str, str]:
    return {str(s.get("name")): str(s.get("status")) for s in _init(events).get("mcp_servers") or []}


def calls(events: list[dict[str, Any]]) -> list[tuple[str, str, bool]]:
    """(tool name, result text, is_error) per tool call. The CLI shows a tool's structured answer
    (``{"result": "<text>"}`` for the fake's string tools); the text is unwrapped from it."""
    out = []
    for u, r in _tool_calls(events):
        text = _result_text(r)
        try:
            data = json.loads(text)
        except ValueError:
            data = None
        if isinstance(data, dict) and set(data) == {"result"}:
            text = str(data["result"])
        out.append((str(u.get("name")), text, bool((r or {}).get("is_error"))))
    return out


def finding(name: str, value: Any) -> None:
    """Spike findings go to stdout (``pytest -s``); never a secret value."""
    print(f"FINDING {name}: {json.dumps(value)}")


@live
def test_mcp_config_shapes_and_expansion(tmp_path: Path, agent: Path, remote: dict[str, str]) -> None:
    stdio_secret = "s3cret-live-stdio-T1"
    servers = {
        "fstdio": stdio_entry("--require-env", "FAKE_KEY", env={"FAKE_KEY": "${OBJECT_MCP_T1}"}),
        "fhttp": {"type": "http", "url": remote["http"], "headers": {"Authorization": "Bearer ${OBJECT_MCP_T2}"}},
        "fsse": {"type": "sse", "url": remote["sse"], "headers": {"Authorization": "Bearer ${OBJECT_MCP_T3}"}},
        # ${VAR} in args too: the fake requires the variable named by the expanded argument.
        "fargs": stdio_entry("--require-env", "${OBJECT_MCP_T4}", env={"FAKE_ARG_KEY": "${OBJECT_MCP_T1}"}),
    }
    env = {"OBJECT_MCP_T1": stdio_secret, "OBJECT_MCP_T2": remote["httpToken"],
           "OBJECT_MCP_T3": remote["sseToken"], "OBJECT_MCP_T4": "FAKE_ARG_KEY"}
    prompt = ("Call these four tools, one after another, each exactly once, with no arguments: "
              "mcp__fstdio__whoami, mcp__fhttp__whoami, mcp__fsse__whoami, mcp__fargs__whoami. "
              "Then answer DONE.")
    events = run_mcp(tmp_path, agent, servers, prompt,
                     allowed=["mcp__fstdio", "mcp__fhttp", "mcp__fsse", "mcp__fargs"], env=env)
    st = statuses(events)
    finding("shapes.statuses", st)
    tools = [t for t in _init(events).get("tools") or [] if str(t).startswith("mcp__")]
    finding("shapes.tools", sorted(tools))
    assert st == {"fstdio": "connected", "fhttp": "connected", "fsse": "connected", "fargs": "connected"}
    for name in ("fstdio", "fhttp", "fsse", "fargs"):
        assert f"mcp__{name}__echo" in tools
    results = {n: (text, err) for n, text, err in calls(events)}
    finding("shapes.called", sorted(results))
    assert results["mcp__fstdio__whoami"] == (stdio_secret, False)
    assert results["mcp__fargs__whoami"] == (stdio_secret, False)
    # The URL servers connected only with the bearer (401 otherwise); their calls answer.
    assert results["mcp__fhttp__whoami"][1] is False and results["mcp__fsse__whoami"][1] is False
    mcp_json = (Path(tmp_path).resolve() / "run" / "mcp.json").read_text(encoding="utf-8")
    secrets = (stdio_secret, remote["httpToken"], remote["sseToken"])
    assert all(v not in mcp_json for v in secrets)


@live
def test_unset_and_default_vars(tmp_path: Path, agent: Path) -> None:
    """What the CLI does with an unset ``${VAR}`` and with ``${VAR:-default}`` (recorded for `expand_refs`)."""
    servers = {
        "funset": stdio_entry("--require-env", "FAKE_KEY", env={"FAKE_KEY": "${OBJECT_MCP_UNSET_Q9}"}),
        "fdefault": stdio_entry("--require-env", "FAKE_KEY", env={"FAKE_KEY": "${OBJECT_MCP_UNSET_Q9:-dflt-value}"}),
    }
    prompt = ("If the tool mcp__funset__whoami exists, call it once. If the tool mcp__fdefault__whoami exists, "
              "call it once. No arguments. Then answer DONE.")
    events = run_mcp(tmp_path, agent, servers, prompt, allowed=["mcp__funset", "mcp__fdefault"])
    st = statuses(events)
    results = {n: (text, err) for n, text, err in calls(events)}
    finding("unset.statuses", st)
    finding("unset.results", results)
    assert st.get("fdefault") == "connected"
    assert results.get("mcp__fdefault__whoami") == ("dflt-value", False)
    # An unset ${VAR} is left as written (2.1.317): the server starts and sees the literal text.
    assert st.get("funset") == "connected"
    assert results.get("mcp__funset__whoami") == ("${OBJECT_MCP_UNSET_Q9}", False)


@live
def test_only_listed_servers_reach_a_run(tmp_path: Path, agent: Path) -> None:
    servers = {"only-one": stdio_entry(), "only_two": stdio_entry()}
    events = run_mcp(tmp_path, agent, servers, "Answer OK.", allowed=["mcp__only-one", "mcp__only_two"])
    names = sorted(statuses(events))
    finding("strict.names", names)
    assert names == ["only-one", "only_two"]


@live
def test_server_allow_and_tool_deny(tmp_path: Path, agent: Path) -> None:
    servers = {"fake": stdio_entry()}
    prompt = ('Call mcp__fake__echo with text "hello", then call mcp__fake__add with a=2 and b=3. '
              "Call each once, even if one fails. Then answer DONE.")
    events = run_mcp(tmp_path, agent, servers, prompt, allowed=["mcp__fake"],
                     disallowed=["Bash", "PowerShell", "mcp__fake__add"])
    tools = [t for t in _init(events).get("tools") or [] if str(t).startswith("mcp__")]
    got = calls(events)
    finding("deny.tools", sorted(tools))
    finding("deny.calls", got)
    echo = [c for c in got if c[0] == "mcp__fake__echo"]
    assert echo and echo[0][1] == "hello" and not echo[0][2]
    # A disallowed tool is either removed from the tool list or refused when called.
    add = [c for c in got if c[0] == "mcp__fake__add"]
    assert "mcp__fake__add" not in tools or (add and add[0][2])
    assert not any(c[0] == "mcp__fake__add" and not c[2] for c in got)


@live
@pytest.mark.skipif(os.name != "nt", reason="Windows only")
def test_windows_cmd_shim(tmp_path: Path, agent: Path) -> None:
    shim_dir = Path(tmp_path).resolve() / "shim"
    shim_dir.mkdir()
    shim = shim_dir / "fake-mcp.cmd"
    shim.write_text(f'@"{sys.executable}" "{FAKE_MCP}" %*\r\n', encoding="utf-8")
    servers = {
        "shim": {"type": "stdio", "command": str(shim), "args": [], "env": {}},
        "shimwrapped": {"type": "stdio", "command": "cmd", "args": ["/c", str(shim)], "env": {}},
    }
    events = run_mcp(tmp_path, agent, servers, "Answer OK.", allowed=["mcp__shim", "mcp__shimwrapped"])
    st = statuses(events)
    finding("cmd.statuses", st)
    # 2.1.317 starts a .cmd command as given, so `cli_entry` doesn't wrap it in "cmd /c".
    assert st == {"shim": "connected", "shimwrapped": "connected"}


@live
def test_tool_name_normalisation(tmp_path: Path, agent: Path) -> None:
    # Object's own names are [A-Za-z0-9_-]; "odd.dot" only shows the CLI's rule for server names too.
    servers = {"odd-srv": stdio_entry("--odd-name"), "odd.dot": stdio_entry("--odd-name")}
    events = run_mcp(tmp_path, agent, servers, "Answer OK.", allowed=["mcp__odd-srv", "mcp__odd_dot"])
    tools = sorted(t for t in _init(events).get("tools") or [] if str(t).startswith("mcp__"))
    finding("names.statuses", statuses(events))
    finding("names.tools", tools)
    # The rule found (2.1.317): every character outside [A-Za-z0-9_-] becomes "_", in the server
    # name and in the tool name.
    assert "mcp__odd-srv__get-item_v2" in tools
    assert "mcp__odd_dot__get-item_v2" in tools


def test_spike_findings_doc_exists() -> None:
    """Not live: the findings the later tasks build on are written down."""
    doc = HERE.parents[1] / "docs" / "superpowers" / "plans" / "m19-cli-spike.md"
    text = doc.read_text(encoding="utf-8")
    for heading in ("CLI version", "Entry shapes", "Tool names", ".cmd", "OAuth"):
        assert heading in text
