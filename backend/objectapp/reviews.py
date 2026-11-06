"""Background reviews (M18, spec section 5): the two counters, the three prompts, the review
runner, the review contributor and the turn watcher.

T1 stub: the Contract's names and final signatures; the plan's T7 fills them. `ReviewRunner` is
constructible and starts nothing (`after_turn` answers None), `review_contributor` and `watch` do
nothing. A review is a ``claude -p`` run built by `agentrun.build_run` (purpose ``"review"``) and
run by `ai.run_turn`; nothing here calls a model any other way.

Review state lives only in the chat's transcript, as two ``review`` lines (start and end, the
same ``id``); the counters are computed from the transcript.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .agentrun import RunParts, RunScope
    from .agents import AgentRecord
    from .watcher import ChangeEvent

__all__ = [
    "BOTH_PROMPT",
    "MEMORY_PROMPT",
    "MEMORY_TOOL",
    "REVIEW_PURPOSES",
    "SKILLS_PROMPT",
    "SKILL_TOOL",
    "Counters",
    "ReviewBusy",
    "ReviewRunner",
    "ReviewStatus",
    "counters",
    "due_kinds",
    "prompt_for",
    "review_contributor",
    "review_tools",
    "summary_text",
    "tool_short",
    "watch",
]

REVIEW_PURPOSES = frozenset({"chat"})
"""Turns that can trigger a review. ``delegate`` (M20) and ``schedule`` (M21) are not in it."""

MEMORY_TOOL = "memory"
SKILL_TOOL = "skill_manage"

_AGENT_PREFIX = "mcp__object-agent__"


def tool_short(name: str) -> str:
    """``"mcp__object-agent__memory"`` -> ``"memory"``; other names unchanged."""
    return name[len(_AGENT_PREFIX):] if name.startswith(_AGENT_PREFIX) else name


@dataclass
class Counters:
    user_turns: int
    """User lines since the last ``memory`` tool line, or since the last review start whose kinds
    hold ``"memory"``."""
    tool_calls: int
    """Tool lines since the last ``skill_manage`` tool line, or since the last review start whose
    kinds hold ``"skills"``."""


def counters(lines: list[dict[str, Any]]) -> Counters:
    """From `transcripts.raw_lines` (T7)."""
    raise NotImplementedError("M18 T7")


def due_kinds(c: Counters, learning: dict[str, Any]) -> list[str]:
    """``[]``, ``["memory"]``, ``["skills"]`` or ``["memory", "skills"]`` (T7)."""
    raise NotImplementedError("M18 T7")


# The three prompts (T7). Each starts with the line the fake claude keys its review actions on.
MEMORY_PROMPT: str = "Look back over this chat."
SKILLS_PROMPT: str = "Look back over this chat."
BOTH_PROMPT: str = "Look back over this chat."


def prompt_for(kinds: list[str]) -> str:
    """The prompt for `kinds` (T7)."""
    raise NotImplementedError("M18 T7")


def review_tools(kinds: list[str], tools_off: Iterable[str]) -> tuple[list[str], list[str]]:
    """(allowed, disallowed) CLI names for a review of `kinds` (T7)."""
    raise NotImplementedError("M18 T7")


def review_contributor(scope: RunScope, parts: RunParts) -> None:
    """Order 68 ``review-tools``: for ``review`` / ``curator`` runs, the review's tool lists and
    only the ``object`` and ``object-agent`` servers (T7). Does nothing in T1."""
    return None


@dataclass
class ReviewStatus:
    id: str
    agent_id: str
    chat_id: str
    kinds: list[str]
    trigger: str
    """``"auto"`` | ``"manual"``"""
    state: str
    """``"running"`` | ``"done"`` | ``"failed"``"""
    started_at: str
    ended_at: str | None = None
    summary: str | None = None
    message: str | None = None
    entry_ids: list[str] = field(default_factory=list)

    def to_api(self) -> dict[str, Any]:
        """The ``ReviewStatus`` shape of ``types.ts``."""
        return {
            "id": self.id,
            "agentId": self.agent_id,
            "chatId": self.chat_id,
            "kinds": list(self.kinds),
            "trigger": self.trigger,
            "state": self.state,
            "startedAt": self.started_at,
            "endedAt": self.ended_at,
            "summary": self.summary,
            "message": self.message,
            "entryIds": list(self.entry_ids),
        }


class ReviewBusy(Exception):
    """A review already runs for this chat (409)."""

    status = 409


class ReviewRunner:
    """One per app (`server.create_app`), shared by `api_ai` and `api_learning`."""

    def __init__(self, announce: Callable[[ChangeEvent], None], space_root: Path, space_name: str) -> None:
        self.announce = announce
        self.space_root = Path(space_root)
        self.space_name = space_name

    def after_turn(self, *, agent: AgentRecord, chat_id: str, mode: str, purpose: str, chat_model: str | None,
                   session_id: str | None, api_url: str, claude: str) -> ReviewStatus | None:
        """Start at most one review for the chat, as an asyncio task never awaited (T7)."""
        return None

    def learn_now(self, *, agent: AgentRecord, chat_id: str, api_url: str, claude: str) -> ReviewStatus:
        """"Learn from this chat": kinds ``["memory", "skills"]``, trigger ``"manual"``;
        `ReviewBusy` when one runs for the chat (T7)."""
        raise NotImplementedError("M18 T7")

    def statuses(self, agent: AgentRecord, chat_id: str) -> list[ReviewStatus]:
        """From the transcript, plus running ones (T7)."""
        return []

    def busy(self) -> bool:
        """Any review running (the curator waits)."""
        return False

    def wait_idle(self, timeout: float = 10.0) -> bool:
        """Wait until no review runs (tests and ``POST /api/_test/reviews/idle``)."""
        return True


def summary_text(entries: list[dict[str, Any]]) -> str:
    """"Saved 1 memory, updated 1 skill" and the like; none: "Nothing new to learn" (T7)."""
    raise NotImplementedError("M18 T7")


def watch(event: dict[str, Any], *, folder: Path, memo_key: str) -> None:
    """A chat turn's event: a call of the CLI's own ``Skill`` tool marks that skill read and
    records a use (T7). Does nothing in T1."""
    return None
