"""Shared harness for the back-end API audit scripts: an app over a fixture copy.

Usage from a sibling script::

    from harness import make_client
    client, root = make_client("space-m8")

Everything (the space copy, the state dir, the search cache) lives under the
scratchpad folder; the repo's fixtures are never touched.
"""

from __future__ import annotations

import os
import shutil
import sys
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "backend"))
SCRATCH = Path(
    "/tmp/claude-0/-home-user-Objects/925c9253-6d40-5f27-a712-45dc1ac4b9ca/scratchpad/backend-api"
)
FIXTURES = REPO / "backend" / "tests" / "fixtures"
BASE = "http://127.0.0.1:8790"


def fresh_dir(name: str) -> Path:
    d = SCRATCH / f"{name}-{uuid.uuid4().hex[:8]}"
    d.mkdir(parents=True, exist_ok=True)
    return d


def copy_space(fixture: str) -> Path:
    dest = fresh_dir("space") / fixture
    shutil.copytree(FIXTURES / fixture, dest)
    return dest


def make_client(fixture: str | Path = "space-sample", watch: bool = False, **env: str):
    """(TestClient, space root). Sets the state and cache dirs to scratch folders."""
    state = fresh_dir("state")
    os.environ["OBJECT_STATE_DIR"] = str(state)
    os.environ["OBJECT_CACHE_DIR"] = str(fresh_dir("cache"))
    for k, v in env.items():
        os.environ[k] = v
    from fastapi.testclient import TestClient
    from objectapp import server
    from objectapp.server import create_app
    from objectapp.space import Space

    server.allowed_hosts = server.LOOPBACK_HOSTS | {"testserver"}
    root = copy_space(fixture) if isinstance(fixture, str) else Path(fixture)
    app = create_app(Space(root), watch=watch)
    client = TestClient(app, base_url=BASE, raise_server_exceptions=False)
    client.__enter__()  # run the lifespan (search index, reminders)
    return client, root
