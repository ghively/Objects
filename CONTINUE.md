# Continuing development

Everything needed to resume is in this repo. Rules and layout: `CLAUDE.md`. Where things stand and what to do first: `HANDOFF.md`. Process and lessons: `docs/superpowers/build-process.md`.

## Status

Take the current state from `docs/superpowers/plans/remaining-work.md` and `git log`; this file doesn't track it. As of 2026-10-28:
- **Built:** M1–M8 are built, reviewed, fixed and gated. M8 covers every Object feature M4–M7 had deferred, local only.
- **Out of scope by the spec:** AI, network integrations, accounts, mobile, telemetry.
- **Pending:** Gene's hand-checks, all milestones (`plans/m1-acceptance.md` to `plans/m8-acceptance.md`, all unchecked).

## The next step, in order

1. **Fix the 2026-10-28 audit list, then what Gene's hand-checks find.**
   - The audit list is `docs/superpowers/plans/audit-2026-10-28.md`; work it top down. Its repro scripts are in `scripts/audit-2026-10-28/` (see the README there).
   - Do one finding per commit, each with a regression test that fails before the fix.
   - The completeness gaps need Gene's yes or no before any building.
2. **Gate.** Run `uv run pytest backend/tests -q` and `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run build`. Run `scripts/m1_roundtrip.py` on a copy of `backend/tests/fixtures/space-sample`, and `scripts/m2_acceptance.py` through `m8_acceptance.py` on `space-sample` and `space-v1` (they copy the space themselves). Then start the app on a scratch copy and look at what changed.
3. **Write it down.** Update `remaining-work.md` and `HANDOFF.md`, commit and push.
4. **Larger new work** (an installer, the in-app agent, the `C:\Git\wiki` migration): write a plan first, following the M7/M8 plan format, then build it as below.

## Running a build

On a fresh machine: install `uv` and Node 22+, then `uv sync` and `cd frontend && npm ci`.

Build workflows (they need the Workflow tool) are in `scripts/workflows/`:
- `object-milestone-build.js`: the M1–M3 script, with two tracks (backend, frontend) and the three-lens review. Its args look like `{"plan":"…","base":"<sha>","backend":[…],"frontend":[…],"integrate":N,"milestone":"Milestone N","perTaskReview":false}`.
- `object-milestone-review-gate.js`: review, fix and gate only, for an already-built milestone.
- `object-milestones-lanes.js`: the M4–M7 script. It reads a plan's "## Build lanes" section, so each lane runs its first tasks in order and then its sub-lanes in parallel. It builds two milestones at once when one only creates new files until its integrate task. It runs one combined review, a gate and a push per milestone.
- `object-m8-build.js`: the M8 script. One agent writes the plan with a "## Coverage" table, one installs the dependencies up front, then it builds the lanes, integrates, reviews once, fixes, gates and pushes.

The saved copies are reference versions: edit the plan paths and milestone list before reusing them. Keep the machine awake for the whole run. To pause, stop the workflow and relaunch with the same script and `resumeFromRunId` in the same session; completed agents replay from cache. A session usage limit or a container restart stops the run, and a resume recovers it.

## Reference material

`reference/` holds a trimmed subset of Object's design notes (`design-notes`), English UI strings (`docs/strings.txt`) and CSS (`docs/design.css`). Read it for behaviour, labels and values only. It was recovered from the Object desktop installer, which is not in the repo (`*.exe` and `Object*.zip` are git-ignored). If work needs another file from the full unpacked app (`.reference/` on Gene's PC), add that single file under `reference/` at the same relative path. The guessed values listed in `HANDOFF.md` are the main candidates.

## Out of scope (by design)

Accounts, login, billing, sync, sharing, mobile, integrations, AI features (a Claude Code agent comes later), telemetry, importing Object data, migrating `C:\Git\wiki`.
