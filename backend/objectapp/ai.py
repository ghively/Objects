"""The AI assistant's runner (M10, M17): one ``claude -p`` subprocess per chat turn.

Object has no model of its own and makes no network call: the user's own Claude Code
CLI does the work. Since M17 every turn is an agent run: `agentrun.build_run` gives the
command (the agent's folder as the working folder, its settings only, Object's MCP servers,
the tool switches and the fence), and `Turn.run` hands it to `_Attempt`. The prompt goes on
stdin. Object's tools reach the space through the running app's ``/api/v1`` with a per-turn
token held in memory (`tokens.TokenStore.ephemeral`), so "Exclude from AI", templates and
the version checks are enforced in one place. The proposal modes run read-only: what they
suggest comes back as a proposal (tags, property values or text) that the user applies
through the normal write paths.

Pieces:

- `find_claude` / `status`: where the CLI is (the ``claudePath`` setting, else ``claude``
  on PATH) and whether ``claude --version`` answers.
- `gather_context` / `build_prompt`: the turn's prompt. Context pages are read with
  `Space.read`; excluded pages, templates and unknown paths are left out and listed in
  ``skipped`` with the reason (``excluded``, ``template``, ``missing``, ``tooLong``); the
  text is capped at `MAX_CONTEXT_CHARS`. Relation values that point at a page the
  assistant may not see are left out of a page's text.
- `visible_path` / `valid_session`: the checks the route makes on a block's page and on a
  session id before a turn starts.
- `parse_proposal`: the mode's proposal from the last fenced block of the answer.
- `StreamParser`: Claude Code's stream-json lines -> `AiEvent` dicts. A tool call gives two
  ``tool`` events with the same id (M16): one at the call (its input, see `short_input`),
  one when its result arrives (`short_result`, capped at `TOOL_RESULT_CAP`). Tool results
  never go into the answer's text.
- `run_turn`: the subprocess, as an async generator of `AiEvent` dicts. The blocking I/O
  runs in threads; a timeout (`TURN_TIMEOUT`) or closing the generator (the client went
  away) kills the whole process tree.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import re
import shutil
import signal
import subprocess
import threading
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .agentrun import RunCommand, RunRefused, register_run_pid, run_base_env, unregister_run_pid
from .apiquery import EXCLUDE_TAG, is_excluded

__all__ = [
    "ELLIPSIS",
    "MAX_CONTEXT_CHARS",
    "MODES",
    "TOOL_INPUT_STRING_CAP",
    "TOOL_RESULT_CAP",
    "TURN_TIMEOUT",
    "ContextPack",
    "StreamParser",
    "Turn",
    "build_prompt",
    "find_claude",
    "gather_context",
    "parse_proposal",
    "run_turn",
    "short_input",
    "short_result",
    "status",
    "valid_session",
    "visible_path",
]

MODES = ("chat", "askBlock", "tagBlock", "tagObject", "autofill", "rephrase")
TURN_TIMEOUT = 300.0
"""Seconds a turn may run before the CLI is stopped."""
STATUS_TIMEOUT = 10.0
MAX_CONTEXT_CHARS = 60_000
"""Characters of context page text one prompt carries at most."""
MAX_TAGS = 5
MAX_EXISTING_TAGS = 300
MCP_SERVER = "object"

NOT_FOUND = (
    "Claude Code was not found. Install it, or set where it is in Settings > AI Assistant."
)
AUTH_MESSAGE = (
    "Claude Code isn't signed in. Run `claude` once in a terminal to sign in, then try again."
)
_AUTH_HINTS = re.compile(
    r"\b(?:log ?in|/login|not logged|logged out|sign ?in|auth(?:enticat\w*|oriz\w*)?|"
    r"api[ _-]?key|credential|oauth|unauthori[sz]ed|401)\b",
    re.IGNORECASE,
)


# -- the CLI --------------------------------------------------------------------------


def find_claude(setting: str | None) -> str | None:
    """The CLI to run: the ``claudePath`` setting when it names a file, else ``claude`` on
    PATH. None when there is none."""
    if setting:
        path = Path(setting).expanduser()
        if path.is_file():
            return str(path)
        found = shutil.which(str(path))
        return found
    return shutil.which("claude")


def _hidden_window() -> dict[str, Any]:
    if os.name == "nt":  # pragma: no cover - Windows
        return {"creationflags": subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


def status(setting: str | None) -> dict[str, Any]:
    """`AiStatus`: whether the CLI is there and answers ``--version``, run with the environment a
    turn gets (`agentrun.run_base_env`), so "available" means what a turn will find.

    Whether it is signed in can't be told without a model call; a turn that finds it
    isn't reports that (`AUTH_MESSAGE`).
    """
    claude = find_claude(setting)
    shown = setting or claude
    if claude is None:
        return {"available": False, "reason": "notFound", "claudePath": shown, "version": None,
                "message": NOT_FOUND}
    try:
        out = subprocess.run(
            [claude, "--version"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=STATUS_TIMEOUT,
            stdin=subprocess.DEVNULL,
            check=False,
            env=run_base_env(),
            **_hidden_window(),
        )
    except subprocess.TimeoutExpired:
        return {"available": False, "reason": "error", "claudePath": claude, "version": None,
                "message": f"`claude --version` didn't answer within {STATUS_TIMEOUT:g} seconds."}
    except OSError as exc:
        return {"available": False, "reason": "error", "claudePath": claude, "version": None,
                "message": f"Claude Code couldn't be started: {exc.strerror or exc}"}
    if out.returncode != 0:
        detail = (out.stderr or out.stdout or "").strip()[-500:]
        return {"available": False, "reason": "error", "claudePath": claude, "version": None,
                "message": f"`claude --version` failed (exit {out.returncode}): {detail}".strip()}
    version = (out.stdout or "").strip().splitlines()
    return {"available": True, "reason": "ok", "claudePath": claude,
            "version": version[0].strip() if version else None, "message": None}


# -- context and prompt ---------------------------------------------------------------


@dataclass
class ContextPage:
    path: str
    title: str
    typeName: str
    text: str
    cut: bool = False


@dataclass
class ContextPack:
    pages: list[ContextPage] = field(default_factory=list)
    skipped: list[dict[str, str]] = field(default_factory=list)
    """Pages left out, each ``{path, reason}``: ``excluded`` (Exclude from AI), ``template``,
    ``missing`` (unknown or unreadable) or ``tooLong`` (past the size cap)."""
    truncated: bool = False
    tags: list[str] = field(default_factory=list)
    """Existing tag names (tag modes)."""
    fields: list[dict[str, Any]] = field(default_factory=list)
    """The empty properties of the first context page (autofill)."""


def _hidden_reason(space, rel: str) -> str | None:
    """Why the assistant may not see `rel` (``missing``, ``template``, ``excluded``), else None."""
    with space._lock:
        summary = space._summaries.get(rel)
        raw = space._raw.get(rel)
    if summary is None:
        return "missing"
    if summary.template is not None:
        return "template"
    if is_excluded(raw.fm if raw else None, summary.tags):
        return "excluded"
    return None


def _visible(space, rel: str):
    """The summary of `rel` when the assistant may see it, else None."""
    if _hidden_reason(space, rel) is not None:
        return None
    with space._lock:
        return space._summaries.get(rel)


def visible_path(space, path: str | None) -> str | None:
    """`path` as a space path when the assistant may see that object, else None."""
    if not path:
        return None
    try:
        rel = space._rel(path)
    except (ValueError, KeyError):
        return None
    return rel if _visible(space, rel) is not None else None


_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def valid_session(session_id: Any) -> str | None:
    """A Claude Code session id (a UUID) to ``--resume``, else None (start a fresh session)."""
    if isinstance(session_id, str) and _UUID.match(session_id.strip()):
        return session_id.strip()
    return None


def _empty(value: Any) -> bool:
    return value is None or value == "" or value == [] or value == {}


_FILLABLE = {"text", "textBlock", "url", "number", "datetime", "datetimeSimple", "label", "entity",
             "entity_description"}


def _fields(space, rel: str, summary) -> list[dict[str, Any]]:
    """The empty, fillable properties of `rel`'s type, for autofill."""
    t = space.type_by_id(summary.type)
    if t is None:
        return []
    rows = space.rows(None, None, [rel], None, False)
    values = rows[0].values if rows else {}
    out = []
    for p in t.propertyDefinitions:
        if p.type not in _FILLABLE or not _empty(values.get(p.key)):
            continue
        entry: dict[str, Any] = {"id": p.key, "name": p.name, "kind": p.type}
        if p.type == "label":
            entry["options"] = [o.get("text") if isinstance(o, dict) else getattr(o, "text", o)
                                for o in p.options.get("set") or []]
            entry["multiple"] = bool(p.options.get("isArray"))
        if p.type == "entity":
            entry["multiple"] = bool(p.options.get("isArray"))
        out.append(entry)
    return out


