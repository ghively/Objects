# Handoff: pick up Object from a clean clone

Updated 2026-10-28. You are continuing "Object", a local, Markdown-backed recreation of Capacities. Read this file, then `CLAUDE.md` (rules), then `CONTINUE.md` (process). Status lives in `docs/superpowers/plans/remaining-work.md`.

## Where things stand

**All eight milestones are built, reviewed, fixed and through their final gates.** Nothing is waiting on a build. What is left is Gene's hands-on checking, then fixing what he finds.

| Milestone | Scope | Plan |
|---|---|---|
| M1 | shell, objects on disk, block editor | `2026-10-23-m1-shell-objects-editor.md` |
| M2 | object types and all property kinds | `2026-10-23-m2-types-properties.md` |
| M3 | views, collections, queries, pinned, All notes | `2026-10-26-m3-views-collections-queries.md` |
| M4 | calendar, daily notes, tasks (recurrence, reminders) | `2026-10-26-m4-calendar-daily-tasks.md` |
| M5 | search (SQLite FTS5), Ctrl+K palette, backlinks, graph | `2026-10-26-m5-search-palette-backlinks-graph.md` |
| M6 | whiteboards and pressure ink | `2026-10-26-m6-whiteboards-pen.md` |
| M7 | remaining blocks, light mode, settings, spaces, tabs, side panel | `2026-10-26-m7-blocks-lightmode-polish.md` |
| M8 | every Capacities feature M4–M7 deferred, local only | `2026-10-27-m8-deferred-features.md` |

Last full verification, 2026-10-28 at `9383a9b`, on Linux:
- 1122 back-end tests passed (1 skipped: it needs a non-root user).
- 1678 front-end tests passed (1 skipped: it needs `OBJECT_ROUNDTRIP_SPACE`).
- `tsc -b --noEmit` clean; `npm run build` ok.
- `m1_roundtrip.py` and `m2`–`m8_acceptance.py` PASS on `space-sample` and `space-v1`.
- The app was started with `uv run objectapp --browser` and driven in headless Chromium with 0 console errors.

## What to do first

1. Set up: install `uv` and Node 22+; run `uv sync`, then `cd frontend && npm ci`. Use `npm ci`, not `npm install`: a newer npm rewrites `package-lock.json`.
2. Run the baseline: `uv run pytest backend/tests -q`, then `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run build`. Report any failure before changing code.
3. Pick up Gene's findings from his hand-checks (`docs/superpowers/plans/m1-acceptance.md` to `m8-acceptance.md`, 237 unchecked items) and fix them. Fix one finding per commit, each with a regression test, then rerun the full gate and every acceptance script on fixture copies.
4. Keep `remaining-work.md`, `CONTINUE.md` and this file current, commit, and push.

## Open items

- **Gene's hands-on checks, M1–M8.** Run them on a copy of the CPI export outside the repo, with `git init` there. Some things can only be checked on his Windows machine:
  - the pywebview window
  - Windows toast reminders
  - Wacom pressure and tilt
  - microphone and clipboard permissions
  - real-size performance
  - the side-by-side look against Capacities, in all four themes
- **Guessed values.** The trimmed `reference/` lacks these, so they are best guesses, marked "our choice" in the acceptance docs:
  - the shortcut keys, all in `frontend/src/lib/shortcuts.ts`
  - the side-panel area layout, breadcrumbs, pinned tabs, slash and block menu looks
  - the search highlight colour and the graph limits
  - the M8 file formats (block ids and references, inline colours, date tokens, table formulas, embeds)
  - the layout switch points: a 480 px main-column minimum, and properties inline below 850 px
  - M3's default dashboard section tabs, which need the full `.reference/` on Gene's PC
- **Inferred Task types:** a Task type whose status options were inferred (as in the sample spaces) has no Done-category option, so tasks can't be completed until one is added. Check the CPI export for this (M4 finding).
- **Deferred by Gene:** TODO handling in the editor. Logseq-style markers were considered and rejected; Capacities' own to-do blocks stay.
- **Later:**
  - an installer (spec §6)
  - the in-app Claude Code agent (spec §2)
  - migrating `C:\Git\wiki` into Object's format (a separate project)

## Rules that bite

- Fidelity to Capacities is the bar; don't over-engineer; no invented schema.
- No per-task review loops. Review once at the end of a piece of work, fix once, then the gate.
- No real CPI data in the repo; fixtures are synthetic. Never touch `C:\Git\wiki`.
- Opening a space never writes `.md` files. Edits change only their own lines. Deletes go to trash. Preserve CRLF/BOM. Write atomically. The server binds 127.0.0.1 only.
- `reference/` is a trimmed copy of Capacities' recovered models, English strings and CSS. Read it for behaviour, labels and values; never copy its code. Older docs and scripts say `.reference/`; in a clone that means `reference/`.
- Plan parallelism from file ownership (`docs/superpowers/build-process.md`): one owning task per shared file.
- Commit trailers: `Co-Authored-By:` the model that wrote the commit.

## Known gaps

- Since M3 the code was built and tested in a Linux cloud container. Windows (Gene's platform) has not been re-run since M2, so expect small path, shell or notification fixes there.
- Timing tests (`editor/preserve.test.ts` 1MB split, `test_search_p95_under_50ms_at_5000`) are sensitive to a busy machine. Rerun one alone before calling it a failure.
- Gene's work-export copy and the full unpacked Capacities app (`.reference/`) stay on his machine.
