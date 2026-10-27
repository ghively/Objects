"""The space's link index: who links to whom, kept in memory and refreshed lazily.

A **link** from object A to object B is a ``[[target]]`` in A's body outside
code (``![[…]]`` included), an ``entity`` property value of A, or a
``[[target]]`` inside any other frontmatter string value of A (the values
M2's `relink_frontmatter` rewrites), whose target resolves to B by
`Space.resolve` from A. Unresolved targets, self links and templates (as
source or target) don't count; ``tags:`` membership is kept separately
(`tags_of`, `tagged`).

The index stores each source's link *targets* (`_extract`, one method, the hook
point for other kinds of objects) and resolves them on read. `on_change` only
records the change: the next read re-extracts the changed sources, re-extracts
everything after a type change (property definitions decide which keys are
relations), and re-resolves every stored target when the set of names changed
(`Space._names_rev`). Nothing is ever written.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from .propvalues import decode_value
from .relink import wikilink_spans, wikilink_targets

if TYPE_CHECKING:
    from .space import Space, SpaceChange

__all__ = ["LinkIndex"]


@dataclass
class _Extracted:
    body: list[str] = field(default_factory=list)
    """Body link targets as written (outside code), in order."""
    props: dict[str, list[str]] = field(default_factory=dict)
    """Frontmatter key -> link targets (entity values and wikilinks in other values)."""
    tags: list[str] = field(default_factory=list)


@dataclass
class _Resolved:
    out: dict[str, tuple[bool, tuple[str, ...]]]
    """Target path -> (a body link, the property keys that link)."""
    tags: tuple[str, ...]
    """Tag object paths, in tag order, distinct."""


def _fold(text: str) -> str:
    return " ".join(text.split()).casefold()


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
        self._resolved: dict[str, _Resolved] = {}
        self._in: dict[str, set[str]] = {}
        self._tagged: dict[str, set[str]] = {}
        self._backlinks_cache: dict[str, list[str]] = {}
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
            full = not self._built or any(c.kind == "types" for c in pending)
            dirty: set[str] = set()
            if full:
                self._sources = {}
                for path in list(space._raw):
                    ex = self._extract_if_source(path)
                    if ex is not None:
                        self._sources[path] = ex
                self._built = True
            else:
                dirty = {c.path for c in pending if c.path}
                for path in dirty:
                    ex = self._extract_if_source(path)
                    if ex is None:
                        self._sources.pop(path, None)
                    else:
                        self._sources[path] = ex
            names_rev = space._names_rev
            if full or names_rev != self._names_rev:
                self._names_rev = names_rev
                self._resolve_all()
            else:
                changed = False
                tag_paths = self._tag_paths() if dirty else {}
                for path in dirty:
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
        """The link targets one object holds (body, relation values, frontmatter wikilinks)."""
        space = self._space
        raw = space._raw[path]
        summary = space._summaries[path]
        ex = _Extracted(tags=list(summary.tags))
        body = raw.of.body
        if "[[" in body:
            ex.body = [t for t, _s, _e in wikilink_spans(body)]
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
        return ex

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

    def tagged(self, tag_path: str) -> set[str]:
        """The objects carrying the Tag object ``tag_path``."""
        self._ensure()
        return set(self._tagged.get(tag_path, ()))
