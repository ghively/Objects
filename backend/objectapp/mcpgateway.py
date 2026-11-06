"""The MCP gateway (M19): outside MCP servers in every agent run, and their Tools tab groups.

M17's extension points:

- the run contributors ``gateway`` (order 35) and ``gateway-tools`` (order 62, after M17's
  ``tools`` and before M18's ``review-tools``);
- `server_groups`, appended to `toolcatalog.GROUP_PROVIDERS`;
- `agentrun.SECRET_LOOKUP` = `secretstore.lookup_var`;
- `TOOL_CACHE`, the tools last listed per server, in memory only (never write on read).

Cache keys: ``gw:<serverId>:<revision>`` and ``folder:<agentId>:<name>:<sha256 of its .mcp.json
entry>``.

Secret values reach a run only through `RunParts.env` (under `secret_env_name` names, or a
folder server's own ``${VAR}`` names); the run's ``mcp.json`` holds only ``${...}`` references.
Nothing here writes a file. Imports no network client.
"""

from __future__ import annotations

import hashlib
import re
import threading
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit

from pydantic import ValidationError

from . import agentfiles, agentrun, secretstore, toolcatalog
from .jsonstore import dump_json
from .mcpmodel import GATEWAY_PURPOSES, NAME_PATTERN, RESERVED_NAMES, McpServerFile
from .mcpprobe import ProbeResult
from .mcpstore import McpServerRecord, McpStore, MissingSecret, cli_entry, secret_env_name

if TYPE_CHECKING:
    from .agentrun import RunParts, RunScope
    from .agents import AgentRecord
    from .toolcatalog import ToolGroup

__all__ = [
    "TOOL_CACHE",
    "ToolCache",
    "cli_entry",
    "folder_key",
    "gateway_contributor",
    "gateway_key",
    "gateway_tools_contributor",
    "install",
    "probe_targets",
    "secret_env_name",
    "server_groups",
    "tool_id",
]

FOLDER_LABEL = "{name} · this agent's folder"  # our string
CLASH_NOTE = "Skipped the MCP server '{name}': this agent's folder has one with the same name."  # our string
MISSING_NOTE = "Skipped the MCP server '{name}': a secret is missing. Set it again in Settings."  # our string
UNREADABLE_NOTE = "Skipped the MCP server '{name}': it can't be read."  # our string

_NAME = re.compile(NAME_PATTERN)
_CLI_CHARS = re.compile(r"[^A-Za-z0-9_-]")
"""(T1 spike) The CLI replaces every character outside ``[A-Za-z0-9_-]`` with ``_``."""


def install() -> None:
    """Idempotent; called once by `server.create_app`."""
    agentrun.add_contributor("gateway", 35, gateway_contributor)
    agentrun.add_contributor("gateway-tools", 62, gateway_tools_contributor)
    if server_groups not in toolcatalog.GROUP_PROVIDERS:
        toolcatalog.GROUP_PROVIDERS.append(server_groups)
    agentrun.SECRET_LOOKUP = secretstore.lookup_var


def tool_id(server: str, tool: str) -> str:
    """``mcp__<server>__<tool>``, with the CLI's normalisation of the tool name as the T1 spike
    found it (``docs/superpowers/plans/m19-cli-spike.md``): every character outside
    ``[A-Za-z0-9_-]`` becomes ``_``, in the server name and the tool name."""
    return f"mcp__{_CLI_CHARS.sub('_', server)}__{_CLI_CHARS.sub('_', tool)}"


# -- the tool cache --------------------------------------------------------------------------


