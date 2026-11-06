"""The agent's tools (M17, spec section 4): the Tools tab's groups and a run's allow and deny lists.

Every tool is on by default and switchable per agent, except the shell (Bash, PowerShell),
which is off by default. An agent stores its switched-**off** ids (``agent.json`` ``toolsOff``),
so a tool added later shows switched on. A group's switch writes each member's id; group ids
are never stored.

Ids: Object's tools are ``mcp__object__<name>``, the agent tools ``mcp__object-agent__<name>``,
the built-ins their row id (``Bash``, ``Read``...; one row may switch several CLI names), and a
folder ``.mcp.json`` server ``mcp__<server>``.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from .agentmodel import SHELL_WARNING

if TYPE_CHECKING:  # agents imports this module
    from .agents import AgentRecord

__all__ = [
    "AGENT_SERVER",
    "AGENT_TOOLS",
    "AGENT_TOOL_LABELS",
    "ALWAYS_ALLOWED",
    "BUILTINS",
    "GROUP_LABELS",
    "GROUP_PROVIDERS",
    "OBJECT_READ",
    "OBJECT_SERVER",
    "OBJECT_WRITE",
    "ToolEntry",
    "ToolGroup",
    "ToolLists",
    "catalogue",
    "default_off",
    "groups_out",
    "run_tool_lists",
]

OBJECT_SERVER = "object"
AGENT_SERVER = "object-agent"

OBJECT_READ: tuple[str, ...] = (
    # M11
    "schema", "search", "query", "run_saved_query", "peek", "read", "backlinks", "daily_note",
    "changes_since",
    # M17
    "type_definition", "collection", "saved_query", "read_whiteboard", "version_history",
    "read_version", "unlinked_mentions", "trash", "automations", "import_preview", "import_status",
)
"""The read tools of ``objectapp-mcp`` (short names). M22 appends 2."""

OBJECT_WRITE: tuple[str, ...] = (
    # M11
    "create_object", "create_task", "set_properties", "add_tags", "add_to_collection",
    "append_to_section", "replace_section", "rename", "move_to_trash",
    # M17
    "write_body", "remove_tags", "remove_from_collection", "open_daily_note", "duplicate",
    "change_type", "merge", "link_mention", "create_tag",
    "create_type", "edit_type", "change_property_kind", "delete_type",
    "create_collection", "edit_collection", "delete_collection",
    "create_query", "edit_query", "delete_query",
    "create_whiteboard", "edit_whiteboard",
    "create_automation", "run_automation", "start_import",
    "restore_from_trash", "restore_version",
)
"""The write tools of ``objectapp-mcp`` (short names). M22 appends 6."""

AGENT_TOOLS: tuple[str, ...] = (
    "agent_info",
    # M18
    "memory", "skills_list", "skill_view", "skill_manage", "session_search",
)
"""The ``object-agent`` server's tools. M18, M20, M21 and M24 append names here, in build order."""

AGENT_TOOL_LABELS: dict[str, str] = {
    # M18 (our strings)
    "memory": "Memory",
    "skills_list": "List skills",
    "skill_view": "Read skills",
    "skill_manage": "Change skills",
    "session_search": "Search chats",
}
"""Row labels for agent tools whose `_label` form doesn't read well; the others use `_label`."""


@dataclass(frozen=True)
class ToolEntry:
    id: str
    """Stored in ``toolsOff``: ``mcp__object__read``, ``Read``, ``Bash``."""
    label: str
    cli: tuple[str, ...]
    """The CLI names this row switches."""
    default_on: bool = True
    warning: str | None = None


@dataclass(frozen=True)
class ToolGroup:
    id: str
    label: str
    tools: tuple[ToolEntry, ...]


BUILTINS: tuple[ToolEntry, ...] = (
    ToolEntry("Bash", "Shell (Bash, PowerShell)", ("Bash", "PowerShell"), default_on=False, warning=SHELL_WARNING),
    ToolEntry("Read", "Read files", ("Read",)),
    ToolEntry("Write", "Write files", ("Write",)),
    ToolEntry("Edit", "Edit files", ("Edit", "MultiEdit")),
    ToolEntry("Glob", "Find files", ("Glob",)),
    ToolEntry("Grep", "Search in files", ("Grep",)),
    ToolEntry("WebSearch", "Web search", ("WebSearch",)),
    ToolEntry("WebFetch", "Web fetch", ("WebFetch",)),
    ToolEntry("Task", "Subagents", ("Task", "Agent")),
    ToolEntry("NotebookEdit", "Notebook edit", ("NotebookEdit",)),
    ToolEntry("TodoWrite", "To-do list", ("TodoWrite", "TaskCreate", "TaskGet", "TaskList", "TaskUpdate")),
)
"""The cli tuples are checked by the T1 spike against the init event's tool list
(``docs/superpowers/plans/m17-cli-spike.md``). CLI 2.1.317 offers no ``TodoWrite``; its to-do
list is ``TaskCreate``/``TaskGet``/``TaskList``/``TaskUpdate``, and only in some runs."""

