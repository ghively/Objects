"""M8 "Start with basic setup": the Person, Meeting, Project and Book object types.

Onboarding offers "Start with basic setup" ("Includes people, meetings,
projects, and books."). Its names, plural names, descriptions, property names and
label options are fixed en-US strings;
the design notes do not give the types' property kinds, icons or colours, so
those are **our choice** (listed for Gene in the M8 plan, Task 8):

- Person: Picture (the cover image), Category (multi label), Organizations
  (relation), Projects (relation to Project), Meetings (relation to Meeting), Notes.
- Meeting: Date (date and time), Type (label), Attendees (relation to Person),
  Project (relation to Project), Reviewed (checkbox), Cover image, Notes.
- Project: Status (a plain label: only Task's status is a status label), Type
  (label), Timeframe (date range), Collaborators (relation to Person), Organizations
  (relation), Meetings (relation to Meeting), Cover image, Notes.
- Book: Authors (relation to Person), Genre (multi label), Type (label), Rating
  (number shown as progress out of 5), Reading timeline (date range), Cover image,
  Notes.

M22: Project also has the ticket and work fields (``workfields.field_defs``, without the
Project relation, which is on Tasks only) and a hidden ``completed`` (Task's), appended
after Notes, so a new Project is a work type. Those keep ``id == key``; the properties
above get fresh ids. M32: only while Work is on for the space (``basic_types(work=True)``);
a Project made with Work off has none of them, and one that has them keeps them.

"Notes" is each type's ``blocks`` property (the object's body). There is no
Organization type in the basic setup, so "Organizations" relations allow any type.
`write_basic_types` writes only ``.object/types/<id>.json`` for the four types.

M28 "IT operations" (plan ``2026-11-09-m28-itops-starter-and-relations.md``, Contract; design
``2026-11-09-it-ops-type-model-design.md`` sections 1, 2 and 5a): `itops_types` builds the 17
`ITOPS_TYPE_IDS` types from the same helpers, `write_itops_types` writes them with one default
template each (Source has none) and `write_itops_tags` the seed Tags. Type names, property names,
label options and counterpart names are the design's; **our choice** (listed in the plan's "Our
calls"):

- Icons, colours, descriptions and folders (= the plural) of the types; the option colours
  (Environment, Application and Incident Status, Severity, Department fixed; every other list
  cycles blue, green, amber, violet, sky, rose, teal, orange, indigo); option ids are
  `label_options`' slugs.
- Every property key and counterpart key (``runsOn``/``runs``, ``covers``/``documentedIn``, ...).
- Operating system, Located at, both Part of and Software's Vendor hold one object; the other
  relations are multi.
- Every own property is shown (``alwaysShow``) but **Sources**, the nine entity types' relation to
  Source (counterpart "Distilled into"), which is hidden while empty.
- Project: the basic Project with Status Back log, In progress, On hold, Complete (status
  categories not-started, in-progress, blocked, done), Priority (Low, Medium, High) after Type and
  Affects after Meetings (guess G2). Person: the basic Person plus Department. Meeting: the basic
  Meeting with Type options Operations and Helpdesk appended.
- Incident is a work type: its own properties, Notes, the M22 work fields without ``cause`` (its
  own Cause, a text, wins the key) and without ``deskResolved`` (M31, G3 "drop the duplicate": the
  Incident's own Resolved is its one resolved time; Desk sync writes there), then Task's hidden
  ``completed``. Status categories: Open and Mitigated in progress, Resolved
  done.
- Template names (= the type name) and their ``## <section>`` bodies (`ITOPS_TEMPLATE_SECTIONS`).
- Seed Tags are coloured ``bg-<THEME_COLORS[i % 18]>`` by their index in `ITOPS_TAGS`. The Task
  statuses and priorities of the vocabulary are already the built-in Task's (nothing written).

M29 (plan ``2026-11-09-m29-synced-facts-and-type-suggestion.md``, Contract "The starter's patterns
and synced facts"; design section 3 and 4): Host ends with five **synced** facts filled by an
inventory script through ``/api/v1`` (`host_synced_properties`: Last boot, Disk free, Patch state,
Reboot pending, Last seen; ``id == key``, source "Inventory script", stale after 7 days, always
shown), and Host, Network and Software get **name patterns** (`ITOPS_NAME_PATTERNS`, matched by
`typesuggest`). Patch state's options (Current, Pending, Failed, Unknown) and Host's patterns
beyond the design's examples are **our choice**. A space whose types were written before M29 keeps
them as they are (no top-up).

Nothing here replaces a file: a type JSON, template or Tag that exists already is kept.
"""

