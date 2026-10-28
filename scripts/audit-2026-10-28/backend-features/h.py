import os, shutil, tempfile, sys
from pathlib import Path
T = Path(tempfile.mkdtemp())
os.environ["OBJECT_CACHE_DIR"]=str(T/"cache"); os.environ["OBJECT_STATE_DIR"]=str(T/"state")
FIX = Path("/home/user/Objects/backend/tests/fixtures")
def copy(name):
    d = T/name; shutil.copytree(FIX/name, d); return d
from objectapp import notify
notify._launch = lambda argv, env: None
from fastapi.testclient import TestClient
from objectapp.server import create_app
from objectapp.space import Space
def client(name="space-sample"):
    sp = Space(copy(name)); return sp, TestClient(create_app(sp, None, watch=False))
