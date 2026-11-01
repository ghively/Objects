"""Big-space writes, reindex, and the cost of walking dot-folders in /api/attachments.

Run: ``uv run python scripts/audit-2026-11-01/backend-api/perf_writes_walk.py``
"""

from __future__ import annotations

import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness import SCRATCH, fresh_dir, make_client  # noqa: E402

BIG = SCRATCH / "space-big"


def t(label, fn):
    t0 = time.perf_counter()
    r = fn()
    print(f"  {label:50} {(time.perf_counter()-t0)*1000:8.1f} ms  {getattr(r, 'status_code', '')} {getattr(r, 'text', '')[:100]}")
    return r


def main() -> None:
    root = fresh_dir("bigcopy") / "space-big"
    shutil.copytree(BIG, root)
    client, _ = make_client(root)
    from objectapp.media import list_attachments
    search = client.app.state.search
    search.ready.wait(300)

    print("== attachments walk ==")
    t("list_attachments (no dot-folder junk)", lambda: list_attachments(root))
    junk = root / ".git" / "objects"
    junk.mkdir(parents=True)
    for i in range(20000):
        (junk / f"{i:05d}.bin").write_bytes(b"x")
    t("list_attachments (+20k files under .git)", lambda: list_attachments(root))
    t("GET /api/attachments", lambda: client.get("/api/attachments"))
    t("GET /api/images", lambda: client.get("/api/images"))
    obj = client.get("/api/objects").json()[100]["path"]
    t("GET /api/object/export media=1", lambda: client.get("/api/object/export", params={"path": obj, "media": "1"}))
    shutil.rmtree(root / ".git")

    print("\n== writes ==")
    v = client.get("/api/object", params={"path": obj}).json()["version"]
    r = t("PUT /api/object/body", lambda: client.put("/api/object/body", json={"path": obj, "body": "edited body [[Object 00001]]", "baseVersion": v}))
    v = r.json().get("version", v)
    r = t("PUT /api/object/properties (description)", lambda: client.put("/api/object/properties", json={"path": obj, "updates": {"description": "d"}, "baseVersion": v}))
    v = r.json().get("version", v)
    r = t("POST /api/object/rename (relinks)", lambda: client.post("/api/object/rename", json={"path": obj, "title": "Object 00101 renamed", "baseVersion": v}))
    if r.status_code == 200:
        print("   relinked:", len(r.json().get("relinked", [])), "skipped:", len(r.json().get("skipped", [])))
    t("POST /api/objects", lambda: client.post("/api/objects", json={"typeId": "page", "title": "New page"}))
    t("POST /api/tags/ensure", lambda: client.post("/api/tags/ensure", json={"name": "brand new tag"}))
    types = client.get("/api/space").json()["types"]
    page = next(x for x in types if x["id"] == "page")
    t("PUT /api/types/page (description only)", lambda: client.put("/api/types/page", json={"type": {**page, "description": "x"}, "baseRevision": page["revision"]}))
    tag = next(o for o in client.get("/api/objects").json() if o["type"] == "tag")
    v = client.get("/api/object", params={"path": tag["path"]}).json()["version"]
    r = t("POST /api/object/rename of a Tag", lambda: client.post("/api/object/rename", json={"path": tag["path"], "title": tag["title"] + " renamed", "baseVersion": v}))
    if r.status_code == 200:
        print("   relinked:", len(r.json().get("relinked", [])))
    t("DELETE /api/object", lambda: client.delete("/api/object", params={"path": obj}))
    tr = client.get("/api/trash").json()
    t("POST /api/trash/restore", lambda: client.post(f"/api/trash/{tr[0]['id']}/restore"))

    print("\n== reindex ==")
    t0 = time.perf_counter()
    client.post("/api/search/reindex")
    time.sleep(0.6)
    search.ready.wait(300)
    print(f"  full reindex: {time.perf_counter()-t0:.2f}s")
    print("\n== calendar with one old recurring task ==")
    (root / "Tasks" / "Old daily.md").write_text("---\ntype: 'Task'\ntitle: Old daily\nstatus: Not Started\ndate: 2021-11-01T09:00:00.000Z\nrepeat: every day\n---\n")
    client.app.state.space.rescan_file("Tasks/Old daily.md")
    t("GET /api/calendar month (5y-old daily timed task)", lambda: client.get("/api/calendar", params={"from": "2026-11-01", "to": "2026-11-30"}))
    t("GET /api/calendar month in 2030", lambda: client.get("/api/calendar", params={"from": "2030-11-01", "to": "2030-11-30"}))
    t("GET /api/calendar month in 2060", lambda: client.get("/api/calendar", params={"from": "2060-11-01", "to": "2060-11-30"}))
    t("GET /api/tasks/stats old daily", lambda: client.get("/api/tasks/stats", params={"path": "Tasks/Old daily.md"}))
    client.__exit__(None, None, None)


if __name__ == "__main__":
    main()
