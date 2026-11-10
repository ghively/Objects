"""The ``/api/v1`` routes behind the expanded ``objectapp-mcp`` (M17; the plan's "Expanded
objectapp-mcp" table).

Each route checks the token and visibility with `v1guard.V1Guard`, then runs the app's own
route for the same action (looked up on the running app by method and path, and called with
``clientId = "api:<token name>"``), so its version and revision checks (409), the Trash,
version history and change events hold exactly as in the app, and a write is announced
``api:<token name>``. Each write is added to the activity log. Version history uses a
`HistoryStore` built as `api_history` builds it. The import routes call the import router's
own endpoints and read its ``jobs``.

"Exclude from AI" keeps its promise here too: an excluded object or a template named by a path
answers 404; result lists leave them out and add ``hiddenCount`` where a count matters (428
answers count only visible objects); a trash entry of such an object is neither listed nor
restorable; an import source inside or holding a registered space folder, or a folder the run
fence closes (``<state>/agents``, every local agent folder, the agent trash), is refused (422); an
automation whose actions remove the "Exclude from AI" tag or set or clear ``tags`` or
``excludeFromAI`` is refused (422), so a rule can't lift the exclusion later.

Routes (all JSON; ``read`` scope for the GETs and the import preview, ``read-write`` for the rest):

- ``GET  /v1/types`` -> ``{types}``, every TypeDef with ``revision`` and ``readOnlyReason`` (what the
  window's ``GET /api/space`` lists); ``GET /v1/types/{id}`` -> one TypeDef (id or name)
- ``GET  /v1/collections/{id}`` -> the collection with ``revision`` (id or name)
- ``GET  /v1/queries`` -> ``{queries}``, every saved query with ``revision`` (the window's
  ``GET /api/queries``); ``GET /v1/queries/{id}`` -> one saved query (id or name)
- ``GET  /v1/whiteboard?path=`` -> ``{path, board, revision}``
- ``GET  /v1/history?path=`` -> ``{versions}``; ``GET /v1/history/version?path=&id=`` -> a version
- ``GET  /v1/references?path=`` -> ``{mentions}`` (unlinked mentions in visible objects)
- ``GET  /v1/trash`` -> ``{items}``; ``GET /v1/automations`` -> ``{automations}``
- ``POST /v1/import/preview`` ``{path, kind?, leaveOut?, keepAsSources?}`` -> the preview (writes nothing;
  M30: ``keepAsSources`` absent is on, as the start);
  ``GET /v1/import/jobs/{id}`` -> the job
- ``POST /v1/object/body`` ``{path, version, body}`` -> ``{version}``
- ``POST /v1/daily-notes`` ``{date}`` -> ``{path, version, created}``
- ``POST /v1/object/duplicate`` ``{path}`` -> 201 ``{path, version}``
- ``POST /v1/object/change-type`` ``{path, version, type, mapping?}`` -> ``{path, version, ...}``
- ``POST /v1/object/merge`` ``{source, target, sourceVersion, targetVersion}`` -> the merge result
- ``POST /v1/references/link`` ``{path, version, target, start, end, text}`` -> ``{version}``
- ``POST /v1/tags/ensure`` ``{name}`` -> ``{path, created}``
- ``POST /v1/types`` ``{name, pluralName, icon?, color?}`` -> 201 TypeDef;
  ``PUT /v1/types/{id}`` ``{revision, type, confirm?}``;
  ``POST /v1/types/{id}/properties/{pid}/change-kind`` ``{toKind, revision}``;
  ``DELETE /v1/types/{id}?confirm=`` (428 ``{detail, affected, hiddenCount}`` without confirm)
- ``POST /v1/collections`` ``{name, typeIds?}``; ``PUT /v1/collections/{id}`` ``{revision, collection}``;
  ``DELETE /v1/collections/{id}?confirm=`` (409 when any member is excluded from AI, decision S5)
- ``POST /v1/queries`` ``{name, definition?}``; ``PUT /v1/queries/{id}`` ``{revision, query}``;
  ``DELETE /v1/queries/{id}``
- ``POST /v1/whiteboards`` ``{title?}``; ``PUT /v1/whiteboard`` ``{path, revision, board}``
- ``POST /v1/automations`` ``{rule}`` -> 201; ``POST /v1/automations/{id}/run`` ``{path}``
- ``POST /v1/import/start`` ``{previewId, target, mapping?, batch?, scan?, keepAsSources?}`` -> 202
  ``{jobId, targetPath}`` (M27: ``422`` when the mapping makes a type no approved proposal makes; M30:
  ``keepAsSources`` absent is on)
- M27: ``POST /v1/import/scan`` ``{path, leaveOut?, batch?}`` -> ``{batch, scan}`` (the scan names kinds and
  lines, never values; with a ``read-write`` token it is kept in a draft batch);
  ``GET /v1/import/proposal?batch=`` -> ``{proposal, decisions, applied}``;
  ``POST /v1/import/proposal`` ``{batch, proposal, revision?}``; ``POST /v1/import/decisions``
  ``{batch, decisions}``; ``GET /v1/import/report?batch=`` -> ``{report, batch, filing}``
- M30: ``GET /v1/import/entities?batch=`` -> ``EntitiesView`` (``409`` when the batch didn't keep its
  pages as Sources); accepting and writing entities stay in the app
- ``POST /v1/trash/{id}/restore``; ``POST /v1/history/restore`` ``{path, versionId, version}``

M22: on a work item, ``/v1/object/duplicate`` and ``/v1/history/restore`` answer ``422`` ("Steps
change with the step actions.") when the copy or the restored version would hold an approved or
done Approve step the file doesn't have now (the app's own routes are unchanged).

Never offered: permanent delete and emptying the trash, the app's preferences, tokens, spaces, UI state,
attachments, export, reminders, templates.
"""

