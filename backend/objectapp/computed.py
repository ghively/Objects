"""M12 computed values (formulas and rollups) and the type-save checks they need.

A `Computer` answers the ``ComputedValue`` of each formula and rollup property of an
object, for one request: it reads only the space's in-memory scan (frontmatter already
parsed, links resolved by the space's resolver), never a file, and nothing it computes is
written anywhere. Parsed expressions are cached by text (`formula.parse_cached`); values
are remembered only for the request (formulas with ``now()``/``today()`` change daily).

`check_type` is the save-time validation: expressions parse, no formula/rollup cycle, a
rollup's relation is an ``entity`` property of the type and its target is not a rollup,
the ID's prefix rule and ``nextNumber = max(stored, sent)``. `rename_in_formulas` rewrites
``prop("Old")`` to ``prop("New")`` for the properties a save renames.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import PurePosixPath
from typing import TYPE_CHECKING, Any

from .formula import (
    MAX_EXPRESSION,
    FDate,
    FormulaError,
    compute,
    error_value,
    parse_cached,
    parse_date_text,
    references,
    rename_references,
    to_computed,
)
from .propvalues import InvalidValue, decode_value
from .rollup import ROLLUP_CALCS, rollup_value

if TYPE_CHECKING:
    from .space import ObjectSummary, Space
    from .typemodel import PropertyDefinition, TypeDefinition

__all__ = [
    "COMPUTED_KINDS",
    "Computer",
    "Obj",
    "check_type",
    "find_prop",
    "has_computed",
    "rename_in_formulas",
]

COMPUTED_KINDS = frozenset({"formula", "rollup"})
"""The kinds whose values the server computes (never in frontmatter)."""

# The system properties a formula can name even when the type lacks the definition.
SYSTEM_NAMES = {
    "title": "title",
    "description": "description",
    "tags": "tags",
    "created at": "createdAt",
    "last updated": "lastUpdated",
    "aliases": "aliases",
}
PREFIX_RE = re.compile(r"^[A-Za-z0-9_-]{0,20}$")


def has_computed(t: TypeDefinition | None) -> bool:
    return t is not None and any(p.type in COMPUTED_KINDS for p in t.propertyDefinitions)


def find_prop(t: TypeDefinition | None, name: str) -> PropertyDefinition | None:
    """The property ``prop("name")`` reads: by name exactly, then case-insensitively."""
    defs = t.propertyDefinitions if t is not None else []
    for p in defs:
        if p.name == name:
            return p
    folded = name.casefold()
    for p in defs:
        if p.name.casefold() == folded:
            return p
    key = SYSTEM_NAMES.get(folded)
    if key is not None:
        from .typemodel import system_property_defs

        return next((p for p in system_property_defs() if p.key == key), None)
    return None


@dataclass
class Obj:
    """One object as a formula sees it."""

    path: str
    fm: dict
    summary: ObjectSummary | None
    t: TypeDefinition | None
    links: dict[str, list[str | None]] | None = None
    """Each relation's resolved paths when the caller has them already (rows do)."""


class _Failed:
    __slots__ = ("message",)

    def __init__(self, message: str) -> None:
        self.message = message


def _text(v: Any) -> str | None:
    if isinstance(v, str):
        return v if v != "" else None
    return None


def _date_of(v: Any) -> FDate | None:
    """An API date value (``{start, end?}``) or a stamp string as `FDate` (the start; end kept)."""
    if isinstance(v, dict):
        start = parse_date_text(str(v.get("start") or ""))
        if start is None:
            return None
        end = parse_date_text(str(v.get("end") or "")) if v.get("end") else None
        return FDate(start.start, end.start if end is not None else None)
    if isinstance(v, datetime):
        return FDate(v)
    if isinstance(v, str):
        return parse_date_text(v)
    return None


class _Env:
    __slots__ = ("c", "now", "obj", "tz")

    def __init__(self, c: Computer, obj: Obj) -> None:
        self.c = c
        self.obj = obj
        self.now = c.now
        self.tz = c.tz

    def prop(self, name: str) -> Any:
        p = self.c.find(self.obj.t, name)
        if p is None:
            raise FormulaError(f'Unknown property "{name}".')
        return self.c.internal(self.obj, p)


