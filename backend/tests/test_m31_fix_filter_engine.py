"""M31 fix pass, finding 13: one filter engine. The view filter engine's server port
(`automation_filter`) filters every kind ``views/filter.ts`` filters: formula and rollup values (by
their result type), IDs, emails, phones and files, and M28's counterpart rows (read from a type's
``counterparts`` as ``defIn`` reads them). Saved queries (`queryeval`) use it as it is, so an
automation's conditions and a saved query mean the same thing."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from objectapp import automation_filter as af
from objectapp import queryeval

CASES_FILE = (
    Path(__file__).resolve().parents[2] / "frontend" / "src" / "queries" / "__fixtures__" / "query-cases.json"
)
DATA = json.loads(CASES_FILE.read_text(encoding="utf-8"))
WIDENED = [
    "formula number greater",
    "formula text contains",
    "formula empty (errors count as empty)",
    "unique id contains a number",
    "email ends with",
    "counterpart row contains",
]


def test_the_engine_offers_the_operators_filter_ts_offers():
    text = af.FILTER_OPTIONS["text"]
    for kind in ("uniqueId", "email", "phone"):
        assert af.filter_options_for({"type": kind}) == text
    assert af.filter_options_for({"type": "files"}) == ["isEmpty", "isNotEmpty"]
    computed = af.filter_options_for({"type": "formula"})
    assert computed == af.filter_options_for({"type": "rollup"})
    assert computed == [*text, *af.FILTER_OPTIONS["number"], "isBefore", "isAfter", "isOnOrBefore",
                        "isOnOrAfter", "isChecked", "isNotChecked"]


@pytest.mark.parametrize("name", WIDENED)
def test_automation_conditions_filter_the_widened_kinds(name):
    # The window's types as they come (counterparts beside the definitions, not merged into them).
    case = next(c for c in DATA["cases"] if c["name"] == name)
    ctx = af.FilterCtx(
        types=DATA["types"],
        collections=DATA["collections"],
        tag_titles=DATA["tagIdsToTitles"],
        now=datetime.fromisoformat(DATA["now"]),
        tz=ZoneInfo(DATA["timeZone"]),
        paths_by_id=DATA["pathsById"],
        view_type_ids=case["scope"]["typeIds"],
    )
    rows = [r for r in DATA["rows"] if r["summary"]["type"] in case["scope"]["typeIds"]]
    got = {r["summary"]["path"] for r in rows if af.match_group(r, case["definition"]["filterGroup"], ctx)}
    assert got == set(case["matches"])


def test_files_filter_as_empty_or_not():
    types = [{"id": "page", "propertyDefinitions": [{"id": "f", "key": "f", "type": "files", "options": {}}]}]
    ctx = af.FilterCtx(types=types)
    some = {"summary": {"path": "a.md", "type": "page"}, "values": {"f": ["Attachments/x.pdf"]}, "links": {}}
    none = {"summary": {"path": "b.md", "type": "page"}, "values": {"f": []}, "links": {}}
    f = {"type": "filter", "propertyId": "f", "option": "isNotEmpty"}
    assert af.match_filter(some, f, ctx) and not af.match_filter(none, f, ctx)


def test_saved_queries_use_the_one_engine():
    assert queryeval.match_group is af.match_group
    assert not hasattr(queryeval, "_compile_filter") and not hasattr(queryeval, "_MORE_OPTIONS")
