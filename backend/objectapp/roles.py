"""Capacities' structure roles for our types, and the role lists M5 needs.

Capacities decides per structure (``RootPage``, ``RootEntity``, ``MediaImage`` …)
whether an object has a references section, unlinked mentions, backlinks or a
graph view (``structureHeuristicsBackbone.ts``). Our basic types map onto those
roles; every other type is a ``RootEntity`` (Capacities' custom object types).
The lists below are the reference lists restricted to the roles we have
(``RootWhiteboard`` is the reference's ``...whiteboard(config)`` entry, M6).
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
    "Page": "RootPage",
    "Tag": "RootTag",
    "Task": "RootTask",
    "DailyNote": "RootDailyNote",
    "Whiteboard": "RootWhiteboard",
    "Weblink": "MediaWebResource",
    "File": "MediaFile",
    "Image": "MediaImage",
    "PDF": "MediaPDF",
    "Audio": "MediaAudio",
    "Video": "MediaVideo",
    "Tweet": "MediaTweet",
}

ROLES = frozenset({*_BASIC_ROLES.values(), "RootEntity"})
"""Every role one of our types can have."""

HAS_REFERENCES_SECTION = frozenset(
    {
        "RootPage",
        "RootEntity",
        "MediaImage",
        "MediaPDF",
        "MediaAudio",
        "MediaWebResource",
        "MediaFile",
        "MediaTweet",
        "RootTask",
        "RootWhiteboard",
    }
)
"""``canHaveBacklinksSection``."""

HAS_UNLINKED_MENTIONS = frozenset(
    {
        "RootPage",
        "RootEntity",
        "MediaImage",
        "MediaPDF",
        "MediaAudio",
        "MediaWebResource",
        "MediaFile",
        "MediaTweet",
        "RootTag",
        "RootTask",
        "RootWhiteboard",
    }
)
"""``hasUnlinkedMentions``."""

CAN_BE_UNLINKED_MENTION = frozenset(
    {
        "RootPage",
        "RootEntity",
        "MediaImage",
        "MediaPDF",
        "MediaAudio",
        "MediaWebResource",
        "MediaFile",
        "MediaTweet",
        "RootDailyNote",
        "RootTask",
        "RootWhiteboard",
    }
)
"""``canBeUnlinkedMention``."""

CAN_HAVE_BACKLINKS = frozenset(
    {
        "RootPage",
        "RootEntity",
        "MediaImage",
        "MediaPDF",
        "MediaAudio",
        "MediaWebResource",
        "MediaFile",
        "MediaTweet",
        "RootTag",
        "RootTask",
        "RootWhiteboard",
    }
)
"""``canHaveBacklinks``."""

NO_GRAPH_SUPPORT: frozenset[str] = frozenset()
"""``hasNoGraphViewSupport`` (RootSpace, User, UserPersonal, UtilDate): none of our roles."""


def role_of(t: TypeDefinition | None) -> str:
    """The Capacities structure role of objects of type ``t`` (``RootEntity`` for custom types)."""
    if t is None or not t.basic:
        return "RootEntity"
    name = _basic_name(t.name)
    return _BASIC_ROLES.get(name or "", "RootEntity")
