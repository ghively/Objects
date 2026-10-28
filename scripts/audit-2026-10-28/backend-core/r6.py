from h import *
s, d = space()
p = "Tasks/Write docs.md"
print((d/p).read_text())
of, fm, v = s.read(p)
r = s.update_properties(p, {"description": "pasted text"}, v)
print(r)
of, fm, v = s.read(p)
print(repr((d/p).read_text()))
v = s.save_body(p, "new body\n", v)
print(repr((d/p).read_text()))
