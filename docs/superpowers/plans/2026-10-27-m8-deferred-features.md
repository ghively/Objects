# Object, Milestone 8: Deferred Capacities Features. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gene asked on 2026-10-27 for M8: build every Capacities feature that M4–M7 recorded as "Not in M*", local only. Only what spec §2 puts out of scope stays out (AI, anything that needs the network at runtime, accounts/sync/sharing, telemetry; see "Coverage"). M8 delivers:
- **Tasks and calendar:** the recurrence **occurrence log**, **Skip** and **Excuse**, **Task Stats** (streaks, completion rate, the occurrence grid), **custom recurrence rules** ("On" weekdays, the Nth or last weekday, the Nth or last day of the month, a day of the year), the **overdue catch-up dialog**, **reminders on any date property** that supports them, and the Day view's **Backlinks**, **Date references** and **Timeline** sections, with real **date tokens** ("Today - date link") and typed dates in the `/` menu.
- **Search and references:** the **extended search** page with "Text matches only" and **Save as Query**; the palette's **clipboard actions** and its "Open extended search", "Open settings", "Open space …" and "Toggle focus mode" actions; **nested backlink display modes**, the **backlink section defaults** and **related-content hiding** settings, the **backlinks side-panel entry** and dragging a side-panel entry onto the main view to swap; the graph's **Export view as PNG**; **find in raw mode**; **Merge into object** and **Merge into tag**.
- **Whiteboards:** **media nodes** (image, PDF, audio, file) and **web-link nodes** (no fetching), the **connector-drop quick-create** menu, the entity node **View** menu, **keyboard resize**, the per-node **lock**, **system-clipboard copy/paste**, **PNG export**, **Turn into whiteboard** and **Add to whiteboard**, the **Floating Inspector** (Outline / Frames / Stats) with **reading-order** editing, the board's **Notes** editor, **presentation** (Play, frames as pages), and for our ink: **select, move and resize strokes**, **partial erase** and **pen tilt**.
- **Editor blocks:** **block references** and "Copy block reference" (live, read-only transclusion with "Referenced in"), **inline text colour and highlight** in a text-selection **tokens menu** (with "Create object from text selection" and "Link existing object"), **indenting any block**, **per-list-item styles**, **table formulas, sorting and CSV export**, **Turn into object / task** (and a to-do into a Task object), **code syntax highlighting**, **Mermaid PNG/SVG export**, **collections and queries embedded as live views**, and **audio recording** into an attachment (no transcription).
- **App:** **version history** for objects and whiteboards (preview, restore), **focus mode** with its timer, object **presentation mode** ("Present") with its settings, **deleting a space folder** (to the OS trash, or a confirmed permanent delete), "Start with basic setup" for a new space, and the **Language** (locale for formatting; strings stay English), **Decimal separator** and **Time zone** settings, all working.

**Architecture:**
- **Five build lanes** with disjoint files (see "Shared files and ordering" and "Build lanes"): **A: foundation and app** (Tasks 1–9: dependencies, the backend and frontend contracts, version history, merge, settings, spaces, focus and presentation), **T: tasks and calendar** (Tasks 10–15), **S: search and references** (Tasks 16–19), **W: whiteboard** (Tasks 20–24), **E: editor blocks** (Tasks 25–30), then **integrate** (Task 31).
- **Two contract tasks own every shared file.** Task 2 (backend) owns `server.py`, `apictx.py`, `settings.py`, `conftest.py` and the new fixture space; it creates every new router module as an empty `APIRouter` and includes it once, so each later backend task fills **its own** router module and never edits `server.py`. Task 3 (frontend) owns `api/types.ts`, `api/client.ts`, `test/mockApi.ts`, `settings/useSettings.ts`, `settings/defaults.ts`, `lib/shortcuts.ts`, `nav/tabs.ts`, `App.tsx`, `shell/MainPanel.tsx`, `shell/GlobalOverlays.tsx` and `object/ObjectView.tsx`; it adds every M8 client method and type, every new shortcut id, the new targets and their routes, every new `…` menu item and mount point, and **stub modules** (a store that works, a component that renders nothing, a function that throws `NotBuiltYet`) that the owning lane later fills without touching the shared file again. After Tasks 2 and 3 no task edits those files.
- **Editor: one data layer, then parallel UI** (the M7 pattern). Task 25 is the single owner of round-tripping for every new syntax (codec, `document.ts`, `blockSource.ts`, `preserve.ts`, `blockTree.ts`, `annotations.ts`, new node and mark schemas with plain rendering and data-level commands, the slash items and the editor key bindings). Tasks 26–30 add node views, menus and engines in files Task 25 created for them.
- **Back end:** a **history store** outside the space (`<state dir>/history/…`) fed by one pre-write hook in `Space`'s write funnels and `whiteboardstore`; **recurrence** gains custom rules and the occurrence log (`taskmodel.py`, `recurrence.py`, `taskhook.py`, `tasklog.py`); **calendar days** gain backlinks, date references and a timeline (`calendarquery.py`, `linkindex.py`); **merge** (`merge.py`) reuses `Space`'s rename relinking; **spaces** gain folder deletion and basic setup; the board format gains `media` and `weblink` blocks.
- **Front end, outside the editor:** a search page target, palette actions, references settings, whiteboard features in `whiteboard/**`, a version-history dialog, focus mode and presentation overlays, and the settings sections.

**Tech Stack:** as M7, plus **four new dependencies**, installed by Task 1 only (the one task that edits `frontend/package.json`, `frontend/package-lock.json`, `pyproject.toml` and `uv.lock`; every other task uses `npm ci` and `uv sync`, never `npm install`). If the build workflow installed them before Task 1 runs, Task 1 only verifies the pins and the lock files.

| Package | Exact version (released) | Where | Why |
|---|---|---|---|
| `highlight.js` | `11.11.1` (2024-12-25) | `frontend` dependencies | Code syntax highlighting (Task 29). Only `highlight.js/lib/core` plus the languages in `editor/code/languages.ts` are imported, so the bundle carries no unused grammar; tokens become ProseMirror decorations, the code text is never rewritten. Pure, no network. 11.11.2 exists (2026-08-11) but 11.11.1 is the long-stable line. |
| `html-to-image` | `1.11.11` (2023-02-01) | `frontend` dependencies | Whiteboard PNG export (Task 22): rasterises the React Flow viewport DOM (nodes, edges, the ink SVG). React Flow's own export example pins exactly 1.11.11 (later 1.11.x changed font embedding). Only same-origin resources, so no network. |
| `tzdata` | `2026.5` (2026-10-03) | Python dependencies | The Time zone setting (Task 2): `zoneinfo.ZoneInfo(name)` needs a tz database, and Windows has none; `tzdata` is the official fallback `zoneinfo` reads. Pure data. |
| `send2trash` | `2.1.0` (2026-01-14) | Python dependencies | Deleting a space folder to the OS trash (Task 8): Recycle Bin on Windows, Trash on macOS, the freedesktop trash on Linux, without our own platform code. |

**Considered and not added:** `@sigma/export-image` (Task 19 composes sigma's own layer canvases into one PNG, ~40 lines), `rrule` (our text form is readable and the arithmetic is small; Task 10's shared vectors pin it), `mathjs` / `hot-formula-parser` (Task 28's formula engine covers exactly Capacities' 20 statements and is pure TypeScript), `papaparse` (CSV writing is ~20 lines with RFC 4180 quoting), `jsdiff` (the version list needs no diff; `diff` in `node_modules` is a transitive package and is not imported), a recording library (`MediaRecorder` is built into WebView2 and Chromium).

**Spec:** `docs/superpowers/specs/2026-10-23-object-design.md` §2 (everything Capacities does with objects, tasks, the calendar, search, backlinks, whiteboards, settings that apply locally; out: cloud, integrations, AI, telemetry), §3 (tasks with recurrence and reminders; blocks; whiteboards), §4 (plain Markdown first, a small inline annotation for what Markdown can't hold, files read cleanly in any editor, saving never rewrites parts that weren't edited; `.capacities-cache/` is derived), §5 (the interactions to copy), §7 (no network access needed).
- **Reference paths.** In a clone read the trimmed, tracked `reference/` (older docs and the build script say `.reference/`; same sub-paths). Never copy code.
  - Recurrence: `reference/recovered-ts/src/shared-logic/models/date.model.ts` (`occurrenceLogEntrySchema` `{scheduledDate: {dateResolution, date}, actionDate, action: task-completed | task-skipped | task-excused}`, `recurrenceBase` `originalStartDate`, `endDate`, `occurrenceLog`, `exceptions`; `dueDateRecurrence` with an `rrule`, `completionDateRecurrence` with only `interval {amount, unit}`; `reminderSchema`; `DateObjectConstraints.supportsReminders`), `notification.model.ts` (folded occurrences).
  - Blocks: `blocks.model.ts` (`TextBlock.formula`, `numberFormat`, `blocks` children on every `ContentBlockInterface`, `SimpleTableColumn.width`, `EntityBlock.localDataViewInfo`, `showDataViewDetails`, `AudioRecordingBlockState`), `dataView.model.ts` (`LocalDataViewInfo`).
  - Whiteboards: `whiteboard.model.ts` (`whiteboardMediaTools` `image | pdf | audio | file | weblink`, `resolveWhiteboardMediaTool`, node `locked`, `readingOrder`, `WHITEBOARD_CLIPBOARD_PREFIX`, `whiteboardPickerTools`).
  - Basic setup: `reference/recovered-ts/src/shared-logic/util/basicStructures.ts` (system structures) and the strings `components.{person,meeting,project,book}.*` (names, descriptions, property names; the property kinds are not in the trimmed set, so they are our choice, listed for Gene).
  - Locales: `reference/recovered-ts/src/shared-logic/locales/core/*.json` (the language list: `en`, `en-gb`, `de`, `fr`, `es`, `it`, `nl`, `pt-br`, `hu`).
  - **en-US strings:** `reference/app-unpacked/dist/virtual_intlify-i18n-0366822.js`, flattened once with a throwaway script outside the repo (evaluate the `var e={…}` object in a Node `vm` context, walk it, join `t:3` text and `t:4` placeholders; ~7,700 strings). Groups to read: `RootTaskCheckbox.menu.*`, `components.RootTask.habitStats.*`, `components.RootTask.turnBlockIntoTaskObject`, `RecurringTaskOverdueModal.*`, `DatePicker.recurrence*`, `DatePicker.recurrenceRemoveConfirm.*`, `CalendarDaily.backlinksToThisDay.*`, `CalendarDaily.references.*`, `CalendarDaily.timeline.*`, `ControlDropdown.custom.*`, `ControlDropdown.query.*`, `LocalSpaceQuery.*`, `CommandPalette.paste.*`, `CommandPalette.actions.options.*`, `PageBacklinkSection.*`, `EditorSettings.backlinkSectionsDefault.*`, `EditorSettings.defaultContextualBacklinkViewMode.*`, `RenderSidepanel.*`, `GraphViewModal.exportPng`, `EntityMenu.mergeObject.*`, `EntityMenu.mergeTag.*`, `EntityMenu.versionHistory.text`, `EntityMenu.presentationMode.text`, `VersionHistory.*`, `PresentationSettings.*`, `FloatingToolbox.presentation.*`, `ComponentHeader.focusMode.*`, `Whiteboard.*`, `FloatingInspector.*`, `BlockMenu.copyBlockReference.*`, `ActionItems.copyBlockReference.*`, `BlockReferences.referencedIn`, `RenderBlockReference.*`, `tokensMenu.*`, `HighlightMenu.turnIntoObject.label`, `blocks.simpleTable.*`, `blocks.CodeBlock.*`, `shortcuts.*`, `LanguageSettings.*`, `DateAndTimeSettings.timeZone.*`, `DeleteHandler.space.*`, `OnboardingSpace.howToStart.*`. Every quoted string below is verbatim unless marked "our string"; a Capacities string naming "Capacities" is adapted and marked "our string, adapted from `<key>`".
  - Visual: `docs/ui-reference/` and `docs/capacities-re-findings.md`. **Not in the trimmed set:** any screenshot of the features above, the shortcut key bindings, `tokens.model.ts` and `annotations.model.ts` (inline token and highlight shapes), the code-editor language list, the presentation slide-splitting rule, the Floating Inspector's Stats contents. Where the plan needs them it says "our choice" and lists the item in Task 31's hand-check.

## Roadmap (one plan per milestone)

| M | Delivers |
|---|---|
| 1–7 (built) | shell, objects, editor; types and properties; views, collections, queries; calendar, daily notes, tasks; search, palette, references, graph; whiteboards and pen; every block option, tabs and side panel, light mode, settings, spaces |
| **8 (this plan)** | every feature M4–M7 deferred, minus spec §2's exclusions (see "Coverage") |

## Global Constraints

**Carried forward from M1–M7** (all of them, unchanged):
- **Server and toolchain:** `127.0.0.1` only (default port 8790), **no outbound network at runtime** (server or client: no fetch of a web page, favicon, oEmbed, font or script; a web link stores only what the user typed), Python `>=3.13` with uv, Node `>=22`. Commands: `uv run pytest backend/tests -q`; `cd frontend && npx vitest run`, `npx tsc -b --noEmit`, `npm run build`, `npm run lint`.
- **Never write on read.** Opening a space, any GET, listing versions, computing stats or the overdue count write nothing inside the space and nothing in the state dir (the one exception is M5's search cache, `.capacities-cache/` or `OBJECT_CACHE_DIR`, which every "writes nothing" check points elsewhere, as `conftest.py`'s autouse fixtures already do). Property edits change only their own lines. Deletes go to the trash and are restorable. Writes are atomic and keep CRLF/BOM and the trailing-newline state. Destructive confirmations use **428**; a stale `baseVersion`/`baseRevision` is **409**; an unreadable definition file is **423** and is never replaced. Every route that writes an object announces `ChangeEvent(origin=clientId)` for each path it wrote.
- **Derived data never goes inside object files.** Indexes, caches, stats and **history snapshots** live in `.capacities-cache/` (derived, rebuildable) or in the per-user state dir (`appstate.state_dir()`, `OBJECT_STATE_DIR` in tests). The only new keys M8 writes into object files are user data that the user's own action creates (the occurrence log, a reminder, a block id, an inline style; see "Storage").
- **Byte preservation of untouched blocks is sacred** (`editor/preserve.ts`, `editor/blocks.ts`, `editor/document.ts`, `editor/extensions/blockSource.ts`, `editor/annotations.ts`, `editor/blockTree.ts`): loading a body and saving it without an edit gives the identical bytes; an edit changes only the lines of the blocks it touched; undo restores the original bytes; moving a block keeps its bytes. M8 adds syntax, never a way to rewrite a block that wasn't edited. M7's annotation grammar and byte rules 1–7 stand unchanged.
- **Definition files and `ui.json`** follow M3/M4: `JsonStore`/`uistate.patch_ui`, revisions, `PUT /api/ui` accepts only `_UI_PATCH_KEYS` and checks shapes in `_ui_problem`. **Device settings** follow M7's `settings.py` (`PUT /api/settings` replaces patched top-level keys, keeps unknown keys, 409/422/423).
- **Tests:** the baseline is this branch at `07e7258` (M7 final gate plus the 2026-10-27 known-issue fixes): **934 back-end tests passing (1 skipped), 1367 front-end tests passing (1 skipped)**, `tsc -b --noEmit` clean, `npm run build` ok, `m1_roundtrip.py` and `m2`–`m7_acceptance.py` PASS on `space-sample` and `space-v1`. Every task keeps all earlier tests green. A test that passes before its task's code exists is labelled "regression guard (green from the start)". Backend tests use the new synthetic `space-m8` (Task 2) or `tmp_path`, never assert absolute fixture counts, and rely on `conftest.py`'s autouse `OBJECT_STATE_DIR`/`OBJECT_CACHE_DIR` isolation and stubbed notifications. Frontend tests mock `api` (`test/mockApi.ts`), `mermaid`, `highlight.js` where timing matters, `html-to-image`, `navigator.clipboard` and `MediaRecorder`. The vitest case "1MB body splits under 300ms" (`editor/preserve.test.ts`) is load-sensitive: rerun it alone before calling it a failure (since 2026-10-28 it asserts the best of 5 runs after a warm-up, still under 300 ms). If a test fails in a file another lane owns, rerun once after a minute before reporting it.
- **Fidelity.** Labels, option keys, defaults and orders come from the reference extract. Strings marked "our string" have no Capacities original. Every behaviour the trimmed reference does not define is marked **"our choice"** here and listed in Task 31's hand-check list for Gene.
- **Commits.** Each task commits only its own files, by explicit path (never `git add -A` or `.`); on `index.lock`, wait and retry. Every message is the task's subject line, a blank line, then:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```
- **Hands-on checks** stay unchecked lists for Gene. No task ticks one.

