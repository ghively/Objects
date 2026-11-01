"""Audit probe 6: HTTP outcome of a deeply nested frontmatter file and a merge-key file."""
import sys, shutil
from pathlib import Path
HERE = Path(__file__).resolve(); sys.path.insert(0, str(HERE.parents[3] / "backend"))
from fastapi.testclient import TestClient
from objectapp import server as _server
_server.allowed_hosts = _server.LOOPBACK_HOSTS | {"testserver"}
src = HERE.parents[3] / "backend/tests/fixtures/space-sample"
root = Path("/tmp/claude-0/-home-user-Objects/925c9253-6d40-5f27-a712-45dc1ac4b9ca/scratchpad/core/p6")
if root.exists(): shutil.rmtree(root)
shutil.copytree(src, root)
(root / "Pages/merge.md").write_text("---\nbase: &b\n  x: 1\n<<: *b\ntitle: Merge\n---\nbody\n", encoding="utf-8")
from objectapp.space import Space
app = _server.create_app(Space(root), watch=False)
c = TestClient(app, raise_server_exceptions=False)
r = c.get("/api/object", params={"path": "Pages/merge.md"}); print("GET merge-key file ->", r.status_code); v = r.json().get("version")
r = c.put("/api/object/body", json={"path": "Pages/merge.md", "body": "new\n", "baseVersion": v})
print("PUT body on merge-key file ->", r.status_code, r.text[:120])
(root / "Pages/deep.md").write_bytes(b"---\na: " + b"[" * 600 + b"]" * 600 + b"\n---\n")
r = c.get("/api/object", params={"path": "Pages/deep.md"})
print("GET deep-nesting object ->", r.status_code, r.text[:120])
r = c.get("/api/objects"); print("GET objects list still works ->", r.status_code)
