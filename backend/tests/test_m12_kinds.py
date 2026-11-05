"""M12 property kinds over the space and the API: computed values, IDs, email/phone/files,
type-save checks and renames, number-existing and the formula preview."""

import copy
import json
import threading
import time
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.frontmatter import parse_fm
from objectapp.objfile import split_object
from objectapp.propvalues import InvalidValue, decode_value, encode_value
from objectapp.server import create_app
from objectapp.space import ConfirmRequired, Space
from objectapp.textfile import decode
from objectapp.typemodel import PropertyDefinition, type_revision
from test_types_api import _snapshot, _write

NOW = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)


def _prop(pid, key, name, kind, **options):
    return {"id": pid, "key": key, "name": name, "type": kind, "options": options}


def _types(space_dir: Path) -> None:
    types = space_dir / ".object" / "types"
    types.mkdir(parents=True, exist_ok=True)
    member = {
        "schemaVersion": 2, "id": "member", "name": "Member", "pluralName": "Members",
        "folder": "Members",
        "propertyDefinitions": [
            _prop("title", "title", "Title", "entity_title"),
            _prop("m-hours", "hours", "Hours", "number"),
            _prop("m-joined", "joined", "Joined", "datetime"),
            _prop("m-double", "double", "Double hours", "formula", expression='prop("Hours") * 2'),
            _prop("m-roll", "roll", "Roll", "rollup", relationId="", targetId="", calc="countAll"),
        ],
    }
    project = {
        "schemaVersion": 2, "id": "project", "name": "Project", "pluralName": "Projects",
        "folder": "Projects",
        "propertyDefinitions": [
            _prop("title", "title", "Title", "entity_title"),
            _prop("createdAt", "createdAt", "Created at", "entity_createdAt"),
            _prop("lastUpdated", "lastUpdated", "Last updated", "entity_lastUpdated"),
            _prop("p-budget", "budget", "Budget", "number"),
            _prop("p-members", "members", "Members", "entity", isArray=True,
                  allowedTypes=["member"], hasFixedSet=False, fixedSet=[]),
            _prop("p-stage", "stage", "Stage", "label", isArray=False,
                  set=[{"id": "s1", "text": "Active", "color": "red"}]),
            _prop("p-double", "double", "Double", "formula", expression='prop("Budget") * 2'),
            _prop("p-label", "label", "Label", "formula",
                  expression='prop("Title") + ": " + format(prop("Budget"))'),
            _prop("p-hours", "teamHours", "Team hours", "rollup",
                  relationId="p-members", targetId="m-hours", calc="sum"),
            _prop("p-count", "teamCount", "Team count", "rollup",
                  relationId="p-members", targetId="title", calc="countAll"),
            _prop("p-names", "teamNames", "Team names", "rollup",
                  relationId="p-members", targetId="title", calc="showOriginal"),
            _prop("p-first", "firstJoined", "First joined", "rollup",
                  relationId="p-members", targetId="m-joined", calc="earliestDate"),
            _prop("p-doubled", "doubled", "Doubled", "rollup",
                  relationId="p-members", targetId="m-double", calc="sum"),
            _prop("p-ref", "ref", "Ref", "formula", expression='prop("Team hours") + 1'),
            _prop("p-code", "code", "Code", "uniqueId", prefix="PRJ-", nextNumber=1),
            _prop("p-mail", "mail", "Mail", "email"),
            _prop("p-phone", "phone", "Phone", "phone"),
            _prop("p-files", "files", "Files", "files"),
        ],
    }
    ticket = {
        "schemaVersion": 2, "id": "ticket", "name": "Ticket", "pluralName": "Tickets",
        "folder": "Tickets",
        "propertyDefinitions": [
            _prop("title", "title", "Title", "entity_title"),
            _prop("t-num", "num", "Num", "uniqueId", prefix="", nextNumber=7),
        ],
    }
    for data in (member, project, ticket):
        (types / f"{data['id']}.json").write_text(json.dumps(data, indent=2) + "\n", "utf-8")


