"""The app's remote-agent routes (M20, spec section 7): ``/api/remote-agents/*`` and
``POST /api/agents/{id}/files/reveal`` (the plan's Contract "Routes").

- ``POST /remote-agents/preview`` ``{url, auth}`` -> ``RemotePreview``. Writes nothing. 422 (a bad
  URL, the header rule, the card refusals); 502 "Couldn't reach {host}: {reason}" / "{host}
  answered {status}." ("{host} refused the token." for 401/403).
- ``POST /remote-agents`` ``AddRemoteAgentRequest`` -> 201 ``Agent`` (``kind: "remote"``); the
  card is fetched again. As preview, plus 409 "This agent is already listed as {name}." (same
  ``cardUrl`` and endpoint).
- ``PUT  /remote-agents/{id}`` ``SaveRemoteAgentRequest`` -> ``Agent``. 404; 409
  ``{currentRevision}``; 422 (name, header rule; not a remote agent).
- ``POST /remote-agents/{id}/refresh`` ``{clientId?}`` -> ``Agent`` (the card fetched again; an
  endpoint on another host drops the secret). 404; 422; 502.
- ``POST /remote-agents/{id}/context-notice`` ``{clientId?}`` -> ``{contextNoticeAt}``. 404; 422.
- ``POST /agents/{id}/files/reveal`` ``{file}`` (``"<chatId>/<name>"``) -> ``{ok: true}``: shows
  the file in the OS file manager. 404 for an unknown agent or file, or a ``file`` that resolves
  outside the agent's ``files/``.

Writes announce ``ChangeEvent("agents", <agentId>, <revision>, origin=clientId)``. Bodies are
validated here, not by FastAPI, so a 422 never echoes a submitted value; no answer, event, log
line or error message holds a token or header value (messages pass through
`secretstore.redact`). Imports no network client: the card is fetched through ``a2a``, inside
the route.
"""

from __future__ import annotations

import asyncio
import ipaddress
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError

from . import a2a, agents, secretstore
from .agentmodel import AgentError, AgentInvalid, AgentNotFound
from .agents import NOT_REMOTE, AgentRecord, AgentRegistry, endpoint_host, remote_auth
from .api_agents import _fail
from .api_agents import _settings as _device_settings
from .apictx import ApiContext
from .remotemodel import CARD_TIMEOUT, REMOTE_KIND, AuthInput, card_url_for, clean_auth
from .watcher import ChangeEvent

__all__ = ["preview_warnings", "router"]

FILES_DIR = ".object-agent/files"
"""A remote agent's file artifacts, under its folder (the Contract's Storage table)."""

BAD_REQUEST = "That request can't be used."  # our string
ALREADY_LISTED = "This agent is already listed as {name}."
UNREACHABLE = "Couldn't reach {host}: {reason}"
ANSWERED = "{host} answered {status}."
REFUSED_TOKEN = "{host} refused the token."
NO_ANSWER_IN_TIME = f"it didn't answer within {int(CARD_TIMEOUT)} seconds"  # our string
NO_CONNECTION = "no connection could be made"  # our string
NO_FILE = "That file isn't there."  # our string
OTHER_HOST = "This agent's card sends messages to {endpoint}, not {card}."
NOT_ENCRYPTED = "This address isn't encrypted (http), so the token can be read on the network."
_REASON_MAX = 200
_ANSWERED_RE = re.compile(r" answered (\d{3})\.$")


class PreviewRequest(BaseModel):
    url: str
    auth: AuthInput


class AddRemoteAgentRequest(BaseModel):
    url: str
    auth: AuthInput
    name: str | None = None
    icon: str | None = None
    clientId: str | None = None


class SaveRemoteAgentRequest(BaseModel):
    name: str
    icon: str | None = None
    color: str | None = None
    auth: AuthInput | None = None
    baseRevision: str
    clientId: str | None = None


class ClientRequest(BaseModel):
    clientId: str | None = None


class RevealFileRequest(BaseModel):
    file: str


def _parse(model: type[BaseModel], body: Any) -> Any:
    """`model` from a request body, or None when it doesn't fit (pydantic's errors carry each
    submitted ``input``, so they never reach an answer)."""
    try:
        return model.model_validate(body if body is not None else {})
    except ValidationError:
        return None


def _error(status: int, detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail}, status_code=status)


def _hostname(url: str) -> str:
    """The host of `url` without port or user info (``[::1]`` for IPv6); ``""`` when none."""
    try:
        host = urlsplit(url or "").hostname or ""
    except ValueError:
        return ""
    return f"[{host}]" if ":" in host else host


