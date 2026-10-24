"""Per-kind value codec (Task 2): encode, decode, convert, label lookup."""

import pytest

from objectapp.frontmatter import parse_fm, set_keys
from objectapp.propvalues import (
    InvalidValue,
    convert_value,
    decode_value,
    encode_updates,
    encode_value,
    label_lookup,
)
from objectapp.typemodel import PropertyDefinition, system_property_defs

BASE = "title: X\n"
SYS = {p.key: p for p in system_property_defs(include_type=True)}
ROCKET = "\U0001f680"


def pdef(key, kind, **options):
    return PropertyDefinition.from_json(
        {"id": key, "key": key, "name": key, "type": kind, "options": options}
    )


STATUS = pdef(
    "s",
    "label",
    set=[
        {"id": "ns", "text": "Not Started", "color": "red"},
        {"id": "ip", "text": "In Progress", "color": "blue"},
    ],
)
MULTI_LABEL = pdef("l", "label", isArray=True, set=[{"id": "a", "text": "A", "color": None}])
ENTITY_ONE = pdef("o", "entity", isArray=False)
ENTITY_MANY = pdef("m", "entity")
DAY = pdef("d", "datetime", constraints={"resolutionPreference": "day"})
DAY_ONLY = pdef("d", "datetime", constraints={"resolutionConstraint": "day"})
DATE = pdef("d", "datetime")

# (definition, API value, exact lines appended to BASE)
ROWS = [
    (pdef("t", "text"), "hello", "t: hello\n"),
    (pdef("t", "text"), "a: b", "t: 'a: b'\n"),
    (pdef("t", "textBlock"), "some *md*", "t: some *md*\n"),
    (pdef("t", "url"), "https://example.org/x", "t: https://example.org/x\n"),
    (pdef("b", "blocks"), "# H\n- [ ] x", "b: |-\n  # H\n  - [ ] x\n"),
    (pdef("b", "simpleTableBlock"), "| a |\n|---|", "b: |-\n  | a |\n  |---|\n"),
    (pdef("n", "number"), 1200.5, "n: 1200.5\n"),
    (pdef("n", "number"), 3, "n: 3\n"),
    (pdef("c", "boolean"), True, "c: true\n"),
    (DATE, {"start": "2026-10-30", "resolution": "day"}, "d: 2026-10-30\n"),
    (
        DATE,
        {"start": "2026-10-30T14:00:00.000Z", "resolution": "time"},
        "d: 2026-10-30T14:00:00.000Z\n",
    ),
    (
        DATE,
        {"start": "2026-10-30", "end": "2026-11-02", "resolution": "day"},
        "d: 2026-10-30 -> 2026-11-02\n",
    ),
    (ENTITY_ONE, [{"target": "Ada Lovelace", "path": None}], "o: '[[Ada Lovelace]]'\n"),
    (
        ENTITY_MANY,
        [{"target": "A", "path": None}, {"target": "B", "path": None}],
        "m: ['[[A]]', '[[B]]']\n",
    ),
    (STATUS, ["Not Started"], "s: Not Started\n"),
    (MULTI_LABEL, ["A"], "l: [A]\n"),
    (SYS["tags"], ["Docs", "Math"], "tags: [Docs, Math]\n"),
    (SYS["aliases"], ["Ada"], "aliases: [Ada]\n"),
    (SYS["description"], "Short text", "description: Short text\n"),
    (
        SYS["icon"],
        {"type": "iconify", "val": "ph-user", "color": "blue"},
        "icon: ph-user\niconColor: blue\n",
    ),
    (SYS["icon"], {"type": "emoji", "val": ROCKET}, f"icon: {ROCKET}\n"),
    (
        pdef("coverImage", "coverImage"),
        "Attachments/cover.png",
        "coverImage: Attachments/cover.png\n",
    ),
    (pdef("color", "color"), "bg-blue", "color: bg-blue\n"),
]
IDS = [f"{r[0].type}-{i}" for i, r in enumerate(ROWS)]


def _write(p, value, src=BASE):
    updates, removals = encode_updates(p, value, parse_fm(src))
    assert not removals
    return set_keys(src, updates)


@pytest.mark.parametrize(("p", "value", "lines"), ROWS, ids=IDS)
def test_set_keys_bytes_per_kind(p, value, lines):
    assert _write(p, value) == BASE + lines


