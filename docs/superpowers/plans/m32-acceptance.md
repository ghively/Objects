# M32 acceptance: notes first

Status (2026-11-11): built 2026-11-11 (the contract `37f189c7` and `c5e8fdbe`, then lanes A, B, C, D, E, F1 and F2 by
file ownership, all merged at `ea0c2ebb`), integrated in two steps (the back end's: the title heading,
`scripts/m32_acceptance.py`, this file, the acceptance sweep and the back-end suite; and the front end's cross-lane
fixes, merged at `ebaee077`), then one whole-milestone review (three reviewers at once, read-only), one fix pass
(three lanes by file ownership, merged at `aeda6e71`) and the full gate at `aeda6e71` (the numbers are under
"Automated results", "The gate"). M32 is on `master`. Gene's hand checks below are unticked, and twelve choices are
left for him ("Choices left for Gene").

Plan: `2026-11-11-m32-notes-first.md` (Gene's four decisions of 2026-11-11, the glossary, the item table, the
contract). Behind it: `notes-first-analysis-2026-11-11.md`. The bar is Gene's direction of 2026-11-11 (`CLAUDE.md`,
"Notes first"); where it and the behaviour catalog disagreed the catalog was updated (the lines marked "(M32)").

## How to run the acceptance script

```
uv run python scripts/m32_acceptance.py [--keep]
```

(In a container where `uv run` can't sync, the same with the venv's Python: `PYTHONPATH=scripts:backend .venv/bin/python scripts/m32_acceptance.py`.)

Every space the script touches is a new one in a temporary folder, made through `POST /api/spaces` the way the app's
"Create space" dialog now calls it (`setup: 'blank'`), or a copy of a synthetic fixture: `space-blocks` (it never had a
Task or a DailyNote type), `space-work` (its tasks carry Ticket IDs and steps) and `space-itops` (made by the IT operations
starter before M32). The fixtures are hashed before and after and never touched. `OBJECT_STATE_DIR` and
`OBJECT_CACHE_DIR` point at temporary folders outside every space, so "nothing was written" is a comparison of the
whole space folder, dot folders included. `create_app` is served on a free `127.0.0.1` port per space. No agent, no
real data, no network. It prints `[ok]` or `[FAIL]` per check and `RESULT: PASS` at the end, and exits non-zero on any
failure. `--keep` keeps the temporary folder. What it checks (the plan's items 8, 10, 12 and 13; the rest of M32 is on
screen, so it is in the hand checks):

1. **A new space** (item 8). `POST /api/spaces` with a name, a folder and `setup: 'blank'` makes `space.json` (the name
   and the start, no Work switch) and the Page, Tag, Task and DailyNote type files, nothing else, and lists the space.
   Opened, it lists those four types (Page is the one the screen calls Note) and asks nothing (`needsSetup` false); the
   Task's statuses are Not Started, Next Up, In Progress, On Hold, Done, the last in the done category; Work is off
   (`workEnabled` null, `workOn` false), the Task has no ticket or work field, and no saved search is listed. Opening,
   listing and reading (what Home, All notes, the Tasks page, the calendar, search and the type gallery read) write
   nothing. The first note, the first task and the first daily note each write only their own `.md`.
2. **An older space without a Task type** (item 8; a copy of `space-blocks`). The built-in Task and DailyNote are
   listed with no file behind them; opening, listing and reading leave the whole folder byte for byte the same; the
   first task writes `task.json` and its `.md` only (no ticket field in the type file, an empty body), a second task
   only its `.md`, and the DailyNote type stays unwritten. Ticking the task with the built-in Done status stamps
   `completed`, and only its `status`, `completed` and `lastUpdated` lines change. A daily note refused because a
   file of another kind holds its name (409) writes nothing, not the DailyNote type either (the fix pass).
3. **The Work switch's default** (item 10). Off on a plain new space. On, with no switch stored and nothing written by
   reading, for `space-work` (its tasks hold ticket and work values; the Task has all 26 ticket and work fields and
   "Tickets" is listed) and `space-itops` (the starter's marker). A new space made with the IT operations starter
   stores `workEnabled: true`. In a plain space (the fix pass) a "Ticket ID" on a note of the user's own type (a
   Flight) or on a Note does not turn Work on; a Ticket ID put on a Task turns the default on and taking it off
   turns it off again; steps on a task turn it on without a Ticket ID; a type named Capture turns it on;
   `space.json` never gains a `workEnabled` from any of this (the first edit of a space adds only its `spaceId`, as
   before M32).
4. **The Work switch set by hand** (item 10). `PUT /api/space` with `workEnabled` true, then false, then true: each
   writes only `.object/space.json`. On: every ticket and work field and the "Tickets" saved search. A Requester is
   given to one task. Off: the Task lists exactly that one field (the value is still on its task and read back; the
   other task was not given it), no "Tickets" is listed, and reading writes nothing. A stale revision is 409 and a
   value that is no switch is 422; neither writes. On again: everything is back and no `.md` or type file changed.
5. **Starter sets after the start** (item 12). In a space that already started: `blank` is 409; `basic` adds only
   the Person, Meeting, Project and Book types and leaves Work off; again, it writes nothing; `itops` then adds only
   the types the space lacks (14), with their templates and seed Tags, replaces nothing and turns Work on
   (`workEnabled: true`); again, nothing; a later `basic` keeps the `itops` marker; an unknown set is 422. "Writes
   nothing" for the repeats compares every file's hash, size and modification time, `space.json` included (the fix
   pass: a repeat used to write `space.json` again with the same bytes).
