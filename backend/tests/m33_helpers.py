"""M33 test helpers: a space as an import made before M33 left it.

Until M33 the importer put ``# <title>`` above every page it wrote that had no first heading of
its own (M15's rule; the code at ``41857f51``), above its File objects and above its report.
`as_before_m33` puts those lines back on what a batch wrote and records the bytes in the batch's
``items.json`` as that run did, so a re-run meets exactly what the old code left: the same file
but for the ids and times any two runs differ by (checked against a run of the old code itself
when M33 was built; see ``m33-acceptance.md``).
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from objectapp.frontmatter import parse_fm
from objectapp.importers.notion import page_heading
from objectapp.objfile import join_object, split_object
from objectapp.space import version_of

__all__ = ["as_before_m33", "body_of", "stamped", "title_on_top"]


def title_on_top(body: str, title: str) -> str:
    """``body`` as the old rule wrote it: ``# <title>`` and a blank line above a body whose first
    line is not a heading (the heading alone above an empty one)."""
    if page_heading(body) is not None:
        return body
    return f"# {title}\n" + (f"\n{body}" if body else "")


def as_before_m33(root: Path, batch: str) -> list[str]:
    """Rewrite what ``batch`` wrote into the space at ``root`` the way the code before M33 wrote
    it; the paths rewritten. Call it while no app has the space open. Not for a batch kept as
    Sources (a Source's text is the page's own bytes; no heading was ever added to it)."""
    d = root / ".object" / "imports" / batch
    items = json.loads((d / "items.json").read_text("utf-8"))
    data = json.loads((d / "batch.json").read_text("utf-8"))
    changed: list[str] = []

    def rewrite(rel: str) -> str | None:
        path = root / rel
        of = split_object(path.read_bytes().decode("utf-8"))
        title = str(parse_fm(of.frontmatter_src or "").get("title") or "")
        body = title_on_top(of.body, title)
        if body == of.body:
            return None
        out = join_object(type(of)(of.frontmatter_src, body, True, None)).encode("utf-8")
        path.write_bytes(out)
        changed.append(rel)
        return version_of(out)

    for item in items:
        if item.get("action") != "created" or not item.get("path"):
            continue
        version = rewrite(item["path"])
        if version is not None and item.get("version"):
            item["version"] = version
    (d / "items.json").write_text(json.dumps(items, indent=2) + "\n", encoding="utf-8")
    report = data.get("reportPath")
    if report and (root / report).is_file():
        rewrite(report)
        md = d / "report.md"
        if md.is_file():
            title = str(parse_fm(split_object((root / report).read_text("utf-8")).frontmatter_src or "").get("title") or "")
            md.write_text(title_on_top(md.read_text("utf-8"), title), encoding="utf-8")
    return changed


def body_of(root: Path, rel: str) -> str:
    """The text of the note at ``rel`` (after its front matter), line ends as ``\\n``, no BOM."""
    return split_object((root / rel).read_bytes().decode("utf-8-sig").replace("\r\n", "\n")).body


def stamped(root: Path) -> dict[str, tuple[str, int, int]]:
    """Every file under ``root`` (dot folders included) with its hash, size and modification time."""
    out = {}
    for p in sorted(root.rglob("*")):
        if p.is_file():
            st = p.stat()
            out[p.relative_to(root).as_posix()] = (hashlib.sha256(p.read_bytes()).hexdigest(), st.st_size, st.st_mtime_ns)
    return out
