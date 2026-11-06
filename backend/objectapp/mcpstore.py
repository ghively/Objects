"""The MCP servers file (M19): ``<state>/mcp-servers.json``, its validation and each server's CLI entry.

Secret values never go into this file; they are kept in `secretstore.SecretStore` under
``mcp:<serverId>:...`` keys. Save order: the secrets first, then the servers file; if the
servers write fails, the secrets just set are removed again and the old values put back.
Unknown keys (top level and per server) are kept on every save; an unreadable file lists no
servers and is copied aside as ``mcp-servers.unreadable-<stamp>.json`` before the next write;
a ``schemaVersion`` other than 1 makes the list read-only (writes raise `McpReadOnly`).

A server's revision is the sha256 of its entry's `jsonstore.dump_json` bytes.

Imports no network client.
"""

from __future__ import annotations

import hashlib
import json
import re
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit

from . import appstate
from .ids import new_ulid
from .jsonstore import dump_json
from .mcpmodel import (
    ENV_KEY_PATTERN,
    ENV_PREFIX,
    HEADER_NAME_PATTERN,
    MAX_ARGS,
    MAX_ROWS,
    MAX_SECRET_CHARS,
    MAX_SERVERS,
    MAX_VALUE_CHARS,
    NAME_PATTERN,
    RESERVED_NAMES,
    SCHEMA_VERSION,
    SERVERS_FILE,
    McpServerFile,
    McpServerInput,
)
from .secretstore import SecretStore
from .textfile import atomic_write

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

# Our strings. No message ever repeats a submitted value (an env key or header name may be
# named: they aren't secret).
BAD_NAME = "Use 1-64 letters, digits, - or _."
NAME_RESERVED = "That name is taken by Object."
NAME_TAKEN = "Another server already has this name."
NAME_FIXED = "A server's name can't be changed."
NO_COMMAND = "Enter the command."
BAD_COMMAND = "That command can't be run."
BAD_URL = "Use an http:// or https:// address."
BAD_HEADER = "That header name isn't valid."
BEARER_AND_AUTH = "Use either a bearer token or an Authorization header."
USE_A_SECRET = "Use a secret for values with ${…}."
SECRET_TOO_LONG = "That secret is too long."
VALUE_TOO_LONG = "That value is too long."
BAD_VALUE = "That value can't be used."
BAD_VAR = "That isn't a valid variable name."
NO_BEARER = "Enter a value for the bearer token."
TOO_MANY_SERVERS = f"Up to {MAX_SERVERS} servers."
TOO_MANY_ARGS = f"Up to {MAX_ARGS} arguments."
TOO_MANY_ENV = f"Up to {MAX_ROWS} environment variables."
TOO_MANY_HEADERS = f"Up to {MAX_ROWS} headers."
NEWER_VERSION = "These MCP servers were saved by a newer version of Object."
UNREADABLE = "The MCP servers file can't be read."
NOT_FOUND = "That MCP server isn't there."
CHANGED = "This server was changed elsewhere."
BEARER_ROW = "Authorization"
"""The name `MissingSecret` and ``missingSecrets`` give a missing bearer token (the header it fills)."""

_NAME_RE = re.compile(NAME_PATTERN)
_ENV_KEY_RE = re.compile(ENV_KEY_PATTERN)
_HEADER_RE = re.compile(HEADER_NAME_PATTERN)
_KNOWN_KEYS = tuple(McpServerFile.model_fields)
_lock = threading.RLock()


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


def _now() -> str:
    moment = datetime.now(UTC)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def _revision(entry: dict[str, Any]) -> str:
    return hashlib.sha256(dump_json(entry)).hexdigest()


def _env_key(server_id: str, key: str) -> str:
    return f"mcp:{server_id}:env:{key}"


def _header_key(server_id: str, name: str) -> str:
    return f"mcp:{server_id}:header:{name.lower()}"


def _bearer_key(server_id: str) -> str:
    return f"mcp:{server_id}:bearer"


def _rows(data: dict[str, Any], field: str) -> list[dict[str, Any]]:
    return [r for r in data.get(field) or [] if isinstance(r, dict)]


