"""The "Add new object type" gallery: the starter type templates (polish item 21).

The gallery offers starter types. Their names, plural names, descriptions, property
names, property descriptions and label options are fixed en-US strings; the type's
``templateKey`` is the key of the template it was created from (e.g. ``person``).
The design notes do not give the templates' property kinds, icons,
colours, the gallery's grouping of the first and last rows, or their saved queries, so
those are **our choice**:

- Meeting, Person, Project, Book: as `basicsetup` (M8, already Gene-reviewed).
- Atomic note: Cover image, Notes. Definition: Notes. Area: Content.
- Film: Poster (the cover image), Director (relation to Person), Genre (multi label),
  Rating (progress out of 5), Watched on (date), Notes.
- TV series: Cover image, Director and Actors (relations to Person), Genre (multi label),
  Rating, Watched on (date), Notes.
- Podcast: URL, People (relation to Person), Listened on (date), Notes.
- Week, Month: Date (a day range), Notes; for periodic reviews. There is no Day template:
  the built-in daily note is the one note per day (fix pass 2026-11-09). A type made from
  the earlier Day template keeps working from its own file; its key is just not offered.
- Organization: Category (label), People (relation to Person), Projects (relation to
  Project), Cover image, Notes.

A relation names the template key of its target ("person"); when the type is created it
points at the space's type made from that template (or named like it), else at any type.
Template objects of the templates are not created. Each template's one saved query
(`TEMPLATE_QUERIES`, written to ``.object/queries/`` when a type is created from the
gallery, never for a blank type) is **our choice** too; a query uses only properties its
template creates.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from .typemodel import Icon, PropertyDefinition, TypeDefinition, system_property_defs

__all__ = [
    "TEMPLATE_KEYS",
    "TEMPLATE_QUERIES",
    "TemplateQuery",
    "TypeTemplate",
    "build_template",
    "template_catalog",
    "template_query",
    "template_query_fixture",
]


@dataclass(frozen=True)
class TypeTemplate:
    key: str
    """The template key, stored as the type's ``templateKey``."""
    section: str | None
    """Gallery group: ``useCases`` (our choice), ``research``, ``media``,
    ``planningAndReflection`` or None."""
    name: str
    pluralName: str
    description: str
    icon: str
    color: str
    props: Callable[[], list[PropertyDefinition]]


def _b():
    from . import basicsetup

    return basicsetup


def _from_basic(tid: str) -> Callable[[], list[PropertyDefinition]]:
    def props() -> list[PropertyDefinition]:
        t = next(x for x in _b().basic_types() if x.id == tid)
        return [p for p in t.propertyDefinitions if not p.type.startswith("entity_")]

    return props


def _date(key: str, name: str, resolution: str = "day", rng: bool = False, description: str = ""):
    constraints: dict[str, Any] = {"resolutionPreference": resolution}
    if rng:
        constraints["endTimePreference"] = True
    return _b()._prop(key, name, "datetime", {"constraints": constraints}, description)


def _rating() -> PropertyDefinition:
    return _b()._prop(
        "rating", "Rating", "number",
        {"numberFormat": {"type": "progress",
                          "options": {"progress": {"steps": 5, "color": "yellow"}}}},
    )  # fmt: skip


def _label(key: str, name: str, texts: tuple[str, ...], multi=False, description=""):
    p = _b()._label(key, name, texts, multi=multi)
    p.description = description
    return p


_FILM_GENRES = (
    "Action", "Adventure", "Animation", "Biography", "Comedy", "Crime", "Documentary", "Drama",
    "Family", "Fantasy", "Film noir", "History", "Horror", "Music", "Musical", "Mystery",
    "Romance", "Sci-fi", "Short", "Sport", "Thriller", "War", "Western",
)  # fmt: skip
_TV_GENRES = (
    "Action", "Adventure", "Animation", "Biography", "Comedy", "Crime", "Documentary", "Drama",
    "Family", "Fantasy", "Game show", "History", "Horror", "Music", "Musical", "Mystery", "News",
    "Reality TV", "Romance", "Sci-fi", "Short", "Sport", "Talk show", "Thriller", "War",
    "Western",
)  # fmt: skip


def _atomic_note():
    return [_b()._cover(), _b()._notes()]


def _definition():
    return [_b()._notes()]


def _film():
    b = _b()
    return [
        b._cover("Poster"),
        b._relation("director", "Director", ["person"]),
        _label("genre", "Genre", _FILM_GENRES, multi=True),
        _rating(),
        _date("watchedOn", "Watched on"),
        b._notes(),
    ]


def _tv_series():
    b = _b()
    return [
        b._cover(),
        b._relation("director", "Director", ["person"]),
        b._relation("actors", "Actors", ["person"]),
        _label("genre", "Genre", _TV_GENRES, multi=True),
        _rating(),
        _date("watchedOn", "Watched on"),
        b._notes(),
    ]


def _podcast():
    b = _b()
    return [
        # key `link`: `url` is reserved (a basic media field)
        b._prop("link", "URL", "url"),
        b._relation("people", "People", ["person"]),
        _date("listenedOn", "Listened on"),
        b._notes(),
    ]


