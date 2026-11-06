"""Saved AI chats (M10): ordinary objects of the "AI Chat" type.

The type is made the first time a chat is saved (never on read): name "AI Chat", plural
"AI Chats", with a relation property "Context" (``context``, many objects: the pages the
chat was about) and a text property "Session" (``session``, the Claude Code session id a
later turn resumes). M17 adds the text property "Agent" (``agent``, the name of the agent the
chat was with), on the next save; existing chat files are never rewritten for it. A chat's body is Markdown in our own format::

    # <title>

    ## You
    <!-- at: 2026-11-05T12:00:00.000Z -->

    The user's message.

    ## Claude
    <!-- at: 2026-11-05T12:00:05.000Z -->

    The answer.

Role headings are read outside fenced code only. A message line that looks like a role
heading (``## You``, ``## Claude``) is written with a backslash in front (Markdown shows
it the same) and read back without it; a message that leaves a code fence open gets a
closing fence, so the messages after it still read.
"""

from __future__ import annotations

import copy
import re
from typing import Any

from .ids import new_ulid
from .typemodel import PROPERTY_ICONS, Icon, PropertyDefinition, TypeDefinition

__all__ = [
    "AGENT_KEY",
    "CHAT_TYPE_NAME",
    "agent_key",
    "default_title",
    "ensure_chat_type",
    "find_chat_type",
    "parse_body",
    "render_body",
]

CHAT_TYPE_NAME = "AI Chat"
CHAT_TYPE_PLURAL = "AI Chats"
CHAT_TYPE_ICON = "ph-chats-circle"
CHAT_TYPE_COLOR = "violet"
CONTEXT_KEY = "context"
SESSION_KEY = "session"
AGENT_KEY = "agent"
AGENT_DESCRIPTION = "The agent this chat was with"  # our string
TITLE_MAX = 60

ROLE_HEADINGS = {"user": "You", "assistant": "Claude"}
_HEADING_ROLES = {v.casefold(): k for k, v in ROLE_HEADINGS.items()}
_ROLE_LINE = re.compile(r"^## (You|Claude)[ \t]*$", re.IGNORECASE)
_ESCAPED_ROLE_LINE = re.compile(r"^(\\+)(## (?:You|Claude)[ \t]*)$", re.IGNORECASE)
_AT_LINE = re.compile(r"^<!-- at: ?(.*?) ?-->[ \t]*$")
_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")


# -- the type -------------------------------------------------------------------------


def find_chat_type(space) -> TypeDefinition | None:
    """The AI Chat type: by its id, else by name (any case)."""
    t = space.type_by_id("ai-chat")
    if t is not None and t.name.casefold() == CHAT_TYPE_NAME.casefold():
        return t
    for t in space.types:
        if t.name.casefold() == CHAT_TYPE_NAME.casefold():
            return t
    return None


def _prop(t: TypeDefinition, key: str, name: str, kinds: tuple[str, ...]) -> PropertyDefinition | None:
    for p in t.propertyDefinitions:
        if p.key == key and p.type in kinds:
            return p
    for p in t.propertyDefinitions:
        if p.name.casefold() == name.casefold() and p.type in kinds:
            return p
    return None


def chat_keys(t: TypeDefinition | None) -> tuple[str | None, str | None]:
    """The (context, session) property keys of the chat type, None where missing."""
    if t is None:
        return None, None
    ctx = _prop(t, CONTEXT_KEY, "Context", ("entity",))
    ses = _prop(t, SESSION_KEY, "Session", ("text", "textBlock"))
    return (ctx.key if ctx else None), (ses.key if ses else None)


def agent_key(t: TypeDefinition | None) -> str | None:
    """The key of the chat type's Agent property (M17), None where missing."""
    if t is None:
        return None
    p = _prop(t, AGENT_KEY, "Agent", ("text", "textBlock"))
    return p.key if p else None


