from h import *
s, d = space()
t = [t for t in s.types if t.name=="Task"][0]
orig = s.delete_object
n = [0]
def flaky(rel, **kw):
    n[0] += 1
    if n[0] == 2: raise PermissionError(13, "locked by another program")
    return orig(rel, **kw)
s.delete_object = flaky
members = s._type_members(t.id, templates=False)
print(members)
try:
    s.trash_type(t, members)
except Exception as e: print("EXC", e)
print("types dir:", sorted(p.name for p in (d/".object/types").iterdir()))
print("trash items:", [(i.kind, i.title) for i in s.list_trash()])
print("stranded:", [str(p.relative_to(d)) for p in (d/".object/trash/types").rglob("*") if p.is_file()])
