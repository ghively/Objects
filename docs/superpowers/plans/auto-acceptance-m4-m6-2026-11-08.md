# Automated acceptance run: M4, M5, M6 (2026-11-08)

Lane C1a, branch `lane/c1a-acceptance-m4-m6` (off `lane/c1-acceptance-m1-m9`). Driven headless: `objectapp --browser` on port 8803 with `BROWSER=/usr/bin/true`, scratch state dir, fresh git-committed copies of the fixtures (space-calendar for M4, space-links for M5, space-whiteboard and space-sample for M6), Chromium at 1440x900 via CDP; DOM read with js(). Gene's boxes in m4/m5/m6-acceptance.md are NOT ticked.

Classes: AUTO = verifiable by driving app/API/files; MANUAL = taste/look, Windows-only (notifications, Wacom), or his real data/scale.

**Counts:** MANUAL 43, NOT-RUN 48, PARTIAL 1, PASS 5, SUPERSEDED 1 (total 98)

## Script reruns on this branch (2026-11-08)

| Script | Fixture | Result |
|---|---|---|
| `scripts/m4_acceptance.py` | space-calendar | exit 0, 24 [ok] |
| `scripts/m4_acceptance.py` | space-sample | exit 0, 24 [ok] |
| `scripts/m5_acceptance.py` | space-links | exit 0, 19 [ok] |
| `scripts/m6_acceptance.py` | space-whiteboard | exit 0, 20 [ok] |
| `scripts/m6_acceptance.py` | space-sample | exit 0, 19 [ok] |

Logs: `~/.hermes/cache/scratch/lane-c1a/acc/*.log`.



## M4

