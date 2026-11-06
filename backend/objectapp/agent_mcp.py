"""The "Object agent tools" MCP server (M17), run as ``python -m objectapp.agent_mcp``.

An agent's turn starts it beside ``objectapp-mcp`` (the run's ``object-agent`` server). Its
tools act on the agent the turn belongs to: they call ``/api/v1/agent/*`` with the turn's
token, and that token names one agent and one space.

- The environment holds ``OBJECT_API_URL`` (a loopback address only) and
  ``OBJECT_API_TOKEN`` (the turn's ephemeral token).
- Each module in `TOOL_MODULES` has ``register(server, client) -> None`` and adds its tools.
  M17's one module (`objectapp.agent_tools_core`) adds ``agent_info``; M18's
  (`objectapp.agent_tools_learning`) adds the memory, skill and chat-search tools; M20, M21 and
  M24 append theirs.
"""

from __future__ import annotations

import argparse
import importlib
import logging
import os
import sys

from mcp.server.mcpserver import MCPServer

from .mcp_server import DEFAULT_URL, ObjectClient, _check_url

__all__ = ["INSTRUCTIONS", "SERVER_NAME", "TOOL_MODULES", "build_server", "main"]

SERVER_NAME = "object-agent"

TOOL_MODULES: tuple[str, ...] = (
    "objectapp.agent_tools_core", "objectapp.agent_tools_learning",
    # M20
    "objectapp.agent_tools_a2a",
    # M21
    "objectapp.agent_tools_schedules",
)
"""The modules whose ``register(server, client)`` adds this server's tools, in build order."""

INSTRUCTIONS = """\
Tools about you, the agent this chat is with, in the user's local notes app Object.
`agent_info` tells you your id, name, model and folder, and the space you are working in."""


def build_server(client: ObjectClient) -> MCPServer:
    """The ``object-agent`` server with every `TOOL_MODULES` module's tools."""
    server = MCPServer(name=SERVER_NAME, instructions=INSTRUCTIONS)
    for name in TOOL_MODULES:
        importlib.import_module(name).register(server, client)
    return server


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="objectapp-agent-mcp", description=__doc__.split("\n\n")[0])
    parser.add_argument("--url", default=None, help=f"the app's address (default {DEFAULT_URL})")
    args = parser.parse_args(argv)
    logging.getLogger("httpx").setLevel(logging.WARNING)  # stderr is the client's log; keep it quiet
    url = _check_url(args.url or os.environ.get("OBJECT_API_URL") or DEFAULT_URL)
    token = os.environ.get("OBJECT_API_TOKEN", "").strip()
    if not token:
        print("objectapp-agent-mcp: OBJECT_API_TOKEN isn't set (an agent turn sets it).", file=sys.stderr)
        raise SystemExit(2)
    build_server(ObjectClient(url, token)).run(transport="stdio")


if __name__ == "__main__":
    main()
