from h import *
import time
root = copy("space-sample")
(root/"Pages/Latin.md").write_bytes(b"---\ntype: 'Page'\ntitle: Caf\xe9 notes\n---\nbody text\n")
sp = Space(root)
c = TestClient(create_app(sp, None, watch=False), raise_server_exceptions=False)
with c:
    time.sleep(1.5)
    print("objects", c.get("/api/objects").status_code)
    print("object", c.get("/api/object", params={"path":"Pages/Latin.md"}).status_code)
    for q in ["notes", "Caf"]:
        r = c.get("/api/search", params={"q":q}); print("search", q, r.status_code, r.text[:100])
    print("graph", c.get("/api/graph").status_code)
    print("calendar", c.get("/api/calendar", params={"from":"2026-10-01","to":"2026-10-31"}).status_code)
    print("references", c.get("/api/references", params={"path":"Pages/Alpha.md"}).status_code)
    print("rows", c.post("/api/rows", json={}).status_code)
    print("history", c.get("/api/history", params={"path":"Pages/Latin.md"}).status_code)
    print("block refs", c.get("/api/block/references", params={"path":"Pages/Latin.md","id":"abcdef"}).status_code)
    print("trash", c.get("/api/trash").status_code)
    print("templates", c.get("/api/types/page/templates").status_code)
