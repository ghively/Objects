"""Remote agents' schemas and the M20 constants (spec sections 7 and 8).

A remote agent is a ``kind: "remote"`` registry entry whose folder (always in the state dir)
holds ``.object-agent/agent.json`` (`RemoteAgentFile`), ``card.json``, ``sessions/`` and
``files/``. Its secret (a bearer token or a header value) never goes into any of them: it lives
in M19's ``<state>/secrets.json`` under `SECRET_KEY` (see ``remotesecrets``).

Imports no network client (M10's ``test_ai_modules_use_no_network_client``).
"""

from __future__ import annotations

import re
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict

from .agentmodel import AgentInvalid

__all__ = [
    "A2A_BINDING",
    "A2A_VERSION",
    "CARD_MAX_BYTES",
    "CARD_PATH",
    "CARD_TIMEOUT",
    "CONNECT_TIMEOUT",
    "DATA_BLOCK_MAX_CHARS",
    "DELEGATE_MAX_AT_ONCE",
    "DELEGATE_SUMMARY_CAP",
    "DELEGATE_TIMEOUT",
    "FILE_MAX_BYTES",
    "FORBIDDEN_HEADERS",
    "HEADER_NAME",
    "OUTPUT_MODES",
    "POLL_INTERVAL",
    "REMOTE_CALL_TIMEOUT",
    "REMOTE_CALL_TIMEOUT_MAX",
    "REMOTE_ICON",
    "REMOTE_KIND",
    "REMOTE_TEXT_CAP",
    "RESPONSE_MAX_BYTES",
    "SECRET_KEY",
    "STREAM_MAX_BYTES",
    "AuthInput",
    "RemoteAgentFile",
    "RemoteAuth",
    "RemoteEndpoint",
    "card_url_for",
    "clean_auth",
]

REMOTE_KIND = "remote"
REMOTE_ICON = "ph-globe"
A2A_VERSION = "1.0"
A2A_BINDING = "JSONRPC"
CARD_PATH = "/.well-known/agent-card.json"
CARD_MAX_BYTES = 1_048_576
"""The card as fetched (our number)."""
RESPONSE_MAX_BYTES = 10_485_760
"""One JSON-RPC answer (our number)."""
STREAM_MAX_BYTES = 52_428_800
"""One stream in total (our number)."""
FILE_MAX_BYTES = 26_214_400
"""One raw file artifact (our number)."""
DATA_BLOCK_MAX_CHARS = 20_000
"""One data part's JSON in the reply text (our number)."""
CONNECT_TIMEOUT = 10.0
CARD_TIMEOUT = 15.0
POLL_INTERVAL = 1.0
"""Seconds (our numbers)."""
REMOTE_TEXT_CAP = 100_000
"""``remote_agent_call``'s text (our number)."""
REMOTE_CALL_TIMEOUT = 120.0
REMOTE_CALL_TIMEOUT_MAX = 240.0
"""``remote_agent_call``'s default and largest timeout, in seconds (our numbers)."""
DELEGATE_SUMMARY_CAP = 24_000
"""Spec section 8."""
DELEGATE_MAX_AT_ONCE = 3
"""Spec section 8."""
DELEGATE_TIMEOUT = 240.0
"""Our number; below ``ai.TURN_TIMEOUT`` (300), so the caller's turn outlives it."""
SECRET_KEY = "a2a:{agent_id}"
"""The key in M19's secrets store (M19 reserves the ``a2a:`` prefix)."""
HEADER_NAME = r"^[A-Za-z0-9-]{1,64}$"
"""A custom auth header's name; and not one of `FORBIDDEN_HEADERS`."""
FORBIDDEN_HEADERS = frozenset({"host", "content-length", "content-type", "accept", "a2a-version",
                               "connection", "transfer-encoding", "cookie"})
OUTPUT_MODES = ("text/plain", "text/markdown", "application/json")
_VALUE_MAX = 4096
"""A token or header value's longest length (the Contract's ``clean_auth`` rule)."""

_HEADER_NAME_RE = re.compile(HEADER_NAME)


class RemoteAuth(BaseModel):
    """``agent.json``'s ``auth``: how the secret is sent. The value itself is never here."""

    kind: Literal["none", "bearer", "header"] = "none"
    headerName: str | None = None


class RemoteEndpoint(BaseModel):
    """The interface Object talks to, from the card's ``supportedInterfaces``."""

    url: str
    protocolVersion: str
    binding: Literal["JSONRPC"] = "JSONRPC"


class RemoteAgentFile(BaseModel):
    """A remote agent's ``.object-agent/agent.json``. Unknown top-level keys are kept."""

    model_config = ConfigDict(extra="allow")

    schemaVersion: int
    kind: Literal["remote"]
    id: str
    name: str
    icon: str | None
    color: str | None
    cardUrl: str
    endpoint: RemoteEndpoint
    streaming: bool
    auth: RemoteAuth
    contextNoticeAt: str | None = None
    cardFetchedAt: str
    createdAt: str
    updatedAt: str


class AuthInput(BaseModel):
    """What the routes accept for a remote agent's auth (the value only on entry)."""

    kind: Literal["none", "bearer", "header"]
    headerName: str | None = None
    value: str | None = None


def clean_auth(inp: AuthInput) -> AuthInput:
    """`inp` checked: a ``header`` needs a name that fits `HEADER_NAME` and isn't forbidden;
    ``bearer`` and ``header`` need a value of 1-`_VALUE_MAX` characters with no CR or LF;
    ``none`` drops any value and name. Raises `AgentInvalid` (our strings)."""
    if inp.kind == "none":
        return AuthInput(kind="none")
    header_name: str | None = None
    if inp.kind == "header":
        header_name = (inp.headerName or "").strip()
        if not _HEADER_NAME_RE.match(header_name) or header_name.lower() in FORBIDDEN_HEADERS:
            raise AgentInvalid(
                "A header name is 1-64 letters, digits or dashes, and can't be one Object sets itself."
            )
    value = inp.value or ""
    if not value:
        raise AgentInvalid("Enter the token.")
    if len(value) > _VALUE_MAX:
        raise AgentInvalid(f"A token can be at most {_VALUE_MAX} characters.")
    if "\r" in value or "\n" in value:
        raise AgentInvalid("A token can't hold a line break.")
    return AuthInput(kind=inp.kind, headerName=header_name, value=value)


def card_url_for(url: str) -> str:
    """The Agent Card URL for what Gene typed: a ``.json`` path is the card as is; anything else
    gets `CARD_PATH` at its host's root. Only http and https; raises `AgentInvalid`."""
    text = (url or "").strip()
    try:
        parts = urlsplit(text)
        host = parts.hostname
        port = parts.port
    except ValueError:
        raise AgentInvalid("That isn't an http or https address.") from None
    if parts.scheme.lower() not in ("http", "https") or not host:
        raise AgentInvalid("That isn't an http or https address.")
    if parts.path.lower().endswith(".json"):
        return text
    netloc = f"[{host}]" if ":" in host else host
    if port is not None:
        netloc = f"{netloc}:{port}"
    return f"{parts.scheme.lower()}://{netloc}{CARD_PATH}"
