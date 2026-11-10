"""The local API for programs outside Object's window (M11): ``/api/v1``.

Every ``/api/v1`` route needs ``Authorization: Bearer <token>`` (see `tokens`). A
``read`` token reaches the GET routes and ``POST /v1/query``; the write routes need a
``read-write`` token. M29: a ``sync`` token reads like a ``read`` one and writes only synced
facts (``POST /v1/synced/{typeId}``, in `api_v1_synced`, which a ``read-write`` token may use
too); any other write answers 403 "This token can only write synced facts." Rows, peeks and
reads of an object whose type has synced properties carry its synced values in ``values`` and
``syncedAt`` (when they were last refreshed, or null). The routes act through the same `Space` methods as the app, so
version checks (409 with ``currentVersion``), the trash, version history and change
events all hold. A write announces its `ChangeEvent` with ``origin: "api:<token name>"``
and is added to the activity log.

Objects marked "Exclude from AI" (`apiquery.is_excluded`) and templates are invisible:
they are left out of every answer and a path that names one answers 404.

Routes (all JSON):

- ``GET  /v1/whoami`` -> ``{name, scope, space}`` (the token's own name and scope)
- ``GET  /v1/schema`` -> ``{types, collections, queries}``
- ``GET  /v1/search?q=&type=&limit=&mode=`` -> ``{results, partial}``
- ``POST /v1/query`` ``{typeIds?, collectionIds?, tags?, filterGroup?, sort?, limit?, offset?,
  search?, searchMode?, excludeTypeIds?, tagsOperator?, excludeTags?, inNoCollection?,
  inAnyCollection?, excludeCollectionIds?}`` -> ``{rows, total, unsupported}`` (every part given
  applies; ``unsupported`` names filter operators this engine doesn't know, which pass)
- ``POST /v1/queries/{id}/run`` ``{limit?, offset?}`` -> ``{rows, total, paused, query}``: the
  objects the saved query's page lists in the app, in its order (`queryeval`, M31); ``paused``
  says a search term has paused its filters and sorts, as in the app
- ``GET  /v1/object/peek?path=`` -> summary, values, outline, size, links, counterparts, version
- ``GET  /v1/object?path=&section=`` -> values, body (or one section), counterparts, version
- ``GET  /v1/object/backlinks?path=`` -> ``{backlinks}``
- ``GET  /v1/daily-note?date=`` -> ``{path}`` or 404
- ``GET  /v1/changes?since=`` -> ``{objects, activity}``
- ``POST /v1/objects`` ``{type, title?, values?, body?, templateId?}`` -> 201 ``{path, version}``
- ``POST /v1/object/properties`` ``{path, version, set?, add?, subtract?, remove?}`` -> ``{version, values}``
  (``subtract: {key: [values]}`` takes items out of a list property, matched by name, M17)
- ``POST /v1/object/section`` ``{path, version, heading?, mode, text}`` -> ``{version}``
- ``POST /v1/object/rename`` ``{path, version, title}`` -> ``{path, version}``
- ``POST /v1/object/trash`` ``{path, version}`` -> ``{trashId}``

M17 adds the routes behind the expanded ``objectapp-mcp`` in `api_v1_tools` (types,
collections, queries, whiteboards, version history, unlinked mentions, the trash, daily notes,
automations and imports) and the agent routes in `api_agent_v1`. Auth, visibility,
announcements and the activity log are shared through `v1guard.V1Guard`; a write also passes
every `v1guard.WRITE_GUARDS` check.

The app's own window manages tokens with routes that need no token (the app's
local-only guard already refuses other hosts and cross-origin writes):

- ``GET    /integrations/tokens`` -> ``{tokens, mcp}``
- ``POST   /integrations/tokens`` ``{name, scope}`` -> 201 ``{token, secret, mcpConfig}``
  (``scope``: ``read``, ``read-write`` or ``sync``; 422 for another)
- ``DELETE /integrations/tokens/{id}``
"""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .apictx import ApiContext
from .apiquery import (
    Matcher,
    append_to_section,
    outline,
    parse_since,
    read_section,
    replace_section,
    sort_rows,
)
from .automation_filter import tag_names
from .propvalues import InvalidValue
from .queryeval import evaluate, row_collection_ids
from .recurrence import week_start_of
from .rows import check_search
from .space import Conflict, ReadOnly
from .synced import synced_props
from .tokens import ActivityLog, TokenStore
from .v1guard import V1Guard, guarded

