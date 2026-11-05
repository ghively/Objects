"""Kind guessing and value conversion for imported properties (contract "Mapping step").

Typed YAML values (Obsidian, Anytype frontmatter) are guessed by `typedefs._kind_of`, the
guessing a space already does for untyped frontmatter. String cells (a Notion CSV, a Notion
page's ``Key: value`` lines) are guessed by `guess_cells`, which reads them with the rules of
M9's Import CSV (``csvValue`` in ``frontend/src/types/ImportCsvDialog.tsx``, ported here):
numbers with the column's decimal separator (`column_decimal_comma`), booleans, dates, URLs,
Notion relation cells, comma-separated label lists and repeated single labels. Every guess
can be overridden in the mapping step; `convert` then reads each value as the chosen kind and
reports the ones that don't fit (they are dropped and listed).

Every rule here is our choice.
"""

from __future__ import annotations

import re
from datetime import UTC, date, datetime
from typing import Any

from ..typedefs import _URL_RE, _kind_of

__all__ = [
    "NOTION_RELATION_RE",
    "column_decimal_comma",
    "convert",
    "guess_cells",
    "guess_yaml",
    "parse_date",
    "parse_number",
    "relation_items",
]

_TRUE = frozenset({"true", "yes", "1"})
_FALSE = frozenset({"false", "no", "0"})
MAX_LABEL_OPTIONS = 50
MAX_LABEL_PART = 40
MAX_OPTION_TEXT = 100

_DOT_NUMBER = re.compile(r"^[-+]?(\d{1,3}(,\d{3})+|\d*)(\.\d*)?(e[-+]?\d+)?$", re.IGNORECASE)
_COMMA_NUMBER = re.compile(r"^[-+]?(\d{1,3}(\.\d{3})+|\d*)(,\d*)?(e[-+]?\d+)?$", re.IGNORECASE)
_PLAIN_NUMBER = re.compile(r"^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$", re.IGNORECASE)
_CURRENCY = "$€£¥"

# A Notion relation item: ``Title (Folder%20Name/Page%20<id>.md)``.
NOTION_RELATION_RE = re.compile(r"\s*([^,()]*?[^,()\s]?)\s*\(([^()]+?\.md)\)\s*(?:,|$)")

_MONTHS = (
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
)
_NOTION_DATE_RE = re.compile(
    r"^@?(?P<month>[A-Za-z]+)\.? (?P<day>\d{1,2}),? (?P<year>\d{4})"
    r"(?:,? (?P<h>\d{1,2})(?::(?P<m>\d{2}))? ?(?P<ampm>[AaPp]\.?[Mm]\.?)?)?"
    r"(?: \((?:GMT|UTC)[^)]*\))?$"
)
_ISO_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_RANGE_SEP_RE = re.compile(r"\s*(?:→|->)\s*")


# -- numbers ------------------------------------------------------------------------


def _number_text(cell: str) -> str:
    t = re.sub(r"\s+", "", cell.replace("\u200b", ""))
    if t and t[0] in _CURRENCY:
        t = t[1:]
    elif t[:2] and t[0] in "+-" and t[1:2] and t[1] in _CURRENCY:
        t = t[0] + t[2:]
    return t


def column_decimal_comma(cells: list[str]) -> bool | None:
    """``columnDecimalComma``: True for a comma decimal separator, False for a point, None unknown."""
    comma = dot = True
    only_comma = only_dot = False
    numbers = 0
    for cell in cells:
        t = _number_text(cell).removesuffix("%")
        if not re.search(r"\d", t):
            continue
        c = bool(_COMMA_NUMBER.match(t))
        d = bool(_DOT_NUMBER.match(t))
        if not c and not d:
            continue
        numbers += 1
        comma = comma and c
        dot = dot and d
        only_comma = only_comma or (c and not d)
        only_dot = only_dot or (d and not c)
    if not numbers:
        return None
    if comma and only_comma:
        return True
    if dot and only_dot:
        return False
    return None


def parse_number(cell: str, radix_comma: bool | None = None) -> int | float | None:
    """``parseNumberInput`` for a cell (a leading currency sign allowed); None when not a number.
    A trailing ``%`` reads as the fraction (``25%`` -> 0.25), as Import CSV reads it."""
    t = _number_text(cell)
    if not t:
        return None
    if radix_comma:
        t = t.replace(".", "").replace(",", ".")
    else:
        t = t.replace(",", "")
    percent = t.endswith("%")
    if percent:
        t = t[:-1]
    if not _PLAIN_NUMBER.match(t):
        return None
    try:
        n = float(t)
    except ValueError:
        return None
    if n != n or n in (float("inf"), float("-inf")):
        return None
    if percent:
        mantissa, _, exp = repr(n).partition("e")
        n = float(f"{mantissa}e{int(exp or 0) - 2}")
    if n.is_integer() and abs(n) < 2**53 and not percent and "." not in t and "e" not in t.lower():
        return int(n)
    return n