def _secret_refs(data: dict[str, Any]) -> list[tuple[str, str]]:
    """(row key or header name, secret key) for each secret the stored server uses, in order."""
    sid = str(data.get("id") or "")
    refs: list[tuple[str, str]] = []
    if data.get("kind") == "command":
        for row in _rows(data, "env"):
            if row.get("secret"):
                refs.append((str(row.get("key")), _env_key(sid, str(row.get("key")))))
    else:
        for row in _rows(data, "headers"):
            if row.get("secret"):
                refs.append((str(row.get("name")), _header_key(sid, str(row.get("name")))))
        if data.get("bearer"):
            refs.append((BEARER_ROW, _bearer_key(sid)))
    return refs


def _missing(data: dict[str, Any], secrets: SecretStore) -> list[str]:
    return [label for label, key in _secret_refs(data) if not secrets.has(key)]


@dataclass
class McpServerRecord:
    data: dict[str, Any]
    revision: str

    def to_api(self, secrets: SecretStore, last_test: ProbeResult | None) -> dict[str, Any]:
        """The API's ``McpServer`` shape (secret rows ``value: None`` with ``set``; no value ever)."""
        d = self.data
        sid = str(d.get("id") or "")
        env = []
        for row in _rows(d, "env"):
            key = str(row.get("key"))
            if row.get("secret"):
                env.append({"key": key, "value": None, "secret": True, "set": secrets.has(_env_key(sid, key))})
            else:
                env.append({"key": key, "value": row.get("value") or "", "secret": False, "set": True})
        headers = []
        for row in _rows(d, "headers"):
            name = str(row.get("name"))
            if row.get("secret"):
                headers.append(
                    {"name": name, "value": None, "secret": True, "set": secrets.has(_header_key(sid, name))}
                )
            else:
                headers.append({"name": name, "value": row.get("value") or "", "secret": False, "set": True})
        test = None
        if last_test is not None:
            test = {
                "ok": last_test.ok,
                "tools": [{"name": n, "description": desc} for n, desc in last_test.tools],
                "error": last_test.error,
                "elapsedMs": last_test.elapsed_ms,
                "at": last_test.at,
            }
        return {
            "id": sid,
            "name": d.get("name"),
            "enabled": bool(d.get("enabled", True)),
            "kind": d.get("kind"),
            "command": d.get("command"),
            "args": list(d.get("args") or []),
            "env": env,
            "transport": d.get("transport"),
            "url": d.get("url"),
            "headers": headers,
            "bearer": bool(d.get("bearer")),
            "createdAt": d.get("createdAt"),
            "updatedAt": d.get("updatedAt"),
            "revision": self.revision,
            "missingSecrets": _missing(d, secrets),
            "lastTest": test,
        }


def _record(entry: dict[str, Any]) -> McpServerRecord:
    return McpServerRecord(entry, _revision(entry))


def _newer(data: dict[str, Any]) -> bool:
    return data.get("schemaVersion", SCHEMA_VERSION) != SCHEMA_VERSION


