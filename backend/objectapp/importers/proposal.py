"""M27: the schema proposal in an import batch's records (design section 8).

``proposal.json`` holds what an agent (or Gene) proposes, ``proposal-review.json`` Gene's decision
per item. Saving and reading write only these two files. **Apply** (`apply`) is the only thing
here that touches the space (it creates and edits types); it is an app route and never an MCP tool,
so an agent can't approve its own schema.

The app checks the rules of section 8 when a proposal is saved (the result is stored with each
item, as ``problems``, ``dropped`` and ``merged``) and again when an item is applied:

- a new type needs at least `MIN_DOCUMENTS` documents and properties of its own;
- a property needs a value in at least `MIN_SHARE` of its group (the evidence must say so);
- options are merged when they differ only by case, spacing, punctuation or a common abbreviation,
  and the merge is shown (``merged``);
- relation properties name a proposed type or an existing one.

M30 (design 2026-11-09 section 5b), M31 (Gene's decision 1, "spaces never change behaviour"): in
every space, whatever its setup, the conventions are rules too. A new type whose properties match an existing type's (`lookalike`) is refused with the
offer "Use <type>, with a category" (``offer``); a new type named like a category (a label option
of a type, or a tag) is refused, with the offer for the type holding that option; a relation
property outside the named set (`named_relations`) is dropped and stays a plain link. Gene takes
the offer with ``{status: "edited", edited: {useType, category}}``: the item becomes an extend of
that type adding the category to its Category (else Kind) options, or a plain use.

Item shape (input; the stored form adds what the checks found)::

    {id?, action: "use"|"extend"|"create", group, name, pluralName?, icon?, color?, typeId?,
     documents, examples: [paths], properties: [{key?, name, kind, isArray?, share | withValue,
     options?: [text | {value, count}], target?, source?}]}
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ..ids import new_ulid
from ..typedefs import SYSTEM_KEYS, slug
from ..typemodel import PROPERTY_ICONS, Icon, PropertyDefinition, label_options
from . import batches
from .model import IMPORT_KINDS

if TYPE_CHECKING:
    from ..space import Space
    from ..typemodel import TypeDefinition

__all__ = [
    "ABBREVIATIONS",
    "CATEGORY_LABELS",
    "INBOX_NAME",
    "LOOKALIKE_SHARE",
    "MIN_DOCUMENTS",
    "MIN_SHARE",
    "OFFER",
    "ProposalConflict",
    "ProposalInvalid",
    "apply",
    "approved_create_names",
    "category_labels",
    "effective_item",
    "load_proposal",
    "load_review",
    "lookalike",
    "merge_options",
    "named_relations",
    "near_duplicates",
    "save_proposal",
    "save_review",
    "view",
]

MIN_DOCUMENTS = 10
MIN_SHARE = 0.30
INBOX_NAME = "Import inbox"
PROPOSAL_FILE = "proposal.json"
REVIEW_FILE = "proposal-review.json"
ACTIONS = ("use", "extend", "create")
STATUSES = ("accepted", "edited", "rejected")
MAX_ITEMS = 200
MAX_PROPERTIES = 60
MAX_OPTIONS = 100
LOOKALIKE_SHARE = 0.8
"""M30: a new type is a look-alike when this share of its properties (by name) are an existing type's."""
OFFER = "Use {type}, with a category"
CATEGORY_LABELS = ("category", "kind", "environment")
"""M30: the label properties whose options are categories (by name or key, any case), on any type but Source."""

ABBREVIATIONS: dict[str, str] = {
    "prod": "production", "prd": "production", "dev": "development", "stg": "staging",
    "stage": "staging", "tst": "test", "qa": "quality assurance", "uat": "user acceptance testing",
    "eng": "engineering", "mgmt": "management", "mgr": "manager", "admin": "administration",
    "infra": "infrastructure", "doc": "document", "docs": "documents", "info": "information",
    "hr": "human resources", "it": "information technology", "ops": "operations",
}
"""Common abbreviations (our short list): a value whose normal form is a key is the same as the long form."""


