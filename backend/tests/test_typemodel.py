import hashlib
import json
from pathlib import Path

import pytest

from objectapp.space import Space
from objectapp.typemodel import (
    BUILTIN_TYPES,
    THEME_COLORS,
    Icon,
    RevisionConflict,
    TypeDefinition,
    TypeReadOnly,
    load_types,
    system_property_defs,
    topup_task_type,
    type_revision,
    write_type_json,
)

SYSTEM_ORDER = [
    "title",
    "collections",
    "description",
    "createdAt",
    "lastUpdated",
    "tags",
    "icon",
    "aliases",
]


def _v1_task() -> dict:
    """A type as M1 wrote it (no schemaVersion), plus an unknown key and field."""
    return {
        "id": "task",
        "name": "Task",
        "pluralName": "Tasks",
        "folder": "Tasks",
        "icon": "ph-check-circle",
        "color": "blue",
        "foo": {"bar": [1, 2]},
        "propertyDefinitions": [
            {"id": "tags", "key": "tags", "name": "Tags", "type": "label", "isArray": True},
            {"id": "status", "key": "status", "name": "Status", "type": "label", "isArray": False},
            {
                "id": "owner",
                "key": "owner",
                "name": "Owner",
                "type": "entity",
                "isArray": False,
                "extra": 1,
            },
            {"id": "due", "key": "due", "name": "Due", "type": "datetime", "isArray": False},
        ],
    }


def _write_types(root: Path, *types: dict) -> Path:
    d = root / ".capacities" / "types"
    d.mkdir(parents=True, exist_ok=True)
    for t in types:
        (d / f"{t['id']}.json").write_text(json.dumps(t, indent=2) + "\n", encoding="utf-8")
    return d


def _v1_sample_types(root: Path) -> Path:
    """The M1-shaped type JSON for the sample space."""
    return _write_types(
        root,
        _v1_task(),
        {
            "id": "server",
            "name": "Server",
            "pluralName": "Servers",
            "folder": "Servers",
            "icon": "ph-hard-drives",
            "color": "teal",
            "propertyDefinitions": [
                {"id": "tags", "key": "tags", "name": "Tags", "type": "label", "isArray": True},
                {"id": "cores", "key": "cores", "name": "Cores", "type": "number", "isArray": False},
                {"id": "owner", "key": "owner", "name": "Owner", "type": "entity", "isArray": False},
            ],
        },
        {
            "id": "page",
            "name": "Page",
            "pluralName": "Pages",
            "folder": "Pages",
            "icon": "ph-file-text",
            "color": "purple",
            "propertyDefinitions": [],
        },
    )


def _snapshot(root: Path) -> dict[str, tuple[str, int]]:
    out = {}
    for p in root.rglob("*"):
        if p.is_file():
            out[p.relative_to(root).as_posix()] = (
                hashlib.sha256(p.read_bytes()).hexdigest(),
                p.stat().st_mtime_ns,
            )
    return out


def _by_id(types):
    return {t.id: t for t in types}


def test_migrate_v1_preserves_every_property():
    t = TypeDefinition.from_json(_v1_task())
    out = t.to_json()
    assert out["schemaVersion"] == 2
    assert out["foo"] == {"bar": [1, 2]}
    props = {p["key"]: p for p in out["propertyDefinitions"]}
    assert props["owner"]["extra"] == 1
    assert props["owner"]["id"] == "owner"
    assert props["owner"]["type"] == "entity"
    assert props["owner"]["options"]["isArray"] is False
    assert props["status"]["type"] == "label"
    assert props["status"]["options"]["isArray"] is False
    assert props["due"]["type"] == "datetime"
    assert "isArray" not in props["owner"] and "isArray" not in props["status"]
    # system defs are inserted, in order, before the type's own properties
    keys = [p["key"] for p in out["propertyDefinitions"]]
    assert keys[: len(SYSTEM_ORDER)] == SYSTEM_ORDER
    assert keys[len(SYSTEM_ORDER) :] == ["status", "owner", "due"]
    assert out["basic"] is True  # Task
    # default icons come from Capacities' propertyIcons
    assert props["due"]["icon"] == {"type": "iconify", "val": "ph-calendar"}
    assert props["owner"]["icon"] == {"type": "iconify", "val": "ph-file-text"}
    # round trip is stable
    assert TypeDefinition.from_json(out).to_json() == out


