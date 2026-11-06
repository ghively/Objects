"""M22 Task 3: the codec of the three work property kinds (``steps``, ``textList``,
``floorItems``), the gate on generic writes of ``steps``, and merges leaving steps alone."""

from __future__ import annotations

import re
import shutil
from datetime import UTC, datetime
from pathlib import Path

import pytest
from objectapp.automations import check_rule
from objectapp.frontmatter import parse_fm, set_keys
from objectapp.merge import merge_objects
from objectapp.propvalues import GATED_KINDS, InvalidValue, decode_value, encode_value
from objectapp.space import Space
from objectapp.typemodel import PropertyDefinition
from objectapp.workmodel import FloorItem, Step
from objectapp.workvalues import (
    STEPS_UNREADABLE,
    UnreadableList,
    encode_floor,
    encode_steps,
    encode_text_list,
    floor_from_api,
    new_id,
    read_floor,
    read_steps,
    read_steps_strict,
    read_text_list,
    step_api,
)

FIXTURE = Path(__file__).parent / "fixtures" / "space-work"
NOW = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)
PRINTER = "Tasks/Printer jams on line 3.md"
BADGE = "Tasks/Badge reader audit.md"
HAND = "Tasks/Hand edited.md"
PARKED = "Tasks/Parked thing.md"
TONER = "Tasks/Order toner.md"
REV_RE = re.compile(r"^[0-9a-f]{12}$")
ID_RE = re.compile(r"^[a-z0-9]{6}$")

STEPS_DEF = PropertyDefinition(id="steps", key="steps", name="Steps", type="steps")
VERIFIED_DEF = PropertyDefinition(id="verified", key="verified", name="Verified", type="textList")
FLOOR_DEF = PropertyDefinition(
    id="floorItems", key="floorItems", name="Floor items", type="floorItems"
)


def _fm_source(path: Path) -> str:
    """The front matter source between the fences (``\\n`` line endings, no BOM)."""
    text = path.read_bytes().decode("utf-8-sig").replace("\r\n", "\n")
    return text.split("---\n", 2)[1]


def _raw(rel: str, key: str):
    return parse_fm(_fm_source(FIXTURE / rel)).get(key)


def _render(key: str, value) -> str:
    return set_keys("", {key: value})


@pytest.fixture
def space(tmp_path: Path) -> Space:
    root = tmp_path / "space"
    shutil.copytree(FIXTURE, root)
    s = Space(root)
    s.clock = lambda: NOW
    task = s.type_by_id("task")
    assert task is not None
    for d in (STEPS_DEF, VERIFIED_DEF, FLOOR_DEF):
        if task.prop(d.key) is None:  # until T6 tops the Task type up with the work fields
            task.propertyDefinitions.append(d)
    return s


def _bytes(space: Space) -> dict[str, bytes]:
    return {
        p.relative_to(space.root).as_posix(): p.read_bytes()
        for p in sorted(space.root.rglob("*"))
        if p.is_file()
    }


# -- reading and encoding steps ------------------------------------------------------------------


def test_round_trip_shapes():
    raw = _raw(PRINTER, "steps")
    values = decode_value(STEPS_DEF, raw)
    assert [v["id"] for v in values] == ["q4m2xa", "r8k1pd", "t2n7vc"]
    assert all(REV_RE.match(v["rev"]) for v in values)
    assert len({v["rev"] for v in values}) == 3
    first = values[0]
    assert first == {
        "id": "q4m2xa",
        "rev": first["rev"],
        "kind": "question",
        "state": "done",
        "text": "Which tray jams most often?",
        "notBefore": None,
        "answer": "Tray 2, mostly in the morning",
        "result": None,
        "addedAt": "2026-11-04T14:02:00.000Z",
        "approvedAt": None,
        "doneAt": "2026-11-04T15:10:00.000Z",
        "declinedAt": None,
    }
    assert [v["kind"] for v in values] == ["question", "approve", "agent"]
    assert [v["state"] for v in values] == ["done", "open", "open"]

    src = _fm_source(FIXTURE / PRINTER)
    encoded = encode_steps(read_steps_strict(raw), new_id)
    assert set_keys(src, {"steps": encoded}) == src  # the same lines: block style, key order
    # the revision is stable across reads and depends on the content
    again = decode_value(STEPS_DEF, raw)
    assert [v["rev"] for v in again] == [v["rev"] for v in values]
    changed = [dict(s) for s in raw]
    changed[1]["text"] = "Restart it twice"
    assert decode_value(STEPS_DEF, changed)[1]["rev"] != values[1]["rev"]


