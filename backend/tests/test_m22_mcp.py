"""M22 Task 9: the agents' work routes (``api_v1_work``) and the ``objectapp-mcp`` work tools
(plan ``2026-11-05-m22-work-model.md``, Contract "Routes" and "MCP tools").

TestClient over ``create_app`` on a copy of ``space-work`` (one Task marked Exclude from AI);
the MCP server is driven in process through ``ObjectClient(http=TestClient)``. Tokens are made
with ``TokenStore`` while ``OBJECT_STATE_DIR`` points at a temp folder.
"""

from __future__ import annotations

import asyncio
import json
import shutil
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from mcp.server.mcpserver.exceptions import ToolError
from objectapp import api_v1_work, toolcatalog
from objectapp.mcp_server import INSTRUCTIONS, ApiError, ObjectClient, build_server
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.tokens import TokenStore

FIXTURE = Path(__file__).parent / "fixtures" / "space-work"
NOW = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)
PRINTER = "Tasks/Printer jams on line 3.md"
PARKED = "Tasks/Parked thing.md"
HIDDEN = "Tasks/Order toner.md"
STEP_CHANGED = "This step changed. Look again."
WORK_READ = {"work_items", "work_item"}
WORK_WRITE = {
    "step_action", "edit_steps", "log_activity", "add_work_note", "set_work_fields",
    "update_floor_item",
}


class Env:
    def __init__(self, root: Path, state: Path, space: Space, http: TestClient,
                 published: list) -> None:
        self.root, self.state, self.space, self.http, self.published = (
            root, state, space, http, published
        )
        self.store = TokenStore(root)

    def token(self, name: str = "Work", scope: str = "read-write") -> str:
        return self.store.ephemeral(name, scope)[1]

    def client(self, name: str = "Work", scope: str = "read-write") -> ObjectClient:
        return ObjectClient("http://testserver", self.token(name, scope), self.http)

    def item(self, path: str) -> dict:
        res = self.http.get("/api/work/item", params={"path": path})
        assert res.status_code == 200, res.text
        return res.json()

    def step(self, path: str, n: int) -> dict:
        return self.item(path)["steps"][n - 1]

    def approve(self, path: str, n: int) -> dict:
        s = self.step(path, n)
        res = self.http.post("/api/work/step", json={
            "path": path, "stepId": s["id"], "stepRev": s["rev"], "action": "approve",
        })
        assert res.status_code == 200, res.text
        return res.json()

    def activity(self) -> list[dict]:
        log = self.state / "api-activity.jsonl"
        if not log.exists():
            return []
        return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines() if line]


@pytest.fixture
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Env:
    state = tmp_path / "state"
    monkeypatch.setenv("OBJECT_STATE_DIR", str(state))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.delenv("OBJECT_CLOCK_FILE", raising=False)
    root = tmp_path / "space"
    shutil.copytree(FIXTURE, root)
    hidden = root / HIDDEN
    raw = hidden.read_bytes()
    hidden.write_bytes(raw.replace(b"type: Task", b"type: Task\nexcludeFromAI: true", 1))
    space = Space(root)
    space.clock = lambda: NOW
    space.tz = UTC
    app = create_app(space, None, watch=False)
    published: list = []
    app.state.hub.publish = published.append
    return Env(root, state, space, TestClient(app), published)


def _call(server, name: str, **args):
    try:
        result = asyncio.run(server.call_tool(name, args))
    except ToolError as exc:
        raise ApiError(str(exc)) from exc
    if result.is_error:
        raise ApiError(" ".join(getattr(c, "text", "") for c in result.content))
    if result.structured_content is not None:
        out = result.structured_content
        return out.get("result", out) if set(out) == {"result"} else out
    return json.loads(result.content[0].text)


def _error_text(server, name: str, **args) -> str:
    """The tool error's text after the MCP server's own "Error executing tool <name>: "."""
    with pytest.raises(ApiError) as caught:
        _call(server, name, **args)
    return str(caught.value).removeprefix(f"Error executing tool {name}: ")


def _names(server) -> set[str]:
    return {t.name for t in asyncio.run(server.list_tools())}


def _v1(env: Env, secret: str, method: str, route: str, **kw):
    return env.http.request(
        method, f"/api/v1{route}", headers={"Authorization": f"Bearer {secret}"}, **kw
    )


# -- tool lists --------------------------------------------------------------------------------


