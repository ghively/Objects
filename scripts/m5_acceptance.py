"""Milestone 5 acceptance run over HTTP (plan Task 13, Step 2).

Usage: ``uv run python scripts/m5_acceptance.py SPACE [--keep] [--big]``

Copies SPACE to a temporary folder (SPACE itself is never touched), commits the
copy to a throw-away git repo, opens it twice and serves it on a free
``127.0.0.1`` port **without** ``OBJECT_CACHE_DIR``, so the default
``.object-cache/`` inside the space is exercised. Over HTTP it checks:

 1. starting, waiting for ``partial: false`` and calling every M5 read
    (``GET /api/search``, ``GET /api/references`` and ``GET /api/object`` for
    every object, ``GET /api/graph``, ``POST /api/rows``) leaves ``git status``
    empty and every file outside ``.object-cache/`` byte-identical; the cache
    gains only ``search.sqlite`` and ``.gitignore`` (files already there are
    unchanged); a second start changes no byte or mtime in the cache;
 2. search: a word only one object has finds it with a snippet; a title with
    letters left out finds it by title; ``type``, ``excludeType`` and ``tag``
    filter; a word added with ``PUT /api/object/body`` is found within 2 s; a
    deleted object is gone; a word written to a file from outside (the
    watcher) is found within 2 s;
 3. deleting ``search.sqlite`` while running and ``POST /api/search/reindex``
    rebuilds it; garbage in it plus a restart rebuilds it with no error;
 4. references: backlink paths of ``GET /api/references`` equal ``GET
    /api/object``'s ``backlinks`` and the set this script computes from the
    files (a minimal wikilink scan that skips code); linking a mention with
    ``POST /api/references/link`` changes only the mention line plus
    ``lastUpdated``; a stale ``baseVersion`` is 409;
 5. graph: node count equals ``GET /api/objects``, link pairs equal the
    script's pairs; ``PUT /api/ui`` with ``graph`` changes only
    ``.object/ui.json``; a stale revision is 409, an unknown ``graph`` key 422;
 6. renaming an object keeps its backlinks and search finds the new title;
 7. with ``--big``: timings on a generated 5,000-object / 50,000-link space
    (``backend/tests/bigspace.py``) against the Performance bar budgets, times
    ``OBJECT_PERF_SLACK``;
 8. the M1 no-edit pass (cache skipped) changes no file.

Each check prints ``[ok]`` or ``[FAIL]``; exits non-zero on any failure.
"""

from __future__ import annotations

import argparse
import difflib
import os
import re
import shutil
import sys
import tempfile
import threading
import time
import uuid
from collections import Counter
from pathlib import Path, PurePosixPath
from typing import Any

import uvicorn

from m2_acceptance import (
    HOST, Http, Run, changed_paths, check_migration, commit, free_port, git, remove_tree, snapshot,
)
from objectapp.server import create_app
from objectapp.space import Space

CACHE = ".object-cache"
CACHE_OWNED = {"search.sqlite", ".gitignore", "search.sqlite-journal"}
SLACK = float(os.environ.get("OBJECT_PERF_SLACK") or 1)
_LINK = re.compile(r"!?\[\[([^\]\n]+?)\]\]")
_FENCE = re.compile(r"^\s*(```|~~~)")
_INLINE_CODE = re.compile(r"`[^`\n]*`")
_KEY = re.compile(r"^([A-Za-z_][\w-]*)\s*:")
_WORD = re.compile(r"[^\W\d_]{6,}")


# -- server --------------------------------------------------------------------


class Served:
    """One `Space` served on a free port, with the app's lifespan (search index) running."""

    def __init__(self, root: Path) -> None:
        self.space = Space(root)
        port = free_port()
        app = create_app(self.space, None, watch=True)
        self.server = uvicorn.Server(uvicorn.Config(app, host=HOST, port=port, log_level="warning"))
        self.thread = threading.Thread(target=self.server.run, daemon=True)
        self.thread.start()
        self.http = Http(f"http://{HOST}:{port}/api")
        for _ in range(200):
            try:
                if self.http("GET", "/space")[0] == 200:
                    break
            except OSError:
                time.sleep(0.05)

    def wait_indexed(self, timeout: float = 120) -> float:
        """Seconds until ``GET /api/search`` says ``partial: false``."""
        t0 = time.perf_counter()
        while time.perf_counter() - t0 < timeout:
            code, res = self.http("GET", "/search", q="zz")
            if code == 200 and res.get("partial") is False:
                return time.perf_counter() - t0
            time.sleep(0.02)
        raise TimeoutError("search index still partial")

    def stop(self) -> None:
        self.server.config.app.state.hub.close()
        self.server.should_exit = True
        self.thread.join(timeout=10)