def _value_text(value: Any, shown: Any = None) -> str:
    """A property value as prompt text. `shown(path)`: whether a linked object may be named
    (a relation or backlink to an object the assistant may not see is left out)."""
    if isinstance(value, dict):
        if "start" in value:
            end = value.get("end")
            return f"{value.get('start')}" + (f" to {end}" if end else "")
        if "target" in value:
            path = value.get("path")
            if path and shown is not None and not shown(path):
                return ""
            return str(value.get("target") or value.get("path") or "")
        return ""
    if isinstance(value, list):
        return ", ".join(t for t in (_value_text(v, shown) for v in value) if t)
    if isinstance(value, bool):
        return "yes" if value else "no"
    return "" if value is None else str(value)


_SKIP_VALUE_KINDS = {"entity_title", "entity_createdAt", "entity_lastUpdated", "entity_icon",
                     "coverImage", "blocks", "color"}


def _page_text(space, rel: str, summary) -> str:
    of, _fm, _version = space.read(rel)
    t = space.type_by_id(summary.type)
    lines = []
    if t is not None:
        rows = space.rows(None, None, [rel], None, False)
        values = rows[0].values if rows else {}
        for p in t.propertyDefinitions:
            if p.type in _SKIP_VALUE_KINDS:
                continue
            text = _value_text(values.get(p.key), lambda path: _visible(space, path) is not None)
            if text:
                lines.append(f"{p.name}: {text}")
    head = "\n".join(lines)
    body = of.body.replace("\r\n", "\n").strip("\n")
    return f"{head}\n\n{body}".strip("\n") if head else body


