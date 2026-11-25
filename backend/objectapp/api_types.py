"""The object-type routes, mounted on ``/api`` (once inline in `server.py`):

- ``GET /api/type-gallery`` -> the gallery (M28: with the IT ops templates when Work is on).
- ``POST /api/types`` -> ``201 TypeDef`` (``template``: a gallery key, polish item 21).
- ``PUT /api/types/{id}`` -> the type after the write (``409``, ``422``, ``423``, ``428``).
- ``POST /api/types/{id}/properties/{pid}/change-kind``, ``/number-existing``, ``/sync``.
- ``POST /api/types/{id}/relation-pair`` (M13: the sub-items or dependencies pair).
- ``GET``/``POST /api/types/{id}/templates`` -> a type's templates.
- ``DELETE /api/types/{id}?confirm=`` -> ``{trashId, paths, typeIds, queryIds}``.
- ``POST /api/formula/preview`` -> parse (and with ``path``, evaluate) an expression.

Announces ``types`` (and ``changed`` per rewritten file, ``created`` per new template,
``queries`` for the templates' saved searches and the ones a delete trashed)."""

from __future__ import annotations

import copy
from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .apictx import ApiContext
from .computed import Computer, Obj
from .formula import FormulaError
from .formula import parse as parse_formula
from .propvalues import InvalidValue
from .space import ConfirmRequired
from .typemodel import (
    DATA_VIEW_LAYOUTS,
    DEFAULT_LAYOUT_KEY,
    PropertyDefinition,
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


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"detail": message}, status_code=status)


def _safe(value: Any) -> Any:
    from .server import _display_safe  # lazy: server.py imports this module

    return _display_safe(value)


class CreateTemplateRequest(BaseModel):
    name: str | None = None
    clientId: str | None = None


class CreateTypeRequest(BaseModel):
    name: str = ""
    pluralName: str = ""
    icon: Any = None
    color: str | None = None
    template: str | None = None
    clientId: str | None = None


class SaveTypeRequest(BaseModel):
    type: dict[str, Any]
    baseRevision: str = ""
    confirm: bool = False
    clientId: str | None = None


class ChangeKindRequest(BaseModel):
    toType: str
    baseRevision: str = ""
    clientId: str | None = None


class NumberExistingRequest(BaseModel):
    baseRevision: str = ""
    clientId: str | None = None


class FormulaPreviewRequest(BaseModel):
    typeId: str
    expression: str
    path: str | None = None
    properties: list[Any] | None = None


class RelationPairRequest(BaseModel):
    kind: str
    baseRevision: str = ""
    clientId: str | None = None


class SyncRequest(BaseModel):
    targetPropertyId: str | None = None
    createName: str | None = None
    baseRevision: str = ""
    clientId: str | None = None


