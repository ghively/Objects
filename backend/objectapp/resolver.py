"""A dictionary-backed ``[[link]]`` resolver with exactly `Space.resolve`'s results.

`Resolver.build` indexes the space's (non-template) summaries once: the space
path form, the exact title, each alias (lowercased) and the case-insensitive
title or file stem. `Resolver.resolve` then walks the same steps as M1/M2's
linear algorithm, for each of `_link_candidates(link)` in turn: the path form
(``<text>.md`` when the text has a ``/``) for every candidate first, then per
candidate the exact title, the alias and the case-insensitive title or stem.
Within a step the linking object's folder wins, then the oldest ``createdAt``
(missing last), then the path. Each bucket is kept sorted by the last two keys,
so a lookup is the first entry in the linking folder, else the first entry.

The space builds it lazily and, whenever one object's names change (an object
created, deleted, moved or retyped, or a change of ``title``, ``aliases``,
``createdAt`` or ``template``), replaces it with `Resolver.updated`: a copy
that shares every untouched bucket, so a reader always sees a whole resolver
and the change costs the one object's entries, not a rebuild (audit 2026-11-01
P6). `link_names` lists the folded link texts an object answers to; links whose
target folds to one of them are the only ones a change can re-resolve.
"""

from __future__ import annotations

import bisect
from collections.abc import Iterable, Mapping
from pathlib import PurePosixPath
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .space import ObjectSummary

__all__ = ["Resolver", "fold", "link_candidates", "link_names"]

# (sort key, folder, path) entries, sorted by the key (createdAt missing, createdAt, path).
_Entry = tuple[tuple[bool, str, str], str, str]
_Bucket = list[_Entry]


def fold(text: str) -> str:
    """Link text normalised for matching: whitespace collapsed, case folded."""
    return " ".join(text.split()).casefold()


def link_names(summary: ObjectSummary) -> frozenset[str]:
    """The folded link texts that can reach ``summary``: title, aliases, stem and path form."""
    path = summary.path
    names = {fold(summary.title), fold(PurePosixPath(path).stem), fold(path[:-3])}
    names.update(fold(a) for a in summary.aliases)
    return frozenset(names)


def link_candidates(link: str) -> list[str]:
    """The link text as given, then without ``[[ ]]``, ``|alias`` and ``#heading`` parts."""
    text = link.strip()
    if text.startswith("[[") and text.endswith("]]"):
        text = text[2:-2].strip()
    out = [text]
    for sep in ("|", "#"):
        for c in list(out):
            if sep in c:
                head = c.split(sep, 1)[0].strip()
                if head not in out:
                    out.append(head)
    return [c for c in out if c]


def _folder_of(path: str) -> str:
    # `PurePosixPath(path).parent.as_posix()` for a normalised space path, without the
    # object construction (it runs once per resolved link).
    head, sep, _name = path.rpartition("/")
    return head if sep else "."


def _sort_key(s: ObjectSummary) -> tuple[bool, str, str]:
    return (s.createdAt is None, s.createdAt or "", s.path)


class Resolver:
    def __init__(self) -> None:
        self._paths: set[str] = set()
        self._title: dict[str, _Bucket] = {}
        self._alias: dict[str, _Bucket] = {}
        self._ci: dict[str, _Bucket] = {}
        self._cache: dict[tuple[str, str | None], str | None] = {}

    @classmethod
    def build(
        cls, summaries: Iterable[ObjectSummary], aliases: Mapping[str, Iterable[str]]
    ) -> Resolver:
        """Index ``summaries`` (templates are skipped) and ``aliases`` (path -> alias texts)."""
        r = cls()
        keyed: list[tuple[tuple[bool, str, str], ObjectSummary]] = []
        for s in summaries:
            if s.template is not None:
                continue
            keyed.append((_sort_key(s), s))
        keyed.sort(key=lambda it: it[0])
        for key, s in keyed:
            entry = (key, _folder_of(s.path), s.path)
            r._paths.add(s.path)
            r._title.setdefault(s.title, []).append(entry)
            for a in dict.fromkeys(a.lower() for a in aliases.get(s.path, ())):
                r._alias.setdefault(a, []).append(entry)
            for k in dict.fromkeys((s.title.lower(), PurePosixPath(s.path).stem.lower())):
                r._ci.setdefault(k, []).append(entry)
        return r

    @staticmethod
    def _keys(s: ObjectSummary) -> list[tuple[str, str]]:
        """Which table each of ``s``'s names goes in (the tables are named by attribute)."""
        out: list[tuple[str, str]] = [("_title", s.title)]
        out += [("_alias", a) for a in dict.fromkeys(a.lower() for a in s.aliases)]
        out += [("_ci", k) for k in dict.fromkeys((s.title.lower(), PurePosixPath(s.path).stem.lower()))]
        return out

    def updated(self, before: ObjectSummary | None, after: ObjectSummary | None) -> Resolver:
        """A resolver with ``before``'s entries replaced by ``after``'s (either may be None).

        Shares the untouched buckets with ``self``, which stays as it was, so the space can
        swap it in atomically under a reader. Same contents as a fresh `build`; the lookup
        cache starts empty.
        """
        r = Resolver()
        r._paths = set(self._paths)
        r._title, r._alias, r._ci = dict(self._title), dict(self._alias), dict(self._ci)
        if before is not None and before.template is None:
            r._paths.discard(before.path)
            entry = (_sort_key(before), _folder_of(before.path), before.path)
            for table, key in self._keys(before):
                buckets = getattr(r, table)
                bucket = [e for e in buckets.get(key, ()) if e != entry]
                if bucket:
                    buckets[key] = bucket
                else:
                    buckets.pop(key, None)
        if after is not None and after.template is None:
            r._paths.add(after.path)
            entry = (_sort_key(after), _folder_of(after.path), after.path)
            for table, key in self._keys(after):
                buckets = getattr(r, table)
                bucket = list(buckets.get(key, ()))
                if entry not in bucket:
                    bisect.insort(bucket, entry)
                buckets[key] = bucket
        return r

    @staticmethod
    def _best(bucket: _Bucket | None, from_folder: str | None) -> str | None:
        if not bucket:
            return None
        if from_folder is not None:
            for _key, folder, path in bucket:
                if folder == from_folder:
                    return path
        return bucket[0][2]

    def resolve(self, link: str, from_path: str | None) -> str | None:
        """The path ``[[link]]`` from ``from_path`` resolves to, or None."""
        key = (link, from_path)
        try:
            return self._cache[key]
        except KeyError:
            pass
        found = self._resolve(link, from_path)
        if len(self._cache) > 200_000:
            self._cache.clear()
        self._cache[key] = found
        return found

    def _resolve(self, link: str, from_path: str | None) -> str | None:
        candidates = link_candidates(link)
        for text in candidates:
            if "/" in text and f"{text}.md" in self._paths:
                return f"{text}.md"
        from_folder = None
        if from_path:
            from_folder = _folder_of(str(from_path).replace("\\", "/"))
        for text in candidates:
            low = text.lower()
            for table, k in ((self._title, text), (self._alias, low), (self._ci, low)):
                found = self._best(table.get(k), from_folder)
                if found:
                    return found
        return None