def poll(fn, timeout: float = 2.0) -> tuple[bool, float]:
    t0 = time.perf_counter()
    while True:
        if fn():
            return True, time.perf_counter() - t0
        if time.perf_counter() - t0 > timeout:
            return False, time.perf_counter() - t0
        time.sleep(0.05)


def search_paths(http: Http, q: str, **opts: Any) -> list[str]:
    code, res = http("GET", "/search", q=q, **opts)
    return [r["path"] for r in res["results"]] if code == 200 else []


def search_multi(http: Http, q: str, key: str, values: list[str]) -> list[dict]:
    """`/search` with a repeated query key (the `Http` helper sends each key once)."""
    import json
    import urllib.parse
    import urllib.request

    qs = urllib.parse.urlencode([("q", q), *((key, v) for v in values)])
    with urllib.request.urlopen(f"{http.base}/search?{qs}", timeout=30) as r:
        return json.loads(r.read())["results"]


# -- the script's own reading of the files ------------------------------------


def split_file(text: str) -> tuple[list[str], str]:
    """(frontmatter lines, body) of `text` (``\\n``-normalised); no closed block -> no frontmatter."""
    text = text.replace("\r\n", "\n").lstrip("﻿")
    lines = text.split("\n")
    if lines and lines[0] == "---":
        for i in range(1, len(lines)):
            if lines[i] == "---":
                return lines[1:i], "\n".join(lines[i + 1:])
    return [], text


def body_targets(body: str) -> list[str]:
    out, fence = [], None
    for line in body.split("\n"):
        m = _FENCE.match(line)
        if m:
            fence = None if fence == m.group(1) else (fence or m.group(1))
            continue
        if fence:
            continue
        out += _LINK.findall(_INLINE_CODE.sub("", line))
    return out


def frontmatter_targets(fm: list[str], skip_keys: set[str]) -> list[str]:
    out, key = [], None
    for line in fm:
        m = _KEY.match(line)
        if m:
            key = m.group(1)
        if key in skip_keys:
            continue
        out += _LINK.findall(line)
    return out


class Model:
    """Links and backlinks computed from the files and ``GET /api/objects``, not by the app."""

    def __init__(self, run: Run) -> None:
        _, objs = run.http("GET", "/objects")
        self.objs = {o["path"]: o for o in objs}
        skip = {"tags"}
        for t in run.types():
            skip |= {d["key"] for d in t["propertyDefinitions"] if d["type"] == "entity_backlinks"}
        order = sorted(objs, key=lambda o: (o.get("createdAt") is None, o.get("createdAt") or "", o["path"]))
        self.order = [o["path"] for o in order]
        self.links: dict[str, set[str]] = {}
        for p in self.objs:
            fm, body = split_file(run.text(p))
            found = set()
            for raw in body_targets(body) + frontmatter_targets(fm, skip):
                t = self.resolve(raw, p)
                if t and t != p:
                    found.add(t)
            self.links[p] = found

    def resolve(self, raw: str, src: str) -> str | None:
        cands = [raw.strip()]
        for sep in ("|", "#"):
            for c in list(cands):
                if sep in c and c.split(sep, 1)[0].strip() not in cands:
                    cands.append(c.split(sep, 1)[0].strip())
        cands = [c for c in cands if c]
        for c in cands:
            if "/" in c and f"{c}.md" in self.objs:
                return f"{c}.md"
        folder = PurePosixPath(src).parent

        def best(match) -> str | None:
            hits = [p for p in self.order if match(self.objs[p], p)]
            near = [p for p in hits if PurePosixPath(p).parent == folder]
            return (near or hits or [None])[0]

        for c in cands:
            low = c.lower()
            for m in (lambda o, p: o["title"] == c,
                      lambda o, p: low in {a.lower() for a in o.get("aliases") or []},
                      lambda o, p: low in (o["title"].lower(), PurePosixPath(p).stem.lower())):
                hit = best(m)
                if hit:
                    return hit
        return None

    def backlinks(self, path: str) -> set[str]:
        return {s for s, ts in self.links.items() if path in ts}

    def pairs(self) -> set[tuple[str, str]]:
        return {tuple(sorted((s, t))) for s, ts in self.links.items() for t in ts}


