"""Milestone 10 acceptance run: the AI assistant's back end, end to end, with a fake ``claude``.

Usage: ``uv run python scripts/m10_acceptance.py SPACE [--keep]``

Copies SPACE to a temporary folder (SPACE itself is never touched), commits the copy to a
throw-away git repo (again after one open, which migrates an old space) and serves it with
``create_app`` on a free ``127.0.0.1`` port. ``OBJECT_STATE_DIR`` and ``OBJECT_CACHE_DIR``
point outside the copy. No model runs: the ``claudePath`` setting (set through
``PUT /api/settings``) points at ``backend/tests/fake_claude.py``, which answers in Claude
Code's stream-json format and logs its command line, working folder and token. Checks:

 1. ``GET /api/ai/status`` answers ``ok`` with the fake's version;
 2. a chat turn over HTTP streams ``session``, ``text`` and ``done`` frames
    (``data: <json>`` separated by blank lines); a tag turn returns a tags proposal;
    the CLI ran in an empty folder outside the space with only the MCP read tools
    allowed and Read/Write/Edit/Bash denied, and its MCP config holds no secret;
 3. the turns changed no file (``git status`` clean); the per-turn token is in no file
    of the space or the state dir and is refused (401) once the turn is over;
 4. saving a chat creates exactly the AI Chat type file and one chat file; loading it
    gives the messages back (a fenced ``## You`` included); a second save with the
    version replaces the messages; a stale version answers 409 and changes nothing;
 5. with "Hide AI features" on, ``POST /api/ai/chat`` answers 403.

Each check prints ``[ok]`` or ``[FAIL]``; exits non-zero on any failure.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from m2_acceptance import Run, commit, git, remove_tree
from m8_acceptance import Served
from objectapp.space import Space

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend" / "tests"))
from fake_claude import install

HOOKS = ("OBJECT_STATE_DIR", "OBJECT_CACHE_DIR", "FAKE_CLAUDE_LOG")
READ_TOOLS = {
    "schema", "search", "query", "run_saved_query", "peek", "read", "backlinks",
    "daily_note", "changes_since",
}
# Claude Code session ids are UUIDs (the app drops any other id).
SESSION_1 = "0f8fad5b-d9cb-469f-a165-70867728950e"
SESSION_2 = "7c9e6679-7425-40de-944b-e07fc1f90ae7"
MESSAGES = [
    {"role": "user", "text": "What do my notes say?", "at": "2026-11-05T12:00:00.000Z"},
    {"role": "assistant", "text": "A code block:\n\n```md\n## You\nstill code\n```\n\nThat's all.",
     "at": "2026-11-05T12:00:04.000Z"},
]


def clean(root: Path) -> bool:
    return git(root, "status", "--porcelain", "--untracked-files=all").strip() == ""


def sse(base: str, body: dict[str, Any]) -> tuple[int, str, list[dict]]:
    """POST /ai/chat; (status, raw text, events)."""
    req = urllib.request.Request(base + "/ai/chat", data=json.dumps(body).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "text/event-stream")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode("utf-8")
            code = r.status
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace"), []
    events = []
    for frame in raw.split("\n\n"):
        data = [line[5:].lstrip(" ") for line in frame.split("\n") if line.startswith("data:")]
        if data:
            events.append(json.loads("\n".join(data)))
    return code, raw, events


def runs(log: Path) -> list[dict]:
    if not log.exists():
        return []
    return [json.loads(x) for x in log.read_text(encoding="utf-8").splitlines() if x]


def first_page(root: Path) -> str | None:
    for p in sorted(root.rglob("*.md")):
        rel = p.relative_to(root).as_posix()
        if rel.startswith((".", "Templates/")):
            continue
        return rel
    return None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path)
    ap.add_argument("--keep", action="store_true", help="keep the temporary copy")
    args = ap.parse_args(argv)
    src = args.space.resolve()
    if not src.is_dir():
        ap.error(f"Not a folder: {src}")

    tmp = Path(tempfile.mkdtemp(prefix="m10-acceptance-")).resolve()
    root = tmp / src.name
    shutil.copytree(src, root, ignore=shutil.ignore_patterns(".git", ".object-cache"))
    saved_env = {k: os.environ.get(k) for k in HOOKS}
    log = tmp / "claude-log.jsonl"
    os.environ.update({
        "OBJECT_STATE_DIR": str(tmp / "state"),
        "OBJECT_CACHE_DIR": str(tmp / "cache"),
        "FAKE_CLAUDE_LOG": str(log),
    })
    fake = install(tmp / "bin")
    git(root, "init", "-q")
    commit(root, "base")
    Space(root)  # a space from before M2 is migrated on its first open; commit that
    commit(root, "opened once")

    served: Served | None = None
    run: Run | None = None
    try:
        served = Served(root)
        run = Run(root, served.http)
        base = served.base
        print(f"Space copy: {root}\nServed at: {base}\nFake claude: {fake}")

        print("\n1. Status")
        _, current = run.http("GET", "/settings")
        code, _ans = run.http("PUT", "/settings", {"patch": {"claudePath": str(fake)},
                                                 "baseRevision": current["revision"]})
        run.report(code == 200, f"claudePath set through PUT /api/settings: {code}")
        code, status = run.http("GET", "/ai/status")
        run.report(code == 200 and status.get("reason") == "ok" and status.get("available") is True,
                   f"status: {status}")

        print("\n2. A turn over HTTP")
        page = first_page(root)
        code, raw, events = sse(base, {"mode": "chat", "prompt": "FAKE:tool What is here?",
                                       "contextPaths": [page] if page else [], "history": []})
        kinds = [e["type"] for e in events]
        run.report(code == 200 and kinds[:1] == ["session"] and "text" in kinds and kinds[-1:] == ["done"],
                   f"chat streams session, text, done: {kinds}")
        run.report("\r" not in raw and raw.startswith("data: "), "frames are 'data: <json>' + blank line")
        run.report(any(e["type"] == "tool" and e.get("name") == "search" for e in events),
                   "the MCP tool use is reported by short name")
        done = events[-1] if events else {}
        run.report(done.get("text") == "Hello from the fake claude." and done.get("sessionId") == events[0].get("sessionId"),
                   f"done carries the answer and the session: {done.get('text')!r}")
        code, _raw, tag_events = sse(base, {"mode": "tagObject", "prompt": "FAKE:tags",
                                           "contextPaths": [page] if page else [], "history": []})
        proposal = tag_events[-1].get("proposal") if tag_events else None
        run.report(proposal == {"kind": "tags", "tags": ["Math", "history", "Ideas"]},
                   f"tag turn proposes tags: {proposal}")
        logged = runs(log)
        cli = logged[0] if logged else {}
        argv_ = cli.get("argv", [])
        allowed = set(argv_[argv_.index("--allowedTools") + 1].split(",")) if "--allowedTools" in argv_ else set()
        denied = set(argv_[argv_.index("--disallowedTools") + 1].split(",")) if "--disallowedTools" in argv_ else set()
        run.report(allowed == {f"mcp__object__{t}" for t in READ_TOOLS}, "allowed tools: the MCP read tools only")
        run.report({"Read", "Write", "Edit", "Bash", "WebFetch"} <= denied, "Read, Write, Edit, Bash, WebFetch denied")
        cwd = Path(cli.get("cwd", str(root))).resolve()
        run.report(cli.get("cwdEntries") == [] and root not in (cwd, *cwd.parents),
                   f"ran in an empty folder outside the space: {cwd}")
        server = (cli.get("mcpConfig") or {}).get("mcpServers", {}).get("object", {})
        run.report(server.get("args") == ["-m", "objectapp.mcp_server", "--read-only"]
                   and server.get("env", {}).get("OBJECT_API_TOKEN") == "${OBJECT_API_TOKEN}",
                   "MCP config: objectapp-mcp --read-only, no secret in the file")

        print("\n3. Nothing written, token gone")
        run.report(clean(root), "the turns changed no file (git status clean)", git(root, "status", "--short"))
        tokens = [r.get("token") for r in logged if r.get("token")]
        leaked = [
            p for folder in (root, tmp / "state") for p in folder.rglob("*")
            if p.is_file() and ".git" not in p.parts and any(t.encode() in p.read_bytes() for t in tokens)
        ]
        run.report(tokens and not leaked, "no file in the space or state dir holds a turn token", *map(str, leaked))
        refused = []
        for token in tokens:
            req = urllib.request.Request(base + "/v1/whoami", headers={"Authorization": f"Bearer {token}"})
            try:
                urllib.request.urlopen(req, timeout=10)
                refused.append(200)
            except urllib.error.HTTPError as e:
                refused.append(e.code)
        run.report(refused and set(refused) == {401}, f"turn tokens refused after the turn: {refused}")

        print("\n4. Saved chats")
        code, made = run.http("POST", "/ai/chat/save", {
            "title": "", "contextPaths": [page] if page else [], "sessionId": SESSION_1,
            "messages": MESSAGES, "clientId": "acceptance"})
        run.report(code == 200, f"save: {made}")
        status_lines = sorted(git(root, "status", "--porcelain", "--untracked-files=all").splitlines())
        added = sorted(line[3:].strip('"') for line in status_lines)
        expected = sorted([".object/types/ai-chat.json", made.get("path", "?")]) if code == 200 else []
        run.report(added == expected and all(line.startswith("??") for line in status_lines),
                   f"exactly the AI Chat type file and one chat file: {added}")
        if code == 200:
            code, loaded = run.http("GET", "/ai/chat", path=made["path"])
            run.report(code == 200 and loaded["messages"] == MESSAGES and loaded["sessionId"] == SESSION_1
                       and loaded["title"] == "What do my notes say?"
                       and loaded["contextPaths"] == ([page] if page else []),
                       "load gives the messages, title, session and context back")
            more = [*MESSAGES, {"role": "user", "text": "And then?", "at": "2026-11-05T12:01:00.000Z"}]
            code, saved = run.http("POST", "/ai/chat/save", {
                "path": made["path"], "baseVersion": made["version"], "title": "", "contextPaths": [],
                "sessionId": SESSION_2, "messages": more, "clientId": "acceptance"})
            run.report(code == 200 and saved["path"] == made["path"], f"second save: {code}")
            _, again = run.http("GET", "/ai/chat", path=made["path"])
            run.report(again["messages"] == more and again["sessionId"] == SESSION_2, "the messages were replaced")
            before = (root / made["path"]).read_bytes()
            code, stale = run.http("POST", "/ai/chat/save", {
                "path": made["path"], "baseVersion": made["version"], "title": "", "contextPaths": [],
                "sessionId": None, "messages": MESSAGES})
            run.report(code == 409 and stale.get("currentVersion") == saved.get("version")
                       and (root / made["path"]).read_bytes() == before,
                       f"a stale version answers 409 and changes nothing: {code}")

        print("\n5. Hide AI features")
        _, current = run.http("GET", "/settings")
        run.http("PUT", "/settings", {"patch": {"aiHidden": True}, "baseRevision": current["revision"]})
        code, _raw, _events = sse(base, {"mode": "chat", "prompt": "hi", "contextPaths": [], "history": []})
        run.report(code == 403, f"POST /api/ai/chat with AI hidden: {code}")
    finally:
        if served is not None:
            served.stop()
        for k, v in saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        if args.keep:
            print(f"\nKept: {tmp}")
        else:
            remove_tree(tmp)

    failures = run.failures if run else 1
    print("\nRESULT:", "PASS" if failures == 0 else f"FAIL ({failures})")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
