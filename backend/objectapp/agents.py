"""The agent registry (M17, spec section 1): which folders are this machine's agents.

Agents belong to the machine, not a space. The registry is ``<state>/agents.json``::

    {"agents": [{"id": "<ULID>", "path": "<folder>", "kind": "local", "addedAt": "..."}]}

The default agent ("Assistant", id ``assistant``) is implicit: it is never in the file, is listed
first, lives in ``<state>/agents/Assistant/`` and has no folder until its first write
(`ensure_default`), so listing never writes. New agents default to
``<state>/agents/<safe_filename(name)>/``.

Delete moves a folder inside ``<state>/agents/`` to ``<state>/agents/.trash/<trashId>/`` with a
``<trashId>.json`` meta file beside it (restorable); a folder anywhere else is only unregistered,
its bytes untouched. An unreadable ``agents.json`` lists as empty and is copied aside as
``agents.unreadable-<stamp>.json`` before the next write.
"""

from __future__ import annotations

import errno
import hashlib
import json
import os
import re
import shutil
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from . import agentfiles
from .agentmodel import (
    AGENT_ID,
    AGENTS_DIR,
    DEFAULT_AGENT_ICON,
    DEFAULT_AGENT_ID,
    DEFAULT_AGENT_NAME,
    DEFAULT_SOUL,
    NEW_AGENT_ICON,
    NEWER_VERSION,
    REGISTRY_FILE,
    SCHEMA_VERSION,
    TRASH_DIR,
    UNREADABLE,
    AgentConflict,
    AgentError,
    AgentInput,
    AgentInvalid,
    AgentNotFound,
    AgentReadOnly,
    clean_input,
)
from .appstate import state_dir
from .ids import new_ulid
from .jsonstore import dump_json, parse_json_object
from .space import safe_filename
from .textfile import atomic_write, create_new, decode, encode_like
from .toolcatalog import AGENT_SERVER, OBJECT_SERVER, default_off

__all__ = [
    "NESTED",
    "AgentConflict",
    "AgentError",
    "AgentInvalid",
    "AgentNotFound",
    "AgentReadOnly",
    "AgentRecord",
    "AgentRegistry",
    "effective_model",
]

NESTED = "An agent folder can't be inside a space folder or hold one."
ID_LISTED = "An agent with this id is already listed."
NOT_AN_AGENT = "This folder isn't an Object agent."
DEFAULT_UNDELETABLE = "The default agent can't be deleted."
NOT_LISTED = "That agent isn't listed any more."  # our string (also the chat route's)
CHANGED = "This agent was changed elsewhere."  # our string
SETTINGS_UNREADABLE = "This agent's .claude/settings.json can't be read. Fix it, then save again."  # our string
FOLDER_IN_USE = "This agent's folder is in use. Wait for its turn to finish, then try again."  # our string

_ULID = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")
_AGENT_ID = re.compile(AGENT_ID)
_SERVER_NAME = re.compile(r"[A-Za-z0-9_-]{1,64}")

_lock = threading.RLock()


def _now() -> str:
    moment = datetime.now(UTC)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def _key(path: Path | str) -> str:
    return os.path.normcase(str(path))


def _within(child: Path, parent: Path) -> bool:
    c, p = _key(child), _key(parent)
    return c == p or c.startswith(p.rstrip(os.sep) + os.sep)


def _resolve(path: Path | str) -> Path:
    text = os.path.expanduser(str(path))
    if "\x00" in text:
        raise ValueError("embedded null character in path")
    return Path(text).resolve()


