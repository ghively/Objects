"""M18's run contributors, registered once by `server.create_app` (plan "Contract (T1)").

`install` is idempotent: `agentrun.add_contributor` replaces a contributor of the same name.
The orders are M17's registry of contributor orders: 10 ``memory-snapshot``, 15
``learning-guidance``, 68 ``review-tools`` (after every contributor that adds tools or servers).
"""

from __future__ import annotations

from . import agentmemory, agentrun, reviews

__all__ = ["install"]


def install() -> None:
    """Register M18's three contributors (again is harmless)."""
    agentrun.add_contributor("memory-snapshot", 10, agentmemory.snapshot_contributor)
    agentrun.add_contributor("learning-guidance", 15, agentmemory.guidance_contributor)
    agentrun.add_contributor("review-tools", 68, reviews.review_contributor)
