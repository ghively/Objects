"""Cold start in phases, cold/warm search sync, and TestClient vs uvicorn on the same app.

Usage (from ``backend/``): ``OBJECT_STATE_DIR=... OBJECT_CACHE_DIR=<fresh dir> uv run python
../scripts/audit-2026-11-01/perf-backend/cold_start.py <space>``
"""
from __future__ import annotations
import json, os, resource, socket, statistics, sys, threading, time, tracemalloc, urllib.request
from pathlib import Path


def rss():
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024


def main():
    root = Path(sys.argv[1]).resolve()
    pass  # tracemalloc disabled: it inflates allocation-heavy code 5-10x
    from objectapp.typedefs import iter_object_paths, read_raw, infer_types_from
    from objectapp.typemodel import load_types
    t0 = time.perf_counter(); paths = list(iter_object_paths(root)); t_walk = time.perf_counter() - t0
    t0 = time.perf_counter(); raws = {p: read_raw(root, p) for p in paths}; t_read = time.perf_counter() - t0
    t0 = time.perf_counter(); inferred = infer_types_from(raws.values()); t_infer = time.perf_counter() - t0
    t0 = time.perf_counter(); load_types(root, inferred=inferred); t_types = time.perf_counter() - t0
    cur, _ = (0, 0)
    print(f"phases: walk {t_walk*1000:.0f} ms | read_raw x{len(paths)} {t_read:.2f} s ({t_read/len(paths)*1000:.2f} ms each) | infer_types {t_infer*1000:.0f} ms | load_types {t_types*1000:.0f} ms | raws traced {cur/1e6:.0f} MB", flush=True)
    del raws
    from objectapp import server as _server
    _server.allowed_hosts = _server.LOOPBACK_HOSTS | {"testserver"}
    from objectapp.server import create_app
    from objectapp.space import Space
    t0 = time.perf_counter(); space = Space(root); t_space = time.perf_counter() - t0
    cur, _ = (0, 0)
    print(f"Space(root): {t_space:.2f} s | traced {cur/1e6:.0f} MB rss {rss():.0f} MB", flush=True)
    app = create_app(space, None, watch=False)
    import uvicorn
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    base = f"http://127.0.0.1:{port}"
    def get(url, method="GET", body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"} if data else {})
        with urllib.request.urlopen(req, timeout=600) as r:
            return r.read()
    while True:
        try: get(base + "/api/ui"); break
        except Exception: time.sleep(0.05)
    t0 = time.perf_counter(); app.state.search.ready.wait(900); t_cold = time.perf_counter() - t0
    print(f"search index cold sync (fresh cache dir): {t_cold:.2f} s | rss {rss():.0f} MB", flush=True)
    t0 = time.perf_counter(); get(base + "/api/graph"); t_links = time.perf_counter() - t0
    cur, peak = (0, 0)
    print(f"first /api/graph (link index build + resolve): {t_links:.2f} s | traced {cur/1e6:.0f} MB peak {peak/1e6:.0f} MB rss {rss():.0f} MB", flush=True)
    print(f"TOTAL to first useful screen (scan + search sync + link index): {t_space + t_cold + t_links:.1f} s", flush=True)
    # warm search sync: a second SearchIndex over the same cache
    from objectapp.searchindex import SearchIndex
    si2 = SearchIndex(space); t0 = time.perf_counter(); si2.start(); si2.ready.wait(900); print(f"search index warm sync (cache present): {time.perf_counter()-t0:.2f} s", flush=True); si2.stop()
    # paired TestClient vs uvicorn (same process, same moment)
    from fastapi.testclient import TestClient
    tc = TestClient(app)
    def pair(name, tc_fn, uv_fn, n=3):
        a = [];
        b = []
        for _ in range(n):
            t0 = time.perf_counter(); r = tc_fn(); a.append(time.perf_counter() - t0); size = len(r.content)
            t0 = time.perf_counter(); uv_fn(); b.append(time.perf_counter() - t0)
        print(f"{name:40s} TestClient median {statistics.median(a)*1000:8.0f} ms | uvicorn median {statistics.median(b)*1000:8.0f} ms | resp {size/1024:.0f} KB | ratio {statistics.median(a)/statistics.median(b):.1f}x", flush=True)
    pair("GET /api/objects", lambda: tc.get("/api/objects"), lambda: get(base + "/api/objects"))
    pair("POST /api/rows typeIds=[task]", lambda: tc.post("/api/rows", json={"typeIds": ["task"]}), lambda: get(base + "/api/rows", "POST", {"typeIds": ["task"]}))
    pair("POST /api/rows typeIds=[page]", lambda: tc.post("/api/rows", json={"typeIds": ["page"]}), lambda: get(base + "/api/rows", "POST", {"typeIds": ["page"]}), n=2)
    pair("GET /api/calendar 7 days", lambda: tc.get("/api/calendar?from=2026-10-25&to=2026-10-31"), lambda: get(base + "/api/calendar?from=2026-10-25&to=2026-10-31"))
    pair("GET /api/graph", lambda: tc.get("/api/graph"), lambda: get(base + "/api/graph"))
    pair("GET /api/search q=harbor", lambda: tc.get("/api/search?q=harbor"), lambda: get(base + "/api/search?q=harbor"), n=5)
    server.should_exit = True


if __name__ == "__main__":
    main()