def test_tool_lists(env: Env) -> None:
    client = env.client()
    rw = _names(build_server(client, write=True))
    assert rw == set(toolcatalog.OBJECT_READ + toolcatalog.OBJECT_WRITE)
    assert WORK_READ | WORK_WRITE <= rw
    ro = _names(build_server(client, write=False))
    assert WORK_READ <= ro and not (WORK_WRITE & ro)
    assert toolcatalog.WORK_STEP_TOOLS == ("step_action", "edit_steps", "log_activity", "add_work_note")
    assert set(toolcatalog.WORK_STEP_TOOLS) <= set(toolcatalog.OBJECT_WRITE)
    assert len(toolcatalog.OBJECT_READ) == 22 and len(toolcatalog.OBJECT_WRITE) == 41
    assert toolcatalog.OBJECT_READ[-2:] == ("work_items", "work_item")
    assert toolcatalog.OBJECT_WRITE[-6:] == (
        "step_action", "edit_steps", "log_activity", "add_work_note", "set_work_fields",
        "update_floor_item",
    )
    tools = {t.name: t for t in asyncio.run(build_server(client).list_tools())}
    for name in WORK_READ:
        assert tools[name].annotations.read_only_hint is True
    for name in WORK_WRITE:
        assert tools[name].annotations.read_only_hint is False
    flat = " ".join(INSTRUCTIONS.split())
    assert "set_properties can't change steps" in flat
    assert f'refused with "{STEP_CHANGED}"' in flat


# -- the agent actor and the gate ---------------------------------------------------------------


def test_agent_actor_and_gate(env: Env) -> None:
    server = build_server(env.client("Work"))
    env.approve(PRINTER, 2)
    item = _call(server, "work_item", path=PRINTER)
    step2 = item["steps"][1]
    assert step2["state"] == "approved"
    out = _call(server, "step_action", path=PRINTER, step_id=step2["id"], step_rev=step2["rev"],
                action="complete", text="Spooler restarted")
    assert out["activity"].endswith('Work completed step 2: Spooler restarted')
    text = (env.root / PRINTER).read_text(encoding="utf-8")
    assert "Work completed step 2: Spooler restarted" in text

    step3 = out["item"]["steps"][2]
    assert _error_text(server, "step_action", path=PRINTER, step_id=step3["id"],
                       step_rev=step3["rev"], action="approve") == "Only you can do this to a step."
    # A stale rev: step 2's old revision.
    assert _error_text(server, "step_action", path=PRINTER, step_id=step2["id"],
                       step_rev=step2["rev"], action="complete", text="again") == STEP_CHANGED

    # The other write tools, as the agent.
    v = _call(server, "log_activity", path=PRINTER, text="checked the spooler log")
    assert v["activity"].endswith("Work checked the spooler log")
    n = _call(server, "add_work_note", path=PRINTER, text="Log is clean since the restart")
    assert n["workNote"].endswith("Work: note: Log is clean since the restart")
    added = _call(server, "edit_steps", path=PRINTER,
                  ops=[{"op": "add", "kind": "do", "text": "Tell the operators"}])
    assert added["item"]["steps"][-1]["text"] == "Tell the operators"
    f = _call(server, "set_work_fields", path=PRINTER, version=added["version"],
              values={"rank": 2}, remove=["hypothesis"])
    assert f["item"]["rank"] == 2 and f["item"]["hypothesis"] is None
    floor = _call(server, "update_floor_item", path=PRINTER, op="add", place="Line 3 printer",
                  what="Photo of the error panel")
    assert floor["item"]["floorItems"][0]["place"] == "Line 3 printer"
    listed = _call(server, "work_items", scope="all")
    assert PRINTER in [i["path"] for i in listed["items"]]


# -- Exclude from AI ----------------------------------------------------------------------------


def test_hidden_items(env: Env) -> None:
    assert env.item(HIDDEN)["path"] == HIDDEN  # the app still sees it
    secret = env.token()
    server = build_server(ObjectClient("http://testserver", secret, env.http))
    paths = [i["path"] for i in _call(server, "work_items", scope="all")["items"]]
    assert HIDDEN not in paths and PRINTER in paths
    assert _v1(env, secret, "GET", "/work/item", params={"path": HIDDEN}).status_code == 404
    step = env.step(HIDDEN, 1) if env.item(HIDDEN)["steps"] else {"id": "x", "rev": "x"}
    before = (env.root / HIDDEN).read_bytes()
    writes = [
        ("/work/step", {"path": HIDDEN, "stepId": step["id"], "stepRev": step["rev"], "action": "done"}),
        ("/work/steps", {"path": HIDDEN, "ops": [{"op": "add", "kind": "do", "text": "x"}]}),
        ("/work/fields", {"path": HIDDEN, "baseVersion": "x", "set": {"rank": 3}}),
        ("/work/note", {"path": HIDDEN, "kind": "note", "text": "x"}),
        ("/work/activity", {"path": HIDDEN, "text": "x"}),
        ("/work/floor", {"path": HIDDEN, "op": "add", "place": "x", "what": "y"}),
    ]
    for route, body in writes:
        assert _v1(env, secret, "POST", route, json=body).status_code == 404, route
    assert (env.root / HIDDEN).read_bytes() == before
    assert _error_text(server, "work_item", path=HIDDEN) == f"No object at {HIDDEN!r}"


