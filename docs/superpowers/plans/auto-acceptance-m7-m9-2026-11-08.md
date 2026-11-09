# Automated acceptance pass: M7, M8, M9 (lane C1b, 2026-11-08)

Generated from `results.json` (lane C1b scratch). Gene's `mN-acceptance.md` boxes are NOT ticked; this file records what an agent could verify.

**Counts:** MANUAL 59, NOT-RUN 31, PARTIAL 8, PASS 16, SUPERSEDED 1 (total 115)

## How this was run

- Worktree `~/Objects-wt/lane-c1b`, branch `lane/c1b-acceptance-m7-m9` (off `lane/c1-acceptance-m1-m9`), frontend built from it.
- Headless server `BROWSER=/usr/bin/true OBJECT_STATE_DIR=<scratch>/state uv run objectapp --space <scratch>/spaces/<fixture> --port 8808 --browser`, on git-initialised copies of `space-blocks` (M7), `space-m8` (M8, M9) and `space-sample` (M9). File-safety boxes are judged with `git status` / `git diff -U0` in the copy.
- Browser: Chromium via CDP at 1440x900, DOM read with JS; clicks are real CDP mouse events, keys are CDP key events or synthetic `KeyboardEvent`s.
- Scripted acceptance re-run in this worktree (all PASS, logs in the lane scratch `acc/`): `m7_acceptance.py space-blocks` (23 checks), `m8_acceptance.py space-m8`, `m9_acceptance.py space-m8` and `space-sample`.
- Every edit adds a `lastUpdated` line change. The evidence below lists it as "+lastUpdated" and does not count it as an extra change.
- Headless pitfall: a background tab reports `document.visibilityState = hidden`, so Radix exit animations never finish and closed dialogs leave a click-blocking overlay. `Page.bringToFront` fixes it. This is a harness artefact, not an app bug.


## M7 (`docs/superpowers/plans/m7-acceptance.md`)

