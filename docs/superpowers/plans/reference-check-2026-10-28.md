# Check of Object's guessed values (2026-10-28)

Each value below was a guess at the time of M7/M8 (marked "our choice" in the acceptance docs). This check settles the target value for each one and lists the change needed in Object. Paths that start with `frontend/` or `backend/` are Object's.

Read-only research. No repo file was changed.

---

## 1. Keyboard shortcuts

### The target table

The Shortcuts sheet renders one table per category (`calendar`, `text`, `block`, `page`, `navigation`, `global`, `markdown`, `aiAssistant`, `table`, `date`, `appmenu`, `taskManagement`, `pdf`, `whiteboard`, `weblink`), each row giving a Windows and a Mac key. The real handlers agree with the table, for example:
- calendar sidebar: Ctrl+Alt+S (Cmd+Alt+S on Mac).
- whiteboard tools: V select, H hand, T text, R rectangle, O ellipse, P triangle, F frame, L line, Shift+L arrow.
The editor rows rely on the table alone.

Actions with a name but **no row in the table**, so no key is shown for them: `heading1`–`heading4`, `toDo`, `toggle`, `textAlignLeft/Center/Right`, `openCommandPalette`, `goToPreviousHigherUnit`, `goToNextHigherUnit` (for example heading1 is "Turn selected blocks into heading 1", with no key).

Notation: Win = the Windows key, Mac = the Mac key. `Mod` in Object = Ctrl on Windows and Cmd on Mac.

### Table: action | Object key | target key | verdict

