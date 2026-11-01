"""cProfile of a rename with 214 referrers (direct call), and the search index's type-save pass.

Usage (from ``backend/``): ``OBJECT_STATE_DIR=... uv run python ../scripts/audit-2026-11-01/perf-backend/profile_rename.py <space-copy>``
Writes to the space: use a copy.
"""
from __future__ import annotations
import cProfile, io, pstats, sys, time
from pathlib import Path


def main():
    from objectapp.space import Space, version_of
    from objectapp.history import HistoryStore
    from objectapp.searchindex import SearchIndex
    root = Path(sys.argv[1]).resolve()
    space = Space(root)
    store = HistoryStore(root)
    space.before_write = lambda rel, data: store.snapshot(rel, data, space.clock())
    list(space.links.edges())
    hub = "Pages/Hub Object.md"
    v = version_of((root / hub).read_bytes())
    pr = cProfile.Profile(); pr.enable()
    t0 = time.perf_counter()
    res = space.rename_object(hub, "Hub Renamed", v)
    el = time.perf_counter() - t0
    pr.disable()
    print(f"rename_object(hub) with cProfile: {el:.2f} s, relinked {len(res.relinked)}")
    s = io.StringIO(); pstats.Stats(pr, stream=s).sort_stats("cumulative").print_stats("objectapp", 32)
    print("\n".join(s.getvalue().splitlines()[6:]))
    s = io.StringIO(); pstats.Stats(pr, stream=s).sort_stats("tottime").print_stats(14)
    print("--- top by own time (all frames)"); print("\n".join(s.getvalue().splitlines()[6:]))
    # uninstrumented rename back
    v = version_of((root / res.path).read_bytes())
    t0 = time.perf_counter(); res2 = space.rename_object(res.path, "Hub Object", v); print(f"rename back uninstrumented: {time.perf_counter()-t0:.2f} s ({(time.perf_counter()-t0)/max(1,len(res2.relinked))*1000:.1f} ms per relinked file)")
    # search index: what a type save costs on the index thread (_sync_types rebuilds every document)
    si = SearchIndex(space); si.start(); si.ready.wait(900)
    si._write(lambda conn: si._put_types_key(conn, "stale-fingerprint"))
    calls = [0]
    orig = si._document
    def counting(p):
        calls[0] += 1
        return orig(p)
    si._document = counting
    t0 = time.perf_counter(); si._sync_types(); print(f"SearchIndex._sync_types after a type save: {time.perf_counter()-t0:.2f} s, _document calls {calls[0]} (runs on the index thread after every PUT /api/types)")
    si.stop()


if __name__ == "__main__":
    main()
