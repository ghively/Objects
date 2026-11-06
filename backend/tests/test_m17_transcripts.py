"""M17 Task 3: per-agent chat transcripts (``transcripts``)."""

from __future__ import annotations

import json
import threading
from pathlib import Path

import pytest

from objectapp import transcripts
from objectapp.ids import new_ulid

T0 = "2026-11-05T09:00:00.000Z"
T1 = "2026-11-05T09:00:01.000Z"
T2 = "2026-11-05T09:00:02.000Z"
T3 = "2026-11-05T09:00:03.000Z"


@pytest.fixture
def folder(tmp_path: Path) -> Path:
    f = tmp_path / "Agent"
    f.mkdir()
    return f


def _start(folder: Path, chat_id: str, *, title: str = "What do my notes say?", space: str | None = "Notes",
           at: str = T0) -> None:
    transcripts.start(folder, chat_id, agent_id="assistant", title=title, space_name=space,
                      space_key="k1" if space else None, created_at=at)


def _lines(path: Path) -> list[bytes]:
    return [ln for ln in path.read_bytes().split(b"\n") if ln]


def test_start_writes_the_header_once(folder: Path) -> None:
    cid = transcripts.new_chat_id()
    _start(folder, cid)
    _start(folder, cid, title="Other")
    path = transcripts.path_for(folder, cid)
    assert path == folder / ".object-agent" / "sessions" / f"{cid}.jsonl"
    lines = _lines(path)
    assert len(lines) == 1
    assert json.loads(lines[0]) == {
        "type": "chat", "v": 1, "id": cid, "agentId": "assistant", "title": "What do my notes say?",
        "createdAt": T0, "space": {"name": "Notes", "key": "k1"}, "delegated": False,
    }
    assert path.read_bytes().endswith(b"\n")


def test_append_and_read(folder: Path) -> None:
    cid = transcripts.new_chat_id()
    _start(folder, cid)
    user = {"type": "user", "text": "hi", "at": T1, "contextPaths": ["Pages/A.md"]}
    tool1 = {"type": "tool", "id": "toolu_1", "name": "search", "input": {"query": "rack"}, "result": "[]",
             "isError": False, "at": T2}
    tool2 = {"type": "tool", "id": "toolu_2", "name": "read", "input": None, "result": None,
             "isError": True, "at": T2}
    asst = {"type": "assistant", "text": "done", "at": T3, "model": "sonnet", "sessionId": "sess-1"}
    transcripts.append(folder, cid, [user])
    transcripts.append(folder, cid, [tool1, tool2, asst])
    transcripts.append(folder, cid, [{"type": "object", "path": "AI Chats/Old.md", "at": T3}])
    transcripts.append(folder, cid, [{"type": "object", "path": "AI Chats/What do my notes say.md", "at": T3}])
    t = transcripts.read(folder, cid)
    assert t["items"] == [user, tool1, tool2, asst]
    assert t["id"] == cid
    assert t["agentId"] == "assistant"
    assert t["title"] == "What do my notes say?"
    assert t["createdAt"] == T0
    assert t["updatedAt"] == T3
    assert t["messageCount"] == 2
    assert t["spaceName"] == "Notes"
    assert t["delegated"] is False
    assert t["sessionId"] == "sess-1"
    assert t["objectPath"] == "AI Chats/What do my notes say.md"


def test_stopped_assistant_line_keeps_the_flag(folder: Path) -> None:
    cid = transcripts.new_chat_id()
    _start(folder, cid)
    line = {"type": "assistant", "text": "", "at": T1, "model": None, "sessionId": None, "stopped": True}
    transcripts.append(folder, cid, [line, {"type": "error", "message": "boom", "at": T2}])
    assert transcripts.read(folder, cid)["items"] == [line, {"type": "error", "message": "boom", "at": T2}]


