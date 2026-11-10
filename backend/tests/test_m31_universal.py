"""M31 item 3 (plan ``2026-11-10-m31-completion.md``, Gene's decisions 1 and 3): spaces never change
behaviour, and G3 "drop the duplicate".

- The import's conventions (no look-alike types, with the offer "Use <type>, with a category";
  categories never types; relations to no known type stay plain links) apply in **every**
  space, whatever its setup: ``space-sample`` (no setup, no IT ops types) gets them too, and the
  same proposal gives the same result in a space set up as ``itops`` or ``blank``.
- An Incident has one Resolved (its own date and time): the starter's and the gallery's Incident
  have no ``deskResolved``; Desk sync writes an Incident's resolved time into its own Resolved, and an
  M28-era Incident that still has ``deskResolved`` keeps working (nothing changes its type).
"""

from __future__ import annotations

import json
import shutil
from datetime import UTC, datetime
from pathlib import Path

from m30_helpers import FIXTURES, itops_space

from objectapp import desksync, spaceconfig, workread
from objectapp.basicsetup import itops_types
from objectapp.importers import batches, proposal
from objectapp.space import Space
from objectapp.typetemplates import get_template
from objectapp.workservice import Actor, WorkService

NOW = datetime(2026, 11, 10, 10, 0, tzinfo=UTC)
SERVER_PROPS = [{"name": "Cores", "kind": "number", "share": 1.0},
                {"name": "Owner", "kind": "text", "share": 1.0}]
PROJECT_PROPS = [{"name": n, "kind": k, "share": 1.0} for n, k in (
    ("Budget", "number"), ("Progress", "number"), ("Done", "boolean"), ("Site", "url"), ("Time Frame", "datetime"),
    ("Kickoff", "datetime"))] + [{"name": n, "kind": "entity", "target": "Person", "share": 1.0} for n in ("Lead", "Members")]
"""Every specific property of ``space-sample``'s Project (by name and kind): a real look-alike (M31 fix pass)."""
OWN = [{"name": "Hypervisor version", "kind": "text", "share": 1.0},
       {"name": "Memory", "kind": "number", "share": 1.0}]


def _create(name: str, props, iid: str) -> dict:
    return {"id": iid, "action": "create", "group": name, "name": name, "documents": 10,
            "examples": [f"Wiki/{name} 1.md"], "properties": props}


def _save(root: Path, *items: dict) -> list[dict]:
    batch = batches.create_draft(root, "/x")
    return proposal.save_proposal(Space(root), batch, {"summary": "", "items": list(items)})["items"]


def _sample(tmp_path: Path) -> Path:
    root = tmp_path / "space-sample"
    shutil.copytree(FIXTURES / "space-sample", root)
    return root


# -- (a) the conventions in every space ---------------------------------------------------------


def test_conventions_in_every_space(tmp_path) -> None:
    """``space-sample`` has no setup and none of the IT ops types: the rules still hold."""
    root = _sample(tmp_path)
    assert spaceconfig.read(root)[0].get("setup") is None
    rel = {"id": "g3", "action": "extend", "group": "Servers", "name": "Server", "documents": 10,
           "properties": [{"name": "Owner", "kind": "entity", "target": "Person", "share": 1.0},
                          {"name": "Backs up", "kind": "entity", "target": "Vault", "share": 1.0}]}
    box, docs, ext, cores = _save(root, _create("Box", PROJECT_PROPS, "g1"), _create("Docs", OWN, "g2"), rel,
                                  _create("Rack", SERVER_PROPS, "g4"))
    assert box["problems"] == ["It has the same properties as Project."]
    assert box["offer"] == {"label": "Use Project, with a category", "typeId": "project", "category": "Box"}
    assert docs["problems"] == ["Docs is a category: a property value or a tag, not a type."]  # a tag
    assert [p["name"] for p in ext["properties"]] == ["Owner"]
    assert ext["dropped"] == [{"key": "backs-up", "name": "Backs up",
                               "reason": "It points at Vault, which is neither a type in this space nor one "
                                         "proposed here; it stays a plain link."}]
    assert cores["problems"] == []  # two properties named like Server's are not a look-alike


