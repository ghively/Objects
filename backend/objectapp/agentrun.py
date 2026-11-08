"""The turn runner (M17, spec section 3): one ``claude -p`` command from an agent and its contributors.

A turn runs inside the agent's folder, loading only that folder's settings
(``--setting-sources project,local``). Everything Object adds to a run (its MCP servers, the
guidance appended to the system prompt, the tool switches, the fence's path deny rules) comes
from an ordered list of **contributors**: functions that fill one `RunParts`. This is the
extension point later milestones plug into (memory, outside servers, delegation, schedules,
work); each registers its own order (the plan's registry of contributor orders).

`build_run` runs the contributors and writes the run's files into a new temp folder outside
every space and agent folder (``mcp.json``, ``run-settings.json``, ``append.md``); the caller
removes that folder after the run (``mkdtemp``: readable by the user only). The run's file tools
are fenced off that folder, and a run removes such folders left behind more than a day ago (when
Object stopped mid-run). Secrets never go into
the CLI's own environment, since the CLI hands its whole environment to every stdio MCP server:
each server gets only its own secrets, filled into its own entry in ``mcp.json`` (`fill_refs`).
The turn's token is in the ``env`` blocks of Object's two servers (``object``, ``object-agent``)
only (audit 7). Every other stdio server's ``env`` sets the sign-in names (`SERVER_ENV_BLANK`)
empty, unless its own config sets them, so it doesn't inherit how the user signs in.

The fence: every run denies the file tools on every registered space folder, every other
agent's folder and the agent trash (``Read(...)`` covers Read, Glob and Grep; ``Edit(...)``
covers Edit, Write and NotebookEdit, as the CLI documents and the T1 spike checked), plus the
agent's own protected files, the state dir's own files and Gene's Claude Code files. The rules
go into the run's ``--settings`` file, so a folder's own settings can't lift them, and a path
with commas or spaces needs no quoting.

(spike, adopted by Gene 2026-11-06) Every run's settings switch auto-memory off and name, in
``claudeMdExcludes``, the user ``CLAUDE.md`` and every ancestor folder's instruction files, since
``--setting-sources`` alone lets them through on CLI 2.1.317. The working folder is the agent
folder's resolved (long) path, and the run's environment drops the variables a parent Claude
Code session sets (`RUN_ENV_DROP`) but keeps how the user signs in to Claude Code
(``CLAUDE_CONFIG_DIR``, `RUN_ENV_KEEP`; audit 20). A ``CLAUDE_CONFIG_DIR``'s ``CLAUDE.md`` and
rules are excluded and its files fenced, as ``~/.claude``'s are.

No network client here: this module only builds a command and writes temp files.
"""

from __future__ import annotations

import os
import re
import shutil
import sys
import tempfile
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

from . import toolcatalog
from .agentmodel import AGENTS_DIR, PROTECTED, SELF_LOADED, TRASH_DIR
from .jsonstore import dump_json

if TYPE_CHECKING:  # agents (T2) imports toolcatalog; this module only needs the type
    from .agents import AgentRecord

__all__ = [
    "CLI_FLAGS",
    "NESTED_AGENT",
    "NESTED_AGENTS_DIR",
    "NESTED_MESSAGE",
    "NESTED_TRASH",
    "OBJECT_GUIDANCE",
    "PROPOSAL_GUIDANCE",
    "RUN_ENV_DROP",
    "RUN_ENV_KEEP",
    "RUN_SETTINGS_BASE",
    "SECRET_LOOKUP",
    "Contributor",
    "RunCommand",
    "RunParts",
    "RunRefused",
    "RunScope",
    "add_contributor",
    "build_run",
    "claude_md_excludes",
    "contributors",
    "fence_folders",
    "fence_rules",
    "fill_refs",
    "nesting_problem",
    "rule_path",
    "run_base_env",
]

CLI_FLAGS = (
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--setting-sources",
    "project,local",
    "--no-chrome",
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--strict-mcp-config",
    "--tools",
    "default",
)
"""Every fixed flag of an agent run (checked against ``claude --help`` of 2.1.317)."""

