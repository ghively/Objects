"""The ``object-agent`` server's ``sync_ticket_fields`` tool (M24): Desk sync's one write, through
``POST /api/v1/agent/work/ticket-fields``. Only a ``work-sync`` run may use it; the route says so.
The route itself is filled by M24 T8.
"""

from __future__ import annotations

from typing import Any

from mcp.server.mcpserver import MCPServer

from .mcp_server import WRITE, ObjectClient

__all__ = ["DESCRIPTION", "register"]

DESCRIPTION = """\
Desk sync only: set ticket fields on one work item. path and version are the item's (from \
work_item); values holds only ticket fields (ticketId, ticketLink, deskStatus, deskPriority and the others \
work_item lists). Never use it for anything else."""


def register(server: MCPServer, client: ObjectClient) -> None:
    """Add ``sync_ticket_fields`` to `server`."""

    @server.tool(annotations=WRITE, description=DESCRIPTION)
    def sync_ticket_fields(path: str, version: str, values: dict[str, Any]) -> dict:
        return client.post("/agent/work/ticket-fields", {"path": path, "version": version, "values": values})