def _revision(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _secret_lookup(name: str) -> str | None:
    """`agentrun.SECRET_LOOKUP` when the runner is there (M19 replaces it), else nothing resolves."""
    try:
        from . import agentrun
    except ImportError:
        return None
    lookup = getattr(agentrun, "SECRET_LOOKUP", None)
    return lookup(name) if callable(lookup) else None


@dataclass
class AgentRecord:
    id: str
    folder: Path
    data: dict[str, Any]
    revision: str | None
    default: bool
    exists: bool
    missing: bool
    in_state_dir: bool
    read_only_reason: str | None

    def to_api(self, settings: dict[str, Any]) -> dict[str, Any]:
        """The API's ``Agent`` shape."""
        d = self.data
        servers = []
        if self.exists and not self.missing:
            for name, server in agentfiles.folder_mcp_servers(self.folder).items():
                missing_vars = sorted(v for v in agentfiles.var_refs(server) if _secret_lookup(v) is None)
                usable = (
                    not missing_vars
                    and bool(_SERVER_NAME.fullmatch(name))
                    and name not in (OBJECT_SERVER, AGENT_SERVER)
                )
                servers.append({"name": name, "missingVars": missing_vars, "usable": usable})
        tools_off = d.get("toolsOff")
        learning = d.get("learning")
        return {
            "id": self.id,
            "kind": "local",
            "name": d.get("name") if isinstance(d.get("name"), str) else self.folder.name,
            "icon": d.get("icon") if isinstance(d.get("icon"), str) else None,
            "color": d.get("color") if isinstance(d.get("color"), str) else None,
            "description": d.get("description") if isinstance(d.get("description"), str) else "",
            "model": effective_model(self, settings),
            "toolsOff": [t for t in tools_off if isinstance(t, str)] if isinstance(tools_off, list) else [],
            "learning": learning if isinstance(learning, dict) else None,
            "createdAt": d.get("createdAt") if isinstance(d.get("createdAt"), str) else None,
            "updatedAt": d.get("updatedAt") if isinstance(d.get("updatedAt"), str) else None,
            "default": self.default,
            "folder": str(self.folder),
            "inStateDir": self.in_state_dir,
            "exists": self.exists,
            "missing": self.missing,
            "readOnlyReason": self.read_only_reason,
            "revision": self.revision,
            "mcpServers": servers,
        }


def effective_model(agent: AgentRecord, settings: dict[str, Any]) -> str | None:
    """The default agent's model is the ``aiModel`` device setting; another agent's is its own."""
    value = settings.get("aiModel") if agent.default else agent.data.get("model")
    return value if isinstance(value, str) and value else None


def _default_data(now: str | None = None) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "id": DEFAULT_AGENT_ID,
        "name": DEFAULT_AGENT_NAME,
        "icon": DEFAULT_AGENT_ICON,
        "color": None,
        "description": "",
        "model": None,
        "toolsOff": default_off(),
        "learning": None,
        "createdAt": now,
        "updatedAt": now,
    }