RUN_SETTINGS_BASE: dict[str, Any] = {"autoMemoryEnabled": False}
"""In every ``run-settings.json`` (spike)."""

RUN_ENV_DROP: tuple[str, ...] = (
    "CLAUDECODE",
    "CLAUDE_CODE_",
    "CLAUDE_AGENT_SDK_",
    "CLAUDE_PLUGIN_ROOT",
    "CLAUDE_EFFORT",
    "CLAUDE_PID",
    "CLAUDE_PREVIEW_",
    "AI_AGENT",
)
"""Names or name prefixes dropped from a run's environment (spike): what a parent Claude Code
session sets, so Object started from a Claude Code terminal runs agents as it would on its own."""

RUN_ENV_KEEP: tuple[str, ...] = (
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_SKIP_BEDROCK_AUTH",
    "CLAUDE_CODE_SKIP_VERTEX_AUTH",
    "CLAUDE_CODE_SKIP_FOUNDRY_AUTH",
)
"""Names `RUN_ENV_DROP`'s prefixes would drop that say how the user signs in (audit 20)."""

SERVER_ENV_BLANK: tuple[str, ...] = (*RUN_ENV_KEEP, "ANTHROPIC_API_KEY")
"""Set empty in every outside stdio MCP server's ``env`` (unless its config sets the name): the
CLI hands its whole environment, with how the user signs in, to each stdio server it starts."""


def run_base_env() -> dict[str, str]:
    """This process's environment as every ``claude`` run gets it (a turn, and ``--version`` in
    `ai.status`): minus `RUN_ENV_DROP` (but `RUN_ENV_KEEP`) and minus ``OBJECT_API_TOKEN``."""
    return {
        k: v for k, v in os.environ.items()
        if (k.upper() in RUN_ENV_KEEP or not k.upper().startswith(RUN_ENV_DROP)) and k != "OBJECT_API_TOKEN"
    }


def _claude_config_dir() -> Path | None:
    """The user's ``CLAUDE_CONFIG_DIR`` (resolved), when set: their Claude Code files live there."""
    value = os.environ.get("CLAUDE_CONFIG_DIR", "").strip()
    if not value:
        return None
    try:
        return Path(os.path.expanduser(value)).resolve()
    except (OSError, ValueError):
        return None

NESTED_MESSAGE = "An agent folder can't be inside a space folder or hold one."
NESTED_AGENT = "An agent folder can't be inside another agent's folder or hold one."  # our string
NESTED_TRASH = "An agent folder can't be inside the agent trash."  # our string
NESTED_AGENTS_DIR = "An agent folder can't be the folder that holds Object's agents."  # our string

OBJECT_GUIDANCE = (
    "You are {agent}, an agent inside Object, the user's local Markdown notes app. "
    "Object's tools are the only way to read or change the notes in the space \"{space}\". "
    "The space's folder and other agents' folders are closed to the file tools. "
    "Pages excluded from AI and templates are hidden from you and must stay hidden. "
    "Every write needs the version from your last read; on a conflict, read again, then retry. "
    "move_to_trash can be undone, and nothing deletes for good. "
    "Your CLAUDE.md, .claude/ and .object-agent/ can't be edited with the file tools."
)  # our string
PROPOSAL_GUIDANCE = (
    OBJECT_GUIDANCE + " You can't change any note: the user applies what you suggest."
)  # our string, ending with M10's sentence

_SERVER_NAME = re.compile(r"[A-Za-z0-9_-]{1,64}")
_RESERVED_SERVERS = (toolcatalog.OBJECT_SERVER, toolcatalog.AGENT_SERVER)


