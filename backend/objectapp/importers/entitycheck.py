"""M30: checking one filing decision's entity candidates against its page (design 2026-11-09,
sections 5 and 5a; plan ``2026-11-09-m30-entity-extraction.md``, Task 2).

On a batch kept as Sources the AI filing pass returns, per page, its **main entity** (what the page
is mainly about), the **entity candidates** it mentions, short **summary lines** about each, the
**relations** between them and the agent's **merges** (the extended decision of the Contract).
`check_candidates` checks each against the page by M27's rules (`filing._check_quote`: the quote is
in the document, has at least ``filing.MIN_QUOTE`` characters and says the value) and the type
model, and answers them with ``ok`` and, when not ok, a ``reason``. It reads only; nothing here
writes.

Shapes (stored in each result of M27's ``filing.json``)::

    CheckedEntity = {"typeId", "type", "name", "aliases": [str],
                     "values": [{"key", "value", "quote", "ok", "reason"?}],
                     "lines": [{"text", "quote", "ok", "reason"?}],
                     "confidence", "main": bool, "ok": bool, "reason"?: str}
    CheckedRelation = {"subject", "relation", "object", "quote", "confidence", "plain": bool,
                       "ok": bool, "reason"?: str}
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ..space import Space

__all__ = ["MAX_LINE", "MIN_PAGES", "check_candidates"]

MIN_PAGES = 2
"""The entity rule: a candidate more than one page mentions becomes an object (`entities.resolve`)."""

MAX_LINE = 200
"""Characters in one summary line."""


def check_candidates(space: Space, decision: dict[str, Any], doc: str, page_path: str, page_title: str) -> dict[str, Any]:
    """Check one decision's ``mainEntity``, ``entities``, ``relations`` and ``merges`` against ``doc``.

    Answers ``{"mainEntity": CheckedEntity | None, "entities": [CheckedEntity],
    "relations": [CheckedRelation], "merges": [{"typeId", "names": [str], "ok": bool, "reason"?: str}]}``.
    Reads only."""
    raise NotImplementedError
