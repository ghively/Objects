"""M30 Task 6: writing distilled entities and relations (plan ``2026-11-09-m30-entity-extraction.md``,
Task 6; Review Focus 1, 2, 4 and 5; design 2026-11-09 sections 5 and 5a).

The six synthetic pages are imported into an IT ops space as Sources (`m30_helpers.import_as_sources`),
each page's decision is checked against its Source (`entitycheck.check_candidates`), and the
resolution is `entities.resolve` of those results (every entity accepted unless a test says
otherwise), so these tests need neither the agent nor the filing pass.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

import pytest
from m30_helpers import decisions, import_as_sources, itops_space, make_itops_source

from objectapp import basicsetup
from objectapp.importers import batches, distill, entities, entitycheck, entitywrite, filing, sources
from objectapp.references import unlinked_mentions
from objectapp.space import Space

IMPORTED_AT = "2026-11-09T10:00:00.000Z"


@dataclass
class W:
    root: Path
    space: Space
    batch: str
    paths: dict[str, str]
    """Page title -> its Source's path."""
    items: list[dict[str, Any]]
    gene: str | None
    """Gene's own Host "app01", when the test has it."""


def _setup(base: Path, *, gene: bool = False, page: bool = False) -> W:
    base.mkdir(parents=True, exist_ok=True)
    root = itops_space(base)
    if page:  # a page of the space, outside the import, that mentions APP01
        (root / "Pages" / "Ops log.md").write_text("# Ops log\n\nChecked APP01 today.\n", encoding="utf-8")
    batch = import_as_sources(root, make_itops_source(base))
    space = Space(root)
    path = None
    if gene:
        path, _v = space.create_object("host", "app01", template_id="none", values={"ipAddress": "10.9.9.9"},
                                       body="My notes.\n")  # fmt: skip
    _data, items = batches.load_batch(root, batch)
    paths = {it["title"]: it["path"] for it in items}
    return W(root, space, batch, paths, items, path)


def _results(w: W, edit: Any = None) -> dict[str, dict[str, Any]]:
    """The checked filing results of the six Sources; ``edit(title, decision)`` changes a decision first."""
    out: dict[str, dict[str, Any]] = {}
    for path, d in decisions(w.paths).items():
        d = copy.deepcopy(d)
        title = w.space.get(path).title
        if edit is not None:
            edit(title, d)
        of, fm, _v = w.space.read(path)
        r = {"path": path, "origPath": path, "title": title, "confidence": d["confidence"], "type": None,
             "values": [], "links": [], "inbox": False, "notes": [],
             "tags": [{"value": v, "quote": v, "ok": True} for v in d.get("tags") or []],
             "collections": [{"value": v, "quote": v, "ok": True} for v in d.get("collections") or []]}  # fmt: skip
        r.update(entitycheck.check_candidates(w.space, d, filing._doc_text(of, fm, title), path, title))
        out[path] = r
    return out


def _write(w: W, results: dict[str, dict[str, Any]], *, batch: str | None = None, reject: tuple[str, ...] = (),
           items: list[dict[str, Any]] | None = None) -> dict[str, Any]:  # fmt: skip
    res = entities.resolve(w.space, results)
    chosen = [(e, e.name) for e in res.entities if e.name not in reject]
    return entitywrite.write_entities(w.space, batch or w.batch, "markdown", IMPORTED_AT, chosen, res, results,
                                      w.items if items is None else items)  # fmt: skip


def _sources(w: W) -> dict[str, bytes]:
    return {p: (w.root / p).read_bytes() for p in w.paths.values()}


def _path(w: W, type_id: str, title: str) -> str:
    hits = [s.path for s in w.space.list(type_id) if s.title == title]
    assert len(hits) == 1, (type_id, title, hits)
    return hits[0]


def _values(w: W, path: str) -> dict[str, Any]:
    return w.space.rows(None, None, [path], None, False)[0].values


def _body(w: W, path: str) -> str:
    return w.space.read(path)[0].body


def _section(body: str) -> str:
    span = distill.find_section(body)
    assert span is not None, body
    return body[span[0] : span[1]]


def _counts(w: W) -> dict[str, int]:
    out: dict[str, int] = {}
    for s in w.space.list():
        out[s.type] = out.get(s.type, 0) + 1
    return out


