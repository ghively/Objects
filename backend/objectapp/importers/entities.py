"""M30: one entity per thing, from the checked candidates of every Source (design 2026-11-09,
sections 5 and 5a; plan ``2026-11-09-m30-entity-extraction.md``, Contract and Task 3).

`resolve` joins the candidates of a batch's filing results into entities: names and aliases that
normalise the same (`norm_name`) within a type, the agent's merges, then Gene's review (merges, then
splits). Per entity it picks the values from all its Sources (`distill.pick_values`: the newest
Source wins, conflicts kept), assembles the summary lines, and applies **the entity rule**: a
candidate becomes an object when a page is mainly about it (``"own"``), more than one page mentions
it (``"pages"``, `entitycheck.MIN_PAGES`) or it has properties of its own (``"properties"``);
otherwise it stays text. A category (an option of a type's Category, Kind or Environment label, or a
tag) is never an entity. The resolved list is **computed** on every read from ``filing.json`` and
``entities-review.json`` (never stored), so reading writes nothing.

Gene's review, ``.object/imports/<batch>/entities-review.json`` (`EntitiesReview`)::

    {"decisions": {entityId: {"status": "accepted"|"renamed"|"rejected", "name"?: str}},
     "merges": [[entityId, ...]], "splits": [{"id": entityId, "names": [str]}], "revision"?: str}

`view` answers the wizard's ``EntitiesView`` (frontend ``api/types.ts``).
"""

from __future__ import annotations

import hashlib
import json
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any

from . import batches, distill, proposal
from .distill import PickedValue, SummaryLine

if TYPE_CHECKING:
    from ..space import Space

__all__ = [
    "REVIEW_FILE",
    "STATUSES",
    "Entity",
    "Resolution",
    "ReviewInvalid",
    "accepted",
    "load_review",
    "norm_name",
    "resolve",
    "save_review",
    "undecided",
    "view",
]

REVIEW_FILE = "entities-review.json"
STATUSES = ("accepted", "renamed", "rejected")


class ReviewInvalid(ValueError):
    """A review the app refuses (422); the message says why."""


@dataclass
class Entity:
    id: str
    """``"<typeId>:<smallest member key>"``."""
    typeId: str
    type: str
    name: str
    """The most-used spelling (first seen on a tie)."""
    aliases: list[str]
    """Every other spelling seen."""
    keys: set[str]
    """`norm_name` of every member."""
    pages: list[str]
    """The Sources that mention it (provenance): main pages first, then by path."""
    mainPages: list[str]
    values: dict[str, PickedValue]
    """`distill.pick_values` over every passing value."""
    lines: list[SummaryLine]
    confidence: str
    """The highest of its candidates."""
    joinedByAgent: bool
    """An agent merge joined it (offered as a split)."""
    rule: str | None
    """``"own"`` | ``"pages"`` | ``"properties"`` | None (stays text)."""
    category: bool
    existing: str | None
    """Path of an object of this type already in the space with that name or alias (never a Source)."""


@dataclass
class Resolution:
    entities: list[Entity]
    """Rule met, not a category."""
    leftOut: list[Entity]
    """Rule None, or a category."""
    suggestedMerges: list[dict[str, Any]]
    """``[{"ids": [...], "names": [...]}]``, near-duplicates within a type."""
    relations: list[dict[str, Any]]
    """Every ok CheckedRelation, with ``"page"``."""
    pages: list[str]
    """Every page (Source) of the results."""


_STRIP = ".,;:()[]\"' "
_RANK = {"high": 0, "medium": 1, "low": 2}


def norm_name(text: str) -> str:
    """NFKC, casefolded, whitespace collapsed, surrounding ``.,;:()[]"'`` stripped."""
    return " ".join(unicodedata.normalize("NFKC", str(text)).casefold().split()).strip(_STRIP)


# -- candidates and groups -------------------------------------------------------------