6. **The type gallery** (item 12). `GET /api/type-gallery` opens with the `personal` section (Idea, Goal, Habit,
   Recipe, Trip, Journal entry), ends with the IT operations entries, and only those are `collapsed`; with Work off
   its Project lists no ticket field; reading writes nothing. Adding Recipe makes its type (Cover image, Servings,
   Prep time, Source, Notes) and its saved search, and changes nothing that existed.
7. **Today's note asked for twice** (item 13). `POST /api/daily-notes`: 201, then 200 with the same path and
   version and `existing: true`, nothing written. A file of another kind that holds the day's name is still 409
   (`nameTaken`).
8. **No built-in name** (item 13; a copy of `space-work`). `activityName` is empty by default; a note added to a
   work item reads "You added a note: …"; with the name set to Pat it reads "Pat added …"; the empty string saves and
   the line reads "You" again; "Gene" is nowhere in the file.
9. **A note's title is in one place** (item 13 and this integrate step, below). "New note" then a title typed (a
   create with no title, then a rename): the title is in the front matter and the body stays empty. A note or a task
   made with a title has no `# <title>` line in its body; a line turned into a task keeps its children as the body
   with no heading above them; a body sent with the create is kept as sent; a type whose default template has an
   empty body gives an empty body, and one with text gives that text.
10. **Type files that already store the ticket and work fields, with Work off** (the fix pass). A `task.json` that
    holds all 26 (a Task saved while Work was on): the Task lists none of them, the file is not rewritten, a save of
    the Task with Work off keeps every definition the file held in its order, and Work on lists them all again. A
    `project.json` as the basic set made it before M32 (the 25 fields and `completed`): Work reads off, the Project
    lists none, nothing is written; a Project marked done is stamped `completed` and reopened it is cleared; on, off
    and on again leave every type file as it was.
11. **The Work agent's queue with Work off** (the fix pass; a copy of `space-work`). A brain dump saved while Work
    is off is saved and not queued; with Work on again it is queued. No agent is set in the script, so nothing runs
    there: that an entry already pending waits while Work is off and runs once it is on again, and that no step is
    auto-run, is `backend/tests/test_m32_fix_loop.py` (the M24 loop fixture and the fake `claude`).
12. The fixture folders are unchanged.

