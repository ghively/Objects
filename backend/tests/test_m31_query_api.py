"""M31 item 2: a saved query over the local API (and so MCP's ``run_saved_query``) lists what the
app's query page lists, in its order: search terms (with the app's mode), included and left-out
tags, excluded types, each type entry's collection rules, filters, sorts and the limit. Objects
excluded from AI stay hidden. The ad-hoc ``POST /v1/query`` takes the same parts.

Each expected answer is the app's: worked out from ``queries/runQuery.ts`` (whose port is checked
case by case against it in ``test_m31_query_parity.py``) and, for every saved query here, checked
again against the app's own two steps: ``POST /api/rows`` with the scope the app sends, then the
pipeline over the rows it answers."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.queryeval import QueryCtx, query_ctx, query_scope, run_query
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.tokens import TokenStore

TAGS = {"alpha": "tag-alpha", "beta": "tag-beta", "gamma": "tag-gamma"}


def _md(path: Path, fm: dict, body: str = "") -> None:
    lines = ["---"]
    for k, v in fm.items():
        if isinstance(v, list):
            lines.append(f"{k}:")
            lines += [f"  - '{x}'" for x in v]
        elif isinstance(v, bool):
            lines.append(f"{k}: {'true' if v else 'false'}")
        else:
            lines.append(f"{k}: {v}")
    lines += ["---", body, ""]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


@pytest.fixture
def api(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    root = tmp_path / "space"
    root.mkdir()
    # 1. The Server type (with a number) and two collections, made as the app makes them.
    with TestClient(create_app(Space(root), watch=False)) as c:
        st = c.post("/api/types", json={"name": "Server", "pluralName": "Servers"}).json()
        st["propertyDefinitions"] = st.get("propertyDefinitions", []) + [
            {"id": "estimate", "key": "estimate", "name": "Estimate", "type": "number", "options": {}}
        ]
        r = c.put(f"/api/types/{st['id']}", json={"type": st, "baseRevision": st.get("revision", "")})
        assert r.status_code == 200, r.text
        for name in ("Tooling", "Ops"):
            assert c.post("/api/collections", json={"name": name, "typeIds": []}).status_code == 201
    # 2. The objects (synthetic), then a fresh app over them.
    for tag, tid in TAGS.items():
        _md(root / "Tags" / f"{tag}.md", {"type": "Tag", "id": tid, "createdAt": "2026-09-01T00:00:00Z"})
    page = {"type": "Page"}
    _md(root / "Pages/Alpha plan.md", {**page, "tags": ["alpha"], "collections": ["Tooling"],
                                       "createdAt": "2026-10-01T00:00:00Z"}, "The quokka plan.")
    _md(root / "Pages/Beta notes.md", {**page, "tags": ["beta"], "createdAt": "2026-10-02T00:00:00Z"}, "Nothing.")
    _md(root / "Pages/Both.md", {**page, "tags": ["alpha", "beta"], "collections": ["Ops"],
                                 "createdAt": "2026-10-03T00:00:00Z"}, "A quokka again.")
    _md(root / "Pages/Secret.md", {**page, "tags": ["alpha"], "excludeFromAI": True,
                                   "createdAt": "2026-10-04T00:00:00Z"}, "A quokka, kept from AI.")
    _md(root / "Pages/Plain.md", {**page, "collections": ["Gone"], "createdAt": "2026-10-05T00:00:00Z"})
    _md(root / "Servers/web.md", {"type": "Server", "tags": ["alpha"], "collections": ["Ops"], "estimate": 3,
                                  "createdAt": "2026-10-06T00:00:00Z"})
    _md(root / "Servers/db.md", {"type": "Server", "tags": ["gamma"], "estimate": 9,
                                 "createdAt": "2026-10-07T00:00:00Z"}, "The quokka database.")
    space = Space(root)
    _record, secret = TokenStore(root).create("agent", "read")
    with TestClient(create_app(space, watch=False)) as c:
        yield space, c, {"Authorization": f"Bearer {secret}"}


def _save(c: TestClient, name: str, **definition) -> str:
    base = {"types": [], "filterGroup": {"type": "filterGroup", "operator": "and", "elements": []}, "sorts": [],
            "groupBy": None}
    r = c.post("/api/queries", json={"name": name, "definition": {**base, **definition}})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _titles(res) -> list[str]:
    assert res.status_code == 200, res.text
    return [x["title"] for x in res.json()["rows"]]


def _app_titles(space: Space, c: TestClient, query_id: str) -> list[str]:
    """What the app's query page lists: ``POST /api/rows`` with its scope, then its pipeline."""
    d = next(q for q in space.list_queries() if q.id == query_id).definition
    scope = query_scope(d, [t.id for t in space.types])
    rows = c.post("/api/rows", json={**scope, "preview": False}).json()["rows"]
    ids = scope.get("typeIds") or list(dict.fromkeys(r["summary"]["type"] for r in rows))
    ctx: QueryCtx = query_ctx(space, [i for i in ids if space.type_by_id(i)] or [t.id for t in space.types])
    return [r["summary"]["title"] for r in run_query(d, rows, ctx).rows]


