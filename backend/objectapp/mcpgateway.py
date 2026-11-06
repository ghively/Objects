"""The MCP gateway (M19): outside MCP servers in every agent run, and their Tools tab groups.

M17's extension points:

- the run contributors ``gateway`` (order 35) and ``gateway-tools`` (order 62, after M17's
  ``tools`` and before M18's ``review-tools``);
- `server_groups`, appended to `toolcatalog.GROUP_PROVIDERS`;
- `agentrun.SECRET_LOOKUP` = `secretstore.lookup_var`;
- `TOOL_CACHE`, the tools last listed per server, in memory only (never write on read).

Cache keys: ``gw:<serverId>:<revision>`` and ``folder:<agentId>:<name>:<sha256 of its .mcp.json
entry>``.

T1 stub: `install` is a no-op until the plan's Task 5 fills this module. Imports no network
client.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

from .mcpprobe import ProbeResult
from .mcpstore import cli_entry, secret_env_name

if TYPE_CHECKING:
    from .agentrun import RunParts, RunScope
    from .agents import AgentRecord
    from .toolcatalog import ToolGroup

__all__ = [
    "TOOL_CACHE",
    "ToolCache",
    "cli_entry",
    "gateway_contributor",
    "gateway_tools_contributor",
    "install",
    "probe_targets",
    "secret_env_name",
    "server_groups",
    "tool_id",
]


def install() -> None:
    """Idempotent; called once by `server.create_app`. T5 fills it:

    ``agentrun.add_contributor("gateway", 35, gateway_contributor)``,
    ``agentrun.add_contributor("gateway-tools", 62, gateway_tools_contributor)``,
    ``toolcatalog.GROUP_PROVIDERS.append(server_groups)`` (once) and
    ``agentrun.SECRET_LOOKUP = secretstore.lookup_var``.
    """


def tool_id(server: str, tool: str) -> str:
    """``mcp__<server>__<tool>``, with the CLI's normalisation of the tool name as the T1 spike
    found it (``docs/superpowers/plans/m19-cli-spike.md``)."""
    raise NotImplementedError


def gateway_contributor(scope: RunScope, parts: RunParts) -> None:
    """Each enabled server (file order) into ``parts.mcp_servers`` and its secrets into ``parts.env``,
    for `mcpmodel.GATEWAY_PURPOSES` only; skips a name the folder already has (a note), a server
    whose every known tool is off (no note) and one with a missing secret (a note)."""
    raise NotImplementedError


def gateway_tools_contributor(scope: RunScope, parts: RunParts) -> None:
    """``mcp__<name>`` allowed (unless already disallowed) and each off ``mcp__<name>__...`` id
    disallowed, for every outside server in ``parts.mcp_servers``."""
    raise NotImplementedError


def server_groups(agent: AgentRecord) -> list[ToolGroup]:
    """One group per folder server (label ``"<name> · this agent's folder"``), then one per gateway
    server (label ``<name>``), each with ``server`` set to its ``McpGroupStatus``."""
    raise NotImplementedError


class ToolCache:
    """Thread-safe, memory only."""

    def get(self, key: str) -> ProbeResult | None:
        raise NotImplementedError

    def put(self, key: str, result: ProbeResult) -> None:
        raise NotImplementedError


TOOL_CACHE = ToolCache()


def probe_targets(agent: AgentRecord) -> dict[str, tuple[dict[str, Any], dict[str, str], Path | None]]:
    """Cache key -> (entry, env, cwd) for the agent's usable folder servers (cwd = its folder) and
    its enabled gateway servers (cwd None); servers with missing secrets are not probed."""
    raise NotImplementedError
