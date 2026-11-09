"""The M15 import routes (contract: ``docs/superpowers/plans/2026-11-05-m15-importers.md``).

- ``POST /api/import/preview`` `PreviewRequest` -> `ImportPreview`: reads the zip or folder at
  ``source.path`` into an `ImportPlan` and answers the dry run; writes nothing anywhere.
  ``404`` no such file or folder, ``415`` neither a ``.zip`` nor a folder, ``413`` over the
  limits, ``422`` a bad mapping. The last `MAX_READS` reads are kept, each for `READ_TTL`
  (our choice): sent again with the same path and kind while the source's fingerprint is
  unchanged, the preview re-plans without reading the source again. A read is dropped when an
  import starts from one of its previews (the job keeps what it needs until it ends).
- ``POST /api/import/start`` `StartImportRequest` -> ``202`` `StartImportResponse`: checks the
  target (``409`` the new space's folder exists, another import runs or the source changed since
  the preview; ``422`` bad name, a target inside the source or the source inside the target;
  ``404`` unknown or expired preview, location not a folder) and starts the job.
- ``GET /api/import/jobs/{id}`` -> `ImportJob` (``404``).
- ``POST /api/import/jobs/{id}/cancel`` -> ``{ok}``: stops after the file being written (``404``).

A new space is made with `create_space(name, location, 'blank')` and written through a second,
unserved `Space` (no watcher, no search index); it is registered (``touch=False``) once the job
ends. Importing into the open space writes through ``ctx.space``; when the job ends having
written anything (done, stopped or failed), it reindexes search and announces one resync, the
watcher's (``types`` at `RESYNC_PATH`, no origin), so every window, the importing one too,
reloads once instead of handling an event per object.
"""

from __future__ import annotations

import logging
import os
import secrets
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from .apictx import ApiContext
from .appstate import state_dir
from .importers import agentwire, batches, provenance
from .importers.detect import read_source
from .importers.jobs import Busy, JobHandle, Jobs
from .importers.model import (
    ImportMapping,
    ImportResult,
    PreviewRequest,
    StartImportRequest,
)
from .importers.planner import MappingProblem, Target, plan, to_preview
from .importers.readmodel import ReadResult
from .importers.source import LimitExceeded, NotASource, SourceMissing, open_source
from .importers.writer import WriteState, open_checked, write_import
from .space import Space, safe_filename
from .spaceconfig import MAX_NAME_LENGTH
from .spaces import Registry, create_space, normalize
from .watcher import RESYNC_PATH, ChangeEvent

__all__ = ["MAX_READS", "READ_TTL", "router"]

_log = logging.getLogger(__name__)

READ_TTL = 30 * 60.0
MAX_READS = 3
"""Source reads kept for re-planning and starting (least recently used dropped first)."""


def _error(status: int, detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail}, status_code=status)


@dataclass
class _Cached:
    key: tuple[str, str, str]
    """(source path, requested kind, fingerprint)."""
    read: ReadResult
    at: float
    previews: set[str]


def _reuse(space, read) -> dict[str, str]:
    """M25 re-runs: source path -> the path of the object an earlier import made from it."""
    index = provenance.index_space(space)
    if not index:
        return {}
    out: dict[str, str] = {}
    for o in read.objects:
        hit = provenance.find(index, read, o)
        if hit is not None:
            out[o.sourcePath] = hit.path
    return out


def _last_mapping(space, source_path: str) -> ImportMapping | None:
    """The mapping the last finished import of this source used (design section 5)."""
    prior = batches.load_prior(space.root, source_path)
    if not prior.mapping:
        return None
    try:
        return ImportMapping.model_validate(prior.mapping)
    except ValueError:
        return None


def _within(child: Path, parent: Path) -> bool:
    c, p = os.path.normcase(str(child)), os.path.normcase(str(parent))
    return c == p or c.startswith(p.rstrip(os.sep) + os.sep)


