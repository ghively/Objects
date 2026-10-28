from h import *
sp, c = client()
r = c.post("/api/images?name=evil.svg", content=b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', headers={"content-type":"text/plain","origin":"http://evil.example"})
print(r.status_code, r.text, r.headers.get("access-control-allow-origin"))
r = c.get("/api/space", headers={"host":"evil.example:8000"}); print("rebind host", r.status_code)
r = c.post("/api/objects", content=b'{"typeId":"page","title":"x"}', headers={"content-type":"text/plain"}); print(r.status_code, r.text[:200])
