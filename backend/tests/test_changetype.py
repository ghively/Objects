"""Change an object's type with a property mapping (Task 8)."""

import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.changetype import (
    CHANGE_FROM_ALLOWED,
    CHANGE_TO_ALLOWED,
    MappingRow,
    load_ui,
    save_change_type_preference,
    suggest_mapping,
)
from objectapp.propvalues import InvalidValue
from objectapp.server import create_app
from objectapp.space import Space, version_of
from objectapp.typemodel import TypeDefinition

_ID_RE = re.compile(r"[0-9A-HJKMNP-TV-Z]{26}")
_STAMP_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z")

ADA = "People/Ada Lovelace.md"
NOTES = "Pages/Notes.md"


def _version(space: Space, path: str) -> str:
    return space.read(path)[2]


def _type(type_id: str, name: str, props: list[tuple[str, str, str]]) -> TypeDefinition:
    """A custom type with (key, name, kind) properties."""
    return TypeDefinition.from_json(
        {
            "id": type_id,
            "name": name,
            "pluralName": f"{name}s",
            "folder": f"{name}s",
            "propertyDefinitions": [
                {"id": f"{type_id}-{key}", "key": key, "name": pname, "type": kind}
                for key, pname, kind in props
            ],
        }
    )


def _add_type(space_dir: Path, type_id: str, name: str, props: list[tuple[str, str, str]]) -> None:
    """Store a custom type's JSON before the space opens."""
    folder = space_dir / ".capacities" / "types"
    folder.mkdir(parents=True, exist_ok=True)
    data = _type(type_id, name, props).to_json()
    (folder / f"{type_id}.json").write_text(json.dumps(data, indent=2), encoding="utf-8")


def _rows(rows: list[MappingRow]) -> dict[str, str | None]:
    return {r.fromKey: r.toKey for r in rows}


# -- suggestions -----------------------------------------------------------------


SRC = _type(
    "gizmo",
    "Gizmo",
    [("notes", "Notes", "text"), ("due", "Due", "datetime"), ("count", "Count", "number")],
)
DST = _type(
    "widget",
    "Widget",
    [("remarks", "Remarks", "text"), ("memo", "Notes", "textBlock"), ("deadline", "Deadline", "datetime")],
)
FM = {"title": "G1", "notes": "hello", "due": "2026-10-30", "count": 3, "tags": ["x"]}


def test_suggest_exact_name_then_type():
    rows = suggest_mapping(SRC, DST, FM, {})
    # Title, tags and the other system keys carry over: they are not rows.
    assert _rows(rows) == {"notes": "memo", "due": "deadline", "count": None}
    assert all(not r.lossy for r in rows)


def test_suggest_uses_remembered_mapping():
    rows = suggest_mapping(SRC, DST, FM, {"notes": "remarks", "due": None})
    assert _rows(rows) == {"notes": "remarks", "due": None, "count": None}


def test_suggest_normalised_and_case_insensitive_names():
    src = _type("a", "A", [("x", "Due-date", "text"), ("y", "owner", "text")])
    dst = _type("b", "B", [("p", "Owner", "text"), ("q", "Due date", "text"), ("r", "Other", "text")])
    rows = suggest_mapping(src, dst, {"x": "1", "y": "2"}, {})
    assert _rows(rows) == {"x": "q", "y": "p"}


def test_suggest_each_target_once_and_only_compatible():
    src = _type("a", "A", [("n1", "Size", "number"), ("n2", "Weight", "number"), ("b", "On", "boolean")])
    dst = _type("b", "B", [("size", "Size", "number"), ("flag", "Flag", "label")])
    rows = suggest_mapping(src, dst, {"n1": 1, "n2": 2, "b": True}, {})
    # n2 would match `size` by kind, but it is taken; boolean can't become a label.
    assert _rows(rows) == {"n1": "size", "n2": None, "b": None}


def test_allowed_categories():
    assert CHANGE_FROM_ALLOWED == frozenset({"page", "custom", "task"})
    assert CHANGE_TO_ALLOWED == frozenset({"page", "custom", "tag", "task"})


# -- change type -----------------------------------------------------------------


