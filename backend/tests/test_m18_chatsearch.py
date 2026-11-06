"""M18 Task 4: full-text search over an agent's own chats (``chatsearch``)."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from objectapp import chatsearch, transcripts
from objectapp.learningmodel import CACHE_DB

CHAT_A = "01KAAAAAAAAAAAAAAAAAAAAAAA"
CHAT_B = "01KBBBBBBBBBBBBBBBBBBBBBBB"
CHAT_C = "01KCCCCCCCCCCCCCCCCCCCCCCC"


def _chat(folder: Path, chat_id: str, title: str, lines: list[dict], *, space: str | None = "Lab space",
          created: str = "2026-11-05T09:00:00.000Z") -> None:
    transcripts.start(folder, chat_id, agent_id="assistant", title=title, space_name=space,
                      space_key=None, created_at=created)
    transcripts.append(folder, chat_id, lines)


def _user(text: str, at: str = "2026-11-05T09:01:00.000Z") -> dict:
    return {"type": "user", "text": text, "at": at}


def _assistant(text: str, at: str = "2026-11-05T09:02:00.000Z") -> dict:
    return {"type": "assistant", "text": text, "at": at, "model": "sonnet", "sessionId": None}


def _tool(text: str) -> dict:
    return {"type": "tool", "id": "toolu_1", "name": "search", "input": {"q": text}, "result": text,
            "isError": False, "at": "2026-11-05T09:01:30.000Z"}


def _three(folder: Path) -> None:
    _chat(folder, CHAT_A, "Where labels go", [
        _user("Which side do the stickers go on?"),
        _assistant("Rack labels go on the left, at eye height."),
    ])
    _chat(folder, CHAT_B, "Cable colours", [
        _user("What colour is the uplink cable?"),
        _tool("toolu result rack"),
        _assistant("Blue for uplinks, grey for the rest."),
    ], space=None)
    _chat(folder, CHAT_C, "Lunch", [_user("What's for lunch?"), _assistant("Soup.")])


def _snapshot(folder: Path) -> dict[str, bytes]:
    cache = (folder / CACHE_DB).parent
    out = {}
    for p in folder.rglob("*"):
        if p.is_file() and cache not in p.parents:
            out[str(p.relative_to(folder))] = p.read_bytes()
    return out


def test_search_finds_chats_with_snippets(tmp_path: Path) -> None:
    _three(tmp_path)
    hits = chatsearch.search(tmp_path, "rack labels")
    assert [h["chatId"] for h in hits] == [CHAT_A]
    hit = hits[0]
    assert hit["title"] == "Where labels go"
    assert hit["spaceName"] == "Lab space"
    assert hit["updatedAt"] == "2026-11-05T09:02:00.000Z"
    assert hit["matches"] >= 1
    assert 1 <= len(hit["snippets"]) <= 3
    assert "«Rack»" in hit["snippets"][0] and "«labels»" in hit["snippets"][0]
    # tool lines are not indexed
    assert chatsearch.search(tmp_path, "toolu") == []
    assert [h["chatId"] for h in chatsearch.search(tmp_path, "uplink")] == [CHAT_B]
    assert chatsearch.search(tmp_path, "uplink")[0]["spaceName"] is None


def test_snippets_at_most_three(tmp_path: Path) -> None:
    _chat(tmp_path, CHAT_A, "Many", [_user(f"rack number {i}") for i in range(6)])
    hit = chatsearch.search(tmp_path, "rack")[0]
    assert hit["matches"] == 6 and len(hit["snippets"]) == 3
    assert chatsearch.search(tmp_path, "rack", limit=1) == [hit]


def test_incremental_sync(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _three(tmp_path)
    assert chatsearch.search(tmp_path, "zebra") == []
    calls: list[str] = []
    real = transcripts.raw_lines

    def counting(folder: Path, chat_id: str) -> list[dict]:
        calls.append(chat_id)
        return real(folder, chat_id)

    monkeypatch.setattr(transcripts, "raw_lines", counting)
    assert chatsearch.search(tmp_path, "zebra") == []
    assert calls == []
    transcripts.append(tmp_path, CHAT_C, [_user("A zebra walked in.", at="2026-11-05T10:00:00.000Z")])
    hits = chatsearch.search(tmp_path, "zebra")
    assert [h["chatId"] for h in hits] == [CHAT_C]
    assert hits[0]["updatedAt"] == "2026-11-05T10:00:00.000Z"
    assert calls == [CHAT_C]
    transcripts.path_for(tmp_path, CHAT_A).unlink()
    assert chatsearch.search(tmp_path, "rack labels") == []
    conn = sqlite3.connect(tmp_path / CACHE_DB)
    try:
        assert conn.execute("SELECT count(*) FROM msgs WHERE chat_id = ?", (CHAT_A,)).fetchone()[0] == 0
        assert conn.execute("SELECT count(*) FROM files WHERE chat_id = ?", (CHAT_A,)).fetchone()[0] == 0
    finally:
        conn.close()


def test_rebuild_when_unreadable(tmp_path: Path) -> None:
    _three(tmp_path)
    before = _snapshot(tmp_path)
    db = tmp_path / CACHE_DB
    db.parent.mkdir(parents=True, exist_ok=True)
    db.write_bytes(b"this is not a database at all " * 50)
    assert [h["chatId"] for h in chatsearch.search(tmp_path, "rack labels")] == [CHAT_A]
    conn = sqlite3.connect(db)
    try:
        conn.execute("UPDATE meta SET value = '0' WHERE key = 'version'")
        conn.execute("DELETE FROM msgs")
        conn.commit()
    finally:
        conn.close()
    assert [h["chatId"] for h in chatsearch.search(tmp_path, "rack labels")] == [CHAT_A]
    conn = sqlite3.connect(db)
    try:
        assert conn.execute("SELECT value FROM meta WHERE key = 'version'").fetchone()[0] == str(
            chatsearch.INDEX_VERSION)
    finally:
        conn.close()
    assert _snapshot(tmp_path) == before


def test_query_syntax_is_neutral(tmp_path: Path) -> None:
    _three(tmp_path)
    for q in ("NEAR(a b)", "a OR", '"', "*", "-x", "", "   ", "rack:", 'rack"labels'):
        assert isinstance(chatsearch.search(tmp_path, q), list)
    assert chatsearch.search(tmp_path, "r") == []


def test_search_with_no_chats(tmp_path: Path) -> None:
    assert chatsearch.search(tmp_path, "rack") == []
    assert list(tmp_path.iterdir()) == []  # an agent with no chats yet: nothing written


def test_read_chat(tmp_path: Path) -> None:
    _three(tmp_path)
    got = chatsearch.read_chat(tmp_path, CHAT_B)
    assert got["chatId"] == CHAT_B and got["title"] == "Cable colours"
    assert got["createdAt"] == "2026-11-05T09:00:00.000Z"
    assert got["messages"] == [
        {"role": "user", "text": "What colour is the uplink cable?", "at": "2026-11-05T09:01:00.000Z"},
        {"role": "assistant", "text": "Blue for uplinks, grey for the rest.", "at": "2026-11-05T09:02:00.000Z"},
    ]
    assert got["truncated"] is False

    long = [_user(f"m{i} " + "x" * 9_996, at=f"2026-11-05T09:{i:02d}:00.000Z") for i in range(6)]
    _chat(tmp_path, CHAT_C.replace("C", "D"), "Long", long)
    cut = chatsearch.read_chat(tmp_path, CHAT_C.replace("C", "D"))
    assert cut["truncated"] is True
    assert sum(len(m["text"]) for m in cut["messages"]) <= 40_000
    assert [m["text"][:3] for m in cut["messages"]] == ["m2 ", "m3 ", "m4 ", "m5 "]
    small = chatsearch.read_chat(tmp_path, CHAT_C.replace("C", "D"), cap=100)
    assert small["truncated"] is True and len(small["messages"]) == 1
    assert len(small["messages"][0]["text"]) <= 100 and small["messages"][0]["text"].endswith("x")

    with pytest.raises(FileNotFoundError):
        chatsearch.read_chat(tmp_path, "01KZZZZZZZZZZZZZZZZZZZZZZZ")
    with pytest.raises(ValueError):
        chatsearch.read_chat(tmp_path, "../x")


def test_search_writes_only_the_cache(tmp_path: Path) -> None:
    _three(tmp_path)
    before = _snapshot(tmp_path)
    chatsearch.search(tmp_path, "rack")
    chatsearch.search(tmp_path, "lunch")
    chatsearch.read_chat(tmp_path, CHAT_A)
    assert _snapshot(tmp_path) == before
    assert (tmp_path / CACHE_DB).is_file()


def test_non_ascii(tmp_path: Path) -> None:
    _chat(tmp_path, CHAT_A, "Accents", [_assistant("The Ünïcode label printer is broken.")])
    hits = chatsearch.search(tmp_path, "unicode")
    assert [h["chatId"] for h in hits] == [CHAT_A]
    assert "«Ünïcode»" in hits[0]["snippets"][0]
