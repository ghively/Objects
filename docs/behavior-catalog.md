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
| Agents: run tools and the fence | specified in part (section 10d) |
| Import: Source line, Files source, scan, proposal, trial, normalise, Import inbox, Keep pages as Sources, Entities | specified (section 10c); the exact strings live in the code |
| Tab and sidebar context menus, Overview tab, collection page, outline | specified (section 9) |
| Drag and drop | specified (section 9b) |
| Views: layouts, toolbar, filter, sort and group editors, Customize view, Queries page, Overview | specified (sections 8, 9) |
| Object page: header, properties, side panel | specified (section 5); outline and stats in section 9; backlinks in section 10; unlinked mentions in section 11 |
| Editor: block menu, selection toolbar, slash, @, markdown list shortcuts | specified (section 6); the default table, Two Columns, Code, Math, Toggle, Group and Horizontal line blocks, and media blocks in section 10 |
| PDF, Weblink, image and file objects | specified (section 10) |
| Version control and backup (git) | specified (section 12) |
| Graph, Trash, Explore panel, shortcuts | specified (section 7); export dialog (PDF, Markdown, Word, LaTeX) in section 10; the import dialog is described in section 10c |
| Synced facts, the suggested type and name patterns | beyond the catalog, Object's own (section 10f, M29) |

## 1. Settings

A two-pane modal: left nav with a "Search settings" field, right pane for the chosen page. Groups:
Account, General, Space, Integrations. Footer of the nav: version, Reload (Object has no Diagnostics row).
Device settings changed elsewhere (another window, the API) load into an open window without a reload (a
`settings` change event), and an open agent's Tools tab reads its groups again when an outside server is turned
on or off or a secret is set.

**Account** **(out of scope)**: account, password and authentication, active sessions, subscription and billing.
Object has no accounts.

**General**
- Appearance: Light theme (Light, Light Dimmed), Dark theme (Dark, Dark Dimmed), App icon (colored icon per
  device). Layout (ours, 2026-11-09): "Show the sidebar when Object opens" (on by default; off opens Object with
  the left sidebar collapsed, "Toggle sidebar" or Ctrl+Shift+Left shows it; device setting `showSidebarOnStart`).
  App icon (M31): a row of swatches (Default, Red, Orange, Green, Blue, Purple, Pink, Gray; device setting
  `appIcon`), each showing the bolt in its colour; the choice recolours the browser tab's icon at once and the
  app window's from the next start (the window takes an icon only when it opens).
- AI Assistant: "Hide AI features" switch.
- Editor: Disable spellcheck; Spellcheck language (Experimental); Open objects as a full page (Alt+Shift click
  opens the preview instead); Show properties by default (ours, 2026-11-09; on by default; off: objects open with
  the properties panel hidden, and the properties button shows it for that object by saving `hideProperties:
  false`, hiding again removes the key); Insert links inline by default; Type icons on inline links;
  Turn off automatic numbered lists (so `1. ` at block start converts by default); How nested backlinks
  show at first (Just the linking block | Full path above); Keep type settings inside Settings only;
  Hide outliner lines; Toggle style (Toggle | Bullet); Hide App Menu; When Object
  starts (Space on this device: Last opened space | Specific space; When this space opens, per space and per
  device: Where I left off | Calendar | Calendar today | Specific object); Highlight Style (Default with a
  rail and notes section | Minimal); Backlink sections start as (Backlinks Open | Closed; Unlinked
  Mentions Open | Closed | Hidden); Backlink content view (Embed default).
  (M31) "Hide App Menu" (a switch after "Hide outliner lines"; device setting `hideAppMenu`, off by default): Object's
  window has no menu bar, so its app menu is the top bar's space menu (spaces, Space settings, Space history, Create
  space, Open folder…). On, that button is hidden (the sidebar toggle stays); a lone Alt tap shows it, focused, and
  another hides it, as a hidden window menu comes back with Alt (our call). The palette and Ctrl+, reach its spaces
  and settings too.
- Language: interface language list (English, English (UK), Deutsch, Français, Español, Dutch, Português (BR),
  Magyar, Italian); Decimal separator (Automatic | Dot | Comma). Gene, 2026-11-10: the interface stays in English;
  the list sets date and number formatting only (translating every screen is not planned).
- Date & Time: Time zone (list); Date formatting with a live preview (Localized | ISO 8601 (year-month-day); date order
  Automatic | day-month-year | month/day/year); 24-hour time (a switch); Start of the week
  (Monday | Sunday).
- Offline & Sync: sync status and cloud media storage are **(out of scope)** (no sync). The local parts apply:
  "Rebuild search index"; Local Storage (size estimate); Media loading (Everything | Required only);
  Clear media cache.
  Local rows (M31): "Local Storage" lists the space folder, its cache (`.object-cache`) and Object's data for the
  space in the state folder (saved versions and the per-space files), and the total (`GET /api/storage`, read
  only). "Media loading" (device setting `mediaLoading`): "Required only" shows images, video, audio and PDF
  as a placeholder with "Load" until clicked, wherever they show: blocks in pages, cover images (and the
  profile picture and a presentation's title slide), card and gallery pictures (the Page link view card
  too), image property cells and whiteboard media; small pictures get a compact "Load" in the picture's box
  (our call); the image picker shows its thumbnails, as opening it asks for them (our call). "Everything" loads
  them at once. "Clear media cache" asks first ("Clear the media cache?"), then removes only the cache's media
  parts (`media/`, `thumbnails/`; Object keeps no media copies of its own, so normally nothing) and has every
  space image and file load again from the files, past the browser's cache (a token on every file URL); it
  says what it freed. Notes and files are never touched.
- Import Content: migration guides per source tool (Notion, Obsidian, Evernote, Apple Notes, Tana, Other tool);
  Bulk import "Start importing" (upload files, review mappings).
  "Remodel this space…" (M31, IT ops design section 6; our strings): the import dialog opens with the open space's
  folder as the source and "A new space" as the only target (named "<space> (remodelled)"); the space is only read,
  never changed. A folder with `.object/space.json` read as a source skips `.object/`, `.object-cache/` and
  `Templates/`, takes each object's type from its `type` (typeSource key; plural names from the space's types; Page
  stays Page), its dates from `createdAt`/`lastUpdated`, leaves out `id`, `template` and `importSource`, and notes
  "This folder is an Object space: its objects keep their types, and the space is only read, never changed."
- Full Export: Automated Full Exports (desktop app only); Manual Full Export with Spaces (All Spaces) and
  options Include media, Links as wikilinks (`[[title]]`), Add the title as a top heading; "Export All Spaces".
  Built (M31; `fullexport.py`, `api_fullexport.py`, `settings/sections/FullExport.tsx`, after Import Content): Spaces
  (This space | All Spaces), the three options, a Folder (a full path outside every space), "Export" and "Export All
  Spaces" run in the background with "Exporting… n of m files" and "Exported n objects and m media files to <folder>";
  Automated Full Exports (a switch, How often Daily | Weekly, Last export, Next export, and why a run is skipped: the
  folder unset, missing or inside a space) use the same spaces, options and folder, checked every minute from server
  start, last run kept in the state dir (`full-export.json`), never two exports at once. Each run writes a new folder
  `Object export <space> <YYYY-MM-DD HHMM>` (`All Spaces` for every space) holding one folder per space, each object at
  its own path with the single-object Markdown export's bytes; with Include media every attachment, referenced file and
  whiteboard sidecar. Our calls: `.object/`, caches, the trash and templates are left out; objects excluded from AI are
  exported; nothing is written in any space; the catalog's "(desktop app only)" doesn't apply (Object always runs here).

