"""A fake ``claude`` CLI for the M10 tests and ``scripts/m10_acceptance.py`` (no model, no network).

`install(folder)` writes a launcher (``claude`` on POSIX, ``claude.cmd`` on Windows) that
runs this script with the current Python; point the ``claudePath`` setting at it.

``--version`` prints a version line (``FAKE_CLAUDE_VERSION_FAIL=1``: fails instead).
Otherwise it reads the prompt on stdin and answers in ``--output-format stream-json``
lines the way Claude Code does: a ``system``/``init`` line with the session id, partial
``stream_event`` text deltas, the full ``assistant`` message, and a ``result``.

``FAKE_CLAUDE_LOG``: a file it appends one JSON line to per run (argv, cwd, pid, the
prompt, the MCP config it was given, the ``OBJECT_API_*`` variables, the ``--model``
value), so tests can check the flags, the working folder, the token and the model.

Steered by markers in the prompt (the user's message is part of it):

- ``FAKE:tool``: uses ``mcp__object__search`` before answering
- ``FAKE:toolerror``: like ``FAKE:tool``, but the ``tool_result`` has ``is_error`` and the
  content ``[{"type": "text", "text": "Search failed: index busy"}]`` (M16)
- ``FAKE:modelswitch``: with both ``--resume`` and ``--model`` given, answers like an
  unknown session (exit 1, nothing shown), so the app retries fresh with the history (M16)
- ``FAKE:tags`` / ``FAKE:props`` / ``FAKE:text`` / ``FAKE:badjson``: ends with a fenced block
- ``FAKE:fail``: writes to stderr and exits 1 without a result
- ``FAKE:error``: a ``result`` with ``is_error`` (exit 1)
- ``FAKE:auth``: the not-signed-in answer (``Invalid API key · Please run /login``)
- ``FAKE:sleep``: sends ``init`` and then sleeps 120 s (timeouts, cancel)
- ``FAKE:wait``: sends ``init`` and waits (up to 20 s) for the file ``<log>.go``

``--resume`` with `EXPIRED_SESSION` (or ``expired``) answers like an unknown session
(exit 1); any other ``--resume`` id is kept as the session id.

M17 (agent runs). The log line also holds ``appendPrompt`` (the text of
``--append-system-prompt-file``), ``runSettings`` (the JSON of ``--settings``, a file or inline
JSON), ``settingSources``, ``tools`` (the value of ``--tools``), ``allowed`` / ``disallowed``
(``--allowedTools`` / ``--disallowedTools`` split on commas) and ``env``
(``{"CLAUDE_CONFIG_DIR": <whether it is set>}``). The ``init`` event's ``tools`` lists the
built-in names (`BUILTIN_NAMES`) minus the disallowed ones, plus each allowed ``mcp__...``
name (without ``--allowedTools``: M10's two Object tools).

Markers that simulate a built-in tool call, one per line, the value running to the line's end:

- ``FAKE:read:<abs path>`` (Read), ``FAKE:grep:<abs folder>`` (Grep), ``FAKE:glob:<abs folder>``
  (Glob), ``FAKE:write:<abs path>`` (Write; never actually writes), ``FAKE:bash`` (Bash)

Each emits a ``tool_use`` and its ``tool_result``. The fake decides with its own matcher,
written from the CLI's documented rule form (not from Object's code): ``Tool(//abs/path/**)``
(``//`` an absolute path, ``~/`` the home folder, anything else relative to the working
folder), gitignore-style ``**`` and ``*``, deny before allow; ``Read(...)`` rules also cover
Grep and Glob and ``Edit(...)`` rules cover Write, as documented; a bare tool name denies the
tool. It checks the ``--settings`` ``permissions.deny``, ``--disallowedTools`` and the working
folder's ``.claude/settings.json`` ``permissions.deny``. Denied: ``is_error`` and "Permission to
use <Tool> has been denied."; allowed: the file's first 200 characters, the matching file
names (one per line), "wrote" or "ran".

M18 (learning). The log line also holds ``forkSession`` (``--fork-session`` given),
``noSessionPersistence`` (``--no-session-persistence`` given) and ``resume`` (the ``--resume`` id
or null). ``--resume <id> --fork-session`` answers with a new session id (the original isn't
reused). More markers and variables:

- ``FAKE:mcp:<server>:<tool>:<json args>`` (one per line, any number, run in order): starts that
  server from the run's ``--mcp-config`` (stdio: its ``command``, ``args`` and ``env``, ``${VAR}``
  filled from the fake's own environment) with the ``mcp`` client library, calls the tool and
  emits the ``tool_use`` and its ``tool_result`` (``is_error`` for a tool error). A tool that
  ``--disallowedTools`` (or the ``--settings`` deny list) names, or that ``--allowedTools`` (when
  given) doesn't, isn't called and its server isn't started: the result is "Permission to use
  <name> has been denied." Each server is started once per run.
- ``FAKE_CLAUDE_REVIEW_ACTIONS``: a JSON list of ``{"server", "tool", "args"}``. When the prompt
  holds the review prompts' first line (`REVIEW_LINE`), these calls run after the markers, as if
  they were ``FAKE:mcp`` markers. ``FAKE_CLAUDE_CURATOR_ACTIONS`` does the same for the
  consolidation prompt's first line (`CURATOR_LINE`).
- ``FAKE_CLAUDE_WORK_ACTIONS`` (M24): JSON ``{"<entry kind>": [{"server", "tool", "args"}]}``. When the
  prompt's first line is ``Work queue entry <id>: <kind>.`` (`WORK_LINE`), that kind's calls run after
  the markers, as ``FAKE:mcp`` markers do (the same allow/deny matcher), with ``{path}``, ``{stepId}``,
  ``{stepRev}`` and ``{capture}`` in string arguments filled from the prompt's ``Ref:`` line
  (``Ref: path=<path> step=<stepId or -> rev=<rev or -> capture=<path or ->``; ``-`` fills as ``""``).
- ``FAKE_CLAUDE_REVIEW_SLEEP`` (seconds): a review run (`REVIEW_LINE` in the prompt) waits that
  long before its answer. ``FAKE_CLAUDE_REVIEW_FAIL=1``: a review run writes to stderr and exits 1
  instead of answering.
- ``FAKE:skilltool:<name>``: a call of the CLI's own ``Skill`` tool with input
  ``{"skill": "<name>"}`` and its result (no MCP).

M19 (MCP gateway). ``FAKE:mcp`` also reaches ``{"type": "http"}`` and ``{"type": "sse"}`` entries:
their ``url`` and ``headers`` are filled with the same ``${VAR}`` rule, then the ``mcp`` client
library's ``streamable_http_client`` (headers through ``create_mcp_http_client``) or
``sse_client`` connects. The ``${VAR}`` rule also takes ``${VAR:-default}`` (the default when the
variable is unset or empty). The log line also holds ``mcpServers``: the server names in the
``--mcp-config`` (sorted).

M20 (A2A and delegation). More markers:

- ``FAKE:long:<n>``: the reply is ``n`` characters long (delegation's summary cap)
- ``FAKE:echo-env``: the reply names ``MCP_TOOL_TIMEOUT``'s value
  (``MCP_TOOL_TIMEOUT=<value, or unset>``)
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import uuid
from pathlib import Path

HERE = Path(__file__).resolve()
EXPIRED_SESSION = "deadbeef-0000-4000-8000-000000000000"
"""A session id (a UUID, as the app only resumes those) the fake doesn't know."""