class RunRefused(Exception):
    """The run can't start (an agent folder nested in, or holding, a fenced folder)."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


@dataclass(frozen=True)
class RunScope:
    agent: AgentRecord
    space_root: Path
    space_name: str
    api_url: str
    token: str
    """The ephemeral token's secret (goes in env only)."""
    write: bool
    """False for proposal modes (and M18 reviews' read-only parts)."""
    chat_id: str
    purpose: str
    """``"chat"`` | ``"proposal"``; M18 ``"review"`` / ``"curator"``, M20 ``"delegate"``, M21
    ``"schedule"``, M24 ``"work"`` / ``"work-read"`` / ``"work-file"`` / ``"work-sync"``."""
    state: Path
    """``appstate.state_dir()``"""


@dataclass
class RunParts:
    append_prompt: list[str] = field(default_factory=list)
    """Joined with blank lines into ``append.md`` (``--append-system-prompt-file``)."""
    mcp_servers: dict[str, dict[str, Any]] = field(default_factory=dict)
    allowed: list[str] = field(default_factory=list)
    disallowed: list[str] = field(default_factory=list)
    deny_rules: list[str] = field(default_factory=list)
    """Path-scoped rules -> ``run-settings.json`` ``permissions.deny``."""
    settings: dict[str, Any] = field(default_factory=dict)
    """Merged into ``run-settings.json``."""
    env: dict[str, str] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)
    """Skipped folder servers etc. (logged, shown on the Profile tab)."""


Contributor = Callable[[RunScope, RunParts], None]

_contributors: dict[str, tuple[int, Contributor]] = {}


def add_contributor(name: str, order: int, fn: Contributor) -> None:
    """Register `fn` at `order`; replaces a contributor of the same name."""
    _contributors[name] = (order, fn)


def contributors() -> list[tuple[int, str, Contributor]]:
    """Every contributor, sorted by order, then name."""
    return sorted(((o, n, fn) for n, (o, fn) in _contributors.items()), key=lambda t: (t[0], t[1]))


SECRET_LOOKUP: Callable[[str], str | None] = lambda name: None  # noqa: E731 - M19 replaces it

_REF = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}")


def fill_refs(value: Any, values: dict[str, str]) -> Any:
    """`value` (a server entry, or any string, list or dict in it) with each ``${VAR}`` and
    ``${VAR:-default}`` whose VAR is in `values` filled the way the CLI fills it
    (``docs/superpowers/plans/m19-cli-spike.md``: the default when VAR is empty); a reference
    to any other name is left as written. Dict keys are left alone."""
    if isinstance(value, str):
        def fill(m: re.Match[str]) -> str:
            name, default = m.group(1), m.group(2)
            if name not in values:
                return m.group(0)
            got = values[name]
            return got if got or default is None else default

        return _REF.sub(fill, value)
    if isinstance(value, list):
        return [fill_refs(v, values) for v in value]
    if isinstance(value, dict):
        return {k: fill_refs(v, values) for k, v in value.items()}
    return value
"""A ``${VAR}``'s value for a folder ``.mcp.json`` server, or None (M19 supplies secrets)."""


# -- paths and the fence -----------------------------------------------------------------------


def _key(path: Path | str) -> str:
    """A comparison key: case-insensitive where the file system is (Windows)."""
    return os.path.normcase(str(path))


def _within(child: Path, parent: Path) -> bool:
    """Whether `child` is `parent` or inside it (both resolved; case-insensitive on Windows)."""
    c = _key(child).rstrip("\\/")
    p = _key(parent).rstrip("\\/")
    return c == p or c.startswith(p + os.sep)


def _dedupe(paths: Iterable[Path]) -> list[Path]:
    out: list[Path] = []
    seen: set[str] = set()
    for p in paths:
        k = _key(p)
        if k not in seen:
            seen.add(k)
            out.append(p)
    return out


