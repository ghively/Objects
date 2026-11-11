"""M32 fix pass, item 13: a note with no ``lastUpdated`` and no ``createdAt`` is in Home's Recent.

A ``.md`` put into the folder by hand or by another tool has neither stamp, so the Notes list and
Home's Recent had nothing to sort it by. In the summaries the app's lists read (``GET
/api/objects``, and the ``summary`` of ``GET /api/object``), such a note's ``lastUpdated`` now
reads as the file's modification time, in the UTC text form of Object's own stamps. Nothing is
written to the file for it, and a note that has either stamp is unchanged. Synthetic data only.
"""

from __future__ import annotations

import os
import re
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.server import create_app
from objectapp.space import Space, now_stamp
from objectapp.spaces import create_space

STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
WHEN = datetime(2026, 3, 4, 5, 6, 7, 890000, tzinfo=UTC)


def _put(root: Path, rel: str, text: str, when: datetime = WHEN) -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, "utf-8", newline="\n")
    ns = int(when.timestamp() * 1000) * 1_000_000
    os.utime(path, ns=(ns, ns))


def _stat(root: Path, rel: str) -> tuple[bytes, int]:
    return (root / rel).read_bytes(), (root / rel).stat().st_mtime_ns


@pytest.fixture
def root(tmp_path: Path) -> Path:
    root = create_space("Notes", tmp_path)
    _put(root, "Pages/By hand.md", "---\ntype: 'Page'\ntitle: 'By hand'\n---\nDropped in.\n")
    _put(root, "Pages/No front matter.md", "Just text.\n", datetime(2026, 3, 5, 0, 0, tzinfo=UTC))
    _put(root, "Pages/Stamped.md",
         "---\ntype: 'Page'\ntitle: 'Stamped'\ncreatedAt: 2026-01-01T00:00:00.000Z\n"
         "lastUpdated: 2026-01-02T00:00:00.000Z\n---\n")
    _put(root, "Pages/Created only.md",
         "---\ntype: 'Page'\ntitle: 'Created only'\ncreatedAt: 2026-01-03T00:00:00.000Z\n---\n")
    return root


@pytest.fixture
def c(root: Path):
    space = Space(root)
    with TestClient(
        create_app(space, None, watch=False), base_url="http://127.0.0.1", client=("127.0.0.1", 50000)
    ) as client:
        client.space = space  # type: ignore[attr-defined]
        yield client


def _listed(c: TestClient, **params) -> dict[str, dict]:
    return {o["path"]: o for o in c.get("/api/objects", params=params).json()}


def test_a_note_with_no_stamp_reads_its_file_time(c: TestClient, root: Path):
    before = {rel: _stat(root, rel) for rel in ("Pages/By hand.md", "Pages/No front matter.md")}
    listed = _listed(c)
    hand = listed["Pages/By hand.md"]
    assert hand["lastUpdated"] == now_stamp(WHEN) == "2026-03-04T05:06:07.890Z"
    assert STAMP.match(hand["lastUpdated"]) and hand["createdAt"] is None
    assert listed["Pages/No front matter.md"]["lastUpdated"] == "2026-03-05T00:00:00.000Z"
    # by type too, and the one note's own summary agrees with the list
    assert _listed(c, type="page")["Pages/By hand.md"]["lastUpdated"] == hand["lastUpdated"]
    one = c.get("/api/object", params={"path": "Pages/By hand.md"}).json()
    assert one["summary"]["lastUpdated"] == hand["lastUpdated"]
    assert "lastUpdated" not in one["frontmatter"]  # the file's own values are as they are
    # read only: the bytes and the file's time are as they were
    assert {rel: _stat(root, rel) for rel in before} == before


def test_a_note_that_has_a_stamp_is_unchanged(c: TestClient):
    listed = _listed(c)
    stamped = listed["Pages/Stamped.md"]
    assert (stamped["createdAt"], stamped["lastUpdated"]) == ("2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z")
    created = listed["Pages/Created only.md"]
    assert created["createdAt"] == "2026-01-03T00:00:00.000Z" and created["lastUpdated"] is None


def test_the_text_sorts_with_objects_own_stamps(c: TestClient):
    listed = _listed(c)
    edited = lambda o: o["lastUpdated"] or o["createdAt"] or ""  # noqa: E731 (the client's `editedAt`)
    order = sorted((o for o in listed.values() if o["path"].startswith("Pages/")), key=edited, reverse=True)
    assert [o["title"] for o in order] == ["No front matter", "By hand", "Created only", "Stamped"]


def test_the_file_time_follows_the_file_and_gives_way_to_a_real_stamp(c: TestClient, root: Path):
    rel = "Pages/By hand.md"
    later = datetime(2026, 4, 1, 12, 0, tzinfo=UTC)
    _put(root, rel, "---\ntype: 'Page'\ntitle: 'By hand'\n---\nEdited outside.\n", later)
    space = _space(c)
    space.rescan_file(rel)  # (the watcher does this in the app)
    assert _listed(c)[rel]["lastUpdated"] == "2026-04-01T12:00:00.000Z"
    # edited in Object: the write stamps the note, and that stamp is the answer from then on
    o = c.get("/api/object", params={"path": rel}).json()
    r = c.put("/api/object/properties",
              json={"path": rel, "updates": {"description": "mine now"}, "remove": [], "baseVersion": o["version"]})
    assert r.status_code == 200
    fm = c.get("/api/object", params={"path": rel}).json()["frontmatter"]
    assert _listed(c)[rel]["lastUpdated"] == fm["lastUpdated"] != "2026-04-01T12:00:00.000Z"
    # deleted outside: nothing is left behind for it
    (root / rel).unlink()
    space.rescan_file(rel)
    assert rel not in _listed(c) and rel not in space.file_times


def test_what_the_space_itself_holds_is_as_before(c: TestClient):
    """Only the summaries the app's lists read change: the space's own summary (saved searches,
    formulas, ``/api/v1``) and the rows keep an empty ``lastUpdated`` for such a note."""
    space = _space(c)
    assert space.get("Pages/By hand.md").lastUpdated is None
    rows = c.post("/api/rows", json={"typeIds": ["page"]}).json()["rows"]
    row = next(r for r in rows if r["summary"]["path"] == "Pages/By hand.md")
    assert not row["values"].get("lastUpdated") and row["summary"]["lastUpdated"] is None


def _space(c: TestClient) -> Space:
    return c.space  # type: ignore[attr-defined]
