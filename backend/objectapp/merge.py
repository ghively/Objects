"""Merge an object (or a tag) into another (M8 Task 6, `EntityMenu.mergeObject.*` / `mergeTag.*`).

"Single values already set on “{targetName}” stay. Lists are combined with “{sourceName}”, and
empty properties are filled from there. Content is added on." So `merge_objects`:

1. refuses merging into itself, a tag into a non-tag and a non-tag into a tag (`InvalidValue`,
   422) and a whiteboard on either side (our choice: a board's content is its sidecar files);
   checks both versions (`Conflict`, 409) and the 5,000 referencing-files limit (`TooLarge`,
   413) before anything is written;
2. writes the target once (stamped, through `Space._write` with the target's version): each
   property the target's type has and the target leaves empty takes the source's value; list
   values (relations, multi labels, tags, aliases, collections) are unioned, target first;
   values of properties the target's type lacks are dropped and listed in ``dropped`` (our
   choice); the source body is appended after the target body with one blank line;
3. relinks every link to the source (bodies, frontmatter values, board entity blocks and text
   links, and for a tag every ``tags:`` list) to the target with M2/M6's rename relinking;
4. moves the source to the app's trash (restorable).

`Space` is used as built: `_write`, `_apply_values`, `_sync_relations`, `_referrers`,
`_relink_edit`, `_rewrite_other`, `_board_referrers`, `relink_board_file`, `delete_object`.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field, replace
from datetime import datetime
from typing import TYPE_CHECKING, Any

from .frontmatter import remove_items
from .objfile import ObjectFile
from .propvalues import InvalidValue, _is_array, decode_value, label_lookup
from .relink import rewrite_tag_lists
from .space import Conflict, Skip

if TYPE_CHECKING:
    from .space import Space
    from .typedefs import PropertyDefinition, TypeDefinition

__all__ = ["MERGE_LIMIT", "MergeResult", "TooLarge", "merge_objects"]

MERGE_LIMIT = 5000
"""At most this many referencing files (`errorTooLarge`, ``{limit}``; our value)."""

# Keys a merge never copies: identity, kind, stamps, and what the app keeps beside another key.
_NOT_MERGED = frozenset(
    {"id", "type", "title", "template", "createdAt", "lastUpdated", "iconColor"}
)
_NOT_MERGED_KINDS = frozenset(
    {"entity_title", "entity_type", "entity_createdAt", "entity_lastUpdated", "entity_backlinks"}
)


class TooLarge(Exception):
    """More referencing files than `MERGE_LIMIT` (the route answers 413)."""

    def __init__(self, count: int, limit: int) -> None:
        super().__init__(f"Merging is limited to {limit} references ({count} found)")
        self.count = count
        self.limit = limit


@dataclass
class MergeResult:
    target: str
    version: str
    relinked: list[str] = field(default_factory=list)
    skipped: list[Skip] = field(default_factory=list)
    dropped: list[str] = field(default_factory=list)
    trashId: str = ""

    def to_api(self) -> dict[str, Any]:
        return {
            "target": self.target,
            "version": self.version,
            "relinked": list(self.relinked),
            "skipped": [asdict(s) for s in self.skipped],
            "dropped": list(self.dropped),
            "trashId": self.trashId,
        }


def _fold(text: Any) -> str:
    return " ".join(str(text).split()).casefold()


def _empty(raw: Any) -> bool:
    return raw is None or raw == "" or raw == [] or raw == {}


def _str_items(raw: Any) -> list[str]:
    items = raw if isinstance(raw, list) else [raw]
    return [str(i).strip() for i in items if isinstance(i, (str, int, float)) and str(i).strip()]


def _is_list(pdef: PropertyDefinition) -> bool:
    return pdef.type == "entity_collections" or (
        pdef.type in ("label", "entity", "entity_tags", "entity_aliases") and _is_array(pdef)
    )


def _merged_updates(
    space: Space,
    t: TypeDefinition | None,
    source: str,
    target: str,
    sfm: dict,
    tfm: dict,
) -> tuple[dict[str, Any], list[str]]:
    """The API-form updates that fill and combine the target's values, and the dropped keys."""
    updates: dict[str, Any] = {}
    dropped: list[str] = []
    for key, sraw in sfm.items():
        if not isinstance(key, str) or key in _NOT_MERGED or _empty(sraw):
            continue
        pdef = space._pdef(t, key)
        if pdef is None or (t is not None and t.prop(key) is None and key not in _SYSTEM_OK):
            # The target's type lacks it (system keys every object has are fine).
            if key not in tfm:
                dropped.append(key)
            continue
        if pdef.type in _NOT_MERGED_KINDS:
            continue
        traw = tfm.get(key)
        try:
            if _is_list(pdef):
                value = _union(space, pdef, source, target, sfm, tfm)
                if value is not None:
                    updates[key] = value
            elif _empty(traw):
                value = _single(space, pdef, source, target, sfm)
                if value is not None:
                    updates[key] = value
        except InvalidValue:
            dropped.append(key)
    return updates, dropped


