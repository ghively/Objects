"""Milestone 1 round-trip check of the server's write path.

Usage: ``uv run python scripts/m1_roundtrip.py SPACE [--edits 10] [--keep]``

1. Copies SPACE to a temporary folder (SPACE itself is never touched), lets
   `Space` create ``.capacities/types/`` there, and commits the copy to a
   throw-away git repo so changes show up in ``git diff``.
2. Starts the API on a free ``127.0.0.1`` port.
3. No-edit pass: for every object, GET it and PUT the identical body. Asserts
   no file's bytes changed ("0 files changed").
4. Edit pass: for up to N writable objects, replaces one word in the first
   paragraph line of the body, PUTs it, and prints ``git diff --stat``. Asserts
   each edited file differs only in that body line, ``lastUpdated`` and (when
   it was missing) a new ``id`` line.

Exits non-zero on any failed assertion.
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import uvicorn

from objectapp.server import create_app
from objectapp.space import Space

HOST = "127.0.0.1"
WORD = re.compile(r"[A-Za-z]{3,}")


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((HOST, 0))
        return s.getsockname()[1]


def http(method: str, url: str, payload: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-c", "core.autocrlf=false", "-c", "core.safecrlf=false", *args],
        cwd=repo, check=True, capture_output=True, text=True, encoding="utf-8",
    ).stdout


def snapshot(root: Path) -> dict[str, bytes]:
    return {
        p.relative_to(root).as_posix(): p.read_bytes()
        for p in root.rglob("*")
        if p.is_file() and ".git" not in p.relative_to(root).parts
        and p.relative_to(root).parts[0] != ".capacities-cache"  # derived search cache (M5), like .git
    }


def edit_first_paragraph(body: str) -> tuple[str, str, str] | None:
    """Replace one word in the first paragraph line. Returns (new_body, old_line, new_line)."""
    lines = body.split("\n")
    in_fence = False
    for i, line in enumerate(lines):
        s = line.strip()
        if s.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence or not s or s[0] in "#|>-*+" or s[0].isdigit() and ". " in s[:4]:
            continue
        m = WORD.search(line)
        if not m:
            continue
        new_line = line[: m.start()] + "Edited" + line[m.end():]
        lines[i] = new_line
        return "\n".join(lines), line.rstrip("\r"), new_line.rstrip("\r")
    return None


def check_edit_diff(before: bytes, after: bytes, old_line: str, new_line: str) -> list[str]:
    """Problems with the edited file's diff (empty when it's exactly as expected)."""
    problems: list[str] = []
    a = before.decode("utf-8-sig").splitlines(keepends=True)
    b = after.decode("utf-8-sig").splitlines(keepends=True)
    if before.startswith(b"\xef\xbb\xbf") != after.startswith(b"\xef\xbb\xbf"):
        problems.append("BOM changed")
    if before.endswith(b"\n") != after.endswith(b"\n"):
        problems.append("trailing newline changed")
    crlf_before = b"\r\n" in before
    crlf_after_all = after.count(b"\n") == after.count(b"\r\n")
    if (crlf_before and not crlf_after_all) or (not crlf_before and b"\r\n" in after):
        problems.append("line endings changed")
    diff = list(difflib.ndiff(a, b))
    removed = [l for l in diff if l.startswith("- ")]
    added = [l for l in diff if l.startswith("+ ")]
    # A file with no frontmatter gets a new block (`---`, id, lastUpdated, `---`) on save.
    had_fm = bool(a) and a[0].rstrip("\r\n") == "---"
    allowed_added = ("lastUpdated:", "id:") if had_fm else ("lastUpdated:", "id:", "---")
    for l in removed:
        text = l[2:].rstrip("\r\n")
        if text != old_line and not text.startswith("lastUpdated:"):
            problems.append(f"unexpected removed line: {text!r}")
    for l in added:
        text = l[2:].rstrip("\r\n")
        if text != new_line and not (text.startswith(allowed_added[:2]) or text in allowed_added[2:]):
            problems.append(f"unexpected added line: {text!r}")
    if not any(l[2:].rstrip("\r\n") == new_line for l in added):
        problems.append("edited line not found in the diff")
    return problems


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path)
    ap.add_argument("--edits", type=int, default=10)
    ap.add_argument("--keep", action="store_true", help="keep the temporary copy")
    args = ap.parse_args(argv)

    src = args.space.resolve()
    if not src.is_dir():
        ap.error(f"Not a folder: {src}")

    tmp = Path(tempfile.mkdtemp(prefix="m1-roundtrip-"))
    root = tmp / src.name
    shutil.copytree(src, root, ignore=shutil.ignore_patterns(".git"))
    failures = 0
    server = None
    thread = None
    try:
        space = Space(root)  # may create .capacities/types/ once; commit after that
        git(root, "init", "-q")
        git(root, "add", "-A")
        git(root, "-c", "user.name=m1", "-c", "user.email=m1@localhost", "commit", "-q", "-m", "base")

        port = free_port()
        app = create_app(space, None, watch=True)
        server = uvicorn.Server(uvicorn.Config(app, host=HOST, port=port, log_level="warning"))
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        base = f"http://{HOST}:{port}/api"
        for _ in range(100):
            try:
                if http("GET", base + "/space")[0] == 200:
                    break
            except OSError:
                time.sleep(0.1)
        print(f"Space copy: {root}")
        print(f"Server:     http://{HOST}:{port}/")

        # -- pass 1: no-edit -------------------------------------------------
        _, objects = http("GET", base + "/objects")
        before = snapshot(root)
        statuses: dict[int, int] = {}
        writable: list[tuple[str, dict]] = []
        for o in objects:
            q = urllib.parse.urlencode({"path": o["path"]})
            code, obj = http("GET", f"{base}/object?{q}")
            if code != 200:
                print(f"  GET {o['path']}: {code}")
                failures += 1
                continue
            code, res = http("PUT", base + "/object/body",
                             {"path": o["path"], "body": obj["body"], "baseVersion": obj["version"]})
            statuses[code] = statuses.get(code, 0) + 1
            if code == 200:
                if res["version"] != obj["version"]:
                    print(f"  {o['path']}: version changed on identical body")
                    failures += 1
                writable.append((o["path"], obj))
            elif code != 423:
                print(f"  PUT {o['path']}: unexpected {code} {res}")
                failures += 1
        after = snapshot(root)
        changed = sorted(k for k in before.keys() | after.keys() if before.get(k) != after.get(k))
        stat = git(root, "diff", "--stat").strip()
        print(f"\nNo-edit pass: {len(objects)} objects, PUT statuses {dict(sorted(statuses.items()))}"
              " (423 = read-only, not written)")
        print(f"  {len(changed)} files changed (byte compare); git diff --stat: {stat or '(empty)'}")
        if changed:
            failures += 1
            print("  FAIL: changed:", changed)

        # -- pass 2: one-word edits -----------------------------------------
        print(f"\nEdit pass (up to {args.edits} objects):")
        edited = 0
        for path, obj in writable:
            if edited >= args.edits:
                break
            e = edit_first_paragraph(obj["body"])
            if e is None:
                print(f"  {path}: no paragraph line, skipped")
                continue
            new_body, old_line, new_line = e
            raw_before = (root / path).read_bytes()
            code, res = http("PUT", base + "/object/body",
                             {"path": path, "body": new_body, "baseVersion": obj["version"]})
            if code != 200:
                print(f"  {path}: PUT {code} {res}")
                failures += 1
                continue
            edited += 1
            problems = check_edit_diff(raw_before, (root / path).read_bytes(), old_line, new_line)
            mark = "ok" if not problems else "FAIL"
            print(f"  [{mark}] {path}: {old_line!r} -> {new_line!r}")
            for p in problems:
                print(f"         {p}")
            failures += bool(problems)
        print(f"\n{edited} objects edited. git diff --stat:")
        print(git(root, "diff", "--stat").rstrip())
        print("\ngit diff --numstat (added removed path):")
        print(git(root, "diff", "--numstat").rstrip())
    finally:
        if server is not None:
            server.should_exit = True
        if thread is not None:
            thread.join(timeout=5)
        if args.keep:
            print(f"\nKept: {root}")
        else:
            shutil.rmtree(tmp, ignore_errors=True)

    print("\nRESULT:", "PASS" if failures == 0 else f"FAIL ({failures})")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
