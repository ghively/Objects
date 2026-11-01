"""Audit 2026-11-01 (back-end API): malformed input answers 4xx, never 500 or 503.

#4a: a NUL byte or an over-long component in a space path, a definition id or an
object path (`fuzz_routes.py`'s cases).
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp import spaces
from objectapp.server import create_app
from objectapp.space import Space

NUL_PATHS = ["a\x00b", "/tmp/x\x00", "\x00"]
LONG = "x" * 5000


@pytest.fixture
def client(m8_space_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    app = create_app(Space(m8_space_dir), watch=False, on_switch=lambda _p: None)
    return TestClient(app, raise_server_exceptions=False)


# -- #4a: NUL and over-long space paths ------------------------------------------------


@pytest.mark.parametrize("path", NUL_PATHS)
def test_normalize_rejects_nul(path: str):
    with pytest.raises(ValueError):
        spaces.normalize(path)


def test_normalize_rejects_over_long_path():
    with pytest.raises(ValueError):
        spaces.normalize(LONG)


@pytest.mark.parametrize("path", [*NUL_PATHS, LONG])
def test_space_routes_refuse_bad_paths(client: TestClient, path: str, m8_space_dir: Path):
    calls = {
        "open": client.post("/api/spaces/open", json={"path": path}),
        "remove": client.delete("/api/spaces", params={"path": path}),
        "create-location": client.post("/api/spaces", json={"name": "x", "location": path}),
        "delete": client.post("/api/spaces/delete", json={"path": path}),
        "delete-permanent": client.post("/api/spaces/delete", json={"path": path, "permanent": True}),
        "switch": client.post("/api/spaces/switch", json={"path": path}),
    }
    assert {k: r.status_code for k, r in calls.items()} == {
        "open": 404,
        "remove": 404,
        "create-location": 404,
        "delete": 404,
        "delete-permanent": 404,
        "switch": 404,
    }, {k: r.text[:80] for k, r in calls.items()}
    for r in calls.values():
        assert "detail" in r.json()


def test_registry_remove_ignores_nul(tmp_path: Path):
    reg = spaces.Registry(tmp_path / "state")
    reg.register(tmp_path)
    with pytest.raises(ValueError):
        reg.remove("a\x00b")
    assert [e.path for e in reg.list()] == [str(tmp_path.resolve())]


# -- #4a: over-long definition ids ----------------------------------------------------

LONG_ID = "A" * 300


def test_long_query_id_is_404_not_503(client: TestClient):
    put = client.put(f"/api/queries/{LONG_ID}", json={"query": {}, "baseRevision": ""})
    delete = client.delete(f"/api/queries/{LONG_ID}")
    assert (put.status_code, delete.status_code) == (404, 404), (put.text, delete.text)


def test_long_collection_and_view_ids_are_4xx(client: TestClient):
    calls = [
        client.get(f"/api/views/{LONG_ID}"),
        client.put(f"/api/views/{LONG_ID}", json={"views": {}, "baseRevision": ""}),
        client.put(f"/api/collections/{LONG_ID}", json={"collection": {}, "baseRevision": ""}),
        client.delete(f"/api/collections/{LONG_ID}"),
    ]
    assert [r.status_code // 100 for r in calls] == [4, 4, 4, 4], [r.text[:80] for r in calls]


# -- #4a: over-long object paths on every path-taking route ----------------------------


def _strict_rel(monkeypatch: pytest.MonkeyPatch) -> None:
    """Lane B1b's `Space._rel`: an over-long component is a `ValueError`, not an `OSError`."""
    original = Space._rel

    def rel(self: Space, path: str) -> str:
        if any(len(part.encode("utf-8")) > 255 for part in str(path).replace("\\", "/").split("/")):
            raise ValueError(f"Not an object path: {path[:40]!r}")
        return original(self, path)

    monkeypatch.setattr(Space, "_rel", rel)


