"""A whiteboard's sidecars follow its ``.md``: trash, restore, purge, rename and relink.

A whiteboard is ``<stem>.md`` plus up to two sidecars beside it, ``<stem>.whiteboard.json``
and ``<stem>.ink.svg`` (`whiteboardfile.sidecar_rels`). These functions move the sidecars
with the object; `Space` calls them from its delete, restore, purge and rename paths
(wired in by the integrate task), so none of them touches the ``.md`` itself.

- **Trash:** ``.capacities/trash/whiteboards/<trash_id>/`` holds ``board.json`` and
  ``ink.svg``, bytes unchanged. `trash.Trash` only lists top-level ``*.json`` and its
  ``types/``, ``collections/`` and ``queries/`` folders, so this folder is never taken for
  an entry.
- **Restore** puts the sidecars back beside the restored ``.md`` (whatever stem it got),
  never overwriting anything; `free_whiteboard_stem` picks a stem whose ``.md`` and both
  sidecar names are free, so an orphan sidecar is never adopted.
- **Rename** moves both sidecars or neither (`move_sidecars` rolls back on failure).
- **Relink** rewrites entity block links and ``[[wikilinks]]`` in text blocks when an
  object is renamed (`relink_board`, `relink_board_file`).
- `board_links` and `board_text` are pure extractions for the link index and search.

Every move is recorded in ``space.own_deletes``/``space.own_writes`` so the watcher stays
quiet, and is made under ``space._lock``.
"""

from __future__ import annotations

import copy
import os
import shutil
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any

from .relink import replace_wikilinks, wikilink_spans
from .space import version_of
from .textfile import atomic_write, move_no_overwrite, retry_os
from .trash import Trash
from .whiteboardfile import (
    BOARD_SUFFIX,
    INK_SUFFIX,
    dump_board,
    load_board,
    sidecar_owner,
)
from .whiteboardfile import board_rel as _board_rel
from .whiteboardfile import ink_rel as _ink_rel
from .whiteboardstore import is_whiteboard

if TYPE_CHECKING:
    from .space import Space

__all__ = [
    "TRASH_BOARD_NAME",
    "TRASH_INK_NAME",
    "board_links",
    "board_text",
    "free_whiteboard_stem",
    "move_sidecars",
    "purge_sidecars",
    "relink_board",
    "relink_board_file",
    "restore_sidecars",
    "sidecar_event_owner",
    "sidecar_trash_dir",
    "trash_sidecars",
]

TRASH_BOARD_NAME = "board.json"
TRASH_INK_NAME = "ink.svg"


def _pairs(md_rel: str) -> list[tuple[str, str]]:
    """``(sidecar space path, its file name in the trash folder)`` for a board's ``.md``."""
    return [(_board_rel(md_rel), TRASH_BOARD_NAME), (_ink_rel(md_rel), TRASH_INK_NAME)]


def _version(path: Path) -> str:
    try:
        return version_of(path.read_bytes())
    except OSError:
        return ""


# --- trash -----------------------------------------------------------------------------------


def sidecar_trash_dir(space: Space, trash_id: str) -> Path:
    """``.capacities/trash/whiteboards/<trash_id>/``; `ValueError` for an unsafe id."""
    if not Trash._safe_id(trash_id):
        raise ValueError(f"not a trash id: {trash_id!r}")
    return space.trash.dir / "whiteboards" / trash_id


def trash_sidecars(space: Space, trash_id: str, md_rel: str) -> list[str]:
    """Move the board's existing sidecars into its trash folder; return their space paths.

    Bytes are unchanged. A board with no sidecars moves nothing and creates no folder. On a
    failure the sidecars already moved go back and the error propagates.
    """
    folder = sidecar_trash_dir(space, trash_id)
    with space._lock:
        todo = [
            (rel, name) for rel, name in _pairs(md_rel) if (space.root / rel).is_file()
        ]
        if not todo:
            return []
        folder.mkdir(parents=True, exist_ok=True)
        moved: list[tuple[str, Path]] = []
        try:
            for rel, name in todo:
                src = space.root / rel
                dest = folder / name
                space.own_deletes[rel] = _version(src)
                try:
                    move_no_overwrite(src, dest)
                except BaseException:
                    space.own_deletes.pop(rel, None)
                    raise
                moved.append((rel, dest))
        except BaseException:
            for rel, dest in reversed(moved):
                move_no_overwrite(dest, space.root / rel)
                space.own_deletes.pop(rel, None)
            _remove_if_empty(folder)
            raise
        for rel, _dest in moved:
            space.own_writes.pop(rel, None)
        return [rel for rel, _dest in moved]


