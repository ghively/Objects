# Object: remaining work

Status as of 2026-10-26 (updated after M2 Task 20). Spec: `docs/superpowers/specs/2026-10-23-object-design.md`. Capacities reference for every item below: `.reference/` (models in `recovered-ts/src/shared-logic/models/`, English UI strings in `app-unpacked/dist/virtual_intlify-i18n-0366822.js`, CSS in `app-unpacked/dist/index36682.css`).

## How we build (changed 2026-10-26)

- Each milestone gets one plan, then one build workflow: a back-end track and a front-end track in parallel, each task built and committed with its own tests.
- **No per-task reviews.** Gene, 2026-10-26: review ceremony burns tokens; review once, after all tasks are complete. One whole-milestone review runs (correctness + file safety, and faithfulness to Capacities), then a fix pass and a final test gate.
- Gene checks each milestone hands-on before the next one's results are relied on.

## Done

| Milestone | State |
|---|---|
| **M1** shell, objects on disk, editor | Built and verified 2026-10-23: 95 back-end + 67 front-end tests, the round-trip leaves files untouched, the shell and peek render. **Open:** Gene's hands-on check on a copy of the CPI export (`m1-acceptance.md` checklist). |

## In progress: M2, object types and properties

Plan: `2026-10-23-m2-types-properties.md` (20 tasks). **All 20 tasks are built and committed.** Acceptance: `m2-acceptance.md`.

| Task | | State |
|---|---|---|
| 1–7 | Type model and migration, codec, property updates, trash, type API, kind change and two-way linking, rename with relink | committed, reviewed |
| 8–10 | Change type; templates; tags, icons and cover images | committed (not yet reviewed) |
| 11–15 | API client, formatting, cells and pickers, editable panel | committed, reviewed |
| 16–19 | Property definition editing; Object Type Settings; page layouts; lifecycle UI | committed (not yet reviewed) |
| 20 | Acceptance: fixtures, `scripts/m2_acceptance.py` (PASS on `space-sample` and `space-v1`), end-to-end API check on port 8791, build | committed |

What remains for M2:

1. **One whole-milestone review** (correctness and file safety, and faithfulness to Capacities), concentrating on the unreviewed Tasks 8–10 and 16–19 and the plan's Review Focus.
2. **A fix pass** for its findings, then the **final gate**: `uv run pytest backend/tests -q`, `cd frontend && npx vitest run`, `npx tsc -b --noEmit`, `npm run build`, and both `m2_acceptance.py` runs.
3. **Gene's hand-run checks** in `m2-acceptance.md`: the sample walk-through in the native window, then the CPI copy (13 types migrate, one-line diffs, rename count, and side by side with Capacities).
4. Known nit: `editor/preserve.test.ts` "1MB body splits under 300ms" can fail on timing when the machine is loaded; it could get a looser budget.

Found and fixed during acceptance: the file watcher thread died when "Empty Trash" removed a deleted type's folder (Windows `resolve()` error), which stopped external-change detection until restart.

### M3 status

The plan is written (`2026-10-26-m3-views-collections-queries.md`); its build starts once M2's review and fix pass land.

## To do

### M3: views, collections, queries