def test_setup_never_changes_the_rules(tmp_path) -> None:
    """The same proposal gives the same checked items whether the space says ``itops`` or ``blank``."""
    root = itops_space(tmp_path)
    items = [_create("Box", SERVER_PROPS, "g1"), _create("Workstation", OWN, "g2"),
             _create("Kiosk", OWN, "g3")]
    as_itops = _save(root, *items)
    spaceconfig.set_internal(root, "setup", "blank")
    as_blank = _save(root, *items)
    assert as_itops == as_blank
    assert not hasattr(proposal, "is_itops_space")


# -- (b) G3: one Resolved on an Incident -------------------------------------------------------


def test_incident_has_one_resolved() -> None:
    incident = next(t for t in itops_types() if t.id == "incident")
    assert incident.prop("deskResolved") is None
    resolved = incident.prop("resolved")
    assert resolved.name == "Resolved" and resolved.type == "datetime"
    assert [p.name for p in incident.propertyDefinitions].count("Resolved") == 1
    gallery = get_template("incident")
    assert "deskResolved" not in [p.key for p in gallery.props()]
    # Project keeps its ticket fields' Resolved.
    project = next(t for t in itops_types() if t.id == "project")
    assert project.prop("deskResolved").name == "Resolved"


INCIDENT = "Incidents/Printer down.md"


def _write_incident(root: Path) -> None:
    f = root / INCIDENT
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("---\ntype: Incident\ntitle: Printer down\nstatus: Open\nticketId: OPS-12\n---\n\nIt broke.\n",
                 encoding="utf-8")


def _service(root: Path) -> WorkService:
    space = Space(root)
    space.clock = lambda: NOW
    space.tz = UTC
    return WorkService(space, jira_site=lambda: None, user_name=lambda: "Gene")


def test_desk_sync_writes_an_incidents_own_resolved(tmp_path) -> None:
    root = itops_space(tmp_path)
    _write_incident(root)
    service = _service(root)
    version = service.space.read(INCIDENT)[2]
    desksync.apply_ticket_fields(service, INCIDENT, version,
                                 {"deskStatus": "Resolved", "deskResolved": "2026-11-09T14:30:00Z"},
                                 Actor("agent", "Work"))
    text = (root / INCIDENT).read_text(encoding="utf-8")
    assert "deskResolved" not in text
    assert "resolved: 2026-11-09T14:30:00.000Z" in text
    assert "Work set Desk status to Resolved; set Resolved to 2026-11-09" in text
    data = workread.item_data(service.space, INCIDENT, now=NOW, jira_site=None)
    assert data.ticket["resolved"] == "2026-11-09"


def test_m28_era_incident_keeps_desk_resolved(tmp_path) -> None:
    """The M28 fixture's Incident type still has ``deskResolved``: Desk sync writes it there, as before."""
    root = tmp_path / "space-itops"
    shutil.copytree(FIXTURES / "space-itops", root)
    before = (root / ".object" / "types" / "incident.json").read_bytes()
    assert any(p["key"] == "deskResolved" for p in json.loads(before)["propertyDefinitions"])
    _write_incident(root)
    service = _service(root)
    version = service.space.read(INCIDENT)[2]
    desksync.apply_ticket_fields(service, INCIDENT, version, {"deskResolved": "2026-11-09"},
                                 Actor("agent", "Work"))
    text = (root / INCIDENT).read_text(encoding="utf-8")
    assert "deskResolved: 2026-11-09" in text
    assert "\nresolved:" not in text
    assert (root / ".object" / "types" / "incident.json").read_bytes() == before
    data = workread.item_data(service.space, INCIDENT, now=NOW, jira_site=None)
    assert data.ticket["resolved"] == "2026-11-09"