@dataclass
class _Cand:
    """One passing candidate (a page's main entity or a mention)."""

    typeId: str
    type: str
    key: str
    """`norm_name` of its name."""
    aliasKeys: list[str]
    values: list[dict[str, Any]]
    lines: list[dict[str, Any]]
    confidence: str
    main: bool
    page: str


@dataclass
class _Spelling:
    text: str
    first: int
    uses: int = 0
    """How often it is written, as a name or an alias."""


@dataclass
class _Key:
    """What the candidates say about one key (``(typeId, norm_name)``)."""

    first: int
    names: int = 0
    """How many candidates are named so."""
    spellings: dict[str, _Spelling] = field(default_factory=dict)

    def text(self) -> str:
        """The key's most-used spelling (first seen on a tie)."""
        return min(self.spellings.values(), key=lambda s: (-s.uses, s.first)).text


@dataclass
class _Group:
    typeId: str
    keys: set[str]

    @property
    def id(self) -> str:
        return f"{self.typeId}:{min(self.keys)}"


class _Built:
    """The candidates of a batch's results joined into groups: names and aliases, the agent's merges,
    then the review's merges and splits (strict: a bad operation raises `ReviewInvalid`)."""

    def __init__(self, results: dict[str, dict[str, Any]]) -> None:
        self.pages: list[str] = []
        self.cands: list[_Cand] = []
        self.keys: dict[tuple[str, str], _Key] = {}
        self.relations: list[dict[str, Any]] = []
        self.agentKeys: set[tuple[str, str]] = set()
        """Keys an agent merge joined to a group no name had joined them to."""
        self.splitLog: list[tuple[str, set[str], set[str]]] = []
        """Per split applied: (the entity's id, the keys moved, the keys left)."""
        self.seenIds: set[str] = set()
        seq = 0
        merges: list[dict[str, Any]] = []
        for path, r in results.items():
            if not isinstance(r, dict) or r.get("rejected"):
                continue
            page = str(r.get("path") or path)
            self.pages.append(page)
            conf = r.get("confidence") if r.get("confidence") in _RANK else "low"
            main = r.get("mainEntity")
            listed = [e for e in r.get("entities") or [] if isinstance(e, dict)]
            for e in ([main] if isinstance(main, dict) else []) + listed:
                cand = self._cand(e, page, conf, e is main)
                if cand is None:
                    continue
                spellings = [str(e.get("name") or "")] + [str(a) for a in e.get("aliases") or []]
                for i, text in enumerate(spellings):
                    k = norm_name(text)
                    if not k:
                        continue
                    info = self.keys.setdefault((cand.typeId, k), _Key(first=seq))
                    info.spellings.setdefault(text.strip(), _Spelling(text.strip(), first=seq)).uses += 1
                    info.names += i == 0
                    seq += 1
                self.cands.append(cand)
            self.relations += [{**rel, "page": page} for rel in r.get("relations") or []
                               if isinstance(rel, dict) and rel.get("ok")]  # fmt: skip
            merges += [m for m in r.get("merges") or [] if isinstance(m, dict) and m.get("ok")]

        # a candidate's name and aliases are one thing; then the agent's merges, within their type
        parent: dict[tuple[str, str], tuple[str, str]] = {k: k for k in self.keys}

        def find(k: tuple[str, str]) -> tuple[str, str]:
            while parent[k] != k:
                parent[k] = parent[parent[k]]
                k = parent[k]
            return k

        for c in self.cands:
            for a in c.aliasKeys:
                parent[find((c.typeId, a))] = find((c.typeId, c.key))
        for m in merges:
            tid = str(m.get("typeId") or "")
            ks = [k for k in ((tid, norm_name(str(n))) for n in m.get("names") or []) if k in self.keys]
            if len({find(k) for k in ks}) > 1:
                self.agentKeys.update(ks)
                for k in ks[1:]:
                    parent[find(k)] = find(ks[0])
        joined: dict[tuple[str, str], _Group] = {}
        for k in sorted(self.keys):
            joined.setdefault(find(k), _Group(k[0], set())).keys.add(k[1])
        self.groups = list(joined.values())
        self._note_ids()

    @staticmethod
    def _cand(e: dict[str, Any], page: str, conf: str, main: bool) -> _Cand | None:
        from . import sources

        tid = str(e.get("typeId") or "")
        key = norm_name(str(e.get("name") or ""))
        if not e.get("ok") or not tid or not key or tid == sources.SOURCE_TYPE_ID:
            return None
        own = e.get("confidence")
        aliases = [norm_name(str(a)) for a in e.get("aliases") or []]
        return _Cand(
            typeId=tid, type=str(e.get("type") or tid), key=key, aliasKeys=[a for a in aliases if a],
            values=[v for v in e.get("values") or [] if isinstance(v, dict) and v.get("ok") and v.get("key")],
            lines=[ln for ln in e.get("lines") or [] if isinstance(ln, dict) and ln.get("ok") and ln.get("text")],
            confidence=own if own in _RANK else conf, main=main or bool(e.get("main")), page=page,
        )  # fmt: skip

    def _note_ids(self) -> None:
        self.groups = [g for g in self.groups if g.keys]
        self.seenIds.update(g.id for g in self.groups)

    def _group(self, gid: Any, strict: bool) -> _Group | None:
        g = next((g for g in self.groups if g.id == gid), None)
        if g is None and strict:
            raise ReviewInvalid(f"There is no entity {gid}.")
        return g

    def merge(self, ids: list[str], strict: bool) -> None:
        found = [self._group(i, strict) for i in dict.fromkeys(ids)]
        groups = [g for g in found if g is not None]
        if len(groups) < 2:
            if strict:
                raise ReviewInvalid("A merge needs two entities or more.")
            return
        if len({g.typeId for g in groups}) > 1:
            if strict:
                raise ReviewInvalid("Only entities of the same type can be merged.")
            return
        for g in groups[1:]:
            groups[0].keys |= g.keys
            g.keys = set()
        self._note_ids()

    def split(self, op: dict[str, Any], strict: bool) -> None:
        g = self._group(op["id"], strict)
        if g is None:
            return
        names = [n for n in op["names"] if norm_name(n)]
        missing = [n for n in names if norm_name(n) not in g.keys]
        if not names or missing:
            if strict:
                had = self.keys[(g.typeId, min(g.keys))].text()
                raise ReviewInvalid(f"{had} has no name {missing[0]}." if missing else "A split needs a name to move.")
            return
        moved = {norm_name(n) for n in names}
        rest = g.keys - moved
        g.keys = rest
        self.groups.append(_Group(g.typeId, moved))
        self.splitLog.append((op["id"], moved, rest))
        self._note_ids()

    def review(self, review: dict[str, Any], strict: bool) -> None:
        for ids in review["merges"]:
            self.merge(ids, strict)
        for op in review["splits"]:
            self.split(op, strict)

    def members(self) -> dict[str, list[_Cand]]:
        """Group id -> its candidates (a candidate is where its name's key is); a group with none drops out."""
        where = {(g.typeId, k): g.id for g in self.groups for k in g.keys}
        out: dict[str, list[_Cand]] = {}
        for c in self.cands:
            out.setdefault(where[(c.typeId, c.key)], []).append(c)
        return out