class ToolCache:
    """Thread-safe, memory only."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._items: dict[str, ProbeResult] = {}

    def get(self, key: str) -> ProbeResult | None:
        with self._lock:
            return self._items.get(key)

    def put(self, key: str, result: ProbeResult) -> None:
        with self._lock:
            self._items[key] = result

    def clear(self) -> None:
        with self._lock:
            self._items.clear()


TOOL_CACHE = ToolCache()


def gateway_key(rec: McpServerRecord) -> str:
    """``gw:<serverId>:<revision>``, so an edited server is listed again."""
    return f"gw:{rec.data.get('id')}:{rec.revision}"


def folder_key(agent_id: str, name: str, server: dict[str, Any]) -> str:
    """``folder:<agentId>:<name>:<sha256 of its .mcp.json entry>``."""
    digest = hashlib.sha256(dump_json(server)).hexdigest()
    return f"folder:{agent_id}:{name}:{digest}"


# -- helpers ---------------------------------------------------------------------------------


def _off(agent: Any) -> list[str]:
    off = agent.data.get("toolsOff") if isinstance(agent.data, dict) else None
    return [t for t in off if isinstance(t, str)] if isinstance(off, list) else []


def _usable_name(name: Any) -> bool:
    return isinstance(name, str) and bool(_NAME.fullmatch(name)) and name not in RESERVED_NAMES


def _runnable(data: dict[str, Any]) -> bool:
    """A stored server a run can use: it fits `McpServerFile`, a command server has a command and
    a URL server an http(s) address with a host. Anything else (a hand edit, a newer version's
    entry) is left out, so one bad entry never breaks every run's ``--mcp-config``."""
    try:
        McpServerFile.model_validate(data)
    except ValidationError:
        return False
    if data.get("kind") == "command":
        command = data.get("command")
        return isinstance(command, str) and command.strip() != ""
    url = data.get("url")
    if not isinstance(url, str):
        return False
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    return parts.scheme in ("http", "https") and bool(parts.hostname)


def _folder_servers(agent: Any) -> dict[str, dict[str, Any]]:
    if not getattr(agent, "exists", True) or getattr(agent, "missing", False):
        return {}
    return agentfiles.folder_mcp_servers(Path(agent.folder))


def _missing_vars(server: dict[str, Any]) -> list[str]:
    lookup = agentrun.SECRET_LOOKUP  # read at call time
    return sorted(v for v in agentfiles.var_refs(server) if lookup(v) is None)


def _cached_names(result: ProbeResult | None) -> list[str]:
    if result is None or not result.ok:
        return []
    return [name for name, _desc in result.tools]


# -- the run ---------------------------------------------------------------------------------


def gateway_contributor(scope: RunScope, parts: RunParts) -> None:
    """Each enabled server (file order) into ``parts.mcp_servers`` and its secrets into ``parts.env``,
    for `mcpmodel.GATEWAY_PURPOSES` only; skips a name the folder already has (a note), a stored
    entry that can't be read (a note), a server whose every known tool is off (no note) and one
    with a missing secret (a note)."""
    if scope.purpose not in GATEWAY_PURPOSES:
        return
    store = McpStore(scope.state)
    off = set(_off(scope.agent))
    for rec in store.list():
        data = rec.data
        if not data.get("enabled", True):
            continue
        name = data.get("name")
        if not _usable_name(name):
            continue
        if name in parts.mcp_servers:
            parts.notes.append(CLASH_NOTE.format(name=name))
            continue
        if not _runnable(data):
            parts.notes.append(UNREADABLE_NOTE.format(name=name))
            continue
        known = _cached_names(TOOL_CACHE.get(gateway_key(rec)))
        if known and all(tool_id(name, t) in off for t in known):
            continue
        try:
            entry, env = cli_entry(data, store.secrets)
        except MissingSecret:
            parts.notes.append(MISSING_NOTE.format(name=name))
            continue
        parts.mcp_servers[name] = entry
        parts.env.update(env)


def gateway_tools_contributor(scope: RunScope, parts: RunParts) -> None:
    """``mcp__<name>`` allowed (unless already disallowed) and each off ``mcp__<name>__...`` id
    disallowed, for every outside server in ``parts.mcp_servers``."""
    off = _off(scope.agent)
    for name in parts.mcp_servers:
        if name in RESERVED_NAMES:
            continue
        whole = f"mcp__{name}"
        if whole not in parts.disallowed and whole not in parts.allowed:
            parts.allowed.append(whole)
        prefix = whole + "__"
        for tid in off:
            if tid.startswith(prefix) and tid not in parts.disallowed:
                parts.disallowed.append(tid)


