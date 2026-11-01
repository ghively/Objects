"""The file watcher: cost of one external edit, and of touching 1,000 files at once.

Usage (from ``backend/``): ``uv run python ../scripts/audit-2026-11-01/perf-backend/bench_watcher.py <space-copy>``
Writes to the space (external edits), so run it on a copy.
"""

from __future__ import annotations

import asyncio
import os
import resource
import sys
import threading
import time
from pathlib import Path


def main():
    from objectapp.space import Space
    from objectapp.watcher import SpaceWatcher

    root = Path(sys.argv[1]).resolve()
    space = Space(root)
    list(space.links.edges())
    loop = asyncio.new_event_loop()
    th = threading.Thread(target=loop.run_forever, daemon=True)
    th.start()
    watcher = SpaceWatcher(space, loop)
    watcher.start()
    rescans = [0]
    orig = space.rescan_file
    def counting(path):
        rescans[0] += 1
        return orig(path)
    space.rescan_file = counting
    time.sleep(1.0)
    cpu0 = time.process_time()

    async def drain(n, timeout):
        got = []
        deadline = time.monotonic() + timeout
        while len(got) < n and time.monotonic() < deadline:
            try:
                got.append(await asyncio.wait_for(watcher.events.get(), timeout=max(0.01, deadline - time.monotonic())))
            except asyncio.TimeoutError:
                break
        return got

    # 1. one external edit of a 50 KB file
    hub = root / "Pages" / "Hub Object.md"
    data = hub.read_bytes()
    t0 = time.perf_counter()
    hub.write_bytes(data + b"\nexternal edit\n")
    fut = asyncio.run_coroutine_threadsafe(drain(1, 5), loop)
    got = fut.result()
    el = time.perf_counter() - t0
    print(f"external edit of one 50 KB file: event after {el*1000:.0f} ms (debounce 150 ms), events={len(got)} kinds={[e.kind for e in got]} rescans={rescans[0]}", flush=True)

    # 2. touch 1,000 files at once (git checkout-like: rewrite bytes with a change)
    paths = sorted(p for p in space._raw if p.startswith("Pages/"))[:1000]
    rescans[0] = 0
    peak_threads = [threading.active_count()]
    stop = threading.Event()
    def watch_threads():
        while not stop.is_set():
            peak_threads[0] = max(peak_threads[0], threading.active_count())
            time.sleep(0.005)
    tw = threading.Thread(target=watch_threads, daemon=True); tw.start()
    lock_wait = [0.0]
    def probe():
        while not stop.is_set():
            t1 = time.perf_counter()
            with space._lock:
                pass
            lock_wait[0] = max(lock_wait[0], time.perf_counter() - t1)
            time.sleep(0.001)
    tp = threading.Thread(target=probe, daemon=True); tp.start()
    cpu1 = time.process_time()
    t0 = time.perf_counter()
    for p in paths:
        f = root / p
        f.write_bytes(f.read_bytes() + b"\nbulk edit\n")
    t_write = time.perf_counter() - t0
    fut = asyncio.run_coroutine_threadsafe(drain(1000, 120), loop)
    got = fut.result()
    el = time.perf_counter() - t0
    time.sleep(1.0)
    stop.set()
    cpu2 = time.process_time()
    kinds = {}
    for e in got:
        kinds[e.kind] = kinds.get(e.kind, 0) + 1
    print(f"touch 1000 files: writing took {t_write*1000:.0f} ms; {len(got)} events delivered after {el:.2f} s; kinds={kinds}; rescans={rescans[0]}; "
          f"peak threads={peak_threads[0]} (baseline {threading.active_count()}); max space-lock wait {lock_wait[0]*1000:.0f} ms; process CPU {cpu2-cpu1:.2f} s; rss {resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024:.0f} MB", flush=True)
    # 3. what the link index pays on the next read after 1000 rescans
    t0 = time.perf_counter(); list(space.links.edges()); print(f"next link-index read after the bulk change: {time.perf_counter()-t0:.2f} s", flush=True)
    # 4. 1000 touches that do NOT change bytes (e.g. git checkout of same content / mtime bump)
    rescans[0] = 0
    t0 = time.perf_counter()
    for p in paths:
        os.utime(root / p)
    fut = asyncio.run_coroutine_threadsafe(drain(1000, 15), loop)
    got = fut.result()
    print(f"utime-only touch of 1000 files: events={len(got)} rescans={rescans[0]} after {time.perf_counter()-t0:.2f} s (each still read + hashed)", flush=True)
    watcher.stop()
    loop.call_soon_threadsafe(loop.stop)


if __name__ == "__main__":
    main()
