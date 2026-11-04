"""Attachments of every kind: kinds, listing, serving with ranges, import and open (M7 Task 2)."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp import media
from objectapp.media import kind_of, list_attachments
from objectapp.server import create_app
from objectapp.space import Space

OCTET = {"content-type": "application/octet-stream"}


@pytest.fixture
def env(blocks_space_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    opened = tmp_path / "opened.txt"
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_FAKE_OPEN_FILE", str(opened))
    client = TestClient(create_app(Space(blocks_space_dir), watch=False))
    return blocks_space_dir, client, opened


def _hashes(root: Path) -> dict[str, str]:
    out = {}
    for p in sorted(root.rglob("*")):
        rel = p.relative_to(root).as_posix()
        if rel.startswith(".object-cache"):
            continue
        out[rel] = hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else "dir"
    return out


def test_kind_of_table():
    cases = {
        "a.png": "image", "a.JPG": "image", "a.jpeg": "image", "a.gif": "image",
        "a.webp": "image", "a.svg": "image",
        "a.pdf": "pdf", "A.PDF": "pdf",
        "a.mp3": "audio", "a.wav": "audio", "a.m4a": "audio", "a.ogg": "audio", "a.oga": "audio",
        "a.flac": "audio", "a.aac": "audio", "a.OPUS": "audio",
        "a.mp4": "video", "a.webm": "video", "a.MOV": "video", "a.m4v": "video", "a.ogv": "video",
        "a.xlsx": "file", "a.html": "file", "a.exe": "file", "README": "file", "": "file",
        "dir.d/noext": "file",
    }
    for name, kind in cases.items():
        assert kind_of(name) == kind, name


def test_list_attachments_kinds_and_sizes(env):
    root, client, _ = env
    listed = client.get("/api/attachments").json()
    assert listed == list_attachments(root)
    by_path = {a["path"]: a for a in listed}
    assert by_path["Attachments/pixel.png"]["kind"] == "image"
    assert by_path["Attachments/report.pdf"]["kind"] == "pdf"
    assert by_path["Attachments/clip.wav"]["kind"] == "audio"
    assert by_path["Attachments/clip.mp4"]["kind"] == "video"
    assert by_path["Attachments/data.xlsx"]["kind"] == "file"
    assert by_path["Attachments/tool.exe"]["kind"] == "file"
    for a in listed:
        assert a["size"] == (root / a["path"]).stat().st_size
    assert [a["path"] for a in listed] == sorted(by_path)
    assert not any(p.endswith(".md") for p in by_path)


def test_listing_outside_attachments_only_non_file_kinds(env):
    root, client, _ = env
    (root / "Pages" / "scan.pdf").write_bytes(b"%PDF-1.4\n")
    (root / "Pages" / "notes.txt").write_bytes(b"plain")
    (root / ".object" / "hidden.png").write_bytes(b"x")
    paths = [a["path"] for a in client.get("/api/attachments").json()]
    assert "Pages/scan.pdf" in paths
    assert "Pages/notes.txt" not in paths
    assert ".object/hidden.png" not in paths


def test_file_route_serves_each_kind_with_headers(env):
    root, client, _ = env
    png = client.get("/api/file", params={"path": "Attachments/pixel.png"})
    assert png.status_code == 200
    assert png.headers["content-type"] == "image/png"
    assert "sandbox" in png.headers["content-security-policy"]
    assert png.headers["x-content-type-options"] == "nosniff"
    assert png.content == (root / "Attachments/pixel.png").read_bytes()

    pdf = client.get("/api/file", params={"path": "Attachments/report.pdf"})
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.headers["content-disposition"].startswith("inline")
    assert "content-security-policy" not in pdf.headers
    assert pdf.headers["x-content-type-options"] == "nosniff"

    wav = client.get("/api/file", params={"path": "Attachments/clip.wav"})
    assert wav.status_code == 200
    assert wav.headers["content-type"] in ("audio/wav", "audio/x-wav")
    assert wav.headers["accept-ranges"] == "bytes"
    assert wav.headers["content-disposition"].startswith("inline")
    assert wav.headers["x-content-type-options"] == "nosniff"

    mp4 = client.get("/api/file", params={"path": "Attachments/clip.mp4"})
    assert mp4.status_code == 200
    assert mp4.headers["content-type"] == "video/mp4"

    xlsx = client.get("/api/file", params={"path": "Attachments/data.xlsx"})
    assert xlsx.status_code == 200
    assert xlsx.headers["content-type"] == "application/octet-stream"
    assert xlsx.headers["content-disposition"] == "attachment; filename*=UTF-8''data.xlsx"
    assert xlsx.headers["x-content-type-options"] == "nosniff"


def test_range_request_206(env):
    root, client, _ = env
    data = (root / "Attachments/clip.wav").read_bytes()
    res = client.get(
        "/api/file", params={"path": "Attachments/clip.wav"}, headers={"Range": "bytes=0-9"}
    )
    assert res.status_code == 206
    assert res.content == data[:10]
    assert res.headers["content-range"] == f"bytes 0-9/{len(data)}"


def test_html_attachment_served_as_download(env):
    _root, client, _ = env
    res = client.get("/api/file", params={"path": "Attachments/page.html"})
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/octet-stream"
    assert res.headers["content-disposition"].startswith("attachment")
    assert res.headers["x-content-type-options"] == "nosniff"


def test_svg_keeps_sandbox_csp(env):
    """Regression guard (green from the start)."""
    _root, client, _ = env
    res = client.get("/api/file", params={"path": "Attachments/notes.svg"})
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("image/svg+xml")
    assert "sandbox" in res.headers["content-security-policy"]
    assert "default-src 'none'" in res.headers["content-security-policy"]


def test_file_route_rejects_traversal_and_dot_folders(env):
    root, client, _ = env
    (root.parent / "x").write_bytes(b"outside")
    for path in (
        "../x", "/etc/passwd", "C:/x", "C:\\x", ".object/types/page.json",
        "Attachments/../../x", "", "Attachments/missing.png",
    ):
        res = client.get("/api/file", params={"path": path})
        assert res.status_code == 404, path


def test_upload_creates_attachment_and_never_overwrites(env):
    root, client, _ = env
    # The fixture already has report.pdf, so two "Report.PDF" uploads would start at (2);
    # "Summary.PDF" shows the plain case, then "REPORT.pdf" the case-insensitive check.
    first = client.post("/api/attachments", params={"name": "Summary.PDF"}, content=b"%PDF-one", headers=OCTET)
    assert first.status_code == 201
    assert first.json() == {"path": "Attachments/Summary.pdf", "kind": "pdf"}
    second = client.post("/api/attachments", params={"name": "Summary.PDF"}, content=b"%PDF-two", headers=OCTET)
    assert second.status_code == 201
    assert second.json() == {"path": "Attachments/Summary (2).pdf", "kind": "pdf"}
    assert (root / "Attachments/Summary.pdf").read_bytes() == b"%PDF-one"
    assert (root / "Attachments/Summary (2).pdf").read_bytes() == b"%PDF-two"
    original = (root / "Attachments/report.pdf").read_bytes()
    third = client.post("/api/attachments", params={"name": "REPORT.pdf"}, content=b"%PDF-new", headers=OCTET)
    assert third.json() == {"path": "Attachments/REPORT (2).pdf", "kind": "pdf"}
    assert (root / "Attachments/report.pdf").read_bytes() == original


def test_upload_name_sanitised(env):
    root, client, _ = env
    res = client.post("/api/attachments", params={"name": "../../evil.sh"}, content=b"echo", headers=OCTET)
    assert res.status_code == 201
    assert res.json() == {"path": "Attachments/evil.sh", "kind": "file"}
    assert not (root.parent / "evil.sh").exists()
    con = client.post("/api/attachments", params={"name": "con.txt"}, content=b"x", headers=OCTET)
    assert con.json()["path"] == "Attachments/con_.txt"
    bad = client.post("/api/attachments", params={"name": "a<b>c.mp3"}, content=b"x", headers=OCTET)
    assert bad.json() == {"path": "Attachments/a.mp3", "kind": "audio"}
    odd_ext = client.post("/api/attachments", params={"name": "weird.ext with space"}, content=b"x", headers=OCTET)
    assert odd_ext.json()["path"] == "Attachments/weird.ext with space"
    long_ext = client.post("/api/attachments", params={"name": "x.abcdefghijk"}, content=b"x", headers=OCTET)
    assert long_ext.json()["path"] == "Attachments/x.abcdefghijk"
    assert client.post("/api/attachments", params={"name": ""}, content=b"x", headers=OCTET).status_code == 422
    assert client.post("/api/attachments", params={"name": "a.png"}, content=b"", headers=OCTET).status_code == 422


def test_upload_over_limit_413(env, monkeypatch: pytest.MonkeyPatch):
    root, client, _ = env
    monkeypatch.setattr(media, "MAX_ATTACHMENT_BYTES", 8)
    res = client.post("/api/attachments", params={"name": "big.bin"}, content=b"123456789", headers=OCTET)
    assert res.status_code == 413
    assert "100 MiB" in res.json()["detail"]
    assert not (root / "Attachments/big.bin").exists()
    ok = client.post("/api/attachments", params={"name": "small.bin"}, content=b"12345678", headers=OCTET)
    assert ok.status_code == 201


def test_open_uses_os_and_refuses_executables(env):
    root, client, opened = env
    res = client.post("/api/attachments/open", json={"path": "Attachments/report.pdf"})
    assert res.status_code == 200
    assert res.json() == {"ok": True}
    assert opened.read_text(encoding="utf-8").splitlines() == [
        str((root / "Attachments/report.pdf").resolve())
    ]
    exe = client.post("/api/attachments/open", json={"path": "Attachments/tool.exe"})
    assert exe.status_code == 415
    assert exe.json()["detail"] == (
        "Object only opens documents, images, audio, video, PDFs and archives. "
        "Open it from the file manager instead."
    )
    outside = client.post("/api/attachments/open", json={"path": "../outside.pdf"})
    assert outside.status_code == 404
    assert len(opened.read_text(encoding="utf-8").splitlines()) == 1


# Audit 2026-11-01 #5 (Gene: whitelist): only documents, images, audio, video, PDFs and
# archives are handed to the OS; everything the OS might run is refused. An SVG is viewed
# in the app (`/api/file`, sandboxed), never opened outside: most desktops hand it to a
# browser, where its scripts run under file:// (fix pass).
RUNNABLE = ["exe", "pif", "scf", "msc", "inf", "ws", "wsc", "sct", "application", "gadget", "py",
            "pyw", "pyz", "desktop", "appimage", "run", "bin", "iso", "dmg", "pkg", "sh", "js",
            "jar", "lnk", "url", "bat", "cmd", "ps1", "rb", "pl", "html", "htm", "svg", "svgz",
            "SVG", ""]
OPENABLE = ["pdf", "png", "jpg", "mp3", "wav", "mp4", "mov", "docx", "xlsx", "pptx", "odt",
            "txt", "csv", "epub", "zip", "7z", "tar", "gz", "DOCX", "Zip"]


def test_open_whitelists_documents_media_and_archives(env):
    root, client, opened = env
    for ext in RUNNABLE:
        name = f"open-{ext or 'noext'}" + (f".{ext}" if ext else "")
        (root / "Attachments" / name).write_bytes(b"x")
        res = client.post("/api/attachments/open", json={"path": f"Attachments/{name}"})
        assert res.status_code == 415, (ext, res.text)
        assert "documents, images, audio, video, PDFs and archives" in res.json()["detail"]
    assert not opened.exists()
    for ext in OPENABLE:
        name = f"open-{ext}.{ext}"
        (root / "Attachments" / name).write_bytes(b"x")
        res = client.post("/api/attachments/open", json={"path": f"Attachments/{name}"})
        assert res.status_code == 200, (ext, res.text)
    assert len(opened.read_text(encoding="utf-8").splitlines()) == len(OPENABLE)


# Audit 2026-11-01 B7: listings prune dot-folders before reading them and classify files by
# a cheap extension lookup; the results are what the rglob walk produced.


def test_listings_never_read_dot_folders(env, monkeypatch):
    from objectapp import media

    root, client, _ = env
    git = root / ".git" / "objects" / "ab"
    git.mkdir(parents=True)
    for i in range(50):
        (git / f"blob{i}.png").write_bytes(b"x")
    (root / ".trash").mkdir(exist_ok=True)
    (root / ".trash" / "old.pdf").write_bytes(b"x")
    (root / "Attachments" / ".hidden.png").write_bytes(b"x")
    opened: list[str] = []
    real = os.scandir

    def spy(path=".", *a, **k):
        opened.append(str(path))
        return real(path, *a, **k)

    monkeypatch.setattr(media.os, "scandir", spy)
    attachments = [a["path"] for a in media.list_attachments(root)]
    images = [i["path"] for i in media.list_images(root)]
    assert not any("/.git" in p or "/.trash" in p for p in opened), opened
    assert all(not p.startswith(".") and "/." not in p for p in attachments + images)
    assert "Attachments/.hidden.png" not in images
    assert "Attachments/pixel.png" in images and "Attachments/report.pdf" in attachments
    assert client.get("/api/attachments").json() == media.list_attachments(root)


def test_listings_match_the_rglob_walk(env):
    from objectapp import media

    root, _client, _ = env
    (root / "Loose").mkdir()
    (root / "Loose" / "deck.pptx").write_bytes(b"x")  # a `file` outside Attachments: not listed
    (root / "Loose" / "clip.MP4").write_bytes(b"x")  # media anywhere is listed
    (root / "Loose" / "note.md").write_bytes(b"---\ntitle: n\n---\n")
    (root / "Attachments" / "odd.").write_bytes(b"x")
    (root / "Attachments" / "no_ext").write_bytes(b"x")
    expected = []
    for p in root.rglob("*"):
        rel = p.relative_to(root)
        if any(part.startswith(".") for part in rel.parts) or not p.is_file():
            continue
        kind = media.kind_of(p.name)
        if (kind == "file" and rel.parts[0] != "Attachments") or p.suffix.lower() == ".md":
            continue
        expected.append({"path": rel.as_posix(), "kind": kind, "size": p.stat().st_size})
    expected.sort(key=lambda a: a["path"])
    assert media.list_attachments(root) == expected
    assert [i["path"] for i in media.list_images(root)] == sorted(
        a["path"] for a in expected if a["kind"] == "image"
    )


@pytest.mark.parametrize(
    "name",
    ["x.", "x..", ".hidden", ".hidden.png", "a.b.PNG", "noext", "dir/x.", "dir.d/x", "a\\b.png", "",
     "x.png/", "a/.png", "..png", "x.tar.gz", "Attachments/report.PDF", " .png", "x. ", "clip.weba"],
)
def test_ext_matches_pure_posix_path_suffix(name):
    from pathlib import PurePosixPath

    from objectapp import media

    assert media._ext(name) == PurePosixPath(name).suffix.lower()
    assert media.kind_of(name) in ("image", "pdf", "audio", "video", "file")


def test_listing_and_serving_write_nothing(env):
    root, client, opened = env
    before = _hashes(root)
    client.get("/api/attachments")
    for path in ("Attachments/pixel.png", "Attachments/report.pdf", "Attachments/clip.wav",
                 "Attachments/data.xlsx", "Pages/Every block.md", "../x"):
        client.get("/api/file", params={"path": path})
    client.get("/api/file", params={"path": "Attachments/clip.wav"}, headers={"Range": "bytes=0-3"})
    assert _hashes(root) == before
    assert not opened.exists()


def test_md_and_whiteboard_sidecars_not_served(env):
    root, client, _ = env
    assert client.get("/api/file", params={"path": "Pages/Every block.md"}).status_code == 415
    board = root / "Pages" / "Board.md"
    board.write_text("---\ntype: Whiteboard\ntitle: Board\n---\n", encoding="utf-8")
    (root / "Pages" / "Board.whiteboard.json").write_text(json.dumps({"version": 1}))
    (root / "Pages" / "Board.ink.svg").write_text("<svg xmlns='http://www.w3.org/2000/svg'/>")
    # An orphan .ink.svg (no .md beside it) is an ordinary image.
    (root / "Attachments" / "Loose.ink.svg").write_text("<svg xmlns='http://www.w3.org/2000/svg'/>")
    for sidecar in ("Pages/Board.whiteboard.json", "Pages/Board.ink.svg"):
        assert client.get("/api/file", params={"path": sidecar}).status_code == 404, sidecar
        res = client.post("/api/attachments/open", json={"path": sidecar})
        assert res.status_code == 404, sidecar
    paths = [a["path"] for a in client.get("/api/attachments").json()]
    assert "Pages/Board.whiteboard.json" not in paths
    assert "Pages/Board.ink.svg" not in paths
    assert "Attachments/Loose.ink.svg" in paths
    assert client.get("/api/file", params={"path": "Attachments/Loose.ink.svg"}).status_code == 200
    md_open = client.post("/api/attachments/open", json={"path": "Pages/Every block.md"})
    assert md_open.status_code == 415