def restore_sidecars(space: Space, trash_id: str, md_rel: str) -> list[str]:
    """Put the trashed sidecars back beside ``md_rel`` (the restored ``.md``); return their paths.

    Each file is moved into place without overwriting (`FileExistsError` if a file already
    has the name, after moving back what was restored). The trash folder is removed.
    """
    folder = sidecar_trash_dir(space, trash_id)
    with space._lock:
        if not folder.is_dir():
            return []
        restored: list[tuple[str, Path]] = []
        try:
            for rel, name in _pairs(md_rel):
                src = folder / name
                if not src.is_file():
                    continue
                dest = space.root / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                version = _version(src)
                previous = space.own_writes.get(rel)
                space.own_writes[rel] = version
                try:
                    move_no_overwrite(src, dest)
                except BaseException:
                    if previous is None:
                        space.own_writes.pop(rel, None)
                    else:
                        space.own_writes[rel] = previous
                    raise
                space.own_deletes.pop(rel, None)
                restored.append((rel, src))
        except BaseException:
            for rel, src in reversed(restored):
                move_no_overwrite(space.root / rel, src)
                space.own_writes.pop(rel, None)
            raise
        shutil.rmtree(folder, ignore_errors=True)
        _remove_if_empty(folder.parent)
        return [rel for rel, _src in restored]


def purge_sidecars(space: Space, trash_id: str) -> None:
    """Delete a trash entry's sidecars for good (nothing when it has none)."""
    folder = sidecar_trash_dir(space, trash_id)
    with space._lock:
        shutil.rmtree(folder, ignore_errors=True)
        _remove_if_empty(folder.parent)


def _remove_if_empty(folder: Path) -> None:
    try:
        folder.rmdir()
    except OSError:
        pass


# --- names -----------------------------------------------------------------------------------


def free_whiteboard_stem(
    root: Path, folder: str, stem: str, same_as: str | None = None
) -> str:
    """A free space path ``<folder>/<stem>.md`` for a whiteboard, like `space.unique_path`.

    A candidate (`` (2)``, `` (3)``... appended on a collision) is free only when its ``.md``,
    ``.whiteboard.json`` and ``.ink.svg`` names are all unused, compared case-insensitively,
    so an orphan sidecar is never adopted. ``same_as`` is the path of the board being
    renamed: its own three files are not a collision. Returns the ``.md`` path (the same
    form `unique_path` returns, so a caller can use either).
    """
    folder = folder.strip("/")
    base = Path(root) / folder if folder else Path(root)
    try:
        taken = {p.name.lower() for p in base.iterdir()} if base.is_dir() else set()
    except OSError:
        taken = set()
    own: set[str] = set()
    if same_as:
        same = PurePosixPath(same_as.replace("\\", "/"))
        same_folder = same.parent.as_posix()
        if (same_folder if same_folder != "." else "").lower() == folder.lower() and (
            same.name.lower().endswith(".md")
        ):
            own_stem = same.name[: -len(".md")].lower()
            own = {own_stem + ".md", own_stem + BOARD_SUFFIX, own_stem + INK_SUFFIX}
    n = 1
    while True:
        name = stem if n == 1 else f"{stem} ({n})"
        names = {(name + s).lower() for s in (".md", BOARD_SUFFIX, INK_SUFFIX)}
        if not (names & taken) - own:
            return f"{folder}/{name}.md" if folder else f"{name}.md"
        n += 1


def _move_one(src: Path, dest: Path) -> None:
    """Move without overwriting; a case-only rename goes through a temporary dot name."""
    if str(src).lower() == str(dest).lower() and src != dest:
        tmp = src.with_name(f".rename-{os.getpid()}-{id(src)}.tmp")
        retry_os(lambda: os.rename(src, tmp))
        try:
            retry_os(lambda: os.rename(tmp, dest))
        except BaseException:
            os.rename(tmp, src)
            raise
        return
    move_no_overwrite(src, dest)


