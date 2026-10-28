from h import *
import hashlib
for name in ["space-blocks","space-calendar","space-links","space-m8","space-sample","space-v1","space-whiteboard"]:
    d = Path(tempfile.mkdtemp(dir="."))/"s"
    shutil.copytree(f"/home/user/Objects/backend/tests/fixtures/{name}", d)
    before = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in d.rglob("*") if p.is_file()}
    s = Space(d)
    for o in s.list(): s.read(o.path); s.backlinks(o.path)
    s.types_with_revisions(); s.list_trash()
    after = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in d.rglob("*") if p.is_file()}
    ch = [str(p.relative_to(d)) for p in set(before)|set(after) if before.get(p)!=after.get(p)]
    print(name, ch)
