"""Whiteboards on disk: the Whiteboard type, reading and saving a board's sidecar files.

A whiteboard is an object of the basic Whiteboard type (``Whiteboards/<Title>.md``) with two
sidecars beside it: ``<stem>.whiteboard.json`` (the canvas) and ``<stem>.ink.svg`` (the ink).

- Reading never writes: a missing sidecar reads as the empty board (or no strokes) with
  revision ``''``; no file is created until the first save.
- A save writes one sidecar: validated first, then, under ``space._lock``, checked against
  the revision the client edited (``''`` = the file must not exist yet), refused when the
  existing file can't be read (or is from a newer version), and written atomically (a create
  through `create_new`, an update through `atomic_write` that re-checks the revision right
  before the replace). The write is recorded in ``space.own_writes`` so the watcher stays
  quiet.
- M9 (Gene reversed M6's "never the ``.md``"): after the sidecar, the save stamps the ``.md``'s
  ``lastUpdated`` through `Space.touch`: only that line, at most once a minute, with no
  version-history snapshot (both our choice). ``lastUpdated`` is component-level and
  the canvas is component data.

Revisions are the sha256 of the file's bytes (`space.version_of`).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .space import Conflict, version_of
from .textfile import atomic_write, create_new
from .typemodel import TypeDefinition, type_revision
from .whiteboardfile import (
    BoardInvalid,
    board_rel,
    dump_board,
    empty_board,
    encode_like_sidecar,
    ink_rel,
    load_board,
    validate_board,
)
from .whiteboardink import InkInvalid, dump_ink, load_ink, validate_strokes

if TYPE_CHECKING:
    from .space import Space

__all__ = [
    "WHITEBOARD_TYPE_ID",
    "WHITEBOARD_UI_KEYS",
    "BoardConflict",
    "BoardInvalid",
    "BoardReadOnly",
    "InkInvalid",
    "NotAWhiteboard",
    "Saved",
    "create_whiteboard",
    "ensure_whiteboard_type",
    "is_whiteboard",
    "read_board",
    "read_ink",
    "save_board",
    "save_ink",
    "whiteboard_type",
    "whiteboard_type_json",
    "whiteboard_ui_problem",
]

WHITEBOARD_TYPE_ID = "whiteboard"

# User-level whiteboard settings, stored in ui.json.
WHITEBOARD_UI_KEYS = (
    "isSnappingToGrid",
    "isSnappingToNodes",
    "isShowingDots",
    "isZoomingOnScroll",
    "isEngineeringMode",
)

# Our string.
_UI_PROBLEM = "whiteboard must be an object of true/false settings."


class NotAWhiteboard(Exception):
    """The object exists but isn't of the Whiteboard type (422)."""


class BoardConflict(Exception):
    """The sidecar isn't at the revision the client edited (409)."""

    def __init__(self, current_revision: str) -> None:
        super().__init__(current_revision)
        self.current_revision = current_revision