def existing_tags(space) -> list[str]:
    """Tag names in use: the Tag objects' titles and the tags on objects the assistant may see."""
    names: dict[str, str] = {}
    for s in space.list():
        if _visible(space, s.path) is None:
            continue
        found = [s.title] if s.type == "tag" and s.title else []
        for tag in s.tags:
            name = str(tag).strip()
            if name.startswith("[[") and name.endswith("]]"):
                name = name[2:-2].split("|")[0]
            found.append(name.strip())
        for name in found:
            if name and name.casefold() != EXCLUDE_TAG:
                names.setdefault(name.casefold(), name)
    return sorted(names.values(), key=str.casefold)[:MAX_EXISTING_TAGS]


def gather_context(space, paths: list[str], *, tags: bool = False, fields: bool = False) -> ContextPack:
    """Read the context pages the assistant may see (never writes)."""
    pack = ContextPack()
    budget = MAX_CONTEXT_CHARS
    seen: set[str] = set()
    for path in paths:
        try:
            rel = space._rel(path)
        except (ValueError, KeyError):
            pack.skipped.append({"path": path, "reason": "missing"})
            continue
        if rel in seen:
            continue
        seen.add(rel)
        reason = _hidden_reason(space, rel)
        summary = _visible(space, rel) if reason is None else None
        if summary is None:
            pack.skipped.append({"path": rel, "reason": reason or "missing"})
            continue
        if budget <= 0:
            pack.skipped.append({"path": rel, "reason": "tooLong"})
            pack.truncated = True
            continue
        try:
            text = _page_text(space, rel, summary)
        except (KeyError, FileNotFoundError, ValueError):
            pack.skipped.append({"path": rel, "reason": "missing"})
            continue
        cut = len(text) > budget
        if cut:
            text = text[:budget]
            pack.truncated = True
        budget -= len(text)
        t = space.type_by_id(summary.type)
        pack.pages.append(ContextPage(rel, summary.title, t.name if t else summary.type, text, cut))
        if fields and len(pack.pages) == 1:
            pack.fields = _fields(space, rel, summary)
    if tags:
        pack.tags = existing_tags(space)
    return pack


