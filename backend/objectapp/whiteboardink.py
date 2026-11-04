"""The freehand ink file: ``<stem>.ink.svg`` beside the board's ``.md`` (Gene's addition).

The server serializes validated strokes into a standalone SVG that any browser renders, and
parses it back. Only the exact shape `dump_ink` writes is accepted on read: a DOCTYPE, an
entity, a comment, any element other than our ``<path>``s, or an attribute we don't write makes
the file read-only, so the app never rewrites content it didn't write.

Pure functions, no `Space`.
"""

from __future__ import annotations

import math
import re
import xml.etree.ElementTree as ET
from typing import Any
from xml.sax.saxutils import quoteattr

from .whiteboardfile import THEME_COLORS

__all__ = [
    "HIGHLIGHTER_OPACITY",
    "INK_READ_ONLY_REASON",
    "MAX_STROKES",
    "InkInvalid",
    "InkStroke",
    "dump_ink",
    "load_ink",
    "validate_strokes",
]

InkStroke = dict[str, Any]

HIGHLIGHTER_OPACITY = 0.35
MAX_STROKES = 50_000
MAX_POINTS = 20_000
MAX_D_BYTES = 1_000_000
PADDING = 15

# Our string.
INK_READ_ONLY_REASON = "This ink file has content Object didn't write, so it opens read-only."

SVG_NS = "http://www.w3.org/2000/svg"
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_D_RE = re.compile(r"^[MLQCZmlqcz0-9 ,.eE+-]*$")
_TOOLS = frozenset({"pen", "highlighter"})
_ROOT_ATTRS = frozenset({"version", "data-object-ink", "viewBox"})
_PATH_ATTRS = frozenset(
    {"id", "data-tool", "data-color", "data-width", "data-points", "fill", "fill-opacity", "d"}
)
_DANGEROUS = re.compile(rb"<!\s*(DOCTYPE|ENTITY)", re.IGNORECASE)
# Comments and processing instructions would be lost on a rewrite, so they make it read-only too.
_FOREIGN_MARKUP = re.compile(rb"<!--|<\?(?!xml\s)")

# The hex behind each theme's ink colour (`--line-<theme>` in frontend/src/theme/tokens.css,
# as copied by the client's inkModel.ts); used to name a stroke's colour when the client
# didn't send `colorName`.
_HEX_TO_THEME = {
    "#5c5959": "gray", "#ea4561": "rose", "#e34d97": "pink", "#d14be5": "fuchsia",
    "#a558ee": "purple", "#8a5fed": "violet", "#6568e8": "indigo", "#3f80eb": "blue",
    "#199dd9": "sky", "#11a9c3": "cyan", "#1dad9d": "teal", "#19ae7d": "emerald",
    "#2bbb60": "green", "#7fbe1f": "lime", "#daaa14": "yellow", "#e89a17": "amber",
    "#ec731f": "orange", "#e54a4a": "red",
}


