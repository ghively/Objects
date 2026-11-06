"""An agent's skills (M18, spec section 5): ``.claude/skills/<name>/`` on disk, ``usage.json``, the
enforced ``skill_manage`` rules, archive / restore / pin, and the per-run read memo.

- A skill is a folder holding ``SKILL.md`` (front matter ``name``, ``description`` and, for skills
  the agent made, ``created_by: agent``; no ``created_by`` reads as ``user``) and support files
  under ``references/``, ``templates/`` or ``scripts/``.
- Archived skills are folders in ``.object-agent/skills-archive/`` (a taken name gets ``" (2)"``,
  ``" (3)"``…); "archived" is where the folder is, never only a flag. An archived skill is named by
  its archive folder's name. Nothing here deletes a skill.
- ``usage.json`` holds uses, last use, created-at, the stale mark, the pin and archive details,
  keyed by the skill's name (an archived skill by its archive folder's name). Unknown keys are
  kept. Listing and viewing with ``bump=False`` write nothing.
- Every change goes to the ledger with the whole file's text before and after (``base64`` when a
  support file that is replaced or removed isn't UTF-8). Text files keep their BOM and line
  endings (`textfile.encode_like`); writes are atomic; no write goes through a link out of the
  skill's folder. One lock per agent folder serialises skill changes and ``usage.json``.
- A ``patch`` or ``edit`` must follow a read of that skill in the same run: `view` with the run's
  memo key, the CLI's own ``Skill`` tool (`record_use`), or the run's own ``create``.

No network client.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from . import ledger, textfile
from .frontmatter import FrontmatterError, delete_keys, parse_fm, set_keys
from .jsonstore import dump_json
from .learningmodel import (
    ARCHIVE_DIR,
    SKILL_DESCRIPTION_MAX,
    SKILL_MD_MAX,
    SKILL_NAME,
    SKILLS_DIR,
    SUPPORT_DIRS,
    SUPPORT_FILE_MAX,
    USAGE_FILE,
)
from .objfile import join_object, split_object
from .space import safe_filename

__all__ = [
    "MEMO",
    "SCHEDULE_SKILLS",
    "RunMemo",
    "SkillConflict",
    "SkillError",
    "SkillInfo",
    "SkillInvalid",
    "SkillNotFound",
    "SkillTooLarge",
    "archive",
    "list_skills",
    "manage",
    "record_use",
    "restore",
    "safe_support_path",
    "set_pinned",
    "set_state",
    "user_create",
    "user_write",
    "view",
]

SKILL_FILE = "SKILL.md"
ACTIONS = ("create", "patch", "edit", "write_file", "remove_file", "archive")

# -- messages (our strings) ------------------------------------------------------------------------

NAME_MESSAGE = "A skill name is at most 64 characters: lower-case letters, digits and hyphens."
DESCRIPTION_MESSAGE = "A skill's description is 1 to 60 characters."
READ_FIRST_MESSAGE = "Read the skill with skill_view first (in this run), then change it."
SKILL_MD_MESSAGE = "SKILL.md can be at most 100,000 characters."
SUPPORT_SIZE_MESSAGE = "A skill's files can be at most 1 MiB each."
SUPPORT_PATH_MESSAGE = "Support files go in references/, templates/ or scripts/."
CURATOR_PROTECTED_MESSAGE = "The curator doesn't change pinned skills or skills you wrote."
CURATOR_SCHEDULE_MESSAGE = "The curator doesn't change skills a schedule uses."
RESTORE_TAKEN_MESSAGE = "A skill with this name is active."
STALE_FILE_MESSAGE = "This file changed since you opened it."
NOT_TEXT_MESSAGE = "That file isn't text."
LINK_MESSAGE = "This skill's folder is a link out of the agent's folder."
USAGE_UNREADABLE_MESSAGE = "usage.json can't be read; fix or move it first."


class SkillError(Exception):
    """A skill operation that can't be made (``status``, ``message``)."""

    status = 422

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        if status is not None:
            self.status = status


class SkillNotFound(SkillError):
    status = 404


class SkillConflict(SkillError):
    status = 409

    def __init__(self, message: str, current_revision: str | None = None) -> None:
        super().__init__(message)
        self.current_revision = current_revision


class SkillTooLarge(SkillError):
    status = 413


class SkillInvalid(SkillError):
    status = 422


