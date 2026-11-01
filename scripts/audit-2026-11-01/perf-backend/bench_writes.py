"""Write-route cost at 5,000 objects, with what each write triggers (rescans, re-resolves,
re-indexed search documents, history snapshots) and the longest space-lock hold it causes.

Usage (from ``backend/``)::

    OBJECT_STATE_DIR=... OBJECT_CACHE_DIR=... uv run python \
        ../scripts/audit-2026-11-01/perf-backend/bench_writes.py <space-copy>

Run it on a COPY of the generated space: it writes to it.
"""

from __future__ import annotations

import json
import sys
import threading
import time
from pathlib import Path

from fastapi.testclient import TestClient


class Counters:
    def __init__(self, space, search, links) -> None:
        self.space, self.search, self.links = space, search, links
        self.rescans = 0
        self.resolve_all = 0
        self.resolver_builds = 0
        self.indexed = 0
        self.snapshots = 0
        self.extracts = 0
        from objectapp import resolver as resolver_mod
        orig_rescan = space.rescan_file
        orig_resolve_all = links._resolve_all
        orig_extract = links._extract
        orig_put = search._put
        orig_build = resolver_mod.Resolver.build

        def rescan(path):
            self.rescans += 1
            return orig_rescan(path)

        def resolve_all():
            self.resolve_all += 1
            return orig_resolve_all()

        def extract(path):
            self.extracts += 1
            return orig_extract(path)

        def put(conn, path, version, doc):
            self.indexed += 1
            return orig_put(conn, path, version, doc)

        def build(cls, summaries, aliases):
            self.resolver_builds += 1
            return orig_build(summaries, aliases)

        space.rescan_file = rescan
        links._resolve_all = resolve_all
        links._extract = extract
        search._put = put
        resolver_mod.Resolver.build = classmethod(build)
        before = space.before_write

        def bw(rel, data):
            self.snapshots += 1
            return before(rel, data) if before else None

        space.before_write = bw

    def snap(self):
        return (self.rescans, self.resolve_all, self.resolver_builds, self.indexed, self.snapshots, self.extracts)


class LockProbe(threading.Thread):
    """Measures how long a reader waits for ``space._lock`` while a write runs."""

    def __init__(self, lock) -> None:
        super().__init__(daemon=True)
        self.lock = lock
        self.max_wait = 0.0
        self.stop = threading.Event()

    def run(self) -> None:
        while not self.stop.is_set():
            t0 = time.perf_counter()
            with self.lock:
                pass
            w = time.perf_counter() - t0
            if w > self.max_wait:
                self.max_wait = w
            time.sleep(0.0005)

    def reset(self) -> float:
        m, self.max_wait = self.max_wait, 0.0
        return m