| Box | Section | Check | Class | Result | Evidence |
|---|---|---|---|---|---|
| M4#1 | Calendar | All four views (Day, Three days, Week, Month); the pager, Today, Shift+Today and the arrow keys in each view. M, W, R, D, T and ←/→ are the calendar keys (the S | AUTO | **PASS** | Segmented Month/Week/Three days/Day + keys M/W/R/D switch (aria-pressed); ←/→ and pager 'Forward one day, week or month' step 1 day (Day, Three days), 1 week (Week: Nov 8->15), 1 month (Month: Nov->Dec 2026); ↑/↓ step the higher unit (Day: Nov 8->Nov 1, Week: ->Oct 4, Month: Dec 2026->Dec 2025); T and 'Jump to today' return to Nov 8 2026; Shift+Today with no daily note today only goes to today (code: opens today's note when it exists) |
| M4#2 | Calendar | The mini month: month and year dropdowns, today, the daily-note dots; the Day header and week numbers around a Sunday and the year boundary. | AUTO | **PASS** | Mini month: Month dropdown (January..December) -> October; Year dropdown (1976..2035+) -> 2027; today button aria-current=date bg-today; daily-note dots (data-has-note + daily-note-dot) on Oct 21,22,23,25 2026; Day header: Sun Dec 27 2026 'Week 53', Fri Jan 1 2027 'Week 53', Sun Jan 3 2027 'Week 1', Mon Jan 4 'Week 1'; mini month has no week-number column |
| M4#3 | Calendar | "+ Daily Note", typing in the inline note, the Reviewed button, an external edit of the note in VS Code appearing in the page, a daily note template. | AUTO | **PARTIAL** | Typing in today's empty inline note created DailyNotes/2026-11-08.md (date, reviewed:false, body = typed line); Reviewed checkbox -> diff reviewed false->true + lastUpdated; external edit of the body appeared in the inline editor ('...edited outside'); Week view '+ Daily Note' created 2026-11-09.md. Template: with DailyNote defaultTemplateId=Standup, typing 'templ line' in the empty slot for Nov 10 created the note from the template (tags [Standup], ## Yesterday/Today/Blockers) BUT the typed text was glued onto the last heading: body ends '## Blockerstempl line' (the empty slot shows no template preview, so the first keystrokes land at the end of the template heading) |
| M4#4 | Calendar | The Day sections and tabs, quick-create chips (including a `createOnce` type and a hidden type), a dated object with a range on each of its days, "Move all open | AUTO | **PASS** | Day sections + tabs All/Daily note/Tasks/Created on This Day (each tab shows only its section; All = Daily note, Tasks, Objects with this date, Created on This Day, Backlinks, Date references, Timeline). Quick-create chips: Event, Meeting, Person, Task; after Meeting createInCalendarOption=disabled -> 'Event,Person,Task'; Person createOnce: chip created People/Untitled.md (birthday: 2026-11-08, opened as page) and the Person chip then vanished on Nov 8 only (other days 'Event,Person,Task'). Range: Meetings/Offsite (Oct 26->28) shown on Oct 26, 27, 28 and not 25/29 (Events type is hideFromCalendarSidebar, so an Event range probe is correctly absent). Tasks '+' > 'Move all open tasks to' > Tomorrow moved all 13 overdue tasks: diff = date lines only (+lastUpdated), timed task keeps local time (08:30Z CDT -> 09:30Z CST); section then 'No tasks today' |
| M4#5 | Calendar | Three days: should empty sections ("No tasks on this day") be hidden? (Task 14 shows them.) | MANUAL | **MANUAL** | decision for Gene (hide empty Three-days sections?) |
| M4#6 | Tasks | The Tasks page: the Status tab as list and kanban, a drag between categories, the Today, Inbox, Deadline, Scheduled, Recurring, Reminders and Completed tabs, qu | AUTO | **SUPERSEDED** | Old Tasks tabs gone (catalog §4). Features at new location (Tasks dashboard): More views > Status 'Every task, grouped by status' with Layout menu List/Wall/Kanban/Gallery/Table/Embed/Calendar/Timeline/Chart; Kanban columns Not started/In progress/Blocked/Done; pointer drag of a card Not started->In progress wrote only status: In Progress (+lastUpdated); quick add 'Task title' + Enter created Tasks/C1a quick add.md; views Today (day timeline + Today's tasks), Inbox (5, default-no-status tasks), Deadline (1), Scheduled (16), Recurring (9), Reminders (2), Completed (2), Context render; Task type page tabs = 'All' only (no Overview) |
| M4#7 | Tasks | A task with Repeat (daily, weekday, custom by completion, with an end date) completed twice. | AUTO | **PASS** | Checkbox (role=checkbox 'Open') twice per task: 'every day' 11-08->11-09->11-10; 'every weekday' Fri 11-13->Mon 11-16->Tue 11-17; 'every 2 days after completion' 11-05->11-10 (today+2)->11-10; 'every day until 2026-11-09' 11-08->11-09, then status Done (series ended). Each diff = date, status, completed, occurrenceLog line (+lastUpdated); status stays Not Started while advancing |
| M4#8 | Tasks | A reminder set a minute ahead fires one Windows notification while the app is open, and none once the task is done. | MANUAL | **MANUAL** | Windows notification banners (pywebview/OS toasts) — scheduler logic: m4_acceptance.py §7 [ok] one notification at the minute, none on second tick; 21 reminder pytest passed |
| M4#9 | Tasks | A reminder set to a time already past stays silent, also across a restart. | AUTO | **PASS** | Live scheduler not observable headless (OS toast); backend: uv run pytest test_reminders.py test_reminders_edit.py -> 21 passed incl. test_trigger_already_past_when_set_does_not_fire_on_restart, test_reminder_set_in_the_past_still_never_fires, test_fires_once_across_restart; scripts/m4_acceptance.py §7 [ok] (no fire at 08:59, one at 09:00:30, none on second tick, 1 in all after restart) |
| M4#10 | On the CPI copy (outside the r | His existing Task type keeps its own `priority`/`deadline` definitions and options. If its status has no Done option, note it: the checkbox can't complete tasks | MANUAL | **MANUAL** | CPI copy / real data at scale |
| M4#11 | On the CPI copy (outside the r | His existing daily notes appear on their days, including any whose `date` key is missing. | MANUAL | **MANUAL** | CPI copy / real data at scale |
| M4#12 | On the CPI copy (outside the r | Opening the Calendar and Tasks changes no file. | MANUAL | **MANUAL** | CPI copy / real data at scale — fixture proxy: m4_acceptance.py §9 M1 no-edit pass on space-calendar [ok] 37 objects, 0 files changed (2026-11-08 rerun on this branch) |
| M4#13 | On the CPI copy (outside the r | Completing a recurring task: the `git diff` is the status, date and completed lines plus `lastUpdated`. | MANUAL | **MANUAL** | CPI copy / real data at scale — fixture proxy (M4#7 run): completing a recurring task diffs date, status, completed AND an occurrenceLog block (+lastUpdated); the box lists only status/date/completed, so Gene should expect the occurrenceLog lines too |
| M4#14 | On the CPI copy (outside the r | A month with 5,000+ objects switches views without a visible stall. | MANUAL | **MANUAL** | CPI copy / real data at scale |
| M4#15 | On the CPI copy (outside the r | Against the behaviour catalog: | MANUAL | **MANUAL** | visual comparison against the behaviour catalog |
| M4#16 | On the CPI copy (outside the r | the Day view and Three days, against the behaviour catalog | MANUAL | **MANUAL** | visual comparison against the behaviour catalog |
| M4#17 | On the CPI copy (outside the r | the mini month | MANUAL | **MANUAL** | visual comparison against the behaviour catalog |
| M4#18 | On the CPI copy (outside the r | the pager and the segmented control | MANUAL | **MANUAL** | visual comparison against the behaviour catalog |
| M4#19 | On the CPI copy (outside the r | the Tasks page | MANUAL | **MANUAL** | visual comparison against the behaviour catalog |
| M4#20 | On the CPI copy (outside the r | the Week view (stacked days) and the Month view (daily-note card list) | MANUAL | **MANUAL** | visual comparison against the behaviour catalog |
| M4#21 | On the CPI copy (outside the r | the daily-note marker in the mini month, which this plan designed on its own; note what should differ so a fix pass can follow | MANUAL | **MANUAL** | visual comparison against the behaviour catalog |
| M4#22 | On the CPI copy (outside the r | Reminders: one banner per reminder, none after quitting the app, one catch-up after reopening within 12 hours. | MANUAL | **MANUAL** | Windows notification banners (pywebview/OS toasts) — backend: test_fires_once_across_restart, test_catch_up_since_last_running, test_catch_up_window_12h_without_ledger pass |