_INTRO = (
    "You are the assistant inside Object, the user's local Markdown notes app. "
    "The Object tools (schema, search, query, peek, read, backlinks, daily_note, ...) look up the "
    "user's notes; they only read. You can't change any note: the user applies what you suggest."
)

_INSTRUCTIONS = {
    "chat": (
        "Answer the user's message about their notes. Use the pages under Context, and the "
        "Object tools when other notes would help. Reply in Markdown, concisely."
    ),
    "askBlock": (
        "Answer the user's question about the block below. Use the pages under Context and "
        "the Object tools when they help. Reply in Markdown, concisely."
    ),
    "tagBlock": (
        "Suggest up to 5 tags for the block below. Prefer the existing tags listed. Reply "
        "with one short sentence, then ONLY a fenced ```json block: {\"tags\": [\"tag name\", ...]}"
    ),
    "tagObject": (
        "Suggest up to 5 tags for the page under Context. Prefer the existing tags listed. "
        "Reply with one short sentence, then ONLY a fenced ```json block: "
        "{\"tags\": [\"tag name\", ...]}"
    ),
    "autofill": (
        "Fill the empty properties listed below for the page under Context, using only what "
        "the page says; leave out any you can't fill. Reply with one short sentence, then "
        "ONLY a fenced ```json block: {\"values\": {\"<property id>\": value}}. Values: "
        "text and url a string; number a number; date {\"start\": \"YYYY-MM-DD\", "
        "\"resolution\": \"day\"}; select a list of option names; relation a list of "
        "{\"target\": \"<object title>\"}."
    ),
    "rephrase": (
        "Rewrite the text below as the user asks (if they don't say how: clearer and more "
        "concise, same meaning, language and Markdown). Reply with ONLY a fenced ```text "
        "block holding the rewritten text."
    ),
}


def _fence(text: str) -> str:
    """A backtick fence longer than any run of backticks in `text`."""
    longest = max((len(m) for m in re.findall(r"`+", text)), default=0)
    return "`" * max(3, longest + 1)


def build_prompt(
    mode: str,
    prompt: str,
    pack: ContextPack,
    block: str | None = None,
    history: list[dict[str, Any]] | None = None,
    *,
    intro: bool = True,
) -> str:
    """The text sent on stdin. `history` (earlier messages) only when no session resumes.

    ``intro=False`` (agent runs, M17) leaves out `_INTRO`: the run's appended guidance carries it.
    """
    parts = [_INTRO] if intro else []
    parts.append(_INSTRUCTIONS.get(mode, _INSTRUCTIONS["chat"]))
    if pack.pages:
        ctx = ["# Context"]
        for page in pack.pages:
            fence = _fence(page.text)
            ctx.append(f"## {page.title or page.path} ({page.typeName}, {page.path})\n"
                       f"{fence}markdown\n{page.text}\n{fence}"
                       + ("\n[This page was cut to fit the size limit.]" if page.cut else ""))
        parts.append("\n\n".join(ctx))
    if pack.truncated:
        parts.append(f"[Context was cut at {MAX_CONTEXT_CHARS:,} characters; some pages are "
                     "shortened or left out. Use the Object tools to read them.]")
    if mode in ("tagBlock", "tagObject"):
        parts.append("# Existing tags\n" + (", ".join(pack.tags) if pack.tags else "(none yet)"))
    if mode == "autofill":
        parts.append("# Empty properties\n" + (json.dumps(pack.fields, ensure_ascii=False)
                                               if pack.fields else "(none)"))
    if history:
        lines = ["# Earlier in this conversation"]
        for m in history:
            who = "User" if m.get("role") == "user" else "Assistant"
            lines.append(f"{who}: {str(m.get('text') or '').strip()}")
        parts.append("\n\n".join(lines))
    if block and block.strip():
        fence = _fence(block)
        label = "# The text" if mode == "rephrase" else "# The block"
        parts.append(f"{label}\n{fence}\n{block}\n{fence}")
    if prompt and prompt.strip():
        label = "# The user's message" if mode == "chat" else "# The user's instruction"
        parts.append(f"{label}\n{prompt.strip()}")
    return "\n\n".join(parts) + "\n"