SCHEDULE_SKILLS: Callable[[Path], set[str]] = lambda folder: set()  # noqa: E731
"""Skills a schedule of this agent uses. M21 replaces it; it may raise (its index can't be read),
and then the curator changes none of that agent's skills."""


# -- the per-run read memo -------------------------------------------------------------------------


class RunMemo:
    """Which skills a run has read (and which uses it has counted), keyed by the run token's id."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._read: dict[str, set[str]] = {}
        self._used: dict[str, set[str]] = {}

    def mark_read(self, key: str, name: str) -> None:
        with self._lock:
            self._read.setdefault(key, set()).add(name)

    def was_read(self, key: str, name: str) -> bool:
        with self._lock:
            return name in self._read.get(key, ())

    def forget(self, key: str) -> None:
        with self._lock:
            self._read.pop(key, None)
            self._used.pop(key, None)

    def _count_use(self, key: str, name: str) -> bool:
        """True the first time `name` is used under `key` (a use counts once per run)."""
        with self._lock:
            used = self._used.setdefault(key, set())
            if name in used:
                return False
            used.add(name)
            return True


MEMO = RunMemo()


# -- small helpers ---------------------------------------------------------------------------------

_locks_guard = threading.Lock()
_locks: dict[str, threading.RLock] = {}


def _lock(folder: Path) -> threading.RLock:
    key = os.path.normcase(os.path.abspath(folder))
    with _locks_guard:
        lock = _locks.get(key)
        if lock is None:
            lock = _locks[key] = threading.RLock()
        return lock


def _clock() -> datetime:
    return datetime.now(UTC)


def _now() -> str:
    moment = _clock().astimezone(UTC)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def _revision(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _read_bytes(path: Path) -> bytes | None:
    try:
        return path.read_bytes()
    except (FileNotFoundError, NotADirectoryError):
        return None


def _utf8(data: bytes) -> str | None:
    """The decoded text (BOM dropped, ``\\n`` endings), or None when `data` isn't UTF-8."""
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        return None
    return textfile.decode(data).text


def _stored(data: bytes | None, *, exact: bool = False) -> tuple[str | None, str]:
    """A file's bytes as the ledger keeps them: (text or base64, encoding).

    With `exact` (a removed file, which undo rebuilds with nothing to copy the form from), text
    that can't give back the same bytes as plain ``\\n`` UTF-8 (a BOM, CRLF endings) is kept as
    base64 too, so the undo restores the file byte for byte.
    """
    if data is None:
        return None, "text"
    text = _utf8(data)
    if text is None or (exact and text.encode("utf-8") != data):
        return base64.b64encode(data).decode("ascii"), "base64"
    return text, "text"


def _encode(original: bytes | None, text: str) -> bytes:
    if original is None or _utf8(original) is None:
        return text.encode("utf-8")
    return textfile.encode_like(original, text)


def _skills_root(folder: Path) -> Path:
    return Path(folder) / SKILLS_DIR


def _archive_root(folder: Path) -> Path:
    return Path(folder) / ARCHIVE_DIR


def _valid_name(name: Any) -> bool:
    return isinstance(name, str) and re.fullmatch(SKILL_NAME, name) is not None


def _check_name(name: Any) -> str:
    if not _valid_name(name):
        raise SkillInvalid(NAME_MESSAGE)
    return name


def _plain_dir_name(name: Any) -> bool:
    """A name usable as one folder under the skills or archive folder (no separators, no dots)."""
    return (isinstance(name, str) and bool(name) and name not in (".", "..")
            and not any(c in name for c in "/\\:\0"))


def _active_dir(folder: Path, name: str) -> Path | None:
    if not _plain_dir_name(name):
        return None
    d = _skills_root(folder) / name
    return d if (d / SKILL_FILE).is_file() else None


def _archived_dir(folder: Path, name: str) -> Path | None:
    if not _plain_dir_name(name):
        return None
    d = _archive_root(folder) / name
    return d if (d / SKILL_FILE).is_file() else None


def _require_active(folder: Path, name: str) -> Path:
    d = _active_dir(folder, name)
    if d is None:
        raise SkillNotFound(f"There's no active skill named '{name}'.")
    return d


_ARCHIVE_SUFFIX = re.compile(r" \(\d+\)$")


def _base_name(archived_name: str) -> str:
    return _ARCHIVE_SUFFIX.sub("", archived_name)


def _archived_names(folder: Path) -> list[str]:
    try:
        return sorted(p.name for p in _archive_root(folder).iterdir() if (p / SKILL_FILE).is_file())
    except OSError:
        return []