## M5

| Box | Section | Check | Class | Result | Evidence |
|---|---|---|---|---|---|
| M5#1 | In the app | Ctrl+K: recents on an empty query, a body word with its snippet, a fuzzy title, the type, exclude and tag options and their chips, Backspace removing a chip, "C | AUTO | **NOT-RUN** |  |
| M5#2 | In the app | Ctrl+P: every action ("Open calendar", "Open today", "Open global graph", "Open graph view", the sidebar and side panel toggles, "Create {type}"). | AUTO | **NOT-RUN** |  |
| M5#3 | In the app | Find in page from the `…` menu and with Ctrl+F: match case, whole word, next and previous, replace, replace all, then `git diff`. | AUTO | **NOT-RUN** |  |
| M5#4 | In the app | The references section on Ada Lovelace: all five tabs, hiding the section by clicking the active tab, linking a mention, then `git diff`. | AUTO | **NOT-RUN** |  |
| M5#5 | In the app | The backlinks property in the panel, as a table column, as a backlinks filter and as a group; the "No backlinks" Overview section; the Tasks page Context tab wi | AUTO | **NOT-RUN** |  |
| M5#6 | In the app | The global graph: filters, tags network, search, fit and click to peek. The local graph: "Maximum distance" 1 to 5 (default 1) with separate "Show less" / "Show | AUTO | **NOT-RUN** |  |
| M5#7 | In the app | On the `--big` copy: the global graph's pan and zoom, and typing in the palette at 5,000 objects. | MANUAL | **MANUAL** | CPI copy / real data at scale (--big perf feel) |
| M5#8 | On the CPI copy (outside the r | Opening creates only `.object-cache/`, and `git status` stays clean. Deleting the folder loses nothing, and it comes back. | MANUAL | **MANUAL** | CPI copy / real data at scale (--big perf feel) |
| M5#9 | On the CPI copy (outside the r | Search finds what you expect by title and by text. The snippets read well. `partial` disappears after the first indexing. | MANUAL | **MANUAL** | CPI copy / real data at scale (--big perf feel) |
| M5#10 | On the CPI copy (outside the r | Backlinks are right for a few objects you know well. Linking a mention changes only that text (`git diff`). | MANUAL | **MANUAL** | CPI copy / real data at scale (--big perf feel) |
| M5#11 | On the CPI copy (outside the r | The graph at your space's size pans, zooms and filters without stalls. | MANUAL | **MANUAL** | CPI copy / real data at scale (--big perf feel) |
| M5#12 | Against the behaviour catalog: | Key bindings: Ctrl+P or Ctrl+K opens search (the Shortcuts sheet in `docs/behavior-catalog.md`; both also work while the peek is open). The sheet lists no key f | AUTO | **NOT-RUN** |  |
| M5#13 | Against the behaviour catalog: | Search highlight colour, now settled: the search highlight tokens (a light yellow in light themes, a dimmer yellow in dark themes); find in page uses its own ma | MANUAL | **MANUAL** | visual: highlight colour/weight judged by eye |
| M5#14 | Against the behaviour catalog: | Graph: | MANUAL | **MANUAL** | decision review (graph sizing/colour rules) judged by eye |
| M5#15 | Against the behaviour catalog: | The palette's type and tag option matching (prefix, word-prefix, or substring of 3+ characters), the cap of 5 tag options and 10 Recently Opened, and the way pi | AUTO | **NOT-RUN** |  |
| M5#16 | Against the behaviour catalog: | Find bar icons: an underlined "ab" for whole word, `ph-text-aa` for match case. The bar shows Replace even in read-only editors, where it does nothing. | AUTO | **NOT-RUN** |  |
| M5#17 | Against the behaviour catalog: | "Related tags" rule: tags that appear together with this object's tags on other objects. | AUTO | **NOT-RUN** |  |
| M5#18 | Against the behaviour catalog: | Lexical "Related Content", a stand-in for a semantic one. | AUTO | **NOT-RUN** |  |
| M5#19 | Against the behaviour catalog: | Tab counts (All is the sum of the other tabs it offers). | AUTO | **NOT-RUN** |  |
| M5#20 | Against the behaviour catalog: | Where the Tasks "Context" tab sits (after Tags, before Completed). | AUTO | **NOT-RUN** |  |
| M5#21 | Against the behaviour catalog: | Our strings: | MANUAL | **MANUAL** | decision review: our strings (wording taste) |
| M5#22 | Against the behaviour catalog: | BacklinksCell: a count in a one-line table cell and in a small card, chips in a wrapped cell and in the property panel. | AUTO | **NOT-RUN** |  |
| M5#23 | Against the behaviour catalog: | Rows carry `backlinks` on every type (wiring fix 1 above), so "No backlinks" is offered on Page, Task and others. | AUTO | **NOT-RUN** |  |

