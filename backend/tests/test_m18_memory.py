"""M18 Task 2: the ledger and the agent's memory (``ledger``, ``agentmemory``).

An agent folder made with M17's ``agentfiles.write_skeleton`` in ``tmp_path``; ``OBJECT_STATE_DIR``
is a temp folder (conftest). Fixtures are synthetic.
"""

from __future__ import annotations

import json
import os
import shutil
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest
from objectapp import agentfiles, agentmemory, agentrun, learnhooks, ledger, transcripts
from objectapp.agentmemory import MemoryError, apply, read, snapshot_for, user_save
from objectapp.agentrun import RunParts, RunScope
from objectapp.learningmodel import LEARNING_DEFAULTS, LEDGER_FILE, MEMORY_FILE, USER_FILE

CHAT = "01KAAAAAAAAAAAAAAAAAAAAAAA"
CHAT2 = "01KBBBBBBBBBBBBBBBBBBBBBBB"
SOURCE = {"kind": "chat", "agentId": "assistant", "chatId": CHAT, "run": None}
CAPS = dict(LEARNING_DEFAULTS)


@dataclass
class FakeAgent:
    id: str
    folder: Path
    data: dict[str, Any] = field(default_factory=dict)
    revision: str | None = None
    default: bool = False
    exists: bool = True
    missing: bool = False
    in_state_dir: bool = True
    read_only_reason: str | None = None


@pytest.fixture
def folder(tmp_path: Path) -> Path:
    f = tmp_path / "agent"
    agentfiles.write_skeleton(f, {"v": 1, "name": "Assistant", "toolsOff": ["Bash"]}, "Be helpful.")
    return f


def _add(folder: Path, content: str, target: str = "memory", **kw: Any) -> dict[str, Any]:
    return apply(folder, "add", target, content=content, old_text=None, source=SOURCE,
                 caps=kw.get("caps", CAPS))


def _ledger(folder: Path) -> list[dict[str, Any]]:
    return ledger.entries(folder, limit=1000)


def _text(folder: Path, rel: str) -> str:
    return (folder / rel).read_bytes().decode("utf-8")


# -- the memory tool -------------------------------------------------------------------------------


def test_add_replace_remove(folder: Path) -> None:
    _add(folder, "Rack A is in room 2")
    _add(folder, "Gene prefers short answers", "user")
    assert _text(folder, MEMORY_FILE) == "Rack A is in room 2"
    assert _text(folder, USER_FILE) == "Gene prefers short answers"
    out = _add(folder, "Rack B is in room 5")
    assert _text(folder, MEMORY_FILE) == "Rack A is in room 2\n§\nRack B is in room 5"
    assert out["ok"] is True and out["entries"] == ["Rack A is in room 2", "Rack B is in room 5"]
    assert out["cap"] == 2200 and out["chars"] == len("Rack A is in room 2\n§\nRack B is in room 5")
    apply(folder, "replace", "memory", content="Rack A is in room 3", old_text="room 2",
          source=SOURCE, caps=CAPS)
    assert _text(folder, MEMORY_FILE) == "Rack A is in room 3\n§\nRack B is in room 5"
    apply(folder, "remove", "memory", content=None, old_text="Rack B", source=SOURCE, caps=CAPS)
    assert _text(folder, MEMORY_FILE) == "Rack A is in room 3"

    entries = list(reversed(_ledger(folder)))
    assert [(e["target"], e["action"]) for e in entries] == [
        ("memory", "add"), ("user", "add"), ("memory", "add"), ("memory", "replace"), ("memory", "remove"),
    ]
    assert entries[0]["before"] is None and entries[0]["after"] == "Rack A is in room 2"
    assert entries[3]["before"] == "Rack A is in room 2\n§\nRack B is in room 5"
    assert entries[3]["after"] == "Rack A is in room 3\n§\nRack B is in room 5"
    assert entries[4]["after"] == "Rack A is in room 3"
    assert all(e["source"] == SOURCE and e["v"] == 1 and e["id"] and e["at"] for e in entries)
    assert out["entryId"] == entries[2]["id"]