**Space**
- Space Settings: Icon, Name, Description, Delete space.
- Object Types: "Custom object types" and "Basic object types" tile grids plus Create; per type: Icon, Name,
  Plural, Color, Description, Properties (Add Property), Templates (New Template), Configuration (see the
  audit doc item 27), Delete object type. Basic types' properties cannot be edited, except that the basic Task type
  takes the sub-items and dependencies pairs (Parent item / Sub-items, Blocked by / Blocking; a table or
  timeline view's Customize › Sub-items and dependencies; decision AC-1). Field lists per built-in
  type are in audit item 28.
  - Add Property › **Table** (M31, after Files; ours: "A small table: a header row of column names, then rows of
    text."): stored as a Markdown table in a `|-` block (header row first; a hand-written YAML list of rows reads the
    same; only line 2 is the separator, and a cell of dashes is written `\-`, `|` as `\|` and `\` as `\\`, read back
    as typed). The panel edits cells, "Add row", "Add column", × on a row (never the header row) or a column; a table
    view or card shows "N rows" (column names on hover), and a table view's opens the table in a peek; the Page link
    view shows the table read-only. Property settings › "First column is a header" (ours; `headerColumn: true` in the
    property's options) shows each row's first cell as a header in the panel, the peek and the Page view; the stored
    table is the same. Its cells are searchable; a document export lists it as "a, b; c, d". "Change property type": Table to Text or Text block (one
    line, "a, b; c, d"); Text or Text block to Table (one cell under the property's name, or the table it holds).
  - "Card view and linking" › Default link view: Link block, Small card, Wide card, Embed, **Page** (M31, spec §3;
    `defaultViewType: page`; also in an object block's `…` › Change Block View, `view=page`). Ours: a full-width,
    read-only page preview: cover, type label, icon and title, the description, the properties the object's panel
    shows (hidden and empty "hide when empty" ones left out, "Empty" otherwise), then the body's first lines; a click
    or Enter opens the object.
- Task management: "Hide Task Management" per space.
- Automations (M14): in the rule editor, "Set a property" on a date needs a date or "Now" ticked; with neither it
  shows "Pick a date or tick Now." under the value and Save refuses with the same message (it would write the
  date empty, `completed: null`). A rule saved like that before keeps running unchanged; opening it shows the
  message.

**Integrations** **(later)**
- Calendar Integrations; Task actions.
- API: scoped API tokens per space (name, masked token, space, last used, Delete) and "New API token";
  Developer settings: "Show developer information" (IDs and developer details in the UI).
  Developer information (M31; device setting `showDeveloperInfo`, off by default): while on, a small read-only
  "Developer information" box with a copy button per value shows an object's id and file path under its
  properties, a type's id, folder and each property's key in type settings, a property's key and id in property
  settings, a query's id on its page, and a collection's id and the open view's key on its page. Views have no
  ids of their own (they live inside their type, collection or query).
  A token's scope is "Read only", "Read and write" or "Synced facts only" (Object's own, M29: reads, and fills synced
  properties; section 10f).
- Web Extension: Chrome, Edge, Safari, Firefox capture extension; Web Highlights.
- Email: send to a capture address from a verified account; subject becomes the heading, `#tags` in the
  subject become tags; per-account "Default space"; Add email account; Remove.
- Telegram and WhatsApp: connect via link or QR code; messages, photos, links and voice notes land in the
  daily note; `#` tags in captions.
- Readwise one-way sync; Kindle import-only; Raycast.

## 2. Keyboard shortcuts (the "Shortcuts" panel, share icon at the sidebar's bottom right)

Opened from the arrow icon next to the theme toggle; a scrolling list grouped General, Text editing,
Markdown, Block editing, Page, Navigation, Calendar, AI Assistant, Table, Date picker, PDF viewer, Weblink.
Ctrl means Cmd on Mac. "Shift" is written as Shift here. "(not in Object)" marks a catalogued key that Object leaves
unbound on purpose; "(not bound)" one whose key is taken by another action (decision D3).

**General**: Open settings Ctrl+, | Create new task Ctrl+Shift+T | Add new content Ctrl+U or Alt+Shift+N (M32) |
New note, or one more of the type in view Ctrl+N or Alt+N (M32: Alt+N is the key a browser tab lets through, where
Ctrl+N opens a browser window) | Search
this space Ctrl+P or Ctrl+K | Open extended search Ctrl+Shift+P (not in Object) | Toggle dark mode Ctrl+Shift+L |
Toggle focus mode Ctrl+Shift+M | Toggle left sidebar Ctrl+Shift+Left | Toggle right side panel
Ctrl+Shift+Right (in Object both panel keys stay out of text fields, where Ctrl+Shift+Left/Right select by word; our call) | Toggle side panel entry list Ctrl+Shift+Down (not in Object) | Toggle media sidebar Ctrl+Alt+Right (not in Object) | Close
current tab Ctrl+W | Show or hide the list of open tabs Ctrl+Shift+Up | Undo Ctrl+Z | Redo Ctrl+Shift+Z
or Ctrl+Y | Go to Calendar Ctrl+Alt+H (press twice to jump to today) | Open Explore Ctrl+J (not in Object) | Open Explore in the
side panel Ctrl+Shift+J (not in Object) | Multi-select blocks and objects Ctrl+Shift+Click | Show or hide the shortcuts list Ctrl+Shift+B |
Show/hide the getting-started checklist Ctrl+Shift+A (not in Object).

**Text editing**: Cut, copy, paste Ctrl+X/C/V | Paste as plain text Ctrl+Shift+V | Make this block a task
Ctrl+Shift+T | Format as code Ctrl+E | Format as TeX formula Ctrl+M | Insert/format as link Ctrl+K (not bound: Ctrl+K is Search this space, taken first; decision D3) | Format bold Ctrl+B |
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

**Page**: Favorite or unfavorite this page Ctrl+Shift+* | Import, Export this page (Ctrl+E), Share menu Ctrl+S (not in Object) |
Start presentation mode Ctrl+Alt+P; back one slide / next presentation slide; exit presentation mode Esc | Find in page Ctrl+F | Select all top-level blocks |
Copy deep link | Delete current page Ctrl+Backspace | Focus the last block (Down) | Scroll to top Home, bottom End,
page up/down.
(M31) Select all top-level blocks Ctrl+Alt+Shift+A and Copy deep link Ctrl+Alt+Shift+L (our keys; ⌃⇧⌘A / ⌃⇧⌘L on
macOS) work in the page or the open peek, caret in the editor included: the first selects every top-level block as a
block selection, the second copies the object's reference `[[Title]]` (as Copy > "Copy object reference"; Object has
no URL scheme, our call) and toasts "Deep link copied". Home, End, Page Up and Page Down ("Page up", "Page down") scroll
the page outside text fields.

**Navigation**: Navigate back Ctrl+Left or Ctrl+[ | Navigate forward Ctrl+Right or Ctrl+] | Open in new tab Ctrl+Click | Open in
side panel (Shift+Click; inline `[[links]]` too) | Open in preview Alt+Shift+Click | Navigate tabs Ctrl+Tab | "Open Minigame" Ctrl+Shift+Y (not in Object).

**Calendar**: Go to monthly view M | Go to weekly view W | Show the day before and after R (decision C9) | Go to daily view D | Jump to today T | Back / forward one day, week or month
Left/Right | Toggle calendar sidebar Ctrl+Alt+S | Pop out today's daily note Ctrl+Shift+D (ours, 2026-11-09).

**Keys that work while you type (M32)**: with the caret in a note's text or title, the new-note keys (Ctrl+N,
Alt+N), the New menu's (Ctrl+U, Alt+Shift+N) and today's note (Ctrl+Shift+D) all work; a note popped out in the
peek closes first, so what is made is seen. Each key was checked against the editors' own: none is bound in the
rich editor or the title; in raw mode Ctrl+U stays the editor's "undo selection" (our call: the menu has
Alt+Shift+N there); on macOS the second keys are Ctrl+N and Ctrl+Shift+N, which stay "next line" inside a text
field (⌘N works there). In other fields (a dialog's input, a quick-add box) the two "new" keys stay off.
Ctrl+Backspace stays "delete a word" in every field.

**AI Assistant**: open; copy message Ctrl+Alt+C; replace context; append message Ctrl+Alt+A; send a message to the daily
note; retry Ctrl+Alt+R; close chat Ctrl+Alt+X; rephrase Ctrl+Alt+U.

**Work** (M23; on the Work page only, never while typing in a field or editor): Search work / |
Brain dump B | Go to Now, Flow, Projects map, Today, On the floor, Your queues, Agent queue, Stuck, Wins,
Alerts, Everything, Inbox, Captures: G then N, W, P, T, O, Q, H, S, Y, L, E, I, C (I and C: decision D3; the other task
lists and Tickets have no key; G then I does nothing while task management is hidden; within 1.5 s; in Just one thing only G then N) |
Next row J | Previous row K | Open Enter | Peek Space | Previous item [ | Next item ] | Close Esc (the work item
panel first, else the focus line and the search) | Shortcuts ?.

**Table** (not in Object; decision D3: these groups stay unbound): expand selection in four directions (Shift+arrows) | fill selected cells Ctrl+resize | insert
rows below / columns after | delete rows/columns Ctrl+Shift+Backspace-style | move row/column Alt+arrows |
select all cells | enter cell editing | clear cells | toggle identifier reference mode F4.

**Date picker** (not in Object; the date picker binds only Enter): toggle include time | toggle end date Ctrl+R | arrow keys move by day, week, month (Alt+Shift
for the end date), year | **PDF viewer** (not in Object: no PDF viewer): search, capture snapshot Ctrl+Shift+D, zoom Ctrl+0, set/next/previous
page | **Weblink** (not in Object: no Weblink viewer): search.

## 3. "Add new object type" gallery (the `+` next to "Object Types")

A popover: "Add new object type", "Create your own", then template groups with a one-line description each.
- Meetings (who attended, and when), People, Projects (status, collaborators, meetings).
- Research: Atomic notes, Definitions.
- Media: Books (authors, rating, genre), Films, TV series, Podcasts.
- Planning and reflection: Weeks, Months (for weekly and monthly reviews; the Calendar's daily notes already cover
  each day, so the gallery offers no Day type; removed 2026-11-09).
- IT operations (Object's own, M28): Hosts, Software, Applications, Containers, Configurations, Locations,
  Networks, Vendors, Scripts, Commands, Runbooks, Prompts, Incidents — the IT ops starter's types that the groups
  above don't already offer (People, Meetings and Projects stay the entries above; Source isn't offered, imports
  make it). Each comes with its default template (the older entries add none) and one saved query; its relations
  point at the space's own types (Location's "Part of" at Location; Application's "Runs on" at Host once the space
  has one, any type before) and keep their named other side.
- Organizations, Areas (areas of responsibility).
Each starter template pre-fills the new type's properties.

## 4. Sidebar details

- **Today's note** (ours, 2026-11-09, Gene): the top bar's notebook button "Today's note", Home's button (M32), the
  palette's "Pop out today's daily note" and Ctrl+Shift+D open today's daily note in the peek, the floating panel
  over the page, creating the note first when today has none (the same call as "+ Daily Note"). The page underneath
  stays as it was; Escape closes the peek. (M32) It opens with the caret at the end of its text, so the next key
  typed lands in the note, and the key works with the caret in a note's text or title. It stays a peek while
  "Open notes as a full page" is on (an explicit pop-out).

- **Home (M32)**: a tab with no page (a new empty tab, the first open of a space with nothing to restore, the
  start choice "Home") shows Home; it replaces the old start text "Pick an object type / Choose a type in the
  sidebar to see its objects.", which is gone. Top to bottom: "New note" and "Today's note"; "Recent", the last 12
  notes edited, newest first (title, type, when edited; daily notes included; tasks, tags and templates left
  out; a click opens the note); "Tasks", the open overdue tasks and today's, each with the task checkbox, or
  the line "Nothing due today."; an empty space shows "Nothing here yet. Start a note, or open today." and the
  two buttons only. Opening Home writes no file. Its tab reads "Home". "When this space opens" › "Home" shows it
  in the active tab (our call: that tab starts over; a persistent or pinned tab keeps its page and an empty tab
  is used, a new one only when there is none); "Where I left off" with nothing to restore is Home. The tab strip's `+`
  ("Create new tab") and Ctrl+T open a new, empty tab, so they land on Home (our call, M32: they used to copy the
  page in view; Ctrl/Cmd+click still opens anything in a new tab).

- **A click opens a full page (M32)**: while "Open notes as a full page" is on (it starts on), a plain click on a
  note anywhere (a list, card or table row, a `[[link]]`, a tag or backlink chip, a graph node, the Calendar's
  timeline, a new card or daily note made from a view) opens it in the current tab, with the page it came from on
  the breadcrumb trail, and an open peek closes. The peek is still there when asked for: Alt+Shift+click, a menu's
  "Open in peek" or "Expand", today's note pop-out, the collection peek and its stepper; Ctrl/Cmd+click is still a
  new tab and Shift+click the side panel. With the setting off a plain click peeks, as before M32.

- Space switcher (top left): popover with a Search field, one row per space with its own icon, a check on the
  current one, a divider, "+ Create space".
- A space opened as a new or empty folder (`objectapp --space <folder>`: no `setup` in `space.json`, no basic
  types, no files) asks "Pick a starting point" once — the same three choices as "Create new space"
  (`POST /api/space/setup`): "Start with basic setup", "IT operations" ("Includes hosts, software, applications,
  runbooks and incidents."; Object's own, M28) and "Empty space". IT operations writes the 17 IT ops types (Host,
  Software, Application, Container, Configuration, Location, Network, Person, Vendor, Script, Command, Runbook,
  Prompt, Source, Project, Incident, Meeting; an Incident has one Resolved, its own date and time, which Desk sync
  fills, M31), a default template for each but Source, and 30 seed Tags; a type,
  template or Tag already there is kept as it is. Nothing is written before a pick; closing asks again next
  time. The pick is recorded as `space.json` `setup` (`basic`, `itops` or `blank`; Create space records it too).
