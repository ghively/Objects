"""M30 Task 7: the IT ops conventions as hard rules in M27's schema proposal (plan
``2026-11-09-m30-entity-extraction.md``, Task 7; design 2026-11-09 section 5b): existing types
first, no look-alike types ("Use <type>, with a category"), categories never types, relations
outside the named set stay plain links. M31 (Gene's decision 1): the rules hold in every space,
whatever its setup (`test_rules_in_every_space`). M31 fix pass: a look-alike shares at least three
specific properties (by name and kind, the common ones left out) that are 80% of both types'
specific properties together; a relation to an existing or proposed type is kept; a category name
blocks only on an item that looks like the type holding it (else a note and the offer).

``space-sample`` (which `itops_space` copies) already has a type named Server (id ``server``,
properties Cores and Owner). A proposed ``create "Server"`` with Host's properties is still a
look-alike of Host: the rule compares it with every other type, and the offer replaces M27's
"already exists; use or extend it" advice, which would point at the wrong type.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest
from m30_helpers import FIXTURES, itops_space

from objectapp import spaceconfig
from objectapp.importers import batches, proposal
from objectapp.space import Space

HOST_PROPS = [
    {"name": "IP address", "kind": "text", "share": 1.0},
    {"name": "FQDN", "kind": "text", "share": 0.9},
    {"name": "Operating system", "kind": "entity", "target": "Software", "share": 0.8},
    {"name": "Environment", "kind": "label", "share": 1.0, "options": ["Production", "Test"]},
    {"name": "Category", "kind": "label", "share": 1.0, "options": ["Server"]},
    {"name": "Roles", "kind": "label", "share": 0.5, "options": ["DHCP"]},
    {"name": "Department", "kind": "label", "share": 0.5, "options": ["IT"]},
    {"name": "Located at", "kind": "entity", "target": "Location", "share": 1.0},
    {"name": "Network", "kind": "entity", "target": "Network", "share": 1.0},
    {"name": "Owned by", "kind": "entity", "target": "Person", "share": 1.0},
    {"name": "Last boot", "kind": "datetime", "share": 0.5},
    {"name": "Disk free", "kind": "number", "share": 0.5},
    {"name": "Patch state", "kind": "label", "share": 0.5, "options": ["Current"]},
    {"name": "Reboot pending", "kind": "boolean", "share": 0.5},
    {"name": "Last seen", "kind": "datetime", "share": 0.5},
]
"""Every specific property of the IT ops Host (by name and kind): a real look-alike."""
OWN = [{"name": "Hypervisor version", "kind": "text", "share": 1.0},
       {"name": "Memory", "kind": "number", "share": 1.0}]


def _create(name: str, props=None, iid: str = "g1", documents: int = 10) -> dict:
    return {"id": iid, "action": "create", "group": name, "name": name, "documents": documents,
            "examples": [f"Wiki/{name} 1.md"], "properties": props if props is not None else HOST_PROPS}


def _save(root: Path, *items: dict) -> tuple[str, list[dict]]:
    batch = batches.create_draft(root, "/x")
    stored = proposal.save_proposal(Space(root), batch, {"summary": "", "items": list(items)})
    return batch, stored["items"]


def _type_files(root: Path) -> dict[str, bytes]:
    return {p.name: p.read_bytes() for p in sorted((root / ".object" / "types").glob("*.json"))}


def _options(space: Space, type_id: str, key: str) -> list[str]:
    return [o["text"] for o in space.type_by_id(type_id).prop(key).options["set"]]


def _sample(tmp_path: Path) -> Path:
    root = tmp_path / "space-sample"
    shutil.copytree(FIXTURES / "space-sample", root)
    return root


def test_lookalike_type_refused_with_offer(tmp_path) -> None:
    root = itops_space(tmp_path)
    space = Space(root)
    assert space.type_by_id("server") is not None  # space-sample's own Server type
    before = _type_files(root)
    batch, items = _save(root, _create("Server"), _create("Box", iid="g2"))
    server, box = items
    assert server["problems"][0] == "It has the same properties as Host."
    assert server["offer"] == {"label": "Use Host, with a category", "typeId": "host", "category": "Server"}
    # Server is also a Host Category option; the offer stands in for M27's "use or extend it".
    assert "Server is a category: a property value or a tag, not a type." in server["problems"]
    assert not any("already exists" in p for p in server["problems"])
    assert box["problems"] == ["It has the same properties as Host."]
    assert box["offer"] == {"label": "Use Host, with a category", "typeId": "host", "category": "Box"}
    assert proposal.lookalike(box["properties"], space).id == "host"

    groups = proposal.view(space, batch)["proposal"]["groups"]
    assert [g["offer"] for g in groups] == [server["offer"], box["offer"]]

    proposal.save_review(space, batch, [{"id": "g1", "status": "accepted"}, {"id": "g2", "status": "accepted"}])
    out = proposal.apply(Space(root), batch)
    assert out["created"] == [] and out["extended"] == []
    assert {s["id"] for s in out["skipped"]} == {"g1", "g2"}
    assert next(s for s in out["skipped"] if s["id"] == "g2")["reason"] == "It has the same properties as Host."
    assert _type_files(root) == before


def test_lookalike_needs_three_shared_and_the_share(tmp_path) -> None:
    """M31 fix pass: the share is over both types' specific properties together (Host has 15)."""
    space = Space(itops_space(tmp_path))
    others = [{"name": n, "kind": "text"} for n in ("Rack unit", "Serial", "Asset tag", "Warranty")]
    assert proposal.lookalike(HOST_PROPS[:2], space) is None  # two shared are not enough
    assert proposal.lookalike(HOST_PROPS[:4], space) is None  # 4 of Host's 15
    assert proposal.lookalike(HOST_PROPS[:-4], space) is None  # 11 of 15: 73%
    assert proposal.lookalike(HOST_PROPS, space).id == "host"
    assert proposal.lookalike([*HOST_PROPS, *others[:3]], space).id == "host"  # 15 of 18: 83%
    assert proposal.lookalike([*HOST_PROPS, *others], space) is None  # 15 of 19: 79%
    squashed = [{**p, "name": {"IP address": "ip-address", "FQDN": "fqdn"}.get(p["name"], p["name"])} for p in HOST_PROPS]
    assert proposal.lookalike(squashed, space).id == "host"  # by the squashed name
    # Never the Source type (its pages are made only by an import), nor the type left out.
    assert proposal.lookalike([{"name": "Category", "kind": "label"}, {"name": "System", "kind": "label"}], space) is None
    assert proposal.lookalike(HOST_PROPS, space, exclude="host") is None


