"""Linking an unlinked mention: one stamped write of only the mention (M5 Task 4)."""

from __future__ import annotations

import difflib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp.propvalues import InvalidValue
from objectapp.references import TEXT_CHANGED, link_mention, unlinked_mentions
from objectapp.searchindex import SearchIndex
from objectapp.server import create_app
from objectapp.space import Conflict, ReadOnly, Space, version_of

ADA = "People/Ada Lovelace.md"
ENGINE = "Pages/Analytical Engine.md"
NOTES = "Pages/Notes on mentions.md"
CRLF = "Pages/CRLF mention.md"
BROKEN = "Pages/Broken.md"
ARCHIVE_MENTION = "Archive/Mention from archive.md"


@pytest.fixture
def links(links_space_dir: Path, tmp_path: Path):
    space = Space(links_space_dir)
    idx = SearchIndex(space, tmp_path / "cache")
    idx.start()
    assert idx.ready.wait(30)
    yield space, idx
    idx.stop()


def _occurrences(
    space: Space, idx: SearchIndex, target: str, path: str
) -> tuple[str, list[dict]]:
    for e in unlinked_mentions(space, idx, target):
        if e["path"] == path:
            return e["version"], e["occurrences"]
    raise AssertionError(f"{path} doesn't mention {target}")


def _changed_lines(before: bytes, after: bytes) -> list[str]:
    a = before.decode("utf-8").splitlines(keepends=True)
    b = after.decode("utf-8").splitlines(keepends=True)
    return [
        line
        for line in difflib.unified_diff(a, b, n=0)
        if line[:1] in "+-" and not line.startswith(("+++", "---"))
    ]


def test_link_mention_changes_only_span(links, links_space_dir: Path):
    space, idx = links
    path = links_space_dir / NOTES
    before = path.read_bytes()
    version, occ = _occurrences(space, idx, ENGINE, NOTES)
    first = occ[0]
    new = link_mention(
        space, NOTES, ENGINE, first["start"], first["end"], first["text"], version
    )
    after = path.read_bytes()
    assert new == version_of(after) != version
    changed = _changed_lines(before, after)
    assert changed == [
        "-lastUpdated: 2026-02-02T09:00:00.000Z\n",
        changed[1],
        "-Analytical Engine was never completed.\n",
        "+[[Analytical Engine]] was never completed.\n",
    ]
    assert changed[1].startswith("+lastUpdated: ")
    # The lowercase occurrence gets the alias form.
    version, occ = _occurrences(space, idx, ENGINE, NOTES)
    (low,) = [o for o in occ if o["text"] == "analytical engine"]
    before = after
    link_mention(space, NOTES, ENGINE, low["start"], low["end"], low["text"], version)
    after = path.read_bytes()
    body_lines = [
        line for line in _changed_lines(before, after) if "lastUpdated" not in line
    ]
    assert body_lines == [
        "-Many people still write about the analytical engine today.\n",
        "+Many people still write about the [[Analytical Engine|analytical engine]] today.\n",
    ]
    # Both are links now; no unlinked mention is left in that object.
    assert NOTES not in [e["path"] for e in unlinked_mentions(space, idx, ENGINE)]


def test_link_mention_crlf_bom_kept(links, links_space_dir: Path):
    space, idx = links
    path = links_space_dir / CRLF
    before = path.read_bytes()
    version, (occ,) = _occurrences(space, idx, ENGINE, CRLF)
    link_mention(space, CRLF, ENGINE, occ["start"], occ["end"], occ["text"], version)
    after = path.read_bytes()
    assert after.startswith(b"\xef\xbb\xbf")
    assert after.count(b"\r\n") == before.count(b"\r\n")
    assert b"\n" not in after.replace(b"\r\n", b"")
    expected = before.replace(
        b"the Analytical Engine once", b"the [[Analytical Engine]] once"
    )
    old_lines = expected.split(b"\r\n")
    new_lines = after.split(b"\r\n")
    assert len(old_lines) == len(new_lines)
    diff = [
        i for i, (a, b) in enumerate(zip(old_lines, new_lines, strict=True)) if a != b
    ]
    assert len(diff) == 1 and new_lines[diff[0]].startswith(b"lastUpdated: ")


def test_link_mention_uses_alias_form_when_needed(links, links_space_dir: Path):
    space, idx = links
    # From Archive/, "Ada Lovelace" resolves to the Archive page, so the link to the
    # Person needs the path form.
    assert space.resolve("Ada Lovelace", ARCHIVE_MENTION) == "Archive/Ada Lovelace.md"
    version, (occ,) = _occurrences(space, idx, ADA, ARCHIVE_MENTION)
    link_mention(
        space, ARCHIVE_MENTION, ADA, occ["start"], occ["end"], occ["text"], version
    )
    text = (links_space_dir / ARCHIVE_MENTION).read_text("utf-8")
    assert "talks about [[People/Ada Lovelace|Ada Lovelace]] without" in text
    assert ARCHIVE_MENTION in [b for b in space.links.backlinks(ADA)]
    assert ARCHIVE_MENTION not in space.links.backlinks("Archive/Ada Lovelace.md")


def test_link_mention_alias_text(links, links_space_dir: Path):
    space, idx = links
    version, (occ,) = _occurrences(space, idx, ADA, ENGINE)
    assert occ["text"] == "ada"
    link_mention(space, ENGINE, ADA, occ["start"], occ["end"], occ["text"], version)
    assert "called her [[Ada Lovelace|ada]] at home" in (
        links_space_dir / ENGINE
    ).read_text("utf-8")


def test_link_mention_stale_409(links, links_space_dir: Path):
    space, idx = links
    version, occ = _occurrences(space, idx, ENGINE, NOTES)
    before = (links_space_dir / NOTES).read_bytes()
    with pytest.raises(Conflict):
        link_mention(
            space,
            NOTES,
            ENGINE,
            occ[0]["start"],
            occ[0]["end"],
            occ[0]["text"],
            "0" * 64,
        )
    assert (links_space_dir / NOTES).read_bytes() == before
    assert version == version_of(before)


def test_link_mention_text_changed_422(links, links_space_dir: Path):
    space, idx = links
    version, occ = _occurrences(space, idx, ENGINE, NOTES)
    before = (links_space_dir / NOTES).read_bytes()
    o = occ[0]
    with pytest.raises(InvalidValue, match=TEXT_CHANGED):
        link_mention(
            space, NOTES, ENGINE, o["start"] + 1, o["end"] + 1, o["text"], version
        )
    with pytest.raises(InvalidValue):
        link_mention(
            space, NOTES, ENGINE, o["start"], o["end"], "Difference Engine", version
        )
    with pytest.raises(InvalidValue):
        link_mention(
            space, NOTES, "Pages/Nobody.md", o["start"], o["end"], o["text"], version
        )
    with pytest.raises(InvalidValue):
        link_mention(space, NOTES, NOTES, o["start"], o["end"], o["text"], version)
    assert (links_space_dir / NOTES).read_bytes() == before


def test_link_mention_inside_link_or_code_422(links, links_space_dir: Path):
    space, _idx = links
    raw = space._raw[NOTES]
    body = raw.of.body
    version = version_of(raw.data)
    before = (links_space_dir / NOTES).read_bytes()
    for marker in (
        "[Analytical Engine](",
        "`Analytical Engine`",
        "[[Analytical Engine]]",
    ):
        at = body.index(marker) + marker.index("Analytical")
        with pytest.raises(InvalidValue):
            link_mention(
                space, NOTES, ENGINE, at, at + 17, "Analytical Engine", version
            )
    # Not a whole word: "Analytical Engines".
    at = body.index("Analytical Engines")
    with pytest.raises(InvalidValue):
        link_mention(space, NOTES, ENGINE, at, at + 17, "Analytical Engine", version)
    assert (links_space_dir / NOTES).read_bytes() == before


def test_link_mention_readonly_423(links, links_space_dir: Path):
    space, idx = links
    p = links_space_dir / BROKEN
    p.write_bytes(p.read_bytes() + b"\nThe Analytical Engine again.\n")
    space.rescan_file(BROKEN)
    version, (occ,) = _occurrences(space, idx, ENGINE, BROKEN)
    before = p.read_bytes()
    with pytest.raises(ReadOnly):
        link_mention(
            space, BROKEN, ENGINE, occ["start"], occ["end"], occ["text"], version
        )
    assert p.read_bytes() == before


# -- the route ---------------------------------------------------------------------


def _client(root: Path):
    space = Space(root)
    app = create_app(space, None, watch=False)
    events: list = []
    app.state.hub.publish = events.append
    return space, app, TestClient(app), events


def test_link_route_announces_changed(links_space_dir: Path):
    _space, app, c, events = _client(links_space_dir)
    with c:
        assert app.state.search.ready.wait(30)
        mentions = c.get("/api/references", params={"path": ENGINE}).json()["mentions"]
        (entry,) = [e for e in mentions if e["path"] == NOTES]
        o = entry["occurrences"][0]
        req = {
            "path": NOTES,
            "target": ENGINE,
            "start": o["start"],
            "end": o["end"],
            "text": o["text"],
            "baseVersion": entry["version"],
            "clientId": "client-1",
        }
        r = c.post("/api/references/link", json=req)
        assert r.status_code == 200
        version = r.json()["version"]
        assert version == version_of((links_space_dir / NOTES).read_bytes())
        # The announce runs on the event loop thread; wait for it via another request.
        c.get("/api/space")
        changed = [e for e in events if e.kind == "changed" and e.path == NOTES]
        assert (
            changed
            and changed[-1].version == version
            and changed[-1].origin == "client-1"
        )
        # Stale now: 409 with the current version.
        r = c.post("/api/references/link", json=req)
        assert r.status_code == 409 and r.json() == {"currentVersion": version}
        # Fresh version, but the text has moved: 422.
        r = c.post("/api/references/link", json={**req, "baseVersion": version})
        assert r.status_code == 422
        assert (
            c.post(
                "/api/references/link", json={**req, "path": "Pages/Nope.md"}
            ).status_code
            == 404
        )
        assert (
            c.post("/api/references/link", json={**req, "path": "../x.md"}).status_code
            == 400
        )


def test_link_route_readonly_423(links_space_dir: Path):
    p = links_space_dir / BROKEN
    p.write_bytes(p.read_bytes() + b"\nThe Analytical Engine again.\n")
    _space, app, c, _events = _client(links_space_dir)
    with c:
        assert app.state.search.ready.wait(30)
        mentions = c.get("/api/references", params={"path": ENGINE}).json()["mentions"]
        (entry,) = [e for e in mentions if e["path"] == BROKEN]
        o = entry["occurrences"][0]
        r = c.post(
            "/api/references/link",
            json={
                "path": BROKEN,
                "target": ENGINE,
                "start": o["start"],
                "end": o["end"],
                "text": o["text"],
                "baseVersion": entry["version"],
            },
        )
        assert r.status_code == 423
