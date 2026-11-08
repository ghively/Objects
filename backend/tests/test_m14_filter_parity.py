"""M14: the server's port of the view filter engine (`automation_filter`) gives the same
answers as ``frontend/src/views/filter.ts`` on the shared cases, which the front end's
``filter.parity.test.ts`` runs too."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from objectapp.automation_filter import FilterCtx, match_filter, match_group

CASES_FILE = (
    Path(__file__).resolve().parents[2] / "frontend" / "src" / "views" / "__fixtures__" / "filter-cases.json"
)
DATA = json.loads(CASES_FILE.read_text(encoding="utf-8"))


def ctx(week_start: str = "monday") -> FilterCtx:
    return FilterCtx(
        types=DATA["types"],
        collections=DATA["collections"],
        tag_titles=DATA["tagIdsToTitles"],
        now=datetime.fromisoformat(DATA["now"]),
        tz=ZoneInfo(DATA["timeZone"]),
        paths_by_id=DATA["pathsById"],
        week_start=week_start,
    )


@pytest.mark.parametrize("case", DATA["cases"], ids=[c["name"] for c in DATA["cases"]])
def test_the_port_matches_the_shared_cases(case):
    c = ctx(case.get("weekStart", "monday"))
    if "group" in case:
        got = [r["summary"]["path"] for r in DATA["rows"] if match_group(r, case["group"], c)]
    else:
        got = [r["summary"]["path"] for r in DATA["rows"] if match_filter(r, case["filter"], c)]
    assert got == case["matches"]


def test_the_fixture_covers_this_week_under_both_week_starts():
    # Weeks follow the "Start of the week" setting everywhere (2026-11-08): the port takes it
    # as ``week_start`` (Monday by default) and the fixture runs "this week" under both, on a
    # Sunday, so the two settings give different weeks (`test_m14_engine` checks a real space).
    def relative(c):
        ref = (c.get("filter") or {}).get("referenceValue")
        return ref.get("relative") if isinstance(ref, dict) else None

    starts = {c.get("weekStart") for c in DATA["cases"] if relative(c) == "thisWeek"}
    assert {"sunday", "monday"} <= starts
    assert FilterCtx.__dataclass_fields__["week_start"].default == "monday"
