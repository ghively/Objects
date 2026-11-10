"""M28 Task 5: reading and editing counterparts in the space (``Space.counterparts``,
``Space.counterpart_defs``, ``Space.edit_counterpart``) and the counterpart check on type save.

Plan ``docs/superpowers/plans/2026-11-09-m28-itops-starter-and-relations.md``, Contract
"Counterparts" and Review Focus 1 and 3. Every test runs on a copy of the ``space-itops``
fixture committed to a throw-away git repo, so ``git status`` shows any write.
"""

from __future__ import annotations

import copy
import difflib
import re
import shutil
import subprocess
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.counterparts import COUNTERPART_NAME, counterpart_defs
from objectapp.propvalues import InvalidValue
from objectapp.server import create_app
from objectapp.space import Skip, Space, version_of
from objectapp.typemodel import type_revision

FIXTURE = Path(__file__).parent / "fixtures" / "space-itops"

APP01 = "Hosts/APP-TEST-01.md"
DB01 = "Hosts/DB-TEST-01.md"
INVENTORY = "Applications/Inventory app.md"
BACKUP = "Configurations/Backup schedule.md"
SQL = "Software/SQL Server 2019.md"
WINDOWS = "Software/Windows Server 2022.md"
SAM = "People/Sam Example.md"


def _git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
         "-c", "core.autocrlf=false", *args],
        cwd=root, check=True, capture_output=True, text=True,
    ).stdout


def _commit(root: Path, message: str) -> None:
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", message)


def _status(root: Path) -> list[str]:
    """The changed or added files (``git status`` paths)."""
    out = _git(root, "status", "--porcelain", "--untracked-files=all")
    return sorted(line[3:].strip().strip('"') for line in out.splitlines() if line.strip())


@pytest.fixture
def root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    dst = tmp_path / "space"
    shutil.copytree(FIXTURE, dst)
    _git(dst, "init", "-q")
    _commit(dst, "fixture")
    return dst


def _owners(text: str) -> tuple[list[str], list[str]]:
    """Each line of an object file and the front matter key it belongs to (``<body>`` after)."""
    lines = text.splitlines(keepends=True)
    owners: list[str] = []
    fences = 0
    key = "<start>"
    for line in lines:
        s = line.lstrip("﻿").rstrip("\r\n")
        if s == "---" and fences < 2:
            fences += 1
            owners.append("---")
            continue
        if fences != 1:
            owners.append("<body>")
            continue
        m = re.match(r"^([A-Za-z_][\w-]*)\s*:", s)
        if m:
            key = m.group(1)
        owners.append(key)
    return lines, owners