def test_bad_property_entry_preserved(tmp_path):
    data = _v1_task()
    data["propertyDefinitions"].insert(1, "oops")
    data["propertyDefinitions"].append({"name": "no key"})
    t = TypeDefinition.from_json(data)
    out = t.to_json()
    assert "oops" in out["propertyDefinitions"]
    assert {"name": "no key"} in out["propertyDefinitions"]
    assert t.prop("status") is not None
    # through load_types, too
    _write_types(tmp_path, data)
    (types, unreadable) = load_types(tmp_path, inferred=[])
    assert unreadable == []
    task = _by_id(types)["task"]
    written = json.loads((tmp_path / ".capacities/types/task.json").read_text("utf-8"))
    assert "oops" in written["propertyDefinitions"]
    assert task.prop("owner") is not None
    # the API shape carries no Python-only attributes
    api = task.to_api("rev")
    assert "extra" not in api and "invalid_property_entries" not in api
    assert api["revision"] == "rev" and api["readOnlyReason"] is None


def test_migrate_backs_up_v1_and_writes_once(space_dir):
    types_dir = _v1_sample_types(space_dir)
    original = (types_dir / "task.json").read_bytes()
    Space(space_dir)
    backup = space_dir / ".capacities" / "backup" / "types-v1" / "task.json"
    assert backup.read_bytes() == original
    written = (types_dir / "task.json").read_bytes()
    assert json.loads(written)["schemaVersion"] == 2
    assert written.endswith(b"}\n") and b"\r\n" not in written
    assert json.loads(written) == json.loads(json.dumps(json.loads(written), indent=2))

    before = _snapshot(space_dir / ".capacities")
    Space(space_dir)
    assert _snapshot(space_dir / ".capacities") == before


def test_unparseable_type_file_untouched(space_dir):
    types_dir = _v1_sample_types(space_dir)
    bad = types_dir / "server.json"
    bad.write_bytes(b'{"id": "server",')
    before = (bad.read_bytes(), bad.stat().st_mtime_ns)
    s = Space(space_dir)
    assert (bad.read_bytes(), bad.stat().st_mtime_ns) == before
    assert not (space_dir / ".capacities" / "backup" / "types-v1" / "server.json").exists()
    assert [u.id for u in s.unreadable_types] == ["server"]
    servers = [t for t in s.types if t.id == "server"]
    assert len(servers) == 1  # no inferred type in its place
    assert servers[0].readOnlyReason
    assert s.get("Servers/Alpha.md").type == "server"
    with pytest.raises(TypeReadOnly):
        write_type_json(space_dir, servers[0], type_revision(space_dir, "server"))
    # even a clean definition can't replace the unreadable file
    clean = TypeDefinition.from_json({"id": "server", "name": "Server", "schemaVersion": 2})
    with pytest.raises(TypeReadOnly):
        write_type_json(space_dir, clean, type_revision(space_dir, "server"))
    assert bad.read_bytes() == before[0]


def test_unparseable_non_object_type_file(tmp_path):
    _write_types(tmp_path)
    (tmp_path / ".capacities/types/list.json").write_text("[1, 2]\n", encoding="utf-8")
    types, unreadable = load_types(tmp_path, inferred=[])
    assert [u.id for u in unreadable] == ["list"]
    assert "list" not in _by_id(types)


def test_open_writes_no_md_files(space_dir):
    _v1_sample_types(space_dir)
    md = {p: v for p, v in _snapshot(space_dir).items() if p.endswith(".md")}
    s = Space(space_dir)
    for summary in s.list(None):
        s.read(summary.path)
    Space(space_dir)
    assert {p: v for p, v in _snapshot(space_dir).items() if p.endswith(".md")} == md


