"""M28 Task 3: IT operations as a starting point, and the gallery's default template.

``create_space(..., "itops")`` and ``Space.apply_setup("itops")`` write the IT ops types, their
default templates and the seed Tags (`basicsetup`), never replacing a file that is there; the
pick is recorded in ``space.json`` (``setup: "itops"``) so the space is asked once. An IT ops type
added from the gallery also gets its default template.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp import typetemplates
from objectapp.basicsetup import ITOPS_TAGS, ITOPS_TYPE_IDS, itops_template, itops_types
from objectapp.objfile import split_object
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.spaceconfig import needs_setup
from objectapp.spaces import create_space
from objectapp.typemodel import system_property_defs


def _files(root: Path) -> dict[str, bytes]:
    return {
        p.relative_to(root).as_posix(): p.read_bytes()
        for p in sorted(root.rglob("*"))
        if p.is_file() and ".object-cache" not in p.relative_to(root).parts
    }


def _client(space: Space) -> TestClient:
    return TestClient(create_app(space, None, watch=False))


def _body(root: Path, rel: str) -> str:
    return split_object((root / rel).read_bytes().decode("utf-8-sig")).body


def _tag_paths(space: Space, title: str) -> list[str]:
    return [s.path for s in space.list("tag") if s.title.casefold() == title.casefold()]


def test_create_space_itops(tmp_path: Path):
    root = create_space("Ops", tmp_path, "itops")
    data = json.loads((root / ".object" / "space.json").read_text("utf-8"))
    assert data == {"name": "Ops", "setup": "itops"}
    files = _files(root)
    types = [r for r in files if r.startswith(".object/types/")]
    templates = [r for r in files if r.startswith("Templates/")]
    tags = [r for r in files if r.startswith("Tags/")]
    assert sorted(types) == sorted(f".object/types/{tid}.json" for tid in ITOPS_TYPE_IDS)
    assert len(types) == 17
    assert len(templates) == 16
    assert sorted(tags) == sorted(f"Tags/{name}.md" for name in ITOPS_TAGS)
    assert len(tags) == 30

    space = Space(root)
    assert {tid for tid in ITOPS_TYPE_IDS} <= {t.id for t in space.types}
    assert needs_setup(root) is False
    # Opening wrote no object and changed no IT ops file (only the basic Page and Tag type
    # files an open adds, as for any space).
    opened = _files(root)
    assert set(opened) - set(files) <= {".object/types/page.json", ".object/types/tag.json"}
    assert all(opened[rel] == data for rel, data in files.items())
    Space(root)
    assert _files(root) == opened


def test_create_space_itops_through_the_route(tmp_path: Path):
    here = tmp_path / "here"
    here.mkdir()
    loc = tmp_path / "loc"
    loc.mkdir()
    with _client(Space(here)) as c:
        res = c.post("/api/spaces", json={"name": "Ops", "location": str(loc), "setup": "itops"})
        assert res.status_code == 201, res.text
        assert c.post(
            "/api/spaces", json={"name": "Other", "location": str(loc), "setup": "x"}
        ).status_code == 422
    root = Path(res.json()["path"])
    assert json.loads((root / ".object" / "space.json").read_text("utf-8"))["setup"] == "itops"
    assert (root / ".object" / "types" / "host.json").is_file()


def test_apply_setup_itops(tmp_path: Path):
    root = tmp_path / "fresh"
    root.mkdir()
    space = Space(root)
    space.apply_setup("itops")

    host = space.type_by_id("host")
    assert host is not None
    for tid in ITOPS_TYPE_IDS:
        assert space.type_by_id(tid) is not None, tid
    templates = space.list_templates("host")
    assert templates[0].title == "Host"
    assert host.templates["defaultTemplateId"] == templates[0].id
    assert space.list_templates("source") == []

    path, _version = space.create_object("host", "SRV-TEST-02")
    assert _body(root, path) == "## Purpose\n\n## Access\n\n## Known issues\n"

    windows = _tag_paths(space, "Windows")
    assert len(windows) == 1
    assert space.resolve("Windows", None) == windows[0]
    assert json.loads((root / ".object" / "space.json").read_text("utf-8"))["setup"] == "itops"
    assert needs_setup(root) is False


def test_setup_route_announces_and_answers(tmp_path: Path):
    root = tmp_path / "fresh"
    root.mkdir()
    with _client(Space(root)) as c:
        res = c.post("/api/space/setup", json={"setup": "itops"})
        assert res.status_code == 200, res.text
        info = res.json()
        assert info["needsSetup"] is False
        assert set(ITOPS_TYPE_IDS) <= {t["id"] for t in info["types"]}
        assert c.post("/api/space/setup", json={"setup": "basic"}).status_code == 409


_HAND_HOST = (
    b'{\r\n  "schemaVersion": 2,\r\n  "id": "host",\r\n  "name": "Host",\r\n'
    b'  "pluralName": "Hosts",\r\n  "folder": "Hosts",\r\n  "propertyDefinitions": []\r\n}\r\n'
)
_HAND_TEMPLATE = "\ufeff---\r\ntype: 'Host'\r\ntemplate: Host\r\n---\r\nMy own host notes.\r\n".encode()
_HAND_TAG = "---\r\ntype: Tag\r\ntitle: Windows\r\ncolor: bg-red\r\n---\r\n".encode()


def test_itops_setup_keeps_what_exists(tmp_path: Path):
    """Review Focus 5: setup on a space that isn't fresh keeps every file that is there."""
    root = tmp_path / "space"
    (root / ".object" / "types").mkdir(parents=True)
    (root / ".object" / "types" / "host.json").write_bytes(_HAND_HOST)
    (root / "Templates" / "Hosts").mkdir(parents=True)
    (root / "Templates" / "Hosts" / "Host.md").write_bytes(_HAND_TEMPLATE)
    (root / "Tags").mkdir()
    (root / "Tags" / "Windows.md").write_bytes(_HAND_TAG)
    kept = {
        ".object/types/host.json": _HAND_HOST,
        "Templates/Hosts/Host.md": _HAND_TEMPLATE,
        "Tags/Windows.md": _HAND_TAG,
    }

    space = Space(root)
    space.apply_setup("itops")

    files = _files(root)
    for rel, data in kept.items():
        assert files[rel] == data, rel
    # The other types are written, with their templates; the hand-made Host stays as it is.
    for tid in ITOPS_TYPE_IDS:
        if tid != "host":
            assert f".object/types/{tid}.json" in files, tid
    assert space.type_by_id("host").prop("category") is None
    assert "Templates/Applications/Application.md" in files
    assert [r for r in files if r.startswith("Templates/Hosts/")] == ["Templates/Hosts/Host.md"]
    # No second Windows tag; the other 29 are written.
    assert [r for r in files if r.lower().startswith("tags/windows")] == ["Tags/Windows.md"]
    assert len(_tag_paths(space, "Windows")) == 1
    assert len([r for r in files if r.startswith("Tags/")]) == 30
    assert json.loads((root / ".object" / "space.json").read_text("utf-8"))["setup"] == "itops"
    assert needs_setup(root) is False

    with _client(space) as c:
        res = c.post("/api/space/setup", json={"setup": "itops"})
        assert res.status_code == 409
        assert res.json()["detail"] == "This space already has a starting point."
        res = c.post("/api/space/setup", json={"setup": "x"})
        assert res.status_code == 422
        assert res.json()["detail"] == 'Pick "basic", "itops" or "blank" as the starting point.'
    for rel, data in kept.items():
        assert (root / rel).read_bytes() == data, rel