from __future__ import annotations

import copy
from collections.abc import Iterable
from pathlib import Path, PurePosixPath
from typing import Any

from .frontmatter import set_keys
from .ids import new_ulid
from .objfile import ObjectFile, join_object
from .space import _title_of, now_stamp, safe_filename, unique_path, yaml_single_quoted
from .textfile import create_new
from .typedefs import iter_object_paths, read_raw
from .typemodel import (
    PROPERTY_ICONS,
    SYNCED_STALE_DEFAULT,
    THEME_COLORS,
    Icon,
    PropertyDefinition,
    SyncedSpec,
    TypeDefinition,
    _task_field_defs,
    label_options,
    system_property_defs,
    write_type_json,
)
from .workfields import field_defs

__all__ = [
    "BASIC_TYPE_IDS",
    "ITOPS_DEPARTMENTS",
    "ITOPS_NAME_PATTERNS",
    "ITOPS_PRIORITIES",
    "ITOPS_PROJECT_STATUSES",
    "ITOPS_TAGS",
    "ITOPS_TASK_STATUSES",
    "ITOPS_TEMPLATE_SECTIONS",
    "ITOPS_TYPE_IDS",
    "basic_types",
    "itops_template",
    "itops_types",
    "retarget_relations",
    "source_type",
    "sources_property",
    "host_synced_properties",
    "write_basic_types",
    "write_itops_tags",
    "write_itops_types",
]

BASIC_TYPE_IDS = ("person", "meeting", "project", "book")

# The Project "Status" options and their colours (our choice). It is a plain label: only
# the basic Task status sets ``isStatus`` (and option ``statusCategory``).
_PROJECT_STATUS = (
    ("Planned", "yellow"),
    ("In Progress", "blue"),
    ("On Hold", "pink"),
    ("Completed", "green"),
)

_GENRES = (
    "Adventure", "Art", "Biography", "Business & Economics", "Children's", "Classic",
    "Comics & Graphic Novels", "Cooking", "Crafts & Hobbies", "Crime", "Drama", "Education",
    "Family & Relationships", "Fantasy", "Health & Fitness", "Historical Fiction", "History",
    "Home & Garden", "Horror", "Humor", "Language & Writing", "Law", "Literary Fiction",
    "Mathematics", "Medicine", "Music", "Mystery", "Nature", "Philosophy", "Poetry",
    "Politics", "Psychology", "Reference", "Religion & Spirituality", "Romance", "Science",
    "Science Fiction", "Self-Help", "Social Science", "Sports", "Technology", "Thriller",
    "Travel", "True Crime", "Young Adult",
)


def _prop(
    key: str,
    name: str,
    kind: str,
    options: dict[str, Any] | None = None,
    description: str = "",
) -> PropertyDefinition:
    return PropertyDefinition(
        id=new_ulid(),
        key=key,
        name=name,
        type=kind,
        description=description,
        icon=Icon("iconify", PROPERTY_ICONS[kind]),
        options=options or {},
    )


def _relation(key: str, name: str, allowed: list[str]) -> PropertyDefinition:
    return _prop(
        key, name, "entity",
        {"isArray": True, "allowedTypes": allowed, "hasFixedSet": False, "fixedSet": []},
    )


def _label(key: str, name: str, texts: tuple[str, ...], multi: bool = False) -> PropertyDefinition:
    return _prop(key, name, "label", {"isArray": multi, "set": label_options(texts)})


def _range(key: str, name: str, description: str) -> PropertyDefinition:
    constraints = {"resolutionPreference": "day", "endTimePreference": True}
    return _prop(key, name, "datetime", {"constraints": constraints}, description)


def _cover(name: str = "Cover image") -> PropertyDefinition:
    return PropertyDefinition(
        id="coverImage",
        key="coverImage",
        name=name,
        type="coverImage",
        icon=Icon("iconify", PROPERTY_ICONS["coverImage"]),
    )


def _notes() -> PropertyDefinition:
    return _prop("notes", "Notes", "blocks")


def _completed() -> PropertyDefinition:
    """Task's hidden ``completed`` (M22: the 14-day Done clock on a Project)."""
    return next(p for p in _task_field_defs() if p.key == "completed")


def _status() -> PropertyDefinition:
    options = [
        {"id": text.lower().replace(" ", "-"), "text": text, "color": color, "icon": None}
        for text, color in _PROJECT_STATUS
    ]
    return _prop("status", "Status", "label", {"isArray": False, "set": options})


