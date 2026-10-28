from h import *
sp, c = client()
for n in ["evil.exe","run.bat","x.html","notes.md","../../x.txt",".bashrc","Pages.md"]:
    r = c.post("/api/attachments", params={"name":n}, content=b"MZ hello", headers={"content-type":"text/plain","origin":"https://evil.example"})
    print(n, r.status_code, r.text[:100], r.headers.get("access-control-allow-origin"))
r = c.get("/api/objects", headers={"origin":"https://evil.example"}); print("GET cross-origin", r.status_code, r.headers.get("access-control-allow-origin"))