def _row(w: W, path: str, name: str) -> list[str]:
    """The paths of ``path``'s computed counterpart row ``name`` (M28; rows of one name merged)."""
    return [p for r in w.space.counterparts(path) if r["name"] == name for p in r["paths"]]


def _resolves_to(w: W, link: str, from_path: str) -> str | None:
    target = link.removeprefix("[[").removesuffix("]]").split("|", 1)[0]
    return w.space.resolve(target, from_path)


def test_write_never_touches_a_source(tmp_path: Path) -> None:
    w = _setup(tmp_path)
    w.space.create_collection("Critical", ["host"])
    before = _sources(w)

    def edit(title: str, d: dict[str, Any]) -> None:
        if title == "APP01":
            d["tags"], d["collections"] = ["Backup"], ["Critical"]

    out = _write(w, _results(w, edit))
    assert out["created"] >= 6 and out["relations"] >= 1 and out["plainLinks"] == 1 and out["relationsInbox"] == 1
    assert out["sections"] >= 1 and not out["failed"]
    assert _sources(w) == before
    for p in w.paths.values():
        v = _values(w, p)
        assert not v.get("tags") and not v.get("collections"), p
        assert "[[" not in _body(w, p).replace("See [[APP01]]", ""), p
        assert w.space.get(p).readOnlyReason == sources.SOURCE_READ_ONLY


def test_creates_accepted_entity_with_provenance_template_and_sources(tmp_path: Path) -> None:
    w = _setup(tmp_path)
    _write(w, _results(w))
    path = _path(w, "software", "SQL Server 2019")
    assert path.startswith("Software/")
    _of, fm, _v = w.space.read(path)
    assert fm["importSource"] == {"system": "markdown", "id": "entity:software:sql server 2019", "batch": w.batch,
                                  "importedAt": IMPORTED_AT}  # fmt: skip
    v = _values(w, path)
    assert v["aliases"] == ["SQL 2019"]
    assert [r["path"] for r in v["sources"]] == sorted([w.paths["SRV-DB01"], w.paths["Payroll"], w.paths["Restart Payroll"]])
    body = _body(w, path)
    assert body.startswith(distill.SECTION_OPEN + "\n" + distill.SECTION_HEADING + "\n")
    section = _section(body)
    links = [m for m in section.split() if m.startswith(("([[", "[["))]
    assert links
    for link in links:
        assert _resolves_to(w, link.strip("(),"), path) in w.paths.values()
    rest = body[len(section) :]
    assert "## Install notes" in rest  # M28's template below the section
    created = [it for it in w.items if it.get("path") == path]
    assert created == [{"sourcePath": "entity:software:sql server 2019", "system": "markdown",
                        "id": "entity:software:sql server 2019", "title": "SQL Server 2019", "path": path,
                        "action": "created", "entity": True}]  # fmt: skip
    assert path in _row(w, w.paths["SRV-DB01"], "Distilled into")


def test_relation_stored_on_one_side_and_counterpart_computed(tmp_path: Path) -> None:
    w = _setup(tmp_path / "a")
    _write(w, _results(w))
    payroll, app01 = _path(w, "application", "Payroll"), _path(w, "host", "APP01")
    assert [r["path"] for r in _values(w, payroll)["runsOn"]] == [app01]
    text = (w.root / app01).read_text(encoding="utf-8")
    assert "runsOn" not in text and "\nruns:" not in text
    assert _row(w, app01, "Runs") == [payroll]

    # the counterpart's name stores the same single line on the other side
    def by_counterpart(title: str, d: dict[str, Any]) -> None:
        if title == "Payroll":
            d["relations"] = [{"subject": "APP01", "relation": "Runs", "object": "Payroll",
                               "quote": "Payroll runs on APP01", "confidence": "high"},
                              *[r for r in d["relations"] if r["relation"] != "Runs on"]]  # fmt: skip

    w2 = _setup(tmp_path / "b")
    _write(w2, _results(w2, by_counterpart))
    payroll2, app012 = _path(w2, "application", "Payroll"), _path(w2, "host", "APP01")
    lines = [ln for ln in (w2.root / payroll2).read_text(encoding="utf-8").splitlines() if ln.startswith("runsOn:")]
    assert len(lines) == 1
    assert [r["path"] for r in _values(w2, payroll2)["runsOn"]] == [app012]
    text2 = (w2.root / app012).read_text(encoding="utf-8")
    assert "runsOn" not in text2 and "\nruns:" not in text2

    # a relation outside the named set is a plain link in the subject's section
    srv = _path(w, "host", "SRV-DB01")
    link = w.space._link_text(srv, payroll)
    expected = f"[[{link}|SRV-DB01]]" if link != "SRV-DB01" else "[[SRV-DB01]]"
    assert f"{distill.ALSO_LINKED} {expected} (backs up to)" in _section(_body(w, payroll))
    assert w.space.resolve(link, payroll) == srv
    assert not any("backs" in k.casefold() for k in _values(w, payroll))


