"""API tokens for the local API (M11).

A token lets a program outside Object's window (an MCP server, a script) use
``/api/v1``. Tokens are per space folder, named, either ``read`` or ``read-write``,
and revocable. They live in the per-user state dir (``api-tokens.json``), never in
the space: the space folder may be synced or committed, a token must not travel with it.

Only a SHA-256 of each secret is stored. The secret is shown once, when it is made.
Secrets are 32 random bytes, so a plain hash is enough (no password stretching).

The activity log (``api-activity.jsonl`` in the same folder) records each write made
through a token: when, which token, what and where. ``GET /api/v1/changes`` reads it.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import threading
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .appstate import state_dir

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

    def to_api(self) -> dict[str, Any]:
        """What the UI sees: everything but the hash and the space key."""
        return {
            "id": self.id,
            "name": self.name,
            "scope": self.scope,
            "createdAt": self.createdAt,
            "lastUsedAt": self.lastUsedAt,
        }


class TokenStore:
    """The token file for one space folder. Thread-safe; writes are atomic."""

    def __init__(self, root: Path, folder: Path | None = None) -> None:
        self.space = _space_key(root)
        self._folder = folder
        self._lock = threading.Lock()

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
                out.append(TokenRecord(**{k: item.get(k) for k in TokenRecord.__dataclass_fields__}))
            except TypeError:
                continue
        return [t for t in out if isinstance(t.hash, str) and t.scope in SCOPES]

    def _save(self, tokens: list[TokenRecord]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps({"tokens": [asdict(t) for t in tokens]}, indent=2), encoding="utf-8"
        )
        os.replace(tmp, self.path)

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

    def verify(self, secret: str | None) -> TokenRecord | None:
        """The record `secret` belongs to in this space, else None. Stamps ``lastUsedAt``
        at most once a minute, so reads don't rewrite the file on every call."""
        if not secret or not secret.startswith(PREFIX):
            return None
        digest = _hash(secret)
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
        self._lock = threading.Lock()

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
            tmp = self.path.with_suffix(".jsonl.tmp")
            tmp.write_text("\n".join(lines[-ACTIVITY_KEEP:]) + "\n", encoding="utf-8")
            os.replace(tmp, self.path)

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