def _type(
    tid: str, name: str, plural: str, description: str, icon: str, color: str,
    props: list[PropertyDefinition],
) -> TypeDefinition:
    return TypeDefinition(
        id=tid,
        name=name,
        pluralName=plural,
        folder=safe_filename(plural),
        icon=Icon("iconify", icon),
        color=color,
        description=description,
        propertyDefinitions=[*system_property_defs(), *props],
    )


def basic_types(work: bool = False) -> list[TypeDefinition]:
    """Fresh Person, Meeting, Project and Book definitions (new property ids each call).

    M32: Project ends with M22's ticket and work fields and the hidden ``completed`` only
    with ``work`` (Work is on for the space the types are made for, `spaceconfig.work_on`; the
    IT operations starter always passes it); a new space's Project has none of them.
    """
    person = _type(
        "person", "Person", "People",
        "A page for each person you know or work with.",
        "ph-user", "blue",
        [
            _cover("Picture"),
            _label(
                "category", "Category",
                ("Friends", "Family", "Colleague", "Academic", "Artist", "Author",
                 "Entrepreneur", "Journalist", "Philosopher", "Politician", "Scientist"),
                multi=True,
            ),
            _relation("organizations", "Organizations", []),
            _relation("projects", "Projects", ["project"]),
            _relation("meetings", "Meetings", ["meeting"]),
            _notes(),
        ],
    )
    meeting = _type(
        "meeting", "Meeting", "Meetings",
        "Notes from a meeting: who came, when, and what was said.",
        "ph-users-three", "orange",
        [
            _prop("date", "Date", "datetime",
                  {"constraints": {"resolutionPreference": "time"}}),
            _label(
                "meetingType", "Type",
                ("Team Meeting", "One-on-One", "Client Meeting", "Brainstorming", "Workshop",
                 "Presentation", "Interview", "Conference"),
            ),
            _relation("attendees", "Attendees", ["person"]),
            _relation("project", "Project", ["project"]),
            _prop("reviewed", "Reviewed", "boolean"),
            _cover(),
            _notes(),
        ],
    )
    project = _type(
        "project", "Project", "Projects",
        "Projects with a status, a timeframe and the people involved.",
        "ph-kanban", "violet",
        [
            _status(),
            _label("projectType", "Type", ("Work", "Personal")),
            _range("timeframe", "Timeframe", "When the project starts and ends"),
            _relation("collaborators", "Collaborators", ["person"]),
            _relation("organizations", "Organizations", []),
            _relation("meetings", "Meetings", ["meeting"]),
            _cover(),
            _notes(),
            *([*field_defs(task=False, project_type_ids=["project"]), _completed()] if work else []),
        ],
    )
    book = _type(
        "book", "Book", "Books",
        "Books you read, with authors, genre and a rating.",
        "ph-book-open", "emerald",
        [
            _relation("authors", "Authors", ["person"]),
            _label("genre", "Genre", _GENRES, multi=True),
            _label("bookType", "Type", ("Fiction", "Non-fiction")),
            _prop(
                "rating", "Rating", "number",
                {"numberFormat": {"type": "progress",
                                  "options": {"progress": {"steps": 5, "color": "yellow"}}}},
            ),
            _range("readingTimeline", "Reading timeline", "When you started and finished reading"),
            _cover(),
            _notes(),
        ],
    )
    return [person, meeting, project, book]


def write_basic_types(root: Path, work: bool = False) -> list[Path]:
    """Write the four types into the (new) space at `root`. Refuses to replace an existing file.
    ``work`` as `basic_types` (a new space has Work off: no ticket field on its Project)."""
    written: list[Path] = []
    for t in basic_types(work=work):
        # base revision "" = the file must not exist yet (RevisionConflict otherwise)
        write_type_json(Path(root), t, "")
        written.append(Path(root) / ".object" / "types" / f"{t.id}.json")
    return written


# -- M28: the IT ops starter ---------------------------------------------------------------------

ITOPS_TYPE_IDS: tuple[str, ...] = (
    "host", "software", "application", "container", "configuration", "location", "network",
    "person", "vendor", "script", "command", "runbook", "prompt", "source", "project", "incident",
    "meeting",
)  # fmt: skip

