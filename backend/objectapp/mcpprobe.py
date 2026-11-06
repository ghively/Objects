"""Listing an outside MCP server's tools (M19): the one M19 module that opens a connection.

Only on Gene's "Test" or the Tools tab, only to the servers he added (or an agent folder's
servers). Uses the ``mcp`` client library: a stdio transport (below), ``mcp.client.
streamable_http.streamable_http_client`` (headers through ``mcp.shared._httpx_utils.
create_mcp_http_client``), ``mcp.client.sse.sse_client``, then ``ClientSession.initialize()`` and
``list_tools()`` following pagination. Errors are our strings, redacted with
`secretstore.redact`; on timeout or failure the stdio process tree is killed. Writes nothing (the
stderr temp file is removed).

The stdio transport is our own small one, built on the library's process helpers
(``mcp.os.win32.utilities`` / ``mcp.os.posix.utilities``): the library's ``stdio_client`` gives a
server 2 seconds after its stdin closes before it kills it, and hides the process, so a probe
couldn't kill a hung server at its deadline or tell "it stopped" from "it answered an error".
A probe has nothing to wait for, so it kills the tree at once on a timeout or failure (and after
a short grace once the tools are listed). Lines on stdout that aren't JSON-RPC are skipped and
never logged.
"""

from __future__ import annotations

import asyncio
import contextlib
import re
import sys
import tempfile
import time
from collections.abc import AsyncIterator, Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from . import mcpmodel
from .mcpmodel import PROBE_TIMEOUT_S

__all__ = ["ProbeResult", "expand_refs", "probe", "probe_many", "probe_sync"]

PROBE_STDERR_CHARS = mcpmodel.PROBE_STDERR_CHARS
TOOL_DESCRIPTION_MAX = mcpmodel.TOOL_DESCRIPTION_MAX
_EXIT_GRACE_S = 0.3
"""After the tools are listed: how long a server gets to exit on its own once its stdin closes."""
_REAP_S = 2.0
"""How long to wait for a killed process to be seen dead."""
_REF = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}")


@dataclass(frozen=True)
class ProbeResult:
    ok: bool
    tools: tuple[tuple[str, str], ...]
    """(name, description capped at `mcpmodel.TOOL_DESCRIPTION_MAX`)"""
    error: str | None
    """Already redacted."""
    elapsed_ms: int
    at: str
    read_only: tuple[str, ...] = ()
    """Names of the listed tools whose ``annotations.readOnlyHint`` is true (a hint only: M19
    never acts on it; M24 shows it in Settings > Work)."""


def expand_refs(value: Any, env: Mapping[str, str]) -> Any:
    """``${VAR}`` and ``${VAR:-default}``, the CLI's rule, recursively (dict keys left alone).

    Read from `env` only, never from Object's own environment. ``${VAR:-default}`` gives the
    default when VAR is unset or empty; an unset ``${VAR}`` stays as written (the CLI leaves it
    literal: ``docs/superpowers/plans/m19-cli-spike.md``).
    """
    if isinstance(value, str):
        def fill(m: re.Match[str]) -> str:
            name, default = m.group(1), m.group(2)
            got = env.get(name)
            if default is not None:
                return got if got else default
            return got if got is not None else m.group(0)

        return _REF.sub(fill, value)
    if isinstance(value, list):
        return [expand_refs(v, env) for v in value]
    if isinstance(value, tuple):
        return tuple(expand_refs(v, env) for v in value)
    if isinstance(value, dict):
        return {k: expand_refs(v, env) for k, v in value.items()}
    return value


# --- errors ----------------------------------------------------------------------------------


