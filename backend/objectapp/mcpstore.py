"""The MCP servers file (M19): ``<state>/mcp-servers.json``, its validation and each server's CLI entry.

Secret values never go into this file; they are kept in `secretstore.SecretStore` under
``mcp:<serverId>:...`` keys. Save order: the secrets first, then the servers file; if the
servers write fails, the secrets just set are removed again and the old values put back.
Unknown keys (top level and per server) are kept on every save; an unreadable file lists no
servers and is copied aside as ``mcp-servers.unreadable-<stamp>.json`` before the next write;
a ``schemaVersion`` other than 1 makes the list read-only (writes raise `McpReadOnly`).

A server's revision is the sha256 of its entry's `jsonstore.dump_json` bytes.

T1 stub: the plan's Task 3 fills it. Imports no network client.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .mcpmodel import McpServerInput
from .secretstore import SecretStore

if TYPE_CHECKING:
    from .mcpprobe import ProbeResult

__all__ = [
    "McpConflict",
    "McpError",
    "McpInvalid",
    "McpNotFound",
    "McpReadOnly",
    "McpServerRecord",
    "McpStore",
    "MissingSecret",
    "clean_input",
    "cli_entry",
    "secret_env_name",
]


class McpError(Exception):
    """A route error: `status` and a `message` that never repeats a submitted value."""

    status: int = 400

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class McpNotFound(McpError):
    status = 404


class McpConflict(McpError):
    """409; `current_revision` is None for a name clash."""

    status = 409

    def __init__(self, message: str, current_revision: str | None = None) -> None:
        super().__init__(message)
        self.current_revision = current_revision


class McpInvalid(McpError):
    status = 422


class McpReadOnly(McpError):
    status = 423


class MissingSecret(Exception):
    """A server's secret is gone from the secrets file; `keys` are the row keys / header names only."""

    def __init__(self, keys: list[str]) -> None:
        super().__init__(", ".join(keys))
        self.keys = keys


@dataclass
class McpServerRecord:
    data: dict[str, Any]
    revision: str

    def to_api(self, secrets: SecretStore, last_test: ProbeResult | None) -> dict[str, Any]:
        """The API's ``McpServer`` shape (secret rows ``value: None`` with ``set``; no value ever)."""
        raise NotImplementedError


class McpStore:
    def __init__(self, state: Path | None = None, secrets: SecretStore | None = None) -> None:
        raise NotImplementedError

    def list(self) -> list[McpServerRecord]:
        """File order; never writes."""
        raise NotImplementedError

    def read_only_reason(self) -> str | None:
        raise NotImplementedError

    def get(self, server_id: str) -> McpServerRecord:
        """McpNotFound for an unknown id."""
        raise NotImplementedError

    def create(self, inp: McpServerInput) -> McpServerRecord:
        raise NotImplementedError

    def save(self, server_id: str, inp: McpServerInput, base_revision: str) -> McpServerRecord:
        raise NotImplementedError

    def delete(self, server_id: str) -> None:
        """Also ``secrets.delete_prefix("mcp:<id>:")``."""
        raise NotImplementedError


def clean_input(
    inp: McpServerInput,
    existing: McpServerRecord | None,
    others: list[McpServerRecord],
    secrets: SecretStore,
) -> tuple[dict[str, Any], dict[str, str], list[str]]:
    """(stored entry, secret values to set, secret keys to remove). Raises McpInvalid / McpConflict."""
    raise NotImplementedError


def cli_entry(server: dict[str, Any], secrets: SecretStore) -> tuple[dict[str, Any], dict[str, str]]:
    """(entry with ``${OBJECT_MCP_...}`` references, {env name: value}). Raises MissingSecret (key names only).

    Shapes: ``{"type": "stdio", "command", "args", "env"}`` and ``{"type": "http"|"sse", "url",
    "headers"}`` (a bearer as ``"Authorization": "Bearer ${OBJECT_MCP_...}"``). The T1 spike
    (``docs/superpowers/plans/m19-cli-spike.md``) says whether a ``.cmd``/``.bat`` command needs
    wrapping in ``cmd /c`` on Windows.
    """
    raise NotImplementedError


def secret_env_name(secret_key: str) -> str:
    """``ENV_PREFIX + sha256(secret_key)[:12].upper()``, e.g. ``OBJECT_MCP_3FA9C01B22D4``."""
    raise NotImplementedError
