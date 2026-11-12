# M33 acceptance: the frameless desktop window, and the choices M32 left

Status (2026-11-12): built by lanes on file ownership (the desktop shell, its chrome in the page, the note page,
tasks with the editor and settings, the back end), the desktop window's two halves joined and run together, reviewed
by two reviewers (the choices; the desktop window), fixed in one pass and gated at `48db5538` (see "The gate"
below); on `master`. Gene's hand checks below are unticked.

Plan: `2026-11-12-m33-desktop-window-and-choices.md` (Gene, 2026-11-12: the twelve choices M32 left are decided as
recommended "as long as those recommendations are additive and not destructive"; the window on the desktop is
frameless and fits the system it runs on). The rule of the pass: additive, nothing a person relies on is taken away,
no file of a space is rewritten unless the person asks.

## How to run the acceptance script

```
uv run python scripts/m33_acceptance.py [--keep]
```

(In a container where `uv run` can't sync, the same with the venv's Python: `PYTHONPATH=scripts:backend .venv/bin/python scripts/m33_acceptance.py`.)

It covers the back end's part of M33: the two settings, the notes that begin with a heading repeating their title,
and imports. The desktop window is not started by it (`desktop/` has its own tests; the window itself is the hand
checks). Every space it touches is a new one in a temporary folder, made through `POST /api/spaces` as the app's
"Create space" dialog makes it, or a copy of a synthetic fixture (`space-sample`; the import sources
`import-obsidian` and `import-notion`). The fixtures are hashed before and after and never touched.
`OBJECT_STATE_DIR` and `OBJECT_CACHE_DIR` point at temporary folders outside every space, so "nothing was written"
is a comparison of the whole space folder, dot folders included (each file's hash, size and modification time), and
of the state folder. `create_app` is served on a free `127.0.0.1` port per space, the watcher on. No agent, no real
data, no network. It prints `[ok]` or `[FAIL]` per check and `RESULT: PASS` at the end, and exits non-zero on any
failure. `--keep` keeps the temporary folder. What it checks (33 checks):

1. **The two settings** (choice 7 and the window's buttons). With no settings file `greaterThanMakes` reads `toggle`
   and `windowButtons` reads `auto`, and reading makes no file. A settings file exactly as the code before M33 wrote
   it reads those two defaults, keeps every value it held, and is not rewritten by reading (hash, size, modification
   time). Any other value (`blockquote`, `true`, null; `automatic`, an empty text, a number) is 422 and writes
   nothing. `quote` saves and the file gains only that key; then each allowed value of both saves and reads back,
   the file's other keys as they were.
2. **Notes that begin with a heading repeating their title: the count** (choice 5). In a new space holding notes as
   older versions left them, `GET /api/space/title-headings` counts seven: LF, CRLF, with a BOM, CRLF with a BOM and
   no blank line under the heading, two notes of one title in two folders, a task. Left out: a second-level heading,
   another case, a code fence, text first, a note whose title is that heading (no title of its own), a daily note,
   an AI chat, a whiteboard, a template. A note, a task and a note with text made now through the app have no such
   line and are not counted. The count, three times, and everything else the app reads write nothing: the whole
   folder and the state folder are as they were.
3. **"Remove those headings"** (choice 5). `POST /api/space/title-headings/remove` answers `{changed: 7}`. Each of
   the seven lost the heading line, one blank line after it where there was one, and its old `lastUpdated` stamp,
   and nothing else (CRLF and the BOM kept). No other file changed. Each note's earlier text is its newest version
   in version history. A second call changes nothing and the count is 0. Restoring one note's version brings the
   line back, and the note is counted again.
4. **A fixture space** (a copy of `space-sample`). One note is counted (Ada Lovelace: a blank line, then her name as
   a heading); "Meeting notes", which has no front matter and takes its title from its heading, is not. The removal
   changes that one file and no other: the heading, one blank line and the stamp go, the blank line above stays, and
   the note gets the `id` a save of its text gives a note that has none.
5. **A new import adds no heading** (choice 5). A Markdown folder into a new space: each page's text is its own text
   (nothing above it; a page of front matter only has an empty text; a page that opens with its own heading keeps
   it; CRLF read as lines). The report's text opens with "- Source:" and the batch's `report.md` is the same text.
   Afterwards one note is counted: the page whose own heading is its title. The Obsidian fixture: the five pages
   without a first heading of their own have none in Object. The sources are only read.
6. **A re-run of an import made before M33** (choice 5). A Markdown folder and the Notion fixture as a zip are
   imported, and the space is put as the old code left it (`# <title>` on top of the seven notes it headed: four
   pages, a table row, the two reports; the batch's records saying so). Imported again from the same sources:
   nothing imported, nothing updated, every item unchanged; no file that existed changed (hash, size, modification
   time) and the only new files are the re-runs' reports and batch records; the old headings are still there. Then
   one source page changes: that note alone is updated and written without the added line, its earlier text
   (heading included) in version history, its id kept. Then "Remove those headings" (14 notes: the old ones and the
   pages whose own heading is their title), and one more re-run: nothing is written, the headings do not come back.
7. **The fixtures** are unchanged.

## Automated results

**The back-end lane.** Run on 2026-11-12 in the lane's worktree (Linux, the shared venv's Python with the worktree's
`backend`; never the whole back-end suite):

- `scripts/m33_acceptance.py`: 33 checks, `RESULT: PASS`.
- The acceptance scripts of the milestones whose code the lane touched, on `space-sample` (m15, m25, m27) and with
  their own defaults (m15, m25, m26, m27, m30, m31, m32, m33): all `PASS`. No script pinned the added heading, so
  none was changed.
- Tests: `test_m33_settings.py` (18), `test_m33_title_headings.py` (50) and `test_m33_import_headings.py` (21) are
  new. With them the settings, lifecycle, history, space and rename tests, the two other import test files and every
  `test_m15_*`, `test_m25_*`, `test_m26_*`, `test_m27_*`, `test_m30_*`, `test_m31_*` and `test_m32_*` file were run
  (56 files): 934 passed, 3 skipped (one is new: the folder made read-only, which can't be done as root, where the
  run was; the test beside it shows the same answer another way).
- Tests changed: `test_settings.py` (the two keys in the list of defaults) and `test_m15_fixes.py`
  (`build_report` no longer takes a title; the report opens with "- Source:"). No test pinned the heading the
  importer added.
- **The re-run across the real change.** Besides the tests (which rebuild an older import's space with
  `m33_helpers.as_before_m33`), the back end as it was at `41857f51` was run from a copy: it imported five sources
  (the Obsidian fixture, the Notion fixture as a zip, the Anytype fixture, a Markdown folder, a table of rows) into
  one space, 24 notes and five reports, all 29 opening with a heading. This milestone's code then imported the same
  sources again into that same space and state folder: nothing imported, nothing updated, and no note, report or
  attachment changed by a byte or a modification time. The same re-run by the old code itself gives the same
  numbers, item for item (two things in them are older than M33; see "Known limits"). And a new import by this
  code, with the old lines put back by the test helper, has the same text in all 29 notes as the old code's.
- **The count on a larger space.** `space-sample` grown to 3,000 notes (12 MB of text, 1,493 of them beginning with
  their title): `GET /api/space/title-headings` took 45 to 60 ms (it reads no file); the removal of all 1,493 took
  12 seconds (8 ms a note: each is a kept version and an atomic write); a second call took 8 ms and changed 0.

### The gate

Run on 2026-11-12 at `48db5538`, after the review and the fix pass:

| What | Result |
|---|---|
| The back-end suite | 4440 passed, 20 skipped, 3 xpassed (28 minutes) |
| The front-end suite | 629 files, 5294 passed, 1 skipped |
| `tsc`, lint, build | clean |
| The desktop shell's tests (`cd desktop && npm test`) | 82 passed |
| The desktop window end to end (`desktop/test/e2e/shell.e2e.js`, Linux X11 under Xvfb) | 84 of 84, three runs in a row (in the fix pass) |
| The acceptance sweep | 59 of 59 PASS |
| M33 acceptance | RESULT: PASS |

## Our calls

**The back end**

1. **Which notes count.** The Settings line says "begin with", so a note counts when the first line of its text that
   is not blank is the `# <title>` heading a rename keeps in step with the title (`space.title_heading`, one function
   for the rename and the count: same case, blanks after the `#` and at the line's end and a closing `#` aside). A
   rename also rewrites such a heading further down the text; that one is not counted or removed. A title that ends
   in `#` ("C#") is not matched by a rename's rule either, so `# C#` is left.
2. **What is left out, and why.** A note with no `title` in its front matter (its title *is* the heading: removing it
   would rename the note to its file name); an AI chat (its format writes `# <title>` as line 1 on every save); a
   daily note (its title is its date and can't be renamed, so no heading is kept in step); a whiteboard (its page is
   the canvas; its text is the board's Notes); a template (its text is what a new note starts with); an imported
   Source (the page as imported, read-only); a file that opens read-only.
3. **The count reads no file.** It is answered from the texts the open space already holds, so it is cheap and can't
   write. A change made outside the app is seen once the watcher has told the app, as everywhere else.
4. **The earlier text is always kept.** An ordinary save keeps no version while the newest one is under five minutes
   old. The removal keeps the text it changes every time, and a note whose version can't be kept is left alone.
5. **A note is read again before it is changed.** The removal reads each file from disk and asks the rule of what is
   there now; the write refuses a file that changed in between (then it is read once more, and left for the next
   time if it changed again). It does not read a changed file into the app's index on the quiet, so the watcher
   still tells the windows about a change made outside.
6. **What is announced.** A `changed` event per note, with no origin, so the asking window refreshes too; one resync
   when more than 100 notes changed (as the watcher and an import do). Automations are told nothing (as with any
   save of a note's text), and the Work agent's count for a work item is not started again.
7. **When a write is refused.** One note in use by another program is skipped and is still counted afterwards. When
   nothing could be written at all (the folder, or the folder that holds the versions, refuses), the answer is the
   503 any write gives there; after 20 refusals in a row with nothing written the removal stops trying.
8. **As a save of the text does.** `lastUpdated` is stamped, and a note with no `id` gets one. A new space gets its
   `spaceId` with the first version kept, as with its first ordinary save.
9. **The answer is `{changed: N}` only**, as the contract has it. Notes skipped are not listed: the count afterwards
   shows what is left.
10. **Every title line the importer added goes, not only M15's.** The page rule, an image's page, an original-only
    file's page, a File note and the Import report all put `# <title>` on top; all would read twice and all would
    be counted by the Settings line after every import. The report page and the batch's `report.md` stay the same
    text (neither opens with the heading now).
11. **A re-run is safe by how it compares.** It compares the source's bytes (`importSource.contentHash`), never the
    text it would write, so no comparison had to be taught about the old line. A note whose source is as it was is
    never opened for writing.
12. **A source page that changed** is updated as before and written the new way, so that one note loses the added
    line (the earlier text is in version history, as for any update).
13. **Settings.** The two keys are choices like "Toggle style": the file stores a key only once it is set.

**The desktop window (the shell, its page side, and joining them)**

14. **Electron, beside the old window.** All three widely used apps compared are Electron with the tabs in a custom
    top bar; it is the only option that keeps each system's own controls (snap layouts on Windows, the traffic lights
    on macOS) and runs the same engine everywhere. `uv run objectapp` uses it when `desktop/node_modules` holds the
    shell, and otherwise opens the pywebview window as before (`--window pywebview` forces the old one).
15. **Python stays the parent.** `objectapp` starts the server, then the shell as a child, and stops the server only
    after the shell has exited, so the window's last saves land. Every launcher entry made before keeps working.
16. **The one-time open link travels in the child's environment** (`OBJECT_DESKTOP_LAUNCH`), never on its command
    line, and the shell deletes it after reading. It is never logged or written under the state folder.
17. **Linux draws its own three buttons** (Electron's overlay exists there too, but its buttons could not be left
    out on a tiling desktop). "Automatic" leaves them out when `XDG_CURRENT_DESKTOP`/`XDG_SESSION_DESKTOP` names
    Hyprland, sway, i3, river, niri, bspwm, dwm, qtile, xmonad or awesome.
18. **`--frame system`** (or `OBJECT_WINDOW_FRAME=system`) gives the system's ordinary frame on every system, for a
    window manager the frameless window does not suit (one of the three apps offers the same).
19. **Closing saves first.** The shell asks the page, waits for its answer or 3 seconds, closes the window (the
    page's own `pagehide` saves still run), then waits up to 2 seconds for requests still in flight. The page blurs
    the field being typed in, sends its saves, and counts the writes still on their way (a wrapper around `fetch`,
    installed only in the desktop window), at most 2.5 seconds.
20. **Permissions.** Notifications, the clipboard, the microphone (audio only) and full screen (presentations) for
    the app's own page; everything else, the camera included, is refused. Links to other sites open in the default
    browser (http, https and mailto only); the window only ever shows the app.
21. **Remembered per device:** size, place (not on Wayland, where a window cannot place itself: size and maximised
    are kept), maximised, the last "Window buttons" choice and theme, so the next start draws right before the page
    loads.
22. **The keep-on-top window keeps the system's frame** (its page has no top bar to drag) and closes with the main
    window.
23. **Spell check** follows Settings > Editor > "Spellcheck language" in the desktop window too. On Windows and
    Linux the browser engine downloads the dictionary for a language once from its vendor's server; the setting
    says so there. Spell check stays on.
24. **macOS traffic lights** at x 14, y 13 (centred in the 42 px top bar, from the system's standard button size;
    not seen on a Mac), with 78 px kept free on their left except in full screen.
25. **No installers yet** and no single-instance lock (two launches share the window's stored web data, as the old
    Linux window did).
26. **The page is asked again after a rebuild:** `index.html` goes out with `Cache-Control: no-cache`, since the
    desktop window keeps its cache between starts.

**The note page (choices 1, 3, 11)**

27. **Choice 1's rule:** a focused button, row or field always keeps its keys, so a note opened by a click on the
    sidebar or a tab takes Enter only once the focus is back on the page. A key still held when a note opens types
    nothing. A layer that is closing (the palette's last 200 ms) no longer counts as open. Raw mode does the same.
28. **Choice 3's rule:** the built-in rows move below the type's own only while the type's stored list still opens
    with them as a block in their default order; any arrangement by hand is shown exactly. Display only.
29. **Choice 11:** a row is one stretch of text (a line up to 280 characters); "Link" makes one link per match, last
    first; if the note changes between two, the links made stay and the toast says how many. The mentions count
    (notes, not matches) is unchanged.

**Tasks, the editor, settings (choices 4, 5, 6, 7, 9)**

30. **Choice 6:** a task with a future date and a deadline today is on Today only (every open task is on exactly
    one of Today, Upcoming and Inbox). The deadline chip shows on Today, Upcoming, Home and the Day view; elsewhere
    the row keeps its date chip, so dating it stays one click. "Move all open tasks" in the Day view leaves a task
    with no date alone.
31. **Choice 7:** with "A quote", `>` is the quote mark in combined runs too (`>#` makes a quoted heading).
32. **Choice 9:** "No date" on a row now does what the pane's "Remove date" does: the repeat, reminder and
    occurrence log go with the date, and it asks first when a log is on record. Both write `date: null`, as before.
33. **Choice 4:** the gallery's toast stays 8 seconds (it carries a button).

## Known limits

- The desktop window runs from the repository (`cd desktop && npm ci` once). Installers that need neither `uv` nor
  Node (an `.exe`, a `.dmg`, an AppImage) are not in M33.
- Only Linux could be run where M33 was built. The Windows and macOS parts of the window were written from Electron's
  documentation and are covered by tests of the options they build; the hand checks are their first real run.
- "Remove those headings" on a few thousand notes takes a while (about 8 ms a note where it was measured: 12 seconds
  for 1,493) and the request waits for it; nothing is lost if the window is closed meanwhile (each note is one
  atomic write), and a second click finishes what is left.
- "Remove those headings" stamps Last updated on each note it changes, as any save of a note's text does, so those
  notes are the most recently updated afterwards (Home's Recent and a list sorted by Last updated show them first).
- After "Remove those headings", a note an import made counts as edited by you. When its source page changes later,
  a re-run lists it under "Changed in both" and does not overwrite it (as for any note edited in Object).
- A heading that repeats the title further down a note's text is not counted. Nor is a note whose title comes from
  its heading (a `.md` file with no `title` of its own): there the heading is the title.
- Older than M33, seen while testing the re-run, the same at `41857f51`, not changed here: a re-run of the Obsidian
  fixture gives the Book type one more "Date" property each time (`date_2`, then `date_3`: the page's `date` key is
  planned as a new property again); and with two Notion exports imported into one space, a table row of one can be
  matched to the other's on a re-run ("changed in both" for one item, one more "unchanged"). No note is changed by
  either.

## Hand checks (Gene)

On a copy of a space, or a new one. The window first, then the choices in the plan's order.

**The desktop window**

- [ ] Once: `cd desktop && npm ci`. Then `uv run objectapp --space <folder>`: Object opens in a window with no title bar and no frame of its own; the top bar (the sidebar toggle, back and forward, the tabs) is the top of the window.
- [ ] Drag the window by a free part of the top bar. The sidebar toggle, back and forward, the tabs and `+` still click, and a tab still drags to another place. A double click on a free part maximises, and again restores.
- [ ] Windows: minimise, maximise and close are the system's own buttons at the top right, in the app's colours (switch between a light and a dark theme: they follow). Hovering maximise shows the snap layouts, Win+arrow snaps, and the window resizes from every edge.
- [ ] macOS: the traffic lights sit at the left of the top bar, which leaves room for them (in full screen the room is given back). The menu bar has Object's own menus, and Cmd+C, Cmd+V, Cmd+Z, Cmd+W and Cmd+Q do what they do everywhere.
- [ ] Linux: minimise, maximise (restore when maximised) and close are drawn at the right end of the top bar and work; the window resizes from its edges. On a tiling desktop (Hyprland, sway, i3 and the like) there are no buttons.
- [ ] Linux: Settings > Appearance > "Window buttons": "Show" and "Hide" take effect at once; "Automatic" goes by the desktop. The setting is not shown on Windows, on macOS or in a browser tab.
- [ ] Move the window, resize it, close it and start again: same size and place. Close it maximised: it comes back maximised. With the screen it was on unplugged, it opens on a screen that is there.
- [ ] The taskbar, dock or launcher shows Object's name and icon; with Settings > Appearance > "App icon" set to a colour, the window has that colour's icon from the next start.
- [ ] A link to another site in a note opens in your default browser; the app's window never shows another site.
- [ ] Right click in a note's text: Cut, Copy, Paste and Select all; on a misspelled word, the spelling suggestions. On a tab or a row that has a menu of its own, that menu shows as before.
- [ ] Type a sentence and close the window at once. Start again: every word is there. (In the old window the server stopped as the window closed.)
- [ ] Export a note: the system's save dialog asks where to put the file.
- [ ] Ctrl+N makes a new note and Ctrl+U opens the New menu in the window; in a browser tab Alt+N and Alt+Shift+N still do (choice 12, unchanged).
- [ ] With Work on, "Keep on top" opens the small "Object focus" window, and it stays above other windows.
- [ ] `uv run objectapp --window pywebview --space <folder>` opens the old window, with the system's title bar, and everything works as before. So does the plain command on a machine where `desktop/node_modules` is not there. `--browser` opens a browser tab as before, and the top bar there looks and works as it did (nothing shifted, no place that refuses a click).
- [ ] `uv run objectapp --frame system --space <folder>`: the window has the system's ordinary frame and title bar, and the top bar keeps no room and draws no buttons.
- [ ] In the desktop window on Windows or Linux, Settings > Editor > "Spellcheck language" says the dictionary is downloaded once; change the language: a misspelled word in that language is marked.
- [ ] Close the terminal that started `uv run objectapp` (or log out) with a property half typed: start again, it is there.
- [ ] `python scripts/install-launcher.py` adds Object to the system's launcher (the Start menu, the applications list, or a `.command` file on macOS), and starting it from there opens the same window.

**Opening a note (choice 1)**

- [ ] Open a note that has text: nothing is focused, Space and Page Down scroll, and a stray letter key types nothing. Enter puts the caret at the end of the text; ArrowDown puts it at the start.
- [ ] Open a note with no text (make one, give it a title, open it again): the caret is in the text, ready to type.

**The properties pane (choice 3)**

- [ ] On a note of a type with its own properties (a Task, a Book): the type's own properties come first, in their own order; Collections, Description, Created at, Last updated, Tags and the rest follow. An order you arranged by hand is kept, and the type's file is not changed by looking.

**A type from the gallery (choice 4)**

- [ ] Types > the gallery > Recipe: you land on Recipe's own page (its list, "New" ready), with a toast that names it and offers "Type settings". A type made from scratch still opens its settings.

**Titles written twice (choice 5)**

- [ ] In a space with notes whose text begins with `# <their title>` (notes made by older versions, pages imported before M33): Settings > Editor shows "N notes begin with a heading that repeats their title." and "Remove those headings". In a space with none, the line is not there.
- [ ] Click "Remove those headings" and confirm: those notes show their title once, and nothing else in them changed. A note's version history has the version from just before, heading included; restoring it brings the heading back.
- [ ] Import a Markdown folder: each page shows its title once, and a page that had its own first heading still has it. Import the same folder again: every page is "unchanged" and nothing is doubled.

**A task with only a deadline (choice 6)**

- [ ] A task with a deadline next week and no date: it is not in Inbox (Inbox holds the open tasks with neither a date nor a deadline); it is on its day in Upcoming, marked as a deadline (its chip is an hourglass and the deadline, and a click on it changes the deadline, not the date).
- [ ] Set that deadline to a day before today: the task is under Today's "Overdue" on the Tasks page, under Home's Tasks as overdue, and under "Overdue (n)" in the Calendar's Day view for today ("No tasks today" is not shown for it); no other day lists it as overdue (the deadline's own day still lists it, with "Deadline"). With Work on, Work's Today badge counts it. Complete it: it leaves Overdue on the Tasks page and on Home.
- [ ] Give it a date: it is placed by its date, as before (a passed deadline does not make a dated task overdue). Each open task is on exactly one of Today, Upcoming and Inbox.

**Typing `> ` (choice 7)**

- [ ] `> ` at the start of a line makes a toggle, as before. Settings > Editor > "Typing "> " makes" > "A quote": now it makes a quote. `| ` makes a quote either way. Back on "A toggle" it makes a toggle again.

**"No date" (choice 9)**

- [ ] On a task with a date, a repeat and a reminder, choose "No date" on its row's chip; on another like it, open its Date in the properties pane and choose "Remove date". Both tasks end up the same: no date, and the repeat and the reminder gone with it (in the app, and in the file: `date: null`, no `repeat` or `remind` line). A task with done or skipped repeats asks first ("Remove date?") in both places.

**Mentions (choice 11)**

- [ ] On a note named in another note's text without a link: the Mentions tab (and "All") lists that line once, also when the line names the note twice, and its context reads as text (a link in the line shows its words, not `[[…]]`).
- [ ] "Link" on that line links every unlinked mention of the title in it. Unlinked mentions are as easy to find as before: the Mentions tab and its count are where they were.

**Left as they were on purpose (choices 2, 8, 10)**

- [ ] Today's note still opens as a pop-over; a property's kinds still read "Link" and "Link to a type"; "Add a task" still ignores "yesterday" and "last week", and the global new task still reads no date words.
