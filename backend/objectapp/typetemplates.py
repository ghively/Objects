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
- M28, section ``itOperations``: the IT ops types that aren't already in the gallery (Host,
  Software, Application, Container, Configuration, Location, Network, Vendor, Script, Command,
  Runbook, Prompt, Incident), each exactly as `basicsetup.itops_types` defines it, other sides
  (``counterpart``) included. Person, Meeting and Project stay the basic entries; Source is not
  offered (imports make it and its objects). Plan ``2026-11-09-m28-itops-starter-and-relations.md``.
  M29: so the gallery's Host has the starter's five synced facts, and Host, Network and Software
  carry the starter's name patterns (`TypeTemplate.namePatterns`).
- M32, section ``personal`` (the gallery's first group; all **our choice**, existing property
  kinds only): Idea (Status: New, Exploring, Kept, Dropped; Notes), Goal (Status: Not started,
  In progress, Achieved, Dropped; Target date; Notes), Habit (Frequency: Daily, Weekly, Monthly;
  Notes), Recipe (Cover image, Servings a number, Prep time a text, Source a URL, Notes), Trip
  (Start and End dates, Location, Notes), Journal entry (Date, Mood: Great, Good, Okay, Low;
  Notes). The groups' order is `SECTION_ORDER` (Personal first, IT operations last and closed
  until opened: `COLLAPSED_SECTIONS`, each catalog entry's ``collapsed``). The Project entry has
  M22's ticket and work fields only while Work is on for the space (`_props`).

A relation names the template key of its target ("person"); when the type is created it
points at the space's type made from that template (or named like it), else at any type. An IT
ops relation whose target isn't in the gallery (Source) points at the space's type of that id or
name.
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
    "COLLAPSED_SECTIONS",
    "SECTION_ORDER",
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
    """Gallery group: ``personal`` (M32), ``useCases`` (our choice), ``research``, ``media``,
    ``planningAndReflection``, ``itOperations`` (M28) or None (`SECTION_ORDER`)."""
    name: str
    pluralName: str
    description: str
    icon: str
    color: str
    props: Callable[[], list[PropertyDefinition]]

    @property
    def namePatterns(self) -> tuple[str, ...]:
        """M29: the name patterns (`typesuggest`) a type made from this entry starts with: an IT
        ops entry's are the starter's (`basicsetup.ITOPS_NAME_PATTERNS`), every other entry has
        none."""
        if self.section != "itOperations":
            return ()
        return _b().ITOPS_NAME_PATTERNS.get(self.key, ())


def _b():
    from . import basicsetup

    return basicsetup


def _from_basic(tid: str, work: bool = False) -> Callable[[], list[PropertyDefinition]]:
    def props() -> list[PropertyDefinition]:
        t = next(x for x in _b().basic_types(work=work) if x.id == tid)
        return [p for p in t.propertyDefinitions if not p.type.startswith("entity_")]

    return props


def _props(tpl: TypeTemplate, work: bool) -> list[PropertyDefinition]:
    """The entry's fresh properties. M32: the Project entry carries M22's ticket and work fields
    only with ``work`` (Work is on for the space, as `basicsetup.basic_types`)."""
    if work and tpl.key == "project":
        return _from_basic("project", work=True)()
    return tpl.props()


def _from_itops(tid: str) -> Callable[[], list[PropertyDefinition]]:
    """The IT ops type `tid`'s own properties (fresh ids), as `basicsetup.itops_types` makes them."""

    def props() -> list[PropertyDefinition]:
        t = next(x for x in _b().itops_types() if x.id == tid)
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


# -- M32: the "Personal" group (our choice throughout; existing property kinds only) ------------


def _idea():
    return [_label("status", "Status", ("New", "Exploring", "Kept", "Dropped")), _b()._notes()]


def _goal():
    return [
        _label("status", "Status", ("Not started", "In progress", "Achieved", "Dropped")),
        _date("targetDate", "Target date"),
        _b()._notes(),
    ]


def _habit():
    return [_label("frequency", "Frequency", ("Daily", "Weekly", "Monthly")), _b()._notes()]


def _recipe():
    b = _b()
    return [
        b._cover(),
        b._prop("servings", "Servings", "number"),
        b._prop("prepTime", "Prep time", "text", description="For example 20 min"),
        # key `link`: `source` is reserved (a basic media field), as Podcast's `url` is
        b._prop("link", "Source", "url"),
        b._notes(),
    ]


def _trip():
    b = _b()
    return [
        _date("startDate", "Start"),
        _date("endDate", "End"),
        b._prop("location", "Location", "text"),
        b._notes(),
    ]


def _journal_entry():
    return [
        _date("date", "Date"),
        _label("mood", "Mood", ("Great", "Good", "Okay", "Low")),
        _b()._notes(),
    ]