class InkInvalid(Exception):
    """Strokes that can't be saved; ``detail`` is a short English sentence."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


def _is_number(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def validate_strokes(strokes: Any) -> None:
    """Raise `InkInvalid` unless ``strokes`` is a list of well-formed `InkStroke` dicts."""
    if not isinstance(strokes, list):
        raise InkInvalid("The ink strokes aren't a list.")
    if len(strokes) > MAX_STROKES:
        raise InkInvalid(f"The ink has more than {MAX_STROKES:,} strokes.")
    seen: set[str] = set()
    for index, stroke in enumerate(strokes):
        if not isinstance(stroke, dict):
            raise InkInvalid(f"Stroke {index + 1} isn't an object.")
        sid = stroke.get("id")
        if not isinstance(sid, str) or not _ID_RE.match(sid):
            raise InkInvalid(f"Stroke {index + 1} has an invalid id.")
        owner = f"Stroke {sid}"
        if sid in seen:
            raise InkInvalid(f"{owner} appears twice.")
        seen.add(sid)
        if stroke.get("tool") not in _TOOLS:
            raise InkInvalid(f"{owner} has an unknown tool.")
        color = stroke.get("color")
        if not isinstance(color, str) or not _COLOR_RE.match(color):
            raise InkInvalid(f"{owner} has a colour that isn't #rrggbb.")
        if "colorName" in stroke and stroke["colorName"] not in THEME_COLORS:
            raise InkInvalid(f"{owner} has an unknown colour name.")
        width = stroke.get("width")
        if not _is_number(width) or not 0.5 <= width <= 200:
            raise InkInvalid(f"{owner} has a width outside 0.5 to 200.")
        points = stroke.get("points")
        if not isinstance(points, list) or not 1 <= len(points) <= MAX_POINTS:
            raise InkInvalid(f"{owner} needs 1 to {MAX_POINTS:,} points.")
        for point in points:
            if (
                not isinstance(point, list)
                or len(point) != 3
                or not all(_is_number(v) for v in point)
            ):
                raise InkInvalid(f"{owner} has a point that isn't three numbers.")
            if not 0 <= point[2] <= 1:
                raise InkInvalid(f"{owner} has a pressure outside 0 to 1.")
        d = stroke.get("d")
        if not isinstance(d, str) or not _D_RE.match(d):
            raise InkInvalid(f"{owner} has a path that isn't plain SVG path data.")
        if len(d.encode("utf-8")) > MAX_D_BYTES:
            raise InkInvalid(f"{owner} has a path over 1 MB.")


# --- writing -------------------------------------------------------------------------------


def _fmt(value: float, decimals: int = 2) -> str:
    text = f"{value:.{decimals}f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def _color_name(stroke: InkStroke) -> str | None:
    name = stroke.get("colorName")
    if isinstance(name, str) and name in THEME_COLORS:
        return name
    return _HEX_TO_THEME.get(stroke["color"].lower())


def _view_box(strokes: list[InkStroke]) -> str:
    xs = [p[0] for s in strokes for p in s["points"]]
    ys = [p[1] for s in strokes for p in s["points"]]
    if not xs:
        return "0 0 1 1"
    min_x, min_y = min(xs) - PADDING, min(ys) - PADDING
    width = max(xs) - min(xs) + 2 * PADDING
    height = max(ys) - min(ys) + 2 * PADDING
    return " ".join(_fmt(v) for v in (min_x, min_y, width, height))


def _path_line(stroke: InkStroke) -> str:
    attrs: list[tuple[str, str]] = [
        ("id", f"s-{stroke['id']}"),
        ("data-tool", stroke["tool"]),
    ]
    name = _color_name(stroke)
    if name:
        attrs.append(("data-color", name))
    attrs.append(("data-width", _fmt(stroke["width"])))
    points = " ".join(
        f"{_fmt(x)},{_fmt(y)},{_fmt(p, 3)}" for x, y, p in stroke["points"]
    )
    attrs.append(("data-points", points))
    attrs.append(("fill", stroke["color"]))
    if stroke["tool"] == "highlighter":
        attrs.append(("fill-opacity", _fmt(HIGHLIGHTER_OPACITY)))
    attrs.append(("d", stroke["d"]))
    return "  <path " + " ".join(f"{k}={quoteattr(v)}" for k, v in attrs) + "/>"


def dump_ink(strokes: list[InkStroke]) -> bytes:
    """The standalone SVG for ``strokes`` (validated first), deterministic, LF, trailing newline."""
    validate_strokes(strokes)
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        (
            f'<svg xmlns="{SVG_NS}" version="1.1" data-object-ink="1" '
            f'viewBox="{_view_box(strokes)}">'
        ),
        *(_path_line(s) for s in strokes),
        "</svg>",
    ]
    return ("\n".join(lines) + "\n").encode("utf-8")


# --- reading -------------------------------------------------------------------------------


class _Foreign(Exception):
    pass


def _number_text(text: str) -> int | float:
    try:
        value = float(text)
    except ValueError as exc:
        raise _Foreign from exc
    if not math.isfinite(value):
        raise _Foreign
    return int(value) if value.is_integer() else value


def _blank(text: str | None) -> bool:
    return text is None or not text.strip()


def _parse_path(el: ET.Element) -> InkStroke:
    if el.tag != f"{{{SVG_NS}}}path" or len(el) or not _blank(el.text):
        raise _Foreign
    if set(el.attrib) - _PATH_ATTRS:
        raise _Foreign
    ident = el.get("id", "")
    raw_points = el.get("data-points")
    if not ident.startswith("s-") or raw_points is None:
        raise _Foreign
    tool = el.get("data-tool")
    fill = el.get("fill")
    d = el.get("d")
    width = el.get("data-width")
    if tool is None or fill is None or d is None or width is None:
        raise _Foreign
    points = []
    for chunk in raw_points.split():
        parts = chunk.split(",")
        if len(parts) != 3:
            raise _Foreign
        points.append([_number_text(p) for p in parts])
    stroke: InkStroke = {
        "id": ident[2:],
        "tool": tool,
        "color": fill,
        "width": _number_text(width),
        "points": points,
        "d": d,
    }
    color_name = el.get("data-color")
    if color_name is not None:
        if color_name not in THEME_COLORS:
            raise _Foreign
        stroke["colorName"] = color_name
    return stroke


def load_ink(data: bytes) -> tuple[list[InkStroke], str | None]:
    """``(strokes, None)`` for a file `dump_ink` could have written; ``([], reason)`` otherwise."""
    if _DANGEROUS.search(data) or _FOREIGN_MARKUP.search(data):
        return [], INK_READ_ONLY_REASON
    try:
        parser = ET.XMLParser(target=ET.TreeBuilder(insert_comments=True, insert_pis=True))
        parser.feed(data)
        root = parser.close()
        if root.tag != f"{{{SVG_NS}}}svg" or root.get("data-object-ink") != "1":
            raise _Foreign
        if set(root.attrib) - _ROOT_ATTRS or not _blank(root.text):
            raise _Foreign
        strokes = []
        for child in root:
            if not _blank(child.tail):
                raise _Foreign
            strokes.append(_parse_path(child))
        validate_strokes(strokes)
    except (ET.ParseError, _Foreign, InkInvalid, ValueError):
        return [], INK_READ_ONLY_REASON
    return strokes, None
