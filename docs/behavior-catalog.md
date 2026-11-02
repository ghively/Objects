# Object behavior catalog

Everything observed by driving a live Object session (v1.72.7, Microsoft Edge, 1912x901, dark theme),
read-only except one scratch Page that was created and trashed. Source for fidelity work; not a copy of
Object's code. No note content or account data is recorded here. Pro-gated features are marked **(Pro)**.

Companion: `docs/superpowers/plans/polish-audit-2026-11-02.md` (what differed from Object and what was fixed).

## Coverage checklist

| Area | Status |
|---|---|
| Settings (all pages) | done (section 1) |
| Sidebar footer: Shortcuts panel (section 2), Add Section, type gallery | done (sections 2-3) |
| Sidebar rest, top bar, search, New menu | done (sections 4, 8) |
| Calendar Month and Week views, backlinks, Export dialog | done (section 10) |
| Tab and sidebar context menus, Overview tab, collection page, outline | done (section 9) |
| Views: layouts, filter, sort, group, Overview | pending |
| Object page: header, properties, side panel | done (section 5); outline and stats in section 9; backlinks and unlinked mentions pending |
| Editor: block menu, selection toolbar, slash, @ | done (section 6); embeds, tables, columns, code, math pending |
| Graph, Trash, Explore panel, shortcuts | done (section 7); export and import dialogs pending |

## 1. Settings

A two-pane modal: left nav with a "Search settings" field, right pane for the chosen page. Groups:
Account, General, Space, Integrations. Footer of the nav: "Built with love in Europe", version, Diagnostics,
Reload.

**Account**: Account; Password & Authentication (change password with "Logout on all other devices",
two-factor with backup codes, authenticator options, list of active sessions with a Logout each and a
"Current Session" marker); Subscription & Billing (plan cards: Object Pro, Object Believer).

**General**
- Appearance: Light theme (Light, Light Dimmed), Dark theme (Dark, Dark Dimmed), App icon (colored icon per
  device).
- AI Assistant **(Pro)**: "Hide AI features" switch.
- Editor: Disable spellcheck; Spellcheck language (Experimental); Always open as full page (Alt+Shift click
  opens the preview instead); Always create inline links; Show object type icon for inline object links;
  Disable automatic detection of numbered lists (so `1. ` at block start converts by default); Default
  display of nested backlinks (Only block with backlink | Full path above); Hide object type settings
  outside of settings; Hide outliner lines; Toggle style (Toggle | Bullet); Hide App Menu; When Object
  starts (Space on this device: Last opened space | Specific space; When this space opens, per space and per
  device: Where I left off | Calendar | Calendar today | Specific object); Highlight Style (Default with a
  rail and notes section | Minimal); Default state for backlink sections (Backlinks Open | Closed; Unlinked
  Mentions **(Pro)** Open | Closed | Hidden); Backlink content view (Embed default).
- Language: interface language list (English, English UK, Deutsch, Francais, Espanol, Dutch, Portugues BR,
  Magyar, Italian); Decimal separator (Automatic | Dot | Comma).
- Date & Time: Time zone (list); Date formatting with a live preview (Localized | ISO 8601; date order
  Automatic | day-month-year | month/day/year); Time format (24 hours | 12 hours); Start of the week
  (Monday | Sunday).
- Offline & Sync: sync status ("All updates from other devices received", last update time); Offline
  (content downloaded state, Content / Calculations / Media content / Media content calculations per space);
  "Recalculate content index"; Local Storage (size estimate); Media loading (Everything | Required only);
  Clear media cache; Cloud Media Storage (uploaded total, plan limit).
- Import Content: migration guides (Notion, Obsidian, Evernote, Apple Notes, Tana, Other tool); Bulk import
  "Start importing" (upload files, review mappings).
- Full Export: Automated Full Exports (desktop app only); Manual Full Export with Spaces (All Spaces) and
  options Include media, Links as wikilinks (`[[title]]`), Include title as heading 1; "Export All Spaces".

**Space**
- Space Settings: Icon, Name, Description, Delete space.
- Object Types: "Custom object types" and "Basic object types" tile grids plus Create; per type: Icon, Name,
  Plural, Color, Description, Properties (Add Property), Templates (New Template), Configuration (see the
  audit doc item 27), Delete Object Type. Basic types' properties cannot be edited. Field lists per built-in
  type are in audit item 28.
- Task management **(Pro)**: "Hide Task Management" per space.

**Integrations**
- Calendar Integrations **(Pro)**; Task actions **(Pro)**.
- Object API **(Pro)**: scoped API tokens per space (name, masked token, space, last used, Delete) and
  "New API token"; Developer settings: "Show developer information" (IDs and developer details in the UI).