def test_conflict_listed_on_the_entity(tmp_path: Path) -> None:
    w = _setup(tmp_path)
    out = _write(w, _results(w))
    app01 = _path(w, "host", "APP01")
    assert _values(w, app01)["ipAddress"] == "10.0.0.5"
    section = _section(_body(w, app01))
    line = next(ln for ln in section.splitlines() if ln.startswith("- IP address:"))
    assert distill.DISAGREE_HEADING in section
    assert "10.0.0.5" in line and "10.0.0.6" in line and "[[Old APP01 notes]]" in line and "10.0.0.5 kept" in line
    rid = w.space.read(app01)[1]["id"]
    record = distill.load_record(w.root, rid)
    assert record is not None and record["path"] == app01
    ip = record["values"]["ipAddress"]
    assert ip["value"] == ip["setByImport"] == "10.0.0.5"
    assert [c["value"] for c in ip["conflict"]] == ["10.0.0.6"]
    assert [s["path"] for s in ip["conflict"][0]["sources"]] == [w.paths["Old APP01 notes"]]
    assert out["conflicts"][0]["entity"]["path"] == app01 and out["conflicts"][0]["name"] == "IP address"
    assert batches.batch_dir(w.root, w.batch).joinpath(entitywrite.WRITTEN_FILE).is_file()


