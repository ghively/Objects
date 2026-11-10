"""M31 item 13: the simple-table property kind (``simpleTableBlock``, menu name "Table").

Stored in the front matter as a Markdown (GFM) table in a literal block, the header row first:

    sizes: |-
      | Name | Qty |
      | --- | --- |
      | Apple | 3 |

A hand-written YAML list of rows (each a list of cells, the first the header) reads the same and
keeps its form when edited.
"""

import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from objectapp.export import ExportOptions, build_doc
from objectapp.frontmatter import parse_fm, set_keys
from objectapp.propvalues import (
    KIND_TRANSFORMS,
    InvalidValue,
    convert_value,
    decode_value,
    encode_value,
    table_markdown,
    table_rows,
)
from objectapp.searchtext import SEARCHABLE_KINDS, property_text
from objectapp.server import create_app
from objectapp.space import NO_TRANSFORMATIONS, Space
from objectapp.typemodel import (
    PropertyDefinition,
    TypeDefinition,
    option_shape_problems,
    type_revision,
)

TABLE = "| Name | Qty |\n| --- | --- |\n| Apple | 3 |\n| Pear \\| green | 5 |"


def _pd(kind: str = "simpleTableBlock", key: str = "sizes", name: str = "Sizes", **extra):
    return PropertyDefinition.from_json(
        {"id": key, "key": key, "name": name, "type": kind, "options": {}, **extra}
    )


def _space_dir(tmp_path: Path) -> Path:
    root = tmp_path / "space"
    types = root / ".object" / "types"
    types.mkdir(parents=True)
    data = {
        "schemaVersion": 2, "id": "fruit", "name": "Fruit", "pluralName": "Fruits",
        "folder": "Fruits",
        "propertyDefinitions": [
            {"id": "title", "key": "title", "name": "Title", "type": "entity_title"},
            {"id": "sizes", "key": "sizes", "name": "Sizes", "type": "simpleTableBlock"},
            {"id": "note", "key": "note", "name": "Note", "type": "text"},
        ],
    }
    (types / "fruit.json").write_text(json.dumps(data, indent=2) + "\n", "utf-8")
    (root / "Fruits").mkdir()
    return root


# -- the codec ------------------------------------------------------------------------------


def test_table_rows_and_markdown_round_trip():
    rows = table_rows(TABLE)
    assert rows == [["Name", "Qty"], ["Apple", "3"], ["Pear | green", "5"]]
    assert table_markdown(rows) == TABLE
    # Ragged rows are padded to the widest; alignment colons and outer pipes are optional.
    assert table_rows("Name | Qty\n:--|--:\n| a |") == [["Name", "Qty"], ["a", ""]]
    assert table_rows("") == [] and table_rows(None) == []
    assert table_rows("just text") == []


def test_encode_writes_a_literal_block_and_reads_back():
    p = _pd()
    out = encode_value(p, TABLE)
    assert out == TABLE and type(out).__name__ == "LiteralScalarString"
    src = set_keys("type: Fruit\n", {"sizes": out})
    assert src == (
        "type: Fruit\nsizes: |-\n  | Name | Qty |\n  | --- | --- |\n  | Apple | 3 |\n"
        "  | Pear \\| green | 5 |\n"
    )
    assert decode_value(p, parse_fm(src)["sizes"]) == TABLE


def test_encode_takes_rows_and_refuses_what_is_not_a_table():
    p = _pd()
    assert encode_value(p, [["Name", "Qty"], ["Apple", 3]]) == "| Name | Qty |\n| --- | --- |\n| Apple | 3 |"
    assert encode_value(p, [["", ""], ["", ""]]) is None  # a blank table clears the value
    assert encode_value(p, "") is None and encode_value(p, None) is None and encode_value(p, []) is None
    for bad in ("not a table", "| a |\n| b |", 5, [["a"], "b"], [[{"x": 1}]], {"a": 1}):
        with pytest.raises(InvalidValue):
            encode_value(p, bad)


def test_a_hand_written_list_of_rows_reads_as_a_table():
    p = _pd()
    src = "sizes:\n- [Name, Qty]\n- [Apple, 3]\n"
    raw = parse_fm(src)["sizes"]
    assert decode_value(p, raw) == "| Name | Qty |\n| --- | --- |\n| Apple | 3 |"
    # An edit writes the Markdown table in place of the list (only this key's lines change).
    out = encode_value(p, "| Name | Qty |\n| --- | --- |\n| Apple | 4 |", raw)
    assert set_keys("a: 1\n" + src + "z: 2\n", {"sizes": out}) == (
        "a: 1\nsizes: |-\n  | Name | Qty |\n  | --- | --- |\n  | Apple | 4 |\nz: 2\n"
    )


