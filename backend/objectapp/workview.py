"""M22: the built-in Tickets view (a virtual saved query, id ``work-tickets``).

Plan ``2026-11-05-m22-work-model.md``, Contract "Tickets view". The view lists every work item
with a Ticket ID: list layout, sorted by Desk updated (newest first), grouped by Desk status (so
its board columns are the desk statuses). It has no file until Gene saves a change to it; its
``structures`` are always every work type, set at read (stored ones are ignored and saved as
``[]``). It can't be deleted. The API marks it with ``builtIn: "tickets"``.
"""

from __future__ import annotations

import copy
from typing import Any

from .queries import QueryDef

__all__ = [
    "BUILT_IN",
    "TICKETS_ID",
    "api_extra",
    "apply_structures",
    "for_storage",
    "tickets_default",
]

TICKETS_ID = "work-tickets"
BUILT_IN = "The Tickets view is built in."
"""Why the Tickets view can't be deleted (422)."""

_DEFAULT: dict[str, Any] = {
    "schemaVersion": 1,
    "id": TICKETS_ID,
    "name": "Tickets",
    "titleIsCustom": True,
    "icon": {"type": "iconify", "val": "ph-ticket"},
    "description": "Every work item with a Ticket ID.",
    "definition": {
        "structures": [],
        "filterGroup": {
            "type": "filterGroup",
            "operator": "and",
            "elements": [{"type": "filter", "propertyId": "ticketId", "option": "isNotEmpty"}],
        },
        "sorts": [{"propertyId": "deskUpdated", "option": "descending"}],
        "groupBy": {"groups": [{"propertyId": "deskStatus", "option": "label"}]},
    },
    "view": {"viewDefinition": {"dataViewLayout": "list"}},
}


def tickets_default() -> dict[str, Any]:
    """The Tickets view's query JSON, ``structures`` empty (a fresh copy)."""
    return copy.deepcopy(_DEFAULT)


def apply_structures(q: QueryDef, work_type_ids: list[str]) -> QueryDef:
    """Set ``q``'s structures to one per work type, in the order given; return ``q``."""
    q.definition["structures"] = [{"id": tid} for tid in work_type_ids]
    return q


def for_storage(q: QueryDef) -> QueryDef:
    """A copy of ``q`` as its file holds it: no structures, no API-only ``builtIn`` key."""
    out = copy.deepcopy(q)
    out.definition["structures"] = []
    out.extra.pop("builtIn", None)
    return out


def api_extra(q: QueryDef) -> dict[str, Any]:
    """The API-only keys of a query: ``{"builtIn": "tickets"}`` for the Tickets view."""
    return {"builtIn": "tickets"} if q.id == TICKETS_ID else {}