# -- dates --------------------------------------------------------------------------


def _fmt(dt: datetime) -> str:
    dt = dt.astimezone(UTC)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _parse_point(text: str) -> tuple[str, str] | None:
    """(resolution, value) of one side of a date: an ISO day or instant, or a Notion date."""
    t = text.strip()
    if not t:
        return None
    if _ISO_DAY_RE.match(t):
        try:
            date.fromisoformat(t)
        except ValueError:
            return None
        return "day", t
    if re.match(r"^\d{4}-\d{2}-\d{2}[Tt ]\d", t):
        try:
            dt = datetime.fromisoformat(t.replace("Z", "+00:00").replace("z", "+00:00"))
        except ValueError:
            return None
        if dt.tzinfo is None:
            dt = dt.astimezone()  # a wall-clock time without a zone: this device's zone
        return "time", _fmt(dt)
    m = _NOTION_DATE_RE.match(t)
    if not m:
        return None
    word = m.group("month").lower()
    month = next((i for i, name in enumerate(_MONTHS) if name.startswith(word) and len(word) >= 3), None)
    if month is None:
        return None
    try:
        day = date(int(m.group("year")), month + 1, int(m.group("day")))
    except ValueError:
        return None
    if m.group("h") is None:
        return "day", day.isoformat()
    h, minute = int(m.group("h")), int(m.group("m") or 0)
    ampm = (m.group("ampm") or "").replace(".", "").lower()
    if minute > 59:
        return None
    if ampm:
        if not 1 <= h <= 12:
            return None
        if ampm == "pm" and h < 12:
            h += 12
        if ampm == "am" and h == 12:
            h = 0
    elif h > 23 or m.group("m") is None:
        return None
    local = datetime(day.year, day.month, day.day, h, minute).astimezone()
    return "time", _fmt(local)


def parse_date(value: Any) -> dict[str, Any] | None:
    """The API date value (``{start, end?, resolution}``) of a source value, or None."""
    if isinstance(value, datetime):
        dt = value if value.tzinfo else value.replace(tzinfo=UTC)
        return {"start": _fmt(dt), "resolution": "time"}
    if isinstance(value, date):
        return {"start": value.isoformat(), "resolution": "day"}
    if not isinstance(value, str):
        return None
    parts = _RANGE_SEP_RE.split(value.strip())
    if not 1 <= len(parts) <= 2:
        return None
    points = [_parse_point(p) for p in parts]
    if any(p is None for p in points):
        return None
    resolution = "time" if any(p[0] == "time" for p in points) else "day"  # type: ignore[index]
    values: list[str] = []
    for res, val in points:  # type: ignore[misc]
        if resolution == "time" and res == "day":
            val = f"{val}T00:00:00.000Z"
        values.append(val)
    out: dict[str, Any] = {"start": values[0], "resolution": resolution}
    if len(values) == 2:
        if values[1] < values[0]:
            return None
        out["end"] = values[1]
    return out


# -- relations ----------------------------------------------------------------------


def relation_items(cell: str) -> list[tuple[str, str]] | None:
    """A Notion relation cell as ``[(title, path), ...]``, or None when it isn't one."""
    t = cell.strip()
    if not t:
        return None
    out: list[tuple[str, str]] = []
    pos = 0
    while pos < len(t):
        m = NOTION_RELATION_RE.match(t, pos)
        if not m or m.end() == pos:
            return None
        out.append((m.group(1).strip(), m.group(2).strip()))
        pos = m.end()
    return out or None


def _parts(cell: str) -> list[str]:
    return [p.strip() for p in cell.split(",") if p.strip()]


# -- guessing -----------------------------------------------------------------------


