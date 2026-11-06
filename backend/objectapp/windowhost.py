"""The keep-on-top window host (M23): who can open Object's small always-on-top window.

``__main__`` sets an opener when it runs the pywebview window (``webview.create_window("Object
focus", url, width=360, height=470, on_top=True)``); in browser mode there is none, and
``POST /api/work/keep-on-top`` answers 501 with `KEEP_ON_TOP_LATER`.
"""

from __future__ import annotations

import threading
from collections.abc import Callable

from .workseams import SeamUnavailable

__all__ = ["KEEP_ON_TOP_LATER", "can_open", "open_window", "set_opener"]

KEEP_ON_TOP_LATER = "Keep on top needs the Object window."

_lock = threading.Lock()
_opener: Callable[[str], None] | None = None


def set_opener(fn: Callable[[str], None] | None) -> None:
    """Install (or, with None, remove) the function that opens the keep-on-top window."""
    global _opener
    with _lock:
        _opener = fn


def can_open() -> bool:
    """True when an opener is installed (the Object window is running)."""
    with _lock:
        return _opener is not None


def open_window(url: str) -> None:
    """Open the keep-on-top window at `url`; `SeamUnavailable` without an opener."""
    with _lock:
        fn = _opener
    if fn is None:
        raise SeamUnavailable(KEEP_ON_TOP_LATER)
    fn(url)
