"""M30 Task 5: distillation (plan ``2026-11-09-m30-entity-extraction.md``, Task 5): picking values
from every Source, summary lines, the "From sources" section and its safe rewrite, and the
per-entity citation records in ``.object/distilled/``.
"""

from __future__ import annotations

import dataclasses
from pathlib import Path

import pytest

from objectapp.importers import distill
from objectapp.importers.distill import SECTION_CLOSE, SECTION_OPEN, SectionEdited
from objectapp.space import Space

NEW = "2026-10-01T00:00:00Z"
OLD = "2025-06-01T00:00:00Z"


def _row(value, page, modified, quote="q"):
    return {"value": value, "quote": quote, "page": page, "modified": modified}


def test_pick_values() -> None:
    found = {
        "fqdn": [_row("app01.corp.example", "S/APP01.md", NEW, "FQDN: app01.corp.example"),
                 _row("APP01.Corp.Example", "S/Payroll.md", OLD, "app01.corp.example")],
        "ipAddress": [_row("10.0.0.6", "S/Old APP01 notes.md", OLD, "APP01 IP address: 10.0.0.6"),
                      _row("10.0.0.5", "S/APP01.md", NEW, "IP address: 10.0.0.5")],
    }  # fmt: skip
    picked = distill.pick_values(found, set())
    fqdn = picked["fqdn"]
    assert fqdn["value"] == "app01.corp.example"
    assert [s["path"] for s in fqdn["sources"]] == ["S/APP01.md", "S/Payroll.md"]
    assert fqdn["conflict"] is None
    ip = picked["ipAddress"]
    assert ip["value"] == "10.0.0.5"
    assert ip["sources"] == [{"path": "S/APP01.md", "quote": "IP address: 10.0.0.5", "modified": NEW}]
    assert ip["conflict"] == [{"value": "10.0.0.6", "sources": [
        {"path": "S/Old APP01 notes.md", "quote": "APP01 IP address: 10.0.0.6", "modified": OLD}]}]

    # Equal times: the main page's value wins, whatever the path order; else the smallest path.
    tie = [_row("a", "S/Z.md", NEW), _row("b", "S/A.md", NEW)]
    assert distill.pick_values({"k": tie}, {"S/Z.md"})["k"]["value"] == "a"
    assert distill.pick_values({"k": tie}, set())["k"]["value"] == "b"
    assert distill.pick_values({"k": tie}, set())["k"]["conflict"][0]["value"] == "a"

    # A None `modified` loses to any date.
    none_vs_old = [_row("undated", "S/A.md", None), _row("dated", "S/Z.md", OLD)]
    assert distill.pick_values({"k": none_vs_old}, {"S/A.md"})["k"]["value"] == "dated"

    # One value: no conflict; the same page saying it twice is one Source.
    one = distill.pick_values({"k": [_row("x", "S/A.md", NEW), _row("X", "S/A.md", NEW)]}, set())["k"]
    assert one["conflict"] is None and [s["path"] for s in one["sources"]] == ["S/A.md"]


def _line(text, page, modified=None, quote="q"):
    return {"text": text, "quote": quote, "page": page, "modified": modified}


def test_summary_lines_merge_and_cap() -> None:
    merged = distill.summary_lines([_line("Runs Payroll.", "S/B.md", NEW), _line("runs  payroll", "S/A.md", OLD)], set())
    assert len(merged) == 1
    assert merged[0]["text"] == "Runs Payroll."
    assert [s["path"] for s in merged[0]["sources"]] == ["S/A.md", "S/B.md"]

    rows = [_line(f"Other line {i}.", f"S/P{i:02}.md", f"2026-0{1 + i % 9}-01T00:00:00Z") for i in range(13)]
    rows += [_line("Main line one.", "S/Main.md", OLD), _line("Main line two.", "S/Main.md", OLD)]
    lines = distill.summary_lines(rows, {"S/Main.md"})
    assert len(rows) == 15 and len(lines) == distill.MAX_LINES == 12
    assert [ln["text"] for ln in lines[:2]] == ["Main line one.", "Main line two."]
    # Then by the newest Source.
    after = [ln["sources"][0]["modified"] for ln in lines[2:]]
    assert after == sorted(after, reverse=True)


CONTRACT_SECTION = """<!-- group from-sources -->
## From sources

- The Payroll server at HQ. ([[Sources/APP01|APP01]])
- Payroll runs on it. ([[Payroll]])

Sources disagree:
- IP address: 10.0.0.5 ([[Sources/APP01|APP01]]) or 10.0.0.6 ([[Old APP01 notes]]); 10.0.0.5 kept, from the newer source.

Also linked: [[SRV-DB01]] (backs up to)
<!-- /group -->
"""