def test_torn_last_line_is_skipped(folder: Path) -> None:
    cid = transcripts.new_chat_id()
    _start(folder, cid)
    transcripts.append(folder, cid, [{"type": "user", "text": "hi", "at": T1, "contextPaths": []}])
    path = transcripts.path_for(folder, cid)
    with open(path, "ab") as f:
        f.write(b'{"type":"assist')
    t = transcripts.read(folder, cid)
    assert [i["type"] for i in t["items"]] == ["user"]
    # The next append starts on a fresh line, so it is not lost to the torn one.
    transcripts.append(folder, cid, [{"type": "error", "message": "x", "at": T2}])
    assert [i["type"] for i in transcripts.read(folder, cid)["items"]] == ["user", "error"]


def test_bad_chat_id(folder: Path) -> None:
    for bad in ("../x", "", "assistant", "01jc7zk3t9q4m2x8b5n6r1v0we", "0" * 25):
        with pytest.raises(ValueError):
            transcripts.path_for(folder, bad)
    with pytest.raises(FileNotFoundError):
        transcripts.read(folder, new_ulid())
    with pytest.raises(ValueError):
        transcripts.append(folder, "../x", [{"type": "error", "message": "x", "at": T0}])
    assert not (folder / ".object-agent").exists()


def test_list_newest_first(folder: Path) -> None:
    assert transcripts.list_chats(folder) == []
    ids = [transcripts.new_chat_id() for _ in range(3)]
    for n, cid in enumerate(ids):
        _start(folder, cid, title=f"Chat {n}", space=None if n == 1 else f"Space {n}", at=T0)
        transcripts.append(folder, cid, [{"type": "user", "text": "q", "at": T1, "contextPaths": []}])
    transcripts.append(folder, ids[0], [{"type": "assistant", "text": "a", "at": T3, "model": None,
                                         "sessionId": None}])
    (folder / ".object-agent" / "sessions" / "notes.txt").write_text("not a chat")
    chats = transcripts.list_chats(folder)
    assert [c["id"] for c in chats][0] == ids[0]
    assert {c["id"] for c in chats} == set(ids)
    first = chats[0]
    assert first == {"id": ids[0], "title": "Chat 0", "createdAt": T0, "updatedAt": T3, "messageCount": 2,
                     "spaceName": "Space 0", "delegated": False}
    by_id = {c["id"]: c for c in chats}
    assert by_id[ids[1]]["spaceName"] is None
    assert by_id[ids[2]]["spaceName"] == "Space 2"


def test_find_by_session(folder: Path) -> None:
    a, b = transcripts.new_chat_id(), transcripts.new_chat_id()
    for cid in (a, b):
        _start(folder, cid)
    transcripts.append(folder, a, [{"type": "assistant", "text": "x", "at": T1, "model": None,
                                    "sessionId": "s-a"}])
    transcripts.append(folder, b, [{"type": "assistant", "text": "y", "at": T2, "model": None,
                                    "sessionId": "s-b"}])
    assert transcripts.find_by_session(folder, "s-a") == a
    assert transcripts.find_by_session(folder, "s-b") == b
    assert transcripts.find_by_session(folder, "nope") is None
    assert transcripts.find_by_session(folder / "missing", "s-a") is None


def test_concurrent_appends(folder: Path) -> None:
    cid = transcripts.new_chat_id()
    _start(folder, cid)
    text = "x" * 5000

    def one(n: int) -> None:
        transcripts.append(folder, cid, [{"type": "user", "text": f"{n}{text}", "at": T1, "contextPaths": []}])

    threads = [threading.Thread(target=one, args=(n,)) for n in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    lines = _lines(transcripts.path_for(folder, cid))
    assert len(lines) == 21
    for ln in lines:
        json.loads(ln)
    assert transcripts.read(folder, cid)["messageCount"] == 20


def test_non_ascii_and_crlf_text(folder: Path) -> None:
    cid = transcripts.new_chat_id()
    text = "é\r\nnext line"
    _start(folder, cid, title="Café")
    transcripts.append(folder, cid, [{"type": "user", "text": text, "at": T1, "contextPaths": ["Pages/É.md"]}])
    t = transcripts.read(folder, cid)
    assert t["title"] == "Café"
    assert t["items"][0]["text"] == text
    assert t["items"][0]["contextPaths"] == ["Pages/É.md"]
    assert "é".encode() in transcripts.path_for(folder, cid).read_bytes()