def test_inferred_type_not_written_on_open(space_dir):
    _v1_sample_types(space_dir)
    (space_dir / "Gadgets").mkdir()
    (space_dir / "Gadgets" / "Widget.md").write_bytes(b"---\ntype: 'Gadget'\ntitle: Widget\n---\n")
    s = Space(space_dir)
    gadget = _by_id(s.types).get("gadget")
    assert gadget is not None and gadget.folder == "Gadgets"
    assert s.get("Gadgets/Widget.md").type == "gadget"
    assert not (space_dir / ".capacities" / "types" / "gadget.json").exists()
    assert type_revision(space_dir, "gadget") == ""


def test_v1_tags_label_becomes_system_tags():
    t = TypeDefinition.from_json(_v1_task())
    tags = t.prop("tags")
    assert tags.type == "entity_tags" and tags.id == "tags"
    assert tags.options["isArray"] is True
    assert tags.options["allowedTypes"] == ["tag"]
    assert tags.icon == Icon("iconify", "ph-tag")
    assert [p.key for p in t.propertyDefinitions].count("tags") == 1


def test_icon_string_becomes_iconify():
    t = TypeDefinition.from_json(_v1_task())
    assert t.icon == Icon("iconify", "ph-check-circle")
    assert t.to_json()["icon"] == {"type": "iconify", "val": "ph-check-circle"}
    assert Icon.parse("🚀") == Icon("emoji", "🚀")
    assert Icon.parse({"type": "iconify", "val": "ph-tag", "color": "red"}).color == "red"
    assert Icon.parse(None) is None


def test_inferred_status_label_has_options_and_categories(space_dir):
    s = Space(space_dir)
    status = _by_id(s.types)["task"].prop("status")
    assert status.options.get("isStatus") is True
    by_text = {o["text"]: o for o in status.options["set"]}
    assert by_text["Not Started"]["statusCategory"] == "not-started"
    assert by_text["In Progress"]["statusCategory"] == "in-progress"
    assert all(o["color"] in THEME_COLORS for o in status.options["set"])

    (space_dir / "Projects").mkdir()
    for i, st in enumerate(["Open", "Closed"]):
        (space_dir / "Projects" / f"P{i}.md").write_bytes(
            f"---\ntype: 'Project'\nstatus: {st}\n---\n".encode()
        )
    s = Space(space_dir)
    project_status = _by_id(s.types)["project"].prop("status")
    assert project_status.type == "label"
    assert "isStatus" not in project_status.options
    assert [o["text"] for o in project_status.options["set"]] == ["Open", "Closed"]
    assert all("statusCategory" not in o for o in project_status.options["set"])


def test_migrated_v1_label_gets_observed_options(space_dir):
    _v1_sample_types(space_dir)
    s = Space(space_dir)
    status = _by_id(s.types)["task"].prop("status")
    assert status.options["isStatus"] is True
    assert {o["text"] for o in status.options["set"]} == {"Not Started", "In Progress"}


def test_inferred_day_dates_prefer_day(space_dir):
    (space_dir / "Events").mkdir()
    (space_dir / "Events" / "A.md").write_bytes(
        b"---\ntype: 'Event'\nwhen: 2026-10-30\nat: 2026-10-30T14:00:00.000Z\n---\n"
    )
    (space_dir / "Events" / "B.md").write_bytes(
        b"---\ntype: 'Event'\nwhen: 2026-03-26T00:00:00.000Z\nat: 2026-10-30\n---\n"
    )
    s = Space(space_dir)
    event = _by_id(s.types)["event"]
    when = event.prop("when")
    assert when.type == "datetime"
    assert when.options["constraints"]["resolutionPreference"] == "day"
    at = event.prop("at")
    assert at.type == "datetime"
    assert "constraints" not in at.options
    daily = _by_id(s.types)["dailynote"].prop("date")
    assert daily.options["constraints"]["resolutionPreference"] == "day"


