"""Milestone 19 acceptance run: the MCP gateway (outside MCP servers, secrets, switches).

Usage: ``uv run python scripts/m19_acceptance.py SPACE [--keep]``

Copies SPACE to a temporary folder (SPACE itself is never touched), commits the copy to a
throw-away git repo (again after one open, which migrates an old space) and serves it with
``create_app`` on a free ``127.0.0.1`` port. ``OBJECT_STATE_DIR``, ``OBJECT_CACHE_DIR`` and
``FAKE_CLAUDE_LOG`` point at temporary paths. No model runs: the ``claudePath`` setting points at
``backend/tests/fake_claude.py``, whose ``FAKE:mcp`` markers call the outside servers for real.
The outside servers are ``backend/tests/fake_mcp_server.py`` (synthetic): its stdio mode, and its
``--http`` mode on ``127.0.0.1`` with ``--require-bearer``. The app's log goes to a temporary file;
every API answer, chat frame and ``/api/events`` frame is recorded. Checks:

 1. ``GET /api/mcp-servers`` and ``GET /api/mcp-secrets`` are empty; the state dir holds no
    ``mcp-servers.json`` and no ``secrets.json``;
 2. ``POST`` the stdio server "fake-stdio" (env ``FAKE_KEY`` secret): the answer shows
    ``set: true`` and no value; ``secrets.json`` holds the value, ``mcp-servers.json`` doesn't;
 3. ``POST`` the URL server "fake-http" (HTTP, a bearer). Test on each lists ``echo``, ``add`` and
    ``whoami``; a wrong bearer makes Test fail with the 401 message; it is then set back;
 4. a chat turn with ``FAKE:mcp:fake-stdio:whoami``: ``--strict-mcp-config``; ``mcpServers`` holds
    fake-stdio, fake-http, object and object-agent; both servers are allowed; the MCP config holds
    ``${OBJECT_MCP_…}`` references and no secret; the tool result equals the secret (compared);
 5. ``FAKE:mcp:fake-http:add:{"a":2,"b":3}`` answers 5;
 6. switches: Researcher's refresh lists both gateway groups with three tools; with fake-http's
    ``add`` and all of fake-stdio's tools off, ``add`` is denied, ``mcp__fake-http__add`` is
    disallowed, fake-stdio is left out; the default agent still has both;
 7. fake-http turned off: the next turn's config has no fake-http;
 8. a folder server with ``${FOLDER_KEY}``: missing, then set through ``PUT /api/mcp-secrets``;
    the refresh lists its tools; a turn calling its ``whoami`` answers the value;
 9. a ``tagObject`` turn has no gateway server: only object, object-agent and folder-fake;
10. no secret leaked into the state dir (but ``secrets.json``), an agent folder, the space copy,
    the app log, the fake's log, an API answer or an SSE frame;
11. deleting fake-stdio removes its ``mcp:<id>:`` secrets and the next turn has no fake-stdio;
12. ``git status`` of the space copy is clean, and the reads, Tests and refreshes changed nothing
    in the state dir, the agent folders or the space.

The two ``whoami`` turns (checks 4 and 8) answer a secret on purpose: the fake server's tool
returns it so the script can prove it arrived. Their chat frames, their transcripts and the app
log's DEBUG copies of those frames are the tool's own output and are left out of check 10.

Each check prints ``[ok]`` or ``[FAIL]``; ``RESULT: PASS`` at the end; exits non-zero on any
failure.
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
import urllib.request
from pathlib import Path
from typing import Any

from m2_acceptance import Http, Run, commit, git, remove_tree
from m8_acceptance import Served
from m10_acceptance import runs, sse
from objectapp.space import Space

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend" / "tests"))
from fake_claude import install
from fake_mcp_server import HERE as FAKE_SERVER
from fake_mcp_server import serve_in_thread

HOOKS = ("OBJECT_STATE_DIR", "OBJECT_CACHE_DIR", "FAKE_CLAUDE_LOG")
STDIO_SECRET = "s3cret-accept-stdio"
HTTP_SECRET = "s3cret-accept-http"
FOLDER_SECRET = "s3cret-accept-folder"
WRONG_BEARER = "wrong-accept-bearer"
SECRETS = (STDIO_SECRET, HTTP_SECRET, FOLDER_SECRET)
TOOLS = ["add", "echo", "whoami"]
REFUSED = "The server refused the credentials (401)"
DENIED = "has been denied"
CLIENT = "acceptance"


class Recorder(Http):
    """`Http` that keeps every answer body (check 10)."""

    def __init__(self, base: str) -> None:
        super().__init__(base)
        self.bodies: list[str] = []

    def __call__(self, method: str, route: str, payload: Any = None, **query: Any) -> tuple[int, Any]:
        code, body = super().__call__(method, route, payload, **query)
        self.bodies.append(json.dumps(body, default=str))
        return code, body


class Events:
    """Reads ``/api/events`` in a thread and keeps every frame."""

    def __init__(self, base: str) -> None:
        self.frames: list[str] = []
        self._resp: Any = None
        self.thread = threading.Thread(target=self._run, args=(base,), daemon=True)
        self.thread.start()

    def _run(self, base: str) -> None:
        try:
            self._resp = urllib.request.urlopen(base + "/events", timeout=600)  # noqa: S310 - 127.0.0.1
            for line in self._resp:
                self.frames.append(line.decode("utf-8", "replace"))
        except Exception:  # noqa: BLE001 - the stream ends when the app stops
            return

    def close(self) -> None:
        try:
            if self._resp is not None:
                self._resp.close()
        except Exception:  # noqa: BLE001
            pass


def tree_hash(*folders: Path, skip: tuple[str, ...] = ()) -> dict[str, str]:
    out: dict[str, str] = {}
    for folder in folders:
        if not folder.exists():
            continue
        for p in sorted(folder.rglob("*")):
            if not p.is_file() or any(part in skip for part in p.parts):
                continue
            out[str(p)] = hashlib.sha256(p.read_bytes()).hexdigest()
    return out


def diff(before: dict[str, str], after: dict[str, str]) -> list[str]:
    keys = sorted(set(before) | set(after))
    return [k for k in keys if before.get(k) != after.get(k)]


def tool_results(events: list[dict]) -> list[dict]:
    return [e for e in events if e.get("type") == "tool" and "result" in e]


def result_text(event: dict) -> str:
    result = event.get("result")
    if isinstance(result, list):
        return "".join(str(c.get("text", "")) if isinstance(c, dict) else str(c) for c in result)
    return str(result)


def server_input(server: dict, **changes: Any) -> dict:
    """An ``McpServerInput`` that keeps a stored server as it is (secrets kept)."""
    inp: dict[str, Any] = {
        "name": server["name"], "enabled": server["enabled"], "kind": server["kind"],
        "command": server.get("command"), "args": server.get("args") or [],
        "env": [{"key": r["key"], "value": None if r["secret"] else r["value"], "secret": r["secret"]}
                for r in server.get("env") or []],
        "transport": server.get("transport"), "url": server.get("url"),
        "headers": [{"name": r["name"], "value": None if r["secret"] else r["value"], "secret": r["secret"]}
                    for r in server.get("headers") or []],
        "bearerAction": "keep",
    }
    inp.update(changes)
    return inp


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path)
    ap.add_argument("--keep", action="store_true", help="keep the temporary copy")
    args = ap.parse_args(argv)
    src = args.space.resolve()
    if not src.is_dir():
        ap.error(f"Not a folder: {src}")

    tmp = Path(tempfile.mkdtemp(prefix="m19-acceptance-")).resolve()
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
    fake = install(tmp / "bin")
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

    served: Served | None = None
    run: Run | None = None
    events: Events | None = None
    stop_http = None
    frames: list[str] = []  # chat frames that must hold no secret
    whoami_chats: list[str] = []
    try:
        http_url, stop_http = serve_in_thread("http", require_bearer=HTTP_SECRET)
        served = Served(root)
        rec = Recorder(served.base)
        run = Run(root, rec)
        base = served.base
        events = Events(base)
        print(f"Space copy: {root}\nServed at: {base}\nFake claude: {fake}\nFake MCP (HTTP): {http_url}")

        _, current = run.http("GET", "/settings")
        run.http("PUT", "/settings", {"patch": {"claudePath": str(fake)}, "baseRevision": current["revision"]})
        agents_dir = state / "agents"

        def chat(prompt: str, *, agent: str | None = None, mode: str = "chat",
                 paths: list[str] | None = None, secret_ok: bool = False) -> tuple[dict, list[dict]]:
            body: dict[str, Any] = {"mode": mode, "prompt": prompt, "contextPaths": paths or [], "history": []}
            if agent is not None:
                body["agentId"] = agent
            before = len(runs(log))
            _code, raw, evs = sse(base, body)
            if secret_ok:
                chat_id = next((e.get("chatId") for e in evs if e.get("type") == "chat"), None)
                if chat_id:
                    whoami_chats.append(str(chat_id))
            else:
                frames.append(raw)
            new = runs(log)[before:]
            return (new[-1] if new else {}), evs

        def watched() -> dict[str, str]:
            return tree_hash(state, root, skip=(".git",))

        print("\n1. Nothing yet")
        snap = watched()
        code, listed = run.http("GET", "/mcp-servers")
        code2, secrets = run.http("GET", "/mcp-secrets")
        run.report(code == 200 and listed == {"servers": [], "readOnlyReason": None, "unreadable": False}
                   and code2 == 200 and secrets == {"vars": []}, f"both lists empty: {listed}, {secrets}")
        run.report(not (state / "mcp-servers.json").exists() and not (state / "secrets.json").exists(),
                   "no mcp-servers.json and no secrets.json in the state dir")
        changed_reads = diff(snap, watched())

        print("\n2. A stdio server")
        code, stdio = run.http("POST", "/mcp-servers", {"server": {
            "name": "fake-stdio", "kind": "command", "command": sys.executable,
            "args": [str(FAKE_SERVER), "--require-env", "FAKE_KEY"],
            "env": [{"key": "FAKE_KEY", "value": STDIO_SECRET, "secret": True}]}, "clientId": CLIENT})
        rows = stdio.get("env", []) if isinstance(stdio, dict) else []
        run.report(code == 201 and rows == [{"key": "FAKE_KEY", "value": None, "secret": True, "set": True}]
                   and STDIO_SECRET not in json.dumps(stdio), f"POST: {code}, env rows {rows}")
        secrets_text = (state / "secrets.json").read_text(encoding="utf-8") if (state / "secrets.json").exists() else ""
        servers_text = (state / "mcp-servers.json").read_text(encoding="utf-8") \
            if (state / "mcp-servers.json").exists() else ""
        run.report(STDIO_SECRET in secrets_text and servers_text and STDIO_SECRET not in servers_text,
                   "secrets.json holds the value; mcp-servers.json doesn't")
        sid = stdio.get("id", "?")

        print("\n3. A URL server and Test")
        code, web = run.http("POST", "/mcp-servers", {"server": {
            "name": "fake-http", "kind": "url", "transport": "http", "url": http_url,
            "bearer": HTTP_SECRET, "bearerAction": "set"}, "clientId": CLIENT})
        run.report(code == 201 and web.get("bearer") is True and HTTP_SECRET not in json.dumps(web),
                   f"POST: {code}, bearer {web.get('bearer')}")
        hid = web.get("id", "?")
        snap = watched()
        for name, server_id in (("fake-stdio", sid), ("fake-http", hid)):
            code, result = run.http("POST", f"/mcp-servers/{server_id}/test")
            names = sorted(t["name"] for t in result.get("tools", [])) if isinstance(result, dict) else []
            run.report(code == 200 and result.get("ok") is True and names == TOOLS,
                       f"Test {name}: {code} {names} {result.get('error') if isinstance(result, dict) else result}")
        changed_tests = diff(snap, watched())
        code, web = run.http("PUT", f"/mcp-servers/{hid}", {
            "server": server_input(web, bearer=WRONG_BEARER, bearerAction="set"),
            "baseRevision": web.get("revision"), "clientId": CLIENT})
        snap = watched()
        code2, result = run.http("POST", f"/mcp-servers/{hid}/test")
        changed_tests += diff(snap, watched())
        run.report(code == 200 and code2 == 200 and result.get("ok") is False
                   and REFUSED in str(result.get("error")) and WRONG_BEARER not in json.dumps(result),
                   f"a wrong bearer fails Test: {result.get('error')}")
        code, web = run.http("PUT", f"/mcp-servers/{hid}", {
            "server": server_input(web, bearer=HTTP_SECRET, bearerAction="set"),
            "baseRevision": web.get("revision"), "clientId": CLIENT})
        code2, result = run.http("POST", f"/mcp-servers/{hid}/test")
        run.report(code == 200 and result.get("ok") is True, f"set back: {code}, Test ok {result.get('ok')}")

        print("\n4. A chat turn uses fake-stdio")
        cli, evs = chat("FAKE:mcp:fake-stdio:whoami", secret_ok=True)
        argv_ = cli.get("argv", [])
        servers = set(cli.get("mcpServers") or [])
        allowed, disallowed = set(cli.get("allowed") or []), set(cli.get("disallowed") or [])
        run.report("--strict-mcp-config" in argv_ and {"fake-stdio", "fake-http", "object", "object-agent"} <= servers,
                   f"--strict-mcp-config; mcpServers {sorted(servers)}")
        run.report({"mcp__fake-stdio", "mcp__fake-http"} <= allowed, "mcp__fake-stdio and mcp__fake-http allowed")
        config_text = json.dumps(cli.get("mcpConfig") or {})
        run.report("${OBJECT_MCP_" in config_text and not any(s in config_text for s in SECRETS),
                   "the MCP config holds ${OBJECT_MCP_…} references and no secret")
        results = tool_results(evs)
        got = result_text(results[0]) if results else ""
        run.report(bool(results) and not results[0].get("isError") and got == STDIO_SECRET,
                   "whoami answered the stdio secret (compared, not printed)")

        print("\n5. fake-http's add")
        cli, evs = chat('FAKE:mcp:fake-http:add:{"a":2,"b":3}')
        results = tool_results(evs)
        run.report(bool(results) and result_text(results[0]) == "5", f"add answered {[result_text(e) for e in results]}")

        print("\n6. Switches")
        code, researcher = run.http("POST", "/agents", {
            "agent": {"name": "Researcher"}, "instructions": "You are Researcher.", "location": None,
            "clientId": CLIENT})
        rid = researcher.get("id", "?")
        rfolder = Path(researcher.get("folder", str(tmp / "missing"))).resolve()
        run.report(code == 201, f"POST /api/agents Researcher: {code}")
        snap = watched()
        code, refreshed = run.http("POST", f"/agents/{rid}/tools/refresh")
        groups = {g["id"]: g for g in refreshed.get("groups", [])} if isinstance(refreshed, dict) else {}
        code2, got_tools = run.http("GET", f"/agents/{rid}/tools")
        changed_refresh = diff(snap, watched())
        ok = code == 200 and all(
            sorted(row["label"] for row in groups.get(f"mcp:{n}", {}).get("tools", [])) == TOOLS
            and (groups.get(f"mcp:{n}", {}).get("server") or {}).get("status") == "ok"
            for n in ("fake-stdio", "fake-http"))
        run.report(ok, "the refresh lists both gateway groups with three tools",
                   *[f"{k}: {[r['label'] for r in g.get('tools', [])]} {(g.get('server') or {}).get('status')}"
                     for k, g in groups.items() if k.startswith("mcp:")])
        run.report(code2 == 200 and got_tools.get("groups") == refreshed.get("groups"),
                   "GET /agents/{id}/tools answers the same groups")
        off = ["mcp__fake-http__add", "mcp__fake-stdio__echo", "mcp__fake-stdio__add", "mcp__fake-stdio__whoami"]
        code, saved = run.http("PUT", f"/agents/{rid}", {
            "agent": {"name": "Researcher", "toolsOff": off}, "baseRevision": researcher.get("revision"),
            "clientId": CLIENT})
        run.report(code == 200 and sorted(saved.get("toolsOff", [])) == sorted(off), f"toolsOff saved: {code}")
        cli, evs = chat("FAKE:mcp:fake-http:add", agent=rid)
        results = tool_results(evs)
        run.report(bool(results) and results[0].get("isError") and DENIED in result_text(results[0]),
                   f"add is denied: {[result_text(e)[:80] for e in results]}")
        run.report("mcp__fake-http__add" in (cli.get("disallowed") or []), "mcp__fake-http__add is disallowed")
        run.report("fake-stdio" not in (cli.get("mcpServers") or []) and "fake-http" in (cli.get("mcpServers") or []),
                   f"fake-stdio left out (all its tools off): {cli.get('mcpServers')}")
        cli, _ = chat("Hello")
        run.report({"fake-stdio", "fake-http"} <= set(cli.get("mcpServers") or []),
                   f"the default agent still has both: {cli.get('mcpServers')}")

        print("\n7. fake-http turned off")
        code, web = run.http("PUT", f"/mcp-servers/{hid}", {
            "server": server_input(web, enabled=False), "baseRevision": web.get("revision"), "clientId": CLIENT})
        cli, _ = chat("Hello again")
        run.report(code == 200 and web.get("enabled") is False and "fake-http" not in (cli.get("mcpServers") or []),
                   f"no fake-http in the next turn: {cli.get('mcpServers')}")

        print("\n8. A folder server")
        mcp_json = {"mcpServers": {"folder-fake": {
            "command": sys.executable, "args": [str(FAKE_SERVER), "--require-env", "FOLDER_KEY"],
            "env": {"FOLDER_KEY": "${FOLDER_KEY}"}}}}
        (rfolder / ".mcp.json").write_text(json.dumps(mcp_json, indent=2) + "\n", encoding="utf-8")
        _, agent = run.http("GET", f"/agents/{rid}")
        folder_servers = agent.get("mcpServers", [])
        run.report(folder_servers == [{"name": "folder-fake", "missingVars": ["FOLDER_KEY"], "usable": False}],
                   f"missingVars FOLDER_KEY, usable false: {folder_servers}")
        _, secrets = run.http("GET", "/mcp-secrets")
        var = next((v for v in secrets.get("vars", []) if v["name"] == "FOLDER_KEY"), {})
        run.report(var.get("set") is False and var.get("settable") is True
                   and var.get("usedBy") == [{"agentId": rid, "agentName": "Researcher", "server": "folder-fake"}],
                   f"listed as missing, used by Researcher: {var}")
        code, done = run.http("PUT", "/mcp-secrets/FOLDER_KEY", {"value": FOLDER_SECRET, "clientId": CLIENT})
        _, agent = run.http("GET", f"/agents/{rid}")
        run.report(code == 200 and done == {"name": "FOLDER_KEY", "set": True}
                   and agent.get("mcpServers") == [{"name": "folder-fake", "missingVars": [], "usable": True}],
                   f"set: {code}; now {agent.get('mcpServers')}")
        snap = watched()
        code, refreshed = run.http("POST", f"/agents/{rid}/tools/refresh")
        changed_refresh += diff(snap, watched())
        group = next((g for g in refreshed.get("groups", []) if g["id"] == "mcp:folder-fake"), {})
        labels = sorted(r["label"] for r in group.get("tools", []) if r["id"] != "mcp__folder-fake")
        run.report(code == 200 and labels == TOOLS and (group.get("server") or {}).get("status") == "ok",
                   f"the refresh lists folder-fake's tools: {labels}")
        cli, evs = chat("FAKE:mcp:folder-fake:whoami", agent=rid, secret_ok=True)
        results = tool_results(evs)
        run.report(bool(results) and not results[0].get("isError") and result_text(results[0]) == FOLDER_SECRET,
                   "whoami answered the folder secret (compared, not printed)")

        print("\n9. A proposal turn")
        page = next((p.relative_to(root).as_posix() for p in sorted(root.rglob("*.md"))
                     if not p.relative_to(root).as_posix().startswith((".", "Templates/"))), None)
        cli, evs = chat("FAKE:tags", mode="tagObject", paths=[page] if page else [], agent=rid)
        names = sorted(cli.get("mcpServers") or [])
        env_refs = "OBJECT_MCP_" in json.dumps(cli.get("mcpConfig") or {})
        run.report(names == ["folder-fake", "object", "object-agent"] and not env_refs,
                   f"no gateway server: {names}")

        print("\n10. No secret leaked")
        events.close()
        leaks: list[str] = []
        whoami_files = {f"{c}.jsonl" for c in whoami_chats}
        for p in sorted(state.rglob("*")):
            if not p.is_file() or p == state / "secrets.json":
                continue
            if p.name in whoami_files:
                continue  # the whoami turns' transcripts: the tool's own answer (see the docstring)
            data = p.read_bytes()
            if any(s.encode() in data for s in SECRETS):
                leaks.append(str(p))
        for p in sorted(root.rglob("*")):
            if p.is_file() and ".git" not in p.parts and any(s.encode() in p.read_bytes() for s in SECRETS):
                leaks.append(str(p))
        handler.flush()
        # The whoami turns' frames, as a library logs them at DEBUG ("chunk: b'data: …'"), are the
        # tool's own answer too; every other line counts.
        app_lines = [line for line in app_log.read_text(encoding="utf-8", errors="replace").splitlines()
                     if not ('"type": "tool"' in line and '__whoami"' in line)]
        for label, text in (("app log", "\n".join(app_lines)),
                            ("fake's log", log.read_text(encoding="utf-8", errors="replace") if log.exists() else ""),
                            ("API answers", "\n".join(rec.bodies)),
                            ("chat frames", "\n".join(frames)),
                            ("event frames", "".join(events.frames))):
            if any(s in text for s in SECRETS):
                leaks.append(label)
        run.report(not leaks, "none of the three secrets outside secrets.json and the env",
                   *[f"in {x}" for x in leaks])
        run.report(bool(events.frames) and len(rec.bodies) > 20,
                   f"recorded {len(rec.bodies)} answers, {len(events.frames)} event lines, {len(frames)} chat streams")

        print("\n11. Deleting fake-stdio")
        code, gone = run.http("DELETE", f"/mcp-servers/{sid}", clientId=CLIENT)
        keys = list((json.loads((state / "secrets.json").read_text(encoding="utf-8")).get("secrets") or {}))
        cli, _ = chat("Hello once more")
        run.report(code == 200 and gone == {"ok": True} and not any(k.startswith(f"mcp:{sid}:") for k in keys)
                   and any(k.startswith(f"mcp:{hid}:") for k in keys),
                   f"its secrets are gone, others kept: {code} {len(keys)} keys")
        run.report("fake-stdio" not in (cli.get("mcpServers") or []), f"next turn: {cli.get('mcpServers')}")

        print("\n12. File safety")
        status = git(root, "status", "--porcelain", "--untracked-files=all").splitlines()
        run.report(not status, f"git status of the space copy is clean ({len(status)} lines)", *status[:10])
        run.report(not changed_reads, "the reads changed nothing", *changed_reads[:10])
        run.report(not changed_tests, "the Tests changed nothing", *changed_tests[:10])
        run.report(not changed_refresh, "the refreshes and the Tools GET changed nothing", *changed_refresh[:10])
        run.report(rfolder.is_relative_to(agents_dir.resolve()), "Researcher's folder is under the state dir")
    finally:
        if events is not None:
            events.close()
        if served is not None:
            served.stop()
        if stop_http is not None:
            stop_http()
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
