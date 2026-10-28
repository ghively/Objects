"""Milestone 7 acceptance run over HTTP (plan Task 19, Step 2).

Usage: ``uv run python scripts/m7_acceptance.py SPACE [--keep] [--skip-roundtrip]``

Copies SPACE to a temporary folder (SPACE itself is never touched), commits the copy to a
throw-away git repo, opens it twice and serves it with ``create_app(space, None, watch=True)``
on a free ``127.0.0.1`` port, with ``OBJECT_STATE_DIR``, ``OBJECT_CACHE_DIR`` and
``OBJECT_FAKE_OPEN_FILE`` pointed at temporary paths outside the copy. The copy is registered
in the (temporary) spaces registry first, as the launcher does. Snapshots skip ``.git`` and
``.object-cache/``. Over HTTP it checks:

 1. calling every M7 read route twice (``GET /api/space``, ``/api/settings``, ``/api/spaces``,
    ``/api/attachments`` and ``/api/file`` for one file of each kind the space has) changes
    no file (``git status`` clean); no ``space.json`` or ``settings.json`` appears; the state
    dir holds only ``spaces.json`` (and M4's reminder ledger, which the scheduler keeps);
 2. uploading a PNG, a PDF, a WAV and an XLSX creates exactly those files under
    ``Attachments/``; a second upload with the same name adds `` (2)``; ``GET /api/file``
    returns each with the contract's headers; a ``Range`` request on the WAV is 206; an
    uploaded ``.html`` comes back as an octet-stream download; ``POST /api/attachments/open``
    records the PDF with the fake opener and refuses an ``.exe`` with 415;
 3. ``PUT /api/space`` with a new name changes only ``.object/space.json`` (created when
    absent); the folder name is unchanged; a stale revision is 409;
 4. ``PUT /api/settings`` writes only ``settings.json`` in the state dir; the space is
    unchanged;
 5. spaces: ``POST /api/spaces`` in a temporary location creates a folder holding only
    ``.object/space.json``; a second create is 409 and leaves the folder byte-identical;
    ``DELETE /api/spaces`` removes it from the list and the folder stays; a `SpaceHost` on a
    free port switches to it and ``GET /api/space`` reports its root;
 6. the editor round trip: ``OBJECT_ROUNDTRIP_SPACE=<copy> npx vitest run
    src/editor/roundtrip.space.test.ts`` (in ``frontend/``) passes: every body byte-identical
    without edits, and every annotated block's option toggled on and off restores the bytes;
 7. the M1 no-edit pass: 0 files changed.

Each check prints ``[ok]`` or ``[FAIL]``; exits non-zero on any failure.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

import uvicorn

from m2_acceptance import (
    HOST, Http, Run, changed_paths, check_migration, commit, free_port, git, remove_tree, snapshot,
)
from objectapp.__main__ import SpaceHost
from objectapp.appstate import state_dir
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.spaces import Registry

REPO = Path(__file__).resolve().parents[1]
FRONTEND = REPO / "frontend"

# A 1x1 PNG, a minimal PDF, a short WAV and a stand-in XLSX (the server goes by extension).
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082"
)
PDF = b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\n" \
      b"trailer<</Root 1 0 R>>\n%%EOF\n"
WAV = (b"RIFF" + (36 + 400).to_bytes(4, "little") + b"WAVEfmt " + (16).to_bytes(4, "little")
       + (1).to_bytes(2, "little") + (1).to_bytes(2, "little") + (8000).to_bytes(4, "little")
       + (8000).to_bytes(4, "little") + (1).to_bytes(2, "little") + (8).to_bytes(2, "little")
       + b"data" + (400).to_bytes(4, "little") + bytes(range(200)) * 2)
XLSX = b"PK\x03\x04" + b"synthetic spreadsheet stand-in" * 4

UPLOADS = [
    ("m7 pixel.png", PNG, "image", "image/png"),
    ("m7 report.pdf", PDF, "pdf", "application/pdf"),
    ("m7 clip.wav", WAV, "audio", None),
    ("m7 data.xlsx", XLSX, "file", "application/octet-stream"),
]


# -- server --------------------------------------------------------------------


def wait_up(http: Http) -> None:
    for _ in range(400):
        try:
            if http("GET", "/space")[0] == 200:
                return
        except OSError:
            pass
        time.sleep(0.05)


class Served:
    """One `Space` served on a free port with the app's lifespan (watcher, search index)."""

    def __init__(self, root: Path) -> None:
        self.space = Space(root)
        self.port = free_port()
        app = create_app(self.space, None, watch=True)
        self.server = uvicorn.Server(uvicorn.Config(app, host=HOST, port=self.port, log_level="warning"))
        self.thread = threading.Thread(target=self.server.run, daemon=True)
        self.thread.start()
        self.base = f"http://{HOST}:{self.port}/api"
        self.http = Http(self.base)
        wait_up(self.http)

    def stop(self) -> None:
        self.server.config.app.state.hub.close()
        self.server.should_exit = True
        self.thread.join(timeout=10)


