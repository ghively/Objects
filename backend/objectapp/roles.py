"""Structure roles for our types, and the role lists M5 needs.

Each structure role (``page``, ``entity``, ``image`` …) decides whether an
object has a references section, unlinked mentions, backlinks or a graph view.
Our basic types map onto those roles; every other type is an ``entity``
(custom object types). The lists below hold the roles we have (``whiteboard``
since M6).

Roles are computed from the type each time (`role_of`); they are never stored
on disk, in the search index or in an API payload.
"""

from __future__ import annotations

from .typemodel import TypeDefinition, _basic_name

__all__ = [
    "CAN_BE_UNLINKED_MENTION",
    "CAN_HAVE_BACKLINKS",
    "HAS_REFERENCES_SECTION",
    "HAS_UNLINKED_MENTIONS",
    "NO_GRAPH_SUPPORT",
    "ROLES",
    "role_of",
]

_BASIC_ROLES = {
    "Page": "page",
    "Tag": "tag",
    "Task": "task",
    "DailyNote": "dailyNote",
    "Whiteboard": "whiteboard",
    "Weblink": "weblink",
    "File": "file",
    "Image": "image",
    "PDF": "pdf",
    "Audio": "audio",
    "Video": "video",
    "Tweet": "tweet",
}

ROLES = frozenset({*_BASIC_ROLES.values(), "entity"})
"""Every role one of our types can have."""

HAS_REFERENCES_SECTION = frozenset(
    {
        "page",
        "entity",
        "image",
        "pdf",
        "audio",
        "weblink",
        "file",
        "tweet",
        "task",
        "whiteboard",
    }
)
"""Roles whose objects show a references section."""

HAS_UNLINKED_MENTIONS = frozenset(
    {
        "page",
        "entity",
        "image",
        "pdf",
        "audio",
        "weblink",
        "file",
        "tweet",
        "tag",
        "task",
        "whiteboard",
    }
)
"""Roles whose references section offers unlinked mentions."""

CAN_BE_UNLINKED_MENTION = frozenset(
    {
        "page",
        "entity",
        "image",
        "pdf",
        "audio",
        "weblink",
        "file",
        "tweet",
        "dailyNote",
        "task",
        "whiteboard",
    }
)
"""Roles whose objects can be found as an unlinked mention."""

CAN_HAVE_BACKLINKS = frozenset(
    {
        "page",
        "entity",
        "image",
        "pdf",
        "audio",
        "weblink",
        "file",
        "tweet",
        "tag",
        "task",
        "whiteboard",
    }
)
"""Roles whose objects can have backlinks."""

NO_GRAPH_SUPPORT: frozenset[str] = frozenset()
"""Roles without a graph view (spaces, users and date utilities): none of our roles."""


def role_of(t: TypeDefinition | None) -> str:
    """The structure role of objects of type ``t`` (``entity`` for custom types)."""
    if t is None or not t.basic:
        return "entity"
    name = _basic_name(t.name)
    return _BASIC_ROLES.get(name or "", "entity")
