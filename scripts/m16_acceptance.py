"""Milestone 16 acceptance run: the model list, the per-chat model pick and tool step events.

Usage: ``uv run python scripts/m16_acceptance.py SPACE [--keep]``

Copies SPACE to a temporary folder (SPACE itself is never touched), commits the copy to a
throw-away git repo (again after one open, which migrates an old space) and serves it with
``create_app`` on a free ``127.0.0.1`` port. ``OBJECT_STATE_DIR`` and ``OBJECT_CACHE_DIR``
point outside the copy. No model runs: the ``claudePath`` setting (set through
``PUT /api/settings``) points at ``backend/tests/fake_claude.py``, which logs each run's
command line (``--model`` and ``--resume`` included). Checks:

 1. ``GET /api/ai/models`` lists exactly ``aimodels.MODELS`` (ids and labels) and the pattern;
 2. a turn with ``model: "claude-opus-5-5"`` runs ``--model claude-opus-5-5``; with no pick and
    ``aiModel`` set to ``sonnet`` it runs ``--model sonnet``; with neither, no ``--model``;
 3. a second turn with the first turn's ``sessionId`` and ``model: "haiku"`` runs
    ``--resume <id> --model haiku``; with ``FAKE:modelswitch`` the stream still ends in ``done``
    after a second, fresh run that carries the history;
 4. ``model: "--dangerously-skip-permissions"`` answers 422 ``That isn't a model name.`` and the
    fake's log gains no run;
 5. a ``FAKE:tool`` turn streams ``tool`` (id, ``name: "search"``, ``input.query``) then ``tool``
    (same id, ``result``) before ``done``, and ``done.text`` holds no tool result; a
    ``FAKE:toolerror`` turn's result event has ``isError: true``;
 6. saving a chat whose assistant text is Markdown stores it byte for byte; the turns
    themselves changed no file (only the saved chat and the AI Chat type file are new);
 7. no run's working folder is under ``~/.claude``, and no turn token is in any file of the
    copy or the state dir.

Each check prints ``[ok]`` or ``[FAIL]``; exits non-zero on any failure.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import tempfile
from dataclasses import asdict
from pathlib import Path

from m2_acceptance import Run, commit, git, remove_tree
from m8_acceptance import Served
from m10_acceptance import clean, first_page, runs, sse
from objectapp import aimodels
from objectapp.space import Space

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend" / "tests"))
from fake_claude import install

HOOKS = ("OBJECT_STATE_DIR", "OBJECT_CACHE_DIR", "FAKE_CLAUDE_LOG")
MARKDOWN = "# Title\n\n**bold** and `x`\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [ ] task\n\n$x^2$"
MESSAGES = [
    {"role": "user", "text": "Show me some Markdown", "at": "2026-11-05T12:00:00.000Z"},
    {"role": "assistant", "text": MARKDOWN, "at": "2026-11-05T12:00:04.000Z"},
]
HISTORY = [
    {"role": "user", "text": "First question about racks", "at": "2026-11-05T12:00:00.000Z"},
    {"role": "assistant", "text": "First answer about racks", "at": "2026-11-05T12:00:04.000Z"},
]


def arg(argv: list[str], name: str) -> str | None:
    if name in argv:
        i = argv.index(name)
        return argv[i + 1] if i + 1 < len(argv) else None
    return None


def put_settings(run: Run, patch: dict) -> int:
    _, current = run.http("GET", "/settings")
    code, _ = run.http("PUT", "/settings", {"patch": patch, "baseRevision": current["revision"]})
    return code


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path)
    ap.add_argument("--keep", action="store_true", help="keep the temporary copy")
    args = ap.parse_args(argv)
    src = args.space.resolve()
    if not src.is_dir():
        ap.error(f"Not a folder: {src}")

    tmp = Path(tempfile.mkdtemp(prefix="m16-acceptance-")).resolve()
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
        code = put_settings(run, {"claudePath": str(fake)})
        run.report(code == 200, f"claudePath set through PUT /api/settings: {code}")
        page = first_page(root)
        ctx = [page] if page else []

        def turn(prompt: str, **extra) -> tuple[int, list[dict], list[dict]]:
            before = len(runs(log))
            code, _raw, events = sse(base, {"mode": "chat", "prompt": prompt, "contextPaths": ctx,
                                            "history": [], **extra})
            return code, events, runs(log)[before:]

        print("\n1. The model list")
        code, body = run.http("GET", "/ai/models")
        run.report(code == 200 and body.get("models") == [asdict(m) for m in aimodels.MODELS],
                   f"GET /api/ai/models lists aimodels.MODELS: {[m.get('id') for m in body.get('models', [])]}")
        run.report(body.get("pattern") == aimodels.MODEL_PATTERN, f"and the pattern: {body.get('pattern')!r}")

        print("\n2. Which --model a turn runs on")
        code, events, new = turn("Hello", model="claude-opus-5-5")
        run.report(code == 200 and len(new) == 1 and arg(new[0]["argv"], "--model") == "claude-opus-5-5"
                   and events[-1:] and events[-1]["type"] == "done",
                   f"the chat's pick: --model {arg(new[0]['argv'], '--model') if new else '?'}")
        code = put_settings(run, {"aiModel": "sonnet"})
        _, events, new = turn("Hello")
        run.report(code == 200 and len(new) == 1 and arg(new[0]["argv"], "--model") == "sonnet",
                   f"no pick, aiModel sonnet: --model {arg(new[0]['argv'], '--model') if new else '?'}")
        put_settings(run, {"aiModel": None})
        _, events, new = turn("Hello", model=None)
        run.report(len(new) == 1 and "--model" not in new[0]["argv"], "no pick, no aiModel: no --model")

        print("\n3. A model change mid-chat")
        _, first, _ = turn("Hello", model="sonnet")
        session = first[-1].get("sessionId") if first else None
        _, events, new = turn("And then?", model="haiku", sessionId=session, history=HISTORY)
        run.report(bool(session) and len(new) == 1 and arg(new[0]["argv"], "--resume") == session
                   and arg(new[0]["argv"], "--model") == "haiku" and events[-1]["type"] == "done",
                   f"next turn: --resume {session} --model haiku")
        _, events, new = turn("FAKE:modelswitch And then?", model="opus", sessionId=session, history=HISTORY)
        ok = (len(new) == 2 and arg(new[0]["argv"], "--resume") == session
              and arg(new[0]["argv"], "--model") == "opus"
              and "--resume" not in new[1]["argv"] and arg(new[1]["argv"], "--model") == "opus"
              and all(m["text"] in (new[1].get("prompt") or "") for m in HISTORY))
        run.report(ok and events[-1:] and events[-1]["type"] == "done",
                   f"a refused resume replays the history in a fresh run: {len(new)} runs, "
                   f"last event {events[-1]['type'] if events else None}")

        print("\n4. A bad model name")
        code, events, new = turn("Hello", model="--dangerously-skip-permissions")
        code2, body2 = run.http("POST", "/ai/chat", {"mode": "chat", "prompt": "Hello", "contextPaths": [],
                                                     "history": [], "model": "--dangerously-skip-permissions"})
        run.report(code == 422 and code2 == 422 and body2.get("detail") == aimodels.BAD_MODEL and not new,
                   f"422 {body2.get('detail')!r}, no run: {len(new)} runs")

        print("\n5. Tool steps")
        code, events, _ = turn("FAKE:tool What is here?")
        tools = [e for e in events if e["type"] == "tool"]
        call = tools[0] if tools else {}
        res = tools[1] if len(tools) > 1 else {}
        run.report(len(tools) == 2 and call.get("name") == "search" and call.get("id")
                   and (call.get("input") or {}).get("query") == "alpha" and "result" not in call,
                   f"the call: {call}")
        run.report(res.get("id") == call.get("id") and res.get("input") is None and "result" in res
                   and res.get("isError") is False,
                   f"its result, same id: {res}")
        kinds = [e["type"] for e in events]
        done = events[-1] if events else {}
        run.report(kinds[-1:] == ["done"] and kinds.index("tool") < len(kinds) - 1
                   and done.get("text") == "Hello from the fake claude."
                   and (res.get("result") or "\0") not in (done.get("text") or ""),
                   f"both before done, done.text holds no tool result: {kinds}")
        _, events, _ = turn("FAKE:toolerror What is here?")
        res = [e for e in events if e["type"] == "tool" and "result" in e]
        run.report(len(res) == 1 and res[0].get("isError") is True
                   and res[0].get("result") == "Search failed: index busy",
                   f"a failed tool: {res[0] if res else None}")

        print("\n6. The saved chat keeps the Markdown source")
        run.report(clean(root), "the turns changed no file (git status clean)", git(root, "status", "--short"))
        code, made = run.http("POST", "/ai/chat/save", {
            "title": "", "contextPaths": ctx, "sessionId": None, "messages": MESSAGES,
            "clientId": "acceptance"})
        run.report(code == 200, f"save: {code}")
        status_lines = sorted(git(root, "status", "--porcelain", "--untracked-files=all").splitlines())
        added = sorted(line[3:].strip('"') for line in status_lines)
        expected = sorted([".object/types/ai-chat.json", made.get("path", "?")]) if code == 200 else []
        run.report(added == expected, f"only the AI Chat type file and the chat are new: {added}")
        if code == 200:
            code, loaded = run.http("GET", "/ai/chat", path=made["path"])
            run.report(code == 200 and loaded["messages"][1]["text"] == MARKDOWN, "loaded back equal")
            body = (root / made["path"]).read_bytes().decode("utf-8")
            run.report(MARKDOWN in body, "the file body holds the source unchanged")

        print("\n7. Nothing of Claude's touched")
        logged = runs(log)
        home_claude = (Path.home() / ".claude").resolve()
        bad_cwd = [r.get("cwd") for r in logged
                   if home_claude in (Path(r.get("cwd", "/")).resolve(), *Path(r.get("cwd", "/")).resolve().parents)]
        run.report(logged and not bad_cwd, f"no run's cwd is under ~/.claude ({len(logged)} runs)", *map(str, bad_cwd))
        tokens = [r.get("token") for r in logged if r.get("token")]
        leaked = [
            p for folder in (root, tmp / "state") for p in folder.rglob("*")
            if p.is_file() and ".git" not in p.parts and any(t.encode() in p.read_bytes() for t in tokens)
        ]
        run.report(tokens and not leaked, "no file in the space or state dir holds a turn token", *map(str, leaked))
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
