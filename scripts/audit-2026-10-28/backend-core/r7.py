from h import *
s, d = space()
p = d/"Servers/Alpha.md"
t = p.read_text()
print(t)
t = t.replace("owner: '[[Ada Lovelace]]'", "owner: [[Ada Lovelace]]\nnotes: |\n  see [[Ada Lovelace]] and\n  [[Ada Lovelace|x]]\nrefs:\n  - \"[[Ada Lovelace]]\"\n  - '[[Alpha]]'\ndq: \"\\u00e9 [[Ada Lovelace]]\"\nplain: see [[Ada Lovelace]] now")
p.write_text(t)
s, _ = Space(d), None
print(s.backlinks("People/Ada Lovelace.md"))
of, fm, v = s.read("People/Ada Lovelace.md")
r = s.rename_object("People/Ada Lovelace.md", "Ada King", v)
print(r)
print(p.read_text())
