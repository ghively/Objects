"""The ``object-agent`` server's ``schedule_manage`` tool (M21, spec section 9), over the routes in
``api_schedules_v1``. Each call makes exactly one ``/api/v1/agent/schedules`` call through
`mcp_server.ObjectClient`, to the loopback app only.
"""

from __future__ import annotations

from typing import Any, Literal
from urllib.parse import quote

from mcp.server.mcpserver import MCPServer

from .mcp_server import REPLACE, ApiError, ObjectClient

__all__ = ["DESCRIPTION", "register"]

DESCRIPTION = """\
Manage your own schedules in the open space: prompts that run on a schedule as new chats of you, \
only while this space is open, each saved as an AI Chat note.
action: "list" (your schedules), "create" (needs name, prompt and repeat), "update" (needs \
schedule_id; only the fields you give change; clear_model goes back to your default model) or \
"delete" (needs schedule_id; the schedule goes to the Trash and can be restored).
repeat examples: "every day", "every weekday", "every week on monday", "every 2 weeks on friday", \
"every month on the 1st".
time is HH:mm in the space's time zone (default 09:00); start is the first day, YYYY-MM-DD (default: \
the first day the repeat reaches from today).
{date:YYYY-MM-DD} in a prompt becomes the run's date."""


def _need(value: Any, field: str, action: str) -> None:
    if value is None or (isinstance(value, str) and not value.strip() and field != "prompt"):
        raise ApiError(f"{action} needs {field}.")  # our string


def register(server: MCPServer, client: ObjectClient) -> None:
    """Add ``schedule_manage`` to `server`."""

    @server.tool(annotations=REPLACE, description=DESCRIPTION)
    def schedule_manage(
        action: Literal["list", "create", "update", "delete"],
        schedule_id: str | None = None,
        name: str | None = None,
        prompt: str | None = None,
        repeat: str | None = None,
        time: str | None = None,
        start: str | None = None,
        model: str | None = None,
        enabled: bool | None = None,
        clear_model: bool = False,
    ) -> dict:
        if action == "list":
            return client.get("/agent/schedules")
        if action == "create":
            for value, field in ((name, "name"), (prompt, "prompt"), (repeat, "repeat")):
                _need(value, field, "create")
            body: dict[str, Any] = {"name": name, "prompt": prompt, "repeat": repeat, "start": start,
                                    "model": model}
            if time is not None:
                body["time"] = time
            if enabled is not None:
                body["enabled"] = enabled
            return client.post("/agent/schedules", body)
        _need(schedule_id, "schedule_id", action)
        route = f"/agent/schedules/{quote(str(schedule_id), safe='')}"
        if action == "update":
            fields = {"name": name, "prompt": prompt, "repeat": repeat, "time": time, "start": start,
                      "model": model, "enabled": enabled}
            body = {k: v for k, v in fields.items() if v is not None}
            if clear_model:
                body["clearModel"] = True
            return client.put(route, body)
        if action == "delete":
            return client.delete(route)
        raise ApiError(f"Unknown action {action!r}.")
