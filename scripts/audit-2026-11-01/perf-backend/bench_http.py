"""Read-route latencies over a real uvicorn server (the production path), 127.0.0.1 only.

Usage (from ``backend/``): ``OBJECT_STATE_DIR=... OBJECT_CACHE_DIR=... uv run python
../scripts/audit-2026-11-01/perf-backend/bench_http.py <space> [--concurrent]``

``--concurrent`` also measures reads while a long write (rename of the hub, 214 referrers) runs,
and reads while a parallel heavy read (/api/rows all) runs, to show lock/GIL contention.
"""

from __future__ import annotations

import json
import socket
import statistics
import sys
import threading
import time
import urllib.request
from pathlib import Path

import uvicorn


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def get(url: str, method: str = "GET", body: dict | None = None) -> tuple[int, bytes]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def bench(name: str, fn, n: int = 5) -> float:
    times = []
    size = 0
    for _ in range(n):
        t0 = time.perf_counter()
        status, content = fn()
        times.append(time.perf_counter() - t0)
        size = len(content)
        assert status < 400, (name, status, content[:200])
    med = statistics.median(times)
    print(f"{name:55s} n={n} median {med*1000:9.1f} ms  min {min(times)*1000:9.1f} ms  max {max(times)*1000:9.1f} ms  resp {size/1024:7.0f} KB", flush=True)
    return med


def main() -> None:
    root = Path(sys.argv[1]).resolve()
    concurrent = "--concurrent" in sys.argv
    from objectapp.server import create_app
    from objectapp.space import Space

    t0 = time.perf_counter()
    space = Space(root)
    print(f"Space(root): {time.perf_counter()-t0:.2f}s", flush=True)
    app = create_app(space, None, watch=False)
    port = free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    th = threading.Thread(target=server.run, daemon=True)
    th.start()
    base = f"http://127.0.0.1:{port}"
    while True:
        try:
            get(base + "/api/ui")
            break
        except Exception:
            time.sleep(0.05)
    t0 = time.perf_counter()
    app.state.search.ready.wait(900)
    print(f"search index start-up sync (cache {'present' if any((Path(__import__('os').environ['OBJECT_CACHE_DIR'])).glob('**/*')) else 'cold'}): {time.perf_counter()-t0:.2f}s", flush=True)
    t0 = time.perf_counter(); get(base + "/api/graph"); print(f"first /api/graph (builds link index): {time.perf_counter()-t0:.2f}s", flush=True)
    hub = "Pages/Hub Object.md"
    page = next(p for p in sorted(space._raw) if p.startswith("Pages/Page 0"))
    q = urllib.parse.quote
    if not concurrent:
        bench("GET /api/objects (5000)", lambda: get(base + "/api/objects"))
        bench("GET /api/objects?type=page (1753)", lambda: get(base + "/api/objects?type=page"))
        bench("POST /api/rows typeIds=[page] (1753 rows)", lambda: get(base + "/api/rows", "POST", {"typeIds": ["page"]}), n=3)
        bench("POST /api/rows typeIds=[task] (200 rows)", lambda: get(base + "/api/rows", "POST", {"typeIds": ["task"]}))
        bench("POST /api/rows all (5000 rows)", lambda: get(base + "/api/rows", "POST", {}), n=3)
        bench("GET /api/object hub", lambda: get(base + f"/api/object?path={q(hub)}"))
        bench("GET /api/object page", lambda: get(base + f"/api/object?path={q(page)}"))
        bench("GET /api/search q=harbor meeting", lambda: get(base + "/api/search?q=harbor%20meeting"), n=10)
        bench("GET /api/search q=Page 0001 mode=title", lambda: get(base + "/api/search?q=Page%200001&mode=title"), n=10)
        bench("GET /api/calendar 7 days", lambda: get(base + "/api/calendar?from=2026-10-25&to=2026-10-31"))
        bench("GET /api/calendar 31 days", lambda: get(base + "/api/calendar?from=2026-10-01&to=2026-10-31"))
        bench("GET /api/graph", lambda: get(base + "/api/graph"), n=3)
        bench("GET /api/references hub", lambda: get(base + f"/api/references?path={q(hub)}"))
        bench("GET /api/references page", lambda: get(base + f"/api/references?path={q(page)}"))
        bench("GET /api/space", lambda: get(base + "/api/space"))
    else:
        # Reads while a heavy read runs on another connection.
        stop = threading.Event()
        def hammer_rows():
            while not stop.is_set():
                get(base + "/api/rows", "POST", {})
        th2 = threading.Thread(target=hammer_rows, daemon=True); th2.start()
        time.sleep(0.5)
        bench("GET /api/object page WHILE /api/rows all runs", lambda: get(base + f"/api/object?path={q(page)}"), n=10)
        bench("GET /api/search WHILE /api/rows all runs", lambda: get(base + "/api/search?q=harbor"), n=10)
        bench("GET /api/ui WHILE /api/rows all runs", lambda: get(base + "/api/ui"), n=10)
        stop.set(); th2.join()
        # Reads while a long write (rename hub, 214 referrers) runs.
        results = {}
        def rename(title):
            s, c = get(base + f"/api/object?path={q(results.get('path', hub))}")
            v = json.loads(c)["version"]
            t0 = time.perf_counter()
            s, c = get(base + "/api/object/rename", "POST", {"path": results.get("path", hub), "title": title, "baseVersion": v})
            results["path"] = json.loads(c)["path"]; results["t"] = time.perf_counter() - t0
        for title in ("Hub Renamed", "Hub Object"):
            wait = []
            th3 = threading.Thread(target=rename, args=(title,)); th3.start()
            time.sleep(0.05)
            while th3.is_alive():
                t0 = time.perf_counter(); get(base + f"/api/object?path={q(page)}"); wait.append(time.perf_counter() - t0)
            th3.join()
            print(f"rename hub ({title!r}) took {results['t']*1000:.0f} ms; concurrent GET /api/object: n={len(wait)} median {statistics.median(wait)*1000:.0f} ms max {max(wait)*1000:.0f} ms", flush=True)
    server.should_exit = True
    th.join(timeout=10)


if __name__ == "__main__":
    import urllib.parse
    main()
