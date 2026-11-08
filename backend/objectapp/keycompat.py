"""Older key names in ``.object/`` JSON, settings and request bodies, read as today's.

Spaces saved before the type keys were renamed hold query, view, collection, type,
``ui.json`` and settings JSON with the older names (left column below). Every loader of
those files, and the request-body parsers of the app's API and the MCP server, pass the
parsed JSON through `upgrade_keys`, which renames them in memory. Nothing is written
back: a file gets today's names the next time it is saved for another reason.

This module is the only place the older names appear.

A key is renamed only when its value has the shape the named field has (a type id
string, a list, a flag, an object), and only when today's key isn't there too (today's
key wins). The shape check keeps a map keyed by type ids (``tableConfigs``,
``smallCardViewConfigs``) intact when a type's id happens to be one of these words.

A request body's property values are the user's own: a property named "Structure ID"
or "Structures" has the key ``structureId`` or ``structures`` (`space.camel_key`), and a
value map keyed by property keys (``updates``, ``values``, ``set``...) must keep them.
`upgrade_body` and the in-process tool calls never look under those keys (`VALUE_KEYS`);
definition JSON (queries, views, collections, types, ``ui``) holds no such map, so the
walk over a loaded file stays complete.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

__all__ = [
    "OLD_KEYS",
    "VALUE_KEYS",
    "KeyCompatMiddleware",
    "upgrade_body",
    "upgrade_keys",
    "upgrade_list_name",
]

_NONE = type(None)

# old key -> (today's key, the value types the old key is renamed for)
OLD_KEYS: dict[str, tuple[str, tuple[type, ...]]] = {
    "structureId": ("typeId", (str, _NONE)),
    "structureIds": ("typeIds", (list,)),
    "structures": ("types", (list,)),
    "excludeStructureIds": ("excludeTypeIds", (list,)),
    "filterStructureIds": ("filterTypeIds", (list,)),
    "hideStructureSettings": ("hideTypeSettings", (bool,)),
    "structureViews": ("typeViews", (dict,)),
}

# Request-body keys whose value is the user's own (a map keyed by property keys, or
# text): `upgrade_body` leaves everything under them exactly as it was sent.
VALUE_KEYS: frozenset[str] = frozenset(
    {
        "updates",  # PUT /api/object/properties
        "values",  # POST /api/objects, POST /v1/objects, desk sync
        "set",  # POST /v1/object/properties
        "add",
        "subtract",
        "remove",
        "mapping",  # change-type and import column maps: property key -> property key
        "frontmatter",
        "properties",
        "body",
    }
)

# A deleted type's trash manifest names the query list it was dropped from
# (``queryRefs[].list``): the older names of those lists.
_OLD_LIST_NAMES = {"structures": "types", "excludeStructureIds": "excludeTypeIds"}

# Bytes every old key contains: a body without them is passed through unparsed.
_MARKER = b"tructure"


def _rename(d: dict[str, Any]) -> bool:
    if not any(k in OLD_KEYS for k in d):
        return False
    changed = False
    items: list[tuple[str, Any]] = []
    for k, v in d.items():
        spec = OLD_KEYS.get(k)
        if spec is not None and isinstance(v, spec[1]):
            changed = True
            if spec[0] in d:
                continue  # today's key is there too: it wins
            k = spec[0]
        items.append((k, v))
    if changed:
        d.clear()
        d.update(items)
    return changed


def upgrade_keys(value: Any, *, skip: frozenset[str] = frozenset()) -> bool:
    """Rename older keys to today's, in place, at every depth; True when anything changed.

    Nothing under a key in `skip` is looked at (a request body's value maps, `VALUE_KEYS`).
    """
    changed = False
    stack = [value]
    while stack:
        v = stack.pop()
        if isinstance(v, dict):
            changed = _rename(v) or changed
            stack.extend(x for k, x in v.items() if k not in skip)
        elif isinstance(v, list):
            stack.extend(v)
    return changed


def upgrade_list_name(name: Any) -> Any:
    """A trash manifest's ``queryRefs[].list`` under today's name."""
    return _OLD_LIST_NAMES.get(name, name) if isinstance(name, str) else name


def upgrade_body(raw: bytes) -> bytes:
    """A JSON request body with today's keys (unchanged bytes when there is nothing to rename
    or it isn't JSON)."""
    if _MARKER not in raw:
        return raw
    try:
        data = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return raw
    if not upgrade_keys(data, skip=VALUE_KEYS):
        return raw
    try:
        return json.dumps(data, ensure_ascii=False).encode("utf-8")
    except UnicodeEncodeError:  # a lone surrogate (`\ud800`): the route answers it itself
        return raw


Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]


class KeyCompatMiddleware:
    """ASGI middleware: a JSON request body (``/api`` and ``/api/v1``, so the MCP server's
    calls too) reaches the routes with today's keys."""

    def __init__(self, app: Callable[[Scope, Receive, Send], Awaitable[None]]) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http" or scope.get("method") not in ("POST", "PUT", "PATCH"):
            await self.app(scope, receive, send)
            return
        headers = scope.get("headers") or []
        ctype = next((v for k, v in headers if k.lower() == b"content-type"), b"")
        if b"json" not in ctype.lower():
            await self.app(scope, receive, send)
            return
        chunks: list[bytes] = []
        while True:
            message = await receive()
            if message["type"] != "http.request":
                # The client went away before the body arrived: let the app see that.
                async def gone(message: Message = message) -> Message:
                    return message

                await self.app(scope, gone, send)
                return
            chunks.append(message.get("body", b""))
            if not message.get("more_body", False):
                break
        raw = b"".join(chunks)
        body = upgrade_body(raw)
        if body is not raw:
            scope = dict(scope)
            scope["headers"] = [
                (k, str(len(body)).encode("latin-1") if k.lower() == b"content-length" else v)
                for k, v in headers
            ]
        sent = False

        async def replay() -> Message:
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay, send)
