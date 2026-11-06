"""M14 automations: the shape of one rule file (``.object/automations/<id>.json``).

Pydantic models only (T1 contract, `docs/superpowers/plans/2026-11-05-m14-automations.md`);
the engine, scheduler, catch-up, run log and routes are `automations.py` (Lane B).

A rule file holds ``{schemaVersion, name, description, enabled, trigger, conditions,
actions, templateRepeat, createdAt}``. Its id is its file name (a ULID), never a key in
the JSON. The API adds ``id``, ``revision``, ``readOnlyReason`` and ``lastRun``; those are
never written to the file. Unknown top-level keys are kept (`extra="allow"`), as the other
definition files keep theirs. A trigger or action of a kind this version doesn't know fails
validation, so such a file loads read-only and never runs.

Shape checks live here; checks that need the space (does the type, property, template or
collection exist, does a value suit its property, does ``repeat`` parse) are the engine's.
"""

from __future__ import annotations

import re
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SerializerFunctionWrapHandler,
    field_validator,
    model_serializer,
    model_validator,
)

from .agentmodel import AGENT_ID
from .aimodels import clean_model

__all__ = [
    "ACTION_KINDS",
    "AGENT_ACTION_KINDS",
    "API_ONLY_KEYS",
    "MAX_ACTIONS",
    "MAX_NAME",
    "MAX_PROMPT",
    "OBJECT_ACTION_KINDS",
    "SCHEMA_VERSION",
    "TRIGGER_KINDS",
    "Action",
    "AddTagAction",
    "AddToCollectionAction",
    "AppendToDailyNoteAction",
    "AutomationRule",
    "ButtonTrigger",
    "ClearPropertyAction",
    "CreateFromTemplateAction",
    "FilterGroupModel",
    "FilterModel",
    "NotifyAction",
    "ObjectCreatedTrigger",
    "PropertyChangedTrigger",
    "RemoveFromCollectionAction",
    "RemoveTagAction",
    "RunAgentAction",
    "ScheduleTrigger",
    "Scope",
    "SetPropertyAction",
    "TemplateRepeat",
    "Trigger",
    "agent_action",
    "origin_for",
]

SCHEMA_VERSION = 1
MAX_NAME = 100
"""Characters in a rule's name (our choice)."""
MAX_ACTIONS = 20
"""Actions in one rule (our choice)."""
MAX_TEXT = 2000
"""Characters in an action's text fields (title, line, notification) (our choice)."""
MAX_PROMPT = 20_000
"""Characters in an agent schedule's prompt (M21, our choice)."""
MAX_FILTER_DEPTH = 3
"""Nesting of condition groups, the top group counting as 1 (our choice)."""

API_ONLY_KEYS = frozenset({"id", "revision", "readOnlyReason", "lastRun"})
"""Keys the API adds to a rule and a save ignores."""

_HHMM = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


def origin_for(rule_id: str) -> str:
    """The `ChangeEvent.origin` (and write origin) of a rule's own writes."""
    return f"automation:{rule_id}"


# -- conditions: the view filter-group shape (`api/types.ts` `FilterGroup`) -----------------