## M6

| Box | Section | Check | Class | Result | Evidence |
|---|---|---|---|---|---|
| M6#1 | Wacom pressure test | In Wacom Tablet Properties → Mapping, "Use Windows Ink" is on (Chromium/WebView2 gets pen pressure through Windows Ink). | MANUAL | **MANUAL** | Wacom pen hardware / touch screen (Windows Ink) |
| M6#2 | Wacom pressure test | With the Pen, a light stroke is thin and a heavy one thick, varying smoothly within one stroke. | MANUAL | **MANUAL** | Wacom pen hardware / touch screen (Windows Ink) |
| M6#3 | Wacom pressure test | A fast scribble has no gaps or corners. | MANUAL | **MANUAL** | Wacom pen hardware / touch screen (Windows Ink) |
| M6#4 | Wacom pressure test | The Highlighter is flat and translucent. | MANUAL | **MANUAL** | Wacom pen hardware / touch screen (Windows Ink) |
| M6#5 | Wacom pressure test | Turning the pen over (eraser end) erases the strokes it crosses, whatever tool is selected. | MANUAL | **MANUAL** | Wacom pen hardware / touch screen (Windows Ink) |
| M6#6 | Wacom pressure test | The barrel button never draws. | MANUAL | **MANUAL** | Wacom pen hardware / touch screen (Windows Ink) |
| M6#7 | Wacom pressure test | A mouse stroke draws with a simulated taper. | AUTO | **NOT-RUN** |  |
| M6#8 | Wacom pressure test | Resting the palm on a touch screen while drawing adds nothing. | MANUAL | **MANUAL** | Wacom pen hardware / touch screen (Windows Ink) |
| M6#9 | Wacom pressure test | Each stroke undoes and redoes as one step. | AUTO | **NOT-RUN** |  |
| M6#10 | Wacom pressure test | The ink is still there after closing and reopening the app. | AUTO | **NOT-RUN** |  |
| M6#11 | Wacom pressure test | `Whiteboards/<title>.ink.svg` opened in Edge or Chrome shows the same strokes. | AUTO | **NOT-RUN** |  |
| M6#12 | Wacom pressure test | Note any lag between pen and line. | MANUAL | **MANUAL** | Wacom pen hardware / touch screen (Windows Ink) |
| M6#13 | Files | Opening his existing space changes nothing (`git status` clean). | MANUAL | **MANUAL** | his existing space (real data) |
| M6#14 | Files | A new board is at most three files, side by side in `Whiteboards/`. | AUTO | **NOT-RUN** |  |
| M6#15 | Files | A `git diff` after moving one shape shows only that node's `position` lines in the `.whiteboard.json`. | AUTO | **NOT-RUN** |  |
| M6#16 | Files | Delete a board and restore it from the Trash: all three files come back. Rename a board: all three files follow. | AUTO | **NOT-RUN** |  |
| M6#17 | Files | Edit a board's `.whiteboard.json` in VS Code while it is open: the board reloads ("Changed elsewhere. Reloaded."). | AUTO | **NOT-RUN** |  |
| M6#18 | Files | Two windows editing different nodes of one board at once both keep their changes (merge). | AUTO | **NOT-RUN** |  |
| M6#19 | In the app | Create a board from "+ New". | AUTO | **NOT-RUN** |  |
| M6#20 | In the app | Every tool. | AUTO | **NOT-RUN** |  |
| M6#21 | In the app | Every shape and gate, with Engineering mode on. | AUTO | **NOT-RUN** |  |
| M6#22 | In the app | Text editing and alignment. | AUTO | **NOT-RUN** |  |
| M6#23 | In the app | An object dragged from Pinned, one dragged from the search palette, and one picked with "Existing object", each opened in the peek by double-click. | AUTO | **NOT-RUN** |  |
| M6#24 | In the app | Connectors in all styles, with labels. | AUTO | **NOT-RUN** |  |
| M6#25 | In the app | Frames: wrap, title, drag with contents. | AUTO | **NOT-RUN** |  |
| M6#26 | In the app | Align, order, flip, duplicate, delete. | AUTO | **NOT-RUN** |  |
| M6#27 | In the app | Lock. | AUTO | **NOT-RUN** |  |
| M6#28 | In the app | Every Canvas display switch. | AUTO | **NOT-RUN** |  |
| M6#29 | In the app | The zoom menu and the zoom keys. | AUTO | **NOT-RUN** |  |
| M6#30 | In the app | Undo and redo across nodes and ink. | AUTO | **NOT-RUN** |  |
| M6#31 | In the app | Boards in backlinks and search: an object embedded on a board lists the board in its references, and a word typed in a board text block finds the board in Ctrl+ | AUTO | **NOT-RUN** |  |
| M6#32 | Against the behaviour catalog  | The toolbox position and contents. | MANUAL | **MANUAL** | visual comparison against the behaviour catalog (judge by eye) |
| M6#33 | Against the behaviour catalog  | The zoom control. | MANUAL | **MANUAL** | visual comparison against the behaviour catalog (judge by eye) |
| M6#34 | Against the behaviour catalog  | The selection toolbar. | MANUAL | **MANUAL** | visual comparison against the behaviour catalog (judge by eye) |
| M6#35 | Against the behaviour catalog  | Node rings and handles. | MANUAL | **MANUAL** | visual comparison against the behaviour catalog (judge by eye) |
| M6#36 | Against the behaviour catalog  | The dotted grid. | MANUAL | **MANUAL** | visual comparison against the behaviour catalog (judge by eye) |
| M6#37 | Against the behaviour catalog  | How connectors look, including the 3 px width and our tip drawings. | MANUAL | **MANUAL** | visual comparison against the behaviour catalog (judge by eye) |
| M6#38 | Against the behaviour catalog  | How frames look. | MANUAL | **MANUAL** | visual comparison against the behaviour catalog (judge by eye) |
| M6#39 | Against the behaviour catalog  | Gates: here they are only labelled rectangles. | MANUAL | **MANUAL** | visual comparison against the behaviour catalog (judge by eye) |
| M6#40 | Against the behaviour catalog  | The entity node's caption and card. | MANUAL | **MANUAL** | visual comparison against the behaviour catalog (judge by eye) |
| M6#41 | Against the behaviour catalog  | The first "zoom to fit" against the title overlay (see above). | MANUAL | **MANUAL** | visual comparison against the behaviour catalog (judge by eye) |
| M6#42 | Decisions made without a refer | The shortcut keys follow the whiteboard part of the Shortcuts sheet: V, H, T, L, Shift+L (arrow), R, O, P (triangle), F, ] and [ (front and back), Ctrl+] and Ct | AUTO | **NOT-RUN** |  |
| M6#43 | Decisions made without a refer | Frames dragging their contents. | AUTO | **NOT-RUN** |  |
| M6#44 | Decisions made without a refer | 9 of the 12 shapes in the picker. | AUTO | **NOT-RUN** |  |
| M6#45 | Decisions made without a refer | Board edits don't bump `lastUpdated`. | AUTO | **NOT-RUN** |  |
| M6#46 | Decisions made without a refer | The camera is per viewer. | AUTO | **NOT-RUN** |  |
| M6#47 | Decisions made without a refer | "Clear Whiteboard" also clears the ink. | AUTO | **NOT-RUN** |  |
| M6#48 | Decisions made without a refer | Change type is refused for boards. | AUTO | **NOT-RUN** |  |
| M6#49 | Decisions made without a refer | Ink colours and widths. | AUTO | **NOT-RUN** |  |
| M6#50 | Decisions made without a refer | A placed text block opens for typing at once. | AUTO | **NOT-RUN** |  |
| M6#51 | Decisions made without a refer | Dragging a search result closes the palette. | AUTO | **NOT-RUN** |  |
| M6#52 | Decisions made without a refer | Whiteboard is offered in "+ New" before the space has the type. | AUTO | **NOT-RUN** |  |
| M6#53 | Decisions made without a refer | The Task 7, 9, 10, 11 and 12 choices and strings listed above. | MANUAL | **MANUAL** | decision review of Task 7/9/10/11/12 choices and strings |
