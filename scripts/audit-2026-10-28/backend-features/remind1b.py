from h import *
from datetime import datetime, UTC, timedelta
from objectapp.reminders import ReminderScheduler, Ledger
class N:
    def __init__(s): s.sent=[]
    def send(s,t,b): s.sent.append((t,b))
root = copy("space-calendar")
sp = Space(root)
T = datetime(2026,10,23,8,15,tzinfo=UTC)  # trigger of Call dentist
clock = [T - timedelta(seconds=20)]
sp.clock = lambda: clock[0]
n = N(); sch = ReminderScheduler(sp, n, ledger=Ledger(T.__class__ and (root.parent/"ledger.json")))
print("tick1", sch.tick(clock[0]))
# user edits the task body 5 s after the trigger
clock[0] = T + timedelta(seconds=5)
_, fm, v = sp.read("Tasks/Call dentist.md")
#sp.save_body("Tasks/Call dentist.md", "\nnotes while waiting\n", v)
print("lastUpdated now", sp.read("Tasks/Call dentist.md")[1]["lastUpdated"])
clock[0] = T + timedelta(seconds=10)
print("tick2", sch.tick(clock[0]), n.sent)
