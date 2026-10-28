from h import *
from datetime import datetime, UTC
root = copy("space-calendar")
p = root/"Tasks/Range task.md"
p.write_text("""---
type: 'Task'
title: Range task
createdAt: 2026-09-30T08:00:00.000Z
lastUpdated: 2026-09-30T08:00:00.000Z
status: Not Started
date: 2026-10-26 -> 2026-10-28
repeat: every week
---
""")
sp = Space(root)
sp.clock = lambda: datetime(2026,10,27,12,tzinfo=UTC)
c = TestClient(create_app(sp, None, watch=False))
o = c.get("/api/object", params={"path":"Tasks/Range task.md"}).json()
r = c.put("/api/object/properties", json={"path":"Tasks/Range task.md","updates":{"status":["Done"]},"baseVersion":o["version"]})
print(r.status_code, r.json().get("task"), r.json()["frontmatter"].get("date"))
o = c.get("/api/object", params={"path":"Tasks/Range task.md"}).json()
r = c.post("/api/tasks/occurrence", json={"path":"Tasks/Range task.md","action":"skip","baseVersion":o["version"]})
print(r.status_code, r.json().get("task"), r.json().get("frontmatter",{}).get("date"))