# Seed vocabulary (design section 1, names only).
ITOPS_TAGS: tuple[str, ...] = (
    "Windows", "Linux", "PowerShell", "ESXi", "VMware", "vSphere", "Synology", "NAS", "Docker",
    "Terraform", "Ansible", "AWS", "Office365", "SharePoint", "Active Directory", "Subnet", "Wifi",
    "Backup", "Automation", "Diagram", "Encryption", "Infrastructure", "Documentation", "Script",
    "AI", "LLM", "MCP", "API", "GitHub", "VM",
)  # fmt: skip
ITOPS_PROJECT_STATUSES: tuple[str, ...] = ("Back log", "In progress", "On hold", "Complete")  # G2
ITOPS_TASK_STATUSES: tuple[str, ...] = ("Not started", "Done")  # the built-in Task's (G2)
ITOPS_PRIORITIES: tuple[str, ...] = ("Low", "Medium", "High")
ITOPS_DEPARTMENTS: tuple[str, ...] = ("IT", "Finance", "All")

# Default template bodies: one ``## <section>`` per entry (our strings). Source has none.
ITOPS_TEMPLATE_SECTIONS: dict[str, tuple[str, ...]] = {
    "host": ("Purpose", "Access", "Known issues"),
    "software": ("Install notes", "Licensing", "Known issues"),
    "application": ("Purpose", "How it's built", "Support"),
    "container": ("Purpose", "Configuration"),
    "configuration": ("What it does", "Settings", "Why"),
    "location": ("Access", "Notes"),
    "network": ("Addressing", "Notes"),
    "person": ("Role", "Contact"),
    "vendor": ("Contacts", "Contract", "Support"),
    "script": ("Purpose", "Usage"),
    "command": ("Usage", "Example"),
    "runbook": ("When to use", "Steps", "Rollback"),
    "prompt": ("Prompt", "Notes"),
    "project": ("Goal", "Plan", "Notes"),
    "incident": ("Timeline", "Impact", "Cause", "Follow-up"),
    "meeting": ("Agenda", "Notes", "Action items"),
}

# Option colours (our choice): these lists are fixed, every other list cycles `_CYCLE`.
_CYCLE = ("blue", "green", "amber", "violet", "sky", "rose", "teal", "orange", "indigo")
_DEPARTMENT_COLORS = ("blue", "green", "gray")
_ENVIRONMENT_COLORS = ("red", "amber", "green")
_APP_STATUS_COLORS = ("green", "yellow", "gray")
_INCIDENT_STATUS_COLORS = ("red", "amber", "green")
_SEVERITY_COLORS = ("red", "orange", "amber", "gray")

_PROJECT_STATUS_CATEGORIES = ("not-started", "in-progress", "blocked", "done")  # guess G2
_INCIDENT_STATUS_CATEGORIES = ("in-progress", "in-progress", "done")

_DAY = {"constraints": {"resolutionPreference": "day"}}
_TIME = {"constraints": {"resolutionPreference": "time"}}

_RUNS = ("Runs", "runs")
_DOCUMENTED_IN = ("Documented in", "documentedIn")
_CONTAINS = ("Contains", "contains")
_OWNS = ("Owns", "owns")
_AFFECTED_BY = ("Affected by", "affectedBy")


def _ops_label(
    key: str,
    name: str,
    texts: tuple[str, ...],
    multi: bool = False,
    colors: tuple[str, ...] | None = None,
    categories: tuple[str, ...] | None = None,
) -> PropertyDefinition:
    """A label with `label_options`' ids, the given colours (else `_CYCLE`) and categories."""
    options = label_options(texts)
    for i, opt in enumerate(options):
        opt["color"] = colors[i] if colors is not None else _CYCLE[i % len(_CYCLE)]
        if categories is not None:
            opt["statusCategory"] = categories[i]
    return _prop(key, name, "label", {"isArray": multi, "set": options})


def _ops_relation(
    key: str,
    name: str,
    allowed: list[str],
    single: bool = False,
    counterpart: tuple[str, str] | None = None,
) -> PropertyDefinition:
    """An ``entity`` property; `counterpart` is the computed other side's (name, key)."""
    p = _relation(key, name, allowed)
    p.options["isArray"] = not single
    if counterpart is not None:
        p.options["counterpart"] = {"name": counterpart[0], "key": counterpart[1]}
    return p


# M29: the synced facts an inventory script fills on Host, and the starter's name patterns.
_INVENTORY = "Inventory script"
_SYNCED_TIME = {"constraints": {"resolutionPreference": "time", "endTimeSettings": "notAllowed"}}
_PATCH_STATE_COLORS = ("green", "amber", "red", "gray")

