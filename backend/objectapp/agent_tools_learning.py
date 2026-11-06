"""M18's agent tools for the ``object-agent`` MCP server (`objectapp.agent_mcp`): ``memory``,
``skills_list``, ``skill_view``, ``skill_manage`` and ``session_search``.

T1 stub: `register` adds nothing yet; the plan's T5 fills it.
"""

from __future__ import annotations

from mcp.server.mcpserver import MCPServer

from .mcp_server import ObjectClient

__all__ = ["register"]


def register(server: MCPServer, client: ObjectClient) -> None:
    """Add M18's agent tools to `server` (T5)."""
    return None
