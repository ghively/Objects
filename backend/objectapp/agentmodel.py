"""The agent's own fields (M17): the ``agent.json`` schema and the constants every agent module shares.

An agent is a folder laid out as a Claude Code project (spec section 1). Object keeps its own
fields in ``<folder>/.object-agent/agent.json``; this module is that file's model and the rules
for what create and save accept. No file is read or written here.

The errors live here too (`AgentError` and its four kinds, re-exported by ``agents``), so
`clean_input` can raise `AgentInvalid` without importing the registry.
"""

from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, ConfigDict

from .aimodels import clean_model
from .typemodel import THEME_COLORS

__all__ = [
    "AGENTS_DIR",
    "AGENT_FILE",
    "AGENT_ID",
    "DEFAULT_AGENT_ICON",
    "DEFAULT_AGENT_ID",
    "DEFAULT_AGENT_NAME",
    "DEFAULT_SOUL",
    "DESCRIPTION_MAX",
    "GITIGNORE",
    "META",
    "NAME_MAX",
    "NEW_AGENT_ICON",
    "PROTECTED",
    "REGISTRY_FILE",
    "SCHEMA_VERSION",
    "SESSIONS_DIR",
    "SHELL_WARNING",
    "TRASH_DIR",
    "AgentConflict",
    "AgentError",
    "AgentFile",
    "AgentInput",
    "AgentInvalid",
    "AgentNotFound",
    "AgentReadOnly",
    "clean_input",
]

SCHEMA_VERSION = 1
DEFAULT_AGENT_ID = "assistant"
DEFAULT_AGENT_NAME = "Assistant"
DEFAULT_AGENT_ICON = "ph-sparkle"
NEW_AGENT_ICON = "ph-robot"
NAME_MAX = 60
DESCRIPTION_MAX = 500
AGENTS_DIR = "agents"
TRASH_DIR = ".trash"
REGISTRY_FILE = "agents.json"
META = ".object-agent"
AGENT_FILE = ".object-agent/agent.json"
SESSIONS_DIR = ".object-agent/sessions"
PROTECTED = ("CLAUDE.md", ".claude/**", ".object-agent/**")
"""Built-in Write/Edit is denied on these in the agent's own folder (spec section 3)."""
GITIGNORE = "settings.local.json\ncache/\n"
"""Written on create (spec section 1, verbatim)."""
AGENT_ID = r"^(?:assistant|[0-9A-HJKMNP-TV-Z]{26})$"
SHELL_WARNING = (
    "With the shell on, this agent can read every file on this computer, including pages excluded from AI."
)
DEFAULT_SOUL = (
    "You are Assistant, the assistant inside Object, the user's local Markdown notes app. "
    "Be concise. When you change notes, say what you changed."
)  # our string

NEWER_VERSION = "This agent was made by a newer version of Object."  # read-only reason
UNREADABLE = "This agent's settings can't be read."  # read-only reason

_PHOSPHOR = re.compile(r"ph-[a-z0-9]+(?:-[a-z0-9]+)*")
_SPACES = re.compile(r"\s+")


class AgentError(Exception):
    """An agent operation refused; `status` is the HTTP answer the routes give."""

    status = 400

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class AgentNotFound(AgentError):
    status = 404


class AgentConflict(AgentError):
    status = 409

    def __init__(self, message: str, current_revision: str | None = None) -> None:
        super().__init__(message)
        self.current_revision = current_revision


class AgentInvalid(AgentError):
    status = 422


class AgentReadOnly(AgentError):
    status = 423


class AgentFile(BaseModel):
    """``.object-agent/agent.json``. Unknown top-level keys are kept (``extra="allow"``)."""

    model_config = ConfigDict(extra="allow")

    schemaVersion: int
    id: str
    name: str
    icon: str | None
    color: str | None
    description: str = ""
    model: str | None = None
    toolsOff: list[str] = []
    learning: dict[str, Any] | None = None
    """Reserved for M18 (kept verbatim by M17)."""
    createdAt: str
    updatedAt: str


class AgentInput(BaseModel):
    """What create and save accept."""

    name: str
    icon: str | None = None
    color: str | None = None
    description: str = ""
    model: str | None = None
    toolsOff: list[str] | None = None
    learning: dict[str, Any] | None = None


def _clean_icon(icon: str | None) -> str | None:
    if icon is None:
        return None
    text = icon.strip()
    if not text:
        return None
    if _PHOSPHOR.fullmatch(text):
        return text
    # One emoji: a short run of non-ASCII, non-space characters (a ZWJ sequence or a flag is
    # several code points). Our rule.
    if len(text) <= 16 and all(ord(c) > 127 for c in text) and not any(c.isspace() for c in text):
        return text
    raise AgentInvalid("An icon is a Phosphor name or one emoji.")  # our string


def clean_input(inp: AgentInput) -> AgentInput:
    """`inp` with its name's whitespace collapsed, checked against the caps and the model rule.

    Raises `AgentInvalid(message)`.
    """
    name = _SPACES.sub(" ", inp.name or "").strip()
    if not name:
        raise AgentInvalid("An agent needs a name.")  # our string
    if len(name) > NAME_MAX:
        raise AgentInvalid(f"A name can be at most {NAME_MAX} characters.")  # our string
    description = (inp.description or "").strip()
    if len(description) > DESCRIPTION_MAX:
        raise AgentInvalid(f"A description can be at most {DESCRIPTION_MAX} characters.")  # our string
    try:
        model = clean_model(inp.model)
    except ValueError as e:
        raise AgentInvalid(str(e)) from None
    color = inp.color.strip() if isinstance(inp.color, str) and inp.color.strip() else None
    if color is not None and color not in THEME_COLORS:
        raise AgentInvalid("That isn't a colour Object knows.")  # our string
    tools_off: list[str] | None = None
    if inp.toolsOff is not None:
        tools_off = []
        for item in inp.toolsOff:
            if not isinstance(item, str) or not item.strip():
                raise AgentInvalid("A tool switch names a tool.")  # our string
            if item.strip() not in tools_off:
                tools_off.append(item.strip())
    return AgentInput(
        name=name,
        icon=_clean_icon(inp.icon),
        color=color,
        description=description,
        model=model,
        toolsOff=tools_off,
        learning=inp.learning,
    )