ITOPS_NAME_PATTERNS: dict[str, tuple[str, ...]] = {
    "host": ("{ip}", "{fqdn}", "SRV-*", "@@##", "@@@##", "@@@@##", "@*-##"),
    "network": ("{cidr}",),
    "software": ("{version}",),
}
"""The name patterns (`typesuggest`) of the three starter types that have any."""


def _synced(p: PropertyDefinition) -> PropertyDefinition:
    p.id = p.key
    p.visibility = "alwaysShow"
    p.synced = SyncedSpec(_INVENTORY, SYNCED_STALE_DEFAULT)
    return p


def host_synced_properties() -> list[PropertyDefinition]:
    """Host's five synced facts (M29), in order; ``id == key``, filled by the "Inventory script"."""
    return [
        _synced(_date("lastBoot", "Last boot", _SYNCED_TIME)),
        _synced(_prop("diskFree", "Disk free", "number", description="Free disk space, in GB")),
        _synced(_ops_label("patchState", "Patch state", ("Current", "Pending", "Failed", "Unknown"),
                           colors=_PATCH_STATE_COLORS)),
        _synced(_prop("rebootPending", "Reboot pending", "boolean")),
        _synced(_date("lastSeen", "Last seen", _SYNCED_TIME)),
    ]  # fmt: skip


def _department() -> PropertyDefinition:
    return _ops_label("department", "Department", ITOPS_DEPARTMENTS, colors=_DEPARTMENT_COLORS)


def _date(key: str, name: str, options: dict[str, Any] = _DAY) -> PropertyDefinition:
    return _prop(key, name, "datetime", copy.deepcopy(options))


def sources_property() -> PropertyDefinition:
    """The entity types' **Sources** relation to Source (counterpart "Distilled into"), fresh id.

    Hidden while empty: a hand-made object has no Sources. M30 adds it to other types.
    """
    p = _ops_relation(
        "sources", "Sources", ["source"], counterpart=("Distilled into", "distilledInto")
    )
    p.visibility = "hideWhenEmpty"
    return p


def source_type() -> TypeDefinition:
    """The **Source** type alone (fresh property ids): an imported page, kept as it was (5a).

    No stored relation: its "Distilled into" row is the computed other side of the entities'
    ``sources``. No template (its body is the imported text).
    """
    return _type(
        "source", "Source", "Sources",
        "A page kept as it was imported, and what was distilled from it.",
        "ph-file-text", "gray",
        [
            _ops_label(
                "category", "Category",
                ("Wiki page", "Document", "Spreadsheet", "Presentation", "PDF", "Diagram",
                 "Email", "Ticket", "Chat", "Web page", "Image", "Note"),
            ),
            _ops_label(
                "system", "System",
                ("SharePoint", "Wiki", "Notion", "Obsidian", "Anytype", "Files", "Markdown"),
            ),
            _notes(),
        ],
    )  # fmt: skip


def _insert_at(t: TypeDefinition, key: str, props: list[PropertyDefinition], after: bool) -> None:
    i = next(n for n, p in enumerate(t.propertyDefinitions) if p.key == key) + int(after)
    t.propertyDefinitions[i:i] = props


def _itops_person(person: TypeDefinition) -> TypeDefinition:
    """The basic Person, plus Department (and Sources) before Notes."""
    _insert_at(person, "notes", [_department(), sources_property()], after=False)
    return person


def _itops_meeting(meeting: TypeDefinition) -> TypeDefinition:
    """The basic Meeting, its Type options with Operations and Helpdesk appended."""
    kind = meeting.prop("meetingType")
    assert kind is not None
    texts = [o["text"] for o in kind.options["set"]]
    kind.options["set"] = label_options((*texts, "Operations", "Helpdesk"))
    return meeting


def _itops_project(project: TypeDefinition) -> TypeDefinition:
    """The basic Project with the IT ops Status, Priority after Type and Affects after Meetings."""
    status = project.prop("status")
    assert status is not None
    status.options["set"] = _ops_label(
        "status", "Status", ITOPS_PROJECT_STATUSES, categories=_PROJECT_STATUS_CATEGORIES
    ).options["set"]
    _insert_at(project, "projectType", [_ops_label("priority", "Priority", ITOPS_PRIORITIES)],
               after=True)
    affects = _ops_relation("affects", "Affects", ["host", "application", "software"],
                            counterpart=_AFFECTED_BY)
    _insert_at(project, "meetings", [affects], after=True)
    return project  # fmt: skip


