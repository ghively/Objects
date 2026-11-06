# Handoff: pick up Object

Updated 2026-11-06 (after M24; M1-M24 are built). You are continuing "Object", a local, Markdown-backed notes app with its own object model. A space keeps its metadata in `.object/` and its cache in `.object-cache/`. Read this file, then `CLAUDE.md` (rules), then `CONTINUE.md` (process). The long history and every gate's numbers live in `docs/superpowers/plans/remaining-work.md`.

## Where things stand

- **M1-M24 are all built and on `master`** (2026-11-06). `master` is the default branch (no `main`). The feature branches are merged and can be deleted.
- **Gate (Linux, 2026-11-06):** back-end 3058+ tests passed (3 tests that pinned pre-M24 defaults were updated), front-end 3775 passed, `tsc` clean, lint clean, `npm run build` ok. Every acceptance script PASS: `m1_roundtrip.py`, `m2`-`m21` on `space-sample` and `space-v1`, `m22`-`m24` on `space-work`.
- **Reviews done:** M23 (8 fixes) and M24 (5 fixes) were reviewed once and fixed. M19-M22 had their per-milestone reviews on their build tracks.
- **Open items from the M24 review, for Gene's call (not changed):** Retry re-runs a timed-out or crashed Approve step with the full tool set and no new approval; the learning and A2A agent routes are not covered by the read-only write guard (only the CLI tool lists block them); a full-tool work run can reach the app's local routes (self-approval, marking tools read-only); `file_capture` is not atomic (a conflict can duplicate a note); the auto-run chain has no depth cap; the answer/question prompts mention fields that the read-only tools can't change; a restart can queue a failed capture once more. Details in the M24 review notes in `m24-acceptance.md`.
- **Not done:** Gene's hand-checks for M1-M24 (none ticked); his decisions at the top of `remaining-work.md`; M25-M27 (import and migration) are designed but not planned.

Milestones and plans (`docs/superpowers/plans/`): M16 chat polish and model picker, M17 agents and tools, M18 learning, M19 MCP gateway, M20 A2A and delegation, M21 schedules (designs: `specs/2026-11-05-agents-design.md`); M22 work model, M23 Work section, M24 brain dump and agent loop (design: `specs/2026-11-05-work-dashboard-design.md`). Each built milestone has `mNN-acceptance.md` (Gene's hand-checks, unticked, plus deviations) and `scripts/mNN_acceptance.py`.

**Update (M24):** M23's integrate task has since been done (`scripts/m23_acceptance.py`, `m23-acceptance.md`, the `fix(m23)` commits) and M24 is built and integrated on `ccr-381ccf85-cjstne` (`scripts/m24_acceptance.py` PASS; `m24-acceptance.md` lists its deviations and 12 hand-checks). **M1-M24 are all built.** What is left: one review of M19-M24, one fix pass, the final full gate (a Linux run was in progress on 2026-11-06; numbers go in `remaining-work.md`), merging the branch to `master`, and Gene's hand-checks. Steps 2, 3 and 5 below are therefore done or reduced to that review and gate.

## What to do next, in order

1. **Set up** (fresh clone): install `uv` and Node 22+; `uv sync`; `cd frontend && npm ci` (not `npm install`).
2. **Gene's hands-on checks**, M1-M24 (`docs/superpowers/plans/mN-acceptance.md`), on a copy of his space, and the fixes they produce.
3. **The open review items** above, then **plan M25-M27** from `docs/superpowers/specs/2026-11-06-import-migration-design.md` against the code as built.

How Gene wants it built (2026-11-06): **parallel tracks by file ownership, a quick check per milestone, and one full gate per track plus one at the end, not a full gate after every milestone.** A workflow must record task results sorted by task number, so a resumed run hits its cache. The previous script ordered them by finish time, which broke resumes and rebuilt finished milestones. The two-track script is at `~/.claude/projects/C--Git-object/412d563a-525c-462f-98d8-9a68624a5e84/workflows/scripts/object-build-two-tracks-wf_9e539a30-330.js`; it can only be resumed from the same session, so copy its structure instead.

## Decisions Gene made (2026-11-05 / 06)

- Agents run only through the `claude` CLI under Gene's login. Never read `~/.claude/.credentials.json` or reuse a Claude token. Each agent is its own Claude Code project folder, loading only that folder's settings. **Agent runs get a `claudeMdExcludes` skip list** (Gene's `~/.claude/CLAUDE.md` and every ancestor folder's `CLAUDE.md`, `.claude/CLAUDE.md` and `CLAUDE.local.md`), because the M17 spike found those leaking in (`m17-cli-spike.md`).
- Patterns from an open-source agent are adopted, but it is never named in the repo. The original notes app this project was modelled on is never named either.
- The Work agent has shell on (Gene's choice, warned); other agents have shell off and file tools fenced from space folders.
- Editor: a page link can switch between a card and an inline link (`3bc8925`): the card's `…` menu has **Turn into inline link**, and the block menu has **Turn into card** on a line holding only a link. "Always create inline links" (Settings > Editor) already existed.
- Import and migration design approved (step 7 of "What to do next").

## Open review items to look at during the final review

- M20 review item 5 (needs Gene's call): Refresh sends the stored token to the card's host even when the card moved its endpoint to another host. The plan contradicts itself here.
- `scripts/m2_acceptance.py` got a retry around removing the copied space (`0288958`). The stopped gate left it uncommitted, and it hasn't been re-run.
- Every milestone's deviations are listed in its `mNN-acceptance.md`.

## Rules that bite

- Fidelity to the behaviour catalog (`docs/behavior-catalog.md`), the design specs and the plans is the bar. Don't over-engineer, and don't invent schema.
- Review once per milestone, fix once; no per-task review loops.
- No real CPI data in the repo; fixtures are synthetic. Never touch `C:\Git\wiki`. `C:\Git\ticket-dashboard` may be read, never changed.
- Opening a space never writes `.md` files. Edits change only their own lines. Deletes go to the Trash. Preserve CRLF/BOM. Write atomically. The server binds 127.0.0.1 only.
- Tests use the fake `claude` (`backend/tests/fake_claude.py`) and `OBJECT_STATE_DIR` pointing at a temp folder; never write to `~/.claude`.
- Commit only your own files, by explicit path. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The untracked `.claude/` folder stays untracked.
- Windows: timing tests and acceptance scripts can flake under load (file-in-use on cleanup). Rerun one alone before calling it a failure.