def _loopback(host: str) -> bool:
    host = host.strip("[]").lower()
    if host == "localhost" or host.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def preview_warnings(card_url: str, endpoint_url: str, has_token: bool) -> list[str]:
    """`RemotePreview.warnings` (our strings): the endpoint on another host than the card; an
    ``http`` endpoint that isn't loopback when a token is given."""
    warnings: list[str] = []
    card_host, ep_host = _hostname(card_url), _hostname(endpoint_url)
    if card_host.lower() != ep_host.lower():
        warnings.append(OTHER_HOST.format(endpoint=ep_host, card=card_host))
    try:
        scheme = urlsplit(endpoint_url).scheme.lower()
    except ValueError:
        scheme = ""
    if has_token and scheme == "http" and not _loopback(ep_host):
        warnings.append(NOT_ENCRYPTED)
    return warnings


def _card_out(card: a2a.Card) -> dict[str, Any]:
    """The `RemoteCard` shape of a parsed card."""
    skills = [{
        "id": str(s.get("id") or ""), "name": str(s.get("name") or ""),
        "description": str(s.get("description") or ""),
        "tags": [t for t in s.get("tags") or [] if isinstance(t, str)],
        "examples": [t for t in s.get("examples") or [] if isinstance(t, str)],
    } for s in card.skills]
    return {
        "name": card.name, "description": card.description, "version": card.version,
        "provider": card.provider, "documentationUrl": card.documentation_url, "skills": skills,
        "streaming": card.streaming, "inputModes": list(card.input_modes), "outputModes": list(card.output_modes),
    }


def _a2a_auth(auth: AuthInput) -> a2a.Auth:
    return a2a.Auth(kind=auth.kind, header_name=auth.headerName, value=auth.value)


def _fetch_failed(exc: a2a.A2AError, card_url: str, secrets: list[str]) -> JSONResponse:
    """A failed card fetch as the Contract's answer: a refused card stays 422 with its message;
    anything else is 502 "Couldn't reach {host}: {reason}" or "{host} answered {status}."."""
    host = _hostname(card_url) or "The agent"
    if exc.status == 422:
        return _error(422, secretstore.redact(exc.message, secrets))
    if exc.status == 504:
        message = UNREACHABLE.format(host=host, reason=NO_ANSWER_IN_TIME)
    elif (m := _ANSWERED_RE.search(exc.message)) is not None:
        status = int(m.group(1))
        message = (REFUSED_TOKEN if status in (401, 403) else ANSWERED).format(host=host, status=status)
    elif exc.message.startswith("Object couldn't reach"):
        cause = exc.__cause__ or exc.__context__
        reason = " ".join(str(cause).split()) if cause is not None else ""
        message = UNREACHABLE.format(host=host, reason=(reason or NO_CONNECTION)[:_REASON_MAX])
    else:
        message = exc.message
    return _error(502, secretstore.redact(message, secrets))


async def _fetch(card_url: str, auth: a2a.Auth) -> tuple[a2a.Card | None, JSONResponse | None]:
    """The card at `card_url` (fetched with `auth`), or the error answer."""
    secrets = [auth.value] if auth.value else []
    try:
        return await a2a.fetch_card(card_url, auth), None
    except a2a.A2AError as exc:
        return None, _fetch_failed(exc, card_url, secrets)


def _target(card_url: str, auth: AuthInput) -> tuple[str, AuthInput]:
    """The card URL for what Gene typed and the cleaned auth; raises `AgentInvalid`."""
    return card_url_for(card_url), clean_auth(auth)