T = lambda *ids, **rules: [{"id": i, **rules} for i in ids]
S = lambda *terms, mode="auto": {"searchTerms": [{"text": t} for t in terms], "searchMode": mode}
F = lambda pid, option, ref: {"type": "filter", "propertyId": pid, "option": option, "referenceValue": ref}

SAVED = [
    # name, definition, the app's answer (Secret is excluded from AI and never shows)
    ("Search text", {"search": S("quokka")}, ["db", "Both", "Alpha plan"]),
    ("Search titles", {"search": S("pla", mode="title")}, ["Plain", "Alpha plan"]),
    ("A short term is dropped", {"types": T("page"), "search": S("q", "pla", mode="title")}, ["Plain", "Alpha plan"]),
    ("Tags any of", {"tags": {"ids": [TAGS["alpha"], TAGS["beta"]], "operator": "or"}},
     ["web", "Both", "Beta notes", "Alpha plan"]),
    ("Tags all of", {"tags": {"ids": [TAGS["alpha"], TAGS["beta"]], "operator": "and"}}, ["Both"]),
    ("Excluded types", {"tags": {"ids": [TAGS["alpha"]], "operator": "or"}, "excludeTypeIds": ["server"]},
     ["Both", "Alpha plan"]),
    ("Excluded types need a term or tag", {"excludeTypeIds": ["server"]}, []),
    ("Left-out tags", {"tags": {"ids": [TAGS["alpha"], TAGS["gamma"]], "operator": "or"},
                       "excludeTags": {"ids": [TAGS["beta"]]}}, ["db", "web", "Alpha plan"]),
    ("In no collection", {"types": T("page", inNoCollection=True)}, ["Plain", "Beta notes"]),
    ("In any collection", {"types": T("page", inAnyCollection=True)}, ["Both", "Alpha plan"]),
    ("Not these, and these", {"types": [{"id": "page", "excludeCollectionIds": ["ops"]},
                                        {"id": "server", "collectionIds": ["ops"]}]},
     ["web", "Plain", "Beta notes", "Alpha plan"]),
    ("Filter and sort", {"types": T("page", "server"), "filterGroup": {"type": "filterGroup", "operator": "and",
                                                                      "elements": [F("estimate", "greater", 1)]},
                         "sorts": [{"propertyId": "estimate", "option": "ascending"}]}, ["web", "db"]),
    ("A search pauses filters and sorts", {"types": T("server"), "search": S("we", "db"),
                                           "filterGroup": {"type": "filterGroup", "operator": "and",
                                                           "elements": [F("estimate", "greater", 5)]},
                                           "sorts": [{"propertyId": "estimate", "option": "ascending"}]},
     ["db", "web"]),
    ("Limit", {"types": T("page"), "sorts": [{"propertyId": "title", "option": "ascending"}], "limit": {"size": 3}},
     ["Alpha plan", "Beta notes", "Both"]),
    ("Not ready", {}, []),
]