def test_steps_without_ids_get_them_on_encode(space: Space):
    before = _bytes(space)
    raw = _raw(HAND, "steps")
    values = decode_value(STEPS_DEF, raw)
    assert [v["id"] for v in values] == ["@1", "@3"]  # positions in the list
    assert [v["text"] for v in values] == ["Check the label printer cable", "Who reloads the labels?"]
    assert values[0]["state"] == "open" and values[0]["kind"] == "do"
    _of, fm, _v = space.read(HAND)
    assert [v["id"] for v in decode_value(STEPS_DEF, fm["steps"])] == ["@1", "@3"]
    assert _bytes(space) == before  # reading assigns nothing and writes nothing

    steps, _problems = read_steps(raw)
    assert [s.id for s in steps] == [None, None]
    encoded = encode_steps(steps, new_id)
    assert encoded is not None
    ids = [m["id"] for m in encoded]
    assert all(ID_RE.match(i) for i in ids) and len(set(ids)) == 2

    kept = [
        Step(id="abcd12", kind="do", state="open", text="a"),
        Step(id=None, kind="do", state="open", text="b"),
        Step(id="abcd12", kind="do", state="open", text="c"),  # a repeat counts as missing
        Step(id="BAD ID", kind="do", state="open", text="d"),
    ]
    out = encode_steps(kept, new_id)
    assert out is not None
    assert out[0]["id"] == "abcd12"
    assert len({m["id"] for m in out}) == 4 and all(ID_RE.match(m["id"]) for m in out[1:])
    assert encode_steps([], new_id) is None


def test_duplicate_and_bad_ids_read_as_missing():
    raw = [
        {"id": "aaaa11", "kind": "do", "text": "one"},
        {"id": "aaaa11", "kind": "do", "text": "two"},
        {"id": "X!", "kind": "Question", "state": "OPEN", "text": "three"},
        "a scalar is a Do step",
    ]
    values = decode_value(STEPS_DEF, raw)
    assert [v["id"] for v in values] == ["aaaa11", "@2", "@3", "@4"]
    assert values[2]["kind"] == "question" and values[2]["state"] == "open"
    assert values[3]["kind"] == "do" and values[3]["text"] == "a scalar is a Do step"


def test_unreadable_list_refuses_writes_and_keeps_bytes(space: Space):
    before = _bytes(space)
    raw = _raw(HAND, "steps")
    with pytest.raises(UnreadableList) as exc:
        read_steps_strict(raw)
    assert str(exc.value) == STEPS_UNREADABLE
    assert str(exc.value) == "The step list can't be read: fix it in the file first."
    assert exc.value.problems == ['Step 2 has an unknown kind "maybe".']
    steps, problems = read_steps(raw)
    assert problems == ['Step 2 has an unknown kind "maybe".']
    assert [s.text for s in steps] == ["Check the label printer cable", "Who reloads the labels?"]

    for bad, problem in [
        ([{"kind": "do", "text": "x"}, ["a", "list"]], "Step 2 can't be read."),
        ([{"kind": "do", "state": "maybe", "text": "x"}], 'Step 1 has an unknown state "maybe".'),
        ([{"kind": "do", "text": "  "}], "Step 1 has no text."),
        ([{"text": "x"}], "Step 1 has no kind."),
    ]:
        assert read_steps(bad)[1] == [problem]
        with pytest.raises(UnreadableList):
            read_steps_strict(bad)

    # a floor list with an unreadable entry is refused too, so no entry is lost
    stored = [{"id": "f3k9wz", "place": "Line 3"}, "loose text"]
    assert read_floor(stored)[1] == ["Floor item 2 can't be read."]
    with pytest.raises(UnreadableList):
        floor_from_api([{"id": "f3k9wz", "place": "Line 3"}], stored)
    with pytest.raises(InvalidValue, match="can't be read"):
        encode_value(FLOOR_DEF, [{"place": "Line 3"}], stored)
    assert _bytes(space) == before


def test_unknown_step_keys_survive_a_write():
    steps, _ = read_steps(_raw(HAND, "steps"))
    assert steps[1].extra == {"owner": "line lead"}
    encoded = encode_steps(steps, new_id)
    assert encoded is not None
    assert list(encoded[1]) == ["id", "kind", "state", "text", "owner"]
    assert encoded[1]["owner"] == "line lead"
    lines = _render("steps", encoded).splitlines()
    i = lines.index("    text: Who reloads the labels?")
    assert lines[i + 1] == "    owner: line lead"
    # and the step reads back with the key kept
    again, _ = read_steps(parse_fm(_render("steps", encoded))["steps"])
    assert again[1].extra == {"owner": "line lead"}


