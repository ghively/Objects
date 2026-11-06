"""The MCP gateway's schemas and constants (M19, spec section 6).

Outside MCP servers live in ``<state>/mcp-servers.json`` (`SERVERS_FILE`), their secret values
in ``<state>/secrets.json`` (`SECRETS_FILE`). A stored server never holds a secret value: a
secret env or header row has ``secret: true`` and no ``value``, and ``bearer: true`` means a
token is in the secrets file. The ``*Input`` models are what the routes accept.

Imports no network client (M10's ``test_ai_modules_use_no_network_client``).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

__all__ = [
    "ENV_KEY_PATTERN",
    "ENV_PASSTHROUGH",
    "ENV_PREFIX",
    "GATEWAY_PURPOSES",
    "HEADER_NAME_PATTERN",
    "MAX_ARGS",
    "MAX_ROWS",
    "MAX_SECRET_CHARS",
    "MAX_SERVERS",
    "MAX_VALUE_CHARS",
    "NAME_PATTERN",
    "PROBE_STDERR_CHARS",
    "PROBE_TIMEOUT_S",
    "RESERVED_NAMES",
    "RESERVED_VARS",
    "RESERVED_VAR_PREFIXES",
    "SCHEMA_VERSION",
    "SECRETS_FILE",
    "SERVERS_FILE",
    "TOOL_DESCRIPTION_MAX",
    "VAR_PATTERN",
    "EnvRow",
    "EnvRowInput",
    "HeaderRow",
    "HeaderRowInput",
    "McpServerFile",
    "McpServerInput",
]

SCHEMA_VERSION = 1
SERVERS_FILE = "mcp-servers.json"
SECRETS_FILE = "secrets.json"
NAME_PATTERN = r"[A-Za-z0-9_-]{1,64}"
"""A server name (fullmatch); M17's folder-server rule, shared."""
RESERVED_NAMES = ("object", "object-agent")
"""`toolcatalog.OBJECT_SERVER` and `toolcatalog.AGENT_SERVER`."""
ENV_KEY_PATTERN = r"[A-Za-z_][A-Za-z0-9_]{0,127}"
"""A stdio server's env key."""
HEADER_NAME_PATTERN = r"[A-Za-z0-9!#$%&*+.^_|~-]{1,128}"
"""An HTTP header token (backtick and quote left out)."""
VAR_PATTERN = r"[A-Za-z_][A-Za-z0-9_]{0,63}"
"""A secret variable name."""
RESERVED_VAR_PREFIXES = ("CLAUDE", "ANTHROPIC", "OBJECT_")
"""Compared case-insensitively."""
RESERVED_VARS = ("PATH", "PATHEXT", "COMSPEC", "SYSTEMROOT", "PYTHONPATH", "PYTHONHOME", "NODE_OPTIONS")
ENV_PASSTHROUGH = ("HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP")
"""Folder ``${VAR}``s that resolve from Object's own environment (not secrets; can't be set in Object)."""
ENV_PREFIX = "OBJECT_MCP_"
"""The env names of gateway secrets in a run."""
MAX_SERVERS = 50
MAX_ROWS = 50
MAX_ARGS = 50
MAX_VALUE_CHARS = 4000
MAX_SECRET_CHARS = 16384
PROBE_TIMEOUT_S = 20
PROBE_STDERR_CHARS = 2000
TOOL_DESCRIPTION_MAX = 300
GATEWAY_PURPOSES: tuple[str, ...] = ("chat", "delegate", "schedule")
"""`RunScope.purpose` values that get gateway servers. M24 appends "work", "work-read",
"work-file" and "work-sync"."""


class EnvRow(BaseModel):
    """A stored env row; a secret row has no value here."""

    model_config = ConfigDict(extra="allow")
    key: str
    value: str | None = None
    secret: bool = False


class HeaderRow(BaseModel):
    """A stored header row; a secret row has no value here."""

    model_config = ConfigDict(extra="allow")
    name: str
    value: str | None = None
    secret: bool = False


class McpServerFile(BaseModel):
    """One stored server in ``mcp-servers.json``; unknown keys are kept."""

    model_config = ConfigDict(extra="allow")
    id: str
    name: str
    enabled: bool = True
    kind: Literal["command", "url"]
    command: str | None = None
    args: list[str] = []
    env: list[EnvRow] = []
    transport: Literal["http", "sse"] | None = None
    url: str | None = None
    headers: list[HeaderRow] = []
    bearer: bool = False
    createdAt: str
    updatedAt: str


class EnvRowInput(BaseModel):
    key: str
    value: str | None = None
    secret: bool = False


class HeaderRowInput(BaseModel):
    name: str
    value: str | None = None
    secret: bool = False


class McpServerInput(BaseModel):
    """What ``POST``/``PUT /mcp-servers`` accept.

    A secret row's value of None means "keep the stored value". On create, or for a row that
    wasn't secret before, it is a 422 "Enter a value for API_KEY.". ``bearer``: with
    ``bearerAction`` "set" the new token; "remove" drops it; "keep" keeps it.
    """

    name: str
    enabled: bool = True
    kind: Literal["command", "url"]
    command: str | None = None
    args: list[str] = []
    env: list[EnvRowInput] = []
    transport: Literal["http", "sse"] | None = None
    url: str | None = None
    headers: list[HeaderRowInput] = []
    bearer: str | None = None
    bearerAction: Literal["keep", "set", "remove"] = "keep"
