"""An uploaded ``.md`` file never becomes an object (audit 2026-10-28).

``POST /api/attachments?name=x.md`` used to write ``Attachments/x.md``, which the
space then reads as an object: unlisted as an attachment and refused by
``/api/file``. Such an upload is refused instead.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.media import MarkdownUpload, import_attachment
from objectapp.server import create_app
from objectapp.space import Space

OCTET = {"content-type": "application/octet-stream"}
NAMES = ["meeting notes.md", "NOTES.MD", "x.md.", "x.md ", "dir/x.md", "x.md. . "]


@pytest.mark.parametrize("name", NAMES)
def test_import_refuses_markdown(space_dir: Path, name: str):
    with pytest.raises(MarkdownUpload):
        import_attachment(space_dir, name, b"# Hello\n")
    folder = space_dir / "Attachments"
    assert not folder.exists() or not [p for p in folder.iterdir() if p.suffix.lower() == ".md"]


def test_upload_route_answers_415(space_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    client = TestClient(create_app(Space(space_dir), watch=False))
    res = client.post("/api/attachments", params={"name": "meeting notes.md"}, content=b"# Hi\n", headers=OCTET)
    assert res.status_code == 415
    assert not (space_dir / "Attachments" / "meeting notes.md").exists()
    # Other text files are still plain attachments.
    res = client.post("/api/attachments", params={"name": "notes.txt"}, content=b"hi", headers=OCTET)
    assert res.status_code == 201
