"""AC-2 (decisions memo 2026-11-08): an imported image becomes an Image object (media type Image:
mimeType, fileSize, source, width, height; the body holds the image), not a Page holding the image.
An image an earlier import made into a Page stays that Page (matched by (system, id), never duplicated
or migrated); the report says it was kept as a Page.
"""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient
from m15_helpers import wait_job
from PIL import Image

from objectapp.frontmatter import parse_fm
from objectapp.objfile import split_object
from objectapp.server import create_app
from objectapp.space import Space


@pytest.fixture
def client(space_dir):
    app = create_app(Space(space_dir), watch=False)
    with TestClient(app) as c:
        c.space_root = space_dir  # type: ignore[attr-defined]
        yield c


def png(w: int, h: int, colour: int = 120) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (colour, 30, 30)).save(buf, format="PNG")
    return buf.getvalue()


def preview(client, src) -> dict:
    r = client.post("/api/import/preview", json={"source": {"path": str(src), "kind": "files"}, "target": "currentSpace"})
    assert r.status_code == 200, r.text
    return r.json()


def run(client, src, **extra) -> dict:
    p = preview(client, src)
    r = client.post("/api/import/start", json={"previewId": p["previewId"], "mapping": p["mapping"],
                                               "target": {"kind": "currentSpace"}, **extra})
    assert r.status_code == 202, r.text
    job = wait_job(client, r.json()["jobId"], timeout=60)
    assert job["phase"] == "done", job
    return job["result"]


def fm_and_body(root, rel) -> tuple[dict, str]:
    of = split_object((root / rel).read_text(encoding="utf-8"))
    return parse_fm(of.frontmatter_src or ""), of.body


def objects_from(client, name: str) -> list[dict]:
    out = []
    for o in client.get("/api/objects").json():
        try:
            fm, _ = fm_and_body(client.space_root, o["path"])
        except Exception:  # noqa: BLE001 - a fixture file with broken frontmatter
            continue
        blk = fm.get("importSource")
        if isinstance(blk, dict) and str(blk.get("id", "")).split("#")[0] == name:
            out.append(o)
    return out


def library(tmp_path, data: bytes | None = None):
    src = tmp_path / "Library"
    src.mkdir(exist_ok=True)
    (src / "photo.png").write_bytes(data if data is not None else png(40, 30))
    (src / "notes.txt").write_text("plain text note\n", encoding="utf-8")
    return src


def test_imported_image_is_an_image_object(client, tmp_path):
    src = library(tmp_path)
    data = (src / "photo.png").read_bytes()
    p = preview(client, src)
    assert any(s["sourcePath"] == "photo.png" and s["path"] == "Images/photo.md" for s in p["samples"]), p["samples"]
    res = run(client, src)
    root = client.space_root
    objs = objects_from(client, "photo.png")
    assert len(objs) == 1, objs
    o = objs[0]
    assert o["type"] == "image" and o["path"] == "Images/photo.md"
    assert not (root / "Pages" / "photo.md").exists()
    fm, body = fm_and_body(root, o["path"])
    assert fm["type"] == "Image" and fm["title"] == "photo"
    assert fm["mimeType"] == "image/png" and fm["fileSize"] == len(data)
    assert fm["width"] == 40 and fm["height"] == 30
    assert fm["source"] == "Attachments/Originals/photo.png"
    assert (root / fm["source"]).read_bytes() == data
    assert fm["importSource"]["id"] == "photo.png" and fm["importSource"]["original"] == fm["source"]
    assert "![](Attachments/Originals/photo.png)" in body
    report = (root / res["reportPath"]).read_text(encoding="utf-8")
    assert "Original only" not in report
    assert "- 1 image became an Image object." in report
    # Other files are still pages.
    assert [o["type"] for o in objects_from(client, "notes.txt")] == ["page"]


def test_image_rerun_is_unchanged(client, tmp_path):
    src = library(tmp_path)
    run(client, src)
    second = run(client, src)
    assert second["objects"] == 0 and second["unchanged"] == 2, second
    assert len(objects_from(client, "photo.png")) == 1
    assert not (client.space_root / "Images" / "photo (2).md").exists()


def test_image_imported_as_page_before_is_kept_as_page(client, tmp_path, monkeypatch):
    from objectapp.importers import planner

    src = library(tmp_path)
    with monkeypatch.context() as m:  # an import made before images became Image objects
        m.setattr(planner, "_imports_as_image", lambda *_a: False)
        run(client, src)
    root = client.space_root
    assert fm_and_body(root, "Pages/photo.md")[0]["type"] == "Page"
    second = run(client, src)
    assert second["objects"] == 0 and second["unchanged"] == 2, second
    assert [o["path"] for o in objects_from(client, "photo.png")] == ["Pages/photo.md"]
    report = (root / second["reportPath"]).read_text(encoding="utf-8")
    assert "Kept as a Page: an earlier import made it before images became Image objects" in report
    # The image changes at the source: the Page is updated in place, still a Page, never duplicated.
    (src / "photo.png").write_bytes(png(50, 20, colour=200))
    third = run(client, src)
    assert third["updated"] == 1 and third["objects"] == 0, third
    assert [o["path"] for o in objects_from(client, "photo.png")] == ["Pages/photo.md"]
    assert fm_and_body(root, "Pages/photo.md")[0]["type"] == "Page"
    assert not (root / "Images" / "photo.md").exists()
    report = (root / third["reportPath"]).read_text(encoding="utf-8")
    assert "Kept as a Page" in report


def test_file_objects_mode_makes_one_image_object(client, tmp_path):
    """"Keep originals as File objects": the image already is its media object; no second one."""
    src = library(tmp_path)
    res = run(client, src, keepOriginals="fileObjects")
    objs = objects_from(client, "photo.png")
    assert [o["type"] for o in objs] == ["image"], objs
    fm, body = fm_and_body(client.space_root, objs[0]["path"])
    assert "Original: [[" not in body
    # notes.txt is read directly (no original kept), so no File object either: only the two objects.
    assert res["objects"] == 2, res


def test_image_in_a_mapped_type_follows_the_mapping(client, tmp_path):
    """Only the default (Page) becomes Image: images a mapping puts in a folder type stay in that type."""
    src = tmp_path / "Library"
    (src / "Shots").mkdir(parents=True)
    (src / "Shots" / "photo.png").write_bytes(png(10, 10))
    (src / "Shots" / "readme.txt").write_text("x\n", encoding="utf-8")
    mapping = {"typeSource": "folder"}
    r = client.post("/api/import/preview", json={"source": {"path": str(src), "kind": "files"}, "target": "currentSpace",
                                                 "mapping": mapping})
    assert r.status_code == 200, r.text
    p = r.json()
    r = client.post("/api/import/start", json={"previewId": p["previewId"], "mapping": p["mapping"], "target": {"kind": "currentSpace"}})
    assert r.status_code == 202, r.text
    assert wait_job(client, r.json()["jobId"], timeout=60)["phase"] == "done"
    objs = objects_from(client, "Shots/photo.png")
    assert len(objs) == 1 and objs[0]["type"] != "image", objs