class Computer:
    """Computes formula and rollup values for one request (see the module docstring)."""

    def __init__(
        self,
        space: Space,
        now: datetime | None = None,
        types: dict[str, TypeDefinition] | None = None,
    ) -> None:
        self.space = space
        self.now = now or space.clock()
        self.tz = space.tz
        self._types = types or {}
        self._memo: dict[tuple[str, str], Any] = {}
        self._active: set[tuple[str, str]] = set()
        # Per-request lookups (a related object is usually shared by many rows).
        self._type_cache: dict[str, TypeDefinition | None] = {}
        self._objs: dict[str, Obj | None] = {}
        self._related: dict[tuple[str, str], list[Obj]] = {}
        self._stored_memo: dict[tuple[str, str], Any] = {}
        self._by_id: dict[int, dict[str, PropertyDefinition]] = {}
        self._by_name: dict[tuple[int, str], PropertyDefinition | None] = {}

    def find(self, t: TypeDefinition | None, name: str) -> PropertyDefinition | None:
        """`find_prop`, remembered per type and name for the request."""
        key = (id(t), name)
        if key not in self._by_name:
            self._by_name[key] = find_prop(t, name)
        return self._by_name[key]

    def prop_by_id(self, t: TypeDefinition | None, pid: str) -> PropertyDefinition | None:
        if t is None:
            return None
        table = self._by_id.get(id(t))
        if table is None:
            table = self._by_id[id(t)] = {p.id: p for p in t.propertyDefinitions}
        return table.get(pid)

    # -- objects ---------------------------------------------------------------------------

    def type_of(self, type_id: str | None) -> TypeDefinition | None:
        if type_id is None:
            return None
        if type_id not in self._type_cache:
            self._type_cache[type_id] = self._types.get(type_id) or self.space.type_by_id(type_id)
        return self._type_cache[type_id]

    def obj(self, path: str) -> Obj | None:
        """The object at ``path`` from the space's memory (None when unknown)."""
        if path in self._objs:
            return self._objs[path]
        space = self.space
        with space._lock:
            raw = space._raw.get(path)
            summary = space._summaries.get(path)
        o = None
        if raw is not None and summary is not None and summary.template is None:
            o = Obj(path, raw.fm, summary, self.type_of(summary.type))
        self._objs[path] = o
        return o

    def related(self, obj: Obj, rel: PropertyDefinition) -> list[Obj]:
        """The objects relation ``rel`` of ``obj`` links to (resolved; dangling links skipped)."""
        key = (obj.path, rel.id)
        hit = self._related.get(key)
        if hit is not None:
            return hit
        out: list[Obj] = []
        seen: set[str] = set()
        if obj.links is not None and rel.key in obj.links:
            paths = obj.links[rel.key]
        else:
            paths = [
                self.space.resolve(ref["target"], obj.path)
                for ref in decode_value(rel, obj.fm.get(rel.key))
            ]
        for path in paths:
            if path is None or path in seen:
                continue
            seen.add(path)
            o = self.obj(path)
            if o is not None:
                out.append(o)
        self._related[key] = out
        return out

    def target_value(self, obj: Obj, target_id: str) -> Any:
        """A rollup target's value on one related object (empty when its type lacks it)."""
        if target_id == "title":
            return self._title(obj)
        p = self.prop_by_id(obj.t, target_id)
        if p is None:
            return None
        if p.type == "rollup":
            raise FormulaError("A rollup can't use another rollup.")
        return self.internal(obj, p)

    # -- values ----------------------------------------------------------------------------

    def values(self, obj: Obj) -> dict[str, dict[str, Any]]:
        """``{key: ComputedValue}`` of the object's formula and rollup properties."""
        out: dict[str, dict[str, Any]] = {}
        if obj.t is None:
            return out
        for p in obj.t.propertyDefinitions:
            if p.type in COMPUTED_KINDS:
                out[p.key] = self.computed_value(obj, p)
        return out

    def computed_value(self, obj: Obj, p: PropertyDefinition) -> dict[str, Any]:
        try:
            return to_computed(self._computed_internal(obj, p))
        except FormulaError as exc:
            return error_value(str(exc))

    def evaluate(self, obj: Obj, expression: str) -> dict[str, Any]:
        """``expression``'s value on ``obj`` (the formula preview)."""
        return compute(expression, _Env(self, obj))

    def internal(self, obj: Obj, p: PropertyDefinition) -> Any:
        """The formula-language value of property ``p`` of ``obj``. Raises `FormulaError`."""
        if p.type in COMPUTED_KINDS:
            return self._computed_internal(obj, p)
        key = (obj.path, p.id)
        if key in self._stored_memo:
            return self._stored_memo[key]
        value = self._stored(obj, p)
        self._stored_memo[key] = value
        return value

    def _computed_internal(self, obj: Obj, p: PropertyDefinition) -> Any:
        key = (obj.path, p.id)
        hit = self._memo.get(key, self)
        if hit is not self:
            if isinstance(hit, _Failed):
                raise FormulaError(hit.message)
            return hit
        if key in self._active:
            raise FormulaError(f'"{p.name}" refers to itself.')
        self._active.add(key)
        try:
            if p.type == "formula":
                expression = p.options.get("expression")
                if not isinstance(expression, str) or not expression.strip():
                    value: Any = None
                else:
                    from .formula import evaluate

                    value = evaluate(parse_cached(expression), _Env(self, obj))
            else:
                value = rollup_value(self, obj, p)
        except FormulaError as exc:
            self._memo[key] = _Failed(str(exc))
            raise
        except (OverflowError, ValueError, ArithmeticError) as exc:
            # Rollup arithmetic runs outside `evaluate`'s guard: a huge number is an error value.
            self._memo[key] = _Failed("The number is too large.")
            raise FormulaError("The number is too large.") from exc
        finally:
            self._active.discard(key)
        self._memo[key] = value
        return value

    def _title(self, obj: Obj) -> str | None:
        title = obj.fm.get("title")
        if isinstance(title, str) and title.strip():
            return title
        return obj.summary.title if obj.summary is not None and obj.summary.title else None

    def _link_title(self, target: str, from_path: str) -> str:
        path = self.space.resolve(target, from_path)
        if path is not None:
            with self.space._lock:
                s = self.space._summaries.get(path)
            if s is not None and s.title:
                return s.title
        return target

    def _stored(self, obj: Obj, p: PropertyDefinition) -> Any:
        """A stored property's value in the formula language (contract "Property values")."""
        kind = p.type
        fm = obj.fm
        raw = fm.get(p.key)
        if kind == "entity_title":
            return self._title(obj)
        if kind in ("entity_createdAt", "entity_lastUpdated"):
            if raw is None and obj.summary is not None:
                raw = obj.summary.createdAt if kind == "entity_createdAt" else obj.summary.lastUpdated
            return _date_of(raw if isinstance(raw, (str, datetime)) else str(raw or ""))
        if kind == "entity_type":
            return obj.t.name if obj.t is not None else None
        if kind == "entity_collections":
            return list(obj.summary.collections) if obj.summary is not None else []
        if kind == "entity_backlinks":
            return [self._link_title(src, obj.path) for src in self.space.links.backlinks(obj.path)]
        if kind == "entity_icon":
            return None
        value = decode_value(p, raw, fm)
        if kind in ("number", "boolean"):
            return value
        if kind in ("datetime", "datetimeSimple"):
            return _date_of(value)
        if kind == "label":
            multi = p.options.get("isArray") is True
            if multi:
                return list(value)
            return value[0] if value else None
        if kind == "entity":
            return [self._link_title(r["target"], obj.path) for r in value]
        if kind in ("entity_tags", "entity_aliases"):
            return list(value)
        if kind == "files":
            return [PurePosixPath(v).name for v in value]
        return _text(value)


