"""M29 fix pass (back end): regression tests for the whole-milestone review's findings.

Plan ``2026-11-09-m29-synced-facts-and-type-suggestion.md``. Every test runs on a copy of the
synthetic ``space-synced`` fixture.
"""

from __future__ import annotations

import json
import shutil
import threading
from datetime import UTC, datetime
from pathlib import Path

import pytest

from objectapp.space import Space

FIXTURE = Path(__file__).parent / "fixtures" / "space-synced"
NOW = datetime(2026, 11, 9, 8, 0, 0, tzinfo=UTC)

APP01 = "Hosts/APP01.md"
SRV02 = "Hosts/SRV-02.md"
PRINT = "Hosts/Print box.md"


@pytest.fixture
def root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("OBJECT_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("OBJECT_CACHE_DIR", str(tmp_path / "cache"))
    dst = tmp_path / "space"
    shutil.copytree(FIXTURE, dst)
    return dst


def _space(root: Path) -> Space:
    s = Space(root)
    s.clock = lambda: NOW
    return s


def _item(by: str, value: str, values: dict, key: str | None = None) -> dict:
    match: dict = {"by": by, "value": value}
    if key is not None:
        match["key"] = key
    return {"match": match, "values": values}


def _store(root: Path) -> dict:
    return json.loads((root / ".object" / "synced" / "host.json").read_text("utf-8"))


def _id_lines(data: bytes) -> list[bytes]:
    return [line for line in data.splitlines() if line.startswith((b"id:", b"\xef\xbb\xbfid:"))]


# -- finding 1: two concurrent syncs of an id-less object -------------------------------------


@pytest.mark.parametrize("attempt", range(5))
def test_two_threads_on_an_id_less_object_keep_both_keys(root: Path, attempt: int) -> None:
    space = _space(root)
    barrier = threading.Barrier(2)
    outcomes: list = []
    errors: list = []

    def run(values: dict) -> None:
        barrier.wait()
        try:
            outcomes.append(space.sync_facts("host", [_item("title", "Print box", values)], set()))
        except Exception as exc:  # pragma: no cover - reported below
            errors.append(exc)

    threads = [
        threading.Thread(target=run, args=({"lastBoot": "2026-11-08T07:12:00.000Z"},)),
        threading.Thread(target=run, args=({"diskFree": 12},)),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert errors == []
    statuses = [o.results[0].status for o in outcomes]
    details = [o.results[0].detail for o in outcomes]
    assert statuses == ["updated", "updated"], details
    ids = {o.results[0].objectId for o in outcomes}
    assert len(ids) == 1
    (object_id,) = ids
    assert _store(root)[object_id]["values"] == {
        "lastBoot": "2026-11-08T07:12:00.000Z",
        "diskFree": 12,
    }
    data = (root / PRINT).read_bytes()
    assert _id_lines(data) == [f"id: {object_id}".encode()]
    assert sum(len(o.idWrites) for o in outcomes) == 1


def test_the_one_time_id_insert_keeps_crlf_and_bom(root: Path) -> None:
    full = root / SRV02
    original = full.read_bytes()
    assert original.startswith(b"\xef\xbb\xbf") and b"\r\n" in original
    lines = original.split(b"\r\n")
    without = b"\r\n".join(line for line in lines if not line.startswith(b"id:"))
    assert without != original
    full.write_bytes(without)
    space = _space(root)
    outcome = space.sync_facts("host", [_item("title", "SRV-02", {"diskFree": 3})], set())
    assert outcome.results[0].status == "updated"
    after = full.read_bytes()
    assert after.startswith(b"\xef\xbb\xbf---\r\nid: ")
    assert b"\n" not in after.replace(b"\r\n", b"")
    assert after.replace(f"id: {outcome.results[0].objectId}\r\n".encode(), b"", 1) == without
