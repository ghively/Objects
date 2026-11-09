"""API tokens for the local API (M11).

A token lets a program outside Object's window (an MCP server, a script) use
``/api/v1``. Tokens are per space folder, named, either ``read`` or ``read-write``,
and revocable. They live in the per-user state dir (``api-tokens.json``), never in
the space: the space folder may be synced or committed, a token must not travel with it.

Only a SHA-256 of each secret is stored. The secret is shown once, when it is made.
Secrets are 32 random bytes, so a plain hash is enough (no password stretching).

The activity log (``api-activity.jsonl`` in the same folder) records each write made
through a token: when, which token, what and where. ``GET /api/v1/changes`` reads it.

M10: `TokenStore.ephemeral` makes a short-lived ``read`` token for one AI assistant turn.
It lives only in this process's memory (never in a file), `verify` accepts it like a
stored one, and `TokenStore.drop_ephemeral` revokes it when the turn ends.

M17: an agent turn's ephemeral token also names the agent and the chat (`TokenRecord.agent`,
`TokenRecord.chat`), so ``/api/v1/agent/*`` acts only on that agent. Stored tokens never
have them (and the file never holds the keys).

M18: an ephemeral token also carries the run's `purpose` (``"review"``, ``"curator"``...), its `run`
id, a tool-step `budget` with its `used` count, and the agent `tools` it may call (None: all).
`TokenStore.spend` counts one step per ``/api/v1`` call. Stored tokens never have them.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import threading
from collections.abc import Iterable
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .appstate import state_dir
from .textfile import atomic_write

__all__ = [
    "SCOPES",
    "ActivityLog",
    "TokenRecord",
    "TokenStore",
]

SCOPES = ("read", "read-write")
PREFIX = "obj_"
MAX_NAME = 60
MAX_TOKENS = 50
ACTIVITY_KEEP = 2000
"""Entries kept in the activity log; older ones are dropped when it grows past twice this."""


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


# M10: in-memory tokens (hash -> record), shared by every `TokenStore` of the process so the
# ``/api/v1`` router's store accepts the token the AI router made. Never written to disk.
_EPHEMERAL: dict[str, TokenRecord] = {}
_EPHEMERAL_LOCK = threading.Lock()
_FILE_LOCK = threading.RLock()
"""Guards ``api-tokens.json`` across every `TokenStore` in the process (audit 2026-11-07 #22)."""
_ACTIVITY_LOCK = threading.Lock()
"""Guards ``api-activity.jsonl`` across every `ActivityLog` in the process (its append and trim)."""


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def _space_key(root: Path) -> str:
    """The key a token is bound to: the space folder's resolved path, case-folded on Windows."""
    text = str(Path(root).resolve())
    return text.casefold() if os.name == "nt" else text


@dataclass
class TokenRecord:
    id: str
    name: str
    scope: str
    space: str
    hash: str
    createdAt: str
    lastUsedAt: str | None = None
    agent: str | None = None
    """M17: the agent id of an agent turn's ephemeral token; None for every stored token."""
    chat: str | None = None
    """M17: the chat id of an agent turn's ephemeral token; None for every stored token."""
    purpose: str = "chat"
    """M18: the run's purpose (``"chat"``, ``"review"``, ``"curator"``...); memory-only."""
    run: str | None = None
    """M18: the review or curator run id; memory-only."""
    budget: int | None = None
    """M18: the tool steps this run may make (None: no limit); memory-only."""
    used: int = 0
    """M18: the ``/api/v1`` calls made so far (`TokenStore.spend`); memory-only."""
    tools: tuple[str, ...] | None = None
    """M18: the agent tools (short names) this run may call; None means all. Memory-only. Every
    agent run's token gets the list its CLI lists allow (`narrow_ephemeral`, decisions memo S2)."""

    def to_api(self) -> dict[str, Any]:
        """What the UI sees: everything but the hash and the space key."""
        return {
            "id": self.id,
            "name": self.name,
            "scope": self.scope,
            "createdAt": self.createdAt,
            "lastUsedAt": self.lastUsedAt,
        }


_MEMORY_ONLY = ("purpose", "run", "budget", "used", "tools")
"""M18's run fields: never written to the file, never read from it."""


def _stored(t: TokenRecord) -> dict[str, Any]:
    """A record as the file holds it: M11's keys only (the M17 agent fields and M18's run fields
    are memory-only)."""
    out = asdict(t)
    for key in ("agent", "chat"):
        if out.get(key) is None:
            out.pop(key, None)
    for key in _MEMORY_ONLY:
        out.pop(key, None)
    return out


class TokenStore:
    """The token file for one space folder. Thread-safe; writes are atomic."""

    def __init__(self, root: Path, folder: Path | None = None) -> None:
        self.space = _space_key(root)
        self._folder = folder
        # Each router makes its own store on the same file: one lock for them all, or one
        # store's read-modify-write loses another's token (audit 2026-11-07 #22).
        self._lock = _FILE_LOCK

    @property
    def path(self) -> Path:
        return (self._folder or state_dir()) / "api-tokens.json"

    # -- file -----------------------------------------------------------------

    def _load(self) -> list[TokenRecord]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError, OSError):
            return []
        out: list[TokenRecord] = []
        for item in data.get("tokens", []) if isinstance(data, dict) else []:
            try:
                out.append(TokenRecord(**{
                    k: item.get(k) for k in TokenRecord.__dataclass_fields__ if k not in _MEMORY_ONLY
                }))
            except TypeError:
                continue
        return [t for t in out if isinstance(t.hash, str) and t.scope in SCOPES]

    def _save(self, tokens: list[TokenRecord]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # A temp file of its own (never a fixed ``.json.tmp`` another writer also renames).
        atomic_write(
            self.path,
            json.dumps({"tokens": [_stored(t) for t in tokens]}, indent=2).encode("utf-8"),
        )

    # -- API ------------------------------------------------------------------

    def list(self) -> list[TokenRecord]:
        with self._lock:
            return [t for t in self._load() if t.space == self.space]

    def create(self, name: str, scope: str) -> tuple[TokenRecord, str]:
        """Make a token; return its record and the secret (shown once)."""
        name = (name or "").strip()
        if not name:
            raise ValueError("A token needs a name.")
        if len(name) > MAX_NAME:
            raise ValueError(f"A token name can be at most {MAX_NAME} characters.")
        if scope not in SCOPES:
            raise ValueError("scope must be read or read-write.")
        secret = PREFIX + secrets.token_urlsafe(32)
        with self._lock:
            tokens = self._load()
            mine = [t for t in tokens if t.space == self.space]
            if len(mine) >= MAX_TOKENS:
                raise ValueError(f"A space can have at most {MAX_TOKENS} tokens.")
            record = TokenRecord(
                id=secrets.token_hex(6),
                name=name,
                scope=scope,
                space=self.space,
                hash=_hash(secret),
                createdAt=_now(),
            )
            tokens.append(record)
            self._save(tokens)
        return record, secret

    def revoke(self, token_id: str) -> bool:
        with self._lock:
            tokens = self._load()
            keep = [t for t in tokens if not (t.id == token_id and t.space == self.space)]
            if len(keep) == len(tokens):
                return False
            self._save(keep)
            return True

    # -- M10: per-turn tokens held in memory ---------------------------------------

    def ephemeral(
        self,
        name: str,
        scope: str = "read",
        agent: str | None = None,
        chat: str | None = None,
        purpose: str = "chat",
        run: str | None = None,
        budget: int | None = None,
        tools: tuple[str, ...] | None = None,
    ) -> tuple[TokenRecord, str]:
        """A token for this space that only this process knows; return (record, secret).

        Nothing is written: the record sits in a process-wide dict until
        `drop_ephemeral`. It isn't listed by `list` (it isn't the user's token).
        M17: `agent` and `chat` stamp an agent turn's token with its agent and chat ids.
        M18: `purpose`, `run`, `budget` and `tools` describe a review or curator run.
        """
        if scope not in SCOPES:
            raise ValueError("scope must be read or read-write.")
        secret = PREFIX + secrets.token_urlsafe(32)
        record = TokenRecord(
            id="ephemeral-" + secrets.token_hex(6),
            name=name,
            scope=scope,
            space=self.space,
            hash=_hash(secret),
            createdAt=_now(),
            agent=agent,
            chat=chat,
            purpose=purpose,
            run=run,
            budget=budget,
            tools=tuple(tools) if tools is not None else None,
        )
        with _EPHEMERAL_LOCK:
            _EPHEMERAL[record.hash] = record
        return record, secret

    @staticmethod
    def narrow_ephemeral(secret: str, tools: Iterable[str]) -> bool:
        """Keep only `tools` in an in-memory token's agent tools (decisions memo S2): a token with
        no list gets `tools`, one with a list keeps its own order minus what `tools` lacks. Never
        widens. True when the token existed. ``agentrun.build_run`` calls it with the run's lists
        before the CLI starts, so the token holds exactly the agent tools the CLI may call."""
        names = tuple(dict.fromkeys(tools))
        with _EPHEMERAL_LOCK:
            record = _EPHEMERAL.get(_hash(secret)) if secret else None
            if record is None:
                return False
            keep = set(names)
            record.tools = names if record.tools is None else tuple(t for t in record.tools if t in keep)
            return True

    @staticmethod
    def drop_ephemeral(secret: str) -> bool:
        """Revoke an in-memory token; True when it existed."""
        with _EPHEMERAL_LOCK:
            return _EPHEMERAL.pop(_hash(secret), None) is not None

    @staticmethod
    def spend(record: TokenRecord) -> bool:
        """Count one tool step (M18): ``used += 1`` under the ephemeral lock. False when the
        record has a `budget` and this step goes past it; a record without one always passes."""
        with _EPHEMERAL_LOCK:
            record.used += 1
            return record.budget is None or record.used <= record.budget

    def verify(self, secret: str | None) -> TokenRecord | None:
        """The record `secret` belongs to in this space, else None. Stamps ``lastUsedAt``
        at most once a minute, so reads don't rewrite the file on every call."""
        if not secret or not secret.startswith(PREFIX):
            return None
        digest = _hash(secret)
        with _EPHEMERAL_LOCK:
            temporary = _EPHEMERAL.get(digest)
        if temporary is not None:
            return temporary if temporary.space == self.space else None
        with self._lock:
            tokens = self._load()
            for t in tokens:
                if t.space == self.space and hmac.compare_digest(t.hash, digest):
                    now = _now()
                    if t.lastUsedAt is None or t.lastUsedAt[:16] != now[:16]:
                        t.lastUsedAt = now
                        try:
                            self._save(tokens)
                        except OSError:
                            pass
                    return t
        return None


class ActivityLog:
    """Writes made through the local API, newest last (JSON lines in the state dir)."""

    def __init__(self, root: Path, folder: Path | None = None) -> None:
        self.space = _space_key(root)
        self._folder = folder
        self._lock = _ACTIVITY_LOCK  # every instance on the file (the router's, each guard's)

    @property
    def path(self) -> Path:
        return (self._folder or state_dir()) / "api-activity.jsonl"

    def add(self, token: TokenRecord, action: str, path: str, **extra: Any) -> None:
        entry = {
            "at": _now(),
            "space": self.space,
            "token": token.name,
            "tokenId": token.id,
            "action": action,
            "path": path,
            **extra,
        }
        with self._lock:
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                with self.path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(entry) + "\n")
                self._trim()
            except OSError:
                pass  # the log is a convenience; a failed append never fails the write

    def _trim(self) -> None:
        lines = self.path.read_text(encoding="utf-8").splitlines()
        if len(lines) > 2 * ACTIVITY_KEEP:
            atomic_write(self.path, ("\n".join(lines[-ACTIVITY_KEEP:]) + "\n").encode("utf-8"))

    def since(self, at: str | None, limit: int = 200) -> list[dict[str, Any]]:
        with self._lock:
            try:
                lines = self.path.read_text(encoding="utf-8").splitlines()
            except (FileNotFoundError, OSError):
                return []
        out = []
        for line in lines:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if e.get("space") != self.space:
                continue
            if at and str(e.get("at", "")) < at:
                continue
            e.pop("space", None)
            out.append(e)
        return out[-limit:]
