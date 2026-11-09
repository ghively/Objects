"""The block-reference routes (M8 Task 27).

- ``GET /api/block?path=&id=`` -> ``BlockInfo`` ``{path, id, markdown, version}``: the
  Markdown of the block of ``path`` whose last line ends with `` ^<id>``; 400 for a bad
  path, 404 when there is no such object or block. Reads only.
- ``GET /api/block/references?path=&id=`` -> ``{paths: string[]}``: the objects whose
  body holds ``![[<Title>#^<id>]]`` or ``[[<Title>#^<id>]]`` with ``<Title>`` resolving
  to ``path`` (the object itself included when it references its own block), sorted by
  title then path; 400 / 404 as above. Reads only.

A block is found by its id the way the editor writes it (`editor/blocks.ts`
``BLOCK_ID_SUFFIX``): a heading is its one line; a list item is its line plus the
lines indented under it; a paragraph or quote runs back from the id line to the
previous blank line, heading, annotation comment or fence (a quote also stops at a
non-quote line). Code is never searched.
"""

from __future__ import annotations

import re

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from .apictx import ApiContext
from .relink import _LINK_RE, _segments

__all__ = ["block_markdown", "block_reference_ids", "router"]

_ID_LINE_RE = re.compile(r" \^([a-z0-9]{6})[ \t]*$")
_FENCE_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
_HEADING_RE = re.compile(r"^ {0,3}#{1,6}(?:\s|$)")
_LIST_RE = re.compile(r"^(\s*)(?:[-*+]|\d+[.)])(?:\s|$)")
_QUOTE_RE = re.compile(r"^ {0,3}>")
_COMMENT_RE = re.compile(r"^ {0,3}<!--.*-->[ \t]*$")
_BLOCK_ID_SUFFIX_RE = re.compile(r"^#\^([a-z0-9]{6})(?:\|.*)?$", re.DOTALL)


def _indent(line: str) -> int:
    return len(line) - len(line.lstrip(" \t"))


def block_markdown(body: str, block_id: str) -> str | None:
    """The Markdown (``\\n`` line ends, no final break) of the block with ``block_id``, or None."""
    lines = body.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    if lines and lines[0].startswith("﻿"):
        lines[0] = lines[0][1:]
    fenced = False
    for i, line in enumerate(lines):
        if _FENCE_RE.match(line):
            fenced = not fenced
            continue
        if fenced:
            continue
        m = _ID_LINE_RE.search(line)
        if m is None or m.group(1) != block_id:
            continue
        if _HEADING_RE.match(line):
            return line.rstrip()
        lm = _LIST_RE.match(line)
        if lm is not None:
            own = _indent(line)
            end = i + 1
            while end < len(lines) and lines[end].strip() and _indent(lines[end]) > own:
                end += 1
            return "\n".join(lines[i:end]).rstrip()
        quote = bool(_QUOTE_RE.match(line))
        start = i
        while start > 0:
            prev = lines[start - 1]
            if (
                not prev.strip()
                or _HEADING_RE.match(prev)
                or _COMMENT_RE.match(prev)
                or _FENCE_RE.match(prev)
                or (quote and not _QUOTE_RE.match(prev))
                or (not quote and _LIST_RE.match(prev))
            ):
                break
            start -= 1
        return "\n".join(lines[start : i + 1]).rstrip()
    return None


def block_reference_ids(body: str) -> list[tuple[str, str]]:
    """``(target, id)`` of each ``[[T#^id]]`` / ``![[T#^id]]`` in ``body`` outside code."""
    out: list[tuple[str, str]] = []
    if "#^" not in body:
        return out
    for s, e, code in _segments(body):
        if code:
            continue
        for m in _LINK_RE.finditer(body, s, e):
            sm = _BLOCK_ID_SUFFIX_RE.match(m.group(2) or "")
            if sm is not None:
                out.append((m.group(1).strip(), sm.group(1)))
    return out


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"detail": message}, status_code=status)


def router(ctx: ApiContext) -> APIRouter:
    """The block-reference routes, mounted on the app's `/api` router (so no prefix here)."""
    r = APIRouter()
    space = ctx.space

    def known(path: str) -> str | JSONResponse:
        try:
            rel = space._rel(path)
        except ValueError as exc:
            return _error(400, str(exc))
        if not (space.root / rel).is_file():
            return _error(404, f'There is no object at "{path}".')
        return rel

    @r.get("/block")
    def get_block(path: str, id: str):
        rel = known(path)
        if isinstance(rel, JSONResponse):
            return rel
        try:
            of, _fm, version = space.read(rel)
        except (KeyError, OSError):
            return _error(404, f'There is no object at "{path}".')
        markdown = block_markdown(of.body, id)
        if markdown is None:
            return _error(404, f'There is no block "{id}" in "{path}".')
        from .searchtext import display_safe

        return {"path": rel, "id": id, "markdown": display_safe(markdown), "version": version}

    @r.get("/block/references")
    def get_block_references(path: str, id: str):
        rel = known(path)
        if isinstance(rel, JSONResponse):
            return rel
        with space._lock:
            scanned = rel in space._summaries
        if not scanned:
            space.rescan_file(rel)
        candidates = {b["path"] for b in space.backlinks(rel)}
        candidates.add(rel)
        found: list[str] = []
        for src in candidates:
            with space._lock:
                raw = space._raw.get(src)
            if raw is None:
                continue
            for target, ref_id in block_reference_ids(raw.of.body):
                if ref_id == id and space.resolve(target, src) == rel:
                    found.append(src)
                    break

        def key(p: str) -> tuple[str, str, str]:
            s = space._summaries.get(p)
            title = s.title if s is not None else p
            return (title.casefold(), title, p)

        return {"paths": sorted(found, key=key)}

    return r
