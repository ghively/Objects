"""Fuzz every API route with malformed input; print any 5xx (or a traceback).

Run: ``uv run python scripts/audit-2026-11-01/backend-api/fuzz_routes.py``
"""

from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness import make_client  # noqa: E402

BAD_PATHS = [
    "", " ", "\x00", "a\x00b.md", "..", "../x.md", "/etc/passwd", "C:\\x.md", "Pages",
    "Pages/", "Pages/Alpha.md/x.md", "Pages/Alpha.md/", ".object/space.json",
    ".hidden/secret.md", "Pages/Alpha.md\x00", "x" * 5000 + ".md", "Pages/../Pages/Alpha.md",
    "Pages/Nope.md", "Attachments/cover.png", "Pages/Alpha.MD", "//Pages/Alpha.md",
    "\\\\server\\share\\x.md", "Pages/Alpha.md?x", "Pages/%41lpha.md", "Pages/Alpha.md#x",
]
BAD_IDS = ["", "..", "../../etc", "x\x00y", "a/b", " ", "con", "A" * 300, "ü", "%2e%2e", "-"]
BAD_JSON_VALUES = [None, 1, -1, 0, 1e308, -1e308, 10**40, "", "x", [], {}, [1], {"a": 1}, True,
                   "\x00", "\u2028", "9999-99-99", "0000-00-00", "x" * 10000]

results: list[tuple[str, str, int, str]] = []


def hit(client, method: str, url: str, **kw) -> int:
    try:
        res = client.request(method, url, **kw)
    except Exception as exc:  # noqa: BLE001
        results.append((method, url + " " + json.dumps(kw, default=str)[:200], -1, traceback.format_exc()[-600:]))
        return -1
    if res.status_code >= 500:
        results.append((method, url + " " + json.dumps(kw, default=str)[:300], res.status_code, res.text[:300]))
    return res.status_code


