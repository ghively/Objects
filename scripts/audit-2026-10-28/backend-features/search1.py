from h import *
import time
sp, c = client()
with c:
    for _ in range(50):
        if c.app.state.search.ready.is_set(): break
        time.sleep(0.1)
    qs = ['"', '""', 'a*', '**', 'NEAR', 'NEAR(a b)', '-x', 'docs -', 'title:x', 'Write OR', 'é', '😀😀', '^ab', 'ab)', '(ab', "AND", 'x"y', '\x00ab', 'ab\u0000cd', 'ab+cd', 'user guide', 'wri', '\ud800ab']
    for q in qs:
        try:
            r = c.get("/api/search", params={"q": q})
            print(repr(q), r.status_code, len(r.json().get("results", [])) if r.status_code==200 else r.text[:150])
        except Exception as e:
            print(repr(q), "EXC", type(e).__name__, e)
    for mode in ("fullText","title"):
        r = c.get("/api/search", params={"q":"guide","mode":mode}); print(mode, r.status_code, [x["path"] for x in r.json()["results"]])
