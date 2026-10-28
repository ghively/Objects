from h import *
from datetime import datetime, UTC, timedelta
from objectapp.reminders import ReminderScheduler, Ledger
class N:
    def __init__(s): s.sent=[]
    def send(s,t,b): s.sent.append((t,b))
root = copy("space-calendar")
sp = Space(root)
T = datetime(2026,10,23,8,15,tzinfo=UTC)
sp.clock = lambda: T - timedelta(seconds=20)
c = TestClient(create_app(sp, None, watch=False))
o = c.get("/api/object", params={"path":"Tasks/Weekly review.md"}).json()
r = c.put("/api/tasks/reminder", json={"path":"Tasks/Weekly review.md","key":"date","remind":"99999999 days before at 09:00","baseVersion":o["version"]})
print("PUT", r.status_code, r.json().get("frontmatter",{}).get("remind"))
n = N(); sch = ReminderScheduler(sp, n, ledger=Ledger(root.parent/"l.json"))
sch.tick(T - timedelta(seconds=20))
try:
    print("tick2", sch.tick(T + timedelta(seconds=10)), n.sent)
except Exception as e:
    print("tick raised", type(e).__name__, e)
