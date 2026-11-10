"""What every ``/api/v1`` route shares (M17): token auth, "Exclude from AI" visibility, the
write announcements and the activity log.

M11's routes (`api_v1`), M17's tool routes (`api_v1_tools`) and the agent routes
(`api_agent_v1`; M18, M20, M21 add theirs) all go through one `V1Guard`, so a rule kept here
holds for every tool an agent has.

- `V1Guard.auth` checks ``Authorization: Bearer <token>``: 401 without a valid token for this
  space, 403 "This token can only read." for a write with a ``read`` token, and 403 with the
  first message a `WRITE_GUARDS` entry returns (M24 appends its read-only guard).
- M29: a ``sync`` token reads like a ``read`` one; any write but a sync answers 403 `SYNC_ONLY`.
  `V1Guard.auth_sync` is the sync route's auth: a ``read-write`` or ``sync`` token (403
  `CANT_SYNC` for a ``read`` one), then the `WRITE_GUARDS`.
- Objects marked "Exclude from AI" and templates are invisible: `visible_rel` raises
  ``KeyError`` (the routes answer 404), `hidden_paths` lists them, `visible_only` filters a
  path list and counts what it left out (``hiddenCount``), and `trash_entry_hidden` tells
  whether a trash entry is such an object.
- `announce` publishes a write's `ChangeEvent` with ``origin: "api:<token name>"`` and `log`
  adds it to the activity log (``GET /api/v1/changes`` reads it).
- `agent_auth` is for ``/api/v1/agent/*``: the token must name an agent (403 "This token
  isn't an agent's."), and the routes act only on that agent.
- M18: `V1Guard.auth` spends one of the token's tool steps per call (`TokenStore.spend`) and
  answers 429 "This run has used its {budget} tool steps." past its budget; every Object tool
  makes exactly one ``/api/v1`` call, so the budget counts tool steps. `agent_tool_allowed`
  answers 403 "This run can't use {tool}." for an agent tool outside the token's `tools`, and for
  a memory or skill write from a read-only purpose (`NO_LEARNING_WRITES`, decisions memo S2).
"""

from __future__ import annotations

import functools
from collections.abc import Callable, Iterable
from typing import TYPE_CHECKING, Any

from fastapi import Request
from fastapi.responses import JSONResponse

from .apiquery import is_excluded
from .tokens import ActivityLog, TokenRecord, TokenStore
from .watcher import ChangeEvent

if TYPE_CHECKING:
    from .agents import AgentRecord
    from .apictx import ApiContext
    from .trash import TrashItem

__all__ = [
    "CANT_SYNC",
    "LEARNING_WRITE_TOOLS",
    "NOT_AN_AGENT",
    "NO_LEARNING_WRITES",
    "SYNC_ONLY",
    "WRITE_GUARDS",
    "Denied",
    "V1Guard",
    "agent_auth",
    "agent_tool_allowed",
    "error",
    "guarded",
]

WRITE_GUARDS: list[Callable[[TokenRecord, Request], str | None]] = []
"""Checks every v1 write runs after the scope check; the first message one returns is the
403's ``detail``. Empty in M17; M24 appends its read-only guard."""

NOT_AN_AGENT = "This token isn't an agent's."
SYNC_ONLY = "This token can only write synced facts."  # our string (M29): a v1 write with a sync token
CANT_SYNC = "This token can't write synced facts."  # our string (M29): a read token on the sync route