def _period():
    return [_date("period", "Date", rng=True), _b()._notes()]


def _organization():
    b = _b()
    return [
        _label("category", "Category",
               ("Company", "Startup", "Nonprofit", "NGO", "Government", "University")),
        b._relation("people", "People", ["person"]),
        b._relation("projects", "Projects", ["project"]),
        b._cover(),
        b._notes(),
    ]  # fmt: skip


def _area():
    return [_b()._prop("content", "Content", "blocks")]


# In the gallery's order (catalog section 3).
_TEMPLATES: tuple[TypeTemplate, ...] = (
    TypeTemplate("meeting", "useCases", "Meeting", "Meetings",
                 "Notes from a meeting: who came, when, and what was said.",
                 "ph-users-three", "orange", _from_basic("meeting")),
    TypeTemplate("person", "useCases", "Person", "People",
                 "A page for each person you know or work with.",
                 "ph-user", "blue", _from_basic("person")),
    TypeTemplate("project", "useCases", "Project", "Projects",
                 "Projects with a status, a timeframe and the people involved.",
                 "ph-kanban", "violet", _from_basic("project")),
    TypeTemplate("atomicNote", "research", "Atomic note", "Atomic notes",
                 "One idea per note, small enough to link from anywhere.",
                 "ph-note", "amber", _atomic_note),
    TypeTemplate("definition", "research", "Definition", "Definitions",
                 "A term and what it means.",
                 "ph-book-bookmark", "teal", _definition),
    TypeTemplate("book", "media", "Book", "Books",
                 "Books you read, with authors, genre and a rating.",
                 "ph-book-open", "emerald", _from_basic("book")),
    TypeTemplate("film", "media", "Film", "Films",
                 "Films you have seen, with director, genre and a rating.",
                 "ph-film-strip", "red", _film),
    TypeTemplate("tvSeries", "media", "TV series", "TV series",
                 "Shows you follow, with cast, genre and a rating.",
                 "ph-television", "indigo", _tv_series),
    TypeTemplate("podcast", "media", "Podcast", "Podcasts",
                 "Episodes you have heard, with a link and the people in them.",
                 "ph-microphone", "fuchsia", _podcast),
    # No Day template: the built-in daily note is the one note per day (fix pass 2026-11-09).
    TypeTemplate("week", "planningAndReflection", "Week", "Weeks",
                 "One entry per week, for weekly reviews and plans. Daily notes already cover each day.",
                 "ph-calendar", "sky", _period),
    TypeTemplate("month", "planningAndReflection", "Month", "Months",
                 "One entry per month, for monthly reviews and plans.",
                 "ph-calendar-dots", "cyan", _period),
    TypeTemplate("organization", None, "Organization", "Organizations",
                 "Companies, schools and other groups, with their people.",
                 "ph-buildings", "gray", _organization),
    TypeTemplate("area", None, "Area", "Areas",
                 "Ongoing parts of your life or work, such as Health or Home.",
                 "ph-squares-four", "lime", _area),
)  # fmt: skip

TEMPLATE_KEYS = tuple(t.key for t in _TEMPLATES)
_BY_KEY = {t.key: t for t in _TEMPLATES}


def get_template(key: str) -> TypeTemplate | None:
    return _BY_KEY.get(key)


def template_for(t: TypeDefinition) -> str | None:
    """The template key a type was made from (``templateKey``), else one named like it."""
    key = t.extra.get("templateKey")
    if isinstance(key, str) and key in _BY_KEY:
        return key
    low = t.name.lower()
    return next((x.key for x in _TEMPLATES if x.name.lower() == low), None)


@dataclass(frozen=True)
class Option:
    """A label filter's reference: the option with this text (its id is looked up)."""

    text: str


@dataclass(frozen=True)
class TemplateQuery:
    """The saved query a gallery template comes with (our choice).

    ``filters`` are ``(property key, operator, reference)``, all AND-ed; a reference is a
    relative date ``{"relative": ...}``, a number, an `Option`, or None (no value).
    ``sorts`` are ``(property key, order)``; ``layout`` is the query view's layout.
    """

    name: str
    filters: tuple[tuple[str, str, Any], ...] = ()
    sorts: tuple[tuple[str, str], ...] = ()
    layout: str = "list"


def _rel(when: str) -> dict[str, str]:
    return {"relative": when}