def test_category_name_refused(tmp_path) -> None:
    """A tag name is refused; an option of Host's Category is refused on an item with two of Host's
    specific properties, and is a note with the offer on one without (M31 fix pass)."""
    root = itops_space(tmp_path)
    like_host = [{"name": "IP address", "kind": "text", "share": 1.0}, {"name": "FQDN", "kind": "text", "share": 1.0},
                 *OWN]
    _batch, (vm, ws, ok, ws2) = _save(root, _create("VM", OWN), _create("Workstation", OWN, iid="g2"),
                                      _create("Kiosk", OWN, iid="g3"), _create("Workstation", like_host, iid="g4"))
    assert vm["problems"] == ["VM is a category: a property value or a tag, not a type."]  # a seed tag
    assert "offer" not in vm
    assert ws["problems"] == [] and ws["notes"] == ["Workstation is also one of Host's Category options."]
    assert ws["offer"] == {"label": "Use Host, with a category", "typeId": "host", "category": "Workstation"}
    assert ws2["problems"] == ["Workstation is a category: a property value or a tag, not a type."]
    assert ws2["offer"] == ws["offer"] and "notes" not in ws2
    assert ok["problems"] == [] and "offer" not in ok and "notes" not in ok


def test_only_category_kind_and_environment_options_are_categories(tmp_path) -> None:
    """Options of other labels (Host's Roles, Script's Language, Source's Category and System) don't
    make a name a category; Environment's do."""
    root = itops_space(tmp_path)
    names = ["DHCP", "Python", "Ticket", "Document", "Wiki", "Production", "Rack"]
    _batch, items = _save(root, *(_create(n, OWN, iid=f"g{i}") for i, n in enumerate(names, 1)))
    got = dict(zip(names, items, strict=True))
    for n in ("DHCP", "Python", "Ticket", "Document", "Wiki"):
        assert got[n]["problems"] == [] and "offer" not in got[n] and "notes" not in got[n], n
    # M31 fix pass: with none of the holder's properties, a category name is a note and the offer.
    assert got["Production"]["problems"] == []
    assert got["Production"]["notes"] == ["Production is also one of Host's Environment options."]
    assert got["Production"]["offer"] == {"label": "Use Host, with a category", "typeId": "host", "category": "Production"}
    assert got["Rack"]["notes"] == ["Rack is also one of Location's Kind options."]
    assert got["Rack"]["offer"]["typeId"] == "location"  # Location's Kind
    assert [pd.key for pd in proposal.category_labels(Space(root).type_by_id("host"))] == ["category", "environment"]
    assert proposal.category_labels(Space(root).type_by_id("source")) == []