# System properties an object of any type carries (`_CORE_SYSTEM_KEYS` and the optional ones).
_SYSTEM_OK = frozenset(
    {"collections", "description", "tags", "icon", "aliases", "coverImage", "color"}
)


def _entity_refs(space: Space, pdef: PropertyDefinition, raw: Any, at: str) -> list[dict]:
    """Entity references as API refs, resolved from ``at`` (a path wins when resolvable)."""
    out = []
    for ref in decode_value(pdef, raw):
        path = space.resolve(ref["target"], at)
        out.append({"target": ref["target"], "path": path})
    return out


def _union(
    space: Space, pdef: PropertyDefinition, source: str, target: str, sfm: dict, tfm: dict
) -> Any:
    """The combined list (API form), or ``None`` when the target already holds every item."""
    key = pdef.key
    if pdef.type == "entity":
        mine = _entity_refs(space, pdef, tfm.get(key), target)
        seen = {r["path"] or _fold(r["target"]) for r in mine}
        added = []
        for r in _entity_refs(space, pdef, sfm.get(key), source):
            if r["path"] in (source, target):
                continue  # a relation between the two would become a self-relation (our choice)
            k = r["path"] or _fold(r["target"])
            if k in seen:
                continue
            seen.add(k)
            added.append(r)
        if not added:
            return None
        # The target's own refs keep their text (no path: `link_for` writes the target as is);
        # the source's are written from the target's folder when they resolve.
        return [{"target": r["target"], "path": None} for r in mine] + added
    if pdef.type == "label":
        mine = decode_value(pdef, tfm.get(key))
        theirs = [x for x in decode_value(pdef, sfm.get(key)) if label_lookup(pdef, x)]
    elif pdef.type == "entity_collections":
        mine, theirs = _str_items(tfm.get(key)), _str_items(sfm.get(key))
    else:  # tags, aliases
        mine = decode_value(pdef, tfm.get(key))
        theirs = decode_value(pdef, sfm.get(key))
    seen = {_fold(x) for x in mine}
    added = []
    for x in theirs:
        if _fold(x) not in seen:
            seen.add(_fold(x))
            added.append(x)
    return [*mine, *added] if added else None


def _single(space: Space, pdef: PropertyDefinition, source: str, target: str, sfm: dict) -> Any:
    """The source's value for an empty single-value property of the target (API form)."""
    if pdef.type == "entity":  # a single relation (isArray false)
        refs = [
            r
            for r in _entity_refs(space, pdef, sfm.get(pdef.key), source)
            if r["path"] not in (source, target)
        ]
        return refs[:1] or None
    if pdef.type == "label":
        texts = [x for x in decode_value(pdef, sfm.get(pdef.key)) if label_lookup(pdef, x)]
        return texts[:1] or None
    value = decode_value(pdef, sfm.get(pdef.key), sfm)
    return None if _empty(value) else value


def _joined_body(target_body: str, source_body: str) -> str:
    """The target body, one blank line, then the source body (content is added on)."""
    if not source_body.strip():
        return target_body
    added = source_body.lstrip("\r\n")
    if not target_body.strip():
        return added
    return target_body.rstrip("\r\n") + "\n\n" + added


def _tag_holders(space: Space, title: str, exclude: str) -> list[str]:
    folded = _fold(title)
    with space._lock:
        raws = list(space._raw.items())
    return sorted(
        rel
        for rel, raw in raws
        if rel != exclude
        and any(_fold(t) == folded for t in _str_items(raw.fm.get("tags")))
    )


def _tracked(edit):
    wrote: list[bool] = []

    def run(of: ObjectFile, fm: dict) -> ObjectFile | None:
        out = edit(of, fm)
        wrote.append(out is not None)
        return out

    return run, wrote


