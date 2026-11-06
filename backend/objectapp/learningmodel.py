"""M18's learning model: the constants, an agent's ``learning`` settings (``agent.json``), the
ledger entry and the ``usage.json`` schema (plan ``2026-11-05-m18-learning.md``, "Contract (T1)").

- `effective_learning` overlays `LEARNING_DEFAULTS` with the stored ``learning`` object's valid
  keys; anything missing, wrong-typed or out of range falls back to its default, so readers
  never trust what M17's ``PUT /agents/{id}`` stored verbatim.
- `clean_learning` checks a ``PUT /agents/{id}/learning`` body: known keys must be valid
  (`LearningInvalid`, 422), unknown keys are kept.

No network client, no file I/O.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from . import aimodels

__all__ = [
    "ARCHIVE_DAYS",
    "ARCHIVE_DIR",
    "CACHE_DB",
    "CURATOR_MAX_STEPS",
    "CURATOR_TICK",
    "ENTRY_SEPARATOR",
    "LEARNING_DEFAULTS",
    "LEARNING_RANGES",
    "LEDGER_FILE",
    "MEMORY_FILE",
    "REVIEW_CONCURRENCY",
    "REVIEW_MAX_STEPS",
    "SESSION_READ_CAP",
    "SKILLS_DIR",
    "SKILL_DESCRIPTION_MAX",
    "SKILL_MD_MAX",
    "SKILL_NAME",
    "SKILL_NAME_MAX",
    "STALE_DAYS",
    "SUPPORT_DIRS",
    "SUPPORT_FILE_MAX",
    "USAGE_FILE",
    "USER_FILE",
    "LearningInvalid",
    "LedgerEntry",
    "LedgerSource",
    "UsageCurator",
    "UsageFile",
    "UsageSkill",
    "clean_learning",
    "effective_learning",
]

LEARNING_DEFAULTS: dict[str, Any] = {
    "memoryChars": 2200, "userChars": 1375,            # spec caps
    "memoryReviewEvery": 10, "skillReviewEvery": 10,   # 0 = that review off
    "reviewModel": None,                               # None = the chat's model
    "curator": True, "curatorIdleHours": 2, "curatorEveryDays": 7,
    "consolidate": False,                              # the optional consolidation pass in scheduled curator runs
}
LEARNING_RANGES: dict[str, tuple[int, int]] = {
    "memoryChars": (200, 20_000), "userChars": (200, 20_000), "memoryReviewEvery": (0, 1000),
    "skillReviewEvery": (0, 1000), "curatorIdleHours": (1, 72), "curatorEveryDays": (1, 365),
}  # our ranges

MEMORY_FILE = ".object-agent/memory/MEMORY.md"
USER_FILE = ".object-agent/memory/USER.md"
LEDGER_FILE = ".object-agent/ledger.jsonl"
USAGE_FILE = ".object-agent/usage.json"
ARCHIVE_DIR = ".object-agent/skills-archive"
SKILLS_DIR = ".claude/skills"
CACHE_DB = ".object-agent/cache/sessions.db"
ENTRY_SEPARATOR = "§"                       # a line holding only this
SKILL_NAME = r"^[a-z0-9][a-z0-9-]{0,63}$"   # at most 64 characters (spec); lower case, digits, hyphens (our rule)
SKILL_NAME_MAX = 64
SKILL_DESCRIPTION_MAX = 60
SKILL_MD_MAX = 100_000
SUPPORT_FILE_MAX = 1_048_576
SUPPORT_DIRS = ("references", "templates", "scripts")
REVIEW_MAX_STEPS = 16                       # spec
CURATOR_MAX_STEPS = 40                      # our number (the consolidation run)
STALE_DAYS = 14                             # spec, not settable
ARCHIVE_DAYS = 30                           # spec, not settable
SESSION_READ_CAP = 40_000                   # characters session_search returns for one chat (our number)
REVIEW_CONCURRENCY = 2                      # reviews running at once, across agents (our number)
CURATOR_TICK = 60.0                         # seconds between curator checks (our number)


class LearningInvalid(Exception):
    """A ``learning`` value that can't be saved (422)."""

    status = 422

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


_RANGE_MESSAGES = {  # our strings
    "memoryChars": "The memory cap must be between 200 and 20,000 characters.",
    "userChars": "The user profile cap must be between 200 and 20,000 characters.",
    "memoryReviewEvery": "The memory review interval must be between 0 and 1,000 turns.",
    "skillReviewEvery": "The skills review interval must be between 0 and 1,000 tool calls.",
    "curatorIdleHours": "The curator's idle time must be between 1 and 72 hours.",
    "curatorEveryDays": "The curator's interval must be between 1 and 365 days.",
}
_BOOL_MESSAGES = {
    "curator": "The curator switch must be true or false.",
    "consolidate": "The tidy-up switch must be true or false.",
}


