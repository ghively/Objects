"""M8 Task 16: ``mode=fullText`` ("Text matches only") on ``GET /api/search``."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient
from objectapp.server import create_app
from objectapp.space import Space

TITLE_ONLY = "Pages/Zebrafish notes.md"
BODY_HIT = "Pages/Aquarium log.md"
DESC_ONLY = "Pages/Described page.md"

_PAGE = """---
id: {id}
type: 'Page'
title: {title}
{extra}createdAt: 2026-10-27T09:00:00.000Z
lastUpdated: 2026-10-27T09:00:00.000Z
---

{body}
"""


def _write_pages(root: Path) -> None:
    (root / TITLE_ONLY).write_text(
        _PAGE.format(
            id="01JC5M8S00000000000000S801",
            title="Zebrafish notes",
            extra="",
            body="Nothing about the striped fish here.",
        ),
        encoding="utf-8",
    )
    (root / BODY_HIT).write_text(
        _PAGE.format(
            id="01JC5M8S00000000000000S802",
            title="Aquarium log",
            extra="",
            body="Fed the zebrafish twice today.",
        ),
        encoding="utf-8",
    )
    (root / DESC_ONLY).write_text(
        _PAGE.format(
            id="01JC5M8S00000000000000S803",
            title="Described page",
            extra="description: A zebrafish summary\n",
            body="No match in the text.",
        ),
        encoding="utf-8",
    )


def _client(root: Path):
    space = Space(root)
    app = create_app(space, None, watch=False)
    app.state.hub.publish = lambda _e: None
    return app, TestClient(app)


def _paths(body: dict) -> list[str]:
    return [r["path"] for r in body["results"]]


def test_full_text_mode_skips_title_only_matches(links_space_dir: Path):
    _write_pages(links_space_dir)
    app, c = _client(links_space_dir)
    with c:
        assert app.state.search.ready.wait(30)
        auto = c.get("/api/search", params={"q": "zebrafish"}).json()
        assert TITLE_ONLY in _paths(auto)
        assert BODY_HIT in _paths(auto)

        r = c.get("/api/search", params={"q": "zebrafish", "mode": "fullText"})
        assert r.status_code == 200
        body = r.json()
        assert set(body) == {"results", "partial"}
        # Body (blocks content) matches only: no title-only or description-only hit.
        assert _paths(body) == [BODY_HIT]
        hit = body["results"][0]
        assert hit["titleMatches"] == []
        assert [h["field"] for h in hit["highlights"]] == ["blocksContent"]
        assert "\u0002" in hit["highlights"][0]["snippets"][0]

        # Filters still apply.
        none = c.get(
            "/api/search",
            params=[("q", "zebrafish"), ("mode", "fullText"), ("type", "person")],
        ).json()
        assert none["results"] == []
        # An empty query stays empty; a one-letter query has no full-text match.
        assert (
            c.get("/api/search", params={"q": "", "mode": "fullText"}).json()["results"]
            == []
        )
        assert (
            c.get("/api/search", params={"q": "z", "mode": "fullText"}).json()[
                "results"
            ]
            == []
        )


def test_bad_mode_422(links_space_dir: Path):
    """Regression guard (green from the start) for the other modes."""
    app, c = _client(links_space_dir)
    with c:
        assert app.state.search.ready.wait(30)
        for mode in ("auto", "title", "fullText"):
            assert (
                c.get("/api/search", params={"q": "engine", "mode": mode}).status_code
                == 200
            )
        for bad in ("semantic", "fulltext", "body", ""):
            r = c.get("/api/search", params={"q": "engine", "mode": bad})
            assert r.status_code == 422, bad
