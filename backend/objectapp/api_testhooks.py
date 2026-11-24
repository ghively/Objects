"""The ``/_test`` routes `create_app` mounts only under the fake notifier
(``OBJECT_FAKE_NOTIFY_FILE``), once inline in `server.py`:

- ``POST /api/_test/tick`` -> run one reminder check and one automation schedule tick at
  the clock's instant; with the fake notifier it also answers the queued agent jobs.
- ``POST /api/_test/agent-schedules/idle`` -> wait up to 30 s until no agent schedule job
  is queued or running (M21).
- ``POST /api/_test/automations/idle`` -> wait up to 10 s until the automation trigger
  queue is empty.
- ``POST /api/_test/reviews/idle`` -> wait up to 10 s until no background review runs (M18).
- ``POST /api/_test/curator/tick`` -> run one curator tick at the clock's instant (M18)."""

from __future__ import annotations

from fastapi import APIRouter

from .automations import AutomationEngine
from .curator import Curator
from .reminders import ReminderScheduler
from .reviews import ReviewRunner
from .space import Space

__all__ = ["router"]


def router(space: Space, scheduler: ReminderScheduler, automations: AutomationEngine,
reviews: ReviewRunner, curator: Curator) -> APIRouter:
    """The test hooks over the app's own services (registered only under the fake notifier)."""

    r = APIRouter()

    @r.post("/_test/tick")
    def test_tick():
        """Run one reminder check and one automation schedule tick at the clock's instant
        (test hook only)."""
        now = space.clock()
        fired = scheduler.tick(now)
        runs = automations.scheduler.tick(now)
        return {
            "fired": [
                {"path": d.path, "title": d.title, "body": d.body, "trigger": d.trigger.isoformat()}
                for d in fired
            ],
            "automationRuns": runs,
            "agentJobs": automations.agent_jobs.pending(),
        }

    @r.post("/_test/agent-schedules/idle")
    def test_agent_schedules_idle():
        """Wait up to 30 s until no agent schedule job is queued or running (M21 test hook)."""
        return {"idle": automations.agent_jobs.wait_idle(30.0)}

    @r.post("/_test/automations/idle")
    def test_automations_idle():
        """Wait up to 10 s until the automation trigger queue is empty (test hook only)."""
        return {"idle": automations.wait_idle(10.0)}

    @r.post("/_test/reviews/idle")
    def test_reviews_idle():
        """Wait up to 10 s until no background review runs (M18 test hook only)."""
        return {"idle": reviews.wait_idle(10.0)}

    @r.post("/_test/curator/tick")
    async def test_curator_tick():
        """Run one curator tick at the clock's instant (M18 test hook only)."""
        return {"agents": await curator.tick()}


    return r