__all__ = ["REPO_ROOT", "mcp_config", "router"]

REPO_ROOT = Path(__file__).resolve().parents[2]
MAX_ROWS = 500
MAX_BODY = 2_000_000


def _error(status: int, detail: str, **extra: Any) -> JSONResponse:
    return JSONResponse({"detail": detail, **extra}, status_code=status)


def _hidden_ref(value: Any, hidden: set[str]) -> bool:
    return isinstance(value, dict) and value.get("path") in hidden


def without_hidden(values: dict[str, Any], hidden: set[str]) -> dict[str, Any]:
    """``values`` without the relation items (``{target, path}``) that point at a hidden object
    (a template or one excluded from AI); a single one becomes None (audit 2026-11-07 #23)."""
    out: dict[str, Any] = {}
    for key, value in values.items():
        if isinstance(value, list):
            value = [x for x in value if not _hidden_ref(x, hidden)]
        elif _hidden_ref(value, hidden):
            value = None
        out[key] = value
    return out


def counterparts_without_hidden(rows: list[dict[str, Any]], hidden: set[str]) -> list[dict[str, Any]]:
    """M28: counterpart rows (`Space.counterparts`) without the paths of hidden objects."""
    return [{**r, "paths": [p for p in r["paths"] if p not in hidden]} for r in rows]


def links_hidden(values: dict[str, Any], hidden: set[str]) -> bool:
    """Whether any relation item of ``values`` points at a hidden object."""
    return any(
        any(_hidden_ref(x, hidden) for x in v) if isinstance(v, list) else _hidden_ref(v, hidden)
        for v in values.values()
    )


def mcp_config(base_url: str, secret: str = "<token>") -> dict[str, Any]:
    """The ``mcpServers`` entry a client (Claude Code, Claude Desktop) needs."""
    return {
        "mcpServers": {
            "object": {
                "command": "uv",
                "args": ["run", "--directory", str(REPO_ROOT), "objectapp-mcp"],
                "env": {"OBJECT_API_URL": base_url, "OBJECT_API_TOKEN": secret},
            }
        }
    }


class CreateTokenRequest(BaseModel):
    name: str
    scope: str = "read"


class QueryRequest(BaseModel):
    typeIds: list[str] | None = None
    collectionIds: list[str] | None = None
    tags: list[str] | None = None
    filterGroup: dict[str, Any] | None = None
    sort: dict[str, Any] | None = None
    limit: int = 50
    offset: int = 0
    # M31: the other parts a saved query has (the app's query builder), by the same names.
    search: str | list[str] | None = None
    searchMode: str = "auto"
    excludeTypeIds: list[str] | None = None
    tagsOperator: str = "or"
    excludeTags: list[str] | None = None
    inNoCollection: bool = False
    inAnyCollection: bool = False
    excludeCollectionIds: list[str] | None = None


class RunQueryRequest(BaseModel):
    limit: int = 50
    offset: int = 0


class CreateRequest(BaseModel):
    type: str
    title: str | None = None
    values: dict[str, Any] | None = None
    body: str | None = None
    templateId: str | None = None


class PropertiesRequest(BaseModel):
    path: str
    version: str
    set: dict[str, Any] = {}
    add: dict[str, list[Any]] = {}
    subtract: dict[str, list[Any]] = {}
    """M17: items to take out of a list property (tags, collections, relations), by name."""
    remove: list[str] = []


class SectionRequest(BaseModel):
    path: str
    version: str
    heading: str | None = None
    mode: str = "append"
    text: str


class RenameRequest(BaseModel):
    path: str
    version: str
    title: str


