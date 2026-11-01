"""The spaces registry (``<state dir>/spaces.json``) and creating a new space.

The registry lists the space folders this device has opened, in the order they
were first registered, with when each was last opened::

    {"spaces": [{"path": "...", "lastOpened": "2026-10-27T09:00:00Z"}], "lastOpened": "..."}

It holds no user content: an unreadable file reads as empty and is replaced on
the next write. Reading never writes. Removing a space only drops it from the
list; its folder is never touched. `create_space` makes a new folder holding only
``.capacities/space.json`` (plus, for M8's basic setup, four type files) and refuses
a folder that already exists.

M8 `delete_space` deletes a space folder that is not the current one: to the OS
trash through `send2trash` (``OBJECT_FAKE_TRASH_FILE`` replaces the trash in
tests), or, after the trash proved unavailable (428) and the user confirmed,
permanently, re-checking first that it is still the same folder. Either way the
entry leaves the registry; nothing in the state dir is deleted.
"""

from __future__ import annotations

import json
import os
import shutil
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .appstate import state_dir
from .jsonstore import dump_json
from .space import safe_filename
from .spaceconfig import MAX_NAME_LENGTH, space_fields
from .textfile import atomic_write

__all__ = [
    "FAKE_TRASH_ENV",
    "REGISTRY_FILE",
    "Registry",
    "SpaceEntry",
    "SpaceFolderChanged",
    "SpaceIsCurrent",
    "SpaceNameProblem",
    "SpaceNotFound",
    "TrashUnavailable",
    "create_space",
    "delete_space",
    "folder_token",
    "normalize",
]

FAKE_TRASH_ENV = "OBJECT_FAKE_TRASH_FILE"

REGISTRY_FILE = "spaces.json"

_lock = threading.RLock()


