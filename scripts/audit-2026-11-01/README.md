# Audit repro scripts (2026-11-01)

The scratch scripts, tests and benchmarks that reproduced the findings in `docs/superpowers/plans/audit-2026-11-01.md`. Keep them as evidence and as the starting point for each fix's regression test. They are not part of the gate (`pytest` collects only `backend/tests`; `vitest` and `tsc` look only at `frontend/src`).

They were written in a Linux cloud container, so some paths are hard-coded (`/home/user/Objects`, a `/tmp/claude-0/.../scratchpad/...` folder). Change them to your clone and any temp folder. Every script copies a fixture space from `backend/tests/fixtures/` (or generates a synthetic one) before touching it; never point one at a real space.

| Folder | Area | How to run |
|---|---|---|
| `backend-core/` | storage core (`probe1`–`probe6`) | from the repo root: `uv run python scripts/audit-2026-11-01/backend-core/probeN_….py` (`probe2 … perf` builds a 5,000-object space) |
| `backend-api/` | API, security, features | `harness.py` is the shared setup; `fuzz_routes.py`, `security_checks.py`, `edge_dates.py`, `perf_big_space.py`, `perf_writes_walk.py`, `concurrency_sse.py` |
| `perf-backend/` | measured back-end performance | `gen_space.py` first (a 5,001-object synthetic space), then `cold_start.py`, `bench_reads.py`, `bench_http.py`, `bench_writes.py`, `bench_watcher.py`, `direct_costs.py`, `profile_*.py`; run from `backend/` with `OBJECT_STATE_DIR`/`OBJECT_CACHE_DIR` set to scratch dirs. Never measure with `tracemalloc` on (5–10× inflation) |
| `editor/` | editor round trips, edits, paste, plugin cost | copy a `*.repro.tsx` to `frontend/src/editor/zz_x.test.tsx`, `npx vitest run src/editor/zz_x.test.tsx`, delete the copy; they print, not assert (see its README) |
| `whiteboard/` | canvas, ink, flush, back end | see its README; pytest files run with `uv run pytest <file> -q`, the `.test.tsx` files are copied into `frontend/src/whiteboard/` |
| `views/` | filter/sort/group/calc, cells, CSV, render cost | `.test.ts(x).txt` files: strip `.txt`, copy under `frontend/src/views/`, run, delete (see its README) |
| `shell/` | SSE, tabs, ui.json saves, themes, palette | same pattern, under `frontend/src/` (see its README) |
| `perf-frontend/` | measured front-end performance | `zz_perf_*.test.tsx` copy into `frontend/src/`; `zz_perf_vite.config.ts` is a chunk-composition reporter (`npx vite build -c zz_perf_vite.config.ts`); `pw-*.cjs` are Playwright drives against `uv run objectapp --space <copy> --port <n> --browser`; `*.txt` are the recorded results |
