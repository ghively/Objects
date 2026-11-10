"""M30: writing what Gene accepted in the Entities step (design 2026-11-09, sections 5 and 5a; plan
``2026-11-09-m30-entity-extraction.md``, Contract and Task 6).

`write_entities` places each accepted entity (an object already in the space, else a new one with
an ``importSource`` block and a ``created`` entry in ``items.json``), writes its relations on their
stored side (M28's counterparts are computed, never written; a relation outside the named set is a
plain link), its values, aliases, **Sources** relation, tags and collections in one
``update_properties``, and its "From sources" section (`distill.replace_section`), keeping the
citations in ``.object/distilled/<entity id>.json``. **No step writes a Source.** Each step is
recorded in ``.object/imports/<batch>/entities-written.json`` (`WRITTEN_FILE`)::

    {"placed": {entityId: path}, "done": {entityId: ["values", "section"]}, "outcome": EntitiesWritten | null}

so a retry after a failure resumes without placing anything twice.

``ConflictRow = {entity: {path, title}, key, name, kept: {value, sources}, others: [{value, sources}]}``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ..space import Space
    from .entities import Entity, Resolution

__all__ = ["WRITTEN_FILE", "write_entities"]

WRITTEN_FILE = "entities-written.json"


def write_entities(
    space: Space,
    batch: str,
    system: str,
    imported_at: str,
    chosen: list[tuple[Entity, str]],
    res: Resolution,
    results: dict[str, dict[str, Any]],
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    """Write the ``chosen`` entities (entity, final name) of ``batch``.

    Answers ``EntitiesWritten`` plus ``"inboxLinks": [{"path", "title", "reason"}]`` and
    ``"conflicts": [ConflictRow]``; appends the created items to ``items``."""
    raise NotImplementedError
