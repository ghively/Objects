# Handoff: pick up Object from a clean clone

Updated 2026-11-02. You are continuing "Object", a local, Markdown-backed recreation of Object. Read this file, then `CLAUDE.md` (rules), then `CONTINUE.md` (process). Status lives in `docs/superpowers/plans/remaining-work.md`.

## Where things stand

**All nine milestones are built, reviewed, fixed and through their final gates.** Nothing is waiting on a build. M9 (the audit's completeness gaps) was built 2026-10-28 on a Linux cloud container on branch `ccr-bcf6e946-bf8moc`; results, open questions and Gene's hand-checks are in `docs/superpowers/plans/m9-acceptance.md`.

**The 2026-10-28 audit is fixed** (on Gene's Windows PC, same day): every bug in `docs/superpowers/plans/audit-2026-10-28.md` and every real "unconfirmed" item, one per commit with a failing-first test. **The guessed values were checked against the full Object app** (`docs/superpowers/plans/reference-check-2026-10-28.md`) and applied. Status and the gate numbers: `docs/superpowers/plans/remaining-work.md`.

**The 2026-11-01 full audit (bugs and optimization) is fixed, every item, in two passes,** (PR #4, merged; Linux cloud container): `docs/superpowers/plans/audit-2026-11-01.md` holds the findings, Gene's answers and the before/after numbers; the repro scripts are in `scripts/audit-2026-11-01/`. Headlines: opening a 5,000-object space warm 6 s → 0.6 s, a rename 4 s → 0.4 s, type saves no longer block reads for seconds, the kanban pages, the entry bundle 3.4 MB → 273 KB, and sixteen data-loss or security bugs closed.

**2026-11-02 polish audit:** `docs/object-behavior-catalog.md` records how Object actually behaves (read live, three spaces); `docs/superpowers/plans/polish-audit-2026-11-02.md` lists the differences, the fixes made and a consolidated backlog (A-H). Unlinked mentions must be kept (already in M5). Several local commits on `master` are not pushed; push only when Gene says so.

**Next:** work the open list at the top of `docs/superpowers/plans/remaining-work.md` and the polish audit's "Remaining tasks"; then Gene's hands-on checks, M1-M9. The audit fix pass (PR #4) and M9 (PR #3) are merged; `master` is the only branch to work on, and it is pushed (2026-11-02).

| Milestone | Scope | Plan |
|---|---|---|
| M1 | shell, objects on disk, block editor | `2026-10-23-m1-shell-objects-editor.md` |
| M2 | object types and all property kinds | `2026-10-23-m2-types-properties.md` |
| M3 | views, collections, queries, pinned, All notes | `2026-10-26-m3-views-collections-queries.md` |
| M4 | calendar, daily notes, tasks (recurrence, reminders) | `2026-10-26-m4-calendar-daily-tasks.md` |
| M5 | search (SQLite FTS5), Ctrl+K palette, backlinks, graph | `2026-10-26-m5-search-palette-backlinks-graph.md` |
| M6 | whiteboards and pressure ink | `2026-10-26-m6-whiteboards-pen.md` |
| M7 | remaining blocks, light mode, settings, spaces, tabs, side panel | `2026-10-26-m7-blocks-lightmode-polish.md` |
| M8 | every Object feature M4–M7 deferred, local only | `2026-10-27-m8-deferred-features.md` |
| M9 | the audit's completeness gaps | `2026-10-28-m9-completeness-gaps.md` |

Last full verification, 2026-11-02 on Linux after both audit fix passes (`71ef3b6`): 1469 back-end tests passed (1 skipped, 3 xpassed), 2284 front-end tests passed (1 skipped), `tsc` clean, lint 0 errors, build ok; every acceptance script PASS (`m1_roundtrip.py`, `m2`–`m9_acceptance.py` on `space-sample` and `space-v1`; `m9` on three more spaces). Details: `remaining-work.md`. Before that, 2026-10-29 on Windows after M9 was merged (`6ef3df8`): the same gate passed (1238 back-end, 1965 front-end), every acceptance script PASS; and at `35bbd88` on Linux:
- 1239 back-end tests passed (1 skipped: it needs a non-root user).
- 1966 front-end tests passed (1 skipped: it needs `OBJECT_ROUNDTRIP_SPACE`).
- `tsc -b --noEmit` clean; lint 0 errors; `npm run build` ok.
- `m9_acceptance.py` PASS on `space-m8`, `space-blocks`, `space-sample`, `space-v1`, `space-whiteboard`; `m1_roundtrip.py` and `m2`–`m8_acceptance.py` PASS on `space-sample` and `space-v1`.
- The app was started with `uv run objectapp --browser` and driven in headless Chromium through every M9 feature with 0 console errors.

## What to do first

1. Set up: install `uv` and Node 22+; run `uv sync`, then `cd frontend && npm ci`. Use `npm ci`, not `npm install`: a newer npm rewrites `package-lock.json`.
2. Run the baseline: `uv run pytest backend/tests -q`, then `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run build`. Report any failure before changing code.
3. **Both audits and M9 are done** (2026-10-28 and 2026-11-01). Don't redo them; `remaining-work.md`, `m9-acceptance.md` and `audit-2026-11-01.md` list what landed and what was left by choice.
4. Pick up Gene's findings from his hand-checks (`docs/superpowers/plans/m1-acceptance.md` to `m9-acceptance.md`, 256 unchecked items) and fix them the same way. After each batch, rerun the full gate and every acceptance script on fixture copies.
5. Keep `remaining-work.md`, `CONTINUE.md` and this file current, commit, and push.

## Open items

- **M9's rules for Gene to confirm:** see `m9-acceptance.md`, "Rules the build chose".

- **Gene's hands-on checks, M1–M9.** Run them on a copy of the CPI export outside the repo, with `git init` there. Some things can only be checked on his Windows machine:
  - the pywebview window
  - Windows toast reminders
  - Wacom pressure and tilt
  - microphone and clipboard permissions
  - real-size performance
  - the side-by-side look against Object, in all four themes
- **Guessed values.** The trimmed `reference/` lacks these, so they are best guesses, marked "our choice" in the acceptance docs:
  - the shortcut keys, all in `frontend/src/lib/shortcuts.ts`
  - the side-panel area layout, breadcrumbs, pinned tabs, slash and block menu looks
  - the search highlight colour and the graph limits
  - the M8 file formats (block ids and references, inline colours, date tokens, table formulas, embeds)
  - the layout switch points: a 480 px main-column minimum, and properties inline below 850 px
  - M3's default dashboard section tabs, which need the full `.reference/` on Gene's PC
- **Inferred Task types:** a Task type whose status options were inferred (as in the sample spaces) has no Done-category option, so tasks can't be completed until one is added. Check the CPI export for this (M4 finding).
- **Deferred by Gene:** TODO handling in the editor. Logseq-style markers were considered and rejected; Object's own to-do blocks stay.
- **Later:**
  - an installer (spec §6)
  - the in-app Claude Code agent (spec §2)
  - migrating `C:\Git\wiki` into Object's format (a separate project)

## Rules that bite

- Fidelity to Object is the bar; don't over-engineer; no invented schema.
- No per-task review loops. Review once at the end of a piece of work, fix once, then the gate.
- No real CPI data in the repo; fixtures are synthetic. Never touch `C:\Git\wiki`.
- Opening a space never writes `.md` files. Edits change only their own lines. Deletes go to trash. Preserve CRLF/BOM. Write atomically. The server binds 127.0.0.1 only.
- `reference/` is a trimmed copy of Object's design notes, English strings and CSS. Read it for behaviour, labels and values; never copy its code. Older docs and scripts say `.reference/`; in a clone that means `reference/`.
- Plan parallelism from file ownership (`docs/superpowers/build-process.md`): one owning task per shared file.
- Commit trailers: `Co-Authored-By:` the model that wrote the commit.

## Known gaps

- Since M3 the code was built and tested in a Linux cloud container. Windows (Gene's platform) has not been re-run since M2, so expect small path, shell or notification fixes there.
- Timing tests (`editor/preserve.test.ts` 1MB split, `test_search_p95_under_50ms_at_5000`) are sensitive to a busy machine. Rerun one alone before calling it a failure.
- Gene's work-export copy and the full unpacked Object app (`.reference/`) stay on his machine.
- Some audit findings show up on Windows but couldn't be tested in the container:
  - reserved names (`con`, `aux`, `nul`) used as type or collection ids
  - path-length limits
  - the pywebview window
  Re-check them on the PC.
- **Audit gate at `04e9d07` (Linux):**
  - pytest: 1122 passed.
  - tsc: clean.
  - vitest and build: passed on a clean rerun. In the first run, the 1MB timing test and `whiteboard/clipboard.test.tsx` failed only while seven audits were running alongside.
