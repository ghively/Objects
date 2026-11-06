"""The MCP gateway's routes (M19): ``/mcp-servers...``, ``/mcp-secrets...`` and
``/agents/{id}/tools/refresh``.

- ``GET    /mcp-servers`` -> ``McpServersAnswer`` (file order; ``unreadable`` is true when the
  file is there but can't be read, and writes stay allowed). Never writes.
- ``POST   /mcp-servers`` ``{server, clientId?}`` -> 201 ``McpServer``. 409 (name taken, no
  ``currentRevision``), 422, 423.
- ``PUT    /mcp-servers/{id}`` ``{server, baseRevision, clientId?}`` -> ``McpServer``. 404,
  409 ``{currentRevision}``, 422, 423.
- ``DELETE /mcp-servers/{id}?clientId=`` -> ``{ok: true}`` (its secrets are deleted too). 404, 423.
- ``POST   /mcp-servers/{id}/test`` -> ``McpTestResult`` (also for a disabled server; the result
  goes into `mcpgateway.TOOL_CACHE`). 404; 422 when a secret is missing.
- ``GET    /mcp-secrets`` -> ``{vars: SecretVar[]}``. Never writes.
- ``PUT    /mcp-secrets/{name}`` ``{value, clientId?}`` -> ``{name, set: true}``. 422.
- ``DELETE /mcp-secrets/{name}?clientId=`` -> ``{ok: true}``. 404.
- ``POST   /agents/{id}/tools/refresh`` -> ``{groups}``, as ``GET /agents/{id}/tools``. 404.

Writes announce ``ChangeEvent("mcpServers", <serverId or "secrets">, <revision or None>,
origin=clientId)``; a secret set or delete also announces ``ChangeEvent("agents", "secrets",
None, origin=clientId)`` (a missing var changes ``Agent.mcpServers``).

Mounted on the app's ``/api`` router before `api_agents`. Every route stays available while
"Hide AI features" is on; only the UI hides the section. Bodies are validated in the routes, not
by FastAPI, so a 422 message never holds a submitted value, and no answer, event or log line ever holds a secret value. Imports no network client.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError

from . import agentfiles, mcpprobe
from .agents import AgentError, AgentRecord, AgentRegistry
from .api_agents import agent_tool_groups
from .apictx import ApiContext
from .mcpgateway import TOOL_CACHE, gateway_key, probe_targets
from .mcpmodel import MAX_SECRET_CHARS, McpServerInput
from .mcpstore import McpConflict, McpError, McpStore, MissingSecret, cli_entry
from .secretstore import SecretStore, check_var_name, lookup_var, var_key
from .watcher import ChangeEvent

__all__ = ["router"]

# Our strings.
SECRET_MISSING = "A secret is missing. Set it again."
ENTER_VALUE = "Enter a value."
SECRET_TOO_LONG = "That secret is too long."
BAD_SECRET = "That value can't be used."
NO_SUCH_VAR = "That secret variable isn't set."
BAD_SERVER = "That server can't be saved."
SECRETS_PATH = "secrets"


class CreateServerRequest(BaseModel):
    server: McpServerInput
    clientId: str | None = None


class SaveServerRequest(BaseModel):
    server: McpServerInput
    baseRevision: str | None = None
    clientId: str | None = None


class SecretRequest(BaseModel):
    value: str | None = None
    clientId: str | None = None


def _parse(model: type[BaseModel], body: Any) -> Any:
    """`model` from a request body, or None when it doesn't fit. The body is validated here, not
    by FastAPI, so a 422 is ours and never echoes a submitted value (pydantic's errors carry
    each one's ``input``)."""
    try:
        return model.model_validate(body)
    except ValidationError:
        return None


def _error(status: int, detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail}, status_code=status)


def _fail(exc: McpError) -> JSONResponse:
    body: dict[str, Any] = {"detail": exc.message}
    if isinstance(exc, McpConflict) and exc.current_revision is not None:
        body["currentRevision"] = exc.current_revision  # a name clash carries no currentRevision
    if exc.status == 423:
        body["reason"] = exc.message
    return JSONResponse(body, status_code=exc.status)


def _test_out(result: mcpprobe.ProbeResult) -> dict[str, Any]:
    """The API's ``McpTestResult``."""
    return {
        "ok": result.ok,
        "tools": [{"name": n, "description": d} for n, d in result.tools],
        "error": result.error,
        "elapsedMs": result.elapsed_ms,
        "at": result.at,
    }


def _agent_name(rec: AgentRecord) -> str:
    name = rec.data.get("name") if isinstance(rec.data, dict) else None
    return name if isinstance(name, str) else rec.folder.name


def _secret_vars(registry: AgentRegistry, secrets: SecretStore) -> list[dict[str, Any]]:
    """Every ``var:`` secret plus every ``${NAME}`` an agent folder's ``.mcp.json`` uses, by name
    (read only)."""
    uses: dict[str, list[dict[str, str]]] = {}
    for key in secrets.keys("var:"):
        uses.setdefault(key[len("var:"):], [])
    for rec in registry.list():
        if not rec.exists or rec.missing:
            continue
        for server, entry in agentfiles.folder_mcp_servers(rec.folder).items():
            for name in sorted(agentfiles.var_refs(entry)):
                uses.setdefault(name, []).append(
                    {"agentId": rec.id, "agentName": _agent_name(rec), "server": server}
                )
    out: list[dict[str, Any]] = []
    for name in sorted(uses, key=lambda n: (n.casefold(), n)):
        try:
            check_var_name(name)
            settable = True
        except ValueError:
            settable = False
        is_set = secrets.has(var_key(name)) if settable else lookup_var(name) is not None
        out.append({"name": name, "set": is_set, "settable": settable, "usedBy": uses[name]})
    return out