@pytest.mark.parametrize(("p", "value", "lines"), ROWS, ids=IDS)
def test_roundtrip_each_kind(p, value, lines):
    fm = parse_fm(_write(p, value))
    assert decode_value(p, fm[p.key], fm) == value


def test_encode_value_single_key():
    assert encode_value(pdef("t", "text"), "hello") == "hello"
    assert encode_value(SYS["icon"], {"type": "emoji", "val": ROCKET}) == ROCKET
    assert encode_value(pdef("color", "color"), "blue") == "bg-blue"
    with pytest.raises(InvalidValue):
        encode_value(pdef("color", "color"), "bg-mauve")


def test_clear_values_encode_none():
    for p in (pdef("t", "text"), pdef("n", "number"), STATUS, ENTITY_MANY, SYS["tags"], DATE):
        assert encode_value(p, None) is None
    assert encode_value(SYS["tags"], []) is None
    assert encode_value(pdef("t", "text"), "") is None
    assert set_keys("t: a\n", {"t": encode_value(pdef("t", "text"), None)}) == "t: null\n"


def test_clear_icon_color_is_removed():
    updates, removals = encode_updates(
        SYS["icon"], {"type": "emoji", "val": ROCKET}, {"iconColor": "red"}
    )
    assert updates == {"icon": ROCKET} and removals == ["iconColor"]


def test_existing_list_form_kept_for_single_label():
    assert encode_value(STATUS, ["Not Started"], ["In Progress"]) == ["Not Started"]


def test_decode_range():
    assert decode_value(DATE, "2026-10-30 -> 2026-11-02") == {
        "start": "2026-10-30",
        "end": "2026-11-02",
        "resolution": "day",
    }
    assert decode_value(DATE, "2026-10-30T14:00:00Z -> 2026-10-30T15:30:00.000Z") == {
        "start": "2026-10-30T14:00:00.000Z",
        "end": "2026-10-30T15:30:00.000Z",
        "resolution": "time",
    }
    assert decode_value(DATE, "not a date") is None
    assert decode_value(DATE, None) is None


def test_midnight_utc_on_day_property_decodes_as_day():
    raw = "2026-03-26T00:00:00.000Z -> 2026-03-26T00:00:00.000Z"
    assert decode_value(DAY, raw) == {
        "start": "2026-03-26",
        "end": "2026-03-26",
        "resolution": "day",
    }
    assert decode_value(DATE, raw) == {
        "start": "2026-03-26T00:00:00.000Z",
        "end": "2026-03-26T00:00:00.000Z",
        "resolution": "time",
    }


def test_day_value_keeps_timestamp_form():
    src = "d: 2026-03-26T00:00:00.000Z -> 2026-03-26T00:00:00.000Z\n"
    value = {"start": "2026-03-27", "end": "2026-03-27", "resolution": "day"}
    out = set_keys(src, {"d": encode_value(DAY, value, parse_fm(src)["d"])})
    assert out == "d: 2026-03-27T00:00:00.000Z -> 2026-03-27T00:00:00.000Z\n"
    assert set_keys(BASE, {"d": encode_value(DAY, value)}) == BASE + "d: 2026-03-27 -> 2026-03-27\n"
    assert encode_value(DAY, {"start": "2026-03-27", "resolution": "day"}) == "2026-03-27"


def test_time_normalised_to_utc_millis():
    value = {"start": "2026-10-30T16:00:00+02:00", "resolution": "time"}
    assert encode_value(DATE, value) == "2026-10-30T14:00:00.000Z"


def test_label_matches_case_insensitively():
    assert encode_value(STATUS, ["not started"]) == "Not Started"
    assert encode_value(STATUS, ["ip"]) == "In Progress"
    assert label_lookup(STATUS, "  in progress ").text == "In Progress"
    assert label_lookup(STATUS, "nope") is None
    assert decode_value(STATUS, "not started") == ["Not Started"]


def test_label_unknown_text_422():
    with pytest.raises(InvalidValue):
        encode_value(STATUS, ["Someday"])


def test_label_single_rejects_two_422():
    with pytest.raises(InvalidValue):
        encode_value(STATUS, ["Not Started", "In Progress"])


def test_entity_single_rejects_two_422():
    with pytest.raises(InvalidValue):
        encode_value(ENTITY_ONE, [{"target": "A", "path": None}, {"target": "B", "path": None}])


