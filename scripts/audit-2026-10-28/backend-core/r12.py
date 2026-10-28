from h import *
s, d = space()
(d/"Pages/alpha.md").write_text("---\ntype: 'Task'\ntitle: Alpha\nstatus: Not Started\n---\nthe task\n")
print("Alpha.md before:", (d/"Pages/Alpha.md").read_text()[:80])
s = Space(d)
t = [t for t in s.types if t.name=="Page"][0]
print("page folder", t.folder)
of, fm, v = s.read("Pages/alpha.md")
r = s.change_type("Pages/alpha.md", t.id, {}, v)
print(r)
print(sorted(p.name for p in (d/"Pages").iterdir()))
print("Alpha.md after:", (d/"Pages/Alpha.md").read_text())
print("trash:", list((d/".capacities/trash").glob("*")) if (d/".capacities/trash").exists() else None)
