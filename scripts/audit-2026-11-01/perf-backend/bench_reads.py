"""Read-route latencies and start-up cost of the Object back end at 5,000 objects.

Usage (from ``backend/``)::

    OBJECT_STATE_DIR=... OBJECT_CACHE_DIR=... uv run python \
        ../scripts/audit-2026-11-01/perf-backend/bench_reads.py <space> [--section basic|rows|search|calendar|rest|all] [--profile ROUTE]

Measures through ``TestClient(create_app(Space(root), watch=False))``. ``--profile`` runs
one route under cProfile without the app lifespan (no search thread competing for the GIL).
"""

from __future__ import annotations

import contextlib
import cProfile
import io
import pstats
import resource
import statistics
import sys
import time
import tracemalloc
from pathlib import Path

from fastapi.testclient import TestClient


def rss_mb() -> float:
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024


def bench(name: str, fn, n: int = 5, note: str = "") -> float:
    times = []
    size = 0
    for _ in range(n):
        t0 = time.perf_counter()
        r = fn()
        times.append(time.perf_counter() - t0)
        if hasattr(r, "content"):
            size = len(r.content)
            assert r.status_code < 400, (name, r.status_code, r.text[:200])
    med = statistics.median(times)
    print(f"{name:52s} n={n} median {med*1000:9.1f} ms  min {min(times)*1000:9.1f} ms  max {max(times)*1000:9.1f} ms  resp {size/1024:8.0f} KB {note}", flush=True)
    return med


