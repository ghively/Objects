"""Milestone 11 acceptance run: the local API and the ``objectapp-mcp`` server, end to end.

Usage: ``uv run python scripts/m11_acceptance.py SPACE [--keep]``

Copies SPACE to a temporary folder (SPACE itself is never touched), marks one Page
"Exclude from AI" (``excludeFromAI: true``, written into the copy before it is committed),
commits the copy to a throw-away git repo (again after one open, which migrates an old
space) and serves it with ``create_app`` on a free
``127.0.0.1`` port. ``OBJECT_STATE_DIR`` and ``OBJECT_CACHE_DIR`` point outside the copy.
Then, over HTTP and over a real stdio MCP session (``objectapp-mcp`` started as a child
process, the way Claude Code or Claude Desktop start it), it checks:

 1. tokens: one ``read`` and one ``read-write`` token are made through
    ``/api/integrations/tokens``; neither secret appears in any file of the space or in the
    state dir (only hashes are kept); ``/api/v1`` refuses a missing or wrong token (401);
 2. a ``read`` token's MCP session lists only the read tools; every read tool runs and
    ``git status`` stays clean (reads write nothing);
 3. the excluded Page is absent from search, query and changes, and reading it gives an
    error;
 4. a ``read-write`` session: ``create_task`` (``create_object`` in a space without Tasks), ``append_to_section``, ``add_tags``,
    ``rename`` and ``move_to_trash`` work; ``add_tags`` changes only the ``tags`` and
    ``lastUpdated`` lines; a stale version is refused (conflict) and changes nothing; the
    activity log lists the writes under the token's name;
 5. revoking the read-write token makes the next call fail with 401.

Each check prints ``[ok]`` or ``[FAIL]``; exits non-zero on any failure.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any

from m2_acceptance import Run, commit, git, remove_tree
from m8_acceptance import Served, diff_keys
from objectapp.space import Space
from objectapp.toolcatalog import OBJECT_READ
from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

REPO = Path(__file__).resolve().parents[1]
HOOKS = ("OBJECT_STATE_DIR", "OBJECT_CACHE_DIR")
READ_TOOLS = {
    "schema", "search", "query", "run_saved_query", "peek", "read", "backlinks",
    "daily_note", "changes_since",
}


def exclude_one(root: Path) -> str | None:
    """Mark the first Page with frontmatter "Exclude from AI"; return its path."""
    for p in sorted(root.rglob("*.md")):
        rel = p.relative_to(root).as_posix()
        if rel.startswith((".", "Templates/")):
            continue
        text = p.read_text(encoding="utf-8")
        if text.startswith("---\n") and "type: 'Page'" in text and "title:" in text:
            p.write_text(text.replace("---\n", "---\nexcludeFromAI: true\n", 1), encoding="utf-8")
            return rel
    return None


def clean(root: Path) -> bool:
    return git(root, "status", "--porcelain", "--untracked-files=all").strip() == ""


class Mcp:
    """One stdio MCP session against ``objectapp-mcp``."""

    def __init__(self, url: str, token: str) -> None:
        env = {**os.environ, "OBJECT_API_URL": url, "OBJECT_API_TOKEN": token}
        self.params = StdioServerParameters(
            command="uv", args=["run", "--directory", str(REPO), "objectapp-mcp"], env=env
        )

    async def run(self, steps):
        async with stdio_client(self.params) as (read, write), ClientSession(read, write) as session:
            await session.initialize()
            return await steps(session)


async def call(session: ClientSession, name: str, **args: Any) -> tuple[bool, Any]:
    """(ok, answer) of one tool call; the answer is the JSON it returned, or the error text."""
    res = await session.call_tool(name, args)
    text = " ".join(getattr(c, "text", "") for c in res.content)
    if res.is_error:
        return False, text
    if res.structured_content is not None:
        out = res.structured_content
        return True, out.get("result", out) if set(out) == {"result"} else out
    try:
        return True, json.loads(text)
    except ValueError:
        return True, text


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path)
    ap.add_argument("--keep", action="store_true", help="keep the temporary copy")
    args = ap.parse_args(argv)
    src = args.space.resolve()
    if not src.is_dir():
        ap.error(f"Not a folder: {src}")

    tmp = Path(tempfile.mkdtemp(prefix="m11-acceptance-")).resolve()
    root = tmp / src.name
    shutil.copytree(src, root, ignore=shutil.ignore_patterns(".git", ".object-cache"))
    saved_env = {k: os.environ.get(k) for k in HOOKS}
    os.environ.update({"OBJECT_STATE_DIR": str(tmp / "state"), "OBJECT_CACHE_DIR": str(tmp / "cache")})
    excluded = exclude_one(root)
    git(root, "init", "-q")
    commit(root, "base")
    # A space from before M2 is migrated once on its first open (checked by m2/m9 acceptance);
    # commit that, so check 2 sees only what the API's reads do.
    Space(root)
    commit(root, "opened once")

    served: Served | None = None
    run: Run | None = None
    try:
        served = Served(root)
        run = Run(root, served.http)
        url = served.base.removesuffix("/api")
        print(f"Space copy: {root}\nServed at: {url}\nExcluded: {excluded}")

        print("\n1. Tokens")
        _, ro = run.http("POST", "/integrations/tokens", {"name": "acceptance read", "scope": "read"})
        _, rw = run.http("POST", "/integrations/tokens", {"name": "acceptance agent", "scope": "read-write"})
        secrets = [ro["secret"], rw["secret"]]
        leaked = [
            p for base in (root, tmp / "state") for p in base.rglob("*")
            if p.is_file() and ".git" not in p.parts
            and any(s.encode() in p.read_bytes() for s in secrets)
        ]
        run.report(not leaked, "no file in the space or state dir holds a secret", *map(str, leaked))
        run.report((tmp / "state" / "api-tokens.json").is_file(), "tokens kept in the state dir, not the space")
        code, _ = run.http("GET", "/v1/schema")
        run.report(code == 401, f"/api/v1 without a token: {code}")

        print("\n2. Read-only session")

        async def reads(s: ClientSession) -> None:
            names = {t.name for t in (await s.list_tools()).tools}
            run.report(names == set(OBJECT_READ), f"read token lists only the read tools ({len(names)})",
                       *sorted(names ^ set(OBJECT_READ)))
            ok, schema = await call(s, "schema")
            run.report(ok and schema["types"], f"schema: {len(schema['types']) if ok else schema} types")
            ok, found = await call(s, "search", query="a", limit=5)
            run.report(ok, f"search: {len(found['results']) if ok else found} results")
            ok, rows = await call(s, "query", limit=200)
            first = rows["rows"][0]["path"] if ok and rows["rows"] else None
            run.report(ok and first is not None, f"query: {rows['total'] if ok else rows} rows")
            if first:
                for tool in ("peek", "read", "backlinks"):
                    ok, ans = await call(s, tool, path=first)
                    run.report(ok, f"{tool} {first}", "" if ok else str(ans))
            ok, ch = await call(s, "changes_since", since="2000-01-01")
            run.report(ok, f"changes_since: {len(ch['objects']) if ok else ch} objects")
            ok, ans = await call(s, "daily_note", date="1999-01-01")
            run.report(not ok and "404" in str(ans), "daily_note for a day without one reports 404")
            if excluded:
                print("\n3. Exclude from AI")
                paths = [r["path"] for r in rows["rows"]] if isinstance(rows, dict) else []
                run.report(excluded not in paths, "excluded Page left out of query")
                ok, found = await call(s, "search", query=Path(excluded).stem, limit=50)
                run.report(ok and excluded not in [r.get("path") for r in found["results"]],
                           "excluded Page left out of search")
                ok, ch = await call(s, "changes_since", since="2000-01-01", limit=500)
                run.report(ok and excluded not in [o["path"] for o in ch["objects"]],
                           "excluded Page left out of changes")
                ok, ans = await call(s, "read", path=excluded)
                run.report(not ok and "404" in str(ans), "reading the excluded Page gives 404")

        asyncio.run(Mcp(url, ro["secret"]).run(reads))
        run.report(clean(root), "reads changed no file (git status clean)", git(root, "status", "--short"))

        print("\n4. Read-write session")

        async def writes(s: ClientSession) -> None:
            names = {t.name for t in (await s.list_tools()).tools}
            run.report("create_task" in names and READ_TOOLS <= names, f"read-write token lists {len(names)} tools")
            _, schema = await call(s, "schema")
            if "Task" in [t["name"] for t in schema["types"]]:
                tool, ok, made = "create_task", *await call(
                    s, "create_task", title="M11 acceptance task", status="Not Started",
                    date="2026-11-06", body="## Notes\n\nFirst line.\n")
            else:  # a space without the Task type
                tool, ok, made = "create_object", *await call(
                    s, "create_object", type="Page", title="M11 acceptance task",
                    body="## Notes\n\nFirst line.\n")
            if not run.report(ok, f"{tool}: {made.get('path') if ok else made}"):
                return
            path, version = made["path"], made["version"]
            ok, ans = await call(s, "append_to_section", path=path, version=version,
                                 heading="Notes", text="Second line.")
            run.report(ok and "Second line." in run.text(path), "append_to_section adds under the heading")
            version = ans["version"] if ok else version
            before = (root / path).read_bytes()
            ok, ans = await call(s, "add_tags", path=path, version=version, tags=["acceptance"])
            after = (root / path).read_bytes()
            removed, added = diff_keys(before, after)
            run.report(ok and (removed | added) <= {"tags", "lastUpdated"},
                       f"add_tags changes only its own lines: {sorted(removed | added)}")
            version = ans["version"] if ok else version
            ok, ans = await call(s, "append_to_section", path=path, version="stale", text="nope")
            run.report(not ok and "Conflict" in str(ans) and (root / path).read_bytes() == after,
                       "a stale version is refused and changes nothing")
            ok, ren = await call(s, "rename", path=path, version=version, title="M11 acceptance renamed")
            run.report(ok and (root / ren["path"]).is_file() and not (root / path).exists(),
                       f"rename: {ren.get('path') if ok else ren}")
            if ok:
                ok, ans = await call(s, "move_to_trash", path=ren["path"], version=ren["version"])
                run.report(ok and not (root / ren["path"]).exists(), "move_to_trash")
            ok, ch = await call(s, "changes_since")
            actions = [e["action"] for e in ch["activity"]] if ok else []
            run.report(actions == ["create", "section-append", "properties", "rename", "trash"]
                       and {e["token"] for e in ch["activity"]} == {"acceptance agent"},
                       f"activity log: {actions}")

        asyncio.run(Mcp(url, rw["secret"]).run(writes))

        print("\n5. Revoke")
        code, _ = run.http("DELETE", f"/integrations/tokens/{rw['token']['id']}")

        async def revoked(s: ClientSession) -> None:
            ok, ans = await call(s, "schema")
            run.report(not ok and "401" in str(ans), f"revoked token refused: {ans if not ok else 'still works'}")

        run.report(code == 200, f"revoke: {code}")
        asyncio.run(Mcp(url, rw["secret"]).run(revoked))
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
