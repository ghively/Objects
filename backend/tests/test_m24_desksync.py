"""M24 Task 8: Desk sync (``desksync``, ``api_desksync``, ``api_v1_desksync``, ``sync_ticket_fields``)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from test_m23_api import PRINTER, Env, _make

from objectapp import desksync, schedulerun, windowhost
from objectapp.agentmodel import AgentInput
from objectapp.agents import AgentRegistry
from objectapp.tokens import TokenStore

CHAT = "01KAAAAAAAAAAAAAAAAAAAAAAA"


@pytest.fixture
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    windowhost.set_opener(None)
    e = _make(tmp_path, monkeypatch)
    e.secrets = []  # type: ignore[attr-defined]
    e.agent = AgentRegistry().create(AgentInput(name="Work"), "Work.\n")  # type: ignore[attr-defined]
    yield e
    for s in e.secrets:  # type: ignore[attr-defined]
        TokenStore.drop_ephemeral(s)
    windowhost.set_opener(None)


def set_agent(env: Env) -> None:
    rev = env.c.get("/api/settings").json()["revision"]
    res = env.c.put("/api/settings", json={"patch": {"workAgentId": env.agent.id}, "baseRevision": rev})  # type: ignore[attr-defined]
    assert res.status_code == 200, res.text


def token(env: Env, purpose: str) -> dict[str, str]:
    _r, secret = TokenStore(env.root).ephemeral("Work", "read-write", agent=env.agent.id, chat=CHAT, purpose=purpose)  # type: ignore[attr-defined]
    env.secrets.append(secret)  # type: ignore[attr-defined]
    return {"Authorization": f"Bearer {secret}"}


def rules(env: Env) -> list[Path]:
    d = env.root / ".object" / "automations"
    return sorted(d.glob("*.json")) if d.exists() else []


def test_setup_makes_an_off_weekday_schedule(env: Env) -> None:
    before = env.status()
    assert env.c.get("/api/work/desk-sync").json()["ruleId"] is None
    assert env.status() == before and not rules(env)
    res = env.c.post("/api/work/desk-sync/setup", json={})
    assert res.status_code == 422 and res.json()["detail"] == "Create the Work agent first."
    set_agent(env)
    res = env.c.post("/api/work/desk-sync/setup", json={})
    assert res.status_code == 201, res.text
    (file,) = rules(env)
    rule = json.loads(file.read_text(encoding="utf-8"))
    assert rule["name"] == "Desk sync" and rule["enabled"] is False
    assert rule["trigger"]["repeat"] == "every weekday" and rule["trigger"]["time"] == "07:00"
    act = rule["actions"][0]
    assert act["kind"] == "runAgent" and act["agentId"] == env.agent.id  # type: ignore[attr-defined]
    assert act["prompt"] == desksync.DESK_SYNC_PROMPT
    space_json = json.loads((env.root / ".object" / "space.json").read_text(encoding="utf-8"))
    assert space_json["deskSyncRuleId"] == file.stem
    again = env.c.post("/api/work/desk-sync/setup", json={})
    assert again.status_code == 409 and again.json()["detail"] == "Desk sync is already set up."
    assert desksync.purpose_for(env.space, file.stem) == "work-sync"
    assert desksync.purpose_for(env.space, "other") == "schedule"
    assert schedulerun.PURPOSE_FOR is desksync.purpose_for


def test_ticket_fields_only(env: Env) -> None:
    def call(headers, **body):
        return env.c.post("/api/v1/agent/work/ticket-fields", headers=headers, json=body)

    version = env.space.read(PRINTER)[2]
    good = token(env, "work-sync")
    res = call(good, path=PRINTER, version=version,
               values={"deskStatus": "Resolved", "deskUpdated": "2026-11-05"})
    assert res.status_code == 200, res.text
    text = (env.root / PRINTER).read_text(encoding="utf-8")
    assert "deskStatus: Resolved" in text and "deskUpdated: 2026-11-05" in text
    assert "status: In Progress" in text
    assert "Work set Desk status to Resolved" in text
    version = env.space.read(PRINTER)[2]
    bad = call(good, path=PRINTER, version=version, values={"rank": 3})
    assert bad.status_code == 422 and bad.json()["detail"] == "rank isn't a ticket field."
    for purpose in ("work-read", "chat"):
        res = call(token(env, purpose), path=PRINTER, version=version, values={"deskStatus": "x"})
        assert res.status_code == 403
        assert res.json()["detail"] == "Only Desk sync updates ticket fields this way."
    stale = call(good, path=PRINTER, version="nope", values={"deskStatus": "Closed"})
    assert stale.status_code == 409


def test_status(env: Env) -> None:
    set_agent(env)
    env.c.post("/api/work/desk-sync/setup", json={})
    st = env.c.get("/api/work/desk-sync").json()
    assert st["ruleId"] and st["enabled"] is False and st["repeat"] == "every weekday"
    assert st["time"] == "07:00" and st["lastRun"] is None and st["markedReadTools"] == 0
    assert env.c.delete(f"/api/automations/{st['ruleId']}").status_code in (200, 204)
    assert env.c.get("/api/work/desk-sync").json()["ruleId"] is None
    assert env.c.post("/api/work/desk-sync/setup", json={}).status_code == 201
