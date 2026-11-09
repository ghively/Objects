"""The run fence (Gene, 2026-11-08): an agent run can't use the app's own ``/api`` routes.

Object's routes are unauthenticated loopback routes, so a run with the shell on (or the Work
loop's full-tool run) could reach them (the import approval routes among them) with a plain
``curl``. The server knows each running run's root process id (`agentrun.running_run_pids`,
kept by the turn runner). `RunFenceMiddleware` finds the process behind each ``/api`` request's
TCP connection and refuses the request with ``403 {"detail": "An agent run can't use the app's
own routes."}`` when that process is a run's root process or one of its descendants.

What stays allowed: ``/api/v1/...`` requests that carry an ``Authorization`` header (Object's
own MCP server ``objectapp-mcp``, a child of the CLI, talks to ``/api/v1`` with its run token,
and `api_v1` checks the token itself; a delegated run's server does the same) and everything
outside ``/api`` (the static files). Requests from the browser, the launcher or any other
process that isn't a run are untouched.

How the process is found: `peer_pid` scans ``psutil.net_connections(kind="tcp")`` for the
socket whose local address is the request's client address, and keeps the whole address-to-pid
table for about two seconds (`CACHE_SECONDS`): a connection the table hasn't seen rescans at
once, a known connection (a browser's keep-alive socket) is answered from the table. On this
machine (Linux) a scan takes a few milliseconds; a table hit is microseconds. The lookup runs
in a worker thread, off the event loop. `is_run_process` walks ``psutil.Process(pid).parents()``.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from collections.abc import Callable, Collection
from typing import Any

import psutil
from fastapi.responses import JSONResponse

__all__ = [
    "CACHE_SECONDS",
    "REFUSED_MESSAGE",
    "UNAVAILABLE_MESSAGE",
    "RunFenceMiddleware",
    "is_run_process",
    "peer_pid",
    "reset_cache",
]

_log = logging.getLogger(__name__)

CACHE_SECONDS = 2.0
"""How long one scan of the connection table answers lookups for the connections it saw."""
REFUSED_MESSAGE = "An agent run can't use the app's own routes."
UNAVAILABLE_MESSAGE = (
    "The run fence is off: this machine doesn't let Object see which process owns a connection."
)

_lock = threading.Lock()
_table: dict[tuple[str, int], int | None] = {}
_scanned_at: float | None = None
_unavailable = False


def _now() -> float:
    return time.monotonic()


def reset_cache() -> None:
    """Forget the cached table and the "psutil can't answer" state (tests)."""
    global _scanned_at, _unavailable
    with _lock:
        _table.clear()
        _scanned_at = None
        _unavailable = False


def _scan() -> dict[tuple[str, int], int | None]:
    table: dict[tuple[str, int], int | None] = {}
    for conn in psutil.net_connections(kind="tcp"):
        laddr = conn.laddr
        if not laddr or not getattr(laddr, "port", None):
            continue
        table[(str(laddr.ip), int(laddr.port))] = conn.pid
    return table


def peer_pid(client_host: str, client_port: int) -> int | None:
    """The id of the process holding the socket at ``client_host:client_port``, or None when
    no such connection is listed, its owner can't be seen, or psutil can't list connections
    here (logged once; every later call answers None without asking again)."""
    global _scanned_at, _unavailable
    key = (client_host, int(client_port))
    with _lock:
        if _unavailable:
            return None
        now = _now()
        fresh = _scanned_at is not None and now - _scanned_at < CACHE_SECONDS
        if not fresh or key not in _table:
            try:
                scanned = _scan()
            except (psutil.Error, OSError, NotImplementedError, RuntimeError) as exc:
                _unavailable = True
                _log.warning("%s (%s)", UNAVAILABLE_MESSAGE, exc)
                return None
            _table.clear()
            _table.update(scanned)
            _scanned_at = now
        return _table.get(key)


def is_run_process(pid: int, run_pids: Collection[int]) -> bool:
    """Whether `pid` is one of `run_pids` or a descendant of one (the CLI's MCP servers, its
    shells and what they start). False for a process that is gone or can't be inspected."""
    if not run_pids:
        return False
    if pid in run_pids:
        return True
    try:
        return any(parent.pid in run_pids for parent in psutil.Process(pid).parents())
    except (psutil.Error, OSError):
        return False


def _fenced(scope: dict[str, Any]) -> bool:
    """Whether this request's path is one the fence covers: under ``/api``, but not ``/api/v1``
    with an ``Authorization`` header (the token-protected API checks the token itself)."""
    path = scope.get("path") or ""
    if path != "/api" and not path.startswith("/api/"):
        return False
    if path == "/api/v1" or path.startswith("/api/v1/"):
        for name, _value in scope.get("headers") or ():
            if name.lower() == b"authorization":
                return False
    return True


def _blocked(client_host: str, client_port: int, run_pids: Collection[int]) -> bool:
    pid = peer_pid(client_host, client_port)
    return pid is not None and is_run_process(pid, run_pids)


class RunFenceMiddleware:
    """Pure ASGI (Server-Sent Events stream through untouched): refuses ``/api`` requests whose
    connecting process belongs to a running agent run. `run_pids` gives the running runs' root
    process ids; with none running nothing is looked up."""

    def __init__(self, app: Any, run_pids: Callable[[], Collection[int]]) -> None:
        self.app = app
        self.run_pids = run_pids

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] == "http" and _fenced(scope):
            pids = self.run_pids()
            client = scope.get("client")
            if pids and client:
                host, port = client[0], client[1]
                if await asyncio.to_thread(_blocked, str(host), int(port), pids):
                    await _refuse(scope, receive, send)
                    return
        await self.app(scope, receive, send)


async def _refuse(scope: Any, receive: Any, send: Any) -> None:
    await JSONResponse({"detail": REFUSED_MESSAGE}, status_code=403)(scope, receive, send)
