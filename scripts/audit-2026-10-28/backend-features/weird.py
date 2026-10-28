from h import *
import time
root = copy("space-m8")
fms = [
 "type: 'Task'\ntitle: 123\nstatus: [Done, Not Started]\ndate: [2026-10-01, x]\nrepeat: every month\n",
 "type: 'Task'\ntitle: T2\ndate: 2026-10-28T25:00:00Z\nremind: at time\n",
 "type: 'Task'\ntitle: T3\ndate: 2026-10-28 -> 2026-10-01\nrepeat: every day\ncreatedAt: 2026-10-23\nlastUpdated: 12\n",
 "type: 'Task'\ntitle: T4\ndate: {a: 1}\nstatus: {x: y}\ntags: {a: b}\naliases: 5\n",
 "type: 'Task'\ntitle: T5\ndate: 2026-10-28T09:00:00+14:00\nremind: 1 minute before\nrepeat: every 3 weekdays\n",
 "type: 'Page'\ntitle: [a, b]\ncreatedAt: 9999-12-31T23:59:59Z\nlastUpdated: 0001-01-01T00:00:00Z\ndescription: [1,2]\nicon: 5\n",
 "type: 'Task'\ntitle: T6\ndate: 9999-12-31\nrepeat: every day\nremind: on the day at 23:59\n",
 "type: 'Task'\ntitle: T7\ndate: 0001-01-01\nrepeat: every year\nremind: 1 day before at 09:00\noccurrenceLog: [garbage, 1, {a: b}]\n",
 "type: 'Task'\ntitle: T8\ndate: 2026-10-28T09:00:00\nrepeat: every week on mon, sun until 2026-12-01\n",
 "type: 123\ntitle: T9\n",
 "title: T10\ntype: 'Task'\nreminders: {deadline: at time, date: 5 minutes before}\ndeadline: 2026-10-30T10:00:00Z\n",
]
for i, fm in enumerate(fms):
    (root/f"Tasks/W{i}.md").write_text("---\n"+fm+"---\nbody [[W1]] <time datetime=\"2026-10-28\">x</time>\n")
sp = Space(root)
from datetime import datetime, UTC
sp.clock = lambda: datetime(2026,10,28,12,tzinfo=UTC)
c = TestClient(create_app(sp, None, watch=False), raise_server_exceptions=False)
with c:
    time.sleep(1.5)
    for u, params in [("/api/calendar",{"from":"2026-09-01","to":"2026-12-01"}),("/api/calendar",{"from":"9999-09-30","to":"9999-12-30"}),("/api/calendar",{"from":"0001-01-01","to":"0001-02-01"}),("/api/graph",{}),("/api/search",{"q":"body"}),("/api/objects",{}),("/api/trash",{})]:
        r = c.get(u, params=params); print(u, params, r.status_code, r.text[:150] if r.status_code>=400 else "")
    r = c.post("/api/rows", json={}); print("rows", r.status_code, r.text[:150] if r.status_code>=400 else len(r.json()["rows"]))
    for i in range(len(fms)):
        p=f"Tasks/W{i}.md"
        for u in ["/api/object","/api/references","/api/tasks/stats","/api/tasks/overdue","/api/history"]:
            r=c.get(u,params={"path":p})
            if r.status_code>=500: print("500", u, p, r.text[:100])
        o = c.get("/api/object",params={"path":p}).json()
        if "version" in o:
            for act in ["complete","skip"]:
                o = c.get("/api/object",params={"path":p}).json()
                r=c.post("/api/tasks/occurrence",json={"path":p,"action":act,"baseVersion":o["version"],"catchUp":"catchUpThroughNow" if act=="complete" else None})
                if r.status_code>=500: print("500 occ", act, p)
            o = c.get("/api/object",params={"path":p}).json()
            r=c.put("/api/object/properties",json={"path":p,"updates":{"status":["Done"]},"baseVersion":o["version"]})
            if r.status_code>=500: print("500 props", p)
    print("tick", c.app.state.reminders.tick(datetime(2026,10,28,12,tzinfo=UTC)))
