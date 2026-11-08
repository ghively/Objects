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
above get fresh ids.

"Notes" is each type's ``blocks`` property (the object's body). There is no
Organization type in the basic setup, so "Organizations" relations allow any type.
`write_basic_types` writes only ``.object/types/<id>.json`` for the four types.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .ids import new_ulid
from .space import safe_filename
from .typemodel import (
    PROPERTY_ICONS,
    Icon,
    PropertyDefinition,
    TypeDefinition,
    _task_field_defs,
    label_options,
    system_property_defs,
    write_type_json,
)
from .workfields import field_defs

__all__ = ["BASIC_TYPE_IDS", "basic_types", "write_basic_types"]

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


def basic_types() -> list[TypeDefinition]:
    """Fresh Person, Meeting, Project and Book definitions (new property ids each call)."""
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
            *field_defs(task=False, project_type_ids=["project"]),
            _completed(),
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


def write_basic_types(root: Path) -> list[Path]:
    """Write the four types into the (new) space at `root`. Refuses to replace an existing file."""
    written: list[Path] = []
    for t in basic_types():
        # base revision "" = the file must not exist yet (RevisionConflict otherwise)
        write_type_json(Path(root), t, "")
        written.append(Path(root) / ".object" / "types" / f"{t.id}.json")
    return written
