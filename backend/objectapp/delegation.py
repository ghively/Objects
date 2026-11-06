"""Delegation: one agent hands a task to another, local or remote (M20, spec section 8).

M20 Task 1 holds this stub, whose `install()` ``server.create_app`` calls once after
``mcpgateway.install()``; Task 6 fills the module (the limits, the "delegation" and
"fence-remote" run contributors). Imports no network client.
"""

from __future__ import annotations

__all__ = ["install"]


def install() -> None:
    """Idempotent; called once by `server.create_app`. Registers nothing yet (M20 Task 6)."""
    return None
