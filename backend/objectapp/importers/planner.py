"""The planner: a `ReadResult` plus a mapping and a target -> the contract's `ImportPlan`.

Shared by every source. It applies the mapping (types from databases, folders, a frontmatter
key or nothing; names, plurals, skips, existing types; property kinds, names and skips), picks
the property keys, guesses kinds, converts and encodes every value the way `update_properties`
writes it (values that don't fit are dropped and listed), plans each object's file and each
attachment's name against the target (an empty folder for a new space; the open space's files
for ``currentSpace``) and resolves links: the link text of an object is computed with the
app's own `Resolver` over what the target will hold, exactly as `Space._link_text` would
answer once the files exist (the title, else the path form for a shared title).

Nothing here reads the source or writes anything. The writer replays the plan; the preview
reports it (`to_preview`).
"""

from __future__ import annotations

import copy
import os
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import TYPE_CHECKING, Any

from ..ids import new_ulid
from ..media import ATTACHMENTS, MAX_ATTACHMENT_BYTES, _safe_attachment_name, kind_of
from ..propvalues import InvalidValue, encode_updates
from ..resolver import Resolver, fold
from ..space import _LINK_BREAKING_RE, ObjectSummary, safe_filename, unique_key
from ..typedefs import SYSTEM_KEYS, _humanize
from ..typemodel import (
    PROPERTY_ICONS,
    Icon,
    PropertyDefinition,
    TypeDefinition,
    label_options,
)
from ..whiteboardfile import BOARD_SUFFIX, INK_SUFFIX
from . import kinds
from .model import (
    IMPORT_KINDS,
    ImportCounts,
    ImportMapping,
    ImportPlan,
    ImportPreview,
    PlanAttachment,
    PlanLink,
    PlannedObjectSample,
    PlannedProperty,
    PlannedType,
    PlanObject,
    PlanProperty,
    PlanType,
    PropertyOverride,
    SkippedItem,
    TypeOverride,
)
from .readmodel import ReadObject, ReadResult

if TYPE_CHECKING:
    from ..space import Space

__all__ = ["MappingProblem", "Planned", "Target", "importable_type", "plan", "to_preview"]

PAGE_KEY = "page"
IMAGE_TYPE = "Image"
IMAGE_FOLDER = "Images"
TAG_FOLDER = "Tags"
MAX_PREVIEW_SKIPPED = 500
MAX_SAMPLES = 20

# Our strings: what the Page type stands for, per source.
_PAGE_ORIGIN = {
    "notion": "Pages outside every database",
    "folder": "Files at the root",
    "key": "Files without the key",
    "none": "Every file",
}

_TO_IMPORT_KIND = {
    "text": "text",
    "textBlock": "text",
    "number": "number",
    "boolean": "boolean",
    "url": "url",
    "datetime": "datetime",
    "datetimeSimple": "datetime",
    "label": "label",
    "entity": "entity",
}

_SYSTEM_KINDS = {"tags": "label", "aliases": "label", "description": "text", "createdAt": "datetime", "lastUpdated": "datetime"}


_IMPORTABLE_BASIC = frozenset({"page", "task"})


def importable_type(t: TypeDefinition) -> bool:
    """Whether imported pages can go into the existing type ``t`` (matched by name or chosen
    as ``existingTypeId``): every custom type and the basic Page and Task types, unless
    read-only. Every other basic type (Tag, DailyNote, Whiteboard, the media types Weblink,
    File, Image, PDF, Audio, Video, Tweet, any other) is left out: its objects aren't pages.
    The import dialog's "Add to" list uses the same rule."""
    if t.readOnlyReason:
        return False
    return not t.basic or t.name.casefold() in _IMPORTABLE_BASIC


def _imports_as_image(o: ReadObject, key: str, tw: TypeWrite, page_id: str) -> bool:
    """AC-2 (decisions memo 2026-11-08): an image file the Page type would take becomes an Image
    object (the design's readers table), not a Page holding the image. Images a mapping puts in
    another type (a folder or key type, an existing type chosen for the Page row) follow the mapping."""
    return (
        bool(o.native)
        and key == PAGE_KEY
        and tw.basic
        and tw.existingTypeId in (None, page_id)
        and kind_of(o.sourcePath) == "image"
    )


class MappingProblem(ValueError):
    """A mapping that names an unknown type, property or existing type (422)."""


@dataclass
class Target:
    """What the planner checks names against."""

    kind: str  # 'newSpace' | 'currentSpace'
    space: Space | None = None

    def types(self) -> list[TypeDefinition]:
        if self.space is None:
            # A new space: `Space()` writes the built-in Page and Tag types when it opens.
            from ..typemodel import BUILTIN_TYPES

            return [TypeDefinition.from_json(copy.deepcopy(s)) for s in BUILTIN_TYPES.values()]
        return list(self.space.types)

    def summaries(self) -> list[ObjectSummary]:
        if self.space is None:
            return []
        return self.space.list()

    def names_in(self, folder: str) -> set[str]:
        """Lower-cased names already in ``folder`` of the target (empty for a new space)."""
        if self.space is None:
            return set()
        base = self.space.root / folder if folder else self.space.root
        try:
            return {n.lower() for n in os.listdir(base)}
        except OSError:
            return set()


@dataclass
class PropStats:
    valueCount: int = 0
    unconvertible: int = 0
    samples: list[str] = field(default_factory=list)
    texts: list[str] = field(default_factory=list)


