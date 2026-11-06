"""An agent folder's files (M17, spec section 1).

The layout is a Claude Code project folder plus Object's own ``.object-agent/``::

    CLAUDE.md                     the soul
    .claude/settings.json         permissions (the tool switches' generated deny entries)
    .claude/settings.local.json   never written here
    .claude/skills/               native skills (M18 writes them)
    .mcp.json                     folder MCP servers (``${VAR}`` references only)
    .object-agent/agent.json      Object's fields (`agentmodel.AgentFile`)
    .object-agent/sessions/       chat transcripts (``transcripts``)
    .gitignore                    `agentmodel.GITIGNORE`

Every write is atomic (`textfile.atomic_write`) or create-only (`textfile.create_new`), and
``agent.json`` and ``.claude/settings.json`` keep every key Object doesn't own. Nothing here
reads or writes outside the folder it is given.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from .agentmodel import AGENT_FILE, GITIGNORE, PROTECTED, SELF_LOADED, SESSIONS_DIR
from .jsonstore import dump_json, parse_json_object
from .textfile import atomic_write, create_new
from .toolcatalog import catalogue

__all__ = [
    "MCP_FILE",
    "SETTINGS_FILE",
    "folder_mcp_servers",
    "generated_denies",
    "read_agent_file",
    "sync_permissions",
    "var_refs",
    "write_agent_file",
    "write_skeleton",
]

SETTINGS_FILE = ".claude/settings.json"
MCP_FILE = ".mcp.json"

# ${VAR} and ${VAR:-default}, the forms Claude Code expands in .mcp.json.
_VAR = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}")


def _revision(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _protected_rules() -> list[str]:
    """`PROTECTED` and `SELF_LOADED` as folder-relative deny rules: ``Edit(./CLAUDE.md)``... (the
    agent's folder is the run's working folder, so the rules travel with a copied or shared folder)."""
    return [f"Edit(./{p})" for p in (*PROTECTED, *SELF_LOADED)]


def _create_if_absent(path: Path, data: bytes) -> None:
    try:
        create_new(path, data)
    except FileExistsError:
        pass


def write_skeleton(folder: Path, data: dict[str, Any], instructions: str) -> None:
    """Write a new agent folder's files: ``CLAUDE.md``, ``.claude/settings.json``,
    ``.object-agent/agent.json``, ``.object-agent/sessions/`` and ``.gitignore``.

    Each file is created only when absent (`create_new`); nothing is ever overwritten. The
    settings file's ``permissions.deny`` holds the generated entries for ``data["toolsOff"]``.
    """
    folder = Path(folder)
    (folder / ".claude").mkdir(parents=True, exist_ok=True)
    (folder / SESSIONS_DIR).mkdir(parents=True, exist_ok=True)
    _create_if_absent(folder / "CLAUDE.md", instructions.encode("utf-8"))
    settings = {"permissions": {"deny": generated_denies(data.get("toolsOff") or [])}}
    _create_if_absent(folder / SETTINGS_FILE, dump_json(settings))
    _create_if_absent(folder / AGENT_FILE, dump_json(data))
    _create_if_absent(folder / ".gitignore", GITIGNORE.encode("utf-8"))


def read_agent_file(folder: Path) -> tuple[dict[str, Any], str]:
    """``(data, revision)`` of ``.object-agent/agent.json``; the revision is the sha256 of its bytes.

    Raises `ValueError` when the file can't be read or isn't a JSON object.
    """
    try:
        raw = (Path(folder) / AGENT_FILE).read_bytes()
    except OSError as e:
        raise ValueError(f"agent.json can't be read: {e}") from None
    try:
        data = parse_json_object(raw)
    except (ValueError, UnicodeDecodeError) as e:
        raise ValueError(f"agent.json isn't a JSON object: {e}") from None
    return data, _revision(raw)


def write_agent_file(folder: Path, data: dict[str, Any]) -> str:
    """Write ``agent.json`` atomically (`dump_json`, every key in `data` kept); the new revision."""
    path = Path(folder) / AGENT_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = dump_json(data)
    atomic_write(path, raw)
    return _revision(raw)


def generated_denies(tools_off: Iterable[str]) -> list[str]:
    """The deny entries Object owns in a folder's ``.claude/settings.json``: the CLI names of the
    switched-off catalogue rows (a folder server's ``mcp__<name>`` id is its own CLI name), then
    the `PROTECTED` rules."""
    by_id = {t.id: t.cli for g in catalogue() for t in g.tools}
    out: list[str] = []
    for tool_id in tools_off:
        names = by_id.get(tool_id) or ((tool_id,) if tool_id.startswith("mcp__") else ())
        for n in names:
            if n not in out:
                out.append(n)
    for rule in _protected_rules():
        if rule not in out:
            out.append(rule)
    return out


def sync_permissions(folder: Path, old_off: Iterable[str], new_off: Iterable[str]) -> None:
    """Set ``.claude/settings.json`` ``permissions.deny`` to (existing entries minus
    ``generated_denies(old_off)``) + ``generated_denies(new_off)``. Every other key and entry is
    kept; a missing file is created. An unreadable file raises `ValueError` and is left as it is.
    """
    path = Path(folder) / SETTINGS_FILE
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        settings: dict[str, Any] = {}
    else:
        try:
            settings = parse_json_object(raw)
        except (ValueError, UnicodeDecodeError) as e:
            raise ValueError(f".claude/settings.json can't be read: {e}") from None
    perms = settings.get("permissions")
    if not isinstance(perms, dict):
        perms = {}
    existing = perms.get("deny")
    existing = existing if isinstance(existing, list) else []
    old = set(generated_denies(old_off))
    deny = [e for e in existing if not (isinstance(e, str) and e in old)]
    for entry in generated_denies(new_off):
        if entry not in deny:
            deny.append(entry)
    perms["deny"] = deny
    settings["permissions"] = perms
    path.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(path, dump_json(settings))


def folder_mcp_servers(folder: Path) -> dict[str, dict[str, Any]]:
    """The folder's ``.mcp.json`` ``mcpServers`` (each a JSON object); ``{}`` when absent or unreadable."""
    try:
        data = json.loads((Path(folder) / MCP_FILE).read_bytes().decode("utf-8"))
    except (OSError, ValueError, UnicodeDecodeError):
        return {}
    servers = data.get("mcpServers") if isinstance(data, dict) else None
    if not isinstance(servers, dict):
        return {}
    return {k: v for k, v in servers.items() if isinstance(k, str) and isinstance(v, dict)}


def var_refs(server: dict[str, Any]) -> set[str]:
    """Every ``${VAR}`` (and ``${VAR:-default}``) named anywhere in a server's definition."""
    found: set[str] = set()

    def walk(value: Any) -> None:
        if isinstance(value, str):
            found.update(_VAR.findall(value))
        elif isinstance(value, dict):
            for k, v in value.items():
                walk(k)
                walk(v)
        elif isinstance(value, list):
            for v in value:
                walk(v)

    walk(server)
    return found