def test_read_scope(env: Env) -> None:
    secret = env.token("Reader", "read")
    step = env.step(PARKED, 1)
    res = _v1(env, secret, "POST", "/work/step", json={
        "path": PARKED, "stepId": step["id"], "stepRev": step["rev"], "action": "answer",
        "text": "Night shift",
    })
    assert res.status_code in (401, 403)
    assert _v1(env, secret, "GET", "/work/items").status_code == 200
    assert _v1(env, "", "GET", "/work/items").status_code == 401


def test_step_guard_hook(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    assert api_v1_work.STEP_GUARD(None, PRINTER, "r8k1pd", "complete") is None
    env.approve(PRINTER, 2)
    secret = env.token()

    def guard(_record, _path, _step_id, action) -> str | None:
        return "No." if action == "complete" else None

    monkeypatch.setattr(api_v1_work, "STEP_GUARD", guard)
    step2 = env.step(PRINTER, 2)
    before = (env.root / PRINTER).read_bytes()
    res = _v1(env, secret, "POST", "/work/step", json={
        "path": PRINTER, "stepId": step2["id"], "stepRev": step2["rev"], "action": "complete",
        "text": "done",
    })
    assert res.status_code == 403 and res.json()["detail"] == "No."
    assert (env.root / PRINTER).read_bytes() == before
    res = _v1(env, secret, "POST", "/work/step", json={
        "path": PRINTER, "stepId": step2["id"], "stepRev": step2["rev"], "action": "fail",
        "text": "The host was down",
    })
    assert res.status_code == 200, res.text


def test_writes_logged(env: Env) -> None:
    with env.http:  # the lifespan runs the event hub's loop
        _test_writes_logged(env)


def _test_writes_logged(env: Env) -> None:
    secret = env.token("Work")
    env.published.clear()
    step = env.step(PARKED, 1)
    version = env.item(PRINTER)["version"]
    calls = [
        ("/work/step", {"path": PARKED, "stepId": step["id"], "stepRev": step["rev"],
                        "action": "complete", "text": "x"}, 422),  # an agent can't answer
        ("/work/activity", {"path": PARKED, "text": "looked at the shift plan"}, 200),
        ("/work/note", {"path": PARKED, "kind": "request", "text": "Ask the supervisor"}, 200),
        ("/work/steps", {"path": PARKED, "ops": [{"op": "add", "kind": "do", "text": "Print labels"}]}, 200),
        ("/work/fields", {"path": PRINTER, "baseVersion": version, "set": {"rank": 4}}, 200),
        ("/work/floor", {"path": PRINTER, "op": "add", "place": "Line 3", "what": "Tray 2"}, 200),
    ]
    for route, body, code in calls:
        res = _v1(env, secret, "POST", route, json=body)
        assert res.status_code == code, (route, res.text)
    origins = [e.origin for e in env.published]
    assert origins and set(origins) == {"api:Work"}
    assert [e.path for e in env.published if e.kind == "changed"] == [
        PARKED, PARKED, PARKED, PRINTER, PRINTER,
    ]
    log = env.activity()
    assert [(e["token"], e["path"]) for e in log] == [("Work", PARKED)] * 3 + [("Work", PRINTER)] * 2
    assert [e["action"] for e in log] == [
        "work-activity", "work-note", "work-steps", "work-fields", "work-floor",
    ]
    # A stale field write is a 409 with the item sentence, and logs nothing.
    res = _v1(env, secret, "POST", "/work/fields",
              json={"path": PRINTER, "baseVersion": version, "set": {"rank": 5}})
    assert res.status_code == 409 and res.json()["detail"] == "This item changed. Look again."
    assert len(env.activity()) == 5
    assert env.http.get("/api/v1/changes", headers={"Authorization": f"Bearer {secret}"}).status_code == 200