class McpStore:
    def __init__(self, state: Path | None = None, secrets: SecretStore | None = None) -> None:
        self.state_dir = Path(state) if state is not None else appstate.state_dir()
        self.path = self.state_dir / SERVERS_FILE
        self.secrets = secrets if secrets is not None else SecretStore(self.state_dir)

    # -- reading (never writes) -------------------------------------------------

    @staticmethod
    def _parse(raw: bytes) -> dict[str, Any] | None:
        """The file's object, or None when it is unreadable."""
        try:
            data = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None
        if not isinstance(data, dict) or not isinstance(data.get("servers", []), list):
            return None
        return data

    def _read(self) -> tuple[dict[str, Any], bool]:
        """(the whole file with unknown keys kept, whether it exists but can't be read)."""
        empty: dict[str, Any] = {"schemaVersion": SCHEMA_VERSION, "servers": []}
        try:
            raw = self.path.read_bytes()
        except FileNotFoundError:
            return empty, False
        except OSError:
            return empty, True
        data = self._parse(raw)
        if data is None:
            return empty, True
        servers = [s for s in data.get("servers") or [] if isinstance(s, dict) and isinstance(s.get("id"), str)]
        return {**data, "servers": servers}, False

    def list(self) -> list[McpServerRecord]:
        """File order; never writes."""
        return [_record(s) for s in self._read()[0]["servers"]]

    def unreadable(self) -> bool:
        """True when the file is there but can't be read: it lists no servers (`UNREADABLE`),
        and the next write copies it aside first. Never writes."""
        return self._read()[1]

    def read_only_reason(self) -> str | None:
        data, unreadable = self._read()
        return NEWER_VERSION if not unreadable and _newer(data) else None

    def get(self, server_id: str) -> McpServerRecord:
        """McpNotFound for an unknown id."""
        for rec in self.list():
            if rec.data["id"] == server_id:
                return rec
        raise McpNotFound(NOT_FOUND)

    # -- writing ----------------------------------------------------------------

    def _writable(self) -> dict[str, Any]:
        data, unreadable = self._read()
        if not unreadable and _newer(data):
            raise McpReadOnly(NEWER_VERSION)
        return data

    def _keep_unreadable(self) -> None:
        """Copy a file `_read` couldn't parse aside, so a write never loses it."""
        try:
            raw = self.path.read_bytes()
        except FileNotFoundError:
            return
        if self._parse(raw) is not None:
            return
        stem = Path(SERVERS_FILE).stem
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S")
        aside = self.state_dir / f"{stem}.unreadable-{stamp}.json"
        n = 2
        while aside.exists():
            aside = self.state_dir / f"{stem}.unreadable-{stamp}-{n}.json"
            n += 1
        atomic_write(aside, raw)

    def _write(self, data: dict[str, Any]) -> None:
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self._keep_unreadable()
        atomic_write(self.path, dump_json({**data, "schemaVersion": SCHEMA_VERSION}))

    def _commit(self, data: dict[str, Any], to_set: dict[str, str], to_remove: list[str]) -> None:
        """Secrets first, then the servers file; the old secrets are put back if that write fails."""
        touched = list(dict.fromkeys([*to_set, *to_remove]))
        old = {k: self.secrets.get(k) for k in touched}
        self.secrets.set_many(to_set, remove=to_remove)
        try:
            self._write(data)
        except BaseException:
            self.secrets.set_many(
                {k: v for k, v in old.items() if v is not None},
                remove=[k for k, v in old.items() if v is None],
            )
            raise

    def create(self, inp: McpServerInput) -> McpServerRecord:
        with _lock:
            data = self._writable()
            others = [_record(s) for s in data["servers"]]
            entry, to_set, to_remove = clean_input(inp, None, others, self.secrets)
            self._commit({**data, "servers": [*data["servers"], entry]}, to_set, to_remove)
            return _record(entry)

    def save(self, server_id: str, inp: McpServerInput, base_revision: str) -> McpServerRecord:
        with _lock:
            data = self._writable()
            records = [_record(s) for s in data["servers"]]
            index = next((i for i, r in enumerate(records) if r.data["id"] == server_id), None)
            if index is None:
                raise McpNotFound(NOT_FOUND)
            existing = records[index]
            if base_revision != existing.revision:
                raise McpConflict(CHANGED, existing.revision)
            others = [r for i, r in enumerate(records) if i != index]
            entry, to_set, to_remove = clean_input(inp, existing, others, self.secrets)
            servers = list(data["servers"])
            servers[index] = entry
            self._commit({**data, "servers": servers}, to_set, to_remove)
            return _record(entry)

    def delete(self, server_id: str) -> None:
        """Also ``secrets.delete_prefix("mcp:<id>:")``."""
        with _lock:
            data = self._writable()
            servers = [s for s in data["servers"] if s["id"] != server_id]
            if len(servers) == len(data["servers"]):
                raise McpNotFound(NOT_FOUND)
            self._write({**data, "servers": servers})
            self.secrets.delete_prefix(f"mcp:{server_id}:")


# -- validation -------------------------------------------------------------------


def _plain(value: str | None, *, too_long: str = VALUE_TOO_LONG, bad: str = BAD_VALUE) -> str:
    """A plain (non-secret) value: no ``${`` (the CLI would expand it), no NUL, capped."""
    value = value or ""
    if "${" in value:
        raise McpInvalid(USE_A_SECRET)
    if "\x00" in value:
        raise McpInvalid(bad)
    if len(value) > MAX_VALUE_CHARS:
        raise McpInvalid(too_long)
    return value


def _secret_value(value: str) -> str:
    if len(value) > MAX_SECRET_CHARS or "\x00" in value:
        raise McpInvalid(SECRET_TOO_LONG)
    return value


def _nameable(text: str) -> bool:
    """A key short and printable enough to repeat in a message."""
    return 0 < len(text) <= 128 and text.isprintable()


