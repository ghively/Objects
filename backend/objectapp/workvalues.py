"""M22: the codec of the three work property kinds (``steps``, ``textList``, ``floorItems``).

Each is a block YAML list in front matter (plan ``2026-11-05-m22-work-model.md``, "Property
kinds"). Reading is lenient and never assigns anything: a step without a (valid, unique) id
is served as ``@<n>`` (its 1-based position in the list) and gets a real id on the next
write. An entry that can't be read (not a mapping or a scalar, an unknown kind or state, no
text) is listed in ``problems``; the strict reads refuse such a list (`UnreadableList`), so a
write never drops an entry it couldn't read.

`encode_steps` / `encode_floor` give the mappings `set_keys` writes: known keys in their
order, only when set, then the unknown keys as they were. Timestamps and days are written
unquoted (as the export writes them); multi-line answers and results as literal blocks.

`propvalues.decode_value` / `encode_value` delegate the three kinds here. No file I/O.
"""

from __future__ import annotations

import hashlib
import json
import re
import secrets
from collections.abc import Callable, Sequence
from datetime import date
from typing import Any

from ruamel.yaml.representer import RoundTripRepresenter
from ruamel.yaml.scalarstring import LiteralScalarString

from .frontmatter import _TIMESTAMP_RE, _literal_safe
from .propvalues import InvalidValue
from .workmodel import (
    FLOOR_KEYS,
    MAX_FLOOR,
    MAX_LIST,
    MAX_LIST_TEXT,
    MAX_NOTE,
    MAX_STEP_TEXT,
    MAX_STEPS,
    STEP_KEYS,
    STEP_KINDS,
    STEP_STATES,
    FloorItem,
    Step,
)

__all__ = [
    "FLOOR_UNREADABLE",
    "STEPS_UNREADABLE",
    "UnreadableList",
    "encode_floor",
    "encode_steps",
    "encode_text_list",
    "floor_api",
    "floor_from_api",
    "floor_rev",
    "new_id",
    "read_floor",
    "read_floor_at",
    "read_floor_strict",
    "read_steps",
    "read_steps_at",
    "read_steps_strict",
    "read_text_list",
    "step_api",
    "step_rev",
    "steps_from_api",
]

STEPS_UNREADABLE = "The step list can't be read: fix it in the file first."
FLOOR_UNREADABLE = "The floor item list can't be read: fix it in the file first."  # our string

_ID_RE = re.compile(r"^[a-z0-9]{4,12}$")
_ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789"
_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_STEP_TEXT_KEYS = STEP_KEYS[4:]  # notBefore … declinedAt
_MULTILINE_KEYS = frozenset({"answer", "result"})


class UnreadableList(ValueError):
    """A list with an entry that can't be read: every write to it is refused (422)."""

    def __init__(self, problems: list[str], message: str = STEPS_UNREADABLE) -> None:
        super().__init__(message)
        self.problems = problems


class _Stamp(str):
    """A timestamp or day written plain (``2026-11-04T14:02:00.000Z``), not quoted."""


RoundTripRepresenter.add_representer(
    _Stamp, lambda rep, data: rep.represent_scalar("tag:yaml.org,2002:timestamp", str(data))
)


# -- helpers ----------------------------------------------------------------------------------


def _as_list(raw: Any) -> list[Any]:
    if raw is None:
        return []
    return list(raw) if isinstance(raw, list) else [raw]


def _scalar(v: Any) -> bool:
    return isinstance(v, (str, int, float)) and not isinstance(v, bool)


def _text(v: Any) -> str | None:
    """A stored scalar as text (``None`` for null, a mapping or a list)."""
    if v is None or isinstance(v, (dict, list)):
        return None
    if isinstance(v, bool):
        return "true" if v else "false"
    return str(v)


def _nested_key(entry: dict[str, Any], keys: Sequence[str]) -> str | None:
    """The first known key whose value is a mapping or a list (it can't be kept as text, so the
    entry is a problem and the strict reads refuse writes instead of dropping it)."""
    return next((k for k in keys if isinstance(entry.get(k), (dict, list))), None)


def _valid_id(v: Any) -> str | None:
    if isinstance(v, bool) or not isinstance(v, (str, int)):
        return None
    text = str(v)
    return text if _ID_RE.match(text) else None


def _out(key: str, value: str) -> Any:
    """How one string value is written inside a mapping."""
    if key in _MULTILINE_KEYS and "\n" in value and _literal_safe(value):
        return LiteralScalarString(value)
    if _TIMESTAMP_RE.fullmatch(value):
        return _Stamp(value)
    return value


