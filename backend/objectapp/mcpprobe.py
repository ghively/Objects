"""Listing an outside MCP server's tools (M19): the one M19 module that opens a connection.

Only on Gene's "Test" or the Tools tab, only to the servers he added (or an agent folder's
servers). Uses the ``mcp`` client library: ``mcp.client.stdio.stdio_client``,
``mcp.client.streamable_http.streamable_http_client`` (headers through
``mcp.shared._httpx_utils.create_mcp_http_client``), ``mcp.client.sse.sse_client``, then
``ClientSession.initialize()`` and ``list_tools()`` following pagination. Errors are our
strings, redacted with `secretstore.redact`; on timeout or failure the stdio process tree is
killed. Writes nothing (the stderr temp file is removed).

T1 stub: the plan's Task 4 fills it.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .mcpmodel import PROBE_TIMEOUT_S

__all__ = ["ProbeResult", "expand_refs", "probe", "probe_many", "probe_sync"]


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


async def probe(
    entry: dict[str, Any],
    env: dict[str, str],
    *,
    cwd: Path | None = None,
    timeout: float = PROBE_TIMEOUT_S,
    redact_values: Iterable[str] = (),
) -> ProbeResult:
    raise NotImplementedError


def probe_sync(entry: dict[str, Any], env: dict[str, str], **kw: Any) -> ProbeResult:
    """`probe` in a fresh event loop (route threads)."""
    raise NotImplementedError


def probe_many(
    targets: dict[str, tuple[dict[str, Any], dict[str, str], Path | None]],
    *,
    timeout: float = PROBE_TIMEOUT_S,
    redact_values: Iterable[str] = (),
) -> dict[str, ProbeResult]:
    """Every target probed in parallel, by cache key."""
    raise NotImplementedError


def expand_refs(value: Any, env: Mapping[str, str]) -> Any:
    """``${VAR}`` and ``${VAR:-default}``, the CLI's rule, recursively (dict keys left alone).

    The T1 spike (``docs/superpowers/plans/m19-cli-spike.md``) records what the CLI does with an
    unset ``${VAR}``.
    """
    raise NotImplementedError
