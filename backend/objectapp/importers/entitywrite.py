"""M30: writing what Gene accepted in the Entities step (design 2026-11-09, sections 5 and 5a; plan
``2026-11-09-m30-entity-extraction.md``, Contract and Task 6).

`write_entities` places each accepted entity (an object already in the space, else a new one with
an ``importSource`` block and a ``created`` entry in ``items.json``), writes its relations on their
stored side (M28's counterparts are computed, never written; a relation outside the named set is a
plain link), its values, aliases, **Sources** relation, tags and collections in one
``update_properties``, and its "From sources" section (`distill.replace_section`), keeping the
citations in ``.object/distilled/<object id>.json``. **No step writes a Source.** Each step is
recorded in ``.object/imports/<batch>/entities-written.json`` (`WRITTEN_FILE`)::

    {"placed": {entityId: path}, "done": {entityId: ["created"?, "values", "section"]},
     "sections": {entityId: "written" | "left" | "kept"}, "outcome": EntitiesWritten | null}

so a retry after a failure resumes without placing anything twice (``"created"`` marks an object
this batch made; a stored relation on an object that is no entity of the Write is recorded under
``"object:<path>"``).

``ConflictRow = {entity: {path, title}, key, name, kept: {value, sources}, others: [{value, sources}]}``.
"""

from __future__ import annotations

import copy
import json
from dataclasses import replace
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from ..frontmatter import set_keys
from ..propvalues import InvalidValue
from . import batches, distill, provenance, sources
from .entities import norm_name

if TYPE_CHECKING:
    from ..space import Space
    from .entities import Entity, Resolution

__all__ = [
    "INBOX_REASON",
    "SECTION_LEFT",
    "SKIP_NOT_PLACED",
    "SKIP_NO_ENTITY",
    "SKIP_SAME",
    "SKIP_SOURCE",
    "SKIP_TURNED_DOWN",
    "SKIP_UNKNOWN",
    "WRITTEN_FILE",
    "write_entities",
]

WRITTEN_FILE = "entities-written.json"

# our strings
INBOX_REASON = "Link not written (low confidence): {subject} {relation} {object}"
SECTION_LEFT = "The From sources section of {title} was edited, so it was left as it is."
SKIP_TURNED_DOWN = "turned down"
SKIP_UNKNOWN = "no such object"
SKIP_SOURCE = "a Source is never linked"
SKIP_SAME = "the same object"
SKIP_NOT_PLACED = "its entity could not be written"
SKIP_NO_ENTITY = "neither side is an entity of this import"


def _has(v: Any) -> bool:
    return not (v is None or v == "" or v == [] or v == {})


def _same(a: Any, b: Any) -> bool:
    """Equal values, whatever their spelling as JSON (a list of refs compared by path or target)."""
    if a == b:
        return True
    try:
        return json.dumps(a, sort_keys=True, default=str) == json.dumps(b, sort_keys=True, default=str)
    except (TypeError, ValueError):
        return False


def _time(modified: Any) -> float:
    """A Source's modified time as a number; None (or unreadable) is the oldest (as `distill` ranks)."""
    if not modified:
        return float("-inf")
    try:
        t = datetime.fromisoformat(str(modified))
    except ValueError:
        return float("-inf")
    return (t if t.tzinfo else t.replace(tzinfo=UTC)).timestamp()


def _newest(refs: Any) -> float:
    return max((_time(r.get("modified")) for r in refs or [] if isinstance(r, dict)), default=float("-inf"))