def merge_objects(
    space: Space,
    source: str,
    target: str,
    source_version: str,
    target_version: str,
    now: datetime | None = None,
) -> MergeResult:
    """Merge ``source`` into ``target``; the source goes to the trash.

    Raises `KeyError` (no such object), `InvalidValue` (422), `Conflict` (409: either version
    is stale; nothing is written), `TooLarge` (413) and `ReadOnly` (423: the target can't be
    saved). Links in files that can't be rewritten are reported in ``skipped``.
    """
    src = space._rel(source)
    dst = space._rel(target)
    for rel in (src, dst):
        if not (space.root / rel).is_file():
            raise KeyError(rel)
    if src == dst:
        raise InvalidValue("An object can't be merged into itself")
    s_sum = space.get(src)
    t_sum = space.get(dst)
    if (s_sum.type == "tag") != (t_sum.type == "tag"):
        raise InvalidValue("A tag can only be merged into another tag")
    if space._is_whiteboard(src) or space._is_whiteboard(dst):
        raise InvalidValue("Whiteboards can't be merged")

    s_of, sfm, s_ver = space.read(src)
    _t_of, tfm, t_ver = space.read(dst)
    if s_ver != source_version:
        raise Conflict(s_ver)
    if t_ver != target_version:
        raise Conflict(t_ver)
    is_tag = s_sum.type == "tag"
    s_title = s_sum.title

    referrers = space._referrers(src, s_title)
    boards = space._board_referrers(src, s_title)
    holders = _tag_holders(space, s_title, src) if is_tag else []
    count = len(({*referrers, *boards, *holders}) - {src})
    if count > MERGE_LIMIT:
        raise TooLarge(count, MERGE_LIMIT)

    # 1. The target: filled and combined values, the source body added on (one stamped write).
    t = space._type_of(dst)
    updates, dropped = _merged_updates(space, t, src, dst, sfm, tfm)
    before: dict = {}

    def edit(of: ObjectFile, fm: dict) -> ObjectFile | None:
        before.update(fm)
        fm_src = of.frontmatter_src or ""
        if updates:
            fm_src = space._apply_values(t, dst, fm_src, fm, updates)
        body = _joined_body(of.body, s_of.body)
        if fm_src == (of.frontmatter_src or "") and body == of.body:
            return None
        keep_none = of.frontmatter_src is None and not fm_src
        return replace(of, frontmatter_src=None if keep_none else fm_src, body=body)

    version = space._write(dst, target_version, edit, now=now)
    _of, new_fm, _v = space.read(dst)
    _synced, skipped = space._sync_relations(dst, t, before, new_fm)

    # 2. Relink every link to the source (the target's copied content included).
    relinked: list[str] = []
    referrers = space._referrers(src, s_title)
    for ref in sorted(referrers):
        if ref == src:
            continue
        run, wrote = _tracked(space._relink_edit(referrers[ref], space._link_text(dst, ref)))
        result = space._rewrite_other(ref, run)
        if isinstance(result, Skip):
            skipped.append(result)
        elif wrote and wrote[-1]:
            relinked.append(ref)
    boards = space._board_referrers(src, s_title)
    if boards:
        from .whiteboardtrash import relink_board_file

        for md in sorted(boards):
            if md == src:
                continue
            written = relink_board_file(space, md, boards[md], space._link_text(dst, md))
            if written is not None:
                relinked.append(written)
                space.rescan_file(md)

    # 3. A tag: every `tags:` list naming the source names the target (once).
    if is_tag:
        t_title = t_sum.title
        for rel in _tag_holders(space, s_title, src):
            run, wrote = _tracked(space._fm_edit(_retag(s_title, t_title)))
            result = space._rewrite_other(rel, run)
            if isinstance(result, Skip):
                skipped.append(result)
            elif wrote and wrote[-1] and rel not in relinked:
                relinked.append(rel)

    # 4. The source goes to the trash.
    item = space.delete_object(src)
    final = space.cached_version(dst) or version
    return MergeResult(
        target=dst,
        version=final,
        relinked=[p for p in relinked if p != dst],
        skipped=skipped,
        dropped=dropped,
        trashId=item.id,
    )


def _retag(old: str, new: str):
    """Rename tag ``old`` to ``new`` in a ``tags:`` list, or drop it when ``new`` is there too."""
    old_f, new_f = _fold(old), _fold(new)

    def apply(src: str, fm: dict) -> str:
        items = _str_items(fm.get("tags"))
        if any(_fold(i) == new_f for i in items):
            out = remove_items(src, "tags", lambda s: _fold(s) == old_f)
            if out is not None:
                return out
        return rewrite_tag_lists(src, fm, old, new)

    return apply