def router(ctx: ApiContext) -> APIRouter:
    """The remote-agent routes, mounted on the app's ``/api`` router (so no prefix here)."""
    r = APIRouter()

    def registry() -> AgentRegistry:
        return AgentRegistry()  # the state dir is read per request (tests point it elsewhere)

    def out(rec: AgentRecord) -> dict[str, Any]:
        return rec.to_api(_device_settings())

    def announce(agent_id: str, revision: str | None, origin: str | None) -> None:
        ctx.announce(ChangeEvent("agents", agent_id, revision, origin=origin))

    def remote_of(agent_id: str) -> AgentRecord:
        rec = registry().get(agent_id)
        if rec.kind != REMOTE_KIND:
            raise AgentInvalid(NOT_REMOTE)
        return rec

    def listed_as(card_url: str, endpoint_url: str) -> str | None:
        """The name of a listed remote agent with this card URL and endpoint, if any."""
        for rec in registry().list():
            if rec.kind != REMOTE_KIND:
                continue
            ep = rec.data.get("endpoint")
            url = ep.get("url") if isinstance(ep, dict) else None
            if rec.data.get("cardUrl") == card_url and url == endpoint_url:
                name = rec.data.get("name")
                return name if isinstance(name, str) else rec.folder.name
        return None

    def create_once(card: a2a.Card, card_url: str, auth: AuthInput, name: str | None,
                    icon: str | None) -> AgentRecord | str:
        """The new remote agent, or the name it is already listed as. The check and the create run
        under the registry's lock, so two adds of the same card can't both pass the check."""
        with agents._lock:
            existing = listed_as(card_url, card.endpoint_url)
            if existing is not None:
                return existing
            return registry().create_remote(card, card.raw, card_url, auth, name, icon)

    # -- preview and add ----------------------------------------------------------------------

    @r.post("/remote-agents/preview")
    async def preview(body: Any = Body(None)):
        req = _parse(PreviewRequest, body)
        if req is None:
            return _error(422, BAD_REQUEST)
        try:
            card_url, auth = _target(req.url, req.auth)
        except AgentError as exc:
            return _fail(exc)
        card, failed = await _fetch(card_url, _a2a_auth(auth))
        if card is None:
            return failed
        return {
            "cardUrl": card_url,
            "card": _card_out(card),
            "endpointUrl": card.endpoint_url,
            "endpointHost": endpoint_host(card.endpoint_url),
            "warnings": preview_warnings(card_url, card.endpoint_url, bool(auth.value)),
        }

    @r.post("/remote-agents", status_code=201)
    async def add(body: Any = Body(None)):
        req = _parse(AddRemoteAgentRequest, body)
        if req is None:
            return _error(422, BAD_REQUEST)
        try:
            card_url, auth = _target(req.url, req.auth)
        except AgentError as exc:
            return _fail(exc)
        card, failed = await _fetch(card_url, _a2a_auth(auth))
        if card is None:
            return failed
        try:
            rec = await asyncio.to_thread(create_once, card, card_url, auth, req.name, req.icon)
        except AgentError as exc:
            return _fail(exc)
        if isinstance(rec, str):
            return _error(409, ALREADY_LISTED.format(name=rec))
        announce(rec.id, rec.revision, req.clientId)
        return JSONResponse(out(rec), status_code=201)

    # -- edit ---------------------------------------------------------------------------------

    @r.put("/remote-agents/{agent_id}")
    def save(agent_id: str, body: Any = Body(None)):
        req = _parse(SaveRemoteAgentRequest, body)
        if req is None:
            return _error(422, BAD_REQUEST)
        try:
            remote_of(agent_id)
            rec = registry().save_remote(agent_id, name=req.name, icon=req.icon, color=req.color,
                                         auth=req.auth, base_revision=req.baseRevision)
        except AgentError as exc:
            return _fail(exc)
        announce(rec.id, rec.revision, req.clientId)
        return out(rec)

    @r.post("/remote-agents/{agent_id}/refresh")
    async def refresh(agent_id: str, body: Any = Body(None)):
        req = _parse(ClientRequest, body)
        if req is None:
            return _error(422, BAD_REQUEST)
        try:
            rec = await asyncio.to_thread(remote_of, agent_id)
            stored = rec.data.get("cardUrl")
            card_url = card_url_for(stored if isinstance(stored, str) else "")
        except AgentError as exc:
            return _fail(exc)
        auth = await asyncio.to_thread(remote_auth, rec)
        card, failed = await _fetch(card_url, auth)
        if card is None:
            return failed
        try:
            rec = await asyncio.to_thread(registry().refresh_remote, agent_id, card, card.raw, card_url)
        except AgentError as exc:
            return _fail(exc)
        announce(rec.id, rec.revision, req.clientId)
        return out(rec)

    @r.post("/remote-agents/{agent_id}/context-notice")
    def context_notice(agent_id: str, body: Any = Body(None)):
        req = _parse(ClientRequest, body)
        if req is None:
            return _error(422, BAD_REQUEST)
        reg = registry()
        try:
            remote_of(agent_id)
            at = reg.mark_context_notice(agent_id)
            rec = reg.get(agent_id)
        except AgentError as exc:
            return _fail(exc)
        announce(rec.id, rec.revision, req.clientId)
        return {"contextNoticeAt": at}

    # -- reveal a file artifact ---------------------------------------------------------------

    @r.post("/agents/{agent_id}/files/reveal")
    def reveal_file(agent_id: str, body: Any = Body(None)):
        from . import server  # server imports this module

        req = _parse(RevealFileRequest, body)
        if req is None:
            return _error(422, BAD_REQUEST)
        try:
            rec = registry().get(agent_id)
        except AgentError as exc:
            return _fail(exc)
        files = (rec.folder / FILES_DIR).resolve()
        name = req.file.replace("\\", "/").strip()
        if not name or name.startswith("/") or ".." in name.split("/"):
            return _fail(AgentNotFound(NO_FILE))
        try:
            path = (files / name).resolve()
        except (OSError, ValueError):
            return _fail(AgentNotFound(NO_FILE))
        if not path.is_relative_to(files) or path == files or not path.is_file():
            return _fail(AgentNotFound(NO_FILE))
        server.reveal_in_file_manager(Path(path))
        return {"ok": True}

    return r