# -- resolution --------------------------------------------------------------------------


def _modified(space: Space, page: str) -> str | None:
    """The Source's ``importSource.modified``, else its ``importedAt`` (None when unreadable)."""
    try:
        _of, fm, _version = space.read(page)
    except (KeyError, ValueError, OSError):
        return None
    block = fm.get("importSource")
    if not isinstance(block, dict):
        return None
    for k in ("modified", "importedAt"):
        v = block.get(k)
        if v not in (None, ""):
            return v.isoformat() if hasattr(v, "isoformat") else str(v)
    return None


def _categories(space: Space) -> set[str]:
    """`norm_name` of every option of a Category, Kind or Environment label of a type in the space
    (`proposal.category_labels`: never the Source type's), and of every tag's title."""
    out = {norm_name(s.title) for s in space.list("tag")}
    for t in space.types:
        for p in proposal.category_labels(t):
            out |= {norm_name(str(o.get("text", ""))) for o in p.options.get("set") or [] if isinstance(o, dict)}
    out.discard("")
    return out


def _existing(space: Space, type_id: str, keys: set[str], ctx: dict[str, Any]) -> str | None:
    """An object of the type already in the space (never a Source) whose title or an alias is one of ``keys``."""
    from . import sources

    if type_id == sources.SOURCE_TYPE_ID:
        return None
    cache: dict[str, dict[str, str]] = ctx["existing"]
    if type_id not in cache:
        found: dict[str, str] = {}
        for s in space.list(type_id):
            if s.path in ctx["skip"] or s.type == sources.SOURCE_TYPE_ID:
                continue
            for name in [s.title, *s.aliases]:
                found.setdefault(norm_name(name), s.path)
        cache[type_id] = found
    hits = sorted(cache[type_id][k] for k in keys if k in cache[type_id])
    return hits[0] if hits else None


