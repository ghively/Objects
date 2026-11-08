"""Import batches (M25, design section 7): the records of each run, Move batch to Trash,
resolving "Changed in both", the scratch copy of a space and the memory re-runs use.

Layout (``<space>/.object/imports/<batch id>/``; the batch id is a ULID, so folders sort by time):

- ``batch.json``: ``{id, startedAt, finishedAt, source: {path, kind, system}, target, mapping,
  keepOriginals, counts: {sourceItems, imported, updated, unchanged, changedInBoth, leftOut,
  failed, ...}, stopped, reportPath, trashedAt}``.
- ``items.json``: one entry per source item: ``{sourcePath, system, id, title, path, action,
  version, contentHash, original, pending}``. ``action`` is ``created``, ``updated``,
  ``unchanged``, ``conflict`` (waiting for a decision), ``resolvedTake``, ``resolvedKeep``,
  ``failed`` or ``leftOut``. ``version`` is the sha256 of the file bytes the run wrote (what a
  later re-run compares against to see whether the object was edited in Object).
- ``attachments.json``: ``{source path: {path, hash}}``: the attachments the run wrote, reused
  by a re-run when the bytes are the same.
- ``removed.json``: objects an earlier batch of this source made that the source no longer has.
- ``report.md``: the report's body (also an Object page in the space).
- ``pending/<n>.md``: for a "changed in both" item, the file the run would have written.

Later milestones add their own files here (``scan.json``, ``proposal.json``, ``decisions.json``).
"""

from __future__ import annotations

import json
import logging
import os
import shutil
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ..frontmatter import parse_fm, set_keys
from ..objfile import split_object
from ..textfile import atomic_write

if TYPE_CHECKING:
    from ..space import Space

__all__ = [
    "Prior",
    "batch_dir",
    "copy_records",
    "copy_space",
    "create_draft",
    "imports_root",
    "list_batches",
    "load_scan",
    "load_batch",
    "load_prior",
    "resolve_conflicts",
    "same_source",
    "store_scan",
    "snapshot",
    "trash_batch",
    "write_json",
]

_log = logging.getLogger(__name__)


def imports_root(space_root: Path | str) -> Path:
    return Path(space_root) / ".object" / "imports"


