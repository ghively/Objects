"""``objectapp-mcp``: an MCP server (stdio) that gives an agent the local API (M11).

It is a thin client of ``/api/v1`` on the running app: it never opens the space folder
itself, so the app stays the only writer and every rule the app keeps (version checks,
the trash, history, "Exclude from AI") holds for agent edits too. The app must be running.

Configuration (environment):

- ``OBJECT_API_TOKEN`` (required): a token made in Settings > Integrations.
- ``OBJECT_API_URL`` (default ``http://127.0.0.1:8790``): the app's address. Only a
  loopback address is accepted, since the token must never leave the machine.

``--read-only`` (or a ``read`` token) registers only the read tools. A ``read-write``
token gets the write tools too; each write needs the ``version`` the agent last read, so
an edit made meanwhile in the app answers a conflict instead of being overwritten.

Example client config (Claude Code ``.mcp.json`` or Claude Desktop)::

    {"mcpServers": {"object": {"command": "uv",
      "args": ["run", "--directory", "<repo>", "objectapp-mcp"],
      "env": {"OBJECT_API_TOKEN": "obj_...", "OBJECT_API_URL": "http://127.0.0.1:8790"}}}}
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from typing import Any
from urllib.parse import urlsplit

import httpx
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

__all__ = ["ApiError", "ObjectClient", "build_server", "main"]

DEFAULT_URL = "http://127.0.0.1:8790"
LOOPBACK = {"127.0.0.1", "localhost", "::1", "[::1]"}

INSTRUCTIONS = """\
Object is the user's local notes app: Markdown files of typed objects (Pages, Tasks,
People, ...) with properties, links and saved queries.

Start with `schema` to learn the types and property ids, then `search` or `query` to find
objects and `peek` before `read` (peek is small: title, properties, outline, links).
Every write needs the `version` from your last read of that object; on a conflict, read
it again, then retry. Writes go to the user's real notes, so change only what was asked.
`move_to_trash` is undoable from the app's trash; nothing here deletes for good."""


class ApiError(ToolError):
    """An answer from the app that isn't 2xx, as a sentence an agent can act on (a
    `ToolError`, so the MCP server passes its text to the agent)."""


class ObjectClient:
    """Calls ``/api/v1`` with the token. `http` may be any ``httpx.Client`` (tests pass the
    app's TestClient)."""

    def __init__(self, base_url: str, token: str, http: httpx.Client | None = None) -> None:
        self.base = base_url.rstrip("/")
        self.http = http or httpx.Client(timeout=30.0)
        self.headers = {"Authorization": f"Bearer {token}"}

    def _url(self, route: str) -> str:
        return f"{self.base}/api/v1{route}"

    def _answer(self, res: httpx.Response) -> Any:
        if 200 <= res.status_code < 300:
            return res.json()
        try:
            body = res.json()
        except ValueError:
            body = {"detail": res.text[:300]}
        detail = body.get("detail") if isinstance(body, dict) else None
        if res.status_code == 409 and isinstance(body, dict):
            raise ApiError(
                f"Conflict: {detail} Current version: {body.get('currentVersion')}."
            )
        raise ApiError(f"{res.status_code}: {detail or body}")

    def get(self, route: str, **params: Any) -> Any:
        clean = {k: v for k, v in params.items() if v is not None}
        try:
            res = self.http.get(self._url(route), params=clean, headers=self.headers)
        except httpx.TransportError as exc:
            raise ApiError(f"Object isn't reachable at {self.base}: is the app running? ({exc})") from exc
        return self._answer(res)

    def post(self, route: str, body: dict[str, Any]) -> Any:
        clean = {k: v for k, v in body.items() if v is not None}
        try:
            res = self.http.post(self._url(route), json=clean, headers=self.headers)
        except httpx.TransportError as exc:
            raise ApiError(f"Object isn't reachable at {self.base}: is the app running? ({exc})") from exc
        return self._answer(res)


READ = ToolAnnotations(readOnlyHint=True, openWorldHint=False)
WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=False)
REPLACE = ToolAnnotations(readOnlyHint=False, destructiveHint=True, openWorldHint=False)