- **View layouts:** list, grid, wall (cards), table, embed, kanban, gallery, on type pages, collections and query results.
- **Table:** resizable columns, wrap content, pinned column, hide/show columns, column calculations, inline cell editing (reuses the M2 cells).
- **Filters:** filter groups (AND/OR), per-kind operators; **sorts**; **group-by** with group order, hide/collapse groups, hide empty groups.
- **Saved views per type:** the Overview / All tabs, view settings saved in `.capacities/`.
- **Card settings:** how objects render as small card, wide card, inline and embed (the type-settings options M2 stored but doesn't apply yet).
- **Collections:**
  - create, rename, delete, icon
  - add/remove objects (`collections:` key)
  - each collection's own views, pinned items, templates and dashboard sections
  - the collections system property becomes live
- **Queries:** saved filter/sort/group definitions shown as objects with a view; the sidebar's "In Progress" style pinned query.
- **Sidebar Pinned section:** pin objects, types, collections and queries; drag to reorder.
- **"All notes" view.**

### M4: calendar, daily notes, tasks

- **Calendar views:** Day, Three days, Week, Month; Today ‹ ›.
- **Day header:** coloured weekday, Today pill, large date, week number.
- **Mini month** in the right panel, marking days that have a daily note.
- **Day sections:** daily note inline, tasks due, created today, updated today; filter tabs (All / Daily note / Tasks / Created Today); quick-create chips for chosen types.
- **Daily notes:** one per date (`DailyNotes/YYYY-MM-DD.md`), the reviewed flag, templates, "+ Daily Note".
- **Calendar options per type:** create-in-calendar and hide-from-calendar (stored in M2).
- **Date properties in the calendar:** objects with date/datetime values appear on their dates, with ranges.
- **Tasks view:** all task-role objects grouped by status category (not-started / in-progress / blocked / done); list and kanban; filters; drag between columns changes status.
- **Task fields:** priority, due date, **recurrence** (every N day/week/month/year, by due date or completion date), **reminders** (local OS notifications only).

### M5: search, command palette, backlinks, graph

- SQLite FTS5 index in `.capacities-cache/`, rebuilt from files and kept current by the watcher.
- **Ctrl+K command palette:** fuzzy titles + full text, filter by type, commands (new object of type, go to calendar/graph, switch space, toggle panels).
- Find in page (Ctrl+F) beyond the editor's own.
- **References section** on objects: tabs All / Backlinks / Related / Mentions / Related tags; unlinked mentions; the backlinks system property becomes live.
- **Global graph:** nodes coloured by type, sized by links; filters for type include/exclude, show completed tasks, minimal nodes, hide large nodes, hide dates, hide indirect links, tag network; click to peek.
- **Local graph** in the right panel (1–2 hops).
- Smooth at 5,000 objects / 50,000 links.

### M6: whiteboards and pen

- A whiteboard is an object (`Whiteboards/<Title>.md` + a board data file).
- **Canvas:** 30 px grid, pan and zoom, multi-select, snap.
- **Items:**
  - blocks: text and embedded objects, which open in the peek
  - 12 shapes: rectangle, rounded rectangle, ellipse, diamond, triangle, triangle down, star, parallelogram, bubble, block arrow left/right, heart
  - frames
  - points
  - logic-circuit gates: not, and, nand, or, nor, xor, xnor, high, low
- **Connectors:** straight / cornered / curved; solid / dashed / dotted; end markers none / arrow / dot / double; labels.
- **Freehand ink (Gene's addition):** Wacom pressure through Pointer Events and `perfect-freehand`; pen, highlighter, eraser; colours and widths; stored as SVG beside the board.
- Undo/redo; drag objects in from the sidebar and search.

### M7: remaining blocks, light mode, polish

- **Block options:**
  - toggles; text and background colours; alignment
  - standout quotes; alphabetical and roman lists
  - grid / columns; groups; simple tables with header row/column
  - math (KaTeX); code previews (Markdown, Mermaid); horizontal line
  - embedded objects with their own view settings
  - media blocks: image, PDF, audio, video, file, web link
  - the annotation syntax for options plain Markdown can't hold
- **Editor:** slash menu completeness, drag handles, block selection, keyboard shortcuts matching Capacities.
- **Tabs:** breadcrumbs, the three-area side panel (area 1/2/3) with resizing, persistent and pinned tabs.
- **Light mode** (tokens from the shipped CSS), **settings modal** completeness for local options, **spaces** (create, switch, rename).
- **Final side-by-side fidelity pass** against Capacities on every screen.

## Out of scope (by design)

Accounts, login, billing, sync, sharing/publishing, mobile, integrations (Readwise, Kindle, calendar feeds, messaging), AI features (a Claude Code agent comes later), telemetry, importing Capacities data, migrating `C:\Git\wiki` (a separate later project).

## Open items for Gene

1. Hands-on check of M1, then M2, on a copy of the CPI export kept outside the repo.
2. Run the M2 hand-run checks (`m2-acceptance.md`) before M3's results are relied on.
3. Keeping the PC awake during workflow runs: an overnight sleep paused M2 for a weekend.
