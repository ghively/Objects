"""``POST /api/v1/synced/{typeId}`` (M29): a script or agent fills synced facts.

The route takes a ``read-write`` or ``sync`` token (`V1Guard.auth_sync`) and runs
`Space.sync_facts`: each item is matched to one object of the type by title, alias or a key
property, and its values are written to ``.object/synced/<typeId>.json``, never to a ``.md``
(plan ``2026-11-09-m29-synced-facts-and-type-suggestion.md``, Contract, Routes).

- Body ``{"items": [{"match": {"by": "title"|"alias"|"key", "value": str, "key"?: str},
  "values": {key: value}}]}``. ``typeId`` is a type id or name.
- ``200 {type, refreshedAt, revision, updated, results}``: one result per item, in order
  (``updated``, ``notFound``, ``ambiguous``, ``invalid``); an item that fails never stops the
  others, so each item is checked by `Space.sync_facts`, not by the body's model.
- ``401``/``403``/``429`` from the guard; ``404`` no such type; ``422`` a type with no synced
  properties, more than 1000 items, or a body that isn't ``{"items": [...]}``; ``423
  {reason}`` when the store file isn't readable (it is never rewritten); ``409`` when the store
  file kept changing outside the app while the call wrote it. Every refusal's ``detail`` is a
  string (the MCP tool ``sync_facts`` passes on ``"<status>: <detail>"``).
- When anything was updated, announces ``ChangeEvent("synced", typeId, revision)`` and
  ``changed`` for each object that got its ``id`` on this call (``origin: "api:<token
  name>"``), and adds one activity entry per call (action ``sync``, ``count`` = updated).
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError

from .apictx import ApiContext
from .propvalues import InvalidValue
from .space import ReadOnly
from .synced import FOLDER
from .tokens import TokenStore
from .typemodel import RevisionConflict
from .v1guard import V1Guard, error, guarded

__all__ = ["BAD_BODY", "STORE_CHANGED", "SyncRequest", "router"]

BAD_BODY = 'The body must be {"items": [{"match": {...}, "values": {...}}, ...]}.'  # our string
STORE_CHANGED = "The synced facts file changed outside Object while it was written. Try again."  # our string


class SyncRequest(BaseModel):
    """The body: each item is ``{"match": {"by", "value", "key"?}, "values": {...}}``, checked
    item by item by `Space.sync_facts` (a bad item is ``invalid``, never a failed call)."""

    items: list[Any]


def router(ctx: ApiContext) -> APIRouter:
    """The synced-facts v1 route, mounted on the app's ``/api`` router (so no prefix here)."""
    space = ctx.space
    guard = V1Guard(ctx, TokenStore(space.root))
    api = APIRouter()

    def safe(value: Any) -> Any:
        from .server import _display_safe  # lazy: server.py imports this module

        return _display_safe(value)

    @guarded
    def sync(type_id: str, raw: bytes, request: Request):
        token = guard.auth_sync(request)
        try:
            req = SyncRequest.model_validate(json.loads(raw or b"null"))
        except (ValueError, ValidationError):  # bad JSON (a ValueError too) or the wrong shape
            return error(422, BAD_BODY)
        tid = space._type_id(type_id)
        with space._lock:
            id_less = {rel for rel, s in space._summaries.items() if s.type == tid and not s.id}
        outcome = None
        for attempt in range(2):
            try:
                outcome = space.sync_facts(type_id, req.items, guard.hidden_paths())
                break
            except RevisionConflict:
                continue  # edited outside the app mid-call: the store is read afresh once more
            except KeyError:
                return error(404, f'There is no object type "{type_id}".')
            except InvalidValue as exc:
                return error(422, str(exc))
            except ReadOnly as exc:
                return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        if outcome is None:
            return error(409, STORE_CHANGED)
        id_writes = dict(outcome.idWrites)
        if attempt:
            # A failed first attempt may have given objects their id: announce those too.
            for rel in sorted(id_less - set(id_writes)):
                with space._lock:
                    s = space._summaries.get(rel)
                if s is not None and s.id:
                    id_writes[rel] = space.cached_version(rel)
        updated = sum(1 for r in outcome.results if r.status == "updated")
        for path, version in id_writes.items():
            guard.announce("changed", path, version, token)
        if updated:
            guard.announce("synced", outcome.typeId, outcome.revision, token)
        guard.log(token, "sync", f".object/{FOLDER}/{outcome.typeId}.json", count=updated)
        return safe(
            {
                "type": outcome.typeId,
                "refreshedAt": outcome.refreshedAt,
                "revision": outcome.revision,
                "updated": updated,
                "results": [r.to_api() for r in outcome.results],
            }
        )

    @api.post("/v1/synced/{type_id}")
    async def sync_route(type_id: str, request: Request):
        raw = await request.body()
        return await run_in_threadpool(sync, type_id, raw, request)

    return api
