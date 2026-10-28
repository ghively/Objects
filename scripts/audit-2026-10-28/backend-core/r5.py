from h import *
for newt in ["Ada's \"quoted\" a: b", "Lovelace, Ada", "ada lovelace", "Ada   Lovelace", "C:\\x", "Ada Lovelace.", "x\u2028y", "back\\slash", "#tag"]:
    s, d = space()
    p = "People/Ada Lovelace.md"
    of, fm, v = s.read(p)
    try:
        r = s.rename_object(p, newt, v)
        print(repr(newt), "->", r.path, r.relinked, r.skipped)
    except Exception as e:
        print("EXC", repr(newt), type(e).__name__, e); continue
    t = (d/"Projects/Object app.md").read_text()
    print("   ", [l for l in t.splitlines() if "[[" in l])
    t = (d/"Servers/Alpha.md").read_text()
    print("   ", [l for l in t.splitlines() if "[[" in l])