- Web Extension: Chrome, Edge, Safari, Firefox capture extension; Web Highlights **(Pro)**.
- Email: send to a Object address from a verified account; subject becomes the heading, `#tags` in the
  subject become tags; per-account "Default space"; Add email account; Remove.
- Telegram and WhatsApp: connect via link or QR code; messages, photos, links and voice notes land in the
  daily note; `#` tags in captions.
- Readwise **(Pro)** one-way sync; Kindle **(Pro)** import-only; Raycast.

## 2. Keyboard shortcuts (the "Shortcuts" panel, share icon at the sidebar's bottom right)

Opened from the arrow icon next to the theme toggle; a scrolling list grouped General, Text editing,
Markdown, Block editing, Page, Navigation, Calendar, AI Assistant, Table, Date picker, PDF viewer, Weblink.
Ctrl means Cmd on Mac. "Shift" is written as Shift here.

**General**: Open settings Ctrl+, | Create new task **(Pro)** Ctrl+Shift+T | Add new content Ctrl+U | Search
this space Ctrl+P or Ctrl+K | Open extended search **(Pro)** Ctrl+Shift+P | Toggle dark mode Ctrl+Shift+L |
Toggle focus mode **(Pro)** Ctrl+Shift+M | Toggle left sidebar Ctrl+Shift+Left | Toggle right side panel
Ctrl+Shift+Right | Toggle side panel entry list Ctrl+Shift+Down | Toggle media sidebar Ctrl+Alt+Right | Close
current tab Ctrl+W | Toggle tab menu when several tabs are open Ctrl+Shift+Up | Undo Ctrl+Z | Redo Ctrl+Shift+Z
or Ctrl+Y | Go to Calendar Ctrl+Alt+H (press twice to jump to today) | Open Explore Ctrl+J | Open Explore in the
side panel Ctrl+Shift+J | Multi-select blocks and objects Ctrl+Shift+Click | Show/hide shortcuts Ctrl+Shift+B |
Show/hide the getting-started checklist Ctrl+Shift+A.

**Text editing**: Cut, copy, paste Ctrl+X/C/V | Paste as plain text Ctrl+Shift+V | Turn block into task object
(unbound) | Format as code Ctrl+E | Format as TeX formula Ctrl+M | Insert/format as link Ctrl+K | Bold Ctrl+B |
Italic Ctrl+I | Strikethrough Ctrl+Shift+S | Underline (unbound) | Highlight Ctrl+Shift+H | Move active block up or
down Alt+Up/Down | Move on the same level Alt+Shift+Up/Down | Check/uncheck to-do Ctrl+Enter | Open/close toggle
Ctrl+Up/Down (inserts and focuses a child block if none) | Set active block as block selection Esc or Ctrl+A |
Insert block below Alt+Enter, above Alt+Shift+Enter | Run default task action; open task actions menu.

**Markdown shortcuts** (at the start of a block, combinable, Space only after the last one; `>#Space` makes a
heading 1 with a toggle): Quote `|` Space | Toggle `>` Space | Bullet `*` or `-` Space | Numbered `1.` Space |
Alphabetical `a)` Space | Roman `i)` Space | To-do `[]` Space | Icon `()` Space | Horizontal line `---` |
Heading 1-4 `#` to `####` Space.

**Block editing** (with a block selection): cut, copy, copy as markdown Ctrl+Shift+C, paste, paste as plain text |
Indent Tab, unindent Shift+Tab | Open block styling Ctrl+Shift+E, remove styles Ctrl+Shift+X, copy styles
Ctrl+Shift+C, paste styles | Duplicate Ctrl+D | Delete Backspace | Turn into object `I` | Group/ungroup Ctrl+G |
Increase/decrease text hierarchy Ctrl+Plus/Minus | Copy block reference Ctrl+Alt+L | Add to selection
Ctrl+Click | Select above/below Up/Down, expand Shift+Up/Down | Select all on this level (then the next higher)
Ctrl+A | Extend to clicked block Shift+Click | Move selected blocks Alt+Up/Down (same level: Shift+Alt+Up/Down) |
Check/uncheck to-dos Ctrl+Enter | Open/close all toggles in the view Ctrl+O | Open toggles Right, close Left |
Code block: leave downwards or upwards (Ctrl+Shift+Down/Up) | Math block likewise | Merge text blocks
Ctrl+Shift+G.

**Page**: Add/remove from favorites Ctrl+Shift+* | Import menu, Export menu (Ctrl+E), Share menu Ctrl+S |
Start presentation Ctrl+Alt+P; previous/next slide; exit Esc | Find in page Ctrl+F | Select all top-level blocks |
Copy deep link | Delete current page Ctrl+Backspace | Focus the last block (Down) | Scroll to top Home, bottom End,
page up/down.

