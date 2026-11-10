"""M30: checking one filing decision's entity candidates against its page (design 2026-11-09,
sections 5 and 5a; plan ``2026-11-09-m30-entity-extraction.md``, Task 2).

On a batch kept as Sources the AI filing pass returns, per page, its **main entity** (what the page
is mainly about), the **entity candidates** it mentions, short **summary lines** about each, the
**relations** between them and the agent's **merges** (the extended decision of the Contract).
`check_candidates` checks each against the page by M27's rules (`filing._check_quote`: the quote is
in the document, has at least ``filing.MIN_QUOTE`` characters and says the value) and the type
model, and answers them with ``ok`` and, when not ok, a ``reason``. It reads only; nothing here
writes.

Shapes (stored in each result of M27's ``filing.json``)::

    CheckedEntity = {"typeId", "type", "name", "aliases": [str],
                     "values": [{"key", "value", "quote", "ok", "reason"?}],
                     "lines": [{"text", "quote", "ok", "reason"?}],
                     "confidence", "main": bool, "ok": bool, "reason"?: str}
    CheckedRelation = {"subject", "relation", "object", "quote", "confidence", "plain": bool,
                       "ok": bool, "reason"?: str}

The rules (Task 2; the reasons are ours):

- type: an importable type of the space (`planner.importable_type`), by name; the Source type is
  never an entity's (a Source is made by the import).
- name: non-empty and in the page (``filing._norm``); aliases the page doesn't say are dropped.
- values: as M27's `filing.apply_decision` checks them against the type (no object exists yet, so
  none "already has a value"); never an ``entity`` property (relations go in ``relations``), never
  ``sources`` (the import sets it), never a synced property (M29). An ok value carries the value as
  the property takes it (a label's option text, a converted number or date).
- lines: at most `MAX_LINES_PER_CANDIDATE` per candidate (the rest dropped), each one line of 1 to
  `MAX_LINE` characters, its quote in the page.
- relations: the quote names the object and, unless the subject is the page's main entity, the
  subject (its name or an alias); ``plain`` when the relation's name is no relation property of an
  importable type and no M28 counterpart (a plain relation is still ok).
- merges: at least two names, of an importable type.
- confidence: a candidate's own when it is one of ``filing.CONFIDENCE``, else its decision's.

A failing value or line keeps its candidate ok; a failing type or name fails the candidate.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from ..counterparts import counterpart_specs, find_relation
from ..typedefs import SYSTEM_KEYS
from . import filing, kinds, planner, sources

if TYPE_CHECKING:
    from ..space import Space
    from ..typemodel import TypeDefinition

__all__ = ["MAX_LINE", "MAX_LINES_PER_CANDIDATE", "MIN_PAGES", "check_candidates"]

MIN_PAGES = 2
"""The entity rule: a candidate more than one page mentions becomes an object (`entities.resolve`)."""

MAX_LINE = 200
"""Characters in one summary line."""

MAX_LINES_PER_CANDIDATE = 3
"""Summary lines kept per candidate; the rest are dropped."""

# Our texts (the plan's Task 2 rules).
NO_TYPE = "no such type"
SOURCE_TYPE = "a Source is made by the import, not distilled"
NAME_NOT_IN_PAGE = "the name is not in the page"
NOT_A_PROPERTY = "not a property of the type"
IN_RELATIONS = "relations go in relations"
SETS_SOURCES = "the import sets Sources"
SYNCED = "synced; not filled by the import"
ONE_SENTENCE = "a summary line is one short sentence"
BOTH_SIDES = "the quote does not name both sides"
TWO_NAMES = "a merge needs at least two names"


def _items(rows: Any) -> list[dict[str, Any]]:
    return [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []


def _strings(rows: Any) -> list[str]:
    return [r.strip() for r in rows if isinstance(r, str) and r.strip()] if isinstance(rows, list) else []


def _text(v: Any) -> str:
    return v.strip() if isinstance(v, str) else ""


def _confidence(v: Any, default: str) -> str:
    return v if v in filing.CONFIDENCE else default


def _fold(name: str) -> str:
    return " ".join(name.split()).casefold()


def _entity_type(space: Space, wanted: str) -> tuple[TypeDefinition | None, str | None]:
    """(the type, None) for a type that can hold entities, else (the type or None, why not)."""
    t = space.type_by_id(space._type_id(wanted)) if wanted else None
    if t is not None and t.id == sources.SOURCE_TYPE_ID:
        return t, SOURCE_TYPE
    if t is None or not planner.importable_type(t):
        return None, NO_TYPE
    return t, None


def _value(t: TypeDefinition, doc: str, row: dict[str, Any]) -> dict[str, Any]:
    """One value, checked as M27's `filing.apply_decision` checks a value against the type."""
    key = str(row.get("key") or "")
    entry: dict[str, Any] = {"key": key, "value": row.get("value"), "quote": str(row.get("quote") or ""), "ok": False}
    pdef = t.prop(key)
    if pdef is None or key in SYSTEM_KEYS:
        entry["reason"] = NOT_A_PROPERTY
        return entry
    if key == "sources":
        entry["reason"] = SETS_SOURCES
        return entry
    if pdef.synced is not None:
        entry["reason"] = SYNCED
        return entry
    kind = pdef.type
    if kind == "entity":
        entry["reason"] = IN_RELATIONS
        return entry
    if kind not in filing.kinds_supported():
        entry["reason"] = f"{kind} properties are not filled by the pass"
        return entry
    value = row.get("value")
    why = filing._check_quote(doc, value, row.get("quote"), kind)
    if why:
        entry["reason"] = why
        return entry
    if kind == "label":
        value = filing._label_value(pdef, value)
        if value is None:
            entry["reason"] = "not an option of the property"
            return entry
    else:
        value, bad = kinds.convert(value, kind, bool(pdef.options.get("isArray")), cells=False)
        if bad or value is None:
            entry["reason"] = "does not fit the property's kind"
            return entry
    entry["value"] = value
    entry["ok"] = True
    return entry