def raw(base: str, method: str, route: str, body: bytes | None = None, headers: dict[str, str] | None = None,
        **query: Any) -> tuple[int, dict[str, str], bytes]:
    """A request that returns the status, the headers (lower-case keys) and the raw body."""
    q = {k: v for k, v in query.items() if v is not None}
    url = base + route + ("?" + urllib.parse.urlencode(q) if q else "")
    req = urllib.request.Request(url, data=body, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


def state_files() -> list[str]:
    folder = state_dir()
    return sorted(p.name for p in folder.iterdir()) if folder.is_dir() else []


def extra_state(names: list[str], allowed: set[str]) -> list[str]:
    """State-dir files beyond `allowed` and M4's reminder ledgers."""
    return [n for n in names if n not in allowed and not (n.startswith("reminders-") and n.endswith(".json"))]


def expected_headers(kind: str, h: dict[str, str]) -> list[str]:
    """What is wrong with the served headers of a file of `kind` (empty when they match the contract)."""
    bad = []
    if h.get("x-content-type-options") != "nosniff":
        bad.append("no nosniff")
    disp = h.get("content-disposition", "")
    ctype = h.get("content-type", "")
    if kind == "image":
        if "sandbox" not in h.get("content-security-policy", ""):
            bad.append("image without the sandbox CSP")
    elif kind in ("pdf", "audio", "video"):
        if not disp.startswith("inline"):
            bad.append(f"{kind} not inline: {disp!r}")
        if kind == "pdf" and not ctype.startswith("application/pdf"):
            bad.append(f"pdf type {ctype!r}")
        if kind in ("audio", "video"):
            if not ctype.startswith(kind + "/"):
                bad.append(f"{kind} type {ctype!r}")
            if h.get("accept-ranges") != "bytes":
                bad.append("no Accept-Ranges")
    else:
        if not ctype.startswith("application/octet-stream"):
            bad.append(f"file type {ctype!r}")
        if not disp.startswith("attachment"):
            bad.append(f"file not a download: {disp!r}")
    return bad


# -- checks --------------------------------------------------------------------


def check_reads(run: Run, base: str) -> None:
    print("\n1. Reading every M7 route writes nothing")
    before = snapshot(run.root)
    state_before = state_files()
    _, atts = run.http("GET", "/attachments")
    by_kind: dict[str, str] = {}
    for a in atts if isinstance(atts, list) else []:
        by_kind.setdefault(a["kind"], a["path"])
    codes: dict[str, set[int]] = {}
    header_problems: list[str] = []
    for _ in range(2):
        for route in ("/space", "/settings", "/spaces", "/attachments"):
            codes.setdefault(route, set()).add(run.http("GET", route)[0])
        for kind, path in by_kind.items():
            code, h, _body = raw(base, "GET", "/file", path=path)
            codes.setdefault(f"/file ({kind})", set()).add(code)
            header_problems += [f"{path}: {p}" for p in expected_headers(kind, h)]
    time.sleep(0.4)
    diff = changed_paths(before, snapshot(run.root))
    status = git(run.root, "status", "--porcelain", "-uall").strip()
    created = [p for p in (".object/space.json",) if (run.root / p).exists() and p not in before]
    names = state_files()
    extra = extra_state(names, {"spaces.json"})
    ok_codes = all(c == {200} for c in codes.values())
    run.report(
        not diff and not status and not created and "settings.json" not in names and not extra and ok_codes
        and not header_problems,
        f"{len(codes)} routes read twice ({', '.join(sorted(by_kind))} served); statuses "
        f"{ {k: sorted(v) for k, v in codes.items() if v != {200}} or 'all 200'}; {len(diff)} files changed; "
        f"state dir {state_before} -> {names}",
        *diff, *([status] if status else []), *created, *extra, *header_problems,
    )


def check_attachments(run: Run, base: str, fake_open: Path) -> None:
    print("\n2. Attachments: upload, serve, ranges, downloads, open")
    before = snapshot(run.root)
    results = []
    for name, data, kind, _ctype in UPLOADS:
        code, h, body = raw(base, "POST", "/attachments", data, {"Content-Type": "application/octet-stream"},
                            name=name)
        res = json.loads(body or b"null") if code == 201 else body
        results.append((code, res))
    expected = {f"Attachments/{n}" for n, *_ in UPLOADS}
    got = {r.get("path") for c, r in results if c == 201 and isinstance(r, dict)}
    kinds_ok = all(isinstance(r, dict) and r.get("kind") == k for (c, r), (_n, _d, k, _t) in zip(results, UPLOADS,
                                                                                                strict=True))
    diff = changed_paths(before, snapshot(run.root))
    run.report(got == expected and set(diff) == expected and kinds_ok,
               f"uploads {[c for c, _ in results]} -> {sorted(got)}; files added: {diff}")
    bytes_ok = all((run.root / f"Attachments/{n}").read_bytes() == d for n, d, *_ in UPLOADS)
    run.report(bytes_ok, f"uploaded bytes byte-identical: {bytes_ok}")

    code, _h, body = raw(base, "POST", "/attachments", PNG, {"Content-Type": "application/octet-stream"},
                         name=UPLOADS[0][0])
    second = json.loads(body or b"null") if code == 201 else {}
    run.report(code == 201 and second.get("path") == "Attachments/m7 pixel (2).png"
               and (run.root / "Attachments/m7 pixel.png").read_bytes() == PNG,
               f"same name again: {code} {second.get('path')}; first file untouched")

    problems = []
    for name, data, kind, ctype in UPLOADS:
        code, h, body = raw(base, "GET", "/file", path=f"Attachments/{name}")
        if code != 200 or body != data:
            problems.append(f"{name}: {code}, body identical {body == data}")
        if ctype and not h.get("content-type", "").startswith(ctype):
            problems.append(f"{name}: content-type {h.get('content-type')!r}")
        problems += [f"{name}: {p}" for p in expected_headers(kind, h)]
    run.report(not problems, "GET /api/file returns each upload with the contract's headers", *problems)

    code, h, body = raw(base, "GET", "/file", headers={"Range": "bytes=4-11"}, path="Attachments/m7 clip.wav")
    run.report(code == 206 and body == WAV[4:12] and h.get("content-range", "").startswith("bytes 4-11/"),
               f"Range on the WAV: {code}, {h.get('content-range')}, {len(body)} bytes")

    page = b"<!doctype html><script>document.title='ran'</script><p>synthetic</p>"
    code, _h, body = raw(base, "POST", "/attachments", page, {"Content-Type": "application/octet-stream"},
                         name="m7 page.html")
    html_path = json.loads(body).get("path") if code == 201 else ""
    code2, h, served = raw(base, "GET", "/file", path=html_path)
    run.report(code == 201 and code2 == 200 and h.get("content-type", "").startswith("application/octet-stream")
               and h.get("content-disposition", "").startswith("attachment") and served == page,
               f"an uploaded .html: {code} {html_path}; served as {h.get('content-type')!r}, "
               f"{h.get('content-disposition')!r}")

    fake_open.unlink(missing_ok=True)
    code, res = run.http("POST", "/attachments/open", {"path": "Attachments/m7 report.pdf"})
    opened = fake_open.read_text("utf-8").splitlines() if fake_open.is_file() else []
    want = str((run.root / "Attachments/m7 report.pdf").resolve())
    run.report(code == 200 and res == {"ok": True} and opened == [want],
               f"open the PDF: {code} {res}; fake opener recorded {opened}")
    code, _h, body = raw(base, "POST", "/attachments", b"MZ synthetic",
                         {"Content-Type": "application/octet-stream"}, name="tool.exe")
    exe = json.loads(body).get("path") if code == 201 else "Attachments/tool.exe"
    code2, res2 = run.http("POST", "/attachments/open", {"path": exe})
    after = fake_open.read_text("utf-8").splitlines() if fake_open.is_file() else []
    run.report(code2 == 415 and after == opened,
               f"open an .exe: {code2} {res2.get('detail') if isinstance(res2, dict) else res2}; "
               f"nothing launched: {after == opened}")
    code3, _ = run.http("GET", "/file", path="../outside.txt")
    code4, _ = run.http("GET", "/file", path=".object/types/page.json")
    run.report(code3 == 404 and code4 == 404, f"traversal {code3}, dot-folder {code4}")
    commit(run.root, "attachments")


def check_space(run: Run) -> None:
    print("\n3. PUT /api/space")
    _, info = run.http("GET", "/space")
    had = (run.root / ".object/space.json").is_file()
    before = snapshot(run.root)
    new_name = f"{info['name']} (M7)"
    code, res = run.http("PUT", "/space", {"patch": {"name": new_name}, "baseRevision": info["revision"]})
    diff = changed_paths(before, snapshot(run.root))
    stored = json.loads((run.root / ".object/space.json").read_text("utf-8")) if diff else {}
    run.report(
        code == 200 and res.get("name") == new_name and diff == [".object/space.json"]
        and stored.get("name") == new_name and run.root.is_dir() and Path(res.get("root", "")).name == run.root.name,
        f"{code}: name {res.get('name')!r}; files changed: {diff} ({'updated' if had else 'created'}); "
        f"folder still {run.root.name!r}",
    )
    commit(run.root, "space renamed")
    before = snapshot(run.root)
    code, res = run.http("PUT", "/space", {"patch": {"name": "Stale"}, "baseRevision": info["revision"]})
    diff = changed_paths(before, snapshot(run.root))
    run.report(code == 409 and not diff, f"stale revision: {code}; {len(diff)} files changed")


def check_settings(run: Run) -> None:
    print("\n4. PUT /api/settings")
    before = snapshot(run.root)
    _, cur = run.http("GET", "/settings")
    code, res = run.http("PUT", "/settings", {"patch": {"themeMode": "light", "font": "serif"},
                                              "baseRevision": cur["revision"]})
    diff = changed_paths(before, snapshot(run.root))
    file = state_dir() / "settings.json"
    stored = json.loads(file.read_text("utf-8")) if file.is_file() else {}
    run.report(
        code == 200 and res["settings"]["themeMode"] == "light" and stored.get("font") == "serif" and not diff,
        f"{code}: settings.json in the state dir {file.is_file()}; {len(diff)} space files changed; "
        f"state dir {state_files()}",
    )
    code, _ = run.http("PUT", "/settings", {"patch": {"themeMode": "dark"}, "baseRevision": cur["revision"]})
    code2, _ = run.http("PUT", "/settings", {"patch": {"noSuchKey": 1}, "baseRevision": res["revision"]})
    run.report(code == 409 and code2 == 422, f"stale revision {code}, unknown key {code2}")


def check_spaces(run: Run, tmp: Path) -> None:
    print("\n5. Spaces: create, refuse, remove, switch")
    location = tmp / "new-spaces"
    location.mkdir()
    code, res = run.http("POST", "/spaces", {"name": "M7 second space", "location": str(location)})
    folder = Path(res.get("path", "")) if isinstance(res, dict) else Path()
    inside = sorted(p.relative_to(folder).as_posix() for p in folder.rglob("*") if p.is_file()) if code == 201 else []
    run.report(code == 201 and folder.parent == location.resolve() and inside == [".object/space.json"],
               f"create: {code} {folder}; holds {inside}")
    snap = snapshot(folder) if folder.is_dir() else {}
    code2, res2 = run.http("POST", "/spaces", {"name": "M7 second space", "location": str(location)})
    run.report(code2 == 409 and snapshot(folder) == snap, f"second create: {code2}; folder byte-identical")
    _, listed = run.http("GET", "/spaces")
    paths = [e["path"] for e in listed["spaces"]]
    current = [e["path"] for e in listed["spaces"] if e["current"]]
    run.report(str(folder) in paths and current == [str(run.root.resolve())],
               f"listed: {len(paths)} spaces, current {current}")
    code3, _ = run.http("DELETE", "/spaces", path=str(folder))
    _, listed = run.http("GET", "/spaces")
    still = str(folder) in [e["path"] for e in listed["spaces"]]
    code4, _ = run.http("DELETE", "/spaces", path=str(run.root))
    run.report(code3 == 200 and not still and folder.is_dir() and snapshot(folder) == snap and code4 == 409,
               f"remove: {code3}, gone from the list {not still}, folder kept {folder.is_dir()}; "
               f"removing the open space {code4}")

    code5, res5 = run.http("POST", "/spaces/switch", {"path": str(folder)})
    run.report(code5 == 503, f"switch without the launcher: {code5} {res5.get('detail') if isinstance(res5, dict) else ''}")

    port = free_port()
    host = SpaceHost(port, static_dir=None)
    thread = threading.Thread(target=host.run, args=(run.root,), daemon=True)
    thread.start()
    http = Http(f"http://{HOST}:{port}/api")
    try:
        wait_up(http)
        first = http("GET", "/space")[1].get("root")
        code6, _ = http("POST", "/spaces/switch", {"path": str(tmp / "not-a-folder")})
        code7, res7 = http("POST", "/spaces/switch", {"path": str(folder)})
        root = None
        for _ in range(200):
            try:
                c, info = http("GET", "/space")
                if c == 200 and info.get("root") != first:
                    root = info.get("root")
                    break
            except OSError:
                pass
            time.sleep(0.05)
        run.report(code6 == 404 and code7 == 202 and root == str(folder),
                   f"SpaceHost on :{port}: non-folder {code6}; switch {code7}; GET /api/space root {root}")
    finally:
        host.stop()
        thread.join(timeout=10)
    # Opening a space with no type files writes the built-in Page and Tag types (M3's
    # typemodel.BUILTIN_TYPES); nothing else may change, and space.json keeps its bytes.
    added = changed_paths(snap, snapshot(folder))
    stray = [p for p in added if not (p.startswith(".object/types/") and p.endswith(".json"))]
    run.report(not stray and snapshot(folder).get(".object/space.json") == snap.get(".object/space.json"),
               f"serving the new space wrote only built-in type files: {added}", *stray)
    commit(run.root, "spaces")


def check_roundtrip(run: Run) -> None:
    print("\n6. Editor round trip (roundtrip.space.test.ts)")
    before = snapshot(run.root)
    npx = shutil.which("npx") or "npx"
    proc = subprocess.run(
        [npx, "vitest", "run", "src/editor/roundtrip.space.test.ts"],
        cwd=FRONTEND, env={**os.environ, "OBJECT_ROUNDTRIP_SPACE": str(run.root)},
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    out = proc.stdout + proc.stderr
    tail = [ln for ln in out.splitlines() if "Tests" in ln or "differ" in ln or "FAIL" in ln][-8:]
    summary = [ln for ln in out.splitlines() if ln.strip().startswith("Tests")]
    ran = bool(summary) and "1 passed" in summary[-1] and "skipped" not in summary[-1]
    run.report(proc.returncode == 0 and ran and not changed_paths(before, snapshot(run.root)),
               f"vitest exit {proc.returncode}", *tail)


def check_no_edit(run: Run) -> None:
    print("\n7. M1 no-edit pass")
    before = snapshot(run.root)
    _, objs = run.http("GET", "/objects")
    statuses: dict[int, int] = {}
    for s in objs:
        o = run.obj(s["path"])
        code, _ = run.http("PUT", "/object/body", {"path": s["path"], "body": o["body"], "baseVersion": o["version"]})
        statuses[code] = statuses.get(code, 0) + 1
    diff = changed_paths(before, snapshot(run.root))
    run.report(not diff and set(statuses) <= {200, 423},
               f"{len(objs)} objects, statuses {statuses}, {len(diff)} files changed", *diff)


# -- main ----------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path)
    ap.add_argument("--keep", action="store_true", help="keep the temporary copy")
    ap.add_argument("--skip-roundtrip", action="store_true", help="skip check 6 (needs frontend/node_modules)")
    args = ap.parse_args(argv)
    src = args.space.resolve()
    if not src.is_dir():
        ap.error(f"Not a folder: {src}")

    tmp = Path(tempfile.mkdtemp(prefix="m7-acceptance-")).resolve()
    root = tmp / src.name
    shutil.copytree(src, root, ignore=shutil.ignore_patterns(".git", ".object-cache"))
    os.environ["OBJECT_STATE_DIR"] = str(tmp / "state")
    os.environ["OBJECT_CACHE_DIR"] = str(tmp / "cache")
    fake_open = tmp / "opened.txt"
    os.environ["OBJECT_FAKE_OPEN_FILE"] = str(fake_open)
    git(root, "init", "-q")
    commit(root, "base")
    original = snapshot(root)

    served: Served | None = None
    run: Run | None = None
    try:
        _space, mig = check_migration(root, original)
        Registry(state_dir()).register(root)  # what the launcher does before serving
        served = Served(root)
        run = Run(root, served.http)
        print(f"Space copy: {root}")
        print(f"\n0. Opening twice: {mig[0]}", *mig[1:], sep="\n   ")
        run.failures += mig[0] != "ok"

        check_reads(run, served.base)
        check_attachments(run, served.base, fake_open)
        check_space(run)
        check_settings(run)
        check_spaces(run, tmp)
        if args.skip_roundtrip:
            print("\n6. Editor round trip: skipped (--skip-roundtrip)")
        else:
            check_roundtrip(run)
        check_no_edit(run)
    finally:
        if served is not None:
            served.stop()
        if args.keep:
            print(f"\nKept: {root}")
        else:
            remove_tree(tmp)

    failures = run.failures if run else 1
    print("\nRESULT:", "PASS" if failures == 0 else f"FAIL ({failures})")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