def test_long_object_path_is_4xx_on_every_route(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    _strict_rel(monkeypatch)
    p = LONG + ".md"
    v = client.get("/api/object", params={"path": "Pages/Source note.md"}).json()["version"]
    board = {"version": 1, "nodes": {}, "edges": {}}
    calls = {
        "GET /api/object": client.get("/api/object", params={"path": p}),
        "GET /api/object/export": client.get("/api/object/export", params={"path": p, "media": "1"}),
        "GET /api/history": client.get("/api/history", params={"path": p}),
        "GET /api/history/version": client.get("/api/history/version", params={"path": p, "id": "x"}),
        "GET /api/references": client.get("/api/references", params={"path": p}),
        "GET /api/whiteboard": client.get("/api/whiteboard", params={"path": p}),
        "GET /api/whiteboard/ink": client.get("/api/whiteboard/ink", params={"path": p}),
        "GET /api/tasks/overdue": client.get("/api/tasks/overdue", params={"path": p}),
        "GET /api/tasks/stats": client.get("/api/tasks/stats", params={"path": p}),
        "GET /api/file": client.get("/api/file", params={"path": p}),
        "GET /api/block": client.get("/api/block", params={"path": p, "id": "abcdef"}),
        "GET /api/block/references": client.get("/api/block/references", params={"path": p, "id": "abcdef"}),
        "GET /api/object/change-type": client.get("/api/object/change-type", params={"path": p, "typeId": "page"}),
        "GET /api/resolve": client.get("/api/resolve", params={"link": p, "from": p}),
        "DELETE /api/object": client.delete("/api/object", params={"path": p}),
        "PUT /api/object/body": client.put("/api/object/body", json={"path": p, "body": "x", "baseVersion": v}),
        "PUT /api/object/properties": client.put(
            "/api/object/properties", json={"path": p, "updates": {"title": "x"}, "baseVersion": v}
        ),
        "POST /api/object/ensure-id": client.post("/api/object/ensure-id", json={"path": p}),
        "POST /api/object/duplicate": client.post("/api/object/duplicate", json={"path": p}),
        "POST /api/object/rename": client.post("/api/object/rename", json={"path": p, "title": "x", "baseVersion": v}),
        "POST /api/object/change-type": client.post(
            "/api/object/change-type", json={"path": p, "typeId": "page", "mapping": {}, "baseVersion": v}
        ),
        "POST /api/object/apply-template": client.post(
            "/api/object/apply-template", json={"path": p, "templateId": "x", "baseVersion": v}
        ),
        "POST /api/reveal": client.post("/api/reveal", json={"path": p}),
        "POST /api/attachments/open": client.post("/api/attachments/open", json={"path": p}),
        "PUT /api/whiteboard": client.put("/api/whiteboard", json={"path": p, "board": board, "baseRevision": ""}),
        "PUT /api/whiteboard/ink": client.put("/api/whiteboard/ink", json={"path": p, "strokes": [], "baseRevision": ""}),
        "POST /api/tasks/occurrence": client.post(
            "/api/tasks/occurrence", json={"path": p, "action": "complete", "baseVersion": v}
        ),
        "PUT /api/tasks/reminder": client.put(
            "/api/tasks/reminder", json={"path": p, "key": "date", "remind": "on the day at 09:00", "baseVersion": v}
        ),
        "POST /api/history/restore": client.post("/api/history/restore", json={"path": p, "id": "x", "baseVersion": v}),
        "POST /api/object/merge source": client.post(
            "/api/object/merge",
            json={"source": p, "target": "Pages/Merge target.md", "sourceVersion": "x", "targetVersion": "x", "confirm": True},
        ),
        "POST /api/object/merge target": client.post(
            "/api/object/merge",
            json={"source": "Pages/Merge source.md", "target": p, "sourceVersion": "x", "targetVersion": "x", "confirm": True},
        ),
        "POST /api/references/link": client.post(
            "/api/references/link",
            json={"path": p, "target": "x", "start": 0, "end": 1, "text": "x", "baseVersion": v},
        ),
        "POST /api/images": client.post(
            "/api/images", params={"name": p}, content=b"x", headers={"content-type": "application/octet-stream"}
        ),
        "POST /api/attachments": client.post(
            "/api/attachments", params={"name": p}, content=b"x", headers={"content-type": "application/octet-stream"}
        ),
    }
    bad = {k: (r.status_code, r.text[:80]) for k, r in calls.items() if r.status_code // 100 != 4}
    assert bad == {}
    # Unknown paths in a rows request are skipped, not an error.
    assert client.post("/api/rows", json={"paths": [p]}).json() == {"rows": []}


# -- #3 (route half): a non-Latin collection or query name never 500s ------------------

NON_LATIN = ["日本語", "ü", "데이터"]


@pytest.mark.parametrize("name", NON_LATIN)
def test_non_latin_collection_and_query_names_never_500(client: TestClient, m8_space_dir: Path, name: str):
    # Lane B1a makes `JsonStore` accept such ids (201); until merged the route answers 422.
    collection = client.post("/api/collections", json={"name": name, "typeIds": ["page"]})
    query = client.post("/api/queries", json={"name": name, "definition": {}, "view": {}})
    assert collection.status_code in (201, 422), collection.text
    assert query.status_code in (201, 422), query.text
    for r, folder in ((collection, "collections"), (query, "queries")):
        if r.status_code == 201:
            file = m8_space_dir / ".capacities" / folder / f"{r.json()['id']}.json"
            assert file.is_file() and file.read_text(encoding="utf-8").strip().startswith("{")
        else:
            assert "name" in r.json()["detail"]


# -- `POST /api/images` has the same size and emptiness rules as attachments --------------

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8


def test_image_upload_refuses_empty_and_over_limit(client: TestClient, m8_space_dir: Path, monkeypatch: pytest.MonkeyPatch):
    from objectapp import media

    monkeypatch.setattr(media, "MAX_ATTACHMENT_BYTES", 16)
    headers = {"content-type": "application/octet-stream"}
    empty = client.post("/api/images", params={"name": "e.png"}, content=b"", headers=headers)
    assert empty.status_code == 422, empty.text
    big = client.post("/api/images", params={"name": "big.png"}, content=PNG + b"x", headers=headers)
    assert big.status_code == 413, big.text
    assert "100 MiB" in big.json()["detail"]
    # A declared length over the limit is refused before the body is read.
    declared = client.post(
        "/api/images", params={"name": "d.png"}, content=PNG, headers={**headers, "content-length": "999"}
    )
    assert declared.status_code == 413
    assert not (m8_space_dir / "Attachments" / "big.png").exists()
    assert not (m8_space_dir / "Attachments" / "e.png").exists()
    ok = client.post("/api/images", params={"name": "ok.png"}, content=PNG, headers=headers)
    assert ok.status_code == 201, ok.text
    assert (m8_space_dir / "Attachments" / "ok.png").read_bytes() == PNG


# -- B2: the bulk routes encode their JSON on the worker thread -------------------------


def test_bulk_routes_skip_fastapi_encoder(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """`list_objects`, `get_calendar` and `post_rows` return a `JSONResponse` (as `api_graph`
    does), so FastAPI's `jsonable_encoder` never runs on the event loop for them."""
    import fastapi.routing

    def boom(*_a, **_k):
        raise AssertionError("jsonable_encoder ran on the event loop")

    plain = client.get("/api/objects").json()
    monkeypatch.setattr(fastapi.routing, "jsonable_encoder", boom)
    objects = client.get("/api/objects")
    calendar = client.get("/api/calendar", params={"from": "2026-10-01", "to": "2026-10-31"})
    rows = client.post("/api/rows", json={"typeIds": ["task"]})
    assert (objects.status_code, calendar.status_code, rows.status_code) == (200, 200, 200)
    assert objects.json() == plain
    assert "days" in calendar.json() and rows.json()["rows"]
    assert rows.headers["content-type"].startswith("application/json")
    # Error answers are unchanged.
    assert client.get("/api/calendar", params={"from": "x", "to": "y"}).status_code == 422


# -- F11: gzip for the API and the static bundle; SSE is never buffered by it ---------------


def test_api_json_is_gzipped_above_1kb(client: TestClient):
    plain = client.get("/api/objects", headers={"accept-encoding": "identity"})
    assert "content-encoding" not in plain.headers
    zipped = client.get("/api/objects", headers={"accept-encoding": "gzip"})
    assert zipped.headers.get("content-encoding") == "gzip"
    assert zipped.json() == plain.json()  # httpx decodes it; same content
    assert int(zipped.headers["content-length"]) < len(plain.content) // 2
    small = client.get("/api/ui", headers={"accept-encoding": "gzip"})
    assert len(small.content) < 1024 and "content-encoding" not in small.headers


def test_static_files_are_gzipped(m8_space_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    static = tmp_path / "dist"
    static.mkdir()
    (static / "index.html").write_text("<!doctype html><title>Object</title>" + "<p>x</p>\n" * 400, encoding="utf-8")
    (static / "app.js").write_text("console.log(1);\n" * 200, encoding="utf-8")
    (static / "tiny.css").write_text("body{}", encoding="utf-8")
    app = create_app(Space(m8_space_dir), static, watch=False)
    with TestClient(app) as c:
        for name in ("", "index.html", "app.js"):
            r = c.get(f"/{name}", headers={"accept-encoding": "gzip"})
            assert r.status_code == 200 and r.headers.get("content-encoding") == "gzip", name
        assert c.get("/index.html", headers={"accept-encoding": "gzip"}).text == (static / "index.html").read_text()
        assert "content-encoding" not in c.get("/tiny.css", headers={"accept-encoding": "gzip"}).headers


def test_sse_is_not_buffered_by_gzip(m8_space_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    import threading
    import time

    from objectapp.watcher import ChangeEvent

    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    app = create_app(Space(m8_space_dir), watch=False)
    with (
        TestClient(app) as c,
        c.stream("GET", "/api/events", headers={"accept-encoding": "gzip, deflate"}) as resp,
    ):
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")
        assert "content-encoding" not in resp.headers

        def publish():
            time.sleep(0.2)
            app.state.hub.publish(ChangeEvent("changed", "Pages/Source note.md", "v1"))

        threading.Thread(target=publish, daemon=True).start()
        t0 = time.monotonic()
        got = None
        for line in resp.iter_lines():
            if line.startswith("data:") and "Source note" in line:
                got = line
                break
            assert time.monotonic() - t0 < 5, "the event did not arrive"
        assert got is not None and time.monotonic() - t0 < 3


@pytest.mark.xfail(reason="needs lane B1a: a Unicode id regex in JsonStore", strict=False)
@pytest.mark.parametrize("name", NON_LATIN)
def test_non_latin_collection_and_query_names_are_created(client: TestClient, m8_space_dir: Path, name: str):
    collection = client.post("/api/collections", json={"name": name, "typeIds": ["page"]})
    query = client.post("/api/queries", json={"name": name, "definition": {}, "view": {}})
    assert (collection.status_code, query.status_code) == (201, 201)
    assert (m8_space_dir / ".capacities" / "collections" / f"{collection.json()['id']}.json").is_file()
    assert (m8_space_dir / ".capacities" / "queries" / f"{query.json()['id']}.json").is_file()