def build_server(client: ObjectClient, write: bool = True) -> MCPServer:
    """The MCP server with the read tools, and the write tools when `write`."""
    server = MCPServer(name="object", instructions=INSTRUCTIONS)

    # -- read -----------------------------------------------------------------------

    @server.tool(annotations=READ)
    def schema() -> dict:
        """The object types (with property ids, kinds and label options), collections and
        saved queries. Call this first: queries and property edits use these ids."""
        return client.get("/schema")

    @server.tool(annotations=READ)
    def search(query: str, types: list[str] | None = None, limit: int = 20, mode: str = "auto") -> dict:
        """Find objects by title and text. `types` takes type names or ids; `mode` is auto,
        title or fullText."""
        params: dict[str, Any] = {"q": query, "limit": limit, "mode": mode}
        if types:
            params["type"] = types
        return client.get("/search", **params)

    @server.tool(annotations=READ)
    def query(
        types: list[str] | None = None,
        collections: list[str] | None = None,
        tags: list[str] | None = None,
        filter_group: dict | None = None,
        sort_by: str | None = None,
        descending: bool = False,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """List objects with their property values, like a database view.

        `filter_group` is the app's filter JSON: {"type": "filterGroup", "operator": "and"|"or",
        "elements": [{"type": "filter", "propertyId": "status", "option": "is",
        "referenceValue": "Done"}, ...]}. Options include is, isNot, contains, notContains,
        isEmpty, isNotEmpty, isChecked, greater, smaller, isBefore, isAfter; a date
        referenceValue may be {"relative": "today"|"thisWeek"|"overdue"|...} or
        {"exactDate": "2026-11-05"}. Unknown options are skipped and listed in `unsupported`."""
        return client.post(
            "/query",
            {
                "typeIds": types,
                "collectionIds": collections,
                "tags": tags,
                "filterGroup": filter_group,
                "sort": {"propertyId": sort_by, "descending": descending} if sort_by else None,
                "limit": limit,
                "offset": offset,
            },
        )

    @server.tool(annotations=READ)
    def run_saved_query(query_id: str, limit: int = 50, offset: int = 0) -> dict:
        """Run one of the user's saved queries (ids from `schema`)."""
        return client.post(f"/queries/{query_id}/run", {"limit": limit, "offset": offset})

    @server.tool(annotations=READ)
    def peek(path: str) -> dict:
        """An object's title, type, property values, heading outline, size, outgoing links
        and version, without its body. Cheap: use it before `read`."""
        return client.get("/object/peek", path=path)

    @server.tool(annotations=READ)
    def read(path: str, section: str | None = None) -> dict:
        """An object's properties and Markdown body, or only the section under one heading
        (matched case-insensitively). The answer's `version` is what writes need."""
        return client.get("/object", path=path, section=section)

    @server.tool(annotations=READ)
    def backlinks(path: str) -> dict:
        """The objects that link to or mention this one."""
        return client.get("/object/backlinks", path=path)

    @server.tool(annotations=READ)
    def daily_note(date: str) -> dict:
        """The path of the daily note for a day (YYYY-MM-DD), if there is one."""
        return client.get("/daily-note", date=date)

    @server.tool(annotations=READ)
    def changes_since(since: str | None = None, limit: int = 100) -> dict:
        """Objects updated since an ISO date or time (newest first), and the writes made
        through this API since then."""
        return client.get("/changes", since=since, limit=limit)

    if not write:
        return server

    # -- write ----------------------------------------------------------------------

    @server.tool(annotations=WRITE)
    def create_object(
        type: str, title: str = "", body: str | None = None, values: dict | None = None,
        template_id: str | None = None,
    ) -> dict:
        """Create an object of a type (name or id), with an optional Markdown body and
        property values keyed by property id. Returns its path and version."""
        return client.post(
            "/objects",
            {"type": type, "title": title, "body": body, "values": values, "templateId": template_id},
        )

    @server.tool(annotations=WRITE)
    def create_task(
        title: str, status: str | None = None, date: str | None = None,
        deadline: str | None = None, priority: str | None = None, body: str | None = None,
    ) -> dict:
        """Create a Task. `date` and `deadline` are YYYY-MM-DD; `status` and `priority` are
        option names from `schema`."""
        values: dict[str, Any] = {}
        if status:
            values["status"] = status
        if priority:
            values["priority"] = priority
        if date:
            values["date"] = {"start": date, "resolution": "day"}
        if deadline:
            values["deadline"] = {"start": deadline, "resolution": "day"}
        return client.post("/objects", {"type": "Task", "title": title, "body": body, "values": values or None})

    @server.tool(annotations=WRITE)
    def set_properties(path: str, version: str, values: dict, remove: list[str] | None = None) -> dict:
        """Set property values (keyed by property id) and remove properties. Only those
        lines of the file change."""
        return client.post(
            "/object/properties", {"path": path, "version": version, "set": values, "remove": remove or []}
        )

    @server.tool(annotations=WRITE)
    def add_tags(path: str, version: str, tags: list[str]) -> dict:
        """Add tags (by name) to an object, keeping the ones it has."""
        return client.post("/object/properties", {"path": path, "version": version, "add": {"tags": tags}})

    @server.tool(annotations=WRITE)
    def add_to_collection(path: str, version: str, collections: list[str]) -> dict:
        """Add an object to collections (by name), keeping the ones it is in."""
        return client.post(
            "/object/properties", {"path": path, "version": version, "add": {"collections": collections}}
        )

    @server.tool(annotations=WRITE)
    def append_to_section(path: str, version: str, text: str, heading: str | None = None) -> dict:
        """Add Markdown at the end of the section under `heading`, or at the end of the body
        when no heading is given. Nothing else in the file changes."""
        return client.post(
            "/object/section",
            {"path": path, "version": version, "heading": heading, "mode": "append", "text": text},
        )

    @server.tool(annotations=REPLACE)
    def replace_section(path: str, version: str, heading: str, text: str) -> dict:
        """Replace what is under one heading (the heading line stays). The old text stays in
        the object's version history."""
        return client.post(
            "/object/section",
            {"path": path, "version": version, "heading": heading, "mode": "replace", "text": text},
        )

    @server.tool(annotations=WRITE)
    def rename(path: str, version: str, title: str) -> dict:
        """Rename an object; links to it are updated. Returns the new path."""
        return client.post("/object/rename", {"path": path, "version": version, "title": title})

    @server.tool(annotations=REPLACE)
    def move_to_trash(path: str, version: str) -> dict:
        """Move an object to the app's trash (the user can restore it)."""
        return client.post("/object/trash", {"path": path, "version": version})

    return server


def _check_url(url: str) -> str:
    parts = urlsplit(url)
    if parts.scheme != "http" or (parts.hostname or "") not in LOOPBACK:
        raise SystemExit(f"OBJECT_API_URL must be a local http address (127.0.0.1), not {url!r}.")
    return url


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="objectapp-mcp", description=__doc__.split("\n\n")[0])
    parser.add_argument("--read-only", action="store_true", help="register only the read tools")
    parser.add_argument("--url", default=None, help=f"the app's address (default {DEFAULT_URL})")
    args = parser.parse_args(argv)
    logging.getLogger("httpx").setLevel(logging.WARNING)  # stderr is the client's log; keep it quiet
    token = os.environ.get("OBJECT_API_TOKEN", "").strip()
    if not token:
        print("objectapp-mcp: set OBJECT_API_TOKEN to a token from Settings > Integrations.", file=sys.stderr)
        raise SystemExit(2)
    url = _check_url(args.url or os.environ.get("OBJECT_API_URL") or DEFAULT_URL)
    client = ObjectClient(url, token)
    write = not args.read_only
    if write:
        try:
            write = client.get("/whoami").get("scope") == "read-write"
        except ApiError as exc:
            # The app may start after the agent: keep the write tools, each call reports.
            print(f"objectapp-mcp: {exc}", file=sys.stderr)
    build_server(client, write=write).run(transport="stdio")


if __name__ == "__main__":
    main()
