"""Audit 2026-11-01, fix lane B1a: storage-module bugs that show through the `Space`.

Each test reproduced the audit's finding before its fix (see
``docs/superpowers/plans/audit-2026-11-01.md``, "Back end: other bugs").
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

from objectapp.space import Space

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def _ulid_at(when: datetime) -> str:
    """A ULID whose time part is ``when`` (the random part is fixed; tests make one each)."""
    ms = int(when.timestamp() * 1000)
    digits = []
    for _ in range(10):
        digits.append(_CROCKFORD[ms % 32])
        ms //= 32
    return "".join(reversed(digits)) + "Z" * 16


def _trash_dir(space_dir: Path) -> Path:
    return space_dir / ".object" / "trash"


# -- a trash object whose .json meta is missing is listed, restorable and purgeable ---------


def test_trash_object_without_meta_is_listed_and_restored_into_the_root(space_dir: Path):
    space = Space(space_dir)
    before = (space_dir / "Pages" / "Alpha.md").read_bytes()
    item = space.delete_object("Pages/Alpha.md")
    (_trash_dir(space_dir) / f"{item.id}.json").unlink()

    reopened = Space(space_dir)
    listed = reopened.list_trash()
    assert [(i.id, i.kind, i.title) for i in listed] == [(item.id, "object", "Alpha")]
    assert listed[0].deletedAt  # from the ULID's time: the entry can still expire
    assert listed[0].originalPath == "Alpha.md"

    result = reopened.restore(item.id)
    assert result == {"paths": ["Alpha.md"], "typeIds": [], "queryIds": []}
    assert (space_dir / "Alpha.md").read_bytes() == before
    assert reopened.get("Alpha.md").title == "Alpha"
    assert reopened.list_trash() == []
    assert not any(_trash_dir(space_dir).glob("*.md"))


def test_trash_object_without_meta_is_purged_by_age(space_dir: Path):
    space = Space(space_dir)
    item = space.delete_object("Pages/Alpha.md")
    old_id = _ulid_at(datetime.now(UTC) - timedelta(days=31))
    (_trash_dir(space_dir) / f"{item.id}.md").rename(_trash_dir(space_dir) / f"{old_id}.md")
    (_trash_dir(space_dir) / f"{item.id}.json").unlink()
    assert space.trash.expired(datetime.now(UTC)) == [old_id]
    Space(space_dir)  # purge_expired runs when the space opens
    assert not (_trash_dir(space_dir) / f"{old_id}.md").exists()


def test_trash_object_without_meta_can_be_purged_by_hand(space_dir: Path):
    space = Space(space_dir)
    item = space.delete_object("Tasks/Write docs.md")
    (_trash_dir(space_dir) / f"{item.id}.json").unlink()
    assert space.purge(item.id) == 1
    assert not (_trash_dir(space_dir) / f"{item.id}.md").exists()
    assert space.list_trash() == []