def batch_dir(space_root: Path | str, batch: str) -> Path:
    if not batch or "/" in batch or "\\" in batch or batch.startswith("."):
        raise KeyError(batch)
    return imports_root(space_root) / batch


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(path, (json.dumps(data, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def same_source(a: str, b: str) -> bool:
    return os.path.normcase(os.path.normpath(a)) == os.path.normcase(os.path.normpath(b))


def list_batches(space_root: Path | str) -> list[dict[str, Any]]:
    """Every batch's ``batch.json``, newest first (a folder without a readable one is skipped)."""
    root = imports_root(space_root)
    out = []
    try:
        names = sorted(os.listdir(root), reverse=True)
    except OSError:
        return []
    for name in names:
        data = _read_json(root / name / "batch.json")
        if isinstance(data, dict):
            out.append(data)
    return out


def load_batch(space_root: Path | str, batch: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """(batch.json, items); raises `KeyError` for an unknown batch."""
    d = batch_dir(space_root, batch)
    data = _read_json(d / "batch.json")
    if not isinstance(data, dict):
        raise KeyError(batch)
    items = _read_json(d / "items.json")
    return data, items if isinstance(items, list) else []


# -- what a re-run remembers -----------------------------------------------------------------


@dataclass
class Prior:
    """What earlier batches of the same source (in this space) left behind."""

    items: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)
    """(system, id) -> the latest item that produced an object."""
    versions: dict[str, str] = field(default_factory=dict)
    """Object path -> the version of the bytes an import last wrote there."""
    attachments: dict[str, dict[str, str]] = field(default_factory=dict)
    mapping: dict[str, Any] | None = None
    """The last finished batch's mapping (the effective one)."""


def load_prior(space_root: Path | str, source_path: str, *, exclude: str | None = None) -> Prior:
    prior = Prior()
    for b in reversed(list_batches(space_root)):  # oldest first, so the newest wins
        if b.get("id") == exclude or b.get("trashedAt"):
            continue
        if not same_source(str(b.get("source", {}).get("path", "")), source_path):
            continue
        d = imports_root(space_root) / str(b["id"])
        items = _read_json(d / "items.json") or []
        for it in items:
            if not isinstance(it, dict) or not it.get("path"):
                continue
            if it.get("action") in ("created", "updated", "unchanged", "conflict", "resolvedTake", "resolvedKeep"):
                prior.items[(str(it.get("system")), str(it.get("id")))] = it
            if it.get("version") and it.get("action") in ("created", "updated", "resolvedTake", "resolvedKeep"):
                prior.versions[str(it["path"])] = str(it["version"])
        atts = _read_json(d / "attachments.json")
        if isinstance(atts, dict):
            prior.attachments.update({k: v for k, v in atts.items() if isinstance(v, dict)})
        if isinstance(b.get("mapping"), dict) and b.get("finishedAt"):
            prior.mapping = b["mapping"]
    return prior


# -- Move batch to Trash -----------------------------------------------------------------------


def _batch_objects(space: Space, batch: str) -> dict[tuple[str, str], str]:
    """(system, id) -> current path, for every object whose provenance names ``batch``."""
    from . import provenance

    with space._lock:
        raws = list(space._raw.values())
    out: dict[tuple[str, str], str] = {}
    for raw in raws:
        b = provenance.read_block(raw.fm)
        if b is not None and b.get("batch") == batch:
            out.setdefault((str(b["system"]), str(b["id"])), raw.path)
    return out


def trash_batch(space: Space, batch: str) -> dict[str, Any]:
    """Move every object the batch created (not ones it only updated) to the Trash.

    Each object is found by its provenance (source id and batch), so one that was moved since (a
    type change, a rename) is found too; the recorded path is the first guess. Answers ``{trashed,
    alreadyTrashed, missing, notFound}``: ``notFound`` lists recorded paths with no object (and not
    in the Trash); the batch is stamped ``trashedAt`` only when none is missing, and a second call
    skips what is already done. Restorable as any Trash item."""
    from . import provenance

    root = space.root
    data, items = load_batch(root, batch)
    by_id = _batch_objects(space, batch)
    in_trash = {t.originalPath for t in space.list_trash() if t.kind == "object"}
    trashed = already = 0
    not_found: list[str] = []
    for it in items:
        if it.get("action") != "created" or not it.get("path"):
            continue
        recorded = str(it["path"])
        key = (str(it.get("system")), str(it.get("id")))
        with space._lock:
            raw = space._raw.get(recorded)
        block = provenance.read_block(raw.fm) if raw is not None else None
        # Only the object this batch created: another batch's (a re-run that created it again) or
        # one with no provenance (Gene's own) at the recorded path is never trashed.
        if (block is not None and block.get("batch") == batch
                and (str(block["system"]), str(block["id"])) == key):
            rel: str | None = recorded
        else:
            rel = by_id.get(key)  # moved: found by the source id and batch it carries
        if rel is None:
            if recorded in in_trash:
                already += 1
                it["action"] = "trashed"
            else:
                not_found.append(recorded)
            continue
        try:
            space.delete_object(rel)
        except (KeyError, FileNotFoundError):
            not_found.append(recorded)
            continue
        it["action"] = "trashed"
        trashed += 1
    if not not_found:
        data["trashedAt"] = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    d = batch_dir(root, batch)
    write_json(d / "items.json", items)
    write_json(d / "batch.json", data)
    return {"trashed": trashed, "alreadyTrashed": already, "missing": len(not_found), "notFound": not_found}


# -- Changed in both: Take source / Keep mine ---------------------------------------------------


def snapshot(space: Space, rel: str, data: bytes) -> None:
    """Keep ``data`` (the object as it is now) in version history, whatever the 5-minute rule says."""
    from ..history import HistoryStore

    try:
        HistoryStore(space.root).snapshot(rel, data, datetime.now(UTC), force=True)
    except Exception:  # noqa: BLE001 - history must never stop an import step
        _log.exception("Could not keep a version of %s", rel)


def resolve_conflicts(space: Space, batch: str, action: str, paths: list[str] | None = None) -> dict[str, Any]:
    """Apply ``action`` (``take`` or ``keep``) to the batch's "changed in both" items (``paths``
    limits it to those objects; None: all). Take source writes the file the run held back (the
    Object edit stays in version history); Keep mine leaves the object and records the new source
    version, so the same source change isn't flagged again."""
    from ..space import version_of

    if action not in ("take", "keep"):
        raise ValueError("action must be 'take' or 'keep'")
    root = space.root
    data, items = load_batch(root, batch)
    d = batch_dir(root, batch)
    done: list[str] = []
    failed: list[str] = []
    for it in items:
        if it.get("action") != "conflict":
            continue
        rel = str(it.get("path"))
        if paths is not None and rel not in paths:
            continue
        try:
            pending = (d / str(it["pending"])).read_bytes().decode("utf-8")
            new_of = split_object(pending)
            block = parse_fm(new_of.frontmatter_src or "").get("importSource")
            full = space.root / rel
            current = full.read_bytes()
            if action == "take":
                snapshot(space, rel, current)
                # at the version just read and kept: a save made since fails this item, never lost
                space._write(rel, version_of(current), lambda _of, _fm, o=new_of: o, stamp=False, history=False)
            else:
                if not isinstance(block, dict):
                    raise ValueError("no provenance in the held-back file")

                def edit(of: Any, _fm: Any, b: dict = block) -> Any:
                    from dataclasses import replace

                    return replace(of, frontmatter_src=set_keys(of.frontmatter_src or "", {"importSource": b}))

                space._write(rel, None, edit, stamp=False, history=False)
            it["version"] = version_of((space.root / rel).read_bytes())
            it["action"] = "resolvedTake" if action == "take" else "resolvedKeep"
            done.append(rel)
        except Exception:  # noqa: BLE001 - one item that fails is listed, the rest go on
            _log.exception("Could not resolve %s", rel)
            failed.append(rel)
    write_json(d / "items.json", items)
    counts = data.setdefault("counts", {})
    counts["pending"] = sum(1 for it in items if it.get("action") == "conflict")
    write_json(d / "batch.json", data)
    return {"resolved": done, "failed": failed, "pending": counts["pending"]}


# -- Try on a copy of this space -----------------------------------------------------------------


def copy_space(src_root: Path, dest: Path) -> Path:
    """Copy a space folder to ``dest`` (which must not exist), leaving its rebuildable cache and
    Git data behind. Nothing in ``src_root`` is changed."""
    skip = {".object-cache", ".git"}
    shutil.copytree(src_root, dest, ignore=lambda _d, names: [n for n in names if n in skip])
    return dest


# -- M27: a batch before its import (scan, proposal), and the scan records ---------------------------


def create_draft(space_root: Path | str, source_path: str, leave_out: list[str] | None = None) -> str:
    """A batch with only ``batch.json`` (``state: "draft"``), so the scan and the schema proposal have
    a place before the import runs; the import then adopts it (`StartImportRequest.batch`)."""
    from ..ids import new_ulid

    batch = new_ulid()
    write_json(
        batch_dir(space_root, batch) / "batch.json",
        {
            "id": batch,
            "state": "draft",
            "startedAt": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
            "finishedAt": None,
            "source": {"path": source_path, "kind": None, "system": None},
            "leaveOut": list(leave_out or []),
            "counts": {},
        },
    )
    return batch


def store_scan(space_root: Path | str, batch: str, scan: dict[str, Any]) -> None:
    """``scan.json``: the scan's findings (kinds and lines, never values) with the choices made."""
    write_json(batch_dir(space_root, batch) / "scan.json", scan)


def load_scan(space_root: Path | str, batch: str) -> dict[str, Any] | None:
    try:
        data = _read_json(batch_dir(space_root, batch) / "scan.json")
    except KeyError:
        return None
    return data if isinstance(data, dict) else None


def copy_records(src_root: Path | str, dest_root: Path | str, batch: str, names: tuple[str, ...]) -> None:
    """Copy some of a draft batch's record files into another space (an import into a new space)."""
    for name in names:
        src = batch_dir(src_root, batch) / name
        if src.is_file():
            write_json(batch_dir(dest_root, batch) / name, _read_json(src))