def test_media_types_basic():
    t = TypeDefinition.from_json(
        {
            "id": "weblink",
            "name": "Weblink",
            "pluralName": "Weblinks",
            "folder": "Weblinks",
            "icon": "ph-cube",
            "color": "blue",
            "propertyDefinitions": [
                {"id": k, "key": k, "name": k, "type": "text", "isArray": False}
                for k in ("url", "domain", "iframeUrl", "previewImage")
            ]
            + [{"id": "rating", "key": "rating", "name": "Rating", "type": "number"}],
        }
    )
    assert t.basic is True
    for k in ("url", "domain", "iframeUrl", "previewImage"):
        p = t.prop(k)
        assert p is not None and p.id == p.key == k
    assert t.prop("url").type == "url" and t.prop("domain").type == "text"
    assert TypeDefinition.from_json({"id": "gadget", "name": "Gadget"}).basic is False
    assert TypeDefinition.from_json({"id": "x", "name": "weblink"}).basic is True


def test_save_type_conflict_on_stale_revision(tmp_path):
    t = TypeDefinition.from_json({"id": "gadget", "name": "Gadget", "folder": "Gadgets"})
    with pytest.raises(RevisionConflict) as exc:
        write_type_json(tmp_path, t, "stale")
    assert exc.value.current_revision == ""
    rev = write_type_json(tmp_path, t, "")
    path = tmp_path / ".capacities" / "types" / "gadget.json"
    assert rev == hashlib.sha256(path.read_bytes()).hexdigest() == type_revision(tmp_path, "gadget")
    t.description = "Things"
    with pytest.raises(RevisionConflict) as exc:
        write_type_json(tmp_path, t, "")
    assert exc.value.current_revision == rev
    before = path.read_bytes()
    with pytest.raises(RevisionConflict):
        write_type_json(tmp_path, t, "0" * 64)
    assert path.read_bytes() == before
    rev2 = write_type_json(tmp_path, t, rev)
    assert rev2 != rev
    assert json.loads(path.read_text("utf-8"))["description"] == "Things"


def test_tag_and_page_builtin_present(space_dir):
    _write_types(space_dir, _v1_task())  # types/ exists, without Page or Tag
    s = Space(space_dir)
    types = _by_id(s.types)
    assert set(BUILTIN_TYPES) == {"page", "tag"}
    tag, page = types["tag"], types["page"]
    assert tag.folder == "Tags" and tag.icon == Icon("iconify", "ph-tag") and tag.basic
    assert tag.prop("color") is not None and tag.prop("color").type == "color"
    assert page.basic and page.folder == "Pages"
    types_dir = space_dir / ".capacities" / "types"
    assert (types_dir / "tag.json").is_file() and (types_dir / "page.json").is_file()
    # the Tags folder is created by the first tag, never on open
    assert not (space_dir / "Tags").exists()
    before = _snapshot(space_dir)
    Space(space_dir)
    assert _snapshot(space_dir) == before


def test_type_matches_former_names(space_dir):
    _v1_sample_types(space_dir)
    data = json.loads((space_dir / ".capacities/types/server.json").read_text("utf-8"))
    data.update(schemaVersion=2, name="Machine", formerNames=["Server"])
    (space_dir / ".capacities/types/server.json").write_text(json.dumps(data), encoding="utf-8")
    s = Space(space_dir)
    assert s.get("Servers/Alpha.md").type == "server"
    assert "machine" not in _by_id(s.types)
    assert sum(1 for t in s.types if t.id == "server") == 1


def test_system_property_defs_order():
    assert [p.key for p in system_property_defs()] == SYSTEM_ORDER
    defs = system_property_defs(include_type=True)
    assert defs[-1].key == "type" and defs[-1].type == "entity_type"
    assert all(p.id == p.key for p in defs)


def test_api_space_returns_v2_types(space_dir):
    from fastapi.testclient import TestClient

    from objectapp.server import create_app

    client = TestClient(create_app(Space(space_dir), None))
    types = {t["id"]: t for t in client.get("/api/space").json()["types"]}
    task = types["task"]
    assert task["schemaVersion"] == 2
    assert task["icon"] == {"type": "iconify", "val": "ph-check-circle"}
    assert task["revision"] == type_revision(space_dir, "task") != ""
    assert task["readOnlyReason"] is None
    assert "extra" not in task and "invalid_property_entries" not in task
    assert "tag" in types and "page" in types