# -- the Tools tab ---------------------------------------------------------------------------


def _status(source: str, server_id: str | None, name: str, status: str, result: ProbeResult | None,
            missing: list[str]) -> dict[str, Any]:
    """The API's ``McpGroupStatus``."""
    return {
        "source": source,
        "serverId": server_id,
        "name": name,
        "status": status,
        "error": result.error if result is not None and not result.ok else None,
        "fetchedAt": result.at if result is not None else None,
        "missingVars": list(missing),
    }


def _result_status(result: ProbeResult | None) -> str:
    if result is None:
        return "unknown"
    return "ok" if result.ok else "error"


def _tool_rows(name: str, result: ProbeResult | None) -> list[toolcatalog.ToolEntry]:
    rows: list[toolcatalog.ToolEntry] = []
    seen: set[str] = set()
    for tool in sorted(_cached_names(result)):
        tid = tool_id(name, tool)
        if tid in seen:
            continue
        seen.add(tid)
        rows.append(toolcatalog.ToolEntry(tid, tool, (tid,)))
    return rows


def server_groups(agent: AgentRecord) -> list[ToolGroup]:
    """One group per folder server (label ``"<name> · this agent's folder"``), then one per gateway
    server (label ``<name>``), each with ``server`` set to its ``McpGroupStatus``."""
    off = set(_off(agent))
    groups: list[ToolGroup] = []
    folder = _folder_servers(agent)
    for name, server in folder.items():
        if not _usable_name(name):
            continue
        missing = _missing_vars(server)
        result = TOOL_CACHE.get(folder_key(agent.id, name, server))
        rows = _tool_rows(name, result)
        whole = f"mcp__{name}"
        if not rows or whole in off:
            rows = [toolcatalog.ToolEntry(whole, name, (whole,)), *rows]
        status = "needsSecrets" if missing else _result_status(result)
        groups.append(toolcatalog.ToolGroup(
            f"mcp:{name}", FOLDER_LABEL.format(name=name), tuple(rows),
            server=_status("folder", None, name, status, result, missing),
        ))
    store = McpStore()
    for rec in store.list():
        name = rec.data.get("name")
        if not _usable_name(name) or name in folder:
            continue
        server_id = str(rec.data.get("id") or "")
        result = TOOL_CACHE.get(gateway_key(rec))
        missing = rec.to_api(store.secrets, None)["missingSecrets"]
        if not rec.data.get("enabled", True):
            status = "disabled"
        elif missing:
            status = "needsSecrets"
        else:
            status = _result_status(result)
        groups.append(toolcatalog.ToolGroup(
            f"mcp:{name}", name, tuple(_tool_rows(name, result)),
            server=_status("gateway", server_id, name, status, result, missing),
        ))
    return groups


def probe_targets(agent: AgentRecord) -> dict[str, tuple[dict[str, Any], dict[str, str], Path | None]]:
    """Cache key -> (entry, env, cwd) for the agent's usable folder servers (cwd = its folder) and
    its enabled gateway servers (cwd None); servers with missing secrets are not probed."""
    targets: dict[str, tuple[dict[str, Any], dict[str, str], Path | None]] = {}
    folder = _folder_servers(agent)
    lookup = agentrun.SECRET_LOOKUP
    for name, server in folder.items():
        if not _usable_name(name):
            continue
        env: dict[str, str] = {}
        missing = False
        for var in sorted(agentfiles.var_refs(server)):
            value = lookup(var)
            if value is None:
                missing = True
                break
            env[var] = value
        if missing:
            continue
        targets[folder_key(agent.id, name, server)] = (server, env, Path(agent.folder))
    store = McpStore()
    for rec in store.list():
        name = rec.data.get("name")
        if not rec.data.get("enabled", True) or not _usable_name(name) or name in folder:
            continue
        if not _runnable(rec.data):
            continue
        try:
            entry, env = cli_entry(rec.data, store.secrets)
        except MissingSecret:
            continue
        targets[gateway_key(rec)] = (entry, env, None)
    return targets
