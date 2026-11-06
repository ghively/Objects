# Hands-on checklist (M1–M9, polish, walkthrough)

Date: 2026-11-04. One list for Gene to work through in the running app. It gathers:

- every unchecked hand-check in `m1-acceptance.md` … `m9-acceptance.md` (255 boxes);
- the "our choice" notes from the 2026-11-03 and 2026-11-04 entries in `remaining-work.md`, marked **(new 2026-11-03)** or **(new 2026-11-04)**;
- the findings of the 2026-11-04 walkthrough, marked **(walkthrough)**.

A tag like `(M4 #7)` is the 7th unchecked box in `m4-acceptance.md`, counting nested boxes, in document order. Tick the item here and in that doc. An item with several tags merges duplicates; tick each source. Items dropped as obsolete are listed at the end.

**How to run.** Never point the app at the repo's fixtures or at your real space; always use a copy outside the repo with git so every write shows up:

1. Copy the space outside the repo (the CPI export, or a fixture such as `backend/tests/fixtures/space-sample`), then in the copy run `git init`, `git add -A`, `git commit -m base`.
2. In `frontend/`, run `npm run build`.
3. From the repo root, run `uv run objectapp --space "<copy>"`. After each check, look at `git status` / `git diff` in the copy.

Fixtures the original checks used: `space-sample` (M2, M3), `space-calendar` (M4), `space-links` plus a 5,000-object space made with `backend/tests/bigspace.py` (M5), `space-whiteboard` (M6), `space-blocks` (M7), `space-m8` (M8, M9). Items that say "CPI copy" need the work export copy.

Behaviour checks compare against the behaviour catalog (`docs/behavior-catalog.md`). Look checks compare side by side with the original app you're modelling.

## Decisions (settled by Gene, 2026-11-04, and built)

Settled and built the same day; check each by hand:

