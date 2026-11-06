"""M18's agent tools for the ``object-agent`` MCP server (`objectapp.agent_mcp`): ``memory``,
``skills_list``, ``skill_view``, ``skill_manage`` and ``session_search``.

Each tool makes exactly one ``/api/v1/agent/...`` call (`api_learning_v1`), so a run's step
budget counts it once. Each docstring states the tool's rules, so the agent sees them.
"""

from __future__ import annotations

from typing import Literal
from urllib.parse import quote

from mcp.server.mcpserver import MCPServer

from .mcp_server import READ, WRITE, ApiError, ObjectClient

__all__ = ["register"]


def register(server: MCPServer, client: ObjectClient) -> None:
    """Add M18's agent tools to `server`."""

    @server.tool(annotations=WRITE)
    def memory(action: Literal["add", "replace", "remove"], target: Literal["memory", "user"],
               content: str | None = None, old_text: str | None = None) -> dict:
        """Save lasting facts for your next chats. target "memory" is MEMORY.md (your work and
        environment); target "user" is USER.md (the person you work for).

        - add: content is a new entry. Keep entries short; one fact each.
        - replace: old_text is a unique substring of one entry; content is that entry's new text.
        - remove: old_text is a unique substring of the entry to remove.

        Entries are separated by a line holding only §, so an entry can't hold such a line.
        Caps (in characters): MEMORY.md 2,200 and USER.md 1,375 by default. A write past the cap
        fails and lists the current entries: consolidate with replace or remove first. What you
        save shows up in your next chat, not this one."""
        return client.post(
            "/agent/memory", {"action": action, "target": target, "content": content, "old_text": old_text}
        )

    @server.tool(annotations=READ)
    def skills_list() -> dict:
        """Your skills (active and stale): name, description, who wrote it (createdBy "agent"
        or "user"), state, pinned, uses and when last used. Read one with skill_view."""
        return client.get("/agent/skills")

    @server.tool(annotations=READ)
    def skill_view(name: str, file: str | None = None) -> dict:
        """Read one of your skills: SKILL.md, or a support file (file, e.g.
        "references/x.md"). Answers the text and the skill's file list. Reading counts as a use
        of the skill, and lets you change it with skill_manage in this run."""
        return client.get(f"/agent/skills/{quote(name, safe='')}", file=file)

    @server.tool(annotations=WRITE)
    def skill_manage(action: Literal["create", "patch", "edit", "write_file", "remove_file", "archive"],
                     name: str, description: str | None = None, content: str | None = None,
                     old_string: str | None = None, new_string: str | None = None,
                     replace_all: bool = False, file: str | None = None,
                     absorbed_into: str | None = None) -> dict:
        """Create and improve your skills. Improve an existing skill before making a new one.

        - create: name, description and content (the body; the front matter is written for you).
        - patch: old_string -> new_string in SKILL.md, or in file (a support file); old_string
          must be found once, or set replace_all.
        - edit: content is the whole new SKILL.md, front matter included.
        - write_file / remove_file: a support file (file) under references/, templates/ or
          scripts/; content is the file's text.
        - archive: put a skill away (restorable); absorbed_into names the active skill it was
          merged into. There is no delete.

        Rules: read the skill with skill_view first (in this run) before a patch or edit. A name
        is at most 64 characters: lower-case letters, digits and hyphens. A description is 1 to
        60 characters. SKILL.md is at most 100,000 characters; a support file at most 1 MiB.
        SKILL.md must keep its front matter with its name and a description."""
        return client.post("/agent/skills/manage", {
            "action": action, "name": name, "description": description, "content": content,
            "old_string": old_string, "new_string": new_string, "replace_all": replace_all or None,
            "file": file, "absorbed_into": absorbed_into,
        })

    @server.tool(annotations=READ)
    def session_search(query: str | None = None, chat_id: str | None = None, limit: int = 10) -> dict:
        """Find your earlier chats. With query: full-text search over your own chats (user and
        assistant messages), best first, each with its chatId, title and up to 3 snippets
        (matches marked «»); limit is 1 to 25. With chat_id: read that chat's messages (at most
        40,000 characters, the oldest cut first)."""
        if chat_id:
            return client.get(f"/agent/sessions/{quote(chat_id, safe='')}")
        if query:
            return client.get("/agent/sessions/search", q=query, limit=limit)
        raise ApiError("Give a query or a chat_id.")