def test_unique_substring(folder: Path) -> None:
    _add(folder, "Rack A is in room 2")
    _add(folder, "Rack B is in room 2")
    before = (folder / MEMORY_FILE).read_bytes()
    count = len(_ledger(folder))
    with pytest.raises(MemoryError) as e:
        apply(folder, "replace", "memory", content="x", old_text="room 2", source=SOURCE, caps=CAPS)
    assert e.value.message == "2 entries contain that text; give more of it." and e.value.status == 422
    with pytest.raises(MemoryError) as e:
        apply(folder, "remove", "memory", content=None, old_text="room 9", source=SOURCE, caps=CAPS)
    assert e.value.message == "No entry contains that text."
    assert (folder / MEMORY_FILE).read_bytes() == before
    assert len(_ledger(folder)) == count


def test_caps_count_characters(folder: Path) -> None:
    # 2,200 characters of "é" (2 bytes each) in two entries: "\n§\n" is 3 characters.
    first = "é" * 1000
    _add(folder, first)
    with pytest.raises(MemoryError) as e:
        _add(folder, "é" * 1198)  # 1000 + 3 + 1198 = 2,201
    msg = e.value.message
    assert "2,201" in msg and "2,200" in msg and "MEMORY.md" in msg
    assert msg.endswith("Current entries:\n" + first)
    out = _add(folder, "é" * 1197)  # exactly 2,200
    assert out["chars"] == 2200
    assert len((folder / MEMORY_FILE).read_bytes()) > 2200

    _add(folder, "u" * 1375, "user")
    with pytest.raises(MemoryError) as e:
        apply(folder, "replace", "user", content="u" * 1376, old_text="u", source=SOURCE, caps=CAPS)
    assert "1,376" in e.value.message and "1,375" in e.value.message and "USER.md" in e.value.message

    other = folder.parent / "other"
    agentfiles.write_skeleton(other, {"v": 1}, "")
    caps = dict(CAPS, memoryChars=300)
    _add(other, "x" * 300, caps=caps)
    with pytest.raises(MemoryError):
        _add(other, "y", caps=caps)


def test_read_cap_from_agent_settings(folder: Path) -> None:
    data, _rev = agentfiles.read_agent_file(folder)
    data["learning"] = {"memoryChars": 300}
    agentfiles.write_agent_file(folder, data)
    assert read(folder, "memory")["cap"] == 300
    assert read(folder, "user")["cap"] == 1375


def test_over_cap_file_can_shrink(folder: Path) -> None:
    big = "\n§\n".join(["e" * 497 + f"{i:03d}" for i in range(5)])  # 2,512 characters
    rev = read(folder, "memory")["revision"]
    saved = user_save(folder, "memory", big, rev)
    assert saved["chars"] > 2200
    with pytest.raises(MemoryError):
        _add(folder, "one more")
    out = apply(folder, "replace", "memory", content="s" * 300, old_text="000", source=SOURCE, caps=CAPS)
    assert 2200 < out["chars"] < saved["chars"]
    out = apply(folder, "remove", "memory", content=None, old_text="001", source=SOURCE, caps=CAPS)
    assert out["ok"] is True and out["chars"] < 2200


def test_entry_with_a_section_line_is_refused(folder: Path) -> None:
    with pytest.raises(MemoryError) as e:
        _add(folder, "a\n§\nb")
    assert e.value.message == "An entry can't hold a line with only §."
    with pytest.raises(MemoryError) as e:
        _add(folder, "a\n  §  \nb")
    assert e.value.message == "An entry can't hold a line with only §."
    with pytest.raises(MemoryError) as e:
        _add(folder, "   ")
    assert e.value.message == "Give the entry's text."
    out = _add(folder, "a § b")
    assert out["entries"] == ["a § b"]


def test_duplicate_add_is_a_no_op(folder: Path) -> None:
    _add(folder, "Rack A is in room 2")
    path = folder / MEMORY_FILE
    os.utime(path, ns=(1_000_000_000_000_000_000, 1_000_000_000_000_000_000))
    mtime = path.stat().st_mtime_ns
    count = len(_ledger(folder))
    out = _add(folder, "Rack A is in room 2")
    assert out["ok"] is True and out["note"] == "Already saved." and out["entryId"] is None
    assert len(_ledger(folder)) == count
    assert path.stat().st_mtime_ns == mtime


