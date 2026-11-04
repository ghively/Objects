from h import *
from fastapi.testclient import TestClient
sp = Space(copy("space-m8"))
(sp.root/"notes.txt").write_text("secret ^abcdef\n")
c = TestClient(create_app(sp, None, watch=False), raise_server_exceptions=False)
for p in [".object/space.json","notes.txt",".object/ui.json"]:
    for u,params in [("/api/object",{"path":p}),("/api/block",{"path":p,"id":"abcdef"}),("/api/history",{"path":p}),("/api/references",{"path":p}),("/api/block/references",{"path":p,"id":"x"})]:
        r=c.get(u,params=params); print(p,u,r.status_code,r.text[:100])
    v="x"
    r=c.put("/api/object/body",json={"path":p,"body":"hi","baseVersion":v}); print("PUT body",p,r.status_code,r.text[:100])
