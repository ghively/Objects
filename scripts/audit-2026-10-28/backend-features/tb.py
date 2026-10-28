from h import *
import traceback
sp, c = client()
for m,u,kw in [("GET","/api/object",{"params":{"path":"x"*5000+".md"}}),("GET","/api/calendar",{"params":{"from":"9999-12-01","to":"9999-12-31"}}),("GET","/api/file",{"params":{"path":"a\x00b.md"}}),("DELETE","/api/queries/"+"x"*300,{}), ("GET","/api/object",{"params":{"path":"x"*300+".md"}})]:
    try: r=c.request(m,u,**kw); print(r.status_code)
    except Exception as e:
        tb=traceback.extract_tb(e.__traceback__)[-3:]
        print(m,u[:40], type(e).__name__, str(e)[:100], [(f.filename.split('/')[-1],f.lineno) for f in tb])
v = c.get("/api/object", params={"path":"Pages/Alpha.md"}).json()["version"]
r = c.post("/api/object/rename", json={"path":"Pages/Alpha.md","title":"a/b","baseVersion":v}); print(r.json())
print(open(sp.root/r.json()["path"]).read()[:300])