class Denied(Exception):
    """An answer a route gives instead of its own (`guarded` turns it into JSON)."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def error(status: int, detail: str, **extra: Any) -> JSONResponse:
    return JSONResponse({"detail": detail, **extra}, status_code=status)


def guarded(fn):
    """Turn `Denied` raised inside a route into its JSON answer."""

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except Denied as exc:
            return error(exc.status, exc.detail)

    return wrapper


class V1Guard:
    """Auth, visibility, announcements and the activity log for one space's v1 routes."""

    def __init__(self, ctx: ApiContext, tokens: TokenStore, activity: ActivityLog | None = None) -> None:
        self.ctx = ctx
        self.space = ctx.space
        self.tokens = tokens
        self.activity = activity or ActivityLog(ctx.space.root, tokens._folder)

    # -- auth -------------------------------------------------------------------

    def auth(self, request: Request, write: bool = False) -> TokenRecord:
        """The request's token; raises `Denied` (401, 403)."""
        header = request.headers.get("authorization", "")
        scheme, _sep, secret = header.partition(" ")
        if scheme.lower() != "bearer" or not secret.strip():
            raise Denied(401, "A token is needed: Authorization: Bearer <token>.")
        token = self.tokens.verify(secret.strip())
        if token is None:
            raise Denied(401, "That token isn't valid for this space.")
        if not self.tokens.spend(token):
            raise Denied(429, f"This run has used its {token.budget} tool steps.")  # our string
        if write:
            if token.scope != "read-write":
                raise Denied(403, SYNC_ONLY if token.scope == "sync" else "This token can only read.")
            self._write_guards(token, request)
        return token

    def auth_sync(self, request: Request) -> TokenRecord:
        """M29: the sync route's token: ``read-write`` or ``sync`` (403 `CANT_SYNC` otherwise),
        then every `WRITE_GUARDS` check; raises `Denied` (401, 403, 429) as `auth` does."""
        token = self.auth(request)
        if token.scope not in ("read-write", "sync"):
            raise Denied(403, CANT_SYNC)
        self._write_guards(token, request)
        return token

    @staticmethod
    def _write_guards(token: TokenRecord, request: Request) -> None:
        for check in list(WRITE_GUARDS):
            message = check(token, request)
            if message:
                raise Denied(403, message)

    # -- visibility -------------------------------------------------------------

    def visible_rel(self, path: str) -> str:
        """The object's space path when the API may show it; KeyError (404) otherwise.

        Raises ValueError (400) for a path outside the space."""
        space = self.space
        rel = space._rel(path)
        with space._lock:
            summary = space._summaries.get(rel)
            raw = space._raw.get(rel)
        if summary is None or summary.template is not None:
            raise KeyError(rel)
        if is_excluded(raw.fm if raw else None, summary.tags):
            raise KeyError(rel)
        return rel

    def hidden_paths(self) -> set[str]:
        """Every template and every object excluded from AI."""
        space = self.space
        with space._lock:
            return {
                rel
                for rel, s in space._summaries.items()
                if s.template is not None
                or is_excluded(space._raw[rel].fm if rel in space._raw else None, s.tags)
            }

    def visible_only(self, paths: Iterable[str]) -> tuple[list[str], int]:
        """The paths the API may show, in order, and how many were left out (``hiddenCount``)."""
        hidden = self.hidden_paths()
        shown: list[str] = []
        left_out = 0
        for p in paths:
            if p in hidden:
                left_out += 1
            else:
                shown.append(p)
        return shown, left_out

    def trash_entry_hidden(self, item: TrashItem) -> bool:
        """Whether a trash entry is an object whose trashed file is excluded from AI or a template."""
        if item.kind != "object":
            return False
        from .typedefs import read_raw

        trash = self.space.trash
        try:
            fm = read_raw(trash.dir, f"{item.id}.md", cache=False).fm
        except (OSError, ValueError):
            return True  # unreadable: never shown to an agent
        if not isinstance(fm, dict):
            return False
        if fm.get("template") not in (None, ""):
            return True
        tags = fm.get("tags")
        tag_list = tags if isinstance(tags, list) else ([tags] if isinstance(tags, str) else [])
        return is_excluded(fm, [str(t) for t in tag_list])

    # -- writes -----------------------------------------------------------------

    def announce(self, kind: str, path: str, version: str | None, token: TokenRecord, **extra: Any) -> None:
        """Publish a write's `ChangeEvent` with ``origin: "api:<token name>"``."""
        self.ctx.announce(ChangeEvent(kind, path, version, origin=f"api:{token.name}", **extra))

    def log(self, token: TokenRecord, action: str, path: str, **extra: Any) -> None:
        """Add a write to the activity log."""
        self.activity.add(token, action, path, **extra)


def agent_auth(guard: V1Guard, registry: Any, request: Request) -> tuple[TokenRecord, AgentRecord]:
    """The token and the agent it names; raises `Denied` (401, 403 `NOT_AN_AGENT`, or the
    registry's own status: 404 for an agent that isn't listed any more)."""
    token = guard.auth(request)
    if not token.agent:
        raise Denied(403, NOT_AN_AGENT)
    from .agentmodel import AgentError

    try:
        agent = registry.get(token.agent)
    except AgentError as exc:
        raise Denied(exc.status, exc.message) from exc
    return token, agent


NO_LEARNING_WRITES = frozenset({"work-read", "work-file", "work-sync", "import-filing"})
"""Run purposes that only read (decisions memo S2): `worktools.READ_ONLY_PURPOSES` and
`importfiling.PURPOSE` (named here, not imported: both modules import this one). Their tokens never
write memory or skills, whatever their `tools` say."""

LEARNING_WRITE_TOOLS = ("memory", "skill_manage")
"""The agent tools that write the agent's memory or skills."""


def agent_tool_allowed(record: TokenRecord, tool: str) -> None:
    """M18: raises `Denied` 403 "This run can't use {tool}." when the token's `tools` is set and
    lacks `tool` (a short agent tool name), or (decisions memo S2) when `tool` writes memory or
    skills and the token's purpose is one of `NO_LEARNING_WRITES`."""
    refused = record.tools is not None and tool not in record.tools
    if refused or (tool in LEARNING_WRITE_TOOLS and record.purpose in NO_LEARNING_WRITES):
        raise Denied(403, f"This run can't use {tool}.")  # our string