**Navigation**: Back Ctrl+Left or Ctrl+[ | Forward Ctrl+Right or Ctrl+] | Open in new tab Ctrl+Click | Open in
side panel (Shift+Click) | Open in preview Alt+Shift+Click | Navigate tabs Ctrl+Tab | "Open Minigame" Ctrl+Shift+Y.

**Calendar**: Month M | Week W | 3 days rolling R | Day D | Today T | Previous/next day, week or month
Left/Right | Toggle calendar sidebar Ctrl+Alt+S.

**AI Assistant** **(Pro)**: open; copy message Ctrl+Alt+C; replace context; append message Ctrl+Alt+A; append to daily
note; retry Ctrl+Alt+R; close chat Ctrl+Alt+X; rephrase Ctrl+Alt+U.

**Table**: expand selection in four directions (Shift+arrows) | fill selected cells Ctrl+resize | insert
rows below / columns after | delete rows/columns Ctrl+Shift+Backspace-style | move row/column Alt+arrows |
select all cells | enter cell editing | clear cells | toggle identifier reference mode F4.

**Date picker**: toggle include time | toggle end date Ctrl+R | arrow keys move by day, week, month (Alt+Shift
for the end date), year | **PDF viewer**: search, capture snapshot Ctrl+Shift+D, zoom Ctrl+0, set/next/previous
page | **Weblink**: search.

## 3. "Add new object type" gallery (the `+` next to "Object Types")

A popover: "Add new object type", "Create your own", then template groups with a one-line description each.
- Meetings (Capture conversations with attendees and a date), People, Projects (status, collaborators, meetings).
- Research: Atomic notes, Definitions.
- Media: Books (authors, rating, genre), Films, TV series, Podcasts.
- Planning and reflection: Days (energy, mood, what stood out), Weeks, Months.
- Organizations, Areas (areas of responsibility).
Object's "new object type" flow has none of the starter templates; each would pre-fill properties.

## 4. Sidebar details seen so far

- Space switcher (top left): popover with a Search field, one row per space with its own icon, a check on the
  current one, a divider, "+ Create space".
- Object Types header: fold chevron, count, a `...` menu (Sort Manually with a check, Sort Alphabetically) and
  a `+` (the gallery above) on hover.
- "Add Section" opens a small form: "Group pages and collections under a named heading in your space
  overview." with an Icon picker, Section Name and Create.
- Bottom row: profile icon (menu: name, email, plan "Object Basic", Logout), settings gear, theme toggle,
  Shortcuts icon.
- The calendar's Tasks rows (Pro): circle checkbox, title, status chip with a dropdown (Next Up, Someday/Maybe,
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
  - Text, number, checkbox, label: not opened in this pass.
- **Tags** are objects of the Tag type with a color; the chip uses that color.

## 6. Editor chrome and menus

- **Selection toolbar** (appears above selected text): Bold, Italic, Strikethrough, Underline, bulleted list,
  numbered/to-do list, Link, Code, TeX formula, color/highlight, `+`, `@` mention, AI sparkle **(Pro)**.
- **Block handle**: hovering a block shows `+` (insert below) and a six-dot grip at its left. Clicking the grip
  selects the block and opens a menu: Hierarchy (current level, submenu), List >, To-do, Quote, Toggle, Group
  (Ctrl+G), AI assistant... **(Pro)**, Turn into..., Copy >, Duplicate (Ctrl+D), Remove (Backspace).
- **Block selection bar** (bottom of the page while blocks are selected): left "N block(s) . M words" with a
  stats dropdown; middle: Bold, Italic, Strikethrough, Underline, Hierarchy dropdown, list dropdown, toggle,
  quote, to-do, icon dropdown, color dropdown; right: "Turn blocks into" dropdown, "Tag" dropdown, "Move"
  dropdown, delete (red), AI **(Pro)**, close.
- **Inline code** renders as a purple monospace token with a tinted background; **tables** are bordered with a
  header row; a text block placeholder reads "Text"; the title placeholder "Title".
- **Slash menu**, **@ picker**, **markdown shortcuts**: see audit items 41-43 and section 2.
- **Object `...` menu**: see audit item 44. **Delete** asks for confirmation then moves to Trash (30 days).
- **While typing** the surrounding chrome (top bar, header buttons) fades until the pointer moves.

## 7. Graph, Trash, Explore, Help

- **Graph**: a force-directed canvas; one dot per object, colored by its type color, bigger when more linked;
  links drawn as thin lines. Top right: a count pill (objects shown), a document icon and a history icon.
  Bottom right: zoom out, a zoom dropdown (Page Fit, 5% ... 300%), zoom in, download (image), and a settings
  dropdown: Show tags network, Filter object types, Exclude object types, Show completed tasks, Hide objects
  with many links, Hide dates, Hide indirect links.
- **Trash**: a list of deleted objects, "Empty Trash", 30-day retention, and "object types and collections cannot
  be restored completely".