def test_multiline_answer_is_a_literal_block():
    step = Step(
        id="q4m2xa",
        kind="question",
        state="done",
        text="Which tray?",
        answer="line 1\nline 2",
        doneAt="2026-11-04T15:10:00.000Z",
    )
    text = _render("steps", encode_steps([step], new_id))
    assert text == (
        "steps:\n"
        "  - id: q4m2xa\n"
        "    kind: question\n"
        "    state: done\n"
        "    text: Which tray?\n"
        "    answer: |-\n"
        "      line 1\n"
        "      line 2\n"
        "    doneAt: 2026-11-04T15:10:00.000Z\n"
    )
    assert read_steps(parse_fm(text)["steps"])[0][0].answer == "line 1\nline 2"
    # an answer a literal block can't hold is quoted instead, and still reads back
    odd = Step(id="q4m2xa", kind="question", state="done", text="x", answer="a  \nb")
    back = read_steps(parse_fm(_render("steps", encode_steps([odd], new_id)))["steps"])[0][0]
    assert back.answer == "a  \nb"


# -- lists and floor items -----------------------------------------------------------------------


def test_text_list_and_floor_items():
    assert read_text_list("fact") == ["fact"]
    assert decode_value(VERIFIED_DEF, "fact") == ["fact"]
    assert decode_value(VERIFIED_DEF, None) == []
    assert decode_value(VERIFIED_DEF, _raw(PRINTER, "verified")) == [
        "The spooler log shows 3 crashes on 2026-11-03"
    ]
    assert encode_text_list(["a", "  ", "b", "a"]) == ["a", "b", "a"]  # duplicates allowed
    assert encode_text_list([" "]) is None
    assert encode_value(VERIFIED_DEF, []) is None
    with pytest.raises(InvalidValue, match="One line per item."):
        encode_text_list(["line 1\nline 2"])
    with pytest.raises(InvalidValue):
        encode_text_list(["x" * 501])
    with pytest.raises(InvalidValue):
        encode_text_list(["x"] * 51)
    assert _render("verified", encode_value(VERIFIED_DEF, ["one", "two"])) == (
        "verified:\n  - one\n  - two\n"
    )

    with pytest.raises(InvalidValue, match="A floor item needs a place or what to collect."):
        encode_value(FLOOR_DEF, [{"found": "x"}])
    with pytest.raises(InvalidValue, match="day"):
        encode_value(FLOOR_DEF, [{"place": "Line 3", "collected": "yesterday"}])
    with pytest.raises(InvalidValue, match="day"):
        encode_value(FLOOR_DEF, [{"place": "Line 3", "collected": "2026-02-30"}])

    stored = [
        {
            "id": "f3k9wz",
            "place": "Line 3 printer",
            "what": "Photo of the error panel",
            "collected": "2026-11-05",
            "found": "Code E-12 on the panel",
            "photo": "panel.jpg",
        },
        {"what": "Spooler log"},
    ]
    values = decode_value(FLOOR_DEF, stored)
    assert [v["id"] for v in values] == ["f3k9wz", "@2"]
    assert all(REV_RE.match(v["rev"]) for v in values)
    assert values[0]["collected"] == "2026-11-05" and values[1]["place"] is None
    # an edit through the API form keeps the stored unknown keys and fills the missing id
    values[1]["found"] = "Three crashes"
    encoded = encode_value(FLOOR_DEF, values, stored)
    assert encoded[0]["id"] == "f3k9wz" and encoded[0]["photo"] == "panel.jpg"
    assert list(encoded[0]) == ["id", "place", "what", "collected", "found", "photo"]
    assert ID_RE.match(encoded[1]["id"]) and encoded[1]["found"] == "Three crashes"
    text = _render("floorItems", encoded)
    assert "    collected: 2026-11-05\n" in text  # a day is written plain
    assert encode_floor([], new_id) is None
    item = FloorItem(id=None, place=None, what="Toner box")
    assert list(encode_floor([item], new_id)[0]) == ["id", "what"]


# -- the gate ------------------------------------------------------------------------------------


