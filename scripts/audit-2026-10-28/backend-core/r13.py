import sys; sys.path.insert(0, "/home/user/Objects/backend")
from objectapp.frontmatter import *
from objectapp.relink import relink_frontmatter
cases = [
 "a: first line\n  see [[Old]] here\nb: 1\n",
 "a: '[[Old]]' # comment [[Old]]\nb: 1\n",
 "a: \"[[Old]]\\n[[Old]]\"\nb: 1\n",
 "a: >\n  folded [[Old]]\n  more\nb: 1\n",
 "a: |\n  more [[Old]]\n    deeper [[Old]]\nb: 1\n",
 "a:\n  - '[[Old]]'\n  - x: '[[Old]]'\nb: 1\n",
 "a: ['[[Old]]', {k: '[[Old]]'}]\nb: 1\n",
 "a: &anc '[[Old]]'\nb: *anc\n",
 "a: !!str '[[Old]]'\nb: 1\n",
 "a: \"[[Old]] \\\"q\\\"\"\n",
 "a: '[[Old]]\n  continued'\nb: 1\n",
]
for src in cases:
    fm = parse_fm(src)
    try:
        out = relink_frontmatter(src, fm, lambda t: t == "Old", "New Name: x")
        fm2 = parse_fm(out)
        import json
        exp = json.loads(json.dumps(fm).replace("[[Old]]", "[[New Name: x]]"))
        flag = "OK" if fm2 == exp else "DIFF"
        print(flag, repr(src), "->", repr(out), "" if flag=="OK" else (fm2, exp))
    except Exception as e:
        print("EXC", repr(src), type(e).__name__, e)
