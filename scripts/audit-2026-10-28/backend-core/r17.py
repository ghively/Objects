from h import *
s, d = space()
t = [t for t in s.types if t.name=="Page"][0]
for title in ["😀"*70, "é"*130]:
    try:
        rel, v = s.create_object(t.id, title); print("ok", len(rel.encode()))
    except Exception as e:
        print("EXC", type(e).__name__, str(e)[:80])
# mixed endings
p = d/"Pages/Alpha.md"
b = p.read_bytes().replace(b"\r\n", b"\n")
lines = b.split(b"\n"); lines[-2] = lines[-2] + b"\r"
p.write_bytes(b"\n".join(lines))
s = Space(d)
of, fm, v = s.read("Pages/Alpha.md")
s.update_properties("Pages/Alpha.md", {"description": "x"}, v)
print(p.read_bytes())
