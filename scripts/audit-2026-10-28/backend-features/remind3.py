from h import *
from datetime import datetime, UTC, timedelta
from objectapp.reminders import ReminderScheduler, Ledger
class N:
    def __init__(s): s.sent=[]
    def send(s,t,b): s.sent.append((t,b))
root = copy("space-m8")
sp = Space(root)
now = datetime(2026,10,29,12,0,tzinfo=UTC)   # deadline day, noon
sp.clock = lambda: now
led = root.parent/"l3.json"
# app was running yesterday and stopped cleanly
Ledger(led).mark_running(datetime(2026,10,28,18,0,tzinfo=UTC))
c = TestClient(create_app(sp, None, watch=False))
o = c.get("/api/object", params={"path":"Tasks/Submit report.md"}).json()
r = c.put("/api/tasks/reminder", json={"path":"Tasks/Submit report.md","key":"deadline","remind":"on the day at 09:00","baseVersion":o["version"]})
fm = r.json()["frontmatter"]; print("PUT", r.status_code, fm.get("reminders"), "lastUpdated:", fm.get("lastUpdated"))
# app restarts a minute later: catch-up from the ledger's lastRunning
sch = ReminderScheduler(sp, N(), ledger=Ledger(led))
print("startup tick fires:", sch.tick(now + timedelta(minutes=1)))
# compare: Task date remind path