class _Failed(Exception):
    """A probe failure carrying our message (not yet redacted)."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def _timeout_message(timeout: float) -> str:
    n = int(timeout) if float(timeout).is_integer() else timeout
    return f"The server didn't answer within {n} second{'' if n == 1 else 's'}."


def _status_message(status: int) -> str:
    if status in (401, 403):
        return (f"The server refused the credentials ({status}). If it needs an OAuth sign-in, Object "
                "can't do that yet; use a token or a header.")
    return f"The server answered {status}."


def _leaves(exc: BaseException) -> list[BaseException]:
    """The exceptions inside (nested) exception groups, plus their causes."""
    out: list[BaseException] = []
    stack = [exc]
    while stack:
        e = stack.pop()
        inner = getattr(e, "exceptions", None)
        if isinstance(e, BaseExceptionGroup) and inner:
            stack.extend(inner)
            continue
        out.append(e)
        if e.__cause__ is not None:
            stack.append(e.__cause__)
    return out


def _http_failure(exc: BaseException, url: str, statuses: list[int]) -> str:
    import httpx2

    leaves = _leaves(exc)
    for e in leaves:
        response = getattr(e, "response", None)
        status = getattr(response, "status_code", None)
        if isinstance(e, httpx2.HTTPStatusError) and isinstance(status, int):
            return _status_message(status)
    bad = [s for s in statuses if s >= 400]
    if bad:
        return _status_message(bad[0])
    if any(isinstance(e, (httpx2.ConnectError, ConnectionError)) for e in leaves):
        return f"Couldn't connect to {urlsplit(url).hostname or url}."
    if any(isinstance(e, httpx2.TimeoutException) for e in leaves):
        return ""  # the caller turns it into the timeout message
    return _generic(leaves)


def _generic(leaves: list[BaseException]) -> str:
    from mcp.shared.exceptions import MCPError

    for e in leaves:
        if isinstance(e, MCPError):
            return f"The server answered an error: {getattr(e.error, 'message', '') or e}"
    first = leaves[0] if leaves else None
    detail = f"{type(first).__name__}: {first}" if first is not None else "unknown error"
    return f"Couldn't list the tools ({detail})."


# --- the stdio transport ---------------------------------------------------------------------


@dataclass
class _Proc:
    process: Any = None
    exited: bool = False
    """The server stopped on its own before the failure was handled."""


async def _spawn(command: str, args: list[str], env: dict[str, str], cwd: Path | None, errlog: Any) -> Any:
    import anyio

    if sys.platform == "win32":
        from mcp.os.win32.utilities import create_windows_process, get_windows_executable_command

        resolved = await anyio.to_thread.run_sync(get_windows_executable_command, command)
        return await create_windows_process(resolved, args, env, errlog, cwd)
    return await anyio.open_process([command, *args], env=env, stderr=errlog, cwd=cwd, start_new_session=True)


async def _kill_tree(process: Any) -> None:
    if sys.platform == "win32":
        from mcp.os.win32.utilities import close_process_job, terminate_windows_process_tree

        await terminate_windows_process_tree(process)
        await _wait_exit(process, _REAP_S)
        close_process_job(process)
    else:
        from mcp.os.posix.utilities import terminate_posix_process_tree

        await terminate_posix_process_tree(process, 1.0)
        await _wait_exit(process, _REAP_S)


async def _wait_exit(process: Any, timeout: float) -> bool:
    import anyio

    deadline = anyio.current_time() + timeout
    while process.returncode is None:
        if anyio.current_time() >= deadline:
            return False
        await anyio.sleep(0.01)
    return True


async def _close(stream: Any) -> None:
    import anyio

    with contextlib.suppress(OSError, anyio.BrokenResourceError, anyio.ClosedResourceError):
        await stream.aclose()


@contextlib.asynccontextmanager
async def _stdio(command: str, args: list[str], env: dict[str, str], cwd: Path | None, errlog: Any,
                 proc: _Proc) -> AsyncIterator[tuple[Any, Any]]:
    """A stdio connection to a server process: (read stream, write stream) for `ClientSession`."""
    import anyio
    import mcp_types
    from anyio.streams.text import TextReceiveStream
    from mcp.shared.message import SessionMessage

    process = await _spawn(command, args, env, cwd, errlog)
    proc.process = process
    read_writer, read_stream = anyio.create_memory_object_stream[Any](0)
    write_stream, write_reader = anyio.create_memory_object_stream[Any](0)

    async def reader() -> None:
        try:
            async with read_writer:
                buffer = ""
                async for chunk in TextReceiveStream(process.stdout, encoding="utf-8", errors="replace"):
                    lines = (buffer + chunk).split("\n")
                    buffer = lines.pop()
                    for line in lines:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            message = mcp_types.jsonrpc_message_adapter.validate_json(line, by_name=False)
                        except ValueError:
                            continue  # junk on stdout: skipped, never logged
                        await read_writer.send(SessionMessage(message))
        except (anyio.ClosedResourceError, anyio.BrokenResourceError, anyio.EndOfStream, OSError):
            pass

    async def writer() -> None:
        try:
            async with write_reader:
                async for message in write_reader:
                    data = message.message.model_dump_json(by_alias=True, exclude_unset=True) + "\n"
                    await process.stdin.send(data.encode("utf-8"))
        except (anyio.ClosedResourceError, anyio.BrokenResourceError, OSError):
            await read_writer.aclose()

    async with anyio.create_task_group() as tg:
        tg.start_soon(reader)
        tg.start_soon(writer)
        failure: BaseException | None = None
        try:
            yield read_stream, write_stream
        except BaseException as e:
            failure = e
            raise
        finally:
            with anyio.CancelScope(shield=True):
                if failure is not None and not isinstance(failure, anyio.get_cancelled_exc_class()):
                    # Did it stop on its own (stdin still open), or is it alive and answered badly?
                    proc.exited = await _wait_exit(process, _EXIT_GRACE_S)
                await _close(process.stdin)
                if failure is None:
                    await _wait_exit(process, _EXIT_GRACE_S)
                await _kill_tree(process)
                await _close(process.stdout)
                for s in (read_stream, write_stream, read_writer, write_reader):
                    await _close(s)
                transport = getattr(getattr(process, "_process", None), "_transport", None)
                close = getattr(transport, "close", None)
                if callable(close):
                    with contextlib.suppress(Exception):
                        close()
            tg.cancel_scope.cancel()


# --- probing ---------------------------------------------------------------------------------


async def _list(read: Any, write: Any) -> tuple[tuple[tuple[str, str], ...], tuple[str, ...]]:
    from mcp import ClientSession
    from mcp.types import PaginatedRequestParams

    async with ClientSession(read, write) as session:
        await session.initialize()
        tools: dict[str, tuple[str, bool]] = {}
        cursor: str | None = None
        seen: set[str] = set()
        while True:
            params = PaginatedRequestParams(cursor=cursor) if cursor is not None else None
            result = await session.list_tools(params=params)
            for tool in result.tools:
                annotations = getattr(tool, "annotations", None)
                read_only = bool(getattr(annotations, "read_only_hint", False)) if annotations else False
                tools[tool.name] = ((tool.description or "")[:TOOL_DESCRIPTION_MAX], read_only)
            cursor = result.next_cursor
            if not cursor or cursor in seen:
                break
            seen.add(cursor)
    names = sorted(tools)
    return (tuple((n, tools[n][0]) for n in names), tuple(n for n in names if tools[n][1]))


def _stderr_tail(errlog: Any) -> str:
    try:
        errlog.flush()
        errlog.seek(0)
        text = errlog.read().decode("utf-8", errors="replace")
    except (OSError, ValueError):
        return ""
    return text.replace("\r\n", "\n").strip()[-PROBE_STDERR_CHARS:].strip()


async def _probe_stdio(entry: dict[str, Any], env: Mapping[str, str], cwd: Path | None,
                       timeout: float) -> tuple[tuple[tuple[str, str], ...], tuple[str, ...]]:
    import anyio
    from mcp.client.stdio import get_default_environment

    command = str(expand_refs(entry.get("command") or "", env))
    args = [str(a) for a in expand_refs(list(entry.get("args") or []), env)]
    extra = {str(k): str(v) for k, v in expand_refs(dict(entry.get("env") or {}), env).items()}
    child_env = get_default_environment() | extra
    proc = _Proc()
    with tempfile.TemporaryFile(mode="w+b") as errlog:
        try:
            with anyio.fail_after(timeout):
                try:
                    async with _stdio(command, args, child_env, cwd, errlog, proc) as (read, write):
                        return await _list(read, write)
                except FileNotFoundError as e:
                    if proc.process is None:
                        raise _Failed(f"Couldn't start {command}: not found.") from e
                    raise
                except PermissionError as e:
                    if proc.process is None:
                        raise _Failed(f"Couldn't start {command}: not allowed.") from e
                    raise
        except TimeoutError as e:
            raise _Failed(_timeout_message(timeout)) from e
        except _Failed:
            raise
        except Exception as e:  # noqa: BLE001 - every failure becomes our message
            if proc.process is None:
                raise _Failed(f"Couldn't start {command}: {getattr(e, 'strerror', None) or 'error'}.") from e
            if proc.exited:
                tail = _stderr_tail(errlog)
                message = "The server stopped before it answered."
                raise _Failed(f"{message}\n{tail}" if tail else message) from e
            raise _Failed(_generic(_leaves(e))) from e


def _hooked_client(headers: dict[str, str], statuses: list[int], **kw: Any) -> Any:
    from mcp.shared._httpx_utils import create_mcp_http_client

    client = create_mcp_http_client(headers=headers, **kw)

    async def note(response: Any) -> None:
        statuses.append(response.status_code)

    client.event_hooks["response"].append(note)
    return client


async def _probe_url(entry: dict[str, Any], env: Mapping[str, str],
                     timeout: float) -> tuple[tuple[tuple[str, str], ...], tuple[str, ...]]:
    import anyio

    url = str(expand_refs(entry.get("url") or "", env))
    headers = {str(k): str(v) for k, v in expand_refs(dict(entry.get("headers") or {}), env).items()}
    statuses: list[int] = []
    try:
        with anyio.fail_after(timeout):
            async with contextlib.AsyncExitStack() as stack:
                if entry.get("type") == "sse":
                    from mcp.client.sse import sse_client

                    def factory(headers: dict[str, str] | None = None, timeout: Any = None, auth: Any = None) -> Any:
                        return _hooked_client(headers or {}, statuses, timeout=timeout, auth=auth)

                    streams = await stack.enter_async_context(
                        sse_client(url, headers=headers, httpx_client_factory=factory))
                else:
                    from mcp.client.streamable_http import streamable_http_client

                    http = await stack.enter_async_context(_hooked_client(headers, statuses))
                    streams = await stack.enter_async_context(streamable_http_client(url, http_client=http))
                return await _list(streams[0], streams[1])
    except TimeoutError as e:
        raise _Failed(_timeout_message(timeout)) from e
    except Exception as e:  # noqa: BLE001 - every failure becomes our message
        message = _http_failure(e, url, statuses)
        raise _Failed(message or _timeout_message(timeout)) from e


def _effective(timeout: float) -> float:
    """The module's `PROBE_TIMEOUT_S` (read now, so a test can patch it) when `timeout` is the default."""
    return PROBE_TIMEOUT_S if timeout == mcpmodel.PROBE_TIMEOUT_S else timeout