def fence_folders(scope: RunScope, spaces: list[Path], agents: list[Path]) -> list[Path]:
    """The folders a run's file tools are fenced away from, absolute, duplicates removed.

    Every registered space (`spaces`, plus the open one even when it isn't registered), every
    other local agent folder (`agents` minus the run's own) and ``<state>/agents/.trash``. Each
    folder is listed as given (made absolute) and resolved, so a space registered through a
    junction or symlink is fenced under both paths.
    """
    own = Path(scope.agent.folder).resolve()
    found: list[Path] = []
    for p in [*spaces, scope.space_root]:
        found += _both_forms(Path(p))
    for p in agents:
        if _key(Path(p).resolve()) != _key(own):
            found += _both_forms(Path(p))
    found += _both_forms(Path(scope.state) / AGENTS_DIR / TRASH_DIR)
    return _dedupe(found)


def _both_forms(p: Path) -> list[Path]:
    """`p` made absolute (links kept) and `p` resolved (links followed)."""
    given = Path(os.path.abspath(p))
    return [given, p.resolve()]


def rule_path(p: Path) -> str:
    """The CLI's absolute rule form of `p`: ``//c/Users/x/My Notes`` on Windows (drive
    lower-cased, ``/`` separators), ``//home/x`` on POSIX. `p` is used as given (callers
    resolve it); a trailing separator is dropped."""
    text = str(p).replace("\\", "/").rstrip("/")
    if len(text) > 1 and text[1] == ":":
        return "//" + text[0].lower() + text[2:]
    return "/" + (text if text.startswith("/") else "/" + text)


def fence_rules(folders: list[Path], own: Path, state: Path, home: Path) -> list[str]:
    """The run's path deny rules (``run-settings.json`` ``permissions.deny``).

    Per fenced folder ``Read(<rp>/**)`` and ``Edit(<rp>/**)``; the agent's own protected paths;
    the state dir's own files; Gene's Claude Code files. ``Read`` rules also cover Glob and Grep
    and ``Edit`` rules cover Write and NotebookEdit (CLI documentation, checked by the T1 spike),
    so this is the one place that would add other forms.
    """
    rules: list[str] = []
    for f in folders:
        rp = rule_path(Path(os.path.abspath(f)))
        rules += [f"Read({rp}/**)", f"Edit({rp}/**)"]
    o = rule_path(Path(own).resolve())
    rules += [f"Edit({o}/{p})" for p in (*PROTECTED, *SELF_LOADED)]
    s = rule_path(Path(state).resolve())
    rules += [f"Read({s}/*)", f"Edit({s}/*)", f"Read({s}/automation-logs-*/**)"]
    # Saved versions of every page (excluded ones too) and deleted spaces, at any depth. Not
    # ``{s}/**``: agent folders live under ``{s}/agents``.
    for sub in ("history", "fake-trash"):
        rules += [f"Read({s}/{sub}/**)", f"Edit({s}/{sub}/**)"]
    h = rule_path(Path(home).resolve())
    rules += [f"Read({h}/.claude/.credentials.json)", f"Edit({h}/.claude/**)", f"Edit({h}/.claude.json)"]
    out: list[str] = []
    for r in rules:
        if r not in out:
            out.append(r)
    return out


def nesting_problem(own: Path, folders: list[Path], message: str = NESTED_MESSAGE) -> str | None:
    """`message` (by default `NESTED_MESSAGE`, the space folders') when `own` is inside, or holds,
    one of `folders`; else None."""
    mine = Path(own).resolve()
    for f in folders:
        other = Path(f).resolve()
        if _within(mine, other) or _within(other, mine):
            return message
    return None


def _nesting(scope: RunScope, spaces: list[Path], agents: list[Path]) -> str | None:
    """What the run's own folder is nested in or holds, named (audit 13): a space folder, the
    agents folder itself, the agent trash, or another agent's folder; else None."""
    own = Path(scope.agent.folder).resolve()
    agents_dir = (Path(scope.state) / AGENTS_DIR).resolve()
    others = [p for p in agents if _key(Path(p).resolve()) != _key(own)]
    problem = nesting_problem(own, [*spaces, scope.space_root])
    if problem is None and _within(agents_dir, own):
        problem = NESTED_AGENTS_DIR
    return (problem or nesting_problem(own, [agents_dir / TRASH_DIR], NESTED_TRASH)
            or nesting_problem(own, others, NESTED_AGENT))