class AgentRegistry:
    """``<state>/agents.json`` and the agent folders it lists."""

    def __init__(self, state: Path | None = None) -> None:
        self.state = Path(state) if state is not None else state_dir()
        self.path = self.state / REGISTRY_FILE

    # -- places -----------------------------------------------------------------------------

    @property
    def agents_dir(self) -> Path:
        return self.state / AGENTS_DIR

    @property
    def trash_dir(self) -> Path:
        return self.agents_dir / TRASH_DIR

    def _default_folder(self) -> Path:
        return _resolve(self.agents_dir / safe_filename(DEFAULT_AGENT_NAME))

    def _in_state_dir(self, folder: Path) -> bool:
        try:
            base = _resolve(self.agents_dir)
        except (OSError, ValueError):
            return False
        return _within(folder, base) and _key(folder) != _key(base)

    # -- the registry file ------------------------------------------------------------------

    def _load(self) -> list[dict[str, Any]]:
        try:
            data = json.loads(self.path.read_bytes().decode("utf-8"))
        except (OSError, ValueError, UnicodeDecodeError):
            return []
        if not isinstance(data, dict):
            return []
        out: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in data.get("agents") or []:
            if not isinstance(item, dict):
                continue
            aid, path = item.get("id"), item.get("path")
            if not isinstance(aid, str) or not _ULID.match(aid) or not isinstance(path, str) or not path:
                continue
            if aid in seen:
                continue
            seen.add(aid)
            out.append(item)
        return out

    def _save(self, entries: list[dict[str, Any]]) -> None:
        self.state.mkdir(parents=True, exist_ok=True)
        self._keep_unreadable()
        atomic_write(self.path, dump_json({"agents": entries}))

    def _keep_unreadable(self) -> None:
        """Copy an ``agents.json`` aside before it is replaced when `_load` couldn't parse it or
        dropped any of its entries (``agents`` not a list, a bad id, a missing path...)."""
        try:
            raw = self.path.read_bytes()
        except FileNotFoundError:
            return
        try:
            data = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            data = None
        if isinstance(data, dict):
            listed = data.get("agents", [])
            if isinstance(listed, list) and len(listed) == len(self._load()):
                return
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S")
        aside = self.state / f"agents.unreadable-{stamp}.json"
        n = 2
        while aside.exists():
            aside = self.state / f"agents.unreadable-{stamp}-{n}.json"
            n += 1
        atomic_write(aside, raw)

    def _register(self, agent_id: str, folder: Path) -> None:
        with _lock:
            entries = self._load()
            entries.append({"id": agent_id, "path": str(folder), "kind": "local", "addedAt": _now()})
            self._save(entries)

    def _listed(self, agent_id: str) -> bool:
        return agent_id == DEFAULT_AGENT_ID or any(e["id"] == agent_id for e in self._load())

    # -- records ----------------------------------------------------------------------------

    def _record(self, agent_id: str, folder: Path, *, default: bool) -> AgentRecord:
        in_state = self._in_state_dir(folder)
        if default and not (folder / ".object-agent" / "agent.json").is_file():
            return AgentRecord(
                id=agent_id, folder=folder, data=_default_data(), revision=None, default=True,
                exists=False, missing=False, in_state_dir=in_state, read_only_reason=None,
            )
        if not folder.is_dir():
            return AgentRecord(
                id=agent_id, folder=folder, data={"id": agent_id, "name": folder.name}, revision=None,
                default=default, exists=True, missing=True, in_state_dir=in_state, read_only_reason=None,
            )
        reason: str | None = None
        try:
            data, revision = agentfiles.read_agent_file(folder)
        except ValueError:
            data, revision, reason = {"id": agent_id, "name": folder.name}, None, UNREADABLE
        else:
            if data.get("schemaVersion") != SCHEMA_VERSION:
                reason = NEWER_VERSION if isinstance(data.get("schemaVersion"), int) else UNREADABLE
            elif not isinstance(data.get("name"), str):
                reason = UNREADABLE
        return AgentRecord(
            id=agent_id, folder=folder, data=data, revision=revision, default=default,
            exists=True, missing=False, in_state_dir=in_state, read_only_reason=reason,
        )

    def _default(self) -> AgentRecord:
        return self._record(DEFAULT_AGENT_ID, self._default_folder(), default=True)

    def list(self) -> list[AgentRecord]:
        """The default agent first, then registry order. Never writes."""
        out = [self._default()]
        for entry in self._load():
            out.append(self._record(entry["id"], Path(entry["path"]), default=False))
        return out

    def get(self, agent_id: str) -> AgentRecord:
        if agent_id == DEFAULT_AGENT_ID:
            return self._default()
        for entry in self._load():
            if entry["id"] == agent_id:
                return self._record(agent_id, Path(entry["path"]), default=False)
        raise AgentNotFound(NOT_LISTED)

    def local_folders(self) -> list[Path]:
        """Every local agent folder (the default agent's included), resolved, for the fence."""
        out = [self._default_folder()]
        for entry in self._load():
            try:
                out.append(_resolve(entry["path"]))
            except (OSError, ValueError):
                continue
        return out

    # -- creating ---------------------------------------------------------------------------

    def _space_folders(self) -> list[Path]:
        from .spaces import Registry

        out: list[Path] = []
        for entry in Registry(self.state).list():
            try:
                out.append(_resolve(entry.path))
            except (OSError, ValueError):
                continue
        return out

    def _check_nesting(self, folder: Path) -> None:
        for space in self._space_folders():
            if _within(folder, space) or _within(space, folder):
                raise AgentInvalid(NESTED)

    def _claim_folder(self, name: str, location: Path | None) -> Path:
        """Make the new agent's (empty) folder and return it, resolved."""
        stem = safe_filename(name)
        if location is None:
            parent = _resolve(self.agents_dir)
            self._check_nesting(parent / stem)
            parent.mkdir(parents=True, exist_ok=True)
            reserved = {_key(self._default_folder())}
            n = 1
            while True:
                target = parent / (stem if n == 1 else f"{stem} ({n})")
                n += 1
                if _key(target) in reserved or target.name == TRASH_DIR:
                    continue
                try:
                    target.mkdir()
                except FileExistsError:
                    continue
                return target
        try:
            parent = _resolve(location)
            if not parent.is_dir():
                raise AgentNotFound(f"Not a folder: {parent}")  # our string, as Create space
        except (OSError, ValueError):
            raise AgentNotFound(f"Not a folder: {str(location)[:60]!r}") from None
        target = parent / stem
        self._check_nesting(target)
        try:
            target.mkdir()
        except FileExistsError:
            raise AgentConflict(f"A folder named {stem} is already there.") from None  # our string
        return target

    def _new_data(self, inp: AgentInput, *, tools_off: list[str] | None = None) -> dict[str, Any]:
        now = _now()
        return {
            "schemaVersion": SCHEMA_VERSION,
            "id": new_ulid(),
            "name": inp.name,
            "icon": inp.icon or NEW_AGENT_ICON,
            "color": inp.color,
            "description": inp.description,
            "model": inp.model,
            "toolsOff": inp.toolsOff if inp.toolsOff is not None else (tools_off or default_off()),
            "learning": inp.learning,
            "createdAt": now,
            "updatedAt": now,
        }

    def ensure_default(self, seed: dict[str, Any] | None = None) -> AgentRecord:
        """The default agent, its folder made first if it has none (its first write).

        `seed` overrides fields of the new ``agent.json`` (never ``id``, ``schemaVersion`` or
        ``model``); an existing folder is left exactly as it is.
        """
        with _lock:
            rec = self._default()
            if rec.exists:
                return rec
            data = _default_data(_now())
            for k, v in (seed or {}).items():
                if k not in ("id", "schemaVersion", "model"):
                    data[k] = v
            self._check_nesting(rec.folder)
            rec.folder.mkdir(parents=True, exist_ok=True)
            agentfiles.write_skeleton(rec.folder, data, DEFAULT_SOUL)
            return self._default()

    def create(self, inp: AgentInput, instructions: str, location: Path | None = None) -> AgentRecord:
        inp = clean_input(inp)
        with _lock:
            folder = self._claim_folder(inp.name, location)
            data = self._new_data(inp)
            agentfiles.write_skeleton(folder, data, instructions)
            self._register(data["id"], folder)
            return self._record(data["id"], folder, default=False)

    def duplicate(
        self, source_id: str, inp: AgentInput, *, memory: bool, skills: bool, location: Path | None = None
    ) -> AgentRecord:
        """A new agent from `source_id`'s folder: its soul, ``.claude/settings.json``,
        ``.claude/settings.local.json`` and ``.mcp.json``; ``.claude/skills/`` only with `skills`,
        ``.object-agent/memory/`` only with `memory`. Chats, ledger, usage and cache never."""
        inp = clean_input(inp)
        source = self.get(source_id)
        if source.missing:
            raise AgentNotFound(f"This agent's folder is missing: {source.folder}")
        with _lock:
            src_off = source.data.get("toolsOff")
            src_off = [t for t in src_off if isinstance(t, str)] if isinstance(src_off, list) else default_off()
            folder = self._claim_folder(inp.name, location)
            data = self._new_data(inp, tools_off=src_off)
            instructions = DEFAULT_SOUL if not source.exists else ""
            copied_settings = False
            if source.exists:
                src = source.folder
                for rel in ("CLAUDE.md", ".claude/settings.json", ".claude/settings.local.json", ".mcp.json"):
                    if (src / rel).is_file():
                        (folder / rel).parent.mkdir(parents=True, exist_ok=True)
                        create_new(folder / rel, (src / rel).read_bytes())
                        copied_settings = copied_settings or rel == ".claude/settings.json"
                if skills and (src / ".claude" / "skills").is_dir():
                    shutil.copytree(src / ".claude" / "skills", folder / ".claude" / "skills")
                if memory and (src / ".object-agent" / "memory").is_dir():
                    shutil.copytree(src / ".object-agent" / "memory", folder / ".object-agent" / "memory")
            agentfiles.write_skeleton(folder, data, instructions)
            if copied_settings and data["toolsOff"] != src_off:
                agentfiles.sync_permissions(folder, src_off, data["toolsOff"])
            self._register(data["id"], folder)
            return self._record(data["id"], folder, default=False)

    def add_folder(self, path: Path) -> AgentRecord:
        """Register an existing agent folder. Nothing in it is written."""
        try:
            folder = _resolve(path)
            is_dir = folder.is_dir()
        except (OSError, ValueError):
            raise AgentNotFound(f"Not a folder: {str(path)[:60]!r}") from None
        if not is_dir:
            raise AgentNotFound(f"Not a folder: {folder}")
        try:
            data, _ = agentfiles.read_agent_file(folder)
        except ValueError:
            raise AgentInvalid(NOT_AN_AGENT) from None
        agent_id = data.get("id")
        if not isinstance(agent_id, str) or not _AGENT_ID.match(agent_id):
            raise AgentInvalid(NOT_AN_AGENT)
        self._check_nesting(folder)
        with _lock:
            if self._listed(agent_id) or any(_key(f) == _key(folder) for f in self.local_folders()):
                raise AgentConflict(ID_LISTED)
            self._register(agent_id, folder)
            return self._record(agent_id, folder, default=False)

    # -- saving -----------------------------------------------------------------------------

    def _writable(self, agent_id: str) -> AgentRecord:
        rec = self.get(agent_id)
        if rec.missing:
            raise AgentNotFound(f"This agent's folder is missing: {rec.folder}")
        if rec.read_only_reason:
            raise AgentReadOnly(rec.read_only_reason)
        return rec

    def save(self, agent_id: str, inp: AgentInput, base_revision: str | None) -> AgentRecord:
        inp = clean_input(inp)
        with _lock:
            rec = self._writable(agent_id)
            if rec.default and not rec.exists:
                if base_revision:
                    raise AgentConflict(CHANGED, None)
                rec = self.ensure_default()
            elif base_revision != rec.revision:
                raise AgentConflict(CHANGED, rec.revision)
            data = dict(rec.data)
            old_off = data.get("toolsOff")
            old_off = [t for t in old_off if isinstance(t, str)] if isinstance(old_off, list) else []
            data["name"] = inp.name
            data["icon"] = inp.icon
            data["color"] = inp.color
            data["description"] = inp.description
            data["model"] = None if rec.default else inp.model
            if inp.toolsOff is not None:
                data["toolsOff"] = inp.toolsOff
            if inp.learning is not None:
                data["learning"] = inp.learning
            data["updatedAt"] = _now()
            new_off = data.get("toolsOff") or []
            if new_off != old_off:
                _check_settings(rec.folder)  # before agent.json, so the two never disagree
            agentfiles.write_agent_file(rec.folder, data)
            if new_off != old_off:
                try:
                    agentfiles.sync_permissions(rec.folder, old_off, new_off)
                except ValueError:
                    raise AgentReadOnly(SETTINGS_UNREADABLE) from None
            return self.get(agent_id)

    def read_instructions(self, agent_id: str) -> tuple[str, str | None]:
        """``(text, revision)`` of the agent's ``CLAUDE.md`` (``\\n`` endings, BOM stripped);
        ``("", None)`` when there is none. Never writes."""
        rec = self.get(agent_id)
        try:
            raw = (rec.folder / "CLAUDE.md").read_bytes()
        except (FileNotFoundError, NotADirectoryError):
            return "", None
        return decode(raw).text, _revision(raw)

    def save_instructions(self, agent_id: str, text: str, base_revision: str | None) -> str:
        """Write ``CLAUDE.md`` keeping its BOM and line endings; the new revision."""
        text = text.replace("\r\n", "\n")
        with _lock:
            rec = self._writable(agent_id)
            path = rec.folder / "CLAUDE.md"
            try:
                original: bytes | None = path.read_bytes()
            except (FileNotFoundError, NotADirectoryError):
                original = None
            current = _revision(original) if original is not None else None
            if (base_revision or None) != current:
                raise AgentConflict(CHANGED, current)
            if rec.default and not rec.exists:
                self.ensure_default()
                original = None  # the skeleton's soul is replaced by what was saved
            data = encode_like(original, text) if original is not None else text.encode("utf-8")
            atomic_write(path, data)
            return _revision(data)

    # -- removing ---------------------------------------------------------------------------

    def unregister(self, agent_id: str) -> None:
        """Drop the agent from the registry; its folder is left exactly as it is."""
        if agent_id == DEFAULT_AGENT_ID:
            raise AgentInvalid(DEFAULT_UNDELETABLE)
        with _lock:
            entries = self._load()
            kept = [e for e in entries if e["id"] != agent_id]
            if len(kept) == len(entries):
                raise AgentNotFound(NOT_LISTED)
            self._save(kept)

    def delete(self, agent_id: str) -> str | None:
        """Unregister the agent and move its folder to the agent trash; the trash id. A folder
        outside ``<state>/agents/`` (or one that is gone) is only unregistered: None."""
        if agent_id == DEFAULT_AGENT_ID:
            raise AgentInvalid(DEFAULT_UNDELETABLE)
        with _lock:
            rec = self.get(agent_id)
            if rec.missing or not rec.in_state_dir:
                self.unregister(agent_id)
                return None
            trash_id = new_ulid()
            self.trash_dir.mkdir(parents=True, exist_ok=True)
            meta_path = self.trash_dir / f"{trash_id}.json"
            meta = {
                "trashId": trash_id,
                "agentId": agent_id,
                "name": rec.data.get("name") if isinstance(rec.data.get("name"), str) else rec.folder.name,
                "icon": rec.data.get("icon") if isinstance(rec.data.get("icon"), str) else None,
                "originalPath": str(rec.folder),
                "deletedAt": _now(),
            }
            create_new(meta_path, dump_json(meta))
            try:
                _move_folder(rec.folder, self.trash_dir / trash_id)
            except OSError:
                meta_path.unlink(missing_ok=True)
                raise AgentConflict(FOLDER_IN_USE) from None
            except BaseException:
                meta_path.unlink(missing_ok=True)
                raise
            self.unregister(agent_id)
            return trash_id

    def _trash_meta(self, trash_id: str) -> dict[str, Any] | None:
        if not _ULID.match(trash_id):
            return None
        try:
            meta = json.loads((self.trash_dir / f"{trash_id}.json").read_bytes().decode("utf-8"))
        except (OSError, ValueError, UnicodeDecodeError):
            return None
        if not isinstance(meta, dict) or meta.get("trashId") != trash_id:
            return None
        if not isinstance(meta.get("originalPath"), str) or not isinstance(meta.get("agentId"), str):
            return None
        if not (self.trash_dir / trash_id).is_dir():
            return None
        return meta

    def trash(self) -> list[dict[str, Any]]:
        """The agent trash, newest first (``AgentTrashItem``)."""
        out: list[dict[str, Any]] = []
        try:
            metas = sorted(self.trash_dir.glob("*.json"))
        except OSError:
            return []
        for path in metas:
            meta = self._trash_meta(path.stem)
            if meta is None:
                continue
            out.append({
                "trashId": meta["trashId"],
                "agentId": meta["agentId"],
                "name": meta.get("name") if isinstance(meta.get("name"), str) else "",
                "icon": meta.get("icon") if isinstance(meta.get("icon"), str) else None,
                "originalPath": meta["originalPath"],
                "deletedAt": meta.get("deletedAt") if isinstance(meta.get("deletedAt"), str) else "",
            })
        out.sort(key=lambda m: (m["deletedAt"], m["trashId"]), reverse=True)
        return out

    def restore(self, trash_id: str) -> AgentRecord:
        """Put a trashed agent back at its original path (or a free ``<name> (2)`` beside it)
        and list it again with its id."""
        with _lock:
            meta = self._trash_meta(trash_id)
            if meta is None:
                raise AgentNotFound("That agent isn't in the trash.")  # our string
            agent_id = meta["agentId"]
            if self._listed(agent_id):
                raise AgentConflict(ID_LISTED)
            original = Path(meta["originalPath"])
            original.parent.mkdir(parents=True, exist_ok=True)
            target, n = original, 2
            while target.exists():
                target = original.parent / f"{original.name} ({n})"
                n += 1
            try:
                _move_folder(self.trash_dir / trash_id, target)
            except OSError:
                raise AgentConflict(FOLDER_IN_USE) from None
            (self.trash_dir / f"{trash_id}.json").unlink(missing_ok=True)
            self._register(agent_id, target)
            return self._record(agent_id, target, default=False)


def _check_settings(folder: Path) -> None:
    """Raise `AgentReadOnly` when the folder's ``.claude/settings.json`` exists but can't be read
    (`agentfiles.sync_permissions` would refuse it)."""
    try:
        raw = (Path(folder) / agentfiles.SETTINGS_FILE).read_bytes()
    except FileNotFoundError:
        return
    except OSError:
        raise AgentReadOnly(SETTINGS_UNREADABLE) from None
    try:
        parse_json_object(raw)
    except (ValueError, UnicodeDecodeError):
        raise AgentReadOnly(SETTINGS_UNREADABLE) from None


def _move_folder(src: Path, dest: Path) -> None:
    """Move a folder to a new path that must not exist: ``os.replace`` on one volume,
    ``shutil.move`` across volumes, checked afterwards. The meta files beside it are created
    with `textfile.create_new`, so nothing is ever replaced."""
    if dest.exists():
        raise FileExistsError(str(dest))
    try:
        os.replace(src, dest)
        return
    except OSError as e:
        if e.errno != errno.EXDEV and getattr(e, "winerror", None) != 17:
            raise
    shutil.move(str(src), str(dest))
    if src.exists() or not dest.is_dir():
        raise OSError(f"The agent folder couldn't be moved: {src}")  # our string