def main() -> None:
    root = Path(sys.argv[1]).resolve()
    profile = sys.argv[sys.argv.index("--profile") + 1] if "--profile" in sys.argv else None
    section = sys.argv[sys.argv.index("--section") + 1] if "--section" in sys.argv else "all"
    pass  # tracemalloc disabled: it inflates allocation-heavy code 5-10x
    from objectapp import server as _server
    _server.allowed_hosts = _server.LOOPBACK_HOSTS | {"testserver"}
    from objectapp.server import create_app
    from objectapp.space import Space

    t0 = time.perf_counter()
    space = Space(root)
    t_scan = time.perf_counter() - t0
    cur, peak = (0, 0)
    print(f"Space(root) scan: {t_scan:.2f}s  objects={len(space._raw)}  traced={cur/1e6:.0f}MB rss={rss_mb():.0f}MB", flush=True)
    app = create_app(space, None, watch=False)
    ctx = contextlib.nullcontext(TestClient(app)) if profile else TestClient(app)
    t0 = time.perf_counter()
    with ctx as c:
        if not profile:
            app.state.search.ready.wait(900)
            print(f"search index start-up sync: {time.perf_counter()-t0:.2f}s in_memory={app.state.search.in_memory} rss={rss_mb():.0f}MB", flush=True)
        t0 = time.perf_counter()
        n_edges = sum(1 for _ in space.links.edges())
        print(f"link index first build: {time.perf_counter()-t0:.2f}s edges={n_edges} rss={rss_mb():.0f}MB", flush=True)
        cur, peak = (0, 0)
        print(f"after warm-up: traced={cur/1e6:.0f}MB peak={peak/1e6:.0f}MB rss={rss_mb():.0f}MB", flush=True)
        hub = "Pages/Hub Object.md"
        page = next(p for p in sorted(space._raw) if p.startswith("Pages/Page 0"))
        task = next(p for p in sorted(space._raw) if p.startswith("Tasks/") and "repeat" in space._raw[p].fm)
        board = next(p for p in sorted(space._raw) if p.startswith("Whiteboards/"))
        collection = next(iter(space.collections))

        if profile:
            pr = cProfile.Profile()
            calls = {
                "rows": lambda: c.post("/api/rows", json={"typeIds": ["page"]}),
                "rows_task": lambda: c.post("/api/rows", json={"typeIds": ["task"]}),
                "objects": lambda: c.get("/api/objects"),
                "search": lambda: c.get("/api/search", params={"q": "harbor meeting"}),
                "search_title": lambda: c.get("/api/search", params={"q": "Page 0001", "mode": "title"}),
                "calendar": lambda: c.get("/api/calendar", params={"from": "2026-10-25", "to": "2026-10-31"}),
                "graph": lambda: c.get("/api/graph"),
                "references": lambda: c.get("/api/references", params={"path": hub}),
                "object": lambda: c.get("/api/object", params={"path": hub}),
                "stats": lambda: c.get("/api/tasks/stats", params={"path": task}),
                "tick": lambda: app.state.reminders.tick(),
            }
            calls[profile]()
            pr.enable()
            calls[profile]()
            pr.disable()
            s = io.StringIO()
            pstats.Stats(pr, stream=s).sort_stats("cumulative").print_stats(45)
            print(s.getvalue()[:10000])
            return

        if section in ("all", "basic"):
            bench("GET /api/space", lambda: c.get("/api/space"))
            bench("GET /api/ui", lambda: c.get("/api/ui"))
            bench("GET /api/collections", lambda: c.get("/api/collections"))
            bench("GET /api/queries", lambda: c.get("/api/queries"))
            bench("GET /api/trash", lambda: c.get("/api/trash"))
            bench("GET /api/objects (all 5000)", lambda: c.get("/api/objects"))
            bench("GET /api/objects?type=page (1753)", lambda: c.get("/api/objects", params={"type": "page"}))
        if section in ("all", "rows"):
            bench("POST /api/rows typeIds=[page] (1753 rows)", lambda: c.post("/api/rows", json={"typeIds": ["page"]}), n=3)
            bench("POST /api/rows typeIds=[task] (200 rows)", lambda: c.post("/api/rows", json={"typeIds": ["task"]}))
            bench("POST /api/rows all types (5000 rows)", lambda: c.post("/api/rows", json={}), n=3)
            bench("POST /api/rows collection", lambda: c.post("/api/rows", json={"collectionIds": [collection]}))
            bench("POST /api/rows page + search 'harbor'", lambda: c.post("/api/rows", json={"typeIds": ["page"], "search": {"terms": ["harbor"], "mode": "auto"}}), n=3)
        if section in ("all", "basic"):
            bench("GET /api/object hub (50KB, 214 backlinks)", lambda: c.get("/api/object", params={"path": hub}))
            bench("GET /api/object ordinary page", lambda: c.get("/api/object", params={"path": page}))
            bench("GET /api/object task", lambda: c.get("/api/object", params={"path": task}))
        if section in ("all", "search"):
            for q, mode in (("aurora", "auto"), ("harbor meeting", "auto"), ("Page 0001", "auto"), ("Page 0001", "title"), ("glacier", "fullText"), ("zen", "auto"), ("pro", "auto")):
                times = []
                for _ in range(20):
                    t0 = time.perf_counter()
                    r = c.get("/api/search", params={"q": q, "mode": mode})
                    times.append(time.perf_counter() - t0)
                    assert r.status_code == 200, r.text
                times.sort()
                print(f"GET /api/search q={q!r:18} mode={mode:8}  p50 {times[9]*1000:7.1f} ms  p95 {times[18]*1000:7.1f} ms  results={len(r.json()['results'])}", flush=True)
            bench("GET /api/search type filter tag=…", lambda: c.get("/api/search", params={"q": "harbor", "type": "page", "tag": "Tag 0001 Aurora"}), n=10)
        if section in ("all", "calendar"):
            bench("GET /api/calendar 1 month", lambda: c.get("/api/calendar", params={"from": "2026-10-01", "to": "2026-10-31"}))
            bench("GET /api/calendar 100 days", lambda: c.get("/api/calendar", params={"from": "2026-07-24", "to": "2026-10-31"}))
            bench("GET /api/calendar 7 days", lambda: c.get("/api/calendar", params={"from": "2026-10-25", "to": "2026-10-31"}))
        if section in ("all", "rest"):
            bench("GET /api/tasks/overdue (recurring task)", lambda: c.get("/api/tasks/overdue", params={"path": task}))
            bench("GET /api/tasks/stats", lambda: c.get("/api/tasks/stats", params={"path": task}))
            bench("GET /api/graph (global)", lambda: c.get("/api/graph"), n=3)
            bench("GET /api/references hub (214 backlinks)", lambda: c.get("/api/references", params={"path": hub}))
            bench("GET /api/references ordinary page", lambda: c.get("/api/references", params={"path": page}))
            bench("GET /api/history (no versions)", lambda: c.get("/api/history", params={"path": page}))
            bench("GET /api/whiteboard", lambda: c.get("/api/whiteboard", params={"path": board}))
            bench("GET /api/views/page", lambda: c.get("/api/views/page"))
            bench("GET /api/types/page/templates", lambda: c.get("/api/types/page/templates"))
            bench("GET /api/object/change-type suggest", lambda: c.get("/api/object/change-type", params={"path": page, "typeId": "idea"}))
            bench("GET /api/object/export media=1 (50 attachments)", lambda: c.get("/api/object/export", params={"path": "Pages/Media heavy page.md", "media": "1"}))
            bench("GET /api/attachments", lambda: c.get("/api/attachments"))
            bench("GET /api/images", lambda: c.get("/api/images"))
            sched = app.state.reminders
            bench("ReminderScheduler.tick() (runs every 30 s)", lambda: sched.tick(), n=5)
            from objectapp.reminders import task_infos
            bench("reminders.task_infos(space)", lambda: task_infos(space), n=5)
        cur, peak = (0, 0)
        print(f"end: traced={cur/1e6:.0f}MB peak={peak/1e6:.0f}MB rss={rss_mb():.0f}MB")
        raw_bytes = sum(len(r.data) for r in space._raw.values())
        print(f"_raw bytes total={raw_bytes/1e6:.1f}MB (each object keeps data bytes + decoded text + body + fm)")


if __name__ == "__main__":
    main()