def _incident() -> TypeDefinition:
    work = []
    for p in field_defs(task=False, project_type_ids=["project"]):
        if p.key in ("cause", "deskResolved"):
            continue  # the Incident's own Cause (text) and Resolved (G3, M31) win
        work.append(p)
    return _type(
        "incident", "Incident", "Incidents",
        "Something that broke: what it affected, why, and how it was resolved.",
        "ph-warning-octagon", "red",
        [
            _ops_label("status", "Status", ("Open", "Mitigated", "Resolved"),
                       colors=_INCIDENT_STATUS_COLORS, categories=_INCIDENT_STATUS_CATEGORIES),
            _ops_label("severity", "Severity", ("SEV1", "SEV2", "SEV3", "SEV4"),
                       colors=_SEVERITY_COLORS),
            _prop("impact", "Impact", "text"),
            _prop("cause", "Cause", "text"),
            _ops_relation("affects", "Affects", ["host", "application"], counterpart=_AFFECTED_BY),
            _date("started", "Started", _TIME),
            _date("resolved", "Resolved", _TIME),
            _notes(),
            *work,
            _completed(),
        ],
    )  # fmt: skip


def _entity(
    tid: str, name: str, plural: str, description: str, icon: str, color: str,
    props: list[PropertyDefinition],
) -> TypeDefinition:
    """An entity type: its own properties, then Sources and Notes."""
    return _type(tid, name, plural, description, icon, color,
                 [*props, sources_property(), _notes()])  # fmt: skip


def _knowledge(
    tid: str, name: str, plural: str, description: str, icon: str, color: str,
    props: list[PropertyDefinition],
) -> TypeDefinition:
    """A knowledge type: its own properties, then Notes."""
    return _type(tid, name, plural, description, icon, color, [*props, _notes()])