def main() -> None:
    root = Path(sys.argv[1]).resolve()
    from objectapp import server as _server
    _server.allowed_hosts = _server.LOOPBACK_HOSTS | {"testserver"}
    from objectapp.server import create_app
    from objectapp.space import Space

    space = Space(root)
    app = create_app(space, None, watch=False)
    with TestClient(app) as c:
        search = app.state.search
        search.ready.wait(900)
        list(space.links.edges())
        c.get("/api/objects")
        ctr = Counters(space, search, space.links)
        probe = LockProbe(space._lock)
        probe.start()
        hub = "Pages/Hub Object.md"

        def settle() -> None:
            """Wait for the background search-index thread to drain (debounce 0.2 s)."""
            time.sleep(1.5)
            list(space.links.edges())  # force the link index to apply pending changes

        def run(name: str, fn, after=None):
            settle()
            probe.reset()
            s0 = ctr.snap()
            t0 = time.perf_counter()
            r = fn()
            el = time.perf_counter() - t0
            if hasattr(r, "status_code"):
                assert r.status_code < 400, (name, r.status_code, r.text[:300])
            lock_in_call = probe.reset()
            settle()
            s1 = ctr.snap()
            d = [b - a for a, b in zip(s0, s1)]
            after_ms = 0.0
            if after is not None:
                t1 = time.perf_counter()
                after()
                after_ms = (time.perf_counter() - t1) * 1000
            print(f"{name:58s} {el*1000:9.1f} ms | lock wait max {lock_in_call*1000:8.1f} ms | rescans {d[0]:4d} resolve_all {d[1]} resolver_builds {d[2]} search_docs {d[3]:4d} snapshots {d[4]} extracts {d[5]:4d}"
                  + (f" | next read after: {after_ms:.0f} ms" if after else ""), flush=True)
            return r

        def version(path):
            return c.get("/api/object", params={"path": path}).json()["version"]

        first_read = lambda: c.get("/api/objects", params={"type": "task"})

        # 1. body save of the 50 KB hub, body changed by a line
        body = c.get("/api/object", params={"path": hub}).json()["body"]
        for i in range(3):
            run(f"PUT /api/object/body hub 50KB (edit {i})", lambda i=i: c.put("/api/object/body", json={"path": hub, "body": body + f"\nEdit {i} {time.time()}\n", "baseVersion": version(hub)}), after=first_read)
        # 2. property edit
        page = "Pages/Page 0005 " + next(p for p in space._raw if p.startswith("Pages/Page 0005 ")).split(" ", 2)[2]
        run("PUT /api/object/properties (description)", lambda: c.put("/api/object/properties", json={"path": page, "updates": {"description": f"desc {time.time()}"}, "baseVersion": version(page)}), after=first_read)
        run("PUT /api/object/properties (aliases -> names change)", lambda: c.put("/api/object/properties", json={"path": page, "updates": {"aliases": [f"alias {int(time.time())}"]}, "baseVersion": version(page)}), after=first_read)
        # 3. rename hub with 200 referrers
        r = run("POST /api/object/rename hub (214 referrers, relink)", lambda: c.post("/api/object/rename", json={"path": hub, "title": "Hub Renamed", "baseVersion": version(hub)}), after=first_read)
        new_hub = r.json()["path"]
        print(f"   relinked={len(r.json()['relinked'])} skipped={len(r.json()['skipped'])}")
        r = run("POST /api/object/rename back (214 referrers)", lambda: c.post("/api/object/rename", json={"path": new_hub, "title": "Hub Object", "baseVersion": version(new_hub)}), after=first_read)
        hub = r.json()["path"]
        run("POST /api/object/rename ordinary page (no referrers)", lambda: c.post("/api/object/rename", json={"path": page, "title": "Page 0005 Again", "baseVersion": version(page)}), after=first_read)
        page = "Pages/Page 0005 Again.md"
        # 4. change type page -> idea
        r = run("POST /api/object/change-type page->idea", lambda: c.post("/api/object/change-type", json={"path": page, "typeId": "idea", "mapping": {}, "baseVersion": version(page)}), after=first_read)
        page = r.json()["path"]
        # 5. delete / restore
        r = run("DELETE /api/object", lambda: c.delete("/api/object", params={"path": page}), after=first_read)
        trash_id = r.json()["trashId"]
        run("POST /api/trash/{id}/restore", lambda: c.post(f"/api/trash/{trash_id}/restore"), after=first_read)
        # 6. duplicate (the hub: 50 KB)
        run("POST /api/object/duplicate hub (50 KB)", lambda: c.post("/api/object/duplicate", json={"path": hub}), after=first_read)
        # 7. create object + daily note
        run("POST /api/objects (create page)", lambda: c.post("/api/objects", json={"typeId": "page", "title": f"New page {time.time()}"}), after=first_read)
        run("POST /api/daily-notes (create)", lambda: c.post("/api/daily-notes", json={"date": "2030-01-01"}), after=first_read)
        # 8. type edit that rewrites objects: rename the Project status option "Next Up" -> "Queued"
        types = {t["id"]: t for t in c.get("/api/space").json()["types"]}
        proj = types["project"]
        rev = proj.get("revision", "")
        t2 = json.loads(json.dumps(proj))
        for p in t2["propertyDefinitions"]:
            if p["id"] == "status":
                for o in p["options"]["set"]:
                    if o["text"] == "Next Up":
                        o["text"] = "Queued"
        n_affected = sum(1 for r_ in space._raw.values() if r_.typeName == "Project" and r_.fm.get("status") == "Next Up")
        r = run(f"PUT /api/types/project (label option rename, {n_affected} objects rewritten)", lambda: c.put("/api/types/project", json={"type": t2, "baseRevision": rev, "confirm": True}), after=first_read)
        print(f"   rewritten={len(r.json().get('rewritten', []))} status={r.status_code}")
        # 9. type rename (non-basic): rewrites every member's type: line
        types = {t["id"]: t for t in c.get("/api/space").json()["types"]}
        book = json.loads(json.dumps(types["book"]))
        rev = book.get("revision", "")
        book["name"] = "Volume"; book["pluralName"] = "Volumes"
        r = run("PUT /api/types/book rename type (438 objects rewritten)", lambda: c.put("/api/types/book", json={"type": book, "baseRevision": rev, "confirm": True}), after=first_read)
        print(f"   rewritten={len(r.json().get('rewritten', []))} status={r.status_code}")
        # 10. whiteboard save
        board_md = next(p for p in sorted(space._raw) if p.startswith("Whiteboards/"))
        b = c.get("/api/whiteboard", params={"path": board_md}).json()
        b["board"]["blocks"]["b-1"]["markdown"] += " edited"
        run("PUT /api/whiteboard (board save)", lambda: c.put("/api/whiteboard", json={"path": board_md, "board": b["board"], "baseRevision": b["revision"]}), after=first_read)
        # 11. tasks occurrence + reminder
        task = next(p for p in sorted(space._raw) if p.startswith("Tasks/") and "repeat" in space._raw[p].fm)
        run("PUT /api/tasks/reminder", lambda: c.put("/api/tasks/reminder", json={"path": task, "key": "date", "remind": "1 day before at 09:00", "baseVersion": version(task)}), after=first_read)
        # 12. collection create (names change)
        run("POST /api/collections", lambda: c.post("/api/collections", json={"name": f"Coll {int(time.time())}", "typeIds": ["page"]}), after=first_read)
        run("PUT /api/ui", lambda: c.put("/api/ui", json={"patch": {"pinned": [hub]}, "baseRevision": c.get("/api/ui").json()["revision"]}), after=first_read)
        # 13. search reindex
        t0 = time.perf_counter()
        c.post("/api/search/reindex")
        time.sleep(0.5)
        search.ready.wait(900)
        print(f"POST /api/search/reindex full rebuild: {time.perf_counter()-t0:.1f} s")
        probe.stop.set()


if __name__ == "__main__":
    main()
