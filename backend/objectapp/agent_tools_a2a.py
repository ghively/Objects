"""The ``object-agent`` server's ``remote_agents_list``, ``remote_agent_call`` and ``delegate``
tools (M20, spec sections 7 and 8), over the routes in ``api_agent_a2a_v1``.

M20 Task 1 holds this stub, listed in ``agent_mcp.TOOL_MODULES``; Task 6 registers the tools.
"""

from __future__ import annotations

from mcp.server.mcpserver import MCPServer

from .mcp_server import ObjectClient

__all__ = ["register"]


def register(server: MCPServer, client: ObjectClient) -> None:
    """Add the three tools to `server` (none yet: M20 Task 6)."""
    return None
