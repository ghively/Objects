"""M8 Task 15: the calendar day's backlinks, date references and timeline; link-index rules."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient
from objectapp.linkindex import count_date_tokens
from objectapp.server import create_app
from objectapp.space import Space

CLOCK = datetime(2026, 10, 27, 9, 0, tzinfo=UTC)
PLUS2 = timezone(timedelta(hours=2))
DAY = "2026-10-27"


def _write(root: Path, rel: str, fm: str, body: str = "") -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(f"---\n{fm.strip()}\n---\n{body}", encoding="utf-8")


def _page(root: Path, name: str, body: str, created: str = "2026-10-01T08:00:00.000Z") -> str:
    n = abs(hash(name)) % 10**8
    _write(
        root,
        f"Pages/{name}.md",
        f"id: 01JBQ4Z7S3N8V2K5D9X6{n:08d}\ntype: 'Page'\ntitle: {name}\n"
        f"createdAt: {created}\nlastUpdated: {created}",
        body,
    )
    return f"Pages/{name}.md"


def _space(root: Path) -> Space:
    space = Space(root)
    space.clock = lambda: CLOCK
    space.tz = PLUS2
    return space


def _day(space: Space, day: str = DAY) -> dict:
    return space.calendar(day, day)["days"][day]


def _hashes(root: Path) -> dict[str, str]:
    return {
        p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def test_day_backlinks_without_daily_note(calendar_space_dir: Path):
    root = calendar_space_dir
    a = _page(root, "Alpha notes", f"See [[{DAY}]] and [[{DAY}|today]].\n")
    b = _page(root, "Beta notes", "Planned for [[2026-10-28]].\n")
    space = _space(root)
    day = _day(space)
    assert day["dailyNote"] is None
    assert day["backlinks"] == [a]
    assert b not in day["backlinks"]
    r = space.calendar(DAY, "2026-10-28")
    assert r["days"]["2026-10-28"]["backlinks"] == [b]
    assert a in r["summaries"] and b in r["summaries"]


def test_day_backlinks_with_daily_note_exclude_it(calendar_space_dir: Path):
    root = calendar_space_dir
    a = _page(root, "Alpha notes", "Yesterday was [[2026-10-22]].\n")
    z = _page(root, "Zeta notes", "Same: [[DailyNotes/2026-10-22]].\n")
    _write(
        root,
        "DailyNotes/2026-10-22.md",
        "id: 01JBQ4Z7S3N8V2K5D9X6T10002\ntype: 'DailyNote'\ntitle: 2026-10-22\n"
        "createdAt: 2026-10-22T07:10:00.000Z\nlastUpdated: 2026-10-22T20:00:00.000Z\n"
        "date: 2026-10-22\nreviewed: true",
        "Self link [[2026-10-22]].\n",
    )
    day = _day(_space(root), "2026-10-22")
    assert day["dailyNote"]["path"] == "DailyNotes/2026-10-22.md"
    assert day["backlinks"] == [a, z]


def test_date_references_count_tokens(calendar_space_dir: Path):
    root = calendar_space_dir
    tok = f'<time datetime="{DAY}">{DAY}</time>'
    a = _page(root, "Alpha notes", f"First {tok}, then {tok}.\n\nAgain <time datetime='{DAY}'>Tue</time>\n")
    b = _page(root, "Beta notes", f"Once {tok}. Other <time datetime=\"2026-10-28\">x</time>\n")
    space = _space(root)
    day = _day(space)
    assert day["references"] == [{"path": a, "count": 3}, {"path": b, "count": 1}]
    assert space.links.date_tokens(b) == {DAY: 1, "2026-10-28": 1}
    assert space.links.date_tokens("Pages/missing.md") == {}
    assert day["backlinks"] == []  # tokens are not links


def test_tokens_in_code_ignored(calendar_space_dir: Path):
    body = (
        f'Real <time datetime="{DAY}">{DAY}</time>\n\n'
        f'Inline `<time datetime="{DAY}">x</time>` code\n\n'
        "```html\n"
        f'<time datetime="{DAY}">{DAY}</time>\n'
        "```\n"
        '<time datetime="2026-02-30">bad day</time>\n'
    )
    assert count_date_tokens(body) == {DAY: 1}
    a = _page(calendar_space_dir, "Alpha notes", body)
    assert _day(_space(calendar_space_dir))["references"] == [{"path": a, "count": 1}]


def test_timeline_sorted_with_kinds(calendar_space_dir: Path):
    root = calendar_space_dir
    # 2026-10-27 local (+02:00) runs 2026-10-26T22:00Z .. 2026-10-27T22:00Z.
    late = _page(root, "Late page", "", created="2026-10-27T15:00:00.000Z")
    early = _page(root, "Early page", "", created="2026-10-26T22:30:00.000Z")
    _page(root, "Before page", "", created="2026-10-26T21:30:00.000Z")  # the 26th locally
    _write(
        root,
        "Meetings/Kickoff.md",
        "id: 01JBQ4Z7S3N8V2K5D9X6T19901\ntype: 'Meeting'\ntitle: Kickoff\n"
        "createdAt: 2026-10-01T08:00:00.000Z\nlastUpdated: 2026-10-01T08:00:00.000Z\n"
        "when: 2026-10-27T07:00:00.000Z",
    )
    _write(
        root,
        "Tasks/Timed task.md",
        "id: 01JBQ4Z7S3N8V2K5D9X6T19902\ntype: 'Task'\ntitle: Timed task\n"
        "createdAt: 2026-10-01T08:00:00.000Z\nlastUpdated: 2026-10-01T08:00:00.000Z\n"
        "status: Not Started\ndate: 2026-10-27T10:00:00.000Z",
    )
    _write(
        root,
        "Tasks/Day task.md",
        "id: 01JBQ4Z7S3N8V2K5D9X6T19903\ntype: 'Task'\ntitle: Day task\n"
        "createdAt: 2026-10-01T08:00:00.000Z\nlastUpdated: 2026-10-01T08:00:00.000Z\n"
        "status: Not Started\ndate: 2026-10-27",
    )
    space = _space(root)
    r = space.calendar(DAY, DAY)
    timeline = r["days"][DAY]["timeline"]
    assert timeline == [
        {"path": early, "at": "2026-10-26T22:30:00Z", "kind": "created"},
        {"path": "Meetings/Kickoff.md", "at": "2026-10-27T07:00:00Z", "kind": "dated", "key": "when"},
        {"path": "Tasks/Timed task.md", "at": "2026-10-27T10:00:00Z", "kind": "task"},
        {"path": late, "at": "2026-10-27T15:00:00Z", "kind": "created"},
    ]
    for e in timeline:
        assert e["path"] in r["summaries"]
    assert all(e["path"] != "Tasks/Day task.md" for e in timeline)
    before = space.calendar("2026-10-26", "2026-10-26")["days"]["2026-10-26"]["timeline"]
    assert [e["path"] for e in before] == ["Pages/Before page.md"]


def test_days_always_carry_the_new_sections(calendar_space_dir: Path):
    day = _space(calendar_space_dir).calendar("2026-12-05", "2026-12-05")["days"]["2026-12-05"]
    assert day["backlinks"] == [] and day["references"] == [] and day["timeline"] == []


def test_calendar_m8_sections_write_nothing(calendar_space_dir: Path, monkeypatch):
    root = calendar_space_dir
    _page(root, "Alpha notes", f'[[{DAY}]] <time datetime="{DAY}">{DAY}</time>\n')
    before = _hashes(root)
    clock = root.parent / "clock.txt"
    clock.write_text(CLOCK.isoformat().replace("+00:00", "Z"), encoding="utf-8")
    monkeypatch.setenv("OBJECT_CLOCK_FILE", str(clock))
    with TestClient(create_app(Space(root), None, watch=False)) as c:
        res = c.get("/api/calendar", params={"from": "2026-10-20", "to": "2026-10-31"})
        assert res.status_code == 200
        day = res.json()["days"][DAY]
        assert day["backlinks"] == ["Pages/Alpha notes.md"]
        assert day["references"] == [{"path": "Pages/Alpha notes.md", "count": 1}]
        assert isinstance(day["timeline"], list)
    assert _hashes(root) == before


def test_dataview_embeds_are_not_links(links_space_dir: Path):
    root = links_space_dir
    _page(root, "collection:abc", "A page whose title looks like an embed.\n")
    _page(root, "query:xyz", "Another.\n")
    src = _page(root, "Embeds", "![[collection:abc]]\n\n![[query:xyz]]\n\nPlain [[collection:abc]]\n")
    space = Space(root)
    out = space.links.outgoing(src)
    assert "Pages/query:xyz.md" not in out
    # the plain (non-embed) link still counts
    assert out == {"Pages/collection:abc.md"}


def test_block_reference_counts_as_link(links_space_dir: Path):
    root = links_space_dir
    target = _page(root, "Target page", "A block ^abc123\n")
    one = _page(root, "Ref one", "![[Target page#^abc123]]\n")
    two = _page(root, "Ref two", "See [[Target page#^abc123|that]].\n")
    space = Space(root)
    assert space.links.outgoing(one) == {target}
    assert space.links.outgoing(two) == {target}
    assert space.links.backlinks(target) == [one, two]
