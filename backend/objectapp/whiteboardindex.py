"""A whiteboard's board file as the link index and search see it (M6, read only).

`board_for_index` is the one place the indexes read a board: for a whiteboard ``.md`` it
returns the parsed ``<stem>.whiteboard.json`` and its revision; anything else (not a
whiteboard, no board file, an unreadable board) adds nothing. It never writes.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .space import version_of
from .whiteboardfile import board_rel, load_board
from .whiteboardstore import whiteboard_type

if TYPE_CHECKING:
    from .space import Space

__all__ = ["board_for_index"]


def board_for_index(space: Space, md_rel: str) -> tuple[dict[str, Any] | None, str]:
    """``(board, revision)`` of the whiteboard ``md_rel``; ``(None, '')`` when there is none.

    The revision is the sha256 of the board file's bytes, also for an unreadable board (so a
    later fix of the file is noticed), with ``board`` ``None`` then.
    """
    with space._lock:
        summary = space._summaries.get(md_rel)
        t = whiteboard_type(space)
        if summary is None or t is None or summary.type != t.id:
            return None, ""
        try:
            data = (space.root / board_rel(md_rel)).read_bytes()
        except OSError:
            return None, ""
    board, reason = load_board(data)
    return (None if reason else board), version_of(data)
