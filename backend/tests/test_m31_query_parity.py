"""M31: the server's port of the app's query evaluation (`queryeval`) gives the same answers as
``frontend/src/queries/runQuery.ts`` on the shared cases, which the front end's
``runQuery.parity.test.ts`` runs too: the scope the app fetches, then the objects and their order."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from objectapp.queryeval import (
    QueryCtx,
    engine_type,
    is_query_ready,
    match_group,
    query_scope,
    run_query,
)

CASES_FILE = (
    Path(__file__).resolve().parents[2] / "frontend" / "src" / "queries" / "__fixtures__" / "query-cases.json"
)
DATA = json.loads(CASES_FILE.read_text(encoding="utf-8"))
TYPES = [engine_type(t) for t in DATA["types"]]


def answer(definition: dict) -> dict:
    # The test's own steps mirror the app's: the scope, the rows of its types, `DataView`'s context.
    scope = query_scope(definition, DATA["allTypeIds"])
    rows = DATA["rows"]
    if "typeIds" in scope:
        rows = [r for r in rows if r["summary"]["type"] in scope["typeIds"]]
    ids = scope.get("typeIds") or list(dict.fromkeys(r["summary"]["type"] for r in rows))
    view = [i for i in ids if any(t["id"] == i for t in TYPES)] or [t["id"] for t in TYPES]
    ctx = QueryCtx(
        types=TYPES,
        collections=DATA["collections"],
        tag_titles=DATA["tagIdsToTitles"],
        now=datetime.fromisoformat(DATA["now"]),
        tz=ZoneInfo(DATA["timeZone"]),
        paths_by_id=DATA["pathsById"],
        view_type_ids=view,
        entity_titles=DATA["entityTitles"],
    )
    seq = iter(DATA["rng"] * 10)
    run = run_query(definition, rows, ctx, lambda: next(seq))
    return {"scope": scope, "matches": [r["summary"]["path"] for r in run.rows]}


@pytest.mark.parametrize("case", DATA["cases"], ids=[c["name"] for c in DATA["cases"]])
def test_the_port_answers_the_shared_cases(case):
    assert answer(case["definition"]) == {"scope": case["scope"], "matches": case["matches"]}


def test_the_cases_cover_every_part_of_a_query():
    keys = {k for c in DATA["cases"] for k, v in c["definition"].items() if v}
    assert {"types", "excludeTypeIds", "tags", "excludeTags", "search", "filterGroup", "sorts", "limit", "groupBy"} <= keys
    entries = [s for c in DATA["cases"] for s in c["definition"]["types"]]
    for rule in ("inNoCollection", "inAnyCollection", "collectionIds", "excludeCollectionIds"):
        assert any(s.get(rule) for s in entries), rule
    assert not is_query_ready(DATA["cases"][0]["definition"])


FILTER_CASES = json.loads(
    (CASES_FILE.parents[2] / "views" / "__fixtures__" / "filter-cases.json").read_text(encoding="utf-8")
)


@pytest.mark.parametrize("case", FILTER_CASES["cases"], ids=[c["name"] for c in FILTER_CASES["cases"]])
def test_the_widened_filter_engine_still_answers_the_view_filter_cases(case):
    ctx = QueryCtx(
        types=[engine_type(t) for t in FILTER_CASES["types"]],
        collections=FILTER_CASES["collections"],
        tag_titles=FILTER_CASES["tagIdsToTitles"],
        now=datetime.fromisoformat(FILTER_CASES["now"]),
        tz=ZoneInfo(FILTER_CASES["timeZone"]),
        paths_by_id=FILTER_CASES["pathsById"],
        week_start=case.get("weekStart", "monday"),
    )
    group = case.get("group") or {"type": "filterGroup", "operator": "and", "elements": [case["filter"]]}
    got = [r["summary"]["path"] for r in FILTER_CASES["rows"] if match_group(r, group, ctx)]
    assert got == case["matches"]
