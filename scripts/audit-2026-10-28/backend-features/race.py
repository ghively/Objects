from h import *
import threading, sys
root = copy("space-sample")
(root/"Pages/Hub.md").write_text("---\ntype: 'Page'\ntitle: Hub\n---\n")
for i in range(3000):
    (root/f"Pages/S{i}.md").write_text(f"---\ntype: 'Page'\ntitle: S{i}\n---\n[[Hub]]\n")
sp = Space(root)
print(len(sp.backlinks("Pages/Hub.md")))
errs=[]; stop=False
def reader():
    while not stop:
        try:
            sp.links.backlinks("Pages/Hub.md"); sp.links._backlinks_cache.clear()
        except Exception as e:
            errs.append(repr(e)); return
def writer():
    for k in range(300):
        p = root/f"Pages/S{k}.md"
        p.write_text(f"---\ntype: 'Page'\ntitle: S{k}\n---\n" + ("[[Hub]]\n" if k%2 else "none\n"))
        sp.rescan_file(f"Pages/S{k}.md")
        sp.links.outgoing("Pages/S0.md")
ts=[threading.Thread(target=reader) for _ in range(3)]
for t in ts: t.start()
writer(); stop=True
for t in ts: t.join()
print("errors:", errs[:3])
