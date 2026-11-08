"""Audit 2026-11-07, lane B: the HTTP API and the v1 local API (findings 4, 12, 22-25)."""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.tokens import TokenStore

REPLACED = "Pages/Caf� notes.md"


def _env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))


def _bearer(space_dir: Path, scope: str) -> dict[str, str]:
    _record, secret = TokenStore(space_dir).create(scope, scope)
    return {"Authorization": f"Bearer {secret}"}


# -- 4: a file name that is not UTF-8 -----------------------------------------------------


@pytest.fixture
def undecodable(space_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """A space holding ``Pages/Caf\\xe9 notes.md`` (Latin-1 bytes) that links to Alpha."""
    if sys.platform != "linux":
        pytest.skip("only Linux file systems take a file name that is not UTF-8")
    _env(tmp_path, monkeypatch)
    raw = os.fsencode(space_dir) + b"/Pages/Caf\xe9 notes.md"
    try:
        with open(raw, "wb") as f:
            f.write(
                b"---\ntype: Page\ntitle: Cafe notes\nrelated:\n  - '[[Alpha]]'\n"
                b"lastUpdated: 2026-11-06T10:00:00.000Z\n---\nBody mentions [[Alpha]] and cafe.\n"
            )
    except OSError:
        pytest.skip("this file system refuses a file name that is not UTF-8")
    with TestClient(
        create_app(Space(space_dir), watch=False), raise_server_exceptions=False
    ) as c:
        deadline = time.monotonic() + 30
        while c.get("/api/search", params={"q": "zzz"}).json().get("partial"):
            assert time.monotonic() < deadline, "the search index did not finish its sync"
            time.sleep(0.05)
        yield c, _bearer(space_dir, "read-write")


def test_undecodable_name_does_not_break_search_or_v1_reads(undecodable):
    c, h = undecodable
    r = c.get("/api/search", params={"q": "Cafe"})
    assert r.status_code == 200, r.text
    assert REPLACED in [x["path"] for x in r.json()["results"]]
    r = c.get("/api/v1/search", params={"q": "Cafe"}, headers=h)
    assert r.status_code == 200, r.text
    assert REPLACED in [x["path"] for x in r.json()["results"]]
    r = c.post("/api/v1/query", json={"typeIds": ["page"]}, headers=h)
    assert r.status_code == 200, r.text
    assert REPLACED in [x["path"] for x in r.json()["rows"]]
    r = c.get("/api/v1/changes", headers=h)
    assert r.status_code == 200, r.text
    assert REPLACED in [x["path"] for x in r.json()["objects"]]
    r = c.get("/api/v1/object/backlinks", params={"path": "Pages/Alpha.md"}, headers=h)
    assert r.status_code == 200, r.text
    assert REPLACED in [x["path"] for x in r.json()["backlinks"]]
    r = c.get("/api/v1/references", params={"path": "Pages/Alpha.md"}, headers=h)
    assert r.status_code == 200, r.text
