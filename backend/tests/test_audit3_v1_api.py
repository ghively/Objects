"""Audit 2026-11-07, lane B: the HTTP API and the v1 local API (findings 4, 12, 22-25)."""

from __future__ import annotations

import os
import sys
import threading
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


# -- 12: an empty or blank import-scan path -----------------------------------------------


@pytest.fixture
def client(space_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _env(tmp_path, monkeypatch)
    with TestClient(
        create_app(Space(space_dir), watch=False), raise_server_exceptions=False
    ) as c:
        yield c


@pytest.mark.parametrize("blank", ["", "   ", '""', ' "" '])
def test_blank_scan_path_is_not_the_working_directory(
    client: TestClient, space_dir: Path, tmp_path: Path, monkeypatch, blank: str
):
    cwd = tmp_path / "cwd"
    (cwd / "sub").mkdir(parents=True)
    (cwd / "sub" / "creds.txt").write_text("password = hunter2\n")
    monkeypatch.chdir(cwd)
    r = client.post("/api/import/scan", json={"path": blank})
    assert r.status_code == 404, r.text
    assert r.json() == {"error": "No such file or folder"}
    for scope in ("read", "read-write"):
        h = _bearer(space_dir, scope)
        r = client.post("/api/v1/import/scan", json={"path": blank}, headers=h)
        assert r.status_code in (403, 404), r.text  # 403: a read token may not scan (#24)
        assert "creds.txt" not in r.text
    assert not (space_dir / ".object" / "imports").exists()


# -- 22: two TokenStores on the same file ---------------------------------------------------


def test_token_stores_sharing_a_file_lose_nothing(tmp_path: Path, monkeypatch):
    """Each router makes its own `TokenStore`; their writes must not overwrite each other."""
    from objectapp import tokens as tk

    real_load = tk.TokenStore._load

    def slow_load(self):  # widen the read-modify-write window
        out = real_load(self)
        time.sleep(0.002)
        return out

    monkeypatch.setattr(tk.TokenStore, "_load", slow_load)
    root, state = tmp_path / "space", tmp_path / "state"
    root.mkdir()
    keeper, keeper_secret = TokenStore(root, state).create("keeper", "read")
    stores = [TokenStore(root, state) for _ in range(4)]
    made: list[tuple[str, str]] = []
    errors: list[BaseException] = []
    lock = threading.Lock()

    def churn(store: TokenStore, n: int) -> None:
        try:
            for i in range(n):
                record, secret = store.create(f"t{id(store)}-{i}", "read-write")
                if i % 2:
                    assert store.revoke(record.id)
                else:
                    with lock:
                        made.append((record.id, secret))
                assert store.verify(keeper_secret) is not None
        except BaseException as exc:  # noqa: BLE001 - reported below
            errors.append(exc)

    threads = [
        threading.Thread(target=churn, args=(s, 10)) for s in stores
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    fresh = TokenStore(root, state)
    ids = {t.id for t in fresh.list()}
    assert ids == {keeper.id, *(i for i, _s in made)}
    for _id, secret in made:
        assert fresh.verify(secret) is not None
    assert [p.name for p in state.iterdir()] == ["api-tokens.json"]  # no temp file left