CITES = {"Sources/APP01.md": "[[Sources/APP01|APP01]]", "Sources/Payroll.md": "[[Payroll]]",
         "Sources/Old APP01 notes.md": "[[Old APP01 notes]]"}


def _ref(path, modified=NEW):
    return {"path": path, "quote": "q", "modified": modified}


def test_build_section_shape() -> None:
    lines = [{"text": "The Payroll server at HQ.", "sources": [_ref("Sources/APP01.md")]},
             {"text": "Payroll runs on it.", "sources": [_ref("Sources/Payroll.md")]}]
    picked = {
        "fqdn": {"value": "app01.corp.example", "sources": [_ref("Sources/APP01.md")], "conflict": None},
        "ipAddress": {"value": "10.0.0.5", "sources": [_ref("Sources/APP01.md")],
                      "conflict": [{"value": "10.0.0.6", "sources": [_ref("Sources/Old APP01 notes.md", OLD)]}]},
    }
    plain = [{"link": "[[SRV-DB01]]", "relation": "backs up to"}]
    section = distill.build_section(lines, picked, plain, CITES.__getitem__, {"ipAddress": "IP address", "fqdn": "FQDN"}.__getitem__)
    assert section == CONTRACT_SECTION
    # Nothing to say: the heading alone, no empty line inside.
    assert distill.build_section([], {}, [], CITES.__getitem__, str) == f"{SECTION_OPEN}\n## From sources\n{SECTION_CLOSE}\n"
    # A plain link given by its target only is linked by its title.
    only = distill.build_section([], {}, [{"target": "SRV-DB01", "relation": "backs up to"}], CITES.__getitem__, str)
    assert "Also linked: [[SRV-DB01]] (backs up to)\n" in only


def _section(*texts: str) -> str:
    lines = [{"text": t, "sources": [_ref("Sources/APP01.md")]} for t in texts]
    return distill.build_section(lines, {}, [], CITES.__getitem__, str)


def test_replace_section_keeps_everything_outside(tmp_path: Path) -> None:
    notes = "Gene's notes.\n"
    first = _section("First line.")
    body = distill.replace_section(notes, first, None)
    assert body == first + "\n" + notes
    span = distill.find_section(body)
    assert span == (0, len(first) + 1)

    second = _section("First line.", "Second line.")
    again = distill.replace_section(body, second, distill.section_hash(first))
    assert again == second + "\n" + notes
    assert again.endswith(notes)

    # Text Gene put above the section (he moved it) stays too.
    moved = "Above.\n\n" + body + "Below.\n"
    s, e = distill.find_section(moved)
    out = distill.replace_section(moved, second, distill.section_hash(first))
    assert out[:s] == moved[:s] and out[s:].endswith(moved[e:])
    assert out == "Above.\n\n" + second + "\n" + notes + "Below.\n"

    # A CRLF body gets CRLF lines; bytes outside the span are unchanged.
    crlf = "Gene's notes.\r\nMore.\r\n"
    put = distill.replace_section(crlf, first, None)
    assert put == first.replace("\n", "\r\n") + "\r\n" + crlf
    s, e = distill.find_section(put)
    assert put[e:] == crlf
    put2 = distill.replace_section(put, second, distill.section_hash(first))
    assert put2 == second.replace("\n", "\r\n") + "\r\n" + crlf

    # A CRLF file with a BOM, read through Space.read and written back: the BOM and every
    # ending kept, Gene's bytes after the section identical.
    root = tmp_path / "space"
    root.mkdir()
    raw_fm = b"\xef\xbb\xbf---\r\ntitle: APP01\r\n---\r\n"
    gene = b"Gene's notes.\r\n\r\n- one\r\n"
    (root / "APP01.md").write_bytes(raw_fm + gene)
    space = Space(root)

    def write(new_section: str, recorded: str | None) -> bytes:
        of, _fm, version = space.read("APP01.md")
        new_body = distill.replace_section(of.body, new_section, recorded)
        space._write("APP01.md", version, lambda o, _f: dataclasses.replace(o, body=new_body), stamp=False, history=False)
        return (root / "APP01.md").read_bytes()

    data1 = write(first, None)
    assert data1 == raw_fm + first.replace("\n", "\r\n").encode() + b"\r\n" + gene
    data2 = write(second, distill.section_hash(first))
    assert data2 == raw_fm + second.replace("\n", "\r\n").encode() + b"\r\n" + gene
    read_back = space.read("APP01.md")[0].body
    s, e = distill.find_section(read_back)
    assert distill.section_hash(read_back[s:e]) == distill.section_hash(second)

    # A group Gene nested inside the section goes with it; a group after it stays.
    nested = (SECTION_OPEN + "\n## From sources\n\n<!-- group color=bg-blue -->\nInner.\n<!-- /group -->\n"
              + SECTION_CLOSE + "\n\n<!-- group -->\nGene's group.\n<!-- /group -->\n")
    s, e = distill.find_section(nested)
    assert nested[e:] == "<!-- group -->\nGene's group.\n<!-- /group -->\n"
    out = distill.replace_section(nested, first, None)
    assert out == first + "\n" + "<!-- group -->\nGene's group.\n<!-- /group -->\n"
    assert "Inner." not in out

    # An empty body gets just the section.
    assert distill.find_section("") is None
    assert distill.find_section(distill.replace_section("", first, None)) is not None


