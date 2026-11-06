# Handoff: pick up Object

Updated 2026-11-06 (end of day). You are continuing "Object", a local, Markdown-backed notes app with its own object model. A space keeps its metadata in `.object/` and its cache in `.object-cache/`. Read this file, then `CLAUDE.md` (rules), then `CONTINUE.md` (process). The long history and every gate's numbers live in `docs/superpowers/plans/remaining-work.md`.

## Where things stand

- **`master`**: M1-M15, pushed. Gene's hand-checks for M1-M15 are still unticked (`docs/superpowers/plans/m1-acceptance.md` onward).
- **Gene paused the M16-M24 build on 2026-11-06** ("stop all the tests, let the code finish, don't start any new"). All code for M16-M23 is written; nothing is running. Two branches, both pushed:

| Branch | Where | Holds | State |
|---|---|---|---|
| `feat/m16-m24` | `C:\Git\object` | M16-M21 (agents), plus the card/inline-link switch and the import design | M16-M18 fully gated. M19, M20, M21 each built, reviewed, fixed and quick-checked (their own tests, tsc, their acceptance script: green). **The track's full gate was stopped mid-run.** |
| `feat/m22-m23` | worktree `C:\Git\object-work` (from `43a9407`) | M22-M23 (work dashboard) | M22 built, reviewed, fixed, quick-checked (green). **M23: every task committed** (last: `4fb8e94`, the Now view, written with no test run), **but its integrate task, review, fix pass and check never ran.** |

Milestones and plans (`docs/superpowers/plans/`): M16 chat polish and model picker, M17 agents and tools, M18 learning, M19 MCP gateway, M20 A2A and delegation, M21 schedules (designs: `specs/2026-11-05-agents-design.md`); M22 work model, M23 Work section, M24 brain dump and agent loop (design: `specs/2026-11-05-work-dashboard-design.md`). Each built milestone has `mNN-acceptance.md` (Gene's hand-checks, unticked, plus deviations) and `scripts/mNN_acceptance.py`.

## What to do next, in order

1. **Set up** (fresh clone): install `uv` and Node 22+; `uv sync`; `cd frontend && npm ci` (not `npm install`). The worktree has its own `frontend/node_modules`. To recreate it: `git worktree add C:\Git\object-work feat/m22-m23`, then `npm ci` in its `frontend`.
2. **Finish M23** in `C:\Git\object-work`: run its integrate task (the last task in `2026-11-05-m23-work-section.md`: wire the lanes together, write `scripts/m23_acceptance.py` and `m23-acceptance.md`). Then one whole-milestone review, one fix pass, and a quick check (M23's own test files, `npx tsc -b --noEmit`, `m23_acceptance.py`). Open item from Task 10: `NowSide.tsx` keeps three of our strings (`No more meetings today`, `Steps done today`, `Focus`) as local constants instead of in `WORK_TEXT`.
3. **Full gate on each branch** (one per track): `uv run pytest backend/tests -q`; `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run lint && npm run build`; `m1_roundtrip.py` plus every `mN_acceptance.py` that exists, on copies of `space-sample` and `space-v1`. The two branches can be gated side by side, since the acceptance scripts pick free ports.
4. **Merge** `feat/m22-m23` into `feat/m16-m24` (`git merge --no-ff`). Expect conflicts in `frontend/src/api/types.ts`, `api/client.ts`, `test/mockApi.ts`, `icons/appIcons.ts` (regenerate with `node scripts/app-icons.mjs`), `backend/objectapp/server.py`, `mcp_server.py` / `toolcatalog.py` and the catalogue-count test, the Settings sections, and the status docs. Keep both sides.
5. **Build M24** (`2026-11-05-m24-brain-dump-and-agent-loop.md`). It needs both tracks.
6. **Final full gate** (step 3's list, plus `m22`-`m24` acceptance on `space-work`), update `remaining-work.md` / `CONTINUE.md` / this file, and push. Then a PR `feat/m16-m24` to `master`, which Gene merges.
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