class SpaceNameProblem(ValueError):
    """A new space's name is empty or too long (422)."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


@dataclass
class SpaceEntry:
    path: str
    name: str
    icon: str | None
    current: bool
    missing: bool
    lastOpened: str | None


# No file system takes a name component longer than this (NTFS: 255 UTF-16 units,
# ext4/APFS: 255 bytes), so a longer one can only be malformed input.
_MAX_COMPONENT_BYTES = 255


def normalize(path: Path | str) -> Path:
    """The absolute, resolved form of `path` (``~`` expanded) the registry stores.

    Raises `ValueError` (the routes answer 404 "Not a folder") for a path no file
    system can hold: one with a NUL byte (`Path.resolve` raises that itself on
    POSIX, not on Windows) or an over-long name component (`os.stat` would raise
    ``ENAMETOOLONG``, which the routes must not report as a file-system failure).
    """
    text = os.path.expanduser(str(path))
    if "\x00" in text:
        raise ValueError(f"embedded null character in path: {text!r}")
    if any(len(part.encode("utf-8")) > _MAX_COMPONENT_BYTES for part in text.replace("\\", "/").split("/")):
        raise ValueError(f"path component too long: {text[:60]!r}")
    return Path(text).resolve()


def _key(path: Path | str) -> str:
    """A comparison key: case-insensitive where the file system is (Windows)."""
    return os.path.normcase(str(path))


def _iso(now: datetime | str | None) -> str:
    if isinstance(now, str):
        return now
    moment = now or datetime.now(UTC)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


class Registry:
    """``<state_dir>/spaces.json``. Created lazily, by `register` and `remove` only."""

    def __init__(self, state_dir: Path) -> None:
        self.state_dir = Path(state_dir)
        self.path = self.state_dir / REGISTRY_FILE

    # -- reading (never writes) -------------------------------------------------

    def _load(self) -> dict[str, Any]:
        """``{"spaces": [{path, lastOpened}], "lastOpened": str | None}``; empty when unreadable."""
        try:
            data = json.loads(self.path.read_bytes().decode("utf-8"))
        except (OSError, ValueError, UnicodeDecodeError):
            return {"spaces": [], "lastOpened": None}
        if not isinstance(data, dict):
            return {"spaces": [], "lastOpened": None}
        spaces: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in data.get("spaces") or []:
            if not isinstance(item, dict) or not isinstance(item.get("path"), str):
                continue
            if not item["path"] or _key(item["path"]) in seen:
                continue
            seen.add(_key(item["path"]))
            opened = item.get("lastOpened")
            spaces.append(
                {"path": item["path"], "lastOpened": opened if isinstance(opened, str) else None}
            )
        last = data.get("lastOpened")
        return {"spaces": spaces, "lastOpened": last if isinstance(last, str) and last else None}

    def _save(self, data: dict[str, Any]) -> None:
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self._keep_unreadable()
        atomic_write(self.path, dump_json(data))

    def _keep_unreadable(self) -> None:
        """Copy a registry file `_load` couldn't parse aside, so a save never loses it.

        It may be a hand edit gone wrong; the user's list of spaces is in it.
        A file that can't even be opened (locked) raises instead of being replaced.
        """
        try:
            raw = self.path.read_bytes()
        except FileNotFoundError:
            return
        try:
            if isinstance(json.loads(raw.decode("utf-8")), dict):
                return
        except (ValueError, UnicodeDecodeError):
            pass
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S")
        aside = self.state_dir / f"spaces.unreadable-{stamp}.json"
        n = 2
        while aside.exists():
            aside = self.state_dir / f"spaces.unreadable-{stamp}-{n}.json"
            n += 1
        atomic_write(aside, raw)

    def list(self, current: Path | str | None = None) -> list[SpaceEntry]:
        """Every registered space in registry order, `current` flagged (and listed even if unregistered)."""
        data = self._load()
        items = list(data["spaces"])
        current_key = _key(normalize(current)) if current is not None else None
        if current_key is not None and all(_key(i["path"]) != current_key for i in items):
            items.append({"path": str(normalize(current)), "lastOpened": None})
        out: list[SpaceEntry] = []
        for item in items:
            root = Path(item["path"])
            missing = not root.is_dir()
            fields = space_fields(root) if not missing else None
            out.append(
                SpaceEntry(
                    path=item["path"],
                    name=fields["name"] if fields else root.name or item["path"],
                    icon=fields["icon"] if fields else None,
                    current=current_key is not None and _key(item["path"]) == current_key,
                    missing=missing,
                    lastOpened=item["lastOpened"],
                )
            )
        return out

    def last_opened(self) -> Path | None:
        """The space opened most recently, or None (whether or not its folder still exists)."""
        last = self._load()["lastOpened"]
        return Path(last) if last else None

    # -- writing ----------------------------------------------------------------

    def register(
        self, path: Path | str, now: datetime | str | None = None, *, touch: bool = True
    ) -> None:
        """Add `path` (or refresh its ``lastOpened``) and make it the registry's ``lastOpened``.

        ``touch=False`` only adds the entry (with no ``lastOpened``) when it is not
        listed yet: nothing was opened, so neither timestamp moves.
        """
        root = str(normalize(path))
        stamp = _iso(now) if touch else None
        with _lock:
            data = self._load()
            for item in data["spaces"]:
                if _key(item["path"]) == _key(root):
                    if not touch:
                        return
                    item["lastOpened"] = stamp
                    break
            else:
                data["spaces"].append({"path": root, "lastOpened": stamp})
            if touch:
                data["lastOpened"] = root
            self._save(data)

    def remove(self, path: Path | str) -> None:
        """Drop `path` from the list. Its folder is left exactly as it is."""
        key = _key(normalize(path))
        with _lock:
            data = self._load()
            kept = [i for i in data["spaces"] if _key(i["path"]) != key]
            last = data["lastOpened"]
            if len(kept) == len(data["spaces"]) and not (last and _key(last) == key):
                return
            data["spaces"] = kept
            if last and _key(last) == key:
                data["lastOpened"] = None
            self._save(data)


def create_space(name: str, location: Path | str, setup: str = "blank") -> Path:
    """Create ``<location>/<safe_filename(name)>`` holding only ``.capacities/space.json``.

    `setup` is M8's "How do you want to start?": ``'blank'`` is the behaviour above;
    ``'basic'`` also writes the Person, Meeting, Project and Book types
    (``.capacities/types/{person,meeting,project,book}.json``, see `basicsetup`).

    Raises `SpaceNameProblem` (422) for an empty or over-long name,
    `NotADirectoryError` (404) when `location` is not an existing folder,
    `FileExistsError` (409) when the target already exists (it is not touched) and
    `ValueError` for an unknown `setup` (checked before anything is made).
    """
    if setup not in ("blank", "basic"):
        raise ValueError(f"Unknown space setup: {setup!r}")
    if not isinstance(name, str) or not name.strip():
        raise SpaceNameProblem("A space needs a name.")
    name = name.strip()
    if len(name) > MAX_NAME_LENGTH:
        raise SpaceNameProblem(f"A space name can have at most {MAX_NAME_LENGTH} characters.")
    try:
        parent = normalize(location)
        if not parent.is_dir():
            raise NotADirectoryError(f"Not a folder: {parent}")
    except ValueError as exc:  # a NUL, or a component too long for any file system
        raise NotADirectoryError(f"Not a folder: {str(location)[:60]!r}") from exc
    target = parent / safe_filename(name)
    target.mkdir()  # FileExistsError when anything is already there
    (target / ".capacities").mkdir()
    atomic_write(target / ".capacities" / "space.json", dump_json({"name": name}))
    if setup == "basic":
        from .basicsetup import write_basic_types

        write_basic_types(target)
    return target


# -- deleting a space folder (M8) ---------------------------------------------------


class SpaceNotFound(LookupError):
    """Not a registered space folder holding ``.capacities/`` (404)."""


class SpaceIsCurrent(Exception):
    """The folder is (or holds, or lies inside) the space that is open (409)."""


class TrashUnavailable(Exception):
    """The OS trash could not take the folder (428: offer the permanent delete).

    `folder` is the folder's identity token (`folder_token`), sent back with the
    permanent delete so it can refuse a folder that was replaced in between.
    """

    def __init__(self, message: str = "", folder: str | None = None) -> None:
        super().__init__(message)
        self.folder = folder


class SpaceFolderChanged(Exception):
    """The folder is not the one the 428 described (another device/inode): 409."""


def _identity(path: Path) -> tuple[int, int]:
    st = os.stat(path, follow_symlinks=False)
    return (st.st_dev, st.st_ino)


def folder_token(path: Path) -> str:
    """The folder's identity as a string token: ``<st_dev>:<st_ino>``."""
    dev, ino = _identity(path)
    return f"{dev}:{ino}"