| id (action) | Object (`frontend/src/lib/shortcuts.ts` unless noted) | Target (Win / Mac) | Verdict |
|---|---|---|---|
| bold | Mod-b | Ctrl+B / ⌘B | match |
| italic | Mod-i | Ctrl+I / ⌘I | match |
| underline | Mod-u | Ctrl+U / ⌘U | match |
| strikethrough | Mod-Shift-s | Ctrl+⇧+S / ⇧⌘S | match |
| codeToken | Mod-e | Ctrl+E / ⌘E | match |
| mathToken | Mod-Shift-m | **Ctrl+M / ⌘M** | change |
| linkToken | (none) | Ctrl+K / ⌘K (text editing) | missing in Object (Object's Mod-k opens search) |
| highlightText | Mod-Shift-h (also `editor/shortcuts.ts`) | Ctrl+⇧+H / ⇧⌘H | match |
| heading1–4 | Mod-Alt-1…4 | none listed (markdown `#`…`####`+Space only) | change: no key |
| toDo | Mod-Alt-t | none listed (`[]`+Space) | change: no key |
| toggle | Mod-Alt-g | none listed (`>`+Space) | change: no key |
| toggleCodeBlock | Mod-Alt-c | **Ctrl+E / ⌘E** (block selection) | change |
| toggleMathBlock | Mod-Alt-m | **Ctrl+M / ⌘M** (block selection) | change |
| textAlignLeft/Center/Right | Mod-Shift-l / e / r | none listed | change: no key |
| selectActiveBlock | Escape | Esc or Ctrl+A / Esc or ⌘A | match (Ctrl+A also listed) |
| expandBlockSelectionUpwards / Downwards | Shift-ArrowUp / Down | ⇧↑ / ⇧↓ | match |
| selectAllBlocks | Mod-a | Ctrl+A / ⌘A | match |
| deleteBlocks | Backspace, Delete | ⌫ | match (Delete is extra) |
| duplicateBlocks | Mod-d | Ctrl+D / ⌘D | match |
| copyBlocksAsMarkdown | Mod-Shift-c | Ctrl+Shift+C / ⌘⇧C | match |
| moveSelectedBlocksUp / Down | Mod-Shift-ArrowUp / Down | **Alt+↑ / Alt+↓** (⌥↑ / ⌥↓) | change |
| (moveSelectedBlocksUp/DownOnSameLevel) | none | ⇧+Alt+↑ / ↓ | missing in Object |
| (moveUp/DownBlockWithCursor) | none | Alt+↑ / Alt+↓ (cursor in block) | missing in Object |
| indentBlocks / unindentBlocks | Tab / Shift-Tab | ⇥ / ⇧⇥ | match |
| toggleTodoInBlockWithCursor | Mod-Enter | Ctrl+↵ / ⌘↵ | match |
| toggleToggleInBlockWithCursor | Mod-Shift-Enter | Ctrl+↵ **or** Ctrl+⇧+↵ | partial: add Mod-Enter (when the block has no to-do), as the action's name says |
| insertBlockAbove | Alt-Shift-Enter | Alt+⇧+↵ / ⇧⌥↵ | match |
| insertBlockBelow | Alt-Enter | Alt+↵ / ⌥↵ | match |
| copyBlockReference | Mod-Alt-r (also `editor/shortcuts.ts`) | **Ctrl+Alt+L / ^⌘L** | change (on Mac it is Ctrl+Cmd, not Cmd+Alt) |
| turnIntoObject | Mod-Alt-o (also `editor/shortcuts.ts`) | **I** (no modifier, block selection) | change |
| turnIntoTask | Mod-Alt-k (also `editor/shortcuts.ts`) | markdown `()`+Space | change: no key |
| turnBlockIntoTaskObject | Mod-Alt-Shift-k (also `editor/shortcuts.ts`) | **Ctrl+Shift+T / ⌘⇧T** | change |
| closeTab | Mod-w | Ctrl+W / ⌘W | match |
| openNewTab | Mod-t | Ctrl+T / ⌘T (desktop app only) | match |
| navigateTabs | Ctrl-Tab | Ctrl+Tab / ^Tab (not in the browser build) | match for a browser app |
| openTabList | Mod-Shift-a | **Ctrl+⇧+↑ / ⌘⇧↑** | change (Ctrl+Shift+A is `toggleChecklistMenu`) |
| navigateBack | Alt-ArrowLeft | **Ctrl+← or Ctrl+[** (⌘← or ⌘[) | change |
| navigateForward | Alt-ArrowRight | **Ctrl+→ or Ctrl+]** (⌘→ or ⌘]) | change |
| toggleSidepanel | Mod-Shift-\\ | **Ctrl+⇧+→ / ⇧⌘→** | change |
| toggleLeftSidebar | Mod-\\ | **Ctrl+⇧+← / ⇧⌘←** | change |
| toggleCalendarSidebar | Mod-Shift-y | **Ctrl+Alt+S / ⌥⌘S** | change (Ctrl+⇧+Y is `openMinigame`) |
| toggleDarkMode | Mod-Shift-d (also `theme/shortcuts.ts`) | **Ctrl+⇧+L / ⇧⌘L** | change |
| openSettings | Mod-, | Ctrl+, / ⌘, | match |
| toggleShortcutsMenu | Mod-/ | **Ctrl+⇧+B / ⇧⌘B** | change |
| openSearchPalette | Mod-k (`palette/CommandPalette.tsx` line ~71) | Ctrl+P **or** Ctrl+K | partial: Ctrl+P should also open search |
| openCommandPalette | Mod-p | none listed | change: Mod-p belongs to search; no key is listed for the action palette |
| (openLocalQuery) | none | Ctrl+⇧+P / ⌘⇧P | missing in Object |
| findInPage / openFindInPage | Mod-f | Ctrl+F / ⌘F | match |
| openAddEntityMenu | Mod-u | Ctrl+U / ⌘U | match |
| createNewEntityOfType | Mod-n | Ctrl+N / ⌘N (desktop app) | match |
| deleteCurrentPage | Mod-Backspace | Ctrl+⌫ / ⌘⌫ | match |
| toggleFocusMode | Mod-Shift-f | **Ctrl+⇧+M / ⇧⌘M** | change |
| openPresentationMode | Mod-Alt-p | Ctrl+Alt+P / **^⌘P** | Windows match; Mac differs (Ctrl+Cmd) |
| exit / next / previous slide | Escape / ArrowRight / ArrowLeft | Esc / → / ← | match |
| undo / redo | Mod-z / Mod-Shift-z, Mod-y | Ctrl+Z / Ctrl+⇧+Z or Ctrl+Y | match |
| calendar: month / week / rolling / day / today | m / w / r / d / t | M / W / R / D / T | match |
| goToPrevious / goToNext | ArrowLeft / ArrowRight | ⇦ / ⇨ | match |
| goToPreviousHigherUnit / goToNextHigherUnit | ArrowUp / ArrowDown | none listed | no key in the table (keep or drop: Gene's call) |
| whiteboardSelect / Hand / Text / Line | v / h / t / l | V / H / T / L | match |
| whiteboardArrow | a (`whiteboard/shortcuts.ts` `case 'a'`) | **⇧+L** | change |
| whiteboardRectangle / Ellipse / Frame | r / o / f | R / O / F | match |
| whiteboardTriangle | Shift-r | **P** | change |
| whiteboardPen (ours) | p | P is Triangle | conflict: free `p` |
| whiteboardHighlighter (ours) | m | M (no modifier) opens the move menu | conflict |
| whiteboardEraser (ours) | e | none | no target key (ours) |
| whiteboardBringForward / SendBackward | Mod-] / Mod-[ | Ctrl+] / Ctrl+[ | match |
| whiteboardBringToFront | Mod-Shift-] | **]** (no modifier) | change |
| whiteboardSendToBack | Mod-Shift-[ | **[** (no modifier) | change |
| whiteboardWrapInFrame | Mod-Alt-g | **Ctrl+G / ⌘G** | change |
| whiteboardZoomIn / Out / Reset | Mod-= / Mod-- / Mod-0 | Ctrl++ / Ctrl+- / Ctrl+0 | match (Object's handler also takes `+`) |
| whiteboardFitAll / FitSelection | Shift-1 / Shift-2 | ⇧1 / ⇧2 | match |
| whiteboardDuplicate | Mod-d | Ctrl+D | match |
| whiteboardNudge / NudgeLarge (keys) | Arrows / Shift-Arrows | ↑↓←→ / ⇧+arrows | match |
| whiteboardResize / ResizeLarge | Mod-Alt-Arrow / Mod-Alt-Shift-Arrow | **Ctrl+Arrow / Ctrl+⇧+Arrow** | change |
| whiteboardFlipHorizontal / Vertical | Shift-h / Shift-v | ⇧H / ⇧V | match |
| whiteboardCycle / CycleBack | Tab / Shift-Tab | Tab / ⇧Tab | match |
| whiteboardPan | Space | Space | match |

### Change needed

Files: `frontend/src/lib/shortcuts.ts` (the registry), `frontend/src/editor/shortcuts.ts` (`M8_EDITOR_SHORTCUTS` repeats five keys), `frontend/src/theme/shortcuts.ts` (repeats `toggleDarkMode`), `frontend/src/palette/CommandPalette.tsx` (hard-coded `k`/`p`), `frontend/src/whiteboard/shortcuts.ts` (`keyToCommand` is hard-coded). Each row is: current value → correct value.
1. mathToken: `Mod-Shift-m` → `Mod-m`.
2. toggleCodeBlock: `Mod-Alt-c` → `Mod-e` while blocks are selected (Ctrl+E with a text selection stays codeToken).
3. toggleMathBlock: `Mod-Alt-m` → `Mod-m` while blocks are selected.
4. moveSelectedBlocksUp/Down: `Mod-Shift-ArrowUp/Down` → `Alt-ArrowUp/Down`. Also add `Alt-Shift-ArrowUp/Down` (on the same level) and Alt+↑/↓ with the cursor in a block (`moveUpBlockWithCursor`).
5. toggleToggleInBlockWithCursor: add `Mod-Enter` beside `Mod-Shift-Enter`.
6. copyBlockReference: `Mod-Alt-r` → Ctrl+Alt+L on Windows, Ctrl+Cmd+L on Mac. The registry has no per-platform key, so `Mod-Alt-l` is right on Windows only.
7. turnIntoObject: `Mod-Alt-o` → `i` while blocks are selected.
8. turnBlockIntoTaskObject: `Mod-Alt-Shift-k` → `Mod-Shift-t`.
9. turnIntoTask: drop `Mod-Alt-k`. The only trigger is the markdown `()` + Space.
10. heading1–4, toDo, toggle, textAlignLeft/Center/Right: no key is listed. Remove the keys, or keep them marked as Object-only. StarterKit's own Mod-Alt-1… still fire (M7 known issue 3).
11. openTabList: `Mod-Shift-a` → `Mod-Shift-ArrowUp`.
12. navigateBack: `Alt-ArrowLeft` → `Mod-ArrowLeft` and `Mod-[`. navigateForward: `Alt-ArrowRight` → `Mod-ArrowRight` and `Mod-]`. Inside an editor these clash with word and line moves, so they must be scoped; how is still open.
13. toggleSidepanel: `Mod-Shift-\` → `Mod-Shift-ArrowRight`.
14. toggleLeftSidebar: `Mod-\` → `Mod-Shift-ArrowLeft`.
15. toggleCalendarSidebar: `Mod-Shift-y` → `Mod-Alt-s`.
16. toggleDarkMode: `Mod-Shift-d` → `Mod-Shift-l` (in both `lib/shortcuts.ts` and `theme/shortcuts.ts`).
17. toggleShortcutsMenu: `Mod-/` → `Mod-Shift-b`.
18. toggleFocusMode: `Mod-Shift-f` → `Mod-Shift-m`.
19. openPresentationMode: Windows matches; Mac should be Ctrl+Cmd+P.
20. Search palette: `Mod-p` should open search, the same as `Mod-k`. No key is listed for the action palette, so the action palette needs another way in (or our key, flagged).
21. Whiteboard (`whiteboard/shortcuts.ts`):
    - Arrow `a` → `Shift-l`.
    - Triangle `Shift-r` → `p`.
    - Bring to front `Mod-Shift-]` → `]`; send to back `Mod-Shift-[` → `[`.
    - Wrap in frame `Mod-Alt-g` → `Mod-g`.
    - Resize `Mod-Alt-Arrow` → `Mod-Arrow`; resize farther → `Mod-Shift-Arrow`.
    - Give pen and highlighter keys that don't clash with Triangle (P) and the move menu (M), or drop them.
22. Whiteboard nudge and resize distances (`whiteboard/shortcuts.ts` `NUDGE = GRID` (30), `NUDGE_FAR = GRID * 5` (150), same for RESIZE). Target: **1 px**, and **30 px** with Shift or while grid snap is on. Resize uses the same step.
23. Optional additions: whiteboard Ctrl+Shift+R (paste to replace the selection), Alt-drag (duplicate), held Ctrl (no snap). Global: `goToDailyNotesDashboard` Ctrl+Alt+H, `openExploreDashboard` Ctrl+J, `createNewTask` Ctrl+Shift+T, `toggleAllToggles` Ctrl+O, `openToggles` → / `closeToggles` ← (block selection), `groupBlocks` Ctrl+G, `increaseHierarchy` Ctrl++ / `decreaseHierarchy` Ctrl+-, `mergeTextBlocks` Ctrl+Shift+G.

### Matches already
bold, italic, underline, strikethrough, codeToken, highlightText, selectActiveBlock, expand selection up/down, selectAllBlocks, deleteBlocks, duplicateBlocks, copyBlocksAsMarkdown, indent/unindent, toggleTodoInBlockWithCursor, insertBlockAbove/Below, closeTab, openNewTab, navigateTabs, openSettings, openSearchPalette (Ctrl+K), findInPage, openAddEntityMenu, createNewEntityOfType, deleteCurrentPage, presentation slide keys, undo/redo, every calendar view key, goToPrevious/Next, and these whiteboard keys: select, hand, text, line, rectangle, ellipse, frame, bring forward / send backward, zoom, fit, duplicate, the nudge keys, flip, cycle, pan.

---

## 2. Side-panel areas, breadcrumbs, pinned tabs, slash menu, block menu

### 2a. Side panel

Target behaviour:
- Width: stored per space as a percentage, not in px, default 45 %.
- Drag-resize: a share of (main column + panel), clamped to 10–90 %.
- Double-click on the resizer resets it to 45 %.
- Areas are stacked vertically (`area1`, `area2`, `area3`). Area 2 and 3 heights are in **px**: default 220 px, minimum 120 px. Area 1 takes the rest (minimum 120). There is a 5 px gap per resizer. An area with no entries shows a 64 px drop zone while you drag.
- New tabs start with the side panel hidden.

Change needed:
1. `frontend/src/nav/sidepanel.ts`: `DEFAULT_SIDEPANEL_WIDTH = 500` (px), `MIN_SIDEPANEL_WIDTH = 320`, `MAX_SIDEPANEL_FRACTION = 0.6`. Target: 45 % of the main column plus the panel, clamped to 10–90 %, stored per space, reset to 45 % on double-click.
2. `frontend/src/nav/sidepanel.ts` area sizes: `area2Size`/`area3Size` are height fractions (`MIN_AREA_FRACTION = 0.1`). Target: px (default 220, minimum 120), and area 1 has a 120 px minimum. The field names stay; the units change.
3. `frontend/src/calendar/CalendarPage.tsx:67` `w-[300px]` (M7: "the calendar sidebar is 300 px wide", our choice). Target: default **`26rem`** (416 px), stored per space and resizable.
4. For reference: the left sidebar (space overview) defaults to `18rem`. Object's left sidebar width was not checked.

Matches already: three vertically stacked areas, `area2Size`/`area3Size` names, the per-tab `sidepanel` entries.

### 2b. Breadcrumbs

Target behaviour:
- Collapse rule: the path includes the current page as its last crumb. More than 3 crumbs means the last 3 show inline and **all earlier ones** go into a dropdown, most recent first.
- Dropdown trigger: a subtle icon button with `ph-dots-three-bold`, small size, menu width `w-64`. It has no text label.
- Separator: a `/` character in the subtle text colour with `px-1`, not selectable.
- Each crumb: `rounded-base`, `px-1`, `h-sm`, `text-sm`, not selectable, hover `bg-back` with a pointer unless it is the last one. Crumbs other than the last are at 80 % opacity (100 % on hover). The object icon comes before the title.
- Click opens in place; ⌘/Ctrl-click opens in a new tab; Shift-click opens in the side panel.
- On hover the row shows a `+` (`ph-plus-bold`) button that opens search in a new tab.
- The container grows to fill the panel's top chrome; the exact host element is not settled.

Change needed (`frontend/src/shell/Breadcrumbs.tsx`):
1. `MAX_VISIBLE_CRUMBS = 3` with "first crumb, …, last two, current". Target: at most 3 crumbs inline **including the current page**, with every earlier crumb (most recent first) in a menu behind a leading "…" button. Object's current page is not counted, so Object shows up to 4 + current.
2. Separator `ph-caret-right` icon → a `/` character in the subtle text colour with `px-1`.
3. "…" button: text "…" → the `ph-dots-three-bold` icon button. The menu is `w-64` (256 px). Object's label "Show hidden breadcrumbs" (our string) can stay as an aria-label only.
4. Crumb look: `max-w-[220px]`, `text-fg-muted`, `text-[14px]`, `h-7`, `px-1.5`, `rounded-md` → `px-1`, `h-sm`, `rounded-base`, `text-sm`, `opacity-80` (100 on hover) for the earlier crumbs and full opacity for the last, hover `bg-back`.
5. Add Ctrl/Cmd-click (new tab) and Shift-click (side panel) on crumbs, and the hover `+` button.

Not settled: the M7 rules "cut the trail when returning to a page already in it" and "the trail travels with a link opened in a new tab" were not checked.

### 2c. Pinned tabs

Target behaviour:
- Closing a pinned tab is **refused** on every close path.
- After closing the active tab, the next active tab is the most recently opened one. Closing the last tab opens a fresh one.
- Pin toggle only flips the flag; pinned tabs are not moved to the front.
- Pin button on the tab: `ph-push-pin-fill` when pinned, `ph-push-pin-bold` otherwise, tooltip "Unpin tab" / "Pin tab". The filled pin always shows on a pinned tab; the outline pin shows on hover otherwise.
- Tab sizing: 200 px max, 60 px min, 5 px gap. Tabs share the width equally. When cramped, only a window of tabs around the active one shows.

Change needed:
1. `frontend/src/shell/TabStrip.tsx` context menu: "Close tab" closes a pinned tab (M7 "Rules the build chose"). Target: a pinned tab can't be closed on any path. Hide or disable "Close tab" for pinned tabs.
2. `frontend/src/nav/tabs.ts` `close()`: next active = `tabs[i] ?? tabs[i-1]` (a neighbour) → the most recently opened tab. Closing the last tab should leave one fresh tab.
3. `nav/tabs.ts` `sortPinned`: pinned tabs sort first. Target: no such sort (medium confidence). Check on screen.
4. Pinned tab look: Object shows no close button and adds `pr-2`. Target: a filled `ph-push-pin-fill` action button on the pinned tab, which unpins on click.
5. Tab widths: `max-w-[220px] min-w-[72px]` → max 200 px, min 60 px, 5 px gap, equal widths, and a sliding window of tabs when cramped. Object scrolls instead.

Matches already: "Pin tab" / "Unpin tab" strings, "Double click to make tab persistent.", middle-click doesn't close a pinned tab.

### 2d. Slash menu

Target behaviour:
- Menu box: 22rem wide in the editor (18rem elsewhere), max height `max-h-72` on desktop. Fuzzy search over each item's description (weight 0.5), aliases (0.75) and command (0.5). A footer slot holds "press "/" to search".
- Section order:
  1. "Create a block"
  2. "Create an object"
  3. "Link to a date"
  4. "Use the AI Assistant"
  5. "Apply a template"
  6. "Create an object from a template"
  7. an unlabelled final "Create '<query>'" item.
- "Create a block" item order:
  - Standard, Small, Heading 1, Heading 2, Heading 3, Heading 4, Bullet list, Alphabetical list, Numbered list, Roman list, Quote block, To-do, Toggle, Icon, Group.
  - then Record audio and Transcribe audio (when audio is available).
  - then Math, Code, Horizontal line, Two Columns, Table.
  - **Only while searching:** the 36 colours ("<Colour> background", text colours) and "Mermaid Diagram" (alias `mmd`).
- Item icons: Standard `ph-text-t`, Small `ph-text-aa`, H1 `ph-text-h`, H2 `ph-text-h-two`, H3 `ph-text-h-three`, H4 `ph-text-h-four`, Bullet `ph-list-bullets`, Alphabetical/Numbered/Roman `ph-list-numbers`, Quote `ph-quotes`, To-do `ph-check-square`, Toggle `ph-caret-right-fill`, Icon `ph-smiley`, Group `ph-rectangle`, text colour `ph-text-aa`, background `ph-stop`, Math `ph-function`, Code `ph-code`, Horizontal line `ph-minus`, Two Columns `ph-columns`, Table `ph-table`. Icons are drawn in a bordered chip.
- Descriptions are not a second line. They are a right-aligned `ph-text-align-justify` icon whose **tooltip** is the description, shown on hover.
- Names: "Standard" ("Turn block into a standard text block"); "Math" / "A display style math block"; "Two Columns"; "Table"; "Horizontal line"; "Code" / "A code block".

Change needed (`frontend/src/editor/slash/slashItems.ts` `BLOCK_ITEMS`, `SlashMenu.tsx`):
1. First item "Text" / "Just text" → "Standard" / "Turn block into a standard text block".
2. Order. Object: Text, H1–H4, Small, Bullet, Numbered, Alphabetical, Roman, To-do, Toggle, Quote, Group, Icon, text colour, background, Two Columns, Horizontal line, Code, Math, Table, Insert image/PDF/audio. Target: Standard, Small, H1, H2, H3, H4, Bullet list, Alphabetical list, Numbered list, Roman list, Quote block, To-do, Toggle, Icon, Group, (Record audio, Transcribe audio), Math, Code, Horizontal line, Two Columns, Table.
3. The colour items ("Text" / "Background" sub-views) are not in the unfiltered list. The 36 individual colour items show **only when there is search text**. "Mermaid Diagram" shows only when searching.
4. "Insert image / PDF / audio" are not in "Create a block". Media is reached through "Create an object" (the media types). These are Object additions; flag or move them.
5. The "Reuse any content" section is not one of the slash menu's sections (blocks, object, date, AI, apply template, from template). Flag it as ours.
6. Icons: H1 `ph-text-h-one` → `ph-text-h`; Alphabetical `ph-list-dashes` → `ph-list-numbers`; Toggle `ph-caret-right` → `ph-caret-right-fill`; Group `ph-bounding-box` → `ph-rectangle`; text colour `ph-text-a-underline` → `ph-text-aa`; background `ph-paint-bucket` → `ph-stop`. Draw icons in a bordered chip.
7. Description as a hover tooltip on a right-hand `ph-text-align-justify` icon, not a second line.
8. Width 22rem (352 px) in the editor, max height 18rem (288 px).

Matches already: the section labels "Create a block", "Create an object", "Link to a date"; the footer `press "/" to search`; the Small, Heading, list, To-do, Toggle, Quote, Group, Icon, Math, Code, Horizontal line, Two Columns and Table names and descriptions.

### 2e. Block menu

Target behaviour:
- Placement `left-start`, offset `[0,4]`. The meta slot shows "<n> selected" for multi-selection, and "AI generated". An icon picker slot is present.
- Sections, in order:
  1. **Hierarchy (<current>)** ▸ (`ph-text-h`; label "Hierarchy (Standard)" etc.), **List** ▸ (`ph-list`), **To-do** (`ph-check-square`), **Icon** ▸ (`ph-smiley`), **Quote** (`ph-quotes`), **Toggle** (`ph-caret-right-fill`), **Group** ("Group selected blocks or ungroup selected group block", `ph-arrows-in`). The first six are text blocks only.
  2. **Insert block above** (`ph-rows-plus-top`), **Insert block below** (`ph-rows-plus-bottom`), each showing its shortcut.
  3. **Launch AI assistant with block selection** (AI only).
  4. **Turn into...**, **Copy** ▸ (Copy selected blocks / Copy selected blocks as Markdown / Copy block reference, the last for a single block of a referencable type), **Duplicate selected blocks** (`ph-copy`), **Delete selected blocks** (`ph-trash`, red).
- Hierarchy submenu order: Standard, Small, Heading 1, Heading 2, Heading 3, Heading 4. List submenu: "No listing" (`ph-placeholder`) in its own section, then Bulleted, Numbered, Alphabetical (icon text `a)`), Roman (icon text `i)`).

Change needed (`frontend/src/editor/handles/BlockMenu.tsx`, `frontend/src/editor/menus/BlockStyleMenu.tsx`):
1. `HIERARCHY_ITEMS` order Standard, H1–H4, Small → Standard, **Small**, H1, H2, H3, H4.
2. Menu structure. Object: "Turn Into" ▸ (Text, H1–H4, Small, lists, To-do, Toggle, Quote, Code), Hierarchy, List, Quote, Color, Icon, Copy block reference, Turn into object / task object / whiteboard, Insert above/below, Move up/down, Duplicate, Remove style, Delete. Target: the four sections above: no "Turn Into" type list ("Turn into..." opens the object picker), no Color, Move up/down or Remove style in this menu, Copy as a submenu, and To-do / Toggle / Quote as direct toggles.
3. Labels: "Duplicate" → "Duplicate selected blocks"; "Delete" → "Delete selected blocks" (red trash icon); "Copy block reference" goes under "Copy" ▸.
4. The "<n> selected" header for multi-block selections.

Matches already: "Insert block above" / "Insert block below" strings; the "Hierarchy" and "List" item names (Standard, Small, Heading n, No listing, Bulleted, Numbered, Alphabetical, Roman).

---

## 3. Search highlight colour and graph limits

### 3a. Search highlight

Target behaviour:
- `.search-highlights b`: background `var(--color-bg-search-highlight)`, weight medium (500), colour `var(--color-text-search-highlight)`, radius 1px.
- `.search-highlights-bold b`: the same at weight semibold (600), used for the command-palette result titles.
- Light theme: background `#fef08a4b`, text yellow 900 = `oklch(0.3495 0.0387 62.84)`.
- Dark theme: background `#fddf472c`, text yellow 100 = `oklch(0.9729 0.0693 103.22)`. Only these two value sets exist (both light themes share one, both dark themes the other).
- Find in page uses the CSS Custom Highlight API, not the search tokens: `::highlight(find-in-page){color:inherit;background-color:#facc1573}` and `::highlight(find-in-page-active){color:inherit;background-color:#f97316b3}` (orange for the current match).

Change needed:
1. `frontend/src/theme/themes.css` (light, lightDimmed): `--text-search-highlight: var(--text)` → `oklch(0.3495 0.0387 62.84)`.
2. `frontend/src/theme/tokens.css:51-53` (dark) and `themes.css:431-433` (darkDimmed): `--bg-search-highlight: rgb(255 240 168 / 0.3)` → `#fddf472c`; `--text-search-highlight: var(--text)` → `oklch(0.9729 0.0693 103.22)`.
3. Find in page (`frontend/src/index.css` `.find-match`, `.find-match-current`; tokens `--bg-search-highlight-current: #fef08a99` and the 0.55 dark value): all matches `#facc1573`, the current match `#f97316b3`, text colour inherited, in every theme. The `--bg-search-highlight-current` token can go.
4. Add `.search-highlights-bold b` (weight 600) and use it for palette result titles.

Matches already: light `--bg-search-highlight: #fef08a4b`; weight 500 and radius 1px on `.search-highlights b`.

### 3b. Graph

Target behaviour:
- Large-node limit is **20** (links + backlinks + collections). A node over the limit with "Hide large nodes" on is **not removed**: its own link lists aren't drawn and the local-graph walk doesn't continue through it.
- Tags: a tag with 10 or more backlinks doesn't draw its backlink edges.
- Hidden objects: filtered-out objects (type filter or exclude, hide dates) become **reduced nodes** that **stay in the graph**. Edges between two reduced nodes are dropped. Reduced nodes connected to 1 or fewer other nodes are pruned, repeatedly. With "Hide indirect links" on, every reduced node and its edges are removed. No synthetic node-to-node edges are made and there is no neighbour cap.
- Two-way links are marked as such and join both labels as `"a • b"`.
- Hops: default 1. "Show more" works while hops < 5 and "Show less" while hops > 1, so the range is 1–5, one step at a time. The label is "Maximum distance".
- Global layouts with more than 500 nodes are cached for 10 minutes.

Change needed:
1. `frontend/src/graph/filterGraph.ts`: `LARGE_NODE_LIMIT = 100` → **20**, and the tests in `GraphCustomization.test.tsx` that expect 100.
2. Same file, `hiddenByFilters`: `hideLargeNodes` **hides** nodes with degree > limit. Target: keep them but drop their own edges and don't expand past them in the local graph.
3. Same file, indirect links: Object draws synthetic edges between the shown neighbours of a hidden node (`INDIRECT_MAX_NEIGHBOURS = 10`, `INDIRECT_MAX_EDGES`). Target: keep hidden objects as "reduced" nodes, pruning those with 1 or fewer links, and draw real edges. The "indirect edge at 0.6 / 22 % alpha" style goes. How reduced nodes are drawn is not settled (likely as minimal nodes).
4. Tags with 10 or more backlinks: omit their backlink edges. Object has no such rule.
5. `frontend/src/graph/LocalGraphPanel.tsx`: hops `1 | 2` toggle → 1–5 with separate "Show less" / "Show more" buttons (±1), default 1. Also `filterGraph.ts` `GraphScope` `hops: 1 | 2`.

Not settled: the node size formula (Object `3 + 2·sqrt(degree)`, cap 18) and node colours. These stay our choice.

Matches already: the customization labels and option set (`showCompletedTasks`, `showMinimalNodes` "Show simplified graph", `hideLargeNodes`, `hideDates`, `hideIndirectLinks`, `showTagsNetwork`, `showSpaceTagsNetwork`). "Show tags network" is offered for a Tag centre or the space graph, which matches Object's rule. The loading step labels.

---

## 4. M8 file formats

Object stores Markdown. The closest fidelity targets are a **Markdown export** (options: links as wikilinks, include media, include embedded content) and an **annotated** Markdown used to round-trip blocks with HTML comments.

Target behaviour:
- **Block ids**: UUIDs. The Markdown export writes **no** block ids. The annotated form writes an HTML comment with the id at the end of the block's line.
- **Block references**: the export writes a referenced block's content inline. Deep links use `…/<spaceId>/<objectId>?bid=<blockId>`, or `?block=` for whiteboards.
- **Inline colour / highlight**: a run has a **single** colour, either a text or a background theme, so a run can't have both. The export **drops** colours. The annotated form appends an HTML comment with the colour after the token. Highlight fallback colour: `bg-amber`; the highlight action uses the last-used highlight colour, else `bg-amber`.
- **Underline**: exported only for pandoc (`<span class="underline">`), otherwise plain text. The annotated form uses `<u>…</u>`. Only one inline style is written (bold-italic > bold > italic > strike > underline).
- **Date tokens**: a link to a date with a day or time resolution, a start and an optional end (ranges and times possible). Export: `[[Date/YYYY-MM-DD]]` or `[[Date/YYYY-MM-DD HH:mm]]`.
- **Table formulas**: kept on the cell; the cell shows the computed value, and the export writes the value.
  - Detection: must start with `=` and contain exactly one `=`.
  - References: `$` absolute refs (`$A$1`) and whole-column ranges (`A:B` → rows 1..n). Rows count from 1 at the first row, header included.
  - Evaluation: empty cells are `null`; MIN, MAX, ABS and similar treat null as 0; `COUNT` counts every value passed, empties included.
  - Function names work in UPPER, lower and Capitalised forms.
- **Embeds**: a block pointing at the object (collections and queries included). Export: a link (`[[Title]]` with wikilinks, else `[Title](path)`). With "include embedded", `# Title` and then the content. Media export as `![title](path)`.

Change needed (only where a concrete target value exists):
1. `frontend/src/editor/nodes/textStyle.ts` (and the M8 plan table): a bare `<mark>` reads as `bg-yellow` → **`bg-amber`**. The `highlightText` action (`textStyle.ts:69`, `tokens/TokensMenu.tsx:171`, `setHighlight('yellow')`) → the last-used highlight colour, falling back to `amber`.
2. `frontend/src/editor/table/formulas.ts`:
   - add `$` absolute references and whole-column ranges (`A:A`);
   - a cell is a formula only when it starts with `=` and has no other `=`;
   - accept lower-case and Capitalised function names (already case-insensitive per the header, so this matches);
   - `COUNT` over a range counts every cell, not only numbers (medium confidence).
3. Optional: one run with both a text colour and a highlight is not in the target. Object allows both marks. Keep it as a superset or block it; Gene's call.
4. Optional: date tokens with a time or a range are in the target. Object's `<time datetime="YYYY-MM-DD">` covers day only.

Matches already / no Markdown form to match:
- block ids `^id` and references `![[Title#^id]]`: the export has no form for these; it transcludes, which `![[…]]` matches in spirit;
- `<span data-color="text-<c>">` / `<mark data-color="bg-<c>">` with the 18 theme colour names;
- `<time datetime>`;
- formula cells as `=<expr>` with rows counted from 1 including the header;
- `![[collection:<id>]]` / `![[query:<id>]]` (no export form; the export only links).

---

## 5. Layout switch points

Target behaviour:
- Container breakpoints: xxs ≤ 475 px, xs 476–639, sm ≥ 640, md ≥ 768, lg ≥ 1024, xl ≥ 1280, xxl ≥ 1536. They are measured on the **container**, which then gets `xxs-container` … `xxl-container` classes.
- Property sidebar:
  - shown only for the Profile and Encyclopedia designs, and for Index card when the object has visible properties. **The Standard design has no property sidebar**; its properties render inline in the page (stacking in `xxs` containers).
  - Profile and Encyclopedia show the sidebar only when the page container is **md (≥ 768 px)**; below that, inline.
  - Index card below md: the sidebar **overlays** the page (`absolute z-30 top-0 left-0 shadow-lg`) instead of pushing it.
  - Width: 19rem (304 px) by default. Drag-resizable between 14 and 30rem, stored per type in the space's UI preferences.
  - Side: rendered before the content column, so on the **left**, for all three designs. It is `sticky … top-0`.
  - Hidden state per object, default hidden for Index card.
- No minimum main-column width. The right side panel is a percentage (10–90 %, see 2a).

Change needed (`frontend/src/object/PageLayout.tsx`, `object/PropertyPanel.tsx`, `index.css` `[data-main-column]` rules at lines ~136–144):
1. `PROPERTIES_BESIDE_WIDTH = 850` (370 + 480) → **768 px** (container md), and applied to Profile and Encyclopedia.
2. Standard design: Object puts the properties in a left panel (`panelVariant` → `'side'`) and goes inline below 850. Target: Standard **never** has a property sidebar; properties are always inline. This is the largest layout difference. Gene should confirm on screen before this changes.
3. `PROPERTY_PANEL_WIDTH = 370` (`w-[370px]`) → 19rem (304 px) by default, resizable 14–30rem and stored per type.
4. Index card: Object draws a bordered card under the header (`panelVariant` → `'card'`). Target: the same left sidebar (hidden by default, toggled), shown when the object has visible properties, and as an overlay below md.
5. Encyclopedia: Object uses a right-hand infobox (`--infobox-width: 300px` in `theme/tokens.css`). Target: the same **left** sidebar (medium confidence on the side).
6. `MIN_CONTENT_WIDTH = 480` and the `index.css` `min-width: min(480px|850px, calc(100% - 320px))` rules have no target counterpart. Drop them, or keep them as ours.

Matches already: the designs' names and descriptions; inline stacking of property rows in the narrowest (`xxs`) containers.

---

## 6. Default type-dashboard sections (M3)

Target behaviour:
- Generic types:
  - `allContent` "All": tab only (not on the dashboard, in the full view), initial, can't be removed.
  - `recentlyAccessed` "Recently Opened": dashboard only, initial, removable.
  - `collections` "Collections" (when the type can have collections): dashboard only, initial, **not removable**.
  - `queries` "Queries": dashboard only, initial, **not removable**.
  - `inNoCollection` "Not in any collection": both, **not initial**.
  - `notTagged` "Not tagged" (type has `tags`): both, **not initial**.
  - `noBacklinks` "No backlinks": both, not initial.
- Daily notes: default section `allContent`, plus `unreviewed` "Unreviewed" (initial unless a matching query section already exists).
- Tasks: default section `tasksInbox`, dashboard hidden, built-ins hidden (`recentlyAccessed`, `collections`, `queries`, `inNoCollection`, `notTagged`, `noBacklinks`).
  - Custom sections, all initial, in this order: Inbox, Today, Scheduled, Status, Context (the source section; its title is "Context"), Tags, Open, Deadline, Recurring, Reminders (when reminders are available), Completed.
  - The initial sort puts `allContent` **last** for Tasks and first for other types.

Change needed:
1. `backend/objectapp/jsonstore.py:200` `default_views`: `keys = ["recentlyAccessed","collections","queries","inNoCollection"]` plus `notTagged` → **`["recentlyAccessed","collections","queries"]`**. "Not in any collection" and "Not tagged" are offered through "Add a section", not added by default. Update `frontend/src/types/dashboardSections.ts` comments and tests to match.
2. `types/dashboardSections.ts`: `collections` and `queries` can't be removed. Whether Object allows it was not checked.
3. `frontend/src/tasks/taskSections.ts`:
   - `TASK_SECTION_KEYS` order (status, today, inbox, open, deadline, scheduled, recurring, reminders, tags, source, completed) → Inbox, Today, Scheduled, Status, Source ("Context"), Tags, Open, Deadline, Recurring, Reminders, Completed, then All.
   - `DEFAULT_TASK_SECTION = 'status'` → **`inbox`**.
   - The Task page hides the dashboard.
   - Check that the Source tab is titled "Context".

Matches already: the section titles and descriptions; "Recently Opened"; `inFullView` per section (`sectionInFullView`); the `unreviewed` section on the basic DailyNote type; `noBacklinks` only through "Add a section".

---

## Not settled by this check
- The block editor's own key handling: the Shortcuts table was used, and spot-checks matched it.
- The graph node size formula and colours.
- How reduced graph nodes are drawn.
- Breadcrumb trail-update rules (cut on revisit, carry to a new tab).
- The exact host element of the breadcrumb row.
- A pinned-tabs-first sort: there is none in the target.
