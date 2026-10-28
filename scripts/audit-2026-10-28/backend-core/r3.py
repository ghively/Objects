import sys; sys.path.insert(0, "/home/user/Objects/backend")
from objectapp.frontmatter import *
for ch in ["\x0b","\x0c","\x1c","\x1d","\x1e","\x85"," "," ", "\r"]:
    src = f"id: x\ntitle: 'a{ch}b'\ndescription: d\nlastUpdated: 2026-01-01\n"
    try:
        p = parse_fm(src)
    except Exception as e:
        print(repr(ch), "parse fail", e); continue
    try:
        out = set_keys(src, {"lastUpdated": "2026-02-02"})
        p2 = parse_fm(out)
        exp = dict(p); exp["lastUpdated"]="2026-02-02"
        if p2 != exp: print(repr(ch), "WRONG", repr(out), p2)
        out = set_keys(src, {"description": "NEW"})
        p2 = parse_fm(out)
        exp = dict(p); exp["description"]="NEW"
        if p2 != exp: print(repr(ch), "WRONG2", repr(out), p2)
    except Exception as e:
        print(repr(ch), "EXC", e)