def test_edit_changes_only_its_own_lines_and_keeps_crlf_and_bom(tmp_path: Path):
    root = _space_dir(tmp_path)
    path = root / "Fruits" / "Apple.md"
    head = (
        b"\xef\xbb\xbf---\r\nid: 01J00000000000000000000000\r\ntype: Fruit\r\ntitle: Apple\r\n"
        b"note: kept\r\n"
    )
    path.write_bytes(head + b"lastUpdated: 2026-01-01T00:00:00.000Z\r\n---\r\nBody line\r\n")
    space = Space(root)
    with TestClient(create_app(space, None, watch=False)) as c:
        version = c.get("/api/object", params={"path": "Fruits/Apple.md"}).json()["version"]
        r = c.put("/api/object/properties", json={
            "path": "Fruits/Apple.md", "updates": {"sizes": TABLE}, "remove": [],
            "baseVersion": version})
        assert r.status_code == 200, r.text
        after = path.read_bytes()
        # The table's lines are added and the stamp's value moves; nothing else changes.
        assert re.fullmatch(
            re.escape(head) + rb"lastUpdated: [0-9T:.\-]+Z\r\n"
            + re.escape(
                b"sizes: |-\r\n  | Name | Qty |\r\n  | --- | --- |\r\n  | Apple | 3 |\r\n"
                b"  | Pear \\| green | 5 |\r\n---\r\nBody line\r\n"
            ),
            after,
        ), after
        version = r.json()["version"]
        r = c.put("/api/object/properties", json={
            "path": "Fruits/Apple.md", "updates": {"sizes": "nope"}, "remove": [],
            "baseVersion": version})
        assert r.status_code == 422
        assert path.read_bytes() == after
        row = next(x for x in space.rows(paths=["Fruits/Apple.md"]))
        assert row.values["sizes"] == TABLE


# -- search and export ----------------------------------------------------------------------


def test_cells_are_searchable_unless_the_property_is_not():
    assert "simpleTableBlock" in SEARCHABLE_KINDS
    t = TypeDefinition.from_json({
        "schemaVersion": 2, "id": "fruit", "name": "Fruit", "pluralName": "Fruits",
        "propertyDefinitions": [
            {"id": "sizes", "key": "sizes", "name": "Sizes", "type": "simpleTableBlock"},
            {"id": "hid", "key": "hid", "name": "Hid", "type": "simpleTableBlock",
             "isNotSearchable": True},
        ],
    })
    text = property_text(t, {"sizes": TABLE, "hid": "| Secret |\n| --- |\n| word |"}, lambda s: s)
    assert text == "Sizes: Name Qty Apple 3 Pear | green 5"


def test_markdown_export_shows_the_table_and_documents_list_the_cells(tmp_path: Path):
    root = _space_dir(tmp_path)
    path = root / "Fruits" / "Apple.md"
    path.write_text(
        "---\ntype: Fruit\ntitle: Apple\nsizes: |-\n  | Name | Qty |\n  | --- | --- |\n"
        "  | Apple | 3 |\n---\nBody\n", "utf-8")
    space = Space(root)
    with TestClient(create_app(space, None, watch=False)) as c:
        r = c.get("/api/object/export", params={"path": "Fruits/Apple.md"})
        assert r.status_code == 200
        assert "  | Name | Qty |\n  | --- | --- |\n  | Apple | 3 |\n" in r.text
        r = c.get("/api/object/export", params={"path": "Fruits/Apple.md", "titleH1": "1"})
        assert "  | Name | Qty |\n  | --- | --- |\n  | Apple | 3 |\n" in r.text
    doc = build_doc(space, "Fruits/Apple.md", ExportOptions(format="html"))
    assert ("Sizes", "Name, Qty; Apple, 3") in doc.properties


# -- kind changes ---------------------------------------------------------------------------


def test_kind_changes_to_and_from_text():
    assert "simpleTableBlock" in KIND_TRANSFORMS["text"]
    assert "simpleTableBlock" in KIND_TRANSFORMS["textBlock"]
    assert KIND_TRANSFORMS["simpleTableBlock"] == ("text", "textBlock")
    table, text, block = _pd(), _pd("text", "note", "Note"), _pd("textBlock", "sum", "Summary")
    assert convert_value(table, text, TABLE) == ("Name, Qty; Apple, 3; Pear | green, 5", True)
    assert convert_value(table, block, TABLE)[0] == "Name, Qty; Apple, 3; Pear | green, 5"
    # A text becomes one cell under a header of the new property's name...
    assert convert_value(text, table, "ripe") == ("| Sizes |\n| --- |\n| ripe |", False)
    # ...unless it already is a table.
    assert convert_value(block, table, TABLE) == (TABLE, False)
    assert convert_value(text, table, "") == (None, False)
    for other in ("number", "label", "url", "blocks"):
        with pytest.raises(InvalidValue):
            convert_value(table, _pd(other), TABLE)


