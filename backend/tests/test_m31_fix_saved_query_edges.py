"""M31 fix pass, finding 12: a saved query over the local API (and MCP's ``run_saved_query``) at the
edges where it differed from the app's query page.

- Rows that sit only in hidden groups (the view's grouping, ``groupByConfig``: a group hidden by
  its config, or every group not named with ``hideByDefault``) are not listed by the app: the API
  drops them too (`queryeval.visible_rows`, a port of ``views/group.ts`` ``groupRows``' group ids).
- A random limit is drawn once per query version (seeded by its id and revision), so paging with
  ``limit``/``offset`` walks one draw instead of a new one each call.
- Objects excluded from AI are left out before the query's own limit, so a limit of N still gives
  N objects when there are as many visible ones.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from objectapp.queryeval import QueryCtx, seeded_rng, visible_rows
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.tokens import TokenStore

# -- the group ids (pure) ---------------------------------------------------------------------

STATUS = {
    "id": "status", "key": "status", "type": "label",
    "options": {"isStatus": True, "set": [
        {"id": "s-todo", "text": "To Do"},
        {"id": "s-doing", "text": "Doing", "statusCategory": "in-progress"},
        {"id": "s-done", "text": "Done", "statusCategory": "done"},
    ]},
}  # fmt: skip
TYPES = [
    {"id": "task", "propertyDefinitions": [
        STATUS,
        {"id": "estimate", "key": "estimate", "type": "number", "options": {}},
        {"id": "due", "key": "due", "type": "datetime", "options": {}},
        {"id": "done", "key": "done", "type": "boolean", "options": {}},
        {"id": "note", "key": "note", "type": "text", "options": {}},
        {"id": "score", "key": "score", "type": "formula", "options": {}},
        {"id": "owner", "key": "owner", "type": "entity", "options": {"isArray": True}},
    ]},
    {"id": "page", "propertyDefinitions": [{"id": "note", "key": "note", "type": "number", "options": {}}]},
]  # fmt: skip


def _row(path: str, type_: str = "task", tags=(), links=None, **values) -> dict:
    return {
        "summary": {"path": path, "type": type_, "title": path[:-3], "tags": list(tags), "aliases": [],
                    "collections": []},
        "values": values,
        "links": links or {},
    }  # fmt: skip


def _ctx() -> QueryCtx:
    return QueryCtx(
        types=TYPES,
        tag_titles={"tag-w": "Work", "tag-h": "Home"},
        now=datetime(2026, 11, 4, 18, 0, tzinfo=UTC),  # a Wednesday, noon in Chicago
        tz=ZoneInfo("America/Chicago"),
        view_type_ids=["task"],
    )


def _visible(rows, entry: dict, config: dict | None) -> list[str]:
    return [r["summary"]["path"] for r in visible_rows(rows, {"groups": [entry]}, config, _ctx())]


def _g(*hidden: str, by_default: bool = False, shown: tuple[str, ...] = ()) -> dict:
    groups = [{"id": i, "isHidden": True, "isClosed": False} for i in hidden]
    groups += [{"id": i, "isHidden": False, "isClosed": False} for i in shown]
    return {"groups": groups, "hideByDefault": by_default}


def test_no_grouping_or_no_hidden_group_keeps_every_row():
    rows = [_row("a.md", status=["Done"]), _row("b.md", status=[])]
    assert [r["summary"]["path"] for r in visible_rows(rows, None, _g("s-done"), _ctx())] == ["a.md", "b.md"]
    assert _visible(rows, {"propertyId": "status", "option": "default"}, None) == ["a.md", "b.md"]
    assert _visible(rows, {"propertyId": "nope", "option": "default"}, _g("other")) == ["a.md", "b.md"]


def test_a_hidden_label_group_and_the_other_group():
    rows = [_row("todo.md", status=["To Do"]), _row("done.md", status=["Done"]), _row("none.md", status=[])]
    entry = {"propertyId": "status", "option": "default"}
    assert _visible(rows, entry, _g("s-done")) == ["todo.md", "none.md"]
    assert _visible(rows, entry, _g("other")) == ["todo.md", "done.md"]
    # Hidden by default: only the groups the config shows are listed.
    assert _visible(rows, entry, _g(by_default=True, shown=("s-todo",))) == ["todo.md"]


def test_a_row_in_two_groups_stays_while_one_of_them_shows():
    rows = [_row("both.md", tags=["Work", "Home"]), _row("work.md", tags=["Work"]), _row("x.md", tags=["Misc"])]
    entry = {"propertyId": "tags", "option": "default"}
    # Tag groups are the Tag's id; an unknown tag's group is ``tag:<value>`` (a saved bare value matches).
    assert _visible(rows, entry, _g("tag-w")) == ["both.md", "x.md"]
    assert _visible(rows, entry, _g("tag-w", "tag-h")) == ["x.md"]
    assert _visible(rows, entry, _g("Misc")) == ["both.md", "work.md"]


def test_status_categories_booleans_and_text():
    rows = [_row("todo.md", status=["To Do"], done=True, note=" hi "), _row("doing.md", status=["Doing"], done=False)]
    assert _visible(rows, {"propertyId": "status", "option": "statusCategory"}, _g("not-started")) == ["doing.md"]
    assert _visible(rows, {"propertyId": "done", "option": "default"}, _g("true")) == ["doing.md"]
    assert _visible(rows, {"propertyId": "note", "option": "default"}, _g("text:hi")) == ["doing.md"]
    assert _visible(rows, {"propertyId": "note", "option": "default"}, _g("hi")) == ["doing.md"]


def test_numbers_by_value_and_by_range():
    rows = [_row("one.md", estimate=1), _row("seven.md", estimate=7.0), _row("big.md", estimate=40)]
    assert _visible(rows, {"propertyId": "estimate", "option": "default"}, _g("7")) == ["one.md", "big.md"]
    entry = {"propertyId": "estimate", "option": "range", "numberRangeConfig": {"min": 0, "max": 10, "step": 5}}
    # Outside the range a row is in no group at all, so the app never lists it.
    assert _visible(rows, entry, None) == ["one.md", "seven.md"]
    assert _visible(rows, entry, _g("0-5")) == ["seven.md"]


def test_dates_by_day_month_and_relative():
    rows = [
        _row("today.md", due={"start": "2026-11-04T20:00:00.000Z", "resolution": "time"}),
        _row("late.md", due={"start": "2026-11-05T03:00:00.000Z", "resolution": "time"}),  # the 4th, 9 PM in Chicago
        _row("next.md", due={"start": "2026-11-10", "resolution": "day"}),
        _row("none.md"),
    ]
    assert _visible(rows, {"propertyId": "due", "option": "day"}, _g("2026-11-04")) == ["next.md", "none.md"]
    assert _visible(rows, {"propertyId": "due", "option": "month"}, _g("2026-11")) == ["none.md"]
    assert _visible(rows, {"propertyId": "due", "option": "relative"}, _g("today", "other")) == ["next.md"]
    assert _visible(rows, {"propertyId": "due", "option": "week"}, _g("2026-11-09")) == ["today.md", "late.md", "none.md"]


def test_relations_formulas_and_another_kind_in_other():
    rows = [
        _row("a.md", owner=[{"target": "Ann", "path": "People/Ann.md"}], score={"type": "number", "value": 3}),
        _row("b.md", owner=[{"target": "Nobody"}], score={"type": "error", "value": None}),
        _row("p.md", type_="page", note=5),
    ]
    assert _visible(rows, {"propertyId": "owner", "option": "default"}, _g("People/Ann.md")) == ["b.md", "p.md"]
    assert _visible(rows, {"propertyId": "owner", "option": "default"}, _g("target:Nobody")) == ["a.md", "p.md"]
    assert _visible(rows, {"propertyId": "score", "option": "default"}, _g("text:3")) == ["b.md", "p.md"]
    # A page's "note" is a number where the grouping's is text: it can't be bucketed, so it is Other.
    assert _visible(rows, {"propertyId": "note", "option": "default"}, _g("other")) == []


def test_the_seeded_draw_is_one_per_query_version():
    a = [seeded_rng("q1", "r1")() for _ in range(3)]
    assert a == [seeded_rng("q1", "r1")() for _ in range(3)]
    assert a != [seeded_rng("q1", "r2")() for _ in range(3)]


# -- over the API -----------------------------------------------------------------------------


def _md(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


@pytest.fixture
def api(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    root = tmp_path / "space"
    root.mkdir()
    _md(root / "Tags/work.md", "---\ntype: Tag\nid: tag-w\n---\n")
    _md(root / "Tags/home.md", "---\ntype: Tag\nid: tag-h\n---\n")
    for n in range(1, 13):
        tag = "home" if n % 4 == 0 else "work"
        extra = "excludeFromAI: true\n" if n in (1, 2, 3) else ""
        _md(root / f"Pages/P{n:02}.md", f"---\ntype: Page\ntags:\n  - {tag}\n{extra}createdAt: 2026-10-{n:02}T00:00:00Z\n---\n")
    space = Space(root)
    _record, secret = TokenStore(root).create("agent", "read")
    with TestClient(create_app(space, watch=False)) as c:
        yield space, c, {"Authorization": f"Bearer {secret}"}


def _save(c: TestClient, name: str, view: dict | None = None, **definition) -> str:
    base = {"types": [{"id": "page"}], "filterGroup": {"type": "filterGroup", "operator": "and", "elements": []},
            "sorts": [], "groupBy": None}
    body = {"name": name, "definition": {**base, **definition}}
    if view is not None:
        body["view"] = view
    r = c.post("/api/queries", json=body)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _run(c: TestClient, h: dict, qid: str, **req) -> dict:
    res = c.post(f"/api/v1/queries/{qid}/run", json=req, headers=h)
    assert res.status_code == 200, res.text
    return res.json()


def test_rows_in_hidden_groups_are_not_listed(api):
    _space, c, h = api
    view = {"viewDefinition": {"dataViewLayout": "list", "groupByConfig": {
        "groups": [{"id": "tag-h", "isHidden": True, "isClosed": False}]}}}  # fmt: skip
    qid = _save(c, "Grouped", view, groupBy={"groups": [{"propertyId": "tags", "option": "default"}]})
    body = _run(c, h, qid)
    titles = [x["title"] for x in body["rows"]]
    assert "P04" not in titles and "P08" not in titles and "P12" not in titles
    assert body["total"] == 6 and len(titles) == 6  # 12, less 3 excluded from AI, less 3 in Home


def test_paging_a_random_limit_walks_one_draw(api):
    _space, c, h = api
    qid = _save(c, "Random", limit={"size": 5, "random": True})
    first = _run(c, h, qid, limit=3, offset=0)
    second = _run(c, h, qid, limit=3, offset=3)
    again = _run(c, h, qid, limit=3, offset=0)
    a, b = [x["path"] for x in first["rows"]], [x["path"] for x in second["rows"]]
    assert first["total"] == 5 and len(a) == 3 and len(b) == 2 and len(set(a + b)) == 5  # one draw
    assert [x["path"] for x in again["rows"]] == a


def test_objects_excluded_from_ai_go_before_the_limit(api):
    _space, c, h = api
    # Oldest first, P01-P03 (excluded from AI) would be the first three of the five.
    qid = _save(c, "Oldest", sorts=[{"propertyId": "createdAt", "option": "ascending"}], limit={"size": 5})
    body = _run(c, h, qid)
    assert [x["title"] for x in body["rows"]] == ["P04", "P05", "P06", "P07", "P08"] and body["total"] == 5
