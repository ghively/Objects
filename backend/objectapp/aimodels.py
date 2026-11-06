"""M16: the AI assistant's model choices and the model-name rule.

`MODELS` is the one list of model choices (spec section 11), served by
``GET /api/ai/models`` with `MODEL_PATTERN`; no other file names a model id. A
model name is passed to ``claude --model``, so `clean_model` refuses anything
that could be read as a flag or that holds a space or shell character.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any, Literal

__all__ = [
    "BAD_MODEL",
    "MODELS",
    "MODEL_PATTERN",
    "ModelChoice",
    "clean_model",
    "models_payload",
    "resolve_model",
]


@dataclass(frozen=True)
class ModelChoice:
    id: str  # what goes after --model
    label: str  # what the picker shows (our strings)
    kind: Literal["alias", "id"]  # alias: the CLI's "latest" names; id: a pinned model


MODELS: tuple[ModelChoice, ...] = (
    ModelChoice("fable", "Fable (latest)", "alias"),
    ModelChoice("opus", "Opus (latest)", "alias"),
    ModelChoice("sonnet", "Sonnet (latest)", "alias"),
    ModelChoice("haiku", "Haiku (latest)", "alias"),  # a guess: see the M16 plan's "Guesses"
    ModelChoice("claude-fable-5-1", "Fable 5.1", "id"),
    ModelChoice("claude-opus-5-5", "Opus 5.5", "id"),
    ModelChoice("claude-sonnet-5-5", "Sonnet 5.5", "id"),
    ModelChoice("claude-haiku-5-5", "Haiku 5.5", "id"),
)
"""The one list of model choices (spec section 11). A new model is one line here."""

MODEL_PATTERN = r"[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,79}"
"""A model name: what settings.py accepted as aiModel since M10 (moved here). A leading
letter or digit means no name can be read as a flag."""

BAD_MODEL = "That isn't a model name."  # our string, also the picker's message

_MODEL_RE = re.compile(MODEL_PATTERN)


def clean_model(value: object) -> str | None:
    """None for None, "" or whitespace; the stripped name when it fullmatches MODEL_PATTERN;
    raises ValueError("That isn't a model name.") otherwise."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(BAD_MODEL)
    name = value.strip()
    if not name:
        return None
    if _MODEL_RE.fullmatch(name) is None:
        raise ValueError(BAD_MODEL)
    return name


def resolve_model(chat: str | None, default: str | None) -> str | None:
    """The --model for a turn: the chat's pick, else the default agent's model, else None.
    M17 calls it with the agent's default; M18's reviews call it with the review model first."""
    return chat or default or None


def models_payload() -> dict[str, Any]:
    """GET /api/ai/models: {"models": [asdict(m) for m in MODELS], "pattern": MODEL_PATTERN}."""
    return {"models": [asdict(m) for m in MODELS], "pattern": MODEL_PATTERN}
