"""M19 Task 6: the ``/mcp-servers...``, ``/mcp-secrets...`` and ``/agents/{id}/tools/refresh`` routes.

The app's `TestClient` over a copy of the synthetic fixture space, with conftest's temp
``OBJECT_STATE_DIR``. Every server is the synthetic fake (`fake_mcp_server.py`); every secret is a
synthetic ``s3cret-...`` string, compared and never printed.
"""

from __future__ import annotations

import hashlib
import json
import logging
import sys
import time
from pathlib import Path
from typing import Any

import fake_mcp_server
import pytest
from fastapi.testclient import TestClient
from objectapp import mcpprobe
from objectapp import settings as device_settings
from objectapp.agentmodel import AgentInput
from objectapp.agents import AgentRegistry
from objectapp.appstate import state_dir
from objectapp.mcpgateway import TOOL_CACHE
from objectapp.server import create_app
from objectapp.space import Space

FAKE = str(Path(fake_mcp_server.__file__).resolve())
PY = sys.executable

ENV_SECRET = "s3cret-env-R7K2Q"
BEARER_SECRET = "s3cret-bearer-M4X9P"
WRONG_BEARER = "s3cret-wrong-Z8C1V"
VAR_SECRET = "s3cret-var-J6D3T"
FOLDER_SECRET = "s3cret-folder-B2W5N"
BAD_SECRET = "s3cret-bad\x00value-Y1"
SECRETS = (ENV_SECRET, BEARER_SECRET, WRONG_BEARER, VAR_SECRET, FOLDER_SECRET, "s3cret-bad")
REFUSED_401 = (
    "The server refused the credentials (401). If it needs an OAuth sign-in, Object can't do that "
    "yet; use a token or a header."
)


def _set(**patch: Any) -> None:
    _data, revision = device_settings.read()
    device_settings.patch(patch, revision)


@pytest.fixture
def api(space_dir: Path, tmp_path: Path):
    TOOL_CACHE.clear()
    app = create_app(Space(space_dir), None, watch=False)
    published: list = []
    app.state.hub.publish = published.append
    responses: list = []
    client = TestClient(app)
    original = client.request

    def recording(*a: Any, **kw: Any):
        res = original(*a, **kw)
        responses.append(res)
        return res

    client.request = recording  # type: ignore[method-assign]
    with client:
        yield {"client": client, "published": published, "space": space_dir, "tmp": tmp_path,
               "responses": responses}
    TOOL_CACHE.clear()


@pytest.fixture
def http_fake():
    started: list = []

    def start(mode: str = "http", **kw: Any) -> str:
        url, stop = fake_mcp_server.serve_in_thread(mode, **kw)
        started.append(stop)
        return url

    yield start
    for stop in started:
        stop()


def _wait(published: list, count: int) -> None:
    deadline = time.monotonic() + 5
    while len(published) < count and time.monotonic() < deadline:
        time.sleep(0.01)


def _stdio(name: str = "fake", *extra: str, secret: str | None = ENV_SECRET, **kw: Any) -> dict[str, Any]:
    args = [FAKE, *extra]
    env: list[dict[str, Any]] = [{"key": "LOG_LEVEL", "value": "info", "secret": False}]
    if secret is not None:
        args = [FAKE, "--require-env", "FAKE_KEY", *extra]
        env.append({"key": "FAKE_KEY", "value": secret, "secret": True})
    return {"name": name, "kind": "command", "command": PY, "args": args, "env": env, **kw}


def _url(name: str, url: str, bearer: str | None, **kw: Any) -> dict[str, Any]:
    body: dict[str, Any] = {"name": name, "kind": "url", "url": url, "transport": "http", **kw}
    if bearer is not None:
        body |= {"bearer": bearer, "bearerAction": "set"}
    return body


def _create(client: TestClient, server: dict[str, Any], client_id: str = "win-1") -> dict[str, Any]:
    res = client.post("/api/mcp-servers", json={"server": server, "clientId": client_id})
    assert res.status_code == 201, res.text
    return res.json()


def _agent(name: str, mcp: dict[str, Any] | None = None) -> str:
    reg = AgentRegistry()
    rec = reg.create(AgentInput(name=name), "Be curious.")
    if mcp is not None:
        (rec.folder / ".mcp.json").write_text(json.dumps({"mcpServers": mcp}), encoding="utf-8")
    return rec.id