def _inside(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except (ValueError, OSError):
        return False


def _is_link(path: Path) -> bool:
    try:
        return path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction())
    except OSError:
        return True


def _check_skill_dir(folder: Path, skill_dir: Path) -> None:
    """No write follows a link from the skills folder out of it."""
    root = skill_dir.parent
    if _is_link(skill_dir) or not _inside(skill_dir, root):
        raise SkillInvalid(LINK_MESSAGE)
    if not _inside(root, Path(folder)):
        raise SkillInvalid(LINK_MESSAGE)


_RESERVED = frozenset({"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)),
                       *(f"LPT{i}" for i in range(1, 10))})
_ILLEGAL = re.compile(r'[<>:"|?*\x00-\x1f]')


def safe_support_path(skill_dir: Path, file: str) -> Path:
    """`file`'s path in `skill_dir`: SkillInvalid unless it is under `SUPPORT_DIRS`, with no
    ``..``, drive, root, backslash or reserved device name, and the resolved path (links
    followed) stays inside `skill_dir`."""
    if not isinstance(file, str) or not file or "\\" in file or file.startswith("/") or ":" in file:
        raise SkillInvalid(SUPPORT_PATH_MESSAGE)
    parts = file.split("/")
    if len(parts) < 2 or parts[0] not in SUPPORT_DIRS:
        raise SkillInvalid(SUPPORT_PATH_MESSAGE)
    for part in parts:
        if (not part or part in (".", "..") or _ILLEGAL.search(part) or part != part.rstrip(". ")
                or part.split(".", 1)[0].upper() in _RESERVED):
            raise SkillInvalid(SUPPORT_PATH_MESSAGE)
    skill_dir = Path(skill_dir)
    path = skill_dir.joinpath(*parts)
    current = skill_dir
    for part in parts:
        current = current / part
        if _is_link(current):
            raise SkillInvalid(SUPPORT_PATH_MESSAGE)
    if not _inside(path, skill_dir):
        raise SkillInvalid(SUPPORT_PATH_MESSAGE)
    return path


def _file_path(skill_dir: Path, file: str | None) -> tuple[str, Path]:
    if file is None or file == SKILL_FILE:
        return SKILL_FILE, skill_dir / SKILL_FILE
    return file, safe_support_path(skill_dir, file)


# -- usage.json ------------------------------------------------------------------------------------


def _usage_path(folder: Path) -> Path:
    return Path(folder) / USAGE_FILE


def _read_usage(folder: Path) -> tuple[dict[str, Any], bool]:
    """(usage.json's object, readable). A missing file is an empty, readable one."""
    raw = _read_bytes(_usage_path(folder))
    if raw is None:
        return {}, True
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return {}, False
    return (data, True) if isinstance(data, dict) else ({}, False)


def _skill_usage(usage: dict[str, Any], name: str) -> dict[str, Any]:
    skills = usage.get("skills")
    entry = skills.get(name) if isinstance(skills, dict) else None
    return entry if isinstance(entry, dict) else {}


def _write_usage(folder: Path, usage: dict[str, Any]) -> None:
    usage.setdefault("v", 1)
    path = _usage_path(folder)
    path.parent.mkdir(parents=True, exist_ok=True)
    textfile.atomic_write(path, dump_json(usage))


def _update_usage(folder: Path, change: Callable[[dict[str, Any]], bool], *, strict: bool) -> None:
    """Apply `change` to usage.json's object and write it when `change` answers True. An
    unreadable file is left alone: SkillInvalid when `strict`, else the change is skipped."""
    usage, ok = _read_usage(folder)
    if not ok:
        if strict:
            raise SkillInvalid(USAGE_UNREADABLE_MESSAGE)
        return
    if not isinstance(usage.get("skills"), dict):
        usage["skills"] = {}
    if change(usage):
        _write_usage(folder, usage)


def _entry_for(usage: dict[str, Any], name: str) -> dict[str, Any]:
    entry = usage["skills"].get(name)
    if not isinstance(entry, dict):
        entry = usage["skills"][name] = {"uses": 0, "lastUsed": None, "createdAt": None, "state": "active",
                                         "pinned": False, "archivedAt": None, "absorbedInto": None}
    return entry


# -- reading skills --------------------------------------------------------------------------------


