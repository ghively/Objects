from h import *
from fastapi.testclient import TestClient
sp = Space(copy("space-m8"))
c = TestClient(create_app(sp, None, watch=False), raise_server_exceptions=False)
def show(m, url, **kw):
    r = c.request(m, url, **kw)
    print(r.status_code, m, url[:50], repr(kw)[:100], r.text[:120] if r.status_code>=400 else "")
    return r
for p in ["../x.md", "/etc/passwd", "Tasks", "", "C:/x.md", "a\x00.md"]:
    show("GET","/api/tasks/overdue",params={"path":p})
    show("GET","/api/tasks/stats",params={"path":p})
    show("POST","/api/tasks/occurrence",json={"path":p,"action":"complete","baseVersion":"x"})
    show("PUT","/api/tasks/reminder",json={"path":p,"key":"date","baseVersion":"x"})
