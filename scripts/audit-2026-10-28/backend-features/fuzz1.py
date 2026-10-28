from h import *
from urllib.parse import quote as Q
from fastapi.testclient import TestClient
sp = Space(copy("space-sample"))
c = TestClient(create_app(sp, None, watch=False), raise_server_exceptions=False)
def show(m, url, **kw):
    r = c.request(m, url, **kw)
    if r.status_code >= 500: print("500!!", m, url[:60], repr(kw)[:120])
    return r
v = c.get("/api/object", params={"path":"Tasks/Write docs.md"}).json()["version"]
weird = ["", "..", "../x.md", "/etc/passwd", "C:\\x.md", "a\x00b.md", "Tasks", "Tasks/", ".capacities/types/task.json", "Tasks/Write docs.md/..", "%2e%2e/x", "\\\\server\\share\\x.md", "Tasks/./Write docs.md", "Tasks//Write docs.md", "TASKS/write docs.md", "x"*5000+".md"]
for p in weird:
    show("GET","/api/object",params={"path":p})
    show("PUT","/api/object/body",json={"path":p,"body":"x","baseVersion":"0"})
    show("PUT","/api/object/properties",json={"path":p,"updates":{},"baseVersion":"0"})
    show("POST","/api/object/ensure-id",json={"path":p})
    show("POST","/api/object/rename",json={"path":p,"title":"y","baseVersion":"0"})
    show("GET","/api/object/change-type",params={"path":p,"typeId":"page"})
    show("DELETE","/api/object",params={"path":p})
    show("GET","/api/file",params={"path":p})
    show("POST","/api/reveal",json={"path":p})
    show("GET","/api/resolve",params={"link":p, "from": p})
    show("GET","/api/views/"+Q(p or "x", safe=""))
    show("PUT","/api/views/"+Q(p or "x", safe=""), json={"views":{}})
    show("GET","/api/types/"+Q(p or "x", safe="")+"/templates")
    show("POST","/api/trash/"+Q(p or "x", safe="")+"/restore")
    show("DELETE","/api/trash/"+Q(p or "x", safe=""))
    show("POST","/api/rows",json={"paths":[p]})
    show("GET","/api/backlinks",params={"path":p})
    show("GET","/api/references",params={"path":p})
    show("GET","/api/graph",params={"path":p})
    show("PUT","/api/collections/"+Q(p or "x", safe=""), json={"collection":{}})
    show("PUT","/api/queries/"+Q(p or "x", safe=""), json={"query":{}})
    show("DELETE","/api/queries/"+Q(p or "x", safe=""))
    show("DELETE","/api/collections/"+Q(p or "x", safe=""))
    show("POST","/api/daily-notes",json={"date":p})
    show("POST","/api/objects",json={"typeId":p or "x","title":p})
for title in ["", " ", "..", ".", "a/b", "a\\b", "CON", "x"*300, "a:b", "<>", "\x00", "#", "trail ", "\u202e", "a|b", "[[x]]"]:
    v = c.get("/api/object", params={"path":"Pages/Alpha.md"}).json()["version"]
    r=show("POST","/api/object/rename",json={"path":"Pages/Alpha.md","title":title,"baseVersion":v})
    if r.status_code==200: 
        np=r.json().get("path"); print("renamed to", repr(np)); 
        v2=c.get("/api/object",params={"path":np}).json()["version"]
        show("POST","/api/object/rename",json={"path":np,"title":"Alpha","baseVersion":v2})
    show("POST","/api/objects",json={"typeId":"page","title":title})
for d in ["2026-02-30","2026-13-01","0000-01-01","9999-12-31","2026-1-1"," 2026-10-30 ","2026-10-30T10:00"]:
    r=show("POST","/api/daily-notes",json={"date":d}); print("dn",repr(d),r.status_code, r.text[:100])
for f,t in [("2026-01-01","2026-01-01"),("9999-12-01","9999-12-31"),("0001-01-01","0001-01-10"),("2026-10-01","2026-09-01"),("x","y")]:
    show("GET","/api/calendar",params={"from":f,"to":t})
for q in [{"limit":"0"},{"limit":"abc"},{"limit":"1e3"},{"q":"x","type":"zzz"},{"q":"ab","tag":" "}]:
    show("GET","/api/search",params=q)
show("POST","/api/rows",json={"search":{"terms":["a"],"mode":"auto"}})
show("POST","/api/rows",json={"search":{"terms":["ab"],"mode":"bogus"}})
print("done")