# -- M4 Task 3: the Task fields, topped up in memory --------------------------------

_TASK_FIELDS = ("status", "priority", "date", "deadline", "completed", "repeat", "remind")


def test_topup_adds_missing_task_fields_in_memory(calendar_space_dir):
    path = calendar_space_dir / ".capacities" / "types" / "task.json"
    data = json.loads(path.read_text("utf-8"))
    data["propertyDefinitions"] = [
        p for p in data["propertyDefinitions"] if p["key"] not in _TASK_FIELDS[1:]
    ]
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    before = path.read_bytes()

    space = Space(calendar_space_dir)
    t = space.type_by_id("task")
    keys = [p.key for p in t.propertyDefinitions]
    # appended after the existing ones (M8's hidden `occurrenceLog` last)
    assert keys[-7:] == [*_TASK_FIELDS[1:], "occurrenceLog"]
    assert t.prop("priority").options["set"][2] == {
        "id": "high", "text": "High", "color": "red", "icon": None
    }  # fmt: skip
    assert t.prop("priority").icon.val == "ph-flag"
    date = t.prop("date")
    assert date.type == "datetimeSimple" and date.icon.val == "ph-calendar"
    assert date.options["constraints"] == {
        "resolutionPreference": "day", "endTimeSettings": "notAllowed", "supportsReminders": True
    }  # fmt: skip
    assert t.prop("deadline").icon.val == "ph-hourglass-medium"
    assert t.prop("completed").visibility == "hidden"
    assert t.prop("completed").options["constraints"]["resolutionPreference"] == "time"
    assert t.prop("repeat").type == "text" and t.prop("repeat").visibility == "hidden"
    assert t.prop("remind").type == "text" and t.prop("remind").visibility == "hidden"
    assert path.read_bytes() == before  # never written on open

    # A type file changed outside the app is topped up again when reloaded.
    data["description"] = "edited by hand"
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    t2, _rev = space.refresh_type("task")
    assert t2.description == "edited by hand"
    assert [p.key for p in t2.propertyDefinitions][-7:] == [*_TASK_FIELDS[1:], "occurrenceLog"]

    # Saving the type persists the fields (the first write of the type).
    t3, rev = space.refresh_type("task")
    space.save_type(t3, rev)
    saved = {p["key"] for p in json.loads(path.read_text("utf-8"))["propertyDefinitions"]}
    assert saved >= set(_TASK_FIELDS)


def test_topup_keeps_existing_definitions(calendar_space_dir):
    path = calendar_space_dir / ".capacities" / "types" / "task.json"
    data = json.loads(path.read_text("utf-8"))
    prio = next(p for p in data["propertyDefinitions"] if p["key"] == "priority")
    prio["options"]["set"] = [{"id": "p1", "text": "P1", "color": "red", "icon": None}]
    data["propertyDefinitions"] = [
        p for p in data["propertyDefinitions"] if p["key"] not in ("deadline", "remind")
    ]
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

    t = Space(calendar_space_dir).type_by_id("task")
    assert [o["text"] for o in t.prop("priority").options["set"]] == ["P1"]
    keys = [p.key for p in t.propertyDefinitions]
    assert keys.count("priority") == 1
    assert keys[-3:] == ["deadline", "remind", "occurrenceLog"]  # M8 adds the log last


def test_topup_not_applied_to_other_types(calendar_space_dir):
    space = Space(calendar_space_dir)
    for tid in ("page", "meeting", "person", "dailynote", "event", "tag"):
        t = space.type_by_id(tid)
        stored = json.loads(
            (calendar_space_dir / ".capacities" / "types" / f"{tid}.json").read_text("utf-8")
        )
        assert [p.key for p in t.propertyDefinitions] == [
            p["key"] for p in stored["propertyDefinitions"]
        ], tid


# -- media types: the fields Capacities defines beyond ours (polish audit item 29) ----


