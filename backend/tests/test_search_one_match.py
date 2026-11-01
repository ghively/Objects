"""Audit 2026-11-01 B9: search answers with one full ``MATCH`` scan, results unchanged.

The ranking reads rowids only (no content lookup per hit) and the snippets filter
by ``+rowid`` (one ``MATCH`` evaluation, no ``path`` read per hit). `_Reference`
is the index as it was before; every fixture query must answer the same.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from objectapp import searchindex as si
from objectapp.searchindex import SearchIndex
from objectapp.space import Space

FIXTURES = Path(__file__).parent / "fixtures"


class _Reference(SearchIndex):
    """The ranking and snippet queries before audit 2026-11-01 B9."""

    def _fts_rank(self, match, candidates, type_set, limit):
        where = "fts MATCH ?"
        params: list[Any] = [match]
        if type_set:
            where += f" AND type IN ({', '.join('?' for _ in type_set)})"
            params.extend(sorted(type_set))
        fetch = min(limit * 4 + 50, 1000)
        rows = self._query(
            f"SELECT path, {si._BM25} AS r FROM fts WHERE {where} ORDER BY r LIMIT ?",
            [*params, fetch],
        )
        return [(p, round(-float(r), 4)) for p, r in rows if p in candidates]

    def _snippets(self, match, paths):
        if not paths:
            return {}
        snippets = ", ".join(
            f"snippet(fts, {i + 2}, '{si._HL_OPEN}', '{si._HL_CLOSE}', '…', {si._SNIPPET_TOKENS})"
            for i in range(len(si._COLUMNS))
        )
        rows = self._query(
            f"SELECT path, {snippets} FROM fts WHERE fts MATCH ? "
            f"AND path IN ({', '.join('?' for _ in paths)})",
            [match, *paths],
        )
        out: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            hl = []
            for col, text in zip(si._COLUMNS, row[1:], strict=True):
                if text and si._HL_OPEN in text:
                    hl.append({"field": si._FIELD[col], "snippets": [si._clean_snippet(text)]})
            out[row[0]] = hl
        return out


QUERIES = [
    "a", "ad", "ada", "ada love", "engine", "difference engine", "the", "an", "café", "cafe",
    "engine ada", "task", "loose", "page", "machine program", "zz", "note", "meeting", "e",
    'quote"s', "not", "or and", "1", "2026", "first published",
]
MODES = ["auto", "fullText", "title"]


@pytest.mark.parametrize("fixture", ["space-links", "space-m8", "space-sample", "space-calendar"])
def test_search_answers_as_before(fixture: str, tmp_path: Path):
    import shutil

    root = tmp_path / fixture
    shutil.copytree(FIXTURES / fixture, root)
    space = Space(root)
    new = SearchIndex(space, tmp_path / "cache-new")
    old = _Reference(space, tmp_path / "cache-old")
    for idx in (new, old):
        idx.start()
        assert idx.ready.wait(30)
    try:
        types = sorted({s.type for s in space._summaries.values()})
        tags = sorted({t for s in space._summaries.values() for t in s.tags})
        for q in QUERIES:
            for mode in MODES:
                for limit in (1, 3, 50):
                    a = new.search(q, mode=mode, limit=limit)
                    b = old.search(q, mode=mode, limit=limit)
                    assert a == b, (q, mode, limit)
            for t in types[:3]:
                assert new.search(q, types=[t]) == old.search(q, types=[t]), (q, t)
                assert new.search(q, exclude_types=[t]) == old.search(q, exclude_types=[t])
            for tag in tags[:2]:
                assert new.search(q, tag=tag) == old.search(q, tag=tag), (q, tag)
    finally:
        new.stop()
        old.stop()


def test_snippets_never_read_path_per_hit(links_space_dir: Path, tmp_path: Path):
    """The snippet query filters on rowids, so ``path`` is read for the answered rows only."""
    space = Space(links_space_dir)
    idx = SearchIndex(space, tmp_path / "cache")
    idx.start()
    assert idx.ready.wait(30)
    sql: list[str] = []
    real = idx._query

    def spy(q, params):
        sql.append(q)
        return real(q, params)

    idx._query = spy  # type: ignore[method-assign]
    try:
        assert idx.search("engine")["results"]
        assert all("path IN" not in q or "+rowid" in q for q in sql), sql
        rank = [q for q in sql if "ORDER BY" in q]
        assert rank and all(q.startswith("SELECT rowid,") for q in rank), rank
    finally:
        idx.stop()