ALWAYS_ALLOWED: tuple[str, ...] = ("Skill",)
"""Allowed in every run; not a switch."""

GROUP_LABELS = {
    "object-read": "Object read",
    "object-write": "Object write",
    "object-agent": "Object agent tools",
    "builtin": "Claude Code built-ins",
}

GROUP_PROVIDERS: list[Callable[[AgentRecord], list[ToolGroup]]] = []
"""More groups for an agent's Tools tab (M19 appends its gateway groups)."""


def _label(short: str) -> str:
    """``run_saved_query`` -> ``Run saved query`` (our labels for Object's tools)."""
    text = short.replace("_", " ")
    return text[:1].upper() + text[1:]


def _mcp(server: str, tool: str) -> str:
    return f"mcp__{server}__{tool}"


def _server_entries(server: str, names: Iterable[str]) -> tuple[ToolEntry, ...]:
    labels = AGENT_TOOL_LABELS if server == AGENT_SERVER else {}
    return tuple(ToolEntry(_mcp(server, n), labels.get(n) or _label(n), (_mcp(server, n),)) for n in names)


def catalogue(folder_servers: Iterable[str] = ()) -> list[ToolGroup]:
    """The four groups, then one ``mcp:<name>`` group per folder ``.mcp.json`` server."""
    groups = [
        ToolGroup("object-read", GROUP_LABELS["object-read"], _server_entries(OBJECT_SERVER, OBJECT_READ)),
        ToolGroup("object-write", GROUP_LABELS["object-write"], _server_entries(OBJECT_SERVER, OBJECT_WRITE)),
        ToolGroup("object-agent", GROUP_LABELS["object-agent"], _server_entries(AGENT_SERVER, AGENT_TOOLS)),
        ToolGroup("builtin", GROUP_LABELS["builtin"], BUILTINS),
    ]
    for name in folder_servers:
        entry = ToolEntry(f"mcp__{name}", name, (f"mcp__{name}",))
        groups.append(ToolGroup(f"mcp:{name}", name, (entry,)))
    return groups


def default_off() -> list[str]:
    """The ids a new agent starts with switched off: ``["Bash"]``."""
    return [t.id for t in BUILTINS if not t.default_on]


def groups_out(groups: list[ToolGroup], off: Iterable[str]) -> list[dict[str, Any]]:
    """The API's ``ToolGroup`` shape with each row's state."""
    off_set = set(off)
    return [
        {
            "id": g.id,
            "label": g.label,
            "tools": [
                {"id": t.id, "label": t.label, "on": t.id not in off_set, "warning": t.warning}
                for t in g.tools
            ],
        }
        for g in groups
    ]


@dataclass
class ToolLists:
    allowed: list[str]
    """``--allowedTools``"""
    disallowed: list[str]
    """``--disallowedTools`` (bare names, no paths)"""


def _add(out: list[str], names: Iterable[str]) -> None:
    for n in names:
        if n not in out:
            out.append(n)


def run_tool_lists(off: Iterable[str], *, write: bool, folder_servers: Iterable[str]) -> ToolLists:
    """A run's allow and deny lists from the agent's switched-off ids.

    allowed: the on built-ins' CLI names, `ALWAYS_ALLOWED`, each on Object read tool (and write
    tool when `write`), each on agent tool, and each on folder server. disallowed: the off
    built-ins' CLI names, the off Object, agent and folder-server names, and every Object write
    tool when not `write`.
    """
    off_set = set(off)
    allowed: list[str] = []
    disallowed: list[str] = []
    for entry in BUILTINS:
        _add(disallowed if entry.id in off_set else allowed, entry.cli)
    _add(allowed, ALWAYS_ALLOWED)
    for name in OBJECT_READ:
        tool = _mcp(OBJECT_SERVER, name)
        _add(disallowed if tool in off_set else allowed, [tool])
    for name in OBJECT_WRITE:
        tool = _mcp(OBJECT_SERVER, name)
        _add(allowed if write and tool not in off_set else disallowed, [tool])
    for name in AGENT_TOOLS:
        tool = _mcp(AGENT_SERVER, name)
        _add(disallowed if tool in off_set else allowed, [tool])
    for server in folder_servers:
        tool = f"mcp__{server}"
        _add(disallowed if tool in off_set else allowed, [tool])
    return ToolLists(allowed=allowed, disallowed=disallowed)
