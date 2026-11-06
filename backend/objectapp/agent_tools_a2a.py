"""The ``object-agent`` server's ``remote_agents_list``, ``remote_agent_call`` and ``delegate``
tools (M20, spec sections 7 and 8), over the routes in ``api_agent_a2a_v1``.

Each tool makes exactly one ``/api/v1/agent/...`` call. A remote call or a delegation can take
minutes, longer than M11's client waits (30 s), so these tools use their own `ObjectClient`
whose ``httpx.Client`` waits `CLIENT_TIMEOUT` seconds (`DELEGATE_TIMEOUT` + 30). httpx goes to
the loopback app only, as ``agent_mcp`` does.
"""

from __future__ import annotations

import httpx
from mcp.server.mcpserver import MCPServer

from .mcp_server import READ, WRITE, ObjectClient
from .remotemodel import DELEGATE_TIMEOUT

__all__ = ["CLIENT_TIMEOUT", "long_client", "register"]

CLIENT_TIMEOUT = DELEGATE_TIMEOUT + 30
"""Seconds these tools' client waits for an answer (our number)."""


def long_client(client: ObjectClient) -> ObjectClient:
    """`client` with an ``httpx.Client`` that waits `CLIENT_TIMEOUT` seconds. A client built on
    another transport (tests pass the app's TestClient) is kept as it is."""
    if type(client.http) is not httpx.Client:
        return client
    own = ObjectClient(client.base, "", httpx.Client(timeout=CLIENT_TIMEOUT))
    own.headers = dict(client.headers)
    return own


def register(server: MCPServer, client: ObjectClient) -> None:
    """Add the three tools to `server`."""
    calls = long_client(client)

    @server.tool(annotations=READ)
    def remote_agents_list() -> dict:
        """List the remote (A2A) agents you can call, with what their cards say they do."""
        return calls.get("/agent/remote-agents")

    @server.tool(annotations=WRITE)
    def remote_agent_call(agent: str, message: str, context_id: str | None = None, task_id: str | None = None,
                          timeout_seconds: float | None = None) -> dict:
        """Send a message to a remote agent and wait for its answer. Pass context_id (and task_id when it asked for input) to continue."""
        return calls.post("/agent/remote-call", {
            "agent": agent, "message": message, "contextId": context_id, "taskId": task_id,
            "timeoutSeconds": timeout_seconds,
        })

    @server.tool(annotations=WRITE)
    def delegate(agent: str, goal: str, context: str = "") -> dict:
        """Hand a task to another agent (local or remote) by name, with a goal and context; it runs as that agent's own chat and you get back its summary."""
        return calls.post("/agent/delegate", {"agent": agent, "goal": goal, "context": context})
