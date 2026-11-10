"""M31 item 15c: Settings > Offline & Sync: Local Storage (size estimate) and Clear media cache."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from objectapp import api_storage
from objectapp.appstate import space_key
from objectapp.searchindex import cache_dir_for
from objectapp.server import create_app
from objectapp.space import Space


def _tree(root: Path) -> dict[str, str]:
    out = {}
    for p in sorted(root.rglob("*")):
        rel = p.relative_to(root).as_posix()
        out[rel] = hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() and not p.is_symlink() else "dir"
    return out


@pytest.fixture
def space(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    root = tmp_path / "space"
    (root / "Pages").mkdir(parents=True)
    (root / "Attachments").mkdir()
    (root / "Pages" / "A.md").write_bytes(b"# A\n" + b"x" * 96)  # 100 bytes
    (root / "Attachments" / "pic.png").write_bytes(b"p" * 1000)
    return root


def _files(root: Path, skip: str | None = None) -> dict[str, int]:
    """{bytes, files} of the regular files under root (Space() adds its basic types to .object/)."""
    found = [
        p
        for p in root.rglob("*")
        if p.is_file() and not p.is_symlink() and not (skip and p.relative_to(root).parts[0] == skip)
    ]
    return {"bytes": sum(p.stat().st_size for p in found), "files": len(found)}


def _client(root: Path) -> TestClient:
    return TestClient(create_app(Space(root), watch=False))


def test_storage_estimate_counts_the_space_cache_and_state(space: Path, tmp_path: Path):
    client = _client(space)
    cache = cache_dir_for(Space(space))
    cache.mkdir(parents=True, exist_ok=True)
    (cache / "extra.bin").write_bytes(b"c" * 500)
    state = tmp_path / "state"
    state.mkdir(exist_ok=True)
    (state / f"reminders-{space_key(space)}.json").write_bytes(b"r" * 30)
    (state / "reminders-someotherspace.json").write_bytes(b"o" * 7000)  # another space's: not counted
    before = _tree(space)

    res = client.get("/api/storage")
    assert res.status_code == 200
    body = res.json()
    assert body["space"] == _files(space)
    assert body["space"]["bytes"] >= 1100
    assert body["cache"]["bytes"] >= 500 and body["cache"]["files"] >= 1
    assert body["state"] == {"bytes": 30, "files": 1}
    assert body["total"] == body["space"]["bytes"] + body["cache"]["bytes"] + body["state"]["bytes"]
    assert body["cacheFolder"] == str(cache)
    # Never writes on read.
    assert _tree(space) == before


def test_storage_estimate_leaves_the_cache_out_of_the_space(space: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("OBJECT_CACHE_DIR", raising=False)
    cache = space / ".object-cache"
    cache.mkdir()
    (cache / "search.db").write_bytes(b"s" * 4000)
    body = api_storage.storage_estimate(Space(space))
    assert body["space"] == _files(space, skip=".object-cache")
    assert body["cache"] == {"bytes": 4000, "files": 1}


def test_storage_estimate_counts_saved_versions(space: Path, tmp_path: Path):
    from objectapp.history import HistoryStore

    folder = HistoryStore(space).dir
    folder.mkdir(parents=True)
    (folder / "v1.gz").write_bytes(b"h" * 250)
    body = api_storage.storage_estimate(Space(space))
    assert body["state"] == {"bytes": 250, "files": 1}


def test_storage_estimate_skips_symlinks(space: Path, tmp_path: Path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "big.bin").write_bytes(b"b" * 9000)
    try:
        os.symlink(outside, space / "Linked", target_is_directory=True)
    except OSError:
        pytest.skip("no symlinks here")
    body = api_storage.storage_estimate(Space(space))
    assert body["space"]["bytes"] < 9000


def test_clear_media_cache_removes_only_the_media_parts(space: Path):
    client = _client(space)
    cache = cache_dir_for(Space(space))
    (cache / "media").mkdir(parents=True)
    (cache / "thumbnails" / "sub").mkdir(parents=True)
    (cache / "media" / "a.jpg").write_bytes(b"a" * 300)
    (cache / "thumbnails" / "sub" / "b.png").write_bytes(b"b" * 200)
    (cache / "search.db").write_bytes(b"s" * 50)
    before = _tree(space)

    res = client.post("/api/storage/clear-media-cache")
    assert res.status_code == 200
    assert res.json() == {"files": 2, "bytes": 500}
    assert not (cache / "media").exists()
    assert not (cache / "thumbnails").exists()
    assert (cache / "search.db").read_bytes() == b"s" * 50
    assert _tree(space) == before  # content is never touched

    # Nothing left: nothing freed.
    assert client.post("/api/storage/clear-media-cache").json() == {"files": 0, "bytes": 0}


def test_clear_media_cache_never_follows_a_link(space: Path, tmp_path: Path):
    cache = cache_dir_for(Space(space))
    cache.mkdir(parents=True, exist_ok=True)
    keep = tmp_path / "keep"
    keep.mkdir()
    (keep / "precious.jpg").write_bytes(b"k" * 10)
    try:
        os.symlink(keep, cache / "media", target_is_directory=True)
    except OSError:
        pytest.skip("no symlinks here")
    assert api_storage.clear_media_cache(cache) == {"files": 0, "bytes": 0}
    assert (keep / "precious.jpg").read_bytes() == b"k" * 10
    assert not (cache / "media").exists()  # the link itself is gone