def _entity(space: Space, b: _Built, g: _Group, cands: list[_Cand], ctx: dict[str, Any]) -> Entity:
    from . import entitycheck

    info = {k: b.keys[(g.typeId, k)] for k in g.keys}
    name_key = min(g.keys, key=lambda k: (-info[k].names, info[k].first))
    main_pages = sorted({c.page for c in cands if c.main})
    pages = main_pages + sorted({c.page for c in cands} - set(main_pages))
    modified: dict[str, str | None] = ctx["modified"]
    for p in pages:
        if p not in modified:
            modified[p] = _modified(space, p)
    found: dict[str, list[dict[str, Any]]] = {}
    lines: list[dict[str, Any]] = []
    for c in cands:
        for v in c.values:
            found.setdefault(str(v["key"]), []).append(
                {"value": v.get("value"), "quote": v.get("quote") or "", "page": c.page, "modified": modified[c.page]})
        lines += [{"text": ln["text"], "quote": ln.get("quote") or "", "page": c.page, "modified": modified[c.page]}
                  for ln in c.lines]  # fmt: skip
    values = distill.pick_values(found, set(main_pages)) if found else {}
    t = space.type_by_id(g.typeId)
    rule = ("own" if main_pages else "pages" if len(pages) >= entitycheck.MIN_PAGES
            else "properties" if values else None)  # fmt: skip
    return Entity(
        id=g.id, typeId=g.typeId, type=t.name if t is not None else cands[0].type,
        name=info[name_key].text(),
        aliases=[info[k].text() for k in sorted(g.keys - {name_key}, key=lambda k: info[k].first)],
        keys=set(g.keys), pages=pages, mainPages=main_pages, values=values,
        lines=distill.summary_lines(lines, set(main_pages)) if lines else [],
        confidence=min((c.confidence for c in cands), key=lambda x: _RANK[x]),
        joinedByAgent=len({(g.typeId, k) for k in g.keys} & b.agentKeys) >= 2,
        rule=rule, category=bool(g.keys & ctx["categories"]),
        existing=_existing(space, g.typeId, g.keys, ctx),
    )  # fmt: skip


def _order(e: Entity) -> tuple[str, str, str]:
    return (e.type.casefold(), e.name.casefold(), e.id)