def install(folder: Path) -> Path:
    """Write a launcher for this fake into `folder`; return its path."""
    folder.mkdir(parents=True, exist_ok=True)
    if os.name == "nt":
        path = folder / "claude.cmd"
        path.write_text(f'@"{sys.executable}" "{HERE}" %*\r\n', encoding="utf-8")
    else:
        path = folder / "claude"
        path.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{HERE}" "$@"\n', encoding="utf-8")
        path.chmod(0o755)
    return path


REVIEW_LINE = "Look back over this chat."
"""The first line of the three review prompts (M18 `reviews`)."""
CURATOR_LINE = "Tidy up your skills."
"""The first line of the consolidation prompt (M18 `curator`)."""

WORK_LINE = re.compile(r"\AWork queue entry (\S+): (\w+)\.")
"""The first line of every work queue entry prompt (M24 `workprompts.ENTRY_PROMPT_FIRST`)."""
WORK_REF = re.compile(r"^Ref: path=(.*?) step=(\S+) rev=(\S+) capture=(.*)$", re.MULTILINE)


def _work_actions(prompt: str) -> list[tuple[str, str, dict]]:
    """The calls ``FAKE_CLAUDE_WORK_ACTIONS`` lists for this work queue entry's kind (M24)."""
    raw = os.environ.get("FAKE_CLAUDE_WORK_ACTIONS")
    first = WORK_LINE.match(prompt)
    if not raw or first is None:
        return []
    try:
        table = json.loads(raw)
    except ValueError:
        return []
    actions = table.get(first.group(2)) if isinstance(table, dict) else None
    ref = WORK_REF.search(prompt)
    fill = {"path": "", "stepId": "", "stepRev": "", "capture": ""}
    if ref:
        values = [v.strip() for v in ref.groups()]
        fill = dict(zip(("path", "stepId", "stepRev", "capture"), ("" if v == "-" else v for v in values)))

    def filled(value):
        if isinstance(value, str):
            for key, text in fill.items():
                value = value.replace("{" + key + "}", text)
            return value
        if isinstance(value, dict):
            return {k: filled(v) for k, v in value.items()}
        if isinstance(value, list):
            return [filled(v) for v in value]
        return value

    out: list[tuple[str, str, dict]] = []
    for a in actions if isinstance(actions, list) else []:
        if isinstance(a, dict):
            args = a.get("args")
            out.append((str(a.get("server") or ""), str(a.get("tool") or ""),
                        filled(args) if isinstance(args, dict) else {}))
    return out