class ProposalInvalid(ValueError):
    """The proposal isn't shaped like one (422)."""


class ProposalConflict(Exception):
    """The stored proposal changed since the revision the caller read (409)."""

    def __init__(self, current: str) -> None:
        super().__init__("The proposal changed. Read it again.")
        self.current = current


def _now() -> str:
    m = datetime.now(UTC)
    return m.strftime("%Y-%m-%dT%H:%M:%S.") + f"{m.microsecond // 1000:03d}Z"


def _revision(data: Any) -> str:
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:16]


# -- option merging ----------------------------------------------------------------------


def _form(text: str) -> str:
    """A comparison form: case, spacing, punctuation and a common abbreviation do not matter."""
    t = re.sub(r"[\s_\-./]+", " ", str(text).casefold().replace("&", " and ")).strip()
    t = re.sub(r"[^\w ]", "", t)
    words = [ABBREVIATIONS.get(w, w) for w in t.split()]
    return " ".join(words)


def _squash(text: str) -> str:
    return _form(text).replace(" ", "")


def near_duplicates(values: list[str], counts: dict[str, int] | None = None) -> list[dict[str, Any]]:
    """Groups of spellings that mean the same: ``[{values: [...], suggested: str}]``.

    ``suggested`` is the most used spelling (first seen on a tie). Only groups of two or more come back."""
    counts = counts or {}
    groups: dict[str, list[str]] = {}
    for v in values:
        t = str(v).strip()
        if t:
            groups.setdefault(_squash(t), [])
            if t not in groups[_squash(t)]:
                groups[_squash(t)].append(t)
    out: list[dict[str, Any]] = []
    for members in groups.values():
        if len(members) > 1:
            best = max(members, key=lambda m: (counts.get(m, 0), -members.index(m)))
            out.append({"values": members, "suggested": best})
    return out


def merge_options(options: list[Any]) -> tuple[list[str], list[dict[str, Any]]]:
    """(canonical options, merges shown) of an option list given as texts or ``{value, count}``."""
    texts: list[str] = []
    counts: dict[str, int] = {}
    for o in options:
        if isinstance(o, dict):
            text, n = str(o.get("value", o.get("text", ""))).strip(), o.get("count")
        else:
            text, n = str(o).strip(), None
        if not text:
            continue
        if text not in texts:
            texts.append(text)
        counts[text] = counts.get(text, 0) + (n if isinstance(n, int) and n > 0 else 1)
    merged = near_duplicates(texts, counts)
    pick = {v: g["suggested"] for g in merged for v in g["values"]}
    out: list[str] = []
    for t in texts:
        c = pick.get(t, t)
        if c not in out:
            out.append(c)
    return out[:MAX_OPTIONS], [{"values": g["values"], "to": g["suggested"]} for g in merged]


# -- the conventions (M30, design 5b; in every space since M31) -----------------------------------


_SOURCE_TYPE = "source"
"""M30's Source type (`sources.SOURCE_TYPE_ID`): made by imports only, so never offered."""


def named_relations(space: Space) -> set[str]:
    """The casefolded names of every relation property of the space's types and of their counterparts."""
    out: set[str] = set()
    for t in space.types:
        for pd in t.propertyDefinitions:
            if pd.type != "entity":
                continue
            out.add(_text(pd.name).casefold())
            cp = pd.options.get("counterpart")
            if isinstance(cp, dict) and _text(cp.get("name")):
                out.add(_text(cp.get("name")).casefold())
    out.discard("")
    return out


def _own_names(t: TypeDefinition) -> set[str]:
    """A type's own properties (not the system ones), in `_squash` form."""
    return {
        _squash(pd.name)
        for pd in t.propertyDefinitions
        if pd.key not in SYSTEM_KEYS and not pd.type.startswith("entity_") and _squash(pd.name)
    }