def _line(doc: str, row: dict[str, Any]) -> dict[str, Any]:
    """One summary line: one short sentence whose quote is in the page."""
    raw, quote = row.get("text"), row.get("quote")
    text = raw.strip() if isinstance(raw, str) else ""
    entry: dict[str, Any] = {"text": text, "quote": str(quote or ""), "ok": False}
    if not text or len(text) > MAX_LINE or "\n" in text or "\r" in text:
        entry["reason"] = ONE_SENTENCE
        return entry
    why = filing._check_quote(doc, quote, quote, "text")
    if why:
        entry["reason"] = why
        return entry
    entry["ok"] = True
    return entry


def _entity(space: Space, doc: str, cand: dict[str, Any], default_conf: str, main: bool) -> dict[str, Any]:
    """One candidate (the main entity or a mention), checked."""
    wanted, name = _text(cand.get("type")), _text(cand.get("name"))
    t, why = _entity_type(space, wanted)
    out: dict[str, Any] = {
        "typeId": t.id if t is not None else None, "type": t.name if t is not None else (wanted or None),
        "name": name, "aliases": [], "values": [], "lines": [],
        "confidence": _confidence(cand.get("confidence"), default_conf), "main": main, "ok": False,
    }  # fmt: skip
    seen = {filing._norm(name)}
    for alias in _strings(cand.get("aliases")):  # only the spellings the page says, once each
        n = filing._norm(alias)
        if n and n not in seen and n in doc:
            seen.add(n)
            out["aliases"].append(alias)
    if why is None and t is not None:
        out["values"] = [_value(t, doc, row) for row in _items(cand.get("values"))]
    out["lines"] = [_line(doc, row) for row in _items(cand.get("lines"))[:MAX_LINES_PER_CANDIDATE]]
    if why is None and not (filing._norm(name) and filing._norm(name) in doc):
        why = NAME_NOT_IN_PAGE
    if why:
        out["reason"] = why
    else:
        out["ok"] = True
    return out


