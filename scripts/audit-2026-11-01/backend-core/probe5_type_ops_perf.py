"""Audit probe 5: cost of type-level rewrites and a type restore on the 5000-object space."""
from __future__ import annotations
import copy, shutil, sys, time
from pathlib import Path
HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[3] / "backend")); sys.path.insert(0, str(HERE.parents[3] / "backend/tests"))
from bigspace import make_big_space
from objectapp.space import Space
root = Path("/tmp/claude-0/-home-user-Objects/925c9253-6d40-5f27-a712-45dc1ac4b9ca/scratchpad/core/p5big")
if root.exists(): shutil.rmtree(root)
make_big_space(root)
sp = Space(root)
t, rev = sp.refresh_type("project")
members = len(sp._type_members("project"))
new = copy.deepcopy(t); new.name = "Venture"
t0 = time.perf_counter()
res = sp.save_type(new, rev, confirm=True)
dt = time.perf_counter() - t0
print(f"INFO rename type Project->Venture over {members} members: {dt:.1f}s ({dt/max(members,1)*1000:.0f} ms/file), rewritten={len(res.rewritten)} skipped={len(res.skipped)}")
# plan-only cost (ConfirmRequired path): delete a property without confirm
t, rev = sp.refresh_type("project")
new = copy.deepcopy(t); new.propertyDefinitions = [p for p in new.propertyDefinitions if p.key != "summary"]
t0 = time.perf_counter()
try:
    sp.save_type(new, rev, confirm=False)
except Exception as exc:
    print(f"INFO plan-only (ConfirmRequired) for deleting a property over {len(sp._type_members('project'))} members: {time.perf_counter()-t0:.2f}s -> {type(exc).__name__}")
# type trash + restore
t = sp.type_by_id("person"); paths = sp._type_members("person", templates=False)
t0 = time.perf_counter(); item = sp.trash_type(t, paths); print(f"INFO trash_type with {len(paths)} objects: {time.perf_counter()-t0:.1f}s")
t0 = time.perf_counter(); sp.restore(item.id); print(f"INFO restore type with {len(paths)} objects: {time.perf_counter()-t0:.1f}s")