# -- proposals ------------------------------------------------------------------------

_FENCE_OPEN = re.compile(r"^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$")


def fenced_blocks(text: str) -> list[tuple[str, str]]:
    """Every closed fenced block of `text` as (info word, content), in order."""
    out: list[tuple[str, str]] = []
    lines = text.replace("\r\n", "\n").split("\n")
    i = 0
    while i < len(lines):
        m = _FENCE_OPEN.match(lines[i])
        if not m:
            i += 1
            continue
        marker, lang = m.group(1), m.group(2).lower()
        close = re.compile(rf"^ {{0,3}}{re.escape(marker[0])}{{{len(marker)},}}[ \t]*$")
        j = i + 1
        while j < len(lines) and not close.match(lines[j]):
            j += 1
        if j >= len(lines):
            break  # unclosed: not a block
        out.append((lang, "\n".join(lines[i + 1 : j])))
        i = j + 1
    return out


def _last_block(text: str, langs: tuple[str, ...]) -> str | None:
    blocks = [content for lang, content in fenced_blocks(text) if lang in langs]
    return blocks[-1] if blocks else None


def _json_block(text: str) -> Any:
    content = _last_block(text, ("json", ""))
    if content is None:
        return None
    try:
        return json.loads(content)
    except ValueError:
        return None


def parse_proposal(mode: str, text: str, allowed_keys: set[str] | None = None) -> dict[str, Any] | None:
    """The proposal of a finished answer, or None (no proposal or a malformed one)."""
    if mode in ("tagBlock", "tagObject"):
        data = _json_block(text)
        if not isinstance(data, dict) or not isinstance(data.get("tags"), list):
            return None
        tags: list[str] = []
        seen: set[str] = set()
        for item in data["tags"]:
            if not isinstance(item, str):
                continue
            name = " ".join(item.strip().lstrip("#").split())
            if name and name.casefold() not in seen:
                seen.add(name.casefold())
                tags.append(name)
        return {"kind": "tags", "tags": tags[:MAX_TAGS]} if tags else None
    if mode == "autofill":
        data = _json_block(text)
        if not isinstance(data, dict) or not isinstance(data.get("values"), dict):
            return None
        values = {str(k): v for k, v in data["values"].items()
                  if allowed_keys is None or str(k) in allowed_keys}
        return {"kind": "properties", "values": values} if values else None
    if mode == "rephrase":
        content = _last_block(text, ("text", "markdown", "md", ""))
        return {"kind": "text", "text": content} if content is not None and content.strip() else None
    return None


# -- the stream -----------------------------------------------------------------------


TOOL_INPUT_STRING_CAP = 1_000
"""Characters kept of each string value in a tool's input, at any depth (our number)."""
TOOL_RESULT_CAP = 4_000
"""Characters kept of a tool's result text (our number)."""
ELLIPSIS = "…"


_SHORT_PREFIXES = (f"mcp__{MCP_SERVER}__", "mcp__object-agent__")
"""Object's tools and the agent tools (M17) are named by their short name in ``tool`` events."""


def _short_tool(name: str) -> str:
    for prefix in _SHORT_PREFIXES:
        if name.startswith(prefix):
            return name.removeprefix(prefix)
    return name


def _cap(text: str, cap: int) -> str:
    return text[:cap] + ELLIPSIS if len(text) > cap else text