def _clean_name(inp: McpServerInput, existing: McpServerRecord | None, others: list[McpServerRecord]) -> str:
    name = inp.name
    if existing is not None:
        if name != existing.data.get("name"):
            raise McpInvalid(NAME_FIXED)
    else:
        if not _NAME_RE.fullmatch(name):
            raise McpInvalid(BAD_NAME)
        if name.casefold() in {n.casefold() for n in RESERVED_NAMES}:
            raise McpInvalid(NAME_RESERVED)
    if any(str(o.data.get("name", "")).casefold() == name.casefold() for o in others):
        raise McpConflict(NAME_TAKEN, None)
    if existing is None and len(others) >= MAX_SERVERS:
        raise McpInvalid(TOO_MANY_SERVERS)
    return name


def _clean_command(
    inp: McpServerInput, sid: str, existing: dict[str, Any] | None
) -> tuple[dict[str, Any], dict[str, str]]:
    if inp.url or inp.headers or inp.transport or inp.bearer or inp.bearerAction == "set":
        raise McpInvalid(BAD_COMMAND)
    command = inp.command or ""
    if not command.strip():
        raise McpInvalid(NO_COMMAND)
    command = _plain(command, too_long=BAD_COMMAND, bad=BAD_COMMAND)
    if command.startswith("-") or not command.isprintable():
        raise McpInvalid(BAD_COMMAND)
    if len(inp.args) > MAX_ARGS:
        raise McpInvalid(TOO_MANY_ARGS)
    args = [_plain(a, too_long=BAD_COMMAND, bad=BAD_COMMAND) for a in inp.args]
    if len(inp.env) > MAX_ROWS:
        raise McpInvalid(TOO_MANY_ENV)
    was_secret = {str(r.get("key")) for r in _rows(existing or {}, "env") if r.get("secret")}
    rows: list[dict[str, Any]] = []
    to_set: dict[str, str] = {}
    seen: set[str] = set()
    for row in inp.env:
        key = row.key
        if not _ENV_KEY_RE.fullmatch(key) or key in seen:
            raise McpInvalid(f"{key} isn't a valid variable name." if _nameable(key) else BAD_VAR)
        seen.add(key)
        if row.secret:
            if row.value:
                to_set[_env_key(sid, key)] = _secret_value(row.value)
            elif key not in was_secret:
                raise McpInvalid(f"Enter a value for {key}.")
            rows.append({"key": key, "secret": True})
        else:
            rows.append({"key": key, "value": _plain(row.value), "secret": False})
    entry = {"command": command, "args": args, "env": rows, "transport": None, "url": None, "headers": [], "bearer": False}
    return entry, to_set


def _clean_url(
    inp: McpServerInput, sid: str, existing: dict[str, Any] | None
) -> tuple[dict[str, Any], dict[str, str]]:
    if inp.command or inp.args or inp.env:
        raise McpInvalid(BAD_URL)
    url = _plain(inp.url, too_long=BAD_URL, bad=BAD_URL)
    try:
        parts = urlsplit(url)
        host = parts.hostname
    except ValueError:
        raise McpInvalid(BAD_URL) from None
    if parts.scheme not in ("http", "https") or not host or not url.isprintable() or any(c.isspace() for c in url):
        raise McpInvalid(BAD_URL)
    if len(inp.headers) > MAX_ROWS:
        raise McpInvalid(TOO_MANY_HEADERS)
    was_secret = {str(r.get("name")).casefold() for r in _rows(existing or {}, "headers") if r.get("secret")}
    rows: list[dict[str, Any]] = []
    to_set: dict[str, str] = {}
    seen: set[str] = set()
    for row in inp.headers:
        name = row.name
        if not _HEADER_RE.fullmatch(name) or name.casefold() in seen:
            raise McpInvalid(BAD_HEADER)
        seen.add(name.casefold())
        if row.value and any(c in row.value for c in "\r\n"):
            raise McpInvalid(BAD_HEADER)
        if row.secret:
            if row.value:
                to_set[_header_key(sid, name)] = _secret_value(row.value)
            elif name.casefold() not in was_secret:
                raise McpInvalid(f"Enter a value for {name}.")
            rows.append({"name": name, "secret": True})
        else:
            rows.append({"name": name, "value": _plain(row.value), "secret": False})
    if inp.bearerAction == "set":
        if not inp.bearer:
            raise McpInvalid(NO_BEARER)
        if any(c in inp.bearer for c in "\r\n"):
            raise McpInvalid(SECRET_TOO_LONG)
        to_set[_bearer_key(sid)] = _secret_value(inp.bearer)
        bearer = True
    elif inp.bearerAction == "remove":
        bearer = False
    else:
        bearer = bool((existing or {}).get("bearer"))
    if bearer and "authorization" in seen:
        raise McpInvalid(BEARER_AND_AUTH)
    entry = {
        "command": None,
        "args": [],
        "env": [],
        "transport": inp.transport or "http",
        "url": url,
        "headers": rows,
        "bearer": bearer,
    }
    return entry, to_set