from __future__ import annotations

import functools
import inspect
import json
import os
import threading
import typing
from collections import OrderedDict
from pathlib import Path
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ValidationError
from pydantic.fields import FieldInfo

from .apictx import ApiContext
from .keycompat import VALUE_KEYS, upgrade_keys
from .tokens import TokenRecord, TokenStore
from .v1guard import V1Guard, error, guarded

if TYPE_CHECKING:
    from .automations import AutomationEngine

__all__ = ["SPACE_FOLDER_IMPORT", "router"]

SPACE_FOLDER_IMPORT = "Importing from a space folder isn't available to agents."
AGENT_FOLDER_IMPORT = "Importing from an agent folder isn't available to agents."  # our string
EXCLUSION_RULE = "An automation made by an agent can't remove “Exclude from AI” or change tags."  # our string
AGENT_SCHEDULE_RULE = "Agent schedules are made with schedule_manage."  # our string (M21)
OBJECT_CONFLICT = "The object changed since that version. Read it again and retry."
DEFINITION_CONFLICT = "The definition changed since that revision. Read it again and retry."  # our string
COLLECTION_HOLDS_EXCLUDED = "This collection holds pages excluded from AI; delete it in Object."  # decision S5
MAX_BODY = 2_000_000
MAX_PREVIEWS = 20
"""Preview ids whose mapping `start_import` may reuse (oldest dropped first)."""


# -- request bodies ---------------------------------------------------------------------


class BodyRequest(BaseModel):
    path: str
    version: str
    body: str


class DailyNoteRequest(BaseModel):
    date: str


class PathRequest(BaseModel):
    path: str


class ChangeTypeRequest(BaseModel):
    path: str
    version: str
    type: str
    mapping: dict[str, str | None] | None = None


class MergeRequest(BaseModel):
    source: str
    target: str
    sourceVersion: str
    targetVersion: str


class LinkRequest(BaseModel):
    path: str
    version: str
    target: str
    start: int
    end: int
    text: str


class NameRequest(BaseModel):
    name: str = ""


class CreateTypeRequest(BaseModel):
    name: str
    pluralName: str
    icon: Any = None
    color: str | None = None


class EditTypeRequest(BaseModel):
    revision: str = ""
    type: dict[str, Any]
    confirm: bool = False


class ChangeKindRequest(BaseModel):
    toKind: str
    revision: str = ""


class CreateCollectionRequest(BaseModel):
    name: str
    typeIds: list[str] | None = None


class EditCollectionRequest(BaseModel):
    revision: str = ""
    collection: dict[str, Any]


class CreateQueryRequest(BaseModel):
    name: str
    definition: dict[str, Any] | None = None


class EditQueryRequest(BaseModel):
    revision: str = ""
    query: dict[str, Any]


class CreateWhiteboardRequest(BaseModel):
    title: str | None = None


class EditWhiteboardRequest(BaseModel):
    path: str
    revision: str = ""
    board: Any


class RuleRequest(BaseModel):
    rule: dict[str, Any]


class PreviewRequest(BaseModel):
    path: str
    kind: str = "auto"
    target: str = "newSpace"
    leaveOut: list[str] = []
    keepAsSources: bool | None = None  # M30: absent, on (as the start)


class StartRequest(BaseModel):
    previewId: str
    target: dict[str, Any] | str
    mapping: dict[str, Any] | None = None
    batch: str | None = None
    scan: dict[str, Any] | None = None
    keepAsSources: bool | None = None  # M30: absent, on (every page kept as a read-only Source)


class ScanRequest(BaseModel):
    path: str
    leaveOut: list[str] = []
    batch: str | None = None


class ProposalSaveRequest(BaseModel):
    batch: str
    proposal: dict[str, Any]
    revision: str | None = None


class DecisionsRequest(BaseModel):
    batch: str
    decisions: list[dict[str, Any]]


class RestoreVersionRequest(BaseModel):
    path: str
    versionId: str
    version: str


# -- calling the app's own routes -------------------------------------------------------


