"""Milestone 15 (importers) acceptance run over HTTP, Lane B.

Usage: ``uv run python scripts/m15_acceptance.py [SPACE] [--keep]``

SPACE (default: ``backend/tests/fixtures/space-sample``) is copied to a temporary folder and
committed to a throw-away git repo; SPACE itself is never touched. The synthetic import
fixtures (``backend/tests/fixtures/import-notion``, ``import-obsidian``, ``import-anytype``)
are copied too, the Notion one zipped as Notion names its exports. ``OBJECT_STATE_DIR`` and
``OBJECT_CACHE_DIR`` point at temporary folders. The copy is served with ``create_app`` on a
free ``127.0.0.1`` port, and over HTTP it checks:

1. a preview of each source (Notion zip, Obsidian folder, Anytype folder picked by hand)
   answers 200 and writes nothing: not the source, not the space, not the state dir;
2. importing the Obsidian vault and the Notion export into new spaces: every object written,
   the links resolve to the right objects (a shared title included), the attachments are
   copied byte for byte, and the "Import report" object lists the skipped items; the new
   spaces are registered;
3. a malicious zip (``..``, absolute and drive-letter entries) writes nothing outside its target;
4. a source changed after its preview answers 409 and creates nothing;
5. importing into "This space" (a file named like an existing object included) never
   overwrites a file: ``git status`` of the space shows only new files.

Each check prints ``[ok]`` or ``[FAIL]``; exits non-zero on any failure.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import tempfile
import time
import zipfile
from pathlib import Path

from m2_acceptance import Http, Run, commit, git, remove_tree, snapshot
from m8_acceptance import Served
from objectapp.appstate import state_dir
from objectapp.space import Space
from objectapp.spaces import Registry

REPO = Path(__file__).resolve().parents[1]
FIXTURES = REPO / "backend" / "tests" / "fixtures"
HOOKS = ("OBJECT_STATE_DIR", "OBJECT_CACHE_DIR")


def zip_folder(folder: Path, dest: Path) -> Path:
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in sorted(folder.rglob("*")):
            if p.is_file():
                zf.write(p, p.relative_to(folder).as_posix())
    return dest


def tree(folder: Path) -> dict[str, bytes]:
    return {p.relative_to(folder).as_posix(): p.read_bytes() for p in sorted(folder.rglob("*")) if p.is_file()}


def state_snapshot() -> dict[str, bytes]:
    folder = state_dir()
    return tree(folder) if folder.is_dir() else {}


class M15:
    def __init__(self, root: Path, run: Run, tmp: Path) -> None:
        self.root = root
        self.run = run
        self.tmp = tmp
        self.src = tmp / "sources"
        self.out = tmp / "imported"
        self.out.mkdir()

    @property
    def http(self) -> Http:
        return self.run.http

    def preview(self, path: Path, kind: str = "auto", **extra) -> tuple[int, dict]:
        return self.http("POST", "/import/preview", {"source": {"path": str(path), "kind": kind}, **extra})

    def start(self, preview: dict, target: dict) -> tuple[int, dict]:
        return self.http(
            "POST", "/import/start", {"previewId": preview["previewId"], "mapping": preview["mapping"], "target": target}
        )

    def wait(self, job_id: str) -> dict:
        for _ in range(1200):
            _, job = self.http("GET", f"/import/jobs/{job_id}")
            if job["phase"] in ("done", "failed", "cancelled"):
                return job
            time.sleep(0.05)
        return job

    def sources(self) -> dict[str, Path]:
        self.src.mkdir()
        notion = shutil.copytree(FIXTURES / "import-notion", self.tmp / "notion-folder")
        return {
            "notion": zip_folder(notion, self.src / "Export-0123abcd-1111-2222-3333-444455556666.zip"),
            "obsidian": shutil.copytree(FIXTURES / "import-obsidian", self.src / "Vault"),
            "anytype": shutil.copytree(FIXTURES / "import-anytype", self.src / "Anytype export"),
        }

    # 1 ------------------------------------------------------------------------------
    def previews_write_nothing(self, sources: dict[str, Path]) -> dict[str, dict]:
        print("\n1. A preview writes nothing")
        out = {}
        for kind, path in sources.items():
            before = (tree(self.src), snapshot(self.root), state_snapshot())
            code, preview = self.preview(path, "anytype" if kind == "anytype" else "auto")
            after = (tree(self.src), snapshot(self.root), state_snapshot())
            ok = code == 200 and preview.get("kind") == kind and before == after
            self.run.report(
                ok,
                f"{kind}: {code}, {preview.get('counts', {}).get('objects')} objects planned, nothing written",
                *([] if before == after else ["files changed"]),
            )
            out[kind] = preview
        return out

    # 2 ------------------------------------------------------------------------------
    def import_new(self, kind: str, path: Path) -> Path | None:
        # The server keeps only the latest read, so preview again right before starting.
        name = f"From {kind}"
        _, preview = self.preview(path, "anytype" if kind == "anytype" else "auto")
        code, started = self.start(preview, {"kind": "newSpace", "name": name, "location": str(self.out)})
        if not self.run.report(code == 202, f"{kind}: start answers 202 ({code})"):
            return None
        job = self.wait(started["jobId"])
        result = job.get("result") or {}
        self.run.report(
            job["phase"] == "done" and result.get("objects") == preview["counts"]["objects"],
            f"{kind}: job {job['phase']}, {result.get('objects')} of {preview['counts']['objects']} objects, "
            f"{result.get('attachments')} attachments, {result.get('tags')} tags",
            *([job["error"]] if job.get("error") else []),
        )
        root = Path(started["targetPath"])
        registered = any(Path(e.path) == root.resolve() for e in Registry(state_dir()).list())
        self.run.report(registered, f"{kind}: the new space is registered")
        return root

    def check_obsidian(self, root: Path, vault: Path) -> None:
        space = Space(root)
        home = (root / "Pages" / "Home.md").read_text(encoding="utf-8")
        ok = (
            space.resolve("Dune", "Pages/Home.md") == "Books/Dune.md"
            and space.resolve("Emma", "Pages/Home.md") == "Books/Emma.md"
            and "[[Dune|the book]]" in home
            and "[[Nowhere]]" in home
        )
        self.run.report(ok, "obsidian: links resolve to the imported objects (shared title Dune included)")
        same = (root / "Attachments" / "cover.png").read_bytes() == (vault / "attachments" / "cover.png").read_bytes()
        self.run.report(same and "![](Attachments/cover.png)" in home, "obsidian: attachments copied and embeds rewritten")
        report = (root / "Pages" / "Import report.md").read_text(encoding="utf-8")
        ok = all(s in report for s in ("Board.canvas", "unused.txt", "cssclasses", "[[Nowhere]]"))
        self.run.report(ok, "obsidian: the Import report lists the skipped items")

    def check_notion(self, root: Path) -> None:
        space = Space(root)
        dune = space.read("Books/Dune.md")[1]
        welcome = (root / "Pages" / "Welcome.md").read_text(encoding="utf-8")
        ok = (
            dune.get("author") == ["[[Frank Herbert]]"]
            and space.resolve("Frank Herbert", "Books/Dune.md") == "Authors/Frank Herbert.md"
            and "[[Dune]]" in welcome
            and space.resolve("Dune", "Pages/Welcome.md") == "Books/Dune.md"
            and (root / "Books" / "Untitled (2).md").is_file()
        )
        self.run.report(ok, "notion: relations and links resolve; a repeated title gets (2)")
        notion = self.tmp / "notion-folder" / "Welcome 0123456789abcdef0123456789abcdef"
        same = (root / "Attachments" / "diagram.png").read_bytes() == (notion / "diagram.png").read_bytes()
        self.run.report(same, "notion: attachments copied byte for byte")
        report = (root / "Pages" / "Import report.md").read_text(encoding="utf-8")
        ok = "_all file is read instead" in report and "Gone%20" in report and "Link to a database" in report
        self.run.report(ok, "notion: the Import report lists the skipped items")

    # 3 ------------------------------------------------------------------------------
    def malicious_zip(self) -> None:
        print("\n3. A malicious zip writes nothing outside its target")
        evil = self.tmp / "evil"
        evil.mkdir()
        z = evil / "evil.zip"
        with zipfile.ZipFile(z, "w") as zf:
            zf.writestr("../../escape.md", "# escape\n")
            zf.writestr("/tmp/m15-absolute-escape.md", "# absolute\n")
            zf.writestr("C:/drive-escape.md", "# drive\n")
            zf.writestr("ok.md", "# ok\n\nSafe.\n")
        before_tmp = sorted(p.relative_to(self.tmp).as_posix() for p in self.tmp.rglob("*") if "imported" not in p.parts)
        code, preview = self.preview(z)
        reasons = sorted({s["reason"] for s in preview.get("skipped", [])})
        self.run.report(code == 200 and reasons == ["unsafePath"], f"preview lists the unsafe entries ({reasons})")
        code, started = self.start(preview, {"kind": "newSpace", "name": "Evil", "location": str(evil)})
        job = self.wait(started["jobId"]) if code == 202 else {"phase": code}
        after_tmp = sorted(p.relative_to(self.tmp).as_posix() for p in self.tmp.rglob("*")
                           if "imported" not in p.parts and not p.relative_to(self.tmp).as_posix().startswith("evil/Evil"))
        ok = (
            job["phase"] == "done"
            and before_tmp == after_tmp
            and not Path("/tmp/m15-absolute-escape.md").exists()
            and not (self.tmp.parent / "escape.md").exists()
        )
        self.run.report(ok, "only the target space was written")

    # 4 ------------------------------------------------------------------------------
    def changed_source(self) -> None:
        print("\n4. A source changed after its preview answers 409")
        folder = shutil.copytree(FIXTURES / "import-anytype", self.tmp / "changing")
        _, preview = self.preview(folder, "anytype")
        (folder / "Late.md").write_text("# Late\n", encoding="utf-8")
        code, _ = self.start(preview, {"kind": "newSpace", "name": "Never", "location": str(self.out)})
        self.run.report(code == 409 and not (self.out / "Never").exists(), f"start answers {code}; nothing created")

    # 5 ------------------------------------------------------------------------------
    def into_this_space(self) -> None:
        print('\n5. Importing into "This space" never overwrites a file')
        commit(self.root, "before import")
        folder = self.tmp / "into-here"
        (folder / "Notes").mkdir(parents=True)
        existing = sorted(p for p in self.root.rglob("*.md") if not any(x.startswith(".") for x in p.parts))
        clash = existing[0]
        (folder / "Notes" / f"{clash.stem}.md").write_text("---\nfrom: import\n---\nAn imported page.\n", encoding="utf-8")
        (folder / "Notes" / "Brand new.md").write_text("Fresh [[" + clash.stem + "]].\n", encoding="utf-8")
        (folder / f"{clash.stem}.md").write_text("A root page named like an existing object.\n", encoding="utf-8")
        before = snapshot(self.root)
        code, preview = self.preview(folder, target="currentSpace")
        if not self.run.report(code == 200, f"preview for this space: {code}"):
            return
        code, started = self.start(preview, {"kind": "currentSpace"})
        job = self.wait(started["jobId"]) if code == 202 else {"phase": code}
        after = snapshot(self.root)
        changed = sorted(k for k in before if after.get(k) != before[k])
        status = git(self.root, "status", "--porcelain", "--untracked-files=all").splitlines()
        not_new = [line for line in status if not line.startswith("??")]
        self.run.report(
            job["phase"] == "done" and not changed and not not_new,
            f"job {job['phase']}; {len(status)} new files, {len(changed)} changed, {len(not_new)} not new",
            *changed[:5],
            *not_new[:5],
        )
        code, space = self.http("GET", "/space")
        names = {t["name"] for t in space.get("types", [])}
        self.run.report(code == 200 and "Note" in names, "the open space lists the new type")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("space", type=Path, nargs="?", default=FIXTURES / "space-sample")
    ap.add_argument("--keep", action="store_true", help="keep the temporary folder")
    args = ap.parse_args(argv)
    src = args.space.resolve()
    if not src.is_dir():
        ap.error(f"Not a folder: {src}")
    tmp = Path(tempfile.mkdtemp(prefix="m15-acceptance-")).resolve()
    root = tmp / src.name
    shutil.copytree(src, root, ignore=shutil.ignore_patterns(".git", ".object-cache"))
    saved_env = {k: os.environ.get(k) for k in HOOKS}
    os.environ.update({"OBJECT_STATE_DIR": str(tmp / "state"), "OBJECT_CACHE_DIR": str(tmp / "cache")})
    git(root, "init", "-q")
    commit(root, "base")
    served: Served | None = None
    run: Run | None = None
    try:
        space = Space(root)  # opened (and migrated, if it is old) before the checks
        commit(root, "opened")
        served = Served(root, space)
        run = Run(root, served.http)
        m15 = M15(root, run, tmp)
        print(f"Space copy: {root}")
        sources = m15.sources()
        pristine = tree(m15.src)
        m15.previews_write_nothing(sources)
        print("\n2. Importing into a new space")
        for kind in ("obsidian", "notion", "anytype"):
            target = m15.import_new(kind, sources[kind])
            if target is None:
                continue
            if kind == "obsidian":
                m15.check_obsidian(target, sources["obsidian"])
            elif kind == "notion":
                m15.check_notion(target)
        run.report(tree(m15.src) == pristine, "the sources are unchanged after importing")
        m15.malicious_zip()
        m15.changed_source()
        m15.into_this_space()
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
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
