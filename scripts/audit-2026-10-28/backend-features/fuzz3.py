from h import *
import itertools
sp = Space(copy("space-m8"))
c = TestClient(create_app(sp, None, watch=False), raise_server_exceptions=False)
W = [None, 1, -1, 1e308, "x", "", [], {}, [1], {"a":1}, True, "a"*100000, [None], {"type":"x"}]
def hit(m,u,**kw):
    r=c.request(m,u,**kw)
    if r.status_code>=500: print("500",m,u,repr(kw)[:150])
    return r
types=[t["id"] for t in c.get("/api/space").json()["types"]]
for w in W:
    hit("POST","/api/objects",json={"typeId":"task","title":"t","values":{"date":w,"status":w,"priority":w,"tags":w,"title":w,"aliases":w}})
    hit("POST","/api/objects",json={"typeId":"task","templateId":w if isinstance(w,str) else "zz"})
    hit("PUT","/api/ui",json={"patch":{"calendar":w}})
    hit("PUT","/api/ui",json={"patch":{"graph":w}})
    hit("PUT","/api/ui",json={"patch":{"tasks":w}})
    hit("PUT","/api/space",json={"patch":{"name":w,"icon":w,"description":w}})
    hit("PUT","/api/settings",json={"patch":{"openOnStart":w}})
    hit("POST","/api/collections",json={"name":w if isinstance(w,str) else "c","icon":w})
    hit("POST","/api/queries",json={"name":"q","definition":{"structures":w,"filterGroup":w,"sorts":w},"view":{"viewDefinition":w}})
    for t in types[:3]:
        hit("PUT",f"/api/views/{t}",json={"views":{"activeTab":w,"all":w}})
        hit("PUT",f"/api/types/{t}",json={"type":{"name":"N","pluralName":"Ns","propertyDefinitions":w if isinstance(w,(list,dict,type(None))) else []}})
        hit("PUT",f"/api/types/{t}",json={"type":{"name":"N","pluralName":"Ns","propertyDefinitions":[{"id":"p","key":"p","name":"P","type":w}]}})
        hit("PUT",f"/api/types/{t}",json={"type":{"name":"N","pluralName":"Ns","icon":w,"color":w,"templates":w,"views":w}})
    for k in ["date","deadline","status","priority","tags","aliases","description","icon","collections","completed","cover","occurrenceLog"]:
        o=c.get("/api/object",params={"path":"Tasks/Submit report.md"}).json()
        hit("PUT","/api/object/properties",json={"path":"Tasks/Submit report.md","updates":{k:w},"baseVersion":o["version"]})
    0 and hit("POST","/api/object/change-type",json={"path":"Tasks/Submit report.md","typeId":"page","mapping":{"x":w} if not isinstance(w,(dict,list)) else {},"baseVersion":o["version"]})
    hit("POST","/api/references/link",json={"path":"Tasks/Submit report.md","target":"Pages/x.md","start":w if isinstance(w,int) else 0,"end":5,"text":"x","baseVersion":"v"})
print("done")