# -- checks --------------------------------------------------------------------


def cache_state(root: Path) -> dict[str, tuple[bytes, int]]:
    d = root / CACHE
    return {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in d.iterdir() if p.is_file()} if d.is_dir() else {}


def outside_cache(root: Path) -> dict[str, bytes]:
    return snapshot(root)  # m2's snapshot skips .git and .object-cache


def all_reads(run: Run) -> None:
    for q in ("the", "engine", "note", "ada"):
        run.http("GET", "/search", q=q)
    _, objs = run.http("GET", "/objects")
    for o in objs:
        run.http("GET", "/references", path=o["path"])
        run.http("GET", "/object", path=o["path"])
    run.http("GET", "/graph")
    run.http("POST", "/rows", {})


def check_reads(root: Path, run: Run, served: Served, cache_before: dict) -> Served:
    print("\n1. Reading writes nothing outside the cache")
    before = outside_cache(root)
    took = served.wait_indexed()
    all_reads(run)
    status = git(root, "status", "--porcelain", "-uall").strip()
    diff = changed_paths(before, outside_cache(root))
    run.report(not status and not diff, f"indexed in {took:.2f}s; every M5 read leaves git status empty "
               "and every file outside .object-cache/ byte-identical", *([status] if status else []), *diff)
    after = cache_state(root)
    gained = set(after) - set(cache_before)
    kept = all(after.get(k, (None,))[0] == v[0] for k, v in cache_before.items())
    gi = (root / CACHE / ".gitignore").read_text("utf-8").strip() if (root / CACHE / ".gitignore").is_file() else None
    run.report(gained <= CACHE_OWNED and "search.sqlite" in after and kept and (".gitignore" in gained) == (".gitignore" not in cache_before),
               f"cache gained {sorted(gained)} (.gitignore holds {gi!r}); files already there unchanged "
               f"{sorted(cache_before)}")

    print("   second start")
    served.stop()
    first = cache_state(root)
    served = Served(root)
    run.http = served.http
    took = served.wait_indexed()
    run.http("GET", "/search", q="engine")
    time.sleep(0.5)
    second = cache_state(root)
    changed = sorted(k for k in first.keys() | second.keys() if first.get(k) != second.get(k))
    run.report(not changed, f"second start (sync {took:.2f}s) changes no byte or mtime in the cache",
               *([f"changed: {changed}"] if changed else []))
    return served


def unique_body_word(run: Run, model: Model) -> tuple[str, str] | None:
    """(word, path): a word in one object's body that no other file has as a word prefix."""
    tree = [p for p in root_files(run.root)]
    texts = {p: run.text(p).lower() for p in tree}
    tokens: dict[str, set[str]] = {}
    for p, t in texts.items():
        for w in set(re.findall(r"[^\W_]+", t)):
            tokens.setdefault(w, set()).add(p)
    for p in sorted(model.objs):
        _, body = split_file(run.text(p))
        for w in sorted(set(m.lower() for m in _WORD.findall(body))):
            owners = {q for tok, ps in tokens.items() if tok.startswith(w) for q in ps}
            if owners == {p}:
                return w, p
    return None


def root_files(root: Path) -> list[str]:
    return [p.relative_to(root).as_posix() for p in root.rglob("*.md")
            if p.is_file() and not set(p.relative_to(root).parts) & {".git", CACHE, ".object"}]


