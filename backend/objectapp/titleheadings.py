"""Notes that begin with a heading repeating their title (M33, choice 5).

Until M32 the app gave every note made with a title the body ``# <title>``, and imports added
that line to a page without a heading of its own. The app shows the title in its own field
above the text and hides nothing, so such a note reads its title twice. Nothing is changed
unless the person asks: Settings > Editor shows how many there are (`count`) and "Remove those
headings" takes the line out of each (`remove`).

**Which notes count** (`title_line`, `_counts`): the note's title is in its front matter, and
the first line of its text that is not blank is the ``# <title>`` heading `Space.rename_object`
keeps in step with the title (`space.title_heading`, the same code: a level-one heading outside
code whose text is the title exactly; blanks after the ``#`` and at the end of the line, and a
closing ``#``, are not part of the text). A rename also rewrites such a heading further down
the text; that one is not counted, because the note does not begin with it.

**Left out**, because the line is not a repeat that can go:

- a note with no ``title`` in its front matter: its title *is* that heading;
- an AI chat (`aichat`): its format writes ``# <title>`` as its first line on every save;
- a daily note: its title is its date and can't be renamed, so no heading is kept in step;
- a whiteboard: its page is the canvas, and its text is the board's Notes;
- a template: its text is what a new note of the type starts with;
- an imported Source (M30): its text is the page as imported, and it opens read-only;
- a file that opens read-only (front matter that can't be read, not UTF-8, CR line ends).

**The removal** goes through the ordinary body write (`Space._write`, as `Space.save_body`): the
file is read again from disk and the rule asked again of what is there now, so a note changed
since the count is never clobbered; only the heading line and at most one blank line after it
go; ``lastUpdated`` is stamped (and an ``id`` added to a note that has none) as a body save
does; line endings, the BOM and every other byte are kept; the replace is atomic and refuses a
file that changed meanwhile (then it is read once more). The text as it was is kept in version
history first, always (an ordinary save keeps none while the newest version is under five
minutes old), and a note whose version can't be kept is not changed. As with any body save,
automations are told nothing.
"""

from __future__ import annotations

import logging
import re
from dataclasses import replace
from typing import TYPE_CHECKING

from .importers.sources import is_imported_source
from .objfile import ObjectFile
from .space import Conflict, ReadOnly, _str_or_none, title_heading, version_of
from .typedefs import RawObject, read_raw

if TYPE_CHECKING:
    from .space import Space

__all__ = ["RESYNC_AFTER", "count", "paths", "remove", "title_line", "without_title_line"]

_log = logging.getLogger(__name__)

RESYNC_AFTER = 100
"""More notes than this changed by one removal are announced as one resync (as the watcher
does for more than `watcher.RESYNC_AFTER` object events), not one event each."""

_GIVE_UP_AFTER = 20
"""Refused writes, with no note written yet, after which the folder itself is taken to refuse
writes and the removal stops (the first refusal is then the answer)."""

# Cheap first look: a text whose first line that isn't blank does not open a heading can't count.
_OPENS_WITH_HEADING = re.compile(r"\s*#[ \t]")
_BLANK_LINE = re.compile(r"[ \t]*\n")


def title_line(body: str, title: str) -> tuple[int, int] | None:
    """Where the heading that repeats ``title`` stands when ``body`` begins with it: the span
    of that line with its line end and at most one blank line after it. None otherwise."""
    if not title or _OPENS_WITH_HEADING.match(body) is None:
        return None
    m = title_heading(body, title)
    if m is None or body[: m.start()].strip():
        return None
    end = m.end()
    if body.startswith("\n", end):
        end += 1
        blank = _BLANK_LINE.match(body, end)
        if blank is not None:
            end = blank.end()
    return m.start(), end


def without_title_line(body: str, title: str) -> str | None:
    """``body`` without the heading that repeats ``title`` (`title_line`); None when it does not
    begin with one."""
    span = title_line(body, title)
    return None if span is None else body[: span[0]] + body[span[1] :]


