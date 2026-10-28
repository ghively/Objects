# Handoff: pick up Object from a clean clone

Written 2026-10-26 by Gene Hively's local Claude session. You are continuing development of "Object", a local Markdown-backed recreation of Object. Read this file, then `CLAUDE.md` (rules), then `CONTINUE.md` (status and process). Everything else is linked from those.

## Where things stand

- **M1, M2:** built and tested. Gene's hands-on checks on a CPI export copy are open (he does those locally).
- **M3 (views, collections, queries):** built, reviewed, fixed and through its final gate on 2026-10-26 (459 back-end tests, 479 front-end tests (66 files), `tsc -b --noEmit` clean, `npm run build` ok; `m1_roundtrip.py` PASS, `m2_acceptance.py` PASS (52/52 checks on `space-sample`, 50/50 on `space-v1`), `m3_acceptance.py` PASS (14/14 checks on each); the built app served headless on a scratch copy of `space-sample` rendered home, a type page (Overview and All), a collection, a query, the Queries page and All notes in Playwright with 0 console errors). Gene's hand-check list in `docs/superpowers/plans/m3-acceptance.md` is pending.
- **M4 (calendar, daily notes, tasks):** built (`c771907..d97c007`, plan `docs/superpowers/plans/2026-10-26-m4-calendar-daily-tasks.md`), fix `4fc0b85`, final gate green 2026-10-27 at `4fc0b85`: 611 back-end tests, 654 front-end tests (99 files), `tsc -b --noEmit` clean, `npm run build` ok; on `space-sample`: `m1_roundtrip.py` PASS, `m2_acceptance.py` PASS (52/52), `m3_acceptance.py` PASS (14/14), `m4_acceptance.py` PASS (24/24). Gene's hand-check list in `docs/superpowers/plans/m4-acceptance.md` is pending.
- **M5 (search, palette, backlinks, graph) and M6 (whiteboards and pen):** built, reviewed (fixes `5193e60`, `c4a087c`), final gate green 2026-10-27 at `c4a087c`: 854 back-end tests, 1013 front-end tests, `tsc -b --noEmit` clean, `npm run build` ok; on `space-sample` `m1_roundtrip.py` and `m2`–`m6_acceptance.py` all PASS (52/52, 14/14, 24/24, 18/18, 19/19). Gene's hand-checks (`plans/m5-acceptance.md`, `plans/m6-acceptance.md`, including the Wacom pressure check) are pending.
- **M7 (remaining blocks, light mode, polish):** built (`f98e401`..`dd3c63e`), acceptance `60e40e8`, review fixes `1f3802f`, `338a42f`; final gate green 2026-10-27 at `338a42f`: 934 back-end tests, 1338 front-end tests, `tsc -b --noEmit` clean, `npm run build` ok; on `space-sample` `m1_roundtrip.py` and `m2`–`m7_acceptance.py` all PASS (52/52, 14/14, 24/24, 18/18, 19/19, 23/23). All milestones are built; Gene's hand-checks (`plans/m1-acceptance.md` to `plans/m7-acceptance.md`, including the M7 side-by-side fidelity pass) are pending.
- **M8 (every Object feature M4–M7 deferred, local only):** built (plan `2026-10-27-m8-deferred-features.md`, 31 tasks), review fixes `f404324`, `0e7c748`; final gate green 2026-10-28 at `0e7c748`: 1119 back-end tests, 1672 front-end tests, `tsc -b --noEmit` clean, `npm run build` ok; `m1_roundtrip.py` PASS, and `m2`–`m8_acceptance.py` all PASS on `space-sample` and `space-v1` (m8: 26/26). Gene's hand-checks (`plans/m8-acceptance.md`) are pending.

## What to do first

1. Set up: install `uv` and Node; `uv sync`; `cd frontend && npm install`.
2. Run the baseline: `uv run pytest backend/tests -q` and `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run build`. Report any failure before changing code.
3. Finish M3: run `scripts/workflows/object-milestone-review-gate.js` with args
   `{"plan":"docs/superpowers/plans/2026-10-26-m3-views-collections-queries.md","base":"39432ce","milestone":"Milestone 3"}`
   (needs the Workflow tool; otherwise do the three review lenses, one fix pass and the gate by hand: correctness and integration, file safety, fidelity to Object). Review once, fix once, then the gate.
4. Verify yourself: the full suites above, `scripts/m1_roundtrip.py`, `scripts/m2_acceptance.py` and `scripts/m3_acceptance.py`, each run on a COPY of a fixture space (`backend/tests/fixtures/space-sample`, `space-v1`), then start the app on a scratch copy and exercise views, collections and queries.
5. Update `docs/superpowers/plans/remaining-work.md` and `CONTINUE.md`, commit, push, then give Gene the hand-check steps from `m3-acceptance.md` and STOP.

## Rules that bite

- Fidelity to Object is the bar; don't over-engineer; no invented schema.
- No per-task review loops. One review at the end of a milestone.
- No real CPI data in the repo; fixtures are synthetic. Never touch `C:\Git\wiki`.
- Opening a space never writes `.md` files; edits change only their own lines; deletes go to trash; preserve CRLF/BOM; atomic writes; server binds 127.0.0.1.
- `reference/` is a trimmed copy of Object's design notes, English strings and CSS: read it for behaviour, labels and values; never copy its code. Older docs and the build script's rules say `.reference/`; in a clone that means `reference/`.
- Plan parallelism from file ownership (`docs/superpowers/build-process.md`): one owning task per shared file, worktrees if tracks must overlap.
- Commit trailers: `Co-Authored-By:` the model that wrote the commit.

## Known gaps in this handoff

- This repo was developed on Windows 11. `m3_acceptance.py`, the app launch and some paths are untested on Linux; expect small path or shell fixes, and say so rather than hiding them.
- The local workflow run cache (`wf_359eade1-0d4`) does not travel; use the review-gate script above.
- `editor/preserve.test.ts` "1MB body splits under 300ms" can fail on timing when the machine is loaded.
- Gene's work-export copy and the full unpacked Object app (`.reference/`) stay on his machine.
