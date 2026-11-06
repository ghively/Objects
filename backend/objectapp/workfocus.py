"""M23: focus lines in the daily note (plan ``2026-11-05-m23-work-section.md``, Contract).

The day's focus lines are the top-level list items of the ``Focus`` section of its daily note:
the first heading whose text is ``Focus`` (any level, case-insensitive, outside fenced code)
up to the next heading of the same or a higher level. `focus_day` reads them (never creating a
note); `save_focus` replaces only the section's list lines (every other line of the body kept
byte for byte), creating the daily note through `Space.create_daily_note` when it is missing.
Writes go through `Space.save_body` (version-checked, CRLF and BOM kept, atomic).
"""

from __future__ import annotations

import re
from typing import Any

from .apiquery import _headings
from .dailynotes import DailyNoteExists, parse_day
from .propvalues import InvalidValue
from .space import Conflict, Space

__all__ = [
    "FOCUS",
    "FOCUS_CHANGED",
    "MAX_FOCUS_LINES",
    "MAX_FOCUS_TEXT",
    "focus_day",
    "parse_focus",
    "replace_focus",
    "save_focus",
]

FOCUS = "Focus"
MAX_FOCUS_LINES = 20
MAX_FOCUS_TEXT = 500
FOCUS_CHANGED = "Today's note changed. Look again."  # ours

_NEED_ONE = "Write at least one line."  # ported
_ONE_LINE = "A focus line is one line."  # ours
_AT_MOST = f"At most {MAX_FOCUS_LINES} focus lines."  # ours
_TOO_LONG = f"A focus line is at most {MAX_FOCUS_TEXT} characters."  # ours

_ITEM = re.compile(r"^( {0,3})([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?(.+)$")
_LINK = re.compile(r"\[\[([^\[\]|]+)(?:\|([^\[\]]*))?\]\]")


def _bare(line: str) -> str:
    return line.rstrip("\r\n")


def _indent(line: str) -> int:
    text = _bare(line).expandtabs(4)
    return len(text) - len(text.lstrip(" "))


def _section(lines: list[str]) -> tuple[int, int] | None:
    """(heading line, end line exclusive) of the Focus section, or None."""
    hs = _headings(lines)
    want = FOCUS.casefold()
    for k, (i, level, text) in enumerate(hs):
        if text.casefold() != want:
            continue
        end = len(lines)
        for j, lvl, _t in hs[k + 1 :]:
            if lvl <= level:
                end = j
                break
        return i, end
    return None


_FENCE = re.compile(r"^ {0,3}(```|~~~)")


def _fenced(lines: list[str]) -> set[int]:
    """Indices of the lines of fenced code blocks (the fence lines included)."""
    out: set[int] = set()
    fence: str | None = None
    for i, line in enumerate(lines):
        m = _FENCE.match(_bare(line))
        if m:
            out.add(i)
            if fence is None:
                fence = m.group(1)
            elif m.group(1) == fence:
                fence = None
        elif fence is not None:
            out.add(i)
    return out


def _items(lines: list[str], start: int, end: int) -> list[tuple[int, int, str]]:
    """The section's top-level items: (first line, end line exclusive, text).

    An item owns the lines after it that are indented to its content (with the blank lines
    between them); a heading inside the section never belongs to an item.
    """
    heading_lines = {i for i, _l, _t in _headings(lines)}
    fenced = _fenced(lines)
    out: list[tuple[int, int, str]] = []
    i = start
    while i < end:
        if i in heading_lines or i in fenced:
            i += 1
            continue
        m = _ITEM.match(_bare(lines[i]))
        if m is None:
            i += 1
            continue
        content = len(m.group(1)) + len(m.group(2)) + len(m.group(3).expandtabs(4))
        j = i + 1
        last = i  # the item's last owned non-blank line
        while j < end and j not in heading_lines:
            if not _bare(lines[j]).strip():
                j += 1
                continue
            if _indent(lines[j]) >= content:
                last = j
                j += 1
                continue
            break
        out.append((i, last + 1, m.group(5).strip()))
        i = last + 1
    return out


def parse_focus(body: str) -> list[str]:
    """The Focus section's top-level list items' texts, in order (a to-do box dropped)."""
    lines = body.splitlines(keepends=True)
    sec = _section(lines)
    if sec is None:
        return []
    heading, end = sec
    return [text for _a, _b, text in _items(lines, heading + 1, end)]


