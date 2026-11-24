"""The whiteboard hooks `Space` keeps beside `whiteboardstore` and `whiteboardtrash`.

`Space` owns the object lifecycle; these are its whiteboard sides, moved out of
`space.py` as free functions over the open space (`Space` keeps thin delegating
methods): the boards whose canvas links to a renamed object by its old name (so
their links are relinked like body links), the sidecars following a renamed
board's ``.md`` (with the ``.md`` going back when they cannot follow), and a
trashed whiteboard coming back under one free stem with its sidecars beside it
(`whiteboardtrash` moves the sidecars; these also touch the ``.md`` itself).
`Space._is_whiteboard` already delegates to `whiteboardstore.is_whiteboard`.
"""

from __future__ import annotations

import logging
from pathlib import PurePosixPath
from typing import TYPE_CHECKING

from .space import _fold, version_of

if TYPE_CHECKING:
    from .space import Space

__all__ = [
    "board_referrers",
    "move_board_files",
    "restore_whiteboard",
]

_log = logging.getLogger(__name__)


def board_referrers(space: Space, rel: str, old_title: str) -> dict[str, set[str]]:
    """Whiteboards whose board file links to ``rel`` by its old name: board .md -> targets.

    The same rule as `Space._referrers`, over each board's entity blocks and text-block
    links (read only; an unreadable or missing board adds nothing).
    """
    from .whiteboardfile import board_rel, load_board
    from .whiteboardstore import whiteboard_type
    from .whiteboardtrash import board_links

    t = whiteboard_type(space)
    if t is None:
        return {}
    names = {_fold(old_title), _fold(PurePosixPath(rel).stem), _fold(rel[:-3])}
    candidates = space._links.mentioning(names)  # a board's links count as body links
    with space._lock:
        boards = sorted(p for p, s in space._summaries.items() if s.type == t.id and p in candidates)
    out: dict[str, set[str]] = {}
    for md in boards:
        with space._lock:
            try:
                data = (space.root / board_rel(md)).read_bytes()
            except OSError:
                continue
        board, reason = load_board(data)
        if reason:
            continue
        found = {
            target
            for target in board_links(board)
            if _fold(target) in names and space.resolve(target, md) == rel
        }
        if found:
            out[md] = found
    return out


def move_board_files(space: Space, rel: str, new_rel: str, version: str) -> str:
    """Move a renamed whiteboard's sidecars after its .md; return where the .md ends up.

    If the sidecars can't follow (both or neither move), the .md goes back to ``rel``
    and the board keeps its old file name; the title change stands.
    """
    from .whiteboardtrash import move_sidecars

    try:
        move_sidecars(space, rel, new_rel)
    except OSError:
        try:
            space._move_file(new_rel, rel, version)
        except OSError:
            _log.exception("Could not move %s back after its sidecars failed", new_rel)
            return new_rel
        return rel
    return new_rel


def restore_whiteboard(space: Space, trash_id: str, original: str, data: bytes) -> str:
    """Put a trashed whiteboard's ``.md`` and its sidecars back under one free stem."""
    from .whiteboardtrash import free_whiteboard_stem, restore_sidecars

    rel = space._rel(original)
    parent = PurePosixPath(rel).parent.as_posix()
    folder = "" if parent == "." else parent
    stem = PurePosixPath(rel).stem
    for _attempt in range(100):
        target = free_whiteboard_stem(space.root, folder, stem)
        if space._place(target, data):
            break
    else:
        raise OSError(f"Could not find a free file name for {stem!r}")
    try:
        restore_sidecars(space, trash_id, target)
    except BaseException:
        # Leave the entry whole in the trash: take the .md back out.
        space.own_deletes[target] = version_of(data)
        (space.root / target).unlink(missing_ok=True)
        space.own_writes.pop(target, None)
        space.rescan_file(target)
        raise
    return target