class FilterModel(_Strict):
    type: Literal["filter"] = "filter"
    propertyId: str
    option: str
    referenceValue: Any = None
    structureId: str | None = None

    @model_serializer(mode="wrap")
    def _omit_absent(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        # As the view JSON writes a filter: no `referenceValue`/`structureId` when unset.
        out = handler(self)
        for key in ("referenceValue", "structureId"):
            if out.get(key) is None:
                out.pop(key, None)
        return out


class FilterGroupModel(_Strict):
    type: Literal["filterGroup"] = "filterGroup"
    operator: Literal["and", "or"] = "and"
    elements: list[Annotated[FilterModel | FilterGroupModel, Field(discriminator="type")]] = Field(
        default_factory=list
    )

    def depth(self) -> int:
        return 1 + max(
            (e.depth() for e in self.elements if isinstance(e, FilterGroupModel)), default=0
        )

    def is_empty(self) -> bool:
        return not self.elements


# -- triggers ------------------------------------------------------------------------------


class Scope(_Strict):
    """The objects a trigger watches: a type's, or a collection's (by id)."""

    kind: Literal["type", "collection"]
    id: str = Field(min_length=1)


class ObjectCreatedTrigger(_Strict):
    """An object is created in the scope (a collection scope: also added to it)."""

    kind: Literal["objectCreated"]
    scope: Scope


class PropertyChangedTrigger(_Strict):
    """``propertyKey`` changes on an object in the scope: to any value (``to`` null), or
    into matching the filter ``to`` (it didn't match before the write, it does after)."""

    kind: Literal["propertyChanged"]
    scope: Scope
    propertyKey: str = Field(min_length=1)
    to: FilterModel | None = None

    @model_validator(mode="after")
    def _to_is_on_the_key(self) -> PropertyChangedTrigger:
        if self.to is not None and self.to.propertyId != self.propertyKey:
            raise ValueError("'to' must filter the trigger's own property")
        return self


class ScheduleTrigger(_Strict):
    """Runs at ``time`` (space time zone) on ``start`` and each later day the M8 ``repeat``
    text reaches from it (`taskmodel.parse_repeat`, by due date only)."""

    kind: Literal["schedule"]
    repeat: str = Field(min_length=1)
    time: str = "09:00"
    start: str

    @field_validator("time")
    @classmethod
    def _hhmm(cls, v: str) -> str:
        if not _HHMM.match(v):
            raise ValueError("time must be HH:mm")
        return v

    @field_validator("start")
    @classmethod
    def _day(cls, v: str) -> str:
        if not _DAY.match(v):
            raise ValueError("start must be YYYY-MM-DD")
        return v


class ButtonTrigger(_Strict):
    """Run by hand on one object (a button block or a Button property). ``scope`` null:
    any object."""

    kind: Literal["button"]
    scope: Scope | None = None


Trigger = Annotated[
    ObjectCreatedTrigger | PropertyChangedTrigger | ScheduleTrigger | ButtonTrigger,
    Field(discriminator="kind"),
]
TRIGGER_KINDS = ("objectCreated", "propertyChanged", "schedule", "button")


# -- actions -------------------------------------------------------------------------------


class SetPropertyAction(_Strict):
    """Set ``key`` to ``value`` (the API value form of `PUT /api/object/properties`), or with
    ``now`` to the run's instant (a date property; a day-only date takes the local day)."""

    kind: Literal["setProperty"]
    key: str = Field(min_length=1)
    value: Any = None
    now: bool = False

    @model_validator(mode="after")
    def _now_has_no_value(self) -> SetPropertyAction:
        if self.now and self.value is not None:
            raise ValueError("a 'now' action takes no value")
        return self


class ClearPropertyAction(_Strict):
    kind: Literal["clearProperty"]
    key: str = Field(min_length=1)


class AddTagAction(_Strict):
    """Add the Tag object with this id (its title goes in ``tags:``)."""

    kind: Literal["addTag"]
    tagId: str = Field(min_length=1)


class RemoveTagAction(_Strict):
    kind: Literal["removeTag"]
    tagId: str = Field(min_length=1)


class AddToCollectionAction(_Strict):
    kind: Literal["addToCollection"]
    collectionId: str = Field(min_length=1)


class RemoveFromCollectionAction(_Strict):
    kind: Literal["removeFromCollection"]
    collectionId: str = Field(min_length=1)


class CreateFromTemplateAction(_Strict):
    """Create an object of ``typeId`` (``templateId`` null: the type's default template,
    ``"none"``: no template). ``title`` takes placeholders; empty: the template's title.
    ``relateVia``: a relation property key of the new object's type, set to the triggering
    object (null: not related)."""

    kind: Literal["createFromTemplate"]
    typeId: str = Field(min_length=1)
    templateId: str | None = None
    title: str = Field(default="", max_length=MAX_TEXT)
    relateVia: str | None = None


class AppendToDailyNoteAction(_Strict):
    """Append ``text`` (placeholders expanded; may hold several lines) to the end of the
    daily note of the run's local day, creating that note when it is missing."""

    kind: Literal["appendToDailyNote"]
    text: str = Field(min_length=1, max_length=MAX_TEXT)


class NotifyAction(_Strict):
    """A local notification (`notify.py`); placeholders expanded. Empty title: the rule's name."""

    kind: Literal["notify"]
    title: str = Field(default="", max_length=MAX_TEXT)
    body: str = Field(default="", max_length=MAX_TEXT)


class RunAgentAction(_Strict):
    """M21: run ``prompt`` as a new chat of the agent ``agentId`` (an agent schedule). ``model``
    null: the agent's default. Only as a schedule rule's one action (`AutomationRule._shape`)."""

    kind: Literal["runAgent"]
    agentId: str = Field(pattern=AGENT_ID)
    prompt: str
    model: str | None = None

    @field_validator("prompt")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()

    @field_validator("model", mode="before")
    @classmethod
    def _model(cls, v: Any) -> str | None:
        return clean_model(v)  # ValueError(aimodels.BAD_MODEL)


Action = Annotated[
    SetPropertyAction
    | ClearPropertyAction
    | AddTagAction
    | RemoveTagAction
    | AddToCollectionAction
    | RemoveFromCollectionAction
    | CreateFromTemplateAction
    | AppendToDailyNoteAction
    | NotifyAction
    | RunAgentAction,
    Field(discriminator="kind"),
]
ACTION_KINDS = (
    "setProperty",
    "clearProperty",
    "addTag",
    "removeTag",
    "addToCollection",
    "removeFromCollection",
    "createFromTemplate",
    "appendToDailyNote",
    "notify",
    # M21, at the end so the slice below is unchanged
    "runAgent",
)
OBJECT_ACTION_KINDS = frozenset(ACTION_KINDS[:6])
"""Actions that edit the triggering object (one write per run; refused on schedule rules)."""
AGENT_ACTION_KINDS = frozenset({"runAgent"})
"""Actions that run an agent (M21): an agent schedule's one action."""


# -- the rule ------------------------------------------------------------------------------


class TemplateRepeat(_Strict):
    """Marks the rule a template's "Repeat" option made (one per template)."""

    typeId: str = Field(min_length=1)
    templateId: str = Field(min_length=1)


class AutomationRule(BaseModel):
    """One rule file. Unknown top-level keys are kept; the API-only keys are dropped."""

    model_config = ConfigDict(extra="allow")

    schemaVersion: Literal[1] = SCHEMA_VERSION
    name: str = Field(min_length=1, max_length=MAX_NAME)
    description: str = ""
    enabled: bool = True
    trigger: Trigger
    conditions: FilterGroupModel = Field(default_factory=FilterGroupModel)
    actions: list[Action] = Field(min_length=1, max_length=MAX_ACTIONS)
    templateRepeat: TemplateRepeat | None = None
    createdAt: str | None = None
    """ISO UTC instant the rule was made (set by the server on create)."""

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("A rule needs a name")
        return v

    @model_validator(mode="before")
    @classmethod
    def _drop_api_only(cls, data: Any) -> Any:
        if isinstance(data, dict):
            data = {k: v for k, v in data.items() if k not in API_ONLY_KEYS}
        return data

    @model_validator(mode="after")
    def _shape(self) -> AutomationRule:
        if self.conditions.depth() > MAX_FILTER_DEPTH:
            raise ValueError(f"Conditions nest at most {MAX_FILTER_DEPTH} groups deep")
        if any(a.kind in AGENT_ACTION_KINDS for a in self.actions):
            # M21's agent schedules (our strings).
            if not isinstance(self.trigger, ScheduleTrigger):
                raise ValueError("An agent schedule runs on a schedule.")
            if len(self.actions) != 1:
                raise ValueError("An agent schedule has exactly one action.")
            if self.templateRepeat is not None:
                raise ValueError("An agent schedule can't repeat a template.")
            action = self.actions[0]
            assert isinstance(action, RunAgentAction)
            if not action.prompt:
                raise ValueError("A schedule needs a prompt.")
            if len(action.prompt) > MAX_PROMPT:
                raise ValueError(f"The prompt is too long (at most {MAX_PROMPT:,} characters).")
        if isinstance(self.trigger, ScheduleTrigger):
            if not self.conditions.is_empty():
                raise ValueError("A scheduled rule has no conditions")
            for a in self.actions:
                if a.kind in OBJECT_ACTION_KINDS:
                    raise ValueError("A scheduled rule has no object to edit")
                if isinstance(a, CreateFromTemplateAction) and a.relateVia is not None:
                    raise ValueError("A scheduled rule has no object to relate to")
        if self.templateRepeat is not None:
            tr = self.templateRepeat
            ok = (
                isinstance(self.trigger, ScheduleTrigger)
                and len(self.actions) == 1
                and isinstance(self.actions[0], CreateFromTemplateAction)
                and self.actions[0].typeId == tr.typeId
                and self.actions[0].templateId == tr.templateId
            )
            if not ok:
                raise ValueError(
                    "A template's repeat is a schedule with one create-from-template action"
                )
        return self

    def to_json(self) -> dict[str, Any]:
        """The file's JSON: the declared keys in order, then the kept unknown ones."""
        return self.model_dump(mode="json")


def agent_action(rule: AutomationRule) -> RunAgentAction | None:
    """The rule's ``runAgent`` action (an M21 agent schedule), or None."""
    for a in rule.actions:
        if isinstance(a, RunAgentAction):
            return a
    return None


