# Handoff: pick up Object

Updated 2026-11-08 (M1-M27 are built, gated and on `master`; the 2026-11-07 bug audit is fixed and merged (PR #12); the copy rewrite and the `structure` to `type` rename are merged (PR #13); the 2026-11-08 sweep's fixes are on `ccr-ad9683a8-vdfntz`). You are continuing "Object", a local, Markdown-backed notes app with its own object model. A space keeps its metadata in `.object/` and its cache in `.object-cache/`. Read this file, then `CLAUDE.md` (rules), then `CONTINUE.md` (process). The long history and every gate's numbers live in `docs/superpowers/plans/remaining-work.md`.

## Where things stand

- **M1-M27 are all built and on `master`** (2026-11-07). `master` is the default branch (no `main`).
- **Gate (Linux):** back-end 3139 passed (15 skipped, 3 xpassed; `test_m24_loop.py::test_not_before_and_reorder` failed once under full-suite load and passes alone and with its file, a timing flake), front-end 3803 passed, `tsc`, lint and `npm run build` clean. Every acceptance script PASS: `m1_roundtrip.py`, `m2`-`m21` and `m25`-`m27` on `space-sample` and `space-v1`; `m15`, `m22`-`m27` on their default spaces.
- **PR #13 (2026-11-08, `cbfde62`):** every UI string rewritten in Object's own words, and `structure` renamed to `type` across the data model (`structureId` to `typeId`, …) with a compatibility layer (`backend/objectapp/keycompat.py`, `KeyCompatMiddleware`, `frontend/src/lib/keyCompat.ts`) so older spaces keep loading; a file gets the new keys the next time it is saved. Its labels no longer match `docs/behavior-catalog.md` §1, §2, §7 (Gene's call, sweep finding 12).
- **Bug and polish sweep (2026-11-08):** `docs/superpowers/plans/bug-audit-2026-11-08.md`. Eight read-only reviewers at `cbfde62`, 60 findings; 52 fixed on `ccr-ad9683a8-vdfntz` (one `fix(sweep)` commit each, with a regression test, seven lanes by file ownership merged `--no-ff`), gate after the fixes: back end 3259 passed, 0 failed; front end 3919 passed; tsc, lint, build clean; acceptance 52/52 PASS; Gene then decided the open points the same day ("Decisions taken" and "Round 2" in that file) and they were built: the catalog follows PR #13's words, weeks follow the "Start of the week" setting everywhere, the whiteboard values stay and the M6 plan follows, menus in sentence case, API messages as full sentences (kept by `test_api_message_style.py`), the daily-note peek header, a version line in Settings, Ctrl+Shift+T / Ctrl+Shift+V / Ctrl+Alt+H / Ctrl+O bound, "Delete 1 object" everywhere. Gate after round 2: back end 3266 passed, 0 failed; front end 3945 passed; tsc, lint, build clean; acceptance 52/52 PASS. A third round (2026-11-09) reviewed the whole branch once (no HIGH; one MEDIUM, all fixed), bound the remaining editor keys (Ctrl+Plus/Minus, Ctrl+Shift+G, Ctrl+Shift+E/X), and closed four older review items on Gene's decisions: Retry on a failed Approve step asks for approval again, agent runs can't use the app's own `/api` routes (`runfence.py`, needs `psutil`), a moved import source is matched, a moved remote agent address waits for confirmation. Gate after round 3: back end 3287 passed, 0 failed; front end 3984 passed; tsc, lint, build clean; acceptance 52/52 PASS. Left: the fence's glob characters and the `--resume` check (live CLI only); a Windows hand-check of the run fence.
- **Bug audit (2026-11-07/08):** `docs/superpowers/plans/bug-audit-2026-11-07.md`. 45 of 46 findings fixed and merged in PR #12 (`a66889a`) (one `fix(audit-N)` commit each, with a regression test), one review, one fix pass (`fix(audit-review)`); gate after: back end 3206 passed, 0 failed; front end 3879 passed; tsc, lint, build clean; every acceptance script PASS. The M24 loop "timing flake" was a race in the test-only `wait_idle` and is fixed. Gene's calls are under "Fix status" in that file (CR-only files read-only, blocks that now open raw, agent secrets in the run's `mcp.json`, `CLAUDE_CONFIG_DIR` passed through, the ledger cap, new strings; finding 24 left by design).
- **Reviews done:** M23, M24 and M25-M27 each had one review and one fix pass. M19-M22 were reviewed on their build tracks.
- **Open review items for Gene's call (not changed):** from the M24 list, no auto-run depth cap, and the learning and A2A routes rely on the CLI tool lists only. The other M24, M25-M27 and M20 item 5 items were closed on 2026-11-09 (see `m24-acceptance.md`, `m27-acceptance.md`, `m20-acceptance.md`).
- **Not done:** Gene's hand-checks for M1-M27 (none ticked, `docs/superpowers/plans/mN-acceptance.md`, plus `m27-ui-acceptance.md`); his decisions at the top of `remaining-work.md`; pywebview window, Windows toasts, Wacom, OCR (needs `tesseract` installed) and the real `claude` CLI/Atlassian MCP were never exercised.

Milestones and plans (`docs/superpowers/plans/`): M1-M9 the base app; M10 AI assistant, M11 local API and MCP server, M12 property kinds, M13 view layouts, M14 automations, M15 importers; M16 chat polish and model picker, M17 agents and tools, M18 learning, M19 MCP gateway, M20 A2A and delegation, M21 schedules (design: `specs/2026-11-05-agents-design.md`); M22 work model, M23 Work section, M24 brain dump and agent loop (design: `specs/2026-11-05-work-dashboard-design.md`); M25 provenance and re-runs, M26 readers and the scan, M27 the agent workflow (design: `specs/2026-11-06-import-migration-design.md`; plans `2026-11-06-m25-provenance-and-reruns.md`, `2026-11-06-m26-readers-and-scan.md`, `2026-11-06-m27-agent-workflow.md`). Each built milestone has `mN-acceptance.md` (Gene's hand-checks, unticked, plus deviations; M27 also `m27-ui-acceptance.md`) and `scripts/mN_acceptance.py`. The feature branches (`feat/m10` to `feat/m15`, `feat/m16-m24`, `feat/m22-m23`, `fix/deleted-type-queries`) and the old `ccr-*` branches are merged or obsolete; `master` is the only live line.

## What to do next, in order

1. **Set up** (fresh clone): install `uv` and Node 22+; `uv sync`; `cd frontend && npm ci` (not `npm install`).
2. **Gene's hands-on checks**, M1-M27 (about 435 unticked boxes: 255 for M1-M9, 37 for M10-M15, 134 for M16-M27 and 9 in `m27-ui-acceptance.md`; `hands-on-checklist.md` merges the M1-M9 ones), on a copy of his space (never his real data first), and the fixes they produce.
3. **The sweep's decisions** (`bug-audit-2026-11-08.md`, "Decisions for Gene") and **the open review items** above.

How Gene wants it built (2026-11-06): **parallel tracks by file ownership, a quick check per milestone, and one full gate per track plus one at the end, not a full gate after every milestone.** A workflow must record task results sorted by task number, so a resumed run hits its cache. The previous script ordered them by finish time, which broke resumes and rebuilt finished milestones. The two-track script is at `~/.claude/projects/C--Git-object/412d563a-525c-462f-98d8-9a68624a5e84/workflows/scripts/object-build-two-tracks-wf_9e539a30-330.js`; it can only be resumed from the same session, so copy its structure instead.

## Decisions Gene made (2026-11-05 / 06)

- Agents run only through the `claude` CLI under Gene's login. Never read `~/.claude/.credentials.json` or reuse a Claude token. Each agent is its own Claude Code project folder, loading only that folder's settings. **Agent runs get a `claudeMdExcludes` skip list** (Gene's `~/.claude/CLAUDE.md` and every ancestor folder's `CLAUDE.md`, `.claude/CLAUDE.md` and `CLAUDE.local.md`), because the M17 spike found those leaking in (`m17-cli-spike.md`).
- Patterns from an open-source agent are adopted, but it is never named in the repo.
- The Work agent has shell on (Gene's choice, warned); other agents have shell off and file tools fenced from space folders.
- Editor: a page link can switch between a card and an inline link (`3bc8925`): the card's `…` menu has **Turn into inline link**, and the block menu has **Turn into card** on a line holding only a link. "Always create inline links" (Settings > Editor) already existed.
- Import and migration design approved 2026-11-06 and built as M25-M27 (`specs/2026-11-06-import-migration-design.md`).

## Open review items to look at during the final review

- The M24 and M25-M27 lists are under "Where things stand" above.
- Every milestone's deviations are listed in its `mNN-acceptance.md`.

## Rules that bite

- Fidelity to the behaviour catalog (`docs/behavior-catalog.md`), the design specs and the plans is the bar. Don't over-engineer, and don't invent schema.
- Review once per milestone, fix once; no per-task review loops.
- No real CPI data in the repo; fixtures are synthetic. Never touch `C:\Git\wiki`. `C:\Git\ticket-dashboard` may be read, never changed.
- Opening a space never writes `.md` files. Edits change only their own lines. Deletes go to the Trash. Preserve CRLF/BOM. Write atomically. The server binds 127.0.0.1 only.
- Tests use the fake `claude` (`backend/tests/fake_claude.py`) and `OBJECT_STATE_DIR` pointing at a temp folder; never write to `~/.claude`.
- Commit only your own files, by explicit path. Commits end with a `Co-Authored-By:` trailer for the model that made them (and the `Claude-Session:` trailer when the session gives one). The untracked `.claude/` folder stays untracked.
- Windows: timing tests and acceptance scripts can flake under load (file-in-use on cleanup). Rerun one alone before calling it a failure.
