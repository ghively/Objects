"""M11: the ``objectapp-mcp`` tools, driven in process against the app's own routes."""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from mcp.server.mcpserver.exceptions import ToolError
from objectapp import toolcatalog
from objectapp.mcp_server import ApiError, ObjectClient, _check_url, build_server
from objectapp.server import create_app
from objectapp.space import Space

NOW = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)
READ_TOOLS = {
    "schema", "search", "query", "run_saved_query", "peek", "read", "backlinks",
    "daily_note", "changes_since",
}
WRITE_TOOLS = {
    "create_object", "create_task", "set_properties", "add_tags", "add_to_collection",
    "append_to_section", "replace_section", "rename", "move_to_trash",
}


@pytest.fixture
def http(space_dir: Path) -> TestClient:
    space = Space(space_dir)
    space.clock = lambda: NOW
    app = create_app(space, None, watch=False)
    app.state.hub.publish = lambda _e: None
    return TestClient(app)


def _client(http: TestClient, scope: str) -> ObjectClient:
    secret = http.post("/api/integrations/tokens", json={"name": "mcp", "scope": scope}).json()["secret"]
    return ObjectClient("http://testserver", secret, http)


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


def _names(server) -> set[str]:
    return {t.name for t in asyncio.run(server.list_tools())}


def test_tool_sets(http: TestClient) -> None:
    client = _client(http, "read")
    assert _names(build_server(client, write=False)) == set(toolcatalog.OBJECT_READ)
    assert _names(build_server(client, write=True)) == set(toolcatalog.OBJECT_READ + toolcatalog.OBJECT_WRITE)
    tools = {t.name: t for t in asyncio.run(build_server(client).list_tools())}
    assert tools["read"].annotations.read_only_hint is True
    assert tools["move_to_trash"].annotations.destructive_hint is True


def test_read_tools(http: TestClient) -> None:
    server = build_server(_client(http, "read"), write=False)
    schema = _call(server, "schema")
    assert "Task" in [t["name"] for t in schema["types"]]
    found = _call(server, "search", query="printer")
    assert any(r["path"] == "Tasks/Fix printer.md" for r in found["results"])
    rows = _call(
        server, "query", types=["Task"],
        filter_group={"type": "filterGroup", "operator": "and", "elements": [
            {"type": "filter", "propertyId": "status", "option": "is", "referenceValue": "In Progress"}]},
    )
    assert [r["title"] for r in rows["rows"]] == ["Fix printer"]
    peek = _call(server, "peek", path="People/Ada Lovelace.md")
    assert peek["values"] and "body" not in peek
    assert "algorithm" in _call(server, "read", path="People/Ada Lovelace.md")["body"]
    assert _call(server, "daily_note", date="2026-10-23")["path"] == "DailyNotes/2026-10-23.md"


def test_read_token_write_tool_reports_403(http: TestClient) -> None:
    server = build_server(_client(http, "read"), write=True)
    with pytest.raises(ApiError, match="403"):
        _call(server, "create_task", title="Nope")


def test_write_tools_and_conflict(http: TestClient, space_dir: Path) -> None:
    server = build_server(_client(http, "read-write"))
    made = _call(server, "create_task", title="Call the vendor", status="Not Started", date="2026-11-06")
    path = made["path"]
    text = (space_dir / path).read_text(encoding="utf-8")
    assert "status: Not Started" in text and "2026-11-06" in text
    v = made["version"]
    v = _call(server, "append_to_section", path=path, version=v, text="Ask about the invoice.")["version"]
    with pytest.raises(ApiError, match="Conflict"):
        _call(server, "append_to_section", path=path, version="old", text="again")
    v = _call(server, "add_tags", path=path, version=v, tags=["Docs"])["version"]
    renamed = _call(server, "rename", path=path, version=v, title="Call the supplier")
    assert renamed["path"].endswith("Call the supplier.md")
    _call(server, "move_to_trash", path=renamed["path"], version=renamed["version"])
    assert not (space_dir / renamed["path"]).exists()


def test_unreachable_app_is_a_clear_error() -> None:
    client = ObjectClient("http://127.0.0.1:9", "obj_x")
    with pytest.raises(ApiError, match="Is the app running"):
        client.get("/schema")


@pytest.mark.parametrize("url", ["https://127.0.0.1:8790", "http://example.com", "http://10.0.0.2:8790"])
def test_only_loopback_urls(url: str) -> None:
    with pytest.raises(SystemExit):
        _check_url(url)


def test_loopback_url_is_accepted() -> None:
    assert _check_url("http://127.0.0.1:8790") == "http://127.0.0.1:8790"
