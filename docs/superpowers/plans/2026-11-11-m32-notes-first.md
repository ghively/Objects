# Milestone 32: notes first

Date: 2026-11-11. Owner: Gene Hively. Source: `notes-first-analysis-2026-11-11.md` (read it first) and Gene's answers
the same day (below).

**Goal.** The default path is a person writing notes and tracking tasks by hand, with no friction: somewhere to land,
a save you can trust, keys that work while you type, a plain task page. AI stays a helper that acts only when asked.
The work dashboard and the IT types stay in the app as things you turn on, never as the default. Nothing is deleted
and nothing is gated behind payment; this milestone changes defaults, layout, wording and fixes.

**The bar for this milestone** is Gene's direction of 2026-11-11, quoted in the analysis. Where it and the behaviour
catalog disagree, the direction wins and the catalog is updated in the same commit (lines marked "(M32)").

## Gene's decisions (2026-11-11, multiple choice)

1. **AI: leave it where it is.** Assistant and the Agents section stay at the top of the sidebar; the slash menu's,
   note menu's and side panel's AI entries stay. M32 does not move, hide or reorder AI. (The Tasks page loses its
   agent parts only because they belong to the work dashboard, decision 2.)
2. **Tasks: plain tasks; Work optional.** Tasks becomes a simple page: Today (with overdue), Upcoming, Inbox, All,
   Done, and a quick-add box that reads dates. The dashboard (Now, Energy, Brain dump, queues, agent views, alerts,
   tickets) is its own "Work" page, off until turned on in Settings for that space.
3. **IT: an optional pack.** A new space just starts (notes, daily notes, tasks). IT types sit in one collapsed
   gallery group. Ticket fields are on Task and Project only while Work is on for that space. Personal templates are
   added.
4. **Wording: everyday words.** Only what the screen says changes; files and front matter stay exactly as they are.

## Glossary (decision 4; every lane uses these, verbatim)

| Was | Now | Notes |
|---|---|---|
| the built-in type shown as "Page" / "Pages" | **"Note" / "Notes"** | display only, through `typeLabel`/`typePlural` (contract); on disk it is still `type: Page`, and a type the user renamed keeps their name |
| "DailyNote" / "DailyNotes" | **"Daily note" / "Daily notes"** | display only, same helper |
| "Object Types" (sidebar, settings) | **"Types"** | "Create object type" → "New type"; "Object type settings" → "Type settings"; "Add new object type" → "Add a type" |
| "object" meaning a thing you made | **no noun where the row reads without one** ("Delete", "Duplicate", "Open in new tab"); otherwise **"note"** ("Delete this note?", "Recently opened notes appear here.") | never "object" in default UI text; the app's name stays Object |
| "Queries" / "query" | **"Saved searches" / "saved search"** | the page, the sidebar row, menus |
| "Create an object" (slash group) | **"New"** | |
| "Reuse any content" (slash group and item) | **"Embed"** | |
| "Pick an object type" start text | gone | the Home tab replaces it |
| shortcut label "Favorite" | **"Pin"** | matches "Pinned" |
| "Search work", "Create task" on Tasks | **"Search tasks"**, **"New task"** | the Work page keeps its own wording |

Kept as they are: Space, Collection, Properties, Tag, Type, Pinned, Trash, Calendar, Graph, Assistant, Agents.
API routes, MCP tool names, file contents and back-end error codes are not renamed.

## What to build