def _front(text: str) -> dict[str, Any] | None:
    """SKILL.md's front matter, or None when it has none or it can't be read."""
    of = split_object(text)
    if not of.fm_ok or of.frontmatter_src is None:
        return None
    try:
        return parse_fm(of.frontmatter_src)
    except FrontmatterError:
        return None


def _files(skill_dir: Path) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    try:
        out.append({"path": SKILL_FILE, "size": (skill_dir / SKILL_FILE).stat().st_size})
    except OSError:
        pass
    for sub in SUPPORT_DIRS:
        base = skill_dir / sub
        if not base.is_dir() or _is_link(base):
            continue
        found = []
        for root, dirs, names in os.walk(base, followlinks=False):
            dirs[:] = [d for d in dirs if not _is_link(Path(root) / d)]
            for n in names:
                p = Path(root) / n
                try:
                    if p.is_file() and not _is_link(p):
                        found.append({"path": p.relative_to(skill_dir).as_posix(), "size": p.stat().st_size})
                except OSError:
                    continue
        out.extend(sorted(found, key=lambda f: f["path"]))
    return out


@dataclass
class SkillInfo:
    name: str
    description: str
    created_by: str
    state: str
    pinned: bool
    uses: int
    last_used: str | None
    created_at: str | None
    absorbed_into: str | None
    files: list[dict[str, Any]] = field(default_factory=list)
    revision: str = ""

    def to_api(self) -> dict[str, Any]:
        """SkillSummary."""
        return {
            "name": self.name, "description": self.description, "createdBy": self.created_by,
            "state": self.state, "pinned": self.pinned, "uses": self.uses, "lastUsed": self.last_used,
            "createdAt": self.created_at, "absorbedInto": self.absorbed_into,
        }


def _int(value: Any) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