def _objects(space_dir: Path) -> None:
    _write(space_dir / "Members" / "Ann.md",
           "---\ntype: 'Member'\ntitle: Ann\nhours: 5\njoined: 2026-01-10\n"
           "createdAt: 2026-01-01T00:00:00.000Z\n---\n")
    _write(space_dir / "Members" / "Bob.md",
           "---\ntype: 'Member'\ntitle: Bob\nhours: 7.5\njoined: 2026-03-01\n"
           "createdAt: 2026-01-02T00:00:00.000Z\n---\n")
    _write(space_dir / "Members" / "Cy.md", "---\ntype: 'Member'\ntitle: Cy\n---\n")
    _write(space_dir / "Projects" / "Apollo.md",
           "---\ntype: 'Project'\ntitle: Apollo\nbudget: 100\n"
           "members: ['[[Ann]]', '[[Bob]]', '[[Ghost]]', '[[Cy]]']\nstage: Active\n"
           "createdAt: 2026-02-01T00:00:00.000Z\nlastUpdated: 2026-02-01T00:00:00.000Z\n---\n")
    _write(space_dir / "Projects" / "Gemini.md",
           "---\ntype: 'Project'\ntitle: Gemini\n"
           "createdAt: 2026-01-15T00:00:00.000Z\nlastUpdated: 2026-01-15T00:00:00.000Z\n---\n")


@pytest.fixture
def m12_dir(m8_space_dir: Path) -> Path:
    _types(m8_space_dir)
    _objects(m8_space_dir)
    return m8_space_dir


def _space(root: Path) -> Space:
    space = Space(root)
    space.clock = lambda: NOW
    return space


def _fm(root: Path, rel: str) -> dict:
    return parse_fm(split_object(decode((root / rel).read_bytes()).text).frontmatter_src)


def _rev(space: Space, type_id: str) -> str:
    return type_revision(space.root, type_id)


def _row(space: Space, path: str) -> dict:
    return next(r for r in space.rows(paths=[path]) if r.summary.path == path).values


E = {"type": "empty", "value": None}


# -- computed values -------------------------------------------------------------------------


def test_rows_carry_computed_values(m12_dir: Path):
    before = _snapshot(m12_dir)
    space = _space(m12_dir)
    v = _row(space, "Projects/Apollo.md")
    assert v["double"] == {"type": "number", "value": 200}
    assert v["label"] == {"type": "text", "value": "Apollo: 100"}
    # The dangling `[[Ghost]]` is skipped; Cy has no hours (empty).
    assert v["teamHours"] == {"type": "number", "value": 12.5}
    assert v["teamCount"] == {"type": "number", "value": 3}
    assert v["teamNames"] == {"type": "list", "value": ["Ann", "Bob", "Cy"]}
    assert v["firstJoined"] == {"type": "date", "value": "2026-01-10"}
    assert v["doubled"] == {"type": "number", "value": 25}  # a rollup of a formula
    assert v["ref"] == {"type": "number", "value": 13.5}  # a formula of a rollup
    g = _row(space, "Projects/Gemini.md")
    assert g["double"] == E
    assert g["label"] == {"type": "text", "value": "Gemini: "}
    assert g["teamHours"] == E and g["teamCount"] == {"type": "number", "value": 0}
    assert g["teamNames"] == {"type": "list", "value": []}
    # An empty relation/target gives empty.
    assert _row(space, "Members/Ann.md")["roll"] == E
    # Reading changed no file.
    assert _snapshot(m12_dir) == before


def test_object_read_has_computed(m12_dir: Path):
    space = _space(m12_dir)
    with TestClient(create_app(space, None, watch=False)) as c:
        r = c.get("/api/object", params={"path": "Projects/Apollo.md"})
        assert r.status_code == 200
        body = r.json()
        assert body["computed"]["teamHours"] == {"type": "number", "value": 12.5}
        assert set(body["computed"]) == {
            "double", "label", "teamHours", "teamCount", "teamNames", "firstJoined", "doubled", "ref"
        }
        assert "double" not in body["frontmatter"]
        r = c.get("/api/object", params={"path": "People/Ada Lovelace.md"})
        assert r.json()["computed"] == {}


