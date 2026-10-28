from h import *
import traceback
sp = Space(copy("space-m8"))
c = TestClient(create_app(sp, None, watch=False), raise_server_exceptions=False)
n = "会議"*45
r = c.post("/api/collections", json={"name":n}); print("collection", r.status_code, r.text[:120])
r = c.post("/api/objects", json={"typeId":"page","title":n}); print("object", r.status_code, r.text[:120])
r = c.post("/api/objects", json={"typeId":"page","title":"a"*119+"é"*80}); print("object2", r.status_code, r.text[:120])
r = c.post("/api/types", json={"name":n,"pluralName":n}); print("type", r.status_code, r.text[:120])
