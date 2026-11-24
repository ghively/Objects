"""The UI-state routes (the sidebar, calendar, tasks, graph and whiteboard display
settings in ``ui.json``), mounted on ``/api`` (once inline in `server.py`):

- ``GET /api/ui`` -> ``{ui, revision, readOnlyReason?}`` (the saved state over the
  defaults).
- ``PUT /api/ui`` ``{patch, baseRevision, clientId?}`` -> the same after the write;
  ``422`` an unknown key or a bad shape, ``409 {currentRevision}``, ``423``.
  Announces ``ui``."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .apictx import ApiContext
from .space import ReadOnly
from .typemodel import RevisionConflict
from .uistate import patch_ui, read_ui, ui_read_only_reason, ui_with_defaults
from .watcher import ChangeEvent
from .whiteboardstore import whiteboard_ui_problem

__all__ = ["router"]


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"detail": message}, status_code=status)


class PatchUiRequest(BaseModel):
    patch: dict[str, Any]
    baseRevision: str = ""
    clientId: str | None = None


_UI_PATCH_KEYS = frozenset(
    {
        "pinned", "sections", "allNotesLayout", "calendar", "tasks", "reminders", "graph",
        "whiteboard", "workspaceOrder", "objectsSectionSortOption", "workspace",
    }
)  # fmt: skip
# The graph view customisation keys.
_GRAPH_LIST_KEYS = ("filterTypeIds", "excludeTypeIds")
_GRAPH_BOOL_KEYS = (
    "showCompletedTasks",
    "showMinimalNodes",
    "hideLargeNodes",
    "hideDates",
    "hideIndirectLinks",
    "showTagsNetwork",
    "showSpaceTagsNetwork",
)
_WEEK_STARTS = ("sunday", "monday")
_CALENDAR_HIDE_KEYS = (
    "hideDailyNote",
    "hideTasks",
    "hideDated",
    "hideCreatedOnDay",
    "hideUpdated",
    "hideCreateObjects",
)
_CALENDAR_VIEW_KEYS = ("tasksView", "createdView", "updatedView", "datedView")
_TASK_SECTION_KEYS = frozenset(
    {
        "status",
        "today",
        "inbox",
        "open",
        "deadline",
        "scheduled",
        "recurring",
        "reminders",
        "tags",
        "completed",
        "source",
        "all",
    }
)


def _ui_problem(patch: dict[str, Any]) -> str | None:
    """Why a PUT /api/ui patch has the wrong shape, else None."""
    if "pinned" in patch:
        pinned = patch["pinned"]
        if not isinstance(pinned, list) or not all(
            isinstance(p, dict) and isinstance(p.get("kind"), str) and isinstance(p.get("id"), str)
            for p in pinned
        ):
            return 'The key "pinned" must be a list of {kind, id}.'
    if "sections" in patch:
        sections = patch["sections"]
        if not isinstance(sections, list) or not all(
            isinstance(x, dict) and isinstance(x.get("items", []), list) for x in sections
        ):
            return 'The key "sections" must be a list of sections with a list of items.'
    if "allNotesLayout" in patch and not isinstance(patch["allNotesLayout"], str):
        return 'The key "allNotesLayout" must be a string.'
    if "calendar" in patch:
        problem = _calendar_ui_problem(patch["calendar"])
        if problem:
            return problem
    if "tasks" in patch:
        problem = _tasks_ui_problem(patch["tasks"])
        if problem:
            return problem
    if "reminders" in patch:
        reminders = patch["reminders"]
        if not isinstance(reminders, dict) or not isinstance(reminders.get("enabled"), bool):
            return 'The key "reminders" must be {enabled: true|false}.'
    if "graph" in patch:
        problem = _graph_ui_problem(patch["graph"])
        if problem:
            return problem
    if "whiteboard" in patch:
        problem = whiteboard_ui_problem(patch["whiteboard"])
        if problem:
            return problem
    if "workspaceOrder" in patch:
        order = patch["workspaceOrder"]
        if not isinstance(order, list) or not all(isinstance(x, str) for x in order):
            return 'The key "workspaceOrder" must be a list of section ids.'
        if len(set(order)) != len(order):
            return 'The key "workspaceOrder" lists a section twice.'
    # The Object Types sort (``ui.json`` ``objectsSectionSortOption``) and its manual order, kept
    # as the `objects` section's ids in ``ui.json`` ``workspace``.
    if "objectsSectionSortOption" in patch and patch["objectsSectionSortOption"] not in (
        "alphabetical",
        "manual",
    ):
        return 'The key "objectsSectionSortOption" must be alphabetical or manual.'
    if "workspace" in patch:
        ws = patch["workspace"]
        if not isinstance(ws, dict):
            return 'The key "workspace" must be an object.'
        unknown = sorted(set(ws) - {"objects"})
        if unknown:
            return f"The UI state has no key named {', '.join(f'workspace.{k}' for k in unknown)}."
        objects = ws.get("objects", {})
        ids = objects.get("ids", []) if isinstance(objects, dict) else None
        if not isinstance(ids, list) or not all(isinstance(x, str) for x in ids):
            return 'The key "workspace.objects.ids" must be a list of ids.'
        if len(set(ids)) != len(ids):
            return 'The key "workspace.objects.ids" lists an id twice.'
    return None


def _graph_ui_problem(graph: Any) -> str | None:
    """Why a ``graph`` ui patch is not a ``GraphViewCustomization``, else None."""
    if not isinstance(graph, dict):
        return 'The key "graph" must be an object.'
    unknown = sorted(set(graph) - set(_GRAPH_LIST_KEYS) - set(_GRAPH_BOOL_KEYS))
    if unknown:
        return f"The UI state has no key named {', '.join(f'graph.{k}' for k in unknown)}."
    for key in _GRAPH_LIST_KEYS:
        if key in graph and not (
            isinstance(graph[key], list) and all(isinstance(x, str) for x in graph[key])
        ):
            return f'The key "graph.{key}" must be a list of type ids.'
    for key in _GRAPH_BOOL_KEYS:
        if key in graph and not isinstance(graph[key], bool):
            return f'The key "graph.{key}" must be true or false.'
    return None


def _calendar_ui_problem(cal: Any) -> str | None:
    """Why a ``calendar`` ui patch is not a ``CalendarUi``, else None."""
    if not isinstance(cal, dict):
        return 'The key "calendar" must be an object.'
    if "weekStart" in cal and cal["weekStart"] not in _WEEK_STARTS:
        return 'The key "calendar.weekStart" must be sunday or monday.'
    if "hideCalendarSidebar" in cal and not isinstance(cal["hideCalendarSidebar"], bool):
        return 'The key "calendar.hideCalendarSidebar" must be true or false.'
    if "daily" in cal:
        daily = cal["daily"]
        if not isinstance(daily, dict):
            return 'The key "calendar.daily" must be an object.'
        for key in _CALENDAR_HIDE_KEYS:
            if key in daily and not isinstance(daily[key], bool):
                return f'The key "calendar.daily.{key}" must be true or false.'
        for key in _CALENDAR_VIEW_KEYS:
            if key in daily and not isinstance(daily[key], dict):
                return f'The key "calendar.daily.{key}" must be a view state object.'
    return None


def _tasks_ui_problem(tasks: Any) -> str | None:
    """Why a ``tasks`` ui patch is not a ``TasksUi``, else None."""
    if not isinstance(tasks, dict):
        return 'The key "tasks" must be an object.'
    if "activeTab" in tasks and tasks["activeTab"] not in _TASK_SECTION_KEYS:
        return 'The key "tasks.activeTab" must be a task section key.'
    if "views" in tasks:
        views = tasks["views"]
        if not isinstance(views, dict) or not all(
            k in _TASK_SECTION_KEYS and isinstance(v, dict) for k, v in views.items()
        ):
            return 'The key "tasks.views" must map task section keys to view state objects.'
    return None


def router(ctx: ApiContext) -> APIRouter:
    """The UI-state routes."""
    space = ctx.space
    announce = ctx.announce

    r = APIRouter()

    @r.get("/ui")
    def get_ui():
        data, revision = read_ui(space.root)
        out: dict[str, Any] = {"ui": ui_with_defaults(data), "revision": revision}
        reason = ui_read_only_reason(space.root)
        if reason:
            out["readOnlyReason"] = reason
        return out

    @r.put("/ui")
    def put_ui(req: PatchUiRequest):
        unknown = sorted(set(req.patch) - _UI_PATCH_KEYS)
        if unknown:
            return _error(422, f"The UI state has no key named {', '.join(unknown)}.")
        problem = _ui_problem(req.patch)
        if problem:
            return _error(422, problem)
        try:
            data, revision = patch_ui(space, req.patch, req.baseRevision)
        except RevisionConflict as exc:
            return JSONResponse({"currentRevision": exc.current_revision}, status_code=409)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        announce(ChangeEvent("ui", "ui.json", revision, origin=req.clientId))
        return {"ui": ui_with_defaults(data), "revision": revision}


    return r
