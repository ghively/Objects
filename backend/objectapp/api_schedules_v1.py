"""The ``/api/v1/agent/schedules`` routes behind the ``schedule_manage`` agent tool (M21, spec
section 9), through `v1guard.agent_auth` (plan `docs/superpowers/plans/2026-11-05-m21-schedules.md`,
"Agent-facing shape and routes").

- ``GET    /v1/agent/schedules`` -> ``{schedules: ScheduleV1[]}`` (this agent's, by name
  (casefold), then id).
- ``POST   /v1/agent/schedules`` ``ScheduleCreateV1`` -> 201 ``ScheduleV1``.
- ``PUT    /v1/agent/schedules/{id}`` ``ScheduleUpdateV1`` -> ``ScheduleV1`` (saved on the rule's
  current revision, read in the same request; a 409 retries once).
- ``DELETE /v1/agent/schedules/{id}`` -> ``{trashId}`` (the space's Trash, restorable).

Each route acts only for the token's agent in the token's space and calls
`v1guard.agent_tool_allowed` for ``schedule_manage``. The write routes refuse a token whose scope
isn't ``read-write`` (and run `v1guard.WRITE_GUARDS`) as `V1Guard.auth` does, without spending a
second tool step. Another agent's schedule, or a rule that isn't an agent schedule, is a 404.
Writes go through the `AutomationEngine` passed to `router`, so M14's validation, events and
Trash apply; they are announced with origin ``api:<token name>`` and kept in the activity log.
Imports no network client.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .agentschedules import default_start, rule_payload, schedule_v1
from .apictx import ApiContext
from .automations_model import agent_action
from .localtime import to_local
from .propvalues import InvalidValue
from .recurrence import week_start_of
from .space import ReadOnly
from .tokens import TokenRecord, TokenStore
from .typemodel import RevisionConflict
from .v1guard import WRITE_GUARDS, Denied, V1Guard, agent_auth, agent_tool_allowed, guarded

if TYPE_CHECKING:
    from .automations import AutomationEngine, LoadedRule

__all__ = ["TOOL", "ScheduleCreateV1", "ScheduleUpdateV1", "ScheduleV1", "router"]

TOOL = "schedule_manage"


class ScheduleV1(BaseModel):
    """What ``schedule_manage`` answers for one schedule."""

    id: str
    name: str
    prompt: str
    repeat: str
    time: str
    start: str
    model: str | None
    enabled: bool
    readOnlyReason: str | None
    lastRun: dict[str, Any] | None
    nextRun: str | None


class ScheduleCreateV1(BaseModel):
    name: str
    prompt: str
    repeat: str
    time: str = "09:00"  # M14's default
    start: str | None = None  # None: agentschedules.default_start
    model: str | None = None
    enabled: bool = True


class ScheduleUpdateV1(BaseModel):
    """Every field optional; absent = unchanged."""

    name: str | None = None
    prompt: str | None = None
    repeat: str | None = None
    time: str | None = None
    start: str | None = None
    model: str | None = None
    clearModel: bool = False
    enabled: bool | None = None


def _not_found(rule_id: str) -> Denied:
    return Denied(404, f"No schedule {rule_id[:60]!r}.")  # our string


def router(ctx: ApiContext, engine: AutomationEngine) -> APIRouter:
    """The agent schedule v1 routes, mounted on the app's ``/api`` router (so no prefix here)."""
    from .agents import AgentRecord, AgentRegistry

    space = ctx.space
    guard = V1Guard(ctx, TokenStore(space.root))
    r = APIRouter()

    def auth(request: Request, write: bool = False) -> tuple[TokenRecord, AgentRecord]:
        token, agent = agent_auth(guard, AgentRegistry(), request)
        agent_tool_allowed(token, TOOL)
        if write:  # V1Guard.auth's write checks; the step was spent by agent_auth
            if token.scope != "read-write":
                raise Denied(403, "This token can only read.")
            for check in list(WRITE_GUARDS):
                message = check(token, request)
                if message:
                    raise Denied(403, message)
        return token, agent

    def owned(lr: LoadedRule | None, agent_id: str) -> bool:
        """Whether ``lr`` is an agent schedule of ``agent_id`` (a read-only file: by what it holds)."""
        if lr is None:
            return False
        if lr.rule is not None:
            action = agent_action(lr.rule)
            return action is not None and action.agentId == agent_id
        acts = (lr.data or {}).get("actions")
        if not isinstance(acts, list) or not acts or not isinstance(acts[0], dict):
            return False
        return acts[0].get("kind") == "runAgent" and acts[0].get("agentId") == agent_id

    def find(rule_id: str, agent_id: str) -> LoadedRule:
        lr = engine.rules.get(rule_id)
        if lr is None or not owned(lr, agent_id):
            raise _not_found(rule_id)
        return lr

    def shape(lr: LoadedRule) -> dict[str, Any]:
        now = space.clock()
        return schedule_v1(lr, engine.last_run(lr.id), now, space.tz, week_start_of(space.root))

    def today() -> Any:
        now: datetime = space.clock()
        return to_local(now, space.tz).date()

    # -- list ---------------------------------------------------------------------------

    @r.get("/v1/agent/schedules")
    @guarded
    def list_schedules(request: Request):
        _token, agent = auth(request)
        mine = [lr for lr in engine.rules.all() if owned(lr, agent.id)]
        out = [shape(lr) for lr in mine]
        out.sort(key=lambda s: (s["name"].casefold(), s["id"]))
        return {"schedules": out}

    # -- create -------------------------------------------------------------------------

    @r.post("/v1/agent/schedules", status_code=201)
    @guarded
    def create_schedule(req: ScheduleCreateV1, request: Request):
        token, agent = auth(request, write=True)
        start = req.start or default_start(req.repeat, today(), space.tz, week_start_of(space.root))
        payload = rule_payload(
            agent.id, name=req.name, prompt=req.prompt, repeat=req.repeat, time=req.time, start=start,
            model=req.model, enabled=req.enabled,
        )
        try:
            lr = engine.create(payload)
        except InvalidValue as exc:
            raise Denied(422, str(exc)) from exc
        guard.announce("automations", lr.id, lr.revision, token)
        guard.log(token, "create-schedule", lr.id)
        return JSONResponse(shape(lr), status_code=201)

    # -- update -------------------------------------------------------------------------

    def updated(lr: LoadedRule, agent_id: str, req: ScheduleUpdateV1) -> dict[str, Any]:
        rule = lr.rule
        if rule is None:
            raise Denied(423, lr.read_only_reason or "This schedule can't be read.")
        action = agent_action(rule)
        trigger = rule.trigger
        assert action is not None
        model = None if req.clearModel else (req.model if req.model is not None else action.model)
        payload = rule_payload(
            agent_id,
            name=req.name if req.name is not None else rule.name,
            prompt=req.prompt if req.prompt is not None else action.prompt,
            repeat=req.repeat if req.repeat is not None else trigger.repeat,  # type: ignore[union-attr]
            time=req.time if req.time is not None else trigger.time,  # type: ignore[union-attr]
            start=req.start if req.start is not None else trigger.start,  # type: ignore[union-attr]
            model=model,
            enabled=req.enabled if req.enabled is not None else rule.enabled,
        )
        payload["description"] = rule.description
        return payload

    @r.put("/v1/agent/schedules/{rule_id}")
    @guarded
    def update_schedule(rule_id: str, req: ScheduleUpdateV1, request: Request):
        token, agent = auth(request, write=True)
        for attempt in (1, 2):
            lr = find(rule_id, agent.id)
            payload = updated(lr, agent.id, req)
            try:
                saved = engine.save(rule_id, payload, lr.revision)
            except KeyError as exc:
                raise _not_found(rule_id) from exc
            except ReadOnly as exc:
                raise Denied(423, exc.reason) from exc
            except RevisionConflict as exc:
                if attempt == 2:
                    raise Denied(409, "This schedule changed while it was being saved.") from exc  # our string
                continue
            except InvalidValue as exc:
                raise Denied(422, str(exc)) from exc
            guard.announce("automations", rule_id, saved.revision, token)
            guard.log(token, "update-schedule", rule_id)
            return shape(saved)
        raise AssertionError("unreachable")

    # -- delete -------------------------------------------------------------------------

    @r.delete("/v1/agent/schedules/{rule_id}")
    @guarded
    def delete_schedule(rule_id: str, request: Request):
        token, agent = auth(request, write=True)
        find(rule_id, agent.id)
        try:
            trash_id = engine.delete(rule_id)
        except KeyError as exc:
            raise _not_found(rule_id) from exc
        except ReadOnly as exc:
            raise Denied(423, exc.reason) from exc
        guard.announce("automations", rule_id, None, token)
        guard.log(token, "delete-schedule", rule_id)
        return {"trashId": trash_id}

    return r
