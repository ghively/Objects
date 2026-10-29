"""M9 Task 3: export an object (``GET /api/object/export?path=&media=0|1``).

Capacities' "Export" with the Markdown format and the "Include media" option ("Adds files
and images to the zip."). ``media=0`` downloads the ``.md`` exactly as on disk; ``media=1``
a zip of ``<stem>.md`` plus the images and attachments it references, at their
space-relative paths. Exporting writes nothing.
"""

from __future__ import annotations

import hashlib
import io
import os
import zipfile
from pathlib import Path
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient
from objectapp.server import create_app
from objectapp.space import Space

PAGE = "Pages/Export me.md"
PAGE_BYTES = (
    b"\xef\xbb\xbf---\r\ntype: 'Page'\r\ntitle: Export me\r\n"
    b"coverImage: Attachments/notes.svg\r\n---\r\n"
    b"# Export me\r\n\r\n"
    b"![pixel](Attachments/pixel.png)\r\n\r\n"
    b"![[Attachments/report.pdf]]\r\n\r\n"
    b'See [the sheet](Attachments/data.xlsx "Sheet") and ![spaced](Attachments/my%20file.png).\r\n\r\n'
    b"![gone](Attachments/missing.png) ![[Attachments/also missing.pdf]]\r\n\r\n"
    b"![outside](../secret.png) ![abs](/etc/hosts) ![dot](.capacities/space.json)\r\n\r\n"
    b"![web](https://example.org/a.png) [[Alpha]]\r\n\r\n"
    b"```\r\n![in code](Attachments/clip.wav)\r\n```\r\n"
)


@pytest.fixture
def space_root(blocks_space_dir: Path) -> Path:
    (blocks_space_dir / "Pages" / "Export me.md").write_bytes(PAGE_BYTES)
    (blocks_space_dir / "Attachments" / "my file.png").write_bytes(b"\x89PNG spaced")
    (blocks_space_dir.parent / "secret.png").write_bytes(b"outside the space")
    return blocks_space_dir


def _client(root: Path) -> TestClient:
    app = create_app(Space(root), None, watch=False)
    app.state.hub.publish = lambda _e: None
    return TestClient(app)


def _tree(root: Path) -> dict[str, str]:
    return {
        p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def _export(c: TestClient, path: str, media: int):
    return c.get("/api/object/export", params={"path": path, "media": str(media)})


def test_export_md_bytes_identical(space_root: Path):
    c = _client(space_root)
    with c:
        r = _export(c, PAGE, 0)
    assert r.status_code == 200, r.text
    assert r.content == PAGE_BYTES
    assert r.headers["content-type"] == "text/markdown; charset=utf-8"


def test_export_zip_holds_md_and_media(space_root: Path):
    c = _client(space_root)
    with c:
        r = _export(c, PAGE, 1)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        names = zf.namelist()
        assert names[0] == "Export me.md"
        assert sorted(names) == sorted(
            [
                "Export me.md",
                "Attachments/notes.svg",
                "Attachments/pixel.png",
                "Attachments/report.pdf",
                "Attachments/data.xlsx",
                "Attachments/my file.png",
            ]
        )
        assert zf.read("Export me.md") == PAGE_BYTES
        for name in names[1:]:
            assert zf.read(name) == (space_root / name).read_bytes()


def test_export_skips_missing_and_outside_paths(space_root: Path):
    c = _client(space_root)
    with c:
        names = zipfile.ZipFile(io.BytesIO(_export(c, PAGE, 1).content)).namelist()
    assert not any("missing" in n for n in names)
    assert not any("secret" in n or "hosts" in n or ".capacities" in n for n in names)
    assert "Attachments/clip.wav" not in names  # only referenced inside a code block
    assert not any(n.endswith("Alpha.md") for n in names)  # objects aren't media
    assert all(not n.startswith(("/", "..")) for n in names)


def test_export_writes_nothing(space_root: Path):
    state = Path(os.environ["OBJECT_STATE_DIR"])
    c = _client(space_root)
    with c:
        before, state_before = _tree(space_root), _tree(state)
        assert _export(c, PAGE, 0).status_code == 200
        assert _export(c, PAGE, 1).status_code == 200
        assert _export(c, "Pages/Every block.md", 1).status_code == 200
        assert _tree(space_root) == before
        assert _tree(state) == state_before


def test_export_errors(space_root: Path):
    c = _client(space_root)
    with c:
        assert _export(c, "Pages/Nope.md", 0).status_code == 404
        assert _export(c, "../outside.md", 1).status_code == 400
        assert _export(c, "Attachments/pixel.png", 0).status_code == 400


def test_export_content_disposition_names(space_root: Path):
    (space_root / "Pages" / "Café notes.md").write_bytes(b"# Caf\xc3\xa9 notes\n")
    c = _client(space_root)
    with c:
        md = _export(c, PAGE, 0)
        zipped = _export(c, PAGE, 1)
        uni = _export(c, "Pages/Café notes.md", 0)
        uni_zip = _export(c, "Pages/Café notes.md", 1)
    assert md.headers["content-disposition"] == 'attachment; filename="Export me.md"'
    assert zipped.headers["content-disposition"] == 'attachment; filename="Export me.zip"'
    assert uni.headers["content-disposition"] == (
        f"attachment; filename=\"Caf_ notes.md\"; filename*=UTF-8''{quote('Café notes.md')}"
    )
    assert uni_zip.headers["content-disposition"].endswith(
        f"filename*=UTF-8''{quote('Café notes.zip')}"
    )
    assert zipfile.ZipFile(io.BytesIO(uni_zip.content)).namelist() == ["Café notes.md"]


def test_export_includes_short_name_embeds(space_root: Path):
    # Obsidian's short form, as the editor resolves it (`findAttachment`): exact path, then
    # the path ignoring case, then (a bare name) the attachment with that file name.
    (space_root / "Attachments" / "photo.png").write_bytes(b"\x89PNG short")
    (space_root / "Attachments" / "Diagram.PNG").write_bytes(b"\x89PNG case")
    (space_root / "Pages" / "Short.md").write_bytes(
        b"---\ntype: Page\ntitle: Short\n---\n# Short\n\n"
        b"![[photo.png]]\n\n![x](attachments/diagram.png)\n\n![[nowhere.png]]\n\n"
        b"![[secret.png]]\n"
    )
    c = _client(space_root)
    with c:
        r = _export(c, "Pages/Short.md", 1)
    assert r.status_code == 200, r.text
    names = zipfile.ZipFile(io.BytesIO(r.content)).namelist()
    assert sorted(names) == ["Attachments/Diagram.PNG", "Attachments/photo.png", "Short.md"]
