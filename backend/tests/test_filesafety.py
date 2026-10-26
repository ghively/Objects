"""File-safety under contention: locked files, races with external writers."""

import asyncio
import os
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from objectapp import textfile
from objectapp.server import create_app
from objectapp.space import Space
from objectapp.textfile import atomic_write, create_new, move_no_overwrite, retry_os
from objectapp.watcher import SpaceWatcher

ADA = "People/Ada Lovelace.md"


def test_atomic_write_retries_a_briefly_locked_target(tmp_path: Path, monkeypatch):
    target = tmp_path / "a.md"
    target.write_bytes(b"old")
    real = os.replace
    calls = []

    def flaky(src, dst):
        calls.append(1)
        if len(calls) <= 2:
            raise PermissionError(13, "Access is denied")
        real(src, dst)

    monkeypatch.setattr(textfile.os, "replace", flaky)
    atomic_write(target, b"new")
    assert target.read_bytes() == b"new"
    assert len(calls) == 3
    assert [p.name for p in tmp_path.iterdir()] == ["a.md"]


def test_retry_os_gives_up_and_raises(monkeypatch):
    monkeypatch.setattr(textfile, "RETRY_DELAYS", (0.0, 0.0))

    def locked():
        raise PermissionError(13, "Access is denied")

    with pytest.raises(PermissionError):
        retry_os(locked)


def test_create_new_never_overwrites(tmp_path: Path):
    target = tmp_path / "a.md"
    target.write_bytes(b"theirs")
    with pytest.raises(FileExistsError):
        create_new(target, b"mine")
    assert target.read_bytes() == b"theirs"
    assert [p.name for p in tmp_path.iterdir()] == ["a.md"]


def test_create_new_loses_a_race_with_an_external_writer(tmp_path: Path, monkeypatch):
    """A file created between the temp write and the placement is never replaced."""
    target = tmp_path / "a.md"
    real = textfile._write_temp

    def write_then_race(path, data):
        tmp = real(path, data)
        target.write_bytes(b"external")
        return tmp

    monkeypatch.setattr(textfile, "_write_temp", write_then_race)
    with pytest.raises(FileExistsError):
        create_new(target, b"mine")
    assert target.read_bytes() == b"external"


def test_create_new_writes_a_fresh_file(tmp_path: Path):
    target = tmp_path / "a.md"
    create_new(target, b"mine")
    assert target.read_bytes() == b"mine"
    assert [p.name for p in tmp_path.iterdir()] == ["a.md"]


def test_move_no_overwrite_refuses_an_existing_destination(tmp_path: Path):
    src, dest = tmp_path / "a.md", tmp_path / "b.md"
    src.write_bytes(b"a")
    dest.write_bytes(b"b")
    with pytest.raises(FileExistsError):
        move_no_overwrite(src, dest)
    assert src.read_bytes() == b"a" and dest.read_bytes() == b"b"
    move_no_overwrite(src, tmp_path / "c.md")
    assert not src.exists() and (tmp_path / "c.md").read_bytes() == b"a"


def test_place_keeps_an_existing_file(space_dir: Path):
    space = Space(space_dir)
    before = (space_dir / ADA).read_bytes()
    assert space._place(ADA, b"---\ntitle: X\n---\n") is False
    assert (space_dir / ADA).read_bytes() == before


def test_watcher_reads_only_under_the_space_lock(space_dir: Path):
    """The watcher never holds a file open while a save (which holds the lock) replaces it."""
    space = Space(space_dir)
    loop = asyncio.new_event_loop()
    try:
        watcher = SpaceWatcher(space, loop)
        (space_dir / ADA).write_bytes((space_dir / ADA).read_bytes() + b"\nexternal\n")
        done = threading.Event()
        space._lock.acquire()
        try:
            t = threading.Thread(target=lambda: (watcher._fire(ADA), done.set()), daemon=True)
            t.start()
            time.sleep(0.2)
            assert not done.is_set()
        finally:
            space._lock.release()
        assert done.wait(2)
    finally:
        loop.close()


def test_write_route_maps_a_locked_file_to_503(space_dir: Path, monkeypatch):
    space = Space(space_dir)
    client = TestClient(create_app(space, None, watch=False))
    version = space.read(ADA)[2]

    def locked(*_a, **_k):
        raise PermissionError(13, "Access is denied")

    monkeypatch.setattr(space, "save_body", locked)
    r = client.put("/api/object/body", json={"path": ADA, "body": "x", "baseVersion": version})
    assert r.status_code == 503
    assert "in use" in r.json()["detail"]


def test_rename_keeps_the_title_when_the_file_cannot_move(space_dir: Path, monkeypatch):
    space = Space(space_dir)
    version = space.read(ADA)[2]

    def locked(*_a, **_k):
        raise PermissionError(32, "The process cannot access the file")

    monkeypatch.setattr(space, "_move_file", locked)
    result = space.rename_object(ADA, "Ada King", version)
    assert result.path == ADA
    _of, fm, now = space.read(ADA)
    assert fm["title"] == "Ada King"
    assert result.version == now
