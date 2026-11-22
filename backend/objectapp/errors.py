"""The API's one shared error-response helper.

The 2026-11-22 audit found twenty-six near-identical copies of a local
``_error(...)`` (in ``api_*.py``, ``server.py``, ``whiteboardapi.py`` and
``v1guard.py``). They all answered the same body, ``{"detail": ...}`` with the
given status, and differed only in the parameter name and in whether extra
fields could be folded in (``api_ai``, ``api_learning``, ``api_v1`` and
``v1guard`` took ``**extra``); ``api_search`` alone fixed the status at 422.
The general form below covers every copy, so each module now imports it
instead of defining its own (aliased to the name the module already uses, so
no call site changes shape).
"""

from __future__ import annotations

from typing import Any

from fastapi.responses import JSONResponse

__all__ = ["error_response"]


def error_response(status: int, detail: str, **extra: Any) -> JSONResponse:
    """A JSON error body: ``{"detail": detail, **extra}`` with the given status."""
    return JSONResponse({"detail": detail, **extra}, status_code=status)
