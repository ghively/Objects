# Continuing development

Everything needed to resume is in this repo. Rules and layout: `CLAUDE.md`. Where things stand and what to do first: `HANDOFF.md`. Process and lessons: `docs/superpowers/build-process.md`.

## Status

M1-M27 are all built, gated and on `master` (2026-11-07). Take the current state, gate numbers and open items from `docs/superpowers/plans/remaining-work.md`, `HANDOFF.md` and `git log`; this file doesn't track them. What is left is Gene's hand-checks (all unticked, `plans/m1-acceptance.md` to `plans/m27-acceptance.md` and `plans/m27-ui-acceptance.md`), his decisions at the top of `remaining-work.md`, and the open review items in `HANDOFF.md`.

## Polish backlog

The 2026-11-02 backlog (`docs/superpowers/plans/polish-audit-2026-11-02.md`, "Consolidated backlog") was built on 2026-11-03/04; what is still open is the "Not yet poked" list there. Use `docs/behavior-catalog.md` as the behaviour reference (labels, order, shortcuts, menus). Keep unlinked mentions working. Do one item per commit with a test; run the full gate before each commit.

## The next step, in order

1. **Work the open list** at the top of `docs/superpowers/plans/remaining-work.md` (Gene's decisions, the open review items), then **fix what Gene's hand-checks find** (both audit lists, the polish backlog and M1-M27 are done and merged).
   - Do one finding per commit, each with a regression test that fails before the fix.
2. **Gate.** Run `uv run pytest backend/tests -q` and `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run build`. Run `scripts/m1_roundtrip.py` on a copy of `backend/tests/fixtures/space-sample`, and `scripts/m2_acceptance.py` through `m27_acceptance.py` on `space-sample` and `space-v1` (they copy the space themselves; some use their own default space; the exact command is in each `mN-acceptance.md`, e.g. `PYTHONPATH=scripts:backend uv run python scripts/m24_acceptance.py`). Then start the app on a scratch copy and look at what changed.
3. **Write it down.** Update `remaining-work.md` and `HANDOFF.md`, and commit (push only when Gene asks).
4. **Larger new work** (an installer, the `C:\Git\wiki` migration, the later integrations): write a plan first, following the M7/M8 plan format, then build it as below.

## Running a build

On a fresh machine: install `uv` and Node 22+, then `uv sync` and `cd frontend && npm ci`.

Build workflows (they need the Workflow tool) are in `scripts/workflows/`:
- `object-milestone-build.js`: the M1–M3 script, with two tracks (backend, frontend) and the three-lens review. Its args look like `{"plan":"…","base":"<sha>","backend":[…],"frontend":[…],"integrate":N,"milestone":"Milestone N","perTaskReview":false}`.
- `object-milestone-review-gate.js`: review, fix and gate only, for an already-built milestone.
- `object-milestones-lanes.js`: the M4–M7 script. It reads a plan's "## Build lanes" section, so each lane runs its first tasks in order and then its sub-lanes in parallel. It builds two milestones at once when one only creates new files until its integrate task. It runs one combined review, a gate and a push per milestone.
- **M10-M27** were built on parallel tracks by file ownership (see `HANDOFF.md` for how Gene wants it built): per milestone a plan, the tasks with their own tests, an integrate task (`scripts/mN_acceptance.py` and `mN-acceptance.md`), then one review, one fix pass and a gate per track.
- **The 2026-11-01 audit and its fix pass** ran the same way as M9: eight read-only auditors in parallel (six areas plus two measured performance audits), one audit doc with Gene's decisions, then seven fix lanes in worktrees by file ownership, a two-half review, a two-agent review fix pass, the gate, a re-measurement.
- **M9 was built without a workflow script:** Task 1 by hand, then one background agent per lane, each in its own git worktree (`isolation: worktree`, `node_modules` symlinked from the main checkout), merged with `--no-ff`; then acceptance and a two-half review in parallel, a two-agent fix pass split by file ownership, and the gate run serially by hand.
- `object-m8-build.js`: the M8 script. One agent writes the plan with a "## Coverage" table, one installs the dependencies up front, then it builds the lanes, integrates, reviews once, fixes, gates and pushes.

The saved copies are reference versions: edit the plan paths and milestone list before reusing them. Keep the machine awake for the whole run. To pause, stop the workflow and relaunch with the same script and `resumeFromRunId` in the same session; completed agents replay from cache. A session usage limit or a container restart stops the run, and a resume recovers it.

## Behaviour reference

`docs/behavior-catalog.md` (labels, menus, shortcuts, order) and the design spec (`docs/superpowers/specs/2026-10-23-object-design.md`) are the reference for behaviour, labels and values. The guessed values listed in `remaining-work.md` ("What is left", item 2) are the ones neither settles yet.

## On-disk format

A space keeps its metadata in `.object/` (types, collections, queries, UI state, trash) and its rebuildable cache in `.object-cache/`. Spaces made before 2026-11-04 used older folder names; they are renamed to these once, automatically, on open, and no `.md` file is changed.

## Out of scope (by design)

Accounts, login, billing, sync, sharing, mobile, telemetry, migrating `C:\Git\wiki` (a separate project). The network integrations (calendar feeds, Readwise, Kindle, Telegram, WhatsApp, email, Raycast) are wanted later at lower priority. AI, the local API and MCP server, agents, the Work section and import are built (M10-M27). Object Team (`docs/superpowers/specs/2026-10-28-object-team-design.md`) is parked.