**New in M8**
- **Start condition and cross-lane waits.** Every backend task except Task 1 starts once Task 2's commit (`feat(backend): M8 contract, fixtures and router stubs`) is on the branch; every frontend task starts once Task 3's commit (`feat(app): M8 client contract, targets, menus and stubs`) is on the branch (check `git log --oneline`; wait a minute and re-check). Tasks 22 and 29 also need Task 1's commit (their packages); Task 8 needs it for `send2trash`.
- **Storage.**

  | What | Where | Format | Written by |
  |---|---|---|---|
  | Occurrence log | the Task's frontmatter key `occurrenceLog` (a hidden `text` property added by `topup_task_type`, as M4 added `repeat` and `remind`) | a YAML literal block, one entry per line, oldest first: `<scheduled> <action> <actionInstant>`, `scheduled` a day `YYYY-MM-DD` or a UTC instant `…Z` (time-resolution dates), `action` `completed`, `skipped` or `excused`, `actionInstant` `YYYY-MM-DDTHH:MM:SSZ`. Example below. An unparseable line is kept as is and ignored (our choice; Capacities stores `occurrenceLog` inside the date object, which a Markdown file can't hold) | Tasks 11, 13 (through the routes) |
  | Custom repeat rules | M4's `repeat` text, extended (grammar below) | text | the date picker |
  | Reminders on dates other than the Task `date` | frontmatter map `reminders`, key = the date property's key, value = M4's `remind` text form (`reminders:` then `  deadline: 1 day before at 09:00`); the Task `date` keeps M4's `remind` key | YAML map, our choice | `PUT /api/tasks/reminder` (Task 12) |
  | Block ids | ` ^<id>` at the end of a block's last line, `<id>` = 6 characters `[a-z0-9]` (the Obsidian convention, so Obsidian resolves our references too) | text | the editor, only when the user copies a block reference |
  | Block references | a line that is exactly `![[<Title>#^<id>]]` (optionally `|label`) | text | the editor |
  | Inline text colour / highlight | `<span data-color="text-<c>">…</span>` and `<mark data-color="bg-<c>">…</mark>`, `<c>` one of the 18 theme colours (`colorThemes.ts`); a bare `<mark>…</mark>` is read as `bg-amber` (Capacities' `FALLBACK_HIGHLIGHT_COLOR`, reference check 2026-10-28, section 4; was `bg-yellow`) and kept as written | inline HTML (renders in GitHub, VS Code, Obsidian), our choice | the editor |
  | Date tokens | `<time datetime="YYYY-MM-DD">YYYY-MM-DD</time>` (the element text is written as the ISO day so the file reads cleanly; any text inside is kept on read) | inline HTML, our choice | the editor |
  | Indented (child) blocks under a non-list block | the container `<!-- indent -->` … `<!-- /indent -->`: the first block inside is the parent, the rest are its indented children (the toggle shape without collapsing) | M7 annotation grammar, new container name | the editor |
  | Per-list-item options | an inline comment at the end of the item's first line: `- Buy milk <!-- item: color=text-red -->` (before a block id when both are present). Options: `small`, `color`, `align`, `icon` (a paragraph's leaf options); unknown ones kept | M7 grammar inside an inline comment, our choice | the editor |
  | Table formulas | the cell's text is `=<expression>` (stays visible in any editor) | text | the editor |
  | Collection / query embeds | a line that is exactly `![[collection:<id>]]` or `![[query:<id>]]` (optionally preceded by `<!-- block: details -->` for "Show details", `showDataViewDetails`) | text, our choice | the editor |
  | Board media and web-link blocks | the board file's `blocks` gain `{"type": "media", "path": "Attachments/<file>"}` and `{"type": "weblink", "url": "https://…", "title"?: "…"}` | JSON, our choice (Capacities' media nodes point at media objects, which our model keeps as attachments) | the board save |
  | Board node lock, reading order, presentation | Capacities' node `locked` and board `readingOrder` (already in M6's format and kept) | JSON | the board save |
  | Ink tilt | no format change: tilt scales the recorded pressure (`p × tiltFactor`) | `.ink.svg` as M6 | the ink layer |
  | Version history | `<state dir>/history/<sha1(space root)[:16]>/<key>/<UTC stamp>.<ext>` with `<key>` the object's frontmatter `id` (else `path-<sha1(rel)[:16]>`), files `…md`, `…whiteboard.json`, `…ink.svg`, plus `index.json` (`[{id, at, rel, files}]`) per key | bytes as they were | Task 4's hook, never on read |
  | Device settings (new keys) | M7's `<state dir>/settings.json` | JSON | `PUT /api/settings` |
  | Focus timer, last presentation slide, inspector pinned, ink erase mode | `localStorage` (per-viewer conveniences) | | the client |

  Occurrence log example:
  ```yaml
  repeat: every day
  occurrenceLog: |-
    2026-10-24 completed 2026-10-24T07:55:10Z
    2026-10-25 skipped 2026-10-26T06:30:00Z
    2026-10-26 excused 2026-10-26T06:30:04Z
  ```
- **`repeat` grammar, extended** (M4's forms stay valid and keep their meaning; the canonical form is written; case and spacing are forgiven on read):

  ```
  every [N] (day|week|month|year)[s] [ON] [after completion] [until YYYY-MM-DD]
  every weekday [until YYYY-MM-DD]
  ON (by due date only; "after completion" with ON is invalid, as Capacities' completionDate rule has only an interval):
    weeks:  on mon[, tue …]                 weekday names mon tue wed thu fri sat sun (full names read too), written in week order
    months: on the 15th | on the last day | on the 2nd tuesday | on the last friday      ordinals 1st…31st; 1st…4th for weekdays
    years:  on march 15 | on the 2nd tuesday of march | on the last day of february
  ```

  Semantics (by due date): the next occurrence is the first date matching the rule strictly after the current one, then the first on or after today (M4's rule), with these anchors: **"on the 31st" skips months that have no 31st** (RFC 5545 `BYMONTHDAY`, which Capacities' `rrule` follows); **"on the last day"** is each month's last day; a weekly rule with `on` steps through the listed weekdays inside each Nth week, weeks starting on the space's week start (`ui.json` `calendar.weekStart`, Monday by default). Plain `every month` keeps M4's step-from-previous behaviour (its clamp drift is what M4 documented); the custom-repeat dialog offers "The {day}" and "Last day" for an anchored rule (our choice; resolves M4's "documented drift, deferred").

  **Shared test vectors** (Task 10 backend, Task 13 frontend; this table is the source and is copied into both test files):

  | text | parsed | next after (current → today 2026-10-27, a Tuesday) |
  |---|---|---|
  | `every week on mon, fri` | `{every:1, unit:'week', on:{weekdays:['mon','fri']}}` | 2026-10-23 → 2026-10-30 |
  | `Every 2 Weeks On Friday, Monday` | canonical `every 2 weeks on mon, fri` | |
  | `every month on the 31st` | `{every:1, unit:'month', on:{monthDay:31}}` | 2026-08-31 → 2026-10-31 (September skipped) |
  | `every month on the last day` | `{…, on:{monthDay:'last'}}` | 2026-09-30 → 2026-10-31 |
  | `every month on the 2nd tuesday` | `{…, on:{weekdayPos:2, weekday:'tue'}}` | 2026-10-13 → 2026-11-10 |
  | `every month on the last friday` | `{…, on:{weekdayPos:'last', weekday:'fri'}}` | 2026-09-25 → 2026-10-30 |
  | `every year on march 15` | `{every:1, unit:'year', on:{month:3, monthDay:15}}` | 2026-03-15 → 2027-03-15 |
  | `every year on the 2nd tuesday of march` | `{…, on:{month:3, weekdayPos:2, weekday:'tue'}}` | 2026-03-10 → 2027-03-09 |
  | `every week on mon after completion`, `every month on the 5th tuesday`, `every month on the 32nd`, `every day on mon`, `every year on february 30`, `every week on` | invalid | |

