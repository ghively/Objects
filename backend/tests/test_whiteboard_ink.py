"""M6 Task 2: the ink SVG format (`whiteboardink`)."""

from __future__ import annotations

import copy
import xml.etree.ElementTree as ET

import pytest
from objectapp.whiteboardink import (
    INK_READ_ONLY_REASON,
    InkInvalid,
    dump_ink,
    load_ink,
    validate_strokes,
)
from wb_support import FIXTURE

WB = FIXTURE / "Whiteboards"
SVG = "{http://www.w3.org/2000/svg}"

STROKES = [
    {
        "id": "01HXPEN",
        "tool": "pen",
        "color": "#3b82f6",
        "width": 4,
        "points": [[10.123, 20.5, 0.2], [30, 40.004, 0.55555], [-5.5, 60, 1]],
        "d": "M 10 20 L 30 40 L -5.5 60 Z",
        "colorName": "blue",
    },
    {
        "id": "hl_2",
        "tool": "highlighter",
        "color": "#eab308",
        "width": 16,
        "points": [[100, 100, 0.5], [200, 120, 0.5]],
        "d": "M100,92L200,112L200,128L100,108Z",
    },
]


def _parse(data: bytes) -> ET.Element:
    return ET.fromstring(data)


def test_ink_svg_round_trip_byte_identical():
    once = dump_ink(STROKES)
    strokes, reason = load_ink(once)
    assert reason is None
    assert dump_ink(strokes) == once
    # Rounding happens once: 2 decimals for coordinates, 3 for pressure.
    assert strokes[0]["points"][0] == [10.12, 20.5, 0.2]
    assert strokes[0]["points"][1] == [30, 40, 0.556]
    assert strokes[1]["colorName"] == "yellow"  # named from the hex


def test_fixture_ink_parses_with_pressures_and_dumps_identically():
    raw = (WB / "Network map.ink.svg").read_bytes()
    strokes, reason = load_ink(raw)
    assert reason is None
    assert [s["id"] for s in strokes] == ["ink01", "ink02", "ink03", "ink04"]
    assert strokes[0]["points"] == [[60, 60, 0.2], [90, 70, 0.35], [120, 80, 0.5]]
    assert strokes[2]["points"][-1] == [260, 120, 1]
    assert strokes[3]["tool"] == "highlighter"
    assert strokes[0]["d"] == "M 60 59 L 120 78 L 120 82 L 60 61 Z"
    assert dump_ink(strokes) == raw


def test_ink_svg_renders_standalone():
    data = dump_ink(STROKES)
    assert data.startswith(b'<?xml version="1.0" encoding="UTF-8"?>\n')
    assert data.endswith(b"</svg>\n") and b"\r" not in data
    root = _parse(data)
    assert root.tag == f"{SVG}svg"
    min_x, min_y, w, h = (float(v) for v in root.get("viewBox").split())
    for s in STROKES:
        for x, y, _ in s["points"]:
            assert min_x <= x <= min_x + w and min_y <= y <= min_y + h
    assert (min_x, min_y) == (-5.5 - 15, 20.5 - 15)
    paths = root.findall(f"{SVG}path")
    assert len(paths) == 2
    for p in paths:
        assert p.get("fill") and p.get("d")
    assert paths[0].get("fill-opacity") is None
    assert paths[1].get("fill-opacity") == "0.35"
    assert paths[0].get("data-color") == "blue"
    assert list(paths[0].attrib) == ["id", "data-tool", "data-color", "data-width", "data-points", "fill", "d"]

    empty = dump_ink([])
    assert _parse(empty).get("viewBox") == "0 0 1 1"
    assert load_ink(empty) == ([], None)


def test_foreign_svg_read_only():
    strokes, reason = load_ink((WB / "Foreign ink.ink.svg").read_bytes())
    assert strokes == [] and reason == INK_READ_ONLY_REASON


@pytest.mark.parametrize(
    "mutate",
    [
        lambda s: s.replace("<path ", "<path onclick=\"x\" ", 1),  # an attribute we don't write
        lambda s: s.replace("</svg>", "  <rect/>\n</svg>"),  # another element
        lambda s: s.replace("</svg>", "<!-- note -->\n</svg>"),  # a comment
        lambda s: s.replace('data-object-ink="1" ', ""),  # not our root
        lambda s: s.replace(' data-points="', ' data-pts="', 1),  # a path without data-points
        lambda s: s.replace("</svg>", "text</svg>"),  # stray text
        lambda s: s.replace('data-color="blue"', 'data-color="chartreuse"'),  # unknown colour name
        lambda s: s.replace("0.2 ", "1.5 ", 1),  # pressure out of range
        lambda s: s[:-10],  # truncated
    ],
)
def test_ink_other_content_read_only(mutate):
    text = dump_ink(STROKES).decode("utf-8")
    changed = mutate(text)
    assert changed != text
    assert load_ink(changed.encode("utf-8")) == ([], INK_READ_ONLY_REASON)


def test_ink_parse_rejects_doctype():
    bomb = (
        b'<?xml version="1.0"?>\n<!DOCTYPE lolz [<!ENTITY lol "lol">'
        b'<!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]>\n'
        b'<svg xmlns="http://www.w3.org/2000/svg" data-object-ink="1">&lol2;</svg>\n'
    )
    assert load_ink(bomb) == ([], INK_READ_ONLY_REASON)
    assert load_ink(b"<!doctype svg><svg/>") == ([], INK_READ_ONLY_REASON)


def _bad(**changes):
    strokes = copy.deepcopy(STROKES)
    strokes[0].update(changes)
    return strokes


@pytest.mark.parametrize(
    "strokes",
    [
        _bad(color="blue"),
        _bad(color="#12345"),
        _bad(points=[[0, 0, 1.5]]),
        _bad(id="hl_2"),  # duplicate id
        _bad(id="has space"),
        _bad(d="javascript:alert(1)"),
        _bad(d="M 0 0 <script>"),
        _bad(points=[]),
        _bad(points=[[0, 0]]),
        _bad(points=[[0, float("inf"), 0.5]]),
        _bad(width=0),
        _bad(width=201),
        _bad(tool="eraser"),
        _bad(colorName="chartreuse"),
        "not a list",
    ],
)
def test_validate_strokes_rejects_bad_strokes(strokes):
    with pytest.raises(InkInvalid):
        validate_strokes(strokes)
    with pytest.raises(InkInvalid):
        dump_ink(strokes)  # type: ignore[arg-type]


def test_validate_strokes_accepts_good_strokes():
    validate_strokes(STROKES)
    validate_strokes([])
