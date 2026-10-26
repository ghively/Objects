"""Property values: the per-kind codec between frontmatter and the API.

`decode_value` reads what is on disk (as `parse_fm` returns it) into the API
value of a property kind, leniently: anything it can't read becomes the
kind's empty value. `encode_value` validates an API value and returns what
`set_keys` should write, keeping the form the existing line already uses
(so the first edit of an exported value changes only the value).
`convert_value` implements `KIND_TRANSFORMS` for a property's kind change.

Value forms (spec section 4, the shapes Object's Markdown export uses):

==================  ==========================================  ============================
kind                on disk                                     API value
==================  ==========================================  ============================
text, url, ...      string                                      ``str | None``
blocks, table       literal ``|-`` block of Markdown            ``str | None``
number              int or float                                ``int | float | None``
boolean             ``true`` / ``false``                        ``bool``
datetime*           ``2026-10-30``, ``...T14:00:00.000Z``,       ``{start, end?, resolution}``
                    ``start -> end``
entity              ``'[[Title]]'`` or a flow list of them      ``[{target, path}]``
label               option text or a list of texts              ``[str]``
tags, aliases       flow list                                   ``[str]``
icon                ``icon: ph-...`` + ``iconColor: <c>``       ``{type, val, color?}``
coverImage          space-relative image path                   ``str | None``
color (Tag)         ``bg-<c>``                                  ``str | None``
==================  ==========================================  ============================
"""

from __future__ import annotations

import math
import random
import re
from collections.abc import Callable
from datetime import UTC, date, datetime
from typing import Any

from ruamel.yaml.scalarstring import LiteralScalarString

from .frontmatter import FlowList
from .ids import new_ulid
from .typemodel import THEME_COLORS, Icon, LabelOption, PropertyDefinition

__all__ = [
    "KIND_TRANSFORMS",
    "InvalidValue",
    "convert_value",
    "decode_value",
    "empty_value",
    "encode_updates",
    "encode_value",
    "label_lookup",
]

# Which kinds a property can change to, and so which conversions `convert_value` does.
KIND_TRANSFORMS: dict[str, tuple[str, ...]] = {
    "text": ("text", "textBlock", "url", "number", "boolean", "label"),
    "textBlock": ("text", "textBlock", "url", "number", "boolean", "label"),
    "url": ("text", "textBlock"),
    "number": ("text", "textBlock", "label"),
    "boolean": ("text", "textBlock"),
    "label": ("text", "textBlock"),
    "entity": ("label", "text", "textBlock"),
    "datetime": ("datetimeSimple", "text", "textBlock"),
    "datetimeSimple": ("datetime", "text", "textBlock"),
}

_STRING_KINDS = frozenset({"text", "textBlock", "url", "coverImage", "entity_description"})
_BLOCK_KINDS = frozenset({"blocks", "simpleTableBlock"})
_DATE_KINDS = frozenset({"datetime", "datetimeSimple"})
_STRING_LIST_KINDS = frozenset({"entity_tags", "entity_aliases"})
_LIST_KINDS = frozenset({"label", "entity"}) | _STRING_LIST_KINDS
# System kinds whose values are not edited through the property codec (title and
# type have their own routes; the rest are maintained by the app).
_READ_ONLY_KINDS = frozenset(
    {
        "entity_title",
        "entity_type",
        "entity_createdAt",
        "entity_lastUpdated",
        "entity_backlinks",
    }
)
MAX_ALIASES = 8
MAX_OPTION_TEXT = 100

_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_LINK_RE = re.compile(r"^\[\[(.*)\]\]$", re.S)
_TRUE_TEXTS = frozenset({"true", "yes", "1"})
_FALSE_TEXTS = frozenset({"false", "no", "0", ""})


class InvalidValue(ValueError):
    """A value that doesn't fit its property (the API answers 422)."""


# -- helpers ---------------------------------------------------------------------


def _is_array(pdef: PropertyDefinition) -> bool:
    if pdef.type in _STRING_LIST_KINDS:
        return True
    default = pdef.type == "entity"
    value = pdef.options.get("isArray", default)
    return value if isinstance(value, bool) else default


def empty_value(pdef: PropertyDefinition) -> Any:
    """The API value of an empty (absent or ``null``) property."""
    if pdef.type in _LIST_KINDS:
        return []
    if pdef.type == "boolean":
        return False
    return None