def test_generic_paths_refuse_steps(space: Space):
    assert GATED_KINDS == frozenset({"steps"})
    with pytest.raises(InvalidValue, match="New steps start open."):
        encode_value(STEPS_DEF, [{"kind": "approve", "state": "approved", "text": "x"}])
    encoded = encode_value(
        STEPS_DEF, [{"kind": "approve", "text": "Restart the spooler"}, {"kind": "do", "text": "Look"}]
    )
    assert [m["kind"] for m in encoded] == ["approve", "do"]
    assert all(m["state"] == "open" and ID_RE.match(m["id"]) for m in encoded)
    with pytest.raises(InvalidValue, match="A step is one line."):
        encode_value(STEPS_DEF, [{"kind": "do", "text": "a\nb"}])
    with pytest.raises(InvalidValue):
        encode_value(STEPS_DEF, [{"kind": "maybe", "text": "a"}])

    for action in (
        {"kind": "setProperty", "key": "steps", "value": [{"kind": "do", "text": "x"}]},
        {"kind": "clearProperty", "key": "steps"},
    ):
        rule = {
            "name": "Touch steps",
            "trigger": {
                "kind": "propertyChanged",
                "scope": {"kind": "type", "id": "task"},
                "propertyKey": "status",
            },
            "actions": [action],
        }
        with pytest.raises(InvalidValue, match="Action 1") as exc:
            check_rule(space, rule)
        assert "can't be set by an automation" in str(exc.value)


def test_update_properties_refuses_steps(space: Space):
    _of, _fm, v = space.read(TONER)
    with pytest.raises(InvalidValue, match="Steps change with the step actions."):
        space.update_properties(TONER, {"steps": [{"kind": "do", "text": "x"}]}, v)


def test_merge_leaves_steps(space: Space):
    sv = space.read(PARKED)[2]
    tv = space.read(TONER)[2]
    result = merge_objects(space, PARKED, TONER, sv, tv, now=NOW)
    assert "steps" in result.dropped
    _of, fm, _v = space.read(TONER)
    assert "steps" not in fm


# -- writes change only their own lines ----------------------------------------------------------


def _changed_lines(before: bytes, after: bytes) -> tuple[list[bytes], list[bytes]]:
    a, b = before.splitlines(keepends=True), after.splitlines(keepends=True)
    removed = [x for x in a if x not in b]
    added = [x for x in b if x not in a]
    return removed, added


def test_only_the_property_lines_change(space: Space):
    path = space.root / PRINTER
    before = path.read_bytes()
    v = space.read(PRINTER)[2]
    space.update_properties(
        PRINTER,
        {"verified": ["The spooler log shows 3 crashes on 2026-11-03", "Tray 2 sensor is dusty"]},
        v,
    )
    after = path.read_bytes()
    removed, added = _changed_lines(before, after)
    assert removed == [b"lastUpdated: 2026-11-04T15:10:00.000Z\n"]
    assert added == [b"lastUpdated: 2026-11-05T12:00:00.000Z\n", b"  - Tray 2 sensor is dusty\n"]
    a, b = before.split(b"\n"), after.split(b"\n")
    i = b.index(b"verified:")
    assert b[i + 1 : i + 3] == [
        b"  - The spooler log shows 3 crashes on 2026-11-03",
        b"  - Tray 2 sensor is dusty",
    ]
    assert b[i + 3] == b"steps:"
    restored = after.replace(b"  - Tray 2 sensor is dusty\n", b"").replace(
        b"lastUpdated: 2026-11-05T12:00:00.000Z\n", b"lastUpdated: 2026-11-04T15:10:00.000Z\n"
    )
    assert restored == before and len(a) + 1 == len(b)  # every other byte as it was

    badge = space.root / BADGE
    before = badge.read_bytes()
    v = space.read(BADGE)[2]
    space.update_properties(BADGE, {"verified": ["Two readers at the east door"]}, v)
    after = badge.read_bytes()
    assert after.startswith(b"\xef\xbb\xbf---\r\n")
    assert b"\n" not in after.replace(b"\r\n", b"")  # every line still ends in CRLF
    removed, added = _changed_lines(before, after)
    assert removed == [b"lastUpdated: 2026-11-02T09:00:00.000Z\r\n"]
    assert added == [
        b"lastUpdated: 2026-11-05T12:00:00.000Z\r\n",
        b"verified:\r\n",
        b"  - Two readers at the east door\r\n",
    ]
    assert after.index(b"verified:") < after.index(b"---\r\n## Description")
    # the steps of the file are untouched and still read the same
    assert decode_value(STEPS_DEF, space.read(BADGE)[1]["steps"])[0]["id"] == "b7c2nd"
