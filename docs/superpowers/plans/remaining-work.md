# Object: remaining work

Status as of 2026-10-27 (M3 and M4 built and through their final gates; Gene asked on 2026-10-26 for all remaining milestones to be built, so M4 onward proceed now and his hand-checks follow later). Spec: `docs/superpowers/specs/2026-10-23-object-design.md`. How to resume: `CONTINUE.md`; rules: `CLAUDE.md`; process: `docs/superpowers/build-process.md`. Object reference for every item below: `reference/` in the repo (a trimmed subset: models in `design-notes`, English UI strings in `docs/strings.txt`, CSS in `docs/design.css`). On Gene's machine the full unpacked app is in the git-ignored `.reference/`.

## How we build (changed 2026-10-26)

- Each milestone gets one plan (writer, three critics, one resolve pass), then one build workflow (`scripts/workflows/object-milestone-build.js`): tracks run in parallel, each task built and committed with its own tests. Track count follows the plan's file ownership (see `build-process.md`; M2 and M3 ran only two tracks, which was too cautious).
- **No per-task reviews.** Gene, 2026-10-26: review ceremony burns tokens; review once, after all tasks are complete. One whole-milestone review runs (correctness, file safety, faithfulness to Object), then a fix pass and a final test gate.
- Gene checks each milestone hands-on before the next one's results are relied on.

## Done

| Milestone | State |
|---|---|
| **M1** shell, objects on disk, editor | Built and verified 2026-10-23. **Open:** Gene's hands-on check on a copy of the CPI export (`m1-acceptance.md`). |
| **M2** object types and properties | 20 tasks built; whole-milestone review and fixes done (`32c7fe2..39432ce`); 372 back-end + 249 front-end tests; `m2_acceptance.py` 52/52 on the sample spaces. **Open:** Gene's hands-on checks (`m2-acceptance.md`). Known nit: `editor/preserve.test.ts` "1MB body splits under 300ms" can fail on timing when the machine is loaded. |
| **M3** views, collections, queries | 16 tasks built (`a89c8cb..bd386e6`), whole-milestone review and fix pass done (`bd386e6..925b023`), final gate green 2026-10-26: 459 back-end tests, 479 front-end tests (66 files), `tsc -b --noEmit` clean, `npm run build` ok; `m1_roundtrip.py` PASS, `m2_acceptance.py` PASS (52/52 checks on `space-sample`, 50/50 on `space-v1`), `m3_acceptance.py` PASS (14/14 checks on each); the built app served headless on a scratch copy of `space-sample` rendered home, a type page (Overview and All), a collection, a query, the Queries page and All notes in Playwright with 0 console errors. **Open:** Gene's hands-on checks (`m3-acceptance.md`, unchecked). |
| **M4** calendar, daily notes, tasks | 16 tasks built (`c771907..d97c007`, acceptance in Task 16), fix `4fc0b85` (daily-note 409 `exists` vs `nameTaken`); final gate green 2026-10-27 at `4fc0b85`: 611 back-end tests, 654 front-end tests (99 files), `tsc -b --noEmit` clean, `npm run build` ok; on `space-sample`: `m1_roundtrip.py` PASS, `m2_acceptance.py` PASS (52/52), `m3_acceptance.py` PASS (14/14), `m4_acceptance.py` PASS (24/24). **Open:** Gene's hands-on checks (`m4-acceptance.md`, unchecked). |

## M3 final gate (2026-10-26)

All automated checks are green: 459 back-end tests, 479 front-end tests (66 files), `tsc -b --noEmit` clean, `npm run build` ok; `m1_roundtrip.py` PASS, `m2_acceptance.py` PASS (52/52 checks on `space-sample`, 50/50 on `space-v1`), `m3_acceptance.py` PASS (14/14 checks on each); the built app served headless on a scratch copy of `space-sample` rendered home, a type page (Overview and All), a collection, a query, the Queries page and All notes in Playwright with 0 console errors.

What is left for Gene on M3: the hand-run list in `m3-acceptance.md` (on a copy of the CPI export kept outside the repo), as for M1 and M2.

### M4 status

Built (Tasks 1–15), and the Task 16 acceptance passed on 2026-10-26; see `m4-acceptance.md`. Task 16 found:

- No contract mismatches between the server and `api/client.ts`. The built app rendered the Calendar and Tasks pages with 0 console errors.
- A Task type whose status options are inferred (`space-sample`, `space-v1`) has no done-category option. Opening keeps a type's own options, so such a task can't be completed until a Done option is added in the type settings. The acceptance script adds one over the API first. Gene should check his CPI export for this.
- Final gate (2026-10-27, after fix `4fc0b85`): 611 back-end tests, 654 front-end tests (99 files), `tsc -b --noEmit` clean, `npm run build` ok; on `space-sample`: `m1_roundtrip.py` PASS, `m2_acceptance.py` PASS (52/52), `m3_acceptance.py` PASS (14/14), `m4_acceptance.py` PASS (24/24).
- What is left for Gene on M4: the hand-run list in `m4-acceptance.md` (on a copy of the CPI export kept outside the repo), including adding a Done-category status option to an inferred Task type if his export lacks one.

## To do

### M3: views, collections, queries (built and gated 2026-10-26; Gene's hand checks pending)

- **View layouts:** list, grid, wall (cards), table, embed, kanban, gallery, on type pages, collections and query results.
- **Table:** resizable columns, wrap content, pinned column, hide/show columns, column calculations, inline cell editing (reuses the M2 cells).
- **Filters:** filter groups (AND/OR), per-kind operators; **sorts**; **group-by** with group order, hide/collapse groups, hide empty groups.
- **Saved views per type:** the Overview / All tabs, view settings saved in `.object/`.
- **Card settings:** how objects render as small card, wide card, inline and embed (the type-settings options M2 stored but doesn't apply yet).
- **Collections:**
  - create, rename, delete, icon
  - add/remove objects (`collections:` key)
  - each collection's own views, pinned items, templates and dashboard sections
  - the collections system property becomes live
- **Queries:** saved filter/sort/group definitions shown as objects with a view; the sidebar's "In Progress" style pinned query.
- **Sidebar Pinned section:** pin objects, types, collections and queries; drag to reorder.
- **"All notes" view.**

### M4: calendar, daily notes, tasks (built and gated 2026-10-27; Gene's hand checks pending)

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

- SQLite FTS5 index in `.object-cache/`, rebuilt from files and kept current by the watcher.
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
- **Editor:** slash menu completeness, drag handles, block selection, keyboard shortcuts matching Object.
- **Tabs:** breadcrumbs, the three-area side panel (area 1/2/3) with resizing, persistent and pinned tabs.
- **Light mode** (tokens from the shipped CSS), **settings modal** completeness for local options, **spaces** (create, switch, rename).
- **Final side-by-side fidelity pass** against Object on every screen.

## Out of scope (by design)

Accounts, login, billing, sync, sharing/publishing, mobile, integrations (Readwise, Kindle, calendar feeds, messaging), AI features (a Claude Code agent comes later), telemetry, importing Object data, migrating `C:\Git\wiki` (a separate later project).

## Open items for Gene

1. Hands-on checks of M1, M2 and M3 on a copy of the CPI export kept outside the repo (`m1-`, `m2-`, `m3-acceptance.md`).
2. (Done 2026-10-26: Gene asked for all remaining milestones to be built now; his hand-checks of each follow later.)
3. Keep the PC awake during workflow runs: an overnight sleep paused M2 for a weekend.
4. The repo goes to a private GitHub repo (`Objects`); the trimmed `reference/` set is committed so a cloud session can continue.