def _cap_strings(value: Any) -> Any:
    if isinstance(value, str):
        return _cap(value, TOOL_INPUT_STRING_CAP)
    if isinstance(value, dict):
        return {k: _cap_strings(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_cap_strings(v) for v in value]
    return value


def short_input(value: Any) -> dict[str, Any] | None:
    """The call's input for the chat: a dict (None if it isn't one) whose string values,
    at any depth, are cut to TOOL_INPUT_STRING_CAP characters + ELLIPSIS."""
    if not isinstance(value, dict):
        return None
    return {str(k): _cap_strings(v) for k, v in value.items()}


def short_result(content: Any) -> str:
    """A tool_result's content as text: a string as is; a list of blocks joined with "\\n"
    (text blocks' text, any other block as "[image]" or "[<type>]", our strings); cut to
    TOOL_RESULT_CAP + ELLIPSIS."""
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str):
                parts.append(block["text"])
            elif isinstance(block, dict):
                parts.append(f"[{block.get('type') or 'block'}]")
            elif isinstance(block, str):
                parts.append(block)
        text = "\n".join(parts)
    elif content is None:
        text = ""
    else:
        text = str(content)
    return _cap(text, TOOL_RESULT_CAP)


class StreamParser:
    """Turns Claude Code's ``stream-json`` lines into `AiEvent` dicts.

    Text arrives twice with ``--include-partial-messages`` (as deltas, then in the whole
    ``assistant`` message); only text not sent yet is emitted. Text from separate blocks
    or messages is joined with a blank line.
    """

    def __init__(self) -> None:
        self.session_id: str | None = None
        self.shown = ""
        """All text emitted so far."""
        self.result: str | None = None
        self.error: str | None = None
        self.finished = False
        self._streamed: dict[str, str] = {}
        self._msg: str | None = None
        self._block_open = False
        self._tools: dict[str, str] = {}
        """Announced tool calls: tool_use id -> short name."""
        self._answered: set[str] = set()
        self._texts: set[tuple[str, str]] = set()

    def _emit_text(self, text: str, new_block: bool) -> list[dict[str, Any]]:
        if not text:
            return []
        if new_block and self.shown and not self.shown.endswith("\n\n"):
            text = ("\n" if self.shown.endswith("\n") else "\n\n") + text
        self.shown += text
        return [{"type": "text", "text": text}]

    def feed(self, obj: Any) -> list[dict[str, Any]]:
        if not isinstance(obj, dict):
            return []
        kind = obj.get("type")
        if kind == "system" and obj.get("subtype") == "init":
            sid = obj.get("session_id")
            if isinstance(sid, str) and sid and sid != self.session_id:
                self.session_id = sid
                return [{"type": "session", "sessionId": sid}]
            return []
        if kind == "stream_event":
            return self._stream_event(obj.get("event") or {})
        if kind == "assistant":
            return self._assistant(obj.get("message") or {})
        if kind == "user":
            return self._user(obj.get("message") or {})
        if kind == "result":
            self.finished = True
            sid = obj.get("session_id")
            if isinstance(sid, str) and sid:
                self.session_id = sid
            text = obj.get("result")
            text = text if isinstance(text, str) else ""
            if obj.get("is_error") or (obj.get("subtype") not in (None, "success")):
                self.error = text or str(obj.get("subtype") or "error")
            else:
                self.result = text
            return []
        return []

    def _stream_event(self, event: dict[str, Any]) -> list[dict[str, Any]]:
        etype = event.get("type")
        if etype == "message_start":
            msg = event.get("message") or {}
            self._msg = msg.get("id") if isinstance(msg.get("id"), str) else None
            if self._msg:
                self._streamed.setdefault(self._msg, "")
            return []
        if etype == "content_block_start":
            block = event.get("content_block") or {}
            self._block_open = block.get("type") == "text"
            return []
        if etype == "content_block_delta":
            delta = event.get("delta") or {}
            if delta.get("type") != "text_delta" or not isinstance(delta.get("text"), str):
                return []
            first = self._block_open
            self._block_open = False
            if self._msg:
                self._streamed[self._msg] = self._streamed.get(self._msg, "") + delta["text"]
            return self._emit_text(delta["text"], first)
        return []

    def _assistant(self, msg: dict[str, Any]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        msg_id = msg.get("id") if isinstance(msg.get("id"), str) else ""
        streamed = self._streamed.get(msg_id, "")
        for block in msg.get("content") or []:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text" and isinstance(block.get("text"), str):
                text = block["text"]
                key = (msg_id, text)
                if key in self._texts or (streamed and text in streamed):
                    continue
                self._texts.add(key)
                out += self._emit_text(text, True)
            elif block.get("type") == "tool_use":
                tid = str(block.get("id") or len(self._tools))
                if tid in self._tools:
                    continue
                name = _short_tool(str(block.get("name") or ""))
                self._tools[tid] = name
                out.append({"type": "tool", "id": tid, "name": name, "input": short_input(block.get("input"))})
        return out

    def _user(self, msg: Any) -> list[dict[str, Any]]:
        """A ``user`` message's ``tool_result`` blocks -> result events, by announced id."""
        if not isinstance(msg, dict) or not isinstance(msg.get("content"), list):
            return []
        out: list[dict[str, Any]] = []
        for block in msg["content"]:
            if not isinstance(block, dict) or block.get("type") != "tool_result":
                continue
            tid = block.get("tool_use_id")
            if not isinstance(tid, str) or tid not in self._tools or tid in self._answered:
                continue
            self._answered.add(tid)
            out.append({"type": "tool", "id": tid, "name": self._tools[tid], "input": None,
                        "result": short_result(block.get("content")), "isError": bool(block.get("is_error"))})
        return out


def is_auth_problem(*texts: str | None) -> bool:
    return any(t and _AUTH_HINTS.search(t) for t in texts)


# -- the turn -------------------------------------------------------------------------


@dataclass
class Turn:
    """One request to the CLI. `prompt_resume` is used with `session_id`; `prompt_fresh`
    (with the earlier messages) without a session, or when resuming fails."""

    claude: str
    mode: str
    prompt_resume: str | None
    prompt_fresh: str
    session_id: str | None
    model: str | None
    api_url: str
    token: str
    skipped: list[dict[str, str]] = field(default_factory=list)
    allowed_keys: set[str] | None = None
    run: Callable[[str | None], RunCommand] = field(kw_only=True)
    """M17: the resume id in, a fresh agent-run command out (`agentrun.build_run`)."""
    timeout: float = field(default_factory=lambda: TURN_TIMEOUT)
    """Seconds this turn may run (`run_turn`'s deadline); the module constant when made."""


def _kill_tree(proc: subprocess.Popen) -> None:
    """Stop the CLI and everything it started (the MCP server among them)."""
    if proc.poll() is not None and os.name == "nt":  # pragma: no cover - Windows
        return
    if os.name == "nt":  # pragma: no cover - Windows
        with contextlib.suppress(OSError, subprocess.SubprocessError):
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True,
                           timeout=10, check=False, creationflags=subprocess.CREATE_NO_WINDOW)
    else:
        with contextlib.suppress(ProcessLookupError, PermissionError, OSError):
            os.killpg(proc.pid, signal.SIGKILL)
    with contextlib.suppress(OSError):
        proc.kill()
    with contextlib.suppress(subprocess.TimeoutExpired, OSError):
        proc.wait(timeout=10)


