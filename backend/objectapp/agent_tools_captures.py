"""The ``object-agent`` server's ``file_capture`` tool (M24): files one brain dump through
``POST /api/v1/agent/work/file-capture``. One call per tool call, to the loopback app only. Only a
``work-file`` run may use it; the route says so. The route itself is filled by M24 T3.
"""

from __future__ import annotations

from typing import Any, Literal

from mcp.server.mcpserver import MCPServer

from .mcp_server import WRITE, ObjectClient

__all__ = ["DESCRIPTION", "register"]

DESCRIPTION = """\
File the brain dump you were given (capture is its path). outcome is exactly one of: "workNote" \
(a Work notes line on item, with text), "step" (one new step on item that isn't an Approve step: \
step_kind question, do or agent, and step_text), "task" (a new Task: task_title), "fact" (a fact \
on a page: page, optionally section, and text) or "needsYou" (needs question: one question for the \
user). The brain dump is never deleted."""


def register(server: MCPServer, client: ObjectClient) -> None:
    """Add ``file_capture`` to `server`."""

    @server.tool(annotations=WRITE, description=DESCRIPTION)
    def file_capture(
        capture: str,
        outcome: Literal["workNote", "step", "task", "fact", "needsYou"],
        item: str | None = None,
        text: str | None = None,
        step_kind: str | None = None,
        step_text: str | None = None,
        task_title: str | None = None,
        page: str | None = None,
        section: str | None = None,
        question: str | None = None,
    ) -> dict:
        fields: dict[str, Any] = {
            "item": item, "text": text, "stepKind": step_kind, "stepText": step_text,
            "taskTitle": task_title, "page": page, "section": section, "question": question,
        }
        body = {"capture": capture, "outcome": outcome, **{k: v for k, v in fields.items() if v is not None}}
        return client.post("/agent/work/file-capture", body)