def _out_extra(value: Any) -> Any:
    if isinstance(value, str) and type(value) is str and _TIMESTAMP_RE.fullmatch(value):
        return _Stamp(value)
    return value


def _rev(mapping: dict[str, Any], ident: str | None, n: int) -> str:
    data = dict(mapping)
    if ident is None:
        data["@"] = f"@{n}"
    canon = json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()[:12]


def new_id(taken: set[str]) -> str:
    """A fresh 6-character id (``[a-z0-9]``, from `secrets`) not in ``taken``."""
    while True:
        ident = "".join(secrets.choice(_ID_CHARS) for _ in range(6))
        if ident not in taken:
            return ident


def _fill_ids(
    ids: list[str | None], new: Callable[[set[str]], str]
) -> list[str]:
    """Each entry's id: a valid id that doesn't repeat an earlier one is kept, others are new."""
    seen: set[str] = set()
    keep: list[str | None] = []
    for ident in ids:
        ident = _valid_id(ident)
        if ident is not None and ident not in seen:
            seen.add(ident)
            keep.append(ident)
        else:
            keep.append(None)
    taken = set(seen)
    out: list[str] = []
    for ident in keep:
        if ident is None:
            ident = new(taken)
            taken.add(ident)
        out.append(ident)
    return out


# -- steps ------------------------------------------------------------------------------------


def _step_mapping(step: Step) -> dict[str, Any]:
    """The step as stored: known keys when set, in order, then the unknown keys."""
    out: dict[str, Any] = {}
    for key in STEP_KEYS:
        value = getattr(step, key)
        if value is not None:
            out[key] = value
    for key, value in step.extra.items():
        if key not in out:
            out[key] = value
    return out


def read_steps_at(raw: Any) -> tuple[list[tuple[int, Step]], list[str]]:
    """The readable steps with their 1-based positions in the list, and the problems.

    An id that isn't ``[a-z0-9]{4,12}`` or repeats an earlier one reads as ``None``.
    """
    out: list[tuple[int, Step]] = []
    problems: list[str] = []
    seen: set[str] = set()
    for n, entry in enumerate(_as_list(raw), start=1):
        if _scalar(entry) or entry is None:
            text = _text(entry) or ""
            if not text.strip():
                problems.append(f"Step {n} has no text.")
                continue
            out.append((n, Step(id=None, kind="do", state="open", text=text)))
            continue
        if not isinstance(entry, dict):
            problems.append(f"Step {n} can't be read.")
            continue
        nested = _nested_key(entry, STEP_KEYS)
        if nested is not None:
            problems.append(f"Step {n}'s {nested} isn't text.")
            continue
        kind_text = _text(entry.get("kind"))
        kind = kind_text.strip().lower() if kind_text is not None else ""
        if kind not in STEP_KINDS:
            if kind_text is None or not kind_text.strip():
                problems.append(f"Step {n} has no kind.")
            else:
                problems.append(f'Step {n} has an unknown kind "{kind_text.strip()}".')
            continue
        state_text = _text(entry.get("state"))
        state = state_text.strip().lower() if state_text is not None and state_text.strip() else "open"
        if state not in STEP_STATES:
            problems.append(f'Step {n} has an unknown state "{state_text.strip()}".')  # type: ignore[union-attr]
            continue
        text = _text(entry.get("text")) or ""
        if not text.strip():
            problems.append(f"Step {n} has no text.")
            continue
        ident = _valid_id(entry.get("id"))
        if ident is not None and ident in seen:
            ident = None
        if ident is not None:
            seen.add(ident)
        values = {k: _text(entry.get(k)) for k in _STEP_TEXT_KEYS}
        extra = {k: v for k, v in entry.items() if k not in STEP_KEYS}
        out.append(
            (n, Step(id=ident, kind=kind, state=state, text=text, extra=extra, **values))  # type: ignore[arg-type]
        )
    return out, problems


def read_steps(raw: Any) -> tuple[list[Step], list[str]]:
    """Lenient: the readable steps (``id`` None when missing, bad or repeated) and the problems."""
    at, problems = read_steps_at(raw)
    return [s for _n, s in at], problems


def read_steps_strict(raw: Any) -> list[Step]:
    """The steps; `UnreadableList` when any entry can't be read."""
    steps, problems = read_steps(raw)
    if problems:
        raise UnreadableList(problems)
    return steps


def step_rev(step: Step, n: int) -> str:
    """The first 12 hex characters of sha256 of the step's canonical JSON (``@n`` when id-less)."""
    return _rev(_step_mapping(step), step.id, n)


