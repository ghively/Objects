from h import *
s, d = space()
name = "漢"*82 + ".md"
print(len(name.encode()))
(d/"Pages"/name).write_text("---\ntype: 'Page'\n---\nhi\n")
s = Space(d)
rel = "Pages/"+name
of, fm, v = s.read(rel)
try:
    s.save_body(rel, "changed\n", v); print("saved")
except Exception as e:
    print("EXC", type(e).__name__, str(e)[-60:])
try:
    s.delete_object(rel); print("deleted ok")
except Exception as e:
    print("EXC del", type(e).__name__)
