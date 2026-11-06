"""The state-dir secrets file (M19): ``<state>/secrets.json``.

``{"version": 1, "secrets": {"<key>": "<value>"}}``, written with `jsonstore.dump_json` through
`textfile.atomic_write`, mode ``0600`` on POSIX. Keys (`KEY_PATTERN`):

- ``mcp:<serverId>:env:<KEY>``: a stdio server's secret environment value
- ``mcp:<serverId>:header:<name, lower-cased>``: a URL server's secret header value
- ``mcp:<serverId>:bearer``: a URL server's bearer token
- ``var:<NAME>``: a secret variable for agent folders' ``.mcp.json`` ``${NAME}`` references
- ``a2a:...``: reserved for M20

Values are never shown again, never logged and never in an exception's text. Reads never
write; an unreadable file reads as empty and is copied aside as
``secrets.unreadable-<stamp>.json`` before the next write. Unknown top-level keys are kept.
A module-level lock is held around every read-modify-write.

Imports no network client.
"""

from __future__ import annotations

import json
import os
import re
import sys
import threading
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from . import appstate
from .jsonstore import dump_json
from .mcpmodel import (
    ENV_PASSTHROUGH,
    MAX_SECRET_CHARS,
    RESERVED_VAR_PREFIXES,
    RESERVED_VARS,
    SECRETS_FILE,
    VAR_PATTERN,
)
from .textfile import atomic_write

__all__ = [
    "KEY_PATTERN",
    "SecretStore",
    "check_var_name",
    "lookup_var",
    "redact",
    "var_key",
]

KEY_PATTERN = r"^[a-z0-9]+:[^\x00-\x1f]{1,200}$"
FILE_VERSION = 1
MASK = "•" * 6
_KEY_RE = re.compile(KEY_PATTERN)
_lock = threading.RLock()


def _check_key(key: Any) -> None:
    if not isinstance(key, str) or not _KEY_RE.fullmatch(key):
        raise ValueError("That isn't a valid secret key.")


def _check_value(value: Any) -> None:
    """Never names the value."""
    if not isinstance(value, str) or not value:
        raise ValueError("Enter a value.")
    if len(value) > MAX_SECRET_CHARS:
        raise ValueError("That secret is too long.")
    if "\x00" in value:
        raise ValueError("That secret can't hold a NUL character.")


def _private(path: Path) -> None:
    """Mode 0600 on POSIX."""
    if sys.platform == "win32":
        return
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