- [ ] Slash menu: `/` opens it only at the start of a block, after whitespace or after a line break. Type `and/or`, `11/04` and a URL: no menu. The block handle's + still opens it anywhere.
- [ ] Update while a window is open: a lazily loaded feature whose file is gone saves pending edits, then reloads once. If saving fails or takes over 5 s, or a second failure comes within 60 s, a toast "Object was updated. Reload to continue." appears instead.
- [ ] Icon buttons: every sidebar, tab bar and top bar button has a name and a tooltip (the walkthrough's "no name" finding was a tool artefact; the per-type collections fold now names its type).
- [ ] Deleting a type moves its saved queries to the trash with it; a query over several types loses only that type. Restoring the type brings them back (byte-identical for the single-type ones).
- [ ] Role values renamed to Object's own (`page`, `tag`, `task`, `dailyNote`, `entity`, `whiteboard`, media kinds); computed only, nothing on disk changed. Nothing to check by hand beyond backlinks, graph filters and duplicates behaving as before.
- [ ] Page title: Escape keeps what you typed and leaves the field, like table cells (Escape with the `#` tag picker open closes only the picker; nothing commits during IME composition).

## Startup & spaces

- [ ] Copy the work export zip and extract it outside the repo, e.g. `C:\Users\genehively\Object Spaces\CPI\`. (M1 #1)
- [ ] In that folder run `git init`, `git add -A`, `git commit -m base`, so diffs are visible. (M1 #2)
- [ ] Run `npm run build` in `frontend/`, copy `backend/tests/fixtures/space-sample` outside the repo, and `git init` / add / commit it. (M2 #1)
- [ ] (Optional) `uv run python scripts/m1_roundtrip.py "<CPI copy>"`: PASS (it works on its own temporary copy). (M1 #3)
- [ ] `uv run python scripts/m2_acceptance.py "<CPI copy>"`: paste its step-10 lists into `m2-acceptance.md`. (M2 #14)
- [ ] `uv run objectapp --space "<copy>"`: a 1440x900 native window opens, and Ctrl+N reaches the page (isn't eaten by the window). (M1 #4, M2 #2)
- [x] **(walkthrough)** **(new 2026-11-04)** A legacy-format space is migrated on open (old metadata folders renamed once), and its `.md` files stay byte-identical.
- [ ] Open the CPI copy and scroll through every note: `git status` stays clean. (M6 #13, M7 #1, M8 #1)
- [ ] Notes with HTML comments, Mermaid fences, `$` signs, `<span>`, `<mark>`, `<time>`, `^ids` or `![[…#^…]]` keep their bytes after opening and scrolling. (M7 #2, M8 #2)
- [ ] Opening creates only `.object-cache/` (`git status` clean); deleting that folder loses nothing, and it comes back. (M5 #8)
- [ ] Version history stays outside the space: nothing new under the space folder; versions are in the state dir. (M8 #7)
- [ ] The sidebar shows the 13 CPI types. (M1 #5)
- [ ] All 13 CPI types migrate (Weblinks and Files as basic types), and each type's settings open. (M2 #15)
- [ ] In the window: create, rename, switch and remove a space; the launcher restarts on the same port. (M7 #33)
- [ ] Removing a space from the list keeps its folder on disk. (M7 #8)
- [ ] Delete a space: the current space is refused (only non-current spaces can be deleted), the folder goes to the Recycle Bin, and the permanent delete works when the bin is unavailable. (M8 #6, M8 #14, M8 #32)

## Sidebar & shell

- [ ] An object opens in the peek, and the peek's pager works. (M1 #6)
- [ ] Sidebar sections: drag to reorder, restart the app: the order is kept. (M9 #15)
- [ ] Tabs: persistent tabs, pinned tabs, the tab menu. (M7 #30)
- [ ] Breadcrumbs: following links builds the trail; earlier crumbs go into the dots menu. (M7 #31)
- [ ] Side panel: Shift+click opens it, three areas, resizing, swap, the calendar sidebar inside the Calendar. (M7 #32)
- [ ] Changed keys work: side panel Ctrl+Shift+→, left sidebar Ctrl+Shift+←, calendar sidebar Ctrl+Alt+S, dark mode Ctrl+Shift+L, shortcuts menu Ctrl+Shift+B, tab menu Ctrl+Shift+↑, back/forward Ctrl+←/→ or Ctrl+[/], math Ctrl+M, code/math block Ctrl+E/Ctrl+M with blocks selected, move blocks Alt+↑/↓. (M7 #9)
- [ ] Confirm the tab, breadcrumb, side panel, block style, space and settings rules listed under "Rules the build chose" in `m7-acceptance.md` (e.g. pinned tabs never close, at most 3 inline crumbs, side panel 45 %). (M7 #18)
- [ ] **(new 2026-11-04)** Help sits below Graph and Trash in the sidebar, and nothing in it links to an external web page.
- [x] **(walkthrough)** **(new 2026-11-04)** Help's three entries (shortcuts, Getting started, Markdown reference) open.

## Object page & editor

- [ ] "+ New" → Task → type a title: the object opens with the title focused. (M2 #3)
- [ ] Ctrl+N creates an object of the current type. (M2 #4)
- [ ] Ctrl+Backspace while typing in the title deletes a word, not the object. (M2 #5)
- [ ] Edit one paragraph or block: `git diff` shows only its lines (plus `lastUpdated`, and `id` if it was missing). (M1 #7, M7 #3)
- [ ] Edit a note in VS Code while the app is open: the app reloads it. (M1 #8)
- [ ] Add an icon, a description and a cover image (`Attachments/cover.png`). (M2 #7)
- [ ] Rename a title (e.g. "Ada Lovelace", sample copy): the relinked count shows, and referrers' `git diff` is only link text. (M2 #8)
- [ ] On the CPI copy, a rename relinks and shows the count. (M2 #17)
- [ ] Each page layout (profile, index card, encyclopedia), with wide mode and cover crop on and off. (M2 #12)
- [ ] Wide / Normal layout per object overrides the type; wide cover and cover reposition (drag, Save, Cancel) behave as the behaviour catalog describes; a new cover image resets the position. (M9 #6)
- [ ] **(new 2026-11-03)** The properties-pane toggle writes `hideProperties` to the object: `git diff` is that line (plus `lastUpdated`).
- [ ] The page inspector: the Outline jumps to headings, and Pin/Unpin is remembered. (M9 #5)
- [ ] Text Stats in the `…` menu and the inspector's Stats tab give the expected words, sentences, paragraphs and characters on the same note. (M9 #4)
- [ ] The inspector's Stats tab contents are right (our choice). (M8 #22)
- [ ] The timeline's contents are right (our choice). (M8 #18)
- [ ] Duplicate a page, a task and a tag: copies are "<Title> (Copy)", the source is untouched, two-way relations link the copy too; no Duplicate on a daily note, template or whiteboard. (M9 #2)
- [ ] Every block kind from the slash menu, and its menus. (M7 #19)
- [ ] The drag and `+` handles. (M7 #20)
- [ ] Block selection and copy. (M7 #21)
- [ ] Resize columns. (M7 #22)
- [ ] The column add and remove controls, against the behaviour catalog. (M7 #14)
- [ ] A table's header row and header column. (M7 #23)
- [ ] A Mermaid diagram and a formula, in light and in dark. (M7 #24)
- [ ] An image resized, with a caption. (M7 #25)
- [ ] A PDF, audio and video block. (M7 #26)
- [ ] The PDF block's default height, against the behaviour catalog. (M7 #15)
- [ ] The code preview's default ("Display"), against the behaviour catalog. (M7 #13)
- [ ] A file attachment opens with the OS. (M7 #27)
- [ ] An embedded object switched between its four views. (M7 #28)
- [ ] Paste and drop files into a note. (M7 #29)
- [ ] Uploading, pasting and dropping a file never overwrites an existing attachment (a same-name file gets " (2)"). (M7 #7)
- [ ] Open and close a toggle: `git diff` is one line. (M7 #4)
- [ ] Change a block's colour or alignment: only its annotation line changes; "Remove style" removes that line. (M7 #5)
- [ ] Turn a note's last paragraph into a list, or add a block at the very end: the file keeps its final newline (fixed in the M7 fix pass; confirm). (M7 #6)
- [ ] Alignment from the block menu and from the table bar. (M9 #11)
- [ ] The slash menu's grouping and look (order, icons, search-only colour and Mermaid items, hover descriptions, 22rem width); "Create bookmark" and "Reuse any content" are ours. (M7 #16)
- [ ] The block menu's look (sections, labels, icons, Hierarchy order Standard, Small, Heading 1–4; no AI row; Color, Standout, Indent/Unindent in a last section as ours). (M7 #17)
- [ ] **(new 2026-11-03)** `@` or `[[` in an empty block inserts an object block; with Settings > Editor > Always create inline links on, it inserts an inline link.
- [ ] **(new 2026-11-04)** An empty icon list item loads as a list item, not as a raw (monospace) block.
- [ ] Copy a block reference: one line changes (the block's last line gains ` ^id`). (M8 #3)
- [ ] The editor's M8 features: tokens menu and colours, date tokens, indent and item colours, block references and "Referenced in", Turn into object/task/whiteboard, formulas, sorting and CSV, highlighting and Mermaid export, collection and query embeds, recording. (M8 #38)
- [ ] The storage forms read well in the file: occurrence log, `reminders` map, inline HTML styles, date tokens, `indent`, item comments, `collection:`/`query:` embeds, board `media`/`weblink`, recordings as `.weba`. (M8 #9)
- [ ] Tab/Shift-Tab indent in any block, and extended search on Ctrl+Shift+Enter: confirm these keys (ours). (M8 #8, M8 #20)
- [ ] Formula row numbering, and "Value" shown for an error (our choice). (M8 #24)
- [ ] The Turn-into embed view (our choice). (M8 #25)
- [ ] The typed-date phrases (our choice). (M8 #26)
- [ ] URLs pasted become bookmark pages (our choice). (M8 #21)
- [ ] The merge dialog (object and tag), and version history with preview and restore. (M8 #36)
- [ ] A merge does only what the plan says: target values, appended body, relinked referrers, source in the trash and restorable. (M8 #4)
- [ ] Merge's dropped properties and the 5,000 limit (our choice). (M8 #13)
- [ ] A history restore brings the bytes back and keeps `id`, `title` and the file name, nothing more. (M8 #5)
- [ ] The version rules: 5 minutes, 200 versions, title kept (our choice). (M8 #12)
- [ ] Present: the slide-splitting rule and the presentation rows it leaves out (our choice). (M8 #17)
- [ ] Every other rule under "Rules the build chose" in `m8-acceptance.md`, against the behaviour catalog. (M8 #28)

## Properties & types

- [ ] On `Projects/Object app.md` (sample copy), edit every property kind (number, progress, boolean, url, date range, day-form `kickoff`, entity single and multi, label, text): each `git diff` is only that key (plus `lastUpdated`, `id` the first time). (M2 #6)
- [ ] On the CPI copy, a property edit gives a one-line `git diff` (plus `lastUpdated`). (M2 #16)
- [ ] Project settings: a Number in EUR with "Separator comma". (M2 #9)
- [ ] Project settings: a Label set with options and colours. (M2 #10)
- [ ] Project settings: "Two-way linking" with "Create property": the counterpart appears on the target type. (M2 #11)
- [ ] Create a type "Meeting", delete it, restore it from the Trash: its settings come back. (M2 #13)
- [ ] Content property: the full block editor works in the property panel; a note edited there reloads identically. (M9 #7)
- [ ] Text property: `[[` opens the picker, links show as chips, renaming the target updates the link. (M9 #8)
- [ ] Template date variables ("Day/Week/Month/Year of creation") on a template's date property: a new object gets the right date or range. (M9 #9)
- [ ] The CPI Task type keeps its own `priority`/`deadline` definitions and options; if its status has no Done option, note it (the checkbox can't complete tasks until one is added). (M4 #10)
- [ ] The basic-setup property kinds (our choice). (M8 #15)
- [ ] **(new 2026-11-03)** The types gallery's property kinds per starter type read sensibly (our choice).
- [ ] **(new 2026-11-03)** In the tag picker, Enter picks the closest existing tag before "Create".
- [x] **(walkthrough)** **(new 2026-11-04)** Adding the Books starter type creates its "Currently reading" query.
- [ ] **(new 2026-11-04)** The other starter types' queries (14 in all, e.g. Projects "Active projects", Films "Top rated films") are created and return the right objects.
- [x] **(walkthrough)** **(new 2026-11-04)** The type setting Default list view saves only its key (`defaultDataViewLayout`).

## Views, collections & queries

- [ ] Task type page, All tab: each of the six full-view layouts (list, grid, wall, table, embed, kanban) renders. (M3 #1)
- [ ] A filter group `status includes Done OR done is selected`, a sort, and group by status work. (M3 #2)
- [ ] Overview sections show, collapse, reorder and remove; a type with no saved views starts with Recently Opened, Collections, Queries and the "All" tab; "Not in any collection" and "Not tagged" come from "Add a section"; Collections and Queries can't be removed; saved views keep their sections. (M3 #3)
- [ ] Table: resize a column, pin, hide, wrap, a Sum calculation, inline edit of a label and a date. (M3 #4)
- [ ] An external edit in VS Code updates the table row. (M3 #5)
- [ ] Kanban: drag a task between status columns; "+" in a column creates a task with that status. (M3 #6)
- [ ] A collection: "Add existing", rename, delete, restore from the Trash. (M3 #7)
- [ ] "Save as query" from the type page; pin it to the sidebar, to its type (new header tab) and to a collection's dashboard. (M3 #8)
- [ ] A custom sidebar section "In Progress" holding that query; the Queries sidebar item and its page; All notes. (M3 #9)
- [ ] A single-type query tab: the type is locked, and the release button works. (M9 #14)
- [ ] An embedded collection and an embedded query: change layout, filter, sort, group; close and reopen: kept; the note's diff is one annotation line. (M9 #10)
- [ ] The row menu on a type page, a type dashboard section and a query page; Select multiple; bulk change type, open in side panel, delete. (M9 #12)
- [ ] On the CPI copy, each type page opens with its default layout; Weblinks shows grid cards. (M3 #10)
- [ ] On the CPI copy, a membership edit's `git diff` is the `collections:` line plus `lastUpdated` (plus `id:` if none); view changes touch only `.object/`. (M3 #11)
- [x] **(walkthrough)** **(new 2026-11-04)** Wall cards show the label, the title, the description under it, and one labelled row per card property (Tags, "Empty").

## Calendar, daily notes & tasks

- [ ] All four views (Day, Three days, Week, Month): the pager, Today, Shift+Today and the arrow keys; M, W, R, D, T and ←/→ switch and move. ↑/↓ (previous/next higher unit) have no key yet: decide. (M4 #1)
- [ ] The mini month: month and year dropdowns, today, the daily-note dots; the Day header and week numbers around a Sunday and the year boundary. (M4 #2)
- [ ] "+ Daily Note", typing in the inline note, the Reviewed button, a VS Code edit of the note appearing in the page, a daily note template. (M4 #3)
- [x] **(walkthrough)** **(new 2026-11-04)** An empty day shows the daily-note placeholders without writing a file.
- [x] **(walkthrough)** **(new 2026-11-04)** Typing into an empty day creates the note, and every keystroke arrives as literal text.
- [ ] **(new 2026-11-04)** The placeholders are Day view only: Week and Three days still show "+ Daily Note".
- [ ] The Day sections and tabs, quick-create chips (including a `createOnce` type and a hidden type), a dated object with a range on each of its days, "Move all open tasks to". (M4 #4)
- [ ] Quick-create "Nothing" (our choice). (M8 #23)
- [ ] Day backlinks show on a day without a note (our choice). (M8 #19)
- [ ] Three days: decide whether empty sections ("No tasks on this day") should be hidden (they show now). (M4 #5)
- [ ] The daily-note marker in the mini month (our own design): note what should differ. (M4 #21)
- [ ] The Tasks page: Status tab as list and kanban, a drag between categories, the Today, Inbox, Deadline, Scheduled, Recurring, Reminders and Completed tabs, quick add, the Task type page without an Overview tab; tabs run Inbox, Today, Scheduled, Status, Context, Tags, Open, Deadline, Recurring, Reminders, Completed, All, with Inbox the default. (M4 #6)
- [ ] Where the Tasks "Context" tab sits (after Tags, before Completed). (M5 #20)
- [ ] A task with Repeat (daily, weekday, custom by completion, with an end date), completed twice. (M4 #7)
- [ ] On the CPI copy, completing a recurring task: `git diff` is the status, date and completed lines plus `lastUpdated`. (M4 #13)
- [ ] Skip and Excuse from the checkbox menu, the overdue dialog (all choices), the custom repeat "On" row, a reminder on a deadline. (M8 #33)
- [ ] The overdue threshold (two or more) and the catch-up readings (our choice). (M8 #10)
- [ ] The Completion Log under Task Stats (deleting one entry changes only its line); "Remove date" on a recurring task with history asks first. (M8 #34)
- [ ] Task Stats: the stats start (first log entry or `createdAt`) and the grid size (26 + 4) (our choice). (M8 #11)
- [ ] On the CPI copy, existing daily notes appear on their days, including any with no `date` key. (M4 #11)
- [ ] On the CPI copy, opening the Calendar and Tasks changes no file. (M4 #12)

## Search, palette, links & graph

- [ ] Ctrl+K: recents on an empty query, a body word with its snippet, a fuzzy title, type/exclude/tag options and their chips, Backspace removing a chip, "Create new … with title …", and Enter / Ctrl+Enter / Shift+Enter. (M5 #1)
- [ ] Ctrl+P: every action ("Open calendar", "Open today", "Open global graph", "Open graph view", the sidebar and side panel toggles, "Create {type}"). (M5 #2)
- [ ] Key bindings: Ctrl+P or Ctrl+K opens search (also with the peek open); the action palette opens from the palette's switch button; Enter variants, Ctrl+Enter in Replace = "Replace all", Esc in the find bar. (M5 #12)
- [ ] The palette's type and tag matching (prefix, word-prefix, or 3+ character substring), the caps (5 tag options, 10 Recently Opened), and picking an option removes the words that named it. (M5 #15)
- [ ] Find in page from the `…` menu and with Ctrl+F: match case, whole word, next/previous, replace, replace all, then `git diff`. (M5 #3)
- [ ] Find bar icons: underlined "ab" for whole word, `ph-text-aa` for match case; Replace shows in read-only editors and does nothing. (M5 #16)
- [ ] Search highlight colours: light `#fef08a4b` with yellow 900 text, dark `#fddf472c` with yellow 100 text; find in page `#facc1573`, current match `#f97316b3`; palette titles in the bold 600 variant; weight 500, radius 1px. (M5 #13)
- [ ] On the CPI copy, search finds what you expect by title and text; snippets read well; `partial` disappears after the first indexing. (M5 #9)
- [ ] The references section on Ada Lovelace (`space-links` copy): all five tabs, hiding it by clicking the active tab, linking a mention, then `git diff`. (M5 #4)
- [ ] On the CPI copy, backlinks are right for a few objects you know; linking a mention changes only that text. (M5 #10)
- [ ] The backlinks property in the panel, as a table column, as a filter and as a group; the "No backlinks" Overview section; the Tasks Context tab with a task linked from a page. (M5 #5)
- [ ] BacklinksCell: a count in a one-line table cell and a small card, chips in a wrapped cell and in the property panel. (M5 #22)
- [ ] "No backlinks" is offered on Page, Task and every other type. (M5 #23)
- [ ] Tab counts in the references section (All is the sum of the other tabs). (M5 #19)
- [ ] "Related tags": tags that appear with this object's tags on other objects. (M5 #17)
- [ ] Lexical "Related Content" as a stand-in for a semantic one. (M5 #18)
- [ ] Our strings: "via {property}", "Changed elsewhere. Reloaded.", "Could not create the link.", "No unlinked mentions", "No related tags", the Related Content empty line, "The text has changed. Reload and try again." (M5 #21)
- [ ] The global graph: filters, tags network, search, fit, click to peek; the local graph: "Maximum distance" 1–5 (default 1) with "Show less" / "Show more". (M5 #6)
- [ ] Graph rules: node sizes `3 + 2·sqrt(degree)` capped at 18, type and tag colours; reduced nodes (smallest, gray, unlabelled until hover); large nodes (20+ links) draw no edges; "Show tags network" only when a local graph's centre is a Tag. (M5 #14)
- [ ] Save as Query, the palette's paste and space actions, backlink modes, the backlinks side panel (drag to swap), graph PNG export, find and replace in raw mode. (M8 #35)

## Whiteboards (incl. Wacom)

- [ ] Wacom Tablet Properties → Mapping: "Use Windows Ink" is on. (M6 #1)
- [ ] Pen: a light stroke is thin, a heavy one thick, varying smoothly within a stroke. (M6 #2)
- [ ] A fast scribble has no gaps or corners. (M6 #3)
- [ ] The Highlighter is flat and translucent. (M6 #4)
- [ ] The pen's eraser end erases the strokes it crosses, whatever tool is selected. (M6 #5)
- [ ] The barrel button never draws. (M6 #6)
- [ ] A mouse stroke draws with a simulated taper. (M6 #7)
- [ ] A palm resting on a touch screen while drawing adds nothing. (M6 #8)
- [ ] Each stroke undoes and redoes as one step. (M6 #9)
- [ ] The ink is still there after closing and reopening the app. (M6 #10)
- [ ] `Whiteboards/<title>.ink.svg` opened in Edge or Chrome shows the same strokes. (M6 #11)
- [ ] Note any lag between pen and line. (M6 #12)
- [ ] Pen tilt changes the stroke as expected; ink tilt and partial erase behave sensibly (our choice). (M8 #27, M8 #29)
- [ ] Ink colours and widths (our choice). (M6 #49)
- [ ] A new board is at most three files, side by side in `Whiteboards/`. (M6 #14)
- [ ] Move one shape: the `.whiteboard.json` diff is only that node's `position` lines (the `.md` may also gain a `lastUpdated` bump since M9). (M6 #15)
- [ ] Delete a board and restore it from the Trash: all three files come back; rename a board: all three follow. (M6 #16)
- [ ] Edit a board's `.whiteboard.json` in VS Code while it is open: it reloads ("Changed elsewhere. Reloaded."). (M6 #17)
- [ ] Two windows editing different nodes of one board both keep their changes. (M6 #18)
- [ ] Draw on a board: its "Last updated" moves, at most once a minute; the board's Notes still save. (M9 #17)
- [ ] Create a board from "+ New". (M6 #19)
- [ ] Whiteboard is offered in "+ New" before the space has the type. (M6 #52)
- [ ] Every tool. (M6 #20)
- [ ] Every shape and gate, with Engineering mode on. (M6 #21)
- [ ] 9 of the 12 shapes are in the picker (our choice). (M6 #44)
- [ ] Text editing and alignment. (M6 #22)
- [ ] A placed text block opens for typing at once. (M6 #50)
- [ ] Objects dragged from Pinned and from the search palette, and one picked with "Existing object", each open in the peek on double-click. (M6 #23)
- [ ] Dragging a search result onto the board closes the palette. (M6 #51)
- [ ] Connectors in all styles, with labels. (M6 #24)
- [ ] Frames: wrap, title, drag with contents. (M6 #25)
- [ ] Frames drag their contents (our choice). (M6 #43)
- [ ] Align, order, flip, duplicate, delete. (M6 #26)
- [ ] Lock. (M6 #27)
- [ ] Every Canvas display switch. (M6 #28)
- [ ] The zoom menu and the zoom keys. (M6 #29)
- [ ] Undo and redo across nodes and ink. (M6 #30)
- [ ] An object embedded on a board lists the board in its references, and a word in a board text block finds the board in Ctrl+K. (M6 #31)
- [ ] Whiteboard keys: V, H, T, L, Shift+L, R, O, P, F, ] and [, Ctrl+] and Ctrl+[, Ctrl+G, Ctrl+Arrow resize, nudge 1 px (30 px with Shift or snap); pen D, highlighter Shift+D, eraser E are ours. (M6 #42)
- [ ] The camera is per viewer (our choice). (M6 #46)
- [ ] "Clear Whiteboard" also clears the ink (our choice). (M6 #47)
- [ ] Change type is refused for boards (our choice). (M6 #48)
- [ ] The Task 7, 9, 10, 11 and 12 choices and strings listed under "Items the lane tasks left for Gene" in `m6-acceptance.md`. (M6 #53)
- [ ] M8 whiteboard features: media tools and web link, connector-drop quick-create, the View menu, keyboard resize and lock, copy and paste between boards, PNG export, the inspector (Outline, Frames, Stats), Play and Notes, ink select, move and partial erase. (M8 #37)
- [ ] Look, against the behaviour catalog: the toolbox position and contents. (M6 #32)
- [ ] Look: the zoom control. (M6 #33)
- [ ] Look: the selection toolbar. (M6 #34)
- [ ] Look: node rings and handles. (M6 #35)
- [ ] Look: the dotted grid. (M6 #36)
- [ ] Look: connectors, including the 3 px width and our tip drawings. (M6 #37)
- [ ] Look: frames. (M6 #38)
- [ ] Look: gates (only labelled rectangles here). (M6 #39)
- [ ] Look: the entity node's caption and card. (M6 #40)
- [ ] On `Network map`, the first "zoom to fit" against the title overlay: the title and "Frame 1" label shouldn't overlap the board text. (M6 #41)

## Settings, themes & look side by side

Look checks: compare side by side with the original app you're modelling, in Light, Light Dimmed, Dark and Dark Dimmed where the source says "dark and light".

- [ ] **(new 2026-11-03)** The root font is 15.5px, so the whole app is about 3 % smaller: it reads right next to the original.
- [ ] Focus mode and its timer, Present, and the Language, Date & Time (time zone, decimal separator), Editor and Space settings. (M8 #39)
- [ ] The focus presets (our choice). (M8 #16)
- [ ] "Recalculate content index" runs, and the indexing state shows. (M9 #16)
- [ ] The Settings modal, every section. (M7 #55)
- [ ] The app shell, sidebar (section headings, "+ New" and search, footer) and the peek with its pager and property panel. (M1 #9, M7 #34, M7 #39)
- [ ] The tab strip, the tab menu and pinned tabs. (M7 #12, M7 #35)
- [ ] Breadcrumbs: position and look. (M7 #11, M7 #36)
- [ ] The side panel's area layout; a Standard page keeps properties in the side column and puts them inline below 768 px (settled 2026-10-28). (M7 #10, M7 #37)
- [ ] The object page in each layout (standard, profile, index card, encyclopedia). (M2 #20, M7 #38)
- [ ] The `…` menus. (M7 #40)
- [ ] The editor: every block kind, the slash menu, handles, the block menu, block selection. (M7 #41)
- [ ] Object Type Settings and the property menus (add property, kind change, number format, label options). (M2 #18, M2 #19, M7 #49)
- [ ] The type page (Overview and All, every layout incl. gallery), the toolbar pill, the filter, sort and group-by popovers, collections and their pages, queries and the Queries page, the sidebar's Pinned, custom sections and Queries entry. (M3 #13, M7 #42, M7 #43, M7 #45, M7 #46)
- [ ] Card settings. (M7 #44)
- [ ] All notes. (M7 #47)
- [ ] Trash. (M7 #48)
- [ ] The Calendar: Day, Three days, Week (stacked days), Month (daily-note card list), the mini month, the pager and segmented control, the calendar sidebar. (M4 #15, M4 #16, M4 #17, M4 #18, M4 #20, M7 #50)
- [ ] The Tasks page (list and kanban). (M4 #19, M7 #51)
- [ ] The command palette, search and find in page. (M7 #52)
- [ ] The references section and the graph. (M7 #53)
- [ ] Whiteboards and the pen. (M7 #54)
- [ ] The spaces menu and the create-space dialog. (M7 #56)
- [ ] Every M8 screen, in Light and Dark. (M8 #40)
- [ ] Every M9 screen, in Light and Dark. (M9 #19)
- [ ] Every rule under "Rules the build chose" in `m9-acceptance.md`, against the behaviour catalog. (M9 #18)

## Export/import

- [ ] Exporting and reading stats change nothing (`git status` clean). (M9 #1)
- [ ] Export a page as Markdown, then with "Include media": the zip opens, and images and attachments are inside (including `![[name.png]]` short-name embeds). (M9 #3)
- [ ] Import CSV into a type (with and without a header row, and into a new collection): the warning shows. (M9 #13)

## Windows-only

- [ ] A reminder set a minute ahead fires one Windows notification while the app is open, and none once the task is done. (M4 #8)
- [ ] A reminder set to a time already past stays silent, also across a restart. (M4 #9)
- [ ] Reminders: one banner per reminder, none after quitting the app, one catch-up after reopening within 12 hours. (M4 #22)
- [ ] In the pywebview window, the microphone prompt appears, and recording, pausing, stopping and playback work. (M8 #30)
- [ ] In the pywebview window, the clipboard read prompt appears for the palette's paste actions. (M8 #31)
- [ ] **(new 2026-11-03)** PDF export inside the pywebview window: it prints from a hidden frame (untried there) and produces the PDF.
- [ ] A type page with 1,000+ real objects stays responsive (filter edit under 200 ms in DevTools). (M3 #12)
- [ ] A calendar month with 5,000+ objects switches views without a visible stall. (M4 #14)
- [ ] On the 5,000-object copy (`backend/tests/bigspace.py`): global graph pan and zoom, and typing in the palette. (M5 #7)
- [ ] On the CPI copy, the graph pans, zooms and filters without stalls. (M5 #11)

## Dropped as obsolete

- (M6 #45) "Board edits don't bump `lastUpdated`": superseded by M9, which made a board save stamp the `.md`'s `lastUpdated`, at most once a minute (`m9-acceptance.md`, automated check 6). Checked instead by (M9 #17).
