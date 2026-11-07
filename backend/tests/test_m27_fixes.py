"""M27 fix pass: re-run matching, scan choices over MCP, filing safety, batch trash, re-run side effects."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from m15_helpers import wait_job
from test_m25_provenance import blocks, fake_readers, run

from objectapp.server import create_app
from objectapp.space import Space


@pytest.fixture
def client(space_dir):
    app = create_app(Space(space_dir), watch=False)
    with TestClient(app) as c:
        c.space_root = space_dir  # type: ignore[attr-defined]
        yield c


def vault(tmp_path: Path, name: str, text: str) -> Path:
    v = tmp_path / name
    (v / "Notes").mkdir(parents=True)
    (v / "Notes" / "Meeting.md").write_text(f"# Meeting\n\n{text}\n", encoding="utf-8")
    return v


# -- 1. re-run matching knows which source an object came from ------------------------------------


def test_same_relative_path_in_another_source_is_a_new_object(client, tmp_path):
    a, b = vault(tmp_path, "VaultA", "from A"), vault(tmp_path, "VaultB", "from B")
    root = client.space_root
    first = run(client, a)["result"]
    second = run(client, b)["result"]
    assert first["objects"] == 1 and second["objects"] == 1 and second["updated"] == 0 and second["changedInBoth"] == 0
    texts = sorted((root / r).read_text(encoding="utf-8") for r in blocks(root))
    assert any("from A" in t for t in texts) and any("from B" in t for t in texts)
    # Each source still re-runs onto its own object.
    again = run(client, a)["result"]
    assert again["unchanged"] == 1 and again["objects"] == 0


def test_two_manifest_rows_with_one_id_are_not_collapsed(client, tmp_path, monkeypatch):
    fake_readers(monkeypatch)
    src = tmp_path / "Lib"
    src.mkdir()
    (src / "One.txt").write_text("first file\n", encoding="utf-8")
    (src / "Two.txt").write_text("second file\n", encoding="utf-8")
    rows = [{"path": "One.txt", "system": "sharepoint", "id": "SAME", "url": "https://sp.example/1"},
            {"path": "Two.txt", "system": "sharepoint", "id": "SAME", "url": "https://sp.example/2"}]
    (src / "_manifest.jsonl").write_text("\n".join(json.dumps(x) for x in rows) + "\n", encoding="utf-8")
    root = client.space_root
    first = run(client, src)["result"]
    assert first["objects"] == 2
    report = (root / first["reportPath"]).read_text(encoding="utf-8")
    assert "same id" in report.lower() and "Two.txt" in report
    ids = [b["id"] for b in blocks(root).values()]
    assert len(set(ids)) == 2
    second = run(client, src)["result"]
    assert second["unchanged"] == 2 and second["objects"] == 0 and second["updated"] == 0
