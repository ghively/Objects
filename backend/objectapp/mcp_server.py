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
an edit made meanwhile in the app answers a conflict instead of being overwritten. A ``sync``
token (M29) gets the read tools and `sync_facts` only, which fills synced properties and never
changes the objects' files.

Example client config (Claude Code ``.mcp.json`` or Claude Desktop)::

    {"mcpServers": {"object": {"command": "uv",
      "args": ["run", "--directory", "<repo>", "objectapp-mcp"],
      "env": {"OBJECT_API_TOKEN": "obj_...", "OBJECT_API_URL": "http://127.0.0.1:8790"}}}}
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from typing import Any
from urllib.parse import quote, urlsplit

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
`type_definition`, `collection` and `saved_query` give a full definition and its `revision`;
`read_whiteboard`, `version_history`, `read_version`, `unlinked_mentions`, `trash`,
`automations`, `import_preview`, `import_status`, `import_scan`, `import_proposal`,
`import_report` and `import_entities` read the rest. To move a folder of files into Object, read the prompt
`migrate_a_source` first.
Every write needs the `version` from your last read of that object (definitions and
whiteboards need their `revision`); on a conflict, read it again, then retry. Writes go to
the user's real notes, so change only what was asked: `write_body` replaces a whole body,
`append_to_section` and `replace_section` change one part. Deleting a type or a collection
first answers how many objects it affects; call again with `confirm` once that is what the
user wants. `move_to_trash`, `delete_type`, `delete_collection`, `delete_query` and `merge`
are undoable from the app's trash (`restore_from_trash`), and `restore_version` brings back
an earlier version; nothing here deletes for good.

A work item (a Task or Project with a `steps` property) is changed with the work tools:
`step_action` and `edit_steps` check the step rules and log Activity; set_properties can't
change steps. Read the item first: each step has an `id` and a `rev`, and a stale `rev` is
refused with "This step changed. Look again."

`sync_facts` fills a type's synced properties (read-only in the app, shown with their source)
from an inventory or monitoring script's results, matched by title, alias or a key property;
it never changes the objects' files."""


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

    def _answer(self, res: httpx.Response, plain: bool = False) -> Any:
        if 200 <= res.status_code < 300:
            return res.json()
        try:
            body = res.json()
        except ValueError:
            body = {"detail": res.text[:300]}
        detail = body.get("detail") if isinstance(body, dict) else None
        if plain and isinstance(detail, str) and detail:
            # M22's work routes: the app's sentence as it is ("This step changed. Look again.").
            raise ApiError(detail)
        if res.status_code == 409 and isinstance(body, dict):
            if "currentRevision" in body:
                raise ApiError(f"Conflict: {detail} Current revision: {body.get('currentRevision')}.")
            if "currentVersion" not in body:  # a refusal, not a version clash (S5's delete_collection)
                raise ApiError(f"Conflict: {detail}")
            raise ApiError(
                f"Conflict: {detail} Current version: {body.get('currentVersion')}."
            )
        extra = (
            {k: v for k, v in body.items() if k not in ("detail", "reason")} if isinstance(body, dict) else {}
        )
        if detail and extra:  # a 428's ``affected`` and ``hiddenCount``, for example
            raise ApiError(f"{res.status_code}: {detail} {json.dumps(extra, default=str)}")
        raise ApiError(f"{res.status_code}: {detail or body}")

    def get(self, route: str, plain: bool = False, **params: Any) -> Any:
        clean = {k: v for k, v in params.items() if v is not None}
        try:
            res = self.http.get(self._url(route), params=clean, headers=self.headers)
        except httpx.TransportError as exc:
            raise ApiError(f"Object isn't reachable at {self.base} ({exc}). Is the app running?") from exc
        return self._answer(res, plain)

    def post(self, route: str, body: dict[str, Any], plain: bool = False) -> Any:
        clean = {k: v for k, v in body.items() if v is not None}
        try:
            res = self.http.post(self._url(route), json=clean, headers=self.headers)
        except httpx.TransportError as exc:
            raise ApiError(f"Object isn't reachable at {self.base} ({exc}). Is the app running?") from exc
        return self._answer(res, plain)

    def put(self, route: str, body: dict[str, Any]) -> Any:
        clean = {k: v for k, v in body.items() if v is not None}
        try:
            res = self.http.put(self._url(route), json=clean, headers=self.headers)
        except httpx.TransportError as exc:
            raise ApiError(f"Object isn't reachable at {self.base} ({exc}). Is the app running?") from exc
        return self._answer(res)

    def delete(self, route: str, **params: Any) -> Any:
        clean = {k: v for k, v in params.items() if v is not None}
        try:
            res = self.http.delete(self._url(route), params=clean, headers=self.headers)
        except httpx.TransportError as exc:
            raise ApiError(f"Object isn't reachable at {self.base} ({exc}). Is the app running?") from exc
        return self._answer(res)