def fuzzy_title(model: Model) -> tuple[str, str] | None:
    titles = sorted(((o["title"], p) for p, o in model.objs.items() if len(o["title"]) >= 10 and " " in o["title"]),
                    key=lambda t: (-len(t[0]), t[1]))
    if not titles:
        titles = sorted(((o["title"], p) for p, o in model.objs.items() if len(o["title"]) >= 6), key=lambda t: t[1])
    if not titles:
        return None
    title, path = titles[0]
    if title == "Analytical Engine":
        return "Analytcal Engne", path
    # drop every fourth letter (never a word's first one)
    out, k = [], 0
    for i, ch in enumerate(title):
        if ch.isalpha() and i and title[i - 1] != " ":
            k += 1
            if k % 4 == 0:
                continue
        out.append(ch)
    return "".join(out), path


def check_search(run: Run, model: Model) -> tuple[str, str] | None:
    print("\n2. Search")
    http = run.http
    uw = unique_body_word(run, model)
    if uw:
        word, path = uw
        code, res = http("GET", "/search", q=word)
        hit = next((r for r in res["results"] if r["path"] == path), None) if code == 200 else None
        snip = [s for h in (hit or {}).get("highlights", []) if h["field"] == "blocksContent" for s in h["snippets"]]
        run.report(hit is not None and any("\u0002" in s and "\u0003" in s for s in snip),
                   f"body-only word {word!r} finds {path} with a snippet", *[repr(s) for s in snip[:1]])
    else:
        run.report(False, "no word occurs in exactly one body")
    fz = fuzzy_title(model)
    if fz:
        q, path = fz
        top = search_paths(http, q)[:5]
        run.report(path in top, f"fuzzy title {q!r} finds {path} (top 5: {top})")

    # filters: a common word, then each filter against the unfiltered results
    counts = Counter(w.lower() for p in model.objs for w in set(re.findall(r"[^\W\d_]{4,}", split_file(run.text(p))[1])))
    common = counts.most_common(1)[0][0] if counts else "the"
    code, res = http("GET", "/search", q=common, limit=200)
    base = res["results"]
    types = Counter(r["type"] for r in base)
    problems = []
    if types:
        t = types.most_common(1)[0][0]
        only = search_multi(http, common, "type", [t])
        if not only or any(r["type"] != t for r in only):
            problems.append(f"type={t}: {[r['type'] for r in only]}")
        excl = search_multi(http, common, "excludeType", [t])
        if any(r["type"] == t for r in excl) or len(excl) != min(50, len([r for r in base if r["type"] != t])):
            problems.append(f"excludeType={t}: {len(excl)} results")
    tags = Counter(tag for o in model.objs.values() for tag in o.get("tags") or [])
    tag_note = "no tags in the space"
    if tags:
        tag = tags.most_common(1)[0][0]
        tagged = {p for p, o in model.objs.items() if tag.lower() in {x.lower() for x in o.get("tags") or []}}
        title_of_tagged = model.objs[sorted(tagged)[0]]["title"]
        got = search_paths(http, title_of_tagged, tag=tag)
        if not got or any(p not in tagged for p in got):
            problems.append(f"tag={tag}: {got}")
        tag_note = f"tag={tag!r}"
    run.report(code == 200 and not problems, f"type / excludeType filter {common!r} ({len(base)} results), {tag_note}",
               *problems)

    # write, delete and the watcher
    page = run.type_named("Page") or run.types()[0]
    c, made = http("POST", "/objects", {"typeId": page["id"], "title": "M5 search probe"})
    word = "zqm5" + uuid.uuid4().hex[:6].translate(str.maketrans("0123456789", "ghijklmnop"))
    o = run.obj(made["path"])
    pc, _ = http("PUT", "/object/body", {"path": made["path"], "body": f"\nA probe word {word}.\n", "baseVersion": o["version"]})
    ok, took = poll(lambda: made["path"] in search_paths(http, word))
    run.report(c == 201 and pc == 200 and ok, f"PUT /object/body word found in {took:.2f}s")
    o = run.obj(made["path"])
    dc, _ = http("DELETE", "/object", path=made["path"], baseVersion=o["version"])
    ok, took = poll(lambda: made["path"] not in search_paths(http, word))
    run.report(dc == 200 and ok, f"deleted object gone from search in {took:.2f}s")
    ext = "Pages/M5 external probe.md"
    word2 = word + "ext"
    (run.root / ext).write_bytes(f"---\ntype: 'Page'\ntitle: M5 external probe\n---\n\nWritten outside: {word2}.\n".encode())
    ok, took = poll(lambda: ext in search_paths(http, word2))
    run.report(ok, f"externally written file found by its word in {took:.2f}s")
    return uw


