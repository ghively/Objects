# UI polish audit, 2026-11-02

Gene asked to check every button and interaction against Object. Method: Claude drove Gene's own
Object tab (Microsoft Edge, the CPI space, 1912x901) through the browser tool's CDP attach, read-only:
opened menus, popovers and views and closed them without choosing anything; nothing was created or
changed, and the view was put back to Day afterwards. Object was then opened at the same width and
compared control by control. Saved references: `docs/01-calendar-day.png`,
`02-calendar-three-days.png`.

## Fixed (commits on `master`, not yet pushed)

| Area | Object | Object before | Now |
|---|---|---|---|
| Empty daily note | one placeholder | two placeholders drawn over each other ("Start your daily note" + "Write your text or search for blocks...") | one; the editor can be told not to draw its own |
| Section headings in narrow columns | heading intact, toolbar beside or below | toolbar overprinted the heading ("Task", "Cre...ay") | the heading row wraps; the toolbar drops to its own line |
| Three days | day header + daily note only, no month sidebar | plus Tasks, Created, Backlinks sections in every column | daily notes only (as `02-calendar-three-days.png`) |
| Month sidebar and its switch | Day view only | every view | Day view only |
| Top bar in a narrow window | stays one line | "Three days" wrapped; Today arrows overprinted the month header | no wrapping; clips instead of colliding |
| Daily note header (Day) | pill: Reviewed checkbox + `...` | Reviewed up by the title; `...` offered only Open as Page / Open in new tab / Delete | pill holds Reviewed and the note's full object menu (Present, Export, Version History, Object Type Settings, Delete, ...) |
| Calendar section toolbars | layout picker, settings menu with only Calculations, `+`; count outside list layout | count, Filter, Sort, Group by, Layout, Customize (7 controls) | compact toolbar for Calendar sections only |
| Sidebar, collections | a type's collections listed under it | none | listed under each type, foldable, remembered |
| Sidebar, type context menu | Open >, Create X, New from Template >, New Collection, Pin to Sidebar >, Object Type Settings, Import | Object Type Settings, Delete | all but Pin to Sidebar (see below); Import is Object's CSV import |

## Backlog (observed, not done)

1. **New menu**: Object opens a popover anchored under the New button, with a "Search" field, the types
   in recent-use order, and a footer "up/down to navigate, Esc to abort, Enter to select". Object opens a
   centred modal with an alphabetical list.
2. **Search palette**: placeholder "Search for content and actions, or paste from clipboard" with an info
   icon; recents grouped "Today" / "Earlier" with each item's type at the right; footer lists Ctrl+Enter
   (new tab) and Shift+Enter (side panel); content and actions are one list. Object has "Search content",
   an empty state until objects are opened, and a separate "Switch to actions" mode.
3. **Month view**: a Jan-Dec strip with the current month highlighted above the cards, and a "+ New Object"
   row under them. Object shows the cards only.
4. **Multi-day views (Week, Three days)**: for an existing note Object puts Reviewed, an expand icon and
   `...` on the date row. Object shows nothing there.
5. **Tasks section**: the `+` is the last control inside the toolbar pill; Object draws it outside, left of
   the pill.
6. **Type menu, "Pin to Sidebar >"**: submenu of the sidebar sections ("In Progress", "Pinned") with
   checkboxes. Object has pinning on other menus (`PinMenuItems`) but built from dropdown primitives, not
   the context-menu ones.
7. **Sidebar type row**: Object shows the count and a `...` button on hover/active; Object shows the
   count always and no `...`.
8. **Object `...` menu order and entries**: Object: Wide Layout, Open >, Use Template >, Object Type
   Settings, Share, Present (Ctrl Alt P), Export (Ctrl E), Import (Ctrl I), Version History, Text Stats >,
   Copy >, Delete Object (Ctrl Backspace). Object has the same actions in another order, no Share, Import
   or Copy >, and no shortcut hints beside most.
