"""The whiteboard board file: ``<stem>.whiteboard.json`` beside the board's ``.md``.

The format is Capacities' ``WhiteboardData`` (``whiteboard.model.ts``: ``version``, ``nodes``
and ``edges`` keyed by id, ``viewport?``, ``locked?``, ``readingOrder?``) plus one key,
``blocks``: the canvas blocks Capacities keeps on the entity's ``RootWhiteboard_canvas``
property (text blocks and embedded objects). Unknown keys at any level are kept: validation
only checks the known fields, and `dump_board` writes exactly the dict it is given.

M8 adds two block types (our format; Capacities' media nodes point at media objects, which
our model keeps as attachments): ``{"type": "media", "path": "Attachments/<file>"}``, a
relative space path that can't leave the space, and ``{"type": "weblink", "url": "https://…",
"title"?: "…"}``, an ``http``/``https`` URL stored as typed and never fetched. An entity block
may carry ``view`` (``inline``, ``smallCard``, ``wideCard`` or ``embed``; the View menu).

Pure functions, no `Space`: the store (Task 3) reads and writes the bytes.
"""

from __future__ import annotations

import json
import math
import re
from typing import Any
from urllib.parse import urlsplit

from .jsonstore import dump_json

__all__ = [
    "BG_COLORS",
    "BOARD_SUFFIX",
    "CONNECTIONS",
    "DATA_VERSION",
    "ENTITY_VIEWS",
    "INK_SUFFIX",
    "LINES",
    "MARKERS",
    "MAX_EDGES",
    "MAX_NODES",
    "NEWER_VERSION_REASON",
    "NODE_KINDS",
    "SHAPES",
    "TEXT_ALIGNS",
    "THEME_COLORS",
    "V_ALIGNS",
    "BoardInvalid",
    "board_rel",
    "dump_board",
    "media_path_problem",
    "weblink_problem",
    "empty_board",
    "ink_rel",
    "load_board",
    "sidecar_owner",
    "sidecar_rels",
    "unreadable_reason",
    "validate_board",
]

BOARD_SUFFIX = ".whiteboard.json"
INK_SUFFIX = ".ink.svg"
DATA_VERSION = 1
MAX_NODES = 20_000
MAX_EDGES = 50_000

# Enums from whiteboard.model.ts and colorThemes.ts.
NODE_KINDS = frozenset({"block", "shape", "point", "frame"})
SHAPES = frozenset({
    "rectangle", "roundedRectangle", "ellipse", "diamond", "triangle", "triangleDown",
    "star", "parallelogram", "bubble", "blockArrow", "blockArrowLeft", "heart",
})
MARKERS = frozenset({"none", "arrow", "arrowClosed", "dot", "double"})
CONNECTIONS = frozenset({"straight", "cornered", "curved"})
LINES = frozenset({"solid", "dashed", "dotted"})
THEME_COLORS = frozenset({
    "gray", "rose", "pink", "fuchsia", "purple", "violet", "indigo", "blue", "sky", "cyan",
    "teal", "emerald", "green", "lime", "yellow", "amber", "orange", "red",
})
BG_COLORS = frozenset(f"bg-{c}" for c in THEME_COLORS)
TEXT_ALIGNS = frozenset({"left", "center", "right"})
# M7's four object views, as an entity block's optional ``view`` (Task 21's View menu).
ENTITY_VIEWS = frozenset({"inline", "smallCard", "wideCard", "embed"})
V_ALIGNS = frozenset({"top", "center", "bottom"})

# Our strings (no Capacities original).
NEWER_VERSION_REASON = "This whiteboard was saved by a newer version of Object."
_UNREADABLE_PREFIX = "This whiteboard's file can't be read, so it opens read-only: "

_ENTITY_LINK_RE = re.compile(r"^\[\[[^\[\]\n]+\]\]$")
_WEBLINK_SCHEMES = frozenset({"http", "https"})


