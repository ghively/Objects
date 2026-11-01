"""Where the time goes inside the heavy read routes (no HTTP): rows, objects, calendar, preview.

Usage (from ``backend/``): ``uv run python ../scripts/audit-2026-11-01/perf-backend/profile_parts.py <space>``
"""

from __future__ import annotations

import cProfile
import io
import json
import pstats
import re
import sys
import time
from dataclasses import asdict
from pathlib import Path


def t(label: str, fn, n: int = 1):
    best = None
    out = None
    for _ in range(n):
        t0 = time.perf_counter()
        out = fn()
        el = time.perf_counter() - t0
        best = el if best is None else min(best, el)
    print(f"  {label:60s} {best*1000:9.1f} ms", flush=True)
    return out


def prof(label: str, fn, pattern: str = "objectapp", lines: int = 22) -> None:
    pr = cProfile.Profile()
    pr.enable()
    fn()
    pr.disable()
    s = io.StringIO()
    pstats.Stats(pr, stream=s).sort_stats("tottime").print_stats(pattern, lines)
    body = s.getvalue()
    print(f"--- profile {label} (top by own time, objectapp frames)")
    print("\n".join(body.splitlines()[6:]))


def main() -> None:
    from fastapi.encoders import jsonable_encoder

    from objectapp import rows as rows_mod
    from objectapp.calendarquery import calendar_range
    from objectapp.rows import body_preview, build_rows
    from objectapp.server import _display_safe
    from objectapp.space import Space, version_of

    space = Space(Path(sys.argv[1]).resolve())
    space.resolve("warm", None)
    list(space.links.edges())

    print("== POST /api/rows typeIds=[page] (1753 rows) split")
    rows = t("build_rows(space, ['page'])", lambda: build_rows(space, ["page"]))
    t("  of which body_preview over the same bodies", lambda: [body_preview(space._raw[r.summary.path].of.body) for r in rows])
    t("  of which space.backlinks per row", lambda: [space.backlinks(r.summary.path) for r in rows])
    t("  of which version_of(raw.data) per row", lambda: [version_of(space._raw[r.summary.path].data) for r in rows])
    d = t("[asdict(r) for r in rows]", lambda: [asdict(r) for r in rows])
    d2 = t("_display_safe({'rows': ...})", lambda: _display_safe({"rows": d}))
    enc = t("fastapi jsonable_encoder (what a dict return costs)", lambda: jsonable_encoder(d2))
    t("json.dumps of the encoded payload", lambda: json.dumps(enc))
    t("json.dumps straight from _display_safe output", lambda: json.dumps(d2))
    print("== POST /api/rows typeIds=[task] (200 rows)")
    prof("build_rows task", lambda: build_rows(space, ["task"]), lines=18)

    print("== GET /api/objects split")
    items = t("space.list()", lambda: space.list())
    d = t("[asdict(s) for s in items]", lambda: [asdict(s) for s in items])
    d2 = t("_display_safe(list)", lambda: _display_safe(d))
    enc = t("jsonable_encoder(list)", lambda: jsonable_encoder(d2))
    t("json.dumps(enc)", lambda: json.dumps(enc))

    print("== body_preview on one 50 KB body: per-regex cost")
    body = space._raw["Pages/Hub Object.md"].of.body
    t("body_preview(hub body) whole", lambda: body_preview(body), n=3)
    lines = body.split("\n")
    for name in ("_HEADING_RE", "_QUOTE_RE", "_LIST_RE", "_TASK_RE", "_TAG_RE", "_IMAGE_RE", "_MDLINK_RE", "_WIKI_RE", "_STRONG_RE", "_EM_STAR_RE", "_EM_UNDER_RE", "_STRIKE_RE", "_CODE_RE", "_BLOCK_ID_RE", "_COMMENT_LINE_RE", "_RULE_RE", "_FENCE_RE"):
        rx = getattr(rows_mod, name)
        if name in ("_COMMENT_LINE_RE", "_RULE_RE", "_FENCE_RE"):
            t(f"  {name}.match per line", lambda rx=rx: [rx.match(l) for l in lines], n=3)
        else:
            t(f"  {name}.sub per line", lambda rx=rx: [rx.sub("", l) for l in lines], n=3)
    print(f"  (hub body: {len(body)} chars, {len(lines)} lines, longest line {max(map(len, lines))})")

    print("== GET /api/calendar 7 days split")
    cal = t("calendar_range(space, 7 days)", lambda: calendar_range(space, "2026-10-25", "2026-10-31"))
    print(f"  summaries returned: {len(cal['summaries'])}, mentioned paths; response json {len(json.dumps(cal))/1024:.0f} KB")
    for day, sections in list(cal["days"].items())[:1]:
        print("  day", day, {k: (len(v) if isinstance(v, list) else v is not None) for k, v in sections.items()})
    prof("calendar_range 7 days", lambda: calendar_range(space, "2026-10-25", "2026-10-31"), lines=22)
    t("jsonable_encoder(calendar)", lambda: jsonable_encoder(_display_safe(cal)))

    print("== search: fuzzy title pass alone")
    from objectapp import fuzzy
    summaries = [s for s in space._summaries.values() if s.template is None]
    t("fuzzy.score(q, title) x 5000 titles", lambda: [fuzzy.score("harbor meeting", s.title) for s in summaries], n=3)

    print("== Space._rel cost (resolve() syscall per call)")
    t("space._rel(path) x 1753", lambda: [space._rel(r.summary.path) for r in rows], n=3)
    t("space.cached_version x 1753", lambda: [space.cached_version(r.summary.path) for r in rows], n=3)


if __name__ == "__main__":
    main()
