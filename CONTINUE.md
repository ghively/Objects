# Continuing development

Everything needed to resume is in this repo. Rules and layout: `CLAUDE.md`. Process and lessons: `docs/superpowers/build-process.md`.

## Status

Always take the current state from `docs/superpowers/plans/remaining-work.md` and `git log`; this file doesn't track it. As of 2026-10-27:

- M1 (shell, objects on disk, editor) and M2 (types and properties) are built and verified by tests. Gene's hands-on checks on a copy of the CPI export are still open (`m1-acceptance.md`, `m2-acceptance.md`).
- M3 (views, collections, queries): built (`a89c8cb..bd386e6`), reviewed and fixed (`..925b023`), final gate green 2026-10-26 (459 back-end tests, 479 front-end tests (66 files), `tsc -b --noEmit` clean, `npm run build` ok; `m1_roundtrip.py` PASS, `m2_acceptance.py` PASS (52/52 checks on `space-sample`, 50/50 on `space-v1`), `m3_acceptance.py` PASS (14/14 checks on each); the built app served headless on a scratch copy of `space-sample` rendered home, a type page (Overview and All), a collection, a query, the Queries page and All notes in Playwright with 0 console errors). Gene's hand-checks (`plans/m3-acceptance.md`) are pending.
- Gene asked on 2026-10-26 for all remaining milestones to be built now; his hand-checks of each milestone are still pending and stay unchecked until he does them.
- M4 (calendar, daily notes, tasks): built (`c771907..d97c007`), fix `4fc0b85`, final gate green 2026-10-27 at `4fc0b85`: 611 back-end tests, 654 front-end tests (99 files), `tsc -b --noEmit` clean, `npm run build` ok; on `space-sample`: `m1_roundtrip.py` PASS, `m2_acceptance.py` PASS (52/52), `m3_acceptance.py` PASS (14/14), `m4_acceptance.py` PASS (24/24). Gene's hand-checks (`plans/m4-acceptance.md`) are pending.
- M5 (search, command palette, backlinks, graph), M6 (whiteboards and pen), M7 (remaining blocks, light mode, polish) are listed in `remaining-work.md` and have plans in `plans/` (M5, M6, M7) and are next.

## The next step, in order

1. Finish the open milestone: review once, fix pass, final gate (`uv run pytest backend/tests -q`; `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run build`; the acceptance scripts on fixture copies; start the app on a scratch copy of a sample space and look at it).
2. Update `remaining-work.md` and leave Gene the hand-check steps. (Gene, 2026-10-26: build all remaining milestones without waiting; his hand-checks come later.)
3. For a new milestone: write the plan (writer agent, three critics, one resolve pass, following the M3/M4 plan format), then build with `scripts/workflows/object-milestone-build.js`.

## Running a build

On a fresh machine: install `uv` and Node, then `uv sync` and `cd frontend && npm install`. The workflow scripts take an optional `repo` arg (the repo path) and default to the current working directory.

The script takes args like:

```json
{"plan":"docs/superpowers/plans/<plan>.md","base":"<HEAD sha>","backend":[1,2,3],"frontend":[4,5,6],"integrate":7,"milestone":"Milestone N","perTaskReview":false}
```

It builds backend and frontend tasks in tracks, then runs the integrate task, a three-lens whole-milestone review, a fix pass and a final gate. Add tracks when the plan's file ownership allows (see `build-process.md`). Its prompt rules refer to `.reference/`; in a clone use `reference/`. Keep the machine awake for the whole run. To pause, stop the workflow and relaunch with the same script and `resumeFromRunId`.

## Reference material

`reference/` holds a trimmed subset of Capacities' recovered models (`recovered-ts/`), English UI strings (`app-unpacked/dist/virtual_intlify-i18n-0366822.js`) and CSS (`app-unpacked/dist/index36682.css`), read for behaviour, labels and values only. It was recovered from the Capacities desktop installer, which is not in the repo (`*.exe` and `Capacities*.zip` are git-ignored). If a plan needs another file from the full unpacked app, add that single file under `reference/` at the same relative path.

## Out of scope (by design)

Accounts, login, billing, sync, sharing, mobile, integrations, AI features (a Claude Code agent comes later), telemetry, importing Capacities data, migrating `C:\Git\wiki`.