- **Occurrence actions** (`RootTaskCheckbox.menu.*`, `RecurringTaskOverdueModal.*`; the precise rules are our reading of the hint strings, listed for Gene):
  - **Complete** (the checkbox, M4's hook): also appends `<old date> completed <now>`.
  - **Skip** ("Skip", tooltip "Move to the next occurrence without marking done. Resets your streak and counts as skipped in stats."): appends `<date> skipped <now>`, moves `date` to the next occurrence, status unchanged.
  - **Excuse** ("Excuse", `RootTaskCheckbox.menu.excuseRecurrence`, with its tooltip; "Excuse for {date}" is only the overdue dialog's button; fixed 2026-10-28): appends `<date> excused <now>` and advances like Skip, but keeps the streak and is left out of the completion rate.
  - **Overdue** (by-due-date rules only): the missed occurrences are the scheduled dates from the current `date` up to yesterday. With **two or more**, the checkbox, Skip and Excuse open the catch-up dialog (our threshold; with one, the action runs at once). Its choices: **"This occurrence only"** (`advanceOne`: act on the current date; the next occurrence may still be overdue), **"All missed before today"** (`catchUpBeforeNow`: act on the latest missed date only; the others stay missed; the next date is the first on or after today: M4's silent catch-up plus a log line), and, for complete and skip, **"Also logs all missed as done"** / **"Also skips all missed"** (`catchUpThroughNow`: log every missed date with the action; next on or after today). Excuse offers only the first two (our choice). "{count}+" when over 99 (`RecurringTaskOverdueModal.overdueCount.capped`).
  - **Remove recurrence** with a non-empty log asks first ("Remove recurrence?", "This recurring task already has completed or skipped occurrences. Removing the recurrence will discard its history.", "Keep recurrence" / "Remove recurrence") and then removes `repeat` and `occurrenceLog` together.
  - **Task Stats** ("Task Stats"): `Streak` (consecutive completed or excused occurrences ending at the latest occurrence before today, plus today's when it is done), `Best`, `Completions`, `Completion rate` ("Completed vs skipped or missed": completed / (completed + skipped + missed), excused left out), units `day | days` … from the rule (weekday rules count days), "At risk" when today is scheduled, not done and the streak is above 0, "Keep it up" above 0, "Start today" at 0, and a grid of the last 26 scheduled occurrences plus the next 4, each `completed | excused | skipped | missed | future | none` ("Completed", "Excused", "Skipped", "Missed", "Scheduled", "No occurrence"). The history starts at the first log entry or the task's `createdAt` day, whichever is earlier (our choice: Capacities' `originalStartDate` is not stored).
- **Version history** (`VersionHistory.*`; our rules, listed for Gene): before any write of an object file or a board's sidecar by the app (body, properties, rename, template, relink, merge, restore, board save, ink save), the server keeps the file's **current bytes** as a version when the newest version of that object is older than **5 minutes** or the object has none (so a typing session is one version); a restore always keeps the current state first ("Your current state will be saved as a new version."). External edits are not versioned (the watcher sees them after the fact). At most **200 versions per object**, oldest dropped. Versions are numbered 1… oldest first. A restore puts the version's bytes back **except** the current `id`, `title` and file name, which stay (a rename is not undone by a restore; our choice), and leaves attachments alone ("Restores content and properties. Files stay as they are now."). Boards are restore-only ("Whiteboards don't show a preview."). Purging an object from the trash keeps its history until the 200 limit; deleting a space folder deletes nothing in the state dir (our choice).
- **Merge** (`EntityMenu.mergeObject.*`, `mergeTag.*`): "Single values already set on “{targetName}” stay. Lists are combined with “{sourceName}”, and empty properties are filled from there. Content is added on." So: for each property the target lacks a value for, the source's value is copied (when the target's type has that property; values of properties the target's type lacks are dropped and listed in the response, our choice); multi-value properties (relations, multi labels, tags, collections, aliases) are unioned in target-then-source order; the source body is appended after the target body with one blank line; every link to the source (bodies, relation and other frontmatter values, board entity blocks and text, `tags:` lists for a tag) is relinked to the target with M2/M6's rename relinking; then the source goes to the app's trash (restorable). Merging into itself, a tag into a non-tag or a non-tag into a tag is 422. Limit: 5,000 referencing files (`errorTooLarge`, `{limit}` = 5000, our value).
- **Deleting a space folder** (`DeleteHandler.space.*`): only a space that is **not** the current one (the current space must be switched away from first; our choice), only a folder that is in the registry and holds `.capacities/`; the folder goes to the OS trash through `send2trash`; when the trash is unavailable the route answers 428 and the UI then offers the permanent delete with "This can't be undone." (`DeleteHandler.space.warning`), which removes the folder after re-checking it is the same folder (same device and inode/file id, still holding `.capacities/`). Either way the entry leaves the registry.
- **Shortcut keys (new ids, provisional, in `lib/shortcuts.ts`; Gene confirms):**

  | Id (category, scope) | Provisional keys |
  |---|---|
  | `copyBlockReference` (block, editor) | Mod-Alt-r |
  | `turnIntoObject`, `turnIntoTask`, `turnBlockIntoTaskObject` (block, editor) | Mod-Alt-o, Mod-Alt-k, Mod-Alt-Shift-k |
  | `highlightText` (text, editor) | Mod-Shift-h |
  | `toggleFocusMode` (global) | Mod-Shift-f |
  | `openPresentationMode`, `exitPresentationMode`, `nextPresentationSlide`, `previousPresentationSlide` (page, global / presentation) | Mod-Alt-p, Escape, ArrowRight, ArrowLeft (the last three only while presenting) |
  | `whiteboardResize`, `whiteboardResizeLarge` (whiteboard) | Mod-Alt-Arrow keys, Mod-Alt-Shift-Arrow keys (one grid step, five grid steps; Alt-Arrow alone is `navigateBack`/`navigateForward`) |
  | indent a non-list block (`indentBlocks`/`unindentBlocks`, existing ids) | Tab / Shift-Tab with the caret in any block (M7 bound them in lists and block selections) |

  Task 3's collision test covers the new keys against every existing binding in the same scope.
- **Not in M8** (spec §2; recorded so they are not built by accident): AI (semantic related content, AI chat, Mermaid AI, transcription, "Analyze with AI"); anything that needs the network at runtime (calendar feeds and task actions to other services, Readwise and Kindle, web-embed and bookmark metadata fetching, iframes of web pages, the help, docs, community, what's-new and feedback palette actions); accounts, sync, sharing and publishing (presentation links, `PermissionManager.*`), the account onboarding tour (`OnboardingSlides.*`, "Restart onboarding"), mobile (the whiteboard phone outline view, `DatePicker.recurrenceNotAvailableOnMobile`); telemetry. The interface stays English.

## API contract (M8): shared by all lanes

```
OccurrenceAction = 'complete'|'skip'|'excuse'
CatchUp          = 'advanceOne'|'catchUpBeforeNow'|'catchUpThroughNow'
OccurrenceLogEntry { scheduled: DateValue, action: 'completed'|'skipped'|'excused', at: string }       /* `at` UTC ISO */
RepeatRule      += { on?: { weekdays?: Weekday[] } | { monthDay: number|'last', month?: number } | { weekdayPos: 1|2|3|4|'last', weekday: Weekday, month?: number } }
Weekday          = 'mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun'
OverdueInfo      { count: number, capped: boolean, missed: string[] /* scheduled days or instants, oldest first, at most 99 */, current: DateValue|null, today: string }
TaskStats        { unit: 'day'|'week'|'month'|'year', currentStreak: number, bestStreak: number, completions: number,
                   completionRate: number|null, atRisk: boolean, cells: { scheduled: string, state: 'completed'|'excused'|'skipped'|'missed'|'future'|'none' }[] }
CalendarDay     += { backlinks?: string[], references?: { path: string, count: number }[],
                     timeline?: { path: string, at: string /* UTC ISO */, kind: 'created'|'dated'|'task' , key?: string }[] }
                   /* optional on the client: a server before Task 15 omits them; the client reads `?? []` */
BacklinkContext += { ancestors?: string[] }    /* the parent blocks' first lines, outermost first (Task 18) */
BlockInfo        { path: string, id: string, markdown: string, version: string }
VersionInfo      { id: string, number: number, at: string, size: number, kind: 'object'|'whiteboard', title: string|null }
VersionContent   { id: string, text: string|null /* null for whiteboards */ }
MergeResult      { target: string, version: string, relinked: string[], skipped: {path, reason}[], dropped: string[], trashId: string }
SpaceSetup       = 'blank'|'basic'
DeviceSettings  += {
  language: 'en'|'en-gb'|'de'|'fr'|'es'|'it'|'nl'|'pt-br'|'hu'      /* default 'en'; sets the formatting locale only */
  decimalSeparator: 'automatic'|'dot'|'comma'                       /* default 'automatic' (from the language) */
  timeZone: string|null                                             /* IANA name; default null = the device's zone */
  backlinkSectionsDefault: { backlinks: Tri, relatedContent: Tri, unlinkedMentions: Tri }  /* Tri = 'open'|'closed'|'hidden'; default all 'open' */
  backlinkContentView: 'inline'|'smallCard'|'wideCard'|'embed'      /* default 'embed' ("Embed is the default") */
  relatedContentHiddenTypes: string[]                               /* type ids; default [] */
  nestedBacklinkView: 'showBlockContainingBacklink'|'showFullPathAbove'   /* default 'showBlockContainingBacklink' (our choice) */
  presentation: { hideCoverImage: boolean, hideProgressIndicator: boolean, hideTitle: boolean, footerLeft: string, footerRight: string }   /* defaults false / '' */
}
WhiteboardBlock += WhiteboardMediaBlock { type: 'media', path: string } | WhiteboardWeblinkBlock { type: 'weblink', url: string, title?: string }
Target          += { kind: 'search', q?: string, textOnly?: boolean }
SidepanelTarget += { kind: 'backlinks' }      /* the open tab's object's backlinks */
```

| Route | Request | Success | Errors | Module (task) |
|---|---|---|---|---|
| `GET /api/tasks/overdue?path=` | | `OverdueInfo` | 404, 422 not a recurring by-due-date task | `api_tasks.py` (11) |
| `POST /api/tasks/occurrence` | `{path, action, catchUp?, baseVersion, clientId?}` | `UpdateResult` (M2's shape, `task` set) | 409 stale, 422 not recurring / bad action | `api_tasks.py` (11) |
| `GET /api/tasks/stats?path=` | | `TaskStats` | 404, 422 not recurring | `api_tasks.py` (11) |
| `PUT /api/tasks/reminder` | `{path, key, remind: string|null, baseVersion, clientId?}` | `UpdateResult` | 409, 422 (`key` not a date property with `supportsReminders`, or a `remind` that doesn't fit its resolution) | `api_tasks.py` (12) |
| `GET /api/calendar` (extended) | | days carry `backlinks`, `references`, `timeline` | as M4 | `calendarquery.py` (15) |
| `GET /api/search?…&mode=fullText` (extended) | | body matches only ("Text matches only") | 422 bad mode | `api_search.py` (16) |
| `GET /api/references?path=` (extended) | | backlink contexts carry `ancestors` | as M5 | `references.py` (18) |
| `GET /api/block?path=&id=` | | `BlockInfo` | 404 no such object or block | `api_blocks.py` (27) |
| `GET /api/block/references?path=&id=` | | `{paths: string[]}` (objects holding `![[<Title>#^<id>]]` or `[[<Title>#^<id>]]`, title then path) | 404 | `api_blocks.py` (27) |
| `GET /api/history?path=` | | `{versions: VersionInfo[]}` newest first | 404 | `api_history.py` (4) |
| `GET /api/history/version?path=&id=` | | `VersionContent` | 404 | `api_history.py` (4) |
| `POST /api/history/restore` | `{path, id, baseVersion, clientId?}` | `{version}` (boards: `{revision}`) | 404, 409 stale | `api_history.py` (4) |
| `POST /api/object/merge` | `{source, target, sourceVersion, targetVersion, confirm: true, clientId?}` | `MergeResult` | 428 without `confirm`, 409 stale, 413 over the limit, 422 | `api_merge.py` (6) |
| `POST /api/spaces` (extended) | `{name, location, setup?: SpaceSetup}` | as M7; `basic` also writes the Person, Meeting, Project and Book type files | as M7 | `server.py` route stays; `spaces.py` (8) |
| `POST /api/spaces/delete` | `{path, permanent?: boolean}` | `{trashed: boolean}` | 404 not a registered space folder, 409 the current space, 428 trash unavailable and not `permanent` | `spaces.py` + `api_spaces_m8.py` (8) |
| `GET/PUT /api/settings` (extended) | the new keys | as M7; a `timeZone` change applies to the running `Space.tz` at once | 422 an unknown zone | `settings.py`, `server.py` (2) |
| `GET/PUT /api/whiteboard` (extended) | boards may hold `media` and `weblink` blocks | as M6 | 422 a media path outside the space or a non-`http(s)` URL | `whiteboardfile.py` (20) |

- **Client** (all in `api/client.ts`, Task 3): `api.overdue(path)`, `api.occurrence(path, action, {catchUp, baseVersion})`, `api.taskStats(path)`, `api.setReminder(path, key, remind, {baseVersion})`, `api.block(path, id)`, `api.blockReferences(path, id)`, `api.history(path)`, `api.historyVersion(path, id)`, `api.restoreVersion(path, id, {baseVersion})`, `api.mergeObject(source, target, {sourceVersion, targetVersion})`, `api.deleteSpace(path, {permanent})`; `api.createSpace(name, location, setup?)` and `api.search(q, {mode: 'fullText'})` gain their options. The whiteboard client (`api/whiteboardClient.ts`, `api/whiteboardTypes.ts`) is Task 20's.
- **Test hooks (server):** M4's `OBJECT_CLOCK_FILE` (every task, stats and history test sets the clock), `OBJECT_STATE_DIR`, `OBJECT_CACHE_DIR`; new `OBJECT_FAKE_TRASH_FILE` (Task 8: "move to trash" appends the absolute path to this file and moves the folder into `<state dir>/fake-trash/` instead of calling `send2trash`; with the value `unavailable` it raises as an unavailable trash does).

## Review Focus

1. **Untouched bytes stay untouched with the new syntax.** No-edit save is byte-identical for bodies holding block ids, block references, inline colour spans and marks, date tokens, `indent` containers, item comments, formula cells, data-view embeds and malformed variants of each (CRLF, BOM, no final newline); an edit touches only its block; adding a block id changes only that block's last line.
   - *(Task 25: `test every m8 fixture body round trips byte for byte`, `test adding a block id changes only that line`, `test inline colour edit rewrites only its block`, `test malformed spans and marks stay raw`, `test indent container groups and ungroups without touching children`, `test item comment survives list edits elsewhere`, `test CRLF body keeps CRLF on new syntax`; Task 31: the round-trip harness over every fixture space)*
2. **Opening and reading write nothing; history never enters the space.** GET routes for tasks, stats, overdue, calendar, block, history and versions change no file anywhere; version snapshots are taken only before app writes and only in the state dir.
   - *(Task 2: `test_m8_space_opens_without_writing`; Task 4: `test_history_reads_write_nothing`, `test_snapshot_only_before_app_writes`, `test_history_lives_in_state_dir`; Task 11: `test_stats_and_overdue_write_nothing`; Task 15: `test_calendar_m8_sections_write_nothing`)*
3. **Recurrence is right.** Custom rules follow the shared vectors (skipping months, last day, Nth weekday, weekly `on` lists, until); the log appends exactly one line per action; Skip, Excuse and the three catch-up choices give the documented dates and lines; stats follow the documented formulas; M4's vectors and the reminder ledger stay green.
   - *(Task 10: `test_custom_rule_vectors`, `test_month_day_31_skips_short_months`, `test_m4_vectors_unchanged`; Task 11: `test_complete_appends_one_log_line`, `test_skip_and_excuse_advance_and_log`, `test_catch_up_choices`, `test_stats_streak_rate_and_cells`, `test_remove_recurrence_removes_log`; Task 13: `test custom rule vectors match the backend table`)*
4. **Destructive operations stay safe.** Merge moves the source to the trash (restorable), relinks only the links that pointed at it, keeps single values on the target and changes nothing on 409/428; a restore is refused on a stale version and keeps the current state as a version; deleting a space refuses the current space and anything not a registered space, trashes by default, and deletes permanently only after 428 and a re-check.
   - *(Task 6: `test_merge_requires_confirm_428`, `test_merge_values_lists_and_body`, `test_merge_relinks_and_trashes_source`, `test_merge_restore_from_trash`, `test_merge_tag_rewrites_tag_lists`; Task 4: `test_restore_stale_409`, `test_restore_keeps_current_as_version`, `test_restore_keeps_title_and_id`; Task 8: `test_delete_space_refuses_current_409`, `test_delete_space_trashes_by_default`, `test_permanent_delete_needs_428_then_rechecks_folder`)*
5. **Whiteboard files stay valid and complete.** New block types validate; unknown keys at every level survive; media paths can't leave the space; web links are never fetched; ink edits change only the strokes touched; copy/paste and Turn into keep ids unique.
   - *(Task 20: `test_media_and_weblink_blocks_validate`, `test_media_path_outside_space_422`, `test_unknown_keys_kept_with_media`; Task 22: `test paste assigns fresh ids and offsets`; Task 24: `test moving a stroke rewrites only that stroke`, `test partial erase splits a stroke`)*
6. **No network at runtime.** No `fetch`/`XMLHttpRequest` to a non-same-origin URL anywhere in M8 code; web links, pasted URLs and bookmarks store only the typed URL; PNG export embeds only same-origin resources.
   - *(Task 31: `test no network calls in m8 sources` (a grep test over `frontend/src` for `http(s)://` fetches outside `api/`); Task 20: `test weblink node never fetches`; Task 17: `test pasted url creates a page without fetching`)*
7. **It reads the same as Capacities.** Every quoted string is verbatim; option orders and defaults follow the reference; every "our choice" is listed for Gene.
   - *(Task 13: `test overdue dialog strings match reference`; Task 26: `test tokens menu items and colour names match reference`; Task 28: `test formula statements list matches reference`; Task 31 Step 5)*

---

## File Structure

```
pyproject.toml uv.lock frontend/package.json frontend/package-lock.json                               MOD (Task 1 only)
backend/objectapp/  api_tasks.py api_history.py api_blocks.py api_merge.py api_spaces_m8.py           NEW (Task 2: empty routers; each later filled by one task)
                    apictx.py server.py settings.py                                                     MOD (Task 2)
                    history.py                                     space.py whiteboardstore.py          NEW / MOD (Task 4)
                    merge.py                                                                            NEW (Task 6)
                    spaces.py basicsetup.py                                                             MOD / NEW (Task 8)
                    taskmodel.py recurrence.py                                                          MOD (Task 10)
                    tasklog.py  taskhook.py typemodel.py                                                NEW / MOD (Task 11)
                    reminders.py                                                                        MOD (Task 12)
                    calendarquery.py linkindex.py                                                       MOD (Task 15)
                    api_search.py searchindex.py (only if needed)                                       MOD (Task 16)
                    references.py api_references.py                                                     MOD (Task 18)
                    whiteboardfile.py whiteboardindex.py                                                MOD (Task 20)
                    rows.py searchtext.py                                                               MOD (Task 27)
backend/tests/      fixtures/space-m8/**  conftest.py (m8_space_dir)  test_fixtures_m8.py test_settings_m8.py   Task 2
                    test_history.py (4) test_merge.py (6) test_spaces_m8.py test_basicsetup.py (8)
                    test_recurrence_m8.py (10) test_tasklog.py test_tasks_api.py (11) test_reminders_m8.py (12)
                    test_calendar_m8.py (15) test_search_m8.py (16) test_references_m8.py (18)
                    test_whiteboard_m8.py (20) test_blocks_api.py (27)
scripts/m8_acceptance.py                                                                               Task 31
frontend/src/api/{types,client}.ts test/mockApi.ts settings/{useSettings,defaults}.ts lib/shortcuts.ts  MOD (Task 3)
frontend/src/lib/zonedTime.ts nav/tabs.ts App.tsx shell/{MainPanel,GlobalOverlays,SidePanelArea}.tsx
             object/ObjectView.tsx                                                                     NEW / MOD (Task 3; SidePanelArea then Task 18)
frontend/src/ stubs created by Task 3, each then filled by ONE task:
  history/{useVersionHistory.ts,VersionHistoryDialog.tsx} (5)  merge/{useMerge.ts,MergeDialog.tsx} (6)
  focus/{useFocusMode.ts,FocusMode.tsx} present/{usePresentation.ts,Presentation.tsx} (9)
  tasks/TaskStatsSection.tsx (13)  search/{SearchPage.tsx,openSearch.ts} (16)  references/BacklinksPanel.tsx (18)
  whiteboard/{turnInto.ts,AddToWhiteboardDialog.tsx} (22)
frontend/src/history/** (5)  merge/** (6)  settings/{SettingsModal.tsx,sections/{Language,DateTime,Editor}.tsx} properties/format.ts
             properties/cells/NumberCell.tsx calendar/dates.ts (7)  settings/sections/SpaceSettings.tsx spaces/** (8)
             focus/** present/** (9)
frontend/src/tasks/** properties/DatePicker.tsx (13, then 14)  properties/PropertySettings.tsx calendar/DaySections.tsx (14)
frontend/src/search/** palette/SearchView.tsx (16)  palette/{CommandPalette,ActionsView}.tsx palette/{actions,paste}.ts (16 then 17 for CommandPalette; 17 for the rest)
             references/** shell/SidePanel.tsx nav/sidepanel.ts (18)  graph/** find/** editor/RawMode.tsx (19)
frontend/src/api/{whiteboardTypes,whiteboardClient}.ts whiteboard/** (20 → 21 → 22 → 23; not whiteboard/ink/**)  whiteboard/ink/** whiteboard/plugin.ts (24)
frontend/src/editor/{annotations,blockTree,blocks,document,preserve}.ts editor/extensions/blockSource.ts editor/Editor.tsx
             editor/shortcuts.ts editor/slash/slashItems.ts editor/slash/parseDate.ts editor/nodes/{indent,blockRef,dateToken,dataViewEmbed,textStyle}.ts
             editor/nodes/listItemOptions.ts editor/tokens/TokensMenu.tsx (stub) editor/turnInto.ts (stub) editor/media/recordAudio.ts (stub)   NEW / MOD (Task 25)
             editor/tokens/** editor/nodes/dateToken.ts (view) editor/nodes/textStyle.ts editor/nodes/indent.ts
             editor/nodes/listItemOptions.ts editor/menus/BlockStyleMenu.tsx (26)
             editor/blockref/** editor/nodes/blockRef.ts editor/turnInto.ts editor/handles/BlockMenu.tsx editor/embed/ObjectEmbedView.tsx (27)
             editor/table/** (28)  editor/code/** editor/nodes/codeBlock.{ts,css} (29)
             editor/embed/DataViewEmbedView.tsx editor/nodes/dataViewEmbed.ts editor/media/{recordAudio.ts,AudioRecorder.tsx} (30)
docs/superpowers/plans/m8-acceptance.md  docs/superpowers/plans/remaining-work.md (M8 rows)           Task 31
```

### Shared files and ordering

| File | Edited by | Why it forces order |
|---|---|---|
| `pyproject.toml`, `uv.lock`, `frontend/package.json`, `frontend/package-lock.json` | **Task 1 only** | the dependency task |
| `backend/objectapp/server.py`, `apictx.py`, `settings.py`, `backend/tests/conftest.py`, `backend/tests/fixtures/space-m8/**`, `backend/tests/fixtures/.gitattributes` | **Task 2 only** | every backend task waits for Task 2's commit; the new routers are already included, so no later task edits `server.py` |
| `backend/objectapp/api_tasks.py` | Task 2 (empty), then 11, then 12 | lane T sub-lane T1, in order |
| `backend/objectapp/api_history.py`, `space.py`, `whiteboardstore.py`, `history.py` | Task 2 (`api_history.py` empty), then **Task 4 only** | `space.py`'s one pre-write hook; Task 6 calls `Space`'s existing relink helpers without editing `space.py` |
| `backend/objectapp/api_merge.py`, `merge.py` | Task 2 (empty router), then Task 6 | |
| `backend/objectapp/api_spaces_m8.py`, `spaces.py`, `basicsetup.py` | Task 2 (the empty router and the no-op `setup` parameter), then Task 8 | `POST /api/spaces` stays in `server.py` and calls `spaces.create_space(…, setup=)`, whose `setup` parameter Task 2 adds as a no-op for `'blank'` and Task 8 fills for `'basic'` |
| `backend/objectapp/api_blocks.py`, `rows.py`, `searchtext.py` | Task 2 (empty router), then Task 27 | |
| `taskmodel.py`, `recurrence.py` | Task 10 only | |
| `taskhook.py`, `typemodel.py`, `tasklog.py` | Task 11 only | |
| `reminders.py` | Task 12 only | |
| `calendarquery.py`, `linkindex.py` | Task 15 only (also the `collection:`/`query:` embed rule and the `#^id` regression guard) | |
| `api_search.py`, `searchindex.py` | Task 16 only | |
| `references.py`, `api_references.py` | Task 18 only | |
| `whiteboardfile.py`, `whiteboardindex.py` | Task 20 only | |
| `frontend/src/api/{types,client}.ts`, `test/mockApi.ts`, `settings/useSettings.ts`, `settings/defaults.ts`, `lib/shortcuts.ts`, `lib/zonedTime.ts`, `nav/tabs.ts`, `App.tsx`, `shell/MainPanel.tsx`, `shell/GlobalOverlays.tsx`, `object/ObjectView.tsx` | **Task 3 only** | every frontend task waits for Task 3's commit |
| each stub module Task 3 creates (File Structure) | Task 3, then its one owner | the owner replaces the stub's body, keeping its exported names and signatures |
| `shell/SidePanelArea.tsx` | Task 3 (the `backlinks` case renders the stub), then Task 18 | |
| `palette/CommandPalette.tsx` | Task 16, then Task 17 | lane S sub-lane S1, in order |
| `properties/DatePicker.tsx` | Task 13, then Task 14 | lane T sub-lane T2, in order |
| `properties/format.ts`, `properties/cells/NumberCell.tsx`, `calendar/dates.ts`, `settings/SettingsModal.tsx`, `settings/sections/{Language,DateTime,Editor}.tsx` | Task 7 only | |
| `settings/sections/SpaceSettings.tsx`, `spaces/**` | Task 8 only (after Task 7 in sub-lane A3) | |
| `api/whiteboardTypes.ts`, `api/whiteboardClient.ts`, `whiteboard/**` except `whiteboard/ink/**` and `whiteboard/plugin.ts` | Tasks 20 → 21 → 22 → 23 | lane W sub-lane W1, in order (`whiteboard/turnInto.ts` and `AddToWhiteboardDialog.tsx`: Task 3's stubs, filled by Task 22) |
| `whiteboard/ink/**`, `whiteboard/plugin.ts` | Task 24 only | the ink layer gets its own select mode so the canvas files stay untouched |
| `editor/{annotations,blockTree,blocks,document,preserve}.ts`, `editor/extensions/blockSource.ts`, `editor/Editor.tsx`, `editor/shortcuts.ts`, `editor/slash/slashItems.ts`, `editor/slash/parseDate.ts`, `editor/editor.css` | **Task 25 only** | the round-trip owner; Tasks 26–30 consume them unchanged |
| `editor/nodes/{textStyle,indent,listItemOptions,dateToken}.ts`, `editor/tokens/TokensMenu.tsx`, `editor/menus/BlockStyleMenu.tsx` | Task 25 (new files), then Task 26 | |
| `editor/nodes/blockRef.ts`, `editor/turnInto.ts`, `editor/handles/BlockMenu.tsx`, `editor/embed/ObjectEmbedView.tsx`, `editor/blockref/**` | Task 25 (new files), then Task 27 | |
| `editor/table/**` | Task 28 only | |
| `editor/code/**`, `editor/nodes/codeBlock.{ts,css}` | Task 29 only | |
| `editor/nodes/dataViewEmbed.ts`, `editor/embed/DataViewEmbedView.tsx`, `editor/media/{recordAudio.ts,AudioRecorder.tsx}` | Task 25 (new files), then Task 30 | |
| `docs/superpowers/plans/remaining-work.md` (M8 rows), `m8-acceptance.md`, `scripts/m8_acceptance.py` | Task 31 only | this plan's own commit adds the M8 section |

Dependency edges: 1 → 2 → 3 (lane A, first); 2 → every backend task; 3 → every frontend task; 1 → 8, 22, 29; 4 → 5; 7 → 8; 10 → 11 → 12; 13 → 14; 16 → 17; 20 → 21 → 22 → 23; 25 → 26, 27, 28, 29, 30. Cross-lane *runtime* calls go through Task 3's stubs, so no task waits on another lane's feature: until its owner lands, a stub renders nothing or throws `NotBuiltYet` (caught and shown as "Not available yet" (our string) by its caller), and tests mock it.

---

### Task 1: Dependencies (lane A; first)

**Files:**
- Modify: `frontend/package.json`, `frontend/package-lock.json` (`npm install --save-exact highlight.js@11.11.1 html-to-image@1.11.11` in `frontend/`), `pyproject.toml`, `uv.lock` (`uv add tzdata==2026.5 send2trash==2.1.0`)

**Interfaces:**
- Produces: the four packages at exact pins. Nothing else changes.

- [ ] **Step 1:** If `frontend/package.json` already pins `highlight.js` `11.11.1` and `html-to-image` `1.11.11` and `pyproject.toml` lists `tzdata==2026.5` and `send2trash==2.1.0` (the workflow may have installed them), skip to Step 3.
- [ ] **Step 2:** Install as in Files. Check `npm ls highlight.js html-to-image` shows the exact versions and no peer warnings; `uv run python -c "import zoneinfo, send2trash; zoneinfo.ZoneInfo('Europe/Berlin')"` succeeds.
- [ ] **Step 3:** Run `uv run pytest backend/tests -q` and `cd frontend && npm ci && npx vitest run && npx tsc -b --noEmit && npm run build`. Expected: PASS at the baseline counts.
- [ ] **Step 4:** Commit (skip when nothing changed):
  ```
  chore(deps): add M8 dependencies (highlight.js, html-to-image, tzdata, send2trash)

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 2: Backend contract, `space-m8` fixture, settings keys, router stubs, time zone (lane A; after Task 1)

**Files:**
- Create: `backend/tests/fixtures/space-m8/**`, `backend/tests/test_fixtures_m8.py`, `backend/tests/test_settings_m8.py`, `backend/objectapp/{api_tasks,api_history,api_blocks,api_merge,api_spaces_m8}.py` (each `def router(ctx: ApiContext) -> APIRouter: return APIRouter()` with a docstring naming its owner task and routes)
- Modify: `backend/tests/conftest.py` (`m8_space_dir`, a `shutil.copytree` into `tmp_path` like `blocks_space_dir`), `backend/tests/fixtures/.gitattributes` (`space-m8/Attachments/* binary`), `settings.py` (the new keys, defaults and shape checks of the contract; `timeZone` checked with `zoneinfo.ZoneInfo`), `apictx.py` (`ApiContext` gains `settings_changed: Callable[[dict], None]`), `server.py` (include the five routers; at start-up and after every successful `PUT /api/settings`, set `space.tz` to `ZoneInfo(timeZone)` when set, else `SystemTz()`; `POST /api/spaces` passes `setup` through to `spaces.create_space`), `spaces.py` (`create_space(…, setup='blank')` parameter only: `'blank'` is today's behaviour, `'basic'` raises `NotImplementedError` until Task 8)

**Interfaces:**
- Consumes: M7's `settings.py` (`DEFAULTS`, `_CHOICES`, `_BOOLS`, `SettingsProblem`), `localtime.SystemTz`, M5's router pattern (`api_graph.py`), `ApiContext`.
- Produces: the fixture every M8 backend test and Task 31 use; the settings keys; the five empty routers already mounted on `/api`; `space.tz` following the setting.

The space (all content invented, clock 2026-10-27 local, a Tuesday):
- `.capacities/types/`: `page.json`, `task.json` (status options with a Done-category option, `date` with `supportsReminders`, `deadline` with `options.constraints.supportsReminders: true`), `person.json`, `tag.json`, `dailynote.json`, `whiteboard.json`; `collections/reading-list.json`, `queries/open-tasks.json`; **no** `space.json`, **no** `ui.json`.
- `Tasks/`: `Water plants.md` (`every day`, `date: 2026-10-24`, a three-line `occurrenceLog`, so three occurrences are overdue on the 27th), `Weekly review.md` (`every week on mon, fri`), `Pay rent.md` (`every month on the last day`), `Board meeting.md` (`every month on the 2nd tuesday`), `Anniversary.md` (`every year on march 15`), `Stretch.md` (`every day after completion`), `Submit report.md` (`deadline: 2026-10-29`, `reminders:` `deadline: 1 day before at 09:00`), `Broken log.md` (an `occurrenceLog` with one garbage line).
- `Pages/`: `Blocks M8.md` (inline `<span data-color="text-red">`, `<mark data-color="bg-yellow">`, bare `<mark>`, a block with ` ^ab12cd`, an `<!-- indent -->` container, list items with `<!-- item: color=text-blue -->`, a table with `=SUM(B2:B3)` and `=A1/0`, fenced `python` and `js` code, `<time datetime="2026-10-27">2026-10-27</time>`, `![[collection:reading-list]]`, `![[query:open-tasks]]`, `![[Source note#^ab12cd]]`), `Source note.md` (the block `^ab12cd`, and `^zz9zz9` in a list item), `CRLF M8.md` (CRLF + BOM with a span, a block id and an indent container), `Malformed M8.md` (an unclosed `<span data-color="text-red">`, `<mark data-color="bg-nope">`, `^TOOLONG1`, `![[collection:]]`, a stray `<!-- /indent -->`), `Merge source.md` / `Merge target.md` (overlapping single and list properties, both with bodies), `Refers to source.md` (links `[[Merge source]]` in body and in a relation), `Day links.md` (links `[[2026-10-27]]`), `Timed meeting.md` (a datetime property `2026-10-27T13:30:00Z`).
- `Tags/Old tag.md`, `Tags/New tag.md`, `People/Ada Lovelace.md` (tagged `Old tag`).
- `DailyNotes/2026-10-27.md`.
- `Whiteboards/Media board.md` + `Media board.whiteboard.json` (a `media` block for `Attachments/pixel.png`, a `media` block for `Attachments/report.pdf`, a `weblink` block, a locked node, three frames with `readingOrder`, an unknown key `"x-future": 1` at block level) + `Media board.ink.svg` (two strokes).
- `Attachments/pixel.png`, `report.pdf`, `clip.wav` (valid minimal files, as M7's).

- [ ] **Step 1: Write failing tests**
  - `test_fixtures_m8.py`: `test_every_md_has_frontmatter`, `test_m8_space_opens_without_writing` (open twice; no file changed or created), `test_expected_inventory` (the lines above are present verbatim; `CRLF M8.md` is CRLF with a BOM).
  - `test_settings_m8.py`: `test_m8_defaults`, `test_m8_keys_shape_checks` (one bad value per key, an unknown zone `Mars/Base` is 422), `test_time_zone_setting_applies_to_space_tz` (PUT `Europe/Berlin` then `GET /api/calendar` `today` follows the zone under `OBJECT_CLOCK_FILE` at 2026-10-27T23:30:00Z: `2026-10-28`; PUT `null` returns to the device zone), `test_m8_routers_mounted` (each new module's router is included: an unknown path under it is 404, not 405).
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_fixtures_m8.py backend/tests/test_settings_m8.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement as in Files.
- [ ] **Step 4:** Run `uv run pytest backend/tests -q`. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(backend): M8 contract, fixtures and router stubs

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 3: Frontend contract, targets, menus, mount points and stubs (lane A; after Task 2's commit, so the mock follows the real shapes)

**Files:**
- Modify: `api/types.ts`, `api/client.ts`, `test/mockApi.ts` (every type and method of the contract; the mock returns empty-but-valid shapes), `settings/useSettings.ts`, `settings/defaults.ts` (the new keys), `lib/shortcuts.ts` (the new ids of Global Constraints, `provisional: true`, editor ones `bound: true` with handlers in Task 25, presentation and focus ones bound in Task 9, whiteboard ones in Task 21), `nav/tabs.ts` (`Target` `search`, `SidepanelTarget` `backlinks`, `sameTarget` for both), `App.tsx` and `shell/MainPanel.tsx` (route `search` to `search/SearchPage.tsx`; tab label "Search" (`LocalSpaceQuery.heading`)), `shell/SidePanelArea.tsx` (`backlinks` renders `references/BacklinksPanel.tsx`), `shell/GlobalOverlays.tsx` (mount `VersionHistoryDialog`, `MergeDialog`, `FocusMode`, `Presentation`, `AddToWhiteboardDialog`), `object/ObjectView.tsx` (`…` menu items "Version History" (`EntityMenu.versionHistory.text`), "Merge into object" / for tags "Merge into tag" (`EntityMenu.mergeObject.text`, `mergeTag.text`), "Present" (`EntityMenu.presentationMode.text`), "Add to whiteboard" (`Whiteboard.addTo.action`); a header button "Enter Focus Mode" / "Leave Focus Mode" (`ComponentHeader.focusMode.*`); `<TaskStatsSection>` under the property panel of task-role objects)
- Create: `lib/zonedTime.ts` (real: `zonedToday()`, `zonedParts(instant)`, `formatInZone(instant, opts)` reading `timeZone` from `useSettings`, through `Intl.DateTimeFormat`), and the stubs: `history/{useVersionHistory.ts,VersionHistoryDialog.tsx}`, `merge/{useMerge.ts,MergeDialog.tsx}`, `focus/{useFocusMode.ts,FocusMode.tsx}`, `present/{usePresentation.ts,Presentation.tsx}`, `tasks/TaskStatsSection.tsx`, `search/{SearchPage.tsx,openSearch.ts}` (`openExtendedSearch(q?, textOnly?)` is real: `useTabs.getState().open({kind: 'search', q, textOnly})`), `references/BacklinksPanel.tsx`, `whiteboard/{turnInto.ts,AddToWhiteboardDialog.tsx}` (`turnBlocksIntoWhiteboard(markdownBlocks, title)` and `addObjectToWhiteboard(objectPath)` throw `NotBuiltYet`; `useAddToWhiteboard` store real); `lib/notBuilt.ts` (`class NotBuiltYet extends Error`, `NOT_AVAILABLE = 'Not available yet'` our string)
- Test: `api/client.m8.test.ts`, `lib/shortcuts.m8.test.ts`, `lib/zonedTime.test.ts`, `object/ObjectView.m8.test.tsx`, `App.m8.test.tsx`

**Interfaces:**
- Consumes: M7's `api` patterns (`request`, `json`, `CLIENT_ID`, the typed errors), `useTabs`, `useSettings`, `lib/shortcuts.ts`'s collision test helpers.
- Produces: every client method and type; the targets; the menu items and mounts; the stubs (each with the exact export names and props the owner fills: `VersionHistoryDialog()` reads `useVersionHistory` `{path|null, open(path), close()}`; `MergeDialog()` reads `useMerge` `{source|null, open(path), close()}`; `FocusMode()` reads `useFocusMode` `{on, toggle(), timer…}`; `Presentation()` reads `usePresentation` `{path|null, start(path), stop()}`; `TaskStatsSection({path, version})`; `SearchPage({q, textOnly})`; `BacklinksPanel({path})`; `AddToWhiteboardDialog()` reads `useAddToWhiteboard` `{objectPath|null, open(path), close()}`).

- [ ] **Step 1: Write failing tests**
  - `test m8 client methods call the contract routes` (one case per method: method, URL, body)
  - `test new shortcut ids exist with reference names and categories`, `test provisional keys do not collide with existing bindings in the same scope` (extends M7's test to the new ids)
  - `test zoned today follows the time zone setting` (fake clock 2026-10-27T23:30:00Z, `Europe/Berlin` → `2026-10-28`; null → the device zone)
  - `test object menu offers version history, merge, present and add to whiteboard` (and "Merge into tag" for a tag), `test focus mode button toggles the store`, `test task stats section mounts only for task objects`
  - `test search target routes to the search page and labels its tab`, `test backlinks side panel entry renders the panel`
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/api/client.m8.test.ts src/lib src/object/ObjectView.m8.test.tsx src/App.m8.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement as in Files.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit && npm run build`. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(app): M8 client contract, targets, menus and stubs

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 4: Version history store and routes (lane A, sub-lane A1)

**Files:**
- Create: `history.py`, `backend/tests/test_history.py`
- Modify: `api_history.py` (the three routes), `space.py` (one hook: `Space.before_write: Callable[[str, bytes], None] | None`, called with the file's current bytes inside the lock right before `atomic_write` in `_write`, `_write_exact`, `_rewrite_other`, and before the rename move in `_move_file` when the bytes change; never on create, never on read), `whiteboardstore.py` (the same hook before the board and ink `atomic_write`)

**Interfaces:**
- Consumes: `appstate.state_dir()`, `textfile.atomic_write`, `jsonstore.dump_json`, M4's clock (`Space.clock`), `frontmatter` helpers to replace `title` and `id` values on restore, `Space._write_exact` for the restore write, `whiteboardstore`'s save for boards.
- Produces: `history.HistoryStore(space_root)` with `snapshot(rel, data, now)` (the 5-minute and 200-version rules of Global Constraints), `versions(rel)`, `content(rel, id)`, `restore(space, rel, id, base_version, now)`; the routes of the contract; `create_app` wiring through `ApiContext` (Task 2 left `api_history.router(ctx)` included; Task 4 builds the store in the router factory and sets `space.before_write` there, so `server.py` stays untouched).

- [ ] **Step 1: Write failing tests** (`m8_space_dir`, `OBJECT_CLOCK_FILE`)
  - `test_snapshot_only_before_app_writes` (a body save keeps the old bytes; a second save inside 5 minutes keeps nothing new; after 5 minutes it keeps one more), `test_history_reads_write_nothing`, `test_history_lives_in_state_dir` (nothing new in the space)
  - `test_versions_numbered_oldest_first_listed_newest_first`, `test_prune_at_200`
  - `test_history_follows_rename_by_id`, `test_object_without_id_keyed_by_path`
  - `test_restore_puts_bytes_back`, `test_restore_keeps_current_as_version`, `test_restore_keeps_title_and_id`, `test_restore_stale_409`, `test_restore_crlf_bom_kept`
  - `test_board_and_ink_snapshots_and_restore` (version content `text` is null for boards)
  - `test_relink_and_property_writes_snapshot_referrers` (a rename's relinked file gets a version)
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_history.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `uv run pytest backend/tests -q`. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(backend): version history for objects and whiteboards

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 5: Version History dialog (lane A, sub-lane A1; after Task 4)

**Files:**
- Modify (fill Task 3's stubs): `history/useVersionHistory.ts`, `history/VersionHistoryDialog.tsx`
- Create: `history/VersionPreview.tsx`, `history/VersionHistoryDialog.test.tsx`

**Interfaces:**
- Consumes: `api.history`, `api.historyVersion`, `api.restoreVersion`, M1's read-only `Editor` (`readOnly`) for the preview, M2's property list renderer for "Properties", `lib/flush.ts` (flush the open editor before a restore), M3's toast/banner pattern.
- Produces: the dialog: title "Version History", a list "Version {number}" with the time and "{count} block | {count} blocks" / "{count} property | {count} properties"; "Select a version" / "Choose a version from the list to preview it here."; the preview (body read-only and a "Properties" section); "Restore" → "Restore this version?" / "This will restore your content to version {number}. Your current state will be saved as a new version." / "Restores content and properties. Files stay as they are now." / "Cancel" / "Restore"; "Version restored successfully"; the errors `VersionHistory.fetchError*`, `previewError*`, `restoreError*`; empty "No version history available yet" / "Versions will appear here after this object is edited."; whiteboards: "Preview isn't available" / "Select a version and restore it. Whiteboards don't show a preview.". A 409 reloads the list and says "Changed elsewhere. Reloaded." (M5's string).

- [ ] **Step 1: Write failing tests:** `test lists versions newest first with counts`, `test selecting shows the preview`, `test restore asks then restores and reports success`, `test restore conflict reloads`, `test whiteboard versions are restore only`, `test empty and error states use reference strings`.
- [ ] **Step 2:** Run `npx vitest run src/history`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(history): version history dialog with preview and restore

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 6: Merge into object and Merge into tag (lane A, sub-lane A2)

**Files:**
- Create: `merge.py`, `backend/tests/test_merge.py`, `merge/MergeDialog.test.tsx`
- Modify: `api_merge.py` (the route), `merge/useMerge.ts`, `merge/MergeDialog.tsx` (Task 3's stubs)

**Interfaces:**
- Consumes: `Space` as built and **unchanged**: `update_properties`, `save_body`, `_referrers`, `_relink_edit`, `_rewrite_other`, `_board_referrers` and the board relink M6 uses in `rename_object`, `relink.rewrite_tag_lists`, `delete_object` (the trash), `space.links.backlinks`; frontend: M5's object picker (`palette/SearchView` result rows or `links/LinkPicker.tsx` in pick mode), `api.mergeObject`.
- Produces: `merge.merge_objects(space, source, target, source_version, target_version, now) -> MergeResult` per Global Constraints "Merge"; the route (428 / 409 / 413 / 422); the dialog: "Merge into" picker ("No other objects found" / "No other tags found", "Loading…"), confirm "Are you sure you want to merge “{sourceName}” into “{targetName}”?" with the description and "Merge", progress "Merging objects…", result "Object successfully merged" / "Tag successfully merged" (opens the target), errors `mergeObject.error`, `errorTooLarge` + description with `{limit}`.

- [ ] **Step 1: Write failing tests**
  - backend: `test_merge_requires_confirm_428`, `test_merge_values_lists_and_body` (single kept, empty filled, lists unioned, body appended with one blank line, dropped properties listed), `test_merge_relinks_and_trashes_source` (only links to the source change; `git diff`-style byte check on `Refers to source.md`), `test_merge_restore_from_trash`, `test_merge_tag_rewrites_tag_lists`, `test_merge_into_self_or_cross_kind_422`, `test_merge_stale_409_changes_nothing`, `test_merge_over_limit_413`, `test_merge_relinks_boards`
  - frontend: `test merge picker excludes the source and lists only tags for a tag`, `test confirm then merge opens the target`, `test errors use reference strings`
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_merge.py -q` and `npx vitest run src/merge`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both full suites. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(merge): merge an object or tag into another

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 7: Language, decimal separator, time zone and backlink defaults in Settings (lane A, sub-lane A3)

**Files:**
- Create: `settings/sections/Language.tsx` (+ test)
- Modify: `settings/SettingsModal.tsx` (nav item "Language" (`LanguageSettings.heading`) in the App group), `settings/sections/DateTime.tsx` (Time zone), `settings/sections/Editor.tsx` (the backlink settings), `properties/format.ts` (locale and decimal separator for numbers, dates and times; the zone through `lib/zonedTime.ts`), `properties/cells/NumberCell.tsx` (parsing with the separator), `calendar/dates.ts` ("today" from `zonedToday()`)

**Interfaces:**
- Consumes: `useSettings` (Task 3), `lib/zonedTime.ts`, `Intl.supportedValuesOf('timeZone')`.
- Produces:
  - **Language:** "Change your language" / "You can change the language of the application interface." with the nine locales by their own names (our labels), plus our info line "Object's interface is in English; the language sets how dates and numbers are formatted." (our string). "Decimal separator" / its explanation / "Automatic", "Dot", "Comma".
  - **Date & Time:** "Time zone" / "Select your preferred time zone." (a searchable list; none = the device zone), the mismatch line (our string, adapted from `DateAndTimeSettings.timeZone.missmatch`: "Your time zone in Object does not match the time zone of your device.") and "Set to local time zone".
  - **Editor:** "Default state for backlink sections" / its description, rows "Backlinks", "Related Content", "Unlinked Mentions" each "Open" / "Closed" / "Hidden"; "Backlink content view" / description with the four object views (M7's names "Link block", "Small card", "Wide card", "Embed"); "Hide related content for object types" / description / "Clear all"; "Default display of nested backlinks" / description / "Only block with backlink" / "Full path above".
  - `format.ts`: `formatNumber(n, opts)` uses `,` or `.` per the setting ('automatic' follows the locale); `formatDate`/`formatPoint` use the language's locale for 'localized' and the zone for instants. Stored values never change (M7 rule).

- [ ] **Step 1: Write failing tests:** `test language section lists locales and saves`, `test decimal separator formats and parses numbers`, `test localized dates follow the language`, `test time zone picker saves and shows mismatch`, `test reset sets the device zone`, `test backlink defaults save each section`, `test nested backlink mode saves`, `test calendar today follows the zone`.
- [ ] **Step 2:** Run `npx vitest run src/settings src/properties src/calendar/dates.test.ts`. Expected: FAIL (the new cases).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(settings): language, decimal separator, time zone and backlink defaults

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 8: Spaces: delete a space folder, basic setup (lane A, sub-lane A3; after Task 7; needs Task 1's `send2trash`)

**Files:**
- Create: `basicsetup.py`, `backend/tests/test_spaces_m8.py`, `backend/tests/test_basicsetup.py`
- Modify: `spaces.py` (`delete_space(path, permanent)`, `create_space(…, setup='basic')`), `api_spaces_m8.py` (`POST /api/spaces/delete`), `settings/sections/SpaceSettings.tsx` (a "Delete space" row, disabled for the current space with our hint "Switch to another space to delete this one."), `spaces/SpacesMenu.tsx` (each non-current space's menu gains "Delete space"), `spaces/CreateSpaceDialog.tsx` ("How do you want to start?" with "Start with basic setup" / "Includes people, meetings, projects, and books." and "Start with a blank space" / "Add object types when you need them."), new `spaces/DeleteSpaceDialog.tsx`

**Interfaces:**
- Consumes: M7's `spaces.py` registry, `appstate`, `send2trash.send2trash`, `OBJECT_FAKE_TRASH_FILE`; M2's type JSON writer (`typedefs`/`jsonstore`) for basic setup.
- Produces: the route per the contract and Global Constraints; `basicsetup.basic_types()` → four `TypeDefinition`s named from `components.{person,meeting,project,book}` (name, plural, description, icon our choice) with the property names from the strings and these kinds (**our choice**, listed for Gene): Person: Picture (image), Category (multi label), Organizations (relation), Projects (relation to Project), Meetings (relation to Meeting), Notes (blocks); Meeting: Date (datetime), Type (label), Attendees (relation to Person), Project (relation to Project), Reviewed (checkbox), Cover image (image), Notes (blocks); Project: Status (label as status), Type (label), Timeframe (date range), Collaborators (relation to Person), Organizations (relation), Meetings (relation to Meeting), Cover image (image), Notes (blocks); Book: Authors (relation to Person), Genre (multi label), Type (label), Rating (number, progress format out of 5), Reading timeline (date range), Cover image (image), Notes (blocks). The delete dialog: "Delete this space?" / "Deletes the space and everything in it." / "Delete space"; on 428 the second step adds "This can't be undone." and sends `permanent: true`.

- [ ] **Step 1: Write failing tests**
  - backend: `test_delete_space_refuses_current_409`, `test_delete_space_refuses_unregistered_or_plain_folder_404`, `test_delete_space_trashes_by_default` (fake trash records the path; the folder is gone from its place; registry updated), `test_permanent_delete_needs_428_then_rechecks_folder` (fake trash `unavailable` → 428; `permanent` deletes; a folder swapped in between is refused), `test_basic_setup_writes_four_types` (only `.capacities/space.json` and four type files), `test_blank_setup_unchanged` (regression guard, green from the start)
  - frontend: `test delete dialog trashes then removes from list`, `test permanent delete second step`, `test current space cannot be deleted`, `test create dialog offers basic setup`
- [ ] **Step 2:** Run the new backend and frontend tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both full suites. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(spaces): delete a space folder to the trash, start with basic setup

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 9: Focus mode and object presentation mode (lane A, sub-lane A4)

**Files:**
- Modify (fill stubs): `focus/useFocusMode.ts`, `focus/FocusMode.tsx`, `present/usePresentation.ts`, `present/Presentation.tsx`
- Create: `focus/FocusTimer.tsx`, `present/slides.ts`, `present/PresentationSettings.tsx`, `present/shortcuts.ts`, tests for each

**Interfaces:**
- Consumes: `useSettings` (`presentation`), `lib/shortcuts.ts` (`toggleFocusMode`, `openPresentationMode`, `exitPresentationMode`, `next/previousPresentationSlide`), M1's read-only `Editor`, `api.object`, the shell's sidebar and side-panel toggles (`useTabs`, M7's side-panel store).
- Produces:
  - **Focus mode** ("Enter Focus Mode" / "Leave Focus Mode"; palette "Toggle focus mode"): hides the left sidebar, the tab strip, the side panel and the property panel and centres the page; restores each one's previous state on leave. "Focus mode is not available here" on non-object targets (our rule: objects only). The timer ("Focus", "Choose focus duration", presets 15, 25, 45 and 60 min (**our choice**), "Focus for {minutes} minutes", "Start a {minutes} minute focus session", "{time} remaining", "Pause timer" / "Resume timer" / "Stop timer" / "Cancel timer", on finish "Focus time completed" / "You focused for {minutes} minutes." with "Continue"); the timer survives a reload through `localStorage` and never writes a file.
  - **Presentation** ("Present", `openPresentationMode`): full-screen slides from the object: a **title slide** (title, cover image unless "Hide cover image", description, the visible properties) then **a new slide at each top-level H1 or H2 heading and each top-level horizontal line** (**our choice**; the splitting rule is not in the trimmed reference); "Previous slide" / "Next slide" / "Exit presentation" / "Slide number"; the progress bar unless "Hide progress indicator"; the title in the header unless "Hide title in header"; "Left footer" / "Right footer" text. "Presentation settings" popover with the `PresentationSettings.preferences.*` and `footer.left/right.*` rows (the watermark row and "Block properties" are left out: no watermark, no block properties in our model; listed for Gene).

- [ ] **Step 1: Write failing tests:** `test focus mode hides chrome and restores it`, `test focus timer counts down and completes`, `test focus unavailable off objects`, `test slides split at top level h1 h2 and rules`, `test title slide follows settings`, `test arrow keys and escape navigate and exit`, `test presentation settings save`.
- [ ] **Step 2:** Run `npx vitest run src/focus src/present`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(app): focus mode with timer and object presentation mode

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 10: Custom recurrence rules (lane T, sub-lane T1; first)

**Files:**
- Modify: `taskmodel.py` (`RepeatRule.on`, the grammar of Global Constraints, `format_repeat`), `recurrence.py` (`step` and `occurrences` for `on` rules; RFC 5545 skipping; weekly lists with the week start)
- Create: `backend/tests/test_recurrence_m8.py`

**Interfaces:**
- Consumes: M4's `parse_repeat`/`format_repeat`, `recurrence.next_occurrence`/`occurrences`, `localtime`, `ui.json` `calendar.weekStart` (read through `uistate`, never written).
- Produces: the extended `RepeatRule` (`to_dict` adds `on` only when present, so M4's API shapes are unchanged for M4 rules); `recurrence.scheduled_between(rule, current, start, end, tz)` (every scheduled date in a range, used by Task 11's overdue and stats).

- [ ] **Step 1: Write failing tests:** `test_custom_rule_vectors` (the shared table, parse + canonical + next), `test_month_day_31_skips_short_months`, `test_last_day_and_last_weekday`, `test_weekly_on_list_respects_week_start`, `test_until_ends_custom_rules`, `test_time_resolution_keeps_wall_clock_with_on`, `test_scheduled_between`, `test_m4_vectors_unchanged` (regression guard, green from the start).
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_recurrence_m8.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `uv run pytest backend/tests -q`. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(tasks): custom recurrence rules (on weekdays, nth or last day and weekday)

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 11: Occurrence log, Skip, Excuse, catch-up and Task Stats (lane T, sub-lane T1; after Task 10)

**Files:**
- Create: `tasklog.py` (parse and append the `occurrenceLog` text; garbage lines kept), `backend/tests/test_tasklog.py`, `backend/tests/test_tasks_api.py`
- Modify: `taskhook.py` (completion appends the `completed` line; reopening never removes lines), `typemodel.py` (`topup_task_type` adds the hidden text property `occurrenceLog`, "Occurrence log" (our string), only when absent), `api_tasks.py` (`GET /api/tasks/overdue`, `POST /api/tasks/occurrence`, `GET /api/tasks/stats`)

**Interfaces:**
- Consumes: Task 10's `scheduled_between`, M4's `on_status_change`, `Space.update_properties` (the route computes `date`, `occurrenceLog`, and for completion `status` and `completed`, and writes them in one call; the hook then sees no category change for Skip/Excuse), `Space.clock`.
- Produces: the routes per the contract and Global Constraints "Occurrence actions" and "Task Stats"; one log line per action; the edit touches only `date`, `status`, `completed`, `occurrenceLog` and `lastUpdated` lines.

- [ ] **Step 1: Write failing tests**
  - `test_tasklog.py`: `test_parse_and_format_round_trip`, `test_garbage_line_kept_and_ignored`, `test_append_changes_only_the_block`, `test_crlf_log_keeps_crlf`
  - `test_tasks_api.py`: `test_complete_appends_one_log_line` (through `PUT /api/object/properties`, M4's path), `test_skip_and_excuse_advance_and_log`, `test_overdue_counts_missed` (Water plants: 3), `test_overdue_capped_at_99`, `test_catch_up_choices` (one case per choice and action, dates and lines exact), `test_completion_mode_has_no_overdue_422`, `test_stats_streak_rate_and_cells`, `test_excused_keeps_streak_and_leaves_rate`, `test_stats_and_overdue_write_nothing`, `test_occurrence_stale_409`, `test_remove_recurrence_removes_log` (removing `repeat` and `occurrenceLog` in one properties write leaves no other line changed), `test_topup_adds_occurrence_log_once`
- [ ] **Step 2:** Run the two files. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `uv run pytest backend/tests -q`. Expected: PASS (M4's task tests unchanged).
- [ ] **Step 5:** Commit:
  ```
  feat(tasks): occurrence log, skip, excuse, overdue catch-up and stats

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 12: Reminders on other date properties (lane T, sub-lane T1; after Task 11)

**Files:**
- Modify: `reminders.py` (task infos and triggers for every date property with `supportsReminders` and an entry in `reminders`; ledger key `<id>|<key>|<date>|<trigger>` for non-`date` keys, M4's key unchanged for `date`), `api_tasks.py` (`PUT /api/tasks/reminder`)
- Create: `backend/tests/test_reminders_m8.py`

**Interfaces:**
- Consumes: M4's `parse_remind`, `trigger_time`, `Ledger`, the scheduler, `Space.update_properties` (the route writes only the `reminders` map's one entry line; removing the last entry removes the key).
- Produces: reminders for any date property of **any type** whose definition has `options.constraints.supportsReminders` (not only Tasks; done status suppresses only for task-role objects); the body "Due {date}" / "Due today" (M4's strings).

- [ ] **Step 1: Write failing tests:** `test_deadline_reminder_fires_once` (fake notifier, `/_test/tick`), `test_reminder_needs_supports_reminders_422`, `test_remind_must_fit_resolution_422`, `test_set_and_clear_reminder_changes_one_line`, `test_m4_date_reminders_unchanged` (regression guard, green from the start), `test_ledger_keys_distinct_per_property`.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_reminders_m8.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `uv run pytest backend/tests -q`. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(tasks): reminders on any date property that supports them

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 13: Task UI: Skip, Excuse, overdue dialog, Task Stats, custom repeat "On", remove recurrence (lane T, sub-lane T2)

**Files:**
- Modify: `tasks/repeat.ts` (mirror of the extended grammar), `tasks/CustomRepeatDialog.tsx` (the "On" row: weekday chips for weeks; "The {day}", "{pos} {day}", "Last day", "Last {day}" for months; "{month} {day}", "{weekday} of {month}" for years, ordinals with `ordinalSuffix.*`), `tasks/RepeatMenu.tsx` (presets "Weekly on {day}", "Monthly on day {date}", "Yearly on {date}" now write the anchored `on` forms; "Remove recurrence" with the confirm), `tasks/TaskCheckbox.tsx` (the menu gains "Skip" and "Excuse", each with its tooltip; overdue recurring tasks open the dialog), `tasks/TaskStatsSection.tsx` (fill the stub), `properties/DatePicker.tsx` (the Repeat parts only)
- Create: `tasks/RecurringOverdueDialog.tsx`, `tasks/taskStats.ts`, tests

**Interfaces:**
- Consumes: `api.overdue`, `api.occurrence`, `api.taskStats`, `api.updateProperties`, M4's `taskActions`.
- Produces: the dialog ("Mark recurring task done" / "Skip recurring task" / "Excuse recurring occurrence"; descriptions with `{title}` and `{count}`; buttons "Mark as done for {date}", "Skip to {date}", "Excuse for {date}" with the hints "This occurrence only", "All missed before today", "Also logs all missed as done" / "Also skips all missed"); the "Task Stats" section (Streak, Best, Completions, Completion rate with its subtitle, All-time, At risk / Keep it up / Start today, the occurrence grid with each cell's state name as its tooltip).

- [ ] **Step 1: Write failing tests:** `test custom rule vectors match the backend table`, `test on row writes canonical rules`, `test skip and excuse call the occurrence route`, `test overdue dialog strings match reference`, `test overdue dialog sends each catch up choice`, `test single missed occurrence acts at once`, `test task stats renders streaks rate and grid`, `test remove recurrence asks when history exists`.
- [ ] **Step 2:** Run `npx vitest run src/tasks src/properties/DatePicker.test.tsx`. Expected: FAIL (the new cases).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(tasks): skip, excuse, overdue catch-up dialog, task stats and custom repeat on

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 14: Reminders on any date property (UI); Day view Backlinks, Date references, Timeline (lane T, sub-lane T2; after Task 13)

**Files:**
- Modify: `properties/DatePicker.tsx` (the Reminder menu for every date property with `supportsReminders`, writing through `api.setReminder`; the Task `date` keeps M4's path), `properties/PropertySettings.tsx` (a "Reminders" switch for date properties that sets `options.constraints.supportsReminders`; "Reminders" is our string), `calendar/DaySections.tsx` (three sections after M4's: "Backlinks" / "No backlinks", "Date references" / "No references", "Timeline" with "Created" items / "No date references."; each lists object cards as M4's sections do; the filter tabs gain none)
- Create: tests

**Interfaces:**
- Consumes: `CalendarDay.backlinks/references/timeline` (`?? []`), `formatInZone`, M4's section components, `tasks/ReminderMenu.tsx`.
- Produces: the sections and the reminder UI.

- [ ] **Step 1: Write failing tests:** `test reminder menu shows for a supports reminders property`, `test reminder writes through set reminder`, `test reminders switch sets the constraint`, `test day view shows backlinks, date references and timeline`, `test empty states use reference strings`, `test missing fields read as empty` (a server before Task 15).
- [ ] **Step 2:** Run `npx vitest run src/properties src/calendar`. Expected: FAIL (the new cases).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(calendar): reminders on any date, day backlinks, date references and timeline

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 15: Calendar day backend: backlinks, date references, timeline; link-index rules (lane T, sub-lane T3)

**Files:**
- Modify: `calendarquery.py` (the three fields), `linkindex.py` (date tokens `<time datetime="YYYY-MM-DD">` per object, counted outside code; `![[collection:…]]` and `![[query:…]]` are not links; `[[T#^id]]` and `![[T#^id]]` are links to `T`)
- Create: `backend/tests/test_calendar_m8.py`

**Interfaces:**
- Consumes: M5's `LinkIndex` (listener-fed), M4's `CalendarQuery` and `_summary_dict`, `Space.tz`.
- Produces: `backlinks` = objects linking to the day's title `[[YYYY-MM-DD]]`, whether or not the daily note exists (our choice), the daily note itself excluded; `references` = objects with date tokens for the day, with the count; `timeline` = the day's timed items sorted by time: creations (`kind: 'created'`, the `createdAt` instant), time-resolution date values (`'dated'`, with `key`), time-resolution Task dates (`'task'`) (our reading of "Timeline"). `LinkIndex.date_tokens(path)` for Task 31's checks.

- [ ] **Step 1: Write failing tests:** `test_day_backlinks_without_daily_note`, `test_date_references_count_tokens`, `test_tokens_in_code_ignored`, `test_timeline_sorted_with_kinds`, `test_calendar_m8_sections_write_nothing`, `test_dataview_embeds_are_not_links`, `test_block_reference_counts_as_link` (regression guard, green from the start if M5's `#` handling already covers it).
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_calendar_m8.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `uv run pytest backend/tests -q`. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(calendar): day backlinks, date references and timeline on the server

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 16: Extended search page and Save as Query (lane S, sub-lane S1)

**Files:**
- Modify: `search/SearchPage.tsx` (fill the stub), `palette/SearchView.tsx` (an "Open extended search" row carrying the query), `palette/CommandPalette.tsx` (Shift+Enter on the search view opens it: our key), `api_search.py`, `searchindex.py` (`mode=fullText`: body matches only; only if `searchindex` can't already filter by field)
- Create: `search/searchPage.css`, `backend/tests/test_search_m8.py`, tests

**Interfaces:**
- Consumes: `api.search` (`mode`), M5's result rows and highlights, M3's `DataView`, `api.createQuery` (M3), `openExtendedSearch`.
- Produces: the page: heading "Search", a query box, "Text matches only" toggle, M5's type and tag filters, results in M3's list view (or table), empty "Enter a search keyword to show content from your space."; "Save as Query" ("Saving...") creates a query whose `definition.search` holds the terms and `searchMode` (`fullText` when "Text matches only", else `auto`) plus the type/tag filters, then opens it.

- [ ] **Step 1: Write failing tests:** backend `test_full_text_mode_skips_title_only_matches`, `test_bad_mode_422` (regression guard for other modes); frontend `test search page runs the query and shows results`, `test text matches only sends full text mode`, `test save as query creates and opens the query`, `test palette opens extended search with the query`.
- [ ] **Step 2:** Run the new tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both full suites. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(search): extended search page with text matches only and save as query

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 17: Palette: clipboard actions, open space, open settings, focus mode, extended search (lane S, sub-lane S1; after Task 16)

**Files:**
- Modify: `palette/actions.ts`, `palette/ActionsView.tsx`, `palette/CommandPalette.tsx`
- Create: `palette/paste.ts` (+ tests)

**Interfaces:**
- Consumes: `navigator.clipboard.read`/`readText` (a denied read shows our line "Clipboard access was denied." and offers nothing), `api.createObject`, `api.saveBody`, `api.createDailyNote`, `api.uploadAttachment`, `api.spaces` and M7's `switchSpace`, `useSettingsModal`, `useFocusMode`, `openExtendedSearch`, `markdownToBody` from `editor/document.ts` (M7's loader) to count blocks.
- Produces: the actions (Capacities' names): "Open extended search", "Open settings", "Open space “{spaceName}”" (one per other registered space), "Toggle focus mode"; and, when the clipboard holds something, the `CommandPalette.paste.*` group: text → "Add to today's daily note" (preview "1 block | {count} blocks"; appends to today's note, creating it; "Added content to daily note") and "Create new page with content"; Markdown with a heading → "Create page" (title from the first heading); files or an image → "Upload" (to `Attachments/`) and, for a single image, an image-object is not created (media are attachments; our choice); a URL → "Create {structureName}" for Page: a page titled with the URL's host and path holding one bookmark block, **never fetched** (our choice).

- [ ] **Step 1: Write failing tests:** `test open space lists other spaces and switches`, `test open settings and toggle focus mode run`, `test add to daily note appends and creates`, `test create page from markdown takes the first heading`, `test upload creates attachments`, `test pasted url creates a page without fetching` (a `fetch` spy sees no call), `test clipboard denied offers nothing`.
- [ ] **Step 2:** Run `npx vitest run src/palette`. Expected: FAIL (the new cases).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(palette): clipboard actions, open space, settings, focus mode and extended search

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 18: References: nested backlink modes, section defaults, related-content hiding, backlinks side-panel entry, drag to swap (lane S, sub-lane S2)

**Files:**
- Modify: `references.py` (backlink contexts gain `ancestors`: the first lines of the enclosing list items, toggle titles and `indent` parents, outermost first), `api_references.py` (passes it through), `references/ReferencesSection.tsx`, `references/BacklinksTab.tsx`, `references/referencesUi.ts`, `references/BacklinksPanel.tsx` (fill the stub), `shell/SidePanelArea.tsx` (after Task 3), `shell/SidePanel.tsx` (the empty entry's "Explore" offers "Backlinks"; dragging an entry's header onto the main view swaps, as "Swap" does), `nav/sidepanel.ts`
- Create: `backend/tests/test_references_m8.py`, tests

**Interfaces:**
- Consumes: settings `backlinkSectionsDefault`, `backlinkContentView`, `relatedContentHiddenTypes`, `nestedBacklinkView`; M5's references API; M7's side-panel store and swap.
- Produces: sections start open, closed or hidden per the setting (a per-object change still wins, M5's `referencesUi`); a backlink shows only its block or the "Full path above" (ancestors as muted lines), switchable per backlink (our control: a small toggle with the two setting names); the backlink content renders in the chosen view; related content is hidden for the listed types; the backlinks side-panel entry (`RenderSidepanel.backlinks.tooltip`) shows the tab object's backlinks and follows the tab; drag-to-swap (M7 known gap).

- [ ] **Step 1: Write failing tests:** backend `test_backlink_context_ancestors`, `test_ancestors_absent_at_top_level`; frontend `test section defaults open closed hidden`, `test per object state wins over default`, `test nested backlink full path above`, `test related content hidden for listed types`, `test backlinks side panel entry follows the tab`, `test dragging an entry onto the main view swaps`.
- [ ] **Step 2:** Run the new tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both full suites. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(references): nested backlink modes, section defaults, backlinks side panel, drag to swap

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 19: Graph PNG export and find in raw mode (lane S, sub-lane S3)

**Files:**
- Modify: `graph/GraphToolbar.tsx` ("Export view as PNG"), `graph/GraphCanvas.tsx` (expose the sigma renderer), `find/FindBar.tsx`, `find/useFind.ts`, `editor/RawMode.tsx` (a CodeMirror search adapter)
- Create: `graph/exportPng.ts`, `find/rawFind.ts`, tests

**Interfaces:**
- Consumes: sigma 3's `renderer.refresh()` and `getCanvases()`, the theme's `--bg-app` token, M5's find bar API (`find`, `matchCase`, `wholeWord`, next/previous, replace, replace all), CodeMirror 6 `EditorView` (`dispatch` of selections and changes).
- Produces: a PNG of the current graph view (all layers composed on the background colour, at device pixel ratio, named `graph.png`, a client-side download); Ctrl+F and the `…` "Find in page" work in raw mode with the same bar: matches are highlighted with CodeMirror decorations, replace edits only the matched ranges and saves through raw mode's autosave.

- [ ] **Step 1: Write failing tests:** `test export composes sigma layers into one png`, `test export button downloads graph png`, `test raw find highlights and steps matches`, `test raw replace changes only matches`, `test match case and whole word in raw mode`.
- [ ] **Step 2:** Run `npx vitest run src/graph src/find src/editor/RawMode.test.tsx`. Expected: FAIL (the new cases).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(graph,find): export the graph view as PNG, find and replace in raw mode

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 20: Whiteboard media and web-link nodes (lane W, sub-lane W1; first)

**Files:**
- Modify: `whiteboardfile.py` (validate `media` blocks: a relative path inside the space, no `..`, not a dot-folder; `weblink` blocks: an `http`/`https` URL, optional title; entity blocks: an optional `view`, one of `inline`, `smallCard`, `wideCard`, `embed`, for Task 21's View menu; unknown keys kept), `whiteboardindex.py` (board text includes web-link titles and URLs; media paths are not links), `api/whiteboardTypes.ts`, `whiteboard/model.ts`, `whiteboard/flowMapping.ts`, `whiteboard/nodes/index.ts`, `whiteboard/chrome/Toolbox.tsx` (the media tool button re-arms the last of "Image", "PDF", "Audio", "File", "Web link", else Image: `resolveWhiteboardMediaTool`), `whiteboard/WhiteboardCanvas.tsx`, `whiteboard/toolMemory.ts`, `whiteboard/strings.ts`
- Create: `whiteboard/nodes/MediaNode.tsx`, `whiteboard/nodes/WeblinkNode.tsx`, `whiteboard/chrome/WeblinkInput.tsx`, `backend/tests/test_whiteboard_m8.py`, tests

**Interfaces:**
- Consumes: M7's `api.uploadAttachment`, `api.fileUrl`, `kind_of` rules (mirrored in `editor/media/upload.ts`), M7's media renderers (`editor/media/MediaView.tsx` read-only pieces: image, PDF iframe, audio element, file row with "open with the OS"), M6's node chrome and history.
- Produces: placing a media tool opens the file picker (accepting the kind), uploads, and places a node of the default size on the grid; dropped files on the board do the same; a web link asks for a URL (and an optional title) and renders a card with the URL's host, never fetching; media nodes resize, keep their aspect for images and video, and open in the OS or the peek viewer on double-click.

- [ ] **Step 1: Write failing tests:** backend `test_media_and_weblink_blocks_validate` (and the entity `view` values), `test_media_path_outside_space_422`, `test_non_http_weblink_422`, `test_unknown_keys_kept_with_media`, `test_board_text_includes_weblink_title`; frontend `test media tool uploads and places a node`, `test media tool remembers the last kind`, `test dropped file becomes a media node`, `test weblink node never fetches`, `test media nodes round trip through flow mapping`.
- [ ] **Step 2:** Run the new tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both full suites. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(whiteboard): media and web-link nodes

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 21: Connector-drop quick-create, entity View menu, keyboard resize, node lock (lane W, sub-lane W1; after Task 20)

**Files:**
- Modify: `whiteboard/WhiteboardCanvas.tsx`, `whiteboard/actions.ts`, `whiteboard/shortcuts.ts` (`whiteboardResize`, `whiteboardResizeLarge`), `whiteboard/chrome/SelectionToolbar.tsx` (Lock / Unlock, our strings; "View" for entity nodes), `whiteboard/nodes/{EntityNode,NodeChrome}.tsx`
- Create: `whiteboard/chrome/QuickCreateMenu.tsx`, `whiteboard/chrome/EntityViewMenu.tsx`, tests

**Interfaces:**
- Consumes: React Flow `onConnectEnd` (the drop point when no handle is hit), `api.createObject`, M6's `ObjectPicker`, shape tools, `lib/shortcuts.ts` ids.
- Produces: dropping a connector on empty canvas opens the menu with "Objects" ("Create Object", "Link Object", "Link {name}" for each type) and "Shapes" (the picker's shapes), "Nothing" (keeps a point end) and "Remove" (drops the connector); the chosen item is placed at the drop point and connected. The entity node "View" menu ("View") switches Link block / Small card / Wide card / Embed (M7's four views, stored as the entity block's optional `view` key, which Task 20's validator accepts; our key). Mod-Alt-Arrow grows or shrinks the selection from the right or bottom edge by one grid step (30 px), with Shift by five ("Grows or shrinks from the right or bottom edge"). A locked node can't be moved, resized or deleted until unlocked; a lock icon shows on hover.

- [ ] **Step 1: Write failing tests:** `test connector drop opens quick create`, `test quick create creates and connects an object`, `test nothing keeps a point and remove drops the edge`, `test entity view menu switches views`, `test keyboard resize steps by grid`, `test locked node refuses move resize delete`.
- [ ] **Step 2:** Run `npx vitest run src/whiteboard`. Expected: FAIL (the new cases).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(whiteboard): quick-create on connector drop, view menu, keyboard resize, node lock

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 22: Clipboard copy/paste, PNG export, Turn into whiteboard, Add to whiteboard (lane W, sub-lane W1; after Task 21; needs Task 1's `html-to-image`)

**Files:**
- Modify: `whiteboard/WhiteboardCanvas.tsx`, `whiteboard/actions.ts`, `whiteboard/chrome/BoardMenu.tsx` ("Export as PNG": our label, adapted from `entity.settings.export.errors.whiteboardClosed`), `whiteboard/turnInto.ts` and `whiteboard/AddToWhiteboardDialog.tsx` (fill Task 3's stubs)
- Create: `whiteboard/clipboard.ts`, `whiteboard/exportPng.ts`, tests

**Interfaces:**
- Consumes: `navigator.clipboard`, `html-to-image` `toPng`, React Flow `getNodesBounds`/`getViewportForBounds`, `api.createObject` (Whiteboard type), `api.saveBoard`, `api.board`.
- Produces: Ctrl+C / Ctrl+X / Ctrl+V of a selection through the system clipboard as `object-whiteboard-v1:` + JSON (nodes, edges between them, their blocks; our prefix, Capacities' is `capacities-whiteboard-v1:`); a paste gets fresh ids and a 30 px offset; pasted plain text becomes a text block, an image an uploaded media node, a URL a web-link node. PNG export of the whole board (or the selection) at 2× with the theme background, named `<title>.png`. `turnBlocksIntoWhiteboard(blocks, title)` creates a board with each block as a text node (object embeds as entity nodes) in a column and returns its path (Task 27 replaces the blocks with an embed of it); `addObjectToWhiteboard(path)` → the dialog picks a board and places an entity node right of the existing content ("Add to whiteboard"; failure "Could not create whiteboard").

- [ ] **Step 1: Write failing tests:** `test copy writes prefixed json`, `test paste assigns fresh ids and offsets`, `test paste text image and url`, `test export png covers all nodes`, `test turn blocks into whiteboard creates a board`, `test add to whiteboard places an entity node`.
- [ ] **Step 2:** Run `npx vitest run src/whiteboard`. Expected: FAIL (the new cases).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit && npm run build`. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(whiteboard): clipboard copy and paste, PNG export, turn into and add to whiteboard

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 23: Floating Inspector, reading order, board Notes, presentation (lane W, sub-lane W1; after Task 22)

**Files:**
- Modify: `whiteboard/WhiteboardPage.tsx` (the Notes editor under the board, "Notes" (`components.RootWhiteboard.propertyDefinitions.RootWhiteboard_notes.name`), M1's body editor on the board's `.md` body, collapsed by default (our choice)), `whiteboard/WhiteboardCanvas.tsx`, `whiteboard/chrome/Toolbox.tsx` ("Play")
- Create: `whiteboard/chrome/FloatingInspector.tsx`, `whiteboard/chrome/BoardPresentation.tsx`, `whiteboard/readingOrder.ts`, tests

**Interfaces:**
- Consumes: M6's board store, `readingOrder`, frames, `FloatingToolbox.presentation.*`, `Whiteboard.control.pagePrev/pageNext`.
- Produces: the inspector ("Outline": the headings in the board's text blocks, click zooms to the block, "No headings in this page"; "Frames": the frames in reading order, click zooms, drag reorders and writes `readingOrder`, "No frames on this whiteboard"; "Stats": counts of nodes by kind, connectors, words and ink strokes (**our choice** of stats); "Pin" / "Unpin"); "Play" presents frame by frame in reading order (else top-to-bottom, left-to-right), fitting each frame, with "Previous page" / "Next page" and "Exit presentation"; Escape exits.

- [ ] **Step 1: Write failing tests:** `test outline lists headings and zooms`, `test frames reorder writes reading order`, `test stats counts`, `test play steps frames in reading order`, `test notes editor saves the board body`.
- [ ] **Step 2:** Run `npx vitest run src/whiteboard`. Expected: FAIL (the new cases).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(whiteboard): floating inspector, reading order, notes and presentation

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 24: Ink: select, move and resize strokes; partial erase; pen tilt (lane W, sub-lane W2)

**Files:**
- Modify: `whiteboard/ink/{InkLayer.tsx,InkToolbar.tsx,inkModel.ts,types.ts,inkStrings.ts}`, `whiteboard/plugin.ts` (`InkToolState.tool` gains `'select'`; `eraseMode: 'stroke'|'partial'`; both optional for the canvas side)
- Create: `whiteboard/ink/inkSelect.ts`, `whiteboard/ink/inkErase.ts`, tests

**Interfaces:**
- Consumes: M6's ink model (`InkStroke`, `getStroke`, pressure), Pointer Events `tiltX`/`tiltY`/`altitudeAngle`.
- Produces: an ink "Select" tool (our label "Select ink", our string): click or lasso selects strokes, drag moves, corner handles scale (points transformed, `d` recomputed), Delete removes; the eraser's "Partial" mode (our string "Erase partially") cuts strokes where the eraser passes, leaving the pieces as new strokes with fresh ids; tilt: pressure × `tiltFactor = 0.6 + 0.4·sin(altitude)` (**our choice**), stored in the existing pressure channel; mouse and touch unchanged.

- [ ] **Step 1: Write failing tests:** `test lasso selects strokes`, `test moving a stroke rewrites only that stroke`, `test scaling recomputes points`, `test partial erase splits a stroke`, `test stroke mode unchanged` (regression guard, green from the start), `test tilt scales pressure`, `test mouse input has no tilt effect`.
- [ ] **Step 2:** Run `npx vitest run src/whiteboard/ink`. Expected: FAIL (the new cases).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(ink): select, move and resize strokes, partial erase, pen tilt

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 25: Editor data layer for every new syntax (lane E; first)

**Files:**
- Modify: `editor/annotations.ts` (container `indent`; the inline `item:` comment), `editor/blockTree.ts` (`indent` containers like toggles), `editor/blocks.ts` (block ids and block-reference lines in the splitter), `editor/document.ts` (load and save of every new node and mark), `editor/extensions/blockSource.ts`, `editor/preserve.ts` (only if needed), `editor/Editor.tsx` (mounts `TokensMenu`), `editor/shortcuts.ts` (binds the new editor ids and Tab/Shift-Tab in any block), `editor/slash/slashItems.ts` ("Today - date link" inserts a date token; typed dates add items; "Record audio" (our string) and the reuse picker's collections and queries), `editor/editor.css`
- Create: `editor/nodes/textStyle.ts` (marks `textColor` and `highlight`), `editor/nodes/dateToken.ts` (inline atom), `editor/nodes/indent.ts`, `editor/nodes/listItemOptions.ts`, `editor/nodes/blockRef.ts` (block node + `copyBlockReference` command: ensures an id with a collision-free 6-character value, writes it onto the block, copies `![[<Title>#^<id>]]`, toasts "Block reference copied"), `editor/nodes/dataViewEmbed.ts`, `editor/slash/parseDate.ts`, stubs `editor/tokens/TokensMenu.tsx`, `editor/turnInto.ts` (`turnIntoObject`, `turnIntoTask`, `turnTodoIntoTask` signatures), `editor/media/recordAudio.ts`; `editor/__fixtures__/m8/*.md` (copies of the `space-m8` bodies)
- Test: `editor/document.m8.test.ts`, `editor/annotations.m8.test.ts`, `editor/slash/parseDate.test.ts`, `editor/shortcuts.m8.test.ts`

**Interfaces:**
- Consumes: M7's codec and byte contract, `lib/shortcuts.ts` ids, `lib/zonedTime.ts`, `formatInZone`.
- Produces: the node and mark schemas with plain rendering (a date token as text, a block reference as a muted line naming its target, a data-view embed as a muted line); commands `setTextColor(c|null)`, `setHighlight(c|null)`, `insertDateToken(day)`, `indentBlock()`, `unindentBlock()`, `setListItemOptions(opts)`, `insertBlockRef(title, id)`, `copyBlockReference()`, `insertDataViewEmbed(kind, id)`, `recordAudio()` (calls the stub); typed dates in the `/` menu: `YYYY-MM-DD`, `today`/`tomorrow`/`yesterday`, `in N days|weeks`, weekday names and `next <weekday>`, `<month> <day>` (English only, **our choice**), each giving "{date}" items for the daily-note link and the date token.

- [ ] **Step 1: Write failing tests:** `test every m8 fixture body round trips byte for byte`, `test adding a block id changes only that line`, `test inline colour edit rewrites only its block`, `test malformed spans and marks stay raw`, `test bare mark loads as yellow and is kept as written`, `test date token loads and saves`, `test indent container groups and ungroups without touching children`, `test item comment survives list edits elsewhere`, `test block reference line becomes a block ref node`, `test dataview embed lines`, `test CRLF body keeps CRLF on new syntax`, `test parse date phrases`, `test tab indents any block`, `test new shortcuts dispatch their commands`.
- [ ] **Step 2:** Run `npx vitest run src/editor`. Expected: FAIL (the new cases).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(editor): M8 data layer (inline styles, date tokens, indent, item options, block and data-view references)

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 26: Tokens menu, inline colour and highlight, date tokens, indent and list-item styles (lane E, sub-lane E1)

**Files:**
- Modify: `editor/tokens/TokensMenu.tsx` (fill the stub), `editor/nodes/{textStyle,dateToken,indent,listItemOptions}.ts` (node views and styles), `editor/menus/BlockStyleMenu.tsx` (acts on one list item when the caret is in it; "Indent" / "Unindent" rows)
- Create: `editor/tokens/ColorMenu.tsx`, `editor/tokens/tokens.css`, `editor/nodes/DateTokenView.tsx`, tests

**Interfaces:**
- Consumes: Task 25's commands, M7's colour names (`menus/colors.ts`), `createAndOpen`, M5's link picker, `openExtendedSearch`.
- Produces: the selection toolbar (`tokensMenu.*`): Bold, Italic, Underline, Strikethrough, Code, Formula, Link, "Highlight text" (with "Text color" and "Background color" sections, 18 colours each, "No color"), "Turn Into", "Create object from text selection." (pick a type → a new object titled with the selection; the selection becomes `[[Title]]`), "Link existing object with text selection.", "Search for content matching your selection" (opens the extended search); the highlight shortcut; the date token chip (the day in the user's date format; click opens that daily note); indented blocks drawn with M7's outliner lines; per-item colours.

- [ ] **Step 1: Write failing tests:** `test tokens menu items and colour names match reference`, `test text colour and background apply as marks`, `test no color removes the mark`, `test create object from selection links it`, `test search for selection opens extended search`, `test date token chip opens its daily note`, `test block style menu styles one list item`, `test indent rows`.
- [ ] **Step 2:** Run `npx vitest run src/editor/tokens src/editor/menus src/editor/nodes`. Expected: FAIL (the new cases).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(editor): tokens menu with inline colour and highlight, date tokens, indent, list item styles

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 27: Block references, Turn into object / task / whiteboard (lane E, sub-lane E2)

**Files:**
- Modify: `editor/nodes/blockRef.ts` (node view), `editor/turnInto.ts` (fill), `editor/handles/BlockMenu.tsx` ("Copy block reference"; "Turn into object", "Turn into task object" for to-dos, "Turn into whiteboard" for a block selection), `editor/embed/ObjectEmbedView.tsx` (a task-role object in Link block view shows M4's `TaskCheckbox`), `api_blocks.py`, `rows.py` and `searchtext.py` (a trailing ` ^id` is dropped from previews and indexed text)
- Create: `editor/blockref/BlockRefView.tsx`, `editor/blockref/ReferencedIn.tsx`, `backend/tests/test_blocks_api.py`, tests

**Interfaces:**
- Consumes: `api.block`, `api.blockReferences`, the SSE change stream (re-fetch on the source's change), `api.createObject`, `api.saveBody`, `whiteboard/turnInto.ts` (`turnBlocksIntoWhiteboard`), M7's block selection.
- Produces: a block reference renders the referenced block live and read-only, with the source title; click opens the source scrolled to the block; a self-reference shows "This block reference seems to be referencing itself either directly or through another embedded object."; a missing block shows our line "Block not found." (our string). A block with an id that others reference shows "Referenced in" with the referring objects. "Turn into object": the block's text becomes the title of a new object of a picked type, its children the body, and the block becomes `![[Title]]` with `view=inline` (Link block; **our choice**); "Turn into task" / "Turn into task object": a to-do becomes a Task titled with its text (status Done when checked) shown the same way. "Turn into whiteboard": the selection becomes a new board and an embed of it.

- [ ] **Step 1: Write failing tests:** backend `test_block_route_returns_markdown`, `test_block_route_404s`, `test_block_references_lists_referrers`, `test_preview_and_search_drop_block_ids`, `test_rename_keeps_block_reference_suffix` (regression guard, green from the start); frontend `test block ref renders source live`, `test self reference message`, `test copy block reference writes id and clipboard`, `test referenced in lists referrers`, `test turn into object creates and embeds`, `test todo turns into task object`, `test turn into whiteboard calls the board helper`.
- [ ] **Step 2:** Run the new tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both full suites. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(editor): block references and turn into object, task and whiteboard

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 28: Table formulas, sorting and CSV export (lane E, sub-lane E3)

**Files:**
- Modify: `editor/table/TableMenu.tsx` ("Sort column ascending", "Sort column descending", "Export as CSV"), `editor/table/tableCommands.ts`, `editor/table/table.css`
- Create: `editor/table/formulas.ts`, `editor/table/FormulaCell.tsx`, `editor/table/csv.ts`, tests

**Interfaces:**
- Consumes: M7's table node and commands, `formatNumber` (Task 7's separator; before Task 7 lands it formats with `.`).
- Produces: a formula engine: numbers, `+ - * / ^`, parentheses, cell references `A1` (columns lettered, rows counted from the first row including the header row; **our choice**), ranges `A1:B3`, the 20 statements (ABS, AVG, CEIL, COUNT, E, FLOOR, LN, LOG, MAX, MEDIAN, MIN, PHI, PI, PRODUCT, RAND, ROUND, SIGN, SQRT, SUM, TAU), errors titled "Circular", "Expression", "Reference", "Value" with the reference messages. A formula cell shows its value and shows the `=…` text while the caret is in it ("Formula" placeholder, "No options found" in the function list). Sorting reorders body rows (the header row stays first) as one edit of the table block; text compares case-insensitively, numbers numerically. CSV export downloads `<object title>.csv` (RFC 4180 quoting, values as shown, formulas as their values).

- [ ] **Step 1: Write failing tests:** `test formula statements list matches reference`, `test arithmetic and ranges`, `test circular reference error`, `test invalid reference and value errors`, `test cell shows value and edits formula`, `test sort ascending and descending keeps header`, `test csv quoting`.
- [ ] **Step 2:** Run `npx vitest run src/editor/table`. Expected: FAIL (the new cases).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(editor): table formulas, column sorting and CSV export

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 29: Code syntax highlighting and Mermaid PNG/SVG export (lane E, sub-lane E4; needs Task 1's `highlight.js`)

**Files:**
- Modify: `editor/nodes/codeBlock.ts` (a decoration plugin), `editor/nodes/codeBlock.css` (`hljs-*` classes on theme tokens, all four themes), `editor/code/languages.ts` (each language's highlight.js grammar id), `editor/code/MermaidPreview.tsx` (export buttons), `editor/code/CodeBlockView.tsx`
- Create: `editor/code/highlight.ts`, `editor/code/exportDiagram.ts`, tests

**Interfaces:**
- Consumes: `highlight.js/lib/core` + the registered languages, M7's Mermaid render (`securityLevel: 'strict'`), the theme tokens.
- Produces: highlighting as ProseMirror decorations (the text and bytes never change; re-highlighted on change, debounced; plain text and unknown languages unhighlighted); "Download as SVG" and "Download as PNG" (our labels) on a rendered Mermaid diagram: the SVG as rendered, the PNG by drawing it on a canvas at 2× (`htmlLabels: false` for the export render so the canvas is not tainted).

- [ ] **Step 1: Write failing tests:** `test python and javascript get token classes`, `test highlighting never changes the document`, `test unknown language is plain`, `test every language maps to a registered grammar`, `test mermaid svg export`, `test mermaid png export draws the svg`.
- [ ] **Step 2:** Run `npx vitest run src/editor/code src/editor/nodes`. Expected: FAIL (the new cases).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit && npm run build`. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(editor): code syntax highlighting and Mermaid SVG and PNG export

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 30: Collections and queries as live views; audio recording (lane E, sub-lane E5)

**Files:**
- Modify: `editor/nodes/dataViewEmbed.ts` (node view), `editor/media/recordAudio.ts` (fill)
- Create: `editor/embed/DataViewEmbedView.tsx`, `editor/media/AudioRecorder.tsx`, tests

**Interfaces:**
- Consumes: M3's `useCollections`/`useQueries`, `runQuery`, `DataView` with the collection's or query's own saved view, `api.uploadAttachment`, `MediaRecorder`, `getUserMedia({audio: true})`.
- Produces: an embedded collection or query shows its live view with its title (click opens it); "Show details" toggles the details (`<!-- block: details -->`); an unknown id shows our line "Collection not found." / "Query not found." (our strings). "Record audio": a recorder chip with elapsed time, pause, stop and cancel (our strings: "Recording…", "Stop", "Cancel"); on stop the audio is uploaded as `Attachments/Recording <YYYY-MM-DD HH-MM>.webm` and a media block for it replaces the chip; a denied microphone shows our line "Microphone access was denied."; no transcription.

- [ ] **Step 1: Write failing tests:** `test collection embed renders its view`, `test query embed runs the query`, `test show details toggles annotation`, `test unknown id message`, `test recording uploads and inserts a media block`, `test cancel leaves no attachment`, `test denied microphone message`.
- [ ] **Step 2:** Run `npx vitest run src/editor/embed src/editor/media`. Expected: FAIL (the new cases).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit:
  ```
  feat(editor): live collection and query embeds, audio recording

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

### Task 31: Milestone acceptance (integrate; after Tasks 1–30)

**Files:**
- Create: `scripts/m8_acceptance.py`, `docs/superpowers/plans/m8-acceptance.md`, `frontend/src/noNetwork.m8.test.ts` (`test no network calls in m8 sources`)
- Modify: `docs/superpowers/plans/remaining-work.md` (the M8 rows only)

- [ ] **Step 1:** Run `uv run pytest backend/tests -q` and `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run lint && npm run build`. Expected: all green. Check every stub of Task 3 has been filled (grep `NotBuiltYet` outside `lib/notBuilt.ts` and tests: none).
- [ ] **Step 2:** Write `scripts/m8_acceptance.py SPACE [--keep]` (run as `uv run python scripts/m8_acceptance.py SPACE`), like `m7_acceptance.py`: a temporary git-committed copy; `OBJECT_STATE_DIR`, `OBJECT_CACHE_DIR`, `OBJECT_CLOCK_FILE` (2026-10-27T10:00:00Z), `OBJECT_FAKE_NOTIFY_FILE`, `OBJECT_FAKE_OPEN_FILE`, `OBJECT_FAKE_TRASH_FILE` in temp paths; `create_app` with uvicorn on a free `127.0.0.1` port. Over HTTP it checks:
  1. Starting twice and calling every M8 read route (`/api/tasks/overdue`, `/api/tasks/stats`, `/api/calendar`, `/api/block`, `/api/block/references`, `/api/history`, `/api/history/version`, `/api/search?mode=fullText`, `/api/references`) changes no file (`git status` clean) and creates nothing in the state dir but M7's `spaces.json`.
  2. Recurrence: Skip, Excuse and each catch-up choice on copies of `Water plants` give the documented `date` and log lines and a `git diff` limited to those lines and `lastUpdated`; a custom-rule task completes to the vector's next date; stats match the expected numbers.
  3. A `deadline` reminder fires once through `/api/_test/tick`.
  4. History: a body save keeps one version in the state dir and none in the space; a restore brings the bytes back except `title`/`id`, and a stale restore is 409.
  5. Merge: without `confirm` 428; with it the target has the merged values and body, `Refers to source.md` links the target and nothing else in it changed, the source is in the trash and restores.
  6. Spaces: create with `setup: basic` writes four types; deleting the current space is 409; deleting another goes to the fake trash; with the trash `unavailable` 428, then `permanent` removes it.
  7. Whiteboards: saving a board with media and web-link blocks round-trips; a media path outside the space is 422.
  8. The editor round trip: `cd frontend && OBJECT_ROUNDTRIP_SPACE=<copy> npx vitest run src/editor/roundtrip.space.test.ts` reports 0 differences on every body (M7's harness; Task 25's fixtures included).
  9. The M1 no-edit pass over HTTP: 0 files changed.
- [ ] **Step 3:** Run it on `space-m8`, `space-blocks`, `space-sample`, `space-v1`, `space-calendar`, `space-links` and `space-whiteboard`. Expected: every check `[ok]`. Rerun `m1_roundtrip.py` and `m2`–`m7_acceptance.py` on `space-sample` and `space-v1`: all PASS.
- [ ] **Step 4:** Run `npm run build`, serve a copy of `space-m8` headless (`BROWSER=true uv run objectapp --space <copy> --port <free port> --browser`, or `build_server_config` + uvicorn as the scripts do) and drive it with Playwright (`require('playwright')`, `chromium.launch()`), screenshots taken, no process left running. Walk through: Skip/Excuse and the overdue dialog, Task Stats, the custom repeat "On" row, a deadline reminder, the Day view's three new sections; extended search and Save as Query; the palette's paste and space actions (with a stubbed clipboard); backlink modes and the backlinks side panel; graph PNG; find in raw mode; merge; every whiteboard feature (media tools, web link, quick-create, View menu, keyboard resize, lock, copy/paste, PNG export, inspector, Play, Notes, ink select/move/partial erase); every editor feature (tokens menu and colours, date tokens, indent, item colours, block references and "Referenced in", Turn into object/task/whiteboard, formulas, sorting, CSV, highlighting, Mermaid export, collection/query embeds, recording with a fake `MediaRecorder`); version history and restore; focus mode and its timer; Present; the Language, Date & Time, Editor and Space settings; deleting a space. Record anything that differs from this plan in `m8-acceptance.md`.
- [ ] **Step 5:** Write `m8-acceptance.md` with Gene's hand-check list (on his CPI copy outside the repo with `git init` done there; unchecked):
  - file safety on real notes: opening changes nothing; notes with `<span>`, `<mark>`, `<time>`, `^ids` or `![[…#^…]]` keep their bytes; copying a block reference changes one line; a merge, a restore and a space delete do what this plan says and nothing more; history stays outside the space
  - the provisional shortcut keys of the new ids, against Capacities
  - every **"our choice"** in this plan, against Capacities: the storage forms (occurrence log, `reminders` map, inline HTML styles, date tokens, `indent`, item comments, `collection:`/`query:` embeds, board `media`/`weblink`), the overdue threshold and catch-up readings, the stats start and grid size, the version rules (5 minutes, 200, title kept), merge's dropped properties and limit, deleting only non-current spaces, the basic-setup property kinds, the focus presets, the slide-splitting rule and the left-out presentation rows, the timeline's contents, day backlinks without a note, the extended search key, URLs pasted as bookmark pages, the inspector's Stats, quick-create "Nothing", the formula row numbering, the Turn-into embed view, typed-date phrases, ink tilt and partial erase
  - hardware and permissions on Windows: the Wacom tilt, the microphone prompt in the pywebview window, the clipboard read prompt, the Recycle Bin delete
  - the side-by-side pass for every M8 screen, in Light and Dark
- [ ] **Step 6:** Update the M8 section of `remaining-work.md` to "built" with what Task 31 found, then commit:
  ```
  chore: milestone 8 acceptance

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T3LWvgj3Zkwn74UzsMJS6N
  ```

## Coverage

Every item in the "Not in M4/M5/M6/M7" lists, the plans' change histories and the acceptance notes, with its task or its exclusion.

| Deferred item (source) | Task / exclusion |
|---|---|
| Occurrence log (M4) | 11 (server), 13 (UI: the "Completion Log" list with entry delete under Task Stats, fixed 2026-10-28; "Remove date" asks before discarding the log, fixed 2026-10-28) |
| Completion stats / habit stats (M4) | 11, 13 |
| Excuse / Skip (M4) | 11, 13 (the checkbox menu's "Excuse" label, fixed 2026-10-28) |
| Custom weekday and "second Tuesday" rules, `DatePicker.recurrenceCustom.on` (M4) | 10, 13 |
| Month/year clamp drift, "documented drift, deferred" (M4 Global Constraints) | 10 (anchored "on the Nth / last day" forms) |
| Overdue catch-up dialog, `RecurringTaskOverdueModal` (M4) | 11, 13 (the client's overdue check follows the Time zone setting, fixed 2026-10-28) |
| Task "Context"/backlinks section (M4) | built in M5 (no work) |
| Task actions and calendar integrations (M4) | **excluded**, spec §2: integrations, network |
| Reminders on dates other than the Task `date` (M4) | 12, 14 |
| To-do blocks as task objects, `turnBlockIntoTaskObject` (M4) | 27 |
| Timeline and "Date references" sections of the Day view (M4) | 15, 14 |
| `{date}`/link shortcuts of the slash menu (M4; partly built in M7) | 25 (real date token for "Today - date link", typed dates), 26 (token chip) |
| Extended search page, "Open extended search" (M5) | 16, 17 |
| "Save as Query" (M5) | 16 |
| Clipboard actions, `CommandPalette.paste.*` (M5) | 17 |
| Semantic related content (M5) | **excluded**, spec §2: AI (M5's lexical stand-in stays) |
| `CommandPalette.actions.options.openSpace` and switching spaces (M5; switching built in M7) | 17 (palette action) |
| "Open settings" (M5) | 17 |
| Focus mode (M5, M7) | 9 (mode and timer), 17 (palette action) |
| Readwise (M5) | **excluded**, spec §2: integrations |
| AI chat (M5) | **excluded**, spec §2: AI |
| Help and feedback actions (M5) | **excluded**, spec §2: network (help centre, docs, community, feedback are online) |
| Block references and transclusion, `BlockReferences.referencedIn` (M5, M7) | 25, 27 |
| "Copy block reference" (M7) | 25, 27 |
| Calendar "Backlinks" and "Date references" sections (M5) | 15, 14 |
| References section on daily notes and tags (M5) | no work: Capacities shows none (`canHaveBacklinksSection`), so fidelity means none |
| Backlink content view and section-default settings (M5) | 7 (settings), 18 (behaviour) |
| Nested backlink display modes (M5) | 7, 18 |
| Side-panel areas (M5; built in M7) and the backlinks side-panel entry (M5) | 18 |
| Dragging a side-panel entry onto the main view to swap (M7 acceptance, "not built") | 18 |
| Graph PNG export (M5) | 19 |
| Find in raw mode (M5) | 19 |
| Merge object (M5) | 6 (with Merge into tag) |
| Whiteboard media tools and media nodes: image, PDF, audio, file, web link (M6) | 20 (web link without fetching) |
| Connector-drop quick-create menu (M6) | 21 |
| Floating Inspector: Outline / Frames / Stats (M6) | 23 |
| Reading-order editing (M6) | 23 |
| Presentation, `Whiteboard.control.play`, pages (M6) | 23 |
| System-clipboard copy/paste on whiteboards (M6) | 22 |
| Whiteboard version history (M6) | 4, 5 |
| Whiteboard PNG export (M6) | 22 |
| "Turn into whiteboard" / "Add to whiteboard" / "New whiteboard" from a selection (M6) | 22, 27 (block selection), 3 (object menu) |
| Phone outline view (M6) | **excluded**, spec §2: mobile |
| Entity node "View" menu (M6) | 21 |
| Keyboard resize, `shortcuts.whiteboardResize*` (M6) | 21 |
| Per-node lock UI (M6) | 21 |
| Notes editor on the board page (M6) | 23 |
| Moving or resizing ink (M6) | 24 |
| Partial erase (M6) | 24 |
| Pen tilt (M6) | 24 |
| Inline text colour and highlight marks, `tokensMenu.color.*` (M7) | 25, 26 |
| Indenting non-list blocks, `tokensMenu.indent.*` (M7) | 25, 26 |
| A list item's own annotation (M7) | 25, 26 |
| Table formulas (M7) | 28 |
| Table sorting (M7) | 28 |
| Table CSV export (M7) | 28 |
| "Turn into object/task", `shortcuts.turnIntoObject`, `turnIntoTask` (M7) | 25 (keys), 26 (from a selection), 27 (from a block) |
| Web embeds and iframes (M7) | **excluded**, spec §2 / §7: network at runtime |
| Bookmark metadata fetching (M7) | **excluded**, spec §2 / §7: network (bookmarks keep the typed URL) |
| Audio recording (M7) | 30 |
| Transcription (M7) | **excluded**, spec §2: AI |
| Mermaid AI (M7) | **excluded**, spec §2: AI |
| Mermaid PNG/SVG export (M7) | 29 |
| Embedding collections or queries as data views (M7) | 25, 30 |
| Code syntax highlighting (M7) | 29 (+ Task 1's `highlight.js`) |
| "Start with basic setup" (M7) | 8 |
| Onboarding (M7): the guided account tour, "Restart onboarding", `OnboardingSlides.*` | **excluded**, spec §2: accounts (account onboarding and interest personalisation); flagged for Gene |
| Deleting a space folder, `DeleteHandler.space.*` (M7) | 8 |
| Language setting (M7) | 7 (locale for formatting; strings stay English) |
| Decimal separator setting (M7) | 7 |
| Time-zone setting (M7) | 2 (server), 7 (UI) (+ Task 1's `tzdata`) |
| Presentation mode for objects (M7) | 9 |
| Version history for objects (M7) | 4, 5 |
| Anything AI (M7) | **excluded**, spec §2: AI |
| M7 known issues 1–7 (acceptance notes) | fixed on 2026-10-27 (no work) |

## Build lanes

Each lane runs its "first" tasks in order, then its sub-lanes in parallel (each in order). Lanes run side by side. Cross-lane waits: every backend task waits for Task 2's commit, every frontend task for Task 3's, Tasks 8, 22 and 29 for Task 1's (see Global Constraints).

| Lane | First (in order) | Then sub-lanes (parallel, each in order) | Files it owns (summary) |
|---|---|---|---|
| **A: foundation and app** | 1 → 2 → 3 | **A1:** 4 → 5 · **A2:** 6 · **A3:** 7 → 8 · **A4:** 9 | deps files; `server.py`, `apictx.py`, `settings.py`, `conftest.py`, `space-m8`; `api/{types,client}.ts`, `test/mockApi.ts`, `settings/**`, `lib/**`, `nav/tabs.ts`, `App.tsx`, `shell/{MainPanel,GlobalOverlays}.tsx`, `object/ObjectView.tsx`; `history.py`, `api_history.py`, `space.py`, `whiteboardstore.py`, `history/**`; `merge.py`, `api_merge.py`, `merge/**`; `properties/format.ts`, `properties/cells/NumberCell.tsx`, `calendar/dates.ts`; `spaces.py`, `basicsetup.py`, `api_spaces_m8.py`, `spaces/**`; `focus/**`, `present/**` |
| **T: tasks and calendar** | (none) | **T1:** 10 → 11 → 12 · **T2:** 13 → 14 · **T3:** 15 | `taskmodel.py`, `recurrence.py`, `tasklog.py`, `taskhook.py`, `typemodel.py`, `reminders.py`, `api_tasks.py`, `calendarquery.py`, `linkindex.py`; `tasks/**`, `properties/{DatePicker,PropertySettings}.tsx`, `calendar/DaySections.tsx` |
| **S: search and references** | (none) | **S1:** 16 → 17 · **S2:** 18 · **S3:** 19 | `api_search.py`, `searchindex.py`, `references.py`, `api_references.py`; `search/**`, `palette/**`, `references/**`, `shell/{SidePanel,SidePanelArea}.tsx`, `nav/sidepanel.ts`, `graph/**`, `find/**`, `editor/RawMode.tsx` |
| **W: whiteboard** | (none) | **W1:** 20 → 21 → 22 → 23 · **W2:** 24 | `whiteboardfile.py`, `whiteboardindex.py`; `api/whiteboard{Types,Client}.ts`, `whiteboard/**` (W2: `whiteboard/ink/**`, `whiteboard/plugin.ts`) |
| **E: editor blocks** | 25 | **E1:** 26 · **E2:** 27 · **E3:** 28 · **E4:** 29 · **E5:** 30 | `editor/**` except `editor/RawMode.tsx`; `api_blocks.py`, `rows.py`, `searchtext.py` |
| **integrate** | 31 (after every lane) | | `scripts/m8_acceptance.py`, `m8-acceptance.md`, `remaining-work.md` (M8 rows), `frontend/src/noNetwork.m8.test.ts` |

Workflow args (for `scripts/workflows/object-milestone-build.js`, which takes tracks): `{"plan":"docs/superpowers/plans/2026-10-27-m8-deferred-features.md","base":"<HEAD sha after this plan's commit>","backend":[1,2,4,6,8,10,11,12,15],"frontend":[3,5,7,9,13,14,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30],"integrate":31,"milestone":"Milestone 8","perTaskReview":false}` when only two tracks are available; with lane support, run the five lanes above.

## Change history

- **2026-10-27:** written against `07e7258` (M7 gated, known issues fixed). Scope from the "Not in M4/M5/M6/M7" lists, the M4–M7 change histories and the M4–M7 acceptance notes (the one extra item found: side-panel drag-to-swap, M7 acceptance). Built-code facts used: M5's router pattern (`api_search`/`api_references`/`api_graph` with `ApiContext`), `Space`'s write funnels (`_write`, `_write_exact`, `_rewrite_other`, `_move_file`) and rename relink helpers (`_referrers`, `_relink_edit`, `_board_referrers`), `topup_task_type` in `typemodel.py`, `taskhook.on_status_change`, M4's `repeat` grammar and `CustomRepeatDialog` (Every / Based on / Ends already built; "On" missing), M7's slash "Link to a date" items (Today, Tomorrow, Yesterday, "Today - date link" inserting a daily-note link, "Now – timestamp"), M7's `settings.py` keys, the whiteboard format's `text`/`entity` blocks (unknown block types rejected today), the ink plugin contract (`whiteboard/plugin.ts`), `RawMode.tsx` on CodeMirror 6, sigma 3 graph canvas, palette actions built from global stores (`useTabs.getState().open`), no palette "Open space"/"Open settings" action yet, no text-selection toolbar yet.
- **2026-10-28:** review findings fixed, each with a test that failed before: "Remove date" on a recurring task with history asks first (`DatePicker.dateRemoveConfirm.*`, verbatim: "Remove date?", "Keep date", "Remove date"); the permanent space delete's 428 carries the folder identity (`st_dev:st_ino`) and the confirm is refused with 409 when the folder was replaced; the checkbox menu says "Excuse" (`RootTaskCheckbox.menu.excuseRecurrence`); the "Completion Log" list (`components.RootTask.occurrenceLog.*`) with entry delete, and a text value written over a literal block keeps the block style (so the delete changes only that line, plus `lastUpdated`); `maybeOverdue` follows the Time zone setting; three test fixes (the palette's 12th action "Toggle focus mode" from `957f5ac` belongs, Task 17; the search page test waits out its debounce; the 1MB split takes the best of 5 runs).