def test_formula_errors_and_now(m12_dir: Path):
    t = json.loads((m12_dir / ".object/types/member.json").read_text("utf-8"))
    t["propertyDefinitions"] += [
        _prop("m-bad", "bad", "Bad", "formula", expression='prop("Hours") / 0'),
        _prop("m-day", "day", "Day", "formula", expression="today()"),
        _prop("m-self", "self", "Self", "formula", expression='prop("Self")'),
        _prop("m-unk", "unk", "Unk", "formula", expression='prop("Nope")'),
        _prop("m-syn", "syn", "Syn", "formula", expression="1 +"),
    ]
    (m12_dir / ".object/types/member.json").write_text(json.dumps(t), "utf-8")
    space = _space(m12_dir)
    v = _row(space, "Members/Ann.md")
    assert v["bad"] == {"type": "error", "value": None, "error": "Division by zero"}
    assert v["day"] == {"type": "date", "value": "2026-11-05"}
    assert v["self"]["type"] == "error" and "refers to itself" in v["self"]["error"]
    assert v["unk"]["error"] == 'Unknown property "Nope"'
    assert v["syn"]["type"] == "error"
    assert _row(space, "Members/Cy.md")["bad"] == E  # empty / 0 stays quietly empty


def test_property_values_in_formulas(m12_dir: Path):
    t = json.loads((m12_dir / ".object/types/project.json").read_text("utf-8"))
    t["propertyDefinitions"] += [
        _prop("f1", "f1", "F1", "formula", expression='prop("Members")'),
        _prop("f2", "f2", "F2", "formula", expression='prop("Stage")'),
        _prop("f3", "f3", "F3", "formula", expression='prop("Created at")'),
        _prop("f4", "f4", "F4", "formula", expression='prop("files")'),
        _prop("f5", "f5", "F5", "formula", expression='prop("Code")'),
        _prop("f6", "f6", "F6", "formula", expression='prop("tags")'),
    ]
    (m12_dir / ".object/types/project.json").write_text(json.dumps(t), "utf-8")
    p = m12_dir / "Projects/Apollo.md"
    p.write_text(p.read_text("utf-8").replace(
        "stage: Active\n",
        "stage: Active\nfiles: ['[[Attachments/report.pdf]]']\ncode: PRJ-4\ntags: [x, y]\n"),
        "utf-8")
    v = _row(_space(m12_dir), "Projects/Apollo.md")
    assert v["f1"] == {"type": "list", "value": ["Ann", "Bob", "Ghost", "Cy"]}
    assert v["f2"] == {"type": "text", "value": "Active"}
    assert v["f3"] == {"type": "date", "value": "2026-02-01T00:00:00.000Z"}
    assert v["f4"] == {"type": "list", "value": ["report.pdf"]}  # file names, case-insensitive name
    assert v["f5"] == {"type": "text", "value": "PRJ-4"}
    assert v["f6"] == {"type": "list", "value": ["x", "y"]}


# -- codec -------------------------------------------------------------------------------------


def _pd(kind, **options):
    return PropertyDefinition.from_json({"id": "x", "key": "x", "name": "X", "type": kind,
                                         "options": options})