@dataclass
class TypeWrite:
    """What the writer does for one plan type."""

    key: str
    existingTypeId: str | None
    name: str
    pluralName: str
    folder: str
    basic: bool
    new_props: list[PropertyDefinition] = field(default_factory=list)
    """Properties to add (a new type: all of them)."""
    add_options: dict[str, list[str]] = field(default_factory=dict)
    """Existing label property key -> option texts to add."""


@dataclass
class ObjectWrite:
    """What the writer writes for one object (its frontmatter values already encoded)."""

    obj: PlanObject
    read: ReadObject
    typeName: str
    values: list[tuple[str, Any]] = field(default_factory=list)
    """(key, encoded value for `set_keys`) in source order."""
    tags: list[str] = field(default_factory=list)
    aliases: list[str] = field(default_factory=list)
    description: str | None = None
    createdAt: str = ""
    lastUpdated: str = ""
    existing: str | None = None
    """M25 re-run: the space path of the object an earlier import made from this source item."""
    media: str | None = None
    """"image": the file is an image the Page type would take; the writer makes an Image object (AC-2)."""


@dataclass
class Planned:
    plan: ImportPlan
    read: ReadResult
    mapping: ImportMapping
    target: str
    counts: ImportCounts
    stats: dict[tuple[str, str], PropStats]
    type_writes: dict[str, TypeWrite]
    writes: list[ObjectWrite]
    tags: list[str]
    """Every distinct tag the objects use (first spelling)."""
    links_by_object: dict[str, list[PlanLink]]
    object_link: Any
    """(target source path, linking source path) -> (link text, title)."""
    attachment_path: Any
    """(attachment source path) -> its planned space path, or None."""
    resolve_href: Any
    resolve_wiki: Any
    not_converted: list[tuple[str, str, str, str]] = field(default_factory=list)
    """(type name, property name, object source path, value) of every dropped value."""
    renamed: list[tuple[str, str]] = field(default_factory=list)
    """(title, planned path) of objects whose file name got `` (2)``."""
    unresolved: list[tuple[str, str]] = field(default_factory=list)
    """(object source path, link as written) of links that stay unresolved."""
    pdefs: dict[tuple[str, str], PropertyDefinition] = field(default_factory=dict)
    """(plan type key, property key) -> the definition its values were encoded for."""


def _stamp(dt: datetime) -> str:
    dt = dt.astimezone(UTC)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


# Words left as they are (our choice): already singular, or the same in both numbers.
_SINGULAR_KEEP = frozenset({"series", "species", "news", "status", "bus", "analysis", "basis", "gas", "lens", "atlas"})
# -ies words whose singular keeps the "ie" (Movies -> Movie, not Movy).
_IE_WORDS = frozenset({"movies", "cookies", "pies", "ties", "lies", "zombies", "selfies", "calories", "rookies", "hippies", "goalies", "smoothies", "brownies", "pixies", "aunties", "genies"})
# -ches words whose singular keeps the "e" (Caches -> Cache).
_CHES_WORDS = frozenset({"caches", "niches", "aches", "headaches", "avalanches", "moustaches", "mustaches", "cliches", "quiches"})
# Common irregular plurals (our choice): People -> Person, so a "People" folder joins the Person type.
_IRREGULAR = {"people": "person", "children": "child", "men": "man", "women": "woman", "mice": "mouse",
              "geese": "goose", "teeth": "tooth", "feet": "foot", "persons": "person"}


def _singular(name: str) -> str:
    """A folder name made singular by a plain English rule (our choice), applied to its last
    word: a few irregular plurals (``People`` -> ``Person``, ``Children`` -> ``Child``), ``-ies`` -> ``-y`` (``Stories``; ``Movies`` -> ``Movie``), ``-sses``, ``-xes``,
    ``-ches``, ``-shes`` drop ``es`` (``Classes``, ``Boxes``, ``Watches``,
    ``Wishes``), a final ``s`` is dropped unless the word ends ``ss``, ``us`` or ``is``; a few
    words (``Series``, ``Status``, ``News``…) stay as they are. Never answers an empty name."""
    head, _, word = name.rpartition(" ")
    low = word.lower()
    upper = word.isupper()

    def done(stem: str, add: str = "") -> str:
        out = stem + (add.upper() if upper else add)
        return f"{head} {out}" if head else out

    if low in _IRREGULAR:
        stem = _IRREGULAR[low]
        stem = stem.upper() if upper else (stem.capitalize() if word[:1].isupper() else stem)
        return f"{head} {stem}" if head else stem
    if len(low) <= 1 or not low.endswith("s") or low in _SINGULAR_KEEP:
        return name
    if low in _IE_WORDS or low in _CHES_WORDS:
        return done(word[:-1])
    if low.endswith("ies") and len(low) > 3:
        return done(word[:-3], "y")
    if low.endswith(("sses", "xes", "ches", "shes")) and len(low) > 4:
        return done(word[:-2])
    if low.endswith(("ss", "us", "is")) or low == "ies":
        return name
    return done(word[:-1])


def _scalar_type_value(value: Any) -> str | None:
    if isinstance(value, list):
        value = value[0] if len(value) == 1 else None
    if isinstance(value, bool) or value is None or isinstance(value, dict):
        return None
    text = " ".join(str(value).split())
    if text.startswith("[[") and text.endswith("]]"):
        text = text[2:-2].split("|", 1)[0].split("#", 1)[0].strip()
    return text or None