class _AppRoutes:
    """The running app's routes by (method, path); built on first use."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._by_app: dict[int, dict[tuple[str, str], Any]] = {}

    def find(self, request: Request, method: str, path: str) -> Any:
        app = request.app
        with self._lock:
            table = self._by_app.get(id(app))
            if table is None:
                table = {}
                for full, route in _walk(app.router.routes, ""):
                    for m in getattr(route, "methods", None) or ():
                        table.setdefault((m, full), route)
                self._by_app[id(app)] = table
        route = table.get((method, path))
        if route is None:  # a wiring mistake, never an agent's input
            raise RuntimeError(f"No app route {method} {path}")
        return route


def _walk(routes: list[Any], prefix: str):
    """(full path, route) for every endpoint route, into included routers: FastAPI 0.16x
    keeps an included router whole (its ``original_router`` and its include ``prefix``)
    instead of copying its routes into the parent."""
    for route in routes:
        inner = getattr(route, "original_router", None)
        if inner is not None:
            context = getattr(route, "include_context", None)
            yield from _walk(inner.routes, prefix + str(getattr(context, "prefix", "") or ""))
        elif getattr(route, "endpoint", None) is not None and isinstance(getattr(route, "path", None), str):
            yield prefix + route.path, route


def _jsonable(value: Any) -> Any:
    return json.loads(json.dumps(value, default=str))


def _call(route: Any, body: dict[str, Any] | None = None, /, **params: Any) -> tuple[int, Any]:
    """Run an app route's endpoint with `params` (and `body` for its request model);
    return (status, JSON body)."""
    endpoint = route.endpoint
    try:
        hints = typing.get_type_hints(endpoint)
    except Exception:  # noqa: BLE001 - a hint that can't be resolved: no body model
        hints = {}
    kwargs: dict[str, Any] = {}
    upgrade_keys(body, skip=VALUE_KEYS)  # older key names, as `KeyCompatMiddleware` does for HTTP
    for name, param in inspect.signature(endpoint).parameters.items():
        hint = hints.get(name)
        if name in params:
            kwargs[name] = params[name]
        elif isinstance(hint, type) and issubclass(hint, BaseModel):
            try:
                kwargs[name] = hint.model_validate(body or {})
            except ValidationError as exc:
                msg = "; ".join(f"{'.'.join(str(x) for x in e['loc'])}: {e['msg']}" for e in exc.errors())
                return 422, {"detail": msg or "The request isn't valid."}
        elif param.default is not inspect.Parameter.empty:
            default = param.default
            kwargs[name] = default.default if isinstance(default, FieldInfo) else default
        else:
            kwargs[name] = None
    out = endpoint(**kwargs)
    if isinstance(out, Response):
        raw = bytes(out.body or b"")
        return out.status_code, (json.loads(raw) if raw else None)
    return route.status_code or 200, _jsonable(out)


def _failed(status: int, body: Any) -> JSONResponse:
    """An app route's error as the v1 answer: always a ``detail``, plus what the route said."""
    data = dict(body) if isinstance(body, dict) else {"detail": str(body)}
    if not data.get("detail"):
        if "currentVersion" in data:
            data["detail"] = OBJECT_CONFLICT
        elif "currentRevision" in data:
            data["detail"] = DEFINITION_CONFLICT
        elif data.get("reason"):
            data["detail"] = data["reason"]
        else:
            data["detail"] = f"The app answered {status}."
    return JSONResponse(data, status_code=status)


def _approvals(fm: dict[str, Any]) -> set[tuple[Any, ...]]:
    """The Approve steps in ``fm`` that Gene has let through (approved or done), as comparable
    keys: a version restore or a copy must not bring back one the file doesn't have now."""
    from .workvalues import read_steps

    steps, _problems = read_steps(fm.get("steps"))
    return {
        (s.id, s.text, s.state, s.approvedAt, s.notBefore, s.doneAt)
        for s in steps
        if s.kind == "approve" and s.state in ("approved", "done")
    }


def _within(child: Path, parent: Path) -> bool:
    c, p = os.path.normcase(str(child)), os.path.normcase(str(parent))
    return c == p or c.startswith(p.rstrip("\\/") + os.sep)