def test_bom_and_crlf_kept(folder: Path) -> None:
    path = folder / MEMORY_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\xef\xbb\xbfFirst line\r\nsecond line\r\n\xc2\xa7\r\nOther\r\n")
    assert read(folder, "memory")["entries"] == ["First line\nsecond line", "Other"]
    _add(folder, "New one\nwith two lines")
    data = path.read_bytes()
    assert data.startswith(b"\xef\xbb\xbf")
    assert b"\n" not in data.replace(b"\r\n", b"")
    assert data.decode("utf-8-sig").replace("\r\n", "\n") == (
        "First line\nsecond line\n§\nOther\n§\nNew one\nwith two lines\n"
    )


def test_read_never_writes(tmp_path: Path) -> None:
    folder = tmp_path / "bare"
    folder.mkdir()
    got = read(folder, "memory")
    assert got == {"target": "memory", "text": "", "entries": [], "chars": 0, "cap": 2200, "revision": None}
    assert read(folder, "user")["cap"] == 1375
    assert list(folder.iterdir()) == []
    assert ledger.entries(folder) == []
    with pytest.raises(MemoryError):
        read(folder, "notes")


def test_user_save_revision(folder: Path) -> None:
    _add(folder, "Rack A is in room 2")
    stale = read(folder, "memory")["revision"]
    _add(folder, "Rack B")
    current = read(folder, "memory")["revision"]
    with pytest.raises(MemoryError) as e:
        user_save(folder, "memory", "whatever", stale)
    assert e.value.status == 409 and e.value.current_revision == current
    out = user_save(folder, "memory", "Gene's own text\n§\nmore", current)
    assert out["entries"] == ["Gene's own text", "more"] and out["revision"] != current
    last = _ledger(folder)[0]
    assert last["action"] == "edit" and last["source"] == {"kind": "user"}
    assert last["before"] == "Rack A is in room 2\n§\nRack B" and last["after"] == "Gene's own text\n§\nmore"