| Box | Check | Class | Result | Evidence |
|---|---|---|---|---|
| M7#1 | Opening the space changes no file. | AUTO | **PASS** | space-blocks copy (6 notes) served + every note opened via palette: `git status --porcelain` empty; script m7_acceptance check 0 (open twice) also run |
| M7#2 | Notes with HTML comments, Mermaid fences and `$` signs keep their bytes: `git status` is clean after opening and scrolling every note. | AUTO | **PASS** | Every block.md has 27 HTML comments, a mermaid fence, 8 `$`; opened + scrolled all 6 notes -> git status empty |
| M7#3 | Editing one block changes only its lines (`git diff`). | AUTO | **PASS** | lane C1 (same code): Same as M1#7 on space-sample copy (fixture, not CPI): editing one block changed only its line (+lastUpdated, +id) |
| M7#4 | Opening and closing a toggle changes one line. | AUTO | **PASS** | Toggle caret click: diff = one body line `<!-- toggle -->` -> `<!-- toggle open -->` (+ the lastUpdated stamp every edit writes); closing again restores it (only lastUpdated differs) |
| M7#5 | Changing a block's colour or alignment changes only its annotation line, and removing the style removes that line. | AUTO | **PARTIAL** | Alignment (block menu > Alignment > Text align center): diff = `<!-- block: icon=ph-star -->` -> `<!-- block: align=center icon=ph-star -->` (+lastUpdated); Ctrl+Shift+X (Remove block styles) deleted that annotation line only. Colour: moved from the block menu to the block-selection bar (911ba2f); its Color > Red text item did not apply under CDP/JS clicks (3 tries, file untouched) - colour path not verified, hand-check |
| M7#6 | Turning the last paragraph of a note into a list, or adding a block at the very end, keeps the file's final newline. This is known issue ... | AUTO | **PASS** | Embedded target.md: Ctrl+End, Enter, typed block -> file ends `...\n\nNew end block\n`; block menu > List > Bulleted on that last paragraph -> `- New end block\n` (one-line diff + lastUpdated); final newline kept both times |
| M7#7 | Uploading, pasting and dropping a file never overwrites an existing attachment. | AUTO | **PARTIAL** | Upload: m7_acceptance check 2 (this worktree) - same name again -> `Attachments/m7 pixel (2).png`, first file untouched. Paste: synthetic paste of a File `pixel.png` into Embedded target -> new `Attachments/pixel (2).png` + `![pixel](Attachments/pixel%20%282%29.png)`, `git diff -- Attachments` empty (original untouched). Drop: synthetic DragEvent drop was not handled by ProseMirror (no file, defaultPrevented=false) - harness limit, not verified |
| M7#8 | Removing a space from the list keeps its folder. | AUTO | **PASS** | UI (M7#33): More > Remove on a non-current space -> left /api/spaces, folder and files kept. API: m7_acceptance check 5 - remove 200, folder kept, removing the open space 409 |
| M7#9 | Hand-check the changed keys: side panel Ctrl+Shift+→, left sidebar Ctrl+Shift+←, calendar sidebar Ctrl+Alt+S, dark mode Ctrl+Shift+L, sho... | AUTO | **PASS** | CDP keys: Ctrl+Shift+→ side panel Show->Hide->Show; Ctrl+Shift+← sidebar 358px->none->358px; Ctrl+Alt+S on Calendar hides/shows "Calendar sidebar" (403px; writes only .object/ui.json hideCalendarSidebar); Ctrl+Shift+L data-theme dark->light->dark; Ctrl+Shift+B opens "Shortcuts" dialog; Ctrl+Shift+↑ opens the tab list ("Every block / Hand written"; by design only with 2+ tabs); Ctrl+←/→ and Ctrl+[/] move back/forward (Embedded target<->Every block); with a block selected Alt+↓ moved it down (diff: block lines moved), Ctrl+E toggled a code block, Ctrl+M made a `$$` math block. Inline Ctrl+M on selected text not driven |
| M7#10 | the side panel's area layout (and the narrow main column, issue 5) | MANUAL | **MANUAL** | Design/look judgement against the behaviour catalog (taste) |
| M7#11 | the breadcrumbs' position and look | MANUAL | **MANUAL** | Design/look judgement against the behaviour catalog (taste) |
| M7#12 | the look of pinned tabs | MANUAL | **MANUAL** | Design/look judgement against the behaviour catalog (taste) |
| M7#13 | the code preview's default ("Display") | MANUAL | **MANUAL** | Design/look judgement against the behaviour catalog (taste) |
| M7#14 | the column add and remove controls | MANUAL | **MANUAL** | Design/look judgement against the behaviour catalog (taste) |
| M7#15 | the PDF's default height | MANUAL | **MANUAL** | Design/look judgement against the behaviour catalog (taste) |
| M7#16 | the slash menu's grouping and look (order, icons, search-only colour and Mermaid items, descriptions as hover tooltips and the 22rem widt... | MANUAL | **MANUAL** | Design/look judgement against the behaviour catalog (taste) |
| M7#17 | the block menu's look (sections, labels, icons and the Hierarchy order Standard, Small, Heading 1–4 now follow the block menu spec: refer... | MANUAL | **MANUAL** | Design/look judgement against the behaviour catalog (taste) |
| M7#18 | the rules listed under "Rules the build chose" above | MANUAL | **MANUAL** | Design/look judgement against the behaviour catalog (taste) |
| M7#19 | every block kind from the slash menu, and its menus | AUTO | **PASS** | "/" opens "Create a block" etc.: 36 items in groups Create a block / Create an object / Link to a date / Reuse any content. Inserted Heading 2, Toggle, Quote block, Code, Math, Horizontal line, Table, To-do, Numbered list at the end of Embedded target -> file gained `<!-- toggle open -->`, `>`, a ``` fence, `$$`, `---`, a GFM table, `- [ ] `, `1. ` (an empty Heading 2 writes nothing). Each kind's own menus: table menu (M7#23), embed menu (M7#28), media (M7#25); the rest not opened one by one |
| M7#20 | the drag and `+` handles | AUTO | **PARTIAL** | `+` handle: inserts a paragraph and opens the slash menu (36 options); Escape leaves the typed "/" in the file. ⋮⋮ click selects the block and opens the block menu (used throughout). Dragging a block by ⋮⋮ needs native HTML5 drag (not driven) - MANUAL |
| M7#21 | block selection and copy | AUTO | **PARTIAL** | Block selection via ⋮⋮: selection bar "1 block · 5 words" with Bold..Color..Move..Delete; Ctrl+C put the text on the clipboard (navigator.clipboard.readText). Shift+click to extend became a text selection under CDP (bar gone) - extension not confirmed, hand-check |
| M7#22 | resizing columns | AUTO | **PASS** | Dragging the columns-divider +80px: one line `<!-- columns widths=40,60 -->` -> `<!-- columns widths=54,46 -->` (+lastUpdated); Column layout / Add column / Remove column controls present |
| M7#23 | a table's header row and header column | AUTO | **PASS** | Table: cell toolbar Alignment \| Edit row \| Edit column \| Edit table; Edit table = Header row \| Header column \| Clear cell contents \| Export as CSV \| Delete table; toggling Header row: `<!-- block: header-column -->` -> `<!-- block: header-column no-header-row -->` (one line) |
| M7#24 | a Mermaid diagram and a formula, in light and in dark | AUTO | **PARTIAL** | Renders in both themes: Mermaid svg present, 6 KaTeX nodes, in dark and after Ctrl+Shift+L light. Whether they LOOK right in each theme is MANUAL |
| M7#25 | an image resized with a caption | AUTO | **PASS** | Dragging the image's right resize handle -60px: `<!-- block: width=120 align=center caption="A \"tiny\" pixel" -->` -> `<!-- block: align=center width=48 caption=... -->` (one line, keys reordered); caption kept and shown |
| M7#26 | a PDF, audio and video | AUTO | **PASS** | Every block media: IMG pixel.png, IFRAME report.pdf, AUDIO clip.wav, VIDEO clip.mp4, xlsx file chip; Range fetch of each src -> 206 with image/png, application/pdf, audio/wav, video/mp4. Playback itself MANUAL |
| M7#27 | a file opened with the OS | AUTO | **PARTIAL** | m7_acceptance check 2: POST /api/attachments/open records the PDF with the fake opener; an uploaded .exe -> 415, nothing launched. The real OS hand-off (Windows shell) is MANUAL |
| M7#28 | an embedded object switched between its four views | AUTO | **PASS** | Embed block menu: Link block \| Small card \| Wide card \| Embed \| Turn into inline link \| Remove Block; switching wrote one line each: view=smallCard, view=inline, view=embed, back to view=wideCard (net diff empty) |
| M7#29 | files pasted and dropped | AUTO | **PARTIAL** | Paste of a File into the editor -> uploaded as `Attachments/pixel (2).png` + image block. Drop: synthetic DragEvent not handled (harness), not verified - see M7#7 |
| M7#30 | tabs (persistent, pinned, the tab menu) | AUTO | **PASS** | New tab + palette open -> 2 tabs; tab context menu "Pin tab \| Close tab"; pinned tab has no close button, its menu is only "Unpin tab", synthetic Ctrl+W and a middle click leave it; after a page reload the tabs (Every block, Hand written) are restored |
| M7#31 | breadcrumbs | AUTO | **PASS** | Ctrl+click on the [[Embedded target]] chip in Every block opened a new tab with nav[aria-label=Breadcrumbs] "Every block / Embedded target"; plain click opens the peek (catalog). Crumb overflow menu (>3) not driven |
| M7#32 | the side panel (Shift+click, three areas, resizing, swap, the calendar sidebar inside the Calendar) | AUTO | **PARTIAL** | Shift+click on the embedded Ada Lovelace card opened the side panel (483px); dragging "Resize side panel" -150px -> 782px, double-click -> back to 483px; "Open sidepanel menu" = Move to area 1/2/3, Close; Swap put Ada in the main tab and Every block in the panel; Calendar sidebar toggles (see M7#9). FINDING: Shift+click on an inline wikilink chip opens the PEEK, not the side panel (links/wikilinkPresenter.ts onClick has no shiftKey branch), against catalog Navigation "Open in side panel (Shift+Click)" |
| M7#33 | creating, renaming, switching and removing a space in the window (the launcher restarts on the same port) | AUTO | **PASS** | Spaces menu > Create space (name "c1b new space", Empty space, default location = parent folder) -> folder with only .object/space.json; "Space created. Switch to it now?" > Switch space -> same port 8808 now serves it (/api/space root = new folder); Space settings Name -> space.json {"name": "c1b renamed"}, folder name unchanged; switching back via the menu entry works; More > Remove ("Object forgets this space. Its folder and files stay where they are.") -> gone from /api/spaces, folder kept |
| M7#34 | the app shell and sidebar (section headings, "+ New" and search, footer) | MANUAL | **MANUAL** | Visual fidelity pass in Light/Dark/Dimmed (visual theme comparison) |
| M7#35 | the tab strip and tab menu | MANUAL | **MANUAL** | Visual fidelity pass in Light/Dark/Dimmed (visual theme comparison) |
| M7#36 | breadcrumbs | MANUAL | **MANUAL** | Visual fidelity pass in Light/Dark/Dimmed (visual theme comparison) |
| M7#37 | the side panel | MANUAL | **MANUAL** | Visual fidelity pass in Light/Dark/Dimmed (visual theme comparison) |
| M7#38 | the object page in each layout (standard, profile, index card, encyclopedia) | MANUAL | **MANUAL** | Visual fidelity pass in Light/Dark/Dimmed (visual theme comparison) |
| M7#39 | the peek, with its pager and property panel | MANUAL | **MANUAL** | Visual fidelity pass in Light/Dark/Dimmed (visual theme comparison) |
| M7#40 | the `…` menus | MANUAL | **MANUAL** | Visual fidelity pass in Light/Dark/Dimmed (visual theme comparison) |
| M7#41 | the editor (every block kind, the slash menu, handles, the block menu, block selection) | MANUAL | **MANUAL** | Visual fidelity pass in Light/Dark/Dimmed (visual theme comparison) |
| M7#42 | the type page, Overview and All, in every view layout: list, grid, wall, table, embed, kanban, gallery | MANUAL | **MANUAL** | Visual fidelity pass in Light/Dark/Dimmed (visual theme comparison) |
| M7#43 | the filter, sort and group-by popovers | MANUAL | **MANUAL** | Visual fidelity pass in Light/Dark/Dimmed (visual theme comparison) |
| M7#44 | card settings | MANUAL | **MANUAL** | Visual fidelity pass in Light/Dark/Dimmed (visual theme comparison) |
| M7#45 | collections and their pages | MANUAL | **MANUAL** | Visual fidelity pass in Light/Dark/Dimmed (visual theme comparison) |
| M7#46 | queries and the Queries page | MANUAL | **MANUAL** | Visual fidelity pass in Light/Dark/Dimmed (visual theme comparison) |
| M7#47 | All notes | MANUAL | **MANUAL** | Visual look (theme comparison). Note: All notes left the sidebar in the 2026-11-08 redesign (catalog §4); it opens from the palette "Open all notes" on this branch |
| M7#48 | Trash | MANUAL | **MANUAL** | Visual fidelity pass in Light/Dark/Dimmed (visual theme comparison) |
| M7#49 | Object Type Settings and the property menus | MANUAL | **MANUAL** | Visual fidelity pass in Light/Dark/Dimmed (visual theme comparison) |
| M7#50 | the Calendar (Month, Week, Three days, Day, the mini month and the calendar sidebar) | MANUAL | **MANUAL** | Visual fidelity pass in Light/Dark/Dimmed (visual theme comparison) |
| M7#51 | the Tasks page (list and kanban) | MANUAL | **SUPERSEDED** | SUPERSEDED (2026-11-08 redesign, catalog §4): the Tasks page with list/kanban tabs is gone; sidebar Tasks opens the Tasks dashboard (list views under More views). Look of the new dashboard is MANUAL |
| M7#52 | the command palette, search and find in page (M5) | MANUAL | **MANUAL** | Visual fidelity pass in Light/Dark/Dimmed (visual theme comparison) |
| M7#53 | the references section and the graph (M5) | MANUAL | **MANUAL** | Visual fidelity pass in Light/Dark/Dimmed (visual theme comparison) |
| M7#54 | whiteboards and the pen (M6) | MANUAL | **MANUAL** | Visual fidelity pass in Light/Dark/Dimmed (visual theme comparison) |
| M7#55 | the Settings modal (every section) | MANUAL | **MANUAL** | Visual fidelity pass in Light/Dark/Dimmed (visual theme comparison) |
| M7#56 | the spaces menu and the create-space dialog | MANUAL | **MANUAL** | Visual fidelity pass in Light/Dark/Dimmed (visual theme comparison) |

