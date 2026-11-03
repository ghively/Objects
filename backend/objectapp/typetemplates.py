"""The "Add new object type" gallery: Object's type templates (polish item 21).

Object offers starter types from its `ObjectStudio` gallery. Their names, plural
names, descriptions, property names, property descriptions and label options are the
en-US strings ``components.<key>.*``; the type's ``templateKey`` is Object's
`RootStructure.templateKey` ("Blueprint key this object type was created from, e.g.
`person`"). The trimmed reference does not hold the templates' property kinds, icons,
colours, the gallery's grouping of the first and last rows, or their saved queries, so
those are **our choice**:

- Meeting, Person, Project, Book: as `basicsetup` (M8, already Gene-reviewed).
- Atomic note: Cover image, Notes. Definition: Notes. Area: Content.
- Film: Poster (the cover image), Director (relation to Person), Genre (multi label),
  Rating (progress out of 5), Watched on (date), Notes.
- TV series: Cover image, Director and Actors (relations to Person), Genre (multi label),
  Rating, Watched on (date), Notes.
- Podcast: URL, People (relation to Person), Listened on (date), Notes.
- Day: Date (day), Energy and Mood (labels, options in rising order), Highlight of the day
  and Grateful For (text), Content.
- Week, Month: Date (a day range), Notes.
- Organization: Category (label), People (relation to Person), Projects (relation to
  Project), Cover image, Notes.

A relation names the template key of its target ("person"); when the type is created it
points at the space's type made from that template (or named like it), else at any type.
Saved queries and template objects of the templates are not created.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from .typemodel import PropertyDefinition, TypeDefinition

__all__ = ["TEMPLATE_KEYS", "TypeTemplate", "build_template", "template_catalog"]


@dataclass(frozen=True)
class TypeTemplate:
    key: str
    """Object's template key (``components.<key>``), stored as the type's ``templateKey``."""
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


def _day():
    b = _b()
    return [
        _date("day", "Date"),
        _label("energy", "Energy", ("Very low", "Low", "Medium", "High", "Very high"),
               description="How's your energy?"),
        _label("mood", "Mood", ("Rough", "Low", "Okay", "Good", "Great"),
               description="How are you feeling?"),
        b._prop("highlight", "Highlight of the day", "text", description="What stood out today?"),
        b._prop("gratefulFor", "Grateful For", "text", description="What are you grateful for?"),
        b._prop("content", "Content", "blocks"),
    ]  # fmt: skip


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


# In the gallery's order (catalog section 3). Strings: Object's `components.<key>`.
_TEMPLATES: tuple[TypeTemplate, ...] = (
    TypeTemplate("meeting", "useCases", "Meeting", "Meetings",
                 "Capture conversations with attendees and a date.",
                 "ph-users-three", "orange", _from_basic("meeting")),
    TypeTemplate("person", "useCases", "Person", "People",
                 "Keep notes on people you meet, work with, or follow.",
                 "ph-user", "blue", _from_basic("person")),
    TypeTemplate("project", "useCases", "Project", "Projects",
                 "Track work with status, collaborators, and meetings.",
                 "ph-kanban", "violet", _from_basic("project")),
    TypeTemplate("atomicNote", "research", "Atomic note", "Atomic notes",
                 "Write small standalone notes you can reuse later.",
                 "ph-note", "amber", _atomic_note),
    TypeTemplate("definition", "research", "Definition", "Definitions",
                 "Capture a term you want to remember.",
                 "ph-book-bookmark", "teal", _definition),
    TypeTemplate("book", "media", "Book", "Books",
                 "Build a reading library with authors, rating, and genre.",
                 "ph-book-open", "emerald", _from_basic("book")),
    TypeTemplate("film", "media", "Film", "Films",
                 "Collect films you watch and want to remember.",
                 "ph-film-strip", "red", _film),
    TypeTemplate("tvSeries", "media", "TV series", "TV series",
                 "Track series you watch and want to come back to.",
                 "ph-television", "indigo", _tv_series),
    TypeTemplate("podcast", "media", "Podcast", "Podcasts",
                 "Save podcasts you listen to and want to revisit.",
                 "ph-microphone", "fuchsia", _podcast),
    TypeTemplate("day", "planningAndReflection", "Day", "Days",
                 "Log a day with energy, mood, and what stood out.",
                 "ph-sun", "yellow", _day),
    TypeTemplate("week", "planningAndReflection", "Week", "Weeks",
                 "Plan or review a single week.",
                 "ph-calendar", "sky", _period),
    TypeTemplate("month", "planningAndReflection", "Month", "Months",
                 "Plan or review a month.",
                 "ph-calendar-dots", "cyan", _period),
    TypeTemplate("organization", None, "Organization", "Organizations",
                 "Keep notes on companies and other institutions.",
                 "ph-buildings", "gray", _organization),
    TypeTemplate("area", None, "Area", "Areas",
                 "Group work and life into areas of responsibility.",
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
