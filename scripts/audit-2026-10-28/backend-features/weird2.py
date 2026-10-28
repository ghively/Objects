import re, traceback
src = open("/tmp/claude-0/-home-user-Objects/9fe675a5-20db-54bd-960e-e71bfe759230/scratchpad/audit-backend-features/weird.py").read()
fms_src = src[src.index("fms = ["):src.index("]\nfor i, fm")+1]
exec("from h import *\n")
from h import *
ns={}; exec(fms_src, ns); fms=ns["fms"]
from datetime import datetime, UTC
for i, fm in enumerate(fms):
    root = copy("space-m8") if False else None
    import shutil, tempfile
    d = Path(tempfile.mkdtemp())/"s"; shutil.copytree(FIX/"space-m8", d)
    (d/f"Tasks/W{i}.md").write_text("---\n"+fm+"---\nbody\n")
    sp = Space(d); sp.clock = lambda: datetime(2026,10,28,12,tzinfo=UTC)
    try:
        sp.calendar("2026-09-01","2026-12-01")
    except Exception as e:
        tb = traceback.extract_tb(e.__traceback__)[-3:]
        print(i, repr(fm[:60]), type(e).__name__, e, [(f.filename.split('/')[-1], f.lineno) for f in tb])
