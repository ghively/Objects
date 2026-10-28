from h import *
s, d = space()
(d/"Pages/AAA.md").write_text("---\ntype: 'Page'\ntitle: AAA\nnote: owned by\n  [[Ada Lovelace]] mostly\n---\nbody [[Ada Lovelace]]\n")
(d/"Pages/BBB.md").write_text("---\ntype: 'Page'\ntitle: BBB\nrefs:\n  - '[[Ada Lovelace]]'\n  - role: '[[Ada Lovelace]]'\n---\nx\n")
s = Space(d)
of, fm, v = s.read("People/Ada Lovelace.md")
try:
    r = s.rename_object("People/Ada Lovelace.md", "Ada King", v); print(r)
except Exception as e:
    print("EXC", type(e).__name__, str(e)[:100])
print(sorted(p.name for p in (d/"People").iterdir()))
for f in ["Pages/AAA.md", "Pages/BBB.md", "Projects/Object app.md", "Servers/Alpha.md", "Tasks/Write docs.md"]:
    print(f, [l for l in (d/f).read_text().splitlines() if "[[" in l or "role" in l])
