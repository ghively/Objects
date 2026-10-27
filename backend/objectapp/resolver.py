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

The space rebuilds it lazily whenever the set of names changes (an object
created, deleted, moved or retyped, or a change of ``title``, ``aliases``,
``createdAt`` or ``template``).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from pathlib import PurePosixPath
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .space import ObjectSummary

__all__ = ["Resolver", "link_candidates"]

# (folder, path) entries, sorted by (createdAt missing, createdAt, path).
_Bucket = list[tuple[str, str]]


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
    return PurePosixPath(path).parent.as_posix()


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
            keyed.append(((s.createdAt is None, s.createdAt or "", s.path), s))
        keyed.sort(key=lambda it: it[0])
        for _key, s in keyed:
            entry = (_folder_of(s.path), s.path)
            r._paths.add(s.path)
            r._title.setdefault(s.title, []).append(entry)
            for a in dict.fromkeys(a.lower() for a in aliases.get(s.path, ())):
                r._alias.setdefault(a, []).append(entry)
            for k in dict.fromkeys(
                (s.title.lower(), PurePosixPath(s.path).stem.lower())
            ):
                r._ci.setdefault(k, []).append(entry)
        return r

    @staticmethod
    def _best(bucket: _Bucket | None, from_folder: str | None) -> str | None:
        if not bucket:
            return None
        if from_folder is not None:
            for folder, path in bucket:
                if folder == from_folder:
                    return path
        return bucket[0][1]

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