def router(ctx: ApiContext) -> APIRouter:
    """The object-type routes."""
    space = ctx.space
    announce = ctx.announce

    r = APIRouter()

    @r.get("/types/{type_id}/templates")
    def list_templates(type_id: str):
        try:
            return _safe([asdict(s) for s in space.list_templates(type_id)])
        except KeyError:
            return _error(404, f'There is no object type "{type_id}".')

    @r.post("/types/{type_id}/templates", status_code=201)
    def create_template(type_id: str, req: CreateTemplateRequest):
        try:
            path, version = space.create_template(type_id, req.name or "New template")
        except TypeReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except KeyError:
            return _error(404, f'There is no object type "{type_id}".')
        announce(ChangeEvent("types", type_id, None, origin=req.clientId))
        announce(ChangeEvent("created", path, version, origin=req.clientId))
        return JSONResponse({"path": path, "version": version}, status_code=201)

    @r.get("/type-gallery")
    def type_gallery():
        from .typetemplates import template_catalog

        return template_catalog(list(space.types), work=space.work_on())

    @r.post("/types", status_code=201)
    def create_type(req: CreateTypeRequest):
        templates_before = space.template_versions() if req.template else {}
        try:
            t = space.create_type(
                req.name, req.pluralName, icon=req.icon, color=req.color, template=req.template
            )
        except InvalidValue as exc:
            return _error(422, str(exc))
        announce(ChangeEvent("types", t.id, None, origin=req.clientId))
        if req.template:
            # M28: an IT ops type from the gallery comes with its default template.
            for path, version in space.template_versions().items():
                if path not in templates_before:
                    announce(ChangeEvent("created", path, version, origin=req.clientId))
        if req.template:
            # The template's saved query: no origin, so the creating window reloads its queries too.
            announce(ChangeEvent("queries", "*", None))
        # M28: as `GET /api/space` serves it, its computed other sides (`counterparts`) included.
        return JSONResponse(
            _safe(space.type_api(t, type_revision(space.root, t.id))), status_code=201
        )

    @r.put("/types/{type_id}")
    def save_type(type_id: str, req: SaveTypeRequest):
        data = {**req.type, "id": type_id}
        data.setdefault("schemaVersion", 2)
        for field in ("name", "pluralName"):
            # `from_json` would fill these in; an edit that clears them is refused.
            if not isinstance(data.get(field), str) or not data[field].strip():
                return _error(422, "A type needs a name and a plural name.")
        if data.get("propertyDefinitions") is not None and not isinstance(
            data["propertyDefinitions"], list
        ):
            return _error(422, 'The field "propertyDefinitions" must be a list.')
        if DEFAULT_LAYOUT_KEY in data:
            if data[DEFAULT_LAYOUT_KEY] is None:
                # null unsets it: the file then has no line for it.
                del data[DEFAULT_LAYOUT_KEY]
            else:
                # Only a changed value is checked, so a stored unknown one never blocks
                # saving the type's other settings.
                current = space.type_by_id(type_id)
                stored = current.extra.get(DEFAULT_LAYOUT_KEY) if current is not None else None
                layout = data[DEFAULT_LAYOUT_KEY]
                if layout != stored and layout not in DATA_VIEW_LAYOUTS:
                    return _error(422, f'"{layout}" is not a list view layout.')
        for entry in data.get("propertyDefinitions") or []:
            if isinstance(entry, dict) and "options" in entry:
                bad = option_shape_problems(entry["options"])
                if bad:
                    name = entry.get("name") or entry.get("key") or "a property"
                    return _error(422, f"The options of {name} are not valid: {', '.join(bad)}.")
        # M29: the synced mark and the name patterns, checked as sent (a bad one never reaches
        # `from_json`, which would keep it aside in `extra`).
        problems = pattern_problems(data.get("namePatterns"))
        for entry in data.get("propertyDefinitions") or []:
            problems += synced_problems(entry)
        if problems:
            return _error(422, problems[0])
        try:
            t = TypeDefinition.from_json(data, fallback_id=type_id)
            result = space.save_type(t, req.baseRevision, confirm=req.confirm)
        except RevisionConflict as exc:
            return JSONResponse({"currentRevision": exc.current_revision}, status_code=409)
        except TypeReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except ConfirmRequired as exc:
            return JSONResponse({"detail": exc.detail, "affected": exc.affected}, status_code=428)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except KeyError:
            return _error(404, f'There is no object type "{type_id}".')
        announce(ChangeEvent("types", type_id, None, origin=req.clientId))
        for path in result.rewritten:
            announce(ChangeEvent("changed", path, space.cached_version(path), origin=req.clientId))
        # M28: the type as `GET /api/space` serves it, its computed other sides included.
        return _safe({**result.to_api(), "type": space.type_api(result.type, result.revision)})

    @r.post("/types/{type_id}/properties/{pid}/change-kind")
    def change_kind(type_id: str, pid: str, req: ChangeKindRequest):
        try:
            result = space.change_property_kind(type_id, pid, req.toType, req.baseRevision)
        except RevisionConflict as exc:
            return JSONResponse({"currentRevision": exc.current_revision}, status_code=409)
        except TypeReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except KeyError:
            return _error(404, f'There is no property "{pid}" on object type "{type_id}".')
        announce(ChangeEvent("types", type_id, None, origin=req.clientId))
        for path in result.rewritten:
            announce(ChangeEvent("changed", path, space.cached_version(path), origin=req.clientId))
        return _safe({**result.to_api(), "type": space.type_api(result.type, result.revision)})

    @r.post("/types/{type_id}/properties/{pid}/number-existing")
    def number_existing(type_id: str, pid: str, req: NumberExistingRequest):
        try:
            result = space.number_existing(type_id, pid, req.baseRevision)
        except RevisionConflict as exc:
            return JSONResponse({"currentRevision": exc.current_revision}, status_code=409)
        except TypeReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except KeyError:
            return _error(404, f'There is no property "{pid}" on object type "{type_id}".')
        announce(ChangeEvent("types", type_id, None, origin=req.clientId))
        for path in result.rewritten:
            announce(ChangeEvent("changed", path, space.cached_version(path), origin=req.clientId))
        return _safe({**result.to_api(), "type": space.type_api(result.type, result.revision)})

    @r.post("/formula/preview")
    def formula_preview(req: FormulaPreviewRequest):
        """M12: parse (and with ``path``, evaluate) an expression. Writes nothing."""
        t = space.type_by_id(req.typeId)
        if t is None:
            return _error(404, f'There is no object type "{req.typeId}".')
        try:
            parse_formula(req.expression) if req.expression.strip() else None
        except FormulaError as exc:
            return {"value": None, "error": str(exc)}
        if not req.path:
            return {"value": None, "error": None}
        if req.properties is not None:
            t = copy.deepcopy(t)
            defs = []
            for entry in req.properties:
                try:
                    defs.append(PropertyDefinition.from_json(entry))
                except (ValueError, TypeError, AttributeError):
                    continue
            t.propertyDefinitions = defs
        try:
            _of, fm, _version = space.read(req.path)
            summary = space.get(req.path)
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f'There is no object at "{req.path}".')
        fm = space.synced.overlay(t, fm)  # M29: the synced facts, as every reader sees them
        value = Computer(space, types={t.id: t}).evaluate(Obj(summary.path, fm, summary, t), req.expression)
        return _safe(
            {"value": value, "error": value.get("error") if value["type"] == "error" else None}
        )

    @r.post("/types/{type_id}/properties/{pid}/sync")
    def sync_property(type_id: str, pid: str, req: SyncRequest):
        try:
            result = space.set_property_sync(
                type_id,
                pid,
                req.targetPropertyId,
                create_name=req.createName,
                base_revision=req.baseRevision,
            )
        except RevisionConflict as exc:
            return JSONResponse({"currentRevision": exc.current_revision}, status_code=409)
        except TypeReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except KeyError:
            return _error(404, f'There is no property "{pid}" on object type "{type_id}".')
        for t in result.types:
            announce(ChangeEvent("types", t.id, None, origin=req.clientId))
        for path in result.rewritten:
            announce(ChangeEvent("changed", path, space.cached_version(path), origin=req.clientId))
        return _safe({**result.to_api(), "types": [space.type_api(t, result.revisions.get(t.id, "")) for t in result.types]})

    @r.post("/types/{type_id}/relation-pair")
    def relation_pair(type_id: str, req: RelationPairRequest):
        """M13: add (or reuse) the sub-items or dependencies pair; rewrites no object."""
        try:
            result = space.create_relation_pair(type_id, req.kind, req.baseRevision)
        except RevisionConflict as exc:
            return JSONResponse({"currentRevision": exc.current_revision}, status_code=409)
        except TypeReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except KeyError:
            return _error(404, f'There is no object type "{type_id}".')
        if result.changed:
            announce(ChangeEvent("types", type_id, None, origin=req.clientId))
        return _safe({**result.to_api(), "type": space.type_api(result.type, result.revision)})

    @r.delete("/types/{type_id}")
    def delete_type(
        type_id: str,
        confirm: bool = Query(default=False),
        clientId: str | None = Query(default=None),
    ):
        try:
            item = space.delete_type(type_id, confirm=confirm)
        except ConfirmRequired as exc:
            return JSONResponse({"detail": exc.detail, "affected": exc.affected}, status_code=428)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except KeyError:
            return _error(404, f'There is no object type "{type_id}".')
        manifest = space.trash.manifest(item.id) or {}
        type_ids = [type_id]
        for ref in manifest.get("allowedTypesRefs") or []:
            other = str(ref.get("typeId"))
            if other not in type_ids:
                type_ids.append(other)
        for tid in type_ids:
            announce(ChangeEvent("types", tid, None, origin=clientId))
        paths = [str(p) for p in manifest.get("templates") or []]
        for oid in manifest.get("objectTrashIds") or []:
            meta = space.trash.object_meta(oid)
            if meta is not None:
                paths.append(str(meta.get("originalPath", "")))
        for path in paths:
            announce(ChangeEvent("deleted", path, None, origin=clientId))
        # The saved queries that went to the trash with the type, or dropped it.
        query_ids = [str(q) for q in manifest.get("queries") or []]
        for ref in manifest.get("queryRefs") or []:
            if str(ref.get("queryId")) not in query_ids:
                query_ids.append(str(ref.get("queryId")))
        for query_id in query_ids:
            announce(ChangeEvent("queries", query_id, None, origin=clientId))
        # The window that deleted can't list these itself: tell it what changed.
        return {"trashId": item.id, "paths": paths, "typeIds": type_ids, "queryIds": query_ids}


    return r
