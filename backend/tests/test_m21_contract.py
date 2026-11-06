"""M21 Task 1: the agent schedules contract (the ``runAgent`` action and its shape rules, the
``schedule_manage`` tool's catalogue row, the stub v1 router and the two M18 hooks)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from objectapp import agentschedules, agentskills, api_schedules_v1, reviews, server, toolcatalog
from objectapp.automations_model import (
    ACTION_KINDS,
    AGENT_ACTION_KINDS,
    MAX_PROMPT,
    OBJECT_ACTION_KINDS,
    AutomationRule,
    RunAgentAction,
    agent_action,
)
from objectapp.space import Space


def _rule(**over: Any) -> dict[str, Any]:
    rule: dict[str, Any] = {
        "name": "Weekly review",
        "trigger": {"kind": "schedule", "repeat": "every week on monday", "time": "09:00", "start": "2026-11-09"},
        "actions": [{"kind": "runAgent", "agentId": "assistant", "prompt": "Hi"}],
    }
    rule.update(over)
    return rule


def test_run_agent_shape() -> None:
    rule = AutomationRule.model_validate(_rule())
    action = rule.actions[0]
    assert isinstance(action, RunAgentAction)
    assert action.model is None
    assert ACTION_KINDS[-1] == "runAgent"
    assert OBJECT_ACTION_KINDS == frozenset(
        {"setProperty", "clearProperty", "addTag", "removeTag", "addToCollection", "removeFromCollection"}
    )
    assert AGENT_ACTION_KINDS == frozenset({"runAgent"})
    found = agent_action(rule)
    assert found is not None and found.prompt == "Hi"
    assert rule.to_json()["actions"][0] == {"kind": "runAgent", "agentId": "assistant", "prompt": "Hi", "model": None}
    ulid = AutomationRule.model_validate(
        _rule(actions=[{"kind": "runAgent", "agentId": "01JC7ZK3T9Q4M2X8B5N6R1V0WE", "prompt": "  Hi  ",
                        "model": " haiku "}])
    )
    assert agent_action(ulid).prompt == "Hi" and agent_action(ulid).model == "haiku"  # type: ignore[union-attr]
    notify = AutomationRule.model_validate(_rule(actions=[{"kind": "notify", "title": "x"}]))
    assert agent_action(notify) is None
    assert agentschedules.is_agent_schedule(rule) and not agentschedules.is_agent_schedule(notify)
    assert not agentschedules.is_agent_schedule(None)
    assert MAX_PROMPT == 20_000


@pytest.mark.parametrize(
    ("over", "message"),
    [
        ({"trigger": {"kind": "button", "scope": None}}, "An agent schedule runs on a schedule."),
        (
            {"actions": [{"kind": "runAgent", "agentId": "assistant", "prompt": "Hi"},
                         {"kind": "notify", "title": "x"}]},
            "An agent schedule has exactly one action.",
        ),
        ({"templateRepeat": {"typeId": "t", "templateId": "x"}}, "An agent schedule can't repeat a template."),
        ({"actions": [{"kind": "runAgent", "agentId": "assistant", "prompt": "   "}]}, "A schedule needs a prompt."),
        (
            {"actions": [{"kind": "runAgent", "agentId": "assistant", "prompt": "x" * 20_001}]},
            "The prompt is too long (at most 20,000 characters).",
        ),
        ({"actions": [{"kind": "runAgent", "agentId": "../x", "prompt": "Hi"}]}, "agentId"),
        ({"actions": [{"kind": "runAgent", "agentId": "assistant", "prompt": "Hi", "model": "-p"}]},
         "That isn't a model name."),
    ],
)
def test_run_agent_shape_errors(over: dict[str, Any], message: str) -> None:
    with pytest.raises(ValidationError) as exc:
        AutomationRule.model_validate(_rule(**over))
    assert message in str(exc.value)


def test_prompt_at_the_cap_is_fine() -> None:
    rule = AutomationRule.model_validate(_rule(actions=[{"kind": "runAgent", "agentId": "assistant",
                                                         "prompt": "x" * MAX_PROMPT}]))
    assert len(agent_action(rule).prompt) == MAX_PROMPT  # type: ignore[union-attr]


def test_agent_tool_listed() -> None:
    assert "schedule_manage" in toolcatalog.AGENT_TOOLS
    tools = toolcatalog.AGENT_TOOLS
    assert tools.index("schedule_manage") > tools.index("delegate")
    group = next(g for g in toolcatalog.catalogue() if g.id == "object-agent")
    assert group.label == "Object agent tools"
    row = next(t for t in group.tools if t.id == "mcp__object-agent__schedule_manage")
    assert row.label == "Schedules" and row.default_on


def test_stub_router_mounted(space_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[Any] = []
    real = api_schedules_v1.router

    def schedules_router(ctx: Any, engine: Any) -> Any:
        seen.append(engine)
        r = real(ctx, engine)
        # T1's router has no routes, so a probe route shows it is mounted under /api.
        r.add_api_route("/v1/agent/schedules-probe", lambda: {"probe": True}, methods=["GET"])
        return r

    monkeypatch.setattr(api_schedules_v1, "router", schedules_router)
    app = server.create_app(Space(space_dir), None, watch=False)
    app.state.hub.publish = lambda _e: None
    assert len(seen) == 1 and seen[0] is app.state.automations
    assert TestClient(app).get("/api/v1/agent/schedules-probe").json() == {"probe": True}


def test_m18_hooks(tmp_path: Path) -> None:
    assert "schedule" not in reviews.REVIEW_PURPOSES
    assert callable(agentskills.SCHEDULE_SKILLS)
    assert isinstance(agentskills.SCHEDULE_SKILLS(tmp_path), set)


def test_index_constants() -> None:
    assert agentschedules.INDEX_FILE == "agent-schedules.json"
    assert agentschedules.MAX_USED == 100
    assert issubclass(agentschedules.IndexUnreadable, Exception)