def test_entity_link_text_from_path_and_resolver():
    refs = [{"target": "Untitled", "path": "Notes/Untitled.md"}]
    assert encode_value(ENTITY_ONE, refs, link_for=lambda ref: "Notes/Untitled") == (
        "[[Notes/Untitled]]"
    )
    assert encode_value(ENTITY_ONE, [{"target": "", "path": "Notes/Untitled.md"}]) == (
        "[[Notes/Untitled]]"
    )
    assert decode_value(ENTITY_MANY, ["[[A|alias]]", "[[B]]"]) == [
        {"target": "A", "path": None},
        {"target": "B", "path": None},
    ]
    assert decode_value(ENTITY_ONE, "[[A]]") == [{"target": "A", "path": None}]


def test_aliases_max_8_and_unique_422():
    with pytest.raises(InvalidValue):
        encode_value(SYS["aliases"], [f"a{i}" for i in range(9)])
    with pytest.raises(InvalidValue):
        encode_value(SYS["aliases"], ["Ada", "ada"])
    eight = [f"a{i}" for i in range(8)]
    assert encode_value(SYS["aliases"], eight) == eight


def test_number_rejects_string_422():
    for bad in ("12", True, float("nan")):
        with pytest.raises(InvalidValue):
            encode_value(pdef("n", "number"), bad)


def test_day_constraint_rejects_time_value_422():
    with pytest.raises(InvalidValue):
        encode_value(DAY_ONLY, {"start": "2026-10-30T14:00:00.000Z", "resolution": "time"})


def test_end_time_settings_enforced_422():
    req = pdef("d", "datetime", constraints={"endTimeSettings": "required"})
    no = pdef("d", "datetime", constraints={"endTimeSettings": "notAllowed"})
    with pytest.raises(InvalidValue):
        encode_value(req, {"start": "2026-10-30", "resolution": "day"})
    with pytest.raises(InvalidValue):
        encode_value(no, {"start": "2026-10-30", "end": "2026-10-31", "resolution": "day"})
    with pytest.raises(InvalidValue):
        encode_value(DATE, {"start": "2026-10-31", "end": "2026-10-30", "resolution": "day"})


def test_read_only_system_kinds_422():
    for key in ("title", "type", "createdAt", "lastUpdated", "collections"):
        with pytest.raises(InvalidValue):
            encode_value(SYS[key], "x")


def test_convert_entity_to_label_lossy():
    dst = pdef("l", "label")
    value, lossy = convert_value(ENTITY_MANY, dst, ["[[Alpha]]", "[[Beta]]"])
    assert value == ["Alpha"] and lossy
    assert [o["text"] for o in dst.options["set"]] == ["Alpha"]
    multi = pdef("l", "label", isArray=True)
    value, lossy = convert_value(ENTITY_MANY, multi, ["[[Alpha]]", "[[Beta]]"])
    assert value == ["Alpha", "Beta"] and lossy
    assert all(o["color"] for o in multi.options["set"])


def test_convert_string_to_boolean_table():
    dst, src = pdef("c", "boolean"), pdef("t", "text")
    table = {
        "true": (True, False),
        "Yes": (True, False),
        "1": (True, False),
        "false": (False, False),
        "no": (False, False),
        "0": (False, False),
        "": (False, False),
        "maybe": (False, True),
    }
    for raw, expected in table.items():
        assert convert_value(src, dst, raw) == expected, raw


def test_convert_other_transforms():
    text, num = pdef("t", "text"), pdef("n", "number")
    assert convert_value(text, num, "12.5") == (12.5, False)
    assert convert_value(text, num, "abc") == (None, True)
    assert convert_value(num, text, 3) == ("3", False)
    assert convert_value(STATUS, text, "Not Started") == ("Not Started", False)
    assert convert_value(MULTI_LABEL, text, ["A", "B"]) == ("A, B", False)
    assert convert_value(DATE, text, "2026-10-30 -> 2026-11-02") == (
        "2026-10-30 -> 2026-11-02",
        False,
    )
    simple = pdef("d", "datetimeSimple")
    assert convert_value(DATE, simple, "2026-10-30") == (
        {"start": "2026-10-30", "resolution": "day"},
        False,
    )
    lab = pdef("l", "label", set=[{"id": "x", "text": "Done", "color": "green"}])
    assert convert_value(text, lab, "  done ") == (["Done"], False)
    assert len(lab.options["set"]) == 1
    assert convert_value(pdef("c", "boolean"), text, True) == ("true", False)
    with pytest.raises(InvalidValue):
        convert_value(num, pdef("c", "boolean"), 1)