def move_sidecars(space: Space, old_md: str, new_md: str) -> list[str]:
    """Move the board's existing sidecars from ``old_md``'s stem to ``new_md``'s; return new paths.

    Never overwrites (`FileExistsError`). On any failure the sidecars already moved go back
    to the old stem and the error propagates, so the caller can move the ``.md`` back too.
    """
    if old_md == new_md:
        return []
    with space._lock:
        pairs = [
            (o, n)
            for o, n in zip(
                (_board_rel(old_md), _ink_rel(old_md)),
                (_board_rel(new_md), _ink_rel(new_md)),
                strict=True,
            )
            if (space.root / o).is_file()
        ]
        moved: list[tuple[str, str, str | None, str | None]] = []
        try:
            for old, new in pairs:
                src, dest = space.root / old, space.root / new
                version = _version(src)
                prev_del = space.own_deletes.get(old)
                prev_write = space.own_writes.get(new)
                space.own_deletes[old] = version
                space.own_writes[new] = version
                try:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    _move_one(src, dest)
                except BaseException:
                    _restore_entry(space.own_deletes, old, prev_del)
                    _restore_entry(space.own_writes, new, prev_write)
                    raise
                moved.append((old, new, prev_del, prev_write))
        except BaseException:
            for old, new, prev_del, prev_write in reversed(moved):
                _move_one(space.root / new, space.root / old)
                _restore_entry(space.own_deletes, old, prev_del)
                _restore_entry(space.own_writes, new, prev_write)
            raise
        for old, new, _d, _w in moved:
            space.own_writes.pop(old, None)
            if old.lower() == new.lower() and (space.root / old).exists():
                # Case-insensitive file system: only the new spelling is ever reported.
                space.own_deletes.pop(old, None)
        return [new for _old, new, _d, _w in moved]


def _restore_entry(table: dict[str, str], key: str, previous: str | None) -> None:
    if previous is None:
        table.pop(key, None)
    else:
        table[key] = previous


# --- relink ----------------------------------------------------------------------------------


def _fold(text: str) -> str:
    return " ".join(text.split()).casefold()


def relink_board(
    board: dict[str, Any], old_targets: set[str], new_text: str
) -> dict | None:
    """The board with links to a renamed object rewritten, or ``None`` when nothing matched.

    Rewrites ``entity`` block links whose target (the text before any ``#``/``|``) is one of
    ``old_targets``, compared case-insensitively, and the same ``[[wikilinks]]`` inside text
    block Markdown (code spans skipped, ``#heading``/``|alias`` kept). Only those string
    values change; the input is not modified.
    """
    folded = {_fold(t) for t in old_targets}

    def should(target: str) -> bool:
        return _fold(target) in folded

    blocks = board.get("blocks")
    if not isinstance(blocks, dict):
        return None
    changes: dict[str, tuple[str, str]] = {}
    for bid, block in blocks.items():
        if not isinstance(block, dict):
            continue
        field = {"entity": "link", "text": "markdown"}.get(block.get("type"))  # type: ignore[arg-type]
        value = block.get(field) if field else None
        if not isinstance(value, str) or "[[" not in value:
            continue
        new_value = replace_wikilinks(value, should, new_text)
        if new_value != value:
            changes[bid] = (field, new_value)  # type: ignore[assignment]
    if not changes:
        return None
    out = copy.deepcopy(board)
    for bid, (field, new_value) in changes.items():
        out["blocks"][bid][field] = new_value
    return out


def relink_board_file(
    space: Space, md_rel: str, old_targets: set[str], new_text: str
) -> str | None:
    """Relink the board file beside ``md_rel``; return its space path when it was written.

    Skips (``None``) a missing or unreadable board and one with no matching link. The write
    is atomic and re-checks right before the replace that the file is unchanged since it was
    read (an external edit in between skips the relink rather than lose that edit).
    """
    rel = _board_rel(md_rel)
    full = space.root / rel
    with space._lock:
        try:
            data = full.read_bytes()
        except OSError:
            return None
        board, reason = load_board(data)
        if reason:
            return None
        new_board = relink_board(board, old_targets, new_text)
        if new_board is None:
            return None
        new_data = dump_board(new_board)
        base = version_of(data)
        new_version = version_of(new_data)

        class _Changed(Exception):
            pass

        def unchanged() -> None:
            if _version(full) != base:
                raise _Changed

        space._call_before_write(rel, data)  # M8 version history (never raises)
        previous = space.own_writes.get(rel)
        space.own_writes[rel] = new_version
        try:
            atomic_write(full, new_data, check=unchanged)
        except _Changed:
            _restore_entry(space.own_writes, rel, previous)
            return None
        except BaseException:
            _restore_entry(space.own_writes, rel, previous)
            raise
        return rel