def test_concurrent_adds_lose_nothing(folder: Path) -> None:
    errors: list[BaseException] = []

    def add(i: int) -> None:
        try:
            _add(folder, f"entry {i:02d}")
        except BaseException as exc:  # pragma: no cover - reported below
            errors.append(exc)

    threads = [threading.Thread(target=add, args=(i,)) for i in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors
    assert sorted(read(folder, "memory")["entries"]) == [f"entry {i:02d}" for i in range(20)]
    assert len(_ledger(folder)) == 20


def test_torn_ledger_line_is_skipped(folder: Path) -> None:
    _add(folder, "one")
    _add(folder, "two")
    path = folder / LEDGER_FILE
    with open(path, "ab") as f:
        f.write(b'{"v":1,"id":')
    assert [e["after"] for e in _ledger(folder)] == ["one\n§\ntwo", "one"]
    _add(folder, "three")
    lines = path.read_bytes().split(b"\n")
    assert lines[-1] == b""
    assert json.loads(lines[-2])["after"] == "one\n§\ntwo\n§\nthree"
    assert len(_ledger(folder)) == 3


def test_ledger_filters_and_lines(folder: Path) -> None:
    run_source = dict(SOURCE, kind="review", run="R1")
    apply(folder, "add", "memory", content="a", old_text=None, source=run_source, caps=CAPS)
    apply(folder, "add", "user", content="b", old_text=None, source=run_source, caps=CAPS)
    apply(folder, "replace", "user", content="c", old_text="b", source=SOURCE, caps=CAPS)
    apply(folder, "remove", "memory", content=None, old_text="a", source=SOURCE, caps=CAPS)
    all_ = ledger.entries(folder)
    assert [e["action"] for e in all_] == ["remove", "replace", "add", "add"]
    assert [e["target"] for e in ledger.entries(folder, run="R1")] == ["user", "memory"]
    assert [e["action"] for e in ledger.entries(folder, target="user")] == ["replace", "add"]
    assert ledger.entries(folder, limit=1)[0]["id"] == all_[0]["id"]
    page = ledger.entries(folder, before=all_[1]["id"])
    assert [e["id"] for e in page] == [all_[2]["id"], all_[3]["id"]]
    assert ledger.entries(folder, before="nope") == []
    assert ledger.get(folder, all_[2]["id"])["target"] == "user"
    with pytest.raises(KeyError):
        ledger.get(folder, "nope")
    assert ledger.line(all_[3]) == "Saved a memory"
    assert ledger.line(all_[2]) == "Saved a memory about you"
    assert ledger.line(all_[1]) == "Changed a memory about you"
    assert ledger.line(all_[0]) == "Removed a memory"
    s = ledger.summary(all_[0])
    assert "before" not in s and "after" not in s and s["line"] == "Removed a memory" and s["id"] == all_[0]["id"]


def test_ledger_skill_and_undo_lines(folder: Path) -> None:
    def ln(**kw: Any) -> str:
        return ledger.line({"target": "skill", "skill": "rack-labels", **kw})

    assert ln(action="create") == "Created the skill 'rack-labels'"
    assert ln(action="patch", file="SKILL.md") == "Patched 'rack-labels'"
    assert ln(action="patch", file="references/x.md") == "Patched 'rack-labels' in references/x.md"
    assert ln(action="edit", file="SKILL.md") == "Rewrote 'rack-labels'"
    assert ln(action="write_file", file="references/x.md") == "Added references/x.md to 'rack-labels'"
    assert ln(action="remove_file", file="references/x.md") == "Removed references/x.md from 'rack-labels'"
    assert ln(action="archive") == "Archived 'rack-labels'"
    assert ln(action="archive", absorbedInto="racks") == "Archived 'rack-labels' into 'racks'"
    assert ln(action="restore") == "Restored 'rack-labels'"
    assert ln(action="stale") == "Marked 'rack-labels' stale"
    assert ln(action="active") == "Marked 'rack-labels' active"
    assert ln(action="pin") == "Pinned 'rack-labels'"
    assert ln(action="unpin") == "Unpinned 'rack-labels'"
    assert ledger.line({"target": "memory", "action": "edit"}) == "Edited the memory file"

    added = _add(folder, "a")
    undo = ledger.append(folder, {"target": "memory", "action": "undo", "before": "a", "after": "",
                                  "source": {"kind": "undo"}, "undoes": added["entryId"]})
    assert ledger.line(undo) == "Undid: Saved a memory"
    again = ledger.append(folder, {"target": "memory", "action": "undo", "before": "", "after": "a",
                                   "source": {"kind": "undo"}, "undoes": undo["id"]})
    assert ledger.line(ledger.get(folder, again["id"])) == "Undid: Undid: Saved a memory"


def test_append_validates(folder: Path) -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        ledger.append(folder, {"target": "nope", "action": "add", "source": {"kind": "chat"}})
    assert not (folder / LEDGER_FILE).exists()


# -- the snapshot ----------------------------------------------------------------------------------


def _start(folder: Path, chat: str) -> None:
    transcripts.start(folder, chat, agent_id="assistant", title="Chat", space_name="Notes",
                      space_key=None, created_at="2026-11-05T09:00:00.000Z")


def _memory_lines(folder: Path, chat: str) -> list[dict[str, Any]]:
    return [x for x in transcripts.raw_lines(folder, chat) if x.get("type") == "memory"]


def test_snapshot_for_is_frozen(folder: Path) -> None:
    _add(folder, "A")
    _start(folder, CHAT)
    assert snapshot_for(folder, CHAT) == ("A", "")
    assert len(_memory_lines(folder, CHAT)) == 1
    apply(folder, "replace", "memory", content="B", old_text="A", source=SOURCE, caps=CAPS)
    assert snapshot_for(folder, CHAT) == ("A", "")
    _start(folder, CHAT2)
    assert snapshot_for(folder, CHAT2) == ("B", "")
    assert snapshot_for(folder, CHAT) == ("A", "")
    assert len(_memory_lines(folder, CHAT)) == 1 and len(_memory_lines(folder, CHAT2)) == 1
    assert transcripts.read(folder, CHAT)["items"] == []


def test_snapshot_without_a_transcript_writes_nothing(folder: Path) -> None:
    _add(folder, "A")
    assert snapshot_for(folder, CHAT) == ("A", "")
    assert not transcripts.path_for(folder, CHAT).exists()
    assert snapshot_for(folder, "not-a-chat") == ("A", "")


def test_snapshot_text() -> None:
    assert agentmemory.snapshot_text("", "") == ""
    text = agentmemory.snapshot_text("M1", "U1")
    assert text.startswith("<memory>\nWhat you saved about your work and environment, as of this chat's start (MEMORY.md):\nM1\n</memory>")
    assert text.endswith("<user-profile>\nWhat you saved about the person you work for, as of this chat's start (USER.md):\nU1\n</user-profile>")


@pytest.fixture
def run_env(tmp_path: Path, monkeypatch) -> dict[str, Any]:
    state = tmp_path / "state"
    state.mkdir()
    monkeypatch.setenv("OBJECT_STATE_DIR", str(state))
    space = tmp_path / "My Notes"
    space.mkdir()
    folder = state / "agents" / "Researcher"
    agentfiles.write_skeleton(folder, {"v": 1, "name": "Researcher", "toolsOff": ["Bash"]}, "")
    monkeypatch.setattr(agentrun, "_local_agent_folders", lambda s: [])
    learnhooks.install()
    return {"state": state, "space": space, "folder": folder}


def _scope(env: dict[str, Any], *, purpose: str = "chat", **data: Any) -> RunScope:
    agent = FakeAgent(id="01JC7ZK3T9Q4M2X8B5N6R1V0WE", folder=env["folder"],
                      data={"name": "Researcher", "toolsOff": ["Bash"], **data})
    return RunScope(agent=agent, space_root=env["space"], space_name="Notes", api_url="http://127.0.0.1:8765",
                    token="tok", write=True, chat_id=CHAT, purpose=purpose, state=env["state"])


def _append_md(scope: RunScope) -> str:
    cmd = agentrun.build_run(scope, claude="claude", model=None, resume=None)
    try:
        return (cmd.tmp / "append.md").read_text(encoding="utf-8")
    finally:
        shutil.rmtree(cmd.tmp, ignore_errors=True)


def test_snapshot_contributor(run_env: dict[str, Any]) -> None:
    folder = run_env["folder"]
    _start(folder, CHAT)
    assert "<memory>" not in _append_md(_scope(run_env))
    assert _memory_lines(folder, CHAT)  # the (empty) snapshot is frozen at the first run

    _start(folder, CHAT2)
    _add(folder, "Rack A is in room 2")
    _add(folder, "Gene prefers short answers", "user")
    scope = RunScope(**{**_scope(run_env).__dict__, "chat_id": CHAT2})
    text = _append_md(scope)
    block = agentmemory.snapshot_text("Rack A is in room 2", "Gene prefers short answers")
    guidance = agentrun.OBJECT_GUIDANCE.format(agent="Researcher", space="Notes")
    assert block in text and guidance in text
    assert text.index(block) < text.index(guidance)
    assert text.index(block) < text.index(agentmemory.LEARNING_GUIDANCE["memory"]) < text.index(guidance)

    parts = RunParts()
    agentmemory.snapshot_contributor(RunScope(**{**scope.__dict__, "purpose": "curator"}), parts)
    assert parts.append_prompt == []
    parts = RunParts()
    agentmemory.snapshot_contributor(scope, parts)
    assert parts.append_prompt == [block]


def test_guidance_contributor(run_env: dict[str, Any]) -> None:
    g = agentmemory.LEARNING_GUIDANCE
    parts = RunParts()
    agentmemory.guidance_contributor(_scope(run_env), parts)
    assert parts.append_prompt == [" ".join([g["memory"], g["skill_manage"], g["session_search"]])]
    assert "session_search" in g["session_search"] and "memory" in g["memory"]

    parts = RunParts()
    off = ["Bash", "mcp__object-agent__session_search"]
    agentmemory.guidance_contributor(_scope(run_env, toolsOff=off), parts)
    assert parts.append_prompt == [" ".join([g["memory"], g["skill_manage"]])]

    parts = RunParts()
    off = ["mcp__object-agent__" + t for t in ("memory", "skills_list", "skill_view", "skill_manage",
                                                 "session_search")]
    agentmemory.guidance_contributor(_scope(run_env, toolsOff=off), parts)
    assert parts.append_prompt == []