def lookalike(props: list[dict[str, Any]], space: Space, *, exclude: str | None = None) -> TypeDefinition | None:
    """The existing type a new type with ``props`` looks like: at least two properties, of which
    `LOOKALIKE_SHARE` or more (by `_squash` of the name) are that type's own. The best share wins,
    then the most shared properties, then the space's type order. Never the Source type, nor
    ``exclude`` (the item's own type id)."""
    names = {_squash(_text(p.get("name") or p.get("key"), 100)) for p in props if isinstance(p, dict)}
    names.discard("")
    if len(names) < 2:
        return None
    best: tuple[float, int] | None = None
    found: TypeDefinition | None = None
    for t in space.types:
        if t.id in (_SOURCE_TYPE, exclude):
            continue
        shared = len(names & _own_names(t))
        rank = (shared / len(names), shared)
        if rank[0] >= LOOKALIKE_SHARE and (best is None or rank > best):
            best, found = rank, t
    return found


def _category_label(t: TypeDefinition) -> Any:
    """The type's Category label property, else its Kind; None when it has neither."""
    for word in ("category", "kind"):
        for pd in t.propertyDefinitions:
            if pd.type == "label" and (pd.key.casefold() == word or _text(pd.name).casefold() == word):
                return pd
    return None


def category_labels(t: TypeDefinition) -> list[Any]:
    """The type's label properties whose options are categories: named (or keyed) Category, Kind or
    Environment, any case (`CATEGORY_LABELS`); none on the Source type, whose Category and System
    say what a page is and where it came from, not a kind of thing."""
    if t.id == _SOURCE_TYPE:
        return []
    return [pd for pd in t.propertyDefinitions
            if pd.type == "label" and (pd.key.casefold() in CATEGORY_LABELS or _text(pd.name).casefold() in CATEGORY_LABELS)]


def _category_of(space: Space, name: str) -> tuple[bool, TypeDefinition | None]:
    """(whether ``name`` is a category, the type to offer): an option of a type's Category, Kind or
    Environment label (`category_labels`; the type's Category or Kind first, then any of them, in type
    order), or a tag's title (no type to offer). Any other label's options (Host's Roles, Script's
    Language) are not categories."""
    want = _squash(name)
    if not want:
        return False, None
    holders: list[tuple[int, TypeDefinition]] = []
    for t in space.types:
        label = _category_label(t)
        for pd in category_labels(t):
            texts = [str(o.get("text", "")) for o in pd.options.get("set") or [] if isinstance(o, dict)]
            if any(_squash(x) == want for x in texts):
                holders.append((0 if pd is label else 1, t))
    if holders:
        return True, min(holders, key=lambda h: h[0])[1]
    return any(_squash(s.title) == want for s in space.list("tag")), None


def _offer(t: TypeDefinition, group: str) -> dict[str, str]:
    return {"label": OFFER.format(type=t.name), "typeId": t.id, "category": group}


# -- normalising and checking an item ------------------------------------------------------------


def _text(v: Any, limit: int = 200) -> str:
    return " ".join(str(v or "").split())[:limit]


def _share(p: dict[str, Any], documents: int) -> float | None:
    s = p.get("share")
    if isinstance(s, (int, float)) and not isinstance(s, bool):
        return max(0.0, min(1.0, float(s) / 100 if s > 1 else float(s)))
    n = p.get("withValue", p.get("count"))
    if isinstance(n, int) and not isinstance(n, bool) and documents > 0:
        return max(0.0, min(1.0, n / documents))
    return None