READ = ToolAnnotations(readOnlyHint=True, openWorldHint=False)
WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=False)
REPLACE = ToolAnnotations(readOnlyHint=False, destructiveHint=True, openWorldHint=False)


def build_server(client: ObjectClient, write: bool = True, sync: bool | None = None) -> MCPServer:
    """The MCP server with the read tools, the write tools when `write`, and `sync_facts` when
    `sync` (M29; None means `write`: a ``sync`` token gets it without the other write tools)."""
    server = MCPServer(name="object", instructions=INSTRUCTIONS)
    if sync is None:
        sync = write

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

    @server.tool(annotations=READ)
    def type_definition(type: str) -> dict:
        """An object type's full definition (name or id): its properties with every option,
        and the `revision` that `edit_type` and `change_property_kind` need."""
        return client.get(f"/types/{_seg(type)}")

    @server.tool(annotations=READ)
    def collection(collection_id: str) -> dict:
        """A collection's definition (id or name) and the `revision` `edit_collection` needs."""
        return client.get(f"/collections/{_seg(collection_id)}")

    @server.tool(annotations=READ)
    def saved_query(query_id: str) -> dict:
        """A saved query's definition (id or name) and the `revision` `edit_query` needs."""
        return client.get(f"/queries/{_seg(query_id)}")

    @server.tool(annotations=READ)
    def read_whiteboard(path: str) -> dict:
        """A whiteboard's board (cards, connections, groups) and the `revision`
        `edit_whiteboard` needs. `path` is the whiteboard's .md."""
        return client.get("/whiteboard", path=path)

    @server.tool(annotations=READ)
    def version_history(path: str) -> dict:
        """The saved versions of an object, newest first."""
        return client.get("/history", path=path)

    @server.tool(annotations=READ)
    def read_version(path: str, version_id: str) -> dict:
        """One saved version of an object (ids from `version_history`)."""
        return client.get("/history/version", path=path, id=version_id)

    @server.tool(annotations=READ)
    def unlinked_mentions(path: str) -> dict:
        """Objects that name this one in their text without linking to it (`link_mention`
        turns one into a link)."""
        return client.get("/references", path=path)

    @server.tool(annotations=READ)
    def trash() -> dict:
        """The app's trash, newest first (ids for `restore_from_trash`)."""
        return client.get("/trash")

    @server.tool(annotations=READ)
    def automations() -> dict:
        """The space's automation rules (ids for `run_automation`)."""
        return client.get("/automations")

    @server.tool(annotations=READ)
    def import_preview(path: str, kind: str = "auto", leave_out: list[str] | None = None) -> dict:
        """What importing a folder or .zip (an Obsidian vault, a Notion or Anytype export)
        would make: types, counts, samples and the mapping `start_import` uses. Writes
        nothing. `kind` is auto, obsidian, notion, anytype or files (Word, Excel, PowerPoint, PDF,
        images; a `_manifest.jsonl` beside the files gives each file's url, author, dates and fields).
        `leave_out` names folders and patterns that are never read (use the ones given to `import_scan`)."""
        return client.post("/import/preview", {"path": path, "kind": kind, "leaveOut": leave_out or []})

    @server.tool(annotations=READ)
    def import_status(job_id: str) -> dict:
        """The progress and result of an import started with `start_import`."""
        return client.get(f"/import/jobs/{_seg(job_id)}")

    @server.tool(annotations=READ)
    def import_scan(path: str, leave_out: list[str] | None = None, batch: str | None = None) -> dict:
        """Scan a folder for sensitive content before anything reads it: private keys, API keys and
        tokens, password assignments, connection strings and card numbers. Answers file, kind and
        line, never the value; `leave_out` names folders and patterns that are never opened. Keeps
        the findings in an import batch and answers its id (`batch`): use it for `save_import_proposal`,
        `start_import` and `save_import_decisions`."""
        return client.post("/import/scan", {"path": path, "leaveOut": leave_out or [], "batch": batch})

    @server.tool(annotations=READ)
    def import_proposal(batch: str) -> dict:
        """The schema proposal saved for an import batch, with the user's decisions (accepted, edited,
        rejected) and its `revision`. Only the user applies it, in Object."""
        return client.get("/import/proposal", batch=batch)

    @server.tool(annotations=READ)
    def import_report(batch: str) -> dict:
        """An import batch's report (counts that reconcile, losses, scan findings, the AI pass) and
        the state of its filing pass."""
        return client.get("/import/report", batch=batch)

    @server.tool(annotations=READ)
    def import_entities(batch: str) -> dict:
        """The entity list of an import batch kept as Sources: each entity with the user's decision
        (accepted, renamed, turned down), its aliases, its values with the Sources and quotes they
        come from and where Sources disagree, its summary lines, and what was not made into objects.
        Only the user accepts and writes entities, in Object."""
        return client.get("/import/entities", batch=batch)

    # -- the migration skill (M27) --------------------------------------------------

    @server.prompt(name="migrate_a_source", description="How to move a folder of notes or files into Object, stage by stage.")
    def migrate_a_source() -> str:
        from .importskill import TEXT

        return TEXT

    @server.resource("object://skills/migrate-a-source", mime_type="text/markdown")
    def migrate_skill() -> str:
        from .importskill import TEXT

        return TEXT

    # -- work (M22) -----------------------------------------------------------------

    @server.tool(annotations=READ)
    def work_items(scope: str = "active") -> dict:
        """The work items (Tasks and Projects with steps): each one's ticket, stage, whose
        turn it is and its current step. `scope` is active (open items and the recently
        done) or all."""
        return client.get("/work/items", plain=True, scope=scope)

    @server.tool(annotations=READ)
    def work_item(path: str) -> dict:
        """One work item in full: its steps (each with `id`, `rev` and the actions open to
        the user), lists, floor items, Activity, Work notes and `version`."""
        return client.get("/work/item", plain=True, path=path)

    if sync:

        @server.tool(annotations=WRITE)
        def sync_facts(type: str, items: list[dict]) -> dict:
            """Fill synced properties (read-only in Object) of objects of a type, matched by title, alias
            or a key property: items = [{"match": {"by": "title"|"alias"|"key", "value": "...", "key"?: "fqdn"},
            "values": {"lastBoot": "...", ...}}]. Never changes the objects' files."""
            return client.post(f"/synced/{_seg(type)}", {"items": items})

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

    @server.tool(annotations=REPLACE)
    def write_body(path: str, version: str, body: str) -> dict:
        """Replace an object's whole Markdown body (its properties stay). The old body stays
        in the object's version history."""
        return client.post("/object/body", {"path": path, "version": version, "body": body})

    @server.tool(annotations=WRITE)
    def remove_tags(path: str, version: str, tags: list[str]) -> dict:
        """Remove tags (by name) from an object, keeping the others."""
        return client.post(
            "/object/properties", {"path": path, "version": version, "subtract": {"tags": tags}}
        )

    @server.tool(annotations=WRITE)
    def remove_from_collection(path: str, version: str, collections: list[str]) -> dict:
        """Take an object out of collections (by name), keeping the others."""
        return client.post(
            "/object/properties",
            {"path": path, "version": version, "subtract": {"collections": collections}},
        )

    @server.tool(annotations=WRITE)
    def open_daily_note(date: str) -> dict:
        """The daily note for a day (YYYY-MM-DD), created when there is none yet
        (`created` says which)."""
        return client.post("/daily-notes", {"date": date})

    @server.tool(annotations=WRITE)
    def duplicate(path: str) -> dict:
        """Make a copy of an object next to it. Returns the copy's path and version."""
        return client.post("/object/duplicate", {"path": path})

    @server.tool(annotations=WRITE)
    def change_type(path: str, version: str, type: str, mapping: dict | None = None) -> dict:
        """Change an object's type (name or id); it moves to that type's folder. `mapping`
        maps its property keys to the new type's keys; without it, the app's suggested
        mapping is used."""
        return client.post(
            "/object/change-type", {"path": path, "version": version, "type": type, "mapping": mapping}
        )

    @server.tool(annotations=REPLACE)
    def merge(source: str, target: str, source_version: str, target_version: str) -> dict:
        """Merge `source` into `target`: its text and properties join the target, links to
        it point at the target, and the source goes to the trash."""
        return client.post(
            "/object/merge",
            {"source": source, "target": target, "sourceVersion": source_version,
             "targetVersion": target_version},
        )

    @server.tool(annotations=WRITE)
    def link_mention(path: str, version: str, target: str, start: int, end: int, text: str) -> dict:
        """Turn one unlinked mention (from `unlinked_mentions`) in `path` into a link to
        `target`; `start`, `end` and `text` locate it in the body."""
        return client.post(
            "/references/link",
            {"path": path, "version": version, "target": target, "start": start, "end": end,
             "text": text},
        )

    @server.tool(annotations=WRITE)
    def create_tag(name: str) -> dict:
        """Make a tag (or find the one with this name). Returns its path."""
        return client.post("/tags/ensure", {"name": name})

    @server.tool(annotations=WRITE)
    def create_type(name: str, plural_name: str, icon: str | None = None, color: str | None = None) -> dict:
        """Make an object type. Returns its definition and revision."""
        return client.post(
            "/types", {"name": name, "pluralName": plural_name, "icon": icon, "color": color}
        )

    @server.tool(annotations=REPLACE)
    def edit_type(type_id: str, revision: str, type: dict, confirm: bool = False) -> dict:
        """Save an object type's definition (the whole object from `type_definition`,
        changed). A change that removes values first answers how many objects it affects;
        send it again with `confirm` to apply it."""
        return client.put(
            f"/types/{_seg(type_id)}", {"revision": revision, "type": type, "confirm": confirm}
        )

    @server.tool(annotations=REPLACE)
    def change_property_kind(type_id: str, property_id: str, to_kind: str, revision: str) -> dict:
        """Change a property's kind (text, number, label, datetime...); each object's value
        is converted."""
        return client.post(
            f"/types/{_seg(type_id)}/properties/{_seg(property_id)}/change-kind",
            {"toKind": to_kind, "revision": revision},
        )

    @server.tool(annotations=REPLACE)
    def delete_type(type_id: str, confirm: bool = False) -> dict:
        """Move an object type, its objects and templates to the trash (restorable). Without
        `confirm` it answers how many objects would go."""
        return client.delete(f"/types/{_seg(type_id)}", confirm="true" if confirm else None)

    @server.tool(annotations=WRITE)
    def create_collection(name: str, type_ids: list[str] | None = None) -> dict:
        """Make a collection, optionally limited to some types."""
        return client.post("/collections", {"name": name, "typeIds": type_ids})

    @server.tool(annotations=REPLACE)
    def edit_collection(collection_id: str, revision: str, collection: dict) -> dict:
        """Save a collection's definition (the object from `collection`, changed); a rename
        updates its members."""
        return client.put(
            f"/collections/{_seg(collection_id)}", {"revision": revision, "collection": collection}
        )

    @server.tool(annotations=REPLACE)
    def delete_collection(collection_id: str, confirm: bool = False) -> dict:
        """Move a collection to the trash (restorable); members only in it go too, the
        others just leave it. Without `confirm` it answers how many objects it affects. A
        collection holding a page excluded from AI is refused (delete it in Object)."""
        return client.delete(
            f"/collections/{_seg(collection_id)}", confirm="true" if confirm else None
        )

    @server.tool(annotations=WRITE)
    def create_query(name: str, definition: dict | None = None) -> dict:
        """Save a query (the app's saved-query JSON: types, filterGroup, sorts)."""
        return client.post("/queries", {"name": name, "definition": definition})

    @server.tool(annotations=REPLACE)
    def edit_query(query_id: str, revision: str, query: dict) -> dict:
        """Save a query's definition (the object from `saved_query`, changed)."""
        return client.put(f"/queries/{_seg(query_id)}", {"revision": revision, "query": query})

    @server.tool(annotations=REPLACE)
    def delete_query(query_id: str) -> dict:
        """Move a saved query to the trash (restorable)."""
        return client.delete(f"/queries/{_seg(query_id)}")

    @server.tool(annotations=WRITE)
    def create_whiteboard(title: str) -> dict:
        """Make an empty whiteboard. Returns its .md path."""
        return client.post("/whiteboards", {"title": title})

    @server.tool(annotations=REPLACE)
    def edit_whiteboard(path: str, revision: str, board: dict) -> dict:
        """Save a whiteboard's board (the object from `read_whiteboard`, changed)."""
        return client.put("/whiteboard", {"path": path, "revision": revision, "board": board})

    @server.tool(annotations=WRITE)
    def create_automation(rule: dict) -> dict:
        """Make an automation rule (the app's rule JSON: name, trigger, actions)."""
        return client.post("/automations", {"rule": rule})

    @server.tool(annotations=WRITE)
    def run_automation(rule_id: str, path: str) -> dict:
        """Run a button automation on one object. Returns the run and each action's result."""
        return client.post(f"/automations/{_seg(rule_id)}/run", {"path": path})

    @server.tool(annotations=WRITE)
    def start_import(
        preview_id: str, target: dict, mapping: dict | None = None, batch: str | None = None, scan: dict | None = None,
        keep_as_sources: bool | None = None,
    ) -> dict:
        """Start the import `import_preview` described. `target` is {"kind": "newSpace",
        "name": ..., "location": <folder>} or {"kind": "currentSpace"}; without `mapping`
        the preview's is used. Refused when the mapping would create a type no approved
        schema proposal creates. `batch` is the id `import_scan` answered; `scan` carries
        {leaveOut, leaveOutFiles, excludeFromAi}. `keep_as_sources` ("Keep pages as Sources", on
        when left out): every page is kept as a read-only Source, exactly as imported, and the
        filing pass lists the entities they talk about; false files pages into their mapped types.
        Follow it with `import_status`."""
        return client.post(
            "/import/start",
            {"previewId": preview_id, "target": target, "mapping": mapping, "batch": batch, "scan": scan,
             "keepAsSources": keep_as_sources},
        )

    @server.tool(annotations=WRITE)
    def save_import_proposal(batch: str, proposal: dict, revision: str | None = None) -> dict:
        """Store a schema proposal for the user to review in Object: {summary?, items: [{action:
        use|extend|create, name, group, documents, examples, properties: [{name, kind, share,
        options?, target?}]}]}. Follow the skill "Migrate a source". The app checks the rules (a new
        type needs 10 documents and properties of its own; a property needs a value in 30% of its
        group; options are merged by case and spacing) and answers what it dropped. Saving over a
        stored proposal needs its `revision`. You can't approve or apply it: the user does.
        """
        return client.post("/import/proposal", {"batch": batch, "proposal": proposal, "revision": revision})

    @server.tool(annotations=WRITE)
    def save_import_decisions(batch: str, decisions: list[dict]) -> dict:
        """Hand over filing decisions for imported objects: [{path, type, confidence: high|medium|low,
        values: [{key, value, quote}], tags: [{value, quote}], collections: [{value, quote}], links:
        [{key, target, quote}]}]. Every value needs a quote copied from the document. The app checks each
        value against its quote and the property's kind and writes only what passes; low confidence goes
        to the Import inbox. The first hand-over of a source is a trial of at most 50 objects the user
        marks in Object. On a batch kept as Sources leave `type`, `values` and `links` empty and give
        `mainEntity` (what the page is mainly about: {type, name, aliases, values, lines}, or null),
        `entities` (what it mentions: {type, name, aliases, values, lines: [{text, quote}], confidence}),
        `relations` ([{subject, relation, object, quote, confidence}]) and `merges` ([{type, names}]),
        checked the same way; the user reviews the entities in Object (`import_entities`)."""
        return client.post("/import/decisions", {"batch": batch, "decisions": decisions})

    @server.tool(annotations=WRITE)
    def restore_from_trash(trash_id: str) -> dict:
        """Put a trash entry (from `trash`) back where it was."""
        return client.post(f"/trash/{_seg(trash_id)}/restore", {})

    @server.tool(annotations=REPLACE)
    def restore_version(path: str, version_id: str, version: str) -> dict:
        """Bring back an earlier version of an object (ids from `version_history`); the
        current one is kept in the history."""
        return client.post(
            "/history/restore", {"path": path, "versionId": version_id, "version": version}
        )

    # -- work (M22) -----------------------------------------------------------------

    @server.tool(annotations=WRITE)
    def step_action(
        path: str, step_id: str, step_rev: str, action: str, text: str | None = None,
        not_before: str | None = None, ask: str | None = None,
    ) -> dict:
        """Act on a work item's step (`id` and `rev` from `work_item`). An agent may
        `complete` an approved Approve step or an Agent step (`text`: what happened), `fail`
        one (`text`: why; `ask` adds a question for the user before it) or mark an Agent step
        `done`. Approving, declining and answering are the user's. Logs one Activity line."""
        return client.post(
            "/work/step",
            {"path": path, "stepId": step_id, "stepRev": step_rev, "action": action,
             "text": text, "notBefore": not_before, "ask": ask},
            plain=True,
        )

    @server.tool(annotations=WRITE)
    def edit_steps(path: str, ops: list[dict]) -> dict:
        """Change a work item's step list in one write: ops are {"op": "add", "kind":
        "question"|"do"|"approve"|"agent", "text", "before"?}, {"op": "edit", "stepId",
        "stepRev", "text"?, "kind"?}, {"op": "move", "stepId", "stepRev", "before"} and
        {"op": "remove", "stepId", "stepRev"}. Approved or done Approve steps can't be
        changed."""
        return client.post("/work/steps", {"path": path, "ops": ops}, plain=True)

    @server.tool(annotations=WRITE)
    def log_activity(path: str, text: str) -> dict:
        """Add one line to a work item's Activity (what you did or found)."""
        return client.post("/work/activity", {"path": path, "text": text}, plain=True)

    @server.tool(annotations=WRITE)
    def add_work_note(path: str, text: str, kind: str = "note") -> dict:
        """Add a work note (`kind` note) or a request (`kind` request) to a work item; it
        goes to Activity and Work notes."""
        return client.post("/work/note", {"path": path, "kind": kind, "text": text}, plain=True)

    @server.tool(annotations=WRITE)
    def set_work_fields(path: str, version: str, values: dict, remove: list[str] | None = None) -> dict:
        """Set or remove a work item's ticket and work fields (keyed by field id: rank, area,
        cause, findings, hypothesis, confidence, verified...). `version` is the item's from
        your last read. Not for steps or floor items."""
        return client.post(
            "/work/fields",
            {"path": path, "baseVersion": version, "set": values, "remove": remove or []},
            plain=True,
        )

    @server.tool(annotations=WRITE)
    def update_floor_item(
        path: str, op: str, item_id: str | None = None, item_rev: str | None = None,
        place: str | None = None, what: str | None = None, found: str | None = None,
    ) -> dict:
        """Add, edit, collect, uncollect or remove a work item's floor item (things to look
        at or collect on the floor). `item_id` and `item_rev` come from `work_item`."""
        return client.post(
            "/work/floor",
            {"path": path, "op": op, "itemId": item_id, "itemRev": item_rev, "place": place,
             "what": what, "found": found},
            plain=True,
        )

    return server


def _seg(value: str) -> str:
    """One URL path segment (an id or a name), quoted so nothing in it can leave it."""
    return quote(str(value), safe="")


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
    write = sync = not args.read_only
    if write:
        try:
            scope = client.get("/whoami").get("scope")
            write = scope == "read-write"
            sync = scope in ("read-write", "sync")  # M29: a sync token gets `sync_facts` only
        except ApiError as exc:
            # The app may start after the agent: keep the write tools, each call reports.
            print(f"objectapp-mcp: {exc}", file=sys.stderr)
    build_server(client, write=write, sync=sync).run(transport="stdio")


if __name__ == "__main__":
    main()