def claude_md_excludes(own: Path, home: Path) -> list[str]:
    """(spike) The ``claudeMdExcludes`` of every run: resolved, ``/``-separated absolute paths,
    duplicates removed. ``<home>/.claude/CLAUDE.md`` and ``<home>/.claude/rules/**``, then for
    every ancestor folder of `own` (not `own` itself) up to the drive root its ``CLAUDE.md``,
    ``.claude/CLAUDE.md`` and ``CLAUDE.local.md``. Never `own`'s own instruction files."""

    def form(p: Path) -> str:
        return str(p).replace("\\", "/")

    home = Path(home).resolve()
    own = Path(own).resolve()
    found = [form(home / ".claude" / "CLAUDE.md"), form(home / ".claude") + "/rules/**"]
    for a in own.parents:
        found += [form(a / "CLAUDE.md"), form(a / ".claude" / "CLAUDE.md"), form(a / "CLAUDE.local.md")]
    mine = {_key(form(own / n)) for n in ("CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md")}
    out: list[str] = []
    seen: set[str] = set()
    for f in found:
        k = _key(f)
        if k in seen or k in mine:
            continue
        seen.add(k)
        out.append(f)
    return out


# -- M17's contributors ------------------------------------------------------------------------


def _object_server(module: str, scope: RunScope, extra: list[str] | None = None) -> dict[str, Any]:
    return {
        "command": sys.executable,
        "args": ["-m", module, *(extra or [])],
        "env": {"OBJECT_API_URL": scope.api_url, "OBJECT_API_TOKEN": scope.token},
    }


def _folder_servers(folder: Path) -> dict[str, dict[str, Any]]:
    from . import agentfiles  # T2's module; imported here so this module loads on its own

    return agentfiles.folder_mcp_servers(folder)


def _folder_mcp(scope: RunScope, parts: RunParts) -> None:
    """The folder's ``.mcp.json`` servers whose ``${VAR}``s all resolve through `SECRET_LOOKUP`
    and whose names are plain and not Object's own; the others become notes."""
    from . import agentfiles

    for name, server in _folder_servers(Path(scope.agent.folder)).items():
        if not _SERVER_NAME.fullmatch(name) or name in _RESERVED_SERVERS:
            parts.notes.append(f"The MCP server \"{name}\" was left out: its name can't be used.")  # our string
            continue
        values: dict[str, str] = {}
        missing: list[str] = []
        for var in sorted(agentfiles.var_refs(server)):
            value = SECRET_LOOKUP(var)
            if value is None:
                missing.append(var)
            else:
                values[var] = value
        if missing:
            parts.notes.append(
                f"The MCP server \"{name}\" was left out: it needs {', '.join(missing)}."
            )  # our string
            continue
        parts.mcp_servers[name] = fill_refs(server, values)  # its secrets, for it alone


def _object_mcp(scope: RunScope, parts: RunParts) -> None:
    extra = [] if scope.write else ["--read-only"]
    parts.mcp_servers[toolcatalog.OBJECT_SERVER] = _object_server("objectapp.mcp_server", scope, extra)


def _agent_mcp(scope: RunScope, parts: RunParts) -> None:
    parts.mcp_servers[toolcatalog.AGENT_SERVER] = _object_server("objectapp.agent_mcp", scope)


def _guidance(scope: RunScope, parts: RunParts) -> None:
    text = PROPOSAL_GUIDANCE if scope.purpose == "proposal" else OBJECT_GUIDANCE
    name = str(scope.agent.data.get("name") or scope.agent.id)
    parts.append_prompt.append(text.format(agent=name, space=scope.space_name))


