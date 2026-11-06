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
``secrets.unreadable-<stamp>.json`` before the next write. A module-level lock is held around
every read-modify-write.

T1 stub: the plan's Task 2 fills it. Imports no network client.
"""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path

__all__ = [
    "KEY_PATTERN",
    "SecretStore",
    "check_var_name",
    "lookup_var",
    "redact",
    "var_key",
]

KEY_PATTERN = r"^[a-z0-9]+:[^\x00-\x1f]{1,200}$"


class SecretStore:
    """The secrets file of a state dir (`appstate.state_dir` when `state` is None)."""

    def __init__(self, state: Path | None = None) -> None:
        raise NotImplementedError

    def get(self, key: str) -> str | None:
        """The value, or None. Never writes; an unreadable file reads as empty."""
        raise NotImplementedError

    def has(self, key: str) -> bool:
        raise NotImplementedError

    def keys(self, prefix: str = "") -> list[str]:
        raise NotImplementedError

    def set(self, key: str, value: str) -> None:
        """ValueError for a bad key or value (never naming the value)."""
        raise NotImplementedError

    def set_many(self, values: dict[str, str], remove: Iterable[str] = ()) -> None:
        """Set `values` and remove `remove` in one atomic write."""
        raise NotImplementedError

    def delete(self, key: str) -> bool:
        raise NotImplementedError

    def delete_prefix(self, prefix: str) -> int:
        raise NotImplementedError

    def values(self) -> list[str]:
        """Every stored value, for redaction only."""
        raise NotImplementedError

    def __repr__(self) -> str:
        """Never shows a value."""
        return "SecretStore(...)"


def redact(text: str, values: Iterable[str]) -> str:
    """`text` with each value (at least 4 characters long, longest first) replaced by ``••••••``."""
    raise NotImplementedError


def var_key(name: str) -> str:
    """``"var:" + name``."""
    raise NotImplementedError


def check_var_name(name: str) -> None:
    """ValueError("Object can't set this variable.") / ValueError("That isn't a valid variable name.")."""
    raise NotImplementedError


def lookup_var(name: str) -> str | None:
    """`agentrun.SECRET_LOOKUP`: the ``var:<NAME>`` secret; else, for a name in
    `mcpmodel.ENV_PASSTHROUGH`, Object's own environment value; else None (missing)."""
    raise NotImplementedError
