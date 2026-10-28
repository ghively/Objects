import sys; sys.path.insert(0, "/home/user/Objects/backend")
from objectapp.frontmatter import *
src = "id: x\ntitle: Old\nlastUpdated: 2026-01-01\n"
vals = ["a: b", "#hash", "- dash", "ünïcode ✓", "multi\nline", "multi\nline\n", "  lead", "trail  ", "yes", "null", "~", "123", "1e3", "@at", "`tick", "'q'", '"dq"', "a #b", "[x]", "{y}", "%p", "!t", "&a", "*b", "?", "|", ">", "", "2026-01-01", "2026-01-01T00:00:00Z", "0x1F", "\t", "x"*5000, "a\r\nb", " sep", "\x85nel", "tab\tin", "---", "...", "x\n---\ny"]
for v in vals:
    try:
        out = set_keys(src, {"title": v})
        back = parse_fm(out)["title"]
        if back != v:
            print("MISMATCH", repr(v), "->", repr(back), repr(out))
        # check other lines preserved
        if not out.startswith("id: x\n") or "lastUpdated: 2026-01-01\n" not in out:
            print("OTHER LINES", repr(out))
        # fence inside
        for line in out.split("\n"):
            if line == "---": print("FENCE in output", repr(v), repr(out))
    except Exception as e:
        print("EXC", repr(v), type(e).__name__, e)