def test_gene_values_never_replaced(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Gene's own value stays
    w = _setup(tmp_path / "a", gene=True)
    _write(w, _results(w))
    assert w.gene is not None
    v = _values(w, w.gene)
    assert v["ipAddress"] == "10.9.9.9" and v["fqdn"] == "app01.corp.example"

    # a value the import set, unchanged by Gene, follows a newer Source
    w2 = _setup(tmp_path / "b")
    results = _results(w2)
    res = entities.resolve(w2.space, results)
    app01 = next(e for e in res.entities if e.name == "APP01")
    synced = {"value": "2026-11-01T00:00:00.000Z", "sources": app01.values["ipAddress"]["sources"], "conflict": None}
    app01.values["lastBoot"] = synced  # a synced property is never written, whatever says it
    entitywrite.write_entities(w2.space, w2.batch, "markdown", IMPORTED_AT, [(e, e.name) for e in res.entities],
                               res, results, w2.items)  # fmt: skip
    host = _path(w2, "host", "APP01")
    assert _values(w2, host)["ipAddress"] == "10.0.0.5"
    assert "lastBoot" not in (w2.root / host).read_text(encoding="utf-8")

    real = entities._modified
    old, new = w2.paths["Old APP01 notes"], w2.paths["APP01"]

    def swapped(space: Space, page: str) -> str | None:
        return real(space, new if page == old else old if page == new else page)

    monkeypatch.setattr(entities, "_modified", swapped)
    _write(w2, _results(w2), batch="second", items=[])
    assert _values(w2, host)["ipAddress"] == "10.0.0.6"
    assert "lastBoot" not in (w2.root / host).read_text(encoding="utf-8")


def test_rerun_rewrites_only_the_section(tmp_path: Path) -> None:
    w = _setup(tmp_path, gene=True)
    assert w.gene is not None
    _write(w, _results(w))
    body = _body(w, w.gene)
    section = _section(body)
    assert body == section + "My notes.\n" and section.endswith(distill.SECTION_CLOSE + "\n\n")

    # Gene adds a line below; a cited Source changes (as its re-run would) with a new line about APP01
    _of, _fm, version = w.space.read(w.gene)
    w.space.save_body(w.gene, body + "More of mine.\n", version)
    src = w.paths["APP01"]
    with w.space.source_writes():
        of, _fm, version = w.space.read(src)
        w.space.save_body(src, of.body.rstrip("\n") + " It is patched monthly.\n", version)

    def patched(title: str, d: dict[str, Any]) -> None:
        if title == "APP01":
            d["mainEntity"]["lines"].append({"text": "Patched monthly.", "quote": "It is patched monthly"})

    before = (w.root / w.gene).read_bytes()
    out = _write(w, _results(w, patched), batch="second", items=[])
    after = (w.root / w.gene).read_bytes()
    assert out["sections"] == 1 and out["created"] == 0 and out["existing"] >= 6
    b_fm, b_body = before.decode().split("\n---\n", 1)
    a_fm, a_body = after.decode().split("\n---\n", 1)
    assert [ln for ln in b_fm.splitlines() if not ln.startswith("lastUpdated:")] == \
        [ln for ln in a_fm.splitlines() if not ln.startswith("lastUpdated:")]  # fmt: skip
    new_section = _section(a_body)
    assert "Patched monthly." in new_section and "Patched monthly." not in b_body
    assert a_body[len(new_section) :] == b_body[len(_section(b_body)) :] == "My notes.\nMore of mine.\n"

    # nothing changed: nothing written
    out = _write(w, _results(w, patched), batch="third", items=[])
    assert (w.root / w.gene).read_bytes() == after and out["sections"] == 0

    # Gene edits a line inside the section: a changed Source leaves the file as it is
    _of, _fm, version = w.space.read(w.gene)
    w.space.save_body(w.gene, _body(w, w.gene).replace("Patched monthly.", "Patched weekly, I checked."), version)
    edited = (w.root / w.gene).read_bytes()
    with w.space.source_writes():
        of, _fm, version = w.space.read(src)
        w.space.save_body(src, of.body.rstrip("\n") + " Owner: ops.\n", version)
    out = _write(w, _results(w, patched), batch="fourth", items=[])
    assert (w.root / w.gene).read_bytes() == edited
    assert out["sectionsLeft"] == 1
    assert out["sectionsLeftList"] == [{"path": w.gene, "title": "app01",
                                        "text": "The From sources section of app01 was edited, so it was left as it is."}]  # fmt: skip


def test_low_confidence_link_goes_to_inbox(tmp_path: Path) -> None:
    w = _setup(tmp_path)
    out = _write(w, _results(w))
    runbook, app01 = _path(w, "runbook", "Restart Payroll"), _path(w, "host", "APP01")
    assert out["inboxLinks"] == [{"path": runbook, "title": "Restart Payroll",
                                  "reason": "Link not written (low confidence): Restart Payroll Covers APP01"}]  # fmt: skip
    v = _values(w, runbook)
    assert v["collections"] == ["Import inbox"]
    assert app01 not in [r["path"] for r in v.get("covers") or []]
    assert [r["path"] for r in v["covers"]] == [_path(w, "application", "Payroll")]
    inbox = [s.path for s in w.space.list() if "Import inbox" in (_values(w, s.path).get("collections") or [])]
    assert inbox == [runbook]


def test_tags_and_collections_go_on_the_main_entity(tmp_path: Path) -> None:
    w = _setup(tmp_path)
    w.space.create_collection("Critical", ["host"])

    def edit(title: str, d: dict[str, Any]) -> None:
        if title == "APP01":
            d["tags"], d["collections"] = ["Backup"], ["Critical"]

    _write(w, _results(w, edit))
    host = _values(w, _path(w, "host", "APP01"))
    assert "Backup" in host["tags"] and host["collections"] == ["Critical"]
    src = _values(w, w.paths["APP01"])
    assert not src.get("tags") and not src.get("collections")
    assert "Backup" not in (_values(w, _path(w, "application", "Payroll")).get("tags") or [])


def test_mentions_in_sources_stay_unlinked(tmp_path: Path) -> None:
    w = _setup(tmp_path, page=True)
    restart = w.paths["Restart Payroll"]
    before = (w.root / restart).read_bytes()
    _write(w, _results(w))
    assert (w.root / restart).read_bytes() == before
    assert "Restart Payroll on APP01:" in _body(w, restart)
    found = [m["path"] for m in unlinked_mentions(w.space, None, _path(w, "host", "APP01"))]
    assert restart in found and "Pages/Ops log.md" in found


def test_existing_object_is_reused_and_write_is_resumable(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    w = _setup(tmp_path, gene=True)
    assert w.gene is not None
    before = _counts(w)
    real = w.space.create_object
    calls: list[str] = []

    def failing(type_id: str, title: str = "", *a: Any, **kw: Any) -> tuple[str, str]:
        calls.append(title)
        if len(calls) > 1:
            raise RuntimeError("disk full")
        return real(type_id, title, *a, **kw)

    monkeypatch.setattr(w.space, "create_object", failing)
    with pytest.raises(RuntimeError):
        _write(w, _results(w))
    monkeypatch.setattr(w.space, "create_object", real)
    first = calls[0]
    assert len([s for s in w.space.list() if s.title == first]) == 2  # its Source and the entity
    _write(w, _results(w))
    after = _counts(w)
    expected = {"application": 1, "host": 1, "location": 1, "runbook": 1, "software": 1}
    assert {k: after.get(k, 0) - before.get(k, 0) for k in expected} == expected
    assert after.get("source") == before.get("source")
    assert len([s for s in w.space.list() if s.title == first]) == 2

    # Gene's Host is reused: its empty FQDN filled, his IP kept, no provenance, no created item
    v = _values(w, w.gene)
    assert v["fqdn"] == "app01.corp.example" and v["ipAddress"] == "10.9.9.9"
    assert "importSource" not in w.space.read(w.gene)[1]
    assert not [it for it in w.items if it.get("path") == w.gene]
    assert len([it for it in w.items if it.get("entity")]) == 5

    # a third run places nothing and writes nothing
    snap = {p.as_posix(): p.read_bytes() for p in w.root.rglob("*.md")}
    out = _write(w, _results(w))
    assert out["created"] == 5 and out["existing"] == 1
    assert {p.as_posix(): p.read_bytes() for p in w.root.rglob("*.md")} == snap


def test_turned_down_side_skips_relation(tmp_path: Path) -> None:
    w = _setup(tmp_path)
    out = _write(w, _results(w), reject=("APP01",))
    assert {"subject": "Payroll", "relation": "Runs on", "object": "APP01", "reason": "turned down"} in out["skipped"]
    assert not _values(w, _path(w, "application", "Payroll")).get("runsOn")
    assert not [s for s in w.space.list("host") if s.title == "APP01"]


def test_sources_property_added_to_other_types(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    w = _setup(tmp_path)
    w.space.add_type(basicsetup._type("gadget", "Gadget", "Gadgets", "A test type.", "ph-cube", "blue", []))
    assert w.space.type_by_id("gadget").prop("sources") is None
    rack = w.paths["Rack notes"]
    ref = {"path": rack, "quote": "Rack 4 at HQ", "modified": None}

    def entity(name: str) -> entities.Entity:
        return entities.Entity(
            id=f"gadget:{name.casefold()}", typeId="gadget", type="Gadget", name=name, aliases=[],
            keys={name.casefold()}, pages=[rack], mainPages=[], values={},
            lines=[{"text": f"{name} sits in rack 4.", "sources": [ref]}], confidence="high",
            joinedByAgent=False, rule="pages", category=False, existing=None,
        )  # fmt: skip

    ents = [entity("Widget"), entity("Gizmo")]
    res = entities.Resolution(entities=ents, leftOut=[], suggestedMerges=[], relations=[], pages=[rack])
    saves: list[str] = []
    real = w.space.save_type

    def counting(t: Any, *a: Any, **kw: Any) -> Any:
        saves.append(t.id)
        return real(t, *a, **kw)

    monkeypatch.setattr(w.space, "save_type", counting)
    out = entitywrite.write_entities(w.space, w.batch, "markdown", IMPORTED_AT, [(e, e.name) for e in ents], res,
                                     {}, w.items)  # fmt: skip
    assert saves == ["gadget"] and out["created"] == 2
    p = w.space.type_by_id("gadget").prop("sources")
    assert p is not None and p.options["counterpart"]["key"] == "distilledInto"
    widget = _path(w, "gadget", "Widget")
    assert [r["path"] for r in _values(w, widget)["sources"]] == [rack]
    assert sorted(_row(w, rack, "Distilled into")) == sorted([widget, _path(w, "gadget", "Gizmo")])
    assert PurePosixPath(widget).parent.name == "Gadgets"