def test_itops_after_basic_is_refused(tmp_path: Path):
    root = tmp_path / "fresh"
    root.mkdir()
    with _client(Space(root)) as c:
        assert c.post("/api/space/setup", json={"setup": "basic"}).status_code == 200
        before = _files(root)
        assert c.post("/api/space/setup", json={"setup": "itops"}).status_code == 409
        assert _files(root) == before


def test_needs_setup_with_itops_types(tmp_path: Path):
    root = tmp_path / "space"
    (root / ".object" / "types").mkdir(parents=True)
    (root / ".object" / "types" / "host.json").write_bytes(_HAND_HOST)
    assert needs_setup(root) is False


def _ensure_gallery_host(monkeypatch) -> None:
    """The gallery's Host entry is T7's; until it is there, stand one in (same shape)."""
    if typetemplates.get_template("host") is not None:
        return
    host = next(t for t in itops_types() if t.id == "host")
    system = {p.key for p in system_property_defs()}

    def props():
        fresh = next(t for t in itops_types() if t.id == "host")
        return [p for p in fresh.propertyDefinitions if p.key not in system]

    tpl = typetemplates.TypeTemplate(
        "host", "itOperations", host.name, host.pluralName, host.description,
        host.icon.val, host.color, props,
    )  # fmt: skip
    monkeypatch.setitem(typetemplates._BY_KEY, "host", tpl)


def test_gallery_itops_type_gets_its_template(tmp_path: Path, monkeypatch):
    _ensure_gallery_host(monkeypatch)
    root = tmp_path / "space"
    root.mkdir()
    space = Space(root)
    t = space.create_type("Host", "Hosts", template="host")
    t = space.type_by_id(t.id)
    templates = space.list_templates(t.id)
    assert [s.title for s in templates] == ["Host"]
    assert t.templates["ids"] == [templates[0].id]
    assert t.templates["defaultTemplateId"] == templates[0].id
    name, body = itops_template("host")
    assert _body(root, templates[0].path) == body
    path, _ = space.create_object(t.id, "SRV-TEST-03")
    assert _body(root, path) == body
    # The stored type file registers it too.
    stored = json.loads((root / ".object" / "types" / f"{t.id}.json").read_text("utf-8"))
    assert stored["templates"]["defaultTemplateId"] == templates[0].id

    # An older gallery entry still creates no template object.
    film = space.create_type("Film", "Films", template="film")
    assert space.list_templates(film.id) == []
    assert not (root / "Templates" / "Films").exists()


def test_gallery_template_is_announced(tmp_path: Path, monkeypatch):
    _ensure_gallery_host(monkeypatch)
    root = tmp_path / "space"
    root.mkdir()
    space = Space(root)
    with _client(space) as c:
        res = c.post("/api/types", json={"name": "Host", "pluralName": "Hosts", "template": "host"})
        assert res.status_code == 201, res.text
        assert res.json()["templates"]["defaultTemplateId"]
        assert len(space.list_templates(res.json()["id"])) == 1


def test_setup_reads_write_nothing(tmp_path: Path):
    root = tmp_path / "fresh"
    root.mkdir()
    with _client(Space(root)) as c:
        before = _files(root)
        info = c.get("/api/space").json()
        assert info["needsSetup"] is True
        assert _files(root) == before
    space = Space(tmp_path / "fresh")
    space.apply_setup("itops")
    with _client(Space(root)) as c:
        before = _files(root)
        assert c.get("/api/space").json()["needsSetup"] is False
        assert _files(root) == before


def test_unknown_setup_is_refused(tmp_path: Path):
    with pytest.raises(ValueError):
        create_space("Bad", tmp_path, "nope")
    assert not (tmp_path / "Bad").exists()
    root = tmp_path / "fresh"
    root.mkdir()
    space = Space(root)
    before = _files(root)
    with pytest.raises(ValueError):
        space.apply_setup("nope")
    assert _files(root) == before
    assert needs_setup(root) is True
