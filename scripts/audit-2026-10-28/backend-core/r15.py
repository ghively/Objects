import sys; sys.path.insert(0, "/home/user/Objects/backend")
from objectapp.frontmatter import *
from objectapp.relink import relink_frontmatter
src = "type: 'Page'\ntitle: AAA\nnote: owned by\n  [[Ada Lovelace]] mostly\n"
fm = parse_fm(src); print(fm)
out = relink_frontmatter(src, fm, lambda t: t == "Ada Lovelace", "Ada King")
print(repr(out)); print(parse_fm(out))