# -- type save -------------------------------------------------------------------------------


def rename_in_formulas(old: TypeDefinition, new: TypeDefinition) -> None:
    """Rewrite ``prop("Old")`` to ``prop("New")`` in ``new``'s formulas for each renamed property.

    A reference is renamed when, under ``old``'s definitions, it named the renamed property.
    """
    new_by_id = {p.id: p for p in new.propertyDefinitions}
    renamed = {
        p.id: new_by_id[p.id].name
        for p in old.propertyDefinitions
        if p.id in new_by_id and new_by_id[p.id].name != p.name
    }
    if not renamed:
        return

    def rename(name: str) -> str | None:
        p = find_prop(old, name)
        if p is None or p.id not in renamed:
            return None
        return renamed[p.id]

    for p in new.propertyDefinitions:
        if p.type != "formula":
            continue
        expression = p.options.get("expression")
        if isinstance(expression, str) and expression:
            p.options["expression"] = rename_references(expression, rename)


def _formula_refs(t: TypeDefinition, p: PropertyDefinition) -> list[PropertyDefinition]:
    expression = p.options.get("expression")
    if not isinstance(expression, str) or not expression.strip():
        return []
    try:
        node = parse_cached(expression)
    except FormulaError:
        return []
    out = []
    for name in references(node):
        q = find_prop(t, name)
        if q is not None:
            out.append(q)
    return out


def _rollup_targets(
    t: TypeDefinition, p: PropertyDefinition, types: dict[str, TypeDefinition]
) -> list[tuple[TypeDefinition, PropertyDefinition]]:
    """(type, property) pairs rollup ``p`` of ``t`` may read on its related objects."""
    rel_id, target_id = p.options.get("relationId"), p.options.get("targetId")
    if not rel_id or not isinstance(target_id, str) or not target_id or target_id == "title":
        return []
    rel = next((q for q in t.propertyDefinitions if q.id == rel_id), None)
    if rel is None or rel.type != "entity":
        return []
    allowed = [a for a in rel.options.get("allowedTypes") or [] if isinstance(a, str)]
    candidates = [types[a] for a in allowed if a in types] if allowed else list(types.values())
    out = []
    for c in candidates:
        q = next((x for x in c.propertyDefinitions if x.id == target_id), None)
        if q is not None:
            out.append((c, q))
    return out