def check_rebuild(run: Run, served: Served, uw: tuple[str, str] | None) -> Served:
    print("\n3. Rebuilding the cache")
    db = run.root / CACHE / "search.sqlite"
    try:
        db.unlink()
        removed = True
    except OSError as exc:
        removed = False
        print(f"         could not delete while running: {exc}")
    code, res = run.http("POST", "/search/reindex", {})
    took = served.wait_indexed()
    found = uw is None or uw[1] in search_paths(run.http, uw[0])
    run.report(removed and code == 202 and res == {"started": True} and db.is_file() and found,
               f"deleted search.sqlite, reindex 202, rebuilt in {took:.2f}s and searchable")
    served.stop()
    db.write_bytes(b"this is not a database\x00" * 64)
    served = Served(run.root)
    run.http = served.http
    took = served.wait_indexed()
    code, _ = run.http("GET", "/search", q=uw[0] if uw else "the")
    found = uw is None or uw[1] in search_paths(run.http, uw[0])
    header = db.read_bytes()[:16]
    run.report(code == 200 and found and header == b"SQLite format 3\x00",
               f"garbage cache + restart: rebuilt in {took:.2f}s, search 200, valid SQLite file")
    return served


def ref_paths(run: Run, path: str) -> tuple[list[str] | None, list[str], dict]:
    code, refs = run.http("GET", "/references", path=path)
    obj = run.obj(path)
    return ([b["path"] for b in refs["backlinks"]] if code == 200 else None,
            [b["path"] for b in obj["backlinks"]], refs)


def check_references(run: Run, model: Model) -> None:
    print("\n4. References")
    mismatches, n_linked = [], 0
    mention = None
    for p in sorted(model.objs):
        refs_bl, obj_bl, refs = ref_paths(run, p)
        want = model.backlinks(p)
        n_linked += bool(want)
        if refs_bl is None or set(refs_bl) != want or set(obj_bl) != want or len(obj_bl) != len(set(obj_bl)):
            mismatches.append(f"{p}: references {refs_bl}, object {obj_bl}, files {sorted(want)}")
        for m in refs.get("mentions", []):
            if mention is None and not model.objs[m["path"]].get("readOnly"):
                mention = (p, m)
    run.report(not mismatches, f"{len(model.objs)} objects ({n_linked} with backlinks): references = object = files",
               *mismatches[:10])
    if mention is None:
        run.report(True, "no unlinked mention in this space; linking skipped")
        return
    target, m = mention
    occ = m["occurrences"][0]
    commit(run.root, "before link")
    raw_before = (run.root / m["path"]).read_bytes()
    code, res = run.http("POST", "/references/link", {"path": m["path"], "target": target, "start": occ["start"],
                                                       "end": occ["end"], "text": occ["text"], "baseVersion": m["version"]})
    raw_after = (run.root / m["path"]).read_bytes()
    problems = link_diff_problems(raw_before, raw_after, occ["text"])
    diff = git(run.root, "diff", "-U0", "--", m["path"]).strip()
    run.report(code == 200 and not problems, f"linked {occ['text']!r} in {m['path']}: the diff is the mention line "
               "plus lastUpdated", *problems, *[f"  {l}" for l in diff.splitlines() if l[:1] in "+-" and l[:3] not in ("+++", "---")])
    stale, sres = run.http("POST", "/references/link", {"path": m["path"], "target": target, "start": occ["start"],
                                                         "end": occ["end"], "text": occ["text"], "baseVersion": m["version"]})
    run.report(stale == 409 and "currentVersion" in (sres or {}), f"stale baseVersion is {stale}")
    model.links[m["path"]].add(target)
    commit(run.root, "linked")


