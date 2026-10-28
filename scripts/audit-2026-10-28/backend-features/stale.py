from h import *
import time
sp, c = client()
def wait(c):
    s=c.app.state.search
    for _ in range(50):
        if s.ready.is_set() and s._queue.empty(): break
        time.sleep(0.1)
    time.sleep(0.5)
def srch(q): return [r["path"] for r in c.get("/api/search",params={"q":q}).json()["results"]]
with c:
    wait(c)
    print("backlinks Ada", c.get("/api/object",params={"path":"People/Ada Lovelace.md"}).json()["backlinks"])
    print("search lovelace", srch("Lovelace"))
    tid = c.delete("/api/object",params={"path":"People/Ada Lovelace.md"}).json()["trashId"]; wait(c)
    print("after delete search", srch("Lovelace"))
    print("Write docs links", c.get("/api/object",params={"path":"Tasks/Write docs.md"}).json()["links"])
    r=c.post(f"/api/trash/{tid}/restore"); print(r.status_code, r.json()); wait(c)
    print("after restore search", srch("Lovelace"))
    print("backlinks Ada", c.get("/api/object",params={"path":"People/Ada Lovelace.md"}).json()["backlinks"])
    v=c.get("/api/object",params={"path":"People/Ada Lovelace.md"}).json()["version"]
    r=c.post("/api/object/rename",json={"path":"People/Ada Lovelace.md","title":"Ada King","baseVersion":v}).json(); print(r); wait(c)
    print("search King", srch("King"), "search Lovelace", srch("Lovelace"))
    print("backlinks", c.get("/api/object",params={"path":r["path"]}).json()["backlinks"])
    print("WD body", c.get("/api/object",params={"path":"Tasks/Write docs.md"}).json()["body"])
    print("search body 'King' fulltext", [x["path"] for x in c.get("/api/search",params={"q":"King","mode":"fullText"}).json()["results"]])
