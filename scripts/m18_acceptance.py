"""Milestone 18 acceptance run: agent memory, skills, the ledger and Undo, background reviews,
the curator and chat search.

Usage: ``uv run python scripts/m18_acceptance.py SPACE [--keep]``

Copies SPACE to a temporary folder (SPACE itself is never touched), commits the copy to a
throw-away git repo (again after one open, which migrates an old space) and serves it with
``create_app`` on a free ``127.0.0.1`` port. ``OBJECT_STATE_DIR``, ``OBJECT_CACHE_DIR``,
``OBJECT_CLOCK_FILE``, ``OBJECT_FAKE_NOTIFY_FILE`` and ``FAKE_CLAUDE_LOG`` point at temporary
paths. No model runs: the ``claudePath`` setting points at ``backend/tests/fake_claude.py``, whose
``FAKE:mcp`` markers call the agent's real tools through the real ``object-agent`` server. The
agent "Researcher" is made through ``POST /api/agents``. Checks:

 1. Memory: a turn's ``memory`` add (target user) lands in USER.md; the ledger has one ``add``
    with source ``chat``; an add past the 1,375 cap gets the cap message listing the entry;
 2. Snapshot: the same chat's next turn's ``appendPrompt`` lacks the fact; a new chat's first turn
    holds it inside ``<user-profile>``;
 3. Skills: a turn creates ``rack-labels``; a patch without ``skill_view`` is refused; view then
    patch passes; ``usage.json`` shows one use; ``write_file`` to ``../x.md`` is refused;
 4. Review: ten chat turns, then ``POST /api/_test/reviews/idle``: one review ran with
    ``--resume <the chat's session> --fork-session --no-session-persistence``, ``--read-only``
    Object tools, no built-in allowed and ``mcp__object-agent__memory`` allowed; its actions (a
    memory add and a skill patch) give a ``done`` review "Saved 1 memory, updated 1 skill"; the
    transcript gained only ``review`` lines;
 5. Undo: undoing the review's patch restores SKILL.md byte for byte; undoing the undo re-applies
    it; an undo after a later change answers 409;
 6. Learn from this chat: ``POST …/learn`` answers 202 and a second call at once 409;
 7. Curator: the clock moves 31 days on; ``POST /api/_test/curator/tick`` archives an unused
    agent-made skill, leaves a pinned one and a user-made one alone, logs every change, sets
    ``curator.lastRunAt``; undo of the archive restores it;
 8. Tidy up now: with ``FAKE_CLAUDE_CURATOR_ACTIONS`` archiving ``narrow-skill`` into
    ``broad-skill``, ``POST …/curator/tidy``: ``narrow-skill`` is archived with ``absorbedInto``
    and ``GET …/learning`` shows the report;
 9. Chat search: ``GET …/chats/search?q=rack`` finds the chat; ``session_search`` through a
    turn does too; deleting ``.object-agent/cache/`` and searching again rebuilds it;
10. Budget: a review whose actions are 17 ``skills_list`` calls: the 17th answers 429;
11. File safety: ``git status`` of the space copy is clean (no learning route or turn wrote a
    file in the space); no ``*.tmp`` is left in the agent folder.

Each check prints ``[ok]`` or ``[FAIL]``; ``RESULT: PASS`` at the end; exits non-zero on any
failure.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from m2_acceptance import Run, commit, git, remove_tree
from m8_acceptance import Served
from m10_acceptance import runs, sse
from objectapp import ai, toolcatalog, transcripts
from objectapp.space import Space

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend" / "tests"))
from fake_claude import install

HOOKS = ("OBJECT_STATE_DIR", "OBJECT_CACHE_DIR", "OBJECT_CLOCK_FILE", "OBJECT_FAKE_NOTIFY_FILE",
         "FAKE_CLAUDE_LOG", "FAKE_CLAUDE_REVIEW_ACTIONS", "FAKE_CLAUDE_CURATOR_ACTIONS",
         "FAKE_CLAUDE_REVIEW_SLEEP")
REVIEW_LINE = "Look back over this chat."
FACT = "Prefers short answers"
AGENT_TOOL = "mcp__object-agent__"


def mcp(tool: str, args: dict[str, Any]) -> str:
    return f"FAKE:mcp:object-agent:{tool}:{json.dumps(args)}"


def actions(var: str, *calls: tuple[str, dict[str, Any]]) -> None:
    os.environ[var] = json.dumps([{"server": "object-agent", "tool": t, "args": a} for t, a in calls])


def results(events: list[dict]) -> list[str]:
    return [str(e.get("result") or "") for e in events if e.get("type") == "tool" and "result" in e]


def iso(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


class Spy:
    """Every review run's events, through a wrapper around `ai.run_turn` (in this process)."""

    def __init__(self) -> None:
        self.events: list[dict] = []
        self.real = ai.run_turn
        real = self.real
        seen = self.events

        async def spy(turn):
            review = (turn.prompt_resume or turn.prompt_fresh or "").startswith(REVIEW_LINE)
            async for event in real(turn):
                if review:
                    seen.append(event)
                yield event

        ai.run_turn = spy

    def restore(self) -> None:
        ai.run_turn = self.real


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path)
    ap.add_argument("--keep", action="store_true", help="keep the temporary copy")
    args = ap.parse_args(argv)
    src = args.space.resolve()
    if not src.is_dir():
        ap.error(f"Not a folder: {src}")

    tmp = Path(tempfile.mkdtemp(prefix="m18-acceptance-")).resolve()
    root = tmp / src.name
    state = tmp / "state"
    shutil.copytree(src, root, ignore=shutil.ignore_patterns(".git", ".object-cache"))
    saved_env = {k: os.environ.get(k) for k in HOOKS}
    log = tmp / "claude-log.jsonl"
    clock = tmp / "clock.txt"
    start = datetime.now(UTC).replace(microsecond=0)
    clock.write_text(iso(start), encoding="utf-8")
    for k in HOOKS:
        os.environ.pop(k, None)
    os.environ.update({
        "OBJECT_STATE_DIR": str(state),
        "OBJECT_CACHE_DIR": str(tmp / "cache"),
        "OBJECT_CLOCK_FILE": str(clock),
        "OBJECT_FAKE_NOTIFY_FILE": str(tmp / "notify.jsonl"),
        "FAKE_CLAUDE_LOG": str(log),
    })
    fake = install(tmp / "bin")
    git(root, "init", "-q")
    commit(root, "base")
    Space(root)  # a space from before M2 is migrated on its first open; commit that
    commit(root, "opened once")

    served: Served | None = None
    run: Run | None = None
    spy = Spy()
    try:
        served = Served(root)
        run = Run(root, served.http)
        base = served.base
        http = run.http
        print(f"Space copy: {root}\nServed at: {base}\nFake claude: {fake}")

        _, current = http("GET", "/settings")
        http("PUT", "/settings", {"patch": {"claudePath": str(fake)}, "baseRevision": current["revision"]})
        code, made = http("POST", "/agents", {"agent": {"name": "Researcher"}, "instructions": "You look things up.",
                                              "location": None, "clientId": "acceptance"})
        if code != 201:
            run.report(False, f"POST /api/agents Researcher: {code} {made}")
            raise SystemExit
        rid = made["id"]
        folder = Path(made["folder"]).resolve()
        A = f"/agents/{rid}"
        print(f"Researcher: {rid} at {folder}")

        def turn(prompt: str, chat_id: str | None = None, session: str | None = None) -> tuple[str, str | None, list]:
            body = {"mode": "chat", "prompt": prompt, "contextPaths": [], "history": [], "agentId": rid,
                    "chatId": chat_id, "sessionId": session}
            code, _raw, events = sse(base, body)
            if code != 200 or not events or events[-1].get("type") != "done":
                print(f"  turn failed: {code} {events[-1:] if events else _raw[:200]}")
            chat = next((e for e in events if e.get("type") == "chat"), {}).get("chatId") or chat_id or "?"
            sess = (events[-1].get("sessionId") if events else None) or session
            return chat, sess, events

        def idle() -> bool:
            code, out = http("POST", "/_test/reviews/idle")
            return code == 200 and out.get("idle") is True

        def ledger(**query: Any) -> list[dict]:
            code, out = http("GET", f"{A}/ledger", **query)
            return out.get("entries", []) if code == 200 else []

        def skills(archived: bool = False) -> dict[str, dict]:
            code, out = http("GET", f"{A}/skills", archived="true" if archived else None)
            return {s["name"]: s for s in out.get("skills", [])} if code == 200 else {}

        skill_md = folder / ".claude" / "skills" / "rack-labels" / "SKILL.md"
        usage_file = folder / ".object-agent" / "usage.json"

        print("\n1. Memory")
        chat_a, sess_a, events = turn(mcp("memory", {"action": "add", "target": "user", "content": FACT}))
        user_md = folder / ".object-agent" / "memory" / "USER.md"
        run.report(user_md.is_file() and FACT in user_md.read_text(encoding="utf-8"), f"USER.md holds {FACT!r}")
        adds = [e for e in ledger(target="user") if e["action"] == "add"]
        run.report(len(adds) == 1 and adds[0]["source"].get("kind") == "chat",
                   f"one add entry with source chat: {[(e['action'], e['source'].get('kind')) for e in adds]}")
        _c, sess_a, events = turn(mcp("memory", {"action": "add", "target": "user", "content": "y" * 1400}),
                                  chat_a, sess_a)
        out = results(events)
        run.report(bool(out) and "over its cap of 1,375" in out[0] and FACT in out[0],
                   "an add past the 1,375 cap gets the cap message listing the entry", out[0][:160] if out else "")

        print("\n2. Snapshot")
        _c, sess_a, _e = turn("Anything new?", chat_a, sess_a)
        append = (runs(log)[-1].get("appendPrompt") or "") if runs(log) else ""
        run.report(FACT not in append, "the same chat's next turn doesn't hold the fact")
        chat_n, _s, _e = turn("Hello again")
        append = (runs(log)[-1].get("appendPrompt") or "") if runs(log) else ""
        profile = append.split("<user-profile>", 1)[-1].split("</user-profile>", 1)[0] if "<user-profile>" in append else ""
        run.report(FACT in profile, "a new chat's first turn holds it inside <user-profile>")

        print("\n3. Skills")
        chat_s, sess_s, events = turn(mcp("skill_manage", {
            "action": "create", "name": "rack-labels", "description": "Label racks",
            "content": "# Rack labels\n\nLabels go on the left side of the rack.\n"}))
        run.report(skill_md.is_file() and "rack-labels" in skills(), f"rack-labels created: {results(events)[:1]}")
        _c, sess_s, events = turn(mcp("skill_manage", {"action": "patch", "name": "rack-labels",
                                                       "old_string": "left", "new_string": "right"}), chat_s, sess_s)
        out = results(events)
        run.report(bool(out) and "Read the skill with skill_view first" in out[0] and "left" in skill_md.read_text(
            encoding="utf-8"), "a patch without a view is refused", out[0][:120] if out else "")
        _c, sess_s, events = turn(mcp("skill_view", {"name": "rack-labels"}) + "\n" + mcp(
            "skill_manage", {"action": "patch", "name": "rack-labels", "old_string": "left side",
                             "new_string": "front"}), chat_s, sess_s)
        out = results(events)
        run.report(len(out) == 2 and "front" in skill_md.read_text(encoding="utf-8"),
                   "skill_view then the patch passes", *[o[:100] for o in out])
        usage = json.loads(usage_file.read_text(encoding="utf-8")) if usage_file.is_file() else {}
        uses = ((usage.get("skills") or {}).get("rack-labels") or {}).get("uses")
        run.report(uses == 1 and skills().get("rack-labels", {}).get("uses") == 1, f"usage.json shows one use: {uses}")
        _c, sess_s, events = turn(mcp("skill_manage", {"action": "write_file", "name": "rack-labels",
                                                       "file": "../x.md", "content": "x"}), chat_s, sess_s)
        out = results(events)
        escaped = (skill_md.parent.parent / "x.md").exists()
        run.report(bool(out) and "x.md" not in "".join(p.name for p in skill_md.parent.parent.iterdir())
                   and not escaped and "422" in out[0],
                   "write_file to ../x.md is refused", out[0][:120] if out else "")

        print("\n4. Review")
        before_review = skill_md.read_bytes()
        actions("FAKE_CLAUDE_REVIEW_ACTIONS",
                ("memory", {"action": "add", "target": "memory", "content": "Rack A is in room 2"}),
                ("skill_view", {"name": "rack-labels"}),
                ("skill_manage", {"action": "patch", "name": "rack-labels", "old_string": "front",
                                  "new_string": "front, at eye height"}))
        chat_r, sess_r = None, None
        for n in range(1, 11):
            chat_r, sess_r, _e = turn(f"FAKE:tool Where do the rack labels go? (turn {n})", chat_r, sess_r)
        run.report(idle(), "POST /api/_test/reviews/idle: the review ended")
        os.environ.pop("FAKE_CLAUDE_REVIEW_ACTIONS", None)
        review_runs = [r for r in runs(log) if REVIEW_LINE in (r.get("prompt") or "")]
        run.report(len(review_runs) == 1, f"one review ran: {len(review_runs)}")
        rv = review_runs[-1] if review_runs else {}
        rargv = rv.get("argv", [])
        run.report(rv.get("resume") == sess_r and rv.get("forkSession") and rv.get("noSessionPersistence"),
                   f"--resume <the chat's session> --fork-session --no-session-persistence: {rv.get('resume')} "
                   f"(chat session {sess_r})")
        servers = (rv.get("mcpConfig") or {}).get("mcpServers", {})
        builtins = {n for e in toolcatalog.BUILTINS for n in e.cli}
        allowed = set(rv.get("allowed") or [])
        run.report("--read-only" in (servers.get("object", {}).get("args") or []),
                   f"Object tools read-only: {servers.get('object', {}).get('args')}")
        run.report(not (allowed & builtins) and f"{AGENT_TOOL}memory" in allowed,
                   f"no built-in allowed, {AGENT_TOOL}memory allowed", *sorted(allowed & builtins))
        run.report("--resume" in rargv, "the review resumed (not a fresh replay)")
        code, out = http("GET", f"{A}/chats/{chat_r}/reviews")
        revs = out.get("reviews", []) if code == 200 else []
        last = revs[-1] if revs else {}
        run.report(len(revs) == 1 and last.get("state") == "done" and last.get("summary") == "Saved 1 memory, updated 1 skill",
                   f"GET .../reviews: {[(r.get('state'), r.get('summary')) for r in revs]}")
        lines = transcripts.raw_lines(folder, chat_r)
        types = [x.get("type") for x in lines]
        last_answer = max(i for i, t in enumerate(types) if t == "assistant")
        tail = types[last_answer + 1:]
        run.report(tail == ["review", "review"] and types.count("assistant") == 10 and types.count("user") == 10,
                   f"the transcript gained only review lines: {tail}")

        print("\n5. Undo")
        patches = [e for e in ledger(skill="rack-labels")
                   if e["action"] == "patch" and e["source"].get("kind") == "review"]
        patch_id = patches[0]["id"] if patches else "?"
        after_review = skill_md.read_bytes()
        code, undo = http("POST", f"{A}/ledger/{patch_id}/undo", {"clientId": "acceptance"})
        run.report(code == 200 and skill_md.read_bytes() == before_review,
                   f"undo of the review's patch restores SKILL.md byte for byte: {code}")
        code2, redo = http("POST", f"{A}/ledger/{undo.get('id') if isinstance(undo, dict) else '?'}/undo",
                           {"clientId": "acceptance"})
        run.report(code2 == 200 and skill_md.read_bytes() == after_review, f"undo of the undo re-applies it: {code2}")
        code, file = http("GET", f"{A}/skills/rack-labels/file", path="SKILL.md")
        text = (file.get("text") or "") if code == 200 else ""
        code, _saved = http("PUT", f"{A}/skills/rack-labels/file", {
            "path": "SKILL.md", "text": text + "\nChecked by hand.\n", "baseRevision": file.get("revision"),
            "clientId": "acceptance"})
        code2, refused = http("POST", f"{A}/ledger/{patch_id}/undo", {"clientId": "acceptance"})
        run.report(code == 200 and code2 == 409, f"an undo after a later change answers 409: {code}, {code2} {refused}")

        print("\n6. Learn from this chat")
        os.environ["FAKE_CLAUDE_REVIEW_SLEEP"] = "3"
        os.environ["FAKE_CLAUDE_REVIEW_ACTIONS"] = "[]"
        code, first = http("POST", f"{A}/chats/{chat_r}/learn", {"clientId": "acceptance"})
        code2, second = http("POST", f"{A}/chats/{chat_r}/learn", {"clientId": "acceptance"})
        run.report(code == 202 and code2 == 409, f"202 then 409: {code}, {code2} {second}")
        idle()
        os.environ.pop("FAKE_CLAUDE_REVIEW_SLEEP", None)
        os.environ.pop("FAKE_CLAUDE_REVIEW_ACTIONS", None)
        code, out = http("GET", f"{A}/chats/{chat_r}/reviews")
        manual = [r for r in out.get("reviews", []) if r.get("trigger") == "manual"] if code == 200 else []
        run.report(len(manual) == 1 and manual[0].get("state") == "done" and manual[0].get("kinds") == ["memory", "skills"],
                   f"the manual review: {[(r.get('state'), r.get('kinds')) for r in manual]}")

        print("\n7. Curator")
        _c, _s, events = turn(mcp("skill_manage", {"action": "create", "name": "old-notes", "description": "Old notes",
                                                   "content": "# Old notes\n\nNever used.\n"}) + "\n" +
                              mcp("skill_manage", {"action": "create", "name": "kept-pinned",
                                                   "description": "Pinned skill", "content": "# Pinned\n\nKept.\n"}))
        code, _p = http("POST", f"{A}/skills/kept-pinned/pin", {"pinned": True, "clientId": "acceptance"})
        code2, _u = http("POST", f"{A}/skills", {"name": "my-own", "description": "Written by Gene",
                                                  "body": "# Mine\n\nGene wrote this.\n", "clientId": "acceptance"})
        have = skills()
        run.report(code == 200 and code2 == 201 and {"old-notes", "kept-pinned", "my-own"} <= set(have),
                   f"made old-notes, kept-pinned (pinned) and my-own (Gene's): {code}, {code2}")
        before_ids = {e["id"] for e in ledger(limit=500)}
        clock.write_text(iso(start + timedelta(days=31)), encoding="utf-8")
        code, ticked = http("POST", "/_test/curator/tick")
        archive_dir = folder / ".object-agent" / "skills-archive"
        active, archived = skills(), skills(archived=True)
        run.report((archive_dir / "old-notes").is_dir() and "old-notes" not in active
                   and archived.get("old-notes", {}).get("state") == "archived",
                   f"the unused agent-made skill is archived in skills-archive/: tick {code} {ticked}")
        run.report("kept-pinned" in active and "my-own" in active
                   and active["kept-pinned"]["state"] == "active" and active["my-own"]["state"] == "active",
                   "the pinned one and the user-made one are left alone")
        new_entries = [e for e in ledger(limit=500) if e["id"] not in before_ids]
        curator_archived = {e["skill"] for e in new_entries
                            if e["source"].get("kind") == "curator" and e["action"] == "archive"}
        gone = {n for n, s in archived.items() if s["state"] == "archived"} - set(active)
        run.report(bool(new_entries) and all(e["source"].get("kind") == "curator" for e in new_entries)
                   and "old-notes" in curator_archived and curator_archived <= gone,
                   f"every change is in the ledger: {[(e['action'], e['skill']) for e in new_entries]}")
        code, learning = http("GET", f"{A}/learning")
        run.report(code == 200 and bool((learning.get("curator") or {}).get("lastRunAt")),
                   f"curator.lastRunAt is set: {(learning.get('curator') or {}).get('lastRunAt')}")
        arch = next((e for e in new_entries if e["action"] == "archive" and e["skill"] == "old-notes"), {})
        code, _u = http("POST", f"{A}/ledger/{arch.get('id', '?')}/undo", {"clientId": "acceptance"})
        run.report(code == 200 and "old-notes" in skills() and (folder / ".claude" / "skills" / "old-notes").is_dir(),
                   f"undo of the archive restores it: {code}")

        print("\n8. Tidy up now")
        turn(mcp("skill_manage", {"action": "create", "name": "broad-skill", "description": "Broad skill",
                                  "content": "# Broad\n\nCovers it all.\n"}) + "\n" +
             mcp("skill_manage", {"action": "create", "name": "narrow-skill", "description": "Narrow skill",
                                  "content": "# Narrow\n\nOne case.\n"}))
        actions("FAKE_CLAUDE_CURATOR_ACTIONS",
                ("skill_manage", {"action": "archive", "name": "narrow-skill", "absorbed_into": "broad-skill"}))
        code, tidy = http("POST", f"{A}/curator/tidy", {"clientId": "acceptance"})
        report = None
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            _c, learning = http("GET", f"{A}/learning")
            cur = (learning or {}).get("curator") or {}
            if not cur.get("running") and cur.get("report"):
                report = cur["report"]
                break
            time.sleep(0.2)
        os.environ.pop("FAKE_CLAUDE_CURATOR_ACTIONS", None)
        narrow = skills(archived=True).get("narrow-skill", {})
        run.report(code == 202 and narrow.get("state") == "archived" and narrow.get("absorbedInto") == "broad-skill",
                   f"narrow-skill archived, absorbed into broad-skill: {code} {tidy} {narrow.get('absorbedInto')}")
        run.report(bool(report and report.get("text")), f"GET .../learning shows the report: {report}")

        print("\n9. Chat search")
        code, found = http("GET", f"{A}/chats/search", q="rack")
        hits = [h["chatId"] for h in found.get("hits", [])] if code == 200 else []
        run.report(chat_r in hits, f"GET .../chats/search?q=rack finds the chat: {code} {len(hits)} hits")
        _c, _s, events = turn(mcp("session_search", {"query": "labels"}))
        out = results(events)
        run.report(bool(out) and chat_r in out[0], "session_search through a turn finds it", out[0][:120] if out else "")
        cache = folder / ".object-agent" / "cache"
        shutil.rmtree(cache, ignore_errors=True)
        code, found = http("GET", f"{A}/chats/search", q="rack")
        hits = [h["chatId"] for h in found.get("hits", [])] if code == 200 else []
        run.report(chat_r in hits and (cache / "sessions.db").is_file(), "deleting cache/ and searching rebuilds it")

        print("\n10. Budget")
        spy.events.clear()
        actions("FAKE_CLAUDE_REVIEW_ACTIONS", *[("skills_list", {})] * 17)
        code, _r = http("POST", f"{A}/chats/{chat_s}/learn", {"clientId": "acceptance"})
        idle()
        os.environ.pop("FAKE_CLAUDE_REVIEW_ACTIONS", None)
        out = results(spy.events)
        run.report(code == 202 and len(out) == 17 and all("This run has used" not in o for o in out[:16])
                   and "This run has used its 16 tool steps." in out[16],
                   f"the 17th call answers 429: {code}, {len(out)} results", out[16][:120] if len(out) > 16 else "")

        print("\n11. File safety")
        status = git(root, "status", "--porcelain", "--untracked-files=all").splitlines()
        run.report(not status, f"git status of the space copy is clean: {len(status)} paths", *status[:10])
        tmps = [p for p in folder.rglob("*") if p.name.endswith(".tmp") or ".tmp" in p.suffixes]
        run.report(not tmps, "no *.tmp left in the agent folder", *[str(p) for p in tmps[:10]])
    except SystemExit:
        pass
    finally:
        spy.restore()
        if served is not None:
            try:
                served.server.config.app.state.reviews.wait_idle(30)
            except Exception:  # noqa: BLE001 - stopping anyway
                pass
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