class BoardReadOnly(Exception):
    """The existing sidecar can't be read (or is from a newer version), so it is never rewritten (423)."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


# --- the type ------------------------------------------------------------------------------


def _system_prop(
    pid: str, kind: str, name: str, description: str, icon: str, **options: Any
):
    return {
        "id": pid,
        "key": pid,
        "name": name,
        "type": kind,
        "description": description,
        "icon": {"type": "iconify", "val": icon},
        "visibility": "alwaysShow",
        "options": dict(options),
    }


def whiteboard_type_json() -> dict[str, Any]:
    """The basic Whiteboard type (``RootWhiteboard``) as type JSON.

    Name "Whiteboard", plural "Whiteboards", icon ``ph-presentation``, colour ``gray`` (our
    name for ``neutral``), full width (``wideLayoutMode``: "The canvas owns the
    page"); its properties are the system ones ``RootWhiteboard`` lists (title, description,
    icon, tags, last updated, created at). The Canvas and Notes are the sidecar and the body.
    """
    return {
        "schemaVersion": 2,
        "id": WHITEBOARD_TYPE_ID,
        "name": "Whiteboard",
        "pluralName": "Whiteboards",
        "folder": "Whiteboards",
        "formerNames": [],
        "icon": {"type": "iconify", "val": "ph-presentation"},
        "color": "gray",
        "description": "",
        "basic": True,
        "collectionsPropertyPosition": 0,
        "viewDesign": None,
        "font": "sans-serif",
        "wideLayoutMode": True,
        "wideCoverImage": False,
        "cropCoverImage": True,
        "templates": {"ids": [], "defaultTemplateId": None},
        "propertyDefinitions": [
            _system_prop(
                "title", "entity_title", "Title",
                "The title serves as the main identifier for any entry", "ph-text-t",
            ),
            _system_prop(
                "description", "entity_description", "Description",
                "Additional information to further describe an item", "ph-info",
            ),
            _system_prop(
                "icon", "entity_icon", "Icon", "A quick visual identifier", "ph-smiley"
            ),
            _system_prop(
                "tags", "entity_tags", "Tags", "General tags of this content", "ph-tag",
                isArray=True, allowedTypes=["tag"],
            ),
            _system_prop(
                "lastUpdated", "entity_lastUpdated", "Last updated",
                "Date and time of last edit", "ph-clock-clockwise",
            ),
            _system_prop(
                "createdAt", "entity_createdAt", "Created at", "Date and time of creation",
                "ph-calendar-blank",
            ),
        ],
    }  # fmt: skip


def whiteboard_type(space: Space) -> TypeDefinition | None:
    """The space's Whiteboard type (matched by name, case-insensitively; stored or inferred)."""
    return next((t for t in space.types if t.name.lower() == "whiteboard"), None)


def ensure_whiteboard_type(space: Space) -> TypeDefinition:
    """The Whiteboard type; a space without one gets the basic one in memory. Never writes.

    An inferred-only Whiteboard type (files of type 'Whiteboard' but no type JSON yet) is
    replaced in memory by the basic definition with the same id and folder, so the JSON that
    M2's lazy persist writes on the first create is the basic type, not a bare inferred one.
    """
    with space._lock:
        t = whiteboard_type(space)
        if t is not None:
            if t.readOnlyReason or type_revision(space.root, t.id):
                return t
            data = whiteboard_type_json()
            data["id"] = t.id
            data["folder"] = t.folder or data["folder"]
            basic = TypeDefinition.from_json(data)
            space.types = [basic if x is t else x for x in space.types]
            space._types_changed(basic.id)
            return basic
        t = TypeDefinition.from_json(whiteboard_type_json())
        space.types.append(t)
        space._types_changed(t.id)
        return t


def is_whiteboard(space: Space, path: str) -> bool:
    """True when ``path`` is a known object of the Whiteboard type."""
    t = whiteboard_type(space)
    if t is None:
        return False
    try:
        return space.get(path).type == t.id
    except (KeyError, ValueError):
        return False


def _board_md(space: Space, path: str) -> str:
    """The board's ``.md`` path: 400 (`ValueError`), 404 (`KeyError`), 422 (`NotAWhiteboard`)."""
    rel = space._rel(path)
    summary = space.get(rel)  # KeyError: no such object
    if not (space.root / rel).is_file():
        raise KeyError(rel)
    t = whiteboard_type(space)
    if t is None or summary.type != t.id:
        raise NotAWhiteboard(f"{rel} isn't a whiteboard.")
    return rel