BUILTIN_NAMES = ("Bash", "PowerShell", "Read", "Write", "Edit", "Glob", "Grep", "NotebookEdit",
                 "WebFetch", "WebSearch", "Task", "TodoWrite", "Skill")
"""The built-in tools the fake's ``init`` event lists (M17)."""

_FAMILY = {"Read": ("Read",), "Grep": ("Grep", "Read"), "Glob": ("Glob", "Read"),
           "Write": ("Write", "Edit"), "Edit": ("Edit",), "Bash": ("Bash",)}
"""Which rule names govern a tool's path (the CLI's documented rule: Read rules cover the
file-reading tools, Edit rules the file-editing ones)."""

_RULE = re.compile(r"^([A-Za-z]+)(?:\((.*)\))?$", re.S)


def _split(value: str | None) -> list[str]:
    return [p.strip() for p in (value or "").split(",") if p.strip()]


def _posix(path: str) -> str:
    """An absolute path in the rules' form: ``C:\\a\\b`` -> ``/c/a/b``; POSIX paths unchanged."""
    text = path.replace("\\", "/")
    m = re.match(r"^([A-Za-z]):(/.*)?$", text)
    if m:
        text = "/" + m.group(1).lower() + (m.group(2) or "/")
    return text.rstrip("/") or "/"


def _glob_regex(pattern: str) -> re.Pattern[str]:
    out = ""
    i = 0
    while i < len(pattern):
        if pattern.startswith("/**", i) and i + 3 == len(pattern):
            out += "(?:/.*)?"
            i += 3
        elif pattern.startswith("**/", i):
            out += "(?:.*/)?"
            i += 3
        elif pattern.startswith("**", i):
            out += ".*"
            i += 2
        elif pattern[i] == "*":
            out += "[^/]*"
            i += 1
        elif pattern[i] == "?":
            out += "[^/]"
            i += 1
        else:
            out += re.escape(pattern[i])
            i += 1
    return re.compile(out + "$", re.I if os.name == "nt" else 0)


def _rule_target(spec: str) -> str:
    """A rule's path pattern as an absolute rules-form pattern."""
    if spec.startswith("//"):
        return spec[1:]
    if spec.startswith("~/"):
        return _posix(str(Path.home())) + spec[1:]
    rel = spec[2:] if spec.startswith("./") else spec.lstrip("/")
    return _posix(os.getcwd()) + "/" + rel


def _denied(tool: str, path: str | None, rules: list[str]) -> bool:
    names = _FAMILY.get(tool, (tool,))
    for rule in rules:
        m = _RULE.match(rule.strip())
        if not m:
            continue
        name, spec = m.group(1), m.group(2)
        if spec is None:
            if name == tool:
                return True
            continue
        if name not in names or path is None:
            continue
        rx = _glob_regex(_rule_target(spec))
        target = _posix(path)
        # A search in a folder is denied when the folder or a file in it is.
        if rx.match(target) or (tool in ("Grep", "Glob") and rx.match(target + "/_")):
            return True
    return False