def itops_types() -> list[TypeDefinition]:
    """Fresh definitions of the 17 IT ops types, in `ITOPS_TYPE_IDS` order (new ids each call)."""
    basic = {t.id: t for t in basic_types(work=True)}  # the starter turns Work on (M32)
    types = [
        _entity(
            "host", "Host", "Hosts",
            "A server, workstation or network device: what runs on it and where it is.",
            "ph-hard-drives", "blue",
            [
                _ops_label("category", "Category",
                           ("Server", "Workstation", "Network device", "Printer", "NAS",
                            "Firewall", "VPN")),
                _ops_label("roles", "Roles",
                           ("DNS", "DHCP", "Active Directory", "File server", "Print server",
                            "RDS", "Hypervisor", "Firewall/VPN"), multi=True),
                _prop("ipAddress", "IP address", "text"),
                _prop("fqdn", "FQDN", "text"),
                _department(),
                _ops_label("environment", "Environment", ("Production", "Test", "Development"),
                           colors=_ENVIRONMENT_COLORS),
                _ops_relation("operatingSystem", "Operating system", ["software"], single=True,
                              counterpart=("Installed on", "installedOn")),
                _ops_relation("locatedAt", "Located at", ["location"], single=True,
                              counterpart=_CONTAINS),
                _ops_relation("network", "Network", ["network"]),
                _ops_relation("ownedBy", "Owned by", ["person", "vendor"], counterpart=_OWNS),
            ],
        ),
        _entity(
            "software", "Software", "Software",
            "A product at one version, who makes it and when its support ends.",
            "ph-package", "violet",
            [
                _prop("product", "Product", "text",
                      description="The product family, e.g. SQL Server"),
                _prop("version", "Version", "text"),
                _ops_relation("vendor", "Vendor", ["vendor"], single=True),
                _date("endOfSupport", "End of support"),
            ],
        ),
        _entity(
            "application", "Application", "Applications",
            "A service people use: what it runs on and what it is built from.",
            "ph-app-window", "indigo",
            [
                _ops_label("status", "Status", ("Live", "Planned", "Retired"),
                           colors=_APP_STATUS_COLORS),
                _ops_relation("ownedBy", "Owned by", ["person"], counterpart=_OWNS),
                _department(),
                _ops_relation("runsOn", "Runs on", ["host", "container"], counterpart=_RUNS),
                _ops_relation("uses", "Uses", ["software"], counterpart=("Used by", "usedBy")),
            ],
        ),
        _entity(
            "container", "Container", "Containers",
            "A container, its image and the host it runs on.",
            "ph-shipping-container", "cyan",
            [
                _prop("image", "Image", "text"),
                _ops_relation("runsOn", "Runs on", ["host"], counterpart=_RUNS),
                _ops_relation("partOf", "Part of", ["application"], single=True,
                              counterpart=("Containers", "containers")),
            ],
        ),
        _entity(
            "configuration", "Configuration", "Configurations",
            "A policy, rule or setting, and what it applies to.",
            "ph-sliders-horizontal", "amber",
            [
                _ops_label("kind", "Kind",
                           ("GPO", "Firewall rule", "Scheduled task", "App setting", "Template")),
                _ops_relation("appliesTo", "Applies to", ["host", "application"],
                              counterpart=("Configured by", "configuredBy")),
            ],
        ),
        _entity(
            "location", "Location", "Locations",
            "A site, building, room or rack, and what is in it.",
            "ph-map-pin", "emerald",
            [
                _ops_label("kind", "Kind", ("Site", "Building", "Room", "Rack")),
                _ops_relation("partOf", "Part of", ["location"], single=True,
                              counterpart=_CONTAINS),
            ],
        ),
        _entity(
            "network", "Network", "Networks",
            "A subnet, VLAN, wifi network or domain.",
            "ph-network", "sky",
            [
                _ops_label("kind", "Kind", ("Subnet", "VLAN", "Wifi", "Domain")),
                _prop("range", "Range", "text", description="CIDR"),
                _prop("vlanId", "VLAN id", "number"),
                _ops_relation("locatedAt", "Located at", ["location"], single=True,
                              counterpart=_CONTAINS),
            ],
        ),
        _itops_person(basic["person"]),
        _entity(
            "vendor", "Vendor", "Vendors",
            "A company you buy from: its support and its contract.",
            "ph-storefront", "orange",
            [
                _prop("website", "Website", "url"),
                _prop("supportContact", "Support contact", "text"),
                _date("contractEnds", "Contract ends"),
            ],
        ),
        _knowledge(
            "script", "Script", "Scripts",
            "A script, its language and what it works on.",
            "ph-file-code", "teal",
            [
                _ops_label("language", "Language", ("PowerShell", "Bash", "Python", "AWS CLI")),
                _ops_relation("covers", "Covers", ["host", "application", "software"],
                              counterpart=_DOCUMENTED_IN),
            ],
        ),
        _knowledge(
            "command", "Command", "Commands",
            "A command worth keeping, and the shell it runs in.",
            "ph-terminal-window", "gray",
            [
                _ops_label("shell", "Shell", ("PowerShell", "Bash", "cmd", "macOS")),
                _ops_relation("covers", "Covers", [], counterpart=_DOCUMENTED_IN),
            ],
        ),
        _knowledge(
            "runbook", "Runbook", "Runbooks",
            "The steps to follow for a known task or problem.",
            "ph-book-open-text", "lime",
            [
                _ops_label("kind", "Kind", ("Runbook", "SOP")),
                _ops_relation("covers", "Covers", [], counterpart=_DOCUMENTED_IN),
                _date("lastReviewed", "Last reviewed"),
            ],
        ),
        _knowledge(
            "prompt", "Prompt", "Prompts",
            "A prompt for an AI model, and what it is for.",
            "ph-chat-text", "fuchsia",
            [
                _prop("model", "Model", "text"),
                _prop("purpose", "Purpose", "text"),
                _ops_relation("usedOn", "Used on", []),
            ],
        ),
        source_type(),
        _itops_project(basic["project"]),
        _incident(),
        _itops_meeting(basic["meeting"]),
    ]  # fmt: skip
    assert tuple(t.id for t in types) == ITOPS_TYPE_IDS
    for t in types:
        if t.id == "host":
            t.propertyDefinitions.extend(host_synced_properties())  # M29, after Notes
        t.namePatterns = list(ITOPS_NAME_PATTERNS.get(t.id, ()))
    return types


def itops_template(type_id: str) -> tuple[str, str]:
    """(template name, body) of one IT ops type's default template; `KeyError` for ``source``."""
    sections = ITOPS_TEMPLATE_SECTIONS[type_id]
    name = next(t.name for t in itops_types() if t.id == type_id)
    return name, "\n".join(f"## {section}\n" for section in sections)


def _template_bytes(template_id: str, type_name: str, body: str) -> bytes:
    """A template file as `Space.create_template` writes it (``id``, ``type``, ``template``)."""
    fm_src = set_keys(
        f"type: {yaml_single_quoted(type_name)}\n",
        {"template": type_name},
        insert_first={"id": template_id},
    )
    return join_object(ObjectFile(fm_src, body, True, None)).encode("utf-8")