def link_diff_problems(before: bytes, after: bytes, text: str) -> list[str]:
    problems = []
    if before.startswith(b"\xef\xbb\xbf") != after.startswith(b"\xef\xbb\xbf"):
        problems.append("BOM changed")
    if (b"\r\n" in before) != (after.count(b"\n") == after.count(b"\r\n")):
        problems.append("line endings changed")
    a = before.decode("utf-8-sig").splitlines()
    b = after.decode("utf-8-sig").splitlines()
    removed = [l[2:] for l in difflib.ndiff(a, b) if l.startswith("- ")]
    added = [l[2:] for l in difflib.ndiff(a, b) if l.startswith("+ ")]
    body_rm = [l for l in removed if not l.startswith("lastUpdated:")]
    body_add = [l for l in added if not l.startswith("lastUpdated:")]
    if len(body_rm) != 1 or len(body_add) != 1:
        return problems + [f"expected one changed line, got -{body_rm} +{body_add}"]
    new = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", body_add[0])
    if new != body_rm[0] or f"{text}]]" not in body_add[0]:
        problems.append(f"line changed beyond the mention: {body_rm[0]!r} -> {body_add[0]!r}")
    if not any(l.startswith("lastUpdated:") for l in added):
        problems.append("lastUpdated not stamped")
    return problems


def check_graph(run: Run, model: Model) -> None:
    print("\n5. Graph")
    _, objs = run.http("GET", "/objects")
    code, g = run.http("GET", "/graph")
    nodes = [n["path"] for n in g["nodes"]]
    links = g["links"]
    pairs = {tuple(sorted((nodes[links[i]], nodes[links[i + 1]]))) for i in range(0, len(links), 2)}
    ordered = all(links[i] < links[i + 1] for i in range(0, len(links), 2)) and len(pairs) * 2 == len(links)
    want = model.pairs()
    run.report(code == 200 and len(nodes) == len(objs) and pairs == want and ordered,
               f"{len(nodes)} nodes for {len(objs)} objects; {len(pairs)} link pairs equal the files' pairs",
               *([f"only in graph: {sorted(pairs - want)[:5]}", f"only in files: {sorted(want - pairs)[:5]}"]
                 if pairs != want else []))
    _, ui = run.http("GET", "/ui")
    before = snapshot(run.root)
    pc, _ = run.http("PUT", "/ui", {"patch": {"graph": {"showCompletedTasks": True, "hideDates": True}},
                                    "baseRevision": ui["revision"]})
    diff = changed_paths(before, snapshot(run.root))
    stale, _ = run.http("PUT", "/ui", {"patch": {"graph": {}}, "baseRevision": ui["revision"]})
    _, ui2 = run.http("GET", "/ui")
    bad, _ = run.http("PUT", "/ui", {"patch": {"graph": {"bogus": True}}, "baseRevision": ui2["revision"]})
    run.report(pc == 200 and diff == [".object/ui.json"] and stale == 409 and bad == 422,
               f"PUT /ui graph wrote {diff}; stale revision {stale}; unknown graph key {bad}")
    commit(run.root, "graph ui")


def check_rename(run: Run, model: Model) -> None:
    print("\n6. Rename keeps backlinks")
    cands = [p for p in sorted(model.objs) if model.backlinks(p) and not model.objs[p].get("readOnly")
             and not model.objs[p].get("template")]
    if not cands:
        run.report(True, "no object with backlinks; skipped")
        return
    path = cands[0]
    before = sorted(b["path"] for b in run.obj(path)["backlinks"])
    o = run.obj(path)
    new_title = f"{model.objs[path]['title']} Renamed"
    code, res = run.http("POST", "/object/rename", {"path": path, "title": new_title, "baseVersion": o["version"]})
    new_path = res.get("path", path) if code == 200 else path
    after = sorted(b["path"] for b in run.obj(new_path)["backlinks"])
    refs = sorted(b["path"] for b in run.http("GET", "/references", path=new_path)[1]["backlinks"])
    ok, took = poll(lambda: new_path in search_paths(run.http, new_title)[:5])
    run.report(code == 200 and before == after == refs and ok,
               f"{path} -> {new_path}: backlinks {len(after)} kept; search finds {new_title!r} in {took:.2f}s",
               *([f"before {before}", f"after {after}", f"references {refs}"] if not before == after == refs else []))
    commit(run.root, "renamed")


