"""Who a write is made for (M14): a context variable the write funnels read.

`Space.after_write` notices carry ``origin``: ``None`` for the app's and the API's own
writes, ``"automation:<rule id>"`` (`automations_model.origin_for`) for the writes an
automation makes. The engine runs every action inside `acting_as`, so the writes those
actions cause on the same thread (relation syncs, a Tag created on the way) carry the
rule's origin too, and the loop guard can tell them apart.

A context variable, not a thread-local: a request handler that leaves it unset sees
``None`` whatever thread FastAPI runs it on.
"""

from __future__ import annotations

import contextlib
from collections.abc import Iterator
from contextvars import ContextVar

__all__ = ["acting_as", "current"]

_ORIGIN: ContextVar[str | None] = ContextVar("object_write_origin", default=None)


def current() -> str | None:
    """The origin of the writes made now (None: the app's own, or a request's)."""
    return _ORIGIN.get()


@contextlib.contextmanager
def acting_as(origin: str | None) -> Iterator[None]:
    """Make the writes inside the block carry ``origin``; the previous one comes back after."""
    token = _ORIGIN.set(origin)
    try:
        yield
    finally:
        _ORIGIN.reset(token)
