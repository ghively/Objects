"""Milestone 17 acceptance run: agents, agent folders, the turn runner's fence and the expanded tools.

Usage: ``uv run python scripts/m17_acceptance.py SPACE [--keep]``

Copies SPACE to a temporary folder (SPACE itself is never touched), commits the copy to a
throw-away git repo (again after one open, which migrates an old space) and serves it with
``create_app`` on a free ``127.0.0.1`` port. ``OBJECT_STATE_DIR`` and ``OBJECT_CACHE_DIR``
point at temporary folders and ``FAKE_CLAUDE_LOG`` at a log file. No model runs: the
``claudePath`` setting points at ``backend/tests/fake_claude.py``. One page of the copy is
marked "Exclude from AI" through ``PUT /api/object/properties`` (its body carries a marker
text) and committed. Checks:

 1. ``GET /api/agents`` lists Assistant with ``exists: false``; the state dir holds no
    ``agents.json`` and no ``agents/``;
 2. a chat turn streams ``chat``, ``session``, ``text``, ``done`` and creates
    ``<state>/agents/Assistant/`` with the skeleton; the fake ran there with
    ``--setting-sources project,local``, ``--permission-mode dontAsk``,
    ``--permission-prompts none`` and ``--strict-mcp-config``; ``appendPrompt`` holds the
    guidance; Bash/PowerShell are disallowed; ``mcp__object__write_body`` is allowed; no
    ``CLAUDE_CONFIG_DIR``; the MCP config holds no secret;
 3. the fence: ``runSettings.permissions.deny`` holds ``Read(<rp space>/**)`` and
    ``Edit(<rp space>/**)``; Read of the excluded page, Grep and Glob of the space and Write
    of a page are denied and the marker is in no frame; Read of a file outside every fence works;
 4. ``POST /api/agents`` "Researcher" (shell on, Object write off), then a turn: it ran in
    Researcher's folder, Bash is allowed, no Object write tool is allowed, the default
    agent's folder is fenced; the transcript has header, user and assistant lines and
    ``GET .../chats`` lists it;
 5. the expanded tools through ``/api/v1`` with a read-write token: ``write_body``,
    ``open_daily_note``, ``create_type`` + ``delete_type`` (to the Trash) and
    ``version_history`` work; every new route given the excluded page answers 404 or leaves
    it out; no answer holds its marker;
 6. a ``tagObject`` turn runs read-only (``--read-only``, a ``read`` token) and answers a
    tags proposal;
 7. saving the chat adds the "Agent" property to the AI Chat type and writes one chat file
    whose ``agent:`` is "Assistant";
 8. agent folders: deleting Researcher moves it to ``<state>/agents/.trash/`` and restore
    puts it back; a copy added from a folder outside the state dir and then deleted is only
    unregistered, its files byte-identical; ``DELETE /api/agents/assistant`` answers 422;
 9. ``git status`` of the copy shows only the AI Chat type file, the chat file, the daily
    note, ``write_body``'s object and the Trash entries (the type made and deleted).

Each check prints ``[ok]`` or ``[FAIL]``; exits non-zero on any failure.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from m2_acceptance import Run, commit, git, remove_tree
from m8_acceptance import Served
from m10_acceptance import runs, sse
from objectapp import toolcatalog
from objectapp.agentrun import OBJECT_GUIDANCE, rule_path
from objectapp.ids import new_ulid
from objectapp.space import Space

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend" / "tests"))
from fake_claude import install

HOOKS = ("OBJECT_STATE_DIR", "OBJECT_CACHE_DIR", "FAKE_CLAUDE_LOG")
MARKER = "M17-ACCEPTANCE-HIDDEN-7Q2X"
DENIED = "has been denied"
SKELETON = ("CLAUDE.md", ".claude/settings.json", ".object-agent/agent.json", ".object-agent/sessions", ".gitignore")


def pages(root: Path) -> list[str]:
    out = []
    for p in sorted(root.rglob("*.md")):
        rel = p.relative_to(root).as_posix()
        if rel.startswith((".", "Templates/")) or "/Templates/" in rel:
            continue
        out.append(rel)
    return out


class V1:
    """``/api/v1`` with a bearer token."""

    def __init__(self, base: str, secret: str) -> None:
        self.base = base
        self.secret = secret

    def __call__(self, method: str, route: str, payload: Any = None, **query: Any) -> tuple[int, Any]:
        q = {k: v for k, v in query.items() if v is not None}
        url = self.base + "/v1" + route + ("?" + urllib.parse.urlencode(q) if q else "")
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.secret}")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            body = e.read()
            try:
                return e.code, json.loads(body or b"null")
            except ValueError:
                return e.code, body.decode(errors="replace")


def whoami(base: str, token: str) -> tuple[int, Any]:
    return V1(base, token)("GET", "/whoami")


def tree_bytes(folder: Path) -> dict[str, bytes]:
    return {p.relative_to(folder).as_posix(): p.read_bytes() for p in sorted(folder.rglob("*")) if p.is_file()}


def chat(base: str, prompt: str, *, agent: str | None = None, mode: str = "chat",
         paths: list[str] | None = None) -> tuple[int, str, list[dict]]:
    body: dict[str, Any] = {"mode": mode, "prompt": prompt, "contextPaths": paths or [], "history": []}
    if agent is not None:
        body["agentId"] = agent
    return sse(base, body)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path)
    ap.add_argument("--keep", action="store_true", help="keep the temporary copy")
    args = ap.parse_args(argv)
    src = args.space.resolve()
    if not src.is_dir():
        ap.error(f"Not a folder: {src}")

    tmp = Path(tempfile.mkdtemp(prefix="m17-acceptance-")).resolve()
    root = tmp / src.name
    state = tmp / "state"
    shutil.copytree(src, root, ignore=shutil.ignore_patterns(".git", ".object-cache"))
    saved_env = {k: os.environ.get(k) for k in HOOKS}
    log = tmp / "claude-log.jsonl"
    os.environ.update({
        "OBJECT_STATE_DIR": str(state),
        "OBJECT_CACHE_DIR": str(tmp / "cache"),
        "FAKE_CLAUDE_LOG": str(log),
    })
    fake = install(tmp / "bin")
    outside = tmp / "outside"
    outside.mkdir()
    (outside / "note.txt").write_text("Outside every fence.\n", encoding="utf-8")
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

        _, current = run.http("GET", "/settings")
        run.http("PUT", "/settings", {"patch": {"claudePath": str(fake)}, "baseRevision": current["revision"]})
        all_pages = pages(root)
        hidden, edited = all_pages[0], all_pages[1]
        obj = run.obj(hidden)
        code, saved = run.http("PUT", "/object/body", {"path": hidden, "baseVersion": obj["version"],
                                                       "body": f"{MARKER} secret text.\n"})
        code2, marked = run.http("PUT", "/object/properties", {
            "path": hidden, "updates": {"excludeFromAI": True}, "baseVersion": saved.get("version", "")})
        commit(root, "exclude one page")
        print(f"Excluded page: {hidden} ({code}, {code2})")
        if code2 != 200:
            print(f"  could not mark the page: {marked}")

        print("\n1. Agents before any use")
        code, listed = run.http("GET", "/agents")
        agents = listed.get("agents", []) if code == 200 else []
        first = agents[0] if agents else {}
        run.report(first.get("id") == "assistant" and first.get("name") == "Assistant" and first.get("exists") is False,
                   f"Assistant listed first with exists: false: {[(a['name'], a['exists']) for a in agents]}")
        run.report(not (state / "agents.json").exists() and not (state / "agents").exists(),
                   "no agents.json and no agents/ in the state dir")

        print("\n2. A chat turn")
        code, raw, events = chat(base, "FAKE:tool What is here?")
        kinds = [e["type"] for e in events]
        run.report(code == 200 and kinds[:2] == ["chat", "session"] and "text" in kinds and kinds[-1:] == ["done"],
                   f"streams chat, session, text, done: {kinds}")
        chat_event = events[0] if events else {}
        home = (state / "agents" / "Assistant").resolve()
        run.report(all((home / name).exists() for name in SKELETON),
                   f"{home} has the skeleton", *[n for n in SKELETON if not (home / n).exists()])
        cli = runs(log)[-1] if runs(log) else {}
        argv_ = cli.get("argv", [])

        def flag(name: str) -> str | None:
            return argv_[argv_.index(name) + 1] if name in argv_ and argv_.index(name) + 1 < len(argv_) else None

        run.report(Path(cli.get("cwd", "")).resolve() == home, f"ran in {cli.get('cwd')}")
        run.report(cli.get("settingSources") == "project,local" and flag("--permission-mode") == "dontAsk"
                   and flag("--permission-prompts") == "none" and "--strict-mcp-config" in argv_,
                   "--setting-sources project,local, --permission-mode dontAsk, --permission-prompts none, "
                   "--strict-mcp-config")
        append = cli.get("appendPrompt") or ""
        guidance = OBJECT_GUIDANCE.format(agent="Assistant", space=served.space.name)
        run.report(guidance in append, f"appendPrompt holds the guidance ({len(append)} characters)")
        allowed, disallowed = set(cli.get("allowed") or []), set(cli.get("disallowed") or [])
        run.report({"Bash", "PowerShell"} <= disallowed and "mcp__object__write_body" in allowed,
                   "Bash/PowerShell disallowed, mcp__object__write_body allowed")
        servers_cfg = (cli.get("mcpConfig") or {}).get("mcpServers") or {}
        others = json.dumps({k: v for k, v in servers_cfg.items() if k not in ("object", "object-agent")})
        run.report(cli.get("env", {}).get("CLAUDE_CONFIG_DIR") is False
                   and cli.get("token") and cli.get("envToken") is False and cli["token"] not in others
                   and all((servers_cfg.get(n) or {}).get("env", {}).get("OBJECT_API_TOKEN") == cli["token"]
                           for n in ("object", "object-agent")),
                   "no CLAUDE_CONFIG_DIR; the token only in Object's two servers' env blocks, not the CLI's env")

        print("\n3. The fence")
        deny = ((cli.get("runSettings") or {}).get("permissions") or {}).get("deny") or []
        rp = rule_path(root)
        run.report(f"Read({rp}/**)" in deny and f"Edit({rp}/**)" in deny, f"deny holds Read/Edit({rp}/**)")
        probes = {
            "Read of the excluded page": f"FAKE:read:{root / hidden}",
            "Grep of the space": f"FAKE:grep:{root}",
            "Glob of the space": f"FAKE:glob:{root}",
            "Write of a page": f"FAKE:write:{root / edited}",
        }
        for label, marker in probes.items():
            code, raw, events = chat(base, marker)
            results = [e for e in events if e["type"] == "tool" and "result" in e]
            run.report(code == 200 and results and all(e.get("isError") and DENIED in str(e.get("result"))
                                                       for e in results) and MARKER not in raw,
                       f"{label} is denied and the marker is in no frame",
                       *[str(e.get("result"))[:120] for e in results])
        code, raw, events = chat(base, f"FAKE:read:{outside / 'note.txt'}")
        results = [e for e in events if e["type"] == "tool" and "result" in e]
        run.report(bool(results) and not results[0].get("isError") and "Outside every fence" in str(results[0].get("result")),
                   "Read of a file outside every fence works")

        print("\n4. A second agent")
        write_off = [f"mcp__{toolcatalog.OBJECT_SERVER}__{t}" for t in toolcatalog.OBJECT_WRITE]
        code, researcher = run.http("POST", "/agents", {
            "agent": {"name": "Researcher", "toolsOff": write_off},
            "instructions": "You are Researcher. You look things up.", "location": None,
            "clientId": "acceptance"})
        run.report(code == 201 and researcher.get("name") == "Researcher", f"POST /api/agents: {code}")
        rid = researcher.get("id", "?")
        rfolder = Path(researcher.get("folder", str(tmp / "missing"))).resolve()
        code, raw, events = chat(base, "Hello Researcher", agent=rid)
        cli = runs(log)[-1] if runs(log) else {}
        allowed = set(cli.get("allowed") or [])
        run.report(Path(cli.get("cwd", "")).resolve() == rfolder, f"ran in Researcher's folder: {cli.get('cwd')}")
        run.report("Bash" in allowed, "Bash is allowed (shell on)")
        run.report(not any(f"mcp__object__{t}" in allowed for t in toolcatalog.OBJECT_WRITE),
                   "no Object write tool is allowed")
        deny = ((cli.get("runSettings") or {}).get("permissions") or {}).get("deny") or []
        run.report(f"Read({rule_path(home)}/**)" in deny, "the default agent's folder is fenced")
        rchat = next((e for e in events if e["type"] == "chat"), {}).get("chatId", "?")
        file = rfolder / ".object-agent" / "sessions" / f"{rchat}.jsonl"
        lines = [json.loads(x) for x in file.read_text(encoding="utf-8").splitlines()] if file.is_file() else []
        # M18: a chat's first run also writes the frozen memory snapshot line.
        run.report([x.get("type") for x in lines] == ["chat", "user", "memory", "assistant"],
                   f"transcript lines: {[x.get('type') for x in lines]}")
        code, chats = run.http("GET", f"/agents/{rid}/chats")
        run.report(code == 200 and [c["id"] for c in chats.get("chats", [])] == [rchat],
                   f"GET /api/agents/{{id}}/chats lists it: {code}")

        print("\n5. Expanded tools through /api/v1")
        code, made = run.http("POST", "/integrations/tokens", {"name": "acceptance agent", "scope": "read-write"})
        v1 = V1(base, made.get("secret", ""))
        code, page = v1("GET", "/object", path=edited)
        code, wrote = v1("POST", "/object/body", {"path": edited, "version": page.get("version"),
                                                  "body": "Written by the M17 acceptance run.\n"})
        run.report(code == 200 and run.text(edited).endswith("Written by the M17 acceptance run.\n"),
                   f"write_body: {code}")
        code, daily = v1("POST", "/daily-notes", {"date": "2026-11-06"})
        run.report(code == 200 and daily.get("created") is True and (root / daily.get("path", "?")).is_file(),
                   f"open_daily_note: {code} {daily.get('path')}")
        code, typ = v1("POST", "/types", {"name": "Specimen", "pluralName": "Specimens"})
        tid = typ.get("id") if isinstance(typ, dict) else None
        code2, gone = v1("DELETE", f"/types/{tid}", confirm="true")
        run.report(code == 201 and code2 == 200 and bool(gone.get("trashId")),
                   f"create_type + delete_type (to the Trash): {code}, {code2}")
        code, versions = v1("GET", "/history", path=edited)
        run.report(code == 200 and len(versions.get("versions", [])) >= 1,
                   f"version_history: {code}, {len(versions.get('versions', []))} versions")
        v = page.get("version")
        _, page2 = v1("GET", "/object", path=edited)
        v2 = page2.get("version")
        hidden_calls = {
            "read": v1("GET", "/object", path=hidden),
            "version_history": v1("GET", "/history", path=hidden),
            "read_version": v1("GET", "/history/version", path=hidden, id=new_ulid()),
            "unlinked_mentions": v1("GET", "/references", path=hidden),
            "read_whiteboard": v1("GET", "/whiteboard", path=hidden),
            "write_body": v1("POST", "/object/body", {"path": hidden, "version": "x", "body": "x"}),
            "remove_tags": v1("POST", "/object/properties", {"path": hidden, "version": "x",
                                                             "subtract": {"tags": ["x"]}}),
            "duplicate": v1("POST", "/object/duplicate", {"path": hidden}),
            "change_type": v1("POST", "/object/change-type", {"path": hidden, "version": "x", "type": "Page"}),
            "merge (source)": v1("POST", "/object/merge", {"source": hidden, "target": edited,
                                                           "sourceVersion": "x", "targetVersion": v2}),
            "merge (target)": v1("POST", "/object/merge", {"source": edited, "target": hidden,
                                                           "sourceVersion": v2, "targetVersion": "x"}),
            "link_mention": v1("POST", "/references/link", {"path": hidden, "version": "x", "target": edited,
                                                            "start": 0, "end": 1, "text": "x"}),
            "restore_version": v1("POST", "/history/restore", {"path": hidden, "versionId": "x", "version": "x"}),
        }
        del v
        bad = {k: c for k, (c, _b) in hidden_calls.items() if c != 404}
        run.report(not bad, "every route given the excluded page answers 404", *[f"{k}: {c}" for k, c in bad.items()])
        listed = {
            "search": v1("GET", "/search", q=MARKER),
            "trash": v1("GET", "/trash"),
            "backlinks": v1("GET", "/object/backlinks", path=edited),
            "unlinked_mentions": v1("GET", "/references", path=edited),
        }
        everything = json.dumps({**{k: b for k, (_c, b) in hidden_calls.items()},
                                 **{k: b for k, (_c, b) in listed.items()}}, default=str)
        run.report(MARKER not in everything and hidden not in json.dumps(listed["trash"][1]),
                   "no answer holds the marker; the trash leaves the page out")

        print("\n6. A proposal turn runs read-only")
        go = Path(str(log) + ".go")
        go.unlink(missing_ok=True)
        before = len(runs(log))
        box: dict[str, Any] = {}
        th = threading.Thread(target=lambda: box.update(
            r=chat(base, "FAKE:wait FAKE:tags", mode="tagObject", paths=[edited])))
        th.start()
        deadline = time.monotonic() + 30
        while len(runs(log)) == before and time.monotonic() < deadline:
            time.sleep(0.05)
        cli = runs(log)[-1] if len(runs(log)) > before else {}
        scope = whoami(base, cli.get("token") or "-")
        go.write_text("go", encoding="utf-8")
        th.join(timeout=60)
        _code, _raw, events = box.get("r", (0, "", []))
        server = (cli.get("mcpConfig") or {}).get("mcpServers", {}).get("object", {})
        run.report("--read-only" in (server.get("args") or []), f"objectapp-mcp args: {server.get('args')}")
        run.report(scope[0] == 200 and scope[1].get("scope") == "read", f"the turn's token: {scope}")
        proposal = events[-1].get("proposal") if events else None
        run.report(proposal == {"kind": "tags", "tags": ["Math", "history", "Ideas"]}, f"tags proposal: {proposal}")

        print("\n7. Saving the chat")
        code, made = run.http("POST", "/ai/chat/save", {
            "title": "", "contextPaths": [], "sessionId": None, "agentId": "assistant",
            "chatId": chat_event.get("chatId"), "clientId": "acceptance",
            "messages": [{"role": "user", "text": "What is here?", "at": "2026-11-06T12:00:00.000Z"},
                         {"role": "assistant", "text": "Hello from the fake claude.", "at": "2026-11-06T12:00:04.000Z"}]})
        chat_path = made.get("path", "?") if code == 200 else "?"
        chat_type = run.type_named("AI Chat") or {}
        names = [p.get("name") for p in chat_type.get("propertyDefinitions", [])]
        run.report(code == 200 and "Agent" in names, f"the AI Chat type has an Agent property: {names}")
        text = run.text(chat_path) if (root / chat_path).is_file() else ""
        run.report("\nagent: Assistant" in text.replace("\r\n", "\n"), f"{chat_path} has agent: Assistant")

        print("\n8. Agent folders")
        code, gone = run.http("DELETE", f"/agents/{rid}", clientId="acceptance")
        trash_id = gone.get("trashId") if isinstance(gone, dict) else None
        run.report(code == 200 and bool(trash_id) and (state / "agents" / ".trash" / str(trash_id)).is_dir()
                   and not rfolder.exists(), f"delete moves Researcher to the agent trash: {code} {trash_id}")
        code, back = run.http("POST", f"/agent-trash/{trash_id}/restore", {"clientId": "acceptance"})
        run.report(code == 200 and rfolder.is_dir() and file.is_file(), f"restore puts it back with its chats: {code}")
        elsewhere = tmp / "elsewhere" / "Researcher copy"
        shutil.copytree(rfolder, elsewhere)
        meta = elsewhere / ".object-agent" / "agent.json"
        data = json.loads(meta.read_text(encoding="utf-8"))
        data["id"] = new_ulid()
        meta.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        snapshot = tree_bytes(elsewhere)
        code, added = run.http("POST", "/agents/add-folder", {"path": str(elsewhere), "clientId": "acceptance"})
        code2, gone = run.http("DELETE", f"/agents/{data['id']}", clientId="acceptance")
        run.report(code == 201 and added.get("inStateDir") is False and code2 == 200 and gone.get("trashId") is None
                   and tree_bytes(elsewhere) == snapshot,
                   f"a folder outside the state dir is only unregistered, bytes unchanged: {code}, {code2}")
        code, refused = run.http("DELETE", "/agents/assistant")
        run.report(code == 422, f"DELETE /api/agents/assistant: {code} {refused}")

        print("\n9. Files changed in the space")
        status = git(root, "status", "--porcelain", "--untracked-files=all").splitlines()
        changed = sorted(line[3:].strip('"') for line in status)
        expected = {".object/types/ai-chat.json", chat_path, daily.get("path", "?"), edited}
        extra = [p for p in changed if p not in expected and not p.startswith(".object/trash/")]
        missing = sorted(expected - set(changed))
        trash = [p for p in changed if p.startswith(".object/trash/")]
        run.report(not extra and not missing and bool(trash), f"{len(changed)} paths changed",
                   *[f"extra: {p}" for p in extra], *[f"missing: {p}" for p in missing])
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
