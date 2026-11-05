"""The AI assistant's routes (M10), mounted on ``/api``.

- ``GET  /ai/status`` -> `AiStatus` (is the Claude Code CLI there and does it answer)
- ``POST /ai/chat`` `AiChatRequest` -> ``text/event-stream``, one ``data: <AiEvent JSON>``
  frame per event, ending with ``done`` or ``error``. 403 when "Hide AI features" is on.
  The turn gets a read-only token held in memory (`TokenStore.ephemeral`, named "AI
  assistant") for Object's MCP read tools; it is revoked when the stream ends. Closing
  the stream stops the CLI.
- ``GET  /ai/chat?path=`` -> `AiChat` (a saved chat; 404 when the path isn't one)
- ``POST /ai/chat/save`` `SaveAiChatRequest` -> ``{path, version}``: creates the chat (no
  ``path``; the "AI Chat" type is made on the first save) or replaces its messages,
  context and session (409 ``{currentVersion}`` on a stale ``baseVersion``). A changed
  title renames the chat. Writes announce `ChangeEvent`s with the request's ``clientId``.

A turn reads the space (context pages, tag names) and writes nothing.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sse_starlette import EventSourceResponse, ServerSentEvent

from . import ai
from .aichat import (
    chat_keys,
    default_title,
    ensure_chat_type,
    find_chat_type,
    parse_body,
    render_body,
)
from .apictx import ApiContext
from .propvalues import InvalidValue
from .settings import read as read_settings
from .space import Conflict, ReadOnly
from .tokens import TokenStore
from .watcher import ChangeEvent

__all__ = ["router"]

MAX_CONTEXT_PATHS = 50
MAX_TEXT = 200_000


class AiMessageModel(BaseModel):
    role: Literal["user", "assistant"]
    text: str
    at: str = ""


class ChatRequest(BaseModel):
    mode: Literal["chat", "askBlock", "tagBlock", "tagObject", "autofill", "rephrase"]
    prompt: str = ""
    contextPaths: list[str] = []
    block: str | None = None
    history: list[AiMessageModel] = []
    sessionId: str | None = None
    clientId: str | None = None


class SaveChatRequest(BaseModel):
    path: str | None = None
    baseVersion: str | None = None
    title: str = ""
    contextPaths: list[str] = []
    sessionId: str | None = None
    messages: list[AiMessageModel] = []
    clientId: str | None = None


def _error(status: int, detail: str, **extra: Any) -> JSONResponse:
    return JSONResponse({"detail": detail, **extra}, status_code=status)


def _settings() -> dict[str, Any]:
    try:
        return read_settings()[0]
    except (ReadOnly, OSError, ValueError):  # an unreadable settings file: the defaults
        return {}


def router(ctx: ApiContext, state_folder: Path | None = None) -> APIRouter:
    space = ctx.space
    tokens = TokenStore(space.root, state_folder)
    r = APIRouter()

    # -- status and turns -------------------------------------------------------------

    @r.get("/ai/status")
    def ai_status():
        return ai.status(_settings().get("claudePath"))

    @r.post("/ai/chat")
    async def ai_chat(req: ChatRequest, request: Request):
        settings = await asyncio.to_thread(_settings)
        if settings.get("aiHidden"):
            return _error(403, "AI features are hidden (Settings > AI Assistant).")
        if len(req.contextPaths) > MAX_CONTEXT_PATHS:
            return _error(422, f"At most {MAX_CONTEXT_PATHS} context pages.")
        if len(req.prompt) > MAX_TEXT or len(req.block or "") > MAX_TEXT:
            return _error(422, "The message is too long.")
        claude = await asyncio.to_thread(ai.find_claude, settings.get("claudePath"))
        base = f"{request.url.scheme}://{request.url.netloc}"

        def frame(event: dict[str, Any]) -> ServerSentEvent:
            return ServerSentEvent(data=json.dumps(event, ensure_ascii=False), sep="\n")

        if claude is None:

            async def missing():
                yield frame({"type": "error", "message": ai.NOT_FOUND})

            return EventSourceResponse(missing(), sep="\n")

        pack = await asyncio.to_thread(
            ai.gather_context,
            space,
            req.contextPaths,
            tags=req.mode in ("tagBlock", "tagObject"),
            fields=req.mode == "autofill",
        )
        history = [m.model_dump() for m in req.history]
        fresh = ai.build_prompt(req.mode, req.prompt, pack, req.block, history)
        resume = ai.build_prompt(req.mode, req.prompt, pack, req.block) if req.sessionId else None
        allowed = {f["id"] for f in pack.fields} if req.mode == "autofill" else None
        model = settings.get("aiModel") or None

        async def stream():
            _record, secret = tokens.ephemeral(ai.TOKEN_NAME, "read")
            try:
                turn = ai.Turn(
                    claude=claude,
                    mode=req.mode,
                    prompt_resume=resume,
                    prompt_fresh=fresh,
                    session_id=req.sessionId,
                    model=model,
                    api_url=base,
                    token=secret,
                    skipped=pack.skipped,
                    allowed_keys=allowed,
                )
                async for event in ai.run_turn(turn):
                    yield frame(event)
            finally:
                TokenStore.drop_ephemeral(secret)

        return EventSourceResponse(stream(), ping=15, sep="\n")

    # -- saved chats ------------------------------------------------------------------

    def announce(kind: str, path: str, version: str | None, origin: str | None, **extra: Any) -> None:
        ctx.announce(ChangeEvent(kind, path, version, origin=origin, **extra))

    @r.get("/ai/chat")
    def load_chat(path: str):
        try:
            rel = space._rel(path)
            of, fm, version = space.read(rel)
            summary = space.get(rel)
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f"No AI chat at {path!r}")
        t = find_chat_type(space)
        if t is None or summary.type != t.id:
            return _error(404, f"No AI chat at {path!r}")
        ctx_key, ses_key = chat_keys(t)
        links = space.links_of(rel, fm) if ctx_key else {}
        context = [p for p in links.get(ctx_key, []) if p] if ctx_key else []
        session = fm.get(ses_key) if ses_key else None
        return {
            "path": rel,
            "version": version,
            "title": summary.title,
            "contextPaths": context,
            "sessionId": str(session) if session not in (None, "") else None,
            "messages": parse_body(of.body),
        }

    def context_refs(paths: list[str]) -> list[dict[str, Any]]:
        refs = []
        seen: set[str] = set()
        for path in paths[:MAX_CONTEXT_PATHS]:
            try:
                rel = space._rel(path)
                summary = space.get(rel)
            except (ValueError, KeyError):
                continue  # a page that is gone isn't linked
            if rel not in seen:
                seen.add(rel)
                refs.append({"target": summary.title or rel, "path": rel})
        return refs

    @r.post("/ai/chat/save")
    def save_chat(req: SaveChatRequest):
        origin = req.clientId
        messages = [m.model_dump() for m in req.messages]
        title = " ".join(req.title.split())
        try:
            t, type_changed = ensure_chat_type(space)
        except InvalidValue as exc:
            return _error(422, str(exc))
        if type_changed:
            announce("types", t.id, None, origin)
        ctx_key, ses_key = chat_keys(t)
        values: dict[str, Any] = {ctx_key: context_refs(req.contextPaths), ses_key: req.sessionId or None}
        try:
            if not req.path:
                title = title or default_title(messages)
                path, version = space.create_object(t.id, title, "none", values)
                announce("created", path, version, origin)
                new = space.save_body(path, render_body(title, messages), version)
                if new != version:
                    announce("changed", path, new, origin)
                return {"path": path, "version": new}
            rel = space._rel(req.path)
            summary = space.get(rel)
            if summary.type != t.id:
                return _error(404, f"No AI chat at {req.path!r}")
            if not req.baseVersion:
                return _error(422, "baseVersion is needed to update a chat.")
            _of, _fm, current = space.read(rel)
            if current != req.baseVersion:
                raise Conflict(current)
            title = title or summary.title
            result = space.update_properties(rel, values, req.baseVersion)
            version = space.save_body(rel, render_body(title, messages), result.version)
            if version != req.baseVersion:
                announce("changed", rel, version, origin)
            for synced in result.synced:
                announce("changed", synced, space.cached_version(synced), origin)
            if title != summary.title:
                renamed = space.rename_object(rel, title, version)
                if renamed.path != rel:
                    announce("renamed", renamed.path, renamed.version, origin, oldPath=rel)
                elif renamed.version != version:
                    announce("changed", rel, renamed.version, origin)
                for path in renamed.relinked:
                    announce("changed", path, space.cached_version(path), origin)
                rel, version = renamed.path, renamed.version
            return {"path": rel, "version": version}
        except Conflict as exc:
            return _error(409, "The chat changed since that version. Load it again and retry.",
                          currentVersion=exc.current_version)
        except ReadOnly as exc:
            return JSONResponse({"reason": exc.reason, "detail": exc.reason}, status_code=423)
        except InvalidValue as exc:
            return _error(422, str(exc))
        except ValueError as exc:
            return _error(400, str(exc))
        except (KeyError, FileNotFoundError):
            return _error(404, f"No AI chat at {req.path!r}")

    return r