def test_edited_or_broken_section_is_left_alone() -> None:
    first = _section("First line.")
    body = distill.replace_section("Gene's notes.\n", first, None)
    edited = body.replace("First line.", "First line, as Gene puts it.")
    with pytest.raises(SectionEdited):
        distill.replace_section(edited, _section("New."), distill.section_hash(first))
    # Without a record there is nothing to compare: the section is the import's to replace.
    assert distill.replace_section(edited, first, None) == body

    no_close = SECTION_OPEN + "\n## From sources\n\n- A line.\n\nGene's notes.\n"
    with pytest.raises(SectionEdited):
        distill.find_section(no_close)
    with pytest.raises(SectionEdited):
        distill.replace_section(no_close, first, None)

    unbalanced = SECTION_OPEN + "\n<!-- group -->\nInner.\n" + SECTION_CLOSE + "\n"
    with pytest.raises(SectionEdited):
        distill.find_section(unbalanced)

    two = first + "\n" + first + "\nGene's notes.\n"
    with pytest.raises(SectionEdited):
        distill.find_section(two)
    with pytest.raises(SectionEdited):
        distill.replace_section(two, first, distill.section_hash(first))

    # The open marker inside Gene's code block is not a marker.
    fenced = "```\n" + SECTION_OPEN + "\n```\n"
    assert distill.find_section(fenced) is None
    assert distill.replace_section(fenced, first, None) == first + "\n" + fenced


def test_section_hash_normalises_line_endings() -> None:
    first = _section("First line.")
    h = distill.section_hash(first)
    assert h.startswith("sha256:")
    assert distill.section_hash(first.replace("\n", "\r\n")) == h
    assert distill.section_hash(first + "\n") == h
    assert distill.section_hash(_section("Other.")) != h


def test_records_roundtrip(tmp_path: Path) -> None:
    root = tmp_path / "space"
    (root / ".object").mkdir(parents=True)
    before = sorted(p.relative_to(root) for p in (root / ".object").rglob("*"))
    assert distill.load_record(root, "01JABCDEFGHJKMNPQRSTVWXYZ0") is None
    record = {
        "id": "01JABCDEFGHJKMNPQRSTVWXYZ0", "path": "Hosts/APP01.md", "batch": "01JBATCH",
        "values": {"ipAddress": {"value": "10.0.0.5", "setByImport": "10.0.0.5",
                                 "sources": [_ref("Sources/APP01.md")],
                                 "conflict": [{"value": "10.0.0.6", "sources": [_ref("Sources/Old APP01 notes.md", OLD)]}]}},
        "section": {"hash": distill.section_hash(_section("A.")), "cites": {"Sources/APP01.md": "v1"}},
    }  # fmt: skip
    distill.save_record(root, record["id"], record)
    assert distill.load_record(root, record["id"]) == record
    after = sorted(p.relative_to(root) for p in (root / ".object").rglob("*"))
    assert set(after) - set(before) == {Path(".object/distilled"), Path(".object/distilled/01JABCDEFGHJKMNPQRSTVWXYZ0.json")}
    assert not list(root.glob(".object/distilled/*.tmp*"))

    # An id that isn't a plain file name stays inside the folder.
    distill.save_record(root, "host:app01", {"id": "host:app01"})
    assert distill.load_record(root, "host:app01") == {"id": "host:app01"}
    assert [p.parent for p in (root / ".object" / "distilled").iterdir()] == [root / ".object" / "distilled"] * 2
    with pytest.raises(ValueError):
        distill.save_record(root, "..", {})

    # Unreadable: None.
    (root / ".object" / "distilled" / "broken.json").write_text("{not json", encoding="utf-8")
    assert distill.load_record(root, "broken") is None
