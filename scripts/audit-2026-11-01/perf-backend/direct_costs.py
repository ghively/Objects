"""Direct cost of the internal steps the write paths repeat (no HTTP, no cProfile)."""

from __future__ import annotations

import sys
import time
from pathlib import Path


def t(label, fn, n=3):
    best = None
    for _ in range(n):
        t0 = time.perf_counter(); fn(); el = time.perf_counter() - t0
        best = el if best is None else min(best, el)
    print(f"  {label:70s} {best*1000:9.1f} ms", flush=True)


def main():
    from objectapp.linkindex import count_date_tokens
    from objectapp.relink import wikilink_spans, wikilink_targets
    from objectapp.resolver import Resolver
    from objectapp.space import Space, _str_list
    from objectapp.typedefs import read_raw, infer_types_from
    from objectapp.frontmatter import parse_fm
    from objectapp.searchtext import plain_body
    from objectapp.rows import body_preview

    root = Path(sys.argv[1]).resolve()
    space = Space(root)
    list(space.links.edges())
    links = space.links
    hub = "Pages/Hub Object.md"
    raw = space._raw[hub]
    print("== per-object steps (hub: 50 KB body)")
    t("read_raw(hub) (decode + split + ruamel parse_fm)", lambda: read_raw(root, hub), n=5)
    t("  parse_fm(hub frontmatter) alone (ruamel pure-python safe loader)", lambda: parse_fm(raw.of.frontmatter_src), n=5)
    t("  wikilink_spans(hub body)", lambda: wikilink_spans(raw.of.body), n=5)
    t("  count_date_tokens(hub body)", lambda: count_date_tokens(raw.of.body), n=5)
    t("  links._extract(hub)", lambda: links._extract(hub), n=5)
    t("  plain_body(hub body) (search document)", lambda: plain_body(raw.of.body), n=5)
    t("  body_preview(hub body) (rows)", lambda: body_preview(raw.of.body), n=5)
    t("  space.rescan_file(hub) (read_raw + summarize + listeners)", lambda: space.rescan_file(hub), n=5)
    small = next(p for p in sorted(space._raw) if p.startswith("Tasks/"))
    t("read_raw(small task, ~1 KB)", lambda: read_raw(root, small), n=5)
    t("  parse_fm(small task) alone", lambda: parse_fm(space._raw[small].of.frontmatter_src), n=5)
    print("== whole-space steps")
    t("infer_types_from(all 5001 raws) (start-up, and rescan_file of an unknown type)", lambda: infer_types_from(space._raw.values()))
    t("Resolver.build (on every names change: create/delete/rename/alias/title edit)", lambda: Resolver.build(list(space._summaries.values()), {rel: _str_list(r.fm.get("aliases")) for rel, r in space._raw.items()}))
    space._names_changed()
    t("links._resolve_all() after a names change (49k links, resolver cold)", lambda: (space._names_changed(), links._resolve_all()), n=2)
    t("links._resolve_all() (resolver warm/cached)", lambda: links._resolve_all(), n=2)
    def full_extract():
        links._built = False
        links._ensure()
    t("link index full rebuild (what any type save forces: extract all + resolve all)", full_extract, n=2)
    t("space._referrers(hub, 'Hub Object') (rename/change-type fixed cost: scans all text)", lambda: space._referrers(hub, "Hub Object"), n=2)
    t("space._bystanders(hub, 'New title') (second full scan per rename)", lambda: space._bystanders(hub, "New title"), n=2)
    t("space._board_referrers(hub, 'Hub Object') (reads 20 board files)", lambda: space._board_referrers(hub, "Hub Object"), n=2)
    t("wikilink_targets over all bodies (the primitive those scans use)", lambda: [wikilink_targets(r.of.frontmatter_src or "" + r.of.body) for r in space._raw.values()], n=2)
    t("space.list() (sort 5000 summaries)", lambda: space.list(), n=5)
    t("space._type_members('page')", lambda: space._type_members("page"), n=3)
    t("space.daily_notes()", lambda: space.daily_notes(), n=3)
    t("links._tag_paths() (sorted over all summaries; per _ensure with dirty paths)", lambda: links._tag_paths(), n=5)
    from objectapp.reminders import task_infos
    t("reminders.task_infos(space) (every 30 s tick)", lambda: task_infos(space), n=3)
    from objectapp.history import HistoryStore
    store = HistoryStore(root)
    from datetime import datetime, UTC
    t("HistoryStore.snapshot(hub) forced (per app write of an existing file)", lambda: store.snapshot(hub, raw.data, datetime.now(UTC), force=True), n=3)
    from objectapp.textfile import atomic_write
    tmp = root / "Pages" / "_atomic_probe.md"
    t("atomic_write(50 KB)", lambda: atomic_write(tmp, raw.data), n=5)
    tmp.unlink(missing_ok=True)
    print("== memory split of the in-memory scan")
    data = sum(len(r.data) for r in space._raw.values())
    text = sum(len(r.of.body) for r in space._raw.values())
    print(f"  raw.data bytes {data/1e6:.1f} MB; of.body chars {text/1e6:.1f} MB; summaries {len(space._summaries)}; resolver cache {len(space._current_resolver()._cache)} entries")
    import resource
    print(f"  rss {resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024:.0f} MB")


if __name__ == "__main__":
    main()