def _place_new(path: Path, data: bytes) -> bool:
    """Write `data` as a new file at `path` (atomically); False when something is there."""
    if path.exists():
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        create_new(path, data)
    except FileExistsError:
        return False
    return True


def retarget_relations(t: TypeDefinition, retarget: dict[str, str]) -> None:
    """M32: point ``t``'s relations at the space's own types: each allowed type id that is a key
    of `retarget` (a starter type left out because the space has a type of that name under
    another id) becomes that type's id. In place; nothing else changes."""
    if not retarget:
        return
    for p in t.propertyDefinitions:
        allowed = p.options.get("allowedTypes") if p.type == "entity" else None
        if isinstance(allowed, list):
            p.options["allowedTypes"] = [retarget.get(a, a) for a in allowed]


def write_itops_types(
    root: Path, skip: Iterable[str] = (), named: dict[str, str] | None = None
) -> list[Path]:
    """Write the IT ops types and their default templates into the space at `root`.

    Never replaces: a type whose ``.object/types/<id>.json`` exists, or whose id is in `skip`, is
    left out with its template; a template whose ``Templates/<folder>/<Name>.md`` exists is kept
    as it is and the type is written without one registered. A written template is the type's
    ``templates.ids[0]`` and ``defaultTemplateId``. Returns the written paths.

    M32 (the starter added to a space that has types): `named` is the space's lower-cased type
    names -> ids; a starter type whose name the space has under another id is left out too, and
    the written types' relations point at the space's type instead (`retarget_relations`).
    """
    root = Path(root)
    skipped = set(skip)
    written: list[Path] = []
    types_dir = root / ".object" / "types"
    starter = itops_types()
    retarget = {
        t.id: named[t.name.lower()]
        for t in starter
        if named and t.id not in skipped and named.get(t.name.lower(), t.id) != t.id
    }
    for t in starter:
        if t.id in skipped or t.id in retarget or (types_dir / f"{t.id}.json").exists():
            continue
        retarget_relations(t, retarget)
        if t.id in ITOPS_TEMPLATE_SECTIONS:
            name, body = itops_template(t.id)
            segment = PurePosixPath(t.folder.strip("/")).name or safe_filename(t.pluralName)
            path = root / "Templates" / segment / f"{safe_filename(name)}.md"
            template_id = new_ulid()
            if _place_new(path, _template_bytes(template_id, t.name, body)):
                t.templates = {"ids": [template_id], "defaultTemplateId": template_id}
                written.append(path)
        # base revision "" = the file must not exist yet (RevisionConflict otherwise)
        write_type_json(root, t, "")
        written.append(types_dir / f"{t.id}.json")
    return written


def _tag_titles(root: Path) -> set[str]:
    """The folded titles of the space's Tag objects (templates aside). Reads only."""
    titles: set[str] = set()
    for rel in iter_object_paths(root):
        try:
            raw = read_raw(root, rel, cache=False)
        except OSError:
            continue
        if raw.typeName.casefold() != "tag" or raw.fm.get("template") is not None:
            continue
        titles.add(" ".join(_title_of(raw).split()).casefold())
    return titles


def write_itops_tags(root: Path) -> list[Path]:
    """Write the seed Tags (`ITOPS_TAGS`) the space lacks, by folded title; return their paths.

    Each is ``Tags/<name>.md`` as `Space.ensure_tag` writes it (``id``, ``type: 'Tag'``,
    ``title``, ``color``, ``createdAt``, ``lastUpdated``, no body), coloured
    ``bg-<THEME_COLORS[i % 18]>`` by its index in `ITOPS_TAGS`.
    """
    root = Path(root)
    have = _tag_titles(root)
    written: list[Path] = []
    for i, name in enumerate(ITOPS_TAGS):
        if name.casefold() in have:
            continue
        stamp = now_stamp()
        fm_src = set_keys(
            "type: 'Tag'\n",
            {
                "title": name,
                "color": f"bg-{THEME_COLORS[i % len(THEME_COLORS)]}",
                "createdAt": stamp,
                "lastUpdated": stamp,
            },
            insert_first={"id": new_ulid()},
        )
        data = join_object(ObjectFile(fm_src, "", True, None)).encode("utf-8")
        for _attempt in range(100):
            rel = unique_path(root, "Tags", safe_filename(name))
            if _place_new(root / rel, data):
                written.append(root / rel)
                break
        have.add(name.casefold())
    return written
