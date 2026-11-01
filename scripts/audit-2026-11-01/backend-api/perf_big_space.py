"""Timings on the generated 5,000-object space (made by tests/bigspace.make_big_space).

Run: ``uv run python scripts/audit-2026-11-01/backend-api/perf_big_space.py``
"""

from __future__ import annotations

import shutil
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness import SCRATCH, fresh_dir, make_client  # noqa: E402

BIG = SCRATCH / "space-big"


def timed(label: str, fn, n: int = 1):
    times = []
    out = None
    for _ in range(n):
        t = time.perf_counter()
        out = fn()
        times.append(time.perf_counter() - t)
    times.sort()
    p95 = times[min(len(times) - 1, int(len(times) * 0.95))]
    size = len(out.content) if hasattr(out, "content") else ""
    print(f"  {label:48} median {statistics.median(times)*1000:8.1f} ms  p95 {p95*1000:8.1f} ms  max {times[-1]*1000:8.1f} ms  {size}")
    return out


def main() -> None:
    root = fresh_dir("bigcopy") / "space-big"
    shutil.copytree(BIG, root)
    # a dot-folder with many files, as a real space might have (.git, .obsidian, .trash)
    junk = root / ".git" / "objects"
    junk.mkdir(parents=True)
    for i in range(3000):
        (junk / f"{i:05d}.bin").write_bytes(b"x")
    t = time.perf_counter()
    client, _ = make_client(root)
    print(f"startup (scan + app + lifespan): {time.perf_counter()-t:.2f}s")
    search = client.app.state.search
    t = time.perf_counter()
    search.ready.wait(300)
    print(f"search index initial sync: {time.perf_counter()-t:.2f}s (in_memory={search.in_memory})")

    if "--writes-only" not in sys.argv:
      print("\n== reads ==")
    timed("GET /api/objects", lambda: client.get("/api/objects"), 3)
    timed("GET /api/graph", lambda: client.get("/api/graph"), 3)
    timed("POST /api/rows (all)", lambda: client.post("/api/rows", json={}), 3)
    timed("POST /api/rows (type=page)", lambda: client.post("/api/rows", json={"typeIds": ["page"]}), 3)
    timed("POST /api/rows search aurora", lambda: client.post("/api/rows", json={"search": {"terms": ["aurora"], "mode": "auto"}}), 3)
    timed("GET /api/calendar 31 days", lambda: client.get("/api/calendar", params={"from": "2026-10-01", "to": "2026-10-31"}), 3)
    timed("GET /api/calendar 100 days", lambda: client.get("/api/calendar", params={"from": "2026-09-01", "to": "2026-12-09"}), 3)
    timed("GET /api/attachments", lambda: client.get("/api/attachments"), 3)
    timed("GET /api/images", lambda: client.get("/api/images"), 3)
    timed("GET /api/collections", lambda: client.get("/api/collections"), 3)
    timed("GET /api/trash", lambda: client.get("/api/trash"), 3)
    timed("GET /api/spaces", lambda: client.get("/api/spaces"), 3)
    timed("GET /api/space", lambda: client.get("/api/space"), 3)
    obj = client.get("/api/objects").json()[100]["path"]
    timed("GET /api/object", lambda: client.get("/api/object", params={"path": obj}), 5)
    timed("GET /api/references", lambda: client.get("/api/references", params={"path": obj}), 5)
    timed("GET /api/block/references", lambda: client.get("/api/block/references", params={"path": obj, "id": "abcdef"}), 3)
    timed("GET /api/history", lambda: client.get("/api/history", params={"path": obj}), 3)
    timed("GET /api/resolve", lambda: client.get("/api/resolve", params={"link": "Object 00042"}), 5)
    timed("GET /api/object/export media=1", lambda: client.get("/api/object/export", params={"path": obj, "media": "1"}), 3)

    print("\n== search ==")
    for q in ["aurora", "obj", "Object 004", "the", "zzzz", "a", "ob", "meeting summary", "x" * 200]:
        timed(f"GET /api/search q={q[:20]!r}", lambda q=q: client.get("/api/search", params={"q": q}), 10)
    timed("GET /api/search mode=title", lambda: client.get("/api/search", params={"q": "object", "mode": "title"}), 10)
    timed("GET /api/search mode=fullText", lambda: client.get("/api/search", params={"q": "aurora", "mode": "fullText"}), 10)

    print("\n== writes ==")
    v = client.get("/api/object", params={"path": obj}).json()["version"]
    r = timed("PUT /api/object/body", lambda: client.put("/api/object/body", json={"path": obj, "body": "edited body [[Object 00001]]", "baseVersion": v}))
    print("   ->", r.status_code, r.text[:120]); v = r.json().get("version", v)
    r = timed("PUT /api/object/properties", lambda: client.put("/api/object/properties", json={"path": obj, "updates": {"title": "Renamed title X"}, "baseVersion": v}))
    print("   ->", r.status_code, r.text[:120]); v = r.json().get("version", v)
    r = timed("POST /api/object/rename (relinks ~10)", lambda: client.post("/api/object/rename", json={"path": obj, "title": "Object 00101 renamed", "baseVersion": v}))
    print("   relinked:", len(r.json().get("relinked", [])), "skipped:", len(r.json().get("skipped", [])))
    timed("POST /api/objects", lambda: client.post("/api/objects", json={"typeId": "page", "title": "New page"}))
    timed("POST /api/tags/ensure", lambda: client.post("/api/tags/ensure", json={"name": "brand new tag"}))
    types = client.get("/api/space").json()["types"]
    page = next(t for t in types if t["id"] == "page")
    timed("PUT /api/types/page (no-op rename)", lambda: client.put("/api/types/page", json={"type": {**page, "description": "x"}, "baseRevision": page["revision"]}))

    print("\n== reindex ==")
    t = time.perf_counter()
    client.post("/api/search/reindex")
    time.sleep(0.5)
    search.ready.wait(300)
    print(f"  full reindex: {time.perf_counter()-t:.2f}s")
    client.__exit__(None, None, None)


if __name__ == "__main__":
    main()