def _int_ok(key: str, value: Any) -> bool:
    if not isinstance(value, int) or isinstance(value, bool):
        return False
    low, high = LEARNING_RANGES[key]
    return low <= value <= high


def _model_ok(value: Any) -> str | None | bool:
    """The cleaned model name, None, or False when it isn't a model name."""
    try:
        return aimodels.clean_model(value)
    except ValueError:
        return False


def effective_learning(data: dict[str, Any]) -> dict[str, Any]:
    """`LEARNING_DEFAULTS` overlaid with ``data["learning"]``'s valid keys (per key fallback)."""
    out = dict(LEARNING_DEFAULTS)
    stored = data.get("learning") if isinstance(data, dict) else None
    if not isinstance(stored, dict):
        return out
    for key in LEARNING_DEFAULTS:
        if key not in stored:
            continue
        value = stored[key]
        if key in LEARNING_RANGES:
            if _int_ok(key, value):
                out[key] = value
        elif key in _BOOL_MESSAGES:
            if isinstance(value, bool):
                out[key] = value
        elif key == "reviewModel":
            model = _model_ok(value)
            if model is not False:
                out[key] = model
    return out


def clean_learning(value: dict[str, Any]) -> dict[str, Any]:
    """A ``PUT /agents/{id}/learning`` body's ``learning``: unknown keys kept, known keys
    checked (`LearningInvalid`); ``reviewModel`` goes through `aimodels.clean_model`."""
    if not isinstance(value, dict):
        raise LearningInvalid("learning must be an object.")
    out: dict[str, Any] = {}
    for key, item in value.items():
        if key in LEARNING_RANGES:
            if not _int_ok(key, item):
                raise LearningInvalid(_RANGE_MESSAGES[key])
            out[key] = item
        elif key in _BOOL_MESSAGES:
            if not isinstance(item, bool):
                raise LearningInvalid(_BOOL_MESSAGES[key])
            out[key] = item
        elif key == "reviewModel":
            try:
                out[key] = aimodels.clean_model(item)
            except ValueError as exc:
                raise LearningInvalid(str(exc)) from exc
        else:
            out[key] = item
    return out


# -- the ledger entry ------------------------------------------------------------------------------


class LedgerSource(BaseModel):
    model_config = ConfigDict(extra="allow")

    kind: Literal["chat", "review", "curator", "user", "undo"]
    agentId: str | None = None
    chatId: str | None = None
    run: str | None = None


class LedgerEntry(BaseModel):
    """One line of ``.object-agent/ledger.jsonl``.

    ``action``: memory ``add | replace | remove | edit``; skill ``create | patch | edit |
    write_file | remove_file | archive | restore | stale | active | pin | unpin``; either
    ``undo``. ``before`` / ``after`` hold the whole file's text (None: no file, or a state-only
    action); ``encoding`` is ``base64`` when a removed support file wasn't UTF-8.
    """

    model_config = ConfigDict(extra="allow")

    v: int = 1
    id: str
    at: str
    target: Literal["memory", "user", "skill"]
    action: str
    skill: str | None = None
    file: str | None = None
    before: str | None = None
    after: str | None = None
    encoding: Literal["text", "base64"] = "text"
    absorbedInto: str | None = None
    source: LedgerSource
    undoes: str | None = None


# -- usage.json ------------------------------------------------------------------------------------


class UsageSkill(BaseModel):
    model_config = ConfigDict(extra="allow")

    uses: int = 0
    lastUsed: str | None = None
    createdAt: str | None = None
    state: Literal["active", "stale"] = "active"
    pinned: bool = False
    archivedAt: str | None = None
    absorbedInto: str | None = None


class UsageCurator(BaseModel):
    model_config = ConfigDict(extra="allow")

    lastRunAt: str | None = None
    lastConsolidatedAt: str | None = None
    report: dict[str, Any] | None = None
    """``{"at", "runId", "text"}`` of the last consolidation pass."""


class UsageFile(BaseModel):
    """``.object-agent/usage.json``. "Archived" is where a skill's folder is, never a flag here.
    A skill with no entry is active, unused and unpinned. Unknown keys are kept."""

    model_config = ConfigDict(extra="allow")

    v: int = 1
    skills: dict[str, UsageSkill] = {}
    curator: UsageCurator = UsageCurator()