def _tools(scope: RunScope, parts: RunParts) -> None:
    off = scope.agent.data.get("toolsOff") or []
    folder = set(_folder_servers(Path(scope.agent.folder)))
    servers = [n for n in parts.mcp_servers if n in folder and n not in _RESERVED_SERVERS]
    lists = toolcatalog.run_tool_lists(off, write=scope.write, folder_servers=servers)
    for name in lists.allowed:
        if name not in parts.allowed:
            parts.allowed.append(name)
    for name in lists.disallowed:
        if name not in parts.disallowed:
            parts.disallowed.append(name)


def _local_agent_folders(state: Path) -> list[Path]:
    """Every registered local agent folder (T2's registry)."""
    from .agents import AgentRegistry

    return AgentRegistry(state).local_folders()


def closed_agent_folders(state: Path) -> list[Path]:
    """The agent folders the fence closes, for checks outside a run (an import's source):
    ``<state>/agents`` (which holds the agent trash), every local agent folder, and the trash."""
    agents = Path(state) / AGENTS_DIR
    return _dedupe([*_both_forms(agents), *_local_agent_folders(state), *_both_forms(agents / TRASH_DIR)])


def _space_folders(state: Path, current: Path) -> list[Path]:
    from .spaces import Registry

    return [Path(e.path) for e in Registry(state).list(current=current)]


def _fence(scope: RunScope, parts: RunParts) -> None:
    spaces, agents = _space_folders(scope.state, scope.space_root), _local_agent_folders(scope.state)
    folders = fence_folders(scope, spaces, agents)
    own = Path(scope.agent.folder)
    problem = _nesting(scope, spaces, agents)
    if problem:
        raise RunRefused(problem)
    cache = os.environ.get("OBJECT_CACHE_DIR")
    if cache:  # spaces' search index and frontmatter cache live here, outside the space folders
        folders = _dedupe([*folders, *_both_forms(Path(cache))])
    rules = fence_rules(folders, own, scope.state, Path.home())
    config = _claude_config_dir()
    if config is not None:  # as ~/.claude's: the login and the user's Claude Code files
        c = rule_path(config)
        rules += [f"Read({c}/.credentials.json)", f"Edit({c}/**)"]
    for rule in rules:
        if rule not in parts.deny_rules:
            parts.deny_rules.append(rule)


add_contributor("folder-mcp", 20, _folder_mcp)
add_contributor("object-mcp", 30, _object_mcp)
add_contributor("agent-mcp", 40, _agent_mcp)
add_contributor("guidance", 50, _guidance)
add_contributor("tools", 60, _tools)
add_contributor("fence", 70, _fence)


# -- the command -------------------------------------------------------------------------------


@dataclass
class RunCommand:
    args: list[str]
    cwd: Path
    env: dict[str, str]
    tmp: Path
    mcp_config: dict[str, Any]
    run_settings: dict[str, Any]
    append: str


def _extend(target: list[Any], items: Iterable[Any]) -> None:
    for item in items:
        if item not in target:
            target.append(item)


def _run_settings(own: Path, parts: RunParts) -> dict[str, Any]:
    """`RUN_SETTINGS_BASE` + the excludes and the fence, then the contributors' settings merged
    in; ``claudeMdExcludes`` and ``permissions.deny`` are extended, never replaced."""
    out: dict[str, Any] = dict(RUN_SETTINGS_BASE)
    out["claudeMdExcludes"] = claude_md_excludes(own, Path.home())
    config = _claude_config_dir()
    if config is not None:  # the user CLAUDE.md lives there instead of ~/.claude
        form = str(config).replace("\\", "/")
        _extend(out["claudeMdExcludes"], [form + "/CLAUDE.md", form + "/rules/**"])
    out["permissions"] = {"deny": list(parts.deny_rules)}
    for key, value in parts.settings.items():
        if key == "claudeMdExcludes":
            _extend(out["claudeMdExcludes"], value if isinstance(value, list) else [value])
        elif key == "permissions" and isinstance(value, dict):
            perms = out["permissions"]
            for pk, pv in value.items():
                if pk == "deny":
                    _extend(perms["deny"], pv if isinstance(pv, list) else [pv])
                else:
                    perms[pk] = pv
        else:
            out[key] = value
    return out


