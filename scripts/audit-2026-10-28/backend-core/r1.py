from h import *
s, d = space()
print([x.path for x in s.list()])
p = "Pages/Alpha.md"
of, fm, v = s.read(p)
try:
    r = s.rename_object(p, ".env", v)
    print("result", r)
except Exception as e:
    print("EXC", type(e), e)
print(sorted(str(x.relative_to(d)) for x in d.rglob("*") if "env" in x.name or "Alpha" in x.name))
print([x.path for x in s.list() if "Alpha" in x.path or "env" in x.path])