def _folder_fake(var: str = "FAKE_FOLDER_KEY") -> dict[str, Any]:
    return {"command": PY, "args": [FAKE, "--require-env", var], "env": {var: "${" + var + "}"}}


def _hashes(*roots: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for root in roots:
        if not root.exists():
            continue
        for p in sorted(root.rglob("*")):
            out[str(p)] = hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else "dir"
    return out


# -- servers ------------------------------------------------------------------------------------


def test_crud_routes(api):
    c = api["client"]
    made = _create(c, _stdio())
    assert made["name"] == "fake" and made["enabled"] is True and made["kind"] == "command"
    sid = made["id"]

    listed = c.get("/api/mcp-servers").json()
    assert listed["readOnlyReason"] is None
    [server] = listed["servers"]
    assert server["id"] == sid and server["lastTest"] is None and server["missingSecrets"] == []
    env = {row["key"]: row for row in server["env"]}
    assert env["FAKE_KEY"] == {"key": "FAKE_KEY", "value": None, "secret": True, "set": True}
    assert env["LOG_LEVEL"] == {"key": "LOG_LEVEL", "value": "info", "secret": False, "set": True}

    # The same name in any case: 409 with the message and no currentRevision.
    res = c.post("/api/mcp-servers", json={"server": _stdio("FAKE")})
    assert res.status_code == 409
    assert res.json() == {"detail": "Another server already has this name."}

    # A reserved name and a bad one: 422.
    res = c.post("/api/mcp-servers", json={"server": _stdio("object")})
    assert res.status_code == 422 and res.json()["detail"] == "That name is taken by Object."
    res = c.post("/api/mcp-servers", json={"server": _stdio("my server")})
    assert res.status_code == 422

    # A stale revision: 409 {currentRevision}.
    res = c.put(f"/api/mcp-servers/{sid}", json={"server": _stdio(enabled=False, secret=None),
                                                 "baseRevision": "stale"})
    assert res.status_code == 409
    assert res.json()["currentRevision"] == server["revision"]

    # enabled: false flips only that (the secret row kept with value null).
    keep = _stdio(enabled=False)
    keep["env"][1]["value"] = None
    res = c.put(f"/api/mcp-servers/{sid}", json={"server": keep, "baseRevision": server["revision"]})
    assert res.status_code == 200, res.text
    saved = res.json()
    assert saved["enabled"] is False
    for field in ("name", "kind", "command", "args", "env", "createdAt"):
        assert saved[field] == server[field]
    assert saved["revision"] != server["revision"]

    # A name can't be changed.
    renamed = {**keep, "name": "other"}
    res = c.put(f"/api/mcp-servers/{sid}", json={"server": renamed, "baseRevision": saved["revision"]})
    assert res.status_code == 422 and res.json()["detail"] == "A server's name can't be changed."

    # Unknown ids: 404.
    assert c.put("/api/mcp-servers/nope", json={"server": keep, "baseRevision": "x"}).status_code == 404
    assert c.delete("/api/mcp-servers/nope").status_code == 404
    assert c.post("/api/mcp-servers/nope/test").status_code == 404

    # DELETE: {ok: true}, and its mcp:<id>: secrets are gone.
    secrets_file = state_dir() / "secrets.json"
    assert f"mcp:{sid}:" in secrets_file.read_text(encoding="utf-8")
    res = c.delete(f"/api/mcp-servers/{sid}?clientId=win-1")
    assert res.status_code == 200 and res.json() == {"ok": True}
    assert f"mcp:{sid}:" not in secrets_file.read_text(encoding="utf-8")
    assert c.get("/api/mcp-servers").json()["servers"] == []

    # A newer-schema file: 423 on writes, readOnlyReason on GET.
    (state_dir() / "mcp-servers.json").write_text(
        json.dumps({"schemaVersion": 2, "servers": []}), encoding="utf-8")
    listed = c.get("/api/mcp-servers").json()
    assert listed["readOnlyReason"] == "These MCP servers were saved by a newer version of Object."
    res = c.post("/api/mcp-servers", json={"server": _stdio("fresh")})
    assert res.status_code == 423
    assert res.json()["detail"] == "These MCP servers were saved by a newer version of Object."
    assert c.put("/api/mcp-servers/x", json={"server": keep, "baseRevision": "x"}).status_code == 423
    assert c.delete("/api/mcp-servers/x").status_code == 423


def test_events(api):
    c, published = api["client"], api["published"]
    made = _create(c, _stdio(), client_id="win-7")
    _wait(published, 1)
    assert [(e.kind, e.path, e.version, e.origin) for e in published] == [
        ("mcpServers", made["id"], made["revision"], "win-7")]
    published.clear()

    keep = _stdio(enabled=False)
    keep["env"][1]["value"] = None
    saved = c.put(f"/api/mcp-servers/{made['id']}",
                  json={"server": keep, "baseRevision": made["revision"], "clientId": "win-7"}).json()
    _wait(published, 1)
    assert [(e.kind, e.path, e.version, e.origin) for e in published] == [
        ("mcpServers", made["id"], saved["revision"], "win-7")]
    published.clear()

    assert c.delete(f"/api/mcp-servers/{made['id']}?clientId=win-7").status_code == 200
    _wait(published, 1)
    assert [(e.kind, e.path, e.version, e.origin) for e in published] == [
        ("mcpServers", made["id"], None, "win-7")]
    published.clear()

    assert c.put("/api/mcp-secrets/GH_TOKEN", json={"value": VAR_SECRET, "clientId": "win-7"}).status_code == 200
    _wait(published, 2)
    assert sorted((e.kind, e.path, e.version, e.origin) for e in published) == [
        ("agents", "secrets", None, "win-7"), ("mcpServers", "secrets", None, "win-7")]
    published.clear()

    assert c.delete("/api/mcp-secrets/GH_TOKEN?clientId=win-7").status_code == 200
    _wait(published, 2)
    assert sorted((e.kind, e.path, e.version, e.origin) for e in published) == [
        ("agents", "secrets", None, "win-7"), ("mcpServers", "secrets", None, "win-7")]
    published.clear()

    # Refusals announce nothing.
    c.post("/api/mcp-servers", json={"server": _stdio("object")})
    c.put("/api/mcp-secrets/PATH", json={"value": VAR_SECRET})
    time.sleep(0.05)
    assert published == []


def test_test_route(api, http_fake):
    c = api["client"]
    made = _create(c, _stdio())
    res = c.post(f"/api/mcp-servers/{made['id']}/test")
    assert res.status_code == 200, res.text
    result = res.json()
    assert result["ok"] is True and result["error"] is None
    assert [t["name"] for t in result["tools"]] == ["add", "echo", "whoami"]
    assert result["elapsedMs"] > 0 and result["at"].endswith("Z")
    [server] = c.get("/api/mcp-servers").json()["servers"]
    assert server["lastTest"] == result

    # A disabled server still tests.
    off = _create(c, _stdio("off", enabled=False))
    res = c.post(f"/api/mcp-servers/{off['id']}/test")
    assert res.status_code == 200 and res.json()["ok"] is True

    # An HTTP server with a wrong bearer: ok false with the 401 message.
    url = http_fake("http", require_bearer=BEARER_SECRET)
    web = _create(c, _url("web", url, WRONG_BEARER))
    res = c.post(f"/api/mcp-servers/{web['id']}/test")
    assert res.status_code == 200
    assert res.json()["ok"] is False and res.json()["error"] == REFUSED_401
    good = _create(c, _url("web2", url, BEARER_SECRET))
    assert c.post(f"/api/mcp-servers/{good['id']}/test").json()["ok"] is True

    # The secrets file removed: 422.
    (state_dir() / "secrets.json").unlink()
    res = c.post(f"/api/mcp-servers/{made['id']}/test")
    assert res.status_code == 422 and res.json() == {"detail": "A secret is missing. Set it again."}


def test_secret_routes(api):
    c = api["client"]
    agent_id = _agent("Researcher", {
        "gh": _folder_fake("FAKE_FOLDER_KEY"),
        "home": {"command": PY, "args": ["${USERPROFILE}", "${HOME}"]},
    })

    res = c.put("/api/mcp-secrets/GH_TOKEN", json={"value": VAR_SECRET})
    assert res.status_code == 200 and res.json() == {"name": "GH_TOKEN", "set": True}

    vars_ = {v["name"]: v for v in c.get("/api/mcp-secrets").json()["vars"]}
    assert vars_["GH_TOKEN"] == {"name": "GH_TOKEN", "set": True, "settable": True, "usedBy": []}
    assert vars_["FAKE_FOLDER_KEY"] == {
        "name": "FAKE_FOLDER_KEY", "set": False, "settable": True,
        "usedBy": [{"agentId": agent_id, "agentName": "Researcher", "server": "gh"}],
    }
    for name in ("USERPROFILE", "HOME"):
        assert vars_[name]["settable"] is False
        assert vars_[name]["usedBy"] == [{"agentId": agent_id, "agentName": "Researcher", "server": "home"}]

    for name, body in (("PATH", {"value": VAR_SECRET}), ("CLAUDE_CONFIG_DIR", {"value": VAR_SECRET}),
                       ("USERPROFILE", {"value": VAR_SECRET}), ("GH_TOKEN", {"value": ""}),
                       ("GH_TOKEN", {}), ("a-b", {"value": VAR_SECRET}),
                       ("GH_TOKEN", {"value": "x" * 16385})):
        res = c.put(f"/api/mcp-secrets/{name}", json=body)
        assert res.status_code == 422, (name, res.text)
    assert c.put("/api/mcp-secrets/PATH", json={"value": "v"}).json()["detail"] == "Object can't set this variable."

    # The folder var set makes the agent's server usable.
    assert c.put("/api/mcp-secrets/FAKE_FOLDER_KEY", json={"value": FOLDER_SECRET}).status_code == 200
    agent = c.get(f"/api/agents/{agent_id}").json()
    gh = next(s for s in agent["mcpServers"] if s["name"] == "gh")
    assert gh == {"name": "gh", "missingVars": [], "usable": True}

    res = c.delete("/api/mcp-secrets/GH_TOKEN?clientId=win-1")
    assert res.status_code == 200 and res.json() == {"ok": True}
    assert c.delete("/api/mcp-secrets/GH_TOKEN").status_code == 404
    assert "GH_TOKEN" not in {v["name"] for v in c.get("/api/mcp-secrets").json()["vars"]}


def test_refresh_agent_tools(api, http_fake, monkeypatch):
    c = api["client"]
    url = http_fake("http", require_bearer=BEARER_SECRET)
    _create(c, _url("web", url, BEARER_SECRET))
    agent_id = _agent("Researcher", {"gh": _folder_fake()})
    assert c.put("/api/mcp-secrets/FAKE_FOLDER_KEY", json={"value": FOLDER_SECRET}).status_code == 200

    before = {g["id"]: g for g in c.get(f"/api/agents/{agent_id}/tools").json()["groups"]}
    assert before["mcp:gh"]["server"]["status"] == "unknown"
    assert before["mcp:web"]["server"]["status"] == "unknown"

    res = c.post(f"/api/agents/{agent_id}/tools/refresh")
    assert res.status_code == 200, res.text
    groups = res.json()["groups"]
    by_id = {g["id"]: g for g in groups}
    for gid, name, source in (("mcp:gh", "gh", "folder"), ("mcp:web", "web", "gateway")):
        group = by_id[gid]
        assert group["server"]["status"] == "ok", group["server"]
        assert group["server"]["source"] == source
        ids = [t["id"] for t in group["tools"]]
        assert ids[-3:] == [f"mcp__{name}__add", f"mcp__{name}__echo", f"mcp__{name}__whoami"]
        assert all(t["on"] for t in group["tools"])
    assert [g["id"] for g in groups].count("mcp:gh") == 1

    # The GET answers the same groups, from the cache.
    assert c.get(f"/api/agents/{agent_id}/tools").json()["groups"] == groups

    # A hanging server is an error while the others are listed. The timeout is patched to 5 s, not
    # the plan's 1 s: a stdio fake (Python plus the mcp library) takes over 1 s to start on Windows.
    _create(c, {"name": "slow", "kind": "command", "command": PY, "args": [FAKE, "--hang"]})
    monkeypatch.setattr(mcpprobe, "PROBE_TIMEOUT_S", 5)
    started = time.monotonic()
    by_id = {g["id"]: g for g in c.post(f"/api/agents/{agent_id}/tools/refresh").json()["groups"]}
    assert time.monotonic() - started < 20
    assert by_id["mcp:slow"]["server"]["status"] == "error"
    assert by_id["mcp:slow"]["server"]["error"] == "The server didn't answer within 5 seconds."
    assert by_id["mcp:gh"]["server"]["status"] == "ok", by_id["mcp:gh"]["server"]["error"]
    assert by_id["mcp:web"]["server"]["status"] == "ok"

    assert c.post("/api/agents/nope/tools/refresh").status_code == 404


def test_no_answer_holds_a_secret(api, http_fake, caplog):
    caplog.set_level(logging.DEBUG)
    c = api["client"]
    url = http_fake("http", require_bearer=BEARER_SECRET)
    printer = _create(c, _stdio("printer", "--print-env-and-exit"))
    web = _create(c, _url("web", url, WRONG_BEARER))
    _create(c, _url("web2", url, BEARER_SECRET))
    agent_id = _agent("Researcher", {"gh": _folder_fake()})

    c.get("/api/mcp-servers")
    # The Test errors: stderr holding the whole environment, and a 401 echoing the header.
    res = c.post(f"/api/mcp-servers/{printer['id']}/test").json()
    assert res["ok"] is False and res["error"].startswith("The server stopped before it answered.")
    assert c.post(f"/api/mcp-servers/{web['id']}/test").json()["ok"] is False
    # 422s refusing a bad secret, for a server and for a variable.
    bad = _stdio("bad")
    bad["env"][1]["value"] = BAD_SECRET
    assert c.post("/api/mcp-servers", json={"server": bad}).status_code == 422
    assert c.put("/api/mcp-secrets/GH_TOKEN", json={"value": BAD_SECRET}).status_code == 422
    assert c.put("/api/mcp-secrets/GH_TOKEN", json={"value": VAR_SECRET + "x" * 16385}).status_code == 422
    assert c.put("/api/mcp-secrets/PATH", json={"value": VAR_SECRET}).status_code == 422
    assert c.put("/api/mcp-secrets/FAKE_FOLDER_KEY", json={"value": FOLDER_SECRET}).status_code == 200
    assert c.put("/api/mcp-secrets/GH_TOKEN", json={"value": VAR_SECRET}).status_code == 200
    c.get("/api/mcp-secrets")
    c.post(f"/api/agents/{agent_id}/tools/refresh")
    c.get(f"/api/agents/{agent_id}/tools")
    c.get(f"/api/agents/{agent_id}")
    c.get("/api/mcp-servers")
    _wait(api["published"], 1)

    bodies = [r.text for r in api["responses"]]
    events = [repr(e) for e in api["published"]]
    logs = caplog.text
    assert bodies and events
    for secret in SECRETS:
        for text in (*bodies, *events, logs):
            assert secret not in text


def test_reads_and_probes_write_nothing(api, http_fake):
    c = api["client"]
    url = http_fake("http", require_bearer=BEARER_SECRET)
    stdio = _create(c, _stdio())
    _create(c, _url("web", url, BEARER_SECRET))
    agent_id = _agent("Researcher", {"gh": _folder_fake()})
    assert c.put("/api/mcp-secrets/FAKE_FOLDER_KEY", json={"value": FOLDER_SECRET}).status_code == 200
    folders = AgentRegistry().local_folders()

    before = _hashes(state_dir(), api["space"], *folders)
    assert c.get("/api/mcp-servers").status_code == 200
    assert c.get("/api/mcp-secrets").status_code == 200
    assert c.post(f"/api/mcp-servers/{stdio['id']}/test").json()["ok"] is True
    assert c.post(f"/api/agents/{agent_id}/tools/refresh").status_code == 200
    assert c.get(f"/api/agents/{agent_id}/tools").status_code == 200
    assert _hashes(state_dir(), api["space"], *folders) == before


def test_routes_answer_while_ai_is_hidden(api):
    _set(aiHidden=True)
    c = api["client"]
    res = c.get("/api/mcp-servers")
    assert res.status_code == 200
    assert res.json() == {"servers": [], "readOnlyReason": None}
    assert c.get("/api/mcp-secrets").status_code == 200
