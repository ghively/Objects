# Handoff: pick up Object from a clean clone

Written 2026-10-26 by Gene Hively's local Claude session. You are continuing development of "Object", a local Markdown-backed recreation of Object. Read this file, then `CLAUDE.md` (rules), then `CONTINUE.md` (status and process). Everything else is linked from those.

## Where things stand

- **M1, M2:** built and tested. Gene's hands-on checks on a CPI export copy are open (he does those locally).
- **M3 (views, collections, queries):** all 16 tasks are built and committed (`a89c8cb..bd386e6`). It has NOT had its whole-milestone review, fix pass or final gate. Task 16's own results: 445 back-end and 465 front-end tests passing, `tsc` clean, build ok, `scripts/m3_acceptance.py` PASS on `space-sample` and `space-v1` (see `docs/superpowers/plans/m3-acceptance.md`; its hand-check list is Gene's).
- **M4 (calendar, daily notes, tasks):** planned in `docs/superpowers/plans/2026-10-26-m4-calendar-daily-tasks.md` (16 tasks, critiqued and revised), not built. **Do not start M4 planning or building until Gene says so.**
- **M5-M7:** listed in `docs/superpowers/plans/remaining-work.md`, no plans yet.

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
