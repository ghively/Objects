# Capacities behavior catalog

Everything observed by driving a live Capacities session (v1.72.7, Microsoft Edge, 1912x901, dark theme),
read-only except one scratch Page that was created and trashed. Source for fidelity work; not a copy of
Capacities' code. No note content or account data is recorded here. Pro-gated features are marked **(Pro)**.

Companion: `docs/superpowers/plans/polish-audit-2026-11-02.md` (what differed from Object and what was fixed).

## Coverage checklist

| Area | Status |
|---|---|
| Settings (all pages) | done (section 1) |
| Sidebar footer: Shortcuts panel (section 2), Add Section, type gallery | done (sections 2-3) |
| Sidebar rest, top bar, tabs, search, New menu | pending |
| Views: layouts, filter, sort, group, Overview | pending |
| Object page: header, properties, side panel, backlinks | pending |
| Editor: block menu, selection toolbar, embeds, tables | pending |
| Graph, Trash, Explore, shortcuts, export dialog | pending |

## 1. Settings

A two-pane modal: left nav with a "Search settings" field, right pane for the chosen page. Groups:
Account, General, Space, Integrations. Footer of the nav: "Built with love in Europe", version, Diagnostics,
Reload.

**Account**: Account; Password & Authentication (change password with "Logout on all other devices",
two-factor with backup codes, authenticator options, list of active sessions with a Logout each and a
"Current Session" marker); Subscription & Billing (plan cards: Capacities Pro, Capacities Believer).

**General**
- Appearance: Light theme (Light, Light Dimmed), Dark theme (Dark, Dark Dimmed), App icon (colored icon per
  device).
- AI Assistant **(Pro)**: "Hide AI features" switch.
- Editor: Disable spellcheck; Spellcheck language (Experimental); Always open as full page (Alt+Shift click
  opens the preview instead); Always create inline links; Show object type icon for inline object links;
  Disable automatic detection of numbered lists (so `1. ` at block start converts by default); Default
  display of nested backlinks (Only block with backlink | Full path above); Hide object type settings
  outside of settings; Hide outliner lines; Toggle style (Toggle | Bullet); Hide App Menu; When Capacities
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
- Capacities API **(Pro)**: scoped API tokens per space (name, masked token, space, last used, Delete) and
  "New API token"; Developer settings: "Show developer information" (IDs and developer details in the UI).
- Web Extension: Chrome, Edge, Safari, Firefox capture extension; Web Highlights **(Pro)**.
- Email: send to a Capacities address from a verified account; subject becomes the heading, `#tags` in the
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
- Bottom row: profile icon (menu: name, email, plan "Capacities Basic", Logout), settings gear, theme toggle,
  Shortcuts icon.
- The calendar's Tasks rows (Pro): circle checkbox, title, status chip with a dropdown (Next Up, Someday/Maybe,
  In Progress), a due-date chip (red when overdue, with a calendar icon), a priority pill (!, !!, !!!) and a
  `...` row menu. Section toolbar: "N open" count, layout picker, settings, snooze-style arrow, `+`.