def _json_arg(value: str | None) -> dict | None:
    if not value:
        return None
    try:
        text = value if value.lstrip().startswith("{") else Path(value).read_text(encoding="utf-8")
        data = json.loads(text)
    except (OSError, ValueError):
        return {"unreadable": value}
    return data if isinstance(data, dict) else {"unreadable": value}


def _deny_list(data: dict | None) -> list[str]:
    perms = (data or {}).get("permissions")
    deny = perms.get("deny") if isinstance(perms, dict) else None
    return [r for r in deny if isinstance(r, str)] if isinstance(deny, list) else []


def _builtin_calls(prompt: str, argv: list[str], run_settings: dict | None, session: str) -> None:
    """The ``FAKE:read:`` / ``grep:`` / ``glob:`` / ``write:`` / ``bash`` markers (M17)."""
    calls: list[tuple[str, str | None]] = []
    for line in prompt.splitlines():
        for marker, tool in (("FAKE:read:", "Read"), ("FAKE:grep:", "Grep"), ("FAKE:glob:", "Glob"),
                             ("FAKE:write:", "Write")):
            at = line.find(marker)
            if at >= 0:
                calls.append((tool, line[at + len(marker):].strip()))
        if "FAKE:bash" in line:
            calls.append(("Bash", None))
    if not calls:
        return
    try:
        local = json.loads((Path.cwd() / ".claude" / "settings.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        local = None
    rules = _deny_list(run_settings) + _split(_arg(argv, "--disallowedTools")) + _deny_list(local)
    for n, (tool, path) in enumerate(calls, start=1):
        tool_id = f"toolu_fake_{n}"
        if tool in ("Read", "Write"):
            tool_input: dict = {"file_path": path}
        elif tool == "Bash":
            tool_input = {"command": "echo hi"}
        else:
            tool_input = {"pattern": "**/*" if tool == "Glob" else ".", "path": path}
        _out(_message(f"msg_t{n}", [{"type": "tool_use", "id": tool_id, "name": tool, "input": tool_input}],
                      session))
        block: dict = {"type": "tool_result", "tool_use_id": tool_id}
        if _denied(tool, path, rules):
            block |= {"is_error": True, "content": f"Permission to use {tool} has been denied."}
        elif tool == "Read":
            try:
                block["content"] = Path(path or "").read_text(encoding="utf-8")[:200]
            except OSError as e:
                block |= {"is_error": True, "content": f"File does not exist: {e}"}
        elif tool in ("Grep", "Glob"):
            names = sorted(p.name for p in Path(path or ".").rglob("*") if p.is_file())
            block["content"] = "\n".join(names)
        elif tool == "Write":
            block["content"] = "wrote"
        else:
            block["content"] = "ran"
        _out({"type": "user", "message": {"role": "user", "content": [block]}, "session_id": session})


def _fill(value, env: dict[str, str]):
    """``${VAR}`` and ``${VAR:-default}`` filled from `env` in a string, or in each string of a list
    or dict (written from the CLI's documented form, not from Object's code)."""
    if isinstance(value, str):
        return re.sub(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}",
                      lambda m: env.get(m.group(1)) or (m.group(2) if m.group(2) is not None else ""), value)
    if isinstance(value, list):
        return [_fill(v, env) for v in value]
    if isinstance(value, dict):
        return {k: _fill(v, env) for k, v in value.items()}
    return value


def _mcp_wanted(prompt: str) -> list[tuple[str, str, dict]]:
    """The ``FAKE:mcp`` markers, then the review or curator actions the prompt asks for (M18)."""
    calls: list[tuple[str, str, dict]] = []
    for line in prompt.splitlines():
        at = line.find("FAKE:mcp:")
        if at < 0:
            continue
        server, _sep, rest = line[at + len("FAKE:mcp:"):].strip().partition(":")
        tool, _sep, raw = rest.partition(":")
        try:
            args = json.loads(raw) if raw.strip() else {}
        except ValueError:
            args = {"unreadable": raw}
        calls.append((server, tool, args if isinstance(args, dict) else {"value": args}))
    for first_line, var in ((REVIEW_LINE, "FAKE_CLAUDE_REVIEW_ACTIONS"), (CURATOR_LINE, "FAKE_CLAUDE_CURATOR_ACTIONS")):
        if first_line not in prompt or not os.environ.get(var):
            continue
        try:
            actions = json.loads(os.environ[var])
        except ValueError:
            actions = []
        for a in actions if isinstance(actions, list) else []:
            if isinstance(a, dict):
                args = a.get("args")
                calls.append((str(a.get("server") or ""), str(a.get("tool") or ""),
                              args if isinstance(args, dict) else {}))
    calls.extend(_work_actions(prompt))
    return calls


def _mcp_denied(name: str, server: str, argv: list[str], rules: list[str]) -> bool:
    whole = f"mcp__{server}"
    disallowed = _split(_arg(argv, "--disallowedTools")) + [r.strip() for r in rules]
    if name in disallowed or whole in disallowed:
        return True
    if "--allowedTools" in argv:
        allowed = _split(_arg(argv, "--allowedTools"))
        return name not in allowed and whole not in allowed
    return False


def _mcp_calls(prompt: str, argv: list[str], config: dict | None, run_settings: dict | None, session: str) -> None:
    """Run the ``FAKE:mcp`` markers and the review / curator actions against real MCP servers (M18)."""
    calls = _mcp_wanted(prompt)
    if not calls:
        return
    import asyncio
    import contextlib

    servers = (config or {}).get("mcpServers") if isinstance(config, dict) else None
    servers = servers if isinstance(servers, dict) else {}
    rules = _deny_list(run_settings)

    async def run() -> None:
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        sessions: dict[str, ClientSession] = {}
        async with contextlib.AsyncExitStack() as stack:
            devnull = stack.enter_context(open(os.devnull, "w", encoding="utf-8"))
            for n, (server, tool, args) in enumerate(calls, start=1):
                name = f"mcp__{server}__{tool}"
                tool_id = f"toolu_mcp_{n}"
                _out(_message(f"msg_m{n}", [{"type": "tool_use", "id": tool_id, "name": name, "input": args}],
                              session))
                block: dict = {"type": "tool_result", "tool_use_id": tool_id}
                spec = servers.get(server)
                if _mcp_denied(name, server, argv, rules):
                    block |= {"is_error": True, "content": f"Permission to use {name} has been denied."}
                elif not isinstance(spec, dict) or not (
                    spec.get("command") or (spec.get("type") in ("http", "sse") and spec.get("url"))
                ):
                    block |= {"is_error": True, "content": f"No such tool available: {name}"}
                else:
                    try:
                        client = sessions.get(server)
                        if client is None and spec.get("type") in ("http", "sse"):
                            env = dict(os.environ)
                            url = str(_fill(spec["url"], env))
                            headers = {str(k): str(v) for k, v in _fill(spec.get("headers") or {}, env).items()}
                            if spec["type"] == "http":
                                from mcp.client.streamable_http import streamable_http_client
                                from mcp.shared._httpx_utils import create_mcp_http_client

                                http = await stack.enter_async_context(create_mcp_http_client(headers=headers))
                                streams = await stack.enter_async_context(
                                    streamable_http_client(url, http_client=http))
                            else:
                                from mcp.client.sse import sse_client

                                streams = await stack.enter_async_context(sse_client(url, headers=headers))
                            read, write = streams[0], streams[1]
                            client = await stack.enter_async_context(ClientSession(read, write))
                            await client.initialize()
                            sessions[server] = client
                        if client is None:
                            env = dict(os.environ)
                            extra = _fill(spec.get("env") or {}, env)
                            params = StdioServerParameters(
                                command=str(_fill(spec["command"], env)),
                                args=[str(a) for a in _fill(spec.get("args") or [], env)],
                                env={**env, **{str(k): str(v) for k, v in extra.items()}},
                                cwd=os.getcwd(),
                            )
                            read, write = await stack.enter_async_context(stdio_client(params, errlog=devnull))
                            client = await stack.enter_async_context(ClientSession(read, write))
                            await client.initialize()
                            sessions[server] = client
                        result = await client.call_tool(tool, args)
                        block["content"] = [
                            {"type": "text", "text": getattr(c, "text", "")}
                            for c in getattr(result, "content", None) or []
                        ]
                        if getattr(result, "is_error", False):
                            block["is_error"] = True
                    except Exception as e:  # noqa: BLE001 - the fake reports any failure as a tool error
                        block |= {"is_error": True, "content": f"MCP error: {e}"}
                _out({"type": "user", "message": {"role": "user", "content": [block]}, "session_id": session})

    asyncio.run(run())


def _skill_tool_calls(prompt: str, session: str) -> None:
    """The ``FAKE:skilltool:<name>`` markers: the CLI's own ``Skill`` tool (M18)."""
    names = []
    for line in prompt.splitlines():
        at = line.find("FAKE:skilltool:")
        if at >= 0:
            names.append(line[at + len("FAKE:skilltool:"):].strip())
    for n, name in enumerate(names, start=1):
        tool_id = f"toolu_skill_{n}"
        _out(_message(f"msg_s{n}", [{"type": "tool_use", "id": tool_id, "name": "Skill",
                                     "input": {"skill": name}}], session))
        block = {"type": "tool_result", "tool_use_id": tool_id, "content": f"Launching skill: {name}"}
        _out({"type": "user", "message": {"role": "user", "content": [block]}, "session_id": session})


def _out(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def _arg(argv: list[str], name: str) -> str | None:
    if name in argv:
        i = argv.index(name)
        return argv[i + 1] if i + 1 < len(argv) else None
    return None


def _message(msg_id: str, content: list[dict], session: str) -> dict:
    return {
        "type": "assistant",
        "message": {"id": msg_id, "type": "message", "role": "assistant", "content": content},
        "session_id": session,
    }


def _stream_text(msg_id: str, chunks: list[str], session: str) -> None:
    _out({"type": "stream_event", "event": {"type": "message_start", "message": {"id": msg_id}}, "session_id": session})
    _out({"type": "stream_event", "event": {"type": "content_block_start", "index": 0,
                                            "content_block": {"type": "text", "text": ""}}, "session_id": session})
    for chunk in chunks:
        _out({"type": "stream_event", "event": {"type": "content_block_delta", "index": 0,
                                                "delta": {"type": "text_delta", "text": chunk}},
              "session_id": session})
        time.sleep(0.01)
    _out(_message(msg_id, [{"type": "text", "text": "".join(chunks)}], session))


def _result(text: str, session: str, error: bool = False) -> None:
    _out({
        "type": "result",
        "subtype": "error_during_execution" if error else "success",
        "is_error": error,
        "result": text,
        "session_id": session,
        "num_turns": 1,
    })


def main(argv: list[str]) -> int:
    if "--version" in argv:
        if os.environ.get("FAKE_CLAUDE_VERSION_FAIL") == "1":
            sys.stderr.write("fake claude: broken install\n")
            return 2
        print("9.9.9 (Claude Code, fake)")
        return 0
    prompt = sys.stdin.read()
    config_arg = _arg(argv, "--mcp-config")
    config = None
    if config_arg:
        try:
            config = json.loads(Path(config_arg).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            config = {"unreadable": config_arg}
    run_settings = _json_arg(_arg(argv, "--settings"))
    append_file = _arg(argv, "--append-system-prompt-file")
    append_prompt = None
    if append_file:
        try:
            append_prompt = Path(append_file).read_text(encoding="utf-8")
        except OSError:
            append_prompt = None
    allowed = _split(_arg(argv, "--allowedTools"))
    disallowed = _split(_arg(argv, "--disallowedTools"))
    log = os.environ.get("FAKE_CLAUDE_LOG")
    if log:
        entry = {
            "argv": argv,
            "cwd": os.getcwd(),
            "cwdEntries": sorted(os.listdir(os.getcwd())),
            "pid": os.getpid(),
            "prompt": prompt,
            "mcpConfig": config,
            "token": os.environ.get("OBJECT_API_TOKEN"),
            "url": os.environ.get("OBJECT_API_URL"),
            "model": _arg(argv, "--model"),
            "appendPrompt": append_prompt,
            "runSettings": run_settings,
            "settingSources": _arg(argv, "--setting-sources"),
            "tools": _arg(argv, "--tools"),
            "allowed": allowed,
            "disallowed": disallowed,
            "env": {"CLAUDE_CONFIG_DIR": "CLAUDE_CONFIG_DIR" in os.environ},
            "forkSession": "--fork-session" in argv,
            "noSessionPersistence": "--no-session-persistence" in argv,
            "resume": _arg(argv, "--resume"),
            "mcpServers": sorted(config["mcpServers"]) if isinstance(config, dict)
            and isinstance(config.get("mcpServers"), dict) else [],
        }
        with open(log, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")

    resume = _arg(argv, "--resume")
    refused = "FAKE:modelswitch" in prompt and resume is not None and _arg(argv, "--model") is not None
    if resume in ("expired", EXPIRED_SESSION) or refused:
        _result(f"No conversation found with session ID: {resume}", resume, error=True)
        sys.stderr.write(f"No conversation found with session ID: {resume}\n")
        return 1
    session = str(uuid.uuid4()) if resume and "--fork-session" in argv else (resume or str(uuid.uuid4()))
    review = REVIEW_LINE in prompt

    if "FAKE:fail" in prompt or (review and os.environ.get("FAKE_CLAUDE_REVIEW_FAIL") == "1"):
        sys.stderr.write("fake claude: something broke\n")
        return 1
    if "FAKE:auth" in prompt:
        _out({"type": "system", "subtype": "init", "session_id": session, "tools": []})
        _result("Invalid API key · Please run /login", session, error=True)
        return 1

    if "--allowedTools" in argv:
        mcp_tools = [t for t in allowed if t.startswith("mcp__")]
    else:
        mcp_tools = ["mcp__object__search", "mcp__object__read"]
    init_tools = [t for t in BUILTIN_NAMES if t not in disallowed] + mcp_tools
    servers = (config or {}).get("mcpServers") if isinstance(config, dict) else None
    names = sorted(servers) if isinstance(servers, dict) and servers else ["object"]
    _out({"type": "system", "subtype": "init", "session_id": session, "cwd": os.getcwd(),
          "tools": init_tools,
          "mcp_servers": [{"name": s, "status": "connected"} for s in names]})

    if "FAKE:sleep" in prompt:
        time.sleep(120)
        return 0
    if "FAKE:wait" in prompt and log:
        go = Path(log + ".go")
        deadline = time.monotonic() + 20
        while not go.exists() and time.monotonic() < deadline:
            time.sleep(0.05)
    if "FAKE:error" in prompt:
        _result("Something went wrong in the fake", session, error=True)
        return 1

    if "FAKE:tool" in prompt:  # also FAKE:toolerror
        failed = "FAKE:toolerror" in prompt
        _stream_text("msg_1", ["Let me look."], session)
        _out(_message("msg_1", [{"type": "tool_use", "id": "toolu_1", "name": "mcp__object__search",
                                 "input": {"query": "alpha"}}], session))
        block: dict = {"type": "tool_result", "tool_use_id": "toolu_1", "content": "[]"}
        if failed:
            block = {"type": "tool_result", "tool_use_id": "toolu_1", "is_error": True,
                     "content": [{"type": "text", "text": "Search failed: index busy"}]}
        _out({"type": "user", "message": {"role": "user", "content": [block]}, "session_id": session})

    _builtin_calls(prompt, argv, run_settings, session)
    _mcp_calls(prompt, argv, config, run_settings, session)
    _skill_tool_calls(prompt, session)
    if review and os.environ.get("FAKE_CLAUDE_REVIEW_SLEEP"):
        try:
            time.sleep(float(os.environ["FAKE_CLAUDE_REVIEW_SLEEP"]))
        except ValueError:
            pass

    final = "Hello from the fake claude."
    if "FAKE:tags" in prompt:
        final = 'These fit.\n\n```json\n{"tags": ["Math", "history", "Math", " Ideas "]}\n```'
    elif "FAKE:props" in prompt:
        final = 'Filled one.\n\n```json\n{"values": {"description": "A mathematician.", "website": "https://example.org", "nope": 1}}\n```'
    elif "FAKE:text" in prompt:
        final = "Here it is.\n\n```text\nA clearer sentence.\nSecond line.\n```"
    elif "FAKE:badjson" in prompt:
        final = 'Oops.\n\n```json\n{"tags": [nope\n```'
    long_text = re.search(r"FAKE:long:(\d+)", prompt)
    if long_text:
        size = int(long_text.group(1))
        final = ("0123456789" * (size // 10 + 1))[:size]
    elif "FAKE:echo-env" in prompt:
        final = f"MCP_TOOL_TIMEOUT={os.environ.get('MCP_TOOL_TIMEOUT', 'unset')}"
    half = len(final) // 2
    _stream_text("msg_2", [final[:half], final[half:]], session)
    _result(final, session)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