def hunk_keys(before: bytes, after: bytes) -> set[str]:
    """The front matter keys whose lines differ between two versions of a file."""
    a_lines, a_own = _owners(before.decode("utf-8"))
    b_lines, b_own = _owners(after.decode("utf-8"))
    keys: set[str] = set()
    sm = difflib.SequenceMatcher(a=a_lines, b=b_lines, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag != "equal":
            keys.update(a_own[i1:i2])
            keys.update(b_own[j1:j2])
    return keys


def _row(rows: list[dict], key: str, source: str) -> dict:
    found = [r for r in rows if r["key"] == key and r["sourceTypeId"] == source]
    assert len(found) == 1, rows
    return found[0]


# -- Review Focus 1: an edit writes only the stored side ---------------------------------------


def test_counterpart_edit_touches_only_the_stored_side(root: Path) -> None:
    space = Space(root)
    db_before = (root / DB01).read_bytes()
    inv_before = (root / INVENTORY).read_bytes()

    result = space.edit_counterpart(DB01, "runs", "application", add=[INVENTORY], remove=[])

    inv_after = (root / INVENTORY).read_bytes()
    assert result.written == [(INVENTORY, version_of(inv_after))]
    assert result.skipped == []
    assert _status(root) == [INVENTORY]
    assert hunk_keys(inv_before, inv_after) == {"runsOn", "lastUpdated"}
    assert list(space.read(INVENTORY)[1]["runsOn"]) == ["[[APP-TEST-01]]", "[[DB-TEST-01]]"]
    assert (root / DB01).read_bytes() == db_before
    assert _row(result.counterparts, "runs", "application")["paths"] == [INVENTORY]
    assert space.counterparts(DB01) == result.counterparts

    # Removing from the CRLF+BOM host's row writes Inventory app only.
    _commit(root, "after add")
    app_before = (root / APP01).read_bytes()
    inv_before = (root / INVENTORY).read_bytes()
    result = space.edit_counterpart(APP01, "runs", "application", add=[], remove=[INVENTORY])
    inv_after = (root / INVENTORY).read_bytes()
    assert result.written == [(INVENTORY, version_of(inv_after))]
    assert _status(root) == [INVENTORY]
    assert (root / APP01).read_bytes() == app_before
    assert hunk_keys(inv_before, inv_after) == {"runsOn", "lastUpdated"}
    assert list(space.read(INVENTORY)[1]["runsOn"]) == ["[[DB-TEST-01]]"]
    assert _row(result.counterparts, "runs", "application")["paths"] == []


def test_removing_the_last_link_writes_the_key_as_update_properties_does(
    root: Path, tmp_path: Path
) -> None:
    now = datetime(2026, 11, 10, 9, 0, tzinfo=UTC)
    space = Space(root)
    space.clock = lambda: now
    result = space.edit_counterpart(APP01, "runs", "application", remove=[INVENTORY], add=[])
    assert [w[0] for w in result.written] == [INVENTORY]

    # The same file written by `update_properties` with an empty relation, as the property
    # routes do today, on a second copy at the same instant: the bytes are the same.
    other = tmp_path / "other"
    shutil.copytree(FIXTURE, other)
    plain = Space(other)
    plain.clock = lambda: now
    plain.update_properties(INVENTORY, {"runsOn": []}, plain.read(INVENTORY)[2])
    assert (root / INVENTORY).read_bytes() == (other / INVENTORY).read_bytes()
    assert _row(space.counterparts(APP01), "runs", "application")["paths"] == []


def test_edit_into_a_crlf_file(root: Path) -> None:
    lf = (root / BACKUP).read_bytes()
    (root / BACKUP).write_bytes(b"\xef\xbb\xbf" + lf.replace(b"\n", b"\r\n"))
    _commit(root, "crlf")
    space = Space(root)
    before = (root / BACKUP).read_bytes()

    result = space.edit_counterpart(
        APP01, "configuredBy", "configuration", add=[BACKUP], remove=[]
    )

    after = (root / BACKUP).read_bytes()
    assert result.written == [(BACKUP, version_of(after))]
    assert after.startswith(b"\xef\xbb\xbf")
    assert b"\n" not in after.replace(b"\r\n", b"")
    assert list(space.read(BACKUP)[1]["appliesTo"]) == ["[[DB-TEST-01]]", "[[APP-TEST-01]]"]
    assert hunk_keys(before, after) == {"appliesTo", "lastUpdated"}
    assert _status(root) == [BACKUP]


def test_single_source_is_replaced(root: Path) -> None:
    space = Space(root)
    result = space.edit_counterpart(SQL, "installedOn", "host", add=[DB01], remove=[])
    assert [w[0] for w in result.written] == [DB01]
    assert space.read(DB01)[1]["operatingSystem"] == "[[SQL Server 2019]]"
    assert _row(result.counterparts, "installedOn", "host")["paths"] == [DB01]
    assert _row(space.counterparts(WINDOWS), "installedOn", "host")["paths"] == [APP01]
    assert _status(root) == [DB01]


def test_edit_errors(root: Path) -> None:
    space = Space(root)
    with pytest.raises(InvalidValue) as exc:
        space.edit_counterpart(APP01, "nope", "application", add=[INVENTORY], remove=[])
    assert str(exc.value) == 'This object has no "nope" relation from Application.'
    with pytest.raises(InvalidValue) as exc:
        space.edit_counterpart(APP01, "runs", "application", add=[SAM], remove=[])
    assert str(exc.value) == '"Sam Example" isn\'t of type Application.'
    result = space.edit_counterpart(APP01, "runs", "application", add=["Applications/Gone.md"], remove=[])
    assert result.written == []
    assert result.skipped == [Skip("Applications/Gone.md", "It's gone.")]
    already = space.edit_counterpart(APP01, "runs", "application", add=[INVENTORY], remove=[])
    assert already.written == [] and already.skipped == []
    with pytest.raises(KeyError):
        space.edit_counterpart("Hosts/Nobody.md", "runs", "application", add=[INVENTORY], remove=[])
    assert _status(root) == []


def test_counterpart_defs_of_the_space(root: Path) -> None:
    space = Space(root)
    assert [d.key for d in space.counterpart_defs("host")] == [
        d.key for d in counterpart_defs("host", space.types)
    ]
    assert space.counterpart_defs("nope") == []


# -- Review Focus 3: a type save checks its counterparts ---------------------------------------


def test_save_type_checks_counterparts(root: Path) -> None:
    space = Space(root)
    type_file = root / ".object" / "types" / "application.json"
    before = type_file.read_bytes()
    rev = type_revision(root, "application")

    taken = copy.deepcopy(space.type_by_id("application"))
    taken.prop("runsOn").options["counterpart"] = {"name": "Runs", "key": "category"}
    with pytest.raises(InvalidValue) as exc:
        space.save_type(taken, rev)
    assert str(exc.value) == 'Host already has a property with the key "category".'
    assert type_file.read_bytes() == before

    app = create_app(space, None, watch=False)
    app.state.hub.publish = lambda _e: None
    client = TestClient(app)
    served = next(t for t in client.get("/api/space").json()["types"] if t["id"] == "application")
    for p in served["propertyDefinitions"]:
        if p["key"] == "runsOn":
            p["options"]["counterpart"] = {"name": "", "key": "runs"}
    res = client.put("/api/types/application", json={"type": served, "baseRevision": served["revision"]})
    assert res.status_code == 422, res.text
    assert res.json()["detail"] == "The options of Runs on are not valid: counterpart."
    assert type_file.read_bytes() == before

    unnamed = copy.deepcopy(space.type_by_id("application"))
    unnamed.prop("runsOn").options["counterpart"] = {"name": "", "key": "runs"}
    with pytest.raises(InvalidValue) as exc:
        space.save_type(unnamed, rev)
    assert str(exc.value) == COUNTERPART_NAME
    assert type_file.read_bytes() == before
    assert _status(root) == []


def test_save_type_with_good_counterparts_still_saves(root: Path) -> None:
    space = Space(root)
    t = copy.deepcopy(space.type_by_id("application"))
    t.description = "Changed."
    result = space.save_type(t, type_revision(root, "application"))
    assert result.type.prop("runsOn").options["counterpart"] == {"name": "Runs", "key": "runs"}


# -- the gallery's self-pointing relation (T4/T7 finding) --------------------------------------


def test_gallery_location_part_of_points_at_the_new_type(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    blank = tmp_path / "blank"
    blank.mkdir()
    space = Space(blank)
    t = space.create_type("", "", template="location")
    assert t.id == "location"
    assert t.prop("partOf").options["allowedTypes"] == ["location"]
    assert [d.key for d in space.counterpart_defs("location")] == ["contains"]

    # A second type from the same entry points at itself, not at the first.
    other = space.create_type("Place", "Places", template="location")
    assert other.prop("partOf").options["allowedTypes"] == [other.id]
    # Other targets still resolve against the space's types as before.
    host = space.create_type("", "", template="host")
    assert host.prop("locatedAt").options["allowedTypes"] == ["location"]