def step_api(step: Step, n: int) -> dict[str, Any]:
    """The `StepValue` of a step at 1-based position ``n``."""
    return {
        "id": step.id or f"@{n}",
        "rev": step_rev(step, n),
        "kind": step.kind,
        "state": step.state,
        "text": step.text,
        **{k: getattr(step, k) for k in _STEP_TEXT_KEYS},
    }


def encode_steps(
    steps: Sequence[Step], new_id: Callable[[set[str]], str] = new_id
) -> list[dict[str, Any]] | None:
    """The mappings to write, ids filled (valid ones kept); ``None`` when there are none."""
    if not steps:
        return None
    ids = _fill_ids([s.id for s in steps], new_id)
    out: list[dict[str, Any]] = []
    for ident, step in zip(ids, steps, strict=True):
        m: dict[str, Any] = {"id": ident}
        for key in STEP_KEYS[1:]:
            value = getattr(step, key)
            if value is not None:
                m[key] = _out(key, value)
        for key, value in step.extra.items():
            if key not in m:
                m[key] = _out_extra(value)
        out.append(m)
    return out


def _one_line(text: str, what: str, limit: int, line_message: str) -> str:
    text = text.strip()
    if "\n" in text or "\r" in text:
        raise InvalidValue(line_message)
    if not text:
        raise InvalidValue(f"{what} needs a text.")
    if len(text) > limit:
        raise InvalidValue(f"{what} is at most {limit} characters.")
    return text


def steps_from_api(value: Any) -> list[Step]:
    """New steps from API values (``[{kind, text, …}]``) for a create; all must be open."""
    if not isinstance(value, list):
        raise InvalidValue("Expected a list of steps.")
    if len(value) > MAX_STEPS:
        raise InvalidValue(f"At most {MAX_STEPS} steps.")
    steps: list[Step] = []
    for item in value:
        if isinstance(item, str):
            item = {"kind": "do", "text": item}
        if not isinstance(item, dict):
            raise InvalidValue("A step is {kind, text}.")
        state = item.get("state")
        if state is not None and str(state).strip().lower() != "open":
            raise InvalidValue("New steps start open.")
        kind = str(item.get("kind") or "").strip().lower()
        if kind not in STEP_KINDS:
            raise InvalidValue(f'Unknown step kind "{item.get("kind")}".')
        if not isinstance(item.get("text"), str):
            raise InvalidValue("A step needs a text.")
        text = _one_line(item["text"], "A step", MAX_STEP_TEXT, "A step is one line.")
        values: dict[str, str | None] = {}
        for key in _STEP_TEXT_KEYS:
            v = item.get(key)
            if v is None:
                continue
            if not isinstance(v, str):
                raise InvalidValue(f'Expected text for "{key}".')
            if key in _MULTILINE_KEYS and len(v) > MAX_NOTE:
                raise InvalidValue(f"At most {MAX_NOTE} characters.")
            values[key] = v or None
        steps.append(
            Step(id=_valid_id(item.get("id")), kind=kind, state="open", text=text, **values)  # type: ignore[arg-type]
        )
    return steps


# -- text lists -------------------------------------------------------------------------------


def read_text_list(raw: Any) -> list[str]:
    """The texts of a ``textList`` (a scalar reads as one item; blanks and mappings are skipped)."""
    out: list[str] = []
    for item in _as_list(raw):
        text = _text(item)
        if text is not None and text.strip():
            out.append(text)
    return out


def encode_text_list(value: Any) -> list[str] | None:
    """The list to write (empty items dropped); ``None`` when empty. `InvalidValue` on a bad item."""
    if value is None:
        return None
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise InvalidValue("Expected a list of texts.")
    items: list[str] = []
    for v in value:
        if not v.strip():
            continue
        items.append(_one_line(v, "An item", MAX_LIST_TEXT, "One line per item."))
    if len(items) > MAX_LIST:
        raise InvalidValue(f"At most {MAX_LIST} items.")
    return items or None


# -- floor items ------------------------------------------------------------------------------


def _floor_mapping(item: FloorItem) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in FLOOR_KEYS:
        value = getattr(item, key)
        if value is not None:
            out[key] = value
    for key, value in item.extra.items():
        if key not in out:
            out[key] = value
    return out


