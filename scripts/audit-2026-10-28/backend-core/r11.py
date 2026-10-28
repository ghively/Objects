from h import *
def crlfify(p):
    b = p.read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
    p.write_bytes(b"\xef\xbb\xbf" + b)
def check(p, label):
    b = p.read_bytes()
    bom = b.startswith(b"\xef\xbb\xbf")
    lone = b.replace(b"\r\n", b"").count(b"\n")
    print(f"{label:30} bom={bom} loneLF={lone}")
s, d = space()
for f in d.rglob("*.md"): crlfify(f)
s = Space(d)
p = "Tasks/Write docs.md"
of, fm, v = s.read(p)
v = s.save_body(p, of.body + "more\nlines\n", v); check(d/p, "save_body")
r = s.update_properties(p, {"description": "multi\nline desc", "tags": ["Docs", "New"]}, v); check(d/p, "update_properties")
v = r.version
t = [t for t in s.types if t.name=="Page"][0]
r = s.change_type(p, t.id, {}, v); check(d/r.path, "change_type"); p = r.path; v = r.version
r = s.rename_object("People/Ada Lovelace.md", "Ada King", s.read("People/Ada Lovelace.md")[2])
for x in r.relinked: check(d/x, "relinked "+x)
check(d/r.path, "renamed")
it = s.delete_object(r.path)
res = s.restore(it.id); check(d/res["paths"][0], "restored")
# tag rename
of, fm, v = s.read("Tags/Docs.md")
r = s.rename_object("Tags/Docs.md", "Documentation", v)
for x in r.relinked: check(d/x, "tagrelinked "+x)
print(r)
