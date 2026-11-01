"""Profiles of /api/references, /api/attachments and export media (direct calls)."""
from __future__ import annotations
import cProfile, io, pstats, sys, time
from pathlib import Path


def prof(label, fn, lines=18):
    t0 = time.perf_counter(); fn(); el = time.perf_counter() - t0
    pr = cProfile.Profile(); pr.enable(); fn(); pr.disable()
    s = io.StringIO(); pstats.Stats(pr, stream=s).sort_stats("cumulative").print_stats("objectapp", lines)
    print(f"--- {label}: {el*1000:.0f} ms uninstrumented (second call)")
    print("\n".join(s.getvalue().splitlines()[6:]))


def main():
    from objectapp.space import Space
    from objectapp.searchindex import SearchIndex
    from objectapp.references import references
    from objectapp.media import list_attachments
    from objectapp.export import export_object
    root = Path(sys.argv[1]).resolve()
    space = Space(root)
    list(space.links.edges())
    search = SearchIndex(space)
    search.start(); search.ready.wait(900)
    page = next(p for p in sorted(space._raw) if p.startswith("Pages/Page 0"))
    hub = "Pages/Hub Object.md"
    prof("references(ordinary page)", lambda: references(space, search, page, related_limit=20))
    prof("references(hub, 214 backlinks)", lambda: references(space, search, hub, related_limit=20), lines=14)
    prof("list_attachments(root) (/api/attachments)", lambda: list_attachments(root), lines=12)
    prof("export_object(media heavy page, media=True)", lambda: export_object(space, "Pages/Media heavy page.md", True), lines=12)
    search.stop()


if __name__ == "__main__":
    main()
