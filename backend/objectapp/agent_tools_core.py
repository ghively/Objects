"""M17's agent tools for the ``object-agent`` MCP server (`objectapp.agent_mcp`): ``agent_info``."""

from __future__ import annotations

from mcp.server.mcpserver import MCPServer

from .mcp_server import READ, ObjectClient

__all__ = ["register"]


def register(server: MCPServer, client: ObjectClient) -> None:
    """Add M17's agent tools to `server`."""

    @server.tool(annotations=READ)
    def agent_info() -> dict:
        """Who you are and where you work: your agent id, name, model and folder, and the
        name of the space this chat is in."""
        return client.get("/agent/info")
