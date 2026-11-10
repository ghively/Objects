"""M30: one entity per thing, from the checked candidates of every Source (design 2026-11-09,
sections 5 and 5a; plan ``2026-11-09-m30-entity-extraction.md``, Contract and Task 3).

`resolve` joins the candidates of a batch's filing results into entities: names and aliases that
normalise the same (`norm_name`) within a type, the agent's merges, then Gene's review (merges, then
splits). Per entity it picks the values from all its Sources (`distill.pick_values`: the newest
Source wins, conflicts kept), assembles the summary lines, and applies **the entity rule**: a
candidate becomes an object when a page is mainly about it (``"own"``), more than one page mentions
it (``"pages"``, `entitycheck.MIN_PAGES`) or it has properties of its own (``"properties"``);
otherwise it stays text. A category (a label option of a type in the space, or a tag) is never an
entity. The resolved list is **computed** on every read from ``filing.json`` and
``entities-review.json`` (never stored), so reading writes nothing.

Gene's review, ``.object/imports/<batch>/entities-review.json`` (`EntitiesReview`)::

    {"decisions": {entityId: {"status": "accepted"|"renamed"|"rejected", "name"?: str}},
     "merges": [[entityId, ...]], "splits": [{"id": entityId, "names": [str]}], "revision"?: str}

`view` answers the wizard's ``EntitiesView`` (frontend ``api/types.ts``).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .distill import PickedValue, SummaryLine

if TYPE_CHECKING:
    from ..space import Space

__all__ = [
    "REVIEW_FILE",
    "STATUSES",
    "Entity",
    "Resolution",
    "ReviewInvalid",
    "accepted",
    "load_review",
    "norm_name",
    "resolve",
    "save_review",
    "undecided",
    "view",
]

REVIEW_FILE = "entities-review.json"
STATUSES = ("accepted", "renamed", "rejected")


class ReviewInvalid(ValueError):
    """A review the app refuses (422); the message says why."""


@dataclass
class Entity:
    id: str
    """``"<typeId>:<smallest member key>"``."""
    typeId: str
    type: str
    name: str
    """The most-used spelling (first seen on a tie)."""
    aliases: list[str]
    """Every other spelling seen."""
    keys: set[str]
    """`norm_name` of every member."""
    pages: list[str]
    """The Sources that mention it (provenance): main pages first, then by path."""
    mainPages: list[str]
    values: dict[str, PickedValue]
    """`distill.pick_values` over every passing value."""
    lines: list[SummaryLine]
    confidence: str
    """The highest of its candidates."""
    joinedByAgent: bool
    """An agent merge joined it (offered as a split)."""
    rule: str | None
    """``"own"`` | ``"pages"`` | ``"properties"`` | None (stays text)."""
    category: bool
    existing: str | None
    """Path of an object of this type already in the space with that name or alias (never a Source)."""


@dataclass
class Resolution:
    entities: list[Entity]
    """Rule met, not a category."""
    leftOut: list[Entity]
    """Rule None, or a category."""
    suggestedMerges: list[dict[str, Any]]
    """``[{"ids": [...], "names": [...]}]``, near-duplicates within a type."""
    relations: list[dict[str, Any]]
    """Every ok CheckedRelation, with ``"page"``."""
    pages: list[str]
    """Every page (Source) of the results."""


def norm_name(text: str) -> str:
    """NFKC, casefolded, whitespace collapsed, surrounding ``.,;:()[]"'`` stripped."""
    raise NotImplementedError


def resolve(space: Space, results: dict[str, dict[str, Any]], review: dict[str, Any] | None = None) -> Resolution:
    """The batch's entities from its filing ``results`` (path -> result) and Gene's ``review``. Reads only."""
    raise NotImplementedError


def load_review(root: Path | str, batch: str) -> dict[str, Any]:
    """The batch's `EntitiesReview`; empty when absent. Reads only."""
    raise NotImplementedError


def save_review(space: Space, batch: str, review: dict[str, Any], results: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Check and write ``entities-review.json`` (the only file it writes); answers the stored review.
    Raises `ReviewInvalid`."""
    raise NotImplementedError


def accepted(res: Resolution, review: dict[str, Any]) -> list[tuple[Entity, str]]:
    """``(entity, final name)`` of every accepted or renamed entity."""
    raise NotImplementedError


def undecided(res: Resolution, review: dict[str, Any]) -> list[str]:
    """Ids of the entities with no decision."""
    raise NotImplementedError


def view(space: Space, batch: str, results: dict[str, dict[str, Any]], state: str) -> dict[str, Any]:
    """The wizard's ``EntitiesView`` for the batch in filing ``state``. Reads only."""
    raise NotImplementedError
