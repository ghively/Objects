"""The space's link index: who links to whom, kept in memory and refreshed lazily.

A **link** from object A to object B is a ``[[target]]`` in A's body outside
code (``![[…]]`` included), an ``entity`` property value of A, or a
``[[target]]`` inside any other frontmatter string value of A (the values
M2's `relink_frontmatter` rewrites), whose target resolves to B by
`Space.resolve` from A. Unresolved targets, self links and templates (as
source or target) don't count; ``tags:`` membership is kept separately
(`tags_of`, `tagged`). M8: a data-view embed (``![[collection:…]]``,
``![[query:…]]``) is not a link; a block reference (``[[T#^id]]``,
``![[T#^id]]``) is a link to ``T``. Link targets written as a day
(``[[YYYY-MM-DD]]``) are also kept unresolved (`day_backlinks`), and each
object's date tokens (``<time datetime="YYYY-MM-DD">``, outside code) are
counted (`date_tokens`, `date_references`).

The index stores each source's link *targets* (`_extract`, one method, the hook
point for other kinds of objects) and resolves them on read. `on_change` only
records the change: the next read re-extracts the changed sources, re-extracts
everything after a type change (property definitions decide which keys are
relations), and re-resolves the sources holding a link written to a name that
changed (`Space._names_since`; every source when the space can't say which).
Nothing is ever written.

It also keeps, for every object (templates too), the folded text of each link
target as written (`mentioning`): a rename or type change asks it which files
could hold a link to rewrite instead of scanning the whole space (audit
2026-11-01 P4).
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from .dailynotes import parse_day
from .propvalues import decode_value
from .relink import code_ranges, wikilink_spans, wikilink_targets
from .resolver import fold as _fold

if TYPE_CHECKING:
    from .space import Space, SpaceChange

__all__ = ["LinkIndex", "count_date_tokens"]

_DATA_VIEW_PREFIXES = ("collection:", "query:")
_TIME_RE = re.compile(
    r"<time\b[^>]*?\bdatetime\s*=\s*([\"'])(\d{4}-\d{2}-\d{2})\1[^>]*>", re.IGNORECASE
)


def count_date_tokens(body: str) -> dict[str, int]:
    """``{day: count}`` of the date tokens ``<time datetime="YYYY-MM-DD">`` outside code."""
    out: dict[str, int] = {}
    if "<" not in body:
        return out
    ranges = code_ranges(body)
    for m in _TIME_RE.finditer(body):
        pos = m.start()
        if any(s <= pos < e for s, e in ranges):
            continue
        day = parse_day(m.group(2))
        if day is not None and day == m.group(2):
            out[day] = out.get(day, 0) + 1
    return out


@dataclass
class _Extracted:
    body: list[str] = field(default_factory=list)
    """Body link targets as written (outside code), in order."""
    props: dict[str, list[str]] = field(default_factory=dict)
    """Frontmatter key -> link targets (entity values and wikilinks in other values)."""
    tags: list[str] = field(default_factory=list)
    days: frozenset[str] = frozenset()
    """The days (``YYYY-MM-DD``) written as link targets, resolved or not."""
    tokens: dict[str, int] = field(default_factory=dict)
    """Day -> the number of date tokens for it in the body (outside code)."""


@dataclass
class _Resolved:
    out: dict[str, tuple[bool, tuple[str, ...]]]
    """Target path -> (a body link, the property keys that link)."""
    tags: tuple[str, ...]
    """Tag object paths, in tag order, distinct."""


def _strings(value: Any) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for v in value:
            if isinstance(v, str):
                yield v


class LinkIndex:
    def __init__(self, space: Space) -> None:
        self._space = space
        self._pending: list[SpaceChange] = []
        self._built = False
        self._names_rev = -1
        self._sources: dict[str, _Extracted] = {}
        self._targets: dict[str, frozenset[str]] = {}
        """Path -> folded link target texts as written (every object, templates included)."""
        self._mentions: dict[str, set[str]] = {}
        """Folded link target text -> the paths holding such a link (the inverse of `_targets`)."""
        self._resolved: dict[str, _Resolved] = {}
        self._in: dict[str, set[str]] = {}
        self._tagged: dict[str, set[str]] = {}
        self._backlinks_cache: dict[str, list[str]] = {}
        self._sources_rev = 0
        self._days_rev = -1
        self._day_sources: dict[str, set[str]] = {}
        self._token_sources: dict[str, dict[str, int]] = {}
        self.revision = 0
        """Bumped on every change that alters a link, a backlink or a tag membership."""

    # -- change tracking ------------------------------------------------------

    def on_change(self, change: SpaceChange) -> None:
        """Record a change (called by the space, maybe under its lock): never blocks."""
        self._pending.append(change)

    def _fresh(self) -> bool:
        return (
            self._built
            and not self._pending
            and self._names_rev == self._space._names_rev
        )

    def _ensure(self) -> None:
        if self._fresh():
            return
        space = self._space
        with space._lock:
            pending, self._pending = self._pending, []
            self._sources_rev += 1
            full = not self._built or any(c.kind == "types" for c in pending)
            dirty: set[str] = set()
            if full:
                self._sources = {}
                self._targets = {}
                self._mentions = {}
                for path in list(space._raw):
                    ex = self._extract_if_source(path)
                    if ex is not None:
                        self._sources[path] = ex
                    self._set_mentions(path, self._written_targets(path, ex))
                self._built = True
            else:
                dirty = {c.path for c in pending if c.path}
                for path in dirty:
                    ex = self._extract_if_source(path)
                    if ex is None:
                        self._sources.pop(path, None)
                    else:
                        self._sources[path] = ex
                    self._set_mentions(path, self._written_targets(path, ex))
            names_rev = space._names_rev
            changed_names: frozenset[str] | None = frozenset()
            if names_rev != self._names_rev:
                changed_names = space._names_since(self._names_rev)
                self._names_rev = names_rev
            if full or changed_names is None:
                self._resolve_all()
            else:
                # Only a link written to a changed name can resolve differently now.
                affected = set(dirty)
                for name in changed_names:
                    affected.update(self._mentions.get(name, ()))
                changed = False
                tag_paths = self._tag_paths() if affected else {}
                for path in affected:
                    changed |= self._resolve_source(path, tag_paths)
                if changed:
                    self._bump()

    def _bump(self) -> None:
        self.revision += 1
        self._backlinks_cache = {}

    # -- extraction -----------------------------------------------------------

    def _extract_if_source(self, path: str) -> _Extracted | None:
        summary = self._space._summaries.get(path)
        if (
            summary is None
            or summary.template is not None
            or path not in self._space._raw
        ):
            return None
        return self._extract(path)

    def _extract(self, path: str) -> _Extracted:
        """The link targets one object holds (body, relation values, frontmatter wikilinks).

        A whiteboard's board links (entity blocks, wikilinks in text blocks) join its body links.
        """
        space = self._space
        raw = space._raw[path]
        summary = space._summaries[path]
        ex = _Extracted(tags=list(summary.tags))
        body = raw.of.body
        if "[[" in body:
            ex.body = [
                t
                for t, s, _e in wikilink_spans(body)
                if not (body.startswith("!", s) and t.lstrip().startswith(_DATA_VIEW_PREFIXES))
            ]
        ex.tokens = count_date_tokens(body)
        # M6: a whiteboard's board links count as body links (imported here: no import cycle).
        from .whiteboardindex import board_for_index
        from .whiteboardtrash import board_links

        board, _revision = board_for_index(space, path)
        if board is not None:
            ex.body.extend(board_links(board))
        t = space.type_by_id(summary.type)
        defs = {p.key: p for p in t.propertyDefinitions} if t is not None else {}
        for key, value in raw.fm.items():
            if key == "tags":
                continue
            pdef = defs.get(key)
            if pdef is not None and pdef.type == "entity_backlinks":
                continue
            if pdef is not None and pdef.type == "entity":
                targets = [r["target"] for r in decode_value(pdef, value)]
            else:
                targets = []
                for s in _strings(value):
                    if "[[" in s:
                        targets.extend(sorted(wikilink_targets(s)))
            if targets:
                ex.props[key] = targets
        days = {d for t in ex.body if (d := parse_day(t)) is not None}
        for targets in ex.props.values():
            days.update(d for t in targets if isinstance(t, str) and (d := parse_day(t)) is not None)
        ex.days = frozenset(days)
        return ex

    def _written_targets(self, path: str, ex: _Extracted | None) -> frozenset[str]:
        """The folded target texts of every ``[[link]]`` in ``path`` (frontmatter and body)."""
        raw = self._space._raw.get(path)
        if raw is None:
            return frozenset()
        if ex is not None:
            body_targets: list[str] = ex.body
        else:  # a template: not a source, but a rename still rewrites its links
            body = raw.of.body
            body_targets = [t for t, _s, _e in wikilink_spans(body)] if "[[" in body else []
        src = raw.of.frontmatter_src or ""
        fm_targets = wikilink_targets(src) if "[[" in src else set()
        tags = ex.tags if ex is not None else ()  # a tag's rename re-resolves its holders
        return frozenset(_fold(t) for t in (*body_targets, *fm_targets, *tags))

    def _set_mentions(self, path: str, targets: frozenset[str]) -> None:
        old = self._targets.pop(path, None)
        for t in old or ():
            paths = self._mentions.get(t)
            if paths is not None:
                paths.discard(path)
                if not paths:
                    del self._mentions[t]
        if targets:
            self._targets[path] = targets
            for t in targets:
                self._mentions.setdefault(t, set()).add(path)

    # -- resolution -----------------------------------------------------------

    def _tag_paths(self) -> dict[str, str]:
        space = self._space
        out: dict[str, str] = {}
        for s in sorted(space._summaries.values(), key=lambda s: s.path):
            if s.type == "tag" and s.template is None:
                out.setdefault(_fold(s.title), s.path)
        return out

    def _resolve_one(self, path: str, tag_paths: dict[str, str]) -> _Resolved:
        ex = self._sources[path]
        resolve = self._space.resolve
        body: set[str] = set()
        keys: dict[str, list[str]] = {}
        for target in ex.body:
            dst = resolve(target, path)
            if dst is not None and dst != path:
                body.add(dst)
        for key, targets in ex.props.items():
            for target in targets:
                dst = resolve(target, path)
                if dst is not None and dst != path:
                    ks = keys.setdefault(dst, [])
                    if key not in ks:
                        ks.append(key)
        out = {
            dst: (dst in body, tuple(keys.get(dst, ()))) for dst in body | keys.keys()
        }
        tags: dict[str, None] = {}
        for name in ex.tags:
            tp = tag_paths.get(_fold(name))
            if tp is not None and tp != path:
                tags[tp] = None
        return _Resolved(out, tuple(tags))

    def _resolve_all(self) -> None:
        tag_paths = self._tag_paths()
        resolved = {p: self._resolve_one(p, tag_paths) for p in self._sources}
        if resolved == self._resolved:
            return
        self._resolved = resolved
        incoming: dict[str, set[str]] = {}
        tagged: dict[str, set[str]] = {}
        for src, r in resolved.items():
            for dst in r.out:
                incoming.setdefault(dst, set()).add(src)
            for tp in r.tags:
                tagged.setdefault(tp, set()).add(src)
        self._in = incoming
        self._tagged = tagged
        self._bump()

    def _resolve_source(self, path: str, tag_paths: dict[str, str]) -> bool:
        """Re-resolve one source (names unchanged); True when anything changed."""
        old = self._resolved.get(path)
        new = self._resolve_one(path, tag_paths) if path in self._sources else None
        if old == new:
            return False
        for dst in old.out if old else ():
            s = self._in.get(dst)
            if s is not None:
                s.discard(path)
                if not s:
                    del self._in[dst]
        for tp in old.tags if old else ():
            s = self._tagged.get(tp)
            if s is not None:
                s.discard(path)
                if not s:
                    del self._tagged[tp]
        if new is None:
            self._resolved.pop(path, None)
        else:
            self._resolved[path] = new
            for dst in new.out:
                self._in.setdefault(dst, set()).add(path)
            for tp in new.tags:
                self._tagged.setdefault(tp, set()).add(path)
        return True

    # -- reads ----------------------------------------------------------------

    def outgoing(self, path: str) -> set[str]:
        """The objects ``path`` links to."""
        self._ensure()
        r = self._resolved.get(path)
        return set(r.out) if r else set()

    def backlinks(self, path: str) -> list[str]:
        """The distinct objects linking to ``path``, sorted by title then path."""
        self._ensure()
        cached = self._backlinks_cache.get(path)
        if cached is not None:
            return list(cached)
        summaries = self._space._summaries

        def key(p: str) -> tuple[str, str, str]:
            s = summaries.get(p)
            title = s.title if s is not None else p
            return (title.casefold(), title, p)

        out = sorted(self._in.get(path, ()), key=key)
        self._backlinks_cache[path] = out
        return list(out)

    def mentioning(self, names: Iterable[str]) -> set[str]:
        """The objects (templates included) with a link whose target text is one of ``names``.

        Matched case-insensitively with whitespace collapsed, wherever the link
        resolves: the candidates a rename or type change checks instead of every file.
        """
        self._ensure()
        out: set[str] = set()
        for name in names:
            out.update(self._mentions.get(_fold(name), ()))
        return out

    def link_keys(self, src: str, dst: str) -> tuple[bool, list[str]]:
        """Whether ``src``'s body links to ``dst``, and the property keys that do."""
        self._ensure()
        r = self._resolved.get(src)
        entry = r.out.get(dst) if r else None
        if entry is None:
            return False, []
        return entry[0], list(entry[1])

    def edges(self) -> Iterator[tuple[str, str]]:
        """Each linked pair once, undirected, as ``(a, b)`` with ``a < b``."""
        self._ensure()
        seen: set[tuple[str, str]] = set()
        for src, r in list(self._resolved.items()):
            for dst in r.out:
                pair = (src, dst) if src < dst else (dst, src)
                if pair not in seen:
                    seen.add(pair)
        yield from sorted(seen)

    def tags_of(self, path: str) -> list[str]:
        """The Tag objects ``path`` carries (by name, case-insensitively), in tag order."""
        self._ensure()
        r = self._resolved.get(path)
        return list(r.tags) if r else []

    def _ensure_days(self) -> None:
        self._ensure()
        if self._days_rev == self._sources_rev:
            return
        with self._space._lock:
            day_sources: dict[str, set[str]] = {}
            token_sources: dict[str, dict[str, int]] = {}
            for src, ex in self._sources.items():
                for d in ex.days:
                    day_sources.setdefault(d, set()).add(src)
                for d, n in ex.tokens.items():
                    token_sources.setdefault(d, {})[src] = n
            self._day_sources = day_sources
            self._token_sources = token_sources
            self._days_rev = self._sources_rev

    def day_link_sources(self, day: str) -> set[str]:
        """The objects whose links are written ``[[day]]`` (resolved or not)."""
        self._ensure_days()
        return set(self._day_sources.get(day, ()))

    def date_tokens(self, path: str) -> dict[str, int]:
        """``{day: count}`` of the date tokens in ``path``'s body (outside code)."""
        self._ensure()
        ex = self._sources.get(path)
        return dict(ex.tokens) if ex is not None else {}

    def date_references(self, day: str) -> dict[str, int]:
        """``{path: count}`` of the objects holding date tokens for ``day``."""
        self._ensure_days()
        return dict(self._token_sources.get(day, {}))

    def tagged(self, tag_path: str) -> set[str]:
        """The objects carrying the Tag object ``tag_path``."""
        self._ensure()
        return set(self._tagged.get(tag_path, ()))