class BoardInvalid(Exception):
    """A board that doesn't match the schema; ``detail`` is a short English sentence."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


# --- sidecar names -------------------------------------------------------------------------


def _stem(md_rel: str) -> str:
    if not md_rel.endswith(".md") or md_rel.endswith("/.md") or md_rel == ".md":
        raise ValueError(f"not an object path: {md_rel!r}")
    return md_rel[: -len(".md")]


def board_rel(md_rel: str) -> str:
    """``Whiteboards/X.md`` -> ``Whiteboards/X.whiteboard.json`` (only the final ``.md`` goes)."""
    return _stem(md_rel) + BOARD_SUFFIX


def ink_rel(md_rel: str) -> str:
    """``Whiteboards/X.md`` -> ``Whiteboards/X.ink.svg``."""
    return _stem(md_rel) + INK_SUFFIX


def sidecar_rels(md_rel: str) -> tuple[str, str]:
    """``(board_rel, ink_rel)`` of a board's ``.md``."""
    return board_rel(md_rel), ink_rel(md_rel)


def sidecar_owner(rel: str) -> str | None:
    """The ``.md`` path a sidecar belongs to, or ``None`` when ``rel`` isn't a sidecar name."""
    for suffix in (BOARD_SUFFIX, INK_SUFFIX):
        if rel.endswith(suffix):
            stem = rel[: -len(suffix)]
            if not stem or stem.endswith("/"):
                return None
            return stem + ".md"
    return None


# --- validation ----------------------------------------------------------------------------


def empty_board() -> dict[str, Any]:
    return {"version": DATA_VERSION, "nodes": {}, "edges": {}, "blocks": {}}


