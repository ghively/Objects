from h import *
from datetime import datetime, UTC, timedelta
from objectapp.reminders import ReminderScheduler, Ledger
class N:
    def __init__(s): s.sent=[]
    def send(s,t,b): s.sent.append((t,b))
root = copy("space-calendar")
(root/"Tasks/Someday.md").write_text("---\ntype: 'Task'\ntitle: Someday\nstatus: Not Started\ndate: 9999-12-31\nremind: on the day at 09:00\n---\n")
sp = Space(root)
T = datetime(2026,10,23,8,15,tzinfo=UTC)
n=N(); sch = ReminderScheduler(sp, n, ledger=Ledger(root.parent/"l4.json"))
for t in (T-timedelta(seconds=20), T+timedelta(seconds=10)):
    try: print(sch.tick(t))
    except Exception as e: print("tick raised", type(e).__name__, e)
print("sent", n.sent)
c = TestClient(create_app(sp, None, watch=False), raise_server_exceptions=False)
(root/"Tasks/Someday2.md").write_text("---\ntype: 'Task'\ntitle: Someday2\nstatus: Not Started\ndate: 9999-12-31\nrepeat: every year\n---\n")
sp.rescan_file("Tasks/Someday2.md")
print("calendar", c.get("/api/calendar", params={"from":"2026-10-01","to":"2026-10-31"}).status_code)
