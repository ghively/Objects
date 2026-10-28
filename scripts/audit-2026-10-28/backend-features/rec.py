from h import *
from datetime import date, datetime, UTC, timedelta
from zoneinfo import ZoneInfo
from objectapp.recurrence import next_date, occurrences, scheduled_between, step
from objectapp.taskmodel import parse_repeat as P
NY = ZoneInfo("America/New_York"); UTCZ = ZoneInfo("UTC")
def nd(rule, cur, now, tz=UTCZ, ws="monday"):
    return next_date(P(rule), cur, now, now.astimezone(tz).date(), tz, ws)
# month end chain
d = date(2026,1,31); out=[]
for i in range(4):
    d = step(P("every month"), d, UTCZ); out.append(d.isoformat())
print("monthly from Jan31", out)
print("occ monthly Jan31", [x.isoformat() for x in occurrences(P("every month"), date(2026,1,31), date(2026,1,1), date(2026,6,30), UTCZ)])
print("sched_between monthly current Mar31", [x.isoformat() for x in scheduled_between(P("every month"), date(2026,3,31), date(2026,1,1), date(2026,6,30), UTCZ)])
# leap
print("yearly Feb29", [step(P("every year"), date(2024,2,29), UTCZ)])
print("yearly on feb 29", next_date(P("every year on february 29"), date(2024,2,29), datetime(2024,3,1,tzinfo=UTC), date(2024,3,1), UTCZ))
# DST: daily 09:00 NY across Mar 8 2026
cur = datetime(2026,3,7,14,0,tzinfo=UTC)  # 09:00 EST
n = step(P("every day"), cur, NY); print("DST daily", n, n.astimezone(NY))
# completion mode: completed late night local (NY 23:30 = UTC 04:30 next day)
comp = datetime(2026,10,29,3,30,tzinfo=UTC)  # 23:30 on Oct 28 NY
print("completion mode", nd("every day after completion", date(2026,10,20), comp, NY))
# weekday from Friday
print("weekday from Fri", step(P("every weekday"), date(2026,10,30), UTCZ))
# until inclusive
print("until", next_date(P("every day until 2026-10-29"), date(2026,10,28), datetime(2026,10,28,12,tzinfo=UTC), date(2026,10,28), UTCZ))
# every 2 weeks on mon, wed from a Wednesday, sunday week start
for ws in ("monday","sunday"):
    d=date(2026,10,28); seq=[]
    for i in range(5): d=step(P("every 2 weeks on mon, wed"), d, UTCZ, ws); seq.append(d.isoformat())
    print("2wk mon,wed", ws, seq)
# last friday
d=date(2026,10,30); seq=[]
for i in range(3): d=step(P("every month on the last friday"), d, UTCZ); seq.append(d.isoformat())
print("last fri", seq)
# 5th weekday? 
print(P("every month on the 5th friday"))
# overdue daily completed: next
print("overdue daily", nd("every day", date(2026,10,20), datetime(2026,10,28,12,tzinfo=UTC)))
# time-based due date, NY, overdue weekly
print("weekly time", nd("every week", datetime(2026,10,1,13,0,tzinfo=UTC), datetime(2026,10,28,12,tzinfo=UTC), NY))
# scheduled_between weekday backwards
print("sb weekday", [x.isoformat() for x in scheduled_between(P("every weekday"), date(2026,10,28), date(2026,10,20), date(2026,11,3), UTCZ)])
# scheduled_between on rule: every 2 months on the 31st current 2026-03-31
print("sb 2mo 31st", [x.isoformat() for x in scheduled_between(P("every 2 months on the 31st"), date(2026,3,31), date(2025,1,1), date(2026,12,31), UTCZ)])
print("fwd 2mo 31st from 2025-01-31", [x.isoformat() for x in occurrences(P("every 2 months on the 31st"), date(2025,1,31), date(2025,1,1), date(2026,12,31), UTCZ)])
