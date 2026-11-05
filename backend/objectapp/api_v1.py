"""The local API for programs outside Object's window (M11): ``/api/v1``.

Every ``/api/v1`` route needs ``Authorization: Bearer <token>`` (see `tokens`). A
``read`` token reaches the GET routes and ``POST /v1/query``; the write routes need a
``read-write`` token. The routes act through the same `Space` methods as the app, so
version checks (409 with ``currentVersion``), the trash, version history and change
events all hold. A write announces its `ChangeEvent` with ``origin: "api:<token name>"``
and is added to the activity log.

Objects marked "Exclude from AI" (`apiquery.is_excluded`) and templates are invisible:
they are left out of every answer and a path that names one answers 404.

Routes (all JSON):

- ``GET  /v1/whoami`` -> ``{name, scope, space}`` (the token's own name and scope)
- ``GET  /v1/schema`` -> ``{types, collections, queries}``
- ``GET  /v1/search?q=&type=&limit=&mode=`` -> ``{results, partial}``
- ``POST /v1/query`` ``{typeIds?, collectionIds?, tags?, filterGroup?, sort?, limit?, offset?}``
  -> ``{rows, total, unsupported}``
- ``POST /v1/queries/{id}/run`` ``{limit?, offset?}`` -> same as ``/v1/query``
- ``GET  /v1/object/peek?path=`` -> summary, values, outline, size, links, version
- ``GET  /v1/object?path=&section=`` -> values, body (or one section), version
- ``GET  /v1/object/backlinks?path=`` -> ``{backlinks}``
- ``GET  /v1/daily-note?date=`` -> ``{path}`` or 404
- ``GET  /v1/changes?since=`` -> ``{objects, activity}``
- ``POST /v1/objects`` ``{type, title?, values?, body?, templateId?}`` -> 201 ``{path, version}``
- ``POST /v1/object/properties`` ``{path, version, set?, add?, remove?}`` -> ``{version, values}``
- ``POST /v1/object/section`` ``{path, version, heading?, mode, text}`` -> ``{version}``
- ``POST /v1/object/rename`` ``{path, version, title}`` -> ``{path, version}``
- ``POST /v1/object/trash`` ``{path, version}`` -> ``{trashId}``

The app's own window manages tokens with routes that need no token (the app's
local-only guard already refuses other hosts and cross-origin writes):

- ``GET    /integrations/tokens`` -> ``{tokens, mcp}``
- ``POST   /integrations/tokens`` ``{name, scope}`` -> 201 ``{token, secret, mcpConfig}``
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
    is_excluded,
    outline,
    parse_since,
    read_section,
    replace_section,
    sort_rows,
)
from .propvalues import InvalidValue
from .space import Conflict, ReadOnly
from .tokens import ActivityLog, TokenRecord, TokenStore
from .watcher import ChangeEvent

__all__ = ["REPO_ROOT", "mcp_config", "router"]

REPO_ROOT = Path(__file__).resolve().parents[2]
MAX_ROWS = 500
MAX_BODY = 2_000_000


class _Denied(Exception):
    def __init__(self, status: int, detail: str) -> None:
        self.status = status
        self.detail = detail


def _error(status: int, detail: str, **extra: Any) -> JSONResponse:
    return JSONResponse({"detail": detail, **extra}, status_code=status)


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


def router(ctx: ApiContext, state_folder: Path | None = None) -> APIRouter:
    """The local API and the token routes, mounted on the app's ``/api`` router."""
    space = ctx.space
    tokens = TokenStore(space.root, state_folder)
    activity = ActivityLog(space.root, state_folder)
    r = APIRouter()

    # -- auth ---------------------------------------------------------------------

    def auth(request: Request, write: bool = False) -> TokenRecord:
        header = request.headers.get("authorization", "")
        scheme, _sep, secret = header.partition(" ")
        if scheme.lower() != "bearer" or not secret.strip():
            raise _Denied(401, "A token is needed: Authorization: Bearer <token>.")
        token = tokens.verify(secret.strip())
        if token is None:
            raise _Denied(401, "That token isn't valid for this space.")
        if write and token.scope != "read-write":
            raise _Denied(403, "This token can only read.")
        return token

    def guarded(fn):
        """Turn `_Denied` from `auth` into its JSON answer."""
        import functools

        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            try:
                return fn(*args, **kwargs)
            except _Denied as exc:
                return _error(exc.status, exc.detail)

        return wrapper

    # -- visibility ---------------------------------------------------------------

    def visible_rel(path: str) -> str:
        """The object's space path when the API may show it; KeyError (404) otherwise."""
        rel = space._rel(path)
        with space._lock:
            summary = space._summaries.get(rel)
            raw = space._raw.get(rel)
        if summary is None or summary.template is not None:
            raise KeyError(rel)
        if is_excluded(raw.fm if raw else None, summary.tags):
            raise KeyError(rel)
        return rel

    def hidden_paths() -> set[str]:
        with space._lock:
            return {
                rel
                for rel, s in space._summaries.items()
                if s.template is not None
                or is_excluded(space._raw[rel].fm if rel in space._raw else None, s.tags)
            }

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

    def resolve_type(name_or_id: str):
        t = space.type_by_id(name_or_id)
        if t is None:
            t = space.type_by_id(space._type_id(name_or_id))
        return t

    def announce(kind: str, path: str, version: str | None, token: TokenRecord, **extra) -> None:
        ctx.announce(ChangeEvent(kind, path, version, origin=f"api:{token.name}", **extra))

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
            return _error(422, "mode must be auto, title or fullText.")
        if len(q) > 200:
            return _error(422, "q must be at most 200 characters.")
        limit = max(1, min(int(limit), 100))
        known = {t.id for t in space.types}
        types = [resolve_type(t).id for t in type if resolve_type(t) is not None]
        types = [t for t in types if t in known]
        hidden = hidden_paths()
        found = ctx.search.search(q, types=types, limit=min(200, limit + len(hidden)), mode=mode)
        results = [x for x in found.get("results", []) if x.get("path") not in hidden][:limit]
        return {"results": results, "partial": found.get("partial", False)}

    def run_query(
        type_ids: list[str] | None,
        collection_ids: list[str] | None,
        tags: list[str] | None,
        group: dict | None,
        sort: dict | None,
        limit: int,
        offset: int,
    ) -> dict[str, Any]:
        limit = max(1, min(int(limit), MAX_ROWS))
        offset = max(0, int(offset))
        ids = None
        if type_ids:
            ids = []
            for name in type_ids:
                t = resolve_type(name)
                if t is None:
                    raise InvalidValue(f"No object type {name!r}")
                ids.append(t.id)
        rows = space.rows(ids, collection_ids or None, None, None, False)
        hidden = hidden_paths()
        rows = [x for x in rows if x.summary.path not in hidden]
        if tags:
            want = {t.casefold() for t in tags}
            rows = [x for x in rows if want & {t.casefold() for t in x.summary.tags}]
        matcher = Matcher(group, space.clock().astimezone(space.tz).date())
        rows = [x for x in rows if matcher.matches(x.values)]
        if sort and isinstance(sort.get("propertyId"), str):
            rows = sort_rows(rows, sort["propertyId"], bool(sort.get("descending")))
        total = len(rows)
        page = rows[offset : offset + limit]
        return {
            "rows": [
                {**summary_out(x.summary), "version": x.version, "values": x.values}
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
            out = run_query(
                req.typeIds, req.collectionIds, req.tags, req.filterGroup, req.sort,
                req.limit, req.offset,
            )
        except InvalidValue as exc:
            return _error(422, str(exc))
        return JSONResponse(json.loads(json.dumps(out, default=str)))

    @r.post("/v1/queries/{query_id}/run")
    @guarded
    def run_saved(query_id: str, request: Request, req: RunQueryRequest | None = None):
        auth(request)
        req = req or RunQueryRequest()
        q = next((x for x in space.list_queries() if x.id == query_id), None)
        if q is None:
            return _error(404, f"No query {query_id!r}")
        d = q.definition or {}
        structures = [s for s in d.get("structures") or [] if isinstance(s, dict)]
        type_ids = [s["id"] for s in structures if isinstance(s.get("id"), str)] or None
        collection_ids = sorted(
            {c for s in structures for c in s.get("collectionIds") or [] if isinstance(c, str)}
        ) or None
        sorts = [s for s in d.get("sorts") or [] if isinstance(s, dict)]
        sort = (
            {"propertyId": sorts[0].get("propertyId"),
             "descending": str(sorts[0].get("option", "")).startswith("descending")}
            if sorts else None
        )
        try:
            out = run_query(
                type_ids, collection_ids, None, d.get("filterGroup"), sort, req.limit, req.offset
            )
        except InvalidValue as exc:
            return _error(422, str(exc))
        # Parts of a saved query this engine doesn't apply yet; the app's own view does.
        skipped = [
            key
            for key, present in (
                ("search", bool((d.get("search") or {}).get("searchTerms"))),
                ("tags", bool((d.get("tags") or {}).get("ids"))),
                ("excludeStructureIds", bool(d.get("excludeStructureIds"))),
                ("structureCollectionRules", any(
                    s.get("inNoCollection") or s.get("inAnyCollection") or s.get("excludeCollectionIds")
                    for s in structures
                )),
            )
            if present
        ]
        out["unsupported"] = sorted({*out["unsupported"], *skipped})
        out["query"] = {"id": q.id, "name": q.name}
        return JSONResponse(json.loads(json.dumps(out, default=str)))

    def read_visible(path: str):
        rel = visible_rel(path)
        of, fm, version = space.read(rel)
        rows = space.rows(None, None, [rel], None, False)
        values = rows[0].values if rows else {}
        return rel, of, fm, version, values

    @r.get("/v1/object/peek")
    @guarded
    def peek(request: Request, path: str):
        auth(request)
        try:
            rel, of, fm, version, values = read_visible(path)
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f"No object at {path!r}")
        hidden = hidden_paths()
        links = space.links_of(rel, fm)
        links = {k: [p for p in v if p not in hidden] for k, v in links.items()}
        body = of.body
        return JSONResponse(
            json.loads(
                json.dumps(
                    {
                        **summary_out(space.get(rel)),
                        "version": version,
                        "values": values,
                        "outline": outline(body),
                        "size": {"characters": len(body), "words": len(body.split())},
                        "links": links,
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
            rel, of, _fm, version, values = read_visible(path)
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f"No object at {path!r}")
        body = of.body
        if section is not None:
            found = read_section(body, section)
            if found is None:
                return _error(404, f"No heading {section!r} in {rel!r}")
            body = found
        return JSONResponse(
            json.loads(
                json.dumps(
                    {**summary_out(space.get(rel)), "version": version, "values": values,
                     "body": body},
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
            return _error(404, f"No object at {path!r}")
        hidden = hidden_paths()
        items = [b for b in space.backlinks(rel) if b.get("path") not in hidden]
        return JSONResponse(json.loads(json.dumps({"backlinks": items}, default=str)))

    @r.get("/v1/daily-note")
    @guarded
    def daily_note(request: Request, date: str):
        auth(request)
        notes, _dupes = space.daily_notes()
        path = notes.get(date)
        if path is None or path in hidden_paths():
            return _error(404, f"No daily note for {date}")
        return {"path": path}

    @r.get("/v1/changes")
    @guarded
    def changes(request: Request, since: str | None = Query(default=None), limit: int = 100):
        auth(request)
        at = parse_since(since)
        if since and at is None:
            return _error(422, "since must be an ISO date or date-time.")
        limit = max(1, min(int(limit), 500))
        hidden = hidden_paths()
        objs = [s for s in space.list() if s.path not in hidden and s.lastUpdated]
        if at:
            objs = [s for s in objs if s.lastUpdated[: len(at)] >= at]
        objs.sort(key=lambda s: s.lastUpdated or "", reverse=True)
        log = [e for e in activity.since(at, limit) if e.get("path") not in hidden]
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
            return _error(404, f"No object type {req.type!r}")
        if req.body is not None and len(req.body) > MAX_BODY:
            return _error(422, "body is too long.")
        values = dict(req.values or {})
        try:
            path, version = space.create_object(
                t.id, req.title or "", req.templateId, values or None
            )
        except InvalidValue as exc:
            return _error(422, str(exc))
        except KeyError:
            return _error(404, f"No object type {req.type!r}")
        announce("created", path, version, token)
        if req.body:
            try:
                of, _fm, current = space.read(path)
                body = of.body
                joined = append_to_section(body, None, req.body) if body.strip() else req.body
                version = space.save_body(path, joined or req.body, current)
                announce("changed", path, version, token)
            except (Conflict, ReadOnly, ValueError) as exc:
                activity.add(token, "create", path)
                return JSONResponse(
                    {"path": path, "version": version, "warning": f"Body not written: {exc}"},
                    status_code=201,
                )
        activity.add(token, "create", path)
        return JSONResponse({"path": path, "version": version}, status_code=201)

    @r.post("/v1/object/properties")
    @guarded
    def properties(req: PropertiesRequest, request: Request):
        token = auth(request, write=True)
        try:
            rel = visible_rel(req.path)
            updates = dict(req.set)
            if req.add:
                rows = space.rows(None, None, [rel], None, False)
                current = rows[0].values if rows else {}
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
            return _error(404, f"No object at {req.path!r}")
        if result.version != req.version:
            announce("changed", rel, result.version, token)
            activity.add(token, "properties", rel, keys=sorted({*updates, *req.remove}))
        for path in result.synced:
            announce("changed", path, space.cached_version(path), token)
        rows = space.rows(None, None, [rel], None, False)
        values = rows[0].values if rows else {}
        return JSONResponse(
            json.loads(
                json.dumps(
                    {"version": result.version, "values": values,
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
            return _error(422, "mode must be append or replace.")
        if req.mode == "replace" and not req.heading:
            return _error(422, "replace needs a heading.")
        if len(req.text) > MAX_BODY:
            return _error(422, "text is too long.")
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
                return _error(404, f"No heading {req.heading!r} in {rel!r}")
            version = space.save_body(rel, new, req.version)
        except Conflict as exc:
            return conflict(exc)
        except ReadOnly as exc:
            return _error(423, exc.reason)
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f"No object at {req.path!r}")
        if version != req.version:
            announce("changed", rel, version, token)
            activity.add(token, f"section-{req.mode}", rel, heading=req.heading)
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
            return _error(404, f"No object at {req.path!r}")
        if result.path != rel:
            announce("renamed", result.path, result.version, token, oldPath=rel)
        elif result.version != req.version:
            announce("changed", rel, result.version, token)
        for path in result.relinked:
            announce("changed", path, space.cached_version(path), token)
        activity.add(token, "rename", result.path, oldPath=rel)
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
            return _error(404, f"No object at {req.path!r}")
        announce("deleted", item.originalPath, None, token)
        activity.add(token, "trash", item.originalPath)
        return {"trashId": item.id}

    return r