def _build(space: Space, results: dict[str, dict[str, Any]], review: dict[str, Any] | None,
           strict: bool) -> tuple[Resolution, _Built]:  # fmt: skip
    b = _Built(results)
    if review:
        b.review(_clean(review), strict)
    ctx: dict[str, Any] = {"modified": {}, "categories": _categories(space), "skip": set(b.pages), "existing": {}}
    groups = {g.id: g for g in b.groups}
    made = sorted((_entity(space, b, groups[gid], cands, ctx) for gid, cands in b.members().items()), key=_order)
    kept = [e for e in made if e.rule is not None and not e.category]
    left = [e for e in made if e.rule is None or e.category]

    suggested: list[dict[str, Any]] = []
    for tid in dict.fromkeys(e.typeId for e in made):
        of_type = [e for e in [*kept, *left] if e.typeId == tid and not e.category]
        for dup in proposal.near_duplicates([e.name for e in of_type]):
            hit = [e for e in of_type if e.name in dup["values"]]
            if len(hit) > 1:
                suggested.append({"ids": [e.id for e in hit], "names": [e.name for e in hit]})
    res = Resolution(entities=kept, leftOut=left, suggestedMerges=suggested, relations=b.relations, pages=b.pages)
    return res, b


def resolve(space: Space, results: dict[str, dict[str, Any]], review: dict[str, Any] | None = None) -> Resolution:
    """The batch's entities from its filing ``results`` (path -> result) and Gene's ``review``. Reads only.

    "First seen" is the order of ``results``, each page's main entity before its mentions. A review
    operation that no longer applies (an id that is gone, a merge across types) is skipped."""
    return _build(space, results, review, strict=False)[0]


# -- the review --------------------------------------------------------------------------


def _clean(review: Any) -> dict[str, Any]:
    """A review in its stored shape; anything unreadable left out."""
    if not isinstance(review, dict):
        return {"decisions": {}, "merges": [], "splits": []}
    decisions = review.get("decisions") if isinstance(review.get("decisions"), dict) else {}
    out: dict[str, Any] = {
        "decisions": {str(k): dict(v) for k, v in decisions.items() if isinstance(v, dict)},
        "merges": [[str(i) for i in m] for m in review.get("merges") or [] if isinstance(m, list)],
        "splits": [{"id": str(s.get("id")), "names": [str(n) for n in s.get("names") or []]}
                   for s in review.get("splits") or [] if isinstance(s, dict)],
    }  # fmt: skip
    if isinstance(review.get("revision"), str):
        out["revision"] = review["revision"]
    return out