def ensure_chat_type(space) -> tuple[TypeDefinition, bool]:
    """The AI Chat type with its Context, Session and Agent properties, made or completed as
    needed (through `Space.create_type` and `Space.save_type`); (type, changed)."""
    changed = False
    t = find_chat_type(space)
    if t is None:
        t = space.create_type(CHAT_TYPE_NAME, CHAT_TYPE_PLURAL, icon=CHAT_TYPE_ICON, color=CHAT_TYPE_COLOR)
        changed = True
    ctx, ses = chat_keys(t)
    agent = agent_key(t)
    if ctx is None or ses is None or agent is None:
        taken = {p.key for p in t.propertyDefinitions}
        new = copy.deepcopy(t)
        if ctx is None:
            key = CONTEXT_KEY if CONTEXT_KEY not in taken else f"{CONTEXT_KEY}-{new_ulid()[-6:].lower()}"
            new.propertyDefinitions.append(PropertyDefinition(
                id=key, key=key, name="Context", type="entity",
                icon=Icon("iconify", PROPERTY_ICONS["entity"]),
                options={"isArray": True, "allowedTypes": [], "hasFixedSet": False, "fixedSet": []},
            ))
        if ses is None:
            key = SESSION_KEY if SESSION_KEY not in taken else f"{SESSION_KEY}-{new_ulid()[-6:].lower()}"
            new.propertyDefinitions.append(PropertyDefinition(
                id=key, key=key, name="Session", type="text",
                description="The Claude Code session this chat continues",
                icon=Icon("iconify", PROPERTY_ICONS["text"]),
            ))
        if agent is None:
            taken = {p.key for p in new.propertyDefinitions}
            key = AGENT_KEY if AGENT_KEY not in taken else f"{AGENT_KEY}-{new_ulid()[-6:].lower()}"
            new.propertyDefinitions.append(PropertyDefinition(
                id=key, key=key, name="Agent", type="text",
                description=AGENT_DESCRIPTION,
                icon=Icon("iconify", PROPERTY_ICONS["text"]),
            ))
        _current, revision = space.refresh_type(t.id)
        space.save_type(new, revision)
        t = space.type_by_id(t.id) or new
        changed = True
    return t, changed


# -- the body -------------------------------------------------------------------------


def default_title(messages: list[dict[str, Any]]) -> str:
    """The first user message's first line, trimmed to `TITLE_MAX` characters."""
    for m in messages:
        if m.get("role") == "user":
            text = " ".join(str(m.get("text") or "").split())
            if text:
                if len(text) <= TITLE_MAX:
                    return text
                cut = text[:TITLE_MAX].rsplit(" ", 1)[0] or text[:TITLE_MAX]
                return cut.rstrip() + "…"
    return "AI chat"


def _fence_state(line: str, fence: str | None) -> str | None:
    """The open fence marker after `line` (None outside code)."""
    m = _FENCE.match(line)
    if fence is None:
        if m:
            return m.group(1)
        return None
    if m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence) and not m.group(2).strip():
        return None
    return fence


def _escape(text: str) -> str:
    lines = text.replace("\r\n", "\n").split("\n")
    out: list[str] = []
    fence: str | None = None
    for line in lines:
        if fence is None and (_ROLE_LINE.match(line) or _ESCAPED_ROLE_LINE.match(line)):
            line = "\\" + line
        fence = _fence_state(line, fence)
        out.append(line)
    if fence is not None:
        out.append(fence)  # close what the message left open
    return "\n".join(out)


def render_body(title: str, messages: list[dict[str, Any]]) -> str:
    parts = [f"# {title}".rstrip() + "\n"]
    for m in messages:
        heading = ROLE_HEADINGS.get(str(m.get("role")), "You")
        at = str(m.get("at") or "")
        text = _escape(str(m.get("text") or "")).strip("\n")
        block = f"## {heading}\n<!-- at: {at} -->\n"
        if text:
            block += f"\n{text}\n"
        parts.append(block)
    return "\n".join(parts)


def parse_body(body: str) -> list[dict[str, Any]]:
    """The messages of a chat body (headings inside fenced code are text)."""
    lines = body.replace("\r\n", "\n").split("\n")
    messages: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    buf: list[str] = []
    fence: str | None = None

    def finish() -> None:
        if current is None:
            return
        text_lines = list(buf)
        if text_lines and _AT_LINE.match(text_lines[0]):
            current["at"] = _AT_LINE.match(text_lines[0]).group(1)
            text_lines = text_lines[1:]
        unescaped: list[str] = []
        inner: str | None = None
        for line in text_lines:
            m = _ESCAPED_ROLE_LINE.match(line) if inner is None else None
            unescaped.append(m.group(1)[1:] + m.group(2) if m else line)
            inner = _fence_state(line, inner)
        current["text"] = "\n".join(unescaped).strip("\n")
        messages.append(current)

    for line in lines:
        m = _ROLE_LINE.match(line) if fence is None else None
        if m:
            finish()
            current = {"role": _HEADING_ROLES[m.group(1).casefold()], "text": "", "at": ""}
            buf = []
            continue
        fence = _fence_state(line, fence)
        if current is not None:
            buf.append(line)
    finish()
    return [{"role": m["role"], "text": m["text"], "at": m["at"]} for m in messages]
