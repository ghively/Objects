"""M30 Task 7: the IT ops conventions as hard rules in M27's schema proposal (plan
``2026-11-09-m30-entity-extraction.md``, Task 7; design 2026-11-09 section 5b): existing types
first, no look-alike types ("Use <type>, with a category"), categories never types, relations
outside the named set stay plain links. M31 (Gene's decision 1): the rules hold in every space,
whatever its setup (`test_rules_in_every_space`).

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
    {"name": "Operating system", "kind": "text", "share": 0.8},
    {"name": "Environment", "kind": "label", "share": 1.0, "options": ["Production", "Test"]},
]


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


def test_lookalike_needs_two_properties_and_the_share(tmp_path) -> None:
    space = Space(itops_space(tmp_path))
    other = {"name": "Rack unit", "kind": "text"}
    assert proposal.lookalike(HOST_PROPS[:1], space) is None  # one property is not enough
    assert proposal.lookalike([*HOST_PROPS[:3], other], space) is None  # 75%
    assert proposal.lookalike([*HOST_PROPS, other], space).id == "host"  # 80%
    assert proposal.lookalike([{"name": "ip-address"}, {"name": "fqdn"}], space).id == "host"  # by the squashed name
    # Never the Source type (its pages are made only by an import), nor the type left out.
    assert proposal.lookalike([{"name": "Category"}, {"name": "System"}], space) is None
    assert proposal.lookalike(HOST_PROPS, space, exclude="host") is None


def test_category_name_refused(tmp_path) -> None:
    root = itops_space(tmp_path)
    own = [{"name": "Hypervisor version", "kind": "text", "share": 1.0},
           {"name": "Memory", "kind": "number", "share": 1.0}]
    _batch, (vm, ws, ok) = _save(root, _create("VM", own), _create("Workstation", own, iid="g2"),
                                 _create("Kiosk", own, iid="g3"))
    assert vm["problems"] == ["VM is a category: a property value or a tag, not a type."]  # a seed tag
    assert "offer" not in vm
    assert ws["problems"] == ["Workstation is a category: a property value or a tag, not a type."]
    assert ws["offer"] == {"label": "Use Host, with a category", "typeId": "host", "category": "Workstation"}
    assert ok["problems"] == [] and "offer" not in ok


def test_only_category_kind_and_environment_options_are_categories(tmp_path) -> None:
    """Options of other labels (Host's Roles, Script's Language, Source's Category and System) don't
    make a name a category; Environment's do."""
    root = itops_space(tmp_path)
    own = [{"name": "Hypervisor version", "kind": "text", "share": 1.0},
           {"name": "Memory", "kind": "number", "share": 1.0}]
    names = ["DHCP", "Python", "Ticket", "Document", "Wiki", "Production", "Rack"]
    _batch, items = _save(root, *(_create(n, own, iid=f"g{i}") for i, n in enumerate(names, 1)))
    got = dict(zip(names, items, strict=True))
    for n in ("DHCP", "Python", "Ticket", "Document", "Wiki"):
        assert got[n]["problems"] == [] and "offer" not in got[n], n
    assert got["Production"]["problems"] == ["Production is a category: a property value or a tag, not a type."]
    assert got["Production"]["offer"] == {"label": "Use Host, with a category", "typeId": "host", "category": "Production"}
    assert got["Rack"]["problems"] == ["Rack is a category: a property value or a tag, not a type."]
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


def test_relations_outside_named_set_dropped(tmp_path) -> None:
    root = itops_space(tmp_path)
    named = proposal.named_relations(Space(root))
    assert {"runs on", "runs", "uses", "used by", "sources", "distilled into"} <= named
    item = {"id": "g1", "action": "extend", "group": "Apps", "name": "Application", "typeId": "application",
            "documents": 10, "properties": [
                {"name": "Runs on", "kind": "entity", "target": "Host", "share": 1.0},
                {"name": "Backs up", "kind": "entity", "target": "Host", "share": 1.0},
                {"name": "Vendor contact", "kind": "text", "share": 1.0}]}  # fmt: skip
    _batch, (ext,) = _save(root, item)
    assert [p["name"] for p in ext["properties"]] == ["Runs on", "Vendor contact"]
    assert ext["dropped"] == [{"key": "backs-up", "name": "Backs up",
                               "reason": "Not one of the named relations; it stays a plain link."}]
    assert ext["problems"] == []


def test_rules_in_every_space(tmp_path) -> None:
    """M31: ``space-sample`` has no setup and none of the IT ops types; the rules hold all the same.
    Server already exists (M27's advice stands, nothing looks like it); Box has Host's properties but
    there is no Host here, so it passes; a relation outside the named set (Owner) stays a plain link."""
    root = _sample(tmp_path)
    assert spaceconfig.read(root)[0].get("setup") is None
    own = [{"name": "Hypervisor version", "kind": "text", "share": 1.0},
           {"name": "Memory", "kind": "number", "share": 1.0}]
    rel = {"id": "g6", "action": "extend", "group": "Projects", "name": "Project", "documents": 10, "properties": [
        {"name": "Owner", "kind": "entity", "target": "Project", "share": 1.0},
        {"name": "Backs up", "kind": "entity", "target": "Project", "share": 1.0}]}
    _batch, items = _save(root, _create("Server"), _create("Box", iid="g2"), _create("VM", own, iid="g3"),
                          _create("Docs", own, iid="g4"), _create("Kiosk", iid="g5"), rel)
    server, box, vm, docs, kiosk, ext = items
    assert server["problems"] == ["A type named 'Server' already exists; use or extend it."]
    assert box["problems"] == vm["problems"] == kiosk["problems"] == ext["problems"] == []
    assert docs["problems"] == ["Docs is a category: a property value or a tag, not a type."]  # the sample's tag
    assert not any("offer" in it for it in items)
    assert [p["name"] for p in box["properties"]] == ["IP address", "FQDN", "Operating system", "Environment"]
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