def _board_md_or_sidecar(space: Space, path: str) -> tuple[str, str | None]:
    """`_board_md`, but an object that isn't typed Whiteboard yet has ``<stem>.whiteboard.json``
    beside it is served read-only: ``(rel, reason)``, `reason` None for a real whiteboard.

    A board whose ``.md`` has malformed (or no) frontmatter reads as a plain, untyped
    object; its canvas is intact and must still open (audit 2026-11-01), only not be
    edited until the ``.md`` is repaired.
    """
    try:
        return _board_md(space, path), None
    except NotAWhiteboard:
        rel = space._rel(path)
        if not (space.root / board_rel(rel)).is_file():
            raise
        summary = space.get(rel)
        if summary.readOnlyReason:
            return rel, f"The whiteboard opens read-only: {summary.readOnlyReason}"
        return rel, f"{rel} isn't typed Whiteboard, so its board opens read-only."


def _read_bytes(full: Path) -> bytes | None:
    try:
        return full.read_bytes()
    except FileNotFoundError:
        return None


# --- reading -------------------------------------------------------------------------------


def read_board(space: Space, path: str) -> dict[str, Any]:
    """``BoardResponse``: ``{path, board, revision, readOnlyReason?}``. Writes nothing."""
    with space._lock:
        rel, md_reason = _board_md_or_sidecar(space, path)
        data = _read_bytes(space.root / board_rel(rel))
    if data is None:
        return {"path": rel, "board": empty_board(), "revision": ""}
    board, reason = load_board(data)
    out: dict[str, Any] = {"path": rel, "board": board, "revision": version_of(data)}
    if reason or md_reason:
        out["readOnlyReason"] = reason or md_reason
    return out


def read_ink(space: Space, path: str) -> dict[str, Any]:
    """``InkResponse``: ``{path, strokes, revision, readOnlyReason?}``. Writes nothing."""
    with space._lock:
        rel, md_reason = _board_md_or_sidecar(space, path)
        data = _read_bytes(space.root / ink_rel(rel))
    if data is None:
        out: dict[str, Any] = {"path": rel, "strokes": [], "revision": ""}
        if md_reason:
            out["readOnlyReason"] = md_reason
        return out
    strokes, reason = load_ink(data)
    out = {
        "path": rel,
        "strokes": strokes,
        "revision": version_of(data),
    }
    if reason or md_reason:
        out["readOnlyReason"] = reason or md_reason
    return out


# --- saving --------------------------------------------------------------------------------


def _save_sidecar(
    space: Space,
    sidecar: str,
    data: bytes,
    base_revision: str,
    unreadable,
) -> str:
    """Write ``data`` to the sidecar ``sidecar`` (space-relative) if it is at ``base_revision``.

    ``unreadable(bytes) -> str | None`` gives the read-only reason of the existing file.
    Call with ``space._lock`` held.
    """
    full = space.root / sidecar
    current = _read_bytes(full)
    if current is not None:
        reason = unreadable(current)
        if reason:
            raise BoardReadOnly(reason)
    data = encode_like_sidecar(current, data)  # keep the file's BOM and CRLF
    current_rev = version_of(current) if current is not None else ""
    if current_rev != base_revision:
        raise BoardConflict(current_rev)
    new_rev = version_of(data)
    previous = space.own_writes.get(sidecar)
    space.own_writes[sidecar] = new_rev

    def forget() -> None:
        if space.own_writes.get(sidecar) == new_rev:
            if previous is None:
                del space.own_writes[sidecar]
            else:
                space.own_writes[sidecar] = previous

    try:
        if base_revision == "":
            try:
                create_new(full, data)
            except FileExistsError:
                raise BoardConflict(version_of(_read_bytes(full) or b"")) from None
        else:

            def unchanged_on_disk() -> None:
                # An external write since the read above surfaces as a conflict.
                now = _read_bytes(full)
                now_rev = version_of(now) if now is not None else ""
                if now_rev != base_revision:
                    raise BoardConflict(now_rev)

            if current is not None and current != data:
                space._call_before_write(sidecar, current)  # M8 version history
            atomic_write(full, data, check=unchanged_on_disk)
    except BaseException:
        forget()
        raise
    return new_rev


