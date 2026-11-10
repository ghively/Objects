"""Restoring a definition's earlier version (M31 item 9).

``POST /api/history/definition/restore`` ``{path, id, baseRevision, confirm?}`` ->
``{revision, rewritten, skipped}``: puts back a version `api_history` lists for a type, collection
or saved query (``.object/<types|collections|queries>/<id>.json``).

The rules (listed for Gene):

- The version goes back through the space's own save (`Space.save_type`, `save_collection`,
  `save_query`), so it is checked like an edit: a stale ``baseRevision`` answers 409
  ``{currentRevision}`` and writes nothing; a type version that would remove values answers 428
  ``{detail, affected}`` until it is sent again with ``confirm``; an unreadable file 423; a version
  the save refuses 422.
- What is there now is kept as a version first (forced, past the 5-minute gap), unless the newest
  version already holds exactly it (so a resend after a 428 keeps no second copy).
- The definition keeps its id (and a type its folder, ``basic`` and former names, as any save does);
  a collection keeps the former names it has now.
- The change events go out with no origin, so this window reloads the definition (and any object
  the save rewrote) like every other window.
- Views have versions too, but no restore here (there is no page for one view's definition).
"""

from __future__ import annotations

import json
import re
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .apictx import ApiContext
from .collections import CollectionDef
from .history import HistoryStore, VersionNotFound
from .propvalues import InvalidValue
from .queries import QueryDef
from .space import ConfirmRequired, ReadOnly
from .textfile import decode
from .typemodel import (
    RevisionConflict,
    TypeDefinition,
    TypeReadOnly,
    option_shape_problems,
    synced_problems,
    type_revision,
)
from .typesuggest import pattern_problems
from .watcher import ChangeEvent

__all__ = ["router"]

_PATH_RE = re.compile(r"^\.object/(types|collections|queries)/([A-Za-z0-9_][A-Za-z0-9_.-]{0,120})\.json$")
_WHAT = {"types": "object type", "collections": "collection", "queries": "query"}


class DefinitionRestoreRequest(BaseModel):
    path: str
    id: str
    baseRevision: str
    confirm: bool = False


def _error(status: int, detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail}, status_code=status)


def _type_problem(data: dict[str, Any]) -> str | None:
    """The first problem `PUT /api/types/{id}` would answer 422 with, or None."""
    for field in ("name", "pluralName"):
        if not isinstance(data.get(field), str) or not data[field].strip():
            return "An object type needs a name and a plural name."
    props = data.get("propertyDefinitions")
    if props is not None and not isinstance(props, list):
        return 'The field "propertyDefinitions" must be a list.'
    problems: list[str] = list(pattern_problems(data.get("namePatterns")))
    for entry in props or []:
        if isinstance(entry, dict) and "options" in entry:
            bad = option_shape_problems(entry["options"])
            if bad:
                name = entry.get("name") or entry.get("key") or "a property"
                problems.append(f"The options of {name} are not valid: {', '.join(bad)}.")
        problems += synced_problems(entry)
    return problems[0] if problems else None


def router(ctx: ApiContext) -> APIRouter:
    """The definition restore route, mounted on the app's `/api` router."""
    space = ctx.space
    store = HistoryStore(space.root)
    r = APIRouter()

    def revision(kind: str, def_id: str) -> str:
        if kind == "types":
            return type_revision(space.root, def_id)
        if kind == "collections":
            return space.collection_revision(def_id)
        return space.query_revision(def_id)

    def keep_current(rel: str, current: bytes) -> None:
        """Keep ``current`` as a version unless the newest one holds exactly it."""
        listed = store.versions(rel)
        if listed:
            try:
                if store.content(rel, listed[0]["id"]).get("text") == decode(current).text:
                    return
            except VersionNotFound:
                pass
        store.snapshot(rel, current, space.clock(), force=True)

    @r.post("/history/definition/restore")
    def post_definition_restore(req: DefinitionRestoreRequest):
        rel = req.path.replace("\\", "/")
        m = _PATH_RE.match(rel)
        if m is None or ".." in rel:
            return _error(400, f'"{req.path}" is not a type, collection or query file.')
        kind, def_id = m.group(1), m.group(2)
        missing = _error(404, f'There is no {_WHAT[kind]} "{def_id}".')
        full = space.root / rel
        if not full.is_file():
            return missing
        try:
            text = store.content(rel, req.id).get("text")
        except VersionNotFound:
            return _error(404, f'There is no version "{req.id}" of "{req.path}".')
        try:
            old = json.loads(text or "")
        except ValueError:
            old = None
        if not isinstance(old, dict):
            return _error(422, "This version can't be read as a definition.")

        with space._lock:
            current_rev = revision(kind, def_id)
            if current_rev != req.baseRevision:
                return JSONResponse({"currentRevision": current_rev}, status_code=409)
            try:
                current = full.read_bytes()
            except FileNotFoundError:
                return missing
            keep_current(rel, current)

        rewritten: list[str] = []
        skipped: list[dict[str, str]] = []
        try:
            if kind == "types":
                data = {**old, "id": def_id}
                data.setdefault("schemaVersion", 2)
                problem = _type_problem(data)
                if problem:
                    return _error(422, problem)
                t = TypeDefinition.from_json(data, fallback_id=def_id)
                result = space.save_type(t, req.baseRevision, confirm=req.confirm)
                new_rev = result.revision
                rewritten = list(result.rewritten)
                skipped = [{"path": s.path, "reason": s.reason} for s in result.skipped]
            elif kind == "collections":
                live = space.collections.get(def_id)
                if live is None:
                    return missing
                c = CollectionDef.from_json(old, fallback_id=def_id)
                c.id = def_id
                c.formerNames = list(dict.fromkeys([*live.formerNames, *c.formerNames]))
                cres = space.save_collection(c, req.baseRevision)
                new_rev = cres.revision
                rewritten = list(cres.rewritten)
                skipped = list(cres.skipped)
            else:
                q = QueryDef.from_json(old, fallback_id=def_id)
                q.id = def_id
                _q, new_rev = space.save_query(q, req.baseRevision)
        except RevisionConflict as exc:
            return JSONResponse({"currentRevision": exc.current_revision}, status_code=409)
        except ConfirmRequired as exc:
            return JSONResponse({"detail": exc.detail, "affected": exc.affected}, status_code=428)
        except (TypeReadOnly, ReadOnly) as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except (KeyError, ValueError):
            return missing

        ctx.announce(ChangeEvent(kind, def_id, None if kind == "types" else new_rev))
        for path in rewritten:
            ctx.announce(ChangeEvent("changed", path, space.cached_version(path)))
        return {"revision": new_rev, "rewritten": rewritten, "skipped": skipped}

    return r
