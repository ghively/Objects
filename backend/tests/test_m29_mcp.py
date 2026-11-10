"""M29 Task 7: the MCP tool ``sync_facts`` (plan ``2026-11-09-m29-synced-facts-and-type-suggestion.md``,
Contract "MCP"). A fake `ObjectClient` records the calls and answers as ``POST /api/v1/synced/{typeId}``
does (Contract "Routes")."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest
from mcp.server.mcpserver.exceptions import ToolError
from objectapp import mcp_server, toolcatalog
from objectapp.mcp_server import ApiError, build_server

ITEMS = [{"match": {"by": "title", "value": "APP01"}, "values": {"diskFree": 12}}]
ANSWER = {
    "type": "host",
    "refreshedAt": "2026-11-10T09:00:00.000Z",
    "revision": "r1",
    "updated": 1,
    "results": [{"index": 0, "status": "updated", "path": "Hosts/APP01.md", "objectId": "01J"}],
}


class FakeClient:
    """Records ``get``/``post`` calls; answers the sync route like the app."""

    def __init__(self, scope: str = "read-write", answer: Any = ANSWER) -> None:
        self.scope = scope
        self.answer = answer
        self.calls: list[tuple[str, str, Any]] = []

    def get(self, route: str, plain: bool = False, **params: Any) -> Any:
        self.calls.append(("GET", route, params))
        if route == "/whoami":
            if isinstance(self.scope, Exception):
                raise self.scope
            return {"name": "inventory", "scope": self.scope}
        return {}

    def post(self, route: str, body: dict[str, Any], plain: bool = False) -> Any:
        self.calls.append(("POST", route, body))
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


def _names(server) -> set[str]:
    return {t.name for t in asyncio.run(server.list_tools())}


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


def test_sync_facts_posts():
    client = FakeClient()
    server = build_server(client)  # type: ignore[arg-type]
    out = _call(server, "sync_facts", type="Host", items=ITEMS)
    assert out == ANSWER
    assert client.calls == [("POST", "/synced/Host", {"items": ITEMS})]
    # A type name is one quoted path segment.
    client.calls.clear()
    _call(server, "sync_facts", type="Hosts/../x y", items=ITEMS)
    assert client.calls[0][1] == "/synced/Hosts%2F..%2Fx%20y"
    # The app's refusal reaches the agent as it is.
    client.answer = ApiError("422: Page has no synced properties.")
    with pytest.raises(ApiError, match="Page has no synced properties."):
        _call(server, "sync_facts", type="page", items=ITEMS)
    tool = next(t for t in asyncio.run(server.list_tools()) if t.name == "sync_facts")
    assert tool.annotations.read_only_hint is False
    assert tool.annotations.destructive_hint is False
    assert "Never changes the objects' files." in (tool.description or "")


def test_tools_by_scope():
    client = FakeClient()
    full = _names(build_server(client, write=True))  # type: ignore[arg-type]
    assert full == set(toolcatalog.OBJECT_READ + toolcatalog.OBJECT_WRITE)
    assert "sync_facts" in full
    sync_only = _names(build_server(client, write=False, sync=True))  # type: ignore[arg-type]
    assert sync_only == set(toolcatalog.OBJECT_READ) | {"sync_facts"}
    read = _names(build_server(client, write=False, sync=False))  # type: ignore[arg-type]
    assert read == set(toolcatalog.OBJECT_READ)
    # `sync` None follows `write`.
    assert _names(build_server(client, write=False)) == set(toolcatalog.OBJECT_READ)  # type: ignore[arg-type]
    assert "sync_facts" in _names(build_server(client))  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("scope", "argv", "expect"),
    [
        ("sync", [], (False, True)),
        ("read-write", [], (True, True)),
        ("read", [], (False, False)),
        ("sync", ["--read-only"], (False, False)),
        ("read-write", ["--read-only"], (False, False)),
        # The app isn't up yet: every tool is kept, each call reports.
        (ApiError("Object isn't reachable"), [], (True, True)),
    ],
)
def test_main_reads_the_scope(monkeypatch: pytest.MonkeyPatch, scope, argv, expect):
    built: list[tuple[bool, bool | None]] = []

    class Built:
        def run(self, transport: str) -> None:
            assert transport == "stdio"

    def fake_build(client, write: bool = True, sync: bool | None = None):
        built.append((write, sync))
        return Built()

    monkeypatch.setenv("OBJECT_API_TOKEN", "obj_test")
    monkeypatch.delenv("OBJECT_API_URL", raising=False)
    monkeypatch.setattr(mcp_server, "ObjectClient", lambda url, token: FakeClient(scope))
    monkeypatch.setattr(mcp_server, "build_server", fake_build)
    mcp_server.main(argv)
    assert built == [expect]


def test_catalogue_lists_sync_facts():
    assert toolcatalog.OBJECT_WRITE[-1] == "sync_facts"
    groups = {g.id: g for g in toolcatalog.catalogue()}
    write = [t.id for t in groups["object-write"].tools]
    assert "mcp__object__sync_facts" in write
    assert "mcp__object__sync_facts" not in toolcatalog.default_off()
    rows = {t["id"]: t for g in toolcatalog.groups_out(list(groups.values()), []) for t in g["tools"]}
    assert rows["mcp__object__sync_facts"]["on"] is True
    assert rows["mcp__object__sync_facts"]["label"] == "Sync facts"
    lists = toolcatalog.run_tool_lists(set(), write=True, folder_servers=[])
    assert "mcp__object__sync_facts" in lists.allowed
    read_only = toolcatalog.run_tool_lists(set(), write=False, folder_servers=[])
    assert "mcp__object__sync_facts" in read_only.disallowed
