from h import *
s, d = space()
t = [t for t in s.types if t.name=="Page"][0]
rel, v = s.create_object(t.id, "Line sep")
print(repr((d/rel).read_text()))
of, fm, v = s.read(rel)
print(fm.keys())
v = s.save_body(rel, "hello\n", v)
print(repr((d/rel).read_text()))
of, fm, v = s.read(rel)
print(fm.keys())
# file written externally with LS in title then edited
p = d/"Pages/Notes.md"
txt = p.read_text()
print(repr(txt[:300]))