- **Explore** **(Pro)** as a side panel: tabs "Explore" with two cards (AI Chat, Search), "Relevant Content"
  (objects related to the page you are on) with "Find More". Toggled with Ctrl+Shift+Right; the tooltip reads
  "Hide sidepanel".
- **Help & Resources** (sidebar): First Steps, Ask a Question, Documentation, What's New, Feedback.
- **Theme toggle** in the sidebar footer switches dark and light immediately (it persists).

## 8. Search, New menu, view toolbar

- **Search palette**: see audit backlog item 2 (placeholder text, Today/Earlier groups, type at the right).
- **New menu**: popover with Search; types in recent-use order; Pro types badged; footer hints.
- **View toolbar** (type pages, `All` tab): count pill, Filter, Sort, Group by, a layout dropdown, Customize.
  - Layouts: List, Wall (cards), Kanban, Gallery, Table, Embed.
  - Filter popover: "where" row builder with "Filter" and "Filter group" buttons. Sort popover: "+ Sort".
    Group by: a "Group by" button. Customize: "Card view" and "Calculations".
  - Tab strip: Overview | All | custom tabs (a Query-backed one is Pro) | `+` to add a tab.
  - Type page header: type icon + plural name; search icon; `...` (New from Template >, New Collection, Pin to
    Sidebar, Object Type Settings, Export, Import); a split "New" button.
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
  type ("Projects"); the cards; a "+ New Object" row; a stepper through the type's collections ("1 / 3").
- **Outline popover** (hover the dash column at the right edge, in a peek or full page): tabs "Outline" and
  "Stats" and a pin button. Outline lists headings indented by level with an active marker on the left; click
  scrolls. Stats: Words, Sentences, Paragraphs, Characters, Created At, Last Updated.
- **Tab context menu** (right-click a type tab): Pin to Sidebar, Pin Tab, Object Type Settings, Import (Ctrl+I).
- **Sidebar type context menu**: Open >, Create <Type>, New from Template >, New Collection, Pin to Sidebar,
  Object Type Settings, Import.
- **Editor content seen in real notes**: a strikethrough run of text, an "Icon" block (a small icon chip in front
  of a paragraph, made with `()` Space), tables with a header row, tags row with colored chips, inline code.
- **Note**: opening an object and selecting text may touch its "Last Updated" (one object showed the current
  time after being opened; others untouched showed old dates).

## 10. Calendar views, backlinks, export, blocks

- **Month view**: header "Nov 2026" at the left, the view switcher (Month, Week, Three days, Day) centered,
  "< Today >" at the right; below, a strip Jan to Dec with the current month highlighted; then one card per
  existing daily note of that month (type label, title, Reviewed checkbox, Tags row, then the note's content:
  to-dos, bullets, code/time rows), and a "+ New Object" row. An empty month shows "No daily notes created for
  this month. You can change this by creating a new object." Clicking a month in the strip jumps there; the tab
  title becomes the month's first day.
- **Week view**: a single column of days. Each day: the weekday name colored by weekday (Sunday red, Monday amber
  with a red "Today" pill, Tuesday pink, Wednesday green, Thursday orange, Friday blue), the date as a large
  title, "Week 45", then the note or a "+ Daily Note" button. No month sidebar.
- **Backlinks** (bottom of an object, a "Backlinks" pill with a count and a collapse toggle): each backlink is an
  embedded reference, not a link list. A task shows as a task row (circle checkbox, title, status chip with a
  dropdown, date icon, priority pill) plus the line that links here ("Parent project: <object chip>"); other
  objects show the linking block with its parent context. A leading radio-dot marks each reference; hovering shows
  small action icons (expand, `...`, and three more at the right). Unlinked Mentions **(Pro)** is separate.
- **Inline tag**: a `#tag` typed in a paragraph renders as a colored chip in the text.
- **Export dialog** (object `...` > Export, Ctrl+E): a modal with format tiles PDF, Markdown, Microsoft Word,
  Latex. PDF: Style cards (Notes: matches the page's styling; Essay and Academic, both Pro + Experimental),
  Options (Include embedded content; Include outline; Hide empty properties, on by default; Show type labels),
  Format (A4 | Letter), Properties (All properties, with a per-property list), and an Export button.
  Markdown: "Export folder containing all subpages" (zip), Include media, Include title as heading 1, Links as
  wikilinks. Word and Latex tiles were not opened.
- **Table block** (slash > Table): a 2 column by 3 row empty table with a rounded border, header row styling,
  and cells that edit in place. Two Columns, Code, Math, Toggle, Group and Horizontal line could not be inserted
  reliably through the debugger (typing after a table failed), so their look is only known from real notes
  (code and math: see section 6; the shortcut sheet in section 2 lists their keyboard behavior).
- **Delete** of a page from the list or the peek `...` menu uses the same confirmation as before and the object
  goes to Trash.
