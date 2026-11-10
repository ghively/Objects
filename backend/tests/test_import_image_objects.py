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
    r = client.post("/api/import/preview", json={"source": {"path": str(src), "kind": "files"}, "target": "currentSpace", "keepAsSources": False})
    assert r.status_code == 200, r.text
    return r.json()


def run(client, src, **extra) -> dict:
    p = preview(client, src)
    r = client.post("/api/import/start", json={"previewId": p["previewId"], "mapping": p["mapping"],
                                               "target": {"kind": "currentSpace"}, "keepAsSources": False, **extra})
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
    # The basic media type Image: its media fields are system fields, not loose frontmatter.
    t = next(t for t in client.get("/api/space").json()["types"] if t["id"] == "image")
    assert t["basic"] is True and t["folder"] == "Images"
    props = {p["key"]: p for p in t["propertyDefinitions"]}
    for key, kind in (("mimeType", "text"), ("fileSize", "number"), ("width", "number"), ("height", "number"), ("source", "text")):
        assert props[key]["type"] == kind and props[key]["id"] == key, props.get(key)
    assert "content" not in props
    report = (root / res["reportPath"]).read_text(encoding="utf-8")
    assert "Original only" not in report
    assert "- 1 image became an Image object." in report
    # Other files are still pages.
    assert [o["type"] for o in objects_from(client, "notes.txt")] == ["page"]


def test_preview_counts_images_under_image(client, tmp_path):
    """Fix pass 2026-11-09: the preview applies the writer's rule (AC-2). An image the Page row
    would take is counted and listed under an Image row, not under Page, so the preview's numbers
    are the import's: the Page row's count leaves the images out, the Image row (the basic media
    type, no properties of its own) has them, the samples name it, and the types count includes
    it. Into this space the row names the space's Image type once it has one."""
    src = library(tmp_path)  # photo.png and notes.txt
    p = preview(client, src)
    rows = {t["key"]: t for t in p["types"]}
    assert [t["key"] for t in p["types"]] == ["page", "image"]
    assert rows["page"]["objectCount"] == 1 and rows["image"]["objectCount"] == 1
    image = rows["image"]
    assert image["name"] == "Image" and image["pluralName"] == "Images" and image["properties"] == []
    assert image["originLabel"] == "Image files" and image["skip"] is False
    assert image["existingTypeId"] is None  # the sample space has no Image type yet
    assert {s["sourcePath"]: s["typeKey"] for s in p["samples"]} == {"photo.png": "image", "notes.txt": "page"}
    assert p["counts"]["objects"] == 2 and p["counts"]["types"] == 2
    # the same mapping previews the same
    r = client.post("/api/import/preview", json={"source": {"path": str(src), "kind": "files"}, "target": "currentSpace",
                                                 "keepAsSources": False, "mapping": p["mapping"]})
    assert r.status_code == 200 and r.json()["counts"] == p["counts"]
    # and the import makes what the preview said
    res = run(client, src)
    assert res["objects"] == 2 and res["types"] == 1  # the Image type, made for the import
    assert [o["type"] for o in objects_from(client, "photo.png")] == ["image"]
    assert [o["type"] for o in objects_from(client, "notes.txt")] == ["page"]
    rows = {t["key"]: t for t in preview(client, src)["types"]}
    assert rows["image"]["existingTypeId"] == "image" and rows["image"]["objectCount"] == 1


def test_the_image_row_cannot_be_changed(client, tmp_path):
    """The Image row is the writer's rule shown, not a mapping row: an override of it is refused."""
    src = library(tmp_path)
    for over in ({"skip": True}, {"name": "Picture"}, {"existingTypeId": "page"}):
        r = client.post("/api/import/preview", json={"source": {"path": str(src), "kind": "files"}, "target": "currentSpace",
                                                     "keepAsSources": False, "mapping": {"types": {"image": over}}})
        assert r.status_code == 422, r.text
        assert r.json()["detail"] == "Images always become Image objects, so the Image row can't be changed."
    r = client.post("/api/import/preview", json={"source": {"path": str(src), "kind": "files"}, "target": "currentSpace",
                                                 "keepAsSources": False, "mapping": {"properties": {"image": {"x": {"skip": True}}}}})
    assert r.status_code == 422, r.text


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
    # The re-run's preview knows it stays a Page: no Image row, the Page row counts both files.
    p = preview(client, src)
    assert [(t["key"], t["objectCount"]) for t in p["types"]] == [("page", 2)]
    assert [s["typeKey"] for s in p["samples"] if s["sourcePath"] == "photo.png"] == ["page"]
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
                                                 "keepAsSources": False, "mapping": mapping})
    assert r.status_code == 200, r.text
    p = r.json()
    # the preview says so too: the images stay with their folder type, and there is no Image row
    assert [(t["key"], t["objectCount"]) for t in p["types"]] == [("folder:Shots", 2)]
    assert p["counts"]["types"] == 1
    r = client.post("/api/import/start", json={"previewId": p["previewId"], "mapping": p["mapping"], "target": {"kind": "currentSpace"},
                                               "keepAsSources": False})
    assert r.status_code == 202, r.text
    assert wait_job(client, r.json()["jobId"], timeout=60)["phase"] == "done"
    objs = objects_from(client, "Shots/photo.png")
    assert len(objs) == 1 and objs[0]["type"] != "image", objs


def test_create_media_type_is_the_basic_media_type(space_dir):
    from objectapp.propvalues import InvalidValue

    space = Space(space_dir)
    t = space.create_media_type("Image")
    assert t.basic and t.id == "image" and t.prop("width").type == "number" and t.prop("category") is not None
    reopened = Space(space_dir).type_by_id("image")
    assert reopened is not None and reopened.basic and reopened.prop("mimeType").id == "mimeType"
    with pytest.raises(InvalidValue):
        space.create_media_type("Image")
    with pytest.raises(InvalidValue):
        space.create_media_type("Gadget")