def _source_texts(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [t for v in value for t in _source_texts(v)]
    if isinstance(value, dict):
        return [str(value)]
    text = str(value).strip()
    return [text] if text else []


# -- the plan ------------------------------------------------------------------------


def plan(
    read: ReadResult,
    mapping: ImportMapping | None,
    target: Target,
    now: datetime | None = None,
    reuse: dict[str, str] | None = None,
    lenient: bool = False,
) -> Planned:
    """Plan the import of ``read`` with ``mapping`` (None: the defaults) into ``target``.

    ``lenient``: a mapping entry for a type the source no longer has (everything of it was left out
    after the preview) is dropped instead of refused.

    ``reuse`` (M25 re-runs): source path -> the space path of the object an earlier import made
    from it; such an object keeps that path (no `` (2)`` name) and the writer updates or skips it."""
    reuse = reuse or {}
    now_iso = _stamp(now or datetime.now(UTC))
    if mapping is None:
        mapping = ImportMapping(typeSource=read.defaultTypeSource, typeKey=read.defaultTypeKey)  # type: ignore[arg-type]
    else:
        mapping = mapping.model_copy(deep=True)
    is_notion = read.kind == "notion"
    if mapping.typeSource == "key" and not mapping.typeKey:
        mapping.typeKey = read.defaultTypeKey
        if not mapping.typeKey:
            raise MappingProblem("Choose the frontmatter key that names each object's type.")
    type_source = "notion" if is_notion else mapping.typeSource
    existing_types = target.types()
    by_id = {t.id: t for t in existing_types}
    if target.kind != "currentSpace":
        for key, o in mapping.types.items():
            if o.existingTypeId:  # "" (a new type) is fine anywhere
                raise MappingProblem("An existing type can only be chosen when importing into this space.")

    # 1. Each object's planned type key.
    def type_key_of(o: ReadObject) -> str:
        if type_source == "notion":
            return o.group or PAGE_KEY
        if type_source == "folder":
            return f"folder:{o.group}" if o.group else PAGE_KEY
        if type_source == "key":
            v = _scalar_type_value(o.fm.get(mapping.typeKey)) if mapping.typeKey else None
            return f"key:{v}" if v else PAGE_KEY
        return PAGE_KEY

    members: dict[str, list[ReadObject]] = {}
    for o in read.objects:
        members.setdefault(type_key_of(o), []).append(o)

    # 2. The plan types, in a stable order.
    order: list[tuple[str, str, str, str, str]] = []  # key, name, plural, origin, label
    if type_source == "notion":
        for db in read.databases:
            order.append((db.key, db.name, db.name, "database", db.csvPath))
    elif type_source == "folder":
        for folder in sorted(k[7:] for k in members if k.startswith("folder:")):
            order.append((f"folder:{folder}", _singular(folder), folder, "folder", folder))
    elif type_source == "key":
        for value in sorted((k[4:] for k in members if k.startswith("key:")), key=str.casefold):
            order.append((f"key:{value}", value, f"{value}s", "key", f"{mapping.typeKey}: {value}"))
    if PAGE_KEY in members or not order:
        order.append((PAGE_KEY, "Page", "Pages", "page", _PAGE_ORIGIN[type_source]))
    known_keys = {k for k, *_ in order}
    for key in list(mapping.types) + list(mapping.properties):
        if key not in known_keys:
            if not lenient:
                raise MappingProblem(f'The mapping names an unknown type "{key}".')
            mapping.types.pop(key, None)
            mapping.properties.pop(key, None)

    taken_type_names = {t.name.casefold() for t in existing_types}
    taken_folders = {t.folder.strip("/").casefold() for t in existing_types} | {ATTACHMENTS.casefold()}
    page_type = next((t for t in existing_types if t.id == "page"), None) or next(
        (t for t in existing_types if t.name.casefold() == "page"), None
    )
    plan_types: list[PlanType] = []
    type_writes: dict[str, TypeWrite] = {}
    effective_types: dict[str, TypeOverride] = {}
    for key, name, plural, origin, label in order:
        o = mapping.types.get(key) or TypeOverride()
        name = " ".join((o.name if o.name is not None else name).split()) or name
        plural = " ".join((o.pluralName if o.pluralName is not None else plural).split()) or plural
        # "" (Lane U's dialog): "make a new type" even when a type has this name.
        force_new = o.existingTypeId == ""
        existing_id = o.existingTypeId or None
        if existing_id is not None:
            ex = by_id.get(existing_id)
            if ex is None:
                raise MappingProblem(f'There is no object type "{existing_id}" to take these objects.')
            if ex.readOnlyReason:
                raise MappingProblem(f"The {ex.name} type can't be changed, so pages can't be imported into it.")
            if not importable_type(ex):
                raise MappingProblem(f"Imported pages can't become {ex.name} objects; choose another type.")
        elif target.kind == "currentSpace" and not force_new:
            match = next((t for t in existing_types if t.name.casefold() == name.casefold() and importable_type(t)), None)
            if match is None and origin == "folder":
                # A folder named like an existing type's plural (its folder name) is that type.
                match = next((t for t in existing_types if t.pluralName.casefold() == plural.casefold() and importable_type(t)), None)
            if key == PAGE_KEY and page_type is not None:
                match = page_type
            existing_id = match.id if match is not None else None
        if existing_id is not None:
            ex = by_id[existing_id]
            tw = TypeWrite(key, ex.id, ex.name, ex.pluralName, ex.folder.strip("/"), ex.basic)
            name, plural = ex.name, ex.pluralName
        elif key == PAGE_KEY and page_type is not None and not force_new:
            tw = TypeWrite(key, None, page_type.name, page_type.pluralName, page_type.folder.strip("/") or "Pages", True)
            name, plural = page_type.name, page_type.pluralName
        else:
            base, n = name, 2
            while name.casefold() in taken_type_names:
                name, n = f"{base} ({n})", n + 1
            # A new type's folder (its plural's file name) is its own, ignoring case: two
            # folders that differ only in case are one folder on Windows (our choice: `` (2)``).
            base, n = plural, 2
            while safe_filename(plural).casefold() in taken_folders:
                plural, n = f"{base} ({n})", n + 1
            taken_folders.add(safe_filename(plural).casefold())
            tw = TypeWrite(key, None, name, plural, safe_filename(plural), False)
        if existing_id is None and (force_new or not (key == PAGE_KEY and page_type is not None)):
            taken_type_names.add(name.casefold())
        skip = bool(o.skip)
        plan_types.append(PlanType(key, name, plural, origin, label, [], existing_id, skip))
        type_writes[key] = tw
        effective_types[key] = TypeOverride(
            name=name,
            pluralName=plural,
            skip=skip,
            existingTypeId=(existing_id or ("" if force_new else None)) if target.kind == "currentSpace" else None,
        )

    skipped: list[SkippedItem] = list(read.skipped)
    kept: list[tuple[ReadObject, PlanType]] = []
    for pt in plan_types:
        for o in members.get(pt.key, []):
            if pt.skip:
                skipped.append(SkippedItem(path=o.sourcePath, reason="userSkipped", detail=pt.name))
            else:
                kept.append((o, pt))
    kept_sources = {o.sourcePath for o, _ in kept}

    # 3. Properties per type.
    stats: dict[tuple[str, str], PropStats] = {}
    real_kind: dict[tuple[str, str], tuple[str, bool]] = {}
    pdefs: dict[tuple[str, str], PropertyDefinition] = {}
    source_to_key: dict[tuple[str, str], str] = {}
    effective_props: dict[str, dict[str, PropertyOverride]] = {}
    for pt in plan_types:
        tw = type_writes[pt.key]
        objs = members.get(pt.key, [])
        existing = by_id.get(tw.existingTypeId) if tw.existingTypeId else (page_type if pt.key == PAGE_KEY and tw.basic else None)
        existing_props = {p.key: p for p in existing.propertyDefinitions} if existing else {}
        taken = set(existing_props)
        names: list[str] = []
        if is_notion and pt.origin == "database":
            db = next(d for d in read.databases if d.key == pt.key)
            names = [h for h in db.headers if h]
        for o in objs:
            for k in o.fields:
                # The key that names the type is the type: not a property too (our choice).
                if k not in names and not (type_source == "key" and k == mapping.typeKey):
                    names.append(k)
        system_present = []
        if not is_notion:
            for sk in ("tags", "aliases", "description"):
                if any(sk in o.system for o in objs):
                    system_present.append(sk)
        overrides = mapping.properties.get(pt.key, {})
        planned_keys: list[str] = []
        for sname in names:
            system_key = None
            if is_notion and sname.lower() in ("created time", "created"):
                system_key = "createdAt"
            elif is_notion and sname.lower() in ("last edited time", "last edited"):
                system_key = "lastUpdated"
            if system_key:
                pkey = system_key
            elif sname in existing_props and sname not in SYSTEM_KEYS and not is_notion:
                pkey = sname
            elif is_notion:
                guess = unique_key(sname, taken)
                camel = unique_key(sname, ())
                pkey = camel if camel in existing_props and existing_props[camel].type in _TO_IMPORT_KIND else guess
            elif sname not in SYSTEM_KEYS and sname != "backlinks" and sname.strip() and sname not in taken:
                pkey = sname
            else:
                pkey = unique_key(sname, taken)
            if pkey in planned_keys:
                pkey = unique_key(sname, set(taken) | set(planned_keys))
            taken.add(pkey)
            planned_keys.append(pkey)
            source_to_key[(pt.key, sname)] = pkey
            values = [o.fields.get(sname) for o in objs if sname in o.fields]
            if system_key:
                guessed, garr = "datetime", False
            elif objs and objs[0].cells:
                guessed, garr = kinds.guess_cells([v for v in values if isinstance(v, str)])
            else:
                guessed, garr = kinds.guess_yaml(sname, values)
            ov = overrides.get(pkey) or PropertyOverride()
            ex_pdef = existing_props.get(pkey)
            if ex_pdef is not None and not system_key:
                kind = _TO_IMPORT_KIND.get(ex_pdef.type, "text")
                arr = bool(ex_pdef.options.get("isArray", ex_pdef.type == "entity"))
            else:
                kind = ov.kind or guessed
                arr = ov.isArray if ov.isArray is not None else (garr if kind == guessed else kind == "entity")
            if kind not in ("label", "entity"):
                arr = False
            prop_name = ov.name if ov.name else (ex_pdef.name if ex_pdef is not None else (sname if is_notion else _humanize(sname)))
            pp = PlanProperty(pkey, sname, prop_name, kind, guessed, arr, system_key, [], bool(ov.skip))
            pt.properties.append(pp)
            real_kind[(pt.key, pkey)] = (kind, arr)
            if ex_pdef is not None:
                pdefs[(pt.key, pkey)] = ex_pdef
        for sk in system_present:
            ov = overrides.get(sk) or PropertyOverride()
            pt.properties.append(
                PlanProperty(sk, sk, _humanize(sk), _SYSTEM_KINDS[sk], _SYSTEM_KINDS[sk], sk != "description", sk, [], bool(ov.skip))
            )
        for pkey in overrides:
            if not any(p.key == pkey for p in pt.properties):
                raise MappingProblem(f'The mapping names an unknown property "{pkey}" of "{pt.key}".')
        effective_props[pt.key] = {
            p.key: PropertyOverride(kind=p.kind, isArray=p.isArray, name=p.name, skip=p.skip) for p in pt.properties
        }

    # 4. Convert every value (pass A: texts and counts), then build the definitions.
    converted: dict[str, list[tuple[PlanProperty, Any]]] = {}
    not_converted: list[tuple[str, str, str, str]] = []
    for pt in plan_types:
        if pt.skip:
            continue
        objs = [o for o in members.get(pt.key, [])]
        for pp in pt.properties:
            if pp.systemKey in ("tags", "aliases", "description"):
                st = stats.setdefault((pt.key, pp.key), PropStats())
                for o in objs:
                    v = o.system.get(pp.systemKey)
                    if v:
                        st.valueCount += 1
                        for t in _source_texts(v):
                            if len(st.samples) < 3 and t not in st.samples:
                                st.samples.append(t)
                            if pp.systemKey != "description" and t not in st.texts:
                                st.texts.append(t)
                continue
            st = stats.setdefault((pt.key, pp.key), PropStats())
            values = [(o, o.fields.get(pp.sourceName)) for o in objs if pp.sourceName in o.fields]
            radix = kinds.column_decimal_comma([v for _, v in values if isinstance(v, str)])
            kind, arr = (pp.kind, pp.isArray) if pp.systemKey is None else ("datetime", False)
            for o, v in values:
                if kinds.is_empty(v):
                    continue
                st.valueCount += 1
                for t in _source_texts(v):
                    if len(st.samples) < 3 and t not in st.samples:
                        st.samples.append(t)
                api, bad = kinds.convert(v, kind, arr, cells=o.cells, radix_comma=radix)
                if bad:
                    st.unconvertible += len(bad)
                    if not pp.skip:
                        for b in bad:
                            not_converted.append((pt.name, pp.name, o.sourcePath, b))
                if api is None or pp.skip:
                    continue
                if kind == "label":
                    for t in api:
                        if t not in st.texts:
                            st.texts.append(t)
                converted.setdefault(o.sourcePath, []).append((pp, api))
            pp.options = st.texts[:50] if kind == "label" else []

    # Definitions: new properties of new types, added properties and options of existing ones.
    for pt in plan_types:
        tw = type_writes[pt.key]
        if pt.skip:
            continue
        for pp in pt.properties:
            if pp.systemKey or pp.skip:
                continue
            st = stats.get((pt.key, pp.key), PropStats())
            ex = pdefs.get((pt.key, pp.key))
            if ex is not None:
                if ex.type == "label":
                    have = {str(o.get("text", "")).strip().casefold() for o in ex.options.get("set") or [] if isinstance(o, dict)}
                    add = [t for t in st.texts if t.strip().casefold() not in have]
                    if add:
                        tw.add_options[pp.key] = add
                        merged = copy.deepcopy(ex)
                        merged.options["set"] = list(ex.options.get("set") or []) + label_options(add)
                        _fix_option_ids(merged)
                        pdefs[(pt.key, pp.key)] = merged
                continue
            pdef = _new_pdef(pp, st, pt.name)
            pdefs[(pt.key, pp.key)] = pdef
            if not tw.basic:
                tw.new_props.append(pdef)

    # 5. Files: each kept object's target path; tags.
    taken_names: dict[str, set[str]] = {}

    def free(folder: str, stem: str) -> tuple[str, bool]:
        names = taken_names.get(folder.casefold())  # one folder on Windows whatever its case
        if names is None:
            names = taken_names[folder.casefold()] = set(target.names_in(folder))
        n = 1
        while True:
            name = f"{stem}.md" if n == 1 else f"{stem} ({n}).md"
            if name.lower() not in names:
                names.add(name.lower())
                return (f"{folder}/{name}" if folder else name), n > 1
            n += 1

    image_type = next((t for t in existing_types if t.name.casefold() == IMAGE_TYPE.casefold()), None)
    image_folder = (image_type.folder.strip("/") if image_type is not None else "") or IMAGE_FOLDER
    page_id = page_type.id if page_type is not None else PAGE_KEY
    objects: list[PlanObject] = []
    writes: list[ObjectWrite] = []
    renamed: list[tuple[str, str]] = []
    by_source: dict[str, PlanObject] = {}
    write_by_source: dict[str, ObjectWrite] = {}
    all_tags: list[str] = []
    tag_folded: set[str] = set()
    for o, pt in kept:
        tw = type_writes[pt.key]
        as_image = _imports_as_image(o, pt.key, tw, page_id)
        reused = reuse.get(o.sourcePath)
        if reused:
            rel, was_renamed = reused, False
        else:
            rel, was_renamed = free(image_folder if as_image else tw.folder, safe_filename(o.title))
        po = PlanObject(o.sourcePath, o.title, pt.key, targetPath=rel, mtime=o.mtime)
        if was_renamed:
            po.renamedFrom = o.title
            renamed.append((o.title, rel))
        skip_sys = {pp.systemKey for pp in pt.properties if pp.systemKey and pp.skip}
        system: dict[str, Any] = {}
        if "tags" not in skip_sys and o.system.get("tags"):
            system["tags"] = list(o.system["tags"])
            for t in system["tags"]:
                if fold(t) not in tag_folded:
                    tag_folded.add(fold(t))
                    all_tags.append(t)
        if "aliases" not in skip_sys and o.system.get("aliases"):
            system["aliases"] = list(o.system["aliases"])
        if "description" not in skip_sys and o.system.get("description"):
            system["description"] = o.system["description"]
        created = _system_date(o.fields, o.system, "createdAt", is_notion) if "createdAt" not in skip_sys else None
        edited = _system_date(o.fields, o.system, "lastUpdated", is_notion) if "lastUpdated" not in skip_sys else None
        base = o.mtime or now_iso
        system["createdAt"] = created or base
        system["lastUpdated"] = edited or (o.mtime if o.mtime else system["createdAt"])
        system["lastUpdated"] = max(system["lastUpdated"], system["createdAt"])
        po.system = system
        objects.append(po)
        by_source[o.sourcePath] = po
        w = ObjectWrite(po, o, tw.name, tags=system.get("tags", []), aliases=system.get("aliases", []),
                        description=system.get("description"), createdAt=system["createdAt"],
                        lastUpdated=system["lastUpdated"], existing=reused, media="image" if as_image else None)
        writes.append(w)
        write_by_source[o.sourcePath] = w

    # 6. The target's link names, for the link text (as `Space._link_text` answers it).
    existing_summaries = target.summaries()
    existing_tags = {fold(s.title) for s in existing_summaries if s.type == "tag"}
    tag_type = by_id.get("tag")
    tag_folder = (tag_type.folder.strip("/") if tag_type is not None else "") or TAG_FOLDER
    tag_paths: list[ObjectSummary] = []
    for t in all_tags:
        if fold(t) in existing_tags:
            continue
        rel, _ = free(tag_folder, safe_filename(" ".join(t.split())))
        tag_paths.append(ObjectSummary(rel, None, "tag", " ".join(t.split()), None, now_iso, now_iso))
    planned_summaries = [
        ObjectSummary(po.targetPath, None, type_writes[po.typeKey].name, po.title, None,
                      po.system["createdAt"], po.system["lastUpdated"], aliases=po.system.get("aliases", []))
        for po in objects
        if po.targetPath not in reuse.values()
    ]
    summaries = existing_summaries + planned_summaries + tag_paths
    resolver = Resolver.build(summaries, {s.path: s.aliases for s in summaries})

    def object_link(target_src: str, from_src: str) -> tuple[str, str]:
        po = by_source[target_src]
        from_path = by_source[from_src].targetPath if from_src in by_source else None
        if not _LINK_BREAKING_RE.search(po.title) and resolver.resolve(po.title, from_path) == po.targetPath:
            return po.title, po.title
        return po.targetPath[:-3], po.title

    # 7. Attachments.
    attachments: dict[str, PlanAttachment] = {}
    att_taken = set(target.names_in(ATTACHMENTS))
    too_large: set[str] = set()

    def plan_attachment(src_path: str, page: str) -> str | None:
        if src_path in attachments:
            return attachments[src_path].targetName
        if src_path in too_large:
            return None
        size = read.files.get(src_path, 0)
        if size > MAX_ATTACHMENT_BYTES:
            too_large.add(src_path)
            skipped.append(SkippedItem(path=src_path, reason="tooLarge", detail=f"{size:,} bytes (attachments can have 100 MiB)"))
            return None
        if size == 0:
            too_large.add(src_path)
            skipped.append(SkippedItem(path=src_path, reason="emptyFile", detail="An empty file"))
            return None
        try:
            stem, ext = _safe_attachment_name(PurePosixPath(src_path).name)
        except ValueError:
            stem, ext = "Attachment", PurePosixPath(src_path).suffix.lower()
        if f"{stem}{ext}".lower().endswith((BOARD_SUFFIX, INK_SUFFIX)):
            stem += " file"
        n = 1
        while True:
            name = f"{stem}{ext}" if n == 1 else f"{stem} ({n}){ext}"
            if name.lower() not in att_taken:
                att_taken.add(name.lower())
                break
            n += 1
        attachments[src_path] = PlanAttachment(src_path, size, f"{ATTACHMENTS}/{name}")
        return attachments[src_path].targetName

    # 8. Links: count, list and keep each object's table.
    links_total = resolved = unresolved_n = 0
    unresolved: list[tuple[str, str]] = []
    links_by_object: dict[str, list[PlanLink]] = {}
    for po in objects:
        o = write_by_source[po.sourcePath].read
        out_links: list[PlanLink] = []
        for link in o.links:
            links_total += 1
            if link.kind == "object" and link.target in kept_sources:
                resolved += 1
                out_links.append(link)
                continue
            if link.kind == "attachment" and link.target is not None:
                if plan_attachment(link.target, po.sourcePath) is not None:
                    resolved += 1
                    po.attachments.append(link.target)
                    out_links.append(link)
                    continue
                unresolved_n += 1
                continue
            unresolved_n += 1
            if link.kind == "database":
                skipped.append(SkippedItem(path=po.sourcePath, reason="databaseLink", detail=link.raw[:200]))
            elif link.kind == "attachment":
                skipped.append(SkippedItem(path=po.sourcePath, reason="missingAttachment", detail=link.raw[:200]))
            else:
                skipped.append(SkippedItem(path=po.sourcePath, reason="unresolvedLink", detail=link.raw[:200]))
                unresolved.append((po.sourcePath, link.raw))
            out_links.append(PlanLink(link.sourcePath, link.raw, None, link.kind if link.kind != "object" else "unresolved",
                                      link.text, link.heading, link.embed))
        po.links = out_links
        links_by_object[po.sourcePath] = out_links

    # 9. Values (pass B): encode each one for its definition; entities get their link text.
    title_index: dict[str, str] = {}
    for po in objects:
        title_index.setdefault(fold(po.title), po.sourcePath)
    for w in writes:
        po = w.obj
        o = w.read
        for pp, api in converted.get(po.sourcePath, []):
            if pp.systemKey:
                continue
            pdef = pdefs.get((po.typeKey, pp.key))
            if pdef is None:
                continue
            if pp.kind == "entity":
                refs: list[dict[str, Any]] = []
                base_page = o.group[9:] if (o.cells and o.group and o.group.startswith("database:")) else po.sourcePath
                for text in api:
                    items = read.entity_items(text, base_page, o.cells) if read.entity_items else [(None, text)]
                    for tgt, shown in items:
                        links_total += 1
                        if tgt is None:
                            tgt = title_index.get(fold(shown))
                        if tgt is not None and tgt in by_source:
                            resolved += 1
                            link_text, _ = object_link(tgt, po.sourcePath)
                            po.links.append(PlanLink(po.sourcePath, text, tgt, "object", shown))
                        else:
                            unresolved_n += 1
                            link_text = shown.replace("[", "").replace("]", "").replace("|", "-").strip()
                            skipped.append(SkippedItem(path=po.sourcePath, reason="unresolvedLink", detail=f"{pp.name}: {shown}"[:200]))
                            unresolved.append((po.sourcePath, f"{pp.name}: {shown}"))
                            po.links.append(PlanLink(po.sourcePath, text, None, "unresolved", shown))
                        if link_text:
                            refs.append({"target": link_text, "path": None})
                api = refs
                if not api:
                    continue
                if not pp.isArray and len(api) > 1:
                    for extra in api[1:]:
                        not_converted.append((w.typeName, pp.name, po.sourcePath, extra["target"]))
                    api = api[:1]
            try:
                updates, _removals = encode_updates(pdef, api, {}, link_for=None)
            except InvalidValue as exc:
                not_converted.append((w.typeName, pp.name, po.sourcePath, f"{_short(api)} ({exc})"))
                continue
            for k, v in updates.items():
                if v is not None:
                    w.values.append((k, v))
                    po.values[k] = v
        for k, v in o.passthrough.items():
            if k in SYSTEM_KEYS or any(k == key for key, _ in w.values):
                continue
            w.values.append((k, v))
    for t, p, s, v in not_converted:
        skipped.append(SkippedItem(path=s, reason="valueNotConverted", detail=f"{t} › {p}: {v}"[:300]))

    # 10. Files no page links to.
    native_files = {w.obj.sourcePath for w in writes if w.read.native}
    for f in sorted(read.files):
        if f not in attachments and f not in too_large and f not in native_files:
            skipped.append(SkippedItem(path=f, reason="unsupported", detail="Not linked from any page"))

    final_plan = ImportPlan(
        kind=read.kind,
        sourcePath=read.sourcePath,
        container=read.container,
        fingerprint=read.fingerprint,
        suggestedName=read.suggestedName,
        types=plan_types,
        objects=objects,
        attachments=attachments,
        skipped=skipped,
        warnings=list(read.warnings),
        frontmatterKeys=dict(read.frontmatterKeys),
        folders=dict(read.folders),
    )
    kept_types = [pt for pt in plan_types if not pt.skip]
    counts = ImportCounts(
        objects=len(objects),
        types=len(kept_types),
        properties=sum(1 for pt in kept_types for p in pt.properties if not p.skip and not p.systemKey),
        attachments=len(attachments),
        attachmentBytes=sum(a.size for a in attachments.values()),
        links=links_total,
        resolvedLinks=resolved,
        unresolvedLinks=unresolved_n,
        renamed=len(renamed),
        skipped=len(skipped),
    )
    mapping.types = effective_types
    mapping.properties = effective_props
    if is_notion:
        mapping.typeSource = "folder"

    def attachment_path(src_path: str) -> str | None:
        a = attachments.get(src_path)
        return a.targetName if a is not None else None

    def resolve_href(path: str, page: str):
        kind, found = read.index.resolve_href(path, page)
        if kind == "object" and found not in by_source:
            return "unresolved", None
        if kind == "attachment" and found not in attachments:
            return "missing", None
        return kind, found

    def resolve_wiki(t: str, page: str):
        kind, found = read.index.resolve_wiki(t, page)
        if kind == "object" and found not in by_source:
            return "unresolved", None
        if kind == "attachment" and found not in attachments:
            return "unresolved", None
        return kind, found

    return Planned(
        plan=final_plan,
        read=read,
        mapping=mapping,
        target=target.kind,
        counts=counts,
        stats=stats,
        type_writes=type_writes,
        writes=writes,
        tags=all_tags,
        links_by_object=links_by_object,
        object_link=object_link,
        attachment_path=attachment_path,
        resolve_href=resolve_href,
        resolve_wiki=resolve_wiki,
        not_converted=not_converted,
        renamed=renamed,
        unresolved=unresolved,
        pdefs=pdefs,
    )


def _short(value: Any) -> str:
    text = str(value)
    return text if len(text) <= 80 else text[:77] + "…"


def _system_date(fields: dict[str, Any], system: dict[str, Any], key: str, notion: bool) -> str | None:
    raw = system.get(key)
    if raw is None:
        return None
    d = kinds.parse_date(raw)
    if d is None:
        return None
    start = d["start"]
    return start if d["resolution"] == "time" else f"{start}T00:00:00.000Z"


def _fix_option_ids(pdef: PropertyDefinition) -> None:
    """Option ids made unique after new options were appended to existing ones."""
    seen: set[str] = set()
    for opt in pdef.options.get("set") or []:
        if not isinstance(opt, dict):
            continue
        oid, n = str(opt.get("id") or "option"), 2
        base = oid
        while oid in seen:
            oid, n = f"{base}-{n}", n + 1
        opt["id"] = oid
        seen.add(oid)


def _new_pdef(pp: PlanProperty, st: PropStats, type_name: str) -> PropertyDefinition:
    kind = pp.kind if pp.kind in IMPORT_KINDS else "text"
    data: dict[str, Any] = {
        "id": new_ulid(),
        "key": pp.key,
        "name": pp.name or pp.key,
        "type": kind,
        "icon": PROPERTY_ICONS.get(kind),
    }
    if kind in ("label", "entity"):
        data["isArray"] = pp.isArray
    options: dict[str, Any] = {}
    if kind == "label":
        options["set"] = label_options(st.texts)
    data["options"] = options
    pdef = PropertyDefinition.from_json(data)
    pdef.icon = Icon("iconify", PROPERTY_ICONS.get(kind, PROPERTY_ICONS["text"]))
    if kind == "datetime" and st.valueCount and all(_is_day_text(s) for s in st.samples):
        pdef.options["constraints"] = {"resolutionPreference": "day"}
    del type_name
    return pdef


def _is_day_text(text: str) -> bool:
    d = kinds.parse_date(text)
    return d is not None and d["resolution"] == "day"


# -- the preview ---------------------------------------------------------------------


def to_preview(p: Planned, preview_id: str) -> ImportPreview:
    types: list[PlannedType] = []
    counts_by_type: dict[str, int] = {}
    for po in p.plan.objects:
        counts_by_type[po.typeKey] = counts_by_type.get(po.typeKey, 0) + 1
    skipped_counts: dict[str, int] = {}
    for s in p.plan.skipped:
        if s.reason == "userSkipped":
            skipped_counts[s.detail] = skipped_counts.get(s.detail, 0) + 1
    for pt in p.plan.types:
        props = []
        for pp in pt.properties:
            st = p.stats.get((pt.key, pp.key), PropStats())
            props.append(
                PlannedProperty(
                    key=pp.key,
                    sourceName=pp.sourceName,
                    name=pp.name,
                    kind=pp.kind if pp.kind in IMPORT_KINDS else "text",  # type: ignore[arg-type]
                    guessedKind=pp.guessedKind if pp.guessedKind in IMPORT_KINDS else "text",  # type: ignore[arg-type]
                    isArray=pp.isArray,
                    systemKey=pp.systemKey,  # type: ignore[arg-type]
                    valueCount=st.valueCount,
                    unconvertible=st.unconvertible,
                    samples=st.samples[:3],
                    options=st.texts[:50] if pp.kind == "label" else [],
                    skip=pp.skip,
                )
            )
        object_count = counts_by_type.get(pt.key, 0) if not pt.skip else skipped_counts.get(pt.name, 0)
        types.append(
            PlannedType(
                key=pt.key,
                name=pt.name,
                pluralName=pt.pluralName,
                origin=pt.origin,  # type: ignore[arg-type]
                originLabel=pt.originLabel,
                objectCount=object_count,
                existingTypeId=pt.existingTypeId if p.target == "currentSpace" else None,
                skip=pt.skip,
                properties=props,
            )
        )
    samples = [
        PlannedObjectSample(title=po.title, typeKey=po.typeKey, path=po.targetPath, sourcePath=po.sourcePath)
        for po in p.plan.objects[:MAX_SAMPLES]
    ]
    return ImportPreview(
        previewId=preview_id,
        sourcePath=p.plan.sourcePath,
        kind=p.plan.kind,  # type: ignore[arg-type]
        detected=p.read.detected,  # type: ignore[arg-type]
        container=p.plan.container,  # type: ignore[arg-type]
        suggestedName=p.plan.suggestedName,
        counts=p.counts,
        types=types,
        mapping=p.mapping,
        frontmatterKeys=sorted(p.plan.frontmatterKeys.items(), key=lambda kv: (-kv[1], kv[0].casefold())),
        folders=sorted(p.plan.folders.items(), key=lambda kv: kv[0].casefold()),
        samples=samples,
        skipped=p.plan.skipped[:MAX_PREVIEW_SKIPPED],
        warnings=p.plan.warnings,
    )


