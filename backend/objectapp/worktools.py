"""The work purposes, the read-only tool lists and the two guards (M24 T4).

T1 ships the constants, the signatures and an idempotent `install` that registers the guards (and
the contributors, which do nothing yet); T4 fills them.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from pathlib import Path
from typing import TYPE_CHECKING, Any

from . import agentfiles, api_v1_work, mcpgateway, toolcatalog, v1guard
from .agentrun import RunParts, RunScope, add_contributor
from .mcpstore import McpStore
from .workprompts import DESK_SYNC_GUIDANCE, WORK_GUIDANCE

if TYPE_CHECKING:
    from fastapi import Request

    from .tokens import TokenRecord
    from .workloop import WorkLoop
    from .workservice import WorkService

__all__ = [
    "EXTRA_AGENT_TOOLS",
    "READ_ONLY_PURPOSES",
    "READ_ONLY_WRITE_ROUTES",
    "STEP_WRITE_ROUTES",
    "WORK",
    "WORK_FILE",
    "WORK_PURPOSES",
    "WORK_READ",
    "WORK_SYNC",
    "install",
    "read_only_write_guard",
    "read_run_tools",
    "step_guard",
    "work_guidance_contributor",
    "work_tools_contributor",
]

WORK = "work"
WORK_READ = "work-read"
WORK_FILE = "work-file"
WORK_SYNC = "work-sync"
WORK_PURPOSES = frozenset({WORK, WORK_READ, WORK_FILE, WORK_SYNC})
READ_ONLY_PURPOSES = frozenset({WORK_READ, WORK_FILE, WORK_SYNC})
EXTRA_AGENT_TOOLS = {WORK_READ: (), WORK_FILE: ("file_capture",), WORK_SYNC: ("sync_ticket_fields",)}
STEP_WRITE_ROUTES = ("/api/v1/work/step", "/api/v1/work/steps", "/api/v1/work/activity", "/api/v1/work/note")
READ_ONLY_WRITE_ROUTES = {
    WORK_READ: STEP_WRITE_ROUTES,
    WORK_FILE: STEP_WRITE_ROUTES + ("/api/v1/agent/work/file-capture",),
    WORK_SYNC: STEP_WRITE_ROUTES + ("/api/v1/agent/work/ticket-fields",),
}

_loop: WorkLoop | None = None

LEFT_OUT_NOTE = (
    "Left out {name} in a read-only run: list its tools on the Work agent's Tools tab and mark the "
    "read ones in Settings > Work."
)  # our string
READ_ONLY_REFUSED = "This run is read-only."  # our string
APPROVE_REPORT_REFUSED = "Only the run for this approved step can report it."  # our string
_OWN_SERVERS = (toolcatalog.OBJECT_SERVER, toolcatalog.AGENT_SERVER)


def _obj(tool: str) -> str:
    return f"mcp__{toolcatalog.OBJECT_SERVER}__{tool}"


def _agent_tool(tool: str) -> str:
    return f"mcp__{toolcatalog.AGENT_SERVER}__{tool}"


def read_run_tools(purpose: str, tools_off: Iterable[str], marked: Iterable[str],
                   servers: Mapping[str, dict[str, Any]],
                   listed: Callable[[str], tuple[str, ...] | None]) -> tuple[list[str], list[str], list[str]]:
    """(allowed, disallowed, dropped server names) of a read-only run (Contract, "Purposes and tools").

    Object's read tools, the step and Activity write tools, web fetch, the skill tool, the
    purpose's extra agent tool and each marked MCP tool whose server is listed and has it; the
    shell, the file tools, subagents and every other write are disallowed by name (a disallowed
    name beats an allow rule in the agent folder's own settings)."""
    off = set(tools_off)
    marked_set = set(marked)
    allowed: list[str] = []
    disallowed: list[str] = []

    def add(into: list[str], name: str) -> None:
        if name not in into:
            into.append(name)

    def put(name: str, on: bool) -> None:
        add(allowed if on and name not in off else disallowed, name)

    for tool in (*toolcatalog.OBJECT_READ, *toolcatalog.WORK_STEP_TOOLS):
        put(_obj(tool), True)
    for entry in toolcatalog.BUILTINS:
        for cli in entry.cli:
            put(cli, cli == "WebFetch" and entry.id not in off)
    for name in toolcatalog.ALWAYS_ALLOWED:
        add(allowed, name)
    extra = EXTRA_AGENT_TOOLS.get(purpose, ())
    for tool in extra:
        put(_agent_tool(tool), True)
    for tool in toolcatalog.OBJECT_WRITE:
        if tool not in toolcatalog.WORK_STEP_TOOLS:
            add(disallowed, _obj(tool))
    for tool in toolcatalog.AGENT_TOOLS:
        if _agent_tool(tool) not in allowed:
            add(disallowed, _agent_tool(tool))
    dropped: list[str] = []
    for name in servers:
        if name in _OWN_SERVERS:
            continue
        tools = listed(name)
        keep: list[str] = []
        for tool in tools or ():
            tid = mcpgateway.tool_id(name, tool)
            if tid in marked_set and tid not in off and f"mcp__{name}" not in off:
                keep.append(tid)
            else:
                add(disallowed, tid)
        if tools is None or not keep:
            dropped.append(name)
            add(disallowed, f"mcp__{name}")
            continue
        for tid in keep:
            add(allowed, tid)
    # Nothing allowed may be disallowed, and the bare server names never appear in `allowed`.
    return allowed, [d for d in disallowed if d not in allowed], dropped


def _settings() -> dict[str, Any]:
    if _loop is not None:
        return _loop.read_settings()
    from . import settings as device_settings

    return device_settings.read()[0]


def work_guidance_contributor(scope: RunScope, parts: RunParts) -> None:
    """Order 57 ``work-guidance``: the work runs' guidance after M17's."""
    if scope.purpose not in WORK_PURPOSES:
        return
    user = str(_settings().get("activityName") or "Gene")
    parts.append_prompt.append(WORK_GUIDANCE.format(user=user))
    if scope.purpose == WORK_SYNC:
        parts.append_prompt.append(DESK_SYNC_GUIDANCE)


def _server_keys(scope: RunScope) -> dict[str, str]:
    """Server name -> its TOOL_CACHE key (the agent's folder wins a name clash)."""
    keys: dict[str, str] = {}
    try:
        for rec in McpStore(scope.state).list():
            name = rec.data.get("name")
            if isinstance(name, str):
                keys[name] = mcpgateway.gateway_key(rec)
    except Exception:  # noqa: BLE001, S110 - an unreadable store lists nothing: every server is dropped
        pass
    for name, server in agentfiles.folder_mcp_servers(Path(scope.agent.folder)).items():
        keys[name] = mcpgateway.folder_key(scope.agent.id, name, server)
    return keys


def work_tools_contributor(scope: RunScope, parts: RunParts) -> None:
    """Order 66 ``work-tools``: narrow a read-only run's lists. Purpose ``work`` is left as built."""
    if scope.purpose not in READ_ONLY_PURPOSES:
        return
    keys = _server_keys(scope)

    def listed(name: str) -> tuple[str, ...] | None:
        key = keys.get(name)
        result = mcpgateway.TOOL_CACHE.get(key) if key else None
        if result is None or not result.ok:
            return None
        return tuple(tool for tool, _desc in result.tools)

    off = scope.agent.data.get("toolsOff") if isinstance(scope.agent.data, dict) else None
    marked = _settings().get("workReadTools") or []
    allowed, disallowed, dropped = read_run_tools(
        scope.purpose, [t for t in (off or []) if isinstance(t, str)], marked, parts.mcp_servers, listed
    )
    parts.allowed[:] = allowed
    for name in disallowed:
        if name not in parts.disallowed:
            parts.disallowed.append(name)
    parts.disallowed[:] = [d for d in parts.disallowed if d not in allowed]
    for name in dropped:
        parts.mcp_servers.pop(name, None)
        parts.notes.append(LEFT_OUT_NOTE.format(name=name))


def _write_method(request: Request) -> bool:
    return request.method.upper() not in ("GET", "HEAD", "OPTIONS")


def read_only_write_guard(record: TokenRecord, request: Request) -> str | None:
    """A `v1guard.WRITE_GUARDS` entry: a read-only run's token writes only its purpose's routes."""
    if record.purpose not in READ_ONLY_PURPOSES or not _write_method(request):
        return None
    path = request.url.path.rstrip("/")
    return None if path in READ_ONLY_WRITE_ROUTES[record.purpose] else READ_ONLY_REFUSED


def step_guard(record: TokenRecord, path: str, step_id: str, action: str) -> str | None:
    """`api_v1_work.STEP_GUARD`: only the run for an approved step may report an Approve step."""
    if action not in ("complete", "fail"):
        return None
    if record.purpose not in WORK_PURPOSES:
        return None
    try:
        item = _loop.service.item(path) if _loop is not None else None
    except Exception:  # noqa: BLE001 - the service answers its own error for a bad path
        return None
    step = next((s for s in (item or {}).get("steps", []) if s.get("id") == step_id), None)
    if step is None and item is not None:
        return None
    if step is not None and step.get("kind") != "approve":
        return None
    if record.purpose in READ_ONLY_PURPOSES:
        return APPROVE_REPORT_REFUSED
    entry = _loop.running_for_chat(record.chat) if _loop is not None else None
    if entry and entry.get("path") == path and entry.get("stepId") == step_id:
        return None
    return APPROVE_REPORT_REFUSED


def install(loop: WorkLoop, service: WorkService) -> None:
    """Both contributors and both guards; idempotent."""
    global _loop
    _loop = loop
    add_contributor("work-guidance", 57, work_guidance_contributor)
    add_contributor("work-tools", 66, work_tools_contributor)
    if read_only_write_guard not in v1guard.WRITE_GUARDS:
        v1guard.WRITE_GUARDS.append(read_only_write_guard)
    api_v1_work.STEP_GUARD = step_guard
