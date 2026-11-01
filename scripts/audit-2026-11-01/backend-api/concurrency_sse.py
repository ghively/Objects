"""Concurrency and event checks: parallel saves on one baseVersion, parallel creates with one
title, parallel uploads with one name, SSE subscriber cleanup, watcher echo of own writes.

Run: ``uv run python scripts/audit-2026-11-01/backend-api/concurrency_sse.py``
"""

from __future__ import annotations

import asyncio
import json
import sys
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness import make_client  # noqa: E402

OCTET = {"content-type": "application/octet-stream"}


def main() -> None:
    client, root = make_client("space-sample", watch=True)
    space = client.app.state.space
    hub = client.app.state.hub

    # -- SSE listener in a thread -------------------------------------------------------
    events: list[dict] = []
    stop = threading.Event()

    def listen():
        with client.stream("GET", "/api/events") as r:
            for line in r.iter_lines():
                if line.startswith("data:"):
                    events.append(json.loads(line[5:]))
                if stop.is_set():
                    break

    t = threading.Thread(target=listen, daemon=True)
    t.start()
    time.sleep(0.5)
    print("subscribers after one SSE client:", len(hub._subscribers))

    print("\n== parallel body saves with one baseVersion ==")
    v = client.get("/api/object", params={"path": "Pages/Alpha.md"}).json()["version"]
    with ThreadPoolExecutor(8) as ex:
        codes = list(ex.map(lambda i: client.put("/api/object/body", json={"path": "Pages/Alpha.md", "body": f"body {i}", "baseVersion": v, "clientId": f"c{i}"}).status_code, range(8)))
    print("  status codes:", Counter(codes))
    time.sleep(1.0)
    print("  SSE events so far:", Counter((e["kind"], e["path"]) for e in events))

    print("\n== parallel creates with one title ==")
    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(lambda i: client.post("/api/objects", json={"typeId": "page", "title": "Same title"}).json(), range(8)))
    paths = [r.get("path") for r in res]
    print("  distinct paths:", len(set(paths)), "of", len(paths), sorted(paths)[:3])
    on_disk = sorted(p.name for p in (root / "Pages").glob("Same title*"))
    print("  files on disk:", len(on_disk))

    print("\n== parallel uploads with one name ==")
    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(lambda i: client.post("/api/attachments", params={"name": "same.bin"}, content=f"data {i}".encode(), headers=OCTET).json(), range(8)))
    paths = [r.get("path") for r in res]
    print("  distinct paths:", len(set(paths)), "of", len(paths))
    contents = {p.name: p.read_bytes() for p in (root / "Attachments").glob("same*")}
    print("  files on disk:", len(contents), "distinct contents:", len(set(contents.values())))

    print("\n== parallel property edits on different objects (lock contention) ==")
    objs = [o["path"] for o in client.get("/api/objects").json()[:6]]
    vers = {p: client.get("/api/object", params={"path": p}).json()["version"] for p in objs}
    t0 = time.perf_counter()
    with ThreadPoolExecutor(6) as ex:
        codes = list(ex.map(lambda p: client.put("/api/object/properties", json={"path": p, "updates": {"description": "x"}, "baseVersion": vers[p]}).status_code, objs))
    print("  codes:", Counter(codes), f"{(time.perf_counter()-t0)*1000:.0f} ms")

    print("\n== watcher: external edit, and an external edit back to the app's bytes ==")
    time.sleep(1.0)
    before = len(events)
    v = client.get("/api/object", params={"path": "Pages/Notes.md"}).json()["version"]
    app_bytes_before = (root / "Pages" / "Notes.md").read_bytes()
    r = client.put("/api/object/body", json={"path": "Pages/Notes.md", "body": "app wrote this", "baseVersion": v, "clientId": "me"})
    app_bytes = (root / "Pages" / "Notes.md").read_bytes()
    time.sleep(1.0)
    print("  events after app write:", [(e["kind"], e["path"], e["origin"]) for e in events[before:]])
    before = len(events)
    (root / "Pages" / "Notes.md").write_bytes(app_bytes_before)  # external edit: revert
    time.sleep(1.0)
    print("  events after external revert:", [(e["kind"], e["path"], e["origin"]) for e in events[before:]])
    before = len(events)
    (root / "Pages" / "Notes.md").write_bytes(app_bytes)  # external edit back to the app's bytes
    time.sleep(1.0)
    print("  events after external re-apply of app bytes:", [(e["kind"], e["path"], e["origin"]) for e in events[before:]])
    before = len(events)
    # a new file created externally, then deleted
    (root / "Pages" / "External.md").write_text("---\ntype: Page\ntitle: External\n---\nhi\n")
    time.sleep(1.0)
    (root / "Pages" / "External.md").unlink()
    time.sleep(1.0)
    print("  events for external create+delete:", [(e["kind"], e["path"]) for e in events[before:]])
    print("  space still lists External?", any(s["path"] == "Pages/External.md" for s in client.get("/api/objects").json()))

    print("\n== SSE cleanup ==")
    stop.set()
    # trigger a line so the listener loop sees stop
    client.post("/api/tags/ensure", json={"name": "wake"})
    t.join(timeout=5)
    time.sleep(0.5)
    print("  listener thread alive:", t.is_alive(), "subscribers:", len(hub._subscribers))

    async def sub_cleanup():
        from objectapp.server import EventHub
        h = EventHub()
        h.loop = asyncio.get_running_loop()
        gens = [h.subscribe() for _ in range(5)]
        tasks = [asyncio.ensure_future(g.__anext__()) for g in gens]
        await asyncio.sleep(0.05)
        n1 = len(h._subscribers)
        for tk in tasks[:3]:
            tk.cancel()
        for g in gens[:3]:
            await g.aclose()
        await asyncio.sleep(0.05)
        n2 = len(h._subscribers)
        h.close()
        for tk in tasks[3:]:
            try:
                await tk
            except StopAsyncIteration:
                pass
        return n1, n2, len(h._subscribers)

    print("  hub subscribers (5 subscribed, 3 closed, then hub.close()):", asyncio.run(sub_cleanup()))
    client.__exit__(None, None, None)


if __name__ == "__main__":
    main()