@pytest.mark.parametrize(("name", "definition", "expected"), SAVED, ids=[s[0] for s in SAVED])
def test_a_saved_query_lists_what_the_app_lists(api, name, definition, expected):
    space, c, h = api
    qid = _save(c, name, **definition)
    res = c.post(f"/api/v1/queries/{qid}/run", json={}, headers=h)
    assert _titles(res) == expected
    body = res.json()
    assert body["total"] == len(expected) and body["query"] == {"id": qid, "name": name}
    assert "unsupported" not in body  # every part of a saved query applies
    assert body["paused"] is bool(definition.get("search") and any(
        len(t["text"].strip()) >= 2 for t in definition["search"]["searchTerms"]))
    # The app's own two steps give the same list, Secret (excluded from AI) aside.
    assert [t for t in _app_titles(space, c, qid) if t != "Secret"] == expected


def test_paging_runs_over_the_app_order(api):
    _space, c, h = api
    qid = _save(c, "Every page", types=T("page"))
    res = c.post(f"/api/v1/queries/{qid}/run", json={"limit": 2, "offset": 1}, headers=h)
    assert _titles(res) == ["Both", "Beta notes"] and res.json()["total"] == 4


def test_mcp_run_saved_query_says_it_lists_what_the_app_lists():
    from objectapp import mcp_server

    text = Path(mcp_server.__file__).read_text(encoding="utf-8")
    start = text.index("def run_saved_query")
    doc = text[start : text.index("return client.post", start)]
    assert "unsupported" not in doc and "the app" in doc


# -- the ad-hoc query takes the same parts ----------------------------------------------------


def _query(c: TestClient, h: dict, **req) -> list[str]:
    return sorted(_titles(c.post("/api/v1/query", json=req, headers=h)))


def test_the_ad_hoc_query_applies_search_tags_types_and_collection_rules(api):
    _space, c, h = api
    assert _query(c, h, search="quokka") == ["Alpha plan", "Both", "db"]
    assert _query(c, h, search=["pla", "web"], searchMode="title") == ["Alpha plan", "Plain", "web"]
    assert _query(c, h, search="quokka", excludeTypeIds=["Server"]) == ["Alpha plan", "Both"]
    assert _query(c, h, tags=["alpha", "beta"], tagsOperator="and") == ["Both"]
    assert _query(c, h, tags=["alpha", "gamma"], excludeTags=["beta"]) == ["Alpha plan", "db", "web"]
    assert _query(c, h, typeIds=["page"], inNoCollection=True) == ["Beta notes", "Plain"]
    assert _query(c, h, typeIds=["page"], inAnyCollection=True) == ["Alpha plan", "Both"]
    assert _query(c, h, typeIds=["page", "server"], excludeCollectionIds=["ops"]) == [
        "Alpha plan", "Beta notes", "Plain", "db"]
    # Filters still apply beside a search here (a query made over the API is not the app's draft).
    group = {"type": "filterGroup", "operator": "and", "elements": [F("estimate", "greater", 5)]}
    assert _query(c, h, search=["we", "db"], filterGroup=group) == ["db"]


def test_the_ad_hoc_query_refuses_what_it_cannot_run(api):
    _space, c, h = api
    bad = c.post("/api/v1/query", json={"search": "q"}, headers=h)
    assert bad.status_code == 422 and "at least 2 characters" in bad.json()["detail"]
    bad = c.post("/api/v1/query", json={"search": "ab", "searchMode": "exact"}, headers=h)
    assert bad.status_code == 422
    bad = c.post("/api/v1/query", json={"tags": ["alpha"], "tagsOperator": "xor"}, headers=h)
    assert bad.status_code == 422
    bad = c.post("/api/v1/query", json={"excludeTypeIds": ["Nope"]}, headers=h)
    assert bad.status_code == 422
