"""The space's graph: nodes, undirected link pairs and tag memberships (M5).

Nodes are every non-template object whose role has graph support (all of ours,
see `roles.NO_GRAPH_SUPPORT`), in path order. ``links`` holds the distinct
undirected pairs of the link index as node indexes (flat ``[a0, b0, …]``,
``a < b``); ``linkDirs`` gives each pair's direction (1: a links to b, 2: b
links to a, 3: both), which Capacities' graph rules need to tell a node's own
links from its backlinks; ``tagged`` holds ``(object, tag)`` pairs the same
way. Each node
carries its ``degree`` (distinct linked neighbours) and the flags the client's
filters need: ``tag`` (role ``RootTag``), ``daily`` (role ``RootDailyNote``) and
``done`` (a Task whose status is in the ``done`` category). Everything is
derived from the in-memory scan; nothing is written.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .propvalues import decode_value, label_lookup
from .roles import NO_GRAPH_SUPPORT, role_of
from .taskhook import status_key_of
from .typemodel import Icon, TypeDefinition, is_task_type, status_category

if TYPE_CHECKING:
    from .space import Space

__all__ = ["graph_data"]


def _icon(summary: Any) -> dict[str, Any] | None:
    icon = Icon.parse(summary.icon)
    if icon is None:
        return None
    if summary.iconColor:
        icon = Icon(icon.type, icon.val, summary.iconColor)
    return icon.to_json()


def _done(t: TypeDefinition, fm: dict[str, Any]) -> bool:
    """True when the Task's status option is in the ``done`` category."""
    sdef = status_key_of(t)
    if sdef is None:
        return False
    texts = decode_value(sdef, fm.get(sdef.key), fm) or []
    text = texts[0] if isinstance(texts, list) and texts else None
    if not isinstance(text, str) or not text:
        return False
    opt = label_lookup(sdef, text)
    if opt is None:
        return False
    return (opt.statusCategory or status_category(opt.text)) == "done"


def graph_data(space: Space) -> dict[str, Any]:
    """The `GraphData` of ``space`` (see the M5 API contract)."""
    links = space.links
    edges = list(links.edges())
    with space._lock:
        summaries = [
            s
            for s in space._summaries.values()
            if s.template is None and s.path in space._raw
        ]
        fms = {s.path: space._raw[s.path].fm or {} for s in summaries}
        types = {t.id: t for t in space.types}
    summaries.sort(key=lambda s: s.path)

    nodes: list[dict[str, Any]] = []
    index: dict[str, int] = {}
    for s in summaries:
        t = types.get(s.type)
        role = role_of(t)
        if role in NO_GRAPH_SUPPORT:
            continue
        index[s.path] = len(nodes)
        nodes.append(
            {
                "path": s.path,
                "title": s.title,
                "type": s.type,
                "icon": _icon(s),
                "degree": 0,
                "tag": role == "RootTag",
                "daily": role == "RootDailyNote",
                "done": t is not None and is_task_type(t) and _done(t, fms[s.path]),
            }
        )

    flat: list[int] = []
    dirs: list[int] = []
    outgoing: dict[str, set[str]] = {}
    for a, b in edges:
        ia = index.get(a)
        ib = index.get(b)
        if ia is None or ib is None or ia == ib:
            continue
        if a not in outgoing:
            outgoing[a] = links.outgoing(a)
        if b not in outgoing:
            outgoing[b] = links.outgoing(b)
        d = (1 if b in outgoing[a] else 0) | (2 if a in outgoing[b] else 0)
        if ia > ib:
            ia, ib = ib, ia
            d = ((d & 1) << 1) | ((d & 2) >> 1)
        flat.append(ia)
        flat.append(ib)
        dirs.append(d)
        nodes[ia]["degree"] += 1
        nodes[ib]["degree"] += 1

    tagged: list[int] = []
    for path, i in index.items():
        for tag_path in links.tags_of(path):
            j = index.get(tag_path)
            if j is not None and j != i:
                tagged.append(i)
                tagged.append(j)

    return {"nodes": nodes, "links": flat, "linkDirs": dirs, "tagged": tagged}