class _Attempt:
    """One CLI process: its stdout lines go to an asyncio queue from reader threads."""

    def __init__(self, turn: Turn, prompt: str, resume: str | None) -> None:
        self.turn = turn
        self.prompt = prompt
        self.resume = resume
        self.proc: subprocess.Popen | None = None
        self.stderr: list[str] = []
        self.command: RunCommand | None = None

    def start(self, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue) -> None:
        self.command = self.turn.run(self.resume)
        args, cwd, env = self.command.args, self.command.cwd, self.command.env
        self.proc = subprocess.Popen(
            args,
            cwd=cwd,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            **_hidden_window(),
        )
        proc = self.proc
        register_run_pid(proc.pid)  # the run fence (`runfence`) knows the run by this process

        def put(item: tuple[str, Any]) -> None:
            with contextlib.suppress(RuntimeError):  # the loop closed
                loop.call_soon_threadsafe(queue.put_nowait, item)

        def write() -> None:
            with contextlib.suppress(OSError, ValueError):
                proc.stdin.write(self.prompt)
            with contextlib.suppress(OSError, ValueError):
                proc.stdin.close()

        def read_out() -> None:
            with contextlib.suppress(OSError, ValueError):
                for line in proc.stdout:
                    put(("line", line))
            put(("eof", None))

        def read_err() -> None:
            with contextlib.suppress(OSError, ValueError):
                for line in proc.stderr:
                    self.stderr.append(line)
                    del self.stderr[:-50]

        for fn in (write, read_out, read_err):
            threading.Thread(target=fn, daemon=True, name="object-ai").start()

    def stop(self) -> None:
        if self.proc is not None:
            unregister_run_pid(self.proc.pid)
            _kill_tree(self.proc)
        if self.command is not None:
            shutil.rmtree(self.command.tmp, ignore_errors=True)

    def stderr_text(self) -> str:
        return "".join(self.stderr).strip()[-800:]