| # | Item | Lane |
|---|---|---|
| 1 | **Saving you can trust.** A note saves at most 3 s after the first unsaved key while typing continues (and 1 s after the last key, as now); it saves at once on `pagehide`, when the window loses visibility, on a tab or note switch and on unmount (a keepalive request on `pagehide`). A small mark in the note's toolbar says "Saving…", then "Saved"; on failure the existing error. | A (hook), E (mark) |
| 2 | **Title to body.** Enter, ArrowDown or Tab in a note's title puts the caret at the start of the body (the peek too). Shift+Tab from the body's first position goes back to the title. | E |
| 3 | **Keys work while you type.** With the caret in a note: new note, the New menu, today's note and "make this line a task" all work. "Today's note" opens with the caret at the end of its text. "Make this line a task" (Ctrl+Shift+T) works on any text line, not only a to-do. | B (global keys, today's note), A (the block conversion) |
| 4 | **Markdown habits.** `- [ ] ` and `- [x] ` make a to-do; a bare word ending in a common file extension (`notes.md`, `config.py`) is not turned into a web link; a list mixing bullets and to-dos renders each line right; a small pasted image keeps its own size; the block toolbar stays inside the window. | A |
| 5 | **Somewhere to land: Home.** An empty tab (and a first open with nothing to restore) shows Home: "New note" and "Today's note" buttons, "Recent" (the last 12 notes edited, daily notes included, newest first) and "Tasks" (overdue and today, tick to complete). No file is written by opening it. "When this space opens" gains "Home"; "Where I left off" falls back to Home. | B |
| 6 | **Notes in the sidebar.** "Notes" is the first entry (above Calendar): every note by last edited, grouped Today / Yesterday / This week / Earlier, daily notes included, tasks and tags left out. | B |
| 7 | **New means a note.** "New" makes a Note at once with the title focused; the arrow beside it opens the type list (search, Suggested first, as now). A note made from `[[`, `@` or the palette's "Create new … with title" is a Note unless a type is chosen. | B (New, palette), A (`[[`/`@` menu) |
| 8 | **A new space just starts.** "Create space" asks for a name and a folder only; opening an empty folder asks nothing. Every space can make notes, daily notes and tasks from the first second: a new space is created with the Note, Tag, Daily note and Task types, and an older space without a Task type gets it the first time a task is made (as the Daily note type already does). The Task type's statuses include a done one. | D (back end), B (dialogs) |
| 9 | **A plain Tasks page.** Tabs Today (Overdue, then Today), Upcoming (by day, next 14 days, then Later), Inbox (no date), All, Done; a "More" menu with the other plain lists (Status, Deadline, Recurring, Reminders, Tags, Context). Opens on Today. "Add a task" on top: Enter adds and keeps focus; date words anywhere in the text ("friday", "tomorrow", "nov 20", "next week") set the date and are shown as a chip that Backspace removes (the words then stay in the title). Rows: tick, title, a date chip that opens the picker with Today / Tomorrow / Next week / No date; overdue dates in the theme's danger colour; done titles struck through. Header "Search tasks", "New task". | C |
| 10 | **Work is its own page, off by default.** A per-space switch, Settings > Work > "Use the Work page in this space". On: a "Work" entry under Tasks opens today's dashboard, unchanged. Off: no Work entry, no brain-dump key, no work toasts or overlays, no work fetch on a task's page, no "Tickets" saved search, and Task and Project carry no ticket fields that have no value. Default: off; a space that already holds work data (a Capture or Alert type, a Ticket ID on any note, or the IT starter) reads as on until the switch is set. Reading the default never writes. | D (config, fields), C (page), F1 (the setting) |
| 11 | **The note page is for writing.** Clicking a note opens it as a full page (the setting "Open notes as a full page" starts on). The properties pane starts closed for a type with no properties of its own (Note, Daily note) and open otherwise; "Show properties by default" keeps its meaning for the rest. The body is at least 60% of the window tall and clicking below the text puts the caret at its end. An empty Backlinks, Related or Mentions section is one quiet line (unlinked mentions always kept, never hidden). | E |
| 12 | **Types and templates.** The gallery's IT operations group is collapsed and last; a "Personal" group is added: Idea, Goal, Habit, Recipe, Trip, Journal entry (each a few sensible properties, no invented machinery). "Starter sets" (the existing basic set and IT operations) are offered from the gallery, since the space dialog no longer asks. | D (templates), F1 (gallery) |
| 13 | **Small faults.** Quick add no longer writes the title into the body; a date field takes "friday"/"next week" and closes on Enter; a new status label is selected for typing; "Overdue (1)" shows its count once; a task's circle on a type with no done status offers to add one; the palette forgets its last query at once; `POST /api/daily-notes` returns the existing note instead of 409; `activityName` has no built-in name. | C, F2, B, D |
| 14 | **Wording** per the glossary, in every lane's own files; Getting started and the Tasks guide rewritten for notes first. | all; F1 (Help) |

## Contract (T1, before the lanes)

One commit, "feat(m32): contract", by one agent; lanes branch from it.

- `frontend/src/lib/typeLabel.ts` (+ test): `typeLabel(t)` and `typePlural(t)`: "Note"/"Notes" for the built-in Page
  whose stored name is still "Page", "Daily note"/"Daily notes" for the built-in DailyNote, else the type's own name
  and plural. Complete, not a stub.
- **Work switch, both ends:** space config key `workEnabled` (`true`, `false` or absent); `GET` of the space's config
  returns `workEnabled` (the stored value) and `workOn` (the effective one); a route to set it. The contract ships the
  shape with `workOn = stored if set else False`; lane D makes the computed default. Front end:
  `frontend/src/work/useWorkOn.ts` (hook, reads it from the same place the app reads space config).
- **App wiring (`frontend/src/App.tsx`):** target `tasks` renders `tasks/TasksPage` (a stub that renders the existing
  plain lists under the new tab names; lane C builds it); target `work` renders `WorkPage` only when `useWorkOn()`,
  else redirects to `tasks`; `WorkToasts`/`WorkOverlays` mount only when on; an empty tab renders `home/HomePage`
  (stub with the two buttons; lane B builds it). Tests updated.