def test_email_phone_files_codec():
    email, phone, files = _pd("email"), _pd("phone"), _pd("files")
    assert encode_value(email, " ada@example.org ") == "ada@example.org"
    assert encode_value(email, "") is None
    for bad in ("ada", "a@b@c", "a @b.org", "@b.org", "a@", 5):
        with pytest.raises(InvalidValue):
            encode_value(email, bad)
    assert encode_value(phone, "+1 (555) 010-0199") == "+1 (555) 010-0199"
    for bad in ("12", "555-CALL", "5x55"):
        with pytest.raises(InvalidValue):
            encode_value(phone, bad)
    assert decode_value(email, "ada@example.org") == "ada@example.org"
    assert files.options["isArray"] is True
    out = encode_value(files, ["Attachments/a.pdf", "Attachments/sub/b c.png", "Attachments/a.pdf"])
    assert list(out) == ["[[Attachments/a.pdf]]", "[[Attachments/sub/b c.png]]"]
    assert encode_value(files, []) is None
    for bad in (["Pages/a.md"], ["Attachments/../x"], ["a.pdf"], ["Attachments/"], "x", [1]):
        with pytest.raises(InvalidValue):
            encode_value(files, bad)
    assert decode_value(files, ["[[Attachments/a.pdf]]", "Attachments/b.png"]) == [
        "Attachments/a.pdf", "Attachments/b.png"
    ]
    assert decode_value(files, "[[Attachments/a.pdf|A]]") == ["Attachments/a.pdf"]
    assert decode_value(files, None) == []
    for kind in ("formula", "rollup", "uniqueId"):
        with pytest.raises(InvalidValue):
            encode_value(_pd(kind), "1")
    assert decode_value(_pd("uniqueId"), 12) == "12"
    assert decode_value(_pd("uniqueId"), "TASK-3") == "TASK-3"
    assert decode_value(_pd("formula"), "x") is None
    assert decode_value(_pd("rollup"), [1]) is None


def test_property_route_new_kinds(m12_dir: Path):
    space = _space(m12_dir)
    path = "Projects/Gemini.md"
    with TestClient(create_app(space, None, watch=False)) as c:
        def put(updates, remove=()):
            version = c.get("/api/object", params={"path": path}).json()["version"]
            return c.put("/api/object/properties", json={
                "path": path, "updates": updates, "remove": list(remove), "baseVersion": version})

        assert put({"mail": "g@example.org", "phone": "555 0101"}).status_code == 200
        r = put({"files": ["Attachments/report.pdf", "Attachments/pixel.png"]})
        assert r.status_code == 200, r.text
        text = (m12_dir / path).read_text("utf-8")
        assert "files: ['[[Attachments/report.pdf]]', '[[Attachments/pixel.png]]']" in text
        assert _row(space, path)["files"] == ["Attachments/report.pdf", "Attachments/pixel.png"]
        before = (m12_dir / path).read_bytes()
        for updates in ({"mail": "nope"}, {"phone": "x1"}, {"files": ["Pages/x.md"]},
                        {"double": 3}, {"teamHours": 1}, {"code": "PRJ-9"}):
            r = put(updates)
            assert r.status_code == 422, (updates, r.text)
        assert put({}, remove=["code"]).status_code == 422
        assert (m12_dir / path).read_bytes() == before


# -- ID -----------------------------------------------------------------------------------------


def test_id_at_create_and_duplicate(m12_dir: Path):
    space = _space(m12_dir)
    a, _ = space.create_object("project", "One")
    b, _ = space.create_object("project", "Two", values={"budget": 3})
    assert _fm(m12_dir, a)["code"] == "PRJ-1"
    assert _fm(m12_dir, b)["code"] == "PRJ-2"
    t1, _ = space.create_object("ticket", "T")
    assert _fm(m12_dir, t1)["num"] == 7  # no prefix: the number itself
    copy_path, _, _ = space.duplicate_object(b)
    assert _fm(m12_dir, copy_path)["code"] == "PRJ-3"
    stored = json.loads((m12_dir / ".object/types/project.json").read_text("utf-8"))
    code = next(p for p in stored["propertyDefinitions"] if p["key"] == "code")
    assert code["options"]["nextNumber"] == 4
    # A value in the create request can't set the ID.
    with pytest.raises(InvalidValue):
        space.create_object("project", "Three", values={"code": "X"})
    # A deleted object's number is never reused.
    space.delete_object(a)
    c, _ = space.create_object("project", "Four")
    assert _fm(m12_dir, c)["code"] == "PRJ-4"


def test_concurrent_creates_never_share_an_id(m12_dir: Path):
    space = _space(m12_dir)
    paths: list[str] = []
    errors: list[BaseException] = []

    def make(i: int) -> None:
        try:
            paths.append(space.create_object("project", f"P{i}")[0])
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=make, args=(i,)) for i in range(12)]
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    assert not errors
    codes = sorted(int(_fm(m12_dir, p)["code"].removeprefix("PRJ-")) for p in paths)
    assert codes == list(range(1, 13))


