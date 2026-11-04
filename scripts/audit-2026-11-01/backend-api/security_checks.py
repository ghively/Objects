"""Security probes: Host/Origin gate, traversal and symlinks in file routes, upload names,
Content-Disposition, open_with_system refusals, image upload size.

Run: ``uv run python scripts/audit-2026-11-01/backend-api/security_checks.py``
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness import BASE, make_client  # noqa: E402

OCTET = {"content-type": "application/octet-stream"}


def main() -> None:
    fake_open = Path(os.environ.get("OBJECT_STATE_DIR", "/tmp")) / "fake-open.txt"
    client, root = make_client("space-sample", OBJECT_FAKE_OPEN_FILE=str(fake_open))
    print("space root:", root)

    print("\n== Host / Origin gate ==")
    for host in ["localhost.", "localhost:8790:1", "127.0.0.1 ", "127.0.0.1\t", "[::1]:80x", "127.1", "0.0.0.0", "127.0.0.2", "::1"]:
        r = client.get("/api/space", headers={"host": host})
        print(f"  Host={host!r:22} -> {r.status_code}")
    for origin, host in [("http://127.0.0.1:8790", "127.0.0.1:8790"), ("http://localhost:8790", "127.0.0.1:8790"),
                         ("HTTP://127.0.0.1:8790", "127.0.0.1:8790"), ("http://127.0.0.1:8790/", "127.0.0.1:8790"),
                         ("http://127.0.0.1", "127.0.0.1"), ("", "127.0.0.1:8790"), ("null", "127.0.0.1:8790"),
                         ("file://", "127.0.0.1:8790"), ("http://127.0.0.1:8790", "127.0.0.1:8790 ")]:
        r = client.post("/api/tags/ensure", json={"name": "probe"}, headers={"origin": origin, "host": host})
        print(f"  Origin={origin!r:26} Host={host!r:18} -> {r.status_code}")
    # Simple cross-site POST to a JSON route without Origin (non-browser client, or an old browser)
    r = client.post("/api/tags/ensure", content=b'{"name":"probe2"}', headers={"content-type": "text/plain"})
    print("  text/plain JSON POST without Origin ->", r.status_code)
    # A cross-origin GET never gets CORS headers
    r = client.get("/api/object", params={"path": "Pages/Alpha.md"}, headers={"origin": "https://evil.example"})
    print("  cross-origin GET CORS header present:", "access-control-allow-origin" in r.headers, r.status_code)
    r = client.options("/api/attachments", headers={"origin": "https://evil.example", "access-control-request-method": "POST"})
    print("  preflight OPTIONS ->", r.status_code, dict(r.headers).get("access-control-allow-origin"))

    print("\n== /api/file traversal and symlinks ==")
    outside = root.parent / "outside-secret.txt"
    outside.write_text("SECRET")
    (root / "Attachments" / "link.txt").symlink_to(outside)
    (root / "Attachments" / "linkdir").symlink_to(root.parent)
    (root / "Attachments" / "inner.txt").write_text("inner")
    (root / "Attachments" / "selflink.txt").symlink_to(root / "Attachments" / "inner.txt")
    for p in ["Attachments/link.txt", "Attachments/linkdir/outside-secret.txt", "Attachments/selflink.txt",
              "Attachments/../../outside-secret.txt", "Attachments/..%2F..%2Foutside-secret.txt",
              "/etc/passwd", "../outside-secret.txt", ".object/space.json", ".hidden/secret.md",
              "Attachments/cover.png/../cover.png", "Attachments//cover.png", "Attachments/./cover.png",
              "Attachments\\cover.png", "ATTACHMENTS/COVER.PNG", "Pages/Alpha.md", "Attachments/cover.png"]:
        r = client.get("/api/file", params={"path": p})
        print(f"  {p!r:50} -> {r.status_code} {dict(r.headers).get('content-disposition', '')[:60]} {r.text[:30] if r.status_code == 200 and 'SECRET' in r.text else ''}")
    # export through a symlinked .md
    (root / "Pages" / "evil.md").symlink_to(outside)
    for p in ["Pages/evil.md", "Pages/Alpha.md"]:
        r = client.get("/api/object/export", params={"path": p})
        print(f"  export {p!r:20} -> {r.status_code} {r.text[:20]!r}")
        r = client.get("/api/object", params={"path": p})
        print(f"  object {p!r:20} -> {r.status_code}")
    (root / "Pages" / "evil.md").unlink()
    # export zip with a cover image pointing outside
    r = client.put("/api/object/properties", json={"path": "Pages/Alpha.md", "updates": {"coverImage": "Attachments/link.txt"},
                                                    "baseVersion": client.get("/api/object", params={"path": "Pages/Alpha.md"}).json()["version"]})
    print("  set cover to symlink ->", r.status_code)
    r = client.get("/api/object/export", params={"path": "Pages/Alpha.md", "media": "1"})
    import io
    import zipfile
    names = zipfile.ZipFile(io.BytesIO(r.content)).namelist() if r.status_code == 200 else None
    print("  export zip names:", names)

    print("\n== attachment / image upload names ==")
    for name in [".htaccess", "..", "...", "con.txt", "CON", "a:b.txt", 'q"uote.txt', "nl\r\nx.txt", "x.tar.gz",
                 "x.MD", "x.markdown", "x.md.", "x.md ", " .md", "x.whiteboard.json", "x.ink.svg", "evil.exe",
                 "x.html", "x.svg", "é" * 130 + ".txt", "x." + "a" * 11, "x.", "nul.pdf", "x.PnG",
                 "Alpha.whiteboard.json", "..\\..\\x.txt", "../../x.txt", "%2e%2e%2fx.txt", "x.lnk", "x.desktop"]:
        r = client.post("/api/attachments", params={"name": name}, content=b"data", headers=OCTET)
        print(f"  attach {name!r:36} -> {r.status_code} {r.json()}")
    for name in ["x.svg", "..png", "x.PNG", "nl\r\n.png", "x.svgz", "a/b/../c.png"]:
        r = client.post("/api/images", params={"name": name}, content=b"data", headers=OCTET)
        print(f"  image  {name!r:36} -> {r.status_code} {r.json()}")
    # empty image body
    r = client.post("/api/images", params={"name": "empty.png"}, content=b"", headers=OCTET)
    print("  empty image ->", r.status_code, r.json())
    # image size limit?
    big = b"\0" * (101 * 1024 * 1024)
    r = client.post("/api/images", params={"name": "big.png"}, content=big, headers=OCTET)
    print("  101 MiB image ->", r.status_code, r.text[:80])
    r = client.post("/api/attachments", params={"name": "big.bin"}, content=big, headers=OCTET)
    print("  101 MiB attachment ->", r.status_code)
    del big

    print("\n== serving headers ==")
    for p in [a["path"] for a in client.get("/api/attachments").json()][:40]:
        r = client.get("/api/file", params={"path": p})
        h = dict(r.headers)
        print(f"  {p!r:40} {r.status_code} ct={h.get('content-type')} cd={h.get('content-disposition')} csp={h.get('content-security-policy', '')[:30]}")
    # Content-Disposition on export of a title with quotes / newline
    v = client.get("/api/object", params={"path": "Pages/Alpha.md"}).json()["version"]
    r = client.post("/api/object/rename", json={"path": "Pages/Alpha.md", "title": 'Al"pha\r\n; x=1 ü', "baseVersion": v})
    print("  rename ->", r.status_code, r.json().get("path"))
    if r.status_code == 200:
        r2 = client.get("/api/object/export", params={"path": r.json()["path"]})
        print("  export CD:", repr(r2.headers.get("content-disposition")))

    print("\n== open_with_system refusals ==")
    for ext in ["exe", "desktop", "pif", "scf", "py", "rb", "pl", "appimage", "run", "dmg", "pkg", "msc", "application", "inf", "ws", "sct", "pyw", "jar", "pdf"]:
        name = f"open-{ext}.{ext}"
        (root / "Attachments" / name).write_bytes(b"x")
        r = client.post("/api/attachments/open", json={"path": f"Attachments/{name}"})
        print(f"  open .{ext:12} -> {r.status_code}")
    print("  fake-open log:", fake_open.read_text().splitlines()[:3] if fake_open.exists() else None)

    print("\n== misc ==")
    r = client.post("/api/spaces/open", json={"path": "/"})
    print("  register / as a space ->", r.status_code, r.json())
    r = client.get("/api/spaces")
    print("  spaces:", [s["path"] for s in r.json()["spaces"]])
    r = client.post("/api/spaces/delete", json={"path": "/", "permanent": True})
    print("  delete / permanent ->", r.status_code, r.json())
    r = client.delete("/api/spaces", params={"path": "/"})
    print("  unregister / ->", r.status_code)
    client.__exit__(None, None, None)


if __name__ == "__main__":
    main()