- Main navigation, always visible at the top (M32): Notes, Calendar, Tasks, Work (only while the Work page is on
  for the space; directly under Tasks; it opens the `work` target), Graph, Assistant. Tasks is the active entry for
  the `tasks` target only, Work for `work` (a `work` target shown while Work is off reads as Tasks). The Assistant
  and the Agents section stay exactly where they were (M32 decision 1). The Assistant is the built-in, always-on helper — a program
  feature, not an "agent" — shown with its own icon; a click opens its chat. Like an agent row it carries a
  hover `…` menu (Open chat, Settings, Memory & skills — no Duplicate/Delete: it is built in), the way into
  its own page (Profile, Instructions, Memory, Skills, Learning, Chats…).
- **Notes** (M32; was "All notes", off the sidebar since 2026-11-08): the first main entry opens the all-notes
  view, heading "Notes", "Every note, by when it was last edited.": every note by last edit (`lastUpdated`, else
  the creation time), newest first, grouped Today / Yesterday / This week / Earlier (our call: "This week" is
  the five days before yesterday, so the list never empties on a Monday); daily notes are in, tasks, tags and
  templates are left out; a list row ends with when it was edited. A sort or grouping picked in the toolbar
  takes over while it is set; the layout is still saved to `ui.allNotesLayout`. The palette's "Open all notes"
  opens the same view.
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
  row. Wins (and its count) follows every object change once loaded, and Alerts follows a settings change (the
  monitoring folder), so neither needs a reload. The task sections are list views of the dashboard, each with the quick add on top (a new task gets
  the values the section's filter implies). **Today** is one view: the day timeline (meetings, focus lines,
  the now-line, deadline countdowns; it spans 07:00-17:30 at least and widens to the whole hour of any earlier or
  later meeting, so evening meetings are on it) with **Today's tasks** under it — the Calendar Day view's Tasks section for
  today (decision T1, one list in both places): tasks whose date covers today, whose deadline is today, and the
  open overdue ones under "Overdue (n)"; done ones stay, struck; "N open, M done" and the `+` menu (Create task,
  Move all open tasks to); "Open in Calendar" under it opens the Calendar's Day view on today. Today's badge
  counts that list's open tasks, Inbox's counts the inbox. While the space hides task management ("Hide Task
  Management"), the Tasks entry stays — the dashboard is the work dashboard too — and the dashboard leaves
  out the task lists (the list views and Today's tasks) instead; the work views and the timeline stay. On
  Today's timeline a block too short for its label and time (the 24-minute Morning brief) shows the two on
  one line under the track (the next row down when two would meet; the tooltip stays). The Task rows load
  once for the page. The old Tasks page (header and section tabs) is retired. Controls use the app's pill style
  (14px, `bg-hover-2` when on).
- Types header (M32; was "Object Types"): fold chevron, count, a `...` menu "Types options" (Sort manually with a
  check, Sort alphabetically) and a `+` "New type" (the gallery above; was "Create object type") on hover. The
  list's rows read the type's plural as the screen shows it: the built-in Page is "Notes", the built-in
  DailyNote "Daily notes" (a renamed type keeps the user's name), and sort by that name; the "Queries" row reads
  "Saved searches". A type row's menu: "Create <Type>" ("Create Note"), "Type settings", "Delete type".
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
  small list icon; a divider; the body. A freshly created object (the New menu, a type's `+`, Ctrl+U and the
  other create buttons) opens with its title focused and selected, in the peek and on the full page, so typing
  names it; "Add description" puts the caret in the description it reveals. Renaming an object (its title, a
  table's title cell, a whiteboard's name) rewrites the links to it in other objects and then says so with a short
  notice, "Updated links in 3 objects" ("1 object"); nothing is shown when no other object linked to it.
- **Whiteboard changed outside** (its `.whiteboard.json` edited in another program while the board is open): the
  board reloads and says "Changed elsewhere. Reloaded."; another view of the same board in this window (a page
  and a peek) follows silently.
- **Property value editors**:
  - Date: a chip; click opens a picker: an input with an info icon, presets (Yesterday, Today, Tomorrow, In 1
    week, In 2 weeks), month and year dropdowns, a month grid with the chosen day as a pill, toggles
    "Include Time" and "End Date", Remove, Cancel, Confirm. The chip has an `x` to clear and an expand icon.
  - Object property (for example Status or Category pointing at Tag): a dropdown arrow on the property header;
    click opens "Search or Create" with an expand-to-search button, then a list of the target objects as
    colored chips each with a checkbox (multi-select). Two tag objects with the same title are different
    objects with their own colors.
  - Text, number, checkbox, label: not specified yet.
- **Property name** (a property label's menu, and "Name" in Property settings): Enter or leaving the field commits
  the new name; Escape goes back only to the last committed name, so Enter then Escape keeps the new one (Escape
  in Property settings closes the dialog).
- **Tags** are objects of the Tag type with a color; the chip uses that color.
- **Counterpart rows** (Object's own, M28): a relation can name its other side ("Show on the other side as" in
  Property settings, placeholder "No other side"; a renamed side keeps its key, an emptied field removes it; not
  offered on basic types, and a relation that already syncs both ways shows "This relation already syncs both
  ways." instead). The target then shows a row of that name (a Host's "Runs" lists the Applications and Containers
  whose "Runs on" names it), after the type's own properties, with the same row chrome. It is computed from the
  links and never stored on the target: adding or removing an object in the row writes that object's own relation
  (a single-valued one is replaced), never the object you are on. Rows of one name from several types merge
  ("Documented in" from Scripts, Commands and Runbooks is one row). An empty row waits under the panel's
  "Hidden (n)" toggle. A relation open to any type (Command and Runbook "Covers") adds no row to every type: its
  row shows on an object only while it has a value. A property the target type stores under the same key wins.
  In views a counterpart filters, sorts and groups like a relation; its table column is read-only and a board
  grouped by it refuses drops.

## 6. Editor chrome and menus

- **Selection toolbar** (appears above selected text): Bold, Italic, Strikethrough, Underline, bulleted list,
  numbered/to-do list, Link, Code, TeX formula, color/highlight, `+`, `@` mention, AI sparkle.
- **Block handle**: hovering a block shows `+` (insert below; it opens the slash menu in the new block, and
  Escape with nothing typed closes it leaving the block empty — no stray `/`; a `/` typed by hand stays) and a
  six-dot grip at its left. Clicking the grip
  selects the block and opens a menu: Hierarchy (current level, submenu), List >, To-do, Quote, Toggle, Group
  (Ctrl+G), AI assistant..., Turn into..., Copy >, Duplicate (Ctrl+D), Remove (Backspace).
- **Block selection bar** (bottom of the page while blocks are selected): left "N block(s) . M words" with a
  stats dropdown; middle: Bold, Italic, Strikethrough, Underline, Hierarchy dropdown, list dropdown, toggle,
  quote, to-do, icon dropdown, color dropdown; right: "Turn blocks into" dropdown, "Tag" dropdown, "Move"
  dropdown, delete (red), AI, close.
- **Inline code** renders as a purple monospace token with a tinted background; **tables** are bordered with a
  header row; the empty body's placeholder reads "Start writing, or type / for blocks..."; the title placeholder "Untitled".
- **Slash menu**, **@ picker**: see audit items 41-43 and section 2.
- **Markdown list shortcuts** (decision C11; `editor/extensions/markdownShortcuts.ts`, `editor/document.ts`):
  - At a block's start, typed marks followed by Space convert: `|` quote, `>` toggle, `*` or `-` bullet, `1.`
    numbered, `a)` alphabetical, `i)` roman, `[]` to-do, `()` icon, `#`-`####` heading. `---` makes a horizontal
    line.
  - Marks combine, with Space only after the last (`>#` + Space = heading 1 in a toggle). They apply inside out:
    heading, icon, quote, list, toggle. Two marks of one kind (two lists, two headings) stay text.
  - A single bullet, number or heading mark is StarterKit's own rule. `> ` makes a toggle, not a quote; `[] ` makes
    a to-do list like the menus.
  - `()` always gives the same icon (Object keeps no last-used icon).
  - "Turn off automatic numbered lists" removes `1.` as a mark, alone and combined.
- **Object `...` menu**: see audit item 44. **Delete** asks for confirmation then moves to Trash (30 days).
- **While typing** the surrounding chrome (top bar, header buttons) fades until the pointer moves.
- **Edited lines are written in the editor's standard Markdown form**: the line of a block you edit is rewritten
  that way (`_b_` becomes `*b*`, `[X]` becomes `[x]`, a setext heading becomes ATX `#`, a bare URL becomes
  `[url](url)`, `\#` escapes appear); it renders the same, and only that line changes in the file — every untouched
  line keeps its bytes (Gene's decision D5).

## 7. Graph, Trash, Explore, Help

- **Graph**: a force-directed canvas; one dot per object, colored by its type color, bigger when more linked;
  links drawn as thin lines. Top right: a count pill (objects shown), a document icon and a history icon.
  Bottom right: zoom out, a zoom dropdown (Page Fit, 5% ... 300%), zoom in, download (image), and a settings
  dropdown: Show tags network, Filter object types, Exclude object types, Show completed tasks, Hide heavily
  linked objects, Hide dates, Hide indirect links, Show simplified graph (Object's own, last).
- **Graph controls** (M31; what the two icons do is our call): the count pill shows the objects shown after the
  filters ("N objects shown" on hover). The document icon, "Open as list", lists those objects by title; a pick peeks
  it with the list as the pager (Ctrl/Cmd+click opens a tab). The history icon, "Recently opened", lists the objects
  opened lately (newest first, up to 10) that the graph shows; a pick finds it on the graph. The zoom menu's steps are
  Page Fit, 5%, 10%, 25%, 50%, 75%, 100%, 150%, 200%, 300% (100% is the whole graph in view; Page Fit also centres
  it); zoom in and out go to the next step and the menu shows the zoom now, wheel zooms included. Download is "Export
  view as PNG"; the settings dropdown is Customize. The search field ("Find a note in this graph", Object's own)
  stays in the header. The local graph panel keeps its compact toolbar.
- **Edge labels** (Object's own, M28): a link made by a relation property is labelled with the relation's name
  ("Runs on"; a pair linked by relations both ways joins the names with " · "); a link from body text only has no
  label. Labels show only on the hovered node's edges, or on the local graph centre's while nothing is hovered,
  and "Show simplified graph" hides them with the node labels.
- **Trash**: a list of deleted objects, "Empty Trash", 30-day retention, and "object types and collections cannot
  be restored completely".
- **Explore** as a side panel: tabs "Explore" with two cards (AI Chat, Search), "Relevant Content"
  (objects related to the page you are on) with "Find More". Toggled with Ctrl+Shift+Right; the tooltip reads
  "Hide sidepanel".
- **Explore panel, as built** (M31): an empty side-panel entry (Ctrl+Shift+Right with nothing open, "New Sidepanel
  Tab") shows the tabs "Explore" (first) and "Relevant Content". Explore: the cards "AI Chat" (hidden with "Hide AI
  features") and "Search" (the Search page, in the entry), then Graph View and Backlinks as small buttons (Object's
  own: kept so neither is lost). Relevant Content: up to 20 objects related to the main view's object (the same
  list as the AI chat's), and "Find More" (the search palette); "Open a page to see content related to it." when the
  main view shows no object.
- **Help & Resources** (sidebar): First Steps, Ask a Question, Documentation, What's New, Feedback. Object's own
  section is local only: Keyboard shortcuts, Getting started, Markdown reference and **How-to guides** (Gene's
  decision D1). How-to guides opens a read-only list (People, Meetings, Projects, Books — one per basic-setup type —
  and The Tasks dashboard); a guide shows read-only with "All guides" to go back. The guides ship with the app and
  are never seeded into a space as objects (they would land in All notes and the counts).
- **Theme toggle** in the sidebar footer switches dark and light immediately (it persists).

## 8. Search, New menu, view toolbar

- **Search palette**: see audit backlog item 2 (placeholder text, Today/Earlier groups, type at the right). (M32)
  The placeholder reads "Find notes and commands, or paste"; the empty state "Recently opened notes appear
  here."; types read as the screen names them ("Note" for the built-in Page: the type at a row's right, "Create
  Note", "Only search for type "Note"", and typing "note" finds the type); the clipboard offers read "Create
  note" and "Make a new note from the clipboard". "Create new {type} with title "{q}"" makes a Note unless a type
  filter is set, the page in view has a type (a type's page, a collection, a saved search) or a name pattern
  matches: never one more of the type made last.
- **New** (M32, "New means a note"): the sidebar's "New" button makes a Note at once and opens it with the title
  focused (Ctrl/Cmd+click a new tab, Shift+click the side panel, as every create); a small arrow beside it,
  "Choose a type", opens the New menu. Home's "New note" does the same.
- **New menu** (the arrow beside "New", Ctrl+U): popover with Search ("Search types"; was "Search Object
  Types"); types by the name the screen shows, the suggested type first, marked "Suggested" (the page in view's
  type, else the type made last); footer hints.
- **View toolbar** (type pages, `All` tab): count pill, Filter, Sort, Group by, a layout dropdown, Customize.
  - Layouts (`views/model.ts`): List, Wall, Kanban, Gallery, Table, Embed, Calendar, Timeline, Chart, Gallery strip.
    Chart export (the Customize page): **Export PNG** renders the frame at 2x; **Export SVG** saves the chart's own
    SVG as vector shapes with its styles written on the shapes and the legend drawn below (fix pass 2026-11-09);
    the number chart, which draws no SVG, exports its rendered frame.
  - Filter popover: "where" row builder with "+ Filter" and "+ Filter group" buttons (below). Sort popover: "Add
    sort". Group by: a "Group by" button. Customize: "Customize view" (below).
  - Tab strip: Overview | All | custom tabs (including Query-backed ones) | `+` to add a tab.
  - Type page header: type icon + plural name; search icon; `...` (New collection, Pin to sidebar, Pin to…,
    Object type settings, Import CSV, Save as query, Delete object type; "New from template" is in the sidebar's
    type menu); a split "New" button.
- **Filter editor** (decision C1; `views/FilterEditor.tsx`, `views/filter.ts`):
  - Popover body: rows that start "where", then the group operator (a menu "and | or" on the second row, plain
    text on the rest), Property, Operator, value editor and a `…` menu (Turn into group, Remove; Remove only, one
    level down).
  - "+ Filter" and "+ Filter group"; a new group takes the opposite operator and two filters. A nested group is
    boxed and titled "Filter group", with `…` Ungroup and Remove and its own "+ Filter". Removing a group's last
    filter removes the group. Nesting goes two levels deep.
  - No filterable property: "No properties can be filtered here". A broken filter shows "Invalid — Will be ignored".
  - Operators by kind:
    - Text, URL, email, phone, ID: is empty, is not empty, includes, does not include, is, is not, starts with,
      ends with.
    - Number: = ≠ ≥ > ≤ <.
    - Checkbox: is selected, is not selected.
    - Label, relation, tags: is empty, is not empty, includes, does not include.
    - Object type: is, is not. Collections and backlinks: includes.
    - Date: is empty, is not empty, is, is before, is after, is on or before, is on or after. A date with an end
      adds the "start …" and "end …" forms. The Task date adds is recurring, is not recurring, has reminder, has no
      reminder.
    - Files, steps, floor items, blocks: is empty, is not empty.
  - Date values (`views/dates.ts`): overdue, today, yesterday, tomorrow, this week, this month, this year, one week
    ago, in one week, one month ago, in one month, Specific date. "This week" follows "Start of the week".
- **Sort editor** (decision C2; `views/SortEditor.tsx`, `views/sort.ts`): rows of Property and Order, a "Move to
  top" arrow on every row but the first, and an × to remove. "Add sort" adds the next unused property; with no
  sorts it reads "No sort". Dates: Oldest first, Newest first, is empty first, is empty last. Everything else:
  ascending, descending. Object type, steps and floor items can't be sorted.
- **Group editor** (decision C3; `views/GroupEditor.tsx`, `views/group.ts`):
  - "Group by": a property menu starting with "None", then "Group option" and "Sort groups by"; one level of
    grouping.
  - Options: status label default | By category; long text By Text | By Linked Objects; number By Exact Value |
    By Range (Min, Max, Group every); date By Hour | By Day | By Week | By Month | By Year | Relative | Scheduled.
  - Group order: label Order | Order inverse, others default; then ascending, descending, (relations: Created
    oldest first, Created newest first), smallest first, largest first, Manual.
  - Long text with paragraphs, files, steps, text lists and floor items can't be grouped.
- **Customize view** (decision C4; `views/CustomizeMenu.tsx`, `views/cards/CardCustomize.tsx`), a 16rem menu:
  - "Layout" (only when the toolbar is under 480 px).
  - The layout's own page: Table (one type only), Card view (Wall, Gallery, Gallery strip, Kanban), Calendar,
    Timeline, Chart.
  - "Sub-items and dependencies".
  - "Groups", "Calculations", and "Show details" / "Hide details".
  - "Groups": "Visible groups" and "Hidden groups" with an eye per row; "Show all groups", "Hide all groups";
    switches "Hide new groups" and "Hide empty groups". Ungrouped: "Group the view by a property first."
  - "Calculations": one row per calculation ("<Property>: <kind>", ×), and an add row with Property and
    Calculation. Kinds (`views/calc.ts`): Count all, Count values, Count unique values, Count empty, Count not
    empty, Percent empty, Percent not empty, Checked, Unchecked, Percent checked, Percent unchecked, Earliest
    date, Latest date, Date range, Sum, Average, Median, Min, Max, Range.
  - "Card view", per type: the type name with a gear (opens Object type settings) and a "Use default" switch.
    "Selected Properties" can be dragged to reorder and removed with ×; "Add Properties" lists the rest, or "All
    properties are already added". With "Use default" on, the list is read-only.
- **Queries page and a query** (decision C5; `queries/QueriesPage.tsx`, `QueryPage.tsx`, `QueryBuilder.tsx`,
  `runQuery.ts`):
  - Sidebar "Queries" (in the Object Types block) opens a list headed "Queries" with "New". Each row has Open, Pin
    to Sidebar, Delete. Empty: "No queries" / "Queries you save show up here."
  - "New" creates a draft and opens it. A query page has an icon, an editable name (Enter commits, Escape
    reverts) and `…`: Pin to Sidebar, Pin to object type / Unpin, Pin to dashboard / Unpin, Delete. "Edit query"
    / "Close editor" toggles the builder. Results are a data view.
  - A draft with no search term, tag or type: "Query isn’t ready" / "The draft is kept, but it lists nothing
    until it has a search term, a tag or an object type." No results: "No content found".
  - Builder: Types: All, or picked types (four shown), plus "Exclude object types" (excluding needs a search term
    or a tag first, and is ignored while particular types are picked). Collection: All | In any collection | In no
    collection. "Tags or backlinks": Any of | All of, plus "Leave out tags or backlinks". Search: up to five terms
    of two or more characters; Enter adds a term, and a result needs to match one. Mode: Auto | Title (below).
    Limit: 1, 3, 5, 10, 25, 50, No limit.
  - During a search, sorting and property filters are off: "Sorting and property filters are off during a search."
  - A query's automatic title: "Tasks, Pages tagged work …", or "All notes" with no types (`queries/autoTitle.ts`).
  - **A saved query over the API** (M31): `POST /api/v1/queries/{id}/run` and MCP's `run_saved_query` list what the
    query's page lists, in its order (`backend/objectapp/queryeval.py`, the server's port of `runQuery.ts`): every
    part above applies, a search pauses filters and sorts (`paused`), and a query that isn't ready lists nothing.
    Objects excluded from AI stay out. The ad-hoc `POST /api/v1/query` (MCP `query`) takes the same parts.
- **Query builder search mode**: Auto | Title. Auto looks for the words in titles, aliases, descriptions and text (a
  case-folded substring); Title looks in titles only. Exact and Semantic are hidden until real full-text search exists
  (Gene's decision Q-1: they matched exactly like Auto). A saved query that uses one still runs as Auto (the
  server keeps accepting both) and shows Auto; the next edit of its search saves it as Auto. The Search page's **Save as
  Query** saves Auto too, with or without **Text matches only** (that toggle filters the Search page only).
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
- **Collection peek, as built** (M31): a click on a collection tile in a type's Overview opens the peek (Ctrl or Cmd
  opens the page in a new tab); the sidebar, pins, a type tab's "Open" and links still open the page. The peek shows
  the collection's All view (its saved layout; the header's toolbar changes it as on the page) with the header icon,
  name, view toolbar, "Search title...", `...` (the page's menu, plus "Add existing"), New (split when the type has
  templates) and "Open as page" (expand: the tab page); the type chip opens the type's page. "+ New object" opens the
  new object in the object peek over the collection's. The peek closes when the main view goes elsewhere.
- **Outline popover** (hover the dash column at the right edge, in a peek or full page): tabs "Outline" and
  "Stats" and a pin button. Outline lists headings indented by level with an active marker on the left; click
  scrolls. Stats: Words, Sentences, Paragraphs, Characters, Created At, Last Updated.
- **Tab context menu** (right-click a type tab): Pin to sidebar, Pin tab, Object type settings, Import (Ctrl+I).
- **Sidebar type context menu**: Open >, Create <Type>, New from template >, New collection, Pin to sidebar,
  Object type settings, Import.
- **Editor content in real notes**: a strikethrough run of text, an "Icon" block (a small icon chip in front
  of a paragraph, made with `()` Space), tables with a header row, tags row with colored chips, inline code.
- **Note**: opening an object and selecting text must not change its "Last Updated"; only a real edit does.

## 9b. Drag and drop (decision C10)

Where it exists; tabs do not drag (`shell/TabStrip.tsx`).

- **Editor**: a block moves by its handle with its bytes intact (`editor/handles/dragMove.ts`). Columns dividers and
  media sizes drag and write on release. Files dropped in upload (section 10, media objects).
- **Sidebar**: sections reorder by drag (`shell/SidebarSections.tsx`). Pinned and custom-section items reorder; an
  object pin dragged onto a whiteboard adds it there (`shell/PinnedSection.tsx`). Types drag in manual sort.
- **Side panel**: an entry's title dragged onto the main view swaps them (`shell/SidePanelArea.tsx`). The divider
  drags between 10 % and 90 %; a double click resets it to 45 % (`nav/sidepanel.ts`).
- **Search palette**: a result row dragged onto a whiteboard adds that object; the palette closes as the drag starts
  (`palette/SearchView.tsx`).
- **Views**:
  - Kanban cards drag between columns and write the group value. A card that can't move gets "This card can't be
    moved here." and no drag starts.
  - Calendar-layout chips move by whole days and write one property; a range moves whole
    (`views/layouts/CalendarLayout.tsx`).
  - Timeline: the bar body moves both dates, an edge moves one, written on drop; "No date" tray items drag onto the
    axis (`views/layouts/TimelineLayout.tsx`).
  - Table columns resize, clamped live (`views/table/TableLayout.tsx`).
- **Lists that reorder by drag**: label options (on Task status, dragging to another section changes its category,
  `properties/LabelMenu.tsx`), text-list items, templates, Overview sections, card properties, automation actions
  (`automations/RuleEditor.tsx`) and Work steps (`work/StepList.tsx`).
- **Cover image**: "Drag to move the image" while repositioning (`object/CoverImage.tsx`).

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
- **Three days view** (decision C9; `calendar/ThreeDaysView.tsx`, `calendar/dates.ts`, `calendar/useCalendar.ts`):
  three equal columns, the anchor day with the day before and after (yesterday, today, tomorrow when anchored on
  today). Each is the small day header over the daily-note slot, and nothing else (Tasks, Created and Backlinks are
  Day-view sections). The pill (Reviewed, "Open as Page", `…`) shows on an existing note; a missing note shows "+
  Daily Note". Previous and next move one day; Up and Down move one week. The switcher tooltip and the R shortcut
  read "Show the day before and after".
- **Daily note from a template**: clicking or typing in an empty day's inline note creates the note (from the
  DailyNote default template, if any) and the typing goes into its own paragraph after the template content (or
  into the template's first empty paragraph) — never onto the end of the template's last heading.
- **Day view** on today: the header's right side has a "Tasks dashboard" link to Tasks › Today, which lists the
  same tasks as the Day view's Tasks section (decision T1); other days have no link.
- **Backlinks** (bottom of an object, a "Backlinks" pill with a count and a collapse toggle): each backlink is an
  embedded reference, not a link list. A task shows as a task row (circle checkbox, title, status chip with a
  dropdown, date icon, priority pill) plus the line that links here ("Parent project: <object chip>"); other
  objects show the linking block with its parent context. A leading radio-dot marks each reference; hovering shows
  small action icons (expand, `...`, and three more at the right). Unlinked Mentions is a separate section
  (section 11).
- **Backlinks stay live**: when another object gains or loses a link to the open one (Link on a mention, an
  outside edit adding `[[X]]`), the Properties panel's Backlinks chips and the Tasks dashboard's Context grouping
  update without a reload (a change to any other object re-reads them).
- **Inline tag**: a `#tag` typed in a paragraph renders as a colored chip in the text.
  (M31) The chip is a decoration: the file keeps the plain `#tag` text. A tag is `#` at the start or after a space,
  `(` or `,`, then letters, digits, `-`, `_` or `/` (the importer's reading); digits only (`#123`) is no tag, nor
  text in code, link text, a URL's `#anchor` or a heading's `# `. It reads paragraphs and headings anywhere. Its
  color is its Tag object's, else gray; a click opens the Tag object like a link (Ctrl: new tab, Shift: side panel),
  or with no Tag object a search for `#tag` in a new tab (our call; a click never creates a tag).
- **Export dialog** (object `...` > Export, Ctrl+E): a modal with format tiles PDF, Markdown, Microsoft Word,
  Latex; Markdown is selected on open. PDF: Style cards (Notes: matches the page's styling; Essay; Academic — all
  three available, none marked Experimental), Options (Include embeds; Include outline; Hide empty properties, on by
  default; Show type labels), Format (A4 | Letter), Properties (All properties, with a per-property list), and an
  Export button. Markdown: "Include subpages (as a folder)" (zip), Include media, Add the title as a top heading,
  Links as wikilinks.
- **Word and Latex export** (decision C8; `object/ExportDialog.tsx`, `backend/objectapp/exportdoc.py`):
  - Options: "Hide empty properties", "Show type labels" and the Properties list ("All properties" plus one per
    property). No Style or paper choice.
  - Both come from one reading of the body (headings, paragraphs, lists and to-dos, quotes, code, math, tables,
    horizontal lines, images, object embeds; block annotations dropped).
  - Word: paper is A4 with 2 cm margins; the title uses the Title style, the type the Subtitle style. To-dos show as
    ☐/☑. Code and math are Consolas "Code" paragraphs (math as its TeX source). Tables have a bold first row. Images
    keep only their alt text, in italics. Embeds show a bold blue title, then the embedded blocks. Web and mail links
    become real hyperlinks; wikilinks are blue text.
  - Latex: an `article` with `amssymb`, `ulem` and `hyperref`; unnumbered headings (`\section*` …). Lists map to
    `itemize` / `enumerate`; to-dos to `[$\square$]` / `[$\boxtimes$]`. Code in `verbatim`, math in `\[ … \]`,
    tables in a ruled `tabular` with a bold first row. Images become a `% image: <src>` comment plus their alt text.
- **Table block** (slash > Table): a 2 column by 3 row empty table with a rounded border, header row styling,
  and cells that edit in place.
- **Blocks** (decision C7):
  - **Two Columns** (`editor/nodes/columns.ts`, `editor/layout/ColumnsView.tsx`, `editor/layout/Divider.tsx`): slash
    "Two Columns" inserts 2 even columns (`<!-- columns widths=… -->`). Dividers drag in whole percent, each column at
    least 10, and write `widths` on release. Hover shows "Column layout" (Columns | Grid: Grid wraps responsively,
    without dividers), "Add column" and "Remove column", for 1 to 6 columns; widths are spread evenly again.
  - **Code** (`editor/nodes/codeBlock.ts`, `editor/code/CodeBlockView.tsx`): the bar shows on hover or focus: "Select
    language", "Wrap lines", "Lock editing" (text read-only until unlocked; moving or deleting the block still
    works), "Copy to clipboard", "Download as file". Markdown and Mermaid blocks add Edit | Edit & Display | Display
    (default Display). Highlighting is a decoration only; the bytes never change. Slash "Mermaid Diagram" shows only
    while searching.
  - **Math** (`editor/nodes/mathBlock.ts`, `editor/math/MathBlockView.tsx`): `$$…$$` rendered with KaTeX, one row per
    blank-line-separated part. A click opens the TeX source with a live preview and "Close". Enter inserts a
    paragraph (above at the very start, else below); Shift+Enter is a line break; Escape closes and selects the block.
  - **Toggle** (`editor/nodes/toggle.ts`): `<!-- toggle open -->…<!-- /toggle -->`; the first child is the toggle's
    line. A caret rotates when open and dims with no children; an outliner line runs along the children unless "Hide
    outliner lines" is on. With Toggle style Bullet, the caret shows as a bullet until hovered. A click writes `open`
    to the file.
  - **Group** (`editor/nodes/group.ts`, `editor/layout/GroupView.tsx`): `<!-- group color=… -->`; a rounded box,
    neutral fill by default, with `color` and `align`. Placeholder "Box heading..." on an empty first line. Hover
    shows "Ungroup". Ctrl+G groups or ungroups the selected blocks.
  - **Horizontal line** (`editor/slash/slashItems.ts`): slash "Horizontal line" inserts it below the block (in place
    of an empty block); `---` at a block start does the same.
- **PDF, Weblink, image and file objects** (decision C6; `backend/objectapp/typemodel.py`,
  `editor/media/MediaView.tsx`):
  - There is no separate PDF or Weblink viewer: an object of a media type is a page whose body holds the media
    block.
  - The media types (Weblink, File, Image, PDF, Audio, Video, Tweet) are basic types with fixed, read-only system
    fields: Weblink: URL, domain, iframe URL, preview image. Tweet: URL, source. File, PDF, Audio: MIME type, file
    size, source. Image and Video add width and height.
  - Editable extras with built-in option sets: PDF: Number of Pages, Table of Contents, Document type, Topic. Image:
    Category, Colors. Weblink: Category, Topic. Audio: Duration, Origin, Category.
  - A Weblink's preview image is the card image when it is a space file (`views/cards/SmallCard.tsx`).
  - Import makes every image a Page row would take an Image object (section 10c). With "Keep originals as File
    objects" picked, each other original becomes a File, PDF, Audio or Video object of the basic media type (made when
    the space has none); otherwise originals go to `Attachments/Originals/` (`importers/writer.py`).
  - Media blocks: Image: resizable, alignable, caption. PDF: an iframe, 600 px tall by default, with a bottom drag
    handle. Audio: controls and caption. Video: resizable, alignable, caption. File: a card with icon, name, size,
    "Open … on system" and "Download …". Missing file: "File not found." Every media block's `…` menu has "Remove
    Block".
  - Web link block: a card with title, domain and URL that opens in the system browser. Nothing is fetched
    (`editor/nodes/bookmark.ts`).
  - Resizing writes once, on release. Align left, center or right; "Add caption" / "Remove caption", placeholder
    "Caption..." (`editor/media/ResizableEmbed.tsx`).
  - Files dropped or pasted into the editor upload to `Attachments/` (never overwriting, 100 MiB limit checked first)
    and insert a media block at the drop point (`editor/extensions/fileDrop.ts`, `editor/media/upload.ts`).
- **Delete** of a page from the list or the peek `...` menu uses the same confirmation as before and the object
  goes to Trash.

## 10b. Brain dump and the Work agent (M24)

- **Brain-dump bar** (Work page, key B): Enter saves a **Capture** object at once (type "Capture", Status New
  | Filed | Needs you; properties Text, Captured at, From view, Linked item, Filed to, Question). `Question about
  <item>: ...` and `Break down <item> step <n>: ...` link that item (title, Ticket ID, `[[link]]`, path) and
  queue a question or a break-down; anything else is filed as typed. The capture is never deleted by filing.
- **Captures** view (Work switcher, icon lightbulb, no key; count = New + Needs you): filters All, New, Needs you,
  Filed; a row shows Captured, From, Filed to, Linked item and, for Needs you, the question with **Reply to the
  agent** + **Send**; **Mark filed**; empty text "Nothing waiting to be filed.". A parked dump picked in Now's
  "Parked dumps need you" opens Captures on Needs you with that dump's reply box focused (the capture's own page
  has no reply box).
- **Agent acts on my approvals** (switch; Agent queue and Settings > Work): off = approvals, answers, notes and
  requests only wait in the Agent queue; on = Object runs due entries one at a time. **Agent runs by itself**
  (Settings > Work): an Agent step that becomes current runs once, read-only. At most 3 auto-runs of one item in a
  row since Gene last acted on it (decision S3): the 4th Agent step stays Open and is listed in Stuck under
  **Waiting for Run now** ("The agent ran 3 steps of this item in a row by itself. Press Run now to let it go on.");
  any action of Gene's on the item (Run now included) starts the count again, and so does his edit of the item's
  properties or body in the app (fix pass 2026-11-09; the window's own change event); writes by agents, automations,
  the token API or a program outside the app don't. The count survives a restart.
- **Withdraw** (an approved Approve step's button, a `reopen`) logs "Gene withdrew the approval of step n …" in
  Activity; reopening a done or declined step still logs "reopened".
- **A step list that can't be read** (a hand-edited entry with an unknown kind or state): the readable steps show,
  but no step offers an action (`stepsUnreadable`, every step's `actions` empty), and the work header lists the
  problems ("Step 3 has an unknown kind "maybe".") until the file is fixed — the server refuses every step write.
- **Settings > Work**: **Create the Work agent** (shell warning; offers to copy your `change-reviewer`),
  **Read tools** (mark a server's read-only tools; no more than 500), **Set up Desk sync** (an off schedule at
  07:00 every weekday that updates ticket fields only; never writes to Jira or ServiceNow).
- **Agent page > Schedules**: each row's menu offers **Run now** (turned-on schedules only; one run outside the
  schedule, same guards as a due occurrence, through `POST /automations/{id}/run-now`), **Edit**, **Run log** and
  **Delete**. A turned-off schedule's summary reads "Off · Every weekday at 7:00 AM".
- **Queue entry states**: pending, running, done, failed (reason + **Retry**), withdrawn. A failed run says why
  ("The run didn't finish within 30 minutes.", "The agent finished without marking the step done.", "Object closed
  during this run.") or asks Gene one question (a Question step is inserted before the step).

## 10c. Import and migration (M15, M25-M27 and M30)

The catalog has no import dialog (only the Import menu entries in sections 4 and 9), so everything here is Object's
own; the strings live in `frontend/src/import/text.ts`, `import/scan/text.ts` and `import/agent/text.ts`.

- **Import dialog** ("Import from another app"): **Zip file or folder** path; **Exported from** Detect automatically
  | Notion | Obsidian | Anytype | Files (a folder, with an optional `_manifest.jsonl`); **Preview** writes nothing.
  Steps in order: source, **Check for sensitive content** (scan), **Review mappings** (types, properties, options),
  progress with **Stop import**, finish. A folder's type name is its singular (Books -> Book, Stories -> Story,
  People -> Person, Children -> Child); into this space a folder joins an existing type with that name, or one whose
  plural is the folder's name (so a "People" folder joins Person instead of making "People (2)").
  **Import into**: A new space | This space; the review step also offers
  **Keep originals as** Attachments (default) | File objects, and **Try on a copy of this space** (imports into a copy
  named "<space> (trial)" next to the open space; on by default for a first run into this space). A finished import into
  the copy offers **Switch and review proposed schema** (the batch lives in the copy): it switches to the copy and opens
  that batch's Proposed schema there. The options also offer **Keep pages as Sources** (M30; the design's label), ticked
  for every import ("Every page is kept as a read-only Source, exactly as imported. With the AI filing pass, the things
  they talk about become their own objects, built from all the pages that mention them."); with it on the preview plans
  one type, Source, and the import writes every page as a Source; unticked, pages are filed into their mapped types as
  before. The batch records the choice (`keepAsSources` in `batch.json`); a request that leaves it out (the API, `/api/v1`,
  MCP) keeps pages as Sources too, so a caller sends `keepAsSources: false` for a plain mapped import.
- **Sources** (M30): a page of a batch kept as Sources is a **Source** object (type id `source`: M28's in an IT ops
  space, else made from the basic Source type by the first import kept as Sources; a space whose `source` id is some
  other type uses that type) in the Source type's folder, with its **Category** (from the original's format, then the
  source system) and **System** (the source system's label: SharePoint, Wiki, Notion, Obsidian, Anytype, Files,
  Markdown), its other fields kept as frontmatter keys the Source type doesn't declare, its kept original and its
  `importSource` block. Images and other files stay Image and File objects. A Source's text is byte-identical to the
  imported text (CRLF and BOM included): no page is turned into an entity, renamed, retyped or given a link, tag,
  collection or Import inbox entry. An imported Source is read-only, reason **Imported source**: property edits, body
  saves, rename, change type, mention links, version restores, `/api/v1`, MCP, agents, automations and the Entities
  Write all refuse it (`423`); Move to Trash and Restore stay allowed, and a Source made by hand (no `importSource`) is
  editable. Only a re-run of the same source updates a Source (the previous text in version history), and a Source
  stays a Source on a re-run whatever the re-run's option says.
- **Source line** (object page, under the properties; hidden when the object was not imported): **Source**
  "Imported from <system> (author, modified <date>, version <v>)", **Open original** (the web url, else the kept
  file) and **Show file** (shows the kept original in the file manager). Every imported object carries the system
  frontmatter block `importSource` (system, url, id, version, author, created, modified, original, contentHash, batch,
  importedAt); it is a system field, so the property panel never lists it under External properties.
- **Git provenance** (M31; import design section 1, the "Wiki (git)" row): a source folder inside a git repository is
  read with read-only git (no network; the repository never changes). A Markdown or Obsidian folder there is
  `system: wiki`; each file's `version` is the commit (HEAD's sha), `url` its web page at that commit when `origin` is on
  GitHub, GitLab, Bitbucket or Azure DevOps (https and ssh remotes; else the `file:` link), `author` and `modified`
  its last commit's. A file that differs from the commit (changed, staged or never committed) gets `uncommitted: true`
  and is listed in the report's **Git** section ("Imported at commit <sha>.", "<file>: has changes not committed to
  git; imported as it is on disk"). The Source line shows "commit <first 7>" and "has uncommitted changes". An earlier
  import of the same folder made as `markdown` or `obsidian` is still matched on a re-run (our calls). Git's check of
  who owns the repository is never switched off (M31 fix pass): a repository git refuses (another user's) is imported
  as a plain folder, and the preview's warnings and the report say "This folder's git repository belongs to another
  user, so its commits were not read."
- **Links between imported pages**: a source link names a page by path or by name; when several pages share the name
  (Books/Dune and Movies/Dune) the one nearest the linking page wins (its own folder, then the deepest shared folder,
  then the shortest path), and the written link is the title only when the space resolves it to that object, else its
  path.
- **Queryable import fields**: filters, sorts and columns offer **Imported from**, **Import batch** and **Source modified**
  (the last is a text filter on the ISO date).
- **Files source**: every non-Markdown file is one page (text and images where they appeared) with the untouched
  original kept in `Attachments/Originals/` (over 100 MB: not copied, listed in the report). A file that cannot be
  read becomes an "Original only" page. Sheets over 200 rows or 20 columns are not shown ("see the original").
  An image (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`) is an **Image object** in the Image type's folder
  (`Images/`; the basic media type Image, made when the space has none): MIME type, file size, width, height and
  source (the kept original) as its read-only system fields, the image
  in its body (the design's call, approved by Gene as AC-2 on 2026-11-08; not a Page holding the image). Only images
  the Page row would take: a mapping that puts them in a folder or key type, or the Page row into another type, wins.
  The import preview lists such images under their own **Image** row ("Image files", the count, no properties;
  the row can't be mapped: "Images always become Image objects, so the Image row can't be changed.") and the Page
  row's count leaves them out (fix pass 2026-11-09). The report's Originals section says "1 image became an Image object."; File objects mode makes no second object for
  an image; the File, PDF, Audio and Video objects it makes belong to the basic media types (made when the space has
  none, like Image), so their MIME type, file size and source are read-only system fields, not External properties. An image an earlier import made into a Page stays that Page on a re-run (matched by source id, updated in
  place, never duplicated or migrated) and the report notes "Kept as a Page: an earlier import made it before images
  became Image objects".
- **Scanned PDF pages (OCR)**: a page with no text layer (or one under 32 characters) that holds an image is read with
  a local `tesseract` in every language it has installed (`tesseract --list-langs`, asked once), or the list in
  **Settings > Import Content > OCR languages** (`ocrLanguages`, Tesseract codes joined with `+`, e.g. `eng+deu`;
  empty = every installed language; fix pass 2026-11-09), and its text merged in page order, so a PDF mixing text and scanned pages keeps
  every page's text (Gene's call, 2026-11-08). The report names the pages: "Needs OCR: page 2 read with the local OCR
  engine", or "Needs OCR: page 2 has no text layer" without `tesseract`; a PDF with no text layer at all still says
  "Needs OCR: read with the local OCR engine" (or "Needs OCR"). Each scanned page is OCR'd once: **Check for
  sensitive content**, the import's own scan and the import reuse the text, cached in memory by the image's content
  hash (never written to the space or the state folder; a restart of the app reads it again).
- **Check for sensitive content** (local, nothing sent anywhere; findings never show the matched text): **Leave out**
  (one folder or pattern per line; left-out files are never read), then **Flagged files** with a kind (Private key, API
  key or token, Password assignment, Connection string, Card number) and line; each defaults to **Import, excluded from AI**
  and can be switched to **Leave out**.
- **Re-runs**: the same source updates its objects in place (the old text goes to version history), reuses identical
  attachments and never overwrites Gene's edits. Finish step and Import report: counts that add up (source items =
  imported + updated + unchanged + changed in both + left out + failed; after **Stop import** both say how many of the
  failed were "not written because the import stopped"), **Changed in both** (**Take source** /
  **Keep mine**, and **Take source for all** / **Keep mine for all**), **Removed at source** (listed, never trashed).
  **Move batch to Trash** moves the objects the batch created (not the ones it only updated) to the Trash.
- **Proposed schema** (finish step offers **Review proposed schema**; so does each row of **Settings > Import Content >
  Import history**, the open space's import batches newest first (source, date, objects; trashed batches left out), which
  reopens the same Proposed schema, Trial, Normalise and Import inbox steps after the dialog was closed or the app
  reloaded): each group is **Use existing type**, **Extend
  existing type** or **Create type**, with document counts, examples, "N% have a value" fill rates, options and merges;
  **Accept**, **Edit** (Name, Plural name, Keep <property>) or **Turn down**; **Apply** stays disabled until every
  item is decided and creates only what was accepted. A new type needs 10 documents; a property needs 30% of its
  group. An item the rules will skip says so before Apply ("Apply will skip this: <reason>"), properties the rules left
  out are listed under **Left out** with their reason, and the Apply summary names each skipped item and why
  ("Skipped: Memo (…)"; items the user turned down are not repeated). Only the app applies a proposal; no MCP tool can.
  In every space, whatever its setup (M30, design 5b; M31, Gene's 2026-11-10 decision "spaces never change
  behaviour": the setup is only the starting set of types) the rules also say: existing types first; a new type that
  shares at least 3 specific properties with an existing type (same name, case and punctuation aside, and same kind; the
  system properties and Notes, Type, Status, Cover image and Sources left out), 80% or more of both types' specific
  properties together, is refused ("It has the same properties as Host.") and offers **Use Host, with a category**,
  which turns the item into an extend of Host that adds the group's name to its Category (else Kind) options (tuned in
  M31's fix pass: [Genre, Rating] is not Book, [Status, Notes] is not Project); a category name (Server, Workstation,
  VM, Production) is never a type when the item also shares 2 specific properties with the type holding it ("Server is
  a category: a property value or a tag, not a type."), and a tag's name never is; a category name on an item that
  doesn't look like its type is a note ("Workstation is also one of Host's Category options.") with the same offer and
  doesn't block Apply; a relation property is kept when it points at an existing type or one proposed in the same
  proposal, else it is left out ("It points at Vault, which is neither a type in this space nor one proposed here; it
  stays a plain link.") (M31 fix pass).
- **Trial on the first 50 objects**: **Start trial**; each result shows a confidence (High, Medium, Low), the value
  and its **Quote**, the **Tags** and **Collections** it adds (each with its quote), and **Right** / **Wrong** marks with an accuracy line ("N of M marked right (P%)"); a value that
  failed the app's check says **Did not pass the check**. **Continue with the rest** starts the bulk pass (40 objects
  per agent turn). Flagged files are not in the trial. On a batch kept as Sources each result shows instead what the
  page is about and what it mentions ("About: Host APP01", "Mentions: HQ, Payroll"); the trial, the bulk pass, the
  Entities step and its review write no `.md` file and no type, only the batch's records.
- **Entities** (M30; a batch kept as Sources only; after the bulk pass, before Normalise, because the candidates come
  from the filing pass): **Entities**, "The things these pages talk about. The pages stay as read-only Sources, and each
  entity is built from all the Sources that mention it. Accept, rename, merge, split or turn down each one." ("No
  entities were found. The pages stay as Sources." when there are none; Write still finishes the batch). Entities are
  grouped by type ("Host (3)") with their source count, "Also called …" for aliases, and the badges **A page is about
  it**, **Already in this space** (an object of that type with that name or alias, never a Source, is reused, so Gene's
  own Host "app01" takes APP01's values instead of a twin), **Merged by the agent** and **Sources disagree** ("10.0.0.5
  kept, from the newer source; also 10.0.0.6"). Each entity: **Accept**, **Rename** (**New name**) or **Turn down**;
  **Select <name>** and **Merge N selected** (same type only); **Split** ("Move these names to a new entity:") on one the
  agent merged; **These look like the same thing** with **Merge** for near-duplicate names (only suggested). Names and
  aliases that normalise the same (case, spacing, surrounding punctuation) merge by themselves within a type. **Not made
  into objects** lists the rest with their reason ("Stays text: one page, no properties of its own" or "A category: kept
  as a tag or property value"): a candidate becomes an object when a page is mainly about it, more than one page
  mentions it, or it has a value of its own that passed the check; a category (a label option of a type in the space,
  Source's own Category and System options included, or a tag) is never an entity. "N entities still to decide",
  **Accept the rest**; **Write** stays disabled until every entity is decided (the server answers "N entities are still
  to decide." and refuses a Write while another import runs), shows **Writing…**, then "N objects created, M already
  here. N links and N "From sources" sections written." with the conflicts, the sections left as Gene edited them and
  the low-confidence links sent to the Import inbox; "Writing stopped. What was written stays; Write again to finish."
  after a failure (a second Write places nothing twice). The review survives closing and reopening the dialog.
- **Distilled entities and the "From sources" section** (M30): each accepted entity is built from all the Sources that
  mention it. Every value, alias, summary line and relation needs a quote from the page that the app checks (M27's
  rules); a value for a synced property or for `sources` is refused. When Sources disagree the value of the most
  recently modified Source wins (equal values from two Sources are one value) and the conflict is listed in the report
  and on the entity; the import fills empty properties and replaces only values it set itself, never one Gene set.
  Per-value citations live in `.object/distilled/<entity id>.json`, never in the `.md` file. The entity's **Sources**
  relation lists its Sources (shown on each Source as **Distilled into**, computed, never written there). The top of
  its body gets a section the import owns, between `<!-- group from-sources -->` and its matching `<!-- /group -->`
  (shown as one grouped block): "## From sources", short lines each citing its Sources as links (`[[title]]` when the
  title resolves to that Source, else `[[path|title]]`), "Sources disagree:" lines ("IP address: 10.0.0.5 (…) or
  10.0.0.6 (…); 10.0.0.5 kept, from the newer source.") and `Also linked: [[path|Title]] (relation)` for a relation
  outside the named set (in every space; the link resolves to the entity, not a same-named Source). An entity with no
  lines, conflicts or plain links gets no section. Everything below it is Gene's and is never touched; a later Write
  rewrites only the bytes between the markers, only when a cited Source changed or a new Source cites it, and a section
  Gene edited (or whose markers are broken) is left alone and reported ("The From sources section of <title> was
  edited, so it was left as it is."). A relation is written on its stored side, in that object's frontmatter (named
  by a counterpart, it is stored on the other side). A link from a low-confidence candidate is not written: its subject entity (never a Source) goes
  to the Import inbox with "Link not written (low confidence): <subject> <relation> <object>". The page's tags and
  collections go on its main entity. Mentions of an entity in Sources stay unlinked and show under its unlinked
  mentions. Created entities carry an `importSource` block (`id: entity:<typeId>:<key>`) and a `created` item in the
  batch, so a re-run finds them instead of making twins and **Move batch to Trash** takes the batch's Sources and the
  entities it created (not objects it only linked to or distilled into), restorable. The report gains `## Entities`
  (Sources, entities accepted, created and already here, turned down, not made into objects; links, plain links and
  inbox links; sections written and left) with `### Sources disagree`; on a batch kept as Sources the report page is
  written at the Write's finish.
- **Normalise tags and options**: near-duplicate tags and option values (for example Prod / prod / Production) with
  **Merge into** and **Merge N groups**; "Nothing looks like a duplicate." when there are none.
- **Import inbox**: low-confidence pages land in a collection named "Import inbox"; the last step says
  "N objects in the Import inbox for you to look at." with **Open Import inbox**. The open window learns of the collection
  the pass made: an import's resync reloads the collections, and a collection page opened on an id the window
  doesn't know yet fetches the collections once more before it says "Unknown collection".
- **MCP**: `import_scan`, `import_proposal`, `import_report`, `import_entities` (read) and `save_import_proposal`,
  `save_import_decisions` (write), the prompt `migrate_a_source` and the resource `object://skills/migrate-a-source` let
  an outside agent run the same workflow; `start_import` refuses a mapping that creates types outside an approved
  proposal (for the open space or a trial copy; a brand-new space is not checked). `start_import` takes
  `keep_as_sources` (sent as `keepAsSources`; on when left out). `import_entities(batch)` reads a Source batch's entity
  list with Gene's decisions, values with their Sources and conflicts (`GET /api/v1/import/entities`; 409 "This import
  didn't keep its pages as Sources." otherwise); decisions saved with `save_import_decisions` may carry `mainEntity`,
  `entities` (with `lines`), `relations` and `merges`, checked the same way. No tool accepts, merges, splits or writes
  entities (only the user does, in Object), and no tool writes a Source.

## 10d. Agents: tools and the fence (M17-M18)

- **Built-in tools** (decisions memo S1): a run is offered only the Claude Code built-ins whose Tools-tab row is on,
  plus the skill tool and `ToolSearch` (which Object's MCP tools load behind); the run passes them as an explicit
  `--tools` list, never `--tools default`. A built-in the CLI adds later (on 2.1.319: CronCreate, RemoteTrigger,
  SendMessage, ScheduleWakeup, Workflow, Monitor...) stays off until it gets a Tools-tab row. Read-only work runs
  get only Web fetch and the skill tool; an import filing run gets none.
- **What a run's token may call** (decisions memo S2): every run (chats, Work, filing, schedules, delegation,
  reviews) carries, on its token, the Object agent tools its tool lists allow, so Object itself refuses the
  others with "This run can't use {tool}." even if the CLI let a call through; an agent's Tools-tab switch-off of
  Memory, Change skills, Delegate or Call a remote agent is enforced by Object, not only by Claude Code. Read-only
  runs (Work read, filing a brain dump, Desk sync, import filing) can never write the agent's memory or skills.
- **Shell and search**: with the shell on, Find files (Glob) and Search in files (Grep) stay ordinary switches. The
  run names them in its `--tools` list, and Claude Code (checked on 2.1.319) then offers them beside the shell;
  only the old `--tools default` dropped them for shell-on runs, which is why greying them out (approved as A-1)
  was not built.
- **The fence**: a run's file tools are denied every space folder (notes are reached only through Object's tools),
  the other agents' folders, the agent trash and Object's own state files, through path rules in the run's
  settings. Known limit, accepted (decisions memo A-2): a folder whose name contains a backslash (`\`, legal in a
  Linux folder name) can't be fenced — no rule form Claude Code accepts matches it (three forms tried live on
  2.1.319, Linux). Rename such a folder if an agent should not read it with its file tools. Object says so instead
  of staying silent (fix pass 2026-11-09): the agent page's Profile tab shows, under Folder, `The folder "…" can't be
  fenced from this agent's file tools because its name contains a backslash. Rename it if the agent shouldn't read
  it.` (the agent API's `warnings`), and the app log gets the same line once per run.

- **Refused steps** (our wording): a tool step the run was not allowed to make reads "Not allowed to create 'X'
  (this agent has the tool switched off)" (or "(the file is outside what this agent may read)", or the refusal's own
  first line), never a past-tense "Created 'X' (failed)"; an ordinary tool error keeps the "(failed)" suffix.
- **Add agent folder…** says what is wrong: "This folder isn't an Object agent." only when there is no readable
  `agent.json`; a missing or malformed id says so and shows the id (an agent id is a 26-character ULID).
- **Settings > Integrations > Secret variables**: **Delete** asks first, as a server's Delete does (**Confirm delete**
  with "Agents that use this variable lose its value at once. This cannot be undone.").

## 10e. Agent and API guards (Object's own; decisions memo 2026-11-08)

- **One turn per chat** (S8): a second message on a chat that is still answering (the same chat open in two tabs
  or windows) gets one error, "This chat is still answering.", before anything is written, run or sent. Local
  agents and remote (A2A) agents share the guard.
- **Deleting a collection over the API** (S5): `delete_collection` (MCP and `DELETE /api/v1/collections/{id}`) is
  refused (409, "This collection holds pages excluded from AI; delete it in Object.") when any member is excluded
  from AI, with or without confirm; nothing changes. Deleting it in Object is unchanged.
- **Only Object's own window uses `/api`** (S6): each launch makes a random key; the window (and the keep-on-top
  window) opens at a one-time `/_open` link that hands it over as a session cookie, so every request the UI makes
  carries it. Without it `/api` answers 401 "Only Object's own window can use this." and the page shows "This page
  isn't connected to Object" ("Only the window Object opened can use this space. Open Object again from its
  launcher."). With `--browser` the browser gets the one-time link alone and the terminal says "Object is running
  at <url> (opened in your browser)."; the link is printed only when no browser could be opened, with `--print-link`,
  or on Enter in the terminal (which prints and opens a new one; it works once, for 5 minutes). `/api/v1` with a
  token keeps its own auth; the run fence stays as a second layer.
- **Maintaining a running space over the token API**: type and saved-query definitions can be listed (`GET
  /api/v1/types`, `GET /api/v1/queries`, added 2026-11-09), read, made, edited and deleted while Object is open with
  a `read-write` token (or the `objectapp-mcp` tools `type_definition`, `create_type`, `edit_type`, `delete_type`,
  `saved_query`, `create_query`, `edit_query`, `delete_query`), through the same Space code as the window: the same
  validation, revision checks (409), read-only types (423), a saved version before each save and the Trash on
  delete. Never hand-write `.object/*.json`.
- **Live refresh**: an object change event (`created`, `changed`, `deleted`, `renamed`) may carry `linked`, the
  sorted paths whose backlinks the change may have altered (absent when the link index can't say). Views keyed on
  backlinks (the Tasks dashboard's Context grouping) refresh only those rows; without the field they reload as
  before. A window's own saves carry the same list in the save response (fix pass 2026-11-09).

## 10f. Synced facts and the suggested type (beyond the catalog; Object's own, M29)

- **Synced facts**: a text, URL, number, checkbox, date or label property can be marked synced (Property settings,
  "Synced": "Synced from a script or agent", Source (placeholder "Inventory script"), "Stale after" N days, default
  7; "Values typed into the file for this property stop showing."). Its values are filled only by a script or
  agent: `POST /api/v1/synced/{type}` with a `read-write` token or a "Synced facts only" (`sync`) token, or the
  `objectapp-mcp` tool `sync_facts` (registered for read-write and sync tokens; a sync token gets it and the read
  tools only). Items match an object of that type by title, alias or a key property (exact after trimming,
  collapsing spaces and case folding; never a template or an object excluded from AI); each item answers updated,
  notFound, ambiguous (two or more matches; nothing written) or invalid. The values live in
  `.object/synced/<typeId>.json`, never in the `.md` (an object with no `id` gets its `id` line on its first
  sync, once); a value typed into the file under a synced key is ignored and never removed. A sync token reads
  like a read token and any other write answers "This token can only write synced facts."; `GET /api/v1/whoami`
  says `scope: "sync"`.
- **Shown read-only**: the property row (page and peek) shows the value with "<source> · Refreshed <time ago>"
  (or "<source> · Not refreshed yet") under it, muted with "Stale" once older than its stale-after days. No
  editor opens; a table cell is read-only; a Kanban drag between, say, Patch state columns is refused; the
  refusal reads `"<name>" is filled by <source> and can't be edited.` and the same refusal answers
  `PUT /api/object/properties`, `/api/v1/object/properties`, automations' Set and Clear property, a create with
  values and the work routes. Filters, sorts, groups, formulas and exports use the synced values; v1 rows, peeks
  and object reads carry `syncedAt`.
- **The IT ops starter's Host** has five synced facts, always shown, from "Inventory script", stale after 7 days:
  Last boot, Disk free (GB), Patch state (Current, Pending, Failed, Unknown), Reboot pending, Last seen. Host,
  Network and Software (the starter's and the gallery's) carry name patterns. A type written before M29 is not
  changed.
- **Suggested type**: every create row offers a suggested type first, marked "Suggested": the context's type (a
  relation's allowed types, else the open collection's or query's types), then a type whose name patterns match
  the name, else the type used last in this space (per viewer and space, localStorage `object.lastType:<root>`);
  no suggestion keeps the old default (Page). `[[` / `@` with a query lists, after the matching objects, "New
  '<q>'" (the suggested type's chip and "Suggested"), then "Other types" (every other writable type); a relation
  picker lists "Create '<q>'" once per allowed type (all writable types when any type is allowed), the suggested
  one first, when no candidate matches exactly (the Tag picker's own "Create 'x'" stays); "+ New object" without
  a type lists the suggested type first; the palette's single create row ("Create new {type} with title "{q}"")
  uses it unless a type filter is set; Turn into object lists it first and `I` uses it. Picking a type applies
  its default template. Nothing is sent anywhere: no AI, no server round trip per keystroke.
- **Name patterns** (Object type settings, "Name patterns", one per line): `*` any characters but spaces, `?` one
  character, `#` a digit, `@` a letter, `\` makes the next character literal, or exactly one of `{ip}`, `{cidr}`,
  `{fqdn}` (three or more labels), `{version}` (a name, a space, a version number); the whole name must match,
  case-insensitive. At most 20 patterns of at most 100 characters; a bad one is flagged (`"{foo}" isn't a name
  pattern.`) and refused on save, and ignored when suggesting. Globs are matched by a linear state-set matcher,
  never a backtracking regex. The starter: Host `{ip}`, `{fqdn}`, `SRV-*`, `@@##`, `@@@##`, `@@@@##`, `@*-##`;
  Network `{cidr}`; Software `{version}`.

## 11. Unlinked mentions

An "Unlinked Mentions" section sits under Backlinks on an object's page; it lists text elsewhere that matches
this object's title or an alias without being a link ("Unlinked name matches", section label "Mentions"; an
alias counts as a mention of the original object). Settings > Editor > "Backlink sections start as"
has Backlinks Open | Closed and Unlinked Mentions Open | Closed | Hidden.

Object builds it in full (M5): `backend/objectapp/references.py` (matching on Unicode word
boundaries, titles and aliases of at least a minimum length, longest name first, linking a mention from the
list), `frontend/src/references/` and the Editor settings. **Gene wants this kept**; it is a ground rule in
`CLAUDE.md`.

## 12. Version control and backup

Gene, 2026-11-08: "I want the entire object workspace gitbacked for backup to github or lab and version control
and rollbacks." Object's own feature (no counterpart in the reference app); design note
`docs/superpowers/specs/2026-11-08-git-backed-spaces-design.md`. Remote-agnostic: any git remote address (https or
ssh: GitHub, GitLab, a self-hosted server).

- **Off until turned on.** Opening a space never starts it and never writes a file. **Settings > Space > Version
  control** (after Space Settings): "Turn on version control" puts the space folder in its own git repository
  (`git init`, or a folder that already is a repository is adopted with its history and branch), keeps a managed
  block in `.gitignore` (`.object-cache/`, the app's `.*.tmp` temp files, `.DS_Store`, `Thumbs.db`; `.object/` is
  content and never ignored) and makes the first commit ("Object: start version control"). A folder tracked by a
  repository in a parent folder is refused. Without git installed the section says "Git is not installed" and it
  stays off. Turning it off stops the commits; the repository and its history stay.
- **Commits** happen after a quiet spell ("Commit after", default 2 minutes, from 30 seconds to 30 minutes) with
  no app write and no change seen on disk, and when the app stops (switching or closing the space, quitting).
  Other programs' edits are committed too. Messages summarise: "Object: edit 3 objects (Printer jams, Rack, Tape)",
  "Object: add 1 object (…)", "Object: update 2 files (…)", the paths in the body. The author is the user's git
  identity, else "Object <object@localhost>". Object stages only the paths it found changed, never commits a change
  another program staged (it stays staged and the section says so), waits for `.git/index.lock` (never deletes
  it), and does not commit during a merge, rebase or on a detached HEAD. "Commit now" commits at once.
- **Remote**: a "Remote" address and an optional "Branch" (default: the current branch), "Save remote", and when
  set "Push now", "Update from remote" and "Push automatically" (on: push 10 minutes after the first unpushed
  commit, "Push after" 5 / 10 / 30 / 60 minutes). Unset by default; then the status just says "No remote set".
  Object uses the system's git credentials (credential helper, SSH agent) and never stores a token or password; git
  never waits on a prompt. On start a space with a remote is fetched and fast-forwarded only when the folder has no
  uncommitted changes and the remote is simply ahead; a remote that has diverged shows "Remote has diverged: N
  commits there and M here. Object never overwrites either side; merge them with git." Nothing is ever force-pushed.
- **Space history** (a page; from the spaces menu under "Space settings", the palette's "Open space history", the
  section's button and the sidebar's backup line): the commits newest first (message, time, "N files changed"); a
  picked commit shows its changes as text diffs per file; **Restore space to this point** asks "Restore the whole
  space?" and makes every file what it was at that commit as a new commit ("Object: restore to <short> (<date>)"),
  committing pending changes first; the space's index reloads. History is never rewritten.
- **Version History dialog** (an object's `…` menu): under the saved versions, "In version control" lists the
  object's commits (following renames) as "Commit <short>"; one previews and restores like a saved version, as a new
  commit ("Object: restore "<title>" to <short> (<date>)").
- **Saved versions** (M8) stay the fine-grained layer. Their folder in the state dir is keyed by the space's stable
  id (`spaceId` in `.object/space.json`, written when version control is turned on or on the next app save in a
  space that has a `space.json`), so moving or renaming the folder keeps them; older path-keyed history is moved over.
  Type, collection, query and view definitions keep a saved version before each app save too.
- **Definition Version History** (M31; our wording and summary): "Version History" in Object type settings' header,
  a saved query's `…` menu and a collection's `…` menu opens the definition's saved versions, newest first
  ("Version N", the time). A picked one shows "In this version" (name, plural name and properties for a type; object
  types for a collection; object types, search, filters, sorts for a query), "Changed since" (renamed, properties or
  object types added, removed or renamed since) and the "Definition file" pretty-printed. "Restore this version" asks
  "Restore this version?" and saves it back through the normal save (revision checked; what is there now is kept as
  a version first); a type version that would remove values asks "Apply changes?" first. Views have versions but no
  restore page.
- **Settings > Offline & Sync > Backup**: "Back up all spaces" (version control on for every space on this device,
  with a line per space that couldn't) and the "Back up agents and settings" switch: the per-user state folder
  (agents, automations, device settings, the spaces list) in its own repository, with a remote field and "Push now".
  Secrets and token files, caches, saved-version snapshots, logs and run ledgers are never committed, even when the
  `.gitignore` block is edited away.
- **Sidebar footer**: while version control is on, a quiet line at the right: "Saved 5 min ago", "Backed up 2 min
  ago" after a push, "Changes waiting", or "Backup problem" in the danger colour; its tooltip has the detail, a
  click opens Space history. Nothing shows while it is off.
- Agent runs can't reach any of this (the run fence covers `/api/vcs`); it is not an MCP tool.