def _is_number(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def _number(owner: str, field: str, value: Any) -> None:
    if not _is_number(value):
        raise BoardInvalid(f"{owner} has a {field} that isn't a finite number.")


def _optional(obj: dict[str, Any], field: str, check) -> None:
    if field in obj:
        check(obj[field])


def _string(owner: str, field: str, value: Any) -> None:
    if not isinstance(value, str):
        raise BoardInvalid(f"{owner} has a {field} that isn't text.")


def _boolean(owner: str, field: str, value: Any) -> None:
    if not isinstance(value, bool):
        raise BoardInvalid(f"{owner} has a {field} that isn't true or false.")


def _enum(owner: str, field: str, value: Any, allowed: frozenset[str]) -> None:
    if not isinstance(value, str) or value not in allowed:
        raise BoardInvalid(f"{owner} has an unknown {field}: {value!r}.")


def _record(value: Any, what: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise BoardInvalid(f"The whiteboard's {what} aren't a record keyed by id.")
    return value


def media_path_problem(path: Any) -> str | None:
    """Why ``path`` can't be a media block's path, or ``None`` when it is a safe space path.

    A relative POSIX path inside the space: not empty, no leading ``/``, no backslash, no
    ``:`` (drive letters, URLs; our choice, it is also not portable), no control characters,
    no empty, ``.`` or ``..`` segment and no dot-folder (``.capacities/``, ``.git/`` …).
    """
    if not isinstance(path, str) or not path:
        return "has no file path"
    if path.startswith("/") or "\\" in path or ":" in path:
        return "has a file path outside the space"
    if any(ord(c) < 32 or ord(c) == 127 for c in path):
        return "has a file path outside the space"
    parts = path.split("/")
    for i, part in enumerate(parts):
        if part in ("", ".", ".."):
            return "has a file path outside the space"
        if part.startswith(".") and i < len(parts) - 1:
            return "has a file path inside a hidden folder"
    return None


def weblink_problem(url: Any) -> str | None:
    """Why ``url`` can't be a web link, or ``None`` for an ``http``/``https`` URL with a host."""
    if not isinstance(url, str) or not url:
        return "has no URL"
    if any(ord(c) <= 32 or ord(c) == 127 for c in url):
        return "has a URL with spaces or control characters"
    try:
        parts = urlsplit(url)
    except ValueError:
        return "has a URL that can't be read"
    if parts.scheme.lower() not in _WEBLINK_SCHEMES:
        return "has a URL that isn't http or https"
    if not parts.netloc or not parts.hostname:
        return "has a URL without a host"
    return None


def _validate_block(key: str, block: Any) -> None:
    owner = f"Block {key}"
    if not isinstance(block, dict):
        raise BoardInvalid(f"{owner} isn't an object.")
    kind = block.get("type")
    if kind == "text":
        if not isinstance(block.get("markdown"), str):
            raise BoardInvalid(f"{owner} has no text.")
        _optional(block, "align", lambda v: _enum(owner, "alignment", v, TEXT_ALIGNS))
    elif kind == "entity":
        link = block.get("link")
        if not isinstance(link, str) or not _ENTITY_LINK_RE.match(link):
            raise BoardInvalid(f"{owner} has a link that isn't a [[wikilink]].")
        _optional(block, "view", lambda v: _enum(owner, "view", v, ENTITY_VIEWS))
    elif kind == "media":
        problem = media_path_problem(block.get("path"))
        if problem:
            raise BoardInvalid(f"{owner} {problem}.")
    elif kind == "weblink":
        problem = weblink_problem(block.get("url"))
        if problem:
            raise BoardInvalid(f"{owner} {problem}.")
        _optional(block, "title", lambda v: _string(owner, "title", v))
    else:
        raise BoardInvalid(f"{owner} has an unknown type: {kind!r}.")


def _validate_node(key: str, node: Any, blocks: dict[str, Any]) -> None:
    owner = f"Node {key}"
    if not isinstance(node, dict):
        raise BoardInvalid(f"{owner} isn't an object.")
    if node.get("id") != key:
        raise BoardInvalid(f"{owner} has an id that doesn't match its key.")
    _enum(owner, "kind", node.get("kind"), NODE_KINDS)
    position = node.get("position")
    if not isinstance(position, dict):
        raise BoardInvalid(f"{owner} has no position.")
    _number(owner, "position x", position.get("x"))
    _number(owner, "position y", position.get("y"))
    for field in ("width", "height"):
        if field in node:
            value = node[field]
            _number(owner, field, value)
            # Points are free-standing connector ends of size 0.
            if value < 0 or (value == 0 and node.get("kind") != "point"):
                raise BoardInvalid(f"{owner} has a {field} that isn't positive.")
    for field in ("z", "rotation"):
        _optional(node, field, lambda v, f=field: _number(owner, f, v))
    if "blockId" in node:
        _string(owner, "blockId", node["blockId"])
        if node["blockId"] not in blocks:
            raise BoardInvalid(f"{owner} points to a block that doesn't exist.")
    _optional(node, "shape", lambda v: _enum(owner, "shape", v, SHAPES))
    _optional(node, "fillColor", lambda v: _enum(owner, "fill colour", v, BG_COLORS))
    _optional(node, "borderColor", lambda v: _enum(owner, "border colour", v, THEME_COLORS))
    _optional(
        node, "textVerticalAlign", lambda v: _enum(owner, "vertical alignment", v, V_ALIGNS)
    )
    for field in ("locked", "flipX", "flipY", "headless"):
        _optional(node, field, lambda v, f=field: _boolean(owner, f, v))
    _optional(node, "title", lambda v: _string(owner, "title", v))


def _validate_edge(key: str, edge: Any, nodes: dict[str, Any], blocks: dict[str, Any]) -> None:
    owner = f"Edge {key}"
    if not isinstance(edge, dict):
        raise BoardInvalid(f"{owner} isn't an object.")
    if edge.get("id") != key:
        raise BoardInvalid(f"{owner} has an id that doesn't match its key.")
    for field in ("source", "target"):
        end = edge.get(field)
        if not isinstance(end, str) or end not in nodes:
            raise BoardInvalid(f"{owner} points to a node that doesn't exist.")
    for field in ("sourceHandle", "targetHandle", "label"):
        _optional(edge, field, lambda v, f=field: _string(owner, f, v))
    for field in ("markerStart", "markerEnd"):
        _optional(edge, field, lambda v, f=field: _enum(owner, f, v, MARKERS))
    _optional(edge, "connection", lambda v: _enum(owner, "connection", v, CONNECTIONS))
    _optional(edge, "line", lambda v: _enum(owner, "line", v, LINES))
    _optional(edge, "color", lambda v: _enum(owner, "colour", v, THEME_COLORS))
    if "blockId" in edge:
        _string(owner, "blockId", edge["blockId"])
        if edge["blockId"] not in blocks:
            raise BoardInvalid(f"{owner} points to a block that doesn't exist.")


def validate_board(data: Any) -> None:
    """Raise `BoardInvalid` unless ``data`` matches ``whiteboardDataSchema`` plus ``blocks``."""
    if not isinstance(data, dict):
        raise BoardInvalid("The whiteboard isn't a JSON object.")
    version = data.get("version")
    if not _is_number(version):
        raise BoardInvalid("The whiteboard has no version number.")
    if version != DATA_VERSION:
        raise BoardInvalid(f"The whiteboard's version must be {DATA_VERSION}.")
    nodes = _record(data.get("nodes"), "nodes")
    edges = _record(data.get("edges"), "edges")
    blocks = _record(data.get("blocks", {}), "blocks")
    if len(nodes) > MAX_NODES:
        raise BoardInvalid(f"The whiteboard has more than {MAX_NODES:,} items.")
    if len(edges) > MAX_EDGES:
        raise BoardInvalid(f"The whiteboard has more than {MAX_EDGES:,} connectors.")
    for key, block in blocks.items():
        _validate_block(key, block)
    for key, node in nodes.items():
        _validate_node(key, node, blocks)
    for key, edge in edges.items():
        _validate_edge(key, edge, nodes, blocks)
    if "viewport" in data:
        viewport = data["viewport"]
        if not isinstance(viewport, dict):
            raise BoardInvalid("The whiteboard's viewport isn't an object.")
        for field in ("x", "y", "zoom"):
            _number("The viewport", field, viewport.get(field))
        for field in ("paneWidth", "paneHeight"):
            _optional(viewport, field, lambda v, f=field: _number("The viewport", f, v))
    _optional(data, "locked", lambda v: _boolean("The whiteboard", "locked", v))
    if "readingOrder" in data:
        order = data["readingOrder"]
        if not isinstance(order, list) or not all(isinstance(i, str) for i in order):
            raise BoardInvalid("The whiteboard's reading order isn't a list of ids.")


# --- reading and writing -------------------------------------------------------------------


def unreadable_reason(detail: str) -> str:
    """The read-only reason for a board file that can't be read (our string)."""
    return _UNREADABLE_PREFIX + detail


def load_board(data: bytes) -> tuple[dict[str, Any], str | None]:
    """``(board, None)`` for a readable, valid file; ``(empty_board(), reason)`` otherwise.

    A board without ``blocks`` (a plain ``WhiteboardData``) reads with ``blocks: {}``; nothing
    is written by reading.
    """
    try:
        board = json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError):
        return empty_board(), unreadable_reason("it isn't valid JSON.")
    if not isinstance(board, dict):
        return empty_board(), unreadable_reason("it isn't a JSON object.")
    version = board.get("version")
    if _is_number(version) and version > DATA_VERSION:
        return empty_board(), NEWER_VERSION_REASON
    if "blocks" not in board:
        board["blocks"] = {}
    try:
        validate_board(board)
    except BoardInvalid as exc:
        return empty_board(), unreadable_reason(exc.detail)
    return board, None


def dump_board(board: dict[str, Any]) -> bytes:
    """The file bytes: ``indent=2``, non-ASCII kept, LF, trailing newline, key order as given."""
    return dump_json(board)