def _run_env(scope: RunScope, parts: RunParts) -> dict[str, str]:
    env = run_base_env()  # no OBJECT_API_TOKEN: only Object's own servers get it (their env blocks)
    env["OBJECT_API_URL"] = scope.api_url
    env.update(parts.env)
    return env


def _without_sign_in(name: str, server: Any) -> Any:
    """`server` with each `SERVER_ENV_BLANK` name its ``env`` doesn't set added as ``""``, when it
    is an outside stdio server (Object's own two get nothing; a remote one inherits no env)."""
    if name in _RESERVED_SERVERS or not isinstance(server, dict) or "command" not in server:
        return server
    if server.get("type", "stdio") != "stdio":
        return server
    raw = server.get("env")
    env = dict(raw) if isinstance(raw, dict) else {}
    have = {str(k).upper() for k in env}
    env.update({n: "" for n in SERVER_ENV_BLANK if n not in have})
    return {**server, "env": env}


RUN_TMP_PREFIX = "object-agent-run-"
_STALE_RUN_SECONDS = 86400


def _sweep_stale_run_folders() -> None:
    """Remove ``object-agent-run-*`` folders in the temp folder older than a day and owned by
    this user: a run's folder (with its servers' secrets) left behind when Object stopped mid-run.
    Only folders (not links or files) with that prefix; a failure is ignored."""
    cutoff = time.time() - _STALE_RUN_SECONDS
    uid = os.getuid() if hasattr(os, "getuid") else None
    try:
        entries = list(os.scandir(tempfile.gettempdir()))
    except OSError:
        return
    for e in entries:
        if not e.name.startswith(RUN_TMP_PREFIX):
            continue
        try:
            st = e.stat(follow_symlinks=False)
            if (not e.is_dir(follow_symlinks=False) or st.st_mtime >= cutoff
                    or (uid is not None and st.st_uid != uid)):
                continue
        except OSError:
            continue
        shutil.rmtree(e.path, ignore_errors=True)


def build_run(scope: RunScope, *, claude: str, model: str | None, resume: str | None) -> RunCommand:
    """One turn's command: the contributors' parts, written into a new temp folder.

    Raises `RunRefused` for a nesting problem (no temp folder is left behind). The caller
    removes ``tmp`` after the run.
    """
    parts = RunParts()
    for _order, _name, fn in contributors():
        fn(scope, parts)
    own = Path(scope.agent.folder).resolve()
    mcp = {"mcpServers": {n: _without_sign_in(n, s) for n, s in parts.mcp_servers.items()}}
    append = "\n\n".join(p for p in parts.append_prompt if p)
    _sweep_stale_run_folders()
    tmp = Path(tempfile.mkdtemp(prefix=RUN_TMP_PREFIX))
    try:
        # The run's own folder holds the servers' secrets (mcp.json): fenced like a space.
        for f in _both_forms(tmp):
            rp = rule_path(f)
            _extend(parts.deny_rules, [f"Read({rp}/**)", f"Edit({rp}/**)"])
        settings = _run_settings(own, parts)
        (tmp / "mcp.json").write_bytes(dump_json(mcp))
        (tmp / "run-settings.json").write_bytes(dump_json(settings))
        (tmp / "append.md").write_bytes(append.encode("utf-8"))
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    args = [
        claude,
        *CLI_FLAGS,
        "--mcp-config", str(tmp / "mcp.json"),
        "--settings", str(tmp / "run-settings.json"),
        "--append-system-prompt-file", str(tmp / "append.md"),
        "--allowedTools", ",".join(parts.allowed),
        "--disallowedTools", ",".join(parts.disallowed),
    ]
    if model:
        args += ["--model", model]
    if resume:
        args += ["--resume", resume]
    return RunCommand(
        args=args,
        cwd=own,
        env=_run_env(scope, parts),
        tmp=tmp,
        mcp_config=mcp,
        run_settings=settings,
        append=append,
    )