## M8 (`docs/superpowers/plans/m8-acceptance.md`)

| Box | Check | Class | Result | Evidence |
|---|---|---|---|---|
| M8#1 | Opening the space changes nothing (`git status` clean after opening and scrolling every note). | ? | **NOT-RUN** | not reached |
| M8#2 | Notes with `<span>`, `<mark>`, `<time>`, `^ids` or `![[…#^…]]` keep their bytes. | ? | **NOT-RUN** | not reached |
| M8#3 | Copying a block reference changes one line (the block's last line gains ` ^id`). | ? | **NOT-RUN** | not reached |
| M8#4 | A merge does what the plan says and nothing more: target values, appended body, relinked referrers, source in the trash and restorable. | ? | **NOT-RUN** | not reached |
| M8#5 | A history restore does what the plan says and nothing more: the bytes come back, and `id`, `title` and the file name are kept. | ? | **NOT-RUN** | not reached |
| M8#6 | A space delete does what the plan says and nothing more. It refuses the current space, and the folder goes to the Recycle Bin. | ? | **NOT-RUN** | not reached |
| M8#7 | History stays outside the space: nothing new under the space folder; versions are in the state dir. | ? | **NOT-RUN** | not reached |
| M8#8 | Still ours, for Gene: Tab/Shift-Tab indent in any block, extended search Ctrl/Cmd+Shift+Enter. | MANUAL | **MANUAL** | Key choice is Gene's call (ours: Tab/Shift-Tab indent, Ctrl/Cmd+Shift+Enter extended search) |
| M8#9 | The storage forms: the occurrence log, the `reminders` map, inline HTML styles, date tokens, `indent`, item comments, `collection:`/`quer... | MANUAL | **MANUAL** | "Our choice" rule for Gene to confirm against the catalog (design decision) |
| M8#10 | The overdue threshold (two or more) and the catch-up readings. | MANUAL | **MANUAL** | "Our choice" rule for Gene to confirm against the catalog (design decision) |
| M8#11 | The stats start (first log entry or `createdAt`) and the grid size (26 + 4). | MANUAL | **MANUAL** | "Our choice" rule for Gene to confirm against the catalog (design decision) |
| M8#12 | The version rules (5 minutes, 200, title kept). | MANUAL | **MANUAL** | "Our choice" rule for Gene to confirm against the catalog (design decision) |
| M8#13 | Merge's dropped properties and the 5,000 limit. | MANUAL | **MANUAL** | "Our choice" rule for Gene to confirm against the catalog (design decision) |
| M8#14 | Deleting only non-current spaces. | MANUAL | **MANUAL** | "Our choice" rule for Gene to confirm against the catalog (design decision) |
| M8#15 | The basic-setup property kinds. | MANUAL | **MANUAL** | "Our choice" rule for Gene to confirm against the catalog (design decision) |
| M8#16 | The focus presets. | MANUAL | **MANUAL** | "Our choice" rule for Gene to confirm against the catalog (design decision) |
| M8#17 | The slide-splitting rule and the left-out presentation rows. | MANUAL | **MANUAL** | "Our choice" rule for Gene to confirm against the catalog (design decision) |
| M8#18 | The timeline's contents. | MANUAL | **MANUAL** | "Our choice" rule for Gene to confirm against the catalog (design decision) |
| M8#19 | Day backlinks without a note. | MANUAL | **MANUAL** | "Our choice" rule for Gene to confirm against the catalog (design decision) |
| M8#20 | The extended search key. | MANUAL | **MANUAL** | "Our choice" rule for Gene to confirm against the catalog (design decision) |
| M8#21 | URLs pasted as bookmark pages. | MANUAL | **MANUAL** | "Our choice" rule for Gene to confirm against the catalog (design decision) |
| M8#22 | The inspector's Stats. | MANUAL | **MANUAL** | "Our choice" rule for Gene to confirm against the catalog (design decision) |
| M8#23 | Quick-create "Nothing". | MANUAL | **MANUAL** | "Our choice" rule for Gene to confirm against the catalog (design decision) |
| M8#24 | The formula row numbering, and "Value" for an error. (Row numbering from 1 at the header row is settled; `$` absolute references, whole-c... | MANUAL | **MANUAL** | "Our choice" rule for Gene to confirm against the catalog (design decision) |
| M8#25 | The Turn-into embed view. | MANUAL | **MANUAL** | "Our choice" rule for Gene to confirm against the catalog (design decision) |
| M8#26 | The typed-date phrases. | MANUAL | **MANUAL** | "Our choice" rule for Gene to confirm against the catalog (design decision) |
| M8#27 | Ink tilt and partial erase. | MANUAL | **MANUAL** | "Our choice" rule for Gene to confirm against the catalog (design decision) |
| M8#28 | Everything else under "Rules the build chose" above. | MANUAL | **MANUAL** | "Our choice" rule for Gene to confirm against the catalog (design decision) |
| M8#29 | Wacom pen tilt changes the stroke as expected. | MANUAL | **MANUAL** | Windows hardware: Wacom pen tilt |
| M8#30 | The microphone prompt appears in the pywebview window, and recording, pausing, stopping and playback work. | MANUAL | **MANUAL** | Windows pywebview microphone permission + recording |
| M8#31 | The clipboard read prompt for the palette's paste actions. | MANUAL | **MANUAL** | Clipboard-read permission prompt (pywebview) |
| M8#32 | Deleting a space goes to the Recycle Bin, and the permanent delete works when the bin is unavailable. | MANUAL | **MANUAL** | Windows Recycle Bin. Server side verified by m8_acceptance check 6: delete -> {"trashed": true} via the trash hook; trash unavailable -> 428 (folder kept), then permanent -> 200 {"trashed": false}, folder gone |
| M8#33 | Skip and Excuse from the checkbox menu, the overdue dialog (all choices), the custom repeat "On" row, and a reminder on a deadline. | ? | **NOT-RUN** | not reached |
| M8#34 | The Completion Log under Task Stats (deleting one entry changes only its line), and "Remove date" on a recurring task with history asking... | ? | **NOT-RUN** | not reached |
| M8#35 | Save as Query, the palette's paste and space actions, backlink modes and the backlinks side panel (drag to swap), graph PNG export, and f... | ? | **NOT-RUN** | not reached |
| M8#36 | The merge dialog (object and tag), and version history with preview and restore. | ? | **NOT-RUN** | not reached |
| M8#37 | Whiteboards: | ? | **NOT-RUN** | not reached |
| M8#38 | The editor: | ? | **NOT-RUN** | not reached |
| M8#39 | Focus mode and its timer, Present, and the Language, Date & Time (time zone, decimal separator), Editor and Space settings. | ? | **NOT-RUN** | not reached |
| M8#40 | Every M8 screen checked against the spec and catalog, in Light and Dark. | MANUAL | **MANUAL** | Visual look in Light/Dark |

