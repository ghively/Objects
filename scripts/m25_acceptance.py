"""Milestone 25 acceptance run over HTTP (provenance, originals, the Files kind, re-runs, batches).

Usage: ``uv run python scripts/m25_acceptance.py [SPACE] [--keep]``
(default SPACE: ``backend/tests/fixtures/space-sample``)

SPACE is copied to a temporary folder and committed to a throw-away git repo; SPACE itself is never
touched. The synthetic import fixtures (``import-obsidian``, ``import-notion``, ``import-anytype``)
and a small Files folder with a ``_manifest.jsonl`` (made here, no real data) are copied or made
beside it. ``OBJECT_STATE_DIR`` and ``OBJECT_CACHE_DIR`` point at temporary folders. The copy is
served with ``create_app`` on a free ``127.0.0.1`` port. Whether M26's readers are installed or
not, the Files checks hold (a format with no reader keeps its original and says "Original only").
Then it checks:

 1. provenance: Obsidian, Notion and Anytype imports write an ``importSource`` block (system, id,
    hash, batch; Notion's url; Obsidian's ``file:`` url) and leave the sources unchanged;
 2. the Files kind: the manifest fills ``importSource`` (system, url, id, version, author), the
    originals sit byte for byte in ``Attachments/Originals`` and are named by ``original``, a
    format nobody reads is an "Original only" page, and "File objects" makes a File object;
 3. the report: counts that reconcile (source items = imported + updated + unchanged + changed in
    both + left out + failed), kept in ``.object/imports/<batch>/report.md`` and as a page;
 4. re-runs: the same source again is all unchanged with no new attachments or duplicates; a
    changed source file is updated in place (the old text in version history); a removed one is
    listed under "Removed at source" and stays; an object edited in Object and changed at the
    source is "Changed in both", left alone, and Take source / Keep mine resolve it;
 5. batches: Move batch to Trash moves what the batch created (the updated object stays), the
    Trash can restore it; "Try on a copy of this space" imports into a copy and leaves the open
    space untouched;
 6. never write on read: previews change nothing; ``git status`` of the space shows only new
    files after a first import (besides the type file of an existing type a planned type maps
    onto, which M15 extends with the properties it lacks and which only gains), and only imported
    objects and records after a re-run.

Each check prints ``[ok]`` or ``[FAIL]``; ``RESULT: PASS`` at the end; exits non-zero on any failure.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

from m2_acceptance import Http, Run, commit, git, remove_tree, snapshot
from m8_acceptance import Served
from objectapp.frontmatter import parse_fm
from objectapp.objfile import split_object
from objectapp.space import Space

REPO = Path(__file__).resolve().parents[1]
FIXTURES = REPO / "backend" / "tests" / "fixtures"
HOOKS = ("OBJECT_STATE_DIR", "OBJECT_CACHE_DIR")


def tree(folder: Path) -> dict[str, bytes]:
    return {p.relative_to(folder).as_posix(): p.read_bytes() for p in sorted(folder.rglob("*")) if p.is_file()}


def zip_folder(folder: Path, dest: Path) -> Path:
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in sorted(folder.rglob("*")):
            if p.is_file():
                zf.write(p, p.relative_to(folder).as_posix())
    return dest


def fm_of(root: Path, rel: str) -> dict:
    of = split_object((root / rel).read_bytes().decode("utf-8-sig"))
    try:
        return parse_fm(of.frontmatter_src or "")
    except Exception:  # noqa: BLE001 - a fixture file with broken frontmatter
        return {}


def blocks(root: Path) -> dict[str, dict]:
    out = {}
    for p in sorted(root.rglob("*.md")):
        rel = p.relative_to(root).as_posix()
        if rel.startswith("."):
            continue
        b = fm_of(root, rel).get("importSource")
        if isinstance(b, dict):
            out[rel] = b
    return out


class M25:
    def __init__(self, root: Path, run: Run, tmp: Path) -> None:
        self.root, self.run, self.tmp = root, run, tmp
        self.src = tmp / "sources"
        self.src.mkdir()
        self.out = tmp / "copies"
        self.out.mkdir()
        self.mapped: set[str] = set()
        """Existing types an import into this space mapped a planned type onto (M15: they may gain properties)."""

    @property
    def http(self) -> Http:
        return self.run.http

    def do_import(self, path: Path, kind: str = "auto", target: dict | None = None, **extra) -> dict:
        code, preview = self.http(
            "POST", "/import/preview", {"source": {"path": str(path), "kind": kind}, "target": "currentSpace",
                                         "keepAsSources": False}
        )
        assert code == 200, (code, preview)
        if target is None:
            self.mapped |= {t["existingTypeId"] for t in preview["types"] if t.get("existingTypeId") and not t.get("skip")}
        body = {"previewId": preview["previewId"], "mapping": preview["mapping"], "target": target or {"kind": "currentSpace"},
                "keepAsSources": False, **extra}
        code, started = self.http("POST", "/import/start", body)
        assert code == 202, (code, started)
        for _ in range(1200):
            _, job = self.http("GET", f"/import/jobs/{started['jobId']}")
            if job["phase"] in ("done", "failed", "cancelled"):
                break
            time.sleep(0.05)
        assert job["phase"] == "done", job
        return job["result"]

    def only_gained(self, rel: str) -> bool:
        """``rel`` is the type file of an existing type an import mapped onto, and it only gained:
        every property it had is still there, with its name and kind, and nothing else changed."""
        if not (rel.startswith(".object/types/") and rel.endswith(".json")):
            return False
        try:
            old = json.loads(git(self.root, "show", f"HEAD:{rel}"))
            new = json.loads((self.root / rel).read_text(encoding="utf-8"))
        except (OSError, ValueError, subprocess.CalledProcessError):  # not in HEAD, or unreadable
            return False
        if old.get("id") not in self.mapped or old.get("id") != new.get("id"):
            return False
        props = {p.get("key"): p for p in new.get("propertyDefinitions") or []}
        for p in old.get("propertyDefinitions") or []:
            q = props.get(p.get("key"))
            if q is None or (q.get("name"), q.get("type")) != (p.get("name"), p.get("type")):
                return False
        rest = {k: v for k, v in new.items() if k != "propertyDefinitions"}
        return rest == {k: v for k, v in old.items() if k != "propertyDefinitions"} and len(props) > len(
            old.get("propertyDefinitions") or []
        )

    @staticmethod
    def reconciles(r: dict) -> bool:
        return r["sourceItems"] == r["objects"] + r["updated"] + r["unchanged"] + r["changedInBoth"] + r["leftOut"] + r["failed"]

    # 1 ------------------------------------------------------------------------------
    def provenance(self) -> None:
        print("\n1. Provenance of the four sources")
        vault = shutil.copytree(FIXTURES / "import-obsidian", self.src / "Vault")
        notion = zip_folder(
            shutil.copytree(FIXTURES / "import-notion", self.tmp / "notion-folder"),
            self.src / "Export-0123abcd-1111-2222-3333-444455556666.zip",
        )
        anytype = shutil.copytree(FIXTURES / "import-anytype", self.src / "Anytype export")
        pristine = tree(self.src)
        commit(self.root, "before imports")
        for label, path, kind in (("obsidian", vault, "auto"), ("notion", notion, "auto"), ("anytype", anytype, "anytype")):
            before = set(blocks(self.root))
            r = self.do_import(path, kind)
            new = {k: v for k, v in blocks(self.root).items() if k not in before}
            ok = (
                len(new) == r["objects"] > 0
                and {b["system"] for b in new.values()} == {label}
                and all(b["batch"] == r["batch"] and b["importedAt"] and b["id"] for b in new.values())
            )
            self.run.report(ok, f"{label}: {len(new)} objects carry importSource (batch {r['batch'][:8]}…)")
            self.run.report(self.reconciles(r), f"{label}: counts reconcile ({r['sourceItems']} source items)")
            if label == "obsidian":
                dune = next(b for b in new.values() if b["id"] == "Books/Dune.md")
                self.run.report(
                    dune["url"].startswith("file:") and dune["contentHash"].startswith("sha256:"),
                    "obsidian: file: url and sha256 contentHash",
                )
            if label == "notion":
                w = next(b for b in new.values() if b["id"] == "0123456789abcdef0123456789abcdef")
                self.run.report(w["url"] == "https://www.notion.so/0123456789abcdef0123456789abcdef", "notion: page url rebuilt from the id")
        self.run.report(tree(self.src) == pristine, "the sources are unchanged after importing")
        status = git(self.root, "status", "--porcelain", "--untracked-files=all").splitlines()
        added = [line for line in status if line.startswith("??")]
        changed = [line[3:] for line in status if not line.startswith("??")]
        # M15 (plan, "Types"): a planned type mapped onto an existing type of the same name extends it
        # with the properties it lacks; nothing else of an existing file changes, and the type only gains.
        extended = [p for p in changed if self.only_gained(p)]
        self.run.report(
            changed == extended,
            f"a first import only adds files ({len(added)} new), besides the existing types it maps onto, which only "
            f"gain properties ({', '.join(extended) or 'none'})",
        )
        self.vault, self.notion = vault, notion

    # 2 ------------------------------------------------------------------------------
    def files_kind(self) -> None:
        print("\n2. The Files kind, the manifest and originals")
        lib = self.src / "Library"
        (lib / "Runbooks").mkdir(parents=True)
        docx = b"PK\x03\x04 synthetic docx bytes"
        (lib / "Runbooks" / "DNS.docx").write_bytes(docx)
        (lib / "Runbooks" / "Network.vsdx").write_bytes(b"synthetic visio bytes")
        (lib / "Manual.pdf").write_bytes(b"%PDF-1.4 synthetic")
        (lib / "notes.txt").write_text("plain text note\n", encoding="utf-8")
        lines = [
            {"path": "Runbooks/DNS.docx", "system": "sharepoint", "url": "https://sp.example/dns", "id": "01ABC", "version": "7.0",
             "author": "Ann Author", "created": "2024-03-02T10:11:00Z", "modified": "2026-10-30T08:00:00Z",
             "fields": {"Owner": "Ops", "Environment": "Prod"}},
        ]
        (lib / "_manifest.jsonl").write_text("\n".join(json.dumps(x) for x in lines) + "\n", encoding="utf-8")
        before_src = tree(lib)
        code, preview = self.http("POST", "/import/preview", {"source": {"path": str(lib)}, "target": "currentSpace",
                                                                 "keepAsSources": False})
        self.run.report(code == 200 and preview["kind"] == "files" and tree(lib) == before_src, "preview detects Files and changes nothing")
        r = self.do_import(lib)
        bs = blocks(self.root)
        dns = next((b for b in bs.values() if b["id"] == "01ABC"), None)
        ok = (
            dns is not None
            and dns["system"] == "sharepoint"
            and dns["url"] == "https://sp.example/dns"
            and dns["version"] == "7.0"
            and dns["author"] == "Ann Author"
            and dns.get("original") == "Attachments/Originals/DNS.docx"
            and (self.root / dns["original"]).read_bytes() == docx
        )
        self.run.report(ok, "manifest fills importSource; the .docx original is kept byte for byte")
        net = next((b for b in bs.values() if b["id"] == "Runbooks/Network.vsdx"), None)
        page = next((k for k, b in bs.items() if b is net), None)
        self.run.report(
            net is not None and page is not None and f"![[{net['original']}]]" in (self.root / page).read_text(encoding="utf-8"),
            ".vsdx is an Original only page with the file as a media block",
        )
        report = (self.root / r["reportPath"]).read_text(encoding="utf-8")
        self.run.report("## Counts" in report and "Original only" in report and self.reconciles(r), "the report has reconciling counts and lists Original only")
        meta = self.root / ".object" / "imports" / r["batch"]
        self.run.report((meta / "report.md").is_file() and (meta / "batch.json").is_file(), "the report and batch.json are in the batch records")
        # File objects option, on a second copy of the folder so it is a fresh import.
        lib2 = shutil.copytree(lib, self.src / "Library2")
        (lib2 / "extra.vsdx").write_bytes(b"another visio")
        r2 = self.do_import(lib2, keepOriginals="fileObjects")
        objs = self.http("GET", "/objects")[1]
        self.run.report(any(o["title"] == "extra.vsdx" and o["type"] == "file" for o in objs), "File objects: the original is a File object too")
        self.run.report(self.reconciles(r2), "counts reconcile (File objects run)")

    # 4 ------------------------------------------------------------------------------
    def reruns(self) -> None:
        print("\n3. Running a source again")
        vault = self.vault
        before_files = {p for p in self.root.rglob("*") if p.is_file()}
        att_before = sorted(p.name for p in (self.root / "Attachments").iterdir())
        r = self.do_import(vault)
        self.run.report(r["objects"] == 0 and r["updated"] == 0 and r["unchanged"] > 0 and self.reconciles(r), f"same source again: {r['unchanged']} unchanged, nothing new")
        self.run.report(sorted(p.name for p in (self.root / "Attachments").iterdir()) == att_before, "no duplicate attachments")
        new_files = {p.relative_to(self.root).as_posix() for p in self.root.rglob("*") if p.is_file()} - {p.relative_to(self.root).as_posix() for p in before_files}
        self.run.report(all(f.startswith((".object/imports/", "Pages/Import report")) for f in new_files), "only the report and batch records were added", *sorted(new_files)[:5])
        # Change one file, add one, remove one.
        emma = vault / "Books" / "Emma.md"
        emma.write_text(emma.read_text(encoding="utf-8") + "\nA new paragraph at the source.\n", encoding="utf-8")
        (vault / "Fresh.md").write_text("# Fresh\n\nnew at the source\n", encoding="utf-8")
        (vault / "Books" / "Sub" / "Deep note.md").unlink()
        r = self.do_import(vault)
        self.run.report(r["updated"] == 1 and r["objects"] == 1 and r["removed"] == 1 and self.reconciles(r), f"changed/new/removed: {r['updated']} updated, {r['objects']} new, {r['removed']} removed")
        emma_rel = next(k for k, b in blocks(self.root).items() if b["id"] == "Books/Emma.md")
        self.run.report("A new paragraph at the source." in (self.root / emma_rel).read_text(encoding="utf-8"), "the changed object was updated in place")
        _, hist = self.http("GET", "/history", path=emma_rel)
        self.run.report(bool(hist["versions"]), "the old content is in version history")
        report = (self.root / r["reportPath"]).read_text(encoding="utf-8")
        deep = [k for k, b in blocks(self.root).items() if b["id"] == "Books/Sub/Deep note.md"]
        self.run.report("Removed at source" in report and bool(deep) and (self.root / deep[0]).is_file(), "Removed at source is listed; the object stays (never trashed)")
        self.updated_batch = r["batch"]
        # Changed in both.
        both = self.tmp / "Both"
        both.mkdir()
        for n in ("a", "b"):
            (both / f"{n}.md").write_text(f"# {n}\n\nversion one\n", encoding="utf-8")
        self.do_import(both, "obsidian")
        bs = blocks(self.root)
        pa = next(k for k, b in bs.items() if b["id"] == "a.md")
        pb = next(k for k, b in bs.items() if b["id"] == "b.md")
        for rel in (pa, pb):
            _, obj = self.http("GET", "/object", path=rel)
            code, _ = self.http("PUT", "/object/body", {"path": rel, "body": "# edited\n\nmy own words\n", "baseVersion": obj["version"]})
            assert code == 200, code
        for n in ("a", "b"):
            (both / f"{n}.md").write_text(f"# {n}\n\nversion two\n", encoding="utf-8")
        r = self.do_import(both, "obsidian")
        self.run.report(r["changedInBoth"] == 2 and r["updated"] == 0 and "my own words" in (self.root / pa).read_text(encoding="utf-8"), "edited in Object and changed at the source: not overwritten, listed as Changed in both")
        code, out = self.http("POST", f"/import/batches/{r['batch']}/resolve", {"action": "take", "paths": [pa]})
        self.run.report(code == 200 and "version two" in (self.root / pa).read_text(encoding="utf-8"), "Take source writes the source version")
        _, hist = self.http("GET", "/history", path=pa)
        found = any("my own words" in (self.http("GET", "/history/version", path=pa, id=v["id"])[1].get("text") or "") for v in hist["versions"])
        self.run.report(found, "the Object edit stays in version history")
        code, out = self.http("POST", f"/import/batches/{r['batch']}/resolve", {"action": "keep"})
        self.run.report(code == 200 and out["pending"] == 0 and "my own words" in (self.root / pb).read_text(encoding="utf-8"), "Keep mine leaves the object as it is")
        r = self.do_import(both, "obsidian")
        self.run.report(r["changedInBoth"] == 0 and r["unchanged"] == 2, "after resolving, the same source is unchanged")

    # 5 ------------------------------------------------------------------------------
    def batches(self) -> None:
        print("\n4. Batches: Move batch to Trash, and a copy of the space")
        src = self.tmp / "Batchy"
        src.mkdir()
        (src / "one.md").write_text("# one\n\nfirst\n", encoding="utf-8")
        first = self.do_import(src, "obsidian")
        (src / "one.md").write_text("# one\n\nsecond\n", encoding="utf-8")
        (src / "two.md").write_text("# two\n\nnew\n", encoding="utf-8")
        second = self.do_import(src, "obsidian")
        code, listing = self.http("GET", "/import/batches")
        self.run.report(code == 200 and listing["batches"][0]["id"] == second["batch"], "GET /import/batches lists the newest first")
        code, out = self.http("POST", f"/import/batches/{second['batch']}/trash")
        titles = {o["title"] for o in self.http("GET", "/objects")[1]}
        self.run.report(code == 200 and out["trashed"] == 1 and "one" in titles and "two" not in titles, "Move batch to Trash: the created object goes, the updated one stays")
        _, trash = self.http("GET", "/trash")
        self.run.report(any(t.get("title") == "two" for t in trash), "the Trash holds it, restorable")
        self.run.report(first["objects"] == 1, "(first batch created one)")
        # A copy of this space.
        before = snapshot(self.root)
        res = self.do_import(self.vault, target={"kind": "spaceCopy", "name": "Trial copy", "location": str(self.out)})
        copy = self.out / "Trial copy"
        self.run.report(snapshot(self.root) == before, "the open space is untouched by a run into a copy")
        self.run.report((copy / ".object").is_dir() and len(blocks(copy)) > 0 and res["batch"], f"the copy holds the import ({len(blocks(copy))} objects with provenance)")
        self.run.report(
            (copy / ".object" / "imports" / res["batch"] / "batch.json").is_file(), "the copy has its own batch records"
        )

    # 6 ------------------------------------------------------------------------------
    def reads_write_nothing(self) -> None:
        print("\n5. Reads write nothing")
        before = (snapshot(self.root), tree(self.src))
        for path in (self.vault, self.src / "Library"):
            code, _ = self.http("POST", "/import/preview", {"source": {"path": str(path)}, "target": "currentSpace",
                                                     "keepAsSources": False})
            assert code == 200
        self.http("GET", "/import/batches")
        self.run.report((snapshot(self.root), tree(self.src)) == before, "previews and batch listings change no file")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path, nargs="?", default=FIXTURES / "space-sample")
    ap.add_argument("--keep", action="store_true", help="keep the temporary folder")
    args = ap.parse_args(argv)
    src = args.space.resolve()
    if not src.is_dir():
        ap.error(f"Not a folder: {src}")
    tmp = Path(tempfile.mkdtemp(prefix="m25-acceptance-")).resolve()
    root = tmp / src.name
    shutil.copytree(src, root, ignore=shutil.ignore_patterns(".git", ".object-cache"))
    saved_env = {k: os.environ.get(k) for k in HOOKS}
    os.environ.update({"OBJECT_STATE_DIR": str(tmp / "state"), "OBJECT_CACHE_DIR": str(tmp / "cache")})
    git(root, "init", "-q")
    commit(root, "base")
    served: Served | None = None
    run: Run | None = None
    try:
        space = Space(root)
        commit(root, "opened")
        served = Served(root, space)
        run = Run(root, served.http)
        m25 = M25(root, run, tmp)
        print(f"Space copy: {root}")
        m25.provenance()
        m25.files_kind()
        m25.reruns()
        m25.batches()
        m25.reads_write_nothing()
    finally:
        if served is not None:
            served.stop()
        for k, v in saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        if args.keep:
            print(f"\nKept: {tmp}")
        else:
            remove_tree(tmp)
    failures = run.failures if run is not None else 1
    print(f"\n{'All checks passed' if not failures else f'{failures} check(s) failed'}.")
    print("RESULT:", "PASS" if not failures else f"FAIL ({failures})")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
