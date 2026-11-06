# Handoff: pick up Object

Updated 2026-11-06 (after M24; M1-M24 are built). You are continuing "Object", a local, Markdown-backed notes app with its own object model. A space keeps its metadata in `.object/` and its cache in `.object-cache/`. Read this file, then `CLAUDE.md` (rules), then `CONTINUE.md` (process). The long history and every gate's numbers live in `docs/superpowers/plans/remaining-work.md`.

## Where things stand

- **`master` (`6ac46a5`, 2026-11-06) holds M1-M23.** Both build tracks were merged into it: `feat/m16-m24` (M16-M21) and `feat/m22-m23` (M22-M23). `master` is the default branch; there is no `main`. Both feature branches are merged and can be deleted; the old `ccr-*` branches are earlier sessions already folded in.
- **Merge verification (Linux):** 2972 back-end tests passed (15 skipped, 3 xpassed); 3755 front-end tests passed (1 skipped); `tsc` clean; `npm run build` ok. Merge conflicts were only in `server.py`, `CONTINUE.md` and `remaining-work.md` (both sides kept). `test_topup_adds_occurrence_log_once` was relaxed: M22 adds Task fields after `occurrenceLog`. **Not run on the merged tree:** `npm run lint`, `m1_roundtrip.py` and every `mN_acceptance.py`.
- **Not done:** the track's full gate was stopped mid-run before the merge; M19-M21 and M22 were quick-checked only; **M23's integrate task, review and fix pass never ran** (it has no `m23-acceptance.md` or `scripts/m23_acceptance.py`; its last commit, the Now view, was written with no test run); M24 is not built. Gene's hand-checks for M1-M23 are all unticked.

Milestones and plans (`docs/superpowers/plans/`): M16 chat polish and model picker, M17 agents and tools, M18 learning, M19 MCP gateway, M20 A2A and delegation, M21 schedules (designs: `specs/2026-11-05-agents-design.md`); M22 work model, M23 Work section, M24 brain dump and agent loop (design: `specs/2026-11-05-work-dashboard-design.md`). Each built milestone has `mNN-acceptance.md` (Gene's hand-checks, unticked, plus deviations) and `scripts/mNN_acceptance.py`.

**Update (M24):** M23's integrate task has since been done (`scripts/m23_acceptance.py`, `m23-acceptance.md`, the `fix(m23)` commits) and M24 is built and integrated on `ccr-381ccf85-cjstne` (`scripts/m24_acceptance.py` PASS; `m24-acceptance.md` lists its deviations and 12 hand-checks). **M1-M24 are all built.** What is left: one review of M19-M24, one fix pass, the final full gate (a Linux run was in progress on 2026-11-06; numbers go in `remaining-work.md`), merging the branch to `master`, and Gene's hand-checks. Steps 2, 3 and 5 below are therefore done or reduced to that review and gate.

## What to do next, in order

1. **Set up** (fresh clone): install `uv` and Node 22+; `uv sync`; `cd frontend && npm ci` (not `npm install`). Work on `master`; the `object-work` worktree is no longer needed.
2. **Finish M23**: run its integrate task (the last task in `2026-11-05-m23-work-section.md`: wire the lanes together, write `scripts/m23_acceptance.py` and `m23-acceptance.md`). Open item from Task 10: `NowSide.tsx` keeps three of our strings (`No more meetings today`, `Steps done today`, `Focus`) as local constants instead of in `WORK_TEXT`.
3. **One review of M19-M23** (correctness, file safety, fidelity), one fix pass, then the **full gate**: `uv run pytest backend/tests -q` (about 12 minutes); `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run lint && npm run build`; `m1_roundtrip.py` plus every `mN_acceptance.py`, on copies of `space-sample` and `space-v1` (`m22`+ also on `space-work`).
4. *(done 2026-11-06: the two tracks are merged.)*
5. **Build M24** (`2026-11-05-m24-brain-dump-and-agent-loop.md`). It needs both tracks.
6. **Final full gate** (step 3's list), update `remaining-work.md` / `CONTINUE.md` / this file, and push to `master`.
7. **Then:** plan M25-M27 from the approved import design (`docs/superpowers/specs/2026-11-06-import-migration-design.md`: provenance and re-runs; Office/PDF readers and the sensitive scan; schema proposal, AI filing pass and the "Migrate a source" skill). Write the plans against the code as built after M24.

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