class SecretStore:
    """The secrets file of a state dir (`appstate.state_dir` when `state` is None)."""

    def __init__(self, state: Path | None = None) -> None:
        self.state_dir = Path(state) if state is not None else appstate.state_dir()
        self.path = self.state_dir / SECRETS_FILE

    # -- reading (never writes) -------------------------------------------------

    @staticmethod
    def _parse(raw: bytes) -> dict[str, Any] | None:
        """The file's object, or None when it is unreadable."""
        try:
            data = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None
        if not isinstance(data, dict) or not isinstance(data.get("secrets", {}), dict):
            return None
        return data

    def _load(self) -> dict[str, Any]:
        """The whole file (unknown top-level keys kept); empty when missing or unreadable."""
        try:
            raw = self.path.read_bytes()
        except OSError:
            return {"version": FILE_VERSION, "secrets": {}}
        data = self._parse(raw)
        if data is None:
            return {"version": FILE_VERSION, "secrets": {}}
        secrets = {
            k: v
            for k, v in (data.get("secrets") or {}).items()
            if isinstance(k, str) and isinstance(v, str)
        }
        return {**data, "secrets": secrets}

    def _secrets(self) -> dict[str, str]:
        return self._load()["secrets"]

    def get(self, key: str) -> str | None:
        """The value, or None. Never writes; an unreadable file reads as empty."""
        return self._secrets().get(key)

    def has(self, key: str) -> bool:
        return key in self._secrets()

    def keys(self, prefix: str = "") -> list[str]:
        return [k for k in self._secrets() if k.startswith(prefix)]

    def values(self) -> list[str]:
        """Every stored value, for redaction only."""
        return list(self._secrets().values())

    # -- writing ----------------------------------------------------------------

    def _keep_unreadable(self) -> None:
        """Copy a file `_load` couldn't parse aside, so a write never loses it."""
        try:
            raw = self.path.read_bytes()
        except FileNotFoundError:
            return
        if self._parse(raw) is not None:
            return
        stem = Path(SECRETS_FILE).stem
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S")
        aside = self.state_dir / f"{stem}.unreadable-{stamp}.json"
        n = 2
        while aside.exists():
            aside = self.state_dir / f"{stem}.unreadable-{stamp}-{n}.json"
            n += 1
        atomic_write(aside, raw)
        _private(aside)

    def _save(self, data: dict[str, Any]) -> None:
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self._keep_unreadable()
        if sys.platform != "win32" and not self.path.exists():
            # A new file: create it 0600 first, so atomic_write's temp file takes that mode.
            os.close(os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600))
        atomic_write(self.path, dump_json({**data, "version": FILE_VERSION}))
        _private(self.path)

    def set(self, key: str, value: str) -> None:
        """ValueError for a bad key or value (never naming the value)."""
        self.set_many({key: value})

    def set_many(self, values: dict[str, str], remove: Iterable[str] = ()) -> None:
        """Set `values` and remove `remove` in one atomic write (none when nothing changes)."""
        remove = list(remove)
        for key, value in values.items():
            _check_key(key)
            _check_value(value)
        with _lock:
            data = self._load()
            secrets = dict(data["secrets"])
            changed = False
            for key in remove:
                if key in secrets and key not in values:
                    del secrets[key]
                    changed = True
            for key, value in values.items():
                if secrets.get(key) != value:
                    secrets[key] = value
                    changed = True
            if changed:
                self._save({**data, "secrets": secrets})

    def delete(self, key: str) -> bool:
        with _lock:
            data = self._load()
            if key not in data["secrets"]:
                return False
            secrets = {k: v for k, v in data["secrets"].items() if k != key}
            self._save({**data, "secrets": secrets})
            return True

    def delete_prefix(self, prefix: str) -> int:
        with _lock:
            data = self._load()
            secrets = {k: v for k, v in data["secrets"].items() if not k.startswith(prefix)}
            gone = len(data["secrets"]) - len(secrets)
            if gone:
                self._save({**data, "secrets": secrets})
            return gone

    def __repr__(self) -> str:
        """Never shows a value."""
        return "SecretStore(...)"

    __str__ = __repr__


def redact(text: str, values: Iterable[str]) -> str:
    """`text` with each value (at least 4 characters long, longest first) replaced by ``••••••``."""
    unique = {v for v in values if isinstance(v, str) and len(v) >= 4}
    for value in sorted(unique, key=len, reverse=True):
        text = text.replace(value, MASK)
    return text


def var_key(name: str) -> str:
    """``"var:" + name``."""
    return "var:" + name


def check_var_name(name: str) -> None:
    """ValueError("Object can't set this variable.") / ValueError("That isn't a valid variable name.")."""
    if not isinstance(name, str) or not re.fullmatch(VAR_PATTERN, name):
        raise ValueError("That isn't a valid variable name.")
    folded = name.casefold()
    if (
        folded in {v.casefold() for v in RESERVED_VARS}
        or folded in {v.casefold() for v in ENV_PASSTHROUGH}
        or any(folded.startswith(p.casefold()) for p in RESERVED_VAR_PREFIXES)
    ):
        raise ValueError("Object can't set this variable.")


def lookup_var(name: str) -> str | None:
    """`agentrun.SECRET_LOOKUP`: the ``var:<NAME>`` secret; else, for a name in
    `mcpmodel.ENV_PASSTHROUGH`, Object's own environment value; else None (missing)."""
    if not isinstance(name, str) or not re.fullmatch(VAR_PATTERN, name):
        return None
    value = SecretStore().get(var_key(name))
    if value is not None:
        return value
    if name in ENV_PASSTHROUGH:
        return os.environ.get(name)
    return None