def _is_relation(t: TypeDefinition, pid: str) -> bool:
    rel = next((q for q in t.propertyDefinitions if q.id == pid), None)
    return rel is not None and rel.type == "entity"


def _kept_broken(old: TypeDefinition, p: PropertyDefinition, rel_id: str) -> bool:
    """True when rollup ``p`` is stored as it is, already without a valid relation.

    A type file written that way (by hand, or by an older version) must not lock the type: the
    rollup evaluates to empty, and the type's other edits still save. A rollup that loses its
    relation in this very save is still refused.
    """
    before = next((q for q in old.propertyDefinitions if q.id == p.id), None)
    return (
        before is not None
        and before.type == "rollup"
        and before.options == p.options
        and not _is_relation(old, rel_id)
    )


def check_type(
    old: TypeDefinition, new: TypeDefinition, types: dict[str, TypeDefinition]
) -> None:
    """Validate ``new``'s formula, rollup and ID properties (`InvalidValue`, the API's 422).

    ``types`` is every type by id (``new`` replaces its stored self). Also keeps each ID's
    ``nextNumber`` at least the stored one.
    """
    types = {**types, new.id: new}
    old_by_id = {p.id: p for p in old.propertyDefinitions}
    for p in new.propertyDefinitions:
        if p.type == "formula":
            expression = p.options.get("expression", "")
            if expression is None:
                expression = p.options["expression"] = ""
            if not isinstance(expression, str):
                raise InvalidValue(f'"{p.name}": the formula must be text.')
            if len(expression) > MAX_EXPRESSION:
                raise InvalidValue(f'"{p.name}": the formula is longer than {MAX_EXPRESSION} characters.')
            if expression.strip():
                try:
                    parse_cached(expression)
                except FormulaError as exc:
                    raise InvalidValue(f'"{p.name}": {str(exc).rstrip(".")}.') from exc
        elif p.type == "rollup":
            rel_id = p.options.get("relationId", "")
            target_id = p.options.get("targetId", "")
            calc = p.options.get("calc", "showOriginal")
            if not isinstance(rel_id, str) or not isinstance(target_id, str):
                raise InvalidValue(f'"{p.name}": the relation and the property are ids.')
            if calc not in ROLLUP_CALCS:
                raise InvalidValue(f'"{p.name}": unknown calculation "{calc}".')
            if rel_id and not _is_relation(new, rel_id) and not _kept_broken(old, p, rel_id):
                raise InvalidValue(f'"{p.name}": the rollup\'s relation must be a relation property of this type.')
            for _c, q in _rollup_targets(new, p, types):
                if q.type == "rollup":
                    raise InvalidValue(f'"{p.name}": a rollup can\'t use another rollup.')
        elif p.type == "uniqueId":
            prefix = p.options.get("prefix", "")
            if prefix is None:
                prefix = ""
            if not isinstance(prefix, str) or not PREFIX_RE.match(prefix):
                raise InvalidValue(
                    f'"{p.name}": the prefix is at most 20 letters, digits, "-" or "_".'
                )
            p.options["prefix"] = prefix
            sent = p.options.get("nextNumber")
            sent_n = sent if isinstance(sent, int) and not isinstance(sent, bool) and sent >= 1 else 1
            before = old_by_id.get(p.id)
            stored = before.options.get("nextNumber") if before is not None else None
            stored_n = (
                stored if isinstance(stored, int) and not isinstance(stored, bool) and stored >= 1 else 1
            )
            p.options["nextNumber"] = max(stored_n, sent_n)
    _check_cycles(new, types)


def _check_cycles(new: TypeDefinition, types: dict[str, TypeDefinition]) -> None:
    """Refuse a formula or rollup of ``new`` that reaches itself through formulas and rollups."""

    def edges(t: TypeDefinition, p: PropertyDefinition) -> list[tuple[TypeDefinition, PropertyDefinition]]:
        if p.type == "formula":
            return [(t, q) for q in _formula_refs(t, p) if q.type in COMPUTED_KINDS]
        if p.type == "rollup":
            return [(c, q) for c, q in _rollup_targets(t, p, types) if q.type in COMPUTED_KINDS]
        return []

    for start in new.propertyDefinitions:
        if start.type not in COMPUTED_KINDS:
            continue
        goal = (new.id, start.id)
        seen: set[tuple[str, str]] = set()
        stack = list(edges(new, start))
        while stack:
            t, q = stack.pop()
            node = (t.id, q.id)
            if node == goal:
                raise InvalidValue(
                    f'"{start.name}" refers to itself (directly or through other formulas or rollups).'
                )
            if node in seen:
                continue
            seen.add(node)
            stack.extend(edges(t, q))