"Reading wrote nothing" in checks 1, 2, 3, 4 and 10 now also asks the `/api/tasks/*` and `/api/work/*` GET routes
and the daily-note reads (the list, the rows, a daily note itself, the DailyNote type's views).

## Automated results

**The integrate step.** Run on 2026-11-11 at `ea0c2ebb` plus this integration (Linux, the shared venv's Python with the worktree's `backend`
first; `objectapp-mcp` through the `uv` shim where a script starts it):

| What | Command | Result |
|---|---|---|
| M32 acceptance | `PYTHONPATH=scripts:backend .venv/bin/python scripts/m32_acceptance.py` | RESULT: PASS (75 checks, about 15 s) |
| The acceptance sweep | `m1_roundtrip.py` and every `mN_acceptance.py`, one run at a time, each with a fresh `OBJECT_STATE_DIR`: M1-M21, M25 and M27 on `space-sample` and `space-v1`; M15 and M22-M32 on their own spaces | 58 of 58 PASS |
| M24 acceptance alone, three times | `... scripts/m24_acceptance.py` | RESULT: PASS each time (72 checks) |
| The back-end suite | `PYTHONPATH=backend .venv/bin/python -m pytest backend/tests -q` | 4205 passed, 19 skipped, 3 xpassed, 1 failed (28 minutes; the one failure is the timing case below) |

No script check had to change in this step, and no check failed because of a product bug. The checks M32 changed on
purpose were updated by lane D with the behaviour: `m4` (a second `POST /api/daily-notes` is 200 with the existing
note, not 409), `m22` (an Activity line reads "You", not a built-in name), `m7`, `m28` and `m31` (a new space holds its
four types, not `space.json` alone; a second setup is allowed for the starter sets). The title-heading change needed
none: no script pinned the `# <title>` line.

Two things about the runs themselves. `m7`, `m8` and `m9` start vitest, so the checkout they run in needs
`frontend/node_modules`; without it they fail with "vitest exit 1" (they did here until the folder was linked).
`m24_acceptance.py` gives its fake agent run a 3 second limit: for lane D two of its checks ("Retry queued it again
and it ran", "the capture is filed") failed on a heavily loaded machine. On a quiet one it passes alone three times
out of three and in the sweep. M32 did not change what it checks: its space is `space-work`, whose Ticket IDs make
Work read as on, and the work routes answer as before.

The back-end suite's one failure, `test_m24_loop.py::test_a_crashed_approve_run_asks_for_approval_again`, is a wait
in the test, not the product: its queue entry is "failed", not pending, so the loop's `wait_idle` can answer before
the worker's pass that withdraws it, which happened once on a loaded machine. An earlier full run of the same tree passed it, it passes alone three times out of three and with its file (32
passed), and the test now waits for that pass. The suite was not run in full again after that one-line change; the gate does. One warning, as before M32:
`test_spaces.py::test_startup_on_a_taken_port_exits_with_a_message` leaves an unhandled thread exception by design.

The front-end suite, `tsc`, lint and the build are the front end's integrate step and the gate after the review.

### The gate (after the fix pass)

Run on 2026-11-11 at `aeda6e71`, after the review and the fix pass below:

| What | Result |
|---|---|
| The back-end suite | 4274 passed, 19 skipped, 3 xpassed (28 minutes) |
| The front-end suite | 618 files, 5028 passed, 1 skipped |
| `tsc`, lint, build | clean |
| The acceptance sweep | 58 of 58 PASS |
| M32 acceptance | RESULT: PASS (94 checks) |

The fix pass took `scripts/m32_acceptance.py` from 75 checks to 94 (the parts marked "the fix pass" in checks 2, 3,
5, 10 and 11 above). The full back-end suite, run after the fix pass's first back-end merge, found one more fault
(`test_m31_fix_import.py::test_remodel_carries_every_type`: a space remodelled from a space where Work is on came out
with Work off); it was fixed in the same pass (call 44).

## The title heading (the integrate step's finding)

Lane C saw that a task from quick add repeated its title in its text, and sent an empty body from the client. The
cause was one rule in `Space.create_object`, there since M2's plan ("Body: `# <title>`, or empty"): every object
created with a title got the body `# <title>`. The app shows a note's title in its own field above the text and does
not hide a first heading, so the title showed twice on the note page for:

- anything the app made with a title: a note from `[[` or `@`, the palette's "Create new … with title", a title typed
  in the New menu's search, a line or a to-do turned into a task (the heading sat above its children), a pasted
  Markdown page with nothing under its heading, each row of a CSV import;
- a type whose default template has an empty body (a template with text replaced the heading; an empty one left it);
- a note an agent or a script made over `/api/v1` or MCP (`create_object`, `create_task`), a note made by an
  automation's create action, an Alert, and an entity written by an import.

Not affected: "New note" and then a title typed (an untitled create has an empty body, and the rename only rewrites a
`# Old title` line that is already there), daily notes (always empty) and captures (they already sent an empty body).

Nothing in the catalog asks for the heading. Both exports offer "Add the title as a top heading" and add it only when
the body does not already open with it; the list preview drops such a line; paste's "Create note" takes the first
heading out of the text because it becomes the title.

**What changed:** the rule itself (`backend/objectapp/space.py`, `Space.create_object`). A new object's body is empty
unless its template or the caller gives it text; the title is in the front matter. That covers every case above at
once, `/api/v1` and MCP included: it is the same fault there, and no test pinned the heading for them. The four tests
that pinned the old rule follow (`test_lifecycle`, two; `test_templates::test_template_none_skips_default`;
`test_m14_engine`'s `appendBody` case), and `test_m32_title_once.py` is new. The script's check 9 shows it over HTTP.

**What was left as it is:**

- No file is rewritten. A note that already opens with `# <title>` keeps that line and shows its title twice until
  the line is removed by hand; a rename and a duplicate still keep such a line in step with the title.
- The importers still open an imported page with `# <title>` when its text has no heading of its own (M15's rule,
  `importers/writer.py`; a re-run compares with what an earlier run wrote, so changing it is a decision of its own).
- An AI chat's note keeps `# <title>` as the first line of its saved conversation: that is the chat's file format.
- The client still sends an empty body from quick add (harmless now), and three comments in the client describe the
  old rule (`api/client.ts`, `editor/turnInto.ts`, `tasks/QuickAddTask.tsx`): the front end's files.
- For Gene: whether an import should stop adding the heading, and whether the note page should hide a first heading
  that repeats the title, for the notes that already have one.

## The review and the fix pass

One whole-milestone review on 2026-11-11 at `ebaee077`: three reviewers at once, read-only. Then one fix pass in
three lanes by file ownership, merged at `aeda6e71`, and the gate. Nothing was reviewed a second time.

### What the review found

**The back-end code** (`backend/**`, `scripts/**`)

- Critical: none.
- Important: the Work agent kept running after Work was switched off; the 26 ticket fields stayed on Task for good
  once its type file was written with Work on; a Project of a pre-M32 "basic setup" showed 25 of them with Work off;
  the Work default turned on from a `ticketId` on any note (a user's "Flight" type with a "Ticket ID" property) and
  missed tasks with Steps only.
- Minor: no event when the default flips; a Project marked done got no `completed` with Work off; `basic` failed
  halfway beside an unloaded type file; a repeated set rewrote `space.json` with the same bytes; a refused daily
  note still wrote the type file; "object type" in the New type dialog's errors; a hand check that could not pass as
  worded.
- Checked and right: never write on read, over every GET route on ten spaces; no value lost with Work off; property
  and body writes change only their own lines (BOM, CRLF); no stored name, key, API field or type id renamed.

**The front-end code** (`frontend/**`)

- Critical: none.
- Important: renaming an open note whose text opens with `# Old title` put the old heading back on the next save;
  the save on close was a plain request whenever the window had the focus (it lost 9 of 10, and only with the
  browser short of connections); quick add read everyday words as dates ("Buy sun cream" became "Buy cream", on
  Sunday); a double click on New made two notes and a held Alt+N six.
- Minor: a second "Today's note" left a focus request behind; a hand-made note with no stamps was missing from
  Recent; the save mark was read out at every save; tab and menu roles had no arrow keys; six tests accepted the old
  word; an ungrouped board's column was titled "Notes" for every type.
- Checked and right: nothing is sent on open, focus or caret moves (18 notes, an md5 of the whole space); decision 1
  held; unlinked mentions are always shown; old tabs restore.

**A second hands-on walk** of the analysis's 14 journeys on the built app (5 spaces, 210 screenshots)

- Critical: a typed title was not saved until Enter, Tab or a click, so a close lost it.
- Important: a starter set wrote up to 57 files on one click with no confirmation; the new-note key made a Task on a
  task's page.
- Minor: "Pick a date" opened without focus; Add Property ignored Enter and did not select the default name; Create
  space's after-create screen overflowed, and a missing Location was refused without a hint; backlinks and mentions
  were always below the fold with no sign above it; no tick on a task's own page; the Tasks entry reopened on the
  last list; an embedded task's toolbar covered its title; "page" wording left in the Shortcuts sheet, the AI chat,
  Settings, type settings and the Trash; the palette found no command for "new"; a 404 for the references of a note
  just deleted.

### The analysis's 15 findings, as the walk found them

Of the 15 findings in `notes-first-analysis-2026-11-11.md`: 9 gone, 5 partly, 1 unchanged by Gene's decision 1. This
is the state at `ebaee077`, before the fix pass; what the walk still found wrong is its list above.

| # | The analysis's finding | On the built app |
|---|---|---|
| 1 | A new space cannot make tasks | gone |
| 2 | Typing can be lost | partly |
| 3 | Enter in the title throws the caret away | gone |
| 4 | The keys that start writing are dead while you write | gone |
| 5 | The app opens on a dead end | gone |
| 6 | The Tasks page is the work dashboard | gone |
| 7 | A task carries a help desk | gone |
| 8 | The note page gives the text 42% of the window | partly |
| 9 | Dating a task takes five steps | gone |
| 10 | Markdown habits misfire | partly |
| 11 | Nothing lists what you wrote lately | gone |
| 12 | AI and agents hold the top of the app | unchanged, by decision 1 |
| 13 | IT is one of three first-run choices | gone |
| 14 | Settings: four of seventeen sections are AI, agents, work or integrations | partly |
| 15 | The words are a database's | partly |

### What the fix pass changed

One pass, three lanes. F numbers are the front-end reviewer's findings and W numbers the walk's, as the code's
comments name them.

**Back end** (merged at `61282486`, and `27c0084d` for the remodel fix `20e05e28`)

- The Work loop does nothing while Work is off; pending entries wait and run when it is on again (call 25).
- One rule for the basic Task and every work type with Work off: a built-in ticket or work field is listed only when
  a note of the type holds a value for it or its stored definition differs from the built-in one. Type files are
  never rewritten for it, and a save with Work off keeps the hidden definitions in the file. The first task in an
  older space with Work on no longer stores the topped-up fields (call 24).
- Work data, which sets the default: a value for a built-in ticket or work field on a basic Task or a work type's
  note, a Capture or an Alert type, or the `itops` marker. A `ticketId` on any other type does not count (call 23).
- The windows are told (`types`, and `queries` when the switch moved) when the default flips with the data.
- A work type's `completed` is stamped and cleared whatever the switch.
- `basic` skips a starter type whose file is already there; a repeated set writes nothing (hash, size, modification
  time).
- A refused daily note or first task writes no type file.
- The words: 'A type named "X" already exists.', "A type needs a name and a plural name.", "Basic types cannot be
  deleted."
- A note with neither `lastUpdated` nor `createdAt` reads its file time as `lastUpdated` in `GET /api/objects` and
  `GET /api/object` (nothing written), so it is in All notes and Recent (call 43).
- Found by the full suite after the first merge (`test_m31_fix_import.py::test_remodel_carries_every_type`): a space
  remodelled into a new space from a space where Work is on came out with Work off, so its Incident type listed 23
  fewer fields (the files held them). The new space now stores the source's switch (call 44).
- `scripts/m32_acceptance.py`: 94 checks.

**Front end 1** (merged at `aeda6e71`)

- F1: a rename keeps the server's heading (`object/titleHeading.ts` mirrors `rename_object`; checked against the
  Python rule on 8,022 generated texts).
- F2: every body save that fits is a keepalive request (in `api.saveBody`, a 60 KiB budget over the saves in
  flight); text a close could not save is kept in local storage per space and note and offered on the next open in
  "Recover unsaved changes"; `forgetSaved` clears the entries the file already holds when the space opens (calls 12,
  14 and 50).
- W1: a typed title is committed 2 s after the last key, and on `pagehide`, hidden and unmount (the rename is a
  keepalive request); the focus, the caret and the keys typed during the rename are kept; a refused title shows one
  toast and is not tried again until the text changes; a tab left on the old path by a closing window is moved on
  the next start (call 45).
- F3: quick add reads a shortened weekday or a bare month and day only as the last words or after on, by, due or
  next; "for" before date words is left out of the title; a line under the field reads
  `Adds "Call the bank" on Nov 13, 2026` (call 17).
- F4, W5: New makes one note per press (a double click, a held key); the new-note key makes a Note everywhere except
  on a type's own page, where it makes one more of that type; its label is "New note" (calls 6 and 46).
- F5: "Today's note" asked for while it is open puts the caret at its end. F7: only "Saved" is announced. F8, W7:
  arrow keys on the Tasks tabs and the date menu; "Pick a date" opens with the caret in the field.
- F10: an ungrouped board's column reads the type's plural. F11: the sidebar's first entry, its tab and its heading
  read "All notes" (call 9). F12: "Hide Tasks in this space" hides Tasks, not Work (call 38).
- W6: an embedded task's toolbar stands above the row, and a ticked one is struck through. W10: a quiet count on the
  type chip's row ("2 backlinks · 1 mention") that opens and scrolls to the section (call 48). W11: a tick beside a
  task's title on its own page (call 49). W14: the sidebar's Tasks entry opens on Today, and a restored tab keeps its
  list (call 15). W19: no references request for a note just deleted.
- Not a regression, nothing changed: W4 (empty ticket fields were hidden when empty before M32 too; with Work on a
  task's pane shows Steps and the rest under the type's fields only when they hold a value) and W18 (the Saved
  searches page never listed the built-in "Tickets").

**Front end 2** (merged at `d32bdbd3`)

- W2: a starter set asks first ("Add the Everyday set?", "Add the IT operations set?"), naming the types the space
  lacks, "their templates and tags" for the IT set, and "The Work page is turned on for this space." when that is
  so; its card reads "Added" once the space has it (call 47).
- W8: Add Property takes arrow keys and Enter to pick the kind, and the default name is selected.
- W9: Create space says "The space is made as a new folder with its name inside this folder." and 'The folder "…"
  does not exist.'; the after-create screen is headed "Space created" and stays inside the box.
- W17: the palette has "New note", "New task" and "Today's note" (the old names are still found).
- W16: "note" where a note is meant in the Shortcuts sheet, the AI chat's text, Settings (Editor, Offline & Sync),
  type settings ("Layout") and the "Related" tab; the Trash names a type by its name.

## Our calls (gathered from the plan, the lanes, the integrate steps and the fix pass)

**The plan**

1. `> ` still makes a toggle and `| ` a quote, as the catalog says; not changed here (Gene can ask).
2. Home is a tab state, not a page with its own data: it lists what the index already knows.
3. The Work default reads as on for a space that already has work data, so Gene's work space keeps its dashboard
   without a step, and a new personal space never sees it.
4. Back-end error messages keep their wording unless an M32 flow shows them on screen.

**Start, Home and the shell (lane B)**

5. The tab strip's `+` and Ctrl+T open an empty tab, so they land on Home (they used to copy the page in view).
6. Alt+N is the new-note key and Alt+Shift+N the New menu's in a browser tab, which keeps Ctrl+N and Ctrl+U for
   itself; the app window takes both pairs. Raw mode keeps Ctrl+U as "undo selection". The new-note key makes a Note
   everywhere except on a type's own page (the fix pass; call 46).
7. The start choice "Home" starts the active tab over (a pinned or persistent tab keeps its page; an empty tab is
   used first).
8. All notes: "This week" is the five days before yesterday, so the list never empties on a Monday.
9. The sidebar's first entry (every note), its tab and its heading read "All notes"; the Note type's row under Types
   reads "Notes" (the fix pass; before it both rows read "Notes").
10. A popped-out note closes first when a new note is made by key, so the new one is seen.
11. The palette starts each opening empty (a reopen during the closing animation too).

**The editor and saving (lane A)**

12. Every body save that fits is a keepalive request, so the browser finishes it after the window has gone (the fix
    pass: in `api.saveBody`, with a 60 KiB budget over the saves in flight; before it the save on close was a plain
    request whenever the window had the focus). The 3 s limit counts from the first unsaved key.
13. "Make this block a task" reads "Make this line a task" and acts on the line holding the caret.
14. Text a close could not save is kept in the browser's local storage and offered on the next open (the fix pass;
    call 50). The limit that remains, accepted: a note over the keepalive size whose save could not leave before the
    page died is offered on the next open, not saved by itself.

**Tasks and Work (lane C)**

15. The sidebar's Tasks entry opens on Today (the fix pass; it reopened on the last list). A restored tab keeps its
    list, remembered in the browser, not in `ui.json`: changing tabs writes no file.
16. Upcoming is one group per day for the next 14 days, then "Later".
17. Quick add also reads "in 3 days" and `2026-11-20`; an "on", "by", "due" or "for" just before the date words is
    left out of the title; a month and day already past this year means next year's. A shortened weekday ("sun") and
    a bare month and day ("3 may") are read as a date only as the last words or right after "on", "by", "due" or
    "next", so "Buy sun cream" keeps its words; and the task that will be saved is shown under the field
    (`Adds "Call the bank" on Nov 13, 2026`) (the fix pass).
18. "Add a Done status" moves an option already named Done into the done category instead of adding a second one.
19. With Work off the dashboard's global parts (keys, toasts, overlays, the keep-on-top window, fetches) do nothing;
    with Work on the Work page keeps its own words ("Search work", "Create task").

**The back end (lane D)**

20. The built-in Task's statuses: Not Started, Next Up, In Progress, On Hold, Done.
21. A space without a Task or DailyNote type has the built-in one in memory from load; its file is written with the
    first task or daily note. A type of that id, name or former name stays the only one.
22. `blank` is refused once a space has a start; `basic` and `itops` can be added later and write only the types the
    space lacks, by id and by name; a later `basic` keeps an `itops` marker.
23. The Work default follows the data, until the switch is set by hand. Work data is (the fix pass): a value for a
    built-in ticket or work field (a Ticket ID, steps, a Requester…) on a note of the basic Task or of a work type, a
    Capture or an Alert type, or the IT starter's marker. A `ticketId` on a note of any other type is the user's own
    property and counts for nothing. Taking the last such value off turns the default off again. The answer is a
    flag kept where notes are indexed, not a scan per request; when it flips, the windows are told (`types` and
    `queries` on the event stream, as `PUT /api/space` sends them).
24. With Work off (the fix pass) one rule for the basic Task and every work type: a built-in ticket or work field is
    listed only when some note of the type holds a value for it, or its stored definition differs from the built-in
    one (the user changed it). An unchanged one without a value is left out of what the type lists, whatever the
    type file holds; the file is not rewritten for it, and a save made with Work off keeps those definitions in the
    file, in their order. The switch never hides a value and drops no saved definition. A type written for its first
    use (the first task of an older space) stores none of the fields a load tops up; a save of the Task made while
    Work is on still stores them (M4's rule, as before M32), which no longer matters once Work is off.
25. With Work off a plain property write does not infer the System from a Ticket ID; a work type's `completed` is
    still stamped when its status reaches the done stage and cleared on reopen, as before M32 (the fix pass). The
    Work loop is not told of edits and (the fix pass) does nothing of its own: it claims no entry, scans nothing,
    auto-runs no step and queues no new brain dump; what is already pending waits and runs once Work is on again.
    The work routes themselves answer as before when called, for a note whose type lists Steps (with Work off: some
    note of the type has a step); for any other they answer "This object has no work fields.", as they do for a
    plain task.
26. The IT operations starter stores `workEnabled: true` unless the user already set the switch.
27. The basic set's Project and the gallery's Project are made with the ticket and work fields only while Work is on;
    a Project that has them in its file (made before M32, or while Work was on) lists them by call 24's rule.
28. An empty `activityName` reads "You" where the name is shown and "the user" in an agent's prompt ("You approved
    this step" would read as the agent's own approval).
29. `POST /api/daily-notes` for a day that has its note answers 200 with `existing: true`; the client still treats
    it as "exists", so no caller writes over the note.
30. Personal types: Idea (Status), Goal (Status, Target date), Habit (Frequency), Recipe (Cover image, Servings, Prep
    time, Source), Trip (Start, End, Location), Journal entry (Date, Mood); each with Notes and one saved search.

**The note page (lane E)**

31. The properties pane starts closed for a type with no properties of its own; a Daily note's Date and Reviewed do
    not count as its own.
32. In a narrow window the properties card follows the text instead of pushing it down.
33. With Work off a work row on a note page (steps, lists, floor items) that holds a value is shown; only the empty
    ones are left out (the integrate step; the lane had hidden every one). No value is hidden by the switch.
34. A rename that moves the file hands the note, the caret and the unsaved text to the view on the new path; with
    the note open in two places, one view claims them.
35. The save mark shows nothing on a note nobody typed in, and fades to the check alone.

**Types, Settings and Help (lane F1)**

36. The gallery draws whatever sections the data gives, in the data's order; the IT operations fold is never
    remembered.
37. Settings > Work: with the switch off the rest of the section stays, disabled, under "Turn on the Work page to use
    these."
38. "Hide Task Management" reads "Hide Tasks in this space" (the key is unchanged). It hides Tasks (the page, its
    sidebar entry and the task features), not Work: with Work on, the Work entry and page stay (the fix pass; the
    integrate step hid both, and this puts M23's rule back).

**Wording elsewhere (lane F2)**

39. The property kind "Object" reads "Link" and "Object Select" reads "Link to a type".
40. A new relation property's default name and an auto-titled saved search use the type's shown name ("Note",
    "Notes…"), so those words are stored.
41. The Trash names a deleted note's folder as the screen names it.

**The integrate step**

42. A new note's body no longer opens with `# <title>` (the section above).

**The fix pass**

43. A note whose front matter has neither `lastUpdated` nor `createdAt` (a `.md` put into the folder by hand or by
    another tool) reads its file's modification time as `lastUpdated` in the summaries the app's lists read
    (`GET /api/objects`, and the `summary` of `GET /api/object`), in the form of Object's own stamps, so it has its
    place in All notes and in Home's Recent. Nothing is written to the file for it; the rows, saved searches, formulas
    and `/api/v1` still see no `lastUpdated` for such a note.
44. A space remodelled from a space where Work is on is a space where Work is on: an import that makes a new space
    from an Object space creates it with `workEnabled: true` when Work is on in the source (its stored switch, the IT
    starter's marker, or, for the space that is open, its data), and with `workEnabled: false` when the source stores
    the switch off (so the ticket data its notes hold doesn't turn the new space's default on). The new space keeps
    its own `setup` marker (`blank`: the starter did not make it). The source is only read; an import into an
    existing space leaves that space's switch alone. Without this the new space read Work off, and by call 24 its
    carried types listed none of their unchanged ticket fields, though their files held them all.
45. A typed title is saved without Enter: it is committed 2 s after the last key in the title, and at once when the
    window goes or is hidden or the note is left. Not on every key, since a commit renames the file: one per pause.
    The focus, the caret and the keys typed during the rename are kept; a refused title shows one toast and is not
    tried again until the text changes.
46. The new-note key has one exception. It makes a Note everywhere, also on a task's or any other note's page; on a
    type's own page, where its notes are listed, it makes one more of that type, as that page's own New button does
    (the Daily notes page makes a Note: a daily note is made by its date). The key's label is "New note". One press
    makes one note: a double click on New and a held key make no second one.
47. A starter set asks before it writes. "Add the Everyday set?" or "Add the IT operations set?" names the types the
    space lacks (the IT set also "their templates and tags"), says that the types you already have are left as they
    are, and says "The Work page is turned on for this space." when that is so. The set's card reads "Added" once
    the space has it.
48. A note says above the fold how many backlinks and mentions it has: a quiet count on the type chip's row
    ("2 backlinks · 1 mention"), each part only when it is not zero. A click opens that tab and scrolls to the
    section. The numbers are the section's own; nothing more is fetched.
49. A task's own page has the tick its rows have, beside the title.
50. Text a close could not save is kept in the browser's local storage, per space and note (it was the tab's session
    storage, which does not outlive the window), and offered the next time the note opens in "Recover unsaved
    changes", beside the version on disk; nothing is written without the user's word. Entries the file already
    holds are cleared when the space opens.

## Known limits

- Notes made before this change that open with `# <title>` keep that line (no file is rewritten), so those show
  their title twice until the line is removed by hand; a rename still keeps such a line in step with the title.
  Imported pages keep the heading their importer writes.
- A note over the keepalive size (60 KiB over the saves in flight) whose save could not leave before the page died
  is not saved by itself: its text is kept in the browser and offered on the next open (calls 12, 14 and 50). Two
  editors on one path share one save state.
- A real close with a title typed in the last 2 s and text still unsaved or in flight loses that title; the text is
  safe (call 45).
- A rename on the server also rewrites the note's links to itself in its own text; the open editor does not mirror
  that (it mirrors the heading), so such a link is put back by the next save of the open note.
- "Find in page", "This page has no headings", "A PDF that looks like the page on screen" and the sidebar-sections
  help line still say "page".
- Raw mode has no title-to-body caret placement and no way back to the title by key.
- The Work default follows the data (call 23).
- A type of the user's own named "Capture" turns the Work default on: the Capture type is found by its name, as
  before M32 (`captures.find_capture_type`). Setting the switch off in Settings > Work settles it.
- A space with a type of the user's own named Task (not the basic one), or with any type whose id is `task`, keeps
  that type as the only one: the built-in Task is not offered beside it (call 21), so such a space has no built-in
  task fields until that type is renamed.
- With Work off a value put on a ticket or work field the type does not list (through the API, or in the file) is
  written as it is given (a plain value or a list; the picker's `{start, …}` form of a date is refused), not through
  the field's kind; the field is listed and read by its kind from then on. This was so for the Task before the fix
  pass, and is now so for a work type's unlisted fields too.
- `> ` is a toggle, `| ` a quote (call 1).
- `m24_acceptance.py` gives its fake agent run 3 seconds; on a loaded machine two of its checks can fail for that
  reason alone (see the results above).

## Choices left for Gene

Not built either way: each line says what happens now, then what the other choice would be.

1. Opening a note from the palette or a list does not put the caret in its text; today's note and a new note do.
   The other choice: every note opens with the caret in its text.
2. Today's note opens as a pop-over (Gene's own request of 2026-11-09), also with "Open notes as a full page" on.
   The other choice: it follows that setting and opens as a full page.
3. A task's pane lists the system rows (Collections, Created at, Tags…) before Status, Priority and Date. The other
   choice: Status, Priority and Date first.
4. A type made from the gallery lands on its settings page. The other choice: on a first note of that type.
5. Old notes that open with `# Title` show the title twice, and imports still add that line ("The title heading").
   The other choice: the note page hides a first heading that repeats the title, and imports stop adding it.
6. A task with only a deadline sits in Inbox, also when the deadline has passed (decision T1's rule). The other
   choice: a deadline places the task as a date does (Upcoming, then Overdue).
7. `> ` makes a toggle and `| ` a quote (call 1). The other choice: `> ` makes a quote, as Markdown has it.
8. The property kinds read "Link" and "Link to a type" (call 39). The other choice: other words for the two.
9. "No date" on a task writes `date: null`. The other choice: it removes the `date` line.
10. Quick add ignores "yesterday" and "last week", and the global new task (Ctrl+Shift+T) reads no date words. The
    other choice: past words date a task in the past, and the global new task reads date words as "Add a task" does.
11. A mention's context shows the raw `[[…]]`, and a line naming the note twice is listed twice. The other choice:
    the context shows the link's words, and such a line is listed once.
12. Alt+N and Alt+Shift+N are the browser-tab keys for a new note and the New menu (call 6). The other choice: other
    keys for the browser tab.

## Hand checks (Gene)

On a copy of a space, or a new one, in the app. The groups follow the analysis's journeys.

**First launch of a new space**

- [ ] "Create space" asks for a name and a folder only (plus "Import from…" and "Do I need a new space?"); no question about a starting point. Switching to it opens Home and nothing is asked.
- [ ] Opening an empty folder as a space asks nothing, and no note or visible file is made until you make something (the hidden `.object/types/page.json` and `tag.json` are written, as before M32).
- [ ] In the new space the sidebar reads All notes, Calendar, Tasks (no Work), and "New task" and "Add a task" work at once.

**Landing on Home**

- [ ] A new tab (`+` or Ctrl+T) and the first open show Home: "New note", "Today's note", "Recent" (the last 12 notes edited, newest first, daily notes included) and "Tasks" (overdue and today; a tick completes one; "Nothing due today." when there is none).
- [ ] An empty space's Home says "Nothing here yet. Start a note, or open today." above the two buttons.
- [ ] A `.md` file dropped into the space's folder by hand shows in All notes and in Home's Recent, placed by the file's date; the file itself is not changed by that.
- [ ] Settings > Editor > "When this space opens" offers Home, and "Where I left off" with nothing to restore lands on Home.

**A new note, by mouse and by key**

- [ ] "New" in the sidebar makes a Note at once with the title ready to type; the arrow beside it opens the type list (search, Suggested first).
- [ ] Alt+N in a browser tab (Ctrl+N in the app window) makes a new note, also with the caret in a note's text or title and on a task's page (on a type's own page it makes one more of that type); Alt+Shift+N (Ctrl+U) opens the New menu.
- [ ] Type a title and press Enter: the caret is at the start of the text and the next words land there (ArrowDown and Tab too, and in the peek). ArrowUp or Shift+Tab at the very start of the text goes back to the title.
- [ ] The title shows once: the new note's text does not open with the title as a heading.
- [ ] Type a title, do not press Enter, and wait three seconds: the file is renamed, and the caret is still in the title.
- [ ] Type a title and close the window at once. Open it again: the note has that title.
- [ ] Rename a note whose text starts with its old title as a heading, then type a word in the text: the heading is the new title, and stays so after the save.

**Saving**

- [ ] Type a burst (a dozen sentences with short pauses) and close the window straight away. Open it again: every word is there.
- [ ] While you type the toolbar says "Saving…", then a check and "Saved", and the mark stays visible while the rest of the toolbar fades.
- [ ] Switch to another note or tab in the middle of a sentence and come back: nothing is lost.
- [ ] In the app window (not a browser tab): type a burst in the text and close the window at once. Open it again: every word is there. (The review could not test the app window, where the server stops when the window closes.)

**Markdown habits**

- [ ] `- [ ] ` makes an empty to-do and `- [x] ` a ticked one.
- [ ] `notes.md` and `config.py` in a sentence stay plain text; a real web address still becomes a link.
- [ ] A list that mixes bullets and to-dos shows each line as it is, also after closing and reopening the note.
- [ ] A small pasted image keeps its own size, and the block toolbar stays inside the window near its edges.
- [ ] Ctrl+Shift+T on any line of text turns that line into a task.

**Links and today's note**

- [ ] `[[New thing` and "Create": the new note is a Note, also right after making a task; opened, it shows its title once.
- [ ] "Today's note" (the top bar, Home, Ctrl+Shift+D) opens with the caret at the end of its text, so typing lands in it at once; asking again opens the same note with no error.

**Notes in the sidebar**

- [ ] "All notes" is the first sidebar entry (the Note type's row under Types reads "Notes"): every note by last edited under Today / Yesterday / This week / Earlier, daily notes in, tasks and tags out. Edit an old note and it moves to Today.

**The plain Tasks page**

- [ ] The sidebar's Tasks entry opens on Today, also after another list was open: "Overdue (n)" then "Today (n)", each count shown once; the header reads "Search tasks" and "New task".
- [ ] Upcoming (a group per day for 14 days, then Later), Inbox (no date), All and Done list the right tasks; "More" holds Status, Deadline, Recurring, Reminders, Tags and Context.
- [ ] "Add a task": type "Call the bank friday". A chip shows Friday, and a line under the field reads `Adds "Call the bank" on` with Friday's date; Enter adds the task, the field keeps the focus, the task is titled "Call the bank" with Friday's date, and its text is empty.
- [ ] Backspace at the start of the field (or the chip's ×) removes the chip, and "friday" stays in the title. "Buy sun cream" shows no chip and keeps its words.
- [ ] A row's date chip opens Today / Tomorrow / Next week / No date and "Pick a date"; a pick moves the task to its group.
- [ ] A tick on the circle completes the task and strikes its title through; an overdue date is in the danger colour.
- [ ] On a type whose status has no done option the circle offers "Add a Done status"; one click adds it and completes the task.
- [ ] A task's own page has the tick beside its title.
- [ ] Settings > Task management > "Hide Tasks in this space" takes the Tasks entry and page away; with Work on, the Work entry and page stay.

**Work off, on, and off again**

- [ ] In a new space: no "Work" entry, B opens no brain dump, a task's page shows no ticket fields (Ticket ID, Desk status, Requester…) and no work header, and Saved searches has no "Tickets".
- [ ] Settings > Work > "Use the Work page in this space" on: "Work" appears under Tasks and opens the dashboard as it was. A ticket field shows on a task once it holds a value (as before M32): give one task a Requester from the Task type's page or a table column.
- [ ] Turn it off again: the Work entry goes, that task still shows its Requester, the empty ticket fields are gone, and no note changed (file dates, or git status).
- [ ] A copy of your real work space opens with Work on by itself: the dashboard, "Tickets" and the ticket fields are as before, without touching the switch.
- [ ] With Work on and a step queued for the agent, turn Work off: the agent does not run the step until Work is on again.

**The note page**

- [ ] A Note opens with the properties pane closed; a Project (any type with properties of its own) with it open. The pane's toggle and "Show properties by default" still work.
- [ ] A plain click on a note in a list opens it as a full page, with the way back on the breadcrumb; Alt+Shift+click still peeks; with "Open notes as a full page" off a click peeks as before.
- [ ] The text area is tall (at least 60% of the window), and a click anywhere below the text puts the caret at its end.
- [ ] An empty Backlinks, Related or Mentions section is one quiet line. A note whose title appears as plain text in another note still lists it under unlinked mentions, and "Link" still links it.
- [ ] A note with backlinks or mentions says so beside its type chip ("2 backlinks · 1 mention"), and a click on the count jumps to them.

**The type gallery**

- [ ] "Add a type" opens with Personal (Idea, Goal, Habit, Recipe, Trip, Journal entry); IT operations is last and folded until opened. Recipe arrives with Cover image, Servings, Prep time, Source and Notes.
- [ ] The gallery's starter sets ("Everyday set" and "IT operations set") ask first: "Add the IT operations set?" names the types the space lacks. "Add" then adds them to a space that already started and replaces none of yours; the IT set turns Work on, and the set reads "Added" after.

**Wording**

- [ ] No "object" on the default screens (the sidebar, Home, a note's menus, Tasks, the first Settings pages); the app is still called Object.
- [ ] The screen says "Notes", "Daily notes", "Types" and "Saved searches"; the slash menu's groups read "New" and "Embed"; the shortcut is "Pin".
- [ ] A note's file still says `type: 'Page'` (a daily note's `'DailyNote'`): only the words on screen changed.

**Help**

- [ ] Help > Getting started opens with the first five minutes (a note, today's note, `[[` links, a task with a date, Ctrl+K, tags); the Tasks guide describes the plain page, with "The Work page (optional)" last.

**AI is where it was (decision 1)**

- [ ] Assistant and the Agents section sit where they were at the top of the sidebar; the slash menu's, the note menu's and the side panel's AI entries are unchanged; "Hide AI features" still hides them.

**Small faults**

- [ ] A date field takes "friday" or "next week" and closes on Enter; a new status label is selected so typing replaces "New status"; the palette opens empty after it was closed with text in it.
- [ ] Settings > Work > "Your name in Activity" is empty, and an Activity line reads "You …" until a name is set.