def _media(name: str, keys=()):
    return TypeDefinition.from_json(
        {
            "schemaVersion": 2, "id": name.lower(), "name": name, "pluralName": name + "s",
            "folder": name + "s", "basic": True, "icon": {"type": "iconify", "val": "ph-cube"},
            "color": "gray",
            "propertyDefinitions": [
                {"id": k, "key": k, "name": k, "type": "text", "description": "",
                 "icon": {"type": "iconify", "val": "ph-text-align-left"},
                 "visibility": "alwaysShow", "options": {}}
                for k in keys
            ],
        }
    )  # fmt: skip


@pytest.mark.parametrize(
    "name,expected",
    [
        ("PDF", {"numberOfPages": "number", "tableOfContents": "boolean",
                 "documentType": "label", "topic": "label"}),
        ("Image", {"category": "label", "colors": "label"}),
        ("Weblink", {"category": "label", "topic": "label"}),
        ("Audio", {"duration": "number", "origin": "text", "category": "label"}),
    ],
)  # fmt: skip
def test_topup_adds_capacities_media_fields(name, expected):
    t = topup_task_type(_media(name))
    for key, kind in expected.items():
        assert t.prop(key) is not None and t.prop(key).type == kind, key
    n = len(t.propertyDefinitions)
    topup_task_type(t)
    assert len(t.propertyDefinitions) == n  # idempotent


def test_topup_media_keeps_an_existing_definition():
    t = topup_task_type(_media("Image", keys=("category",)))
    assert [p.key for p in t.propertyDefinitions].count("category") == 1
    assert t.prop("category").type == "text"  # the stored one wins


@pytest.mark.parametrize(
    "name,key,first,count",
    [
        ("PDF", "documentType", ("academic-paper", "Academic paper"), 15),
        ("PDF", "topic", ("ai-ml", "AI/ML"), 20),
        ("Image", "category", ("book-page", "Book Page"), 27),
        ("Image", "colors", ("beige", "Beige"), 21),
        ("Weblink", "category", ("about", "About"), 31),
        ("Weblink", "topic", ("academic", "Academic"), 29),
        ("Audio", "category", ("ambient", "Ambient"), 10),
    ],
)  # fmt: skip
def test_topup_media_labels_get_capacities_option_sets(name, key, first, count):
    """Item 19: the label fields start with Capacities' own sets (ids and en-US texts)."""
    p = topup_task_type(_media(name)).prop(key)
    opts = p.options["set"]
    assert len(opts) == count
    assert (opts[0]["id"], opts[0]["text"]) == first
    assert len({o["id"] for o in opts}) == count
    assert all(o["color"] for o in opts)


def test_topup_media_colors_label_uses_matching_theme_colours():
    opts = {o["id"]: o for o in topup_task_type(_media("Image")).prop("colors").options["set"]}
    assert opts["blue"]["color"] == "blue" and opts["gray"]["color"] == "gray"


def test_media_label_set_is_editable_through_save_type(space_dir):
    """A basic media type's label set can be edited (options added, renamed, removed)."""
    import copy as _copy

    from objectapp.space import Space
    from objectapp.typemodel import type_revision as _rev

    types = space_dir / ".capacities" / "types"
    Space(space_dir)  # first open: writes the inferred types
    (types / "pdf.json").write_text(json.dumps(_media("PDF").to_json()), encoding="utf-8")
    sp = Space(space_dir)
    t = _copy.deepcopy(sp.type_by_id("pdf"))
    topic = t.prop("topic")
    topic.options["set"] = [
        {**topic.options["set"][0], "text": "Machine learning"},
        {"id": "networking", "text": "Networking", "color": "blue", "icon": None},
    ]
    sp.save_type(t, _rev(space_dir, "pdf"))
    stored = json.loads((types / "pdf.json").read_text(encoding="utf-8"))
    saved = next(p for p in stored["propertyDefinitions"] if p["key"] == "topic")
    assert [o["text"] for o in saved["options"]["set"]] == ["Machine learning", "Networking"]


def test_topup_leaves_a_custom_type_named_like_a_media_type_alone():
    t = _media("PDF")
    t.basic = False
    assert topup_task_type(t).prop("topic") is None