def _named(types: list[TypeDefinition]) -> set[str]:
    """Folded names a relation can go by: the types' relation properties and their M28 counterparts
    (a quick filter in front of `find_relation`, which decides)."""
    ids = {t.id for t in types}
    names = {_fold(p.name) for t in types for p in t.propertyDefinitions if p.type == "entity"}
    return names | {_fold(s.name) for s in counterpart_specs(types) if s.source_type_id in ids}


def _plain(types: list[TypeDefinition], named: set[str], relation: str) -> bool:
    """True when `relation` names neither a relation property of an importable type nor an M28
    counterpart: `find_relation` finds nothing for any pair of importable types."""
    if _fold(relation) not in named:
        return True
    return not any(find_relation(types, s.id, o.id, relation) is not None for s in types for o in types)


def _spellings(entity: dict[str, Any]) -> list[str]:
    return [entity["name"], *entity["aliases"]]


def check_candidates(space: Space, decision: dict[str, Any], doc: str, page_path: str, page_title: str) -> dict[str, Any]:
    """Check one decision's ``mainEntity``, ``entities``, ``relations`` and ``merges`` against ``doc``.

    Answers ``{"mainEntity": CheckedEntity | None, "entities": [CheckedEntity],
    "relations": [CheckedRelation], "merges": [{"typeId", "names": [str], "ok": bool, "reason"?: str}]}``.
    ``doc`` is the page's document (M27's ``filing._doc_text``); ``page_path`` and ``page_title``
    name the page the decision is about. Reads only."""
    conf = _confidence(decision.get("confidence"), "low")
    main_raw = decision.get("mainEntity")
    if isinstance(main_raw, list):  # at most one
        main_raw = next(iter(_items(main_raw)), None)
    main = _entity(space, doc, main_raw, conf, True) if isinstance(main_raw, dict) else None
    mentioned = [_entity(space, doc, e, conf, False) for e in _items(decision.get("entities"))]

    known = [e for e in [main, *mentioned] if e is not None and e["ok"]]
    main_names = {filing._norm(s) for s in _spellings(main)} if main is not None and main["ok"] else set()
    types = [t for t in space.types if planner.importable_type(t)]
    named = _named(types)

    relations: list[dict[str, Any]] = []
    for row in _items(decision.get("relations")):
        subject, relation, obj = _text(row.get("subject")), _text(row.get("relation")), _text(row.get("object"))
        rel: dict[str, Any] = {
            "subject": subject, "relation": relation, "object": obj, "quote": str(row.get("quote") or ""),
            "confidence": _confidence(row.get("confidence"), conf), "plain": _plain(types, named, relation),
            "ok": False,
        }  # fmt: skip
        why = filing._check_quote(doc, obj, row.get("quote"), "text")
        subj = filing._norm(subject)
        if why is None and (not subj or subj not in main_names):
            # The subject is named in the quote, by the spelling given or any of its candidate's.
            spell = {subject}
            for e in known:
                if subj in {filing._norm(s) for s in _spellings(e)}:
                    spell.update(_spellings(e))
            q = filing._norm(rel["quote"])
            if not any(filing._norm(s) and filing._norm(s) in q for s in spell):
                why = BOTH_SIDES
        if why:
            rel["reason"] = why
        else:
            rel["ok"] = True
        relations.append(rel)

    merges: list[dict[str, Any]] = []
    for row in _items(decision.get("merges")):
        t, why = _entity_type(space, _text(row.get("type")))
        names = list(dict.fromkeys(_strings(row.get("names"))))
        m: dict[str, Any] = {"typeId": t.id if t is not None else None, "names": names, "ok": False}
        if why is None and len({filing._norm(n) for n in names}) < 2:
            why = TWO_NAMES
        if why:
            m["reason"] = why
        else:
            m["ok"] = True
        merges.append(m)

    return {"mainEntity": main, "entities": mentioned, "relations": relations, "merges": merges}
