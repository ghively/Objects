# UI polish audit, 2026-11-02

Gene asked to check every button and interaction against Capacities. Method: Claude drove Gene's own
Capacities tab (Microsoft Edge, the CPI space, 1912x901) through the browser tool's CDP attach, read-only:
opened menus, popovers and views and closed them without choosing anything; nothing was created or
changed, and the view was put back to Day afterwards. Object was then opened at the same width and
compared control by control. Saved references: `docs/ui-reference/01-calendar-day.png`,
`02-calendar-three-days.png`.

## Fixed (commits on `master`, not yet pushed)

| Area | Capacities | Object before | Now |
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

1. **New menu**: Capacities opens a popover anchored under the New button, with a "Search" field, the types
   in recent-use order, and a footer "up/down to navigate, Esc to abort, Enter to select". Object opens a
   centred modal with an alphabetical list.
2. **Search palette**: placeholder "Search for content and actions, or paste from clipboard" with an info
   icon; recents grouped "Today" / "Earlier" with each item's type at the right; footer lists Ctrl+Enter
   (new tab) and Shift+Enter (side panel); content and actions are one list. Object has "Search content",
   an empty state until objects are opened, and a separate "Switch to actions" mode.
3. **Month view**: a Jan-Dec strip with the current month highlighted above the cards, and a "+ New Object"
   row under them. Object shows the cards only.
4. **Multi-day views (Week, Three days)**: for an existing note Capacities puts Reviewed, an expand icon and
   `...` on the date row. Object shows nothing there.
5. **Tasks section**: the `+` is the last control inside the toolbar pill; Object draws it outside, left of
   the pill.
6. **Type menu, "Pin to Sidebar >"**: submenu of the sidebar sections ("In Progress", "Pinned") with
   checkboxes. Object has pinning on other menus (`PinMenuItems`) but built from dropdown primitives, not
   the context-menu ones.
7. **Sidebar type row**: Capacities shows the count and a `...` button on hover/active; Object shows the
   count always and no `...`.
8. **Object `...` menu order and entries**: Capacities: Wide Layout, Open >, Use Template >, Object Type
   Settings, Share, Present (Ctrl Alt P), Export (Ctrl E), Import (Ctrl I), Version History, Text Stats >,
   Copy >, Delete Object (Ctrl Backspace). Object has the same actions in another order, no Share, Import
   or Copy >, and no shortcut hints beside most.
9. **Type page, All tab**: a "+ New Object" row under the cards; cards show an "Empty" tags row when there
   are none.
10. **Empty daily note**: Capacities shows "Tags" and "Text" placeholders. Only the empty state was seen;
    what happens on focus is unknown.
11. **Quick-create chips**: Capacities shows Task, Meeting, Project (a chosen set); Object shows every type
    plus an eye toggle. Probably a Settings choice in Capacities; not checked.
12. **Workspace switcher**: Capacities: popover with a "Search" field, the spaces with a check on the
    current one, and "+ Create space". Object: a "Spaces" header instead of a search field, the list with
    a check, then "Space settings", "Add space" and "Open folder..." (the folder entries are local-app
    needs Capacities doesn't have; the search field is the gap).

## Second pass: object page, editor, Settings (read-only)

13. **Editor sizing**: Capacities sizes the editor in `rem` from a 15.5px root (no zoom, DPR 1). Full-page
    People guide: H2 20.34px/700, body 15.5px on a 23.25px line, a 705px text column. Object's editor uses a
    fixed 17px base and has no text-size setting; a rem-based scale plus a setting would match.
14. **Object page header**: type pill (e.g. "Person") + a "Collections" chip above the title, emoji icons in
    the title, a "Tags" row under it, then the body. Properties live in a side pane (Contact, Category,
    "Add Property", each "Empty" when unset); the outline is a dash ladder at the right edge.
15. **Settings > Editor** (all missing from Object): Disable spellcheck; Spellcheck language
    (Experimental); Always open as full page; Always create inline links; backlink display (Only block with
    backlink / Full path above); Hide object type settings outside of settings; Hide outliner lines; Toggle
    style (Toggle | Bullet); Hide App Menu; When Capacities starts (space on this device: Last opened | Specific;
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
18. **How-to guides**: Capacities ships guide objects ("How to Use This People Object", Meeting, Project).
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
20. **Tags are flat facets**: 102, mostly used once; client/org ("Ecard" 15), technology (Linux 5, Wifi 5),
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

## Not yet poked

Tasks page, Graph, Trash, typing behaviour (slash menu, `[[` picker, @mentions, markdown shortcuts, block
handles, selection toolbar), whiteboards, the side panel, the tab context menu, row context menus in lists
and tables, drag and drop, keyboard shortcuts. Typing tests need the one scratch page Gene allowed; not
created yet.