def _check_item(raw: dict[str, Any], index: int, space: Space | None, names: set[str]) -> dict[str, Any]:
    """The stored form of one item: shape errors raise, rule violations are listed in ``problems``."""
    if not isinstance(raw, dict):
        raise ProposalInvalid(f"Item {index + 1} is not an object.")
    action = raw.get("action")
    if action not in ACTIONS:
        raise ProposalInvalid(f"Item {index + 1}: action is use, extend or create.")
    name = _text(raw.get("name"), 100)
    if not name:
        raise ProposalInvalid(f"Item {index + 1} needs a type name.")
    documents = raw.get("documents")
    if not isinstance(documents, int) or isinstance(documents, bool) or documents < 0:
        raise ProposalInvalid(f"Item {index + 1} ({name}): documents is the number of documents in the group.")
    iid = _text(raw.get("id"), 64) or f"item-{index + 1}"
    named = named_relations(space) if space is not None else set()
    problems: list[str] = []
    exists = f"A type named {name!r} already exists; use or extend it."
    type_id: str | None = None
    if space is not None:
        wanted = _text(raw.get("typeId"), 100) or name
        type_id = space.type_by_id(wanted).id if space.type_by_id(wanted) else None
        if type_id is None:
            tid = space._type_id(wanted)
            type_id = tid if space.type_by_id(tid) else None
    if action in ("use", "extend") and space is not None and type_id is None:
        problems.append(f"There is no type named {name!r} in this space.")
    if action == "create":
        if documents < MIN_DOCUMENTS:
            problems.append(
                f"A new type needs at least {MIN_DOCUMENTS} documents ({documents} here); "
                "make the group a tag or a collection on an existing type."
            )
        if type_id is not None and space is not None:
            problems.append(exists)
    props_in = raw.get("properties") or []
    if not isinstance(props_in, list):
        raise ProposalInvalid(f"Item {index + 1} ({name}): properties is a list.")
    if len(props_in) > MAX_PROPERTIES:
        raise ProposalInvalid(f"Item {index + 1} ({name}): at most {MAX_PROPERTIES} properties.")
    props: list[dict[str, Any]] = []
    dropped: list[dict[str, Any]] = []
    keys: set[str] = set()
    for p in props_in:
        if not isinstance(p, dict):
            raise ProposalInvalid(f"Item {index + 1} ({name}): a property is an object.")
        pname = _text(p.get("name") or p.get("key"), 100)
        if not pname:
            raise ProposalInvalid(f"Item {index + 1} ({name}): a property needs a name.")
        kind = p.get("kind", "text")
        if kind not in IMPORT_KINDS:
            raise ProposalInvalid(f'Item {index + 1} ({name}): the kind of "{pname}" is one of {', '.join(IMPORT_KINDS)}.')
        key = _text(p.get("key"), 100) or slug(pname)
        share = _share(p, documents)
        if key in SYSTEM_KEYS or key in keys:
            dropped.append({"key": key, "name": pname, "reason": "The key is already used (a system property or a repeat)."})
            continue
        if share is None:
            dropped.append({"key": key, "name": pname, "reason": "No evidence of how often it has a value."})
            continue
        if share < MIN_SHARE:
            dropped.append({"key": key, "name": pname,
                            "reason": f"It has a value in {round(share * 100)}% of the group; a property needs at least "
                                      f"{round(MIN_SHARE * 100)}%."})
            continue
        entry: dict[str, Any] = {
            "key": key, "name": pname, "kind": kind, "isArray": bool(p.get("isArray")),
            "share": round(share, 3), "source": _text(p.get("source"), 100) or None,
        }
        if kind == "label":
            options, merged = merge_options(p.get("options") or [])
            entry["options"] = options
            if merged:
                entry["merged"] = merged
            if not options:
                dropped.append({"key": key, "name": pname, "reason": "A label property needs the values found."})
                continue
        if kind == "entity" and space is not None and pname.casefold() not in named:
            dropped.append({"key": key, "name": pname, "reason": "Not one of the named relations; it stays a plain link."})
            continue
        if kind == "entity":
            target = _text(p.get("target"), 100)
            known = (space is not None and bool(space.type_by_id(space._type_id(target)))) if target else False
            if not target or (target.casefold() not in names and not known):
                dropped.append({"key": key, "name": pname,
                                "reason": f"A relation names a proposed or existing type ({target or 'none given'})."})
                continue
            entry["target"] = target
        keys.add(key)
        props.append(entry)
    if action == "create" and not props:
        problems.append("A new type needs properties of its own.")
    if action == "extend" and not props:
        problems.append("There is nothing to add: no property passed the checks.")
    group = _text(raw.get("group"), 200) or name
    offer: dict[str, str] | None = None
    if space is not None and action == "create":
        rules: list[str] = []
        like = lookalike(props, space, exclude=type_id)
        if like is not None:
            rules.append(f"It has the same properties as {like.name}.")
            offer = _offer(like, group)
        is_category, holder = _category_of(space, name)
        if is_category:
            rules.append(f"{name} is a category: a property value or a tag, not a type.")
            if offer is None and holder is not None:
                offer = _offer(holder, group)
        # The offer is what to do instead; M27's "use or extend it" would point at the wrong type.
        problems = [*rules, *(p for p in problems if not (offer and p == exists))]
    examples = [_text(e, 300) for e in (raw.get("examples") or [])[:5] if _text(e, 300)]
    out = {
        "id": iid, "action": action, "group": group, "name": name,
        "pluralName": _text(raw.get("pluralName"), 100) or (name if name.endswith("s") else name + "s"),
        "icon": raw.get("icon") if isinstance(raw.get("icon"), (str, dict)) else None,
        "color": _text(raw.get("color"), 30) or None,
        "typeId": type_id, "documents": documents, "examples": examples,
        "properties": props, "dropped": dropped, "problems": problems,
    }
    if offer is not None:
        out["offer"] = offer
    return out