def test_change_kind_route_text_to_table_and_refusal(tmp_path: Path):
    root = _space_dir(tmp_path)
    path = root / "Fruits" / "Apple.md"
    path.write_text("---\ntype: Fruit\ntitle: Apple\nnote: ripe\n---\n", "utf-8")
    space = Space(root)
    with TestClient(create_app(space, None, watch=False)) as c:
        rev = type_revision(root, "fruit")
        r = c.post("/api/types/fruit/properties/note/change-kind",
                   json={"toType": "simpleTableBlock", "baseRevision": rev})
        assert r.status_code == 200, r.text
        assert path.read_text("utf-8") == (
            "---\ntype: Fruit\ntitle: Apple\nnote: ripe\nnote_: |-\n  | Note |\n  | --- |\n"
            "  | ripe |\n---\n"
        )
        rev = r.json()["type"]["revision"]
        r = c.post("/api/types/fruit/properties/sizes/change-kind",
                   json={"toType": "number", "baseRevision": rev})
        assert r.status_code == 422
        assert r.json()["detail"] == NO_TRANSFORMATIONS


def test_a_table_property_can_be_added_to_a_type(tmp_path: Path):
    root = _space_dir(tmp_path)
    space = Space(root)
    with TestClient(create_app(space, None, watch=False)) as c:
        t = next(x for x in c.get("/api/space").json()["types"] if x["id"] == "fruit")
        t["propertyDefinitions"].append({
            "id": "grid", "key": "grid", "name": "Table", "type": "simpleTableBlock",
            "description": "", "icon": {"type": "iconify", "val": "ph-table"},
            "visibility": "alwaysShow", "options": {}})
        r = c.put("/api/types/fruit", json={"type": t, "baseRevision": t["revision"]})
        assert r.status_code == 200, r.text
    stored = json.loads((root / ".object" / "types" / "fruit.json").read_text("utf-8"))
    assert stored["propertyDefinitions"][-1]["type"] == "simpleTableBlock"


# -- M31 fix pass: dash-only cells, pipes and backslashes (finding 8) -----------------------

STEPS = [["Step"], ["Boil"], ["-"], ["Serve"]]
STEPS_MD = "| Step |\n| --- |\n| Boil |\n| \\- |\n| Serve |"


def test_a_dash_only_cell_is_escaped_on_write_and_kept_on_read():
    # Only line 2 is the separator: a cell of dashes is a cell, escaped so it can't read as one.
    assert table_markdown(STEPS) == STEPS_MD
    assert table_rows(STEPS_MD) == STEPS
    p = _pd()
    assert encode_value(p, STEPS) == STEPS_MD
    assert encode_value(p, STEPS_MD) == STEPS_MD
    # Every separator-like cell is escaped (alignment colons too) and reads back as typed.
    rows = [["A", "B"], ["---", ":-:"], [":--", "--:"]]
    md = table_markdown(rows)
    assert md == "| A | B |\n| --- | --- |\n| \\--- | \\:-: |\n| \\:-- | \\--: |"
    assert table_rows(md) == rows and encode_value(p, md) == md
    # A hand-written table whose later line looks like a separator: that line is a row.
    hand = "| Step |\n|---|\n| Boil |\n| - |\n|:--:|"
    assert table_rows(hand) == [["Step"], ["Boil"], ["-"], [":--:"]]
    assert encode_value(p, hand) == hand
    # CRLF reads the same.
    assert table_rows(STEPS_MD.replace("\n", "\r\n")) == STEPS
    assert table_rows(hand.replace("\n", "\r\n")) == [["Step"], ["Boil"], ["-"], [":--:"]]