@dataclass(frozen=True)
class Saved:
    """A board or ink save: the sidecar's new revision and the board ``.md``'s stamp."""

    revision: str
    md_version: str | None
    """The ``.md``'s version after the ``lastUpdated`` stamp; None when nothing was written."""
    md_base_version: str | None
    """The ``.md``'s version on disk the stamp started from; None when nothing was written."""

    @property
    def md_bumped(self) -> bool:
        return self.md_version is not None


def _touch_md(space: Space, rel: str) -> tuple[str | None, str | None]:
    """Stamp the board ``.md``'s ``lastUpdated`` (`Space.touch`); ``(version, base)``.

    Both are None unless the stamp wrote the disk: ``base`` is the version it started
    from, so a client adopts ``version`` only when it holds ``base`` (a body change it
    hasn't loaded must still meet a 409). Call with ``space._lock`` held, after the
    sidecar is saved: a stamp that fails (the ``.md`` locked, or changed on disk
    meanwhile) never fails the save.
    """
    try:
        base, version = space.touch(rel, space.clock())
    except (Conflict, KeyError, OSError):
        return None, None
    if version == base:
        return None, None
    return version, base


def save_board(space: Space, path: str, board: Any, base_revision: str) -> Saved:
    """Save the board JSON beside the whiteboard's ``.md``, then stamp the ``.md``.

    Raises `BoardInvalid` (422), `BoardConflict` (409), `BoardReadOnly` (423), `KeyError`
    (404), `ValueError` (400) and `NotAWhiteboard` (422). Writes ``<stem>.whiteboard.json``
    and only the ``lastUpdated`` line of the ``.md`` (see `_touch_md`).
    """
    validate_board(board)
    data = dump_board(board)
    with space._lock:
        rel, md_reason = _board_md_or_sidecar(space, path)
        if md_reason:
            raise BoardReadOnly(md_reason)
        revision = _save_sidecar(
            space, board_rel(rel), data, base_revision, lambda b: load_board(b)[1]
        )
        return Saved(revision, *_touch_md(space, rel))


def save_ink(space: Space, path: str, strokes: Any, base_revision: str) -> Saved:
    """Save the ink SVG beside the whiteboard's ``.md``, then stamp the ``.md``.

    The same rules as `save_board` (`InkInvalid` for invalid strokes). Writes
    ``<stem>.ink.svg`` (zero strokes write the empty SVG: a save never deletes the file)
    and only the ``lastUpdated`` line of the ``.md``.
    """
    validate_strokes(strokes)
    data = dump_ink(strokes)
    with space._lock:
        rel, md_reason = _board_md_or_sidecar(space, path)
        if md_reason:
            raise BoardReadOnly(md_reason)
        revision = _save_sidecar(
            space, ink_rel(rel), data, base_revision, lambda b: load_ink(b)[1]
        )
        return Saved(revision, *_touch_md(space, rel))


# --- creating ------------------------------------------------------------------------------


def create_whiteboard(space: Space, title: str = "") -> tuple[str, str, list[str]]:
    """Create ``Whiteboards/<Title>.md``; return ``(path, version, type_ids)``.

    ``type_ids`` holds the Whiteboard type id when its JSON was written by this create (M2's
    lazy persist, the first time). No sidecar is written: the board is empty until edited.
    """
    with space._lock:
        t = ensure_whiteboard_type(space)
        had_file = bool(type_revision(space.root, t.id))
        path, version = space.create_object(t.id, title or "")
        type_ids = [t.id] if not had_file and type_revision(space.root, t.id) else []
    return path, version, type_ids


# --- display settings ----------------------------------------------------------------------


def whiteboard_ui_problem(value: Any) -> str | None:
    """Why a ``whiteboard`` ui.json patch isn't ``{isSnappingToGrid?, …: bool}``, else None."""
    if not isinstance(value, dict):
        return _UI_PROBLEM
    for key, setting in value.items():
        if key not in WHITEBOARD_UI_KEYS or not isinstance(setting, bool):
            return _UI_PROBLEM
    return None
