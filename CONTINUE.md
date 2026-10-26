# Continuing development

Everything needed to resume is in this repo. Rules and layout: `CLAUDE.md`. Process and lessons: `docs/superpowers/build-process.md`.

## Status

Always take the current state from `docs/superpowers/plans/remaining-work.md` and `git log`; this file doesn't track it. As of 2026-10-26:

- M1 (shell, objects on disk, editor) and M2 (types and properties) are built and verified by tests. Gene's hands-on checks on a copy of the CPI export are still open (`m1-acceptance.md`, `m2-acceptance.md`).
- M3 (views, collections, queries): all 16 tasks built and committed (`a89c8cb..bd386e6`), stopped at the review gate. Still to do: whole-milestone review, one fix pass, the final gate, and Gene's hand-checks (`plans/m3-acceptance.md`). Resume with the build script and `resumeFromRunId wf_359eade1-0d4` if that run is still available, otherwise run the review, fix and gate stages by hand.
- M4 (calendar, daily notes, tasks) is planned (`plans/2026-10-26-m4-calendar-daily-tasks.md`, 16 tasks) but not built. Before building it, re-read what M3 actually produced and correct interface names in the plan.
- M5 (search, command palette, backlinks, graph), M6 (whiteboards and pen), M7 (remaining blocks, light mode, polish) are listed in `remaining-work.md` and need plans.

## The next step, in order

1. Finish the open milestone: review once, fix pass, final gate (`uv run pytest backend/tests -q`; `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run build`; the acceptance scripts on fixture copies; start the app on a scratch copy of a sample space and look at it).
2. Update `remaining-work.md`, give Gene the hand-check steps, then stop. Don't start the next milestone's planning or build until Gene says so.
3. For a new milestone: write the plan (writer agent, three critics, one resolve pass, following the M3/M4 plan format), then build with `scripts/workflows/object-milestone-build.js`.

## Running a build

The script takes args like:

```json
{"plan":"docs/superpowers/plans/<plan>.md","base":"<HEAD sha>","backend":[1,2,3],"frontend":[4,5,6],"integrate":7,"milestone":"Milestone N","perTaskReview":false}
```

It builds backend and frontend tasks in tracks, then runs the integrate task, a three-lens whole-milestone review, a fix pass and a final gate. Add tracks when the plan's file ownership allows (see `build-process.md`). Its prompt rules refer to `.reference/`; in a clone use `reference/`. Keep the machine awake for the whole run. To pause, stop the workflow and relaunch with the same script and `resumeFromRunId`.

## Reference material

`reference/` holds a trimmed subset of Capacities' recovered models (`recovered-ts/`), English UI strings (`app-unpacked/dist/virtual_intlify-i18n-0366822.js`) and CSS (`app-unpacked/dist/index36682.css`), read for behaviour, labels and values only. It was recovered from the Capacities desktop installer, which is not in the repo (`*.exe` and `Capacities*.zip` are git-ignored). If a plan needs another file from the full unpacked app, add that single file under `reference/` at the same relative path.

## Out of scope (by design)

Accounts, login, billing, sync, sharing, mobile, integrations, AI features (a Claude Code agent comes later), telemetry, importing Capacities data, migrating `C:\Git\wiki`.