class _Failed(Exception):
    def __init__(self, message: str, *, retryable: bool) -> None:
        self.message = message
        self.retryable = retryable


async def _attempt_events(attempt: _Attempt, parser: StreamParser, deadline: float) -> AsyncIterator[dict]:
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    try:
        attempt.start(loop, queue)
    except RunRefused as exc:
        raise _Failed(exc.message, retryable=False) from exc
    except OSError as exc:
        raise _Failed(f"Claude Code couldn't be started: {exc.strerror or exc}", retryable=False) from exc
    except Exception as exc:  # noqa: BLE001 - any other failure still ends the turn with ``error``
        raise _Failed(f"Claude Code couldn't be started: {exc}", retryable=False) from exc
    while True:
        remaining = deadline - loop.time()
        if remaining <= 0:
            raise TimeoutError
        kind, line = await asyncio.wait_for(queue.get(), timeout=remaining)
        if kind == "eof":
            break
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        for event in parser.feed(obj):
            yield event
    proc = attempt.proc
    assert proc is not None
    code = await asyncio.to_thread(_wait, proc, max(0.1, deadline - loop.time()))
    if code is None:
        raise TimeoutError
    stderr = attempt.stderr_text()
    if parser.error is not None or (code != 0 and parser.result is None):
        detail = parser.error or stderr or f"exit code {code}"
        if is_auth_problem(parser.error, stderr):
            raise _Failed(AUTH_MESSAGE, retryable=False)
        raise _Failed(f"Claude Code stopped with an error: {detail}", retryable=not parser.shown)
    if parser.result is None and not parser.shown:
        raise _Failed(f"Claude Code ended without an answer. {stderr}".strip(), retryable=False)


def _wait(proc: subprocess.Popen, timeout: float) -> int | None:
    try:
        return proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        return None


async def run_turn(turn: Turn) -> AsyncIterator[dict[str, Any]]:
    """The turn's `AiEvent` dicts, ending with one ``done`` or ``error``.

    Closing the generator early (the client went away) or running past the turn's `timeout`
    (`TURN_TIMEOUT` unless the caller set one) kills the CLI's process tree. A ``--resume`` that fails before any answer is tried
    once more as a fresh session with the earlier messages.
    """
    loop = asyncio.get_running_loop()
    deadline = loop.time() + turn.timeout
    plans: list[tuple[str, str | None]] = []
    if turn.session_id and turn.prompt_resume is not None:
        plans.append((turn.prompt_resume, turn.session_id))
    plans.append((turn.prompt_fresh, None))
    for index, (prompt, resume) in enumerate(plans):
        parser = StreamParser()
        attempt = _Attempt(turn, prompt, resume)
        try:
            async for event in _attempt_events(attempt, parser, deadline):
                yield event
        except _Failed as exc:
            if exc.retryable and resume and index + 1 < len(plans):
                continue
            yield {"type": "error", "message": exc.message}
            return
        except TimeoutError:
            yield {"type": "error",
                   "message": f"Claude Code took too long (over {turn.timeout:g} seconds) and was stopped."}
            return
        finally:
            await asyncio.shield(asyncio.to_thread(attempt.stop))
        text = parser.result if parser.result else parser.shown
        yield {
            "type": "done",
            "text": text,
            "sessionId": parser.session_id,
            "proposal": parse_proposal(turn.mode, text, turn.allowed_keys),
            "skipped": list(turn.skipped),
        }
        return
