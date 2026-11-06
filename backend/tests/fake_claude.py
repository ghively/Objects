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
"""

from __future__ import annotations

import json
import os
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
        }
        with open(log, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")

    resume = _arg(argv, "--resume")
    refused = "FAKE:modelswitch" in prompt and resume is not None and _arg(argv, "--model") is not None
    if resume in ("expired", EXPIRED_SESSION) or refused:
        _result(f"No conversation found with session ID: {resume}", resume, error=True)
        sys.stderr.write(f"No conversation found with session ID: {resume}\n")
        return 1
    session = resume or str(uuid.uuid4())

    if "FAKE:fail" in prompt:
        sys.stderr.write("fake claude: something broke\n")
        return 1
    if "FAKE:auth" in prompt:
        _out({"type": "system", "subtype": "init", "session_id": session, "tools": []})
        _result("Invalid API key · Please run /login", session, error=True)
        return 1

    _out({"type": "system", "subtype": "init", "session_id": session, "cwd": os.getcwd(),
          "tools": ["mcp__object__search", "mcp__object__read"],
          "mcp_servers": [{"name": "object", "status": "connected"}]})

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

    final = "Hello from the fake claude."
    if "FAKE:tags" in prompt:
        final = 'These fit.\n\n```json\n{"tags": ["Math", "history", "Math", " Ideas "]}\n```'
    elif "FAKE:props" in prompt:
        final = 'Filled one.\n\n```json\n{"values": {"description": "A mathematician.", "website": "https://example.org", "nope": 1}}\n```'
    elif "FAKE:text" in prompt:
        final = "Here it is.\n\n```text\nA clearer sentence.\nSecond line.\n```"
    elif "FAKE:badjson" in prompt:
        final = 'Oops.\n\n```json\n{"tags": [nope\n```'
    half = len(final) // 2
    _stream_text("msg_2", [final[:half], final[half:]], session)
    _result(final, session)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
