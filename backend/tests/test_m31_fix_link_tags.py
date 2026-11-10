"""M31 fix pass, finding 4: a tag written as a link in front matter (``[[Work]]``, ``[[Work|alias]]``,
or the Tag's path, ``[[Tags/Work]]`` / ``Tags/Work.md``) names the Tag "Work" in every tag matcher:
the view filter engine (automation conditions and saved queries) and the ad-hoc ``POST /v1/query``.
How tags are stored is unchanged."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.automation_filter import FilterCtx, match_filter, tag_names
from objectapp.queryeval import QueryCtx, run_query
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.tokens import TokenStore


def _row(path: str, tags: list[str]) -> dict:
    return {"summary": {"path": path, "type": "page", "title": path, "tags": tags}, "values": {}, "links": {}}


ROWS = [
    _row("plain.md", ["Work"]),
    _row("link.md", ["[[Work]]"]),
    _row("alias.md", ["[[Work|the job]]"]),
    _row("path.md", ["[[Tags/Work]]"]),
    _row("file.md", ["Tags/Work.md"]),
    _row("other.md", ["[[Home]]"]),
    _row("none.md", []),
]
TYPES = [{"id": "page", "propertyDefinitions": []}]
TITLES = {"t-work": "Work", "t-home": "Home", "t-cicd": "CI/CD"}


def _f(option: str, ids: list[str]) -> dict:
    return {"type": "filter", "propertyId": "tags", "option": option, "referenceValue": ids}


def test_tag_names_unwraps_links_aliases_and_paths():
    assert tag_names("Work") == ["Work"]
    assert tag_names(" [[Work]] ") == ["Work"]
    assert tag_names("[[Work|the job]]") == ["Work"]
    assert tag_names("[[Tags/Work]]") == ["Tags/Work", "Work"]
    assert tag_names("[[Tags/Work.md|w]]") == ["Tags/Work.md", "Work"]
    assert tag_names("Tags/Work.md") == ["Tags/Work.md", "Work"]
    assert tag_names("CI/CD") == ["CI/CD"]  # a plain name with a slash is a name


def test_the_filter_engine_matches_link_form_tags():
    ctx = FilterCtx(types=TYPES, tag_titles=TITLES)
    hit = [r["summary"]["path"] for r in ROWS if match_filter(r, _f("contains", ["t-work"]), ctx)]
    assert hit == ["plain.md", "link.md", "alias.md", "path.md", "file.md"]
    miss = [r["summary"]["path"] for r in ROWS if match_filter(r, _f("notContains", ["t-work"]), ctx)]
    assert miss == ["other.md", "none.md"]


def test_a_saved_query_includes_and_leaves_out_link_form_tags():
    ctx = QueryCtx(types=TYPES, tag_titles=TITLES)
    d = {"types": [], "tags": {"ids": ["t-work", "t-home"], "operator": "or"}, "excludeTags": {"ids": ["t-home"]}}
    got = sorted(r["summary"]["path"] for r in run_query(d, ROWS, ctx).rows)
    assert got == ["alias.md", "file.md", "link.md", "path.md", "plain.md"]


@pytest.fixture
def api(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    root = tmp_path / "space"
    (root / "Tags").mkdir(parents=True)
    (root / "Pages").mkdir()
    (root / "Tags/Work.md").write_text("---\ntype: Tag\nid: t-work\n---\n", encoding="utf-8")
    (root / "Pages/Linked.md").write_text("---\ntype: Page\ntags:\n  - '[[Work]]'\n---\n", encoding="utf-8")
    (root / "Pages/Aliased.md").write_text("---\ntype: Page\ntags:\n  - '[[Work|job]]'\n---\n", encoding="utf-8")
    (root / "Pages/Plain.md").write_text("---\ntype: Page\ntags:\n  - work\n---\n", encoding="utf-8")
    (root / "Pages/Untagged.md").write_text("---\ntype: Page\n---\n", encoding="utf-8")
    space = Space(root)
    _record, secret = TokenStore(root).create("agent", "read")
    with TestClient(create_app(space, watch=False)) as c:
        yield c, {"Authorization": f"Bearer {secret}"}


def _titles(c: TestClient, h: dict, **req) -> list[str]:
    res = c.post("/api/v1/query", json=req, headers=h)
    assert res.status_code == 200, res.text
    return sorted(x["title"] for x in res.json()["rows"])


def test_the_ad_hoc_query_matches_link_form_tags(api):
    c, h = api
    assert _titles(c, h, tags=["Work"]) == ["Aliased", "Linked", "Plain"]
    assert _titles(c, h, tags=["[[Work]]"]) == ["Aliased", "Linked", "Plain"]
    assert _titles(c, h, typeIds=["page"], excludeTags=["work"]) == ["Untagged"]