def _left_out_types(space: Space) -> frozenset[str]:
    """The ids of the types whose notes are left alone: the daily note (`Space._locks_title`, the
    rename's own rule), the AI chat and the whiteboard, each found the way its own module finds it."""
    from .aichat import find_chat_type
    from .whiteboardstore import whiteboard_type

    out = {t.id for t in space.types if space._locks_title(t)}
    out.update(t.id for t in (find_chat_type(space), whiteboard_type(space)) if t is not None)
    return frozenset(out)


def _counts(space: Space, raw: RawObject, left_out: frozenset[str]) -> bool:
    """Whether the note read as ``raw`` begins with a heading repeating its title and is of a
    kind that counts (module docstring). Asked of the index's copy and of a file just read alike."""
    if raw.readOnly or _str_or_none(raw.fm.get("template")) is not None:
        return False
    title = _str_or_none(raw.fm.get("title"))  # none in the front matter: the heading is the title
    if title is None or title_line(raw.of.body, title) is None:
        return False
    type_id = space._type_id(raw.typeName)
    return type_id not in left_out and not is_imported_source(type_id, raw.fm)


def paths(space: Space) -> list[str]:
    """The notes that begin with a heading repeating their title, sorted. Reads the space's
    index only (the texts it already holds): no file is read and nothing is written."""
    left_out = _left_out_types(space)
    with space._lock:
        raws = list(space._raw.items())
    return sorted(rel for rel, raw in raws if _counts(space, raw, left_out))


def count(space: Space) -> int:
    return len(paths(space))


def _keep_version(space: Space, rel: str, raw: RawObject) -> bool:
    """Keep ``raw`` (the file as it is now) in version history, whatever the five-minute rule
    says; False when it couldn't be kept (`OSError` when its folder refuses the write)."""
    from .history import HistoryStore

    try:
        HistoryStore(space.root).snapshot(
            rel, raw.data, space.clock(), force=True, object_id=_str_or_none(raw.fm.get("id"))
        )
    except OSError:
        raise  # the folder that holds the versions refuses the write: a refusal like the note's own
    except Exception:  # noqa: BLE001 - whatever went wrong, the note is then left as it is
        _log.exception("Could not keep a version of %s; its heading is left", rel)
        return False
    return True


def _remove_one(space: Space, rel: str, left_out: frozenset[str]) -> str | None:
    """Take the heading out of the note at ``rel`` as it is on disk now; its new version, or
    None when it was left as it is. Raises `OSError` when the file system refuses the write."""

    def edit(of: ObjectFile, fm: dict) -> ObjectFile | None:
        title = _str_or_none(fm.get("title"))
        body = without_title_line(of.body, title) if title else None
        return None if body is None else replace(of, body=body)

    for _attempt in range(2):
        try:
            raw = read_raw(space.root, rel)  # from disk: the index may be behind a change made outside
        except (FileNotFoundError, NotADirectoryError):
            return None
        if not _counts(space, raw, left_out) or not _keep_version(space, rel, raw):
            return None
        base = version_of(raw.data)
        try:
            version = space._write(rel, base, edit, history=False)
        except Conflict:
            continue  # it changed since it was read: read it again
        except (ReadOnly, KeyError, FileNotFoundError):
            return None
        return version if version != base else None
    return None


def remove(space: Space) -> list[tuple[str, str]]:
    """Take the heading that repeats the title out of every note that begins with one; the
    ``(path, new version)`` of each note changed.

    A note that can't be written (in use by another program) is skipped and stays counted. When
    nothing could be written at all, the first refusal is raised (`OSError`: the answer every
    write gives when the folder refuses it; the folder that holds the versions counts too)."""
    changed: list[tuple[str, str]] = []
    refused: OSError | None = None
    refusals = 0
    left_out = _left_out_types(space)
    for rel in paths(space):
        try:
            version = _remove_one(space, rel, left_out)
        except OSError as exc:
            refused = refused or exc
            refusals += 1
            if not changed and refusals >= _GIVE_UP_AFTER:
                break
            continue
        if version is not None:
            changed.append((rel, version))
    if refused is not None and not changed:
        raise refused
    return changed
