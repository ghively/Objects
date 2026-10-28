from h import *
sp, c = client()
r = c.post("/api/attachments", params={"name":"meeting notes.md"}, content=b"# Hello\nsome notes\n"); print(r.json())
p = r.json()["path"]
print("file", c.get("/api/file", params={"path":p}).status_code, c.get("/api/file", params={"path":p}).text[:80])
sp.rescan_file(p)  # what the watcher does on a new file
print("as object:", [o["path"] for o in c.get("/api/objects").json() if o["path"].startswith("Attachments")])
print("attachments list:", [a for a in c.get("/api/attachments").json() if "meeting" in str(a)])