## M9 (`docs/superpowers/plans/m9-acceptance.md`)

| Box | Check | Class | Result | Evidence |
|---|---|---|---|---|
| M9#1 | Opening the space, exporting and reading stats change nothing (`git status` clean). | ? | **NOT-RUN** | not reached |
| M9#2 | Duplicate a page, a task and a tag: the copies are named "<Title> (Copy)" and the source is untouched. Duplicating an object with a two-w... | ? | **NOT-RUN** | not reached |
| M9#3 | Export a page as Markdown, then with "Include media": the zip opens, and images and attachments are inside (including `![[name.png]]` sho... | ? | **NOT-RUN** | not reached |
| M9#4 | Text Stats in the `…` menu and the inspector's Stats tab give the expected counts on the same note (words, sentences, paragraphs, charact... | ? | **NOT-RUN** | not reached |
| M9#5 | The page inspector: the Outline jumps to headings, and Pin/Unpin is remembered. | ? | **NOT-RUN** | not reached |
| M9#6 | Wide layout / Normal layout per object overrides the type. Toggling the wide cover and repositioning the cover (drag, Save, Cancel) look ... | ? | **NOT-RUN** | not reached |
| M9#7 | Content property: the full block editor works in the property panel. A note edited there reloads identically. | ? | **NOT-RUN** | not reached |
| M9#8 | Text property: `[[` opens the picker, links show as chips, and renaming the target updates the link. | ? | **NOT-RUN** | not reached |
| M9#9 | Template date variables: "Day/Week/Month/Year of creation" on a template's date property; a new object from it gets the right date or range. | ? | **NOT-RUN** | not reached |
| M9#10 | An embedded collection and an embedded query: change the layout, filter, sort and group, close and reopen, and they are kept. The note's ... | ? | **NOT-RUN** | not reached |
| M9#11 | Alignment in the block menu and in the table bar. | ? | **NOT-RUN** | not reached |
| M9#12 | The row menu on a type page, a type dashboard section and a query page; Select multiple; bulk change type, open in side panel and delete. | ? | **NOT-RUN** | not reached |
| M9#13 | Import CSV into a type (with and without a header row, and a new collection); the warning shows. | ? | **NOT-RUN** | not reached |
| M9#14 | A single-type query tab: the type is locked and the release button works. | ? | **NOT-RUN** | not reached |
| M9#15 | Sidebar sections: drag to reorder, restart, and the order is kept. | ? | **NOT-RUN** | not reached |
| M9#16 | "Rebuild search index" (Settings > Offline & Sync) runs and the indexing state shows. | ? | **NOT-RUN** | not reached |
| M9#17 | Draw on a whiteboard: its "Last updated" moves, at most once a minute. The board's Notes still save. | ? | **NOT-RUN** | not reached |
| M9#18 | Every rule in "Rules the build chose", against the behaviour catalog. | MANUAL | **MANUAL** | Rules for Gene to confirm against the catalog |
| M9#19 | The look of every M9 screen against the spec and catalog, in Light and Dark. | MANUAL | **MANUAL** | Visual look in Light/Dark |