# --- extraction for the link index and search ------------------------------------------------


def _position_key(node: dict[str, Any]) -> tuple[float, float]:
    pos = node.get("position")
    if not isinstance(pos, dict):
        return (0.0, 0.0)
    x, y = pos.get("x"), pos.get("y")
    num = (int, float)
    return (
        float(y) if isinstance(y, num) and not isinstance(y, bool) else 0.0,
        float(x) if isinstance(x, num) and not isinstance(x, bool) else 0.0,
    )


def _ordered_blocks(board: dict[str, Any]) -> list[dict[str, Any]]:
    """The board's blocks in reading order.

    Nodes named in ``readingOrder`` come first (in that order), then the other nodes
    top-to-bottom, left-to-right by position; then connector labels in edge order; then
    any block nothing points to, in file order. Each block appears once.
    """
    blocks = board.get("blocks") if isinstance(board.get("blocks"), dict) else {}
    nodes = board.get("nodes") if isinstance(board.get("nodes"), dict) else {}
    edges = board.get("edges") if isinstance(board.get("edges"), dict) else {}
    order: list[str] = []
    seen_nodes: set[str] = set()
    reading = board.get("readingOrder")
    for nid in reading if isinstance(reading, list) else []:
        if isinstance(nid, str) and nid in nodes and nid not in seen_nodes:
            seen_nodes.add(nid)
            order.append(nid)
    rest = [
        (nid, n)
        for nid, n in nodes.items()
        if nid not in seen_nodes and isinstance(n, dict)
    ]
    rest.sort(key=lambda item: (*_position_key(item[1]), item[0]))
    order.extend(nid for nid, _n in rest)
    block_ids: list[str] = []
    for nid in order:
        node = nodes.get(nid)
        bid = node.get("blockId") if isinstance(node, dict) else None
        if isinstance(bid, str):
            block_ids.append(bid)
    for edge in edges.values():
        bid = edge.get("blockId") if isinstance(edge, dict) else None
        if isinstance(bid, str):
            block_ids.append(bid)
    block_ids.extend(blocks.keys())
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for bid in block_ids:
        block = blocks.get(bid)
        if bid in seen or not isinstance(block, dict):
            continue
        seen.add(bid)
        out.append(block)
    return out


def board_links(board: dict[str, Any]) -> list[str]:
    """Link targets as written (before any ``#``/``|``), in reading order.

    Every ``entity`` block's link and every ``[[wikilink]]`` in text block Markdown (outside
    code), duplicates kept, as the link index stores body links.
    """
    out: list[str] = []
    for block in _ordered_blocks(board):
        kind = block.get("type")
        value = block.get("link") if kind == "entity" else block.get("markdown")
        if (
            kind not in ("entity", "text")
            or not isinstance(value, str)
            or "[[" not in value
        ):
            continue
        out.extend(target for target, _start, _end in wikilink_spans(value))
    return out


def _block_text(block: dict[str, Any]) -> str | None:
    kind = block.get("type")
    if kind == "text":
        md = block.get("markdown")
        return md if isinstance(md, str) else None
    if kind == "weblink":
        # M8: a web link's title (when set) and its URL; media blocks add no text.
        url = block.get("url")
        title = block.get("title")
        lines = [v for v in (title, url) if isinstance(v, str) and v.strip()]
        return "\n".join(lines) if lines else None
    return None


def board_text(board: dict[str, Any]) -> str:
    """The searchable text of the board in reading order, separated by blank lines.

    Text blocks give their Markdown; web-link blocks (M8) their title and URL. Entity and
    media blocks give nothing (a media path is neither text nor a link).
    """
    parts = [t for block in _ordered_blocks(board) if (t := _block_text(block)) is not None]
    return "\n\n".join(p for p in parts if p.strip())


# --- watcher ---------------------------------------------------------------------------------


def sidecar_event_owner(space: Space, rel: str) -> str | None:
    """The owning ``.md`` of a sidecar path when that object exists and is a whiteboard."""
    owner = sidecar_owner(rel.replace("\\", "/"))
    if owner is None:
        return None
    if not (space.root / owner).is_file() or not is_whiteboard(space, owner):
        return None
    return owner