def _str_or_none(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _info(name: str, skill_dir: Path, usage: dict[str, Any], archived: bool) -> SkillInfo:
    raw = _read_bytes(skill_dir / SKILL_FILE) or b""
    fm = _front(_utf8(raw) or "") or {}
    description = fm.get("description")
    u = _skill_usage(usage, name)
    state = "archived" if archived else ("stale" if u.get("state") == "stale" else "active")
    return SkillInfo(
        name=name,
        description=description if isinstance(description, str) else "",
        created_by="agent" if fm.get("created_by") == "agent" else "user",
        state=state,
        pinned=u.get("pinned") is True,
        uses=_int(u.get("uses")),
        last_used=_str_or_none(u.get("lastUsed")),
        created_at=_str_or_none(u.get("createdAt")),
        absorbed_into=_str_or_none(u.get("absorbedInto")) if archived else None,
        files=_files(skill_dir),
        revision=_revision(raw),
    )


def _summary(folder: Path, name: str, archived: bool = False) -> dict[str, Any]:
    usage, _ok = _read_usage(folder)
    d = _archived_dir(folder, name) if archived else _active_dir(folder, name)
    if d is None:
        raise SkillNotFound(f"There's no {'archived' if archived else 'active'} skill named '{name}'.")
    return _info(name, d, usage, archived).to_api()


def list_skills(folder: Path, *, archived: bool = False) -> list[SkillInfo]:
    """The active and stale skills, plus the archived ones when `archived`; by name. Never writes."""
    usage, _ok = _read_usage(folder)
    out: list[SkillInfo] = []
    try:
        active = [p for p in _skills_root(folder).iterdir() if (p / SKILL_FILE).is_file()]
    except OSError:
        active = []
    out.extend(_info(p.name, p, usage, False) for p in active)
    if archived:
        out.extend(_info(n, _archive_root(folder) / n, usage, True) for n in _archived_names(folder))
    return sorted(out, key=lambda s: (s.name, s.state == "archived"))


def _bump(folder: Path, name: str, memo_key: str | None) -> None:
    """One use of an active skill (once per memo key), turning a stale skill active."""
    if memo_key is not None and not MEMO._count_use(memo_key, name):
        return

    def change(usage: dict[str, Any]) -> bool:
        entry = _entry_for(usage, name)
        entry["uses"] = _int(entry.get("uses")) + 1
        entry["lastUsed"] = _now()
        if entry.get("state") == "stale":
            entry["state"] = "active"
        return True

    _update_usage(folder, change, strict=False)


def view(folder: Path, name: str, file: str | None = None, *, memo_key: str | None = None,
         bump: bool = True, archived: bool = False) -> dict[str, Any]:
    """``{"name", "file", "text", "revision", "files", "binary"}`` (``text`` None and ``binary``
    True for a file that isn't UTF-8). With `bump` (active skills only): one use per memo key, and
    a stale skill turns active (no ledger line). `memo_key` marks the skill read."""
    with _lock(folder):
        if archived:
            skill_dir = _archived_dir(folder, name)
            if skill_dir is None:
                raise SkillNotFound(f"There's no archived skill named '{name}'.")
        else:
            skill_dir = _require_active(folder, name)
        rel, path = _file_path(skill_dir, file)
        raw = _read_bytes(path) if path.is_file() else None
        if raw is None:
            raise SkillNotFound(f"There's no file {rel} in '{name}'.")
        text = _utf8(raw)
        if not archived:
            if memo_key is not None:
                MEMO.mark_read(memo_key, name)
            if bump:
                _bump(folder, name, memo_key)
        return {"name": name, "file": rel, "text": text, "revision": _revision(raw),
                "files": _files(skill_dir), "binary": text is None}


def record_use(folder: Path, name: str, memo_key: str | None) -> None:
    """The CLI's own ``Skill`` tool loaded `name`: marks it read for the run and records a use."""
    with _lock(folder):
        if _active_dir(folder, name) is None:
            return
        if memo_key is not None:
            MEMO.mark_read(memo_key, name)
        _bump(folder, name, memo_key)


# -- the rules -------------------------------------------------------------------------------------


def _curator_guard(folder: Path, name: str, skill_dir: Path, source: dict[str, Any]) -> None:
    if not isinstance(source, dict) or source.get("kind") != "curator":
        return
    usage, _ok = _read_usage(folder)
    info = _info(name, skill_dir, usage, False)
    if info.pinned or info.created_by != "agent":
        raise SkillInvalid(CURATOR_PROTECTED_MESSAGE)
    try:
        scheduled = SCHEDULE_SKILLS(Path(folder))
    except Exception as exc:  # M21's index can't be read: protect every skill (fail safe)
        raise SkillInvalid(CURATOR_SCHEDULE_MESSAGE) from exc
    if name in scheduled:
        raise SkillInvalid(CURATOR_SCHEDULE_MESSAGE)


def _check_description(description: Any) -> str:
    if not isinstance(description, str) or not description.strip() or len(description) > SKILL_DESCRIPTION_MAX:
        raise SkillInvalid(DESCRIPTION_MESSAGE)
    return description


def _check_skill_md(name: str, text: str, *, check_front: bool) -> None:
    if len(text) > SKILL_MD_MAX:
        raise SkillTooLarge(SKILL_MD_MESSAGE)
    if not check_front:
        return
    fm = _front(text)
    description = fm.get("description") if fm else None
    if fm is None or fm.get("name") != name or not isinstance(description, str) or not description.strip():
        raise SkillInvalid(f"SKILL.md must keep its front matter with name '{name}' and a description.")
    if len(description) > SKILL_DESCRIPTION_MAX:
        raise SkillInvalid(DESCRIPTION_MESSAGE)


def _check_support(text: str) -> None:
    if len(text.encode("utf-8", errors="surrogateescape")) > SUPPORT_FILE_MAX:
        raise SkillTooLarge(SUPPORT_SIZE_MESSAGE)


def _keep_created_by(old_text: str, new_text: str) -> str:
    """`new_text` with ``created_by`` as it was in `old_text` (put back, changed back or dropped)."""
    old = _front(old_text) or {}
    new = _front(new_text)
    if new is None:
        return new_text
    of = split_object(new_text)
    src = of.frontmatter_src or ""
    if "created_by" in old:
        if new.get("created_by") == old["created_by"] and "created_by" in new:
            return new_text
        src = set_keys(src, {"created_by": old["created_by"]})
    elif "created_by" in new:
        src = delete_keys(src, ["created_by"])
    else:
        return new_text
    return join_object(type(of)(src, of.body, of.fm_ok, of.fm_error, of.closing_fence_newline))


def _skill_md_text(name: str, description: str, body: str, created_by: str | None) -> str:
    keys: dict[str, Any] = {"name": name, "description": description}
    if created_by is not None:
        keys["created_by"] = created_by
    body = body.replace("\r\n", "\n")
    return f"---\n{set_keys('', keys)}---\n{body}"


def _taken(folder: Path, name: str) -> bool:
    if (_skills_root(folder) / name).exists():
        return True
    return any(_base_name(n) == name for n in _archived_names(folder))


def _result(folder: Path, entry: dict[str, Any] | None, name: str, archived: bool = False) -> dict[str, Any]:
    return {"ok": True, "entryId": entry["id"] if entry else None, "skill": _summary(folder, name, archived)}


def _log(folder: Path, action: str, name: str, source: dict[str, Any], **fields: Any) -> dict[str, Any]:
    return ledger.append(folder, {"target": "skill", "action": action, "skill": name, "source": source, **fields})


# -- creating --------------------------------------------------------------------------------------


def _create(folder: Path, name: str, description: str, body: str, source: dict[str, Any],
            created_by: str | None) -> dict[str, Any]:
    _check_name(name)
    _check_description(description)
    if not isinstance(body, str):
        body = ""
    text = _skill_md_text(name, description, body, created_by)
    _check_skill_md(name, text, check_front=False)
    if _taken(folder, name):
        raise SkillConflict(f"A skill named '{name}' already exists.")
    root = _skills_root(folder)
    root.mkdir(parents=True, exist_ok=True)
    if not _inside(root, Path(folder)):
        raise SkillInvalid(LINK_MESSAGE)
    skill_dir = root / name
    try:
        skill_dir.mkdir()
    except FileExistsError as exc:
        raise SkillConflict(f"A skill named '{name}' already exists.") from exc
    data = text.encode("utf-8")
    textfile.create_new(skill_dir / SKILL_FILE, data)
    entry = _log(folder, "create", name, source, file=SKILL_FILE, before=None, after=text)

    def change(usage: dict[str, Any]) -> bool:
        item = _entry_for(usage, name)
        item["createdAt"] = entry["at"]
        return True

    _update_usage(folder, change, strict=False)
    return entry


def user_create(folder: Path, name: str, description: str, body: str) -> dict[str, Any]:
    """Gene's new skill (no ``created_by``, so it reads as ``user``): SkillDetail plus ``entryId``."""
    with _lock(folder):
        entry = _create(folder, name, description, body, {"kind": "user"}, None)
        detail = view(folder, name, bump=False)
        return {**_summary(folder, name), "text": detail["text"], "revision": detail["revision"],
                "files": detail["files"], "entryId": entry["id"]}


# -- changing files --------------------------------------------------------------------------------


def _write_text(path: Path, original: bytes | None, text: str) -> bytes:
    data = _encode(original, text)
    path.parent.mkdir(parents=True, exist_ok=True)
    textfile.atomic_write(path, data)
    return data


def _patched(text: str, rel: str, old_string: Any, new_string: Any, replace_all: bool) -> str:
    if not isinstance(old_string, str) or not old_string:
        raise SkillInvalid(f"That text isn't in {rel}.")
    old = old_string.replace("\r\n", "\n")
    new = (new_string if isinstance(new_string, str) else "").replace("\r\n", "\n")
    n = text.count(old)
    if n == 0:
        raise SkillInvalid(f"That text isn't in {rel}.")
    if n > 1 and not replace_all:
        raise SkillInvalid(f"That text is in {rel} {n} times; give more of it or set replace_all.")
    return text.replace(old, new) if replace_all else text.replace(old, new, 1)


def _change_file(folder: Path, name: str, skill_dir: Path, action: str, source: dict[str, Any], *,
                 file: str | None, content: Any = None, old_string: Any = None, new_string: Any = None,
                 replace_all: bool = False) -> dict[str, Any]:
    """patch / edit / write_file / remove_file of one file; the ledger entry."""
    _check_skill_dir(folder, skill_dir)
    if action in ("write_file", "remove_file") and (file is None or file == SKILL_FILE):
        raise SkillInvalid(SUPPORT_PATH_MESSAGE)
    rel, path = _file_path(skill_dir, file)
    original = _read_bytes(path) if path.is_file() else None
    if action == "remove_file":
        if original is None:
            raise SkillNotFound(f"There's no file {rel} in '{name}'.")
        before, encoding = _stored(original, exact=True)
        textfile.retry_os(lambda: os.unlink(path))
        return _log(folder, action, name, source, file=rel, before=before, after=None, encoding=encoding)
    if action == "write_file":
        if not isinstance(content, str):
            raise SkillInvalid("Give the file's content.")
        new_text = content.replace("\r\n", "\n")
        _check_support(new_text)
        before, encoding = _stored(original)
        if encoding == "base64":
            original = None
    else:
        if original is None:
            raise SkillNotFound(f"There's no file {rel} in '{name}'.")
        old_text = _utf8(original)
        if old_text is None:
            raise SkillInvalid(NOT_TEXT_MESSAGE)
        before, encoding = old_text, "text"
        if action == "patch":
            new_text = _patched(old_text, rel, old_string, new_string, replace_all)
        else:
            if not isinstance(content, str):
                raise SkillInvalid("Give the file's content.")
            new_text = content.replace("\r\n", "\n")
        if rel == SKILL_FILE:
            new_text = _keep_created_by(old_text, new_text)
            _check_skill_md(name, new_text, check_front=True)
        else:
            _check_support(new_text)
    data = _write_text(path, original, new_text)
    after = textfile.decode(data).text
    return _log(folder, action, name, source, file=rel, before=before, after=after, encoding=encoding)


def user_write(folder: Path, name: str, file: str, text: str, base_revision: str | None) -> dict[str, Any]:
    """Gene's save of one file of an active skill: ``{"revision", "entryId"}``. 409
    (`SkillConflict` with ``current_revision``) when `base_revision` isn't the file's revision
    (None: the file doesn't exist). Limits and paths are checked; the front matter isn't."""
    with _lock(folder):
        skill_dir = _require_active(folder, name)
        _check_skill_dir(folder, skill_dir)
        rel, path = _file_path(skill_dir, file)
        original = _read_bytes(path) if path.is_file() else None
        current = _revision(original) if original is not None else None
        if base_revision != current:
            raise SkillConflict(STALE_FILE_MESSAGE, current)
        if not isinstance(text, str):
            raise SkillInvalid("Give the file's content.")
        new_text = text.replace("\r\n", "\n")
        if rel == SKILL_FILE:
            _check_skill_md(name, new_text, check_front=False)
        else:
            _check_support(new_text)
        before, encoding = _stored(original)
        data = _write_text(path, original if encoding == "text" else None, new_text)
        entry = _log(folder, "edit" if rel == SKILL_FILE else "write_file", name, {"kind": "user"},
                     file=rel, before=before, after=textfile.decode(data).text, encoding=encoding)
        return {"revision": _revision(data), "entryId": entry["id"]}


# -- archive, restore, pin, state ------------------------------------------------------------------


def _move_usage(usage: dict[str, Any], old: str, new: str) -> dict[str, Any]:
    entry = usage["skills"].pop(old, None)
    if not isinstance(entry, dict):
        entry = {}
    usage["skills"][new] = entry
    return entry


def _do_archive(folder: Path, name: str, absorbed_into: str | None) -> str:
    """Move the active skill `name` into the archive; the archive folder's name."""
    skill_dir = _require_active(folder, name)
    root = _archive_root(folder)
    root.mkdir(parents=True, exist_ok=True)
    if not _inside(root, Path(folder)):
        raise SkillInvalid(LINK_MESSAGE)
    n = 1
    while True:
        archived = safe_filename(name if n == 1 else f"{name} ({n})")
        dest = root / archived
        if not dest.exists():
            try:
                textfile.move_no_overwrite(skill_dir, dest)
                break
            except FileExistsError:
                pass
        n += 1
    at = _now()

    def change(usage: dict[str, Any]) -> bool:
        entry = _move_usage(usage, name, archived)
        entry["archivedAt"] = at
        entry["absorbedInto"] = absorbed_into
        return True

    _update_usage(folder, change, strict=False)
    return archived


def _do_restore(folder: Path, archived: str) -> str:
    """Move the archived skill `archived` back; the active name. 409 when that name is active."""
    skill_dir = _archived_dir(folder, archived)
    if skill_dir is None:
        raise SkillNotFound(f"There's no archived skill named '{archived}'.")
    name = _base_name(archived)
    dest = _skills_root(folder) / name
    if dest.exists():
        raise SkillConflict(RESTORE_TAKEN_MESSAGE)
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        textfile.move_no_overwrite(skill_dir, dest)
    except FileExistsError as exc:
        raise SkillConflict(RESTORE_TAKEN_MESSAGE) from exc

    def change(usage: dict[str, Any]) -> bool:
        entry = _move_usage(usage, archived, name)
        entry["archivedAt"] = None
        entry["absorbedInto"] = None
        return True

    _update_usage(folder, change, strict=False)
    return name


def _skill_md_of(skill_dir: Path) -> str | None:
    return _utf8(_read_bytes(skill_dir / SKILL_FILE) or b"")


def archive(folder: Path, name: str, *, source: dict[str, Any], absorbed_into: str | None = None) -> dict[str, Any]:
    """Move an active skill to the archive: ``{"ok", "entryId", "skill"}`` (the archived
    SkillSummary). The ledger keeps SKILL.md's text as ``before`` and ``archivedAs``."""
    with _lock(folder):
        skill_dir = _require_active(folder, name)
        _curator_guard(folder, name, skill_dir, source)
        if absorbed_into is not None and (absorbed_into == name or _active_dir(folder, absorbed_into) is None):
            raise SkillInvalid(f"There's no active skill named '{absorbed_into}'.")
        before = _skill_md_of(skill_dir)
        archived = _do_archive(folder, name, absorbed_into)
        entry = _log(folder, "archive", name, source, file=SKILL_FILE, before=before, after=None,
                     absorbedInto=absorbed_into, archivedAs=archived)
        return _result(folder, entry, archived, archived=True)


def restore(folder: Path, name: str, *, source: dict[str, Any]) -> dict[str, Any]:
    """Move the archived skill `name` (its archive folder's name) back: ``{"ok", "entryId",
    "skill"}``; 409 "A skill with this name is active." when its name is taken."""
    with _lock(folder):
        active = _do_restore(folder, name)
        after = _skill_md_of(_skills_root(folder) / active)
        entry = _log(folder, "restore", active, source, file=SKILL_FILE, before=None, after=after,
                     archivedAs=name)
        return _result(folder, entry, active)


def set_pinned(folder: Path, name: str, pinned: bool, *, source: dict[str, Any]) -> dict[str, Any]:
    """Pin or unpin an active skill (``usage.json``; one ledger line, none when unchanged)."""
    with _lock(folder):
        _require_active(folder, name)
        usage, _ok = _read_usage(folder)
        if (_skill_usage(usage, name).get("pinned") is True) == bool(pinned):
            return _result(folder, None, name)

        def change(u: dict[str, Any]) -> bool:
            _entry_for(u, name)["pinned"] = bool(pinned)
            return True

        _update_usage(folder, change, strict=True)
        entry = _log(folder, "pin" if pinned else "unpin", name, source)
        return _result(folder, entry, name)


def set_state(folder: Path, name: str, state: str, *, source: dict[str, Any]) -> dict[str, Any]:
    """Mark an active skill ``stale`` or ``active`` (``usage.json``; one ledger line, none when
    unchanged). The curator's pass decides which skills it may mark."""
    if state not in ("stale", "active"):
        raise SkillInvalid("A skill's state is stale or active.")
    with _lock(folder):
        _require_active(folder, name)
        usage, _ok = _read_usage(folder)
        current = "stale" if _skill_usage(usage, name).get("state") == "stale" else "active"
        if current == state:
            return _result(folder, None, name)

        def change(u: dict[str, Any]) -> bool:
            _entry_for(u, name)["state"] = state
            return True

        _update_usage(folder, change, strict=True)
        entry = _log(folder, state, name, source)
        return _result(folder, entry, name)


# -- skill_manage ----------------------------------------------------------------------------------


def manage(folder: Path, action: str, *, name: str, source: dict[str, Any], memo_key: str | None,
           description: str | None = None, content: str | None = None, old_string: str | None = None,
           new_string: str | None = None, replace_all: bool = False, file: str | None = None,
           absorbed_into: str | None = None) -> dict[str, Any]:
    """``skill_manage``: ``{"ok": True, "entryId", "skill": SkillSummary}``; every rule of the
    Contract's table, raised as a `SkillError`. There is no delete."""
    if action not in ACTIONS:
        raise SkillInvalid("The skill actions are create, patch, edit, write_file, remove_file and archive.")
    _check_name(name)
    with _lock(folder):
        if action == "create":
            entry = _create(folder, name, description or "", content or "", source, "agent")
            if memo_key is not None:
                MEMO.mark_read(memo_key, name)
            return _result(folder, entry, name)
        if action == "archive":
            out = archive(folder, name, source=source, absorbed_into=absorbed_into)
            return out
        skill_dir = _require_active(folder, name)
        _curator_guard(folder, name, skill_dir, source)
        if action in ("patch", "edit") and (memo_key is None or not MEMO.was_read(memo_key, name)):
            raise SkillInvalid(READ_FIRST_MESSAGE)
        entry = _change_file(folder, name, skill_dir, action, source, file=file, content=content,
                             old_string=old_string, new_string=new_string, replace_all=bool(replace_all))
        return _result(folder, entry, name)