9. **Type page, All tab**: a "+ New Object" row under the cards; cards show an "Empty" tags row when there
   are none.
10. **Empty daily note**: Object shows "Tags" and "Text" placeholders. Only the empty state was seen;
    what happens on focus is unknown.
11. **Quick-create chips**: Object shows Task, Meeting, Project (a chosen set); Object shows every type
    plus an eye toggle. Probably a Settings choice in Object; not checked.
12. **Workspace switcher**: Object: popover with a "Search" field, the spaces with a check on the
    current one, and "+ Create space". Object: a "Spaces" header instead of a search field, the list with
    a check, then "Space settings", "Add space" and "Open folder..." (the folder entries are local-app
    needs Object doesn't have; the search field is the gap).

## Second pass: object page, editor, Settings (read-only)

13. **Editor sizing**: Object sizes the editor in `rem` from a 15.5px root (no zoom, DPR 1). Full-page
    People guide: H2 20.34px/700, body 15.5px on a 23.25px line, a 705px text column. Object's editor uses a
    fixed 17px base and has no text-size setting; a rem-based scale plus a setting would match.
14. **Object page header**: type pill (e.g. "Person") + a "Collections" chip above the title, emoji icons in
    the title, a "Tags" row under it, then the body. Properties live in a side pane (Contact, Category,
    "Add Property", each "Empty" when unset); the outline is a dash ladder at the right edge.
15. **Settings > Editor** (all missing from Object): Disable spellcheck; Spellcheck language
    (Experimental); Always open as full page; Always create inline links; backlink display (Only block with
    backlink / Full path above); Hide object type settings outside of settings; Hide outliner lines; Toggle
    style (Toggle | Bullet); Hide App Menu; When Object starts (space on this device: Last opened | Specific;
    per space: Where I left off | Calendar | Calendar today | Specific object); Highlight Style (Default |
    Minimal); Default state for backlink sections.
16. **Other Settings pages**: Language; Date & Time (time zone list, date formatting); Offline & Sync
    (sync status, content downloaded, Recalculate content index, local storage size, media loading Everything |
    Required only, Clear media cache, cloud media usage); Import Content (migration guides per app); Space
    Settings; Object Types; Task management; Integrations (Calendar, Task actions, API, Web Extension, Email,
    Telegram, WhatsApp, Readwise, Kindle, Raycast). Cloud-only ones (Account, Billing, sync, integrations)
    have no Object equivalent by design.
17. **Sidebar footer**: Graph, Trash, "Help & Resources" (First Steps, Ask a Question, Documentation, What's
    New, Feedback); profile, settings, theme icons along the bottom.
18. **How-to guides**: Object ships guide objects ("How to Use This People Object", Meeting, Project).
    Imported into the wiki-organized space as How-to-tagged objects and used as type descriptions.

Method note: one stray click in this pass collapsed the sidebar's Object Types section; it was expanded
again right away. Nothing was created, edited or deleted, so no scratch page was needed.

## Third pass: a well-used space (structure only, no note content kept)

Gene pointed Claude at a second space used for about a year (27 object types, 144 daily notes, 102 tags,
184 pages). Read-only; nothing from it is stored in the repo. What it shows about real use:

19. **Types are buckets, not schemas.** Of 19 custom types, 14 have only Title, Tags and Content. Types with
    properties: Server (IP Address, Roles, Primary Function, Departments, Operating System, all Text),
    Person, Organization, Place, Meeting, Project (Status and Category are Object properties pointing at the
    Tag type; Project also relates to Servers and Software), Key (relates to Servers and Scripts). Object's
    import and templates should treat "Object -> Tag" relations as first-class (status or category as a tag).
20. **Tags are flat facets**: 102, mostly used once; client or organization names (the biggest used 15 times), technology (Linux 5, Wifi 5),
    status words ("Complete" 7, "In Progress" 2) and a few with 0 uses. The Tags type page lists them as
    chips with counts.
21. **Daily notes are the inbox.** Most are short: a few lines, a list of links to objects filed elsewhere
    (Prompt, Meeting, Script), or pasted tables and code blocks. 29 of 144 are nearly empty. Filing happens by
    linking or creating the object from the note, which then appears in the day's "Created Today" list.
22. **Collections hang under their type** in the sidebar (Emails > Backup Reports; Pages > Backup Report,
    Evidence & Reports), as Object now does.
23. **Cards are masonry**: columns of variable height, each showing the object's tags and the start of its
    body (bullets, tables, links, code, inline `#tags`). Object's card layout should be checked against this.
24. **Table layout on a type's All tab**: row numbers, then Title, Tags, Cover image, Icon, Description,
    Content (a "N words" chip with an expand icon), Last updated, Created at.
25. **Type page `...` menu**: New from Template >, New Collection, Pin to Sidebar (Ctrl Shift *), Object Type
    Settings, Export (Ctrl E), Import (Ctrl I). Daily Notes has tabs Overview | All | Unreviewed and a "Go to
    today" button where other types have a split New button.
26. **Peek** shows the type pill, Collections chip, title, Tags, the property table, the body, a Backlinks
    section (each hit shows its parent block and the source's type), and a "6 / 26" prev/next stepper.
27. **Object Types settings** (Settings > Object Types): "Custom object types" and "Basic object types" tile
    grids plus Create; each type page has Icon, Name, Plural, Color, Description, Properties (Title, Tags,
    Content fixed; Add Property), Templates, and a Configuration block: Page layout (Standard | Index card |
    Profile | Encyclopedia), Wide layout, Cover image mode and display, Default card view, Default list view
    (up to three right-hand properties), Default link view, Delete Object Type. Settings has a "Search
    settings" field and four groups: Account, General, Space, Integrations.

Note: this space holds plaintext credentials in some daily notes and pages. Nothing was copied; worth
scrubbing before any of it is imported into Object.

## Fourth pass: Object's built-in types, and a third space (Personal)

Read from Settings > Object Types in two spaces. Basic types cannot be edited in Object. Fields below are
Object's own; "Object has" is `backend/objectapp/typemodel.py` (`BASIC_MEDIA_TYPES`, task fields).

28. **Built-in types and their fields** (beyond Title, Tags, Notes/Content, Description where listed):
    - Page: Aliases, Cover image, Icon, Description, Last updated, Created at.
    - Daily Note: Reviewed (checkbox); the type config has a "Hide reviewing" switch.
    - Task: Status (label), Date, Deadline, Priority (label), Context, Completed (date time). Config: Default
      link view and "Task Management Settings"; Settings > Task management can hide tasks per space.
    - Tag: Aliases, Description, Icon, Color.
    - Query: Icon, Title, Description.
    - AI Chat: Title, Description, Tags, Context (Object -> Pages).
    - File: Icon, File, Description, Created at, Last updated, MIME type, File size.
    - Image: Image file, Description, Source, MIME type, File size, Width, Height, Created at,
      Category (label), Colors (label).
    - PDF: Icon, Preview Image, Source, PDF file, Description, Created at, Last updated, Number of Pages,
      File size, Table of Contents (checkbox), Document type (label), Topic (label), MIME type.
    - Weblink: Preview Image, Description, URL, Iframe URL, Domain, Category (label), Topic (label),
      Created at. Its Default link view is "Small Card" with a Reset button.
    - Audio: Icon, Audio file, Description, Duration, MIME type, File size, URL, Origin, Category (label),
      Created at.
    - Table, Video, Whiteboard exist too (Table seen in Work; not opened).
29. **Gaps in Object's media types**: PDF lacks Number of Pages, Table of Contents, Document type, Topic;
    Image lacks Category and Colors; Weblink lacks Category and Topic; Audio lacks Duration, Origin, Category.
    The label-type fields (Category, Topic, Document type, Colors) are new to Object: label sets that the
    user can edit.
30. **Object Types page layout**: basic and custom tiles are separate grids; in Personal, Task, Query, AI
    Chat, Audio, PDF, Tag, Image, Weblink, Page, File and Daily Note are all "basic", so which types are
    basic depends on the space.
31. **Personal space**: 20 types (Prompt, Docker, Project, Email, Idea, Place, Person, Organization, Artist,
    Album custom; the rest basic), 78 daily notes, 101 pages, 30 tags. Same pattern as Work: most custom
    types are Title/Tags/Content only; Album has Artist (text), Cover image and a single select (Object ->
    Tag); Project has Status (Object -> Tag), Time frame, Collaborators. The calendar's Tasks section groups
    tasks by status chips (Next Up, Someday/Maybe, In Progress) with a due-date column and a "N open" count.

## Fifth pass: how the notes are actually written

Read from the Work space's 144 daily notes (text) and several Personal daily notes (rendered, in the peek).
No note content is kept here.

32. **A daily note is often a title line plus object links.** Each link sits on its own line as an object
    chip: the object's type icon, then its title underlined (a Page, a Prompt, a Config). Linking from the
    day is how things get filed; the day is a pointer, the object holds the content.
33. **Pasted AI output is common**: long runs of paragraphs with emoji section markers and emoji bullets
    (check marks, warnings), headings often just bold or emoji-led lines, not heading blocks. The editor has
    to keep these as plain paragraphs and bullets and stay fast with 1,000+ word notes; pasted tables and code
    blocks also appear.
34. **Inline date chip**: a date in running text renders as a boxed chip ("Last update resets on <date>").
    Object's editor should render a date mention the same way.
35. **Block handle**: hovering a block shows `+` and a six-dot grip at its left edge (insert below, drag).
36. **Daily note peek header**: Reviewed checkbox, a "Calendar" button (jump to that day), `...`, expand.
    The peek stepper counts in the list's sort order ("10 / 78").
37. **Shape of the notes (Work, 144)**: median about 150 characters; about 1 in 10 empty; 16 hold URLs, 9
    mention ticket ids (OPS-n), few use raw `[[ ]]` or `#tags` as text (linking is done with the picker, so
    the Markdown form seen in an export is not how they were typed).
38. **Pro-gated features appear as upsells**: a Query-backed tab ("Untitled") on Daily Notes shows blurred
    cards and a "Get Object Pro" card; Tasks and Explore show a rocket badge. Object has no paywall. Whether Pro-gated
    Object features (Tasks, Queries, AI, unlinked mentions, version history) should all be unlocked in Object
    is decided on 2026-11-02: all unlocked, nothing gated (see item 26).

Not studied: typing flows themselves (slash menu, `[[` picker, @mentions, paste behaviour), since that needs
an editable scratch page; only rendered results were read.

## Sixth pass: the editor, driven on one scratch page

One Page was created in the Personal space, typed in, and deleted (it is in Trash, kept 30 days; Trash says
"Objects will be kept in trash for 30 days"; Empty Trash was not touched). Typing went through the browser
debugger, which makes list shortcuts unreliable to judge, so treat "did not convert" below as unconfirmed.

39. **New menu**: a popover under New with a Search field, types in recent-use order (Pro types show a rocket
    badge), footer "up/down to navigate, Esc to abort, Enter to select". Typing "Page" + Enter creates the
    object and opens it in a peek with the title focused. Type pill + "Collections" chip above the title, then
    "Tags" and a "Text" placeholder.
40. **While typing, the chrome fades**: the top bar, tabs and the peek's header buttons disappear until the
    pointer moves (a focus mode). Object keeps them visible.
41. **Slash menu** ("Create a block", a scrolling list with the same footer hints), in order:
    Create a block: Standard, Small, Heading 1-4, Bullet list, Alphabetical list, Numbered list, Roman list,
    Quote block, To-do, Toggle, Icon, Group, Math, Code, Horizontal line, Two Columns, Table.
    Create an object: New <each type in the space>, New Date, New Tag, New Tweet.
    Link to a date: Time, Now, Today, Tomorrow, Yesterday, In a week, A week ago.
    Use the AI Assistant: Ask AI about this block, Add tags to block using AI (both Pro).
42. **`@` picker** (not `[[`; `[[` stayed literal text): lists recent objects with their type icon and a
    "Collection" badge on collections, then one row per type with a `>` to browse its objects; typing
    filters; same footer hints.
43. **Markdown input**: `# ` became a heading block; a backtick pair became an inline code token (monospace,
    purple, tinted background). `- `, `1. `, `[] `, `> ` and `**bold**`/`*ital*`/`~~strike~~` stayed literal in
    this run (unconfirmed, see above). Whether Object converts them with real key events is still open.
44. **Object `...` menu on a Page**: Open >, Find in Page (Ctrl F), Use Template >, Pin to Sidebar
    (Ctrl Shift *), Change Type >, Object Type Settings, Share, Present (Ctrl Alt P), Export (Ctrl E),
    Import (Ctrl I), Version History (Pro), Text Stats >, Copy >, Duplicate, Merge Into Object >,
    Delete Object (Ctrl Backspace). Delete asks "Delete this object? Deletes it everywhere." with the
    object chip and a red "Delete 1 object" button, then the object sits in Trash.
    Object lacks Merge Into Object, Change Type > as a submenu check, Find in Page's shortcut hint, and
    most shortcut hints (see item 8).
45. **Trash page**: "Go to today"-style header, an "Empty Trash" button, the trashed objects listed,
    a 30-day retention note, and a warning that object types and collections cannot be restored.

## Consolidated backlog (everything above, in one list, 2026-11-02)

Full behaviour is in `docs/object-behavior-catalog.md`; item numbers refer to this file. Status: **open**
unless marked. Order is a suggestion, highest value first.

**Keep (Gene's explicit requirements)**
- **Unlinked mentions stay.** Object already has them (M5: `backend/objectapp/references.py`,
  `frontend/src/references/`, setting "Default state for backlink sections" with Open | Closed | Hidden).
  Object gates them behind Pro; Object keeps them free. Any change to references, the object page or
  search must not remove or hide them. Add a regression test per change that touches that code.

**A. Data model (built-in types and fields)** (items 28, 29)
1. PDF: Number of Pages, Table of Contents (checkbox), Document type (label), Topic (label).
2. Image: Category (label), Colors (label). Weblink: Category, Topic. Audio: Duration, Origin, Category.
3. Label-type properties with an editable option set on built-in types.
4. Type settings: Page layout (Standard | Index card | Profile | Encyclopedia), Wide layout default, cover
   image mode and display, default card view, default list view (3 right-hand properties), default link view
   (Weblink defaults to Small Card with a Reset) (item 27). Check which Object already has before building.
5. "Add new object type" starter gallery: Meetings, People, Projects, Atomic notes, Definitions, Books, Films,
   TV series, Podcasts, Days, Weeks, Months, Organizations, Areas (catalog section 3).
6. Object -> Tag relations as first-class "status/category as a tag" (item 19), including the wiki import.

**B. Editor** (items 33-35, 39-43; catalog sections 2, 6)
7. Slash menu: the four groups and their order, "Create an object" rows per type (+ New Date), "Link to a
   date" presets (Time, Now, Today, Tomorrow, Yesterday, In a week, A week ago), footer hints.
8. `@` picker: recents with type icon and Collection badge, per-type rows with `>` to browse, filter on typing.
9. Selection toolbar (B I S U, lists, link, code, TeX, color, `+`, `@`), block-handle menu (Hierarchy, List,
   To-do, Quote, Toggle, Group, Turn into, Copy, Duplicate, Remove), bottom block-selection bar with the
   "N blocks . M words" stats.
10. Markdown shortcuts incl. `|` quote, `>` toggle, `a)` and `i)` lists, `()` icon block, combinable (catalog
    section 2); confirm each with real key events.
11. Inline date chip; inline tag chip; inline code token style; Icon block; emoji-heavy pasted content.
12. Focus mode while typing (chrome fades) and "Always open as full page" / "Always create inline links" /
    "Disable automatic detection of numbered lists" / spellcheck settings (item 15).
13. Rem-based editor sizing from a 15.5px root and a text-size setting (item 13).

**C. Shell, menus, palettes** (backlog 1-12 above; catalog sections 4, 8, 9)
14. New menu popover with Search and footer hints (backlog 1). Search palette (backlog 2).
15. Space switcher with a Search field (backlog 12). Sidebar type row hover count and `...` (backlog 7).
16. Object Types header `...`: Sort Manually | Sort Alphabetically; `+` opens the starter gallery.
17. Add Section form (icon + name). Pin to Sidebar submenu (backlog 6). Tab context menu (Pin to Sidebar,
    Pin Tab, Object Type Settings, Import).
18. Object `...` menu order, Share, Import, Copy >, Merge Into Object >, Change Type >, Text Stats >, shortcut
    hints (backlog 8, item 44).
19. Shortcuts panel (the arrow icon at the sidebar footer) with the full grouped list (catalog section 2);
    Object's registry is `frontend/src/lib/shortcuts.ts`.
20. Help & Resources sidebar section; Graph settings list (Show tags network, Filter / Exclude object types,
    Show completed tasks, Hide objects with many links, Hide dates, Hide indirect links) and zoom presets.

**D. Views and pages** (items 23-26; catalog sections 5, 8, 9)
21. Masonry cards; Wall cards with property rows and "Empty" placeholders; Tags type page chips with counts.
22. Table "Content" word-count column; row numbers; type page `...` menu (New from Template, New Collection,
    Pin to Sidebar, Object Type Settings, Export, Import) and tab `+`.
23. Overview tab: Recently Opened row, Collections tiles, "+ Collection", gear with Visible/Hidden sections
    incl. smart sections "Not in any collection", "Not tagged", "No backlinks".
24. Collection page in a peek with the parent-type chip and "+ New Object"; peek property pane toggle and
    "N / total" stepper; outline popover with Outline | Stats and a pin button; Stats fields.
25. Date picker (presets, Include Time, End Date, Remove, Cancel, Confirm); Object-property picker
    ("Search or Create", multi-select chips).

**E. Calendar** (backlog 3-5, 10; catalog section 10)
26. Month strip Jan-Dec and "+ New Object"; Week view's weekday colors and "+ Daily Note"; multi-day
    Reviewed/expand/`...`; Tasks `+` inside the pill; empty daily-note placeholders.

**F. Settings** (items 15, 16; catalog section 1)
27. Editor options not yet in Object; Language (decimal separator); Date & Time (time zone, formatting, start of
    week); Offline & Sync (content index recalculation, media loading); Full Export options; Space Settings.

**G. Export and import** (catalog section 10)
28. Export dialog: PDF styles and options, Markdown options (subpages zip, media, H1 title, wikilinks), Word,
    Latex. Import: starter migration guides per tool.

**H. Decisions for Gene**
- ~~Which Pro-gated Object features to unlock~~ Decided 2026-11-02: all unlocked, nothing gated (item 26). AI and
  the network integrations stay out by the spec.
- Whether the Object how-to guides should ship as built-in seeds in the Object app (currently only in the
  imported wiki space).
- Scrub credentials found in the Work and Personal spaces before any of it is imported or shared.

## Progress on the backlog (updated 2026-11-02, commits on `master`, not pushed)

| Backlog item | State | Commit |
|---|---|---|
| A1, A2 media fields (PDF, Image, Weblink, Audio) | done: added in memory like the Task fields, a stored definition wins, never written on read | `5f9215d` |
| C14 keyboard-hint footer ("up/down to navigate, Esc to abort, Enter to select") | done for the slash menu, New menu, link picker and search palette (the palette adds new tab and side panel) | `cbc84d3` |
| B7 "Link to a date" presets | done: In a week, A week ago added. Object's live list also names "Time" and "Now"; Object keeps its own "Today - date link" and "Now - timestamp" (reference strings), not renamed | `54a10c7` |
| B8 `@` picker | done: `@` at the start of a word (and `[[`) opens a popover at the caret: recent objects first, then a row per type with its count and a chevron that lists the type's objects (Backspace goes back), typing fuzzy-matches titles, keyboard-hint footer; the live "Collection" badge on collection rows is not built | `f4c6a89` |
| C18 object `...` menu shortcut hints | done for Find in page (Ctrl F), Present (Ctrl Alt P), Delete (Ctrl Backspace), read from the shortcut registry; the menu's order was already set to Object's sections on 2026-10-29. Export, Import and Pin to Sidebar have no registered key yet | `2dd693e` |
| C15 space switcher Search field | done: a Search field heads the list (replacing the "Spaces" heading) and filters by name | `d112222` |
| C17 Pin to Sidebar on a type's context menu; label capitalised ("Pin to Sidebar") everywhere | done | `553a88c` |
| New menu (backlog 1, C14) | done: a popover under the New button with a "Search" field, the types in the sidebar's order (alphabetical here), the keyboard-hint footer; picking a type creates an untitled object of it at once, as in the live app (the old second step, "Search or Create" with a typed title, remains only when a `typeId` is passed). Correction: backlog item 1 said "recent-use order"; the live order is the sidebar's | `243805f` |
| Sidebar: Graph below the object types, beside Trash | done (a second "Space" navigation landmark); "Add Section" still sits under Pinned, the live app puts it under the types | `7cfd501` |

Checked and already present in Object (so not backlog): Add Section, Graph customization options, the Shortcuts
sheet (Settings), slash menu groups and strings (taken from Object's own app), unlinked mentions.
Checked and also present: Wall cards are already masonry, the peek has the "N / total" stepper, the type page `...` menu has Pin, Collection, Import and settings.
Checked and still open: sidebar "Sort Manually | Sort Alphabetically" on the Object Types header (types are always
alphabetical), Help & Resources section (links to Object's web pages), the search palette
as one list, the Overview tab's hidden-section picker, the Table "Content" word-count column, "Add Section" under the types.

Gate after these eight commits: back end 1463 passed (1 pre-existing failure, `test_static_files_are_gzipped`,
also fails without these changes); front end 2321 passed; `tsc` clean; lint warnings only (pre-existing); build ok.
The app was also started on a copy of the imported wiki space and the sidebar checked in the browser pane.

## Remaining tasks (end of the 2026-11-02 session)

Everything not done, with the behaviour to match (catalog section in brackets) and a rough size (S: one component and a test; M: several files; L: a feature). Fix one per commit with a failing-first test; run the full gate before each commit. Unlinked mentions stay.

**Editor** (catalog 2, 6)
1. Selection toolbar to the live set: Bold, Italic, Strikethrough, Underline, lists, Link, Code, TeX, color, `+`, `@` (AI left out per the spec). M.
2. Block-handle menu: Hierarchy, List, To-do, Quote, Toggle, Group, Turn into..., Copy, Duplicate, Remove, with key hints. M.
3. Block-selection bar at the bottom: "N blocks . M words", formatting buttons, Turn blocks into, Tag, Move, delete, close. M.
4. Markdown shortcuts: confirm each with real key events (`|` quote, `>` toggle, `a)` and `i)` lists, `()` icon block, combinable); the debugger-typed test in the live app was inconclusive. S each.
5. Focus mode while typing (chrome fades until the pointer moves). S.
6. Rem-based editor sizing from a 15.5px root and a text-size setting. M.
7. Settings > Editor options Object lacks: spellcheck language, Always create inline links, Hide object type settings outside of settings, Highlight Style, startup per-space choice. M.

**Shell and menus** (catalog 4, 8, 9)
8. Sidebar Object Types header `...`: Sort Manually | Sort Alphabetically, with drag reordering for manual. M.
9. "Add Section" under the types; Help & Resources section (links to Object's pages; check the no-network rule first). S.
10. Search palette as one list: Today/Earlier groups, type at the right, Ctrl+Enter new tab, Shift+Enter side panel. M.
11. Object menu: Export, Import and Pin key hints (need registry entries), Share, Copy > submenu. S.
12. `@` picker: "Collection" badge on collection rows. S.
13. Tab context menu: Pin Tab. S.

**Views and pages** (catalog 5, 8, 9)
14. Table layout "Content" column ("N words" chip with an expand icon); row numbers. S.
15. Overview tab: the gear with Visible and Hidden Sections incl. "Not in any collection", "Not tagged", "No backlinks". M.
16. Tags type page: chips with counts. S.
17. Peek: property-pane toggle position and behaviour; Backlinks entries as embedded references with hover actions. M.

**Calendar** (catalog 10)
18. Month strip Jan-Dec and "+ New Object"; Week view weekday colors and "+ Daily Note"; multi-day Reviewed/expand/`...`; Tasks `+` inside the pill; empty daily-note placeholders. M.

**Data model** (catalog 1, 3; items 27-29)
19. Label-type properties with an editable option set on the media types (the fields exist; editing their options is the gap). M.
20. Type settings: Page layout (Standard | Index card | Profile | Encyclopedia), Wide default, cover image mode and display, default card/list/link view. Check what already exists first. M.
21. "Add new object type" starter gallery (Meetings, People, Projects, Atomic notes, Definitions, Books, Films, TV series, Podcasts, Days, Weeks, Months, Organizations, Areas). M.
22. Object -> Tag relations as first-class status/category, including the wiki import. M.

**Export and import** (catalog 1, 10)
23. Export dialog: PDF styles (Notes; Essay and Academic are Pro/Experimental), options, Markdown options (subpages zip, media, H1 title, wikilinks), Word and Latex. L.
24. Import: migration guides per tool. S.

**Settings pages** (catalog 1)
25. Language (decimal separator), Date & Time (time zone, format, start of week), Offline & Sync (index recalculation, media loading), Space Settings. Check what Object has. S-M.

**Decisions and housekeeping**
26. **Decided (Gene, 2026-11-02): unlock all Pro features, nothing gated.** The spec already said so ("Pro-only features are simply available"). Checked: Object has no gating, badge or upsell anywhere, and Tasks, Queries, version history, extended search, focus mode and unlinked mentions all exist. Do not copy Object's rocket badges, blurred previews or "Get Object Pro" cards. Left out by the spec because they need the cloud or a network, not because of Pro: AI (assistant, chat, AI block menu entries; a Claude Code agent comes later), integrations (calendar feeds, task actions that send to other apps, Readwise, Kindle, Telegram, WhatsApp, email, Raycast, the API) and accounts. If Gene wants any of those, it is a spec change first.
27. Decide whether the Object how-to guides ship as built-in seeds.
28. Investigate `test_static_files_are_gzipped` (fails on Windows `master`, also before these changes).
29. Gene's hands-on checks, M1-M9 (256 items), and wiki-import follow-ups (see `remaining-work.md`).

**Still to look at in Object** (the "Not yet poked" list below).

## Not yet poked

Opened but only partly read, or never opened (all would need a scratch view or a second scratch page to look at
safely): filter, sort and group editors; Customize card view and calculations; the Tasks page, Queries, AI
Chat, Explore panel contents (Pro-gated); Weblink and PDF viewers; image and file objects; Two Columns, Code,
Math, Toggle, Group and Horizontal line blocks (could not be inserted through the debugger); the Word and Latex
export tabs; Unlinked Mentions in Object (Pro; Object's own implementation is in M5); Three days view in
the second and third spaces; whiteboards (none in the spaces seen); drag and drop; the Android and web clients.