def guess_cells(cells: list[str]) -> tuple[str, bool]:
    """(kind, isArray) for a column of string cells (empty cells don't count)."""
    values = [c.strip() for c in cells if isinstance(c, str) and c.strip()]
    if not values:
        return "text", False
    if all(v.lower() in ("yes", "no") for v in values):
        return "boolean", False
    radix = column_decimal_comma(values)
    if all(parse_number(v, radix) is not None for v in values):
        return "number", False
    if all(parse_date(v) is not None for v in values):
        return "datetime", False
    if all(_URL_RE.fullmatch(v) for v in values):
        return "url", False
    if all(relation_items(v) is not None for v in values):
        return "entity", True
    if any("," in v for v in values):
        counts: dict[str, int] = {}
        too_long = False
        for v in values:
            for p in dict.fromkeys(_parts(v)):
                counts[p] = counts.get(p, 0) + 1
                too_long = too_long or len(p) > MAX_LABEL_PART
        if (
            not too_long
            and len(counts) <= MAX_LABEL_OPTIONS
            and any(n > 1 for n in counts.values())
            and all("\n" not in v for v in values)
        ):
            return "label", True
    distinct = set(values)
    if (
        len(distinct) <= MAX_LABEL_OPTIONS
        and len(distinct) < len(values)
        and all("\n" not in v and len(v) <= MAX_OPTION_TEXT for v in values)
    ):
        return "label", False
    return "text", False


def guess_yaml(key: str, values: list[Any]) -> tuple[str, bool]:
    """(kind, isArray) for typed frontmatter values (`typedefs._kind_of`)."""
    kind, is_array = _kind_of(key, [v for v in values if v not in (None, "", [])])
    if kind not in ("text", "number", "boolean", "url", "datetime", "label", "entity"):
        return "text", False
    return kind, is_array


# -- converting ---------------------------------------------------------------------


def _scalar_text(value: Any) -> str | None:
    if value is None or isinstance(value, (dict, list)):
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, datetime):
        return _fmt(value if value.tzinfo else value.replace(tzinfo=UTC))
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, float) and value.is_integer():
        return str(int(value)) if abs(value) < 2**53 else str(value)
    return str(value)


def label_texts(value: Any, is_array: bool, split_commas: bool) -> list[str]:
    """The option texts of a source value (lists flattened; a cell split on commas)."""
    items = value if isinstance(value, list) else [value]
    out: list[str] = []
    for item in items:
        text = _scalar_text(item)
        if text is None:
            continue
        parts = _parts(text) if (split_commas and is_array) else [text.strip()]
        for p in parts:
            p = " ".join(p.split())
            if p and p not in out:
                out.append(p)
    return out


def is_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, list):
        return all(is_empty(v) for v in value)
    return False


def convert(
    value: Any, kind: str, is_array: bool, *, cells: bool, radix_comma: bool | None = None
) -> tuple[Any, list[str]]:
    """(API value or None, the texts that didn't fit) of one source value as ``kind``.

    ``cells`` marks string cells (a CSV), whose label and entity values split on commas. An
    entity value is answered as the list of item texts (the planner resolves them). An empty
    value is ``(None, [])``.
    """
    if is_empty(value):
        return None, []
    if kind == "text":
        if isinstance(value, dict) or (isinstance(value, list) and any(isinstance(v, dict) for v in value)):
            return None, [str(value)]
        if isinstance(value, list):
            return ", ".join(t for t in (_scalar_text(v) for v in value) if t), []
        return _scalar_text(value), []
    if kind == "label":
        texts = label_texts(value, is_array, cells)
        bad = [t for t in texts if len(t) > MAX_OPTION_TEXT or "\n" in t]
        good = [t for t in texts if t not in bad]
        if not is_array and len(good) > 1:
            return good[:1], bad + good[1:]
        return (good or None), bad
    if kind == "entity":
        texts: list[str] = []
        items = value if isinstance(value, list) else [value]
        for item in items:
            text = _scalar_text(item)
            if text is None:
                continue
            if cells and relation_items(text) is None and is_array:
                texts.extend(_parts(text))
            else:
                texts.append(text.strip())
        if not is_array and len(texts) > 1 and not cells:
            return texts[:1], texts[1:]
        return (texts or None), []
    # The scalar kinds: a list holds one value only when it has one item.
    if isinstance(value, list):
        items = [v for v in value if not is_empty(v)]
        if len(items) != 1:
            return None, [", ".join(t for t in (_scalar_text(v) for v in items) if t)]
        value = items[0]
    text = _scalar_text(value)
    if kind == "number":
        if isinstance(value, bool):
            return None, [text or ""]
        if isinstance(value, (int, float)):
            return value, []
        n = parse_number(text or "", radix_comma)
        return (n, []) if n is not None else (None, [text or ""])
    if kind == "boolean":
        if isinstance(value, bool):
            return value, []
        low = (text or "").strip().lower()
        if low in _TRUE:
            return True, []
        if low in _FALSE:
            return False, []
        return None, [text or ""]
    if kind == "datetime":
        d = parse_date(value)
        return (d, []) if d is not None else (None, [text or ""])
    if kind == "url":
        t = (text or "").strip()
        if not t or "\n" in t:
            return None, [text or ""]
        return t, []
    return None, [text or ""]
