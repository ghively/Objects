from h import *
import hashlib, time, sys
def snap(root):
    out={}
    for p in sorted(root.rglob("*")):
        if p.is_file(): out[str(p.relative_to(root))]=hashlib.sha256(p.read_bytes()).hexdigest()
        else: out[str(p.relative_to(root))+"/"]="d"
    return out
for name in ["space-m8","space-calendar","space-sample","space-links","space-blocks","space-whiteboard","space-v1"]:
    root = copy(name)
    before = snap(root)
    sp = Space(root)
    c = TestClient(create_app(sp, None, watch=True), raise_server_exceptions=False)
    with c:
        time.sleep(0.5)
        objs = c.get("/api/objects").json()
        bad=[]
        for u in ["/api/space","/api/settings","/api/spaces","/api/ui","/api/collections","/api/queries","/api/trash","/api/images","/api/attachments","/api/graph","/api/calendar?from=2026-10-01&to=2026-11-30","/api/search?q=the"]:
            r=c.get(u); 
            if r.status_code>=500: bad.append((u,r.status_code))
        for t in c.get("/api/space").json()["types"]:
            c.get(f"/api/views/{t['id']}"); c.get(f"/api/types/{t['id']}/templates")
        for o in objs:
            p=o["path"]
            for u,params in [("/api/object",{"path":p}),("/api/references",{"path":p}),("/api/history",{"path":p}),("/api/tasks/stats",{"path":p}),("/api/tasks/overdue",{"path":p}),("/api/object/change-type",{"path":p,"typeId":"page"})]:
                r=c.get(u,params=params)
                if r.status_code>=500: bad.append((u,p,r.status_code,r.text[:80]))
        c.post("/api/rows", json={})
        time.sleep(0.6)
    after = snap(root)
    diff = {k for k in set(before)|set(after) if before.get(k)!=after.get(k)}
    print(name, "objs",len(objs),"changed:", sorted(diff)[:10], "500s:", bad[:5])
