# Object behavior catalog

What Object does, or is meant to do: labels, menus, shortcuts, options and their order. This is the reference
for fidelity work; when a label, an order or a shortcut is in question, this file and the design spec
(`docs/superpowers/specs/2026-10-23-object-design.md`) settle it. Every feature is available; nothing is gated.
Items that would need an account or a cloud service are marked **(out of scope)** or
**(later)**, following the ground rules in `CLAUDE.md`.

Companion: `docs/superpowers/plans/polish-audit-2026-11-02.md` (where Object differed from this catalog and what
was fixed).

Labels aligned to the app on 2026-11-08 (PR #13's wording, Gene's decision): the quoted labels below are the words the screens show today.

## Coverage checklist

The list of what this catalog does not yet specify is in `docs/superpowers/plans/polish-audit-2026-11-02.md`
("Not yet poked").

| Area | Status |
|---|---|
| Settings (all pages) | specified (section 1) |
| Sidebar footer: Shortcuts panel (section 2), Add section, type gallery | specified (sections 2-3) |
| Sidebar rest, top bar, search, New menu | specified (sections 4, 8) |
| Calendar Month and Week views, backlinks, Export dialog | specified (section 10) |
| Unlinked mentions | specified (section 11) |
| Brain dump, Work agent | specified (section 10b) |
| Import: Source line, Files source, scan, proposal, trial, normalise, Import inbox | specified (section 10c); the exact strings live in the code |
| Tab and sidebar context menus, Overview tab, collection page, outline | specified (section 9) |
| Views: layouts, toolbar, Overview | specified (sections 8, 9); the inner screens of the filter, sort and group editors and Customize are not specified yet |
| Object page: header, properties, side panel | specified (section 5); outline and stats in section 9; backlinks in section 10; unlinked mentions in section 11 |
| Editor: block menu, selection toolbar, slash, @ | specified (section 6); the default table in section 10; the look of Two Columns, Code, Math, Toggle, Group and Horizontal line blocks is not specified yet |
| Graph, Trash, Explore panel, shortcuts | specified (section 7); export dialog in section 10 (PDF, Markdown; Word and LaTeX options not specified yet); the import dialog is described in section 10c |

## 1. Settings

A two-pane modal: left nav with a "Search settings" field, right pane for the chosen page. Groups:
Account, General, Space, Integrations. Footer of the nav: version, Diagnostics, Reload.

**Account** **(out of scope)**: account, password and authentication, active sessions, subscription and billing.
Object has no accounts.

**General**
- Appearance: Light theme (Light, Light Dimmed), Dark theme (Dark, Dark Dimmed), App icon (colored icon per
  device).
- AI Assistant: "Hide AI features" switch.
- Editor: Disable spellcheck; Spellcheck language (Experimental); Open objects as a full page (Alt+Shift click
  opens the preview instead); Insert links inline by default; Type icons on inline links;
  Turn off automatic numbered lists (so `1. ` at block start converts by default); How nested backlinks
  show at first (Just the linking block | Full path above); Keep type settings inside Settings only;
  Hide outliner lines; Toggle style (Toggle | Bullet); Hide App Menu; When Object
  starts (Space on this device: Last opened space | Specific space; When this space opens, per space and per
  device: Where I left off | Calendar | Calendar today | Specific object); Highlight Style (Default with a
  rail and notes section | Minimal); Backlink sections start as (Backlinks Open | Closed; Unlinked
  Mentions Open | Closed | Hidden); Backlink content view (Embed default).
- Language: interface language list (English, English (UK), Deutsch, Français, Español, Dutch, Português (BR),
  Magyar, Italian); Decimal separator (Automatic | Dot | Comma).
- Date & Time: Time zone (list); Date formatting with a live preview (Localized | ISO 8601 (year-month-day); date order
  Automatic | day-month-year | month/day/year); 24-hour time (a switch); Start of the week
  (Monday | Sunday).
- Offline & Sync: sync status and cloud media storage are **(out of scope)** (no sync). The local parts apply:
  "Rebuild search index"; Local Storage (size estimate); Media loading (Everything | Required only);
  Clear media cache.
- Import Content: migration guides per source tool (Notion, Obsidian, Evernote, Apple Notes, Tana, Other tool);
  Bulk import "Start importing" (upload files, review mappings).
- Full Export: Automated Full Exports (desktop app only); Manual Full Export with Spaces (All Spaces) and
  options Include media, Links as wikilinks (`[[title]]`), Add the title as a top heading; "Export All Spaces".

**Space**
- Space Settings: Icon, Name, Description, Delete space.
- Object Types: "Custom object types" and "Basic object types" tile grids plus Create; per type: Icon, Name,
  Plural, Color, Description, Properties (Add Property), Templates (New Template), Configuration (see the
  audit doc item 27), Delete object type. Basic types' properties cannot be edited. Field lists per built-in
  type are in audit item 28.
- Task management: "Hide Task Management" per space.

**Integrations** **(later)**
- Calendar Integrations; Task actions.
- API: scoped API tokens per space (name, masked token, space, last used, Delete) and "New API token";
  Developer settings: "Show developer information" (IDs and developer details in the UI).
- Web Extension: Chrome, Edge, Safari, Firefox capture extension; Web Highlights.
- Email: send to a capture address from a verified account; subject becomes the heading, `#tags` in the
  subject become tags; per-account "Default space"; Add email account; Remove.
- Telegram and WhatsApp: connect via link or QR code; messages, photos, links and voice notes land in the
  daily note; `#` tags in captions.
- Readwise one-way sync; Kindle import-only; Raycast.

## 2. Keyboard shortcuts (the "Shortcuts" panel, share icon at the sidebar's bottom right)

Opened from the arrow icon next to the theme toggle; a scrolling list grouped General, Text editing,
Markdown, Block editing, Page, Navigation, Calendar, AI Assistant, Table, Date picker, PDF viewer, Weblink.
Ctrl means Cmd on Mac. "Shift" is written as Shift here.

**General**: Open settings Ctrl+, | Create new task Ctrl+Shift+T | Add new content Ctrl+U | Search
this space Ctrl+P or Ctrl+K | Open extended search Ctrl+Shift+P | Toggle dark mode Ctrl+Shift+L |
Toggle focus mode Ctrl+Shift+M | Toggle left sidebar Ctrl+Shift+Left | Toggle right side panel
Ctrl+Shift+Right | Toggle side panel entry list Ctrl+Shift+Down | Toggle media sidebar Ctrl+Alt+Right | Close
current tab Ctrl+W | Show or hide the list of open tabs Ctrl+Shift+Up | Undo Ctrl+Z | Redo Ctrl+Shift+Z
or Ctrl+Y | Go to Calendar Ctrl+Alt+H (press twice to jump to today) | Open Explore Ctrl+J | Open Explore in the
side panel Ctrl+Shift+J | Multi-select blocks and objects Ctrl+Shift+Click | Show or hide the shortcuts list Ctrl+Shift+B |
Show/hide the getting-started checklist Ctrl+Shift+A.

**Text editing**: Cut, copy, paste Ctrl+X/C/V | Paste as plain text Ctrl+Shift+V | Make this block a task
Ctrl+Shift+T | Format as code Ctrl+E | Format as TeX formula Ctrl+M | Insert/format as link Ctrl+K | Format bold Ctrl+B |
Italicize Ctrl+I | Strikethrough Ctrl+Shift+S | Underline (unbound) | Highlight the selected text Ctrl+Shift+H | Move active block up or
down Alt+Up/Down | Move this block up or down among its siblings Alt+Shift+Up/Down | Tick or untick the to-do in this block Ctrl+Enter | Expand or collapse the toggle in this block
Ctrl+Up/Down (inserts and focuses a child block if none) | Select this block as a whole Esc or Ctrl+A |
New block below, with the cursor in it Alt+Enter, above Alt+Shift+Enter | Run default task action; open task actions menu.

**Markdown shortcuts** (at the start of a block, combinable, Space only after the last one; `>#Space` makes a
heading 1 with a toggle): Quote `|` Space | Toggle `>` Space | Bullet `*` or `-` Space | Numbered `1.` Space |
Alphabetical `a)` Space | Roman `i)` Space | To-do `[]` Space | Icon `()` Space | Horizontal line `---` |
Heading 1-4 `#` to `####` Space.

**Block editing** (with a block selection): cut, copy, copy the selected blocks as Markdown text Ctrl+Shift+C, paste, paste as plain text |
Indent selected blocks Tab, outdent the selected blocks Shift+Tab | Open block styling Ctrl+Shift+E, remove styles Ctrl+Shift+X, copy styles
Ctrl+Shift+C, paste styles | Make a copy of the selected blocks Ctrl+D | Delete selected blocks Backspace | Turn into object `I` | Group the selected blocks, or ungroup a selected group Ctrl+G |
Increase/decrease text hierarchy Ctrl+Plus/Minus | Copy block reference Ctrl+Alt+L | Add to selection
Ctrl+Click | Select above/below Up/Down, grow the block selection up/down Shift+Up/Down | Select the blocks at this level, then the level above
Ctrl+A | Extend to clicked block Shift+Click | Move selected blocks Alt+Up/Down (among their siblings: Shift+Alt+Up/Down) |
Tick or untick the to-do in this block Ctrl+Enter | Open or close all toggles on the page Ctrl+O | Open toggles Right, close Left |
Code block: leave downwards or upwards (Ctrl+Shift+Down/Up) | Math block likewise | Merge text blocks
Ctrl+Shift+G.

**Page**: Favorite or unfavorite this page Ctrl+Shift+* | Import, Export this page (Ctrl+E), Share menu Ctrl+S |
Start presentation mode Ctrl+Alt+P; back one slide / next presentation slide; exit presentation mode Esc | Find in page Ctrl+F | Select all top-level blocks |
Copy deep link | Delete current page Ctrl+Backspace | Focus the last block (Down) | Scroll to top Home, bottom End,
page up/down.

**Navigation**: Navigate back Ctrl+Left or Ctrl+[ | Navigate forward Ctrl+Right or Ctrl+] | Open in new tab Ctrl+Click | Open in
side panel (Shift+Click) | Open in preview Alt+Shift+Click | Navigate tabs Ctrl+Tab | "Open Minigame" Ctrl+Shift+Y.

**Calendar**: Go to monthly view M | Go to weekly view W | Show three days from today R | Go to daily view D | Jump to today T | Back / forward one day, week or month
Left/Right | Toggle calendar sidebar Ctrl+Alt+S.

**AI Assistant**: open; copy message Ctrl+Alt+C; replace context; append message Ctrl+Alt+A; send a message to the daily
note; retry Ctrl+Alt+R; close chat Ctrl+Alt+X; rephrase Ctrl+Alt+U.

**Work** (M23; on the Work page only, never while typing in a field or editor): Search work / |
Brain dump B | Go to Now, Flow, Projects map, Today, On the floor, Your queues, Agent queue, Stuck, Wins,
Alerts, Everything: G then N, W, P, T, O, Q, H, S, Y, L, E (within 1.5 s; in Just one thing only G then N) |
Next row J | Previous row K | Open Enter | Peek Space | Previous item [ | Next item ] | Close Esc (the work item
panel first, else the focus line and the search) | Shortcuts ?.

**Table**: expand selection in four directions (Shift+arrows) | fill selected cells Ctrl+resize | insert
rows below / columns after | delete rows/columns Ctrl+Shift+Backspace-style | move row/column Alt+arrows |
select all cells | enter cell editing | clear cells | toggle identifier reference mode F4.

**Date picker**: toggle include time | toggle end date Ctrl+R | arrow keys move by day, week, month (Alt+Shift
for the end date), year | **PDF viewer**: search, capture snapshot Ctrl+Shift+D, zoom Ctrl+0, set/next/previous
page | **Weblink**: search.

## 3. "Add new object type" gallery (the `+` next to "Object Types")

A popover: "Add new object type", "Create your own", then template groups with a one-line description each.
- Meetings (who attended, and when), People, Projects (status, collaborators, meetings).
- Research: Atomic notes, Definitions.
- Media: Books (authors, rating, genre), Films, TV series, Podcasts.
- Planning and reflection: Days (energy, mood, what stood out), Weeks, Months.
- Organizations, Areas (areas of responsibility).
Each starter template pre-fills the new type's properties.

## 4. Sidebar details

- Space switcher (top left): popover with a Search field, one row per space with its own icon, a check on the
  current one, a divider, "+ Create space".
- Main navigation, always visible at the top: Calendar, Tasks, Graph, Assistant (Gene's 2026-11-08 redesign;
  Calendar is the space's opening view). The Assistant is the built-in, always-on helper — a program
  feature, not an "agent" — shown with its own icon; a click opens its chat. "All notes" is gone from the
  sidebar — with many note types it was a dumping ground; the view stays reachable through queries and the
  palette.
- Agents (M17), a section of its own with the standard section header, directly below the main navigation;
  it lists only the user's own agents (the built-in Assistant is not in it), and the header's `+` menu —
  not a "+ New agent" row — is the way to add one.
- **Tasks dashboard** (Gene's redesign of M23's Work page): the sidebar's Tasks entry opens one page for
  every task — Gene's rationale: the dashboard was never about tickets; tickets are tasks carrying desk
  fields, so the task lists and the work dashboard are one domain and get one entry (there is no separate
  Work entry; the `tasks` and `work` targets both open it, tab title "Tasks"). Top to bottom: the Tasks
  header (icon, title, Search work, Create task); the brain-dump bar with Energy, Just one thing and the
  agent pill beside it; the focus rail (only when today has focus lines; Now's Focus card keeps Edit); the
  view row; the view. Views are grouped so the page opens calm on Now: **Drive** on one row (Now, Inbox,
  Today, Your queues, Agent queue, Captures), and **More views** folds **Plan** (Scheduled, Flow, Projects
  map, On the floor), **Manage** (Status, Open, Deadline, Recurring, Reminders, Context, Tags, All) and
  **Review** (Stuck, Wins, Alerts, Tickets, Everything, Completed); a folded view that is open stays on the
  row. The task sections are list views of the dashboard, each with the quick add on top (a new task gets
  the values the section's filter implies). **Today** is one view: the day timeline (meetings, focus lines,
  the now-line, deadline countdowns) with **Today's tasks** (overdue and due today, not done) under it; its
  badge counts today's tasks, Inbox's counts the inbox. While the space hides task management ("Hide Task
  Management"), the Tasks entry stays — the dashboard is the work dashboard too — and the dashboard leaves
  out the task lists (the list views and Today's tasks) instead; the work views and the timeline stay. On
  Today's timeline a block too short for its label and time (the 24-minute Morning brief) shows the two on
  one line under the track (the next row down when two would meet; the tooltip stays). The Task rows load
  once for the page. The old Tasks page (header and section tabs) is retired. Controls use the app's pill style
  (14px, `bg-hover-2` when on).
- Object Types header: fold chevron, count, a `...` menu (Sort manually with a check, Sort alphabetically) and
  a `+` (the gallery above) on hover.
- "Add section" opens a small form (a one-line explanation that a section is a named heading for pages
  and collections in the sidebar) with an Icon picker, Section Name and Create.
- Trash, on its own at the very bottom of the sidebar.
- Bottom row: settings gear, theme toggle, Shortcuts icon. (A profile menu with account and plan is
  **(out of scope)**.)
- The calendar's Tasks rows: circle checkbox, title, status chip with a dropdown (Next Up, Someday/Maybe,
  In Progress), a due-date chip (red when overdue, with a calendar icon), a priority pill (!, !!, !!!) and a
  `...` row menu. Section toolbar: "N open" count, layout picker, settings, snooze-style arrow, `+`.

## 5. Object page and peek

- **Peek** (click an object in a list): a modal over the page. Header buttons top right: a focus/AI sparkle
  toggle, `...` (the object menu, section 6), expand (open as full page). Top left: a toggle that shows the
  property pane. Bottom right: a stepper "N / total" with previous and next through the list you came from.
  Daily Notes add a Reviewed checkbox and a "Calendar" button (jump to that day).
- **Full page**: the same content, with the property pane docked on the left (Status, Time frame,
  Collaborators... one block per property, each "Empty" when unset) and the outline as a column of short
  dashes at the right edge (hover opens the outline popover). The browser tab title is the object title.
- **Header**, top to bottom: type pill (icon + name; click to change type), a relation button, then any
  property surfaced in the header (a Status chip such as "In Progress"), a "Collections" chip; the title in
  large bold; the Description property as a paragraph under the title; a "Tags" row of colored tag chips with a
  small list icon; a divider; the body.
- **Property value editors**:
  - Date: a chip; click opens a picker: an input with an info icon, presets (Yesterday, Today, Tomorrow, In 1
    week, In 2 weeks), month and year dropdowns, a month grid with the chosen day as a pill, toggles
    "Include Time" and "End Date", Remove, Cancel, Confirm. The chip has an `x` to clear and an expand icon.
  - Object property (for example Status or Category pointing at Tag): a dropdown arrow on the property header;
    click opens "Search or Create" with an expand-to-search button, then a list of the target objects as
    colored chips each with a checkbox (multi-select). Two tag objects with the same title are different
    objects with their own colors.
  - Text, number, checkbox, label: not specified yet.
- **Tags** are objects of the Tag type with a color; the chip uses that color.

## 6. Editor chrome and menus

- **Selection toolbar** (appears above selected text): Bold, Italic, Strikethrough, Underline, bulleted list,
  numbered/to-do list, Link, Code, TeX formula, color/highlight, `+`, `@` mention, AI sparkle.
- **Block handle**: hovering a block shows `+` (insert below) and a six-dot grip at its left. Clicking the grip
  selects the block and opens a menu: Hierarchy (current level, submenu), List >, To-do, Quote, Toggle, Group
  (Ctrl+G), AI assistant..., Turn into..., Copy >, Duplicate (Ctrl+D), Remove (Backspace).
- **Block selection bar** (bottom of the page while blocks are selected): left "N block(s) . M words" with a
  stats dropdown; middle: Bold, Italic, Strikethrough, Underline, Hierarchy dropdown, list dropdown, toggle,
  quote, to-do, icon dropdown, color dropdown; right: "Turn blocks into" dropdown, "Tag" dropdown, "Move"
  dropdown, delete (red), AI, close.
- **Inline code** renders as a purple monospace token with a tinted background; **tables** are bordered with a
  header row; the empty body's placeholder reads "Start writing, or type / for blocks..."; the title placeholder "Untitled".
- **Slash menu**, **@ picker**, **markdown shortcuts**: see audit items 41-43 and section 2.
- **Object `...` menu**: see audit item 44. **Delete** asks for confirmation then moves to Trash (30 days).
- **While typing** the surrounding chrome (top bar, header buttons) fades until the pointer moves.

## 7. Graph, Trash, Explore, Help

- **Graph**: a force-directed canvas; one dot per object, colored by its type color, bigger when more linked;
  links drawn as thin lines. Top right: a count pill (objects shown), a document icon and a history icon.
  Bottom right: zoom out, a zoom dropdown (Page Fit, 5% ... 300%), zoom in, download (image), and a settings
  dropdown: Show tags network, Filter object types, Exclude object types, Show completed tasks, Hide heavily
  linked objects, Hide dates, Hide indirect links, Show simplified graph (Object's own, last).
- **Trash**: a list of deleted objects, "Empty Trash", 30-day retention, and "object types and collections cannot
  be restored completely".
- **Explore** as a side panel: tabs "Explore" with two cards (AI Chat, Search), "Relevant Content"
  (objects related to the page you are on) with "Find More". Toggled with Ctrl+Shift+Right; the tooltip reads
  "Hide sidepanel".
- **Help & Resources** (sidebar): First Steps, Ask a Question, Documentation, What's New, Feedback.
- **Theme toggle** in the sidebar footer switches dark and light immediately (it persists).

## 8. Search, New menu, view toolbar

- **Search palette**: see audit backlog item 2 (placeholder text, Today/Earlier groups, type at the right).
- **New menu**: popover with Search; types in recent-use order; footer hints.
- **View toolbar** (type pages, `All` tab): count pill, Filter, Sort, Group by, a layout dropdown, Customize.
  - Layouts: List, Wall (cards), Kanban, Gallery, Table, Embed.
  - Filter popover: "where" row builder with "Filter" and "Filter group" buttons. Sort popover: "+ Sort".
    Group by: a "Group by" button. Customize: "Card view" and "Calculations".
  - Tab strip: Overview | All | custom tabs (including Query-backed ones) | `+` to add a tab.
  - Type page header: type icon + plural name; search icon; `...` (New collection, Pin to sidebar, Pin to…,
    Object type settings, Import CSV, Save as query, Delete object type; "New from template" is in the sidebar's
    type menu); a split "New" button.
- **Wall cards** show: the type label, the icon and title, the description, then one row per card-view property
  with its icon and value or "Empty" (Collaborators, Time frame, Status on Projects).

## 9. Overview tab, collections, outline, context menus

- **Overview tab** (type pages): sections stacked vertically. "Recently Opened": a horizontally scrolling row
  of cards with an expand icon at the right (opens the All tab); "Collections": a tile per collection (name and
  "N entries") with a "+ Collection" button at the right. A gear at the right of the tab strip opens "Visible
  Sections" (All, Recently Opened, Collections; the last two marked "Overview only") and "Hidden Sections":
  smart sections "Not in any collection", "Not tagged", "No backlinks", and one per collection. Any can be
  moved into view. The "Not in any collection / Not tagged / No backlinks" sections are cleanup tools.
- **Collection page**: opens in a peek: collection icon + name, the full view toolbar (count, Filter, Sort,
  Group, layout, Customize), search, `...`, a split New button, expand; under the header a chip of the parent
  type ("Projects"); the cards; a "+ New object" row; a stepper through the type's collections ("1 / 3").
- **Outline popover** (hover the dash column at the right edge, in a peek or full page): tabs "Outline" and
  "Stats" and a pin button. Outline lists headings indented by level with an active marker on the left; click
  scrolls. Stats: Words, Sentences, Paragraphs, Characters, Created At, Last Updated.
- **Tab context menu** (right-click a type tab): Pin to sidebar, Pin tab, Object type settings, Import (Ctrl+I).
- **Sidebar type context menu**: Open >, Create <Type>, New from template >, New collection, Pin to sidebar,
  Object type settings, Import.
- **Editor content in real notes**: a strikethrough run of text, an "Icon" block (a small icon chip in front
  of a paragraph, made with `()` Space), tables with a header row, tags row with colored chips, inline code.
- **Note**: opening an object and selecting text must not change its "Last Updated"; only a real edit does.

## 10. Calendar views, backlinks, export, blocks

- **Month view**: header "Nov 2026" at the left, the view switcher (Month, Week, Three days, Day) centered,
  "< Today >" at the right; below, a strip Jan to Dec with the current month highlighted; then one card per
  existing daily note of that month (type label, title, Reviewed checkbox, Tags row, then the note's content:
  to-dos, bullets, code/time rows), and a "+ New object" row. An empty month shows a short
  empty-state line saying the month has no daily notes yet. Clicking a month in the strip jumps there; the tab
  title becomes the month's first day.
- **Week view**: a single column of days. Each day: the weekday name colored by weekday (Sunday red, Monday amber
  with a red "Today" pill, Tuesday pink, Wednesday green, Thursday orange, Friday blue), the date as a large
  title, "Week 45", then the note or a "+ Daily Note" button. No month sidebar.
- **Backlinks** (bottom of an object, a "Backlinks" pill with a count and a collapse toggle): each backlink is an
  embedded reference, not a link list. A task shows as a task row (circle checkbox, title, status chip with a
  dropdown, date icon, priority pill) plus the line that links here ("Parent project: <object chip>"); other
  objects show the linking block with its parent context. A leading radio-dot marks each reference; hovering shows
  small action icons (expand, `...`, and three more at the right). Unlinked Mentions is a separate section
  (section 11).
- **Inline tag**: a `#tag` typed in a paragraph renders as a colored chip in the text.
- **Export dialog** (object `...` > Export, Ctrl+E): a modal with format tiles PDF, Markdown, Microsoft Word,
  Latex. PDF: Style cards (Notes: matches the page's styling; Essay and Academic, both Experimental),
  Options (Include embeds; Include outline; Hide empty properties, on by default; Show type labels),
  Format (A4 | Letter), Properties (All properties, with a per-property list), and an Export button.
  Markdown: "Include subpages (as a folder)" (zip), Include media, Add the title as a top heading, Links as
  wikilinks. The Word and Latex options are not specified yet.
- **Table block** (slash > Table): a 2 column by 3 row empty table with a rounded border, header row styling,
  and cells that edit in place. The look of Two Columns, Code, Math, Toggle, Group and Horizontal line blocks is
  not specified beyond section 6 (code and math) and the shortcut sheet in section 2 (keyboard behavior).
- **Delete** of a page from the list or the peek `...` menu uses the same confirmation as before and the object
  goes to Trash.

## 10b. Brain dump and the Work agent (M24)

- **Brain-dump bar** (Work page, key B): Enter saves a **Capture** object at once (type "Capture", Status New
  | Filed | Needs you; properties Text, Captured at, From view, Linked item, Filed to, Question). `Question about
  <item>: ...` and `Break down <item> step <n>: ...` link that item (title, Ticket ID, `[[link]]`, path) and
  queue a question or a break-down; anything else is filed as typed. The capture is never deleted by filing.
- **Captures** view (Work switcher, icon lightbulb, no key; count = New + Needs you): filters All, New, Needs you,
  Filed; a row shows Captured, From, Filed to, Linked item and, for Needs you, the question with **Reply to the
  agent** + **Send**; **Mark filed**; empty text "Nothing waiting to be filed.".
- **Agent acts on my approvals** (switch; Agent queue and Settings > Work): off = approvals, answers, notes and
  requests only wait in the Agent queue; on = Object runs due entries one at a time. **Agent runs by itself**
  (Settings > Work): an Agent step that becomes current runs once, read-only.
- **Settings > Work**: **Create the Work agent** (shell warning; offers to copy your `change-reviewer`),
  **Read tools** (mark a server's read-only tools; no more than 500), **Set up Desk sync** (an off schedule at
  07:00 every weekday that updates ticket fields only; never writes to Jira or ServiceNow).
- **Queue entry states**: pending, running, done, failed (reason + **Retry**), withdrawn. A failed run says why
  ("The run didn't finish within 30 minutes.", "The agent finished without marking the step done.", "Object closed
  during this run.") or asks Gene one question (a Question step is inserted before the step).

## 10c. Import and migration (M15 and M25-M27)

The catalog has no import dialog (only the Import menu entries in sections 4 and 9), so everything here is Object's
own; the strings live in `frontend/src/import/text.ts`, `import/scan/text.ts` and `import/agent/text.ts`.

- **Import dialog** ("Import from another app"): **Zip file or folder** path; **Exported from** Detect automatically
  | Notion | Obsidian | Anytype | Files (a folder, with an optional `_manifest.jsonl`); **Preview** writes nothing.
  Steps in order: source, **Check for sensitive content** (scan), **Review mappings** (types, properties, options),
  progress with **Stop import**, finish. **Import into**: A new space | This space; the review step also offers
  **Keep originals as** Attachments (default) | File objects, and **Try on a copy of this space** (imports into a copy
  named "<space> (trial)" next to the open space; on by default for a first run into this space).
- **Source line** (object page, under the properties; hidden when the object was not imported): **Source**
  "Imported from <system> (author, modified <date>, version <v>)", **Open original** (the web url, else the kept
  file) and **Show file** (shows the kept original in the file manager). Every imported object carries the system
  frontmatter block `importSource` (system, url, id, version, author, created, modified, original, contentHash, batch,
  importedAt).
- **Queryable import fields**: filters, sorts and columns offer **Imported from**, **Import batch** and **Source modified**
  (the last is a text filter on the ISO date).
- **Files source**: every non-Markdown file is one page (text and images where they appeared) with the untouched
  original kept in `Attachments/Originals/` (over 100 MB: not copied, listed in the report). A file that cannot be
  read becomes an "Original only" page. Sheets over 200 rows or 20 columns are not shown ("see the original").
- **Check for sensitive content** (local, nothing sent anywhere; findings never show the matched text): **Leave out**
  (one folder or pattern per line; left-out files are never read), then **Flagged files** with a kind (Private key, API
  key or token, Password assignment, Connection string, Card number) and line; each defaults to **Import, excluded from AI**
  and can be switched to **Leave out**.
- **Re-runs**: the same source updates its objects in place (the old text goes to version history), reuses identical
  attachments and never overwrites Gene's edits. Finish step and Import report: counts that add up (source items =
  imported + updated + unchanged + changed in both + left out + failed), **Changed in both** (**Take source** /
  **Keep mine**, and **Take source for all** / **Keep mine for all**), **Removed at source** (listed, never trashed).
  **Move batch to Trash** moves the objects the batch created (not the ones it only updated) to the Trash.
- **Proposed schema** (finish step offers **Review proposed schema**): each group is **Use existing type**, **Extend
  existing type** or **Create type**, with document counts, examples, "N% have a value" fill rates, options and merges;
  **Accept**, **Edit** (Name, Plural name, Keep <property>) or **Turn down**; **Apply** stays disabled until every
  item is decided and creates only what was accepted. A new type needs 10 documents; a property needs 30% of its
  group. Only the app applies a proposal; no MCP tool can.
- **Trial on the first 50 objects**: **Start trial**; each result shows a confidence (High, Medium, Low), the value
  and its **Quote**, and **Right** / **Wrong** marks with an accuracy line ("N of M marked right (P%)"); a value that
  failed the app's check says **Did not pass the check**. **Continue with the rest** starts the bulk pass (40 objects
  per agent turn). Flagged files are not in the trial.
- **Normalise tags and options**: near-duplicate tags and option values (for example Prod / prod / Production) with
  **Merge into** and **Merge N groups**; "Nothing looks like a duplicate." when there are none.
- **Import inbox**: low-confidence pages land in a collection named "Import inbox"; the last step says
  "N objects in the Import inbox for you to look at." with **Open Import inbox**.
- **MCP**: `import_scan`, `import_proposal`, `import_report` (read) and `save_import_proposal`, `save_import_decisions`
  (write), the prompt `migrate_a_source` and the resource `object://skills/migrate-a-source` let an outside agent run the
  same workflow; `start_import` refuses a mapping that creates types outside an approved proposal (for the open space or a trial copy; a brand-new space is not checked).

## 11. Unlinked mentions

An "Unlinked Mentions" section sits under Backlinks on an object's page; it lists text elsewhere that matches
this object's title or an alias without being a link ("Unlinked name matches", section label "Mentions"; an
alias counts as a mention of the original object). Settings > Editor > "Backlink sections start as"
has Backlinks Open | Closed and Unlinked Mentions Open | Closed | Hidden.

Object builds it in full (M5): `backend/objectapp/references.py` (matching on Unicode word
boundaries, titles and aliases of at least a minimum length, longest name first, linking a mention from the
list), `frontend/src/references/` and the Editor settings. **Gene wants this kept**; it is a ground rule in
`CLAUDE.md`.
