"""The per-launch UI key (decision S6, 2026-11-08): only Object's own window may use ``/api``.

Object's ``/api`` routes have no login: they bind 127.0.0.1 and refuse cross-origin writes
(`server.LocalOnlyMiddleware`), and the run fence (`runfence`) refuses requests from an agent
run's process tree. A process outside that tree (a detached ``curl`` started by a run with the
shell on, or anything else running as Gene) could still use them. So the launcher makes one random
`LaunchKey` per run and `UiKeyMiddleware` requires it on every ``/api`` request; the run fence
stays as the second layer.

How the window gets it, without a file or a page any local process can read: the launcher opens
the window (pywebview, or the browser with ``--browser``) at ``/_open?code=<code>``. The code is
random, works once and for `CODE_SECONDS`; the answer is a redirect to the page with the key in
an HttpOnly, SameSite=Strict session cookie named for the port (``object-ui-<port>``: cookies
don't keep ports apart). Every same-origin request the UI makes (``fetch``, ``EventSource``,
download links, images, a WebSocket) then carries it with no frontend code. The keep-on-top
window gets its own code (pywebview's private mode gives each window its own cookie jar). The
launcher's own start-up probe sends the key as the ``X-Object-Key`` header.

What is checked: ``/api`` and everything under it, except ``/api/v1/...`` with an
``Authorization`` header (the bearer-token API checks its token itself: the MCP servers, agent
runs, A2A callers); and the page itself (``/`` and ``/index.html``), which without the key is a
short "not connected" page instead of an app that can't load. The static bundle stays open.

What a local process running as the same user can still do (for the acceptance notes): read the
browser's memory or, with ``--browser``, a cookie store on disk (the key is a session cookie, so
browsers keep it in memory, but session restore may write it); read the browser's command line
while it opens ``/_open`` (the code is spent by the time the page shows, and is useless after);
and read the launcher's printed ``/_open`` link in ``--browser`` mode before the browser uses it
(it is printed for when no browser opens). It can't get the key from Object over HTTP. ``/api/v1``
with a token is open by design; that token's scope is the limit there.
"""

from __future__ import annotations

import hmac
import secrets
import threading
import time
from collections.abc import Callable
from http.cookies import SimpleCookie
from typing import Any
from urllib.parse import parse_qs, quote, urlsplit

from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

__all__ = [
    "CODE_SECONDS",
    "HEADER",
    "NOT_CONNECTED_PAGE",
    "OPEN_PATH",
    "REFUSED_MESSAGE",
    "LaunchKey",
    "UiKeyMiddleware",
]

OPEN_PATH = "/_open"
HEADER = "x-object-key"
CODE_SECONDS = 300.0
"""How long a one-time ``/_open`` code works (it is normally spent at once)."""
REFUSED_MESSAGE = "Only Object's own window can use this."  # our string
NOT_CONNECTED_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Object</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:15vh auto;max-width:34em;padding:0 1em}</style>
</head><body>
<h1>This page isn't connected to Object</h1>
<p>Only the window Object opened can use this space. Open Object again from its launcher.</p>
</body></html>
"""  # our string
_PAGES = {"/", "/index.html"}


class LaunchKey:
    """One launch's key (`secret`) and its one-time ``/_open`` codes."""

    def __init__(self, port: int, *, clock: Callable[[], float] = time.monotonic) -> None:
        self.port = int(port)
        self.secret = secrets.token_urlsafe(32)
        self.clock = clock
        self._codes: dict[str, float] = {}
        self._lock = threading.Lock()

    @property
    def cookie_name(self) -> str:
        return f"object-ui-{self.port}"

    def issue(self) -> str:
        """A new one-time code for ``/_open``."""
        code = secrets.token_urlsafe(24)
        with self._lock:
            now = self.clock()
            for old, until in list(self._codes.items()):
                if until <= now:
                    del self._codes[old]
            self._codes[code] = now + CODE_SECONDS
        return code

    def redeem(self, code: str | None) -> bool:
        """True once for a code `issue` made, within `CODE_SECONDS`."""
        if not code:
            return False
        with self._lock:
            until = self._codes.pop(code, None)
        return until is not None and self.clock() < until

    def open_url(self, url: str) -> str:
        """``url`` (``http://host:port/path?query``) as the ``/_open`` link that lands there."""
        parts = urlsplit(url)
        target = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
        return f"{parts.scheme}://{parts.netloc}{OPEN_PATH}?code={self.issue()}&next={quote(target, safe='/')}"

    def accepts(self, headers: dict[str, str]) -> bool:
        given = headers.get(HEADER)
        if given is None:
            jar: SimpleCookie = SimpleCookie()
            try:
                jar.load(headers.get("cookie", ""))
            except Exception:  # noqa: BLE001 - a malformed Cookie header is no key
                return False
            morsel = jar.get(self.cookie_name)
            given = morsel.value if morsel is not None else None
        return given is not None and hmac.compare_digest(given.encode(), self.secret.encode())


def _headers(scope: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in scope.get("headers") or ():
        name = k.decode("latin-1").lower()
        value = v.decode("latin-1")
        out[name] = f"{out[name]}; {value}" if name == "cookie" and name in out else value
    return out


def _checked(path: str, headers: dict[str, str]) -> bool:
    if path in _PAGES:
        return True
    if path != "/api" and not path.startswith("/api/"):
        return False
    return not ((path == "/api/v1" or path.startswith("/api/v1/")) and "authorization" in headers)


def _safe_next(value: str | None) -> str:
    """A path on this site: starts with one ``/``, no scheme, host or backslash; else ``/``."""
    if not value or not value.startswith("/") or value.startswith("//") or "\\" in value:
        return "/"
    parts = urlsplit(value)
    return "/" if parts.scheme or parts.netloc else value


class UiKeyMiddleware:
    """Pure ASGI (Server-Sent Events stream through untouched): answers ``/_open`` and refuses
    checked requests without the launch key (401; a WebSocket is closed with 1008)."""

    def __init__(self, app: Any, key: LaunchKey) -> None:
        self.app = app
        self.key = key

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        kind = scope["type"]
        if kind in ("http", "websocket"):
            path = scope.get("path") or ""
            headers = _headers(scope)
            if kind == "http" and path == OPEN_PATH:
                await self._open(scope, receive, send)
                return
            if _checked(path, headers) and not self.key.accepts(headers):
                if kind == "websocket":
                    await send({"type": "websocket.close", "code": 1008})
                    return
                if path in _PAGES:
                    response: Any = HTMLResponse(NOT_CONNECTED_PAGE, status_code=401)
                else:
                    response = JSONResponse({"detail": REFUSED_MESSAGE}, status_code=401)
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)

    async def _open(self, scope: Any, receive: Any, send: Any) -> None:
        query = parse_qs((scope.get("query_string") or b"").decode("latin-1"))
        code = (query.get("code") or [None])[0]
        target = _safe_next((query.get("next") or [None])[0])
        response = RedirectResponse(target, status_code=303)
        response.headers["Cache-Control"] = "no-store"
        if self.key.redeem(code):
            response.set_cookie(self.key.cookie_name, self.key.secret, path="/", httponly=True, samesite="strict")
        await response(scope, receive, send)