def _check(items_in: list[Any], space: Space | None) -> list[dict[str, Any]]:
    if not isinstance(items_in, list) or not items_in:
        raise ProposalInvalid("A proposal has a list of items.")
    if len(items_in) > MAX_ITEMS:
        raise ProposalInvalid(f"A proposal has at most {MAX_ITEMS} items.")
    names = {_text(i.get("name"), 100).casefold() for i in items_in if isinstance(i, dict)}
    items = [_check_item(raw, n, space, names) for n, raw in enumerate(items_in)]
    seen: set[str] = set()
    for it in items:
        if it["id"] in seen:
            raise ProposalInvalid(f'Two items have the id "{it["id"]}".')
        seen.add(it["id"])
    return items


# -- records -----------------------------------------------------------------------------------


def _read(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def load_proposal(root: Path | str, batch: str) -> dict[str, Any] | None:
    data = _read(batches.batch_dir(root, batch) / PROPOSAL_FILE)
    return data if isinstance(data, dict) else None


def load_review(root: Path | str, batch: str) -> dict[str, Any]:
    data = _read(batches.batch_dir(root, batch) / REVIEW_FILE)
    return data if isinstance(data, dict) else {"items": {}, "applied": None}


def save_proposal(
    space: Space, batch: str, proposal: dict[str, Any], revision: str | None = None, *, origin: str = "agent"
) -> dict[str, Any]:
    """Store ``proposal`` (``{summary?, items}``) in the batch; returns the stored form with its ``revision``.

    A proposal already stored needs its ``revision`` (`ProposalConflict` otherwise). Decisions Gene
    made on items whose content did not change are kept; the others are open again."""
    root = space.root
    d = batches.batch_dir(root, batch)  # KeyError: no such batch
    if not (d / "batch.json").is_file():
        raise KeyError(batch)
    if not isinstance(proposal, dict):
        raise ProposalInvalid("A proposal is an object with items.")
    current = load_proposal(root, batch)
    if current is not None and revision != current.get("revision"):
        raise ProposalConflict(str(current.get("revision")))
    items = _check(proposal.get("items"), space)
    body = {"summary": _text(proposal.get("summary"), 1000), "items": items}
    stored = {**body, "revision": _revision(body), "savedAt": _now(), "origin": origin}
    batches.write_json(d / PROPOSAL_FILE, stored)
    review = load_review(root, batch)
    kept: dict[str, Any] = {}
    old = {i["id"]: i for i in (current or {}).get("items", [])}
    for iid, dec in (review.get("items") or {}).items():
        if iid in old and _revision(old[iid]) == _revision(next((i for i in items if i["id"] == iid), None)):
            kept[iid] = dec
    review["items"] = kept
    batches.write_json(d / REVIEW_FILE, review)
    return stored


def _find_type(space: Space | None, wanted: str) -> TypeDefinition | None:
    if space is None or not wanted:
        return None
    return space.type_by_id(wanted) or space.type_by_id(space._type_id(wanted))


def effective_item(item: dict[str, Any], decision: dict[str, Any] | None, space: Space | None) -> dict[str, Any]:
    """The item as Gene left it: his edits (``name``, ``plural``, ``dropProperties``) laid over it.

    M30: an edit with ``useType`` (the offer "Use <type>, with a category") makes the item an
    extend of that type adding ``category`` to its Category (else Kind) options; a type with
    neither label (or no ``space`` to look it up in), or a ``category`` that is already an option
    of one of the type's labels (Production in Host's Environment), makes it a plain use."""
    if not decision or decision.get("status") != "edited" or not isinstance(decision.get("edited"), dict):
        return item
    e = decision["edited"]
    out = dict(item)
    use = _text(e.get("useType"), 100) if isinstance(e.get("useType"), str) else ""
    if use:
        t = _find_type(space, use)
        category = _text(e.get("category"), 100) if isinstance(e.get("category"), str) else ""
        label = _category_label(t) if t is not None else None
        out.update({"typeId": t.id if t else use, "name": t.name if t else out["name"], "action": "use", "properties": []})
        if t is not None and category and any(
            _squash(str(o.get("text", ""))) == _squash(category)
            for pd in t.propertyDefinitions if pd.type == "label"
            for o in pd.options.get("set") or [] if isinstance(o, dict)
        ):  # fmt: skip
            return out  # already one of the type's options: nothing to add
        if label is not None and category:
            out["action"] = "extend"
            out["properties"] = [{"key": label.key, "name": label.name, "kind": "label",
                                  "isArray": bool(label.options.get("isArray")), "share": 1.0, "options": [category]}]
        return out
    if isinstance(e.get("name"), str) and e["name"].strip():
        out["name"] = e["name"]
    plural = e.get("plural", e.get("pluralName"))
    if isinstance(plural, str) and plural.strip():
        out["pluralName"] = plural
    drop = {str(k) for k in (e.get("dropProperties") or [])}
    if drop:
        out["properties"] = [p for p in item.get("properties", []) if p.get("key") not in drop]
    return out


def save_review(space: Space, batch: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    """Record Gene's decisions (``[{id, status, edited?}]``); returns the review. Writes only the review file."""
    root = space.root
    proposal = load_proposal(root, batch)
    if proposal is None:
        raise KeyError(batch)
    ids = {i["id"] for i in proposal["items"]}
    review = load_review(root, batch)
    decided = review.setdefault("items", {})
    if not isinstance(items, list):
        raise ProposalInvalid('"items" is a list.')
    for row in items:
        if not isinstance(row, dict) or row.get("id") not in ids:
            raise ProposalInvalid(f'There is no proposal item "{row.get("id") if isinstance(row, dict) else row}".')
        status = row.get("status")
        if status not in STATUSES:
            raise ProposalInvalid('"status" is accepted, edited or rejected.')
        entry: dict[str, Any] = {"status": status, "at": _now()}
        if status == "edited":
            edited = row.get("edited")
            if not isinstance(edited, dict):
                raise ProposalInvalid("An edited item says what the edit is.")
            base = next(i for i in proposal["items"] if i["id"] == row["id"])
            if not isinstance(edited.get("dropProperties", []), list):
                raise ProposalInvalid('"dropProperties" is a list of property keys.')
            if "useType" in edited:
                use = edited.get("useType")
                if not isinstance(use, str) or _find_type(space, use.strip()) is None:
                    raise ProposalInvalid(f'There is no type named "{use}" in this space.')
                if not isinstance(edited.get("category"), str) or not edited["category"].strip():
                    raise ProposalInvalid('"category" is the option to add to the type.')
            _check_item({**effective_item(base, {"status": "edited", "edited": edited}, space), "id": row["id"]}, 0, space,
                        {i["name"].casefold() for i in proposal["items"]})
            entry["edited"] = edited
        decided[row["id"]] = entry
    batches.write_json(batches.batch_dir(root, batch) / REVIEW_FILE, review)
    return review


def _group(it: dict[str, Any]) -> dict[str, Any]:
    """An item as the wizard's ``ProposalGroup``."""
    props = []
    for p in it["properties"]:
        row: dict[str, Any] = {"key": p["key"], "name": p["name"], "kind": p["kind"], "fillRate": p["share"]}
        if p.get("options"):
            row["options"] = p["options"]
        if p.get("merged"):
            row["mergedFrom"] = {m["to"]: m["values"] for m in p["merged"]}
        if p.get("target"):
            row["relationTo"] = p["target"]
        props.append(row)
    g: dict[str, Any] = {
        "id": it["id"], "action": it["action"], "name": it["name"], "plural": it["pluralName"],
        "documentCount": it["documents"], "examples": it["examples"], "properties": props,
        "group": it["group"], "problems": it["problems"], "dropped": it["dropped"],
    }
    if it.get("offer"):
        g["offer"] = it["offer"]
    if it.get("typeId"):
        g["typeId"] = it["typeId"]
    if isinstance(it.get("icon"), str):
        g["icon"] = it["icon"]
    if it.get("color"):
        g["color"] = it["color"]
    return g


def view(space: Space, batch: str) -> dict[str, Any]:
    """``{proposal, review}`` as the route answers it (reads only). No proposal yet: both null."""
    root = space.root
    proposal = load_proposal(root, batch)
    if proposal is None:
        return {"proposal": None, "review": None}
    review = load_review(root, batch)
    decided = review.get("items") or {}
    rows = []
    for it in proposal["items"]:
        d = decided.get(it["id"])
        if d:
            row: dict[str, Any] = {"id": it["id"], "status": d["status"]}
            if d.get("edited") is not None:
                row["edited"] = d["edited"]
            rows.append(row)
    return {
        "proposal": {"groups": [_group(i) for i in proposal["items"]], "revision": proposal["revision"],
                     "summary": proposal.get("summary", "")},
        "review": {"items": rows, "applied": review.get("applied")},
    }


def approved_create_names(root: Path | str, batch: str | None = None) -> set[str]:
    """Names (casefolded) of types an approved proposal creates, or has created (this batch, else every batch)."""
    out: set[str] = set()
    for b in ([{"id": batch}] if batch else batches.list_batches(root)):
        try:
            proposal = load_proposal(root, str(b["id"]))
        except KeyError:
            continue
        if proposal is None:
            continue
        decided = load_review(root, str(b["id"])).get("items") or {}
        for it in proposal["items"]:
            d = decided.get(it["id"])
            if not d or d.get("status") not in ("accepted", "edited"):
                continue
            eff = effective_item(it, d, None)
            if eff.get("action") == "create":
                out.add(_text(eff.get("name"), 100).casefold())
    return out


# -- Apply -------------------------------------------------------------------------------------


def _pdef(p: dict[str, Any], target_ids: dict[str, str]) -> PropertyDefinition:
    kind = p["kind"]
    data: dict[str, Any] = {
        "id": new_ulid(), "key": p["key"], "name": p["name"], "type": kind, "icon": PROPERTY_ICONS.get(kind),
    }
    if kind in ("label", "entity"):
        data["isArray"] = bool(p.get("isArray"))
    options: dict[str, Any] = {}
    if kind == "label":
        options["set"] = label_options(p.get("options") or [])
    if kind == "entity":
        tid = target_ids.get(str(p.get("target", "")).casefold())
        options["allowedTypes"] = [tid] if tid else []
        options["hasFixedSet"] = False
    data["options"] = options
    pdef = PropertyDefinition.from_json(data)
    pdef.icon = Icon("iconify", PROPERTY_ICONS.get(kind, PROPERTY_ICONS["text"]))
    return pdef


def _save_props(space: Space, type_id: str, props: list[dict[str, Any]], target_ids: dict[str, str]) -> bool:
    """Add the properties the type lacks; add missing options to existing label properties. True if it changed."""
    current, revision = space.refresh_type(type_id)
    if current is None:
        raise KeyError(type_id)
    edited = copy.deepcopy(current)
    have = {pd.key: pd for pd in edited.propertyDefinitions}
    changed = False
    for p in props:
        existing = have.get(p["key"])
        if existing is None:
            edited.propertyDefinitions.append(_pdef(p, target_ids))
            changed = True
        elif existing.type == "label" and p["kind"] == "label":
            known = {str(o.get("text", "")).strip().casefold() for o in existing.options.get("set") or [] if isinstance(o, dict)}
            add = [o for o in p.get("options") or [] if o.strip().casefold() not in known]
            if add:
                existing.options["set"] = [*(existing.options.get("set") or []), *label_options(add)]
                seen: set[str] = set()
                for opt in existing.options["set"]:
                    oid, n = str(opt.get("id") or "option"), 2
                    base = oid
                    while oid in seen:
                        oid, n = f"{base}-{n}", n + 1
                    opt["id"] = oid
                    seen.add(oid)
                changed = True
    if changed:
        space.save_type(edited, revision)
    return changed


def apply(space: Space, batch: str) -> dict[str, Any]:
    """Create and edit the types Gene approved. Answers ``{created: [typeId], extended: [typeId], skipped}``.

    Only items he accepted or edited, that pass the rules, are applied. Safe to run again: a type that
    already exists is not made twice. Writes types (and records the outcome in the review)."""
    root = space.root
    proposal = load_proposal(root, batch)
    if proposal is None:
        raise KeyError(batch)
    review = load_review(root, batch)
    decided = review.get("items") or {}
    names = {i["name"].casefold() for i in proposal["items"]}
    chosen: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    for it in proposal["items"]:
        d = decided.get(it["id"])
        if not d or d.get("status") not in ("accepted", "edited"):
            skipped.append({"id": it["id"], "reason": "Not approved." if not d else "Turned down."})
            continue
        eff = _check_item(effective_item(it, d, space), 0, space, names)
        eff["id"] = it["id"]
        if eff["action"] == "create" and eff["typeId"] is not None:
            # made by an earlier Apply (or by hand): the work is done
            skipped.append({"id": it["id"], "reason": "The type already exists."})
            continue
        if eff["problems"]:
            skipped.append({"id": it["id"], "reason": eff["problems"][0]})
            continue
        chosen.append(eff)
    created: list[str] = []
    extended: list[str] = []
    ids: dict[str, str] = {}  # casefolded type name -> id, for relations
    for it in chosen:
        if it["action"] != "create":
            continue
        t = space.create_type(it["name"], it["pluralName"], it["icon"], it["color"])
        created.append(t.id)
        ids[it["name"].casefold()] = t.id
    for t in space.types:
        ids.setdefault(t.name.casefold(), t.id)
    for it in chosen:
        if it["action"] == "use":
            continue
        tid = ids.get(it["name"].casefold()) if it["action"] == "create" else it["typeId"]
        if tid is None:
            continue
        changed = _save_props(space, tid, it["properties"], ids)
        if it["action"] == "extend" and changed:
            extended.append(tid)
    out = {"created": created, "extended": extended}
    review["applied"] = {**out, "skipped": skipped, "at": _now()}
    batches.write_json(batches.batch_dir(root, batch) / REVIEW_FILE, review)
    return {**out, "skipped": skipped}