def test_create_route_announces_type(m12_dir: Path):
    space = _space(m12_dir)
    app = create_app(space, None, watch=False)
    with TestClient(app) as c:
        r = c.post("/api/objects", json={"typeId": "project", "title": "X", "clientId": "w"})
        assert r.status_code == 201 and r.json()["typeIds"] == ["project"]
        r = c.post("/api/objects", json={"typeId": "page", "title": "Y", "clientId": "w"})
        assert r.status_code == 201 and r.json()["typeIds"] == []


def test_number_existing(m12_dir: Path):
    space = _space(m12_dir)
    apollo, gemini = m12_dir / "Projects/Apollo.md", m12_dir / "Projects/Gemini.md"
    app = create_app(space, None, watch=False)
    published: list = []
    app.state.hub.publish = published.append
    with TestClient(app) as c:
        url = "/api/types/project/properties/p-code/number-existing"
        r = c.post(url, json={"baseRevision": "stale"})
        assert r.status_code == 409 and r.json()["currentRevision"] == _rev(space, "project")
        r = c.post("/api/types/project/properties/nope/number-existing",
                   json={"baseRevision": _rev(space, "project")})
        assert r.status_code == 404
        r = c.post("/api/types/nope/properties/p-code/number-existing", json={"baseRevision": ""})
        assert r.status_code == 404
        r = c.post("/api/types/project/properties/p-budget/number-existing",
                   json={"baseRevision": _rev(space, "project")})
        assert r.status_code == 422
        before = apollo.read_bytes()
        r = c.post(url, json={"baseRevision": _rev(space, "project"), "clientId": "w1"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body) == {"type", "numbered", "rewritten", "skipped"}
        assert body["numbered"] == 2 and body["skipped"] == []
        # Oldest createdAt first: Gemini (Jan 15) before Apollo (Feb 1).
        assert body["rewritten"] == ["Projects/Gemini.md", "Projects/Apollo.md"]
        assert _fm(m12_dir, "Projects/Gemini.md")["code"] == "PRJ-1"
        assert _fm(m12_dir, "Projects/Apollo.md")["code"] == "PRJ-2"
        code = next(p for p in body["type"]["propertyDefinitions"] if p["key"] == "code")
        assert code["options"]["nextNumber"] == 3
        assert body["type"]["revision"] == _rev(space, "project")
        # Unstamped: only the added line.
        after = apollo.read_bytes()
        assert after.replace(b"code: PRJ-2\n", b"") == before
        assert b"lastUpdated: 2026-01-15T00:00:00.000Z" in gemini.read_bytes()
        deadline = time.monotonic() + 2
        while len(published) < 3 and time.monotonic() < deadline:
            time.sleep(0.01)
        assert {(e.kind, e.path, e.origin) for e in published} == {
            ("types", "project", "w1"),
            ("changed", "Projects/Gemini.md", "w1"),
            ("changed", "Projects/Apollo.md", "w1"),
        }
        # Again: nothing left to number.
        r = c.post(url, json={"baseRevision": _rev(space, "project")})
        assert r.json()["numbered"] == 0 and r.json()["rewritten"] == []
        # The next created object continues the sequence.
        r = c.post("/api/objects", json={"typeId": "project", "title": "New"})
        assert _fm(m12_dir, r.json()["path"])["code"] == "PRJ-3"


# -- type save --------------------------------------------------------------------------------


def _edit(space: Space, type_id: str):
    return copy.deepcopy(space.type_by_id(type_id))


def _p(t, key):
    return next(p for p in t.propertyDefinitions if p.key == key)


def _save(space, t, confirm=False):
    return space.save_type(t, _rev(space, t.id), confirm=confirm)


def _invalid(space, t, *words):
    with pytest.raises(InvalidValue) as exc:
        _save(space, t)
    for w in words:
        assert w in str(exc.value)


def test_formula_only_edits_rewrite_nothing(m12_dir: Path):
    space = _space(m12_dir)
    before = {k: v for k, v in _snapshot(m12_dir).items() if not k.startswith(".object/")}
    t = _edit(space, "project")
    t.propertyDefinitions.append(PropertyDefinition.from_json(
        _prop("p-new", "newOne", "New one", "formula", expression='prop("Budget") + 1')))
    t.propertyDefinitions.append(PropertyDefinition.from_json(
        _prop("p-new2", "newTwo", "New two", "rollup", relationId="p-members",
              targetId="m-hours", calc="max")))
    result = _save(space, t)  # no ConfirmRequired
    assert result.rewritten == []
    t = _edit(space, "project")
    _p(t, "double").options["expression"] = 'prop("Budget") * 3'
    _p(t, "teamHours").options["calc"] = "average"
    _save(space, t)
    assert _row(space, "Projects/Apollo.md")["double"] == {"type": "number", "value": 300}
    assert _row(space, "Projects/Apollo.md")["teamHours"] == {"type": "number", "value": 6.25}
    t = _edit(space, "project")
    t.propertyDefinitions = [p for p in t.propertyDefinitions
                             if p.key not in ("double", "teamHours", "newOne", "newTwo", "ref")]
    _save(space, t)  # deleting formulas and rollups asks nothing
    after = {k: v for k, v in _snapshot(m12_dir).items() if not k.startswith(".object/")}
    assert after == before


def test_deleting_an_id_property_still_confirms(m12_dir: Path):
    space = _space(m12_dir)
    space.create_object("project", "Numbered")
    t = _edit(space, "project")
    t.propertyDefinitions = [p for p in t.propertyDefinitions if p.key != "code"]
    with pytest.raises(ConfirmRequired):
        _save(space, t)


def test_save_type_validations(m12_dir: Path):
    space = _space(m12_dir)
    t = _edit(space, "project")
    _p(t, "double").options["expression"] = 'prop("Budget") *'
    _invalid(space, t, "Double")
    t = _edit(space, "project")
    _p(t, "double").options["expression"] = "x" * 2001
    _invalid(space, t, "Double", "2000")
    t = _edit(space, "project")
    _p(t, "double").options["expression"] = 'prop("Double") + 1'
    _invalid(space, t, "Double", "refers to itself")
    t = _edit(space, "project")
    _p(t, "double").options["expression"] = 'prop("Label") + 1'
    _p(t, "label").options["expression"] = 'prop("double")'  # case-insensitive name
    _invalid(space, t, "refers to itself")
    # Through a rollup: the Member formula reads a rollup that reads it back.
    m = _edit(space, "member")
    _p(m, "double").options["expression"] = 'prop("Roll")'
    m.propertyDefinitions.append(PropertyDefinition.from_json(
        _prop("m-rel", "rel", "Rel", "entity", isArray=True, allowedTypes=["member"],
              hasFixedSet=False, fixedSet=[])))
    _p(m, "roll").options.update(relationId="m-rel", targetId="m-double", calc="sum")
    _invalid(space, m, "refers to itself")
    # Rollup of a rollup.
    t = _edit(space, "project")
    _p(t, "teamHours").options["targetId"] = "m-roll"
    _invalid(space, t, "Team hours", "another rollup")
    t = _edit(space, "project")
    _p(t, "teamHours").options["relationId"] = "p-budget"
    _invalid(space, t, "Team hours", "relation")
    t = _edit(space, "project")
    _p(t, "teamHours").options["relationId"] = "missing"
    _invalid(space, t, "relation")
    t = _edit(space, "project")
    _p(t, "teamHours").options["calc"] = "bogus"
    _invalid(space, t, "calculation")
    for prefix in ("has space", "x" * 21, "ü"):
        t = _edit(space, "project")
        _p(t, "code").options["prefix"] = prefix
        _invalid(space, t, "prefix")
    # Allowed: an empty relation, a formula target, a long but flat expression.
    t = _edit(space, "project")
    _p(t, "teamHours").options.update(relationId="", targetId="")
    _p(t, "label").options["expression"] = ""
    _save(space, t)
    assert _row(space, "Projects/Apollo.md")["teamHours"] == E
    assert _row(space, "Projects/Apollo.md")["label"] == E


def test_next_number_never_moves_back(m12_dir: Path):
    space = _space(m12_dir)
    stale = _edit(space, "project")
    for i in range(3):
        space.create_object("project", f"N{i}")
    t = _edit(space, "project")
    _p(t, "code").options = copy.deepcopy(_p(stale, "code").options)  # nextNumber 1
    _p(t, "code").options["prefix"] = "P-"
    result = _save(space, t)
    assert _p(result.type, "code").options == {"prefix": "P-", "nextNumber": 4}
    t = _edit(space, "project")
    _p(t, "code").options["nextNumber"] = 50  # moving it forward is fine
    assert _p(_save(space, t).type, "code").options["nextNumber"] == 50
    assert _fm(m12_dir, space.create_object("project", "Z")[0])["code"] == "P-50"


def test_rename_rewrites_formulas(m12_dir: Path):
    space = _space(m12_dir)
    before = {k: v for k, v in _snapshot(m12_dir).items() if not k.startswith(".object/")}
    t = _edit(space, "project")
    _p(t, "budget").name = "Cost"
    _p(t, "label").options["expression"] = 'prop("budget") + "/" + prop("Title") + "Budget"'
    _p(t, "teamHours").name = "Hours of team"
    result = _save(space, t)
    assert _p(result.type, "double").options["expression"] == 'prop("Cost") * 2'
    assert _p(result.type, "label").options["expression"] == (
        'prop("Cost") + "/" + prop("Title") + "Budget"'
    )
    assert _p(result.type, "ref").options["expression"] == 'prop("Hours of team") + 1'
    stored = json.loads((m12_dir / ".object/types/project.json").read_text("utf-8"))
    assert any(p["options"].get("expression") == 'prop("Cost") * 2'
               for p in stored["propertyDefinitions"])
    assert _row(space, "Projects/Apollo.md")["double"] == {"type": "number", "value": 200}
    after = {k: v for k, v in _snapshot(m12_dir).items() if not k.startswith(".object/")}
    assert after == before


def test_save_route_names_property(m12_dir: Path):
    space = _space(m12_dir)
    with TestClient(create_app(space, None, watch=False)) as c:
        project = space.type_by_id("project").to_api(_rev(space, "project"))
        for p in project["propertyDefinitions"]:
            if p["key"] == "double":
                p["options"]["expression"] = 'prop("Double")'
        r = c.put("/api/types/project", json={"type": project, "baseRevision": project["revision"]})
        assert r.status_code == 422 and "Double" in r.json()["detail"]


# -- preview ----------------------------------------------------------------------------------


def test_formula_preview(m12_dir: Path):
    space = _space(m12_dir)
    before = _snapshot(m12_dir)
    with TestClient(create_app(space, None, watch=False)) as c:
        def preview(**body):
            r = c.post("/api/formula/preview", json={"typeId": "project", **body})
            assert r.status_code == 200, r.text
            return r.json()

        assert preview(expression='prop("Budget") + 1') == {"value": None, "error": None}
        out = preview(expression='prop("Budget") +')
        assert out["value"] is None and "end of the formula" in out["error"]
        assert preview(expression='prop("Budget") + 1', path="Projects/Apollo.md") == {
            "value": {"type": "number", "value": 101}, "error": None}
        out = preview(expression='prop("Nope")', path="Projects/Apollo.md")
        assert out["value"]["type"] == "error" and out["error"] == 'Unknown property "Nope"'
        # Unsaved definitions: Budget renamed to Cost and an unsaved formula.
        props = space.type_by_id("project").to_api("")["propertyDefinitions"]
        for p in props:
            if p["key"] == "budget":
                p["name"] = "Cost"
        props.append(_prop("tmp", "tmp", "Tmp", "formula", expression='prop("Cost") - 1'))
        out = preview(expression='prop("Tmp") * 10', path="Projects/Apollo.md", properties=props)
        assert out == {"value": {"type": "number", "value": 990}, "error": None}
        r = c.post("/api/formula/preview", json={"typeId": "nope", "expression": "1"})
        assert r.status_code == 404
        r = c.post("/api/formula/preview",
                   json={"typeId": "project", "expression": "1", "path": "Projects/Nope.md"})
        assert r.status_code == 404
    assert _snapshot(m12_dir) == before


def test_template_never_copies_the_id(m12_dir: Path):
    space = _space(m12_dir)
    rel, _ = space.create_template("project", "Tpl")
    p = m12_dir / rel
    text = p.read_text("utf-8")
    assert "template: Tpl\n" in text
    p.write_text(text.replace("template: Tpl\n", "template: Tpl\ncode: PRJ-99\nbudget: 5\n"), "utf-8")
    space.rescan_file(rel)
    tid = space.type_by_id("project").templates["ids"][-1]
    made, _ = space.create_object("project", "From template", template_id=tid)
    fm = _fm(m12_dir, made)
    assert fm["code"] == "PRJ-1" and fm["budget"] == 5


# -- review fixes (2026-11-05) ---------------------------------------------------------------------


def test_huge_numbers_in_rollups_are_errors(m12_dir: Path):
    _write(m12_dir / "Members" / "Ann.md",
           "---\ntype: 'Member'\ntitle: Ann\nhours: " + "1" + "0" * 320 + "\n---\n")
    space = _space(m12_dir)
    too_large = {"type": "error", "value": None, "error": "Number too large"}
    v = _row(space, "Projects/Apollo.md")
    assert v["teamHours"] == too_large  # sum: float() overflows
    assert v["ref"] == too_large  # a formula over it says the same
    assert v["teamCount"] == {"type": "number", "value": 3}  # the others still compute
    t = _edit(space, "project")
    for calc in ("average", "median", "max"):
        _p(t, "teamHours").options["calc"] = calc
        _save(space, t)
        t = _edit(space, "project")
        assert _row(space, "Projects/Apollo.md")["teamHours"] == too_large, calc
    with TestClient(create_app(space, None, watch=False)) as c:
        r = c.get("/api/object", params={"path": "Projects/Apollo.md"})
        assert r.status_code == 200
        assert r.json()["computed"]["teamHours"] == too_large
        r = c.post("/api/rows", json={"typeIds": ["project"]})
        assert r.status_code == 200


def test_kind_change_keeps_the_rollup_relation(m12_dir: Path):
    # Changing a relation's kind adds a new property and keeps the old relation, so the
    # rollups over it still work and the type still saves.
    space = _space(m12_dir)
    space.change_property_kind("project", "p-members", "text", _rev(space, "project"))
    t = _edit(space, "project")
    assert _p(t, "members").type == "entity"
    _p(t, "budget").name = "Money"
    _save(space, t)
    assert _row(space, "Projects/Apollo.md")["teamHours"] == {"type": "number", "value": 12.5}


def test_a_stored_broken_rollup_never_locks_the_type(m12_dir: Path):
    f = m12_dir / ".object/types/project.json"
    data = json.loads(f.read_text("utf-8"))
    for p in data["propertyDefinitions"]:
        if p["id"] == "p-hours":
            p["options"]["relationId"] = "p-budget"  # not a relation
        if p["id"] == "p-count":
            p["options"]["relationId"] = "gone"  # missing
    f.write_text(json.dumps(data, indent=2) + "\n", "utf-8")
    space = _space(m12_dir)
    assert _row(space, "Projects/Apollo.md")["teamHours"] == E
    assert _row(space, "Projects/Apollo.md")["teamCount"] == E
    # Other edits still save while the broken rollups are left as they are.
    t = _edit(space, "project")
    _p(t, "budget").name = "Money"
    _save(space, t)
    # Changing a broken rollup checks it again.
    t = _edit(space, "project")
    _p(t, "teamHours").options["calc"] = "average"
    _invalid(space, t, "Team hours", "relation")
    # Removing the relation a working rollup uses is still refused.
    t = _edit(space, "project")
    t.propertyDefinitions = [p for p in t.propertyDefinitions if p.key != "members"]
    _invalid(space, t, "relation")
