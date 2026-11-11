"""M28 Task 2: the IT ops types, templates, seed vocabulary and the ``space-itops`` fixture.

Plan ``docs/superpowers/plans/2026-11-09-m28-itops-starter-and-relations.md``, Contract tables
"The starter types", "Counterparts", "Seed vocabulary" and "Default templates".
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from objectapp.basicsetup import (
    ITOPS_DEPARTMENTS,
    ITOPS_PRIORITIES,
    ITOPS_PROJECT_STATUSES,
    ITOPS_TAGS,
    ITOPS_TASK_STATUSES,
    ITOPS_TEMPLATE_SECTIONS,
    ITOPS_TYPE_IDS,
    basic_types,
    itops_template,
    itops_types,
    source_type,
    sources_property,
    write_itops_tags,
    write_itops_types,
)
from objectapp.frontmatter import parse_fm
from objectapp.objfile import split_object
from objectapp.typemodel import PropertyDefinition, TypeDefinition
from objectapp.workfields import FIELD_KEYS, is_work_type
from objectapp.workrules import done_option

FIXTURE = Path(__file__).parent / "fixtures" / "space-itops"

ENTITY_IDS = (
    "host", "software", "application", "container", "configuration", "location", "network",
    "person", "vendor",
)


def _types() -> dict[str, TypeDefinition]:
    return {t.id: t for t in itops_types()}


def _own(t: TypeDefinition) -> list[PropertyDefinition]:
    """The type's properties after the system ones (the starter's own, in order)."""
    return [p for p in t.propertyDefinitions if not p.type.startswith("entity_")]


def _own_keys(t: TypeDefinition) -> list[str]:
    return [p.key for p in _own(t)]


def _texts(p: PropertyDefinition) -> list[str]:
    return [o["text"] for o in p.options["set"]]


def _fm(path: Path) -> tuple[dict, str]:
    of = split_object(path.read_bytes().decode("utf-8-sig").replace("\r\n", "\n"))
    return parse_fm(of.frontmatter_src or ""), of.body


# -- the types ------------------------------------------------------------------------------


def test_itops_type_ids():
    types = itops_types()
    assert [t.id for t in types] == list(ITOPS_TYPE_IDS)
    assert len(ITOPS_TYPE_IDS) == 17
    assert [(t.name, t.pluralName) for t in types] == [
        ("Host", "Hosts"), ("Software", "Software"), ("Application", "Applications"),
        ("Container", "Containers"), ("Configuration", "Configurations"),
        ("Location", "Locations"), ("Network", "Networks"), ("Person", "People"),
        ("Vendor", "Vendors"), ("Script", "Scripts"), ("Command", "Commands"),
        ("Runbook", "Runbooks"), ("Prompt", "Prompts"), ("Source", "Sources"),
        ("Project", "Projects"), ("Incident", "Incidents"), ("Meeting", "Meetings"),
    ]
    assert all(t.folder == t.pluralName for t in types)
    # Every type round-trips through the type model unchanged (normalize_options keeps it all).
    for t in types:
        assert TypeDefinition.from_json(t.to_json()).to_json() == t.to_json()
    # Fresh property ids on each call (the system and work fields keep id == key).
    a, b = _types()["host"], _types()["host"]
    assert a.prop("category").id != b.prop("category").id


def test_type_icons_and_colours():
    got = {t.id: (t.icon.val if t.icon else None, t.color) for t in itops_types()}
    basic = {t.id: (t.icon.val if t.icon else None, t.color) for t in basic_types()}
    assert got == {
        "host": ("ph-hard-drives", "blue"),
        "software": ("ph-package", "violet"),
        "application": ("ph-app-window", "indigo"),
        "container": ("ph-shipping-container", "cyan"),
        "configuration": ("ph-sliders-horizontal", "amber"),
        "location": ("ph-map-pin", "emerald"),
        "network": ("ph-network", "sky"),
        "person": basic["person"],
        "vendor": ("ph-storefront", "orange"),
        "script": ("ph-file-code", "teal"),
        "command": ("ph-terminal-window", "gray"),
        "runbook": ("ph-book-open-text", "lime"),
        "prompt": ("ph-chat-text", "fuchsia"),
        "source": ("ph-file-text", "gray"),
        "project": basic["project"],
        "incident": ("ph-warning-octagon", "red"),
        "meeting": basic["meeting"],
    }
    # Every colour is one Object knows (fix pass, finding 5: Source was "slate").
    from objectapp.typemodel import THEME_COLORS

    assert all(color in THEME_COLORS for _icon, color in got.values()), got


def test_host_properties():
    host = _types()["host"]
    assert _own_keys(host) == [
        "category", "roles", "ipAddress", "fqdn", "department", "environment",
        "operatingSystem", "locatedAt", "network", "ownedBy", "sources", "notes",
        # M29: the synced facts (test_m29_starter.py)
        "lastBoot", "diskFree", "patchState", "rebootPending", "lastSeen",
    ]
    names = [p.name for p in _own(host)]
    assert names == [
        "Category", "Roles", "IP address", "FQDN", "Department", "Environment",
        "Operating system", "Located at", "Network", "Owned by", "Sources", "Notes",
        "Last boot", "Disk free", "Patch state", "Reboot pending", "Last seen",
    ]
    category = host.prop("category")
    assert category.type == "label" and category.options["isArray"] is False
    assert _texts(category) == [
        "Server", "Workstation", "Network device", "Printer", "NAS", "Firewall", "VPN",
    ]
    roles = host.prop("roles")
    assert roles.type == "label" and roles.options["isArray"] is True
    assert _texts(roles) == [
        "DNS", "DHCP", "Active Directory", "File server", "Print server", "RDS", "Hypervisor",
        "Firewall/VPN",
    ]
    assert _texts(host.prop("environment")) == ["Production", "Test", "Development"]
    assert [(o["text"], o["color"]) for o in host.prop("environment").options["set"]] == [
        ("Production", "red"), ("Test", "amber"), ("Development", "green"),
    ]
    assert [(o["text"], o["color"]) for o in host.prop("department").options["set"]] == [
        ("IT", "blue"), ("Finance", "green"), ("All", "gray"),
    ]
    # Other lists take blue, green, amber, violet, sky, rose, teal, orange, indigo (cycling).
    assert [o["color"] for o in category.options["set"]] == [
        "blue", "green", "amber", "violet", "sky", "rose", "teal",
    ]
    assert [o["color"] for o in roles.options["set"]] == [
        "blue", "green", "amber", "violet", "sky", "rose", "teal", "orange",
    ]
    assert [o["id"] for o in roles.options["set"]][-1] == "firewall-vpn"
    assert host.prop("ipAddress").type == "text" and host.prop("fqdn").type == "text"
    os_prop = host.prop("operatingSystem")
    assert os_prop.type == "entity"
    assert os_prop.options == {
        "isArray": False,
        "allowedTypes": ["software"],
        "hasFixedSet": False,
        "fixedSet": [],
        "counterpart": {"name": "Installed on", "key": "installedOn"},
    }
    assert host.prop("locatedAt").options["isArray"] is False
    assert host.prop("network").options["allowedTypes"] == ["network"]
    assert host.prop("network").options["isArray"] is True
    assert "counterpart" not in host.prop("network").options
    assert host.prop("ownedBy").options["allowedTypes"] == ["person", "vendor"]
    assert host.prop("notes").type == "blocks"
    # Every own property is shown (alwaysShow), but Sources (hidden while empty).
    assert {p.key: p.visibility for p in _own(host) if p.visibility != "alwaysShow"} == {
        "sources": "hideWhenEmpty",
    }


COUNTERPART_PAIRS = [
    # (type id, key, allowedTypes, isArray, counterpart)
    ("application", "runsOn", ["host", "container"], True, {"name": "Runs", "key": "runs"}),
    ("container", "runsOn", ["host"], True, {"name": "Runs", "key": "runs"}),
    ("application", "uses", ["software"], True, {"name": "Used by", "key": "usedBy"}),
    ("host", "operatingSystem", ["software"], False,
     {"name": "Installed on", "key": "installedOn"}),
    ("configuration", "appliesTo", ["host", "application"], True,
     {"name": "Configured by", "key": "configuredBy"}),
    ("script", "covers", ["host", "application", "software"], True,
     {"name": "Documented in", "key": "documentedIn"}),
    ("command", "covers", [], True, {"name": "Documented in", "key": "documentedIn"}),
    ("runbook", "covers", [], True, {"name": "Documented in", "key": "documentedIn"}),
    ("host", "locatedAt", ["location"], False, {"name": "Contains", "key": "contains"}),
    ("network", "locatedAt", ["location"], False, {"name": "Contains", "key": "contains"}),
    ("location", "partOf", ["location"], False, {"name": "Contains", "key": "contains"}),
    ("host", "ownedBy", ["person", "vendor"], True, {"name": "Owns", "key": "owns"}),
    ("application", "ownedBy", ["person"], True, {"name": "Owns", "key": "owns"}),
    ("container", "partOf", ["application"], False,
     {"name": "Containers", "key": "containers"}),
    *[(tid, "sources", ["source"], True, {"name": "Distilled into", "key": "distilledInto"})
      for tid in ENTITY_IDS],
    ("project", "affects", ["host", "application", "software"], True,
     {"name": "Affected by", "key": "affectedBy"}),
    ("incident", "affects", ["host", "application"], True,
     {"name": "Affected by", "key": "affectedBy"}),
]


@pytest.mark.parametrize(("tid", "key", "allowed", "is_array", "counterpart"), COUNTERPART_PAIRS)
def test_every_counterpart_pair(tid, key, allowed, is_array, counterpart):
    p = _types()[tid].prop(key)
    assert p is not None and p.type == "entity"
    assert p.options["allowedTypes"] == allowed
    assert p.options["isArray"] is is_array
    assert p.options["counterpart"] == counterpart


def test_only_the_contract_pairs_have_counterparts():
    want = {(tid, key) for tid, key, *_ in COUNTERPART_PAIRS}
    got = {
        (t.id, p.key)
        for t in itops_types()
        for p in t.propertyDefinitions
        if p.options.get("counterpart") is not None
    }
    assert got == want
    types = _types()
    assert types["software"].prop("vendor").options["allowedTypes"] == ["vendor"]
    assert types["software"].prop("vendor").options["isArray"] is False
    assert types["prompt"].prop("usedOn").options["allowedTypes"] == []


def test_source_type():
    src = source_type()
    assert src.id == "source"
    assert (src.name, src.pluralName, src.folder) == ("Source", "Sources", "Sources")
    assert _own_keys(src) == ["category", "system", "notes"]
    assert _texts(src.prop("category")) == [
        "Wiki page", "Document", "Spreadsheet", "Presentation", "PDF", "Diagram", "Email",
        "Ticket", "Chat", "Web page", "Image", "Note",
    ]
    assert _texts(src.prop("system")) == [
        "SharePoint", "Wiki", "Notion", "Obsidian", "Anytype", "Files", "Markdown",
    ]
    assert not [p for p in src.propertyDefinitions if p.type == "entity"]
    assert source_type().prop("category").id != src.prop("category").id
    assert src.templates == {"ids": [], "defaultTemplateId": None}

    sp = sources_property()
    assert (sp.key, sp.name, sp.type) == ("sources", "Sources", "entity")
    assert sp.options["isArray"] is True
    assert sp.options["allowedTypes"] == ["source"]
    assert sp.options["counterpart"] == {"name": "Distilled into", "key": "distilledInto"}
    assert sp.visibility == "hideWhenEmpty"
    assert sources_property().id != sp.id

    for t in itops_types():
        keys = _own_keys(t)
        if t.id in ENTITY_IDS:
            assert keys[keys.index("notes") - 1] == "sources", t.id
        else:
            assert "sources" not in keys, t.id


OPTION_LISTS = [
    # (type id, key, name, kind, options or None, isArray or None)
    ("software", "product", "Product", "text", None, None),
    ("software", "version", "Version", "text", None, None),
    ("software", "vendor", "Vendor", "entity", None, False),
    ("software", "endOfSupport", "End of support", "datetime", None, None),
    ("application", "status", "Status", "label", ["Live", "Planned", "Retired"], False),
    ("application", "ownedBy", "Owned by", "entity", None, True),
    ("application", "department", "Department", "label", ["IT", "Finance", "All"], False),
    ("application", "runsOn", "Runs on", "entity", None, True),
    ("application", "uses", "Uses", "entity", None, True),
    ("container", "image", "Image", "text", None, None),
    ("container", "runsOn", "Runs on", "entity", None, True),
    ("container", "partOf", "Part of", "entity", None, False),
    ("configuration", "kind", "Kind", "label",
     ["GPO", "Firewall rule", "Scheduled task", "App setting", "Template"], False),
    ("configuration", "appliesTo", "Applies to", "entity", None, True),
    ("location", "kind", "Kind", "label", ["Site", "Building", "Room", "Rack"], False),
    ("location", "partOf", "Part of", "entity", None, False),
    ("network", "kind", "Kind", "label", ["Subnet", "VLAN", "Wifi", "Domain"], False),
    ("network", "range", "Range", "text", None, None),
    ("network", "vlanId", "VLAN id", "number", None, None),
    ("network", "locatedAt", "Located at", "entity", None, False),
    ("vendor", "website", "Website", "url", None, None),
    ("vendor", "supportContact", "Support contact", "text", None, None),
    ("vendor", "contractEnds", "Contract ends", "datetime", None, None),
    ("script", "language", "Language", "label", ["PowerShell", "Bash", "Python", "AWS CLI"],
     False),
    ("script", "covers", "Covers", "entity", None, True),
    ("command", "shell", "Shell", "label", ["PowerShell", "Bash", "cmd", "macOS"], False),
    ("command", "covers", "Covers", "entity", None, True),
    ("runbook", "kind", "Kind", "label", ["Runbook", "SOP"], False),
    ("runbook", "covers", "Covers", "entity", None, True),
    ("runbook", "lastReviewed", "Last reviewed", "datetime", None, None),
    ("prompt", "model", "Model", "text", None, None),
    ("prompt", "purpose", "Purpose", "text", None, None),
    ("prompt", "usedOn", "Used on", "entity", None, True),
    ("incident", "status", "Status", "label", ["Open", "Mitigated", "Resolved"], False),
    ("incident", "severity", "Severity", "label", ["SEV1", "SEV2", "SEV3", "SEV4"], False),
    ("incident", "impact", "Impact", "text", None, None),
    ("incident", "cause", "Cause", "text", None, None),
    ("incident", "affects", "Affects", "entity", None, True),
    ("incident", "started", "Started", "datetime", None, None),
    ("incident", "resolved", "Resolved", "datetime", None, None),
]


@pytest.mark.parametrize(("tid", "key", "name", "kind", "texts", "is_array"), OPTION_LISTS)
def test_option_lists(tid, key, name, kind, texts, is_array):
    p = _types()[tid].prop(key)
    assert p is not None
    assert (p.name, p.type) == (name, kind)
    if texts is not None:
        assert _texts(p) == texts
    if is_array is not None:
        assert p.options["isArray"] is is_array


OWN_KEYS = {
    "software": ["product", "version", "vendor", "endOfSupport", "sources", "notes"],
    "application": ["status", "ownedBy", "department", "runsOn", "uses", "sources", "notes"],
    "container": ["image", "runsOn", "partOf", "sources", "notes"],
    "configuration": ["kind", "appliesTo", "sources", "notes"],
    "location": ["kind", "partOf", "sources", "notes"],
    "network": ["kind", "range", "vlanId", "locatedAt", "sources", "notes"],
    "vendor": ["website", "supportContact", "contractEnds", "sources", "notes"],
    "script": ["language", "covers", "notes"],
    "command": ["shell", "covers", "notes"],
    "runbook": ["kind", "covers", "lastReviewed", "notes"],
    "prompt": ["model", "purpose", "usedOn", "notes"],
}


@pytest.mark.parametrize("tid", sorted(OWN_KEYS))
def test_own_keys_in_order(tid):
    assert _own_keys(_types()[tid]) == OWN_KEYS[tid]


def test_option_details():
    types = _types()
    assert types["software"].prop("product").description == "The product family, e.g. SQL Server"
    assert types["network"].prop("range").description == "CIDR"
    day = {"constraints": {"resolutionPreference": "day"}}
    time = {"constraints": {"resolutionPreference": "time"}}
    assert types["software"].prop("endOfSupport").options == day
    assert types["vendor"].prop("contractEnds").options == day
    assert types["runbook"].prop("lastReviewed").options == day
    assert types["incident"].prop("started").options == time
    assert types["incident"].prop("resolved").options == time
    colours = {
        ("application", "status"): [("Live", "green"), ("Planned", "yellow"), ("Retired", "gray")],
        ("incident", "status"): [("Open", "red"), ("Mitigated", "amber"), ("Resolved", "green")],
        ("incident", "severity"): [
            ("SEV1", "red"), ("SEV2", "orange"), ("SEV3", "amber"), ("SEV4", "gray"),
        ],
        ("application", "department"): [("IT", "blue"), ("Finance", "green"), ("All", "gray")],
        ("source", "category"): list(zip(
            ["Wiki page", "Document", "Spreadsheet", "Presentation", "PDF", "Diagram", "Email",
             "Ticket", "Chat", "Web page", "Image", "Note"],
            ["blue", "green", "amber", "violet", "sky", "rose", "teal", "orange", "indigo",
             "blue", "green", "amber"],
            strict=True,
        )),
    }
    for (tid, key), want in colours.items():
        assert [(o["text"], o["color"]) for o in types[tid].prop(key).options["set"]] == want
    assert [o["statusCategory"] for o in types["incident"].prop("status").options["set"]] == [
        "in-progress", "in-progress", "done",
    ]
    assert [o["id"] for o in types["configuration"].prop("kind").options["set"]] == [
        "gpo", "firewall-rule", "scheduled-task", "app-setting", "template",
    ]


def test_basic_variants():
    types = _types()
    basic = {t.id: t for t in basic_types(work=True)}

    person = types["person"]
    base = [k for k in _own_keys(basic["person"]) if k != "notes"]
    assert _own_keys(person) == [*base, "department", "sources", "notes"]
    assert _texts(person.prop("department")) == ["IT", "Finance", "All"]
    assert person.description == basic["person"].description

    meeting = types["meeting"]
    assert _own_keys(meeting) == _own_keys(basic["meeting"])
    texts = _texts(meeting.prop("meetingType"))
    assert texts == [*_texts(basic["meeting"].prop("meetingType")), "Operations", "Helpdesk"]
    assert texts[-2:] == ["Operations", "Helpdesk"]

    project = types["project"]
    keys = _own_keys(project)
    base = _own_keys(basic["project"])
    want = list(base)
    want.insert(want.index("projectType") + 1, "priority")
    want.insert(want.index("meetings") + 1, "affects")
    assert keys == want
    status = project.prop("status")
    assert _texts(status) == list(ITOPS_PROJECT_STATUSES)
    assert [o["statusCategory"] for o in status.options["set"]] == [
        "not-started", "in-progress", "blocked", "done",
    ]
    assert "isStatus" not in status.options
    assert done_option(status) == "Complete"
    assert _texts(project.prop("priority")) == ["Low", "Medium", "High"]
    assert project.prop("affects").options["counterpart"] == {
        "name": "Affected by", "key": "affectedBy",
    }
    assert is_work_type(project)
    assert project.prop("completed").visibility == "hidden"

    incident = types["incident"]
    assert is_work_type(incident)
    assert incident.prop("cause").type == "text"
    assert [p.key for p in incident.propertyDefinitions].count("cause") == 1
    assert incident.prop("deskResolved") is None  # M31, G3: its own Resolved is the one
    assert done_option(incident.prop("status")) == "Resolved"
    assert incident.prop("completed").visibility == "hidden"
    keys = _own_keys(incident)
    assert keys[:8] == [
        "status", "severity", "impact", "cause", "affects", "started", "resolved", "notes",
    ]
    assert keys[-1] == "completed"
    assert set(keys[8:-1]) == FIELD_KEYS - {"cause", "project", "deskResolved"}
    # The basic Project's work fields keep their own Resolved name.
    assert project.prop("deskResolved").name == "Resolved"


def test_no_credential_property():
    bad = re.compile(r"(?i)password|secret|credential|api key|token")
    for t in itops_types():
        for p in t.propertyDefinitions:
            assert not bad.search(p.name), (t.id, p.name)
            assert not bad.search(p.key), (t.id, p.key)


def test_vocabulary():
    assert len(ITOPS_TAGS) == 30 and len(set(ITOPS_TAGS)) == 30
    assert ITOPS_TAGS[0] == "Windows" and ITOPS_TAGS[-1] == "VM"
    assert ITOPS_PROJECT_STATUSES == ("Back log", "In progress", "On hold", "Complete")
    assert ITOPS_TASK_STATUSES == ("Not started", "Done")
    assert ITOPS_PRIORITIES == ("Low", "Medium", "High")
    assert ITOPS_DEPARTMENTS == ("IT", "Finance", "All")


# -- templates ------------------------------------------------------------------------------


def test_templates():
    assert itops_template("host") == ("Host", "## Purpose\n\n## Access\n\n## Known issues\n")
    assert itops_template("incident") == (
        "Incident", "## Timeline\n\n## Impact\n\n## Cause\n\n## Follow-up\n",
    )
    assert itops_template("application")[1] == "## Purpose\n\n## How it's built\n\n## Support\n"
    assert set(ITOPS_TEMPLATE_SECTIONS) == set(ITOPS_TYPE_IDS) - {"source"}
    names = {t.id: t.name for t in itops_types()}
    for tid in ITOPS_TYPE_IDS:
        if tid == "source":
            continue
        name, body = itops_template(tid)
        assert name == names[tid]
        assert ITOPS_TEMPLATE_SECTIONS[tid]
        assert body == "\n".join(f"## {s}\n" for s in ITOPS_TEMPLATE_SECTIONS[tid])
    with pytest.raises(KeyError):
        itops_template("source")


def _files(root: Path) -> list[str]:
    return sorted(p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file())


def test_write_itops_types_never_replaces(tmp_path: Path):
    root = tmp_path / "space"
    (root / ".object" / "types").mkdir(parents=True)
    (root / ".object" / "types" / "host.json").write_bytes(b"{}")
    (root / "Templates" / "Hosts").mkdir(parents=True)
    (root / "Templates" / "Hosts" / "Host.md").write_bytes(b"mine\r\n")

    written = write_itops_types(root)

    assert (root / ".object" / "types" / "host.json").read_bytes() == b"{}"
    assert (root / "Templates" / "Hosts" / "Host.md").read_bytes() == b"mine\r\n"
    rels = sorted(p.relative_to(root).as_posix() for p in written)
    type_files = [r for r in rels if r.startswith(".object/types/")]
    templates = [r for r in rels if r.startswith("Templates/")]
    assert len(type_files) == 16 and ".object/types/host.json" not in type_files
    assert len(templates) == 15
    assert ".object/types/source.json" in type_files
    assert not any(r.startswith("Templates/Sources/") for r in templates)
    assert sorted(set(_files(root)) - {".object/types/host.json", "Templates/Hosts/Host.md"}) \
        == rels

    names = {t.id: (t.name, t.pluralName) for t in itops_types()}
    for tid in ITOPS_TYPE_IDS:
        if tid == "host":
            continue
        t = TypeDefinition.from_json(
            json.loads((root / ".object" / "types" / f"{tid}.json").read_text("utf-8"))
        )
        if tid == "source":
            assert t.templates == {"ids": [], "defaultTemplateId": None}
            continue
        name, plural = names[tid]
        path = root / "Templates" / plural / f"{name}.md"
        fm, body = _fm(path)
        assert fm["type"] == name and fm["template"] == name
        assert t.templates["ids"] == [fm["id"]]
        assert t.templates["defaultTemplateId"] == fm["id"]
        assert body == itops_template(tid)[1]
        assert path.read_bytes().startswith(f"---\nid: {fm['id']}\ntype: '{name}'\n".encode())

    # A second call writes nothing.
    assert write_itops_types(root) == []

    other = tmp_path / "other"
    other.mkdir()
    write_itops_types(other, skip=["person"])
    assert not (other / ".object" / "types" / "person.json").exists()
    assert not (other / "Templates" / "People").exists()
    assert (other / ".object" / "types" / "meeting.json").exists()


def test_write_itops_types_keeps_types_whose_template_exists(tmp_path: Path):
    """A type is written but a template already at its path is kept (and not registered)."""
    root = tmp_path / "space"
    (root / "Templates" / "Vendors").mkdir(parents=True)
    mine = b"---\ntype: Vendor\n---\nx\n"
    (root / "Templates" / "Vendors" / "Vendor.md").write_bytes(mine)
    written = write_itops_types(root)
    assert root / ".object" / "types" / "vendor.json" in written
    assert (root / "Templates" / "Vendors" / "Vendor.md").read_bytes() == mine
    vendor = json.loads((root / ".object" / "types" / "vendor.json").read_text("utf-8"))
    assert vendor["templates"] == {"ids": [], "defaultTemplateId": None}


# -- seed tags ------------------------------------------------------------------------------


def test_write_itops_tags(tmp_path: Path):
    root = tmp_path / "space"
    root.mkdir()
    written = write_itops_tags(root)
    assert len(written) == 30
    assert sorted(p.relative_to(root).as_posix() for p in written) == sorted(
        f"Tags/{name}.md" for name in ITOPS_TAGS
    )
    fm, body = _fm(root / "Tags" / "Windows.md")
    assert fm["type"] == "Tag" and fm["title"] == "Windows"
    assert fm["color"] == "bg-gray"  # THEME_COLORS[0]: deterministic by index
    assert body == ""
    assert (root / "Tags" / "Windows.md").read_bytes().startswith(b"---\nid: ")
    assert b"type: 'Tag'\n" in (root / "Tags" / "Windows.md").read_bytes()
    fm, _ = _fm(root / "Tags" / "Linux.md")
    assert fm["color"] == "bg-rose"
    fm, _ = _fm(root / "Tags" / "VM.md")
    assert fm["color"] == "bg-emerald"  # index 29: THEME_COLORS[29 % 18]
    # A second call writes none.
    assert write_itops_tags(root) == []

    other = tmp_path / "other"
    (other / "Tags").mkdir(parents=True)
    mine = b"---\ntype: 'Tag'\ntitle: Windows\n---\n"
    (other / "Tags" / "windows.md").write_bytes(mine)
    written = write_itops_tags(other)
    assert len(written) == 29
    assert (other / "Tags" / "windows.md").read_bytes() == mine
    assert not [p for p in written if p.name.lower() == "windows.md"]
    assert write_itops_tags(other) == []


# -- the fixture ----------------------------------------------------------------------------


def _without_ids(data: dict) -> dict:
    data = json.loads(json.dumps(data))
    data["templates"] = None
    for p in data["propertyDefinitions"]:
        p["id"] = None
    return data


def _without_m29(data: dict) -> dict:
    """The starter's type JSON as M28 wrote it: M29's synced facts and name patterns left out."""
    data = json.loads(json.dumps(data))
    data.pop("namePatterns", None)
    data["propertyDefinitions"] = [p for p in data["propertyDefinitions"] if "synced" not in p]
    return data


def _without_m31(tid: str, data: dict) -> dict:
    """The fixture's Incident as M28 wrote it keeps its ticket fields' ``deskResolved`` ("Desk
    resolved"): M31 (G3) drops it from the starter, and an existing space keeps it."""
    if tid == "incident":
        data = {**data, "propertyDefinitions": [p for p in data["propertyDefinitions"] if p["key"] != "deskResolved"]}
    return data


def test_fixture_types_match():
    # The fixture is an M28-era space: M29 never tops its types up (M29 plan, "Our calls" 19).
    for t in itops_types():
        path = FIXTURE / ".object" / "types" / f"{t.id}.json"
        got = TypeDefinition.from_json(_without_m31(t.id, json.loads(path.read_text("utf-8"))))
        assert _without_ids(got.to_json()) == _without_ids(_without_m29(t.to_json())), t.id
        if t.id != "source":
            assert got.templates["defaultTemplateId"] == got.templates["ids"][0]


def test_fixture_space_json_and_crlf_bom():
    assert json.loads((FIXTURE / ".object" / "space.json").read_text("utf-8")) == {
        "name": "IT ops test", "setup": "itops",
    }
    data = (FIXTURE / "Hosts" / "APP-TEST-01.md").read_bytes()
    assert data.startswith(b"\xef\xbb\xbf---\r\n")
    assert b"\n" not in data.replace(b"\r\n", b"")
    fm, _ = _fm(FIXTURE / "Hosts" / "APP-TEST-01.md")
    assert fm["category"] == "Server" and fm["environment"] == "Test"
    assert fm["operatingSystem"] == "[[Windows Server 2022]]"
    assert fm["locatedAt"] == "[[Rack A]]"
    assert fm["aliases"] == ["app01"]


FIXTURE_OBJECTS = {
    "Hosts/DB-TEST-01.md": ("Host", {"operatingSystem": "[[Windows Server 2022]]"}),
    "Software/SQL Server 2019.md": (
        "Software", {"product": "SQL Server", "version": "2019", "vendor": "[[Example Vendor]]"},
    ),
    "Software/Windows Server 2022.md": ("Software", {}),
    "Applications/Inventory app.md": ("Application", {
        "status": "Live", "runsOn": ["[[APP-TEST-01]]"], "uses": ["[[SQL Server 2019]]"],
        "ownedBy": ["[[Sam Example]]"],
    }),
    "Applications/Old app.md": ("Application", {"runsOn": ["[[Missing host]]"]}),
    "Containers/inventory-web.md": (
        "Container", {"runsOn": ["[[app01]]"], "partOf": "[[Inventory app]]"},
    ),
    "Configurations/Backup schedule.md": (
        "Configuration", {"kind": "Scheduled task", "appliesTo": ["[[DB-TEST-01]]"]},
    ),
    "Locations/Main site.md": ("Location", {"kind": "Site"}),
    "Locations/Rack A.md": ("Location", {"kind": "Rack", "partOf": "[[Main site]]"}),
    "Networks/Server VLAN.md": ("Network", {
        "kind": "VLAN", "range": "10.0.0.0/24", "vlanId": 10, "locatedAt": "[[Main site]]",
    }),
    "People/Sam Example.md": ("Person", {}),
    "Vendors/Example Vendor.md": ("Vendor", {}),
    "Runbooks/Restart the inventory app.md": (
        "Runbook", {"kind": "Runbook", "covers": ["[[Inventory app]]", "[[APP-TEST-01]]"]},
    ),
    "Incidents/Inventory app slow.md": ("Incident", {
        "status": "Open", "severity": "SEV3", "affects": ["[[Inventory app]]"],
    }),
    "Pages/Rack notes.md": ("Page", {"runsOn": "[[DB-TEST-01]]"}),
}


@pytest.mark.parametrize("rel", sorted(FIXTURE_OBJECTS))
def test_fixture_objects(rel):
    type_name, values = FIXTURE_OBJECTS[rel]
    data = (FIXTURE / rel).read_bytes()
    assert not data.startswith(b"\xef\xbb\xbf") and b"\r\n" not in data
    fm, _body = _fm(FIXTURE / rel)
    assert fm["type"] == type_name
    assert fm["title"] == Path(rel).stem
    assert "template" not in fm
    for key, value in values.items():
        assert fm[key] == value, (rel, key)


def test_fixture_page_and_template_links():
    _fm_page, body = _fm(FIXTURE / "Pages" / "Rack notes.md")
    assert "See [[APP-TEST-01]]." in body
    fm, body = _fm(FIXTURE / "Templates" / "Hosts" / "Host.md")
    assert fm["template"] == "Host" and fm["type"] == "Host"
    assert fm["locatedAt"] == "[[Rack A]]"
    assert body == itops_template("host")[1]
    host = json.loads((FIXTURE / ".object" / "types" / "host.json").read_text("utf-8"))
    assert host["templates"]["ids"] == [fm["id"]]
