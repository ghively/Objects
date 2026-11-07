"""M27: what the import start does for the scan and the schema proposal (design sections 6 and 8)."""

from __future__ import annotations

import dataclasses
from pathlib import Path
from typing import Any

from ..ids import new_ulid
from ..importscan import is_left_out, scan_tree
from . import batches, proposal
from .model import StartImportRequest
from .readmodel import ReadResult

__all__ = ["apply_leave_out", "prepare", "unapproved_types"]

DRAFT_RECORDS = ("scan.json", "proposal.json", "proposal-review.json")


def apply_leave_out(read: ReadResult, req: StartImportRequest, draft_patterns: list[str] | None = None) -> ReadResult:
    """``read`` without what is left out (a copy; the cached read is shared): the flagged files Gene
    chose to Leave out, and whatever matches a Leave out pattern given with the preview, the scan
    choices or the draft batch. Those are never planned, so never read or written."""
    patterns = list(dict.fromkeys([*read.leave_out, *(req.scan.leaveOut if req.scan else []), *(draft_patterns or [])]))
    gone = set(req.scan.leaveOutFiles) if req.scan else set()
    by_pattern = [o.sourcePath for o in read.objects if o.sourcePath not in gone and is_left_out(o.sourcePath, patterns)]
    if not gone and not by_pattern and patterns == list(read.leave_out):
        return read
    skip = gone | set(by_pattern)
    left = [*read.left_out, *[p for p in by_pattern if p not in read.left_out]]
    return dataclasses.replace(
        read, objects=[o for o in read.objects if o.sourcePath not in skip], leave_out=patterns, left_out=left
    )


def unapproved_types(planned: Any, root: Path, batch: str | None) -> list[str]:
    """Names of types the plan would create that no approved proposal creates."""
    used = {w.obj.typeKey for w in planned.writes}
    approved = proposal.approved_create_names(root, batch)
    out: list[str] = []
    for key, tw in planned.type_writes.items():
        if key in used and tw.existingTypeId is None and not tw.basic and tw.name.casefold() not in approved:
            out.append(tw.name)
    return out


def prepare(state: Any, read: ReadResult, req: StartImportRequest, target_root: Path, open_root: Path) -> None:
    """Set the run's batch id, the Leave out files and the files written with ``excludeFromAI``.

    The scan runs here (local, no AI) when the batch has no ``scan.json`` yet and the source is a
    folder; its findings (kinds and lines only) and the choices are stored as ``scan.json``."""
    batch = req.batch or state.batch or new_ulid()
    state.batch = batch
    if req.batch and Path(target_root) != Path(open_root):
        batches.copy_records(open_root, target_root, batch, proposal_names())
    stored = batches.load_scan(target_root, batch)
    choices = req.scan
    patterns = list(read.leave_out)  # the preview's, the scan choices' and the draft batch's (apply_leave_out)
    if stored is None and read.container == "folder":
        try:
            stored = scan_tree(Path(read.sourcePath), patterns).to_json()
        except OSError:
            stored = None
    flagged = list((stored or {}).get("findings") or {})
    # Whatever the scan flagged is imported excluded from AI, whatever else the choices say; the
    # choices can add files to the list or leave flagged ones out, never import a flagged file plain.
    leave = set(choices.leaveOutFiles) if choices is not None else set()
    exclude = set(flagged) | (set(choices.excludeFromAi) if choices is not None else set())
    exclude -= leave
    state.exclude_ai = exclude
    state.left_out_files = sorted(leave) + [p for p in read.left_out if p not in leave]
    if stored is not None:
        batches.store_scan(
            target_root, batch,
            {**stored, "choices": {"leaveOut": patterns, "leaveOutFiles": sorted(leave), "excludeFromAi": sorted(exclude)}},
        )


def proposal_names() -> tuple[str, ...]:
    return DRAFT_RECORDS