def clean_input(
    inp: McpServerInput,
    existing: McpServerRecord | None,
    others: list[McpServerRecord],
    secrets: SecretStore,
) -> tuple[dict[str, Any], dict[str, str], list[str]]:
    """(stored entry, secret values to set, secret keys to remove). Raises McpInvalid / McpConflict.

    The entry keeps the existing server's id, ``createdAt`` and unknown keys; a new one gets a
    ULID. The keys to remove are every ``mcp:<id>:`` secret the new entry no longer uses (a
    row removed or turned plain, a bearer removed).
    """
    old = existing.data if existing is not None else None
    name = _clean_name(inp, existing, others)
    sid = str(old["id"]) if old is not None else new_ulid()
    if inp.kind == "command":
        fields, to_set = _clean_command(inp, sid, old)
    else:
        fields, to_set = _clean_url(inp, sid, old)
    now = _now()
    built: dict[str, Any] = {
        "id": sid,
        "name": name,
        "enabled": inp.enabled,
        "kind": inp.kind,
        **fields,
        "createdAt": str(old.get("createdAt") or now) if old is not None else now,
        "updatedAt": now,
    }
    entry = {k: built[k] for k in _KNOWN_KEYS}
    if old is not None:
        entry.update({k: v for k, v in old.items() if k not in _KNOWN_KEYS})
    used = {key for _, key in _secret_refs(entry)}
    to_remove = [k for k in secrets.keys(f"mcp:{sid}:") if k not in used]
    return entry, to_set, to_remove


# -- the CLI's entry --------------------------------------------------------------


def secret_env_name(secret_key: str) -> str:
    """``ENV_PREFIX + sha256(secret_key)[:12].upper()``, e.g. ``OBJECT_MCP_3FA9C01B22D4``."""
    return ENV_PREFIX + hashlib.sha256(secret_key.encode("utf-8")).hexdigest()[:12].upper()


def cli_entry(server: dict[str, Any], secrets: SecretStore) -> tuple[dict[str, Any], dict[str, str]]:
    """(entry with ``${OBJECT_MCP_...}`` references, {env name: value}). Raises MissingSecret (key names only).

    Shapes: ``{"type": "stdio", "command", "args", "env"}`` and ``{"type": "http"|"sse", "url",
    "headers"}`` (a bearer as ``"Authorization": "Bearer ${OBJECT_MCP_...}"``). The T1 spike
    (``docs/superpowers/plans/m19-cli-spike.md``) found that the CLI starts a ``.cmd``/``.bat``
    command as given on Windows, so the command is never wrapped in ``cmd /c``.
    """
    sid = str(server.get("id") or "")
    env: dict[str, str] = {}
    missing: list[str] = []

    def ref(label: str, key: str) -> str:
        value = secrets.get(key)
        if value is None:
            missing.append(label)
            return ""
        name = secret_env_name(key)
        env[name] = value
        return "${" + name + "}"

    entry: dict[str, Any]
    if server.get("kind") == "command":
        values: dict[str, str] = {}
        for row in _rows(server, "env"):
            key = str(row.get("key"))
            values[key] = ref(key, _env_key(sid, key)) if row.get("secret") else str(row.get("value") or "")
        entry = {"type": "stdio", "command": server.get("command"), "args": list(server.get("args") or []), "env": values}
    else:
        headers: dict[str, str] = {}
        for row in _rows(server, "headers"):
            name = str(row.get("name"))
            headers[name] = ref(name, _header_key(sid, name)) if row.get("secret") else str(row.get("value") or "")
        if server.get("bearer"):
            headers["Authorization"] = "Bearer " + ref(BEARER_ROW, _bearer_key(sid))
        entry = {"type": server.get("transport") or "http", "url": server.get("url"), "headers": headers}
    if missing:
        raise MissingSecret(missing)
    return entry, env
