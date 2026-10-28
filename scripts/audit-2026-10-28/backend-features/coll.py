from h import *
import traceback
sp = Space(copy("space-m8"))
c = TestClient(create_app(sp, None, watch=False))
for n in ["a"*300, "a"*100000]:
    try:
        r = c.post("/api/collections", json={"name":n}); print(len(n), r.status_code, r.text[:150])
    except Exception as e:
        print(len(n), type(e).__name__, str(e)[:100], [(f.filename.split('/')[-1],f.lineno) for f in traceback.extract_tb(e.__traceback__)[-3:]])
