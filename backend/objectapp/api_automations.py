"""The automation routes (M14), mounted on the app's ``/api`` router.

- ``GET /automations`` -> ``AutomationRule[]`` by name (casefold), then id;
  ``GET /automations/{id}`` -> ``AutomationRule`` (404).
- ``POST /automations`` ``{rule, clientId?}`` -> 201 ``AutomationRule``; 422 ``{detail}``.
- ``PUT /automations/{id}`` ``{rule, baseRevision, clientId?}`` -> ``{rule}``; 404,
  409 ``{currentRevision}``, 422, 423 (a file that can't be read or is from a newer version).
- ``DELETE /automations/{id}?clientId=`` -> ``{trashId}`` (restorable); 404, 423.
- ``POST /automations/{id}/run`` ``{path, clientId?}`` -> ``AutomationRun``; 404 (rule or
  object), 422 (not a button rule, turned off, out of scope, a template), 423.
- ``GET /automations/{id}/runs?limit=`` (1-200, default 200) -> ``{runs}`` newest first; 404.
- ``GET /automations/catch-up`` -> ``{items}``; ``POST /automations/catch-up``
  ``{ruleId, choice, clientId?}`` -> ``{runs, queued}`` (M21: ``queued`` counts an agent
  schedule's occurrences handed to the agent jobs); 404 (no such rule or nothing pending).

Create, save, delete announce ``ChangeEvent("automations", id, revision or None,
origin=clientId)``; the engine announces its own writes and runs.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .apictx import ApiContext
from .automations import AutomationEngine, LoadedRule, RuleRefused, rule_api
from .propvalues import InvalidValue
from .space import ReadOnly
from .typemodel import RevisionConflict
from .watcher import ChangeEvent

__all__ = ["router"]


class CreateRuleRequest(BaseModel):
    rule: dict[str, Any]
    clientId: str | None = None


class SaveRuleRequest(BaseModel):
    rule: dict[str, Any]
    baseRevision: str = ""
    clientId: str | None = None


class RunRequest(BaseModel):
    path: str
    clientId: str | None = None


class CatchUpRequest(BaseModel):
    ruleId: str
    choice: Literal["all", "latest", "skip"]
    clientId: str | None = None


def _error(status: int, detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail}, status_code=status)


def _locked(reason: str) -> JSONResponse:
    return JSONResponse({"reason": reason, "detail": reason}, status_code=423)


def router(ctx: ApiContext, engine: AutomationEngine) -> APIRouter:
    r = APIRouter()
    announce = ctx.announce

    def api_form(lr: LoadedRule) -> dict[str, Any]:
        return rule_api(lr, engine.last_run(lr.id))

    def find(rule_id: str) -> LoadedRule | None:
        if "\x00" in rule_id or len(rule_id) > 200:
            return None
        return engine.rules.get(rule_id)

    @r.get("/automations")
    def list_rules():
        rules = sorted(
            engine.rules.all(),
            key=lambda lr: (str(api_form_name(lr)).casefold(), lr.id),
        )
        return [api_form(lr) for lr in rules]

    def api_form_name(lr: LoadedRule) -> str:
        if lr.rule is not None:
            return lr.rule.name
        name = (lr.data or {}).get("name")
        return name if isinstance(name, str) else lr.id

    # The catch-up routes come before `/automations/{id}` so "catch-up" is never taken for an id.
    @r.get("/automations/catch-up")
    def get_catch_up():
        return {"items": engine.scheduler.catch_up_items()}

    @r.post("/automations/catch-up")
    def post_catch_up(req: CatchUpRequest):
        try:
            runs, queued = engine.scheduler.answer_counted(req.ruleId, req.choice)
        except KeyError:
            return _error(404, "This automation has no missed runs.")
        # M21: an agent schedule's occurrences are queued for the agent jobs (`queued`), not run here.
        return {"runs": runs, "queued": queued}

    @r.get("/automations/{rule_id}")
    def get_rule(rule_id: str):
        lr = find(rule_id)
        if lr is None:
            return _error(404, f"No automation {rule_id[:60]!r}")
        return api_form(lr)

    @r.post("/automations", status_code=201)
    def create_rule(req: CreateRuleRequest):
        try:
            lr = engine.create(req.rule)
        except InvalidValue as exc:
            return _error(422, str(exc))
        announce(ChangeEvent("automations", lr.id, lr.revision, origin=req.clientId))
        return JSONResponse(api_form(lr), status_code=201)

    @r.put("/automations/{rule_id}")
    def save_rule(rule_id: str, req: SaveRuleRequest):
        if find(rule_id) is None:
            return _error(404, f"No automation {rule_id[:60]!r}")
        try:
            lr = engine.save(rule_id, req.rule, req.baseRevision)
        except KeyError:
            return _error(404, f"No automation {rule_id[:60]!r}")
        except ReadOnly as exc:
            return _locked(exc.reason)
        except RevisionConflict as exc:
            return JSONResponse({"currentRevision": exc.current_revision}, status_code=409)
        except InvalidValue as exc:
            return _error(422, str(exc))
        announce(ChangeEvent("automations", rule_id, lr.revision, origin=req.clientId))
        return {"rule": api_form(lr)}

    @r.delete("/automations/{rule_id}")
    def delete_rule(rule_id: str, clientId: str | None = Query(default=None)):
        if find(rule_id) is None:
            return _error(404, f"No automation {rule_id[:60]!r}")
        try:
            trash_id = engine.delete(rule_id)
        except KeyError:
            return _error(404, f"No automation {rule_id[:60]!r}")
        except ReadOnly as exc:
            return _locked(exc.reason)
        announce(ChangeEvent("automations", rule_id, None, origin=clientId))
        return {"trashId": trash_id}

    @r.post("/automations/{rule_id}/run")
    def run_rule(rule_id: str, req: RunRequest):
        if find(rule_id) is None:
            return _error(404, f"No automation {rule_id[:60]!r}")
        try:
            return engine.run_button(rule_id, req.path)
        except RuleRefused as exc:
            if exc.status == 423:
                return _locked(exc.detail)
            return _error(exc.status, exc.detail)

    @r.get("/automations/{rule_id}/runs")
    def get_runs(rule_id: str, limit: int = Query(default=200, ge=1, le=200)):
        if find(rule_id) is None:
            return _error(404, f"No automation {rule_id[:60]!r}")
        return {"runs": engine.runs(rule_id, limit)}

    return r