def check_no_edit(run: Run) -> None:
    print("\n8. M1 no-edit pass")
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


def check_big(run: Run) -> None:
    print(f"\n7. Performance at 5,000 objects / 50,000 links (OBJECT_PERF_SLACK={SLACK:g})")
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend" / "tests"))
    from bigspace import SHARED_WORDS, make_big_space, title_of

    tmp = Path(tempfile.mkdtemp(prefix="m5-big-"))
    served = None
    try:
        root = tmp / "big"
        stats = make_big_space(root)
        served = Served(root)
        build = served.wait_indexed(300)
        served.stop()
        served = Served(root)
        second = served.wait_indexed(60)
        http = served.http
        queries = [*SHARED_WORDS, *(title_of(i) for i in range(1, 4001, 400)), "object 0", "draft", "review"][:20]
        times = []
        for q in queries:
            s = time.perf_counter()
            http("GET", "/search", q=q)
            times.append(time.perf_counter() - s)
        p95 = sorted(times)[int(0.95 * (len(times) - 1))]
        _, objs = http("GET", "/objects")
        s = time.perf_counter()
        http("GET", "/references", path=objs[0]["path"])  # the first read builds the link index (own budget: 2 s)
        cold = time.perf_counter() - s
        refs = []
        for o in objs[::250][:20]:
            s = time.perf_counter()
            http("GET", "/references", path=o["path"])
            refs.append(time.perf_counter() - s)
        http("GET", "/graph")  # warm
        s = time.perf_counter()
        _, g = http("GET", "/graph")
        graph = time.perf_counter() - s
        rows = [("full index build", build, 30.0), ("second start sync", second, 2.0),
                ("first GET /api/references (builds the link index)", cold, 2.0),
                ("search p95 (20 queries)", p95, 0.050), ("references max (20 objects)", max(refs), 0.150),
                ("GET /api/graph", graph, 0.300)]
        print(f"   {stats.objects} objects, {stats.links} links written; graph {len(g['nodes'])} nodes, "
              f"{len(g['links']) // 2} pairs")
        for label, took, budget in rows:
            run.report(took <= budget * SLACK, f"{label}: {took * 1000:.0f} ms (budget {budget * SLACK * 1000:.0f} ms)")
    finally:
        if served is not None:
            served.stop()
        remove_tree(tmp)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path)
    ap.add_argument("--keep", action="store_true", help="keep the temporary copy")
    ap.add_argument("--big", action="store_true", help="also time the generated 5,000-object space")
    args = ap.parse_args(argv)
    src = args.space.resolve()
    if not src.is_dir():
        ap.error(f"Not a folder: {src}")
    os.environ.pop("OBJECT_CACHE_DIR", None)  # exercise the default .object-cache/

    tmp = Path(tempfile.mkdtemp(prefix="m5-acceptance-"))
    root = tmp / src.name
    shutil.copytree(src, root, ignore=shutil.ignore_patterns(".git"))
    git(root, "init", "-q")
    commit(root, "base")
    original = snapshot(root)

    served: Served | None = None
    run: Run | None = None
    try:
        _space, mig = check_migration(root, original)
        cache_before = cache_state(root)
        served = Served(root)
        run = Run(root, served.http)
        print(f"Space copy: {root}")
        print(f"\n0. Opening twice: {mig[0]}", *mig[1:], sep="\n   ")
        run.failures += mig[0] != "ok"

        served = check_reads(root, run, served, cache_before)
        model = Model(run)
        uw = check_search(run, model)
        commit(root, "search probes")
        served = check_rebuild(run, served, uw)
        model = Model(run)
        check_references(run, model)
        check_graph(run, Model(run))
        check_rename(run, Model(run))
        if args.big:
            check_big(run)
        check_no_edit(run)
        status = git(root, "status", "--porcelain", "-uall").strip()
        run.report(not status, "git status never shows the cache", *([status] if status else []))
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
    raise SystemExit(main())