def router(ctx: ApiContext) -> APIRouter:
    """The MCP routes (no prefix here)."""
    r = APIRouter()

    def store() -> McpStore:
        return McpStore()  # the state dir is read per request (tests point it elsewhere)

    def announce(path: str, revision: str | None, origin: str | None) -> None:
        ctx.announce(ChangeEvent("mcpServers", path, revision, origin=origin))

    def announce_secrets(origin: str | None) -> None:
        announce(SECRETS_PATH, None, origin)
        ctx.announce(ChangeEvent("agents", SECRETS_PATH, None, origin=origin))

    def server_out(st: McpStore, rec: Any) -> dict[str, Any]:
        return rec.to_api(st.secrets, TOOL_CACHE.get(gateway_key(rec)))

    # -- servers ----------------------------------------------------------------------------

    @r.get("/mcp-servers")
    def list_servers():
        st = store()
        return {
            "servers": [server_out(st, rec) for rec in st.list()],
            "readOnlyReason": st.read_only_reason(),
            "unreadable": st.unreadable(),
        }

    @r.post("/mcp-servers", status_code=201)
    def create_server(body: Any = Body(None)):
        req = _parse(CreateServerRequest, body)
        if req is None:
            return _error(422, BAD_SERVER)
        st = store()
        try:
            rec = st.create(req.server)
        except McpError as exc:
            return _fail(exc)
        announce(str(rec.data["id"]), rec.revision, req.clientId)
        return JSONResponse(server_out(st, rec), status_code=201)

    @r.put("/mcp-servers/{server_id}")
    def save_server(server_id: str, body: Any = Body(None)):
        req = _parse(SaveServerRequest, body)
        if req is None:
            return _error(422, BAD_SERVER)
        st = store()
        try:
            rec = st.save(server_id, req.server, req.baseRevision or "")
        except McpError as exc:
            return _fail(exc)
        announce(server_id, rec.revision, req.clientId)
        return server_out(st, rec)

    @r.delete("/mcp-servers/{server_id}")
    def delete_server(server_id: str, clientId: str | None = None):  # noqa: N803 - the query name
        try:
            store().delete(server_id)
        except McpError as exc:
            return _fail(exc)
        announce(server_id, None, clientId)
        return {"ok": True}

    @r.post("/mcp-servers/{server_id}/test")
    def test_server(server_id: str):
        st = store()
        try:
            rec = st.get(server_id)
        except McpError as exc:
            return _fail(exc)
        try:
            entry, env = cli_entry(rec.data, st.secrets)
        except MissingSecret:
            return _error(422, SECRET_MISSING)
        result = mcpprobe.probe_sync(entry, env, redact_values=st.secrets.values())
        TOOL_CACHE.put(gateway_key(rec), result)
        return _test_out(result)

    # -- secret variables -------------------------------------------------------------------

    @r.get("/mcp-secrets")
    def list_secrets():
        return {"vars": _secret_vars(AgentRegistry(), SecretStore())}

    @r.put("/mcp-secrets/{name}")
    def set_secret(name: str, body: Any = Body(None)):
        try:
            check_var_name(name)
        except ValueError as exc:
            return _error(422, str(exc))
        req = _parse(SecretRequest, body)
        if req is None:
            return _error(422, BAD_SECRET)
        value = req.value
        if not isinstance(value, str) or value == "":
            return _error(422, ENTER_VALUE)
        if len(value) > MAX_SECRET_CHARS:
            return _error(422, SECRET_TOO_LONG)
        if "\x00" in value:
            return _error(422, BAD_SECRET)
        try:
            SecretStore().set(var_key(name), value)
        except ValueError:
            return _error(422, BAD_SECRET)  # never the store's message: it could name the value
        announce_secrets(req.clientId)
        return {"name": name, "set": True}

    @r.delete("/mcp-secrets/{name}")
    def delete_secret(name: str, clientId: str | None = None):  # noqa: N803 - the query name
        try:
            gone = SecretStore().delete(var_key(name))
        except ValueError:
            gone = False
        if not gone:
            return _error(404, NO_SUCH_VAR)
        announce_secrets(clientId)
        return {"ok": True}

    # -- the Tools tab ----------------------------------------------------------------------

    @r.post("/agents/{agent_id}/tools/refresh")
    def refresh_tools(agent_id: str):
        registry = AgentRegistry()
        try:
            rec = registry.get(agent_id)
        except AgentError as exc:
            return _error(exc.status, exc.message)
        targets = probe_targets(rec)
        if targets:
            results = mcpprobe.probe_many(targets, redact_values=SecretStore().values())
            for key, result in results.items():
                TOOL_CACHE.put(key, result)
        return {"groups": agent_tool_groups(registry.get(agent_id))}

    return r