def router(ctx: ApiContext, engine: AutomationEngine, imports: APIRouter) -> APIRouter:
    """The v1 tool routes, mounted on the app's ``/api`` router (so no prefix here)."""
    from .history import HistoryStore, VersionNotFound, _fm_of
    from .workfields import is_work_type
    from .workhook import STEPS_GATED
    from .references import unlinked_mentions
    from .whiteboardstore import is_whiteboard

    del engine  # the automation routes are called through the app (`api_automations`)
    space = ctx.space
    guard = V1Guard(ctx, TokenStore(space.root))
    auth = guard.auth
    routes = _AppRoutes()
    history = HistoryStore(space.root, is_whiteboard=lambda md: is_whiteboard(space, md))
    previews: OrderedDict[str, dict[str, Any]] = OrderedDict()
    previews_lock = threading.Lock()
    from .server import SafeJSONResponse  # lazy: server.py imports this module

    # A file name that is not UTF-8 holds surrogate escapes (audit 2026-11-07 #4).
    r = APIRouter(default_response_class=SafeJSONResponse)

    def is_work(rel: str) -> bool:
        try:
            return is_work_type(space.type_by_id(space.get(rel).type))
        except (KeyError, ValueError):
            return False

    def origin(token: TokenRecord) -> str:
        return f"api:{token.name}"

    seen = threading.local()

    def app(request: Request, method: str, route_path: str, body: dict[str, Any] | None = None, /, **params):
        # What was hidden before the call: a delete takes an excluded object out of the space,
        # and its path must still be left out of the answer's lists.
        seen.hidden = guard.hidden_paths()
        return _call(routes.find(request, method, route_path), body, **params)

    def hidden_now() -> set[str]:
        return guard.hidden_paths() | getattr(seen, "hidden", set())

    def visible(path: str) -> str:
        """`guard.visible_rel`; `Hide` (404/400) when the API may not name it."""
        try:
            return guard.visible_rel(path)
        except ValueError as exc:
            raise _Hide(400, str(exc)) from exc
        except KeyError as exc:
            raise _Hide(404, f'There is no object at "{path}".') from exc

    def resolve_type_id(name_or_id: str) -> str | None:
        t = space.type_by_id(name_or_id) or space.type_by_id(space._type_id(name_or_id))
        return t.id if t is not None else None

    def visible_list(key: str, data: dict[str, Any]) -> int:
        """Leave hidden paths out of ``data[key]``; return how many."""
        items = data.get(key)
        if not isinstance(items, list):
            return 0
        hidden = hidden_now()
        kept = [i for i in items if (i.get("path") if isinstance(i, dict) else str(i)) not in hidden]
        data[key] = kept
        return len(items) - len(kept)

    def answer(status: int, body: Any, *lists: str) -> Any:
        if status >= 400:
            return _failed(status, body)
        if isinstance(body, dict) and lists:
            hidden = sum(visible_list(k, body) for k in lists)
            body["hiddenCount"] = hidden
        return JSONResponse(body, status_code=status)

    def run(fn):
        """`guarded`, and `_Hide` as its answer."""

        @functools.wraps(fn)
        def hiding(*args, **kwargs):
            try:
                return fn(*args, **kwargs)
            except _Hide as exc:
                return error(exc.status, exc.detail)

        return guarded(hiding)

    # -- read --------------------------------------------------------------------------

    @r.get("/v1/types")
    @run
    def type_definitions(request: Request):
        # The list the window gets (`server.space_info`), so a script can keep a space's types
        # without closing Object (2026-11-09).
        auth(request)
        return SafeJSONResponse(_jsonable({"types": space.types_api()}))

    @r.get("/v1/types/{type_id}")
    @run
    def type_definition(type_id: str, request: Request):
        auth(request)
        tid = resolve_type_id(type_id)
        found = next(((t, rev) for t, rev in space.types_with_revisions() if t.id == tid), None)
        if found is None:
            return error(404, f'There is no object type "{type_id}".')
        t, rev = found
        return SafeJSONResponse(_jsonable(space.type_api(t, rev)))

    def find_collection(collection_id: str):
        for c, rev in space.collections_with_revisions():
            if c.id == collection_id or c.name.casefold() == collection_id.casefold():
                return c, rev
        return None

    @r.get("/v1/collections/{collection_id}")
    @run
    def collection(collection_id: str, request: Request):
        auth(request)
        found = find_collection(collection_id)
        if found is None:
            return error(404, f'There is no collection "{collection_id}".')
        c, rev = found
        return SafeJSONResponse(_jsonable(c.to_api(rev)))

    def find_query(query_id: str):
        for q in space.list_queries():
            if q.id == query_id or (q.name or "").casefold() == query_id.casefold():
                return q
        return None

    @r.get("/v1/queries")
    @run
    def saved_queries(request: Request):
        auth(request)
        status, body = app(request, "GET", "/api/queries")
        if status >= 400:
            return _failed(status, body)
        return {"queries": body}

    @r.get("/v1/queries/{query_id}")
    @run
    def saved_query(query_id: str, request: Request):
        auth(request)
        q = find_query(query_id)
        if q is None:
            return error(404, f'There is no query "{query_id}".')
        return SafeJSONResponse(_jsonable(q.to_api(space.query_revision(q.id))))

    @r.get("/v1/whiteboard")
    @run
    def read_whiteboard(request: Request, path: str):
        auth(request)
        rel = visible(path)
        return answer(*app(request, "GET", "/api/whiteboard", path=rel))

    @r.get("/v1/history")
    @run
    def version_history(request: Request, path: str):
        auth(request)
        rel = visible(path)
        return SafeJSONResponse(_jsonable({"versions": history.versions(rel)}))

    @r.get("/v1/history/version")
    @run
    def read_version(request: Request, path: str, id: str):
        auth(request)
        rel = visible(path)
        try:
            return SafeJSONResponse(_jsonable(history.content(rel, id)))
        except VersionNotFound:
            return error(404, f'There is no version "{id}" of "{path}".')
        except ValueError as exc:
            return error(400, str(exc))

    @r.get("/v1/references")
    @run
    def references(request: Request, path: str):
        auth(request)
        rel = visible(path)
        hidden = guard.hidden_paths()
        found = [m for m in unlinked_mentions(space, ctx.search, rel) if m.get("path") not in hidden]
        return SafeJSONResponse(_jsonable({"mentions": found}))

    @r.get("/v1/trash")
    @run
    def trash(request: Request):
        auth(request)
        items = [i.to_api() for i in space.list_trash() if not guard.trash_entry_hidden(i)]
        return SafeJSONResponse(_jsonable({"items": items}))

    @r.get("/v1/automations")
    @run
    def automations(request: Request):
        auth(request)
        status, body = app(request, "GET", "/api/automations")
        if status >= 400:
            return _failed(status, body)
        return {"automations": body}

    def refuse_space_source(path: str) -> JSONResponse | None:
        from .appstate import state_dir
        from .spaces import Registry, normalize

        try:
            source = normalize(path)
        except (ValueError, OSError):
            return None  # the import route answers for a path that can't be a source
        roots = [space.root]
        try:
            roots += [Path(e.path) for e in Registry(state_dir()).list(current=space.root)]
        except OSError:
            pass
        for root in roots:
            try:
                folder = normalize(root)
            except (ValueError, OSError):
                continue
            if _within(source, folder) or _within(folder, source):
                return error(422, SPACE_FOLDER_IMPORT)
        from .agentrun import closed_agent_folders

        try:
            closed = closed_agent_folders(state_dir())
        except (OSError, ValueError):
            closed = []
        for root in closed:  # the folders the run fence closes (spec section 3)
            try:
                folder = normalize(root)
            except (ValueError, OSError):
                continue
            if _within(source, folder) or _within(folder, source):
                return error(422, AGENT_FOLDER_IMPORT)
        return None

    @r.post("/v1/import/preview")
    @run
    def import_preview(req: PreviewRequest, request: Request):
        auth(request)
        refused = refuse_space_source(req.path)
        if refused is not None:
            return refused
        target = req.target if req.target in ("newSpace", "currentSpace") else "newSpace"
        status, body = _call(
            next(rt for rt in imports.routes if getattr(rt, "path", "") == "/import/preview"),
            {"source": {"path": req.path, "kind": req.kind}, "target": target, "leaveOut": req.leaveOut,
             "keepAsSources": req.keepAsSources},
        )
        if status >= 400:
            return _failed(status, body)
        with previews_lock:
            previews[body["previewId"]] = body.get("mapping") or {}
            while len(previews) > MAX_PREVIEWS:
                previews.popitem(last=False)
        return JSONResponse(body)

    @r.post("/v1/import/scan")
    @run
    def import_scan(req: ScanRequest, request: Request):
        from .api_importscan import NO_SOURCE, scan_root
        from .importers import batches
        from .importscan import scan_tree

        token = auth(request)
        # Absolute and present, never the working or home folder (audit 2026-11-07 #12,
        # sweep 2026-11-08): the same rule as the app's scan routes.
        root = scan_root(req.path)
        if root is None:
            return error(404, NO_SOURCE)
        refused = refuse_space_source(str(root))
        if refused is not None:
            return refused
        scan = scan_tree(root, req.leaveOut).to_json()
        batch = None
        if token.scope == "read-write":
            batch = req.batch
            if batch is None:
                batch = batches.create_draft(space.root, str(root), req.leaveOut)
            try:
                bdata, _items = batches.load_batch(space.root, batch)
            except KeyError:
                return error(404, "No such import batch.")
            if bdata.get("state") != "draft":
                return error(409, "That batch has already been imported; its scan can't be replaced.")
            batches.store_scan(space.root, batch, scan)
        return JSONResponse({"batch": batch, "scan": scan})

    @r.get("/v1/import/proposal")
    @run
    def import_proposal(batch: str, request: Request):
        from .importers import batches, proposal

        auth(request)
        try:
            batches.load_batch(space.root, batch)
        except KeyError:
            return error(404, "No such import batch.")
        stored = proposal.load_proposal(space.root, batch)
        review = proposal.load_review(space.root, batch)
        return JSONResponse({"proposal": stored, "decisions": review.get("items", {}), "applied": review.get("applied")})

    @r.post("/v1/import/proposal")
    @run
    def save_import_proposal(req: ProposalSaveRequest, request: Request):
        from .importers import proposal

        token = auth(request, write=True)
        try:
            stored = proposal.save_proposal(space, req.batch, req.proposal, req.revision, origin=origin(token))
        except KeyError:
            return error(404, "No such import batch.")
        except proposal.ProposalConflict as exc:
            return JSONResponse({"detail": str(exc), "currentRevision": exc.current}, status_code=409)
        except proposal.ProposalInvalid as exc:
            return error(422, str(exc))
        guard.log(token, "import-proposal", req.batch)
        problems = [{"id": i["id"], "problems": i["problems"], "dropped": i["dropped"]}
                    for i in stored["items"] if i["problems"] or i["dropped"]]
        return JSONResponse({"revision": stored["revision"], "items": len(stored["items"]), "checks": problems})

    @r.post("/v1/import/decisions")
    @run
    def save_import_decisions(req: DecisionsRequest, request: Request):
        from .importers import batches, filing

        token = auth(request, write=True)
        try:
            batches.load_batch(space.root, req.batch)
        except KeyError:
            return error(404, "No such import batch.")
        try:
            out = imports.filing.apply_external(req.batch, req.decisions)  # type: ignore[attr-defined]
        except (filing.Busy, filing.NotAllowed) as exc:
            return error(409, str(exc))
        guard.log(token, "import-decisions", req.batch)
        return JSONResponse(out)

    @r.get("/v1/import/report")
    @run
    def import_report(batch: str, request: Request):
        from .importers import batches

        auth(request)
        try:
            data, _items = batches.load_batch(space.root, batch)
        except KeyError:
            return error(404, "No such import batch.")
        try:
            text = (batches.batch_dir(space.root, batch) / "report.md").read_text(encoding="utf-8")
        except OSError:
            text = ""
        filing_state = imports.filing.status(batch)  # type: ignore[attr-defined]
        return JSONResponse({"report": text, "batch": data, "filing": {
            "state": filing_state["state"], "rightShare": filing_state["trial"]["rightShare"]}})

    @r.get("/v1/import/entities")
    @run
    def import_entities(batch: str, request: Request):
        from .importers import filing

        auth(request)
        try:
            view = imports.filing.entities_view(batch)  # type: ignore[attr-defined]
        except KeyError:
            return error(404, "No such import batch.")
        except filing.NotAllowed as exc:
            return error(409, str(exc))
        return SafeJSONResponse(_jsonable(view))

    @r.get("/v1/import/jobs/{job_id}")
    @run
    def import_status(job_id: str, request: Request):
        auth(request)
        job = imports.jobs.get(job_id)  # type: ignore[attr-defined]
        if job is None:
            return error(404, "No such import.")
        return SafeJSONResponse(_jsonable(job.model_dump()))

    # -- write -------------------------------------------------------------------------

    @r.post("/v1/object/body")
    @run
    def write_body(req: BodyRequest, request: Request):
        token = auth(request, write=True)
        if len(req.body) > MAX_BODY:
            return error(422, "The body is too long.")
        rel = visible(req.path)
        status, body = app(
            request, "PUT", "/api/object/body",
            {"path": rel, "body": req.body, "baseVersion": req.version, "clientId": origin(token)},
        )
        if status < 400 and body.get("version") != req.version:
            guard.log(token, "body", rel)
        return answer(status, body)

    @r.post("/v1/daily-notes")
    @run
    def open_daily_note(req: DailyNoteRequest, request: Request):
        token = auth(request, write=True)
        status, body = app(request, "POST", "/api/daily-notes", {"date": req.date, "clientId": origin(token)})
        if status == 409 and isinstance(body, dict) and body.get("reason") == "exists":
            rel = visible(str(body.get("path")))
            return {"path": rel, "version": space.cached_version(rel), "created": False}
        if status >= 400:
            return _failed(status, body)
        guard.log(token, "daily-note", body["path"])
        return {"path": body["path"], "version": body["version"], "created": True}

    @r.post("/v1/object/duplicate", status_code=201)
    @run
    def duplicate(req: PathRequest, request: Request):
        token = auth(request, write=True)
        rel = visible(req.path)
        # M22: a copy of a work item would hold Gene's approvals for the agent to use again.
        if is_work(rel) and _approvals(space.read(rel)[1]):
            return error(422, STEPS_GATED)
        status, body = app(request, "POST", "/api/object/duplicate", {"path": rel, "clientId": origin(token)})
        if status >= 400:
            return _failed(status, body)
        guard.log(token, "duplicate", body["path"], source=rel)
        return JSONResponse({"path": body["path"], "version": body["version"]}, status_code=201)

    @r.post("/v1/object/change-type")
    @run
    def change_type(req: ChangeTypeRequest, request: Request):
        token = auth(request, write=True)
        rel = visible(req.path)
        tid = resolve_type_id(req.type)
        if tid is None:
            return error(404, f'There is no object type "{req.type}".')
        mapping = req.mapping
        if mapping is None:
            status, body = app(request, "GET", "/api/object/change-type", path=rel, typeId=tid)
            if status >= 400:
                return _failed(status, body)
            mapping = {row["fromKey"]: row["toKey"] for row in body.get("rows", [])}
        status, body = app(
            request, "POST", "/api/object/change-type",
            {"path": rel, "typeId": tid, "mapping": mapping, "baseVersion": req.version,
             "clientId": origin(token)},
        )
        if status < 400:
            guard.log(token, "change-type", body["path"], oldPath=rel, typeId=tid)
        return answer(status, body, "relinked")

    @r.post("/v1/object/merge")
    @run
    def merge(req: MergeRequest, request: Request):
        token = auth(request, write=True)
        source, target = visible(req.source), visible(req.target)
        status, body = app(
            request, "POST", "/api/object/merge",
            {"source": source, "target": target, "sourceVersion": req.sourceVersion,
             "targetVersion": req.targetVersion, "confirm": True, "clientId": origin(token)},
        )
        if status < 400:
            guard.log(token, "merge", target, source=source)
        return answer(status, body, "relinked")

    @r.post("/v1/references/link")
    @run
    def link_mention(req: LinkRequest, request: Request):
        token = auth(request, write=True)
        rel, target = visible(req.path), visible(req.target)
        status, body = app(
            request, "POST", "/api/references/link",
            {"path": rel, "target": target, "start": req.start, "end": req.end, "text": req.text,
             "baseVersion": req.version, "clientId": origin(token)},
        )
        if status < 400 and body.get("version") != req.version:
            guard.log(token, "link-mention", rel, target=target)
        return answer(status, body)

    @r.post("/v1/tags/ensure")
    @run
    def create_tag(req: NameRequest, request: Request):
        token = auth(request, write=True)
        status, body = app(request, "POST", "/api/tags/ensure", {"name": req.name, "clientId": origin(token)})
        if status >= 400:
            return _failed(status, body)
        visible(body["path"])
        if body.get("created"):
            guard.log(token, "create-tag", body["path"])
        return body

    # types

    @r.post("/v1/types", status_code=201)
    @run
    def create_type(req: CreateTypeRequest, request: Request):
        token = auth(request, write=True)
        status, body = app(
            request, "POST", "/api/types",
            {"name": req.name, "pluralName": req.pluralName, "icon": req.icon, "color": req.color,
             "clientId": origin(token)},
        )
        if status < 400:
            guard.log(token, "create-type", body.get("id", ""))
        return answer(status, body)

    @r.put("/v1/types/{type_id}")
    @run
    def edit_type(type_id: str, req: EditTypeRequest, request: Request):
        token = auth(request, write=True)
        tid = resolve_type_id(type_id)
        if tid is None:
            return error(404, f'There is no object type "{type_id}".')
        status, body = app(
            request, "PUT", "/api/types/{type_id}",
            {"type": req.type, "baseRevision": req.revision, "confirm": req.confirm,
             "clientId": origin(token)},
            type_id=tid,
        )
        if status == 428:
            shown, hidden = guard.visible_only(type_edit_removes(tid, req.type))
            n = len(shown)
            return error(
                428,
                f"This change removes values from {n} object{'s' if n != 1 else ''}.",
                affected=n, hiddenCount=hidden,
            )
        if status < 400:
            guard.log(token, "edit-type", tid)
        return answer(status, body, "rewritten", "skipped")

    def type_edit_removes(tid: str, edited: dict[str, Any]) -> list[str]:
        """The objects (templates included) a type edit would remove values from.

        Plans the edit as `Space.save_type` does (nothing is written: the app's route has just
        refused it for want of ``confirm``), so the 428 can count only what the API may show.
        """
        from .typemodel import TypeDefinition, topup_task_type
        from .workfields import topup_work_fields

        data = {**edited, "id": tid}
        data.setdefault("schemaVersion", 2)
        try:
            new = TypeDefinition.from_json(data, fallback_id=tid)
        except (TypeError, ValueError, KeyError):
            return []
        with space._lock:
            mem = space.type_by_id(tid)
            if mem is None:
                return []
            stored = space._stored_type(tid)
            old = (  # as `Space.save_type` plans it (M22: the work fields too)
                topup_work_fields(topup_task_type(stored), space.types)
                if stored is not None
                else mem
            )
            new.id, new.folder, new.basic = old.id, old.folder, old.basic
            new.formerNames = list(old.formerNames)
            new.name = " ".join(str(new.name or "").split())
            new.pluralName = " ".join(str(new.pluralName or "").split())
            try:
                ops, _ = space._plan_type_ops(old, new)
            except ValueError:
                return []
            confirming = [op for op in ops if op.confirm]
            return [
                rel
                for rel in space._type_members(old.id)
                if rel in space._raw
                and any(op.applies(space._raw[rel].fm, rel) for op in confirming)
            ]

    @r.post("/v1/types/{type_id}/properties/{pid}/change-kind")
    @run
    def change_property_kind(type_id: str, pid: str, req: ChangeKindRequest, request: Request):
        token = auth(request, write=True)
        tid = resolve_type_id(type_id)
        if tid is None:
            return error(404, f'There is no object type "{type_id}".')
        status, body = app(
            request, "POST", "/api/types/{type_id}/properties/{pid}/change-kind",
            {"toType": req.toKind, "baseRevision": req.revision, "clientId": origin(token)},
            type_id=tid, pid=pid,
        )
        if status < 400:
            guard.log(token, "change-property-kind", tid, propertyId=pid)
        return answer(status, body, "rewritten", "skipped")

    def type_members(tid: str) -> list[str]:
        with space._lock:
            return sorted(
                rel for rel, s in space._summaries.items() if s.type == tid and s.template is None
            )

    @r.delete("/v1/types/{type_id}")
    @run
    def delete_type(type_id: str, request: Request, confirm: bool = Query(default=False)):  # noqa: B008
        token = auth(request, write=True)
        tid = resolve_type_id(type_id)
        if tid is None:
            return error(404, f'There is no object type "{type_id}".')
        status, body = app(
            request, "DELETE", "/api/types/{type_id}",
            type_id=tid, confirm=bool(confirm), clientId=origin(token),
        )
        if status == 428:
            shown, hidden = guard.visible_only(type_members(tid))
            t = space.type_by_id(tid)
            name = t.name if t is not None else tid
            n = len(shown)
            return error(
                428,
                f"Delete the object type {name}? Its {n} object{'s' if n != 1 else ''} "
                "and templates move to the Trash.",
                affected=n, hiddenCount=hidden,
            )
        if status < 400:
            guard.log(token, "delete-type", tid, trashId=body.get("trashId"))
        return answer(status, body, "paths")

    # collections

    @r.post("/v1/collections", status_code=201)
    @run
    def create_collection(req: CreateCollectionRequest, request: Request):
        token = auth(request, write=True)
        type_ids = [t for t in (resolve_type_id(x) for x in req.typeIds or []) if t]
        status, body = app(
            request, "POST", "/api/collections",
            {"name": req.name, "typeIds": type_ids, "clientId": origin(token)},
        )
        if status < 400:
            guard.log(token, "create-collection", body.get("id", ""))
        return answer(status, body)

    @r.put("/v1/collections/{collection_id}")
    @run
    def edit_collection(collection_id: str, req: EditCollectionRequest, request: Request):
        token = auth(request, write=True)
        found = find_collection(collection_id)
        if found is None:
            return error(404, f'There is no collection "{collection_id}".')
        cid = found[0].id
        status, body = app(
            request, "PUT", "/api/collections/{collection_id}",
            {"collection": req.collection, "baseRevision": req.revision, "clientId": origin(token)},
            collection_id=cid,
        )
        if status < 400:
            guard.log(token, "edit-collection", cid)
        return answer(status, body, "rewritten", "skipped")

    def collection_members(cid: str) -> list[str]:
        return [x.summary.path for x in space.rows(None, [cid], None, None, False)]

    @r.delete("/v1/collections/{collection_id}")
    @run
    def delete_collection(collection_id: str, request: Request, confirm: bool = Query(default=False)):  # noqa: B008
        token = auth(request, write=True)
        found = find_collection(collection_id)
        if found is None:
            return error(404, f'There is no collection "{collection_id}".')
        cid = found[0].id
        members = collection_members(cid)
        hidden_set = hidden_now()
        shown = [m for m in members if m not in hidden_set]
        if len(shown) < len(members):
            # Decision S5: deleting it would trash or edit "Exclude from AI" pages; only the app may.
            return error(409, COLLECTION_HOLDS_EXCLUDED)
        status, body = app(
            request, "DELETE", "/api/collections/{collection_id}",
            collection_id=cid, confirm=bool(confirm), clientId=origin(token),
        )
        if status == 428:
            data = dict(body) if isinstance(body, dict) else {}
            return error(428, data.get("detail") or "This change needs to be confirmed",
                         affected=len(shown), hiddenCount=0)
        if status < 400:
            guard.log(token, "delete-collection", cid, trashId=body.get("trashId"))
        return answer(status, body, "removedFrom", "deleted", "skipped")

    # saved queries

    @r.post("/v1/queries", status_code=201)
    @run
    def create_query(req: CreateQueryRequest, request: Request):
        token = auth(request, write=True)
        status, body = app(
            request, "POST", "/api/queries",
            {"name": req.name, "definition": req.definition, "clientId": origin(token)},
        )
        if status < 400:
            guard.log(token, "create-query", body.get("id", ""))
        return answer(status, body)

    @r.put("/v1/queries/{query_id}")
    @run
    def edit_query(query_id: str, req: EditQueryRequest, request: Request):
        token = auth(request, write=True)
        q = find_query(query_id)
        if q is None:
            return error(404, f'There is no query "{query_id}".')
        status, body = app(
            request, "PUT", "/api/queries/{query_id}",
            {"query": req.query, "baseRevision": req.revision, "clientId": origin(token)},
            query_id=q.id,
        )
        if status < 400:
            guard.log(token, "edit-query", q.id)
        return answer(status, body)

    @r.delete("/v1/queries/{query_id}")
    @run
    def delete_query(query_id: str, request: Request):
        token = auth(request, write=True)
        q = find_query(query_id)
        if q is None:
            return error(404, f'There is no query "{query_id}".')
        status, body = app(request, "DELETE", "/api/queries/{query_id}", query_id=q.id, clientId=origin(token))
        if status < 400:
            guard.log(token, "delete-query", q.id, trashId=body.get("trashId"))
        return answer(status, body)

    # whiteboards

    @r.post("/v1/whiteboards", status_code=201)
    @run
    def create_whiteboard(req: CreateWhiteboardRequest, request: Request):
        token = auth(request, write=True)
        status, body = app(request, "POST", "/api/whiteboards", {"title": req.title, "clientId": origin(token)})
        if status < 400:
            guard.log(token, "create-whiteboard", body["path"])
            body = {"path": body["path"], "version": body["version"]}
        return answer(status, body)

    @r.put("/v1/whiteboard")
    @run
    def edit_whiteboard(req: EditWhiteboardRequest, request: Request):
        token = auth(request, write=True)
        rel = visible(req.path)
        status, body = app(
            request, "PUT", "/api/whiteboard",
            {"path": rel, "board": req.board, "baseRevision": req.revision, "clientId": origin(token)},
        )
        if status < 400:
            guard.log(token, "whiteboard", rel)
        return answer(status, body)

    # automations

    def lifts_exclusion(rule: dict[str, Any]) -> bool:
        """Whether a rule's actions could take "Exclude from AI" off a page later: removing the
        tag of that name, or setting or clearing ``tags`` or ``excludeFromAI``."""
        from .apiquery import EXCLUDE_TAG

        actions = rule.get("actions") if isinstance(rule, dict) else None
        for a in actions if isinstance(actions, list) else []:
            if not isinstance(a, dict):
                continue
            kind = a.get("kind")
            if kind in ("setProperty", "clearProperty") and a.get("key") in ("tags", "excludeFromAI"):
                return True
            if kind == "removeTag":
                tag_id = a.get("tagId")
                with space._lock:
                    titles = [
                        x.title for x in space._summaries.values()
                        if x.type == "tag" and x.id == tag_id
                    ]
                if any((t or "").strip().casefold() == EXCLUDE_TAG for t in titles):
                    return True
        return False

    def runs_agent(rule: dict[str, Any]) -> bool:
        """M21: whether a rule has a ``runAgent`` action (an agent schedule, made only with
        ``schedule_manage``, which can't name another agent)."""
        actions = rule.get("actions") if isinstance(rule, dict) else None
        return any(isinstance(a, dict) and a.get("kind") == "runAgent"
                   for a in (actions if isinstance(actions, list) else []))

    @r.post("/v1/automations", status_code=201)
    @run
    def create_automation(req: RuleRequest, request: Request):
        token = auth(request, write=True)
        if runs_agent(req.rule):
            return error(422, AGENT_SCHEDULE_RULE)
        if lifts_exclusion(req.rule):
            return error(422, EXCLUSION_RULE)
        status, body = app(request, "POST", "/api/automations", {"rule": req.rule, "clientId": origin(token)})
        if status < 400:
            guard.log(token, "create-automation", body.get("id", ""))
        return answer(status, body)

    @r.post("/v1/automations/{rule_id}/run")
    @run
    def run_automation(rule_id: str, req: PathRequest, request: Request):
        token = auth(request, write=True)
        rel = visible(req.path)
        status, body = app(
            request, "POST", "/api/automations/{rule_id}/run",
            {"path": rel, "clientId": origin(token)}, rule_id=rule_id,
        )
        if status < 400:
            guard.log(token, "run-automation", rel, ruleId=rule_id)
        return answer(status, body)

    # imports

    @r.post("/v1/import/start", status_code=202)
    @run
    def start_import(req: StartRequest, request: Request):
        token = auth(request, write=True)
        target = {"kind": req.target} if isinstance(req.target, str) else dict(req.target)
        mapping = req.mapping
        if mapping is None:
            with previews_lock:
                mapping = previews.get(req.previewId)
            if mapping is None:
                return error(404, "This preview has expired. Preview the source again.")
        status, body = _call(
            next(rt for rt in imports.routes if getattr(rt, "path", "") == "/import/start"),
            {"previewId": req.previewId, "mapping": mapping, "target": target, "clientId": origin(token),
             "batch": req.batch, "scan": req.scan, "requireApproved": True, "keepAsSources": req.keepAsSources},
        )
        if status >= 400:
            return _failed(status, body)
        guard.log(token, "import", str(body.get("targetPath", "")), jobId=body.get("jobId"))
        return JSONResponse(body, status_code=202)

    # trash and history

    @r.post("/v1/trash/{trash_id}/restore")
    @run
    def restore_from_trash(trash_id: str, request: Request):
        token = auth(request, write=True)
        item = next((i for i in space.list_trash() if i.id == trash_id), None)
        if item is None or guard.trash_entry_hidden(item):
            return error(404, f'There is no Trash entry "{trash_id}".')
        status, body = app(request, "POST", "/api/trash/{trash_id}/restore", trash_id=trash_id, clientId=origin(token))
        if status < 400:
            guard.log(token, "restore", item.originalPath, trashId=trash_id)
        return answer(status, body, "paths", "rewritten")

    @r.post("/v1/history/restore")
    @run
    def restore_version(req: RestoreVersionRequest, request: Request):
        token = auth(request, write=True)
        rel = visible(req.path)
        # M22: an earlier version may hold an approval Gene has since withdrawn or declined.
        if is_work(rel):
            try:
                old = history.content(rel, req.versionId).get("text")
            except (KeyError, ValueError):  # VersionNotFound: the app route answers it
                old = None
            if isinstance(old, str) and _approvals(_fm_of(old.encode("utf-8"))) - _approvals(
                space.read(rel)[1]
            ):
                return error(422, STEPS_GATED)
        status, body = app(
            request, "POST", "/api/history/restore",
            {"path": rel, "id": req.versionId, "baseVersion": req.version, "clientId": origin(token)},
        )
        if status < 400:
            guard.log(token, "restore-version", rel, versionId=req.versionId)
        return answer(status, body)

    return r


class _Hide(Exception):
    """A path the API may not name: 404 (or 400 for a path outside the space)."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail
