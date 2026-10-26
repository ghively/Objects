"""Title edit and rename with minimal relinking (Task 7)."""

import difflib
import re
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from objectapp import space as space_mod
from objectapp.propvalues import InvalidValue
from objectapp.relink import relink_frontmatter, replace_wikilinks, wikilink_targets
from objectapp.server import create_app
from objectapp.space import Conflict, Space, version_of

_ID_RE = re.compile(r"[0-9A-HJKMNP-TV-Z]{26}")
_STAMP_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z")

ADA = "People/Ada Lovelace.md"


def _changed_lines(before: bytes, after: bytes) -> tuple[list[str], list[str]]:
    old = before.decode().splitlines(keepends=True)
    new = after.decode().splitlines(keepends=True)
    diff = [d for d in difflib.ndiff(old, new) if d.startswith(("+ ", "- "))]
    return [d[2:] for d in diff if d.startswith("- ")], [d[2:] for d in diff if d.startswith("+ ")]


def _version(space: Space, path: str) -> str:
    return space.read(path)[2]


def _rename_ada(space: Space, title: str = "Ada King"):
    return space.rename_object(ADA, title, _version(space, ADA))


# -- the renamed object ------------------------------------------------------------


def test_rename_moves_file_updates_title_and_heading(space_dir: Path):
    space = Space(space_dir)
    result = _rename_ada(space)

    assert result.path == "People/Ada King.md"
    assert not (space_dir / ADA).exists()
    after = (space_dir / "People" / "Ada King.md").read_bytes()
    assert result.version == version_of(after)
    text = after.decode()
    assert "title: Ada King\n" in text
    assert "\n# Ada King\n" in text and "# Ada Lovelace" not in text
    assert text.startswith("---\nid: ")
    assert _ID_RE.search(text.splitlines()[1])
    assert "lastUpdated: 2026-01-10T08:00:00.000Z" not in text
    assert _STAMP_RE.search(text.split("lastUpdated: ", 1)[1])
    summary = space.get("People/Ada King.md")
    assert summary.title == "Ada King"
    with pytest.raises(KeyError):
        space.get(ADA)
    assert space.resolve("Ada King", None) == "People/Ada King.md"


def test_rename_no_frontmatter_creates_fence(space_dir: Path):
    space = Space(space_dir)
    notes = "Pages/Notes.md"
    result = space.rename_object(notes, "Standup notes", _version(space, notes))

    assert result.path == "Pages/Standup notes.md"
    assert not (space_dir / "Pages" / "Notes.md").exists()
    text = (space_dir / "Pages" / "Standup notes.md").read_bytes().decode()
    text = _ID_RE.sub("<ulid>", text, count=1)
    text = _STAMP_RE.sub("<t>", text, count=1)
    assert text == (
        "---\nid: <ulid>\ntitle: Standup notes\nlastUpdated: <t>\n---\n"
        "# Standup notes\n\nNo frontmatter here. Mentions [[Alpha]].\n"
    )


def test_rename_case_only_keeps_path_without_suffix(space_dir: Path):
    space = Space(space_dir)
    result = _rename_ada(space, "Ada lovelace")

    assert result.path == "People/Ada lovelace.md"
    names = [p.name for p in (space_dir / "People").iterdir()]
    assert names == ["Ada lovelace.md"]
    assert [s.path for s in space.list() if s.path.startswith("People/")] == [
        "People/Ada lovelace.md"
    ]
    assert "title: Ada lovelace\n" in (space_dir / "People" / "Ada lovelace.md").read_text()
    # The referrers now say [[Ada lovelace]].
    assert "[[Ada lovelace]]" in (space_dir / "Tasks" / "Write docs.md").read_text()


def test_rename_collision_suffix(space_dir: Path):
    (space_dir / "People" / "Ada King.md").write_bytes(
        b"---\ntype: 'Person'\ntitle: Ada King\ncreatedAt: 2025-05-01T00:00:00.000Z\n---\n"
    )
    other = (space_dir / "People" / "Ada King.md").read_bytes()
    space = Space(space_dir)
    result = _rename_ada(space)

    assert result.path == "People/Ada King (2).md"
    assert (space_dir / "People" / "Ada King.md").read_bytes() == other
    assert "title: Ada King\n" in (space_dir / "People" / "Ada King (2).md").read_text()
    # The referrer can't say [[Ada King]] (that is the other one): it uses the path form.
    assert "[[People/Ada King (2)]]" in (space_dir / "Tasks" / "Write docs.md").read_text()
    assert space.resolve("People/Ada King (2)", "Tasks/Write docs.md") == result.path


def test_rename_same_title_noop(space_dir: Path):
    space = Space(space_dir)
    target = space_dir / ADA
    before = (target.read_bytes(), target.stat().st_mtime_ns)
    version = version_of(before[0])

    result = space.rename_object(ADA, "  Ada Lovelace ", version)

    assert (result.path, result.version, result.relinked, result.skipped) == (ADA, version, [], [])
    assert (target.read_bytes(), target.stat().st_mtime_ns) == before


def test_dailynote_title_locked_422(space_dir: Path):
    space = Space(space_dir)
    path = "DailyNotes/2026-10-23.md"
    before = (space_dir / path).read_bytes()
    with pytest.raises(InvalidValue):
        space.rename_object(path, "Something else", version_of(before))
    with pytest.raises(InvalidValue):
        space.rename_object(ADA, "   ", _version(space, ADA))
    assert (space_dir / path).read_bytes() == before


def test_rename_stale_409(space_dir: Path):
    space = Space(space_dir)
    target = space_dir / ADA
    before = target.read_bytes()
    referrer = (space_dir / "Tasks" / "Write docs.md").read_bytes()
    with pytest.raises(Conflict) as exc:
        space.rename_object(ADA, "Ada King", "0" * 64)
    assert exc.value.current_version == version_of(before)
    assert target.read_bytes() == before
    assert not (space_dir / "People" / "Ada King.md").exists()
    assert (space_dir / "Tasks" / "Write docs.md").read_bytes() == referrer


# -- relinking ---------------------------------------------------------------------


def test_rename_relinks_only_link_lines(space_dir: Path):
    space = Space(space_dir)
    docs = space_dir / "Tasks" / "Write docs.md"
    alpha = space_dir / "Servers" / "Alpha.md"
    docs_before, alpha_before = docs.read_bytes(), alpha.read_bytes()

    result = _rename_ada(space)

    removed, added = _changed_lines(docs_before, docs.read_bytes())
    assert removed == ["Write the user guide. See [[Ada Lovelace]].\n"]
    assert added == ["Write the user guide. See [[Ada King]].\n"]
    removed, added = _changed_lines(alpha_before, alpha.read_bytes())
    assert sorted(removed) == ["Owner: [[Ada Lovelace]]\n", "owner: '[[Ada Lovelace]]'\n"]
    assert sorted(added) == ["Owner: [[Ada King]]\n", "owner: '[[Ada King]]'\n"]
    assert result.relinked == ["Servers/Alpha.md", "Tasks/Write docs.md"]
    assert result.skipped == []
    assert space.links_of("Servers/Alpha.md", space.read("Servers/Alpha.md")[1])["owner"] == [
        "People/Ada King.md"
    ]


def test_rename_relinks_list_item_keeps_quotes(space_dir: Path):
    pages = space_dir / "Pages"
    (pages / "Flow.md").write_bytes(
        b"---\ntype: 'Page'\ntitle: Flow\n"
        b"members: ['[[Ada Lovelace]]', \"[[Alpha]]\", '[[X]]']\n---\n\nBody.\n"
    )
    (pages / "Block.md").write_bytes(
        b"---\ntype: 'Page'\ntitle: Block\nmembers:\n  - '[[X]]'\n  - '[[Ada Lovelace]]'\n"
        b'  - "[[Alpha]]"\n---\n\nBody.\n'
    )
    (pages / "Literal.md").write_bytes(
        b"---\ntype: 'Page'\ntitle: Literal\nnotes: |-\n  First line.\n"
        b"  Met [[Ada Lovelace]] today.\n  Last line.\n---\n\nBody.\n"
    )
    befores = {p: (pages / p).read_bytes() for p in ("Flow.md", "Block.md", "Literal.md")}
    space = Space(space_dir)

    result = _rename_ada(space)

    assert (pages / "Flow.md").read_bytes() == befores["Flow.md"].replace(
        b"members: ['[[Ada Lovelace]]', \"[[Alpha]]\", '[[X]]']",
        b"members: ['[[Ada King]]', \"[[Alpha]]\", '[[X]]']",
    )
    assert _changed_lines(befores["Block.md"], (pages / "Block.md").read_bytes()) == (
        ["  - '[[Ada Lovelace]]'\n"],
        ["  - '[[Ada King]]'\n"],
    )
    assert _changed_lines(befores["Literal.md"], (pages / "Literal.md").read_bytes()) == (
        ["  Met [[Ada Lovelace]] today.\n"],
        ["  Met [[Ada King]] today.\n"],
    )
    assert {"Pages/Flow.md", "Pages/Block.md", "Pages/Literal.md"} <= set(result.relinked)


def test_rename_keeps_alias_and_heading_suffix(space_dir: Path):
    ref = space_dir / "Pages" / "Ref.md"
    ref.write_bytes(
        b"---\ntype: 'Page'\ntitle: Ref\n---\n\n"
        b"See [[Ada Lovelace|Ada L]] and [[Ada Lovelace#Life]] and [[ada lovelace]].\n"
    )
    space = Space(space_dir)
    _rename_ada(space)
    assert (
        ref.read_bytes()
        .decode()
        .endswith("See [[Ada King|Ada L]] and [[Ada King#Life]] and [[Ada King]].\n")
    )


@pytest.mark.parametrize(
    ("title", "stem"),
    [("Ada [x]", "Ada x"), ("Ada #1", "Ada 1"), ("Ada|B", "Ada"), ("Ada: K's #1", "Ada")],
)
def test_rename_to_a_link_breaking_title_uses_the_path_form(space_dir: Path, title, stem):
    ref = space_dir / "Pages" / "Ref.md"
    ref.write_bytes(b"---\ntype: 'Page'\ntitle: Ref\n---\n\nSee [[Ada Lovelace#Life]].\n")
    space = Space(space_dir)
    result = _rename_ada(space, title)

    assert result.path == f"People/{stem}.md"
    assert space.get(result.path).title == title
    for referrer in ("Tasks/Write docs.md", "Servers/Alpha.md", "Pages/Ref.md"):
        text = (space_dir / referrer).read_text(encoding="utf-8")
        assert f"[[People/{stem}" in text
        for target in wikilink_targets(text):
            if target.startswith("People/"):
                assert space.resolve(target, referrer) == result.path
    assert f"[[People/{stem}#Life]]" in ref.read_text(encoding="utf-8")


def test_rename_skips_links_to_colliding_title(space_dir: Path):
    notes = space_dir / "Pages" / "Notes.md"
    before = notes.read_bytes()
    page_alpha = (space_dir / "Pages" / "Alpha.md").read_bytes()
    space = Space(space_dir)

    result = space.rename_object(
        "Servers/Alpha.md", "Alpha One", _version(space, "Servers/Alpha.md")
    )

    assert result.path == "Servers/Alpha One.md"
    assert notes.read_bytes() == before
    assert (space_dir / "Pages" / "Alpha.md").read_bytes() == page_alpha
    assert "Pages/Notes.md" not in result.relinked
    assert space.resolve("Alpha", "Pages/Notes.md") == "Pages/Alpha.md"


def test_rename_leaves_alias_references(space_dir: Path):
    ref = space_dir / "Pages" / "Ref.md"
    ref.write_bytes(b"---\ntype: 'Page'\ntitle: Ref\n---\n\n[[Ada]] and [[Countess of Lovelace]]\n")
    before = ref.read_bytes()
    space = Space(space_dir)

    result = _rename_ada(space)

    assert ref.read_bytes() == before
    assert "Pages/Ref.md" not in result.relinked
    assert space.resolve("Ada", "Pages/Ref.md") == "People/Ada King.md"
    assert space.resolve("Countess of Lovelace", "Pages/Ref.md") == "People/Ada King.md"


def test_rename_skips_code_spans(space_dir: Path):
    ref = space_dir / "Pages" / "Code.md"
    ref.write_bytes(
        b"---\ntype: 'Page'\ntitle: Code\n---\n\n"
        b"Inline `[[Ada Lovelace]]` and ``a ` [[Ada Lovelace]]`` but [[Ada Lovelace]].\n\n"
        b"```\n[[Ada Lovelace]]\n```\n\n~~~~md\n[[Ada Lovelace]]\n~~~~\n"
    )
    space = Space(space_dir)
    _rename_ada(space)
    assert (
        ref.read_bytes()
        .decode()
        .endswith(
            "Inline `[[Ada Lovelace]]` and ``a ` [[Ada Lovelace]]`` but [[Ada King]].\n\n"
            "```\n[[Ada Lovelace]]\n```\n\n~~~~md\n[[Ada Lovelace]]\n~~~~\n"
        )
    )


def test_rename_referrer_crlf_preserved(space_dir: Path):
    ref = space_dir / "Pages" / "Crlf.md"
    ref.write_bytes(
        b"---\r\ntype: 'Page'\r\ntitle: Crlf\r\nwho: '[[Ada Lovelace]]'\r\n---\r\n\r\n"
        b"Met [[Ada Lovelace]].\r\nEnd.\r\n"
    )
    space = Space(space_dir)
    result = _rename_ada(space)
    assert "Pages/Crlf.md" in result.relinked
    assert ref.read_bytes() == (
        b"---\r\ntype: 'Page'\r\ntitle: Crlf\r\nwho: '[[Ada King]]'\r\n---\r\n\r\n"
        b"Met [[Ada King]].\r\nEnd.\r\n"
    )


def test_readonly_referrer_reported_in_skipped(space_dir: Path):
    bad = space_dir / "Pages" / "Bad ref.md"
    bad.write_bytes(b"---\ntype: 'Page'\ntitle: [Bad\n---\n\nSee [[Ada Lovelace]].\n")
    before = bad.read_bytes()
    space = Space(space_dir)

    result = _rename_ada(space)

    assert [s.path for s in result.skipped] == ["Pages/Bad ref.md"]
    assert result.skipped[0].reason
    assert "Pages/Bad ref.md" not in result.relinked
    assert bad.read_bytes() == before


def _external_writes(monkeypatch, target: Path, times: int) -> list[bytes]:
    real = space_mod.atomic_write
    written: list[bytes] = []

    def patched(path, data, check=None):
        if Path(path) == target and len(written) < times:
            ext = target.read_bytes() + f"external {len(written)}\n".encode()
            target.write_bytes(ext)
            written.append(ext)
        return real(path, data, check=check)

    monkeypatch.setattr(space_mod, "atomic_write", patched)
    return written


def test_referrer_conflict_retried_then_skipped(space_dir: Path, monkeypatch):
    docs = space_dir / "Tasks" / "Write docs.md"
    space = Space(space_dir)
    written = _external_writes(monkeypatch, docs, 2)

    result = _rename_ada(space)

    assert len(written) == 2
    assert [s.path for s in result.skipped] == ["Tasks/Write docs.md"]
    assert result.relinked == ["Servers/Alpha.md"]
    assert docs.read_bytes() == written[-1]