def _scalar_text(raw: Any) -> str | None:
    if raw is None or isinstance(raw, dict):
        return None
    if isinstance(raw, bool):
        return "true" if raw else "false"
    if isinstance(raw, list):
        parts = [_scalar_text(v) for v in raw]
        return ", ".join(p for p in parts if p)
    return str(raw)


def _as_list(raw: Any) -> list[Any]:
    if raw is None:
        return []
    return list(raw) if isinstance(raw, list) else [raw]


def _single_or_list(pdef: PropertyDefinition, items: list[Any], existing_raw: Any) -> Any:
    """Encoded form of a list value: a scalar for single-select (unless the line is a list)."""
    if not items:
        return None
    if _is_array(pdef) or isinstance(existing_raw, list):
        return FlowList(items)
    return items[0]


def _number(value: Any) -> int | float:
    if isinstance(value, float) and value.is_integer() and abs(value) < 2**53:
        return int(value)
    return value


def _constraints(pdef: PropertyDefinition) -> dict[str, Any]:
    c = pdef.options.get("constraints")
    return c if isinstance(c, dict) else {}


def _prefers_day(pdef: PropertyDefinition) -> bool:
    c = _constraints(pdef)
    return "day" in (c.get("resolutionConstraint"), c.get("resolutionPreference"))


# -- dates -----------------------------------------------------------------------