def _is_space_folder(path: Path) -> bool:
    try:
        return (
            path.is_dir()
            and not path.is_symlink()
            and (path / ".capacities").is_dir()
            and not (path / ".capacities").is_symlink()
        )
    except OSError:  # a path the OS can't even stat (too long) is no space folder
        return False


def _within(child: Path, parent: Path) -> bool:
    c, p = _key(child), _key(parent)
    return c == p or c.startswith(p.rstrip(os.sep) + os.sep)


def _move_to_trash(path: Path) -> None:
    """Send `path` to the OS trash; `TrashUnavailable` when that is not possible.

    With ``OBJECT_FAKE_TRASH_FILE`` set (tests), the path is appended to that file
    and the folder moved into ``<state dir>/fake-trash/`` instead; the value
    ``unavailable`` behaves as an unavailable trash.
    """
    fake = os.environ.get(FAKE_TRASH_ENV)
    if fake:
        if fake == "unavailable":
            raise TrashUnavailable("The trash is not available.")
        bin_dir = state_dir() / "fake-trash"
        bin_dir.mkdir(parents=True, exist_ok=True)
        dest, n = bin_dir / path.name, 2
        while dest.exists():
            dest, n = bin_dir / f"{path.name}-{n}", n + 1
        shutil.move(str(path), str(dest))
        with open(fake, "a", encoding="utf-8") as fh:
            fh.write(str(path) + "\n")
        return
    from send2trash import send2trash
    from send2trash.exceptions import TrashPermissionError

    try:
        send2trash(str(path))
    except TrashPermissionError as exc:
        raise TrashUnavailable(str(exc) or "The trash is not available.") from exc
    except FileNotFoundError:
        raise
    except OSError as exc:
        if path.exists():  # nothing (or only part) was moved: the trash can't take it
            raise TrashUnavailable(str(exc) or "The trash is not available.") from exc
        raise


def _before_permanent_delete(path: Path) -> None:
    """Test seam: runs between the first check and the re-check of a permanent delete."""


def delete_space(
    path: Path | str,
    permanent: bool = False,
    *,
    current: Path | str | None = None,
    registry: Registry | None = None,
    folder: str | None = None,
) -> bool:
    """Delete the registered space folder `path`. Returns True when it went to the trash.

    Refuses (`SpaceIsCurrent`, 409) the `current` space, a folder holding it and a
    folder inside it; refuses (`SpaceNotFound`, 404) a folder that is not in the
    registry or does not hold ``.capacities/``. By default the folder goes to the OS
    trash (`TrashUnavailable`, 428, when it can't, and nothing changes). With
    `permanent` it is removed for good after re-checking that it is still the same
    folder (device and inode/file id) and still holds ``.capacities/``. The entry
    then leaves the registry; nothing in the state dir is deleted.

    The 428 carries the folder's identity token (`TrashUnavailable.folder`); a
    permanent delete given that token (`folder`) refuses (`SpaceFolderChanged`, 409)
    when the folder at `path` is no longer the one the 428 described.
    """
    reg = registry or Registry(state_dir())
    if not isinstance(path, (str, Path)) or not str(path).strip():
        raise SpaceNotFound("No space given.")
    try:
        target = normalize(path)
    except ValueError as exc:
        raise SpaceNotFound(f"Not a space folder: {str(path)[:60]!r}") from exc
    if current is not None:
        cur = normalize(current)
        if _within(cur, target) or _within(target, cur):
            raise SpaceIsCurrent("This space is open. Switch to another space first.")
    registered = {_key(i["path"]) for i in reg._load()["spaces"]}
    if _key(target) not in registered or not _is_space_folder(target):
        raise SpaceNotFound(f"Not a space folder: {target}")
    if not permanent:
        try:
            _move_to_trash(target)
        except TrashUnavailable as exc:
            try:
                exc.folder = folder_token(target)
            except OSError:
                exc.folder = None
            raise
        reg.remove(target)
        return True
    before = _identity(target)
    if folder is not None and folder != f"{before[0]}:{before[1]}":
        raise SpaceFolderChanged(
            f"The folder was replaced since the trash failed; nothing was deleted: {target}"
        )
    _before_permanent_delete(target)
    try:
        same = _is_space_folder(target) and _identity(target) == before
    except OSError:
        same = False
    if not same:
        raise SpaceNotFound(f"The folder changed; nothing was deleted: {target}")
    shutil.rmtree(target)
    reg.remove(target)
    return False