def load_review(root: Path | str, batch: str) -> dict[str, Any]:
    """The batch's `EntitiesReview`; empty when absent. Reads only."""
    try:
        data = json.loads((batches.batch_dir(root, batch) / REVIEW_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = None
    return _clean(data)


def _decision(d: dict[str, Any]) -> dict[str, Any]:
    status = d.get("status")
    if status not in STATUSES:
        raise ReviewInvalid(f"{status!r} is not a decision: an entity is accepted, renamed or rejected.")
    if status != "renamed":
        return {"status": status}
    name = d.get("name")
    name = " ".join(name.split()) if isinstance(name, str) else ""
    if not name:
        raise ReviewInvalid("A renamed entity needs a name.")
    return {"status": status, "name": name}


def save_review(space: Space, batch: str, review: dict[str, Any], results: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Check and write ``entities-review.json`` (the only file it writes); answers the stored review.
    Raises `ReviewInvalid`; `KeyError` when the batch has no records.

    Decisions are keyed by the ids the entities have after the review's merges and splits. When the
    review adds a split, the part split off starts undecided and the rest keeps the decision of the
    entity it was split from (also when the split hands that id to the part split off); decisions on
    ids that are gone are dropped, so they never come back."""
    folder = batches.batch_dir(space.root, batch)
    if not folder.is_dir():
        raise KeyError(batch)
    if not isinstance(review, dict):
        raise ReviewInvalid("A review holds decisions, merges and splits.")
    raw = review.get("decisions") or {}
    if not isinstance(raw, dict) or not all(isinstance(v, dict) for v in raw.values()):
        raise ReviewInvalid("Each decision has a status.")
    for key, kind in (("merges", list), ("splits", dict)):
        rows = review.get(key) or []
        if not isinstance(rows, list) or not all(isinstance(r, kind) for r in rows):
            raise ReviewInvalid(f"The review's {key} can't be read.")
    asked = _clean(review)
    decisions = {k: _decision(v) for k, v in asked["decisions"].items()}
    res, built = _build(space, results, asked, strict=True)

    # decisions follow a split this review adds
    stored = load_review(space.root, batch)
    old = stored["splits"]
    added = asked["merges"][: len(stored["merges"])] == stored["merges"] and asked["splits"][: len(old)] == old
    where = {(e.typeId, k): e.id for e in [*res.entities, *res.leftOut] for k in e.keys}
    for old_id, moved, rest in built.splitLog[len(old):] if added else []:
        tid = old_id.split(":", 1)[0]
        off = where.get((tid, min(moved)))
        kept = where.get((tid, min(rest))) if rest else None
        if kept is not None and kept != old_id and old_id in decisions and kept not in decisions:
            decisions[kept] = decisions[old_id]
        if off is not None:
            decisions.pop(off, None)

    final = {e.id for e in res.entities}
    out: dict[str, dict[str, Any]] = {}
    for gid, d in decisions.items():
        if gid in final:
            out[gid] = d
            continue
        left = next((e for e in res.leftOut if e.id == gid), None)
        if left is not None and d["status"] != "rejected":
            raise ReviewInvalid(f"{left.name} isn't made into an object, so it can't be {d['status']}.")
        if left is None and gid not in built.seenIds:
            raise ReviewInvalid(f"There is no entity {gid}.")
    data: dict[str, Any] = {"decisions": out, "merges": asked["merges"], "splits": asked["splits"]}
    digest = hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
    data["revision"] = digest[:16]
    batches.write_json(folder / REVIEW_FILE, data)
    return data


def _decided(review: dict[str, Any], entity_id: str) -> dict[str, Any] | None:
    d = (review.get("decisions") or {}).get(entity_id)
    if not isinstance(d, dict) or d.get("status") not in STATUSES:
        return None
    if d["status"] == "renamed" and not (isinstance(d.get("name"), str) and d["name"].strip()):
        return None
    return d


def accepted(res: Resolution, review: dict[str, Any]) -> list[tuple[Entity, str]]:
    """``(entity, final name)`` of every accepted or renamed entity."""
    out: list[tuple[Entity, str]] = []
    for e in res.entities:
        d = _decided(review, e.id)
        if d is not None and d["status"] != "rejected":
            out.append((e, d["name"].strip() if d["status"] == "renamed" else e.name))
    return out


def undecided(res: Resolution, review: dict[str, Any]) -> list[str]:
    """Ids of the entities with no decision."""
    return [e.id for e in res.entities if _decided(review, e.id) is None]


# -- the wizard's view -------------------------------------------------------------------

_WRITTEN = ("created", "updated", "unchanged", "resolvedTake", "resolvedKeep")
"""The ``items.json`` actions of an object the batch wrote (or kept), as `filing.Filing.eligible` reads them."""


def batch_sources(space: Space, batch: str) -> int:
    """How many imported Sources the batch's ``items.json`` holds (not the entities a Write made). Reads only."""
    from . import sources

    try:
        _data, items = batches.load_batch(space.root, batch)
    except KeyError:
        return 0
    seen: set[str] = set()
    for it in items:
        p = it.get("path")
        if it.get("entity") or it.get("action") not in _WRITTEN or not isinstance(p, str) or p in seen:
            continue
        try:
            _of, fm, _v = space.read(p)
            type_id = space.get(p).type
        except (KeyError, ValueError, OSError):
            continue
        if sources.is_imported_source(type_id, fm):
            seen.add(p)
    return len(seen)


_STATES = {"idle": "collecting", "running": "collecting", "trial": "collecting", "entities": "review",
           "writing": "writing", "failed": "review"}  # fmt: skip


def view(space: Space, batch: str, results: dict[str, dict[str, Any]], state: str) -> dict[str, Any]:
    """The wizard's ``EntitiesView`` for the batch in filing ``state``. Reads only.

    ``collecting`` while the filing state is ``idle``, ``running`` or ``trial``; ``review`` in
    ``entities`` (and ``failed``, which Write can be run again from); ``writing``; ``written`` in
    ``done`` after a write."""
    from . import entitywrite

    review = load_review(space.root, batch)
    res = resolve(space, results, review)
    try:
        done = batches.batch_dir(space.root, batch) / entitywrite.WRITTEN_FILE
        record = json.loads(done.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        record = None
    written = record.get("outcome") if isinstance(record, dict) and isinstance(record.get("outcome"), dict) else None
    shown = "written" if state == "done" and written is not None else _STATES.get(state, "review")

    titles: dict[str, str] = {}

    def title(path: str) -> str:
        if path not in titles:
            try:
                titles[path] = space.get(path).title
            except (KeyError, ValueError):
                titles[path] = PurePosixPath(path).stem
        return titles[path]

    def cites(refs: list[Any]) -> list[dict[str, Any]]:
        return [{"path": r["path"], "title": title(r["path"]), "quote": r.get("quote") or ""} for r in refs]

    def values(e: Entity) -> list[dict[str, Any]]:
        t = space.type_by_id(e.typeId)
        order = [p.key for p in t.propertyDefinitions] if t is not None else []
        out = []
        for k in sorted(e.values, key=lambda k: (order.index(k) if k in order else len(order), k)):
            pv, pdef = e.values[k], t.prop(k) if t is not None else None
            out.append({
                "key": k, "name": pdef.name if pdef is not None else k, "value": pv["value"],
                "sources": cites(pv["sources"]),
                "conflict": [{"value": c["value"], "sources": cites(c["sources"])} for c in pv["conflict"]]
                if pv.get("conflict") else None,
            })  # fmt: skip
        return out

    def row(e: Entity) -> dict[str, Any]:
        d = _decided(review, e.id)
        return {
            "id": e.id, "typeId": e.typeId, "type": e.type, "name": e.name, "aliases": list(e.aliases),
            "pages": [{"path": p, "title": title(p)} for p in e.pages], "mainPages": list(e.mainPages),
            "values": values(e), "summary": [ln["text"] for ln in e.lines], "confidence": e.confidence,
            "joinedByAgent": e.joinedByAgent,
            "existing": {"path": e.existing, "title": title(e.existing)} if e.existing else None,
            "rule": e.rule, "decision": dict(d) if d is not None else None,
        }  # fmt: skip

    # a relation's sides, by name or alias (any type; an object already in the space has no confidence)
    sides: dict[str, Entity] = {}
    for e in [*res.entities, *res.leftOut]:
        for k in e.keys:
            sides.setdefault(k, e)

    def low(r: dict[str, Any]) -> bool:
        ends = [sides.get(norm_name(str(r.get(k) or ""))) for k in ("subject", "object")]
        return r.get("confidence") == "low" or any(s is not None and s.confidence == "low" for s in ends)

    return {
        "state": shown,
        "entities": [row(e) for e in res.entities],
        "leftOut": [{"id": e.id, "type": e.type, "name": e.name, "pages": len(e.pages),
                     "reason": "category" if e.category else "text"} for e in res.leftOut],
        "suggestedMerges": res.suggestedMerges,
        "relations": {"total": len(res.relations), "lowConfidence": sum(1 for r in res.relations if low(r)),
                      "plain": sum(1 for r in res.relations if r.get("plain"))},
        "sources": batch_sources(space, batch),
        "conflicts": sum(1 for e in res.entities for pv in e.values.values() if pv.get("conflict")),
        "review": {k: review[k] for k in ("decisions", "merges", "splits")},
        "undecided": len(undecided(res, review)),
        "written": written,
    }  # fmt: skip
