"""The A2A v1.0 client, JSON-RPC binding only (M20, spec section 7).

Fetches and parses an Agent Card, and sends ``SendMessage`` / ``SendStreamingMessage``,
``GetTask`` and ``CancelTask`` with size caps, timeouts and no redirects. It is the only M20 module
with a network client; it reads nothing from the disk and writes nothing.

M20 Task 1 holds the contract (the dataclasses, `A2AError`, the state sets and the signatures);
Task 2 fills the functions.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    import httpx

__all__ = [
    "STATE_INTERRUPTED",
    "STATE_TERMINAL",
    "A2AError",
    "Auth",
    "Card",
    "Update",
    "cancel",
    "fetch_card",
    "parse_card",
    "send",
    "user_message",
]

STATE_TERMINAL: frozenset[str] = frozenset({
    "TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_REJECTED", "TASK_STATE_CANCELED",
})
"""A task that is over."""
STATE_INTERRUPTED: frozenset[str] = frozenset({"TASK_STATE_INPUT_REQUIRED", "TASK_STATE_AUTH_REQUIRED"})
"""A task waiting on the user (the turn ends; input-required keeps its task id)."""


@dataclass(frozen=True)
class Card:
    """A parsed Agent Card with the interface Object uses."""

    name: str
    description: str
    version: str | None
    provider: str | None
    documentation_url: str | None
    endpoint_url: str
    protocol_version: str
    streaming: bool
    skills: tuple[dict[str, Any], ...]
    """``{id, name, description, tags: [..], examples: [..]}`` (strings cut to 500 characters)."""
    input_modes: tuple[str, ...]
    output_modes: tuple[str, ...]
    raw: dict[str, Any]


@dataclass
class Auth:
    """How a request authenticates. Never logged; its repr hides the value."""

    kind: Literal["none", "bearer", "header"]
    header_name: str | None = None
    value: str | None = field(default=None, repr=False)

    def __repr__(self) -> str:
        shown = "set" if self.value else None
        return f"Auth(kind={self.kind!r}, header_name={self.header_name!r}, value={shown!r})"

    def headers(self) -> dict[str, str]:
        """``Authorization: Bearer <value>`` for bearer, ``<header_name>: <value>`` for header, else none."""
        if not self.value:
            return {}
        if self.kind == "bearer":
            return {"Authorization": f"Bearer {self.value}"}
        if self.kind == "header" and self.header_name:
            return {self.header_name: self.value}
        return {}


@dataclass
class Update:
    """One piece of an answer, in arrival order."""

    kind: Literal["text", "file", "data", "state"]
    text: str = ""
    """kind text: an agent message's, an artifact text part's or the final status message's text."""
    artifact_id: str | None = None
    name: str | None = None
    media_type: str | None = None
    data: Any = None
    """kind data."""
    raw: bytes | None = None
    url: str | None = None
    """kind file: exactly one of `raw` and `url`."""
    state: str | None = None
    context_id: str | None = None
    task_id: str | None = None
    """kind state."""
    status_text: str = ""
    """kind state: the status message's text."""


class A2AError(Exception):
    """Remote or protocol trouble: `status` 502, 504 at a timeout, 422 for a refused card."""

    def __init__(self, message: str, status: int = 502) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


async def fetch_card(card_url: str, auth: Auth, *, client: httpx.AsyncClient | None = None) -> Card:
    """GET the card (at most ``CARD_MAX_BYTES``, no redirects) and `parse_card` it."""
    raise NotImplementedError("M20 Task 2")


def parse_card(data: Any) -> Card:
    """The card's first JSON-RPC A2A 1.x interface; `A2AError` (422) with the Contract's messages."""
    raise NotImplementedError("M20 Task 2")


def user_message(parts: list[dict[str, Any]], *, context_id: str | None, task_id: str | None) -> dict[str, Any]:
    """A ``ROLE_USER`` ``Message`` with a new ``messageId``, and ``contextId``/``taskId`` when given."""
    raise NotImplementedError("M20 Task 2")


async def send(card: Card, auth: Auth, message: dict[str, Any], *, deadline: float,
               client: httpx.AsyncClient | None = None) -> AsyncIterator[Update]:
    """``SendStreamingMessage`` when ``card.streaming``, else ``SendMessage`` (+ ``GetTask`` polling
    while running). Raises `A2AError` (504) at the deadline (``loop.time()``) after a best-effort
    ``CancelTask``."""
    raise NotImplementedError("M20 Task 2")
    yield  # pragma: no cover - makes this an async generator


async def cancel(card: Card, auth: Auth, task_id: str, *, client: httpx.AsyncClient | None = None) -> None:
    """A best-effort ``CancelTask`` (5 s, errors swallowed)."""
    raise NotImplementedError("M20 Task 2")