def test_referrer_conflict_once_is_retried(space_dir: Path, monkeypatch):
    docs = space_dir / "Tasks" / "Write docs.md"
    space = Space(space_dir)
    written = _external_writes(monkeypatch, docs, 1)

    result = _rename_ada(space)

    assert len(written) == 1
    assert result.skipped == []
    text = docs.read_bytes().decode()
    assert "external 0\n" in text and "[[Ada King]]" in text


# -- the helpers -------------------------------------------------------------------


def test_replace_wikilinks_helper():
    def yes(t: str) -> bool:
        return t.lower() == "old"

    assert replace_wikilinks("a [[Old]] [[old|x]] [[Old#h|y]] [[Other]]", yes, "New") == (
        "a [[New]] [[New|x]] [[New#h|y]] [[Other]]"
    )
    assert replace_wikilinks("`[[Old]]` [[Old]]", yes, "New") == "`[[Old]]` [[New]]"
    assert replace_wikilinks("no links", yes, "New") == "no links"


def test_relink_frontmatter_helper():
    src = "a: '[[Old]]'\nb: [x, '[[Old]]']\nc: plain\n"
    fm = {"a": "[[Old]]", "b": ["x", "[[Old]]"], "c": "plain"}
    out = relink_frontmatter(src, fm, lambda t: t == "Old", "New")
    assert out == "a: '[[New]]'\nb: [x, '[[New]]']\nc: plain\n"
    assert relink_frontmatter(src, fm, lambda t: False, "New") is src


# -- route -------------------------------------------------------------------------


def test_rename_route_and_events(space_dir: Path):
    space = Space(space_dir)
    app = create_app(space, None, watch=False)
    published = []
    app.state.hub.publish = published.append
    with TestClient(app) as c:
        obj = c.get("/api/object", params={"path": ADA}).json()
        r = c.post(
            "/api/object/rename",
            json={
                "path": ADA,
                "title": "Ada King",
                "baseVersion": obj["version"],
                "clientId": "w1",
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body) == {"path", "version", "relinked", "skipped"}
        assert body["path"] == "People/Ada King.md"
        assert body["relinked"] == ["Servers/Alpha.md", "Tasks/Write docs.md"]
        deadline = time.monotonic() + 2
        while len(published) < 3 and time.monotonic() < deadline:
            time.sleep(0.01)
        assert {(e.kind, e.path, e.oldPath, e.origin) for e in published} == {
            ("renamed", "People/Ada King.md", ADA, "w1"),
            ("changed", "Servers/Alpha.md", None, "w1"),
            ("changed", "Tasks/Write docs.md", None, "w1"),
        }
        renamed = next(e for e in published if e.kind == "renamed")
        assert renamed.version == body["version"]

        r = c.post(
            "/api/object/rename",
            json={"path": "People/Ada King.md", "title": "X", "baseVersion": obj["version"]},
        )
        assert r.status_code == 409 and r.json()["currentVersion"] == body["version"]
        daily = c.get("/api/object", params={"path": "DailyNotes/2026-10-23.md"}).json()
        r = c.post(
            "/api/object/rename",
            json={
                "path": "DailyNotes/2026-10-23.md",
                "title": "X",
                "baseVersion": daily["version"],
            },
        )
        assert r.status_code == 422 and r.json()["detail"]
        bad = c.get("/api/object", params={"path": "Pages/Bad yaml.md"}).json()
        r = c.post(
            "/api/object/rename",
            json={"path": "Pages/Bad yaml.md", "title": "Good", "baseVersion": bad["version"]},
        )
        assert r.status_code == 423
        r = c.post(
            "/api/object/rename",
            json={"path": "Pages/Nope.md", "title": "X", "baseVersion": "0" * 64},
        )
        assert r.status_code == 404