def test_pipes_and_backslashes_in_cells_round_trip():
    rows = [["a|b", "c\\d"], ["\\", "x\\|y"], ["|", "end\\"], ["\\-", "\\\\"]]
    md = table_markdown(rows)
    assert md == (
        "| a\\|b | c\\\\d |\n| --- | --- |\n| \\\\ | x\\\\\\|y |\n| \\| | end\\\\ |\n"
        "| \\\\- | \\\\\\\\ |"
    )
    assert table_rows(md) == rows
    assert table_rows(md.replace("\n", "\r\n")) == rows
    assert encode_value(_pd(), rows) == md and encode_value(_pd(), md) == md
    # A backslash before a letter is kept as typed (C:\temp in a hand-written table).
    assert table_rows("| Path |\n| --- |\n| C:\\temp |") == [["Path"], ["C:\\temp"]]


def test_a_dash_cell_saves_reads_searches_and_exports_with_crlf_and_bom(tmp_path: Path):
    root = _space_dir(tmp_path)
    path = root / "Fruits" / "Apple.md"
    head = b"\xef\xbb\xbf---\r\nid: 01J00000000000000000000000\r\ntype: Fruit\r\ntitle: Apple\r\n"
    path.write_bytes(head + b"lastUpdated: 2026-01-01T00:00:00.000Z\r\n---\r\nBody line\r\n")
    space = Space(root)
    with TestClient(create_app(space, None, watch=False)) as c:
        version = c.get("/api/object", params={"path": "Fruits/Apple.md"}).json()["version"]
        r = c.put("/api/object/properties", json={
            "path": "Fruits/Apple.md", "updates": {"sizes": STEPS_MD}, "remove": [],
            "baseVersion": version})
        assert r.status_code == 200, r.text
        after = path.read_bytes()
        assert after.startswith(head)
        assert (
            b"sizes: |-\r\n  | Step |\r\n  | --- |\r\n  | Boil |\r\n  | \\- |\r\n  | Serve |\r\n"
            b"---\r\nBody line\r\n"
        ) in after
        row = next(x for x in space.rows(paths=["Fruits/Apple.md"]))
        assert row.values["sizes"] == STEPS_MD
    doc = build_doc(space, "Fruits/Apple.md", ExportOptions(format="html"))
    assert ("Sizes", "Step; Boil; -; Serve") in doc.properties
    t = space.type_by_id("fruit")
    assert property_text(t, {"sizes": STEPS_MD}, lambda s: s) == "Sizes: Step Boil - Serve"


# -- M31 fix pass: "First column is a header" (finding 13b) ---------------------------------


def test_the_header_column_option_is_kept_and_checked():
    p = _pd(options={"headerColumn": True})
    assert p.options["headerColumn"] is True
    assert p.to_json()["options"]["headerColumn"] is True
    # Storage ignores it: the Markdown table is the same.
    assert encode_value(p, TABLE) == encode_value(_pd(), TABLE) == TABLE
    assert option_shape_problems({"headerColumn": False}) == []
    assert option_shape_problems({"headerColumn": "yes"}) == ["headerColumn"]
    # A hand-edited bad value is dropped on read.
    assert "headerColumn" not in _pd(options={"headerColumn": "yes"}).options


def test_a_type_save_keeps_the_header_column_and_refuses_a_bad_one(tmp_path: Path):
    root = _space_dir(tmp_path)
    path = root / "Fruits" / "Apple.md"
    src = "---\ntype: Fruit\ntitle: Apple\nsizes: |-\n  | Name | Qty |\n  | --- | --- |\n  | Apple | 3 |\n---\n"
    path.write_text(src, "utf-8")
    space = Space(root)
    with TestClient(create_app(space, None, watch=False)) as c:
        t = next(x for x in c.get("/api/space").json()["types"] if x["id"] == "fruit")
        sizes = next(d for d in t["propertyDefinitions"] if d["key"] == "sizes")
        sizes["options"] = {**sizes.get("options", {}), "headerColumn": "yes"}
        r = c.put("/api/types/fruit", json={"type": t, "baseRevision": t["revision"]})
        assert r.status_code == 422
        assert r.json()["detail"] == "The options of Sizes are not valid: headerColumn."
        sizes["options"]["headerColumn"] = True
        r = c.put("/api/types/fruit", json={"type": t, "baseRevision": t["revision"]})
        assert r.status_code == 200, r.text
        t = next(x for x in c.get("/api/space").json()["types"] if x["id"] == "fruit")
        sizes = next(d for d in t["propertyDefinitions"] if d["key"] == "sizes")
        assert sizes["options"]["headerColumn"] is True
    stored = json.loads((root / ".object" / "types" / "fruit.json").read_text("utf-8"))
    stored_sizes = next(d for d in stored["propertyDefinitions"] if d["key"] == "sizes")
    assert stored_sizes["options"]["headerColumn"] is True
    assert path.read_text("utf-8") == src