class _Writer:
    def __init__(self, space: Space, batch: str, system: str, imported_at: str,
                 chosen: list[tuple[Entity, str]], res: Resolution, results: dict[str, dict[str, Any]],
                 items: list[dict[str, Any]]) -> None:  # fmt: skip
        self.space = space
        self.batch = batch
        self.system = system
        self.imported_at = imported_at
        self.chosen = chosen
        self.res = res
        self.results = results
        self.items = items
        self.folder = batches.batch_dir(space.root, batch)
        self.rec = self._load()
        self.failed: list[dict[str, str]] = []
        self.failed_ids: set[str] = set()
        self._index: dict[tuple[str, str], list[provenance.Existing]] | None = None
        self._names: dict[str, list[str]] | None = None
        """`norm_name` of every title and alias of the space's objects but Sources -> their paths."""
        self._typed: set[str] = set()
        """Types checked for the Sources relation in this run."""
        self.picked: dict[str, dict[str, Any]] = {}
        """Entity id -> its values merged with an earlier Write's (`_merged_values`)."""

    # -- the record -------------------------------------------------------------------------------

    def _load(self) -> dict[str, Any]:
        try:
            data = json.loads((self.folder / WRITTEN_FILE).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = None
        data = data if isinstance(data, dict) else {}
        return {
            "placed": dict(data.get("placed") or {}) if isinstance(data.get("placed"), dict) else {},
            "done": {k: list(v) for k, v in (data.get("done") or {}).items() if isinstance(v, list)}
            if isinstance(data.get("done"), dict) else {},
            "sections": dict(data.get("sections") or {}) if isinstance(data.get("sections"), dict) else {},
            "outcome": None,
        }  # fmt: skip

    def _save(self) -> None:
        batches.write_json(self.folder / WRITTEN_FILE, self.rec)

    def _mark(self, key: str, step: str) -> None:
        steps = self.rec["done"].setdefault(key, [])
        if step not in steps:
            steps.append(step)
        self._save()

    def _done(self, key: str, step: str) -> bool:
        return step in self.rec["done"].get(key, [])

    def _fail(self, e: Entity, name: str, exc: BaseException) -> None:
        self.failed_ids.add(e.id)
        reason = str(exc).strip() or type(exc).__name__
        if not any(f["name"] == name for f in self.failed):
            self.failed.append({"name": name, "reason": reason[:200]})

    # -- helpers ----------------------------------------------------------------------------------

    def _summary(self, path: str) -> Any:
        try:
            return self.space.get(path)
        except (KeyError, ValueError):
            return None

    def _is_source(self, path: str) -> bool:
        s = self._summary(path)
        return s is not None and s.type == sources.SOURCE_TYPE_ID

    def _title(self, path: str) -> str:
        s = self._summary(path)
        return s.title if s is not None else path.rsplit("/", 1)[-1].removesuffix(".md")

    def _link(self, path: str, from_path: str) -> str:
        """The link `references.link_mention` would write for ``path``'s title from ``from_path``."""
        title = self._title(path)
        if self.space.resolve(title, from_path) == path and not any(c in title for c in "[]|#\n"):
            return f"[[{title}]]"
        return f"[[{self.space._link_text(path, from_path)}|{title}]]"

    def _values(self, path: str) -> dict[str, Any]:
        rows = self.space.rows(None, None, [path], None, False)
        return dict(rows[0].values) if rows else {}

    def _ref_paths(self, refs: Any, from_path: str) -> list[str]:
        out: list[str] = []
        for r in refs if isinstance(refs, list) else []:
            p = r.get("path") if isinstance(r, dict) else None
            if not p:
                target = r.get("target") if isinstance(r, dict) else r
                p = self.space.resolve(str(target), from_path) if target else None
            if p:
                out.append(str(p))
        return out

    def _record_id(self, path: str) -> str:
        oid, _version = self.space.ensure_id(path)
        return oid

    def _ident(self, e: Entity) -> str:
        return f"entity:{e.typeId}:{norm_name(e.name)}"

    # -- earlier Writes: the entity is distilled from all its Sources, not only this batch's -------

    def _earlier(self, e: Entity, page: Any) -> bool:
        """A Source an earlier Write cited that this batch didn't read (what it said still stands)."""
        p = str(page or "")
        return bool(p) and p not in self.res.pages and p not in e.pages and self._summary(p) is not None

    def _merged_values(self, e: Entity, before: dict[str, Any]) -> dict[str, dict[str, Any]]:
        """Per key, `distill.pick_values` over this batch's values and those the record keeps from
        Sources this batch didn't read: the newest Source wins, equal values from several Sources
        are one value, and the recorded winner stays on a tie (a value is replaced only by a newer
        Source's). Keys only an earlier Write found keep their record entry."""
        from . import filing

        main = set(e.mainPages)
        out: dict[str, dict[str, Any]] = {}
        for key, old in before.items():
            if key not in e.values and isinstance(old, dict):
                out[key] = {"value": old.get("value"), "sources": list(old.get("sources") or []),
                            "conflict": old.get("conflict") or None}  # fmt: skip
        for key, pv in e.values.items():
            old = before.get(key) if isinstance(before.get(key), dict) else None
            rows: list[dict[str, Any]] = []
            earlier = False

            def add(value: Any, refs: Any, fresh: bool, rows: list[dict[str, Any]] = rows) -> bool:
                added = False
                for r in refs if isinstance(refs, list) else []:
                    if isinstance(r, dict) and r.get("path") and (fresh or self._earlier(e, r["path"])):
                        rows.append({"value": value, "quote": r.get("quote") or "", "page": str(r["path"]),
                                     "modified": r.get("modified")})  # fmt: skip
                        added = True
                return added

            if old is not None:
                earlier = add(old.get("value"), old.get("sources"), False)
                for c in old.get("conflict") or []:
                    if isinstance(c, dict):
                        earlier = add(c.get("value"), c.get("sources"), False) or earlier
            if not earlier:
                out[key] = pv
                continue
            add(pv["value"], pv["sources"], True)
            for c in pv.get("conflict") or []:
                add(c["value"], c["sources"], True)
            picked = dict(distill.pick_values({key: rows}, main)[key])
            if old is not None and filing._norm(str(picked["value"])) != filing._norm(str(old.get("value"))):
                rest = list(picked["conflict"] or [])
                prior = next((c for c in rest if filing._norm(str(c["value"])) == filing._norm(str(old.get("value")))), None)
                if prior is not None and _newest(prior["sources"]) >= _newest(picked["sources"]):
                    rest.remove(prior)  # a tie: the recorded winner stays
                    rest.insert(0, {"value": picked["value"], "sources": picked["sources"]})
                    picked = {"value": prior["value"], "sources": prior["sources"], "conflict": rest}
            out[key] = picked
        return out

    def _merged_section(self, e: Entity, sec: dict[str, Any] | None,
                        plain: list[dict[str, Any]]) -> tuple[list[Any], list[str], list[dict[str, Any]]]:  # fmt: skip
        """The section's lines, main pages and plain links: this batch's merged with what the record
        keeps from Sources this batch didn't read (`distill.summary_lines`: main pages first, then
        the newest Source, at most `distill.MAX_LINES`)."""
        sec = sec or {}
        old_main = [str(p) for p in sec.get("mainPages") or [] if self._earlier(e, p)]
        main = [*e.mainPages, *(p for p in old_main if p not in e.mainPages)]
        rows: list[dict[str, Any]] = []
        for ln in sec.get("lines") or []:
            if not isinstance(ln, dict):
                continue
            for r in ln.get("sources") or []:
                if isinstance(r, dict) and self._earlier(e, r.get("path")):
                    rows.append({"text": str(ln.get("text") or ""), "quote": r.get("quote") or "",
                                 "page": str(r["path"]), "modified": r.get("modified")})  # fmt: skip
        lines: list[Any] = list(e.lines)
        if rows:
            for ln in e.lines:
                for r in ln["sources"]:
                    rows.append({"text": ln["text"], "quote": r.get("quote") or "", "page": r["path"],
                                 "modified": r.get("modified")})  # fmt: skip
            lines = list(distill.summary_lines(rows, set(main)))
        links = [p for p in sec.get("plain") or [] if isinstance(p, dict) and self._earlier(e, p.get("page"))]
        seen = {(str(p.get("link")), str(p.get("relation")).casefold()) for p in plain}
        merged = list(plain)
        for p in links:
            k = (str(p.get("link")), str(p.get("relation")).casefold())
            if k not in seen:
                seen.add(k)
                merged.append(p)
        return lines, main, merged

    # -- 1. place ---------------------------------------------------------------------------------

    def _ensure_sources(self, type_id: str) -> None:
        """M28's Sources relation on the type, added by one type save when it lacks it."""
        if type_id in self._typed:
            return
        self._typed.add(type_id)
        t, revision = self.space.refresh_type(type_id)
        if t is None or t.prop("sources") is not None:
            return
        from ..basicsetup import sources_property

        new = copy.deepcopy(t)
        new.propertyDefinitions.append(sources_property())
        self.space.save_type(new, revision)

    def _by_provenance(self, e: Entity, name: str) -> str | None:
        """An object an earlier Write of this source made for the entity (its ``importSource`` id)."""
        if self._index is None:
            self._index = provenance.index_space(self.space)
        for k in dict.fromkeys([norm_name(e.name), norm_name(name), *sorted(e.keys)]):
            for hit in self._index.get((self.system, f"entity:{e.typeId}:{k}"), []):
                s = self._summary(hit.path)
                if s is not None and s.type == e.typeId and s.template is None:
                    return hit.path
        return None

    def _finish_created(self, e: Entity, name: str, path: str) -> None:
        """The created object's ``importSource`` block and its ``items.json`` entry (each once)."""
        ident = self._ident(e)
        _of, fm, version = self.space.read(path)
        if provenance.read_block(fm) is None:
            blk = {"system": self.system, "id": ident, "batch": self.batch, "importedAt": self.imported_at}
            blk = {k: v for k, v in blk.items() if v not in (None, "")}

            def edit(of: Any, _fm: dict) -> Any:
                return replace(of, frontmatter_src=set_keys(of.frontmatter_src or "", {provenance.BLOCK_KEY: blk}))

            self.space._write(path, version, edit, stamp=False, history=False)
        if not any(it.get("entity") and it.get("path") == path for it in self.items):
            self.items.append({"sourcePath": ident, "system": self.system, "id": ident, "title": name, "path": path,
                               "action": "created", "entity": True})  # fmt: skip

    def place(self, e: Entity, name: str) -> str:
        placed = self.rec["placed"]
        if e.id in placed:
            path = placed[e.id]
            if self._summary(path) is not None:
                if self._done(e.id, "created"):
                    self._finish_created(e, name, path)
                return path
            del placed[e.id]  # gone since (trashed): placed again
            self.rec["done"].pop(e.id, None)
        self._ensure_sources(e.typeId)
        path = e.existing if e.existing and not self._is_source(e.existing) else None
        path = path or self._by_provenance(e, name)
        if path is not None:
            self.space.ensure_id(path)
            placed[e.id] = path
            self._save()
            return path
        path, _version = self.space.create_object(e.typeId, name)
        placed[e.id] = path
        self.rec["done"][e.id] = ["created"]
        self._save()
        self._finish_created(e, name, path)
        return path

    # -- 2. relations -----------------------------------------------------------------------------

    def plan_relations(self, paths: dict[str, str]) -> None:
        """Where each relation goes: a stored link, a plain link, the inbox, or skipped (with why)."""
        everyone = [*self.res.entities, *self.res.leftOut]
        by_key = {(e.typeId, k): e for e in everyone for k in e.keys}
        decided = {e.id for e in self.res.entities}
        self.stored: dict[str, dict[str, list[str]]] = {}
        self.plain: dict[str, list[dict[str, Any]]] = {}
        self.inbox_ids: set[str] = set()
        self.inbox_links: list[dict[str, str]] = []
        self.skipped: list[dict[str, str]] = []
        self.relation_count = 0
        self.plain_count = 0
        seen: set[tuple[Any, ...]] = set()

        cache: dict[str, dict[str, list[str]]] = {}

        def page_types(page: str) -> dict[str, list[str]]:
            """The type ids of the page's candidates, by `norm_name` of their names and aliases."""
            if page in cache:
                return cache[page]
            r = self.results.get(page) or {}
            out: dict[str, list[str]] = {}
            for c in [r.get("mainEntity"), *(r.get("entities") or [])]:
                if isinstance(c, dict) and c.get("ok"):
                    for s in [c.get("name"), *(c.get("aliases") or [])]:
                        k = norm_name(str(s or ""))
                        if k:
                            out.setdefault(k, []).append(str(c.get("typeId") or ""))
            cache[page] = out
            return out

        def side(name: str, page: str) -> tuple[str, Any]:
            k = norm_name(name)
            found = [by_key[(tid, k)] for tid in page_types(page).get(k, []) if (tid, k) in by_key]
            if not found:
                hits = {e.id: e for e in everyone if k in e.keys}
                found = list(hits.values()) if len(hits) == 1 else []
            if found:
                e = found[0]
                if e.id in paths:
                    return "entity", e
                if e.id in self.failed_ids:
                    return "skip", SKIP_NOT_PLACED
                if e.id in decided:
                    return "skip", SKIP_TURNED_DOWN
            obj = self._find_object(name)
            if obj is None:
                return "skip", SKIP_UNKNOWN
            if obj == "source":
                return "skip", SKIP_SOURCE
            return "object", obj

        for rel in self.res.relations:
            subject, relation, obj = str(rel.get("subject") or ""), str(rel.get("relation") or ""), str(rel.get("object") or "")
            page = str(rel.get("page") or "")
            row = {"subject": subject, "relation": relation, "object": obj}
            ends = [side(subject, page), side(obj, page)]
            why = next((v for kind, v in ends if kind == "skip"), None)
            pth = [paths[v.id] if kind == "entity" else v for kind, v in ends] if why is None else []
            if why is None and pth[0] == pth[1]:
                why = SKIP_SAME
            if why is None and not any(kind == "entity" for kind, _v in ends):
                why = SKIP_NO_ENTITY
            if why is not None:
                self.skipped.append({**row, "reason": why})
                continue
            (sk, sv), (_ok, ov) = ends
            holder_id = sv.id if sk == "entity" else ov.id
            low = rel.get("confidence") == "low" or any(kind == "entity" and v.confidence == "low" for kind, v in ends)
            if low:
                key = ("inbox", subject.casefold(), relation.casefold(), obj.casefold())
                if key not in seen:
                    seen.add(key)
                    self.inbox_ids.add(holder_id)
                    hp = paths[holder_id]
                    self.inbox_links.append({"path": hp, "title": self._title(hp),
                                             "reason": INBOX_REASON.format(subject=subject, relation=relation, object=obj)})
                continue
            match = None
            if not rel.get("plain"):
                from ..counterparts import find_relation

                types = [self._type_id(p) for p in pth]
                match = find_relation(self.space.types, types[0], types[1], relation)
            holder, target = (pth[1], pth[0]) if match is not None and match.reversed else (pth[0], pth[1])
            if match is not None:
                t = self.space.type_by_id(self._type_id(holder))
                pdef = t.prop(match.property_key) if t is not None else None
                if pdef is None or pdef.type != "entity" or getattr(pdef, "synced", None):
                    match = None
            if match is None:
                # a plain link, in the subject's section (else the object's, when only it is an entity)
                at, other = (sv.id, pth[1]) if sk == "entity" else (ov.id, pth[0])
                key = ("plain", at, other, relation.casefold())
                if key not in seen:
                    seen.add(key)
                    self.plain_count += 1
                    self.plain.setdefault(at, []).append(
                        {"link": self._link(other, paths[at]), "relation": " ".join(relation.split()), "page": page})
                continue
            key = ("stored", holder, match.property_key, target)
            if key not in seen:
                seen.add(key)
                self.relation_count += 1
                targets = self.stored.setdefault(holder, {}).setdefault(match.property_key, [])
                if target not in targets:
                    targets.append(target)

    def _type_id(self, path: str) -> str:
        s = self._summary(path)
        return s.type if s is not None else ""

    def _find_object(self, name: str) -> str | None:
        """An object of the space named so (title or alias) that isn't a Source; ``"source"`` when only a Source is."""
        hit = self.space.resolve(name, None)
        if hit is not None and not self._is_source(hit):
            s = self._summary(hit)
            if s is not None and s.template is None:
                return hit
        if self._names is None:
            self._names = {}
            for s in self.space.list():
                if s.template is None and s.type != sources.SOURCE_TYPE_ID:
                    for n in dict.fromkeys(norm_name(x) for x in [s.title, *s.aliases]):
                        self._names.setdefault(n, []).append(s.path)
        found = self._names.get(norm_name(name), [])
        if len(found) == 1:
            return found[0]
        return "source" if hit is not None else None

    # -- 3. values, aliases, Sources, tags, collections and stored relations ----------------------

    def _relation_updates(self, path: str, current: dict[str, Any], updates: dict[str, Any]) -> None:
        t = self.space.type_by_id(self._type_id(path))
        for key, targets in self.stored.get(path, {}).items():
            pdef = t.prop(key) if t is not None else None
            if pdef is None:
                continue
            cur = updates.get(key, current.get(key))
            cur = list(cur) if isinstance(cur, list) else ([] if not _has(cur) else [cur])
            have = set(self._ref_paths(cur, path))
            add = [p for p in targets if p not in have]
            if not add:
                continue
            if pdef.options.get("isArray") is False:
                if cur:
                    continue  # one value only, and it has one: left as it is
                add = add[:1]
            updates[key] = [*cur, *({"target": self._title(p), "path": p} for p in add)]

    def _write_props(self, e: Entity | None, name: str, path: str, updates: dict[str, Any]) -> None:
        """One `update_properties`; when the app refuses it, value by value (the refused ones listed)."""
        if not updates:
            return
        try:
            _of, _fm, version = self.space.read(path)
            self.space.update_properties(path, updates, version)
            return
        except InvalidValue:
            pass
        for key, value in updates.items():
            try:
                _of, _fm, version = self.space.read(path)
                self.space.update_properties(path, {key: value}, version)
            except InvalidValue as exc:
                self.failed.append({"name": name, "reason": f"{key}: {exc}"[:200]})

    def values(self, e: Entity, name: str, path: str) -> None:
        if self._done(e.id, "values"):
            return
        from . import filing

        space = self.space
        t = space.type_by_id(self._type_id(path))
        current = self._values(path)
        rid = self._record_id(path)
        record = distill.load_record(space.root, rid) or {}
        before = record.get("values") if isinstance(record.get("values"), dict) else {}
        updates: dict[str, Any] = {}
        kept: dict[str, Any] = {}
        merged = self._merged_values(e, before)
        for key in e.values:
            pv = merged[key]
            pdef = t.prop(key) if t is not None else None
            if pdef is None or pdef.type == "entity" or key == "sources" or getattr(pdef, "synced", None):
                continue
            win, cur = pv["value"], current.get(key)
            prev = (before.get(key) or {}).get("setByImport") if isinstance(before.get(key), dict) else None
            set_by = prev  # Gene's value (or the one the import set and still holds) stays
            if not _has(cur) or (prev is not None and _same(cur, prev) and not _same(cur, win)):
                updates[key] = win
                set_by = win
            kept[key] = {"value": win, "setByImport": set_by, "sources": pv["sources"], "conflict": pv["conflict"]}

        # aliases: the entity's spellings, old ones first, never the title
        title = self._title(path)
        cur_aliases = [str(a) for a in current.get("aliases") or [] if isinstance(a, str)]
        seen = {a.casefold() for a in cur_aliases} | {title.casefold()}
        new_aliases = list(cur_aliases)
        for s in [name, e.name, *e.aliases]:
            if s and s.casefold() not in seen:
                seen.add(s.casefold())
                new_aliases.append(s)
        if new_aliases != cur_aliases:
            updates["aliases"] = new_aliases

        # Sources: the current ones, then every Source of the entity (main first)
        sp = t.prop("sources") if t is not None else None
        if sp is not None and sp.type == "entity":
            cur = list(current.get("sources") or [])
            have = set(self._ref_paths(cur, path))
            add = [p for p in e.pages if p not in have and self._is_source(p)]
            if add:
                updates["sources"] = [*cur, *({"target": self._title(p), "path": p} for p in add)]

        # tags and collections of the pages it is the main entity of; the inbox for a low link
        for field_ in ("tags", "collections"):
            wanted: list[str] = []
            for page in e.mainPages:
                for row in (self.results.get(page) or {}).get(field_) or []:
                    if isinstance(row, dict) and row.get("ok") and str(row.get("value") or "").strip():
                        wanted.append(str(row["value"]).strip())
            if field_ == "collections" and e.id in self.inbox_ids:
                wanted.append(filing.ensure_inbox(space, self._type_id(path)))
            cur = [str(v) for v in current.get(field_) or []]
            have = {v.casefold() for v in cur}
            add = [v for v in dict.fromkeys(wanted) if v.casefold() not in have]
            if add:
                updates[field_] = [*cur, *add]

        self._relation_updates(path, current, updates)
        self._write_props(e, name, path, updates)
        record.update({"id": rid, "path": path, "batch": self.batch, "values": {**before, **kept}})
        record.setdefault("section", None)
        distill.save_record(space.root, rid, record)
        self._mark(e.id, "values")

    def other_relations(self, placed_paths: set[str]) -> None:
        """A stored relation on an object that is no entity of this Write: its own single write."""
        for path in self.stored:
            if path in placed_paths or self._is_source(path):
                continue
            key = f"object:{path}"
            if self._done(key, "values"):
                continue
            updates: dict[str, Any] = {}
            self._relation_updates(path, self._values(path), updates)
            self._write_props(None, self._title(path), path, updates)
            self._mark(key, "values")

    # -- 4. the section ---------------------------------------------------------------------------

    def section(self, e: Entity, path: str) -> None:
        if self._done(e.id, "section"):
            return
        space = self.space
        rid = self._record_id(path)
        record = distill.load_record(space.root, rid) or {"id": rid, "path": path, "batch": self.batch}
        sec = record.get("section") if isinstance(record.get("section"), dict) else None
        before = record.get("values") if isinstance(record.get("values"), dict) else {}
        picked = self._merged_values(e, before)
        self.picked[e.id] = picked
        recorded = sec.get("cites") if sec is not None and isinstance(sec.get("cites"), dict) else {}
        # the versions of this batch's Sources; an earlier Write's other Sources keep their recorded ones
        cites: dict[str, str] = {p: v for p, v in recorded.items() if self._earlier(e, p)}
        fresh: dict[str, str] = {}
        for p in e.pages:
            try:
                fresh[p] = space.read(p)[2]
            except (KeyError, ValueError, OSError):
                continue
        cites.update(fresh)
        if sec is not None and set(cites) == set(recorded) and all(recorded.get(p) == v for p, v in fresh.items()):
            self.rec["sections"][e.id] = "kept"
            self._mark(e.id, "section")
            return
        t = space.type_by_id(self._type_id(path))

        def label(key: str) -> str:
            p = t.prop(key) if t is not None else None
            return p.name if p is not None else key

        lines, main, plain = self._merged_section(e, sec, self.plain.get(e.id, []))
        text = distill.build_section(lines, picked, plain, lambda p: self._link(p, path), label)
        empty = not lines and not plain and not any(pv.get("conflict") for pv in picked.values())
        outcome: list[str] = ["kept"]

        def edit(of: Any, _fm: dict) -> Any:
            outcome[0] = "kept"
            if empty and sec is None and distill.find_section(of.body) is None:
                outcome[0] = "empty"  # nothing to say: no empty section is added
                return None
            try:
                body = distill.replace_section(of.body, text, sec.get("hash") if sec is not None else None)
            except distill.SectionEdited:
                outcome[0] = "left"
                return None
            if body == of.body:
                return None
            outcome[0] = "written"
            return replace(of, body=body)

        _of, _fm, version = space.read(path)
        space._write(path, version, edit)
        if outcome[0] == "left":
            self.rec["sections"][e.id] = "left"
            self.sections_left.append({"path": path, "title": self._title(path),
                                       "text": SECTION_LEFT.format(title=self._title(path))})
        elif outcome[0] == "empty":
            self.rec["sections"][e.id] = "kept"
        else:
            record["section"] = {"hash": distill.section_hash(text), "cites": cites, "lines": lines,
                                 "mainPages": main, "plain": plain}  # fmt: skip
            record.update({"id": rid, "path": path, "batch": self.batch})
            distill.save_record(space.root, rid, record)
            self.rec["sections"][e.id] = outcome[0]
        self._mark(e.id, "section")

    # -- the run ----------------------------------------------------------------------------------

    def run(self) -> dict[str, Any]:
        from ..space import Conflict, ReadOnly, TemplateError

        expected = (InvalidValue, ReadOnly, Conflict, TemplateError, KeyError)
        self.sections_left: list[dict[str, str]] = []
        paths: dict[str, str] = {}
        names: dict[str, str] = {}
        for e, name in self.chosen:
            names[e.id] = name
            try:
                paths[e.id] = self.place(e, name)
            except expected as exc:
                self._fail(e, name, exc)
        self.plan_relations(paths)
        for e, name in self.chosen:
            if e.id not in paths:
                continue
            try:
                self.values(e, name, paths[e.id])
            except expected as exc:
                self._fail(e, name, exc)
        self.other_relations(set(paths.values()))
        for e, name in self.chosen:
            if e.id not in paths or e.id in self.failed_ids:
                continue
            try:
                self.section(e, paths[e.id])
            except expected as exc:
                self._fail(e, name, exc)
        for e, _name in self.chosen:  # sections left alone in an earlier, interrupted run
            if self.rec["sections"].get(e.id) == "left" and not any(s["path"] == paths.get(e.id) for s in self.sections_left):
                p = paths.get(e.id)
                if p:
                    self.sections_left.append({"path": p, "title": self._title(p),
                                               "text": SECTION_LEFT.format(title=self._title(p))})

        conflicts: list[dict[str, Any]] = []
        for e, _name in self.chosen:
            p = paths.get(e.id)
            if p is None:
                continue
            t = self.space.type_by_id(self._type_id(p))
            if e.id not in self.picked:  # its steps were done by an earlier, interrupted run
                record = distill.load_record(self.space.root, self._record_id(p)) or {}
                before = record.get("values") if isinstance(record.get("values"), dict) else {}
                self.picked[e.id] = self._merged_values(e, before)
            for key, pv in self.picked[e.id].items():
                if not pv.get("conflict"):
                    continue
                pdef = t.prop(key) if t is not None else None
                conflicts.append({
                    "entity": {"path": p, "title": self._title(p)}, "key": key,
                    "name": pdef.name if pdef is not None else key,
                    "kept": {"value": pv["value"], "sources": self._cites(pv["sources"])},
                    "others": [{"value": c["value"], "sources": self._cites(c["sources"])} for c in pv["conflict"]],
                })  # fmt: skip
        created = sum(1 for e, _n in self.chosen if e.id in paths and self._done(e.id, "created"))
        outcome = {
            "created": created, "existing": len(paths) - created,
            "relations": self.relation_count, "plainLinks": self.plain_count,
            "relationsInbox": len(self.inbox_links),
            "sections": sum(1 for e, _n in self.chosen if self.rec["sections"].get(e.id) == "written"),
            "sectionsLeft": sum(1 for e, _n in self.chosen if self.rec["sections"].get(e.id) == "left"),
            "conflicts": len(conflicts), "failed": list(self.failed),
        }  # fmt: skip
        self.rec["outcome"] = outcome
        self._save()
        return {**outcome, "inboxLinks": list(self.inbox_links), "conflicts": conflicts,
                "skipped": list(self.skipped), "sectionsLeftList": list(self.sections_left)}  # fmt: skip

    def _cites(self, refs: list[Any]) -> list[dict[str, Any]]:
        return [{"path": r["path"], "title": self._title(r["path"]), "quote": r.get("quote") or "",
                 "modified": r.get("modified")} for r in refs]  # fmt: skip


def write_entities(
    space: Space,
    batch: str,
    system: str,
    imported_at: str,
    chosen: list[tuple[Entity, str]],
    res: Resolution,
    results: dict[str, dict[str, Any]],
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    """Write the ``chosen`` entities (entity, final name) of ``batch``; appends the created items to ``items``.

    Answers ``EntitiesWritten`` (``created``, ``existing``, ``relations``, ``plainLinks``,
    ``relationsInbox``, ``sections``, ``sectionsLeft``, ``conflicts``: a count, ``failed``; also
    stored as the record's ``outcome``) with, in the answer only, ``"conflicts"`` replaced by the
    list of ConflictRows, plus ``"inboxLinks": [{"path", "title", "reason"}]`` (the subject
    entity's path), ``"skipped": [{"subject", "relation", "object", "reason"}]`` and
    ``"sectionsLeftList": [{"path", "title", "text"}]`` (the report's line for each section left
    alone because Gene edited it).

    Steps, each recorded in `WRITTEN_FILE` before the next, so a retry skips what is done:
    place every entity (an object already in the space, one an earlier Write of this source made,
    else a new object with an ``importSource`` block and a ``created`` item); plan the relations
    (stored side by M28's `counterparts.find_relation`, plain links, low-confidence links to the
    inbox); one `update_properties` per object (values never replacing Gene's, aliases, Sources,
    tags and collections of the pages it is the main entity of, the Import inbox, stored
    relations); the "From sources" section, rewritten only when a cited Source changed or a new
    one cites it, and left alone when Gene edited it. Nothing writes a Source.

    Raises what it can't handle (a disk error...): the record keeps what was done."""
    return _Writer(space, batch, system, imported_at, chosen, res, results, items).run()
