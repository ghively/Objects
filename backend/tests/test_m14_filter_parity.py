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


def ctx() -> FilterCtx:
    return FilterCtx(
        types=DATA["types"],
        collections=DATA["collections"],
        tag_titles=DATA["tagIdsToTitles"],
        now=datetime.fromisoformat(DATA["now"]),
        tz=ZoneInfo(DATA["timeZone"]),
        paths_by_id=DATA["pathsById"],
    )


@pytest.mark.parametrize("case", DATA["cases"], ids=[c["name"] for c in DATA["cases"]])
def test_the_port_matches_the_shared_cases(case):
    c = ctx()
    if "group" in case:
        got = [r["summary"]["path"] for r in DATA["rows"] if match_group(r, case["group"], c)]
    else:
        got = [r["summary"]["path"] for r in DATA["rows"] if match_filter(r, case["filter"], c)]
    assert got == case["matches"]


def test_this_week_ignores_the_spaces_week_start():
    # Review M14 #6 (our choice): the port has no week-start setting; "this week" runs Monday
    # to Sunday as the views' engine has it, so a Sunday-start space's rules match its views
    # (the fixture's ``spaceWeekStart`` case; `test_m14_engine` checks it on a real space).
    assert "week_start" not in FilterCtx.__dataclass_fields__
    assert any(c.get("spaceWeekStart") == "sunday" for c in DATA["cases"])