def test_offer_applied(tmp_path) -> None:
    root = itops_space(tmp_path)
    batch, (kiosk,) = _save(root, _create("Kiosk"))
    assert kiosk["offer"] == {"label": "Use Host, with a category", "typeId": "host", "category": "Kiosk"}
    space = Space(root)
    with pytest.raises(proposal.ProposalInvalid):
        proposal.save_review(space, batch, [{"id": "g1", "status": "edited", "edited": {"useType": "nope", "category": "Kiosk"}}])
    with pytest.raises(proposal.ProposalInvalid):
        proposal.save_review(space, batch, [{"id": "g1", "status": "edited", "edited": {"useType": "host", "category": " "}}])
    proposal.save_review(space, batch, [{"id": "g1", "status": "edited", "edited": {"useType": "host", "category": "Kiosk"}}])
    count = len(space.types)
    out = proposal.apply(Space(root), batch)
    assert out["created"] == [] and out["extended"] == ["host"]
    space = Space(root)
    assert len(space.types) == count
    assert _options(space, "host", "category")[-1] == "Kiosk"
    assert _options(space, "host", "category").count("Kiosk") == 1
    assert proposal.approved_create_names(root, batch) == set()

    before = _type_files(root)
    again = proposal.apply(Space(root), batch)
    assert again["created"] == [] and again["extended"] == []
    assert _type_files(root) == before

    # A type with no Category label takes Kind; one with neither is a plain use.
    batch2, _ = _save(root, _create("Closet", [{"name": "Kind", "kind": "text", "share": 1.0},
                                               {"name": "Part of", "kind": "text", "share": 1.0}]))
    proposal.save_review(Space(root), batch2, [{"id": "g1", "status": "edited",
                                                "edited": {"useType": "location", "category": "Closet"}}])
    assert proposal.apply(Space(root), batch2)["extended"] == ["location"]
    assert _options(Space(root), "location", "kind")[-1] == "Closet"
    eff = proposal.effective_item({**kiosk}, {"status": "edited", "edited": {"useType": "person", "category": "X"}}, Space(root))
    assert eff["action"] == "use" and eff["typeId"] == "person" and eff["properties"] == []


def test_offer_of_an_existing_option_adds_nothing(tmp_path) -> None:
    """``create "Production"``: Production is already an option of Host's Environment, so the offer
    taken is a plain use of Host (nothing added to its Category or anywhere); the same for a name
    already in Host's Category."""
    root = itops_space(tmp_path)
    own = [{"name": "Owner team", "kind": "text", "share": 1.0}, {"name": "Change window", "kind": "text", "share": 1.0}]
    batch, (prod, ws) = _save(root, _create("Production", own), _create("Workstation", own, iid="g2"))
    assert prod["offer"] == {"label": "Use Host, with a category", "typeId": "host", "category": "Production"}
    assert ws["offer"] == {"label": "Use Host, with a category", "typeId": "host", "category": "Workstation"}
    space = Space(root)
    for it in (prod, ws):
        eff = proposal.effective_item(it, {"status": "edited", "edited": {"useType": "host", "category": it["name"]}}, space)
        assert eff["action"] == "use" and eff["typeId"] == "host" and eff["properties"] == [], it["name"]
    before = _type_files(root)
    proposal.save_review(space, batch, [{"id": it["id"], "status": "edited",
                                         "edited": {"useType": "host", "category": it["name"]}} for it in (prod, ws)])
    out = proposal.apply(Space(root), batch)
    assert out["created"] == [] and out["extended"] == [] and out["skipped"] == []
    assert _type_files(root) == before
    assert "Production" not in _options(Space(root), "host", "category")