def test_change_type_inserts_id_and_moves(space_dir: Path):
    space = Space(space_dir)
    client = TestClient(create_app(space, watch=False))
    res = client.post(
        "/api/object/change-type",
        json={"path": NOTES, "typeId": "task", "mapping": {}, "baseVersion": _version(space, NOTES)},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["path"] == "Tasks/Meeting notes.md"
    assert not (space_dir / NOTES).exists()
    data = (space_dir / "Tasks" / "Meeting notes.md").read_bytes()
    assert body["version"] == version_of(data)
    text = data.decode()
    object_id = _ID_RE.search(text).group(0)
    norm = _STAMP_RE.sub("<t>", _ID_RE.sub("<ulid>", text, count=1), count=1)
    assert norm.startswith(
        "---\nid: <ulid>\ntype: 'Task'\ntitle: Meeting notes\nlastUpdated: <t>\n---\n# Meeting notes\n"
    )
    got = client.get("/api/object", params={"path": body["path"]}).json()
    assert got["summary"]["id"] == object_id
    assert got["summary"]["type"] == "task"


def test_change_type_keeps_quotes_and_collides(space_dir: Path):
    space = Space(space_dir)
    path = "Servers/Alpha.md"
    result = space.change_type(path, "page", {}, _version(space, path))
    assert result.path == "Pages/Alpha (2).md"
    assert (space_dir / "Pages" / "Alpha.md").exists()
    text = (space_dir / "Pages" / "Alpha (2).md").read_text(encoding="utf-8")
    assert "\ntype: 'Page'\n" in text
    assert text.startswith("---\nid: ") and _ID_RE.search(text.splitlines()[1])
    assert "cores: 8\n" in text and "owner: '[[Ada Lovelace]]'\n" in text
    assert space.get(result.path).type == "page"


def test_change_type_keeps_unmapped_keys(space_dir: Path):
    space = Space(space_dir)
    before = (space_dir / ADA).read_text(encoding="utf-8")
    result = space.change_type(ADA, "page", {"website": None}, _version(space, ADA))
    assert result.path == "Pages/Ada Lovelace.md"
    after = (space_dir / result.path).read_text(encoding="utf-8")
    line = "website: https://example.org/ada\n"
    assert line in before and line in after
    assert "aliases: [Ada, Countess of Lovelace]\n" in after
    assert "icon: ph-user\n" in after and "tags: [Math]\n" in after
    assert "type: 'Page'\n" in after


def test_change_type_renames_mapped_key_in_place(space_dir: Path):
    _add_type(space_dir, "contact", "Contact", [("homepage", "Homepage", "url")])
    space = Space(space_dir)
    before = (space_dir / ADA).read_text(encoding="utf-8").splitlines()
    result = space.change_type(ADA, "contact", {"website": "homepage"}, _version(space, ADA))
    assert result.path == "Contacts/Ada Lovelace.md"
    after = (space_dir / result.path).read_text(encoding="utf-8").splitlines()
    i = before.index("website: https://example.org/ada")
    j = after.index("homepage: https://example.org/ada")
    # Same place among the lines (an id was inserted first).
    assert j == i + 1
    assert not any(x.startswith("website:") for x in after)
    _of, fm, _v = space.read(result.path)
    assert fm["homepage"] == "https://example.org/ada"


def test_change_type_converts_text_to_label_and_flags_lossy(space_dir: Path):
    _add_type(space_dir, "gizmo", "Gizmo", [("kind", "Kind", "text"), ("notes", "Notes", "text")])
    _add_type(space_dir, "widget", "Widget", [("kind", "Kind", "label"), ("score", "Notes", "number")])
    (space_dir / "Gizmos").mkdir()
    (space_dir / "Gizmos" / "G1.md").write_text(
        "---\ntype: 'Gizmo'\ntitle: G1\nkind: Sprocket\nnotes: not a number\n---\nBody\n",
        encoding="utf-8",
        newline="",
    )
    space = Space(space_dir)
    path = "Gizmos/G1.md"
    rows = space.suggest_change_type(path, "widget")
    assert {(r.fromKey, r.toKey, r.lossy) for r in rows} == {
        ("kind", "kind", False),
        ("notes", "score", True),
    }
    result = space.change_type(path, "widget", {"kind": "kind", "notes": "score"}, _version(space, path))
    assert result.path == "Widgets/G1.md"
    _of, fm, _v = space.read(result.path)
    assert fm["kind"] == "Sprocket"
    assert "notes" not in fm  # converted (to nothing): the source key goes
    widget = space.type_by_id("widget")
    texts = [o["text"] for o in widget.prop("kind").options["set"]]
    assert texts == ["Sprocket"]
    stored = json.loads((space_dir / ".capacities" / "types" / "widget.json").read_text("utf-8"))
    kind = next(p for p in stored["propertyDefinitions"] if p["key"] == "kind")
    assert [o["text"] for o in kind["options"]["set"]] == ["Sprocket"]


def test_change_type_from_dailynote_422(space_dir: Path):
    space = Space(space_dir)
    client = TestClient(create_app(space, watch=False))
    path = "DailyNotes/2026-10-23.md"
    before = (space_dir / path).read_bytes()
    res = client.post(
        "/api/object/change-type",
        json={"path": path, "typeId": "page", "mapping": {}, "baseVersion": _version(space, path)},
    )
    assert res.status_code == 422
    assert (space_dir / path).read_bytes() == before
    assert client.get("/api/object/change-type", params={"path": path, "typeId": "page"}).status_code == 422
    with pytest.raises(InvalidValue):
        space.change_type(NOTES, "dailynote", {}, _version(space, NOTES))


def test_change_type_stale_409(space_dir: Path):
    space = Space(space_dir)
    client = TestClient(create_app(space, watch=False))
    before = (space_dir / ADA).read_bytes()
    res = client.post(
        "/api/object/change-type",
        json={"path": ADA, "typeId": "page", "mapping": {}, "baseVersion": "stale"},
    )
    assert res.status_code == 409
    assert res.json()["currentVersion"] == version_of(before)
    assert (space_dir / ADA).read_bytes() == before


def test_links_resolve_after_move(space_dir: Path):
    ref = space_dir / "Pages" / "Ref.md"
    ref.write_text(
        "---\ntype: 'Page'\ntitle: Ref\nlastUpdated: 2026-01-01T00:00:00.000Z\n---\n"
        "See [[Notes]] and [[Meeting notes]].\n",
        encoding="utf-8",
        newline="",
    )
    space = Space(space_dir)
    assert space.resolve("Notes", "Pages/Ref.md") == NOTES
    result = space.change_type(NOTES, "task", {}, _version(space, NOTES))
    assert result.path == "Tasks/Meeting notes.md"
    assert result.relinked == ["Pages/Ref.md"]
    text = ref.read_text(encoding="utf-8")
    assert "See [[Meeting notes]] and [[Meeting notes]].\n" in text
    assert "lastUpdated: 2026-01-01T00:00:00.000Z\n" in text  # unstamped
    assert space.resolve("Meeting notes", "Pages/Ref.md") == result.path


def test_preference_remembered_in_ui_json(space_dir: Path):
    _add_type(space_dir, "contact", "Contact", [("homepage", "Homepage", "url"), ("site", "Site", "url")])
    ui = space_dir / ".capacities" / "ui.json"
    ui.write_text(json.dumps({"foo": 1}), encoding="utf-8")
    space = Space(space_dir)
    client = TestClient(create_app(space, watch=False))
    rows = client.get("/api/object/change-type", params={"path": ADA, "typeId": "contact"}).json()
    # Same kind (url) matches; on a tie the target listed first wins.
    assert rows == {"rows": [{"fromKey": "website", "toKey": "homepage", "lossy": False}]}
    res = client.post(
        "/api/object/change-type",
        json={
            "path": ADA,
            "typeId": "contact",
            "mapping": {"website": "site"},
            "baseVersion": _version(space, ADA),
        },
    )
    assert res.status_code == 200, res.text
    data = load_ui(space_dir)
    assert data["foo"] == 1
    assert data["changeTypePreferences"]["person"]["contact"] == {"website": "site"}

    # Another Person now gets the remembered mapping suggested.
    (space_dir / "People" / "Bob.md").write_text(
        "---\ntype: 'Person'\ntitle: Bob\nwebsite: https://example.org/bob\n---\n",
        encoding="utf-8",
        newline="",
    )
    space.rescan_file("People/Bob.md")
    rows = client.get("/api/object/change-type", params={"path": "People/Bob.md", "typeId": "contact"})
    assert rows.json()["rows"] == [{"fromKey": "website", "toKey": "site", "lossy": False}]


def test_save_preference_keeps_other_keys(tmp_path: Path):
    (tmp_path / ".capacities").mkdir()
    (tmp_path / ".capacities" / "ui.json").write_text('{"a": [1], "changeTypePreferences": {"x": {"y": {}}}}')
    save_change_type_preference(tmp_path, "p", "q", [MappingRow("k", "v", False)])
    data = load_ui(tmp_path)
    assert data["a"] == [1]
    assert data["changeTypePreferences"] == {"x": {"y": {}}, "p": {"q": {"k": "v"}}}