SECTION_ORDER: tuple[str | None, ...] = (
    "personal", "useCases", "research", "media", "planningAndReflection", None, "itOperations",
)  # fmt: skip
"""M32: the gallery's groups in order, after "Create your own": Personal first, IT operations
last (None is the untitled row, Organization and Area). `_TEMPLATES` is in this order, so
`template_catalog` is too."""
COLLAPSED_SECTIONS: frozenset[str] = frozenset({"itOperations"})
"""M32: the groups the gallery shows closed until they are opened (each catalog entry of one
carries ``collapsed: true``)."""

# In the gallery's order (catalog section 3; `SECTION_ORDER`).
_TEMPLATES: tuple[TypeTemplate, ...] = (
    # M32: Personal.
    TypeTemplate("idea", "personal", "Idea", "Ideas",
                 "A thought worth keeping, and where it stands.",
                 "ph-lightbulb-filament", "yellow", _idea),
    TypeTemplate("goal", "personal", "Goal", "Goals",
                 "Something you are working toward, with a target date.",
                 "ph-target", "green", _goal),
    TypeTemplate("habit", "personal", "Habit", "Habits",
                 "Something you do regularly, and how often.",
                 "ph-repeat", "teal", _habit),
    TypeTemplate("recipe", "personal", "Recipe", "Recipes",
                 "A dish you cook: servings, time and where it came from.",
                 "ph-cooking-pot", "orange", _recipe),
    TypeTemplate("trip", "personal", "Trip", "Trips",
                 "A journey: when, where, and what you planned.",
                 "ph-airplane-tilt", "sky", _trip),
    TypeTemplate("journalEntry", "personal", "Journal entry", "Journal entries",
                 "A dated entry in your journal, with how the day felt.",
                 "ph-notebook", "purple", _journal_entry),
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
    # The untitled row. M32: before IT operations, which is the gallery's last group.
    TypeTemplate("organization", None, "Organization", "Organizations",
                 "Companies, schools and other groups, with their people.",
                 "ph-buildings", "gray", _organization),
    TypeTemplate("area", None, "Area", "Areas",
                 "Ongoing parts of your life or work, such as Health or Home.",
                 "ph-squares-four", "lime", _area),
    # M28: the IT ops types (names, descriptions, icons and colours as `basicsetup.itops_types`;
    # `test_m28_gallery.py` holds them to it). M32: the last group, closed until opened.
    TypeTemplate("host", "itOperations", "Host", "Hosts",
                 "A server, workstation or network device: what runs on it and where it is.",
                 "ph-hard-drives", "blue", _from_itops("host")),
    TypeTemplate("software", "itOperations", "Software", "Software",
                 "A product at one version, who makes it and when its support ends.",
                 "ph-package", "violet", _from_itops("software")),
    TypeTemplate("application", "itOperations", "Application", "Applications",
                 "A service people use: what it runs on and what it is built from.",
                 "ph-app-window", "indigo", _from_itops("application")),
    TypeTemplate("container", "itOperations", "Container", "Containers",
                 "A container, its image and the host it runs on.",
                 "ph-shipping-container", "cyan", _from_itops("container")),
    TypeTemplate("configuration", "itOperations", "Configuration", "Configurations",
                 "A policy, rule or setting, and what it applies to.",
                 "ph-sliders-horizontal", "amber", _from_itops("configuration")),
    TypeTemplate("location", "itOperations", "Location", "Locations",
                 "A site, building, room or rack, and what is in it.",
                 "ph-map-pin", "emerald", _from_itops("location")),
    TypeTemplate("network", "itOperations", "Network", "Networks",
                 "A subnet, VLAN, wifi network or domain.",
                 "ph-network", "sky", _from_itops("network")),
    TypeTemplate("vendor", "itOperations", "Vendor", "Vendors",
                 "A company you buy from: its support and its contract.",
                 "ph-storefront", "orange", _from_itops("vendor")),
    TypeTemplate("script", "itOperations", "Script", "Scripts",
                 "A script, its language and what it works on.",
                 "ph-file-code", "teal", _from_itops("script")),
    TypeTemplate("command", "itOperations", "Command", "Commands",
                 "A command worth keeping, and the shell it runs in.",
                 "ph-terminal-window", "gray", _from_itops("command")),
    TypeTemplate("runbook", "itOperations", "Runbook", "Runbooks",
                 "The steps to follow for a known task or problem.",
                 "ph-book-open-text", "lime", _from_itops("runbook")),
    TypeTemplate("prompt", "itOperations", "Prompt", "Prompts",
                 "A prompt for an AI model, and what it is for.",
                 "ph-chat-text", "fuchsia", _from_itops("prompt")),
    TypeTemplate("incident", "itOperations", "Incident", "Incidents",
                 "Something that broke: what it affected, why, and how it was resolved.",
                 "ph-warning-octagon", "red", _from_itops("incident")),
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
    # M32: the Personal entries (our choice).
    "idea": TemplateQuery("New ideas", (("status", "contains", Option("New")),),
                          (("lastUpdated", "descending"),)),
    "goal": TemplateQuery("Goals in progress", (("status", "contains", Option("In progress")),),
                          (("targetDate", "ascending"),)),
    "habit": TemplateQuery("Daily habits", (("frequency", "contains", Option("Daily")),),
                           (("title", "ascending"),)),
    "recipe": TemplateQuery("All recipes A-Z", (), (("title", "ascending"),), "grid"),
    "trip": TemplateQuery("This year's trips", (("startDate", "is", _rel("thisYear")),),
                          (("startDate", "ascending"),)),
    "journalEntry": TemplateQuery("This month's entries", (("date", "is", _rel("thisMonth")),),
                                  (("date", "descending"),)),
    # M28: the IT ops entries (plan 2026-11-09-m28, Task 7; our choice).
    "host": TemplateQuery("Production hosts", (("environment", "contains", Option("Production")),),
                          (("title", "ascending"),), "table"),
    "software": TemplateQuery("Software by product", (),
                              (("product", "ascending"), ("version", "descending")), "table"),
    "application": TemplateQuery("Live applications", (("status", "contains", Option("Live")),),
                                 (("title", "ascending"),)),
    "container": TemplateQuery("All containers A-Z", (), (("title", "ascending"),)),
    "configuration": TemplateQuery("All configurations A-Z", (), (("title", "ascending"),)),
    "location": TemplateQuery("Sites", (("kind", "contains", Option("Site")),)),
    "network": TemplateQuery("All networks A-Z", (), (("title", "ascending"),), "table"),
    "vendor": TemplateQuery("Contracts ending", (("contractEnds", "isNotEmpty", None),),
                            (("contractEnds", "ascending"),)),
    "script": TemplateQuery("Recently updated scripts", (), (("lastUpdated", "descending"),)),
    "command": TemplateQuery("All commands A-Z", (), (("title", "ascending"),)),
    "runbook": TemplateQuery("Runbooks to review", (), (("lastReviewed", "ascending"),)),
    "prompt": TemplateQuery("All prompts A-Z", (), (("title", "ascending"),)),
    "incident": TemplateQuery("Open incidents", (("status", "contains", Option("Open")),),
                              (("lastUpdated", "descending"),)),
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


def build_template(
    key: str, types: list[TypeDefinition], work: bool = False
) -> list[PropertyDefinition]:
    """Fresh custom properties for template ``key``, relations resolved against ``types``.
    ``work`` (M32): whether Work is on for the space (`_props`)."""
    tpl = _BY_KEY[key]
    by_template: dict[str, str] = {}
    for t in types:
        k = template_for(t)
        if k is not None:
            by_template.setdefault(k, t.id)
    props = _props(tpl, work)
    for p in props:
        if p.type == "entity":
            allowed = p.options.get("allowedTypes") or []
            p.options["allowedTypes"] = [
                tid for a in allowed if (tid := _target(a, tpl, by_template, types)) is not None
            ]
    return props


def _target(
    a: str, tpl: TypeTemplate, by_template: dict[str, str], types: list[TypeDefinition]
) -> str | None:
    """The space's type a template relation's target ``a`` points at, or None (any type).

    M28: an IT ops entry's target that isn't in the gallery (Source) is the space's type of that
    id, else one named like it.
    """
    if a in by_template:
        return by_template[a]
    if tpl.section != "itOperations" or a in _BY_KEY:
        return None
    return next((t.id for t in types if t.id == a), None) or next(
        (t.id for t in types if t.name.lower() == a), None
    )


def template_catalog(types: list[TypeDefinition], work: bool = False) -> list[dict[str, Any]]:
    """The gallery, in order: each template with its properties and whether the space has it.
    ``work`` (M32): whether Work is on for the space (Project's ticket fields, `_props`)."""
    have = {k for k in (template_for(t) for t in types) if k}
    out = []
    for tpl in _TEMPLATES:
        out.append(
            {
                "key": tpl.key,
                "section": tpl.section,
                # M32: whether the entry's group starts closed in the gallery (IT operations).
                "collapsed": tpl.section in COLLAPSED_SECTIONS,
                "name": tpl.name,
                "pluralName": tpl.pluralName,
                "description": tpl.description,
                "icon": {"type": "iconify", "val": tpl.icon},
                "color": tpl.color,
                "properties": [{"name": p.name, "type": p.type} for p in _props(tpl, work)],
                "added": tpl.key in have,
            }
        )
    return out