def read_floor_at(raw: Any) -> tuple[list[tuple[int, FloorItem]], list[str]]:
    """The readable floor items with their 1-based positions, and the problems."""
    out: list[tuple[int, FloorItem]] = []
    problems: list[str] = []
    seen: set[str] = set()
    for n, entry in enumerate(_as_list(raw), start=1):
        if not isinstance(entry, dict):
            problems.append(f"Floor item {n} can't be read.")
            continue
        nested = _nested_key(entry, FLOOR_KEYS)
        if nested is not None:
            problems.append(f"Floor item {n}'s {nested} isn't text.")
            continue
        place, what = _text(entry.get("place")), _text(entry.get("what"))
        place = place if place and place.strip() else None
        what = what if what and what.strip() else None
        if place is None and what is None:
            problems.append(f"Floor item {n} has no place or what.")
            continue
        ident = _valid_id(entry.get("id"))
        if ident is not None and ident in seen:
            ident = None
        if ident is not None:
            seen.add(ident)
        extra = {k: v for k, v in entry.items() if k not in FLOOR_KEYS}
        out.append(
            (
                n,
                FloorItem(
                    id=ident,
                    place=place,
                    what=what,
                    collected=_text(entry.get("collected")),
                    found=_text(entry.get("found")),
                    extra=extra,
                ),
            )
        )
    return out, problems


def read_floor(raw: Any) -> tuple[list[FloorItem], list[str]]:
    at, problems = read_floor_at(raw)
    return [i for _n, i in at], problems


def read_floor_strict(raw: Any) -> list[FloorItem]:
    items, problems = read_floor(raw)
    if problems:
        raise UnreadableList(problems, FLOOR_UNREADABLE)
    return items


def floor_rev(item: FloorItem, n: int) -> str:
    return _rev(_floor_mapping(item), item.id, n)


def floor_api(item: FloorItem, n: int) -> dict[str, Any]:
    """The `FloorItemValue` of an item at 1-based position ``n``."""
    return {
        "id": item.id or f"@{n}",
        "rev": floor_rev(item, n),
        "place": item.place,
        "what": item.what,
        "collected": item.collected,
        "found": item.found,
    }


def encode_floor(
    items: Sequence[FloorItem], new_id: Callable[[set[str]], str] = new_id
) -> list[dict[str, Any]] | None:
    """The mappings to write, ids filled; ``None`` when there are none."""
    if not items:
        return None
    ids = _fill_ids([i.id for i in items], new_id)
    out: list[dict[str, Any]] = []
    for ident, item in zip(ids, items, strict=True):
        m: dict[str, Any] = {"id": ident}
        for key in FLOOR_KEYS[1:]:
            value = getattr(item, key)
            if value is not None:
                m[key] = _out(key, value)
        for key, value in item.extra.items():
            if key not in m:
                m[key] = _out_extra(value)
        out.append(m)
    return out


def _is_day(text: str) -> bool:
    if not _DAY_RE.match(text):
        return False
    try:
        date.fromisoformat(text)
    except ValueError:
        return False
    return True


def _opt_text(item: dict[str, Any], key: str) -> str | None:
    v = item.get(key)
    if v is None:
        return None
    if not isinstance(v, str):
        raise InvalidValue(f'Expected text for "{key}".')
    return v.strip() or None


def floor_from_api(value: Any, existing_raw: Any = None) -> list[FloorItem]:
    """Floor items from API values (`FloorItemValue`-like), keeping the stored unknown keys.

    An item is matched to the stored one by id (``@n`` by position). A stored list that
    can't be read is refused (`UnreadableList`).
    """
    if isinstance(value, dict):
        value = [value]
    if not isinstance(value, list):
        raise InvalidValue("Expected a list of floor items.")
    if len(value) > MAX_FLOOR:
        raise InvalidValue(f"At most {MAX_FLOOR} floor items.")
    stored_at, problems = read_floor_at(existing_raw)
    if problems:
        raise UnreadableList(problems, FLOOR_UNREADABLE)
    by_ref = {(i.id or f"@{n}"): i for n, i in stored_at}
    out: list[FloorItem] = []
    for item in value:
        if not isinstance(item, dict):
            raise InvalidValue("A floor item is {place, what, collected, found}.")
        place, what = _opt_text(item, "place"), _opt_text(item, "what")
        if place is None and what is None:
            raise InvalidValue("A floor item needs a place or what to collect.")
        collected = _opt_text(item, "collected")
        if collected is not None and not _is_day(collected):
            raise InvalidValue("Collected is a day (YYYY-MM-DD).")
        found = item.get("found")
        if found is not None and not isinstance(found, str):
            raise InvalidValue('Expected text for "found".')
        if found is not None and len(found) > MAX_NOTE:
            raise InvalidValue(f"At most {MAX_NOTE} characters.")
        ref = item.get("id")
        stored = by_ref.get(ref) if isinstance(ref, str) else None
        out.append(
            FloorItem(
                id=_valid_id(ref),
                place=place,
                what=what,
                collected=collected,
                found=found or None,
                extra=dict(stored.extra) if stored is not None else {},
            )
        )
    return out