# One query per gallery template, by template key.
TEMPLATE_QUERIES: dict[str, TemplateQuery] = {
    "meeting": TemplateQuery("This week's meetings", (("date", "is", _rel("thisWeek")),),
                             (("date", "ascending"),)),
    "person": TemplateQuery("Colleagues", (("category", "contains", Option("Colleague")),),
                            (("title", "ascending"),), "grid"),
    "project": TemplateQuery("Active projects", (("status", "contains", Option("In Progress")),),
                             (("lastUpdated", "descending"),)),
    "atomicNote": TemplateQuery("Recently updated notes", (), (("lastUpdated", "descending"),)),
    "definition": TemplateQuery("All definitions A-Z", (), (("title", "ascending"),)),
    "book": TemplateQuery("Currently reading",
                          (("readingTimeline", "startIsNotEmpty", None),
                           ("readingTimeline", "endIsEmpty", None)),
                          (("readingTimeline", "descending"),), "grid"),
    "film": TemplateQuery("Top rated films", (("rating", "greaterEqual", 4),),
                          (("rating", "descending"),), "grid"),
    "tvSeries": TemplateQuery("Watched this year", (("watchedOn", "is", _rel("thisYear")),),
                              (("watchedOn", "descending"),), "grid"),
    "podcast": TemplateQuery("Listened this month", (("listenedOn", "is", _rel("thisMonth")),),
                             (("listenedOn", "descending"),)),
    "week": TemplateQuery("This month's weeks", (("period", "is", _rel("thisMonth")),),
                          (("period", "ascending"),)),
    "month": TemplateQuery("This year's months", (("period", "is", _rel("thisYear")),),
                           (("period", "ascending"),)),
    "organization": TemplateQuery("Companies", (("category", "contains", Option("Company")),),
                                  (("title", "ascending"),)),
    "area": TemplateQuery("All areas A-Z", (), (("title", "ascending"),)),
}  # fmt: skip


def template_query(key: str, t: TypeDefinition) -> tuple[str, dict[str, Any], dict[str, Any]]:
    """The (name, definition, view) of template ``key``'s query over the created type ``t``.

    Raises `KeyError` when the query names a property or label option ``t`` lacks.
    """
    spec = TEMPLATE_QUERIES[key]
    elements: list[dict[str, Any]] = []
    for prop_key, option, ref in spec.filters:
        p = t.prop(prop_key)
        if p is None:
            raise KeyError(prop_key)
        f: dict[str, Any] = {"type": "filter", "propertyId": prop_key, "option": option}
        if isinstance(ref, Option):
            opts = p.options.get("set") or []
            oid = next((o["id"] for o in opts if isinstance(o, dict) and o.get("text") == ref.text), None)
            if oid is None:
                raise KeyError(f"{prop_key}: {ref.text}")
            f["referenceValue"] = [oid]
        elif ref is not None:
            f["referenceValue"] = ref
        f["typeId"] = t.id
        elements.append(f)
    sorts = []
    for prop_key, order in spec.sorts:
        if t.prop(prop_key) is None:
            raise KeyError(prop_key)
        sorts.append({"propertyId": prop_key, "option": order, "typeId": t.id})
    definition = {
        "types": [{"id": t.id}],
        "filterGroup": {"type": "filterGroup", "operator": "and", "elements": elements},
        "sorts": sorts,
        "groupBy": None,
    }
    return spec.name, definition, {"viewDefinition": {"dataViewLayout": spec.layout}}


def template_query_fixture() -> dict[str, Any]:
    """Each template's query and the properties it reads (keys, kinds, options), for the
    frontend's evaluation test. Property ids are left out so the output is stable."""
    out: dict[str, Any] = {}
    for tpl in _TEMPLATES:
        props = [*system_property_defs(), *build_template(tpl.key, [])]
        t = TypeDefinition(
            id=tpl.key, name=tpl.name, pluralName=tpl.pluralName, folder=tpl.pluralName,
            icon=Icon("iconify", tpl.icon), color=tpl.color, propertyDefinitions=props,
        )  # fmt: skip
        name, definition, view = template_query(tpl.key, t)
        spec = TEMPLATE_QUERIES[tpl.key]
        used = {"title", *(f[0] for f in spec.filters), *(s[0] for s in spec.sorts)}
        out[tpl.key] = {
            "properties": [
                {"key": p.key, "name": p.name, "type": p.type, "options": p.options}
                for p in props
                if p.key in used
            ],
            "query": {"name": name, "definition": definition, "view": view},
        }
    return out


def build_template(key: str, types: list[TypeDefinition]) -> list[PropertyDefinition]:
    """Fresh custom properties for template ``key``, relations resolved against ``types``."""
    tpl = _BY_KEY[key]
    by_template: dict[str, str] = {}
    for t in types:
        k = template_for(t)
        if k is not None:
            by_template.setdefault(k, t.id)
    props = tpl.props()
    for p in props:
        if p.type == "entity":
            allowed = p.options.get("allowedTypes") or []
            p.options["allowedTypes"] = [by_template[a] for a in allowed if a in by_template]
    return props


def template_catalog(types: list[TypeDefinition]) -> list[dict[str, Any]]:
    """The gallery, in order: each template with its properties and whether the space has it."""
    have = {k for k in (template_for(t) for t in types) if k}
    out = []
    for tpl in _TEMPLATES:
        out.append(
            {
                "key": tpl.key,
                "section": tpl.section,
                "name": tpl.name,
                "pluralName": tpl.pluralName,
                "description": tpl.description,
                "icon": {"type": "iconify", "val": tpl.icon},
                "color": tpl.color,
                "properties": [{"name": p.name, "type": p.type} for p in tpl.props()],
                "added": tpl.key in have,
            }
        )
    return out