def main() -> None:
    client, root = make_client("space-m8")
    base_version = client.get("/api/object", params={"path": "Pages/Source note.md"}).json()["version"]
    task_version = client.get("/api/object", params={"path": "Tasks/Water plants.md"}).json()["version"]
    board_rev = client.get("/api/whiteboard", params={"path": "Whiteboards/Media board.md"}).json()["revision"]
    types = {t["id"]: t for t in client.get("/api/space").json()["types"]}
    type_rev = types["task"]["revision"]
    ui_rev = client.get("/api/ui").json()["revision"]

    # -- path-taking GETs ------------------------------------------------------------
    for p in BAD_PATHS:
        for url in ("/api/object", "/api/object/export", "/api/history", "/api/references",
                    "/api/whiteboard", "/api/whiteboard/ink", "/api/tasks/overdue", "/api/tasks/stats",
                    "/api/file", "/api/block/references"):
            hit(client, "GET", url, params={"path": p, **({"id": "abcdef"} if "block" in url else {})})
        hit(client, "GET", "/api/block", params={"path": p, "id": "abcdef"})
        hit(client, "GET", "/api/history/version", params={"path": p, "id": "x"})
        hit(client, "GET", "/api/object/change-type", params={"path": p, "typeId": "page"})
        hit(client, "GET", "/api/object/export", params={"path": p, "media": "1"})
        hit(client, "GET", "/api/resolve", params={"link": p, "from": p})
        hit(client, "GET", "/api/resolve", params={"link": "Source note", "from": p})
        hit(client, "DELETE", "/api/object", params={"path": p})
        hit(client, "DELETE", "/api/object", params={"path": p, "baseVersion": "x"})
        # -- path-taking POST/PUT bodies --
        hit(client, "PUT", "/api/object/body", json={"path": p, "body": "x", "baseVersion": base_version})
        hit(client, "PUT", "/api/object/properties", json={"path": p, "updates": {"title": "x"}, "baseVersion": base_version})
        hit(client, "POST", "/api/object/ensure-id", json={"path": p})
        hit(client, "POST", "/api/object/duplicate", json={"path": p})
        hit(client, "POST", "/api/object/rename", json={"path": p, "title": "x", "baseVersion": base_version})
        hit(client, "POST", "/api/object/change-type", json={"path": p, "typeId": "page", "mapping": {}, "baseVersion": base_version})
        hit(client, "POST", "/api/object/apply-template", json={"path": p, "templateId": "x", "baseVersion": base_version})
        hit(client, "POST", "/api/reveal", json={"path": p})
        hit(client, "POST", "/api/attachments/open", json={"path": p})
        hit(client, "PUT", "/api/whiteboard", json={"path": p, "board": {"version": 1, "nodes": {}, "edges": {}}, "baseRevision": ""})
        hit(client, "PUT", "/api/whiteboard/ink", json={"path": p, "strokes": [], "baseRevision": ""})
        hit(client, "POST", "/api/tasks/occurrence", json={"path": p, "action": "complete", "baseVersion": task_version})
        hit(client, "PUT", "/api/tasks/reminder", json={"path": p, "key": "date", "remind": "on the day at 09:00", "baseVersion": task_version})
        hit(client, "POST", "/api/history/restore", json={"path": p, "id": "x", "baseVersion": base_version})
        hit(client, "POST", "/api/object/merge", json={"source": p, "target": "Pages/Merge target.md", "sourceVersion": "x", "targetVersion": "x", "confirm": True})
        hit(client, "POST", "/api/object/merge", json={"source": "Pages/Merge source.md", "target": p, "sourceVersion": "x", "targetVersion": "x", "confirm": True})
        hit(client, "POST", "/api/references/link", json={"path": p, "target": "x", "start": 0, "end": 1, "text": "x", "baseVersion": base_version})
        hit(client, "POST", "/api/rows", json={"paths": [p]})
        hit(client, "POST", "/api/spaces/open", json={"path": p})
        hit(client, "POST", "/api/spaces/switch", json={"path": p})
        hit(client, "POST", "/api/spaces/delete", json={"path": p})
        hit(client, "POST", "/api/spaces/delete", json={"path": p, "permanent": True})
        hit(client, "POST", "/api/spaces", json={"name": "x", "location": p})
        hit(client, "POST", "/api/spaces", json={"name": p, "location": str(root.parent)})
        hit(client, "DELETE", "/api/spaces", params={"path": p})
        hit(client, "POST", "/api/images", params={"name": p}, content=b"x", headers={"content-type": "application/octet-stream"})
        hit(client, "POST", "/api/attachments", params={"name": p}, content=b"x", headers={"content-type": "application/octet-stream"})

    # -- id-taking routes --------------------------------------------------------------
    for i in BAD_IDS:
        hit(client, "GET", f"/api/types/{i}/templates")
        hit(client, "POST", f"/api/types/{i}/templates", json={"name": "x"})
        hit(client, "POST", f"/api/trash/{i}/restore")
        hit(client, "DELETE", f"/api/trash/{i}")
        hit(client, "GET", f"/api/views/{i}")
        hit(client, "PUT", f"/api/views/{i}", json={"views": {}, "baseRevision": ""})
        hit(client, "PUT", f"/api/collections/{i}", json={"collection": {}, "baseRevision": ""})
        hit(client, "DELETE", f"/api/collections/{i}")
        hit(client, "PUT", f"/api/queries/{i}", json={"query": {}, "baseRevision": ""})
        hit(client, "DELETE", f"/api/queries/{i}")
        hit(client, "PUT", f"/api/types/{i}", json={"type": {"name": "x", "pluralName": "y"}, "baseRevision": ""})
        hit(client, "POST", f"/api/types/{i}/properties/{i}/change-kind", json={"toType": "text", "baseRevision": ""})
        hit(client, "POST", f"/api/types/task/properties/{i}/change-kind", json={"toType": "text", "baseRevision": type_rev})
        hit(client, "POST", f"/api/types/{i}/properties/{i}/sync", json={"targetPropertyId": None, "baseRevision": ""})
        hit(client, "DELETE", f"/api/types/{i}")
        hit(client, "GET", "/api/objects", params={"type": i})
        hit(client, "GET", "/api/object/change-type", params={"path": "Pages/Source note.md", "typeId": i})
        hit(client, "POST", "/api/objects", json={"typeId": i, "title": "x"})
        hit(client, "POST", "/api/objects", json={"typeId": "page", "title": i})
        hit(client, "POST", "/api/objects", json={"typeId": "page", "templateId": i})
        hit(client, "POST", "/api/object/apply-template", json={"path": "Pages/Source note.md", "templateId": i, "baseVersion": base_version})
        hit(client, "POST", "/api/tags/ensure", json={"name": i})
        hit(client, "POST", "/api/whiteboards", json={"title": i})
        hit(client, "POST", "/api/types", json={"name": i, "pluralName": i})
        hit(client, "POST", "/api/types", json={"name": "x", "pluralName": "y", "icon": i, "color": i})
        hit(client, "POST", "/api/collections", json={"name": i, "typeIds": [i], "icon": i})
        hit(client, "POST", "/api/queries", json={"name": i, "definition": {"x": i}, "view": {"y": i}})
        hit(client, "GET", "/api/search", params={"q": i, "type": [i], "tag": i, "limit": i, "mode": i})
        hit(client, "GET", "/api/history/version", params={"path": "Pages/Source note.md", "id": i})
        hit(client, "GET", "/api/block", params={"path": "Pages/Source note.md", "id": i})
        hit(client, "GET", "/api/block/references", params={"path": "Pages/Source note.md", "id": i})
        hit(client, "POST", "/api/daily-notes", json={"date": i})
        hit(client, "POST", "/api/daily-notes", json={"date": "2026-10-28", "templateId": i})
        hit(client, "GET", "/api/calendar", params={"from": i, "to": i})
        hit(client, "PUT", "/api/tasks/reminder", json={"path": "Tasks/Water plants.md", "key": i, "remind": i, "baseVersion": task_version})
        hit(client, "PUT", "/api/tasks/reminder", json={"path": "Tasks/Submit report.md", "key": "deadline", "remind": i, "baseVersion": "x"})
        hit(client, "POST", "/api/tasks/occurrence", json={"path": "Tasks/Water plants.md", "action": i, "catchUp": i, "baseVersion": task_version})
        hit(client, "POST", "/api/object/rename", json={"path": "Pages/Source note.md", "title": i, "baseVersion": base_version})
        hit(client, "GET", "/api/resolve", params={"link": i})

    # -- wrong-shaped JSON values -------------------------------------------------------
    for v in BAD_JSON_VALUES:
        hit(client, "PUT", "/api/object/properties", json={"path": "Pages/Source note.md", "updates": {"title": v, "tags": v, "date": v, "lastUpdated": v, "createdAt": v, "id": v, "coverImage": v, "collections": v, "aliases": v, "x": v}, "baseVersion": base_version})
        hit(client, "PUT", "/api/object/properties", json={"path": "Pages/Source note.md", "updates": v if isinstance(v, dict) else {}, "remove": v if isinstance(v, list) else [], "baseVersion": base_version})
        hit(client, "PUT", "/api/object/properties", json={"path": "Tasks/Water plants.md", "updates": {"status": v, "repeat": v, "remind": v, "occurrenceLog": v, "deadline": v, "reminders": v}, "baseVersion": task_version})
        hit(client, "POST", "/api/objects", json={"typeId": "task", "title": "x", "values": {"status": v, "date": v, "repeat": v, "tags": v}})
        hit(client, "POST", "/api/objects", json={"typeId": "page", "values": v if isinstance(v, dict) or v is None else {"title": v}})
        hit(client, "PUT", "/api/types/task", json={"type": {"name": "Task", "pluralName": "Tasks", "propertyDefinitions": v, "templates": v, "icon": v, "color": v, "folder": v, "formerNames": v, "collectionsPropertyPosition": v}, "baseRevision": type_rev})
        hit(client, "PUT", "/api/types/task", json={"type": {"name": "Task", "pluralName": "Tasks", "propertyDefinitions": [v]}, "baseRevision": type_rev})
        hit(client, "PUT", "/api/types/task", json={"type": {"name": "Task", "pluralName": "Tasks", "propertyDefinitions": [{"id": v, "key": v, "name": v, "type": v, "options": v, "visibility": v, "description": v, "icon": v}]}, "baseRevision": type_rev})
        hit(client, "PUT", "/api/types/task", json={"type": {"name": "Task", "pluralName": "Tasks", "propertyDefinitions": [{"id": "status", "key": "status", "name": "Status", "type": "select", "options": {"set": v, "isStatus": v, "isArray": v, "constraints": v, "allowedTypes": v}}]}, "baseRevision": type_rev})
        hit(client, "PUT", "/api/ui", json={"patch": {"pinned": v, "sections": v, "calendar": v, "tasks": v, "graph": v, "reminders": v, "whiteboard": v, "workspaceOrder": v}, "baseRevision": ui_rev})
        hit(client, "PUT", "/api/ui", json={"patch": {"calendar": {"weekStart": v, "daily": v, "hideCalendarSidebar": v}}, "baseRevision": ui_rev})
        hit(client, "PUT", "/api/ui", json={"patch": {"sections": [{"items": v, "key": v}], "pinned": [{"kind": "x", "id": "y", "extra": v}]}, "baseRevision": ui_rev})
        hit(client, "PUT", "/api/views/task", json={"views": {"activeTab": v, "all": v, "dashboard": v, "x": v}, "baseRevision": ""})
        hit(client, "PUT", "/api/views/task", json={"views": {"all": {"layout": v, "filters": v, "sorts": v, "group": v, "columns": v}}, "baseRevision": ""})
        hit(client, "PUT", "/api/space", json={"patch": {"name": v, "icon": v, "description": v, "hideTaskManagement": v}, "baseRevision": ""})
        hit(client, "PUT", "/api/settings", json={"patch": {"timeZone": v, "openOnStart": v, "presentation": v, "startupSpacePath": v}, "baseRevision": ""})
        hit(client, "POST", "/api/collections", json={"name": "c", "typeIds": v if isinstance(v, list) else ["page"], "icon": v})
        hit(client, "POST", "/api/queries", json={"name": "q", "definition": v if isinstance(v, dict) else {"x": v}, "view": v if isinstance(v, dict) else {"x": v}})
        hit(client, "POST", "/api/queries", json={"name": "q", "definition": {"typeIds": v, "filters": v, "sorts": v, "group": v}, "view": {"layout": v}})
        hit(client, "POST", "/api/rows", json={"typeIds": v if isinstance(v, list) else None, "collectionIds": v if isinstance(v, list) else None, "search": {"terms": v if isinstance(v, list) else [str(v)], "mode": str(v)}})
        hit(client, "PUT", "/api/whiteboard", json={"path": "Whiteboards/Media board.md", "board": v, "baseRevision": board_rev})
        hit(client, "PUT", "/api/whiteboard", json={"path": "Whiteboards/Media board.md", "board": {"version": 1, "nodes": v, "edges": v, "blocks": v, "viewport": v, "readingOrder": v, "locked": v}, "baseRevision": board_rev})
        hit(client, "PUT", "/api/whiteboard", json={"path": "Whiteboards/Media board.md", "board": {"version": 1, "nodes": {"n": v}, "edges": {"e": v}, "blocks": {"b": v}}, "baseRevision": board_rev})
        hit(client, "PUT", "/api/whiteboard", json={"path": "Whiteboards/Media board.md", "board": {"version": 1, "nodes": {"n": {"id": "n", "kind": "shape", "x": v, "y": v, "width": v, "height": v, "shape": v, "color": v, "text": v}}, "edges": {}}, "baseRevision": board_rev})
        hit(client, "PUT", "/api/whiteboard/ink", json={"path": "Whiteboards/Media board.md", "strokes": v, "baseRevision": "x"})
        hit(client, "PUT", "/api/whiteboard/ink", json={"path": "Whiteboards/Media board.md", "strokes": [v], "baseRevision": "x"})
        hit(client, "PUT", "/api/whiteboard/ink", json={"path": "Whiteboards/Media board.md", "strokes": [{"id": "s1", "tool": "pen", "color": "#000000", "width": v, "points": v, "d": v}], "baseRevision": "x"})
        hit(client, "POST", "/api/references/link", json={"path": "Pages/Source note.md", "target": "Merge target", "start": v if isinstance(v, int) else 0, "end": v if isinstance(v, int) else 0, "text": str(v), "baseVersion": base_version})
        hit(client, "POST", "/api/object/change-type", json={"path": "Pages/Source note.md", "typeId": "task", "mapping": {"title": str(v), str(v): None}, "baseVersion": base_version})
        hit(client, "POST", "/api/search/reindex", json=v)
        hit(client, "GET", "/api/search", params={"q": "x", "limit": str(v)[:20]})
        hit(client, "GET", "/api/references", params={"path": "Pages/Source note.md", "relatedLimit": str(v)[:20]})
    # body-level wrong shapes (non-object bodies)
    for url in ("/api/object/body", "/api/object/properties", "/api/objects", "/api/types", "/api/ui",
                "/api/rows", "/api/whiteboard", "/api/tasks/occurrence", "/api/spaces", "/api/object/merge"):
        for body in (b"null", b"[]", b"1", b'"x"', b"{", b"", b"\xff\xfe"):
            hit(client, "POST" if url not in ("/api/object/body", "/api/object/properties", "/api/ui", "/api/whiteboard") else "PUT",
                url, content=body, headers={"content-type": "application/json"})

    client.__exit__(None, None, None)
    print(f"{len(results)} problem responses")
    for method, url, status, body in results:
        print(f"--- {status} {method} {url}\n{body}\n")


if __name__ == "__main__":
    main()