def replace_focus(body: str, lines: list[str]) -> str:
    """``body`` with the Focus section's list replaced by ``- {line}`` lines.

    The new list goes where the first item was (right after the heading, one blank line
    between, when there was none); the old items (and the lines nested under them) go. Every
    other line is kept as it is. A body without the section gets ``## Focus``, a blank line and
    the list at its end, after one blank line.
    """
    new = [f"- {line}\n" for line in lines]
    src = body.splitlines(keepends=True)
    sec = _section(src)
    if sec is None:
        if not body:
            prefix = ""
        elif body.endswith("\n\n"):
            prefix = body
        elif body.endswith("\n"):
            prefix = body + "\n"
        else:
            prefix = body + "\n\n"
        return prefix + "## Focus\n\n" + "".join(new)
    heading, end = sec
    items = _items(src, heading + 1, end)
    if items:
        drop: set[int] = set()
        for a, b, _t in items:
            drop.update(range(a, b))
        first = items[0][0]
        out: list[str] = []
        for i, line in enumerate(src):
            if i == first:
                out.extend(new)
            if i not in drop:
                out.append(line)
        return "".join(out)
    # A section with no items: the list right after the heading.
    head = src[heading]
    if not head.endswith("\n"):
        head += "\n"
    before = [*src[:heading], head]
    rest = src[heading + 1 :]
    if rest and not _bare(rest[0]).strip():
        before.append(rest[0])
        rest = rest[1:]
    else:
        before.append("\n")
    after = ["\n"] if rest and _bare(rest[0]).strip() else []
    return "".join([*before, *new, *after, *rest])


def _check_day(day: Any) -> str:
    parsed = parse_day(day) if isinstance(day, str) else None
    if parsed is None or parsed != day.strip():
        raise InvalidValue(f"Not a day (YYYY-MM-DD): {day!r}")
    return parsed


def _clean(lines: Any) -> list[str]:
    if not isinstance(lines, list) or not all(isinstance(x, str) for x in lines):
        raise InvalidValue(_NEED_ONE)
    out: list[str] = []
    for raw in lines:
        text = raw.strip()
        if not text:
            continue
        if "\n" in text or "\r" in text:
            raise InvalidValue(_ONE_LINE)
        if len(text) > MAX_FOCUS_TEXT:
            raise InvalidValue(_TOO_LONG)
        out.append(text)
    if not out:
        raise InvalidValue(_NEED_ONE)
    if len(out) > MAX_FOCUS_LINES:
        raise InvalidValue(_AT_MOST)
    return out


def _focus_line(space: Space, n: int, text: str, note_path: str) -> dict:
    links = [
        {"target": m.group(1).strip(), "path": space.resolve(m.group(1).strip(), note_path)}
        for m in _LINK.finditer(text)
    ]
    label = _LINK.sub(lambda m: (m.group(2) if m.group(2) is not None else m.group(1)).strip(), text)
    return {"n": n, "text": text, "label": label, "links": links}


def _note_path(space: Space, day: str) -> str | None:
    return space.daily_notes()[0].get(day)


def focus_day(space: Space, day: str) -> dict:
    """The ``FocusDay`` of ``day``; reads only (a missing note is not created)."""
    day = _check_day(day)
    path = _note_path(space, day)
    empty = {"day": day, "notePath": None, "version": None, "hasSection": False, "lines": []}
    if path is None:
        return empty
    try:
        of, _fm, version = space.read(path)
    except KeyError:
        return empty
    body = of.body
    has_section = _section(body.splitlines(keepends=True)) is not None
    lines = [_focus_line(space, n, t, path) for n, t in enumerate(parse_focus(body), start=1)]
    return {
        "day": day,
        "notePath": path,
        "version": version,
        "hasSection": has_section,
        "lines": lines,
    }


def save_focus(space: Space, day: str, lines: list[str], base_version: str | None) -> dict:
    """Write ``lines`` as the Focus section's list of ``day``'s daily note; the new ``FocusDay``.

    ``base_version`` is the note's version the lines were edited against (None: the note was
    missing). Raises `Conflict` when the note is not at that version, `InvalidValue` for a bad
    day or bad lines, and whatever `Space.save_body` raises (`ReadOnly`).
    """
    day = _check_day(day)
    clean = _clean(lines)
    path = _note_path(space, day)
    if path is None:
        if base_version is not None:
            raise Conflict(None)  # type: ignore[arg-type]  # the note is gone
        try:
            path, version = space.create_daily_note(day)
        except DailyNoteExists as e:
            try:  # a note made meanwhile (or a file holding its name)
                current = space.read(e.path)[2]
            except KeyError:
                current = None
            raise Conflict(current) from None  # type: ignore[arg-type]
    else:
        version = space.read(path)[2]
        if base_version != version:
            raise Conflict(version)
    of, _fm, version = space.read(path)
    new_body = replace_focus(of.body, clean)
    if new_body != of.body:
        space.save_body(path, new_body, version)
    return focus_day(space, day)
