"""M18 Task 6: the agent page's learning routes (``api_learning``, under ``/api/agents/{id}/...``).

``OBJECT_STATE_DIR`` is a temp folder (conftest). The ``learn``, ``reviews`` and ``tidy`` routes are
tested against test doubles of the app's `ReviewRunner` and `Curator` public methods (T7 and T8
fill the real ones). Nothing here runs a CLI or writes outside ``tmp_path`` and that state folder.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp import ai, ledger, transcripts
from objectapp import settings as device_settings
from objectapp.agentmodel import AGENT_FILE, AgentInput
from objectapp.agents import AgentRegistry
from objectapp.appstate import state_dir
from objectapp.curator import CuratorBusy
from objectapp.learningmodel import LEARNING_DEFAULTS
from objectapp.reviews import ReviewBusy, ReviewStatus
from objectapp.server import create_app
from objectapp.space import Space

CHAT = "01KAAAAAAAAAAAAAAAAAAAAAAA"
UNKNOWN_CHAT = "01KZZZZZZZZZZZZZZZZZZZZZZZ"


def _set(**patch) -> None:
    _data, revision = device_settings.read()
    device_settings.patch(patch, revision)


class Env:
    def __init__(self, space_dir: Path) -> None:
        self.app = create_app(Space(space_dir), None, watch=False)
        self.events: list = []
        self.app.state.hub.publish = self.events.append
        self.http = TestClient(self.app)
        self.http.__enter__()
        self.agent = AgentRegistry().create(AgentInput(name="Researcher"), "Find things.\n")
        self.id = self.agent.id
        self.folder = self.agent.folder

    def url(self, rest: str = "") -> str:
        return f"/api/agents/{self.id}{rest}"

    def learning_events(self, want: int = 1) -> list:
        deadline = time.monotonic() + 2.0
        while True:
            got = [e for e in self.events if e.kind == "agentLearning"]
            if len(got) >= want or time.monotonic() > deadline:
                return got
            time.sleep(0.01)

    def chat(self, chat_id: str = CHAT, text: str = "The rack labels use the blue printer.") -> None:
        transcripts.start(self.folder, chat_id, agent_id=self.id, title="Labels", space_name="Test",
                          space_key=None, created_at="2026-11-05T09:00:00.000Z")
        transcripts.append(self.folder, chat_id, [
            {"type": "user", "text": "Where do rack labels print?", "at": "2026-11-05T09:00:01.000Z"},
            {"type": "assistant", "text": text, "model": "sonnet", "at": "2026-11-05T09:00:02.000Z"},
        ])

    def close(self) -> None:
        self.http.__exit__(None, None, None)


@pytest.fixture
def env(space_dir: Path):
    e = Env(space_dir)
    try:
        yield e
    finally:
        e.close()


def _snapshot(root: Path) -> dict[str, bytes]:
    if not root.exists():
        return {}
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*") if p.is_file()}


def _status(agent_id: str, chat_id: str, state: str = "running") -> ReviewStatus:
    return ReviewStatus(id="01KRRRRRRRRRRRRRRRRRRRRRRR", agent_id=agent_id, chat_id=chat_id,
                        kinds=["memory", "skills"], trigger="manual", state=state,
                        started_at="2026-11-05T09:01:00.000Z")


# -- memory -------------------------------------------------------------------------------------


def test_memory_routes(env: Env) -> None:
    before = _snapshot(state_dir())
    res = env.http.get(env.url("/memory"))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["memory"]["target"] == "memory" and body["memory"]["cap"] == 2200
    assert body["user"]["target"] == "user" and body["user"]["cap"] == 1375
    assert body["user"]["revision"] is None
    assert _snapshot(state_dir()) == before

    res = env.http.put(env.url("/memory/user"),
                       json={"text": "Gene likes short answers.", "baseRevision": None, "clientId": "win-1"})
    assert res.status_code == 200, res.text
    saved = res.json()
    assert saved["entries"] == ["Gene likes short answers."] and saved["revision"]
    assert (env.folder / ".object-agent/memory/USER.md").read_text(encoding="utf-8").startswith("Gene likes")
    events = env.learning_events()
    assert events and events[-1].path == env.id and events[-1].origin == "win-1"
    entry = ledger.entries(env.folder)[0]
    assert entry["action"] == "edit" and entry["target"] == "user" and entry["source"]["kind"] == "user"
    assert events[-1].version == entry["id"]

    stale = env.http.put(env.url("/memory/user"), json={"text": "Other.", "baseRevision": "nope"})
    assert stale.status_code == 409
    assert stale.json()["currentRevision"] == saved["revision"]

    bad = env.http.put(env.url("/memory/other"), json={"text": "x", "baseRevision": None})
    assert bad.status_code == 422


# -- skills -------------------------------------------------------------------------------------


def test_skill_routes(env: Env) -> None:
    res = env.http.post(env.url("/skills"),
                        json={"name": "rack-labels", "description": "Print rack labels", "body": "Use blue.\n",
                              "clientId": "win-1"})
    assert res.status_code == 201, res.text
    made = res.json()
    assert made["createdBy"] == "user" and made["name"] == "rack-labels"
    assert "Use blue." in made["text"] and made["revision"]
    assert env.learning_events()[-1].origin == "win-1"
    again = env.http.post(env.url("/skills"),
                          json={"name": "rack-labels", "description": "Again", "body": "x"})
    assert again.status_code == 409
    assert env.http.post(env.url("/skills"),
                         json={"name": "Bad Name", "description": "x", "body": "x"}).status_code == 422

    listed = env.http.get(env.url("/skills")).json()["skills"]
    assert [s["name"] for s in listed] == ["rack-labels"]

    detail = env.http.get(env.url("/skills/rack-labels")).json()
    assert detail["text"] and detail["revision"] and detail["files"][0]["path"] == "SKILL.md"
    assert env.http.get(env.url("/skills/nope")).status_code == 404

    ref = env.http.put(env.url("/skills/rack-labels/file"),
                       json={"path": "references/a.md", "text": "Notes.\n", "baseRevision": None})
    assert ref.status_code == 200, ref.text
    assert ref.json()["revision"]
    assert ledger.entries(env.folder)[0]["action"] == "write_file"
    read = env.http.get(env.url("/skills/rack-labels/file"), params={"path": "references/a.md"}).json()
    assert read == {"path": "references/a.md", "text": "Notes.\n", "revision": ref.json()["revision"],
                    "binary": False}

    stale = env.http.put(env.url("/skills/rack-labels/file"),
                         json={"path": "SKILL.md", "text": "x", "baseRevision": "old"})
    assert stale.status_code == 409
    assert stale.json()["currentRevision"] == detail["revision"]
    outside = env.http.put(env.url("/skills/rack-labels/file"),
                           json={"path": "../x.md", "text": "x", "baseRevision": None})
    assert outside.status_code == 422

    (env.folder / ".claude/skills/rack-labels/scripts").mkdir(parents=True)
    (env.folder / ".claude/skills/rack-labels/scripts/blob.bin").write_bytes(b"\xff\xfe\x00\x81")
    binary = env.http.get(env.url("/skills/rack-labels/file"), params={"path": "scripts/blob.bin"}).json()
    assert binary["binary"] is True and binary["text"] is None

    pinned = env.http.post(env.url("/skills/rack-labels/pin"), json={"pinned": True})
    assert pinned.status_code == 200 and pinned.json()["pinned"] is True

    archived = env.http.post(env.url("/skills/rack-labels/archive"), json={})
    assert archived.status_code == 200 and archived.json()["state"] == "archived"
    assert env.http.get(env.url("/skills")).json()["skills"] == []
    with_archived = env.http.get(env.url("/skills"), params={"archived": "true"}).json()["skills"]
    assert [s["state"] for s in with_archived] == ["archived"]
    arch_detail = env.http.get(env.url("/skills/rack-labels"), params={"archived": "true"})
    assert arch_detail.status_code == 200 and arch_detail.json()["state"] == "archived"

    restored = env.http.post(env.url("/skills/rack-labels/restore"), json={})
    assert restored.status_code == 200 and restored.json()["state"] == "active"
    assert env.http.post(env.url("/skills/rack-labels/restore"), json={}).status_code == 404


# -- the ledger and Undo ------------------------------------------------------------------------


def test_ledger_routes(env: Env) -> None:
    rev = None
    for i in range(3):
        saved = env.http.put(env.url("/memory/memory"), json={"text": f"Fact {i}.", "baseRevision": rev})
        assert saved.status_code == 200, saved.text
        rev = saved.json()["revision"]
    env.http.post(env.url("/skills"), json={"name": "alpha", "description": "A", "body": "a"})

    first = env.http.get(env.url("/ledger"), params={"limit": 2}).json()
    assert first["more"] is True and len(first["entries"]) == 2
    assert first["entries"][0]["action"] == "create" and first["entries"][0]["line"] == "Created the skill 'alpha'"
    assert "before" not in first["entries"][0]
    rest = env.http.get(env.url("/ledger"), params={"limit": 5, "before": first["entries"][-1]["id"]}).json()
    assert rest["more"] is False and len(rest["entries"]) == 2

    only = env.http.get(env.url("/ledger"), params={"skill": "alpha"}).json()["entries"]
    assert [e["skill"] for e in only] == ["alpha"]
    ledger.append(env.folder, {"target": "memory", "action": "add", "before": None, "after": "x",
                               "source": {"kind": "review", "agentId": env.id, "chatId": CHAT, "run": "R1"}})
    by_run = env.http.get(env.url("/ledger"), params={"run": "R1"}).json()["entries"]
    assert len(by_run) == 1 and by_run[0]["source"]["run"] == "R1"

    memory_entries = env.http.get(env.url("/ledger"), params={"target": "memory"}).json()["entries"]
    last_edit = next(e for e in memory_entries if e["action"] == "edit")
    full = env.http.get(env.url(f"/ledger/{last_edit['id']}")).json()
    assert full["before"] == "Fact 1." and full["after"].startswith("Fact 2.")
    assert env.http.get(env.url("/ledger/01KNOPENOPENOPENOPENOPENOP")).status_code == 404

    undone = env.http.post(env.url(f"/ledger/{last_edit['id']}/undo"), json={"clientId": "win-2"})
    assert undone.status_code == 200, undone.text
    assert undone.json()["action"] == "undo" and undone.json()["undoes"] == last_edit["id"]
    assert undone.json()["line"].startswith("Undid: ")
    assert (env.folder / ".object-agent/memory/MEMORY.md").read_text(encoding="utf-8").startswith("Fact 1.")
    assert env.learning_events()[-1].origin == "win-2"

    # An older entry whose file changed since can't be undone.
    oldest = memory_entries[-1]
    conflict = env.http.post(env.url(f"/ledger/{oldest['id']}/undo"), json={})
    assert conflict.status_code == 409
    assert conflict.json()["detail"] == "This changed again since. Undo the later change first."


# -- learning settings ---------------------------------------------------------------------------


def test_learning_routes(env: Env) -> None:
    agent_json = env.folder / AGENT_FILE
    data = json.loads(agent_json.read_text(encoding="utf-8"))
    data["mystery"] = {"keep": True}
    data["toolsOff"] = ["session_search"]
    agent_json.write_text(json.dumps(data), encoding="utf-8")

    state = env.http.get(env.url("/learning")).json()
    assert state["settings"] == LEARNING_DEFAULTS and state["defaults"] == LEARNING_DEFAULTS
    assert set(state["curator"]) >= {"lastRunAt", "nextDueAt", "running", "report"}
    revision = state["revision"]
    assert revision

    res = env.http.put(env.url("/learning"),
                       json={"learning": {"memoryChars": 3000}, "baseRevision": revision, "clientId": "win-1"})
    assert res.status_code == 200, res.text
    new = res.json()
    assert new["settings"]["memoryChars"] == 3000 and new["revision"] != revision
    after = json.loads(agent_json.read_text(encoding="utf-8"))
    assert after["learning"]["memoryChars"] == 3000
    assert after["name"] == "Researcher" and after["toolsOff"] == ["session_search"]
    assert after["mystery"] == {"keep": True}

    bad = env.http.put(env.url("/learning"), json={"learning": {"memoryChars": 50}, "baseRevision": new["revision"]})
    assert bad.status_code == 422 and "between 200 and 20,000" in bad.json()["detail"]
    stale = env.http.put(env.url("/learning"), json={"learning": {"memoryChars": 4000}, "baseRevision": revision})
    assert stale.status_code == 409 and stale.json()["currentRevision"] == new["revision"]


# -- chat search -------------------------------------------------------------------------------


def test_chat_search_route(env: Env) -> None:
    env.chat()
    res = env.http.get(env.url("/chats/search"), params={"q": "printer"})
    assert res.status_code == 200, res.text
    hits = res.json()["hits"]
    assert [h["chatId"] for h in hits] == [CHAT] and "«printer»" in hits[0]["snippets"][0]
    assert env.http.get(env.url("/chats/search"), params={"q": "zebra"}).json()["hits"] == []


# -- reviews ------------------------------------------------------------------------------------


def test_learn_and_reviews_routes(env: Env, monkeypatch) -> None:
    env.chat()
    reviews = env.app.state.reviews
    calls: list = []

    def learn_now(*, agent, chat_id, api_url, claude):
        calls.append((agent.id, chat_id, api_url, claude))
        return _status(agent.id, chat_id)

    monkeypatch.setattr(ai, "find_claude", lambda setting: "C:/fake/claude.exe")
    monkeypatch.setattr(reviews, "learn_now", learn_now)
    monkeypatch.setattr(reviews, "statuses", lambda agent, chat_id: [_status(agent.id, chat_id, "done")])

    res = env.http.post(env.url(f"/chats/{CHAT}/learn"), json={"clientId": "win-1"})
    assert res.status_code == 202, res.text
    assert res.json()["state"] == "running" and res.json()["chatId"] == CHAT
    assert calls == [(env.id, CHAT, "http://testserver", "C:/fake/claude.exe")]

    listed = env.http.get(env.url(f"/chats/{CHAT}/reviews")).json()["reviews"]
    assert [r["state"] for r in listed] == ["done"]

    def busy(**_kw):
        raise ReviewBusy()

    monkeypatch.setattr(reviews, "learn_now", busy)
    res = env.http.post(env.url(f"/chats/{CHAT}/learn"), json={})
    assert res.status_code == 409 and res.json()["detail"] == "This chat is already being reviewed."

    assert env.http.post(env.url(f"/chats/{UNKNOWN_CHAT}/learn"), json={}).status_code == 404
    assert env.http.post(env.url("/chats/not-a-chat/learn"), json={}).status_code == 404
    assert env.http.get(env.url(f"/chats/{UNKNOWN_CHAT}/reviews")).status_code == 404

    AgentRegistry().save(env.id, AgentInput(name="Researcher", toolsOff=["memory", "skill_manage"]),
                         AgentRegistry().get(env.id).revision)
    res = env.http.post(env.url(f"/chats/{CHAT}/learn"), json={})
    assert res.status_code == 422 and res.json()["detail"] == "Learning tools are switched off for this agent."


def test_learn_without_claude(env: Env, monkeypatch) -> None:
    env.chat()
    monkeypatch.setattr(ai, "find_claude", lambda setting: None)
    res = env.http.post(env.url(f"/chats/{CHAT}/learn"), json={})
    assert res.status_code == 503 and res.json()["detail"] == ai.NOT_FOUND


# -- tidy up ------------------------------------------------------------------------------------


def test_tidy_route(env: Env, monkeypatch) -> None:
    curator = env.app.state.curator
    seen: list = []

    async def tidy_now(agent, api_url):
        seen.append((agent.id, api_url))
        return {"runId": "01KTTTTTTTTTTTTTTTTTTTTTTT"}

    monkeypatch.setattr(ai, "find_claude", lambda setting: "C:/fake/claude.exe")
    monkeypatch.setattr(curator, "tidy_now", tidy_now)
    res = env.http.post(env.url("/curator/tidy"), json={"clientId": "win-1"})
    assert res.status_code == 202, res.text
    assert res.json() == {"runId": "01KTTTTTTTTTTTTTTTTTTTTTTT"}
    assert seen == [(env.id, "http://testserver")]

    async def busy(agent, api_url):
        raise CuratorBusy()

    monkeypatch.setattr(curator, "tidy_now", busy)
    res = env.http.post(env.url("/curator/tidy"), json={})
    assert res.status_code == 409 and res.json()["detail"] == "Tidying up is already running."

    monkeypatch.setattr(ai, "find_claude", lambda setting: None)
    res = env.http.post(env.url("/curator/tidy"), json={})
    assert res.status_code == 503 and res.json()["detail"] == ai.NOT_FOUND


# -- hidden AI, unknown agents, the default agent ------------------------------------------------


def test_hidden_ai(env: Env, monkeypatch) -> None:
    env.chat()
    monkeypatch.setattr(ai, "find_claude", lambda setting: "C:/fake/claude.exe")
    _set(aiHidden=True)
    hidden = "AI features are hidden (Settings > AI Assistant)."
    res = env.http.post(env.url(f"/chats/{CHAT}/learn"), json={})
    assert res.status_code == 403 and res.json()["detail"] == hidden
    res = env.http.post(env.url("/curator/tidy"), json={})
    assert res.status_code == 403 and res.json()["detail"] == hidden
    assert env.http.get(env.url("/skills")).status_code == 200
    assert env.http.get(env.url("/memory")).status_code == 200


def test_unknown_agent_404(env: Env) -> None:
    base = "/api/agents/nobody"
    calls = [
        ("get", "/memory", None), ("put", "/memory/memory", {"text": "x", "baseRevision": None}),
        ("get", "/skills", None), ("post", "/skills", {"name": "a", "description": "a", "body": "a"}),
        ("get", "/skills/a", None), ("get", "/skills/a/file?path=SKILL.md", None),
        ("put", "/skills/a/file", {"path": "SKILL.md", "text": "x", "baseRevision": None}),
        ("post", "/skills/a/archive", {}), ("post", "/skills/a/restore", {}),
        ("post", "/skills/a/pin", {"pinned": True}),
        ("get", "/ledger", None), ("get", "/ledger/01KAAAAAAAAAAAAAAAAAAAAAAA", None),
        ("post", "/ledger/01KAAAAAAAAAAAAAAAAAAAAAAA/undo", {}),
        ("get", "/learning", None), ("put", "/learning", {"learning": {}, "baseRevision": None}),
        ("post", "/curator/tidy", {}), ("get", "/chats/search?q=x", None),
        ("post", f"/chats/{CHAT}/learn", {}), ("get", f"/chats/{CHAT}/reviews", None),
    ]
    for method, rest, body in calls:
        kw = {"json": body} if body is not None else {}
        res = getattr(env.http, method)(base + rest, **kw)
        assert res.status_code == 404, (method, rest, res.status_code, res.text)


def test_default_agent_reads_write_nothing(env: Env) -> None:
    before = _snapshot(state_dir())
    for rest in ("/memory", "/skills", "/ledger", "/learning", "/chats/search?q=printer"):
        res = env.http.get(f"/api/agents/assistant{rest}")
        assert res.status_code == 200, (rest, res.text)
    assert env.http.get("/api/agents/assistant/chats/search?q=printer").json() == {"hits": []}
    assert _snapshot(state_dir()) == before
    saved = env.http.put("/api/agents/assistant/memory/memory", json={"text": "First.", "baseRevision": None})
    assert saved.status_code == 200, saved.text
    assert AgentRegistry().get("assistant").exists