def _parse_time(text: str) -> datetime | None:
    try:
        dt = datetime.fromisoformat(text.strip())
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _fmt_time(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _is_day(text: str) -> bool:
    if not _DAY_RE.match(text):
        return False
    try:
        date.fromisoformat(text)
    except ValueError:
        return False
    return True


def _decode_part(text: str, day_pref: bool) -> tuple[str, str] | None:
    """(resolution, normalised text) of one side of a date value."""
    text = text.strip()
    if _is_day(text):
        return "day", text
    dt = _parse_time(text)
    if dt is None:
        return None
    if day_pref and (dt.hour, dt.minute, dt.second, dt.microsecond) == (0, 0, 0, 0):
        return "day", dt.date().isoformat()
    return "time", _fmt_time(dt)


def _decode_date(pdef: PropertyDefinition, raw: Any) -> dict[str, Any] | None:
    text = _scalar_text(raw)
    if not text:
        return None
    parts = [p for p in text.split("->")]
    if len(parts) > 2:
        return None
    decoded = [_decode_part(p, _prefers_day(pdef)) for p in parts]
    if any(d is None for d in decoded):
        return None
    resolution = "day" if all(d[0] == "day" for d in decoded) else "time"
    values = [
        d[1] if resolution == "day" or d[0] == "time" else f"{d[1]}T00:00:00.000Z"
        for d in decoded
    ]
    out: dict[str, Any] = {"start": values[0]}
    if len(values) == 2:
        out["end"] = values[1]
    out["resolution"] = resolution
    return out


def _encode_date_part(text: Any, resolution: str, side: str) -> str:
    if not isinstance(text, str) or not text.strip():
        raise InvalidValue(f"The date's {side} is missing")
    text = text.strip()
    if resolution == "day":
        if not _is_day(text):
            raise InvalidValue(f"{text!r} is not a day (YYYY-MM-DD)")
        return text
    if _is_day(text):
        return f"{text}T00:00:00.000Z"
    dt = _parse_time(text)
    if dt is None:
        raise InvalidValue(f"{text!r} is not a date and time")
    return _fmt_time(dt)


def _encode_date(pdef: PropertyDefinition, value: Any, existing_raw: Any) -> str:
    if not isinstance(value, dict):
        raise InvalidValue("A date value is {start, end?, resolution}")
    start, end = value.get("start"), value.get("end")
    resolution = value.get("resolution")
    if resolution is None:
        resolution = "day" if isinstance(start, str) and _is_day(start.strip()) else "time"
    if resolution not in ("day", "time"):
        raise InvalidValue(f"Unknown date resolution {resolution!r}")
    c = _constraints(pdef)
    constraint = c.get("resolutionConstraint")
    if constraint in ("day", "time") and constraint != resolution:
        raise InvalidValue(
            "This property only takes dates" if constraint == "day" else "This property needs a time"
        )
    has_end = end not in (None, "")
    if c.get("endTimeSettings") == "required" and not has_end:
        raise InvalidValue("This property needs an end date")
    if c.get("endTimeSettings") == "notAllowed" and has_end:
        raise InvalidValue("This property doesn't take an end date")

    parts = [_encode_date_part(start, resolution, "start")]
    if has_end:
        parts.append(_encode_date_part(end, resolution, "end"))
        if parts[1] < parts[0]:
            raise InvalidValue("The end is before the start")
    if resolution == "day" and _prefers_day(pdef):
        existing = _scalar_text(existing_raw) or ""
        if "T" in existing.split("->")[0]:
            # Same form as the line: the export writes days as midnight UTC.
            parts = [f"{p}T00:00:00.000Z" for p in parts]
    return " -> ".join(parts)


# -- labels and links ------------------------------------------------------------


def label_lookup(pdef: PropertyDefinition, text: str) -> LabelOption | None:
    """The option whose text matches ``text`` (trimmed, case-insensitively), or whose id is it."""
    if not isinstance(text, str):
        return None
    wanted = text.strip()
    folded = wanted.casefold()
    options = pdef.options.get("set") or []
    for opt in options:
        if isinstance(opt, dict) and str(opt.get("text", "")).strip().casefold() == folded:
            return LabelOption.from_json(opt)
    for opt in options:
        if isinstance(opt, dict) and opt.get("id") == wanted:
            return LabelOption.from_json(opt)
    return None


def _link_target(item: Any) -> str | None:
    text = _scalar_text(item)
    if text is None:
        return None
    text = text.strip()
    m = _LINK_RE.match(text)
    if m:
        text = m.group(1).split("|", 1)[0].strip()
    return text or None


def _default_link_text(ref: dict[str, Any]) -> str:
    target = ref.get("target")
    if isinstance(target, str) and target.strip():
        return target.strip()
    path = ref.get("path")
    if isinstance(path, str) and path.strip():
        path = path.strip()
        return path[:-3] if path.lower().endswith(".md") else path
    return ""


# -- decode ----------------------------------------------------------------------


def decode_value(pdef: PropertyDefinition, raw: Any, fm: dict[str, Any] | None = None) -> Any:
    """The API value of ``raw`` (one key's value from `parse_fm`), leniently.

    ``fm`` is the whole frontmatter; the icon reads its colour from ``iconColor``.
    Entity references come back with ``path: None`` (the space resolves them).
    """
    kind = pdef.type
    if kind == "number":
        if isinstance(raw, bool) or raw is None:
            return None
        if isinstance(raw, (int, float)):
            return None if isinstance(raw, float) and not math.isfinite(raw) else raw
        text = str(raw).strip()
        try:
            return int(text)
        except ValueError:
            pass
        try:
            n = float(text)
        except ValueError:
            return None
        return n if math.isfinite(n) else None
    if kind == "boolean":
        if isinstance(raw, bool):
            return raw
        text = _scalar_text(raw)
        return text is not None and text.strip().lower() in _TRUE_TEXTS
    if kind in _DATE_KINDS:
        return _decode_date(pdef, raw)
    if kind == "label":
        out = []
        for item in _as_list(raw):
            text = _scalar_text(item)
            if text is None or not text.strip():
                continue
            opt = label_lookup(pdef, text)
            out.append(opt.text if opt else text.strip())
        return out
    if kind == "entity":
        targets = (_link_target(item) for item in _as_list(raw))
        return [{"target": t, "path": None} for t in targets if t]
    if kind in _STRING_LIST_KINDS:
        texts = (_scalar_text(item) for item in _as_list(raw))
        return [t for t in texts if t]
    if kind == "entity_icon":
        icon = Icon.parse(raw if isinstance(raw, (str, dict)) else None)
        if icon is None:
            return None
        color = (fm or {}).get("iconColor")
        if isinstance(color, str) and color.strip():
            icon = Icon(icon.type, icon.val, color.strip())
        return icon.to_json()
    text = _scalar_text(raw)
    return text if text else None


# -- encode ----------------------------------------------------------------------


def _encode_string(value: Any) -> str | None:
    if not isinstance(value, str):
        raise InvalidValue("Expected text")
    return value or None


def _encode_string_list(pdef: PropertyDefinition, value: Any) -> FlowList | None:
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise InvalidValue("Expected a list of texts")
    items = [v.strip() for v in value if v.strip()]
    folded = [v.casefold() for v in items]
    if len(set(folded)) != len(folded):
        raise InvalidValue(f"{pdef.name} must be unique")
    if pdef.type == "entity_aliases" and len(items) > MAX_ALIASES:
        raise InvalidValue(f"At most {MAX_ALIASES} aliases")
    return FlowList(items) if items else None


def _encode_collections(pdef: PropertyDefinition, value: Any) -> FlowList:
    """Collection names as a flow list; ``[]`` stays an (empty) list so ``key: []`` is written."""
    if value is None:
        return FlowList()
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise InvalidValue("Expected a list of collection names")
    items = [v.strip() for v in value if v.strip()]
    folded = [v.casefold() for v in items]
    if len(set(folded)) != len(folded):
        raise InvalidValue(f"{pdef.name} must be unique")
    return FlowList(items)


def _encode_label(pdef: PropertyDefinition, value: Any, existing_raw: Any) -> Any:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise InvalidValue("Expected a list of option texts")
    texts: list[str] = []
    for v in value:
        if not v.strip():
            continue
        opt = label_lookup(pdef, v)
        if opt is None:
            raise InvalidValue(f"{v.strip()!r} is not an option of {pdef.name}")
        if opt.text not in texts:
            texts.append(opt.text)
    if len(texts) > 1 and not _is_array(pdef):
        raise InvalidValue(f"{pdef.name} takes one option")
    return _single_or_list(pdef, texts, existing_raw)


def _encode_entity(
    pdef: PropertyDefinition,
    value: Any,
    existing_raw: Any,
    link_for: Callable[[dict[str, Any]], str] | None,
) -> Any:
    if not isinstance(value, list):
        raise InvalidValue("Expected a list of object references")
    links: list[str] = []
    for ref in value:
        if isinstance(ref, str):
            ref = {"target": ref, "path": None}
        if not isinstance(ref, dict):
            raise InvalidValue("An object reference is {target, path}")
        text = link_for(ref) if link_for else _default_link_text(ref)
        if not text:
            raise InvalidValue("An object reference has no target")
        link = f"[[{text}]]"
        if link not in links:
            links.append(link)
    if len(links) > 1 and not _is_array(pdef):
        raise InvalidValue(f"{pdef.name} takes one object")
    return _single_or_list(pdef, links, existing_raw)


def _encode_number(value: Any) -> int | float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InvalidValue("Expected a number")
    if isinstance(value, float) and not math.isfinite(value):
        raise InvalidValue("Expected a finite number")
    return _number(value)


def _encode_color(value: Any) -> str:
    if not isinstance(value, str):
        raise InvalidValue("Expected a colour")
    name = value.strip().removeprefix("bg-")
    if name not in THEME_COLORS:
        raise InvalidValue(f"Unknown colour {value!r}")
    return f"bg-{name}"


def encode_value(
    pdef: PropertyDefinition,
    value: Any,
    existing_raw: Any = None,
    *,
    link_for: Callable[[dict[str, Any]], str] | None = None,
) -> Any:
    """Validate an API value and return what `set_keys` writes for ``pdef.key``.

    ``existing_raw`` is the key's current value (from `parse_fm`), whose form is
    kept. ``None`` means "clear" (the caller writes ``null`` if the key exists).
    For an entity, ``link_for(ref)`` gives the link text of a reference (the
    space uses it for the path form of duplicate titles); by default it is the
    target, or the path without ``.md``. The icon's colour is written by
    `encode_updates`. Raises `InvalidValue`.
    """
    kind = pdef.type
    if kind in _READ_ONLY_KINDS:
        raise InvalidValue(f"{pdef.name} can't be edited as a property")
    if kind == "entity_collections":
        return _encode_collections(pdef, value)
    if value is None or (value == [] and kind in _LIST_KINDS):
        return None
    if kind in _STRING_KINDS:
        return _encode_string(value)
    if kind in _BLOCK_KINDS:
        text = _encode_string(value)
        return LiteralScalarString(text) if text else None
    if kind == "number":
        return _encode_number(value)
    if kind == "boolean":
        if not isinstance(value, bool):
            raise InvalidValue("Expected true or false")
        return value
    if kind in _DATE_KINDS:
        return _encode_date(pdef, value, existing_raw)
    if kind == "label":
        return _encode_label(pdef, value, existing_raw)
    if kind == "entity":
        return _encode_entity(pdef, value, existing_raw, link_for)
    if kind in _STRING_LIST_KINDS:
        return _encode_string_list(pdef, value)
    if kind == "entity_icon":
        icon = Icon.parse(value)
        if icon is None:
            raise InvalidValue("Expected an icon {type, val, color?}")
        return icon.val
    if kind == "color":
        return _encode_color(value)
    raise InvalidValue(f"Properties of kind {kind!r} can't be edited")


def encode_updates(
    pdef: PropertyDefinition,
    value: Any,
    fm: dict[str, Any] | None = None,
    *,
    link_for: Callable[[dict[str, Any]], str] | None = None,
) -> tuple[dict[str, Any], list[str]]:
    """The ``(updates, removals)`` that write ``value`` into frontmatter ``fm``.

    ``updates`` go to `set_keys`, ``removals`` to `delete_keys`. Clearing writes
    ``key: null`` only when the key exists, else nothing. The icon also sets
    ``iconColor`` (or removes it when the icon has no colour).
    """
    fm = fm or {}
    key = pdef.key
    encoded = encode_value(pdef, value, fm.get(key), link_for=link_for)
    updates: dict[str, Any] = {}
    removals: list[str] = []
    if pdef.type == "entity_collections" and not encoded and key not in fm:
        encoded = None  # nothing to clear: an absent key stays absent
    if encoded is not None or key in fm:
        updates[key] = encoded
    if pdef.type == "entity_icon":
        icon = Icon.parse(value) if value is not None else None
        if icon is not None and icon.color:
            updates["iconColor"] = icon.color
        elif "iconColor" in fm:
            removals.append("iconColor")
    return updates, removals


# -- convert ---------------------------------------------------------------------


def _to_label(dst: PropertyDefinition, texts: list[str]) -> tuple[list[str], bool]:
    """Option texts of ``dst`` for ``texts``, creating missing options (random colour)."""
    lossy = False
    wanted: list[str] = []
    for t in texts:
        t = t.strip()
        if t and t.casefold() not in (w.casefold() for w in wanted):
            wanted.append(t)
    if len(wanted) > 1 and not _is_array(dst):
        wanted, lossy = wanted[:1], True
    options = dst.options.setdefault("set", [])
    out: list[str] = []
    for t in wanted:
        opt = label_lookup(dst, t)
        if opt is None:
            if len(t) > MAX_OPTION_TEXT:
                t, lossy = t[:MAX_OPTION_TEXT], True
            options.append(
                {"id": new_ulid(), "text": t, "color": random.choice(THEME_COLORS), "icon": None}
            )
            out.append(t)
        else:
            out.append(opt.text)
    return out, lossy


def _text_to_number(text: str) -> tuple[int | float | None, bool]:
    text = text.strip()
    if not text:
        return None, False
    try:
        n = float(text)
    except ValueError:
        return None, True
    if not math.isfinite(n):
        return None, True
    return _number(n), False


def _text_to_boolean(text: str) -> tuple[bool, bool]:
    folded = text.strip().lower()
    if folded in _TRUE_TEXTS:
        return True, False
    if folded in _FALSE_TEXTS:
        return False, False
    return False, True


def convert_value(
    src: PropertyDefinition, dst: PropertyDefinition, raw: Any
) -> tuple[Any, bool]:
    """Convert an on-disk value of ``src`` into an API value of ``dst``: ``(value, lossy)``.

    Only the pairs in `KIND_TRANSFORMS` convert (others raise `InvalidValue`).
    Converting to a label adds any missing option to ``dst.options['set']``.
    """
    sk, dk = src.type, dst.type
    if sk == dk:
        return decode_value(dst, raw), False
    if dk not in KIND_TRANSFORMS.get(sk, ()):
        raise InvalidValue(f"A {sk} property can't become a {dk} property")
    if raw is None or raw == [] or raw == "":
        return empty_value(dst), False

    if sk in _DATE_KINDS:
        if dk in _DATE_KINDS:
            value = decode_value(dst, raw)
            return value, value is None
        return _scalar_text(raw), False  # the on-disk string

    if sk == "entity":
        if dk == "label":
            targets = [r["target"] for r in decode_value(src, raw)]
            value, _ = _to_label(dst, targets)
            return value, bool(targets)
        items = [_scalar_text(v) for v in _as_list(raw)]
        return ", ".join(t.strip() for t in items if t and t.strip()) or None, False

    if sk == "label":
        return ", ".join(decode_value(src, raw)) or None, False

    if sk == "number":
        n = decode_value(src, raw)
        if n is None:
            return empty_value(dst), True
        text = str(_number(n))
        if dk == "label":
            return _to_label(dst, [text])
        return text, False

    if sk == "boolean":
        return ("true" if decode_value(src, raw) else "false"), False

    # text, textBlock, url
    text = decode_value(src, raw) or ""
    if dk == "number":
        return _text_to_number(text)
    if dk == "boolean":
        return _text_to_boolean(text)
    if dk == "label":
        return _to_label(dst, [text] if text.strip() else [])
    return text or None, False
