"""M14 T1: the rule file's shape (`automations_model`); the engine has its own tests."""

from __future__ import annotations

import pytest
from objectapp.automations_model import (
    AutomationRule,
    CreateFromTemplateAction,
    ScheduleTrigger,
    origin_for,
)
from pydantic import ValidationError


def _rule(**over):
    data = {
        "name": "Stamp completion",
        "trigger": {
            "kind": "propertyChanged",
            "scope": {"kind": "type", "id": "task"},
            "propertyKey": "status",
            "to": {"type": "filter", "propertyId": "status", "option": "contains", "referenceValue": ["done"]},
        },
        "actions": [{"kind": "setProperty", "key": "completedOn", "now": True}],
    }
    data.update(over)
    return data


def test_round_trip_keeps_unknown_keys_and_drops_api_only_ones():
    rule = AutomationRule.model_validate(
        {**_rule(), "id": "01J", "revision": "r", "readOnlyReason": None, "lastRun": None, "later": [1]}
    )
    out = rule.to_json()
    assert out["schemaVersion"] == 1 and out["enabled"] is True
    assert out["conditions"] == {"type": "filterGroup", "operator": "and", "elements": []}
    assert out["trigger"]["to"] == {
        "type": "filter",
        "propertyId": "status",
        "option": "contains",
        "referenceValue": ["done"],
    }
    assert out["later"] == [1]
    assert not {"id", "revision", "readOnlyReason", "lastRun"} & out.keys()
    assert AutomationRule.model_validate(out).to_json() == out


def test_unknown_kinds_and_versions_are_refused():
    with pytest.raises(ValidationError):
        AutomationRule.model_validate(_rule(actions=[{"kind": "sendEmail"}]))
    with pytest.raises(ValidationError):
        AutomationRule.model_validate(_rule(schemaVersion=2))
    with pytest.raises(ValidationError):
        AutomationRule.model_validate(_rule(name="   "))
    with pytest.raises(ValidationError):
        AutomationRule.model_validate(_rule(actions=[]))


def test_schedule_rules_take_no_conditions_and_no_object_actions():
    schedule = {"kind": "schedule", "repeat": "every week on monday", "time": "09:00", "start": "2026-11-09"}
    create = {"kind": "createFromTemplate", "typeId": "page", "templateId": "T1"}
    rule = AutomationRule.model_validate(_rule(trigger=schedule, actions=[create]))
    assert isinstance(rule.trigger, ScheduleTrigger)
    assert isinstance(rule.actions[0], CreateFromTemplateAction)
    with pytest.raises(ValidationError):
        AutomationRule.model_validate(_rule(trigger=schedule))  # setProperty
    with pytest.raises(ValidationError):
        AutomationRule.model_validate(_rule(trigger={**schedule, "time": "9:00"}, actions=[create]))
    with pytest.raises(ValidationError):
        AutomationRule.model_validate(
            _rule(
                trigger=schedule,
                actions=[create],
                conditions={"type": "filterGroup", "operator": "and",
                            "elements": [{"type": "filter", "propertyId": "tags", "option": "isEmpty"}]},
            )
        )


def test_template_repeat_must_be_a_schedule_creating_that_template():
    schedule = {"kind": "schedule", "repeat": "every day", "time": "08:30", "start": "2026-11-05"}
    create = {"kind": "createFromTemplate", "typeId": "page", "templateId": "T1"}
    ok = _rule(trigger=schedule, actions=[create], templateRepeat={"typeId": "page", "templateId": "T1"})
    assert AutomationRule.model_validate(ok).templateRepeat is not None
    with pytest.raises(ValidationError):
        AutomationRule.model_validate({**ok, "templateRepeat": {"typeId": "page", "templateId": "T2"}})


def test_conditions_nest_three_deep_at_most():
    leaf = {"type": "filter", "propertyId": "tags", "option": "isEmpty"}
    g3 = {"type": "filterGroup", "operator": "or", "elements": [leaf]}
    g2 = {"type": "filterGroup", "operator": "and", "elements": [g3]}
    AutomationRule.model_validate(_rule(conditions={"type": "filterGroup", "operator": "and", "elements": [g2]}))
    g4 = {"type": "filterGroup", "operator": "and", "elements": [{**g2}]}
    with pytest.raises(ValidationError):
        AutomationRule.model_validate(_rule(conditions={"type": "filterGroup", "operator": "and", "elements": [g4]}))


def test_set_now_takes_no_value_and_to_filters_its_own_key():
    with pytest.raises(ValidationError):
        AutomationRule.model_validate(
            _rule(actions=[{"kind": "setProperty", "key": "d", "now": True, "value": "x"}])
        )
    bad_to = _rule()
    bad_to["trigger"]["to"]["propertyId"] = "priority"
    with pytest.raises(ValidationError):
        AutomationRule.model_validate(bad_to)


def test_origin():
    assert origin_for("01JABC") == "automation:01JABC"