def router(ctx: ApiContext) -> APIRouter:
    """The import routes, mounted on the app's ``/api`` router (so no prefix here)."""
    r = APIRouter()
    lock = threading.Lock()
    reads: OrderedDict[tuple[str, str, str], _Cached] = OrderedDict()  # least recently used first
    jobs = Jobs()
    r.jobs = jobs  # type: ignore[attr-defined]  (tests reach the job list)

    def expire() -> None:
        """Drop expired reads (call with ``lock`` held)."""
        now = time.monotonic()
        for key in [k for k, c in reads.items() if now - c.at > READ_TTL]:
            reads.pop(key, None)

    def keep(c: _Cached, preview_id: str) -> None:
        """Remember ``c`` as the most recently used read (call with ``lock`` held)."""
        current = reads.get(c.key)
        if current is not None and current is not c:
            current.previews |= c.previews
            c = current
        c.previews.add(preview_id)
        c.at = time.monotonic()
        reads[c.key] = c
        reads.move_to_end(c.key)
        while len(reads) > MAX_READS:
            reads.popitem(last=False)

    def announce_resync() -> None:
        """One resync for a whole import, with no origin: every window (the importing one
        too) reloads once, as after the watcher's resync."""
        try:
            ctx.announce(ChangeEvent("types", RESYNC_PATH, None))
        except Exception:  # noqa: BLE001 - an SSE hiccup never fails an import
            _log.warning("Could not announce the import's resync", exc_info=True)

    @r.post("/import/preview")
    def post_preview(req: PreviewRequest):
        try:
            src = open_source(req.source.path, req.leaveOut)
        except SourceMissing:
            return _error(404, "There is no file or folder at this path.")
        except NotASource as exc:
            return _error(415, str(exc))
        except LimitExceeded as exc:
            return _error(413, str(exc))
        try:
            key = (str(src.path), req.source.kind, src.fingerprint + "|" + "\x00".join(req.leaveOut))
            with lock:
                expire()
                c = reads.get(key)
            if c is None:
                try:
                    read = read_source(src, req.source.kind)
                except LimitExceeded as exc:
                    return _error(413, str(exc))
                read.leave_out = list(req.leaveOut)
                read.left_out = list(src.left_out)
                c = _Cached(key, read, time.monotonic(), set())
        finally:
            src.close()
        target = Target("currentSpace", ctx.space) if req.target == "currentSpace" else Target("newSpace")
        reuse: dict[str, str] = {}
        mapping = req.mapping
        if req.target == "currentSpace":
            reuse = _reuse(ctx.space, c.read)
            if mapping is None:
                mapping = _last_mapping(ctx.space, c.read.sourcePath)
        try:
            try:
                planned = plan(c.read, mapping, target, reuse=reuse)
            except MappingProblem:
                if mapping is req.mapping:
                    raise
                planned = plan(c.read, None, target, reuse=reuse)  # the remembered mapping no longer fits
        except MappingProblem as exc:
            return _error(422, str(exc))
        preview_id = secrets.token_hex(8)
        with lock:
            keep(c, preview_id)
        return to_preview(planned, preview_id).model_dump()

    @r.post("/import/start", status_code=202)
    def post_start(req: StartImportRequest):
        with lock:
            expire()
            c = next((c for c in reads.values() if req.previewId in c.previews), None)
            if c is None:
                return _error(404, "This preview has expired. Preview the source again.")
            read = c.read
        if jobs.running():
            return _error(409, "Another import is running.")
        source = Path(read.sourcePath)
        source_folder = source if read.container == "folder" else source.parent
        if req.target.kind in ("newSpace", "spaceCopy"):
            name = req.target.name.strip()
            if not name:
                return _error(422, "A space needs a name.")
            if len(name) > MAX_NAME_LENGTH:
                return _error(422, f"A space name can have at most {MAX_NAME_LENGTH} characters.")
            try:
                location = normalize(req.target.location)
            except (ValueError, OSError):
                return _error(404, "This path is not a folder.")
            if not location.is_dir():
                return _error(404, f'"{location}" is not a folder.')
            target_path = location / safe_filename(name)
            if target_path.exists():
                return _error(409, "A file or folder with this name already exists there.")
            if read.container == "folder" and _within(target_path, source):
                return _error(422, "The new space can't be inside the folder being imported.")
            if req.target.kind == "spaceCopy" and _within(target_path, ctx.space.root):
                return _error(422, "The copy can't be inside this space.")
            target = Target("newSpace") if req.target.kind == "newSpace" else Target("currentSpace", ctx.space)
        else:
            target_path = ctx.space.root
            if _within(source, target_path) or (read.container == "folder" and _within(target_path, source_folder)):
                return _error(422, "A source inside this space can't be imported into it.")
            target = Target("currentSpace", ctx.space)
        # The source must still be what was previewed.
        try:
            with open_source(read.sourcePath, read.leave_out) as src:
                fingerprint = src.fingerprint
        except (SourceMissing, NotASource, LimitExceeded):
            fingerprint = ""
        if fingerprint != read.fingerprint:
            return _error(409, "The source changed since the preview. Preview it again.")
        draft_patterns: list[str] = []
        if req.batch:
            try:
                bdata, _items = batches.load_batch(ctx.space.root, req.batch)
            except KeyError:
                return _error(404, "No such import batch.")
            if bdata.get("state") != "draft":
                return _error(409, "That batch has already been imported.")
            draft_patterns = [str(x) for x in bdata.get("leaveOut") or []]
        previewed = read
        read = agentwire.apply_leave_out(read, req, draft_patterns)
        reuse = _reuse(ctx.space, read) if target.kind == "currentSpace" else {}
        try:
            planned = plan(read, req.mapping, target, reuse=reuse, lenient=read is not previewed)
        except MappingProblem as exc:
            return _error(422, str(exc))
        if req.requireApproved:  # an agent's import, into this space or a new one alike (Gene, 2026-11-08)
            names = agentwire.unapproved_types(planned, ctx.space.root, req.batch)
            if names:
                return _error(422, "The mapping would create types no approved schema proposal creates: "
                                   + ", ".join(sorted(names)) + ". Save a proposal and ask the user to approve and apply it in Object.")
        try:
            handle = jobs.reserve(str(target_path))
        except Busy as exc:
            return _error(409, str(exc))
        with lock:  # this read's job holds what it needs; the cache lets it go
            if reads.get(c.key) is c:
                reads.pop(c.key, None)

        if req.target.kind in ("newSpace", "spaceCopy"):
            space_name, where = req.target.name.strip(), str(location)
            is_copy = req.target.kind == "spaceCopy"

            def work(h: JobHandle) -> ImportResult:
                src = open_checked(planned)  # before the space is made: a source gone leaves nothing
                try:
                    if is_copy:  # M25 "Try on a copy of this space"
                        folder = batches.copy_space(ctx.space.root, target_path)
                    else:
                        folder = create_space(space_name, where, "blank")
                except BaseException:
                    src.close()
                    raise
                try:
                    state = WriteState(progress=h.progress, cancelled=h.cancelled, keep_originals=req.keepOriginals)
                    agentwire.prepare(state, read, req, Path(folder), ctx.space.root)
                    result = write_import(planned, Space(folder), state, src)
                finally:
                    try:
                        Registry(state_dir()).register(folder, touch=False)
                    except OSError:
                        pass
                if state.stopped and not result.cancelled:
                    h.job.error = f"The import stopped: {state.stopped}."
                return result

        else:

            def work(h: JobHandle) -> ImportResult:
                state = WriteState(progress=h.progress, cancelled=h.cancelled, keep_originals=req.keepOriginals)
                agentwire.prepare(state, read, req, ctx.space.root, ctx.space.root)
                try:
                    result = write_import(planned, ctx.space, state)
                finally:
                    if state.wrote_anything:
                        try:
                            ctx.search.reindex()
                        except Exception:  # noqa: BLE001 - search catches up on its own
                            pass
                        announce_resync()
                if state.stopped and not result.cancelled:
                    h.job.error = f"The import stopped: {state.stopped}."
                return result

        jobs.run(handle, work)
        return {"jobId": handle.job.id, "targetPath": str(target_path)}

    from .api_import_batches import router as batches_router

    r.include_router(batches_router(ctx, jobs, announce_resync))
    from .api_import_agent import router as agent_router

    agent = agent_router(ctx, jobs, announce_resync)
    r.filing = agent.filing  # type: ignore[attr-defined]
    r.include_router(agent)

    @r.get("/import/jobs/{job_id}")
    def get_job(job_id: str):
        job = jobs.get(job_id)
        if job is None:
            return _error(404, "No such import.")
        return job.model_dump()

    @r.post("/import/jobs/{job_id}/cancel")
    def post_cancel(job_id: str):
        if not jobs.cancel(job_id):
            return _error(404, "No such import.")
        return {"ok": True}

    return r