- **Settings, both ends:** `startTarget` gains `home`; `openAsFullPage` (whatever its real key is) defaults on;
  `activityName` defaults to an empty string.
- `useAutosave` returns `saveState: 'saved' | 'unsaved' | 'saving' | 'error'` (stubbed from what it knows today;
  lane A makes it exact).
- The glossary above is final. A file `frontend/src/lib/words.ts` exports the shared nouns used in more than one lane
  (`NOTE`, `NOTES`, `TYPES`, `SAVED_SEARCHES`, …) so lanes don't spell them twice.

## Lanes and file ownership

Each lane edits only its own files and their tests, adds catalog lines "(M32)" in the catalog section its item lives
in, and writes failing tests first, one commit per item. A change needed in another lane's file is reported, not
made.

- **A, editor and saving:** `frontend/src/editor/**`. Items 1 (the hook), 3 (line to task), 4, 7 (`[[`/`@`), wording.
- **B, shell and start:** `frontend/src/App.tsx` and the `App.*.test.tsx` files, `shell/**`, `nav/**`, `home/**`,
  `palette/**`, `allnotes/**`, `spaces/**`, `create/**`, `calendar/**`, `lib/shortcuts.ts`. Items 3, 5, 6, 7, 8
  (dialogs), 13 (palette), wording.
- **C, tasks:** `frontend/src/tasks/**`, `frontend/src/work/**`. Items 9, 10 (page), 13 (quick add, the count, the
  circle), wording.
- **D, back end:** `backend/**`, `scripts/**`. Items 8, 10 (config, fields, saved search), 12 (templates), 13 (daily
  notes, `activityName`), the all-notes listing if it needs a route for "by last edited".
- **E, the note page:** `frontend/src/object/**`, `references/**`, `focus/**`. Items 1 (the mark), 2, 11, wording.
- **F1, types, settings, help:** `frontend/src/types/**`, `settings/**`, `help/**`. Items 10 (the setting), 12
  (gallery), 14 (Help), wording.
- **F2, wording everywhere else, and the field faults:** `frontend/src/properties/**`, `collections/**`, `queries/**`,
  `views/**`, `trash/**`, `links/**`, `search/**`, `graph/**`, `import/**`, `history/**`, `merge/**`, `present/**`,
  `find/**`, `vcs/**`, `whiteboard/**`, `components/**`, `agents/**`, `ai/**`, `mcp/**`, `automations/**` (wording
  only in the AI folders; decision 1). Item 13 (date field, status label).

## Global constraints

- Never write on read: Home, Notes, the Tasks page and the Work default must not create or change a file. Types are
  written only by a user action (making a space, a task, a daily note).
- Property edits change only their own lines; CRLF/BOM preserved; atomic writes; deletes go to the Trash.
- **Unlinked mentions stay** on the note page; test near every change to references.
- No file, front matter key, API route or MCP tool is renamed. A space made before M32 opens and behaves the same,
  apart from the new layout and words.
- Decision 1: no AI entry is moved, hidden or reordered.
- Nothing is removed from the app: the dashboard, captures, the IT starter and every setting remain reachable.
- Synthetic fixtures only. Tests use the fake `claude`.

## Review focus

Data safety of the new save paths (no lost typing, no double save, conflict handling unchanged); never write on
read; the Work switch off/on in an old space and a new one (no values lost when fields are no longer topped up);
that every old route into the dashboard still works with Work on; keyboard flow title → body → today's note; that
wording changed only on screen; unlinked mentions; a second hands-on walk of the analysis's 14 journeys.

## Our calls (recorded as they are made)

1. `> ` still makes a toggle and `| ` a quote, as the catalog says; not changed here (Gene can ask).
2. "Home" is a tab state, not a page with its own data: it lists what the index already knows.
3. The Work default reads as on for a space that already has work data, so Gene's work space keeps its dashboard
   without a step, and a new personal space never sees it.
4. Back-end error messages keep their wording unless an M32 flow shows them on screen.

Settled by the review (2026-11-11; the record is `m32-acceptance.md`, "The review and the fix pass" and "Our calls"):

5. The sidebar's first entry, its tab and its heading read "All notes"; the Note type's row reads "Notes".
6. "Hide Tasks in this space" hides Tasks only; with Work on, the Work page stays (M23's rule).
7. Work data, which turns the Work default on: a value for a built-in ticket or work field on a basic Task or a work
   type's note, a Capture or an Alert type, or the IT starter's marker. A `ticketId` on any other type does not count.
8. A typed title is saved after a pause (2 s after the last key) and when the window goes, not only on Enter.
9. The new-note key makes a Note everywhere except on a type's own page, where it makes one more of that type.
