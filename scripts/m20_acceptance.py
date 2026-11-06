"""Milestone 20 acceptance run: remote agents over A2A (outbound) and delegation.

Usage: ``uv run python scripts/m20_acceptance.py SPACE [--keep]``

Copies SPACE to a temporary folder (SPACE itself is never touched), commits the copy to a
throw-away git repo (again after one open, which migrates an old space) and serves it with
``create_app`` on a free ``127.0.0.1`` port. ``OBJECT_STATE_DIR``, ``OBJECT_CACHE_DIR`` and
``FAKE_CLAUDE_LOG`` point at temporary paths. No model runs: the ``claudePath`` setting points at
``backend/tests/fake_claude.py``. Two synthetic A2A 1.0 agents run on ``127.0.0.1``
(``backend/tests/fake_a2a.py``): "Fake Planner" (streaming, a bearer token) and "Fake Notes" (no
streaming, no auth). One page of the copy is marked "Exclude from AI" through
``PUT /api/object/properties`` (its body carries a marker line) and another visible page carries a
second marker; both are committed. The app's log goes to a temporary file and every API answer is
recorded. Checks:

 1. ``POST /api/remote-agents/preview`` with Fake Planner's base URL and the bearer answers its
    card; the state dir is unchanged;
 2. adding both: ``GET /api/agents`` lists them with ``kind: "remote"``; the token is in no file
    of the state dir but ``secrets.json``, in no API answer and in no line of the app's log;
 3. a chat turn with Fake Planner streams ``chat``, ``text`` and ``done``; the fake logged
    ``SendStreamingMessage`` with ``A2A-Version: 1.0`` and the bearer; the transcript is in
    ``<state>/agents/Fake Planner/.object-agent/sessions/``;
 4. multi-turn: turn 2 carries turn 1's ``contextId``; ``A2A:input`` answers "Which date?"; the
    next turn carries its ``taskId`` and answers "Booked for …";
 5. a Fake Notes turn uses ``SendMessage``;
 6. ``A2A:file`` saves ``files/<chatId>/plan.md`` and sends an ``attachment`` event; ``A2A:data``
    gives a ``json`` code block;
 7. context: a turn with context chips answers 428 before the notice; after
    ``POST …/context-notice``, ``A2A:echo-parts`` with the visible and the excluded page answers
    the visible page's marker; the excluded page's marker is in no request the fake logged and
    ``done.skipped`` lists it;
 8. delegation through ``/api/v1/agent/*`` with the caller's turn token minted in-process
    (``TokenStore.ephemeral``, as the chat route does): a local "Researcher" runs a ``delegate``
    call in its own folder and the chat is listed with ``delegated: true, from: "assistant"``;
    ``FAKE:long:30000`` gives a 24,000-character summary + "…"; three ``FAKE:wait`` delegations at
    once plus a fourth answer 429 for the fourth; the delegated run's own token answers 403 on
    ``/delegate``; ``delegate`` to Fake Planner answers its text and its chat is marked delegated;
 9. ``remote_agents_list`` and ``remote_agent_call`` through the routes; ``remote_agent_call``
    with ``A2A:slow:5`` and ``timeoutSeconds: 1`` answers 504 and the fake logged ``CancelTask``;
10. ``DELETE /api/agents/<Fake Planner>`` moves its folder to ``<state>/agents/.trash/``; restore
    puts it back with ``remote.auth.set`` true;
11. saving the Fake Planner chat (``POST /api/ai/chat/save``) writes one AI Chat whose ``agent:``
    is "Fake Planner"; ``git status`` of the copy shows only that file and the AI Chat type file.

Each check prints ``[ok]`` or ``[FAIL]``; ``RESULT: PASS`` at the end; exits non-zero on any
failure. Both fakes and the server are stopped in ``finally``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
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

from m2_acceptance import Http, Run, commit, git, remove_tree
from m8_acceptance import Served
from m10_acceptance import runs, sse
from objectapp.remotemodel import DELEGATE_SUMMARY_CAP
from objectapp.space import Space
from objectapp.tokens import TokenStore

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend" / "tests"))
from fake_a2a import FakeA2A
from fake_claude import install

HOOKS = ("OBJECT_STATE_DIR", "OBJECT_CACHE_DIR", "FAKE_CLAUDE_LOG")
TOKEN = "acc-TOKEN-7f3a"
HIDDEN_MARKER = "M20-ACCEPTANCE-HIDDEN-4K8W"
VISIBLE_MARKER = "M20-ACCEPTANCE-VISIBLE-9J2P"
CLIENT = "acceptance"


class Recorder(Http):
    """`Http` that keeps every answer body (check 2)."""

    def __init__(self, base: str) -> None:
        super().__init__(base)
        self.bodies: list[str] = []

    def __call__(self, method: str, route: str, payload: Any = None, **query: Any) -> tuple[int, Any]:
        code, body = super().__call__(method, route, payload, **query)
        self.bodies.append(json.dumps(body, default=str))
        return code, body


class V1:
    """``/api/v1`` with a bearer token and a long timeout (a delegation may take minutes)."""

    def __init__(self, base: str, secret: str, bodies: list[str]) -> None:
        self.base = base
        self.secret = secret
        self.bodies = bodies

    def __call__(self, method: str, route: str, payload: Any = None) -> tuple[int, Any]:
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(self.base + "/v1" + route, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.secret}")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=300) as r:  # noqa: S310 - 127.0.0.1
                code, raw = r.status, r.read()
        except urllib.error.HTTPError as e:
            code, raw = e.code, e.read()
        self.bodies.append(raw.decode("utf-8", "replace"))
        try:
            return code, json.loads(raw or b"null")
        except ValueError:
            return code, raw.decode("utf-8", "replace")


def tree_hash(folder: Path) -> dict[str, str]:
    if not folder.exists():
        return {}
    return {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(folder.rglob("*")) if p.is_file()}


def pages(root: Path) -> list[str]:
    out = []
    for p in sorted(root.rglob("*.md")):
        rel = p.relative_to(root).as_posix()
        if rel.startswith((".", "Templates/")) or "/Templates/" in rel:
            continue
        out.append(rel)
    return out


def rpc_calls(fake: FakeA2A, method: str) -> list[dict]:
    return [r for r in list(fake.requests) if r.get("rpc") == method]


def sent_messages(fake: FakeA2A) -> list[dict]:
    return [r.get("params", {}).get("message") or {} for r in list(fake.requests)
            if r.get("rpc") in ("SendMessage", "SendStreamingMessage")]


def header(entry: dict, name: str) -> str | None:
    return next((v for k, v in (entry.get("headers") or {}).items() if k.lower() == name.lower()), None)


def text_of(events: list[dict]) -> str:
    return "".join(str(e.get("text", "")) for e in events if e.get("type") == "text")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path)
    ap.add_argument("--keep", action="store_true", help="keep the temporary copy")
    args = ap.parse_args(argv)
    src = args.space.resolve()
    if not src.is_dir():
        ap.error(f"Not a folder: {src}")

    tmp = Path(tempfile.mkdtemp(prefix="m20-acceptance-")).resolve()
    root = tmp / src.name
    state = tmp / "state"
    shutil.copytree(src, root, ignore=shutil.ignore_patterns(".git", ".object-cache"))
    saved_env = {k: os.environ.get(k) for k in HOOKS}
    log = tmp / "claude-log.jsonl"
    app_log = tmp / "app.log"
    os.environ.update({
        "OBJECT_STATE_DIR": str(state),
        "OBJECT_CACHE_DIR": str(tmp / "cache"),
        "FAKE_CLAUDE_LOG": str(log),
    })
    fake_claude = install(tmp / "bin")
    git(root, "init", "-q")
    commit(root, "base")
    Space(root)  # a space from before M2 is migrated on its first open; commit that
    commit(root, "opened once")

    handler = logging.FileHandler(app_log, encoding="utf-8")
    handler.setLevel(logging.DEBUG)
    root_logger = logging.getLogger()
    old_level = root_logger.level
    root_logger.addHandler(handler)
    root_logger.setLevel(logging.DEBUG)

    planner = FakeA2A(streaming=True, token=TOKEN, name="Fake Planner")
    notes = FakeA2A(streaming=False, name="Fake Notes")
    served: Served | None = None
    run: Run | None = None
    caller_secret: str | None = None
    try:
        planner_url = planner.start()
        notes_url = notes.start()
        served = Served(root)
        rec = Recorder(served.base)
        run = Run(root, rec)
        base = served.base
        print(f"Space copy: {root}\nServed at: {base}\nFake claude: {fake_claude}\n"
              f"Fake Planner: {planner_url}\nFake Notes: {notes_url}")

        _, current = run.http("GET", "/settings")
        run.http("PUT", "/settings", {"patch": {"claudePath": str(fake_claude)}, "baseRevision": current["revision"]})
        all_pages = pages(root)
        hidden, visible = all_pages[0], all_pages[1]
        obj = run.obj(hidden)
        code, saved = run.http("PUT", "/object/body", {"path": hidden, "baseVersion": obj["version"],
                                                       "body": f"{HIDDEN_MARKER} secret text.\n"})
        code2, _ = run.http("PUT", "/object/properties", {
            "path": hidden, "updates": {"excludeFromAI": True}, "baseVersion": saved.get("version", "")})
        obj = run.obj(visible)
        code3, _ = run.http("PUT", "/object/body", {"path": visible, "baseVersion": obj["version"],
                                                    "body": f"{VISIBLE_MARKER} shared text.\n"})
        commit(root, "exclude one page, mark another")
        print(f"Excluded page: {hidden} ({code}, {code2}); visible page: {visible} ({code3})")
        agents_dir = state / "agents"

        def chat(prompt: str, *, agent: str, chat_id: str | None = None,
                 paths: list[str] | None = None) -> tuple[int, str, list[dict]]:
            body: dict[str, Any] = {"mode": "chat", "prompt": prompt, "contextPaths": paths or [],
                                    "history": [], "agentId": agent}
            if chat_id is not None:
                body["chatId"] = chat_id
            code, raw, evs = sse(base, body)
            rec.bodies.append(raw)
            return code, raw, evs

        print("\n1. Preview")
        before = tree_hash(state)
        bearer = {"kind": "bearer", "value": TOKEN}
        code, preview = run.http("POST", "/remote-agents/preview", {"url": planner_url, "auth": bearer})
        card = preview.get("card", {}) if isinstance(preview, dict) else {}
        run.report(code == 200 and card.get("name") == "Fake Planner" and card.get("streaming") is True
                   and preview.get("endpointHost", "").startswith("127.0.0.1"),
                   f"the preview answers the card: {code} {card.get('name')} {preview.get('endpointHost')}")
        run.report(tree_hash(state) == before, "the preview wrote nothing in the state dir")

        print("\n2. Adding both")
        code, added = run.http("POST", "/remote-agents", {"url": planner_url, "auth": bearer, "name": None,
                                                          "clientId": CLIENT})
        pid = added.get("id", "?") if isinstance(added, dict) else "?"
        code2, added2 = run.http("POST", "/remote-agents", {"url": notes_url, "auth": {"kind": "none"},
                                                            "clientId": CLIENT})
        nid = added2.get("id", "?") if isinstance(added2, dict) else "?"
        run.report(code == 201 and code2 == 201 and (added.get("remote") or {}).get("auth", {}).get("set") is True,
                   f"POST /api/remote-agents: {code}, {code2}")
        _, listed = run.http("GET", "/agents")
        kinds = {a["name"]: a.get("kind") for a in listed.get("agents", [])}
        run.report(kinds.get("Fake Planner") == "remote" and kinds.get("Fake Notes") == "remote",
                   f"GET /api/agents lists them as remote: {kinds}")
        pfolder = agents_dir / "Fake Planner"
        run.report((pfolder / ".object-agent" / "agent.json").is_file()
                   and (pfolder / ".object-agent" / "card.json").is_file(),
                   f"{pfolder} holds agent.json and card.json")

        def token_leaks() -> list[str]:
            leaks = []
            for p in sorted(state.rglob("*")):
                if p.is_file() and p != state / "secrets.json" and TOKEN.encode() in p.read_bytes():
                    leaks.append(str(p))
            if not (state / "secrets.json").is_file() or TOKEN not in (state / "secrets.json").read_text("utf-8"):
                leaks.append("(secrets.json doesn't hold the token)")
            handler.flush()
            if TOKEN in app_log.read_text(encoding="utf-8", errors="replace"):
                leaks.append("app log")
            if any(TOKEN in b for b in rec.bodies):
                leaks.append("an API answer")
            return leaks

        leaks = token_leaks()
        run.report(not leaks, "the token is only in secrets.json", *leaks)

        print("\n3. A chat turn with Fake Planner")
        n_before = len(planner.requests)
        code, _raw, evs = chat("Hello planner", agent=pid)
        kinds_ = [e.get("type") for e in evs]
        chat1 = next((e.get("chatId") for e in evs if e.get("type") == "chat"), None)
        run.report(code == 200 and kinds_[:1] == ["chat"] and "text" in kinds_ and kinds_[-1:] == ["done"],
                   f"streams chat, text, done: {kinds_}")
        streams = [r for r in planner.requests[n_before:] if r.get("rpc") == "SendStreamingMessage"]
        ok = bool(streams) and header(streams[0], "A2A-Version") == "1.0" \
            and header(streams[0], "Authorization") == f"Bearer {TOKEN}"
        run.report(ok, "the fake logged SendStreamingMessage with A2A-Version: 1.0 and the bearer")
        transcript = pfolder / ".object-agent" / "sessions" / f"{chat1}.jsonl"
        run.report(transcript.is_file(), f"the transcript is {transcript}")

        print("\n4. Multi-turn")
        first_ctx = (sent_messages(planner) or [{}])[-1]
        reply1 = text_of(evs)
        code, _raw, evs = chat("Second turn", agent=pid, chat_id=chat1)
        msg2 = sent_messages(planner)[-1]
        run.report(code == 200 and bool(msg2.get("contextId")) and f"ctx={msg2.get('contextId')}" in reply1
                   and first_ctx.get("contextId") is None,
                   f"turn 2 carries turn 1's contextId: {msg2.get('contextId')}")
        code, _raw, evs = chat("A2A:input", agent=pid, chat_id=chat1)
        run.report("Which date?" in text_of(evs), f"A2A:input answers: {text_of(evs)[:80]!r}")
        code, _raw, evs = chat("Friday", agent=pid, chat_id=chat1)
        msg4 = sent_messages(planner)[-1]
        run.report(bool(msg4.get("taskId")) and "Booked for Friday" in text_of(evs),
                   f"the next turn carries the taskId ({msg4.get('taskId')}): {text_of(evs)[:80]!r}")

        print("\n5. Fake Notes")
        code, _raw, evs = chat("Hello notes", agent=nid)
        run.report(code == 200 and bool(rpc_calls(notes, "SendMessage")) and not rpc_calls(notes, "SendStreamingMessage")
                   and "Echo: Hello notes" in text_of(evs), f"a turn uses SendMessage: {text_of(evs)[:60]!r}")

        print("\n6. Artifacts")
        code, _raw, evs = chat("A2A:file", agent=pid)
        fchat = next((e.get("chatId") for e in evs if e.get("type") == "chat"), "?")
        att = [e for e in evs if e.get("type") == "attachment"]
        saved_file = pfolder / ".object-agent" / "files" / str(fchat) / "plan.md"
        run.report(bool(att) and att[0].get("attachment", {}).get("file") == f"{fchat}/plan.md"
                   and saved_file.is_file() and saved_file.read_bytes() == b"# Plan",
                   f"plan.md saved and announced: {[a.get('attachment') for a in att]}")
        code, _raw, evs = chat("A2A:data", agent=pid)
        run.report("```json" in text_of(evs) and '"rooms": 2' in text_of(evs), "A2A:data gives a json code block")

        print("\n7. Context")
        n_before = len(planner.requests)
        code, raw, _ = chat("A2A:echo-parts", agent=pid, paths=[visible, hidden])
        run.report(code == 428 and len(planner.requests) == n_before, f"context before the notice: {code} {raw[:120]}")
        code, noticed = run.http("POST", f"/remote-agents/{pid}/context-notice", {"clientId": CLIENT})
        run.report(code == 200 and bool(noticed.get("contextNoticeAt")), f"the notice is recorded: {noticed}")
        code, _raw, evs = chat("A2A:echo-parts", agent=pid, paths=[visible, hidden])
        done = evs[-1] if evs else {}
        skipped = [s.get("path") for s in done.get("skipped") or []]
        run.report(code == 200 and VISIBLE_MARKER in text_of(evs), "the visible page's marker came back")
        run.report(not any(HIDDEN_MARKER in json.dumps(r) for r in planner.requests) and hidden in skipped,
                   f"the excluded page's marker reached no request; skipped {skipped}")

        print("\n8. Delegation")
        code, _raw, evs = chat("Hello", agent="assistant")
        caller_chat = next((e.get("chatId") for e in evs if e.get("type") == "chat"), None)
        _record, caller_secret = TokenStore(root).ephemeral("Assistant", "read-write", agent="assistant",
                                                            chat=caller_chat, purpose="chat")
        v1 = V1(base, caller_secret, rec.bodies)
        code, researcher = run.http("POST", "/agents", {
            "agent": {"name": "Researcher"}, "instructions": "You are Researcher.", "location": None,
            "clientId": CLIENT})
        rid = researcher.get("id", "?")
        rfolder = Path(researcher.get("folder", str(tmp / "missing"))).resolve()
        n_runs = len(runs(log))
        code, res = v1("POST", "/agent/delegate", {"agent": "Researcher", "goal": "List my pages."})
        new = runs(log)[n_runs:]
        ran_in = Path(new[-1]["cwd"]).resolve() if new else None
        run.report(code == 200 and res.get("state") == "completed" and ran_in == rfolder,
                   f"delegate ran Researcher in its folder: {code} {res.get('state')} {ran_in}")
        _, chats = run.http("GET", f"/agents/{rid}/chats")
        row = next((c for c in chats.get("chats", []) if c.get("id") == res.get("chatId")), {})
        run.report(row.get("delegated") is True and row.get("from") == "assistant",
                   f"listed delegated from assistant: {row.get('delegated')} {row.get('from')}")
        code, res = v1("POST", "/agent/delegate", {"agent": rid, "goal": "FAKE:long:30000"})
        summary = res.get("summary", "") if isinstance(res, dict) else ""
        run.report(code == 200 and len(summary) == DELEGATE_SUMMARY_CAP + 1 and summary.endswith("…")
                   and res.get("cut") is True, f"FAKE:long:30000 gives {len(summary)} characters, cut {res.get('cut')}")

        go = Path(str(log) + ".go")
        go.unlink(missing_ok=True)
        n_runs = len(runs(log))
        results: list[tuple[int, Any]] = []
        lock = threading.Lock()

        def wait_one(i: int) -> None:
            out = v1("POST", "/agent/delegate", {"agent": rid, "goal": f"FAKE:wait number {i}"})
            with lock:
                results.append(out)

        threads = [threading.Thread(target=wait_one, args=(i,), daemon=True) for i in range(3)]
        for t in threads:
            t.start()
        deadline = time.monotonic() + 30
        while len(runs(log)) < n_runs + 3 and time.monotonic() < deadline:
            time.sleep(0.1)
        waiting = runs(log)[n_runs:]
        code4, fourth = v1("POST", "/agent/delegate", {"agent": rid, "goal": "A fourth one"})
        child = waiting[0].get("token") if waiting else None
        code5, nested = V1(base, child or "x", rec.bodies)("POST", "/agent/delegate",
                                                         {"agent": "Fake Notes", "goal": "Go further"})
        go.write_text("go", encoding="utf-8")
        for t in threads:
            t.join(timeout=120)
        run.report(len(waiting) == 3 and code4 == 429, f"a fourth delegation while three run: {code4} {fourth}")
        run.report(sorted(c for c, _ in results) == [200, 200, 200], f"the three finish: {[c for c, _ in results]}")
        run.report(bool(child) and code5 == 403, f"the delegated run's own token on /delegate: {code5} {nested}")
        n_before = len(planner.requests)
        code, res = v1("POST", "/agent/delegate", {"agent": "Fake Planner", "goal": "Plan a trip"})
        run.report(code == 200 and res.get("state") == "completed" and "Echo:" in res.get("summary", "")
                   and res.get("agent", {}).get("kind") == "remote",
                   f"delegate to Fake Planner: {code} {res.get('state')} {str(res.get('summary'))[:60]!r}")
        _, chats = run.http("GET", f"/agents/{pid}/chats")
        row = next((c for c in chats.get("chats", []) if c.get("id") == res.get("chatId")), {})
        run.report(row.get("delegated") is True and row.get("from") == "assistant",
                   f"Fake Planner's chat is marked delegated: {row.get('delegated')} {row.get('from')}")

        print("\n9. remote_agents_list and remote_agent_call")
        code, listing = v1("GET", "/agent/remote-agents")
        names = {a["name"]: a.get("usable") for a in listing.get("agents", [])} if isinstance(listing, dict) else {}
        run.report(code == 200 and names == {"Fake Planner": True, "Fake Notes": True}, f"listed: {names}")
        code, called = v1("POST", "/agent/remote-call", {"agent": "fake notes", "message": "Hi there"})
        run.report(code == 200 and called.get("state") == "completed" and "Echo: Hi there" in called.get("text", ""),
                   f"remote_agent_call: {code} {called.get('state')} {str(called.get('text'))[:40]!r}")
        cancels = len(rpc_calls(planner, "CancelTask"))
        code, slow = v1("POST", "/agent/remote-call", {"agent": "Fake Planner", "message": "A2A:slow:5",
                                                       "timeoutSeconds": 1})
        deadline = time.monotonic() + 5
        while len(rpc_calls(planner, "CancelTask")) <= cancels and time.monotonic() < deadline:
            time.sleep(0.1)
        run.report(code == 504 and len(rpc_calls(planner, "CancelTask")) > cancels,
                   f"A2A:slow:5 with a 1 s timeout: {code} {slow}; CancelTask logged")

        print("\n10. Delete and restore")
        code, gone = run.http("DELETE", f"/agents/{pid}", clientId=CLIENT)
        trash_id = gone.get("trashId") if isinstance(gone, dict) else None
        run.report(code == 200 and bool(trash_id) and (agents_dir / ".trash" / str(trash_id)).is_dir()
                   and not pfolder.exists(), f"delete moves Fake Planner to the agent trash: {code} {trash_id}")
        code, _ = run.http("POST", f"/agent-trash/{trash_id}/restore", {"clientId": CLIENT})
        _, back = run.http("GET", f"/agents/{pid}")
        run.report(code == 200 and pfolder.is_dir() and (back.get("remote") or {}).get("auth", {}).get("set") is True,
                   f"restore puts it back with its token set: {code}")
        code, _raw, evs = chat("Still there?", agent=pid)
        run.report("Echo: Still there?" in text_of(evs), "it still answers after the restore")

        print("\n11. Saving the chat")
        code, made = run.http("POST", "/ai/chat/save", {
            "title": "", "contextPaths": [], "sessionId": None, "agentId": pid, "chatId": chat1,
            "clientId": CLIENT,
            "messages": [{"role": "user", "text": "Hello planner", "at": "2026-11-06T12:00:00.000Z"},
                         {"role": "assistant", "text": reply1, "at": "2026-11-06T12:00:04.000Z"}]})
        chat_path = made.get("path", "?") if code == 200 else "?"
        text = run.text(chat_path) if (root / chat_path).is_file() else ""
        run.report(code == 200 and "\nagent: Fake Planner" in text.replace("\r\n", "\n"),
                   f"{chat_path} has agent: Fake Planner")
        status = git(root, "status", "--porcelain", "--untracked-files=all").splitlines()
        changed = sorted(line[3:].strip('"') for line in status)
        expected = sorted({".object/types/ai-chat.json", chat_path})
        run.report(changed == expected, f"git status shows only the chat and its type: {changed}")

        leaks = token_leaks()
        run.report(not leaks, "after everything, the token is still only in secrets.json", *leaks)
    finally:
        if caller_secret is not None:
            TokenStore.drop_ephemeral(caller_secret)
        if served is not None:
            served.stop()
        planner.stop()
        notes.stop()
        root_logger.removeHandler(handler)
        root_logger.setLevel(old_level)
        handler.close()
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
