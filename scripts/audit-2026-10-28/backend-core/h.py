import shutil, tempfile, sys
from pathlib import Path
sys.path.insert(0, "/home/user/Objects/backend")
from objectapp.space import Space
def space(name="space-sample"):
    d = Path(tempfile.mkdtemp(dir="/tmp/claude-0/-home-user-Objects/9fe675a5-20db-54bd-960e-e71bfe759230/scratchpad/audit-backend-core"))/"s"
    shutil.copytree(f"/home/user/Objects/backend/tests/fixtures/{name}", d)
    return Space(d), d