def test_relations_to_known_types_kept(tmp_path) -> None:
    """M31 fix pass: in the schema proposal a relation to an existing type (or one proposed here) is
    kept, named or not; one to a type that is neither stays a plain link."""
    root = itops_space(tmp_path)
    named = proposal.named_relations(Space(root))
    assert {"runs on", "runs", "uses", "used by", "sources", "distilled into"} <= named
    item = {"id": "g1", "action": "extend", "group": "Apps", "name": "Application", "typeId": "application",
            "documents": 10, "properties": [
                {"name": "Runs on", "kind": "entity", "target": "Host", "share": 1.0},
                {"name": "Backs up", "kind": "entity", "target": "Host", "share": 1.0},
                {"name": "Feeds", "kind": "entity", "target": "Pipeline", "share": 1.0},
                {"name": "Vendor contact", "kind": "text", "share": 1.0}]}  # fmt: skip
    _batch, (ext,) = _save(root, item)
    assert [p["name"] for p in ext["properties"]] == ["Runs on", "Backs up", "Vendor contact"]
    assert ext["dropped"] == [{"key": "feeds", "name": "Feeds",
                               "reason": "It points at Pipeline, which is neither a type in this space nor one "
                                         "proposed here; it stays a plain link."}]
    assert ext["problems"] == []


def test_rules_in_every_space(tmp_path) -> None:
    """M31: ``space-sample`` has no setup and none of the IT ops types; the rules hold all the same.
    Server already exists (M27's advice stands, nothing looks like it); Box has Host's properties but
    there is no Host here, so it passes (its relations to types this space lacks stay plain links); a
    relation to an existing type (Owner) is kept, one to a type that is neither (Backs up) is not."""
    root = _sample(tmp_path)
    assert spaceconfig.read(root)[0].get("setup") is None
    own = OWN
    rel = {"id": "g6", "action": "extend", "group": "Projects", "name": "Project", "documents": 10, "properties": [
        {"name": "Owner", "kind": "entity", "target": "Project", "share": 1.0},
        {"name": "Backs up", "kind": "entity", "target": "Vault", "share": 1.0}]}
    _batch, items = _save(root, _create("Server"), _create("Box", iid="g2"), _create("VM", own, iid="g3"),
                          _create("Docs", own, iid="g4"), _create("Kiosk", iid="g5"), rel)
    server, box, vm, docs, kiosk, ext = items
    assert server["problems"] == ["A type named 'Server' already exists; use or extend it."]
    assert box["problems"] == vm["problems"] == kiosk["problems"] == ext["problems"] == []
    assert docs["problems"] == ["Docs is a category: a property value or a tag, not a type."]  # the sample's tag
    assert not any("offer" in it for it in items)
    assert [p["name"] for p in box["properties"]] == [p["name"] for p in HOST_PROPS
                                                       if p.get("target") in (None, "Person")]
    assert [p["name"] for p in ext["properties"]] == ["Owner"]
    assert [d["name"] for d in ext["dropped"]] == ["Backs up"]


def test_setup_is_not_a_switch(tmp_path) -> None:
    """M31: the space's ``setup`` changes nothing; ``is_itops_space`` is gone."""
    root = itops_space(tmp_path)
    _batch, first = _save(root, _create("Server"), _create("Workstation", iid="g2"))
    spaceconfig.set_internal(root, "setup", "blank")
    _batch, second = _save(root, _create("Server"), _create("Workstation", iid="g2"))
    assert first == second and first[0]["offer"]["typeId"] == "host"
    assert not hasattr(proposal, "is_itops_space")