class TrashRequest(BaseModel):
    path: str
    version: str


def _item_name(item: Any) -> str:
    """A list item's name for `PropertiesRequest.subtract`: a link's target (``[[...]]``
    unwrapped) or the text, case-folded."""
    if isinstance(item, dict):
        item = item.get("target") or item.get("path") or ""
    text = str(item).strip()
    if text.startswith("[[") and text.endswith("]]"):
        text = text[2:-2].split("|", 1)[0]
    return text.strip().casefold()


def router(ctx: ApiContext, state_folder: Path | None = None) -> APIRouter:
    """The local API and the token routes, mounted on the app's ``/api`` router."""
    space = ctx.space
    tokens = TokenStore(space.root, state_folder)
    activity = ActivityLog(space.root, state_folder)
    from .server import SafeJSONResponse  # lazy: server.py imports this module

    # A file name that is not UTF-8 holds surrogate escapes; its answers show them as U+FFFD
    # instead of failing to encode (audit 2026-11-07 #4).
    r = APIRouter(default_response_class=SafeJSONResponse)

    guard = V1Guard(ctx, tokens, activity)
    auth = guard.auth
    visible_rel = guard.visible_rel
    hidden_paths = guard.hidden_paths

    def type_name(type_id: str) -> str:
        t = space.type_by_id(type_id)
        return t.name if t is not None else type_id

    def summary_out(s) -> dict[str, Any]:
        return {
            "path": s.path,
            "title": s.title,
            "type": s.type,
            "typeName": type_name(s.type),
            "tags": s.tags,
            "createdAt": s.createdAt,
            "lastUpdated": s.lastUpdated,
        }

    def synced_at(row) -> dict[str, Any]:
        """M29: ``{"syncedAt": ...}`` for a row whose type has synced properties, else ``{}``."""
        if row is None or not synced_props(space.type_by_id(row.summary.type)):
            return {}
        return {"syncedAt": row.syncedAt}

    def resolve_type(name_or_id: str):
        t = space.type_by_id(name_or_id)
        if t is None:
            t = space.type_by_id(space._type_id(name_or_id))
        return t

    announce = guard.announce

    # -- token routes (the app's window) --------------------------------------------

    @r.get("/integrations/tokens")
    def list_tokens(request: Request):
        base = f"{request.url.scheme}://{request.url.netloc}"
        return {"tokens": [t.to_api() for t in tokens.list()], "mcp": mcp_config(base)}

    @r.post("/integrations/tokens", status_code=201)
    def create_token(req: CreateTokenRequest, request: Request):
        try:
            record, secret = tokens.create(req.name, req.scope)
        except ValueError as exc:
            return _error(422, str(exc))
        base = f"{request.url.scheme}://{request.url.netloc}"
        return JSONResponse(
            {"token": record.to_api(), "secret": secret, "mcpConfig": mcp_config(base, secret)},
            status_code=201,
        )

    @r.delete("/integrations/tokens/{token_id}")
    def revoke_token(token_id: str):
        if not tokens.revoke(token_id):
            return _error(404, "No such token.")
        return {"revoked": token_id}

    # -- read ----------------------------------------------------------------------

    @r.get("/v1/whoami")
    @guarded
    def whoami(request: Request):
        token = auth(request)
        return {"name": token.name, "scope": token.scope, "space": space.root.name}

    @r.get("/v1/schema")
    @guarded
    def schema(request: Request):
        auth(request)
        types = []
        for t in space.types:
            api = t.to_api()
            types.append(
                {
                    "id": api["id"],
                    "name": api["name"],
                    "pluralName": api.get("pluralName"),
                    "folder": api.get("folder"),
                    "properties": [
                        {
                            "id": p["id"],
                            "key": p.get("key", p["id"]),
                            "name": p["name"],
                            "kind": p["type"],
                            **(
                                {"options": [o.get("text") for o in p["options"].get("set") or []]}
                                if p["type"] == "label" and isinstance(p.get("options"), dict)
                                else {}
                            ),
                        }
                        for p in api.get("propertyDefinitions", [])
                    ],
                }
            )
        collections = [{"id": c.id, "name": c.name} for c in space.list_collections()]
        queries = [{"id": q.id, "name": q.name} for q in space.list_queries()]
        return {"types": types, "collections": collections, "queries": queries}

    @r.get("/v1/search")
    @guarded
    def search(
        request: Request,
        q: str = Query(default=""),
        type: list[str] = Query(default=[]),  # noqa: B008
        limit: int = Query(default=20),
        mode: str = Query(default="auto"),
    ):
        auth(request)
        if mode not in ("auto", "title", "fullText"):
            return _error(422, 'The field "mode" must be auto, title or fullText.')
        if len(q) > 200:
            return _error(422, 'The field "q" must be at most 200 characters.')
        limit = max(1, min(int(limit), 100))
        known = {t.id for t in space.types}
        types = [resolve_type(t).id for t in type if resolve_type(t) is not None]
        types = [t for t in types if t in known]
        hidden = hidden_paths()
        # Hidden objects are left out before ranking, so `limit` visible results come back
        # however many hidden ones match (sweep 2026-11-08).
        found = ctx.search.search(q, types=types, limit=limit, mode=mode, exclude_paths=hidden)
        results = [x for x in found.get("results", []) if x.get("path") not in hidden][:limit]
        if hidden and results:
            # A properties snippet shows a relation's target by its title: leave it out for an
            # object that links a hidden one (audit 2026-11-07 #23).
            rows = space.rows(None, None, [x["path"] for x in results], None, False)
            linking = {x.summary.path for x in rows if links_hidden(x.values, hidden)}
            results = [
                {**x, "highlights": [
                    hl for hl in x.get("highlights") or [] if hl.get("field") != "properties"
                ]} if x["path"] in linking else x
                for x in results
            ]
        return {"results": results, "partial": found.get("partial", False)}

    def type_ids_of(names: list[str] | None) -> list[str] | None:
        if not names:
            return None
        ids = []
        for name in names:
            t = resolve_type(name)
            if t is None:
                raise InvalidValue(f'There is no object type "{name}".')
            ids.append(t.id)
        return ids

    def run_query(req: QueryRequest) -> dict[str, Any]:
        """An ad-hoc query: every part given applies (M31 adds a saved query's other parts: search
        terms with their mode, excluded types, all-of and left-out tags, the collection rules)."""
        limit = max(1, min(int(req.limit), MAX_ROWS))
        offset = max(0, int(req.offset))
        ids = type_ids_of(req.typeIds)
        excluded = set(type_ids_of(req.excludeTypeIds) or [])
        if req.tagsOperator not in ("or", "and"):
            raise InvalidValue('The field "tagsOperator" must be or or and.')
        terms = [req.search] if isinstance(req.search, str) else list(req.search or [])
        search = (check_search(terms, req.searchMode), req.searchMode) if terms else None
        rows = space.rows(ids, req.collectionIds or None, None, search, False)
        hidden = hidden_paths()
        rows = [x for x in rows if x.summary.path not in hidden and x.summary.type not in excluded]

        def names(tags) -> set[str]:
            # A tag written as a link (``[[Work]]``, ``[[Work|alias]]``, ``[[Tags/Work]]``) is "Work".
            return {n.casefold() for t in tags for n in tag_names(t)}

        def wanted(tags) -> set[str]:
            return {tag_names(t)[-1].casefold() for t in tags}

        if req.tags:
            want = wanted(req.tags)
            every = req.tagsOperator == "and"
            rows = [x for x in rows if (want <= names(x.summary.tags) if every else want & names(x.summary.tags))]
        if req.excludeTags:
            out = wanted(req.excludeTags)
            rows = [x for x in rows if not out & names(x.summary.tags)]
        if req.inNoCollection or req.inAnyCollection or req.excludeCollectionIds:
            collections = [
                {"id": c.id, "name": c.name, "formerNames": list(c.formerNames)}
                for c in space.list_collections()
            ]
            left_out = set(req.excludeCollectionIds or [])

            def passes(x) -> bool:
                have = row_collection_ids({"summary": {"collections": x.summary.collections}}, collections)
                if req.inNoCollection and have:
                    return False
                if req.inAnyCollection and not have:
                    return False
                return not left_out & set(have)

            rows = [x for x in rows if passes(x)]
        group, sort = req.filterGroup, req.sort
        matcher = Matcher(group, space.clock().astimezone(space.tz).date(), week_start_of(space.root))
        rows = [x for x in rows if matcher.matches(x.values)]
        if sort and isinstance(sort.get("propertyId"), str):
            rows = sort_rows(rows, sort["propertyId"], bool(sort.get("descending")))
        total = len(rows)
        page = rows[offset : offset + limit]
        return {
            "rows": [
                {**summary_out(x.summary), "version": x.version,
                 "values": without_hidden(x.values, hidden), **synced_at(x)}
                for x in page
            ],
            "total": total,
            "unsupported": sorted(matcher.unsupported),
        }

    @r.post("/v1/query")
    @guarded
    def query(req: QueryRequest, request: Request):
        auth(request)
        try:
            out = run_query(req)
        except InvalidValue as exc:
            return _error(422, str(exc))
        return SafeJSONResponse(json.loads(json.dumps(out, default=str)))

    @r.post("/v1/queries/{query_id}/run")
    @guarded
    def run_saved(query_id: str, request: Request, req: RunQueryRequest | None = None):
        auth(request)
        req = req or RunQueryRequest()
        q = next((x for x in space.list_queries() if x.id == query_id), None)
        if q is None:
            return _error(404, f'There is no query "{query_id}".')
        # M31: the app's own evaluation (`queryeval`, a port of `queries/runQuery.ts`): every
        # part of the query applies, and the rows come in the order the query page lists them.
        try:
            run = evaluate(space, q.definition or {})
        except InvalidValue as exc:
            return _error(422, str(exc))
        hidden = hidden_paths()
        rows = [x for x in run.rows if x.summary.path not in hidden]
        limit = max(1, min(int(req.limit), MAX_ROWS))
        offset = max(0, int(req.offset))
        out = {
            "rows": [
                {**summary_out(x.summary), "version": x.version,
                 "values": without_hidden(x.values, hidden), **synced_at(x)}
                for x in rows[offset : offset + limit]
            ],
            "total": len(rows),
            "paused": run.paused,
            "query": {"id": q.id, "name": q.name},
        }
        return SafeJSONResponse(json.loads(json.dumps(out, default=str)))

    def read_visible(path: str):
        rel = visible_rel(path)
        of, fm, version = space.read(rel)
        rows = space.rows(None, None, [rel], None, False)
        values = rows[0].values if rows else {}
        return rel, of, fm, version, values, synced_at(rows[0] if rows else None)

    @r.get("/v1/object/peek")
    @guarded
    def peek(request: Request, path: str):
        auth(request)
        try:
            rel, of, fm, version, values, synced = read_visible(path)
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f'There is no object at "{path}".')
        hidden = hidden_paths()
        links = space.links_of(rel, fm)
        links = {k: [p for p in v if p not in hidden] for k, v in links.items()}
        body = of.body
        return SafeJSONResponse(
            json.loads(
                json.dumps(
                    {
                        **summary_out(space.get(rel)),
                        "version": version,
                        "values": without_hidden(values, hidden),
                        **synced,
                        "outline": outline(body),
                        "size": {"characters": len(body), "words": len(body.split())},
                        "links": links,
                        "counterparts": counterparts_without_hidden(space.counterparts(rel), hidden),
                    },
                    default=str,
                )
            )
        )

    @r.get("/v1/object")
    @guarded
    def read(request: Request, path: str, section: str | None = Query(default=None)):
        auth(request)
        try:
            rel, of, _fm, version, values, synced = read_visible(path)
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f'There is no object at "{path}".')
        body = of.body
        hidden = hidden_paths()
        if section is not None:
            found = read_section(body, section)
            if found is None:
                return _error(404, f'There is no heading "{section}" in "{rel}".')
            body = found
        return SafeJSONResponse(
            json.loads(
                json.dumps(
                    {**summary_out(space.get(rel)), "version": version,
                     "values": without_hidden(values, hidden), **synced, "body": body,
                     "counterparts": counterparts_without_hidden(space.counterparts(rel), hidden)},
                    default=str,
                )
            )
        )

    @r.get("/v1/object/backlinks")
    @guarded
    def backlinks(request: Request, path: str):
        auth(request)
        try:
            rel = visible_rel(path)
        except ValueError as exc:
            return _error(400, str(exc))
        except KeyError:
            return _error(404, f'There is no object at "{path}".')
        hidden = hidden_paths()
        items = [b for b in space.backlinks(rel) if b.get("path") not in hidden]
        return SafeJSONResponse(json.loads(json.dumps({"backlinks": items}, default=str)))

    @r.get("/v1/daily-note")
    @guarded
    def daily_note(request: Request, date: str):
        auth(request)
        notes, _dupes = space.daily_notes()
        path = notes.get(date)
        if path is None or path in hidden_paths():
            return _error(404, f"There is no daily note for {date}.")
        return {"path": path}

    @r.get("/v1/changes")
    @guarded
    def changes(request: Request, since: str | None = Query(default=None), limit: int = 100):
        auth(request)
        at = parse_since(since)
        if since and at is None:
            return _error(422, 'The field "since" must be an ISO date or date-time.')
        limit = max(1, min(int(limit), 500))
        hidden = hidden_paths()
        objs = [s for s in space.list() if s.path not in hidden and s.lastUpdated]
        if at:
            objs = [s for s in objs if s.lastUpdated[: len(at)] >= at]
        objs.sort(key=lambda s: s.lastUpdated or "", reverse=True)
        log = [
            # A rename's old path or a merge's source can name a hidden object (#23).
            {k: v for k, v in e.items() if not (k in ("oldPath", "source") and v in hidden)}
            for e in activity.since(at, limit)
            if e.get("path") not in hidden
        ]
        return {"objects": [summary_out(s) for s in objs[:limit]], "activity": log}

    # -- write ---------------------------------------------------------------------

    def conflict(exc: Conflict) -> JSONResponse:
        return _error(
            409,
            "The object changed since that version. Read it again and retry.",
            currentVersion=exc.current_version,
        )

    @r.post("/v1/objects", status_code=201)
    @guarded
    def create(req: CreateRequest, request: Request):
        token = auth(request, write=True)
        t = resolve_type(req.type)
        if t is None:
            return _error(404, f'There is no object type "{req.type}".')
        if req.body is not None and len(req.body) > MAX_BODY:
            return _error(422, "The body is too long.")
        values = dict(req.values or {})
        try:
            path, version = space.create_object(
                t.id, req.title or "", req.templateId, values or None
            )
        except InvalidValue as exc:
            return _error(422, str(exc))
        except KeyError:
            return _error(404, f'There is no object type "{req.type}".')
        announce("created", path, version, token)
        if req.body:
            try:
                of, _fm, current = space.read(path)
                body = of.body
                joined = append_to_section(body, None, req.body) if body.strip() else req.body
                version = space.save_body(path, joined or req.body, current)
                announce("changed", path, version, token)
            except (Conflict, ReadOnly, ValueError) as exc:
                guard.log(token, "create", path)
                return JSONResponse(
                    {"path": path, "version": version, "warning": f"Body not written: {exc}"},
                    status_code=201,
                )
        guard.log(token, "create", path)
        return JSONResponse({"path": path, "version": version}, status_code=201)

    @r.post("/v1/object/properties")
    @guarded
    def properties(req: PropertiesRequest, request: Request):
        token = auth(request, write=True)
        try:
            rel = visible_rel(req.path)
            updates = dict(req.set)
            rows = space.rows(None, None, [rel], None, False) if req.add or req.subtract else []
            current = rows[0].values if rows else {}
            if req.add:
                for key, items in req.add.items():
                    have = current.get(key)
                    have = list(have) if isinstance(have, list) else ([] if have in (None, "") else [have])
                    seen = {json.dumps(h, sort_keys=True, default=str).casefold() for h in have}
                    for item in items:
                        k = json.dumps(item, sort_keys=True, default=str).casefold()
                        if k not in seen:
                            have.append(item)
                            seen.add(k)
                    updates[key] = have
            for key, items in req.subtract.items():
                have = updates.get(key, current.get(key))
                have = list(have) if isinstance(have, list) else ([] if have in (None, "") else [have])
                drop = {_item_name(i) for i in items}
                updates[key] = [h for h in have if _item_name(h) not in drop]
            result = space.update_properties(rel, updates, req.version, remove=req.remove)
        except Conflict as exc:
            return conflict(exc)
        except ReadOnly as exc:
            return _error(423, exc.reason)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f'There is no object at "{req.path}".')
        if result.version != req.version:
            announce("changed", rel, result.version, token)
            guard.log(token, "properties", rel, keys=sorted({*updates, *req.remove}))
        for path in result.synced:
            announce("changed", path, space.cached_version(path), token)
        rows = space.rows(None, None, [rel], None, False)
        values = rows[0].values if rows else {}
        return SafeJSONResponse(
            json.loads(
                json.dumps(
                    {"version": result.version, "values": without_hidden(values, hidden_paths()),
                     "skipped": [asdict(s) for s in result.skipped]},
                    default=str,
                )
            )
        )

    @r.post("/v1/object/section")
    @guarded
    def section(req: SectionRequest, request: Request):
        token = auth(request, write=True)
        if req.mode not in ("append", "replace"):
            return _error(422, 'The field "mode" must be append or replace.')
        if req.mode == "replace" and not req.heading:
            return _error(422, "Replacing needs a heading.")
        if len(req.text) > MAX_BODY:
            return _error(422, "The text is too long.")
        try:
            rel = visible_rel(req.path)
            of, _fm, current = space.read(rel)
            if current != req.version:
                raise Conflict(current)
            body = of.body
            if req.mode == "append":
                new = append_to_section(body, req.heading, req.text)
            else:
                new = replace_section(body, req.heading or "", req.text)
            if new is None:
                return _error(404, f'There is no heading "{req.heading}" in "{rel}".')
            version = space.save_body(rel, new, req.version)
        except Conflict as exc:
            return conflict(exc)
        except ReadOnly as exc:
            return _error(423, exc.reason)
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f'There is no object at "{req.path}".')
        if version != req.version:
            announce("changed", rel, version, token)
            guard.log(token, f"section-{req.mode}", rel, heading=req.heading)
        return {"version": version}

    @r.post("/v1/object/rename")
    @guarded
    def rename(req: RenameRequest, request: Request):
        token = auth(request, write=True)
        try:
            rel = visible_rel(req.path)
            result = space.rename_object(rel, req.title, req.version)
        except Conflict as exc:
            return conflict(exc)
        except ReadOnly as exc:
            return _error(423, exc.reason)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f'There is no object at "{req.path}".')
        if result.path != rel:
            announce("renamed", result.path, result.version, token, oldPath=rel)
        elif result.version != req.version:
            announce("changed", rel, result.version, token)
        for path in result.relinked:
            announce("changed", path, space.cached_version(path), token)
        guard.log(token, "rename", result.path, oldPath=rel)
        return {"path": result.path, "version": result.version}

    @r.post("/v1/object/trash")
    @guarded
    def trash(req: TrashRequest, request: Request):
        token = auth(request, write=True)
        try:
            rel = visible_rel(req.path)
            item = space.delete_object(rel, base_version=req.version)
        except Conflict as exc:
            return conflict(exc)
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f'There is no object at "{req.path}".')
        announce("deleted", item.originalPath, None, token)
        guard.log(token, "trash", item.originalPath)
        return {"trashId": item.id}

    return r