def _now() -> str:
    moment = datetime.now(timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


async def probe(
    entry: dict[str, Any],
    env: dict[str, str],
    *,
    cwd: Path | None = None,
    timeout: float = PROBE_TIMEOUT_S,
    redact_values: Iterable[str] = (),
) -> ProbeResult:
    """List the tools of the server `entry` (a `mcpstore.cli_entry` / ``.mcp.json`` shape).

    `env` fills the entry's ``${VAR}`` references; `cwd` is a stdio server's folder. Never
    raises: a failure is ``ok=False`` with our message, every value of `redact_values` and of `env`
    masked.
    """
    from .secretstore import redact

    timeout = _effective(timeout)
    # The values the entry's references are filled from are secrets too (gateway values, folder vars).
    secrets = [v for v in (*redact_values, *env.values()) if isinstance(v, str)]
    started = time.monotonic()
    tools: tuple[tuple[str, str], ...] = ()
    read_only: tuple[str, ...] = ()
    error: str | None = None
    try:
        kind = entry.get("type") or ("stdio" if entry.get("command") else None)
        if kind in ("http", "sse"):
            tools, read_only = await _probe_url(entry, env, timeout)
        elif kind == "stdio" or entry.get("command"):
            tools, read_only = await _probe_stdio(entry, env, cwd, timeout)
        else:
            error = "This server has no command or URL."
    except _Failed as e:
        error = e.message
    except Exception as e:  # noqa: BLE001 - a probe never raises
        error = f"Couldn't list the tools ({type(e).__name__})."
    elapsed = max(1, int((time.monotonic() - started) * 1000))
    if error is not None:
        return ProbeResult(False, (), redact(error, secrets), elapsed, _now())
    return ProbeResult(True, tools, None, elapsed, _now(), read_only)


def _run(coro: Any) -> Any:
    if sys.platform == "win32":
        # The proactor loop runs subprocesses (the default; explicit for threads).
        with asyncio.Runner(loop_factory=asyncio.ProactorEventLoop) as runner:  # type: ignore[attr-defined]
            return runner.run(coro)
    return asyncio.run(coro)


def probe_sync(entry: dict[str, Any], env: dict[str, str], **kw: Any) -> ProbeResult:
    """`probe` in a fresh event loop (route threads)."""
    return _run(probe(entry, env, **kw))


def probe_many(
    targets: dict[str, tuple[dict[str, Any], dict[str, str], Path | None]],
    *,
    timeout: float = PROBE_TIMEOUT_S,
    redact_values: Iterable[str] = (),
) -> dict[str, ProbeResult]:
    """Every target probed in parallel, by cache key."""
    if not targets:
        return {}
    secrets = list(redact_values)
    timeout = _effective(timeout)

    async def all_of() -> dict[str, ProbeResult]:
        keys = list(targets)
        results = await asyncio.gather(*(
            probe(targets[k][0], targets[k][1], cwd=targets[k][2], timeout=timeout, redact_values=secrets)
            for k in keys
        ))
        return dict(zip(keys, results, strict=True))

    return _run(all_of())
