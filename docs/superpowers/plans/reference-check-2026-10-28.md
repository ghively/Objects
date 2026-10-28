# Reference check of Object's guessed values against the full Capacities app (2026-10-28)

Source: `C:\Git\object\.reference\` (bundles in `app-unpacked/dist/`, workers in `app-unpacked/dist/assets/`, recovered TS in `recovered-ts/src/`). English strings: `dist/virtual_intlify-i18n-0366822.js`. Paths below are relative to `.reference/app-unpacked/dist/` unless they start with `recovered-ts/` or `frontend/`/`backend/` (Object). Byte offsets are given where the bundle is one long line.

Read-only research. No repo file was changed.

---

## 1. Keyboard shortcuts

### Where Capacities defines them

`shortcuts36682.js`, byte ~344585 onward: `var ex={calendar:[{key:\`setViewToMonth\`,shortcut:{windows:[\`M\`],mac:[\`M\`]}}…` — one table per category (`calendar`, `text`, `block`, `page`, `navigation`, `global`, `markdown`, `aiAssistant`, `table`, `date`, `appmenu`, `taskManagement`, `pdf`, `whiteboard`, `weblink`). This is the table the Shortcuts sheet renders (`LocationManager36682.js` reads `e.shortcut.mac` / `e.shortcut.windows`). I spot-checked real handlers against it and they agree:
- calendar sidebar: `LocationManager36682.js` `function AP(e,t){return e.code!==\`KeyS\`||e.shiftKey||!e.altKey?…` = Ctrl+Alt+S (Cmd+Alt+S on Mac), same as the table.
- whiteboard: `RootEntity36682.js` `Y4={v:\`select\`,h:\`hand\`,t:\`text\`,r:\`rectangle\`,o:\`ellipse\`,p:\`triangle\`,f:\`frame\`}` and `if(!r&&n===\`l\`){…setActiveTool(t.shiftKey?\`arrow\`:\`line\`)`, same as the table.
I could not find the block editor's own keydown handler as plain key checks, so the editor rows rely on the table alone.

Ids with an English string but **no row in the table**, so Capacities shows no key for them: `heading1`–`heading4`, `toDo`, `toggle`, `textAlignLeft/Center/Right`, `openCommandPalette`, `goToPreviousHigherUnit`, `goToNextHigherUnit`. The strings are in the i18n file, for example `heading1:{description:…,name:…\`Turn selected blocks into heading 1\`}`.

Notation: Win = the `windows` array, Mac = the `mac` array. `Mod` in Object = Ctrl on Windows and Cmd on Mac.

### Table: action | Object key | Capacities key | evidence

| id (action) | Object (`frontend/src/lib/shortcuts.ts` unless noted) | Capacities (Win / Mac) | Verdict |
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
| toggleToggleInBlockWithCursor | Mod-Shift-Enter | Ctrl+↵ **or** Ctrl+⇧+↵ | partial: add Mod-Enter (when the block has no to-do), as the name string says |
| insertBlockAbove | Alt-Shift-Enter | Alt+⇧+↵ / ⇧⌥↵ | match |
| insertBlockBelow | Alt-Enter | Alt+↵ / ⌥↵ | match |
| copyBlockReference | Mod-Alt-r (also `editor/shortcuts.ts`) | **Ctrl+Alt+L / ^⌘L** | change (on Mac it is Ctrl+Cmd, not Cmd+Alt) |
| turnIntoObject | Mod-Alt-o (also `editor/shortcuts.ts`) | **I** (no modifier, block selection) | change |
| turnIntoTask | Mod-Alt-k (also `editor/shortcuts.ts`) | markdown `()`+Space (Pro) | change: no key |
| turnBlockIntoTaskObject | Mod-Alt-Shift-k (also `editor/shortcuts.ts`) | **Ctrl+Shift+T / ⌘⇧T** | change |
| closeTab | Mod-w | Ctrl+W / ⌘W | match |
| openNewTab | Mod-t | Ctrl+T / ⌘T (desktop app only) | match |
| navigateTabs | Ctrl-Tab | Ctrl+Tab / ^Tab (`isDeactivated:fe(\`electron\`)`) | match for a browser app |
| openTabList | Mod-Shift-a | **Ctrl+⇧+↑ / ⌘⇧↑** | change (Capacities' Ctrl+Shift+A is `toggleChecklistMenu`) |
| navigateBack | Alt-ArrowLeft | **Ctrl+← or Ctrl+[** (⌘← or ⌘[) | change |
| navigateForward | Alt-ArrowRight | **Ctrl+→ or Ctrl+]** (⌘→ or ⌘]) | change |
| toggleSidepanel | Mod-Shift-\\ | **Ctrl+⇧+→ / ⇧⌘→** | change |
| toggleLeftSidebar | Mod-\\ | **Ctrl+⇧+← / ⇧⌘←** | change |
| toggleCalendarSidebar | Mod-Shift-y | **Ctrl+Alt+S / ⌥⌘S** | change (Ctrl+⇧+Y is `openMinigame`) |
| toggleDarkMode | Mod-Shift-d (also `theme/shortcuts.ts`) | **Ctrl+⇧+L / ⇧⌘L** | change |
| openSettings | Mod-, | Ctrl+, / ⌘, | match |
| toggleShortcutsMenu | Mod-/ | **Ctrl+⇧+B / ⇧⌘B** | change |
| openSearchPalette | Mod-k (`palette/CommandPalette.tsx` line ~71) | Ctrl+P **or** Ctrl+K | partial: Ctrl+P should also open search |
| openCommandPalette | Mod-p | none listed | change: Mod-p belongs to search; Capacities lists no key for the action palette |
| (openLocalQuery) | none | Ctrl+⇧+P / ⌘⇧P (Pro) | missing in Object |
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
| goToPreviousHigherUnit / goToNextHigherUnit | ArrowUp / ArrowDown | none listed | no key in Capacities' table (keep or drop: Gene's call) |
| whiteboardSelect / Hand / Text / Line | v / h / t / l | V / H / T / L | match |
| whiteboardArrow | a (`whiteboard/shortcuts.ts` `case 'a'`) | **⇧+L** | change |
| whiteboardRectangle / Ellipse / Frame | r / o / f | R / O / F | match |
| whiteboardTriangle | Shift-r | **P** | change |
| whiteboardPen (ours) | p | P is Triangle | conflict: free `p` |
| whiteboardHighlighter (ours) | m | M opens the move menu (`!r&&!t.shiftKey&&!t.altKey&&n===\`m\`…openMoveMenu()`) | conflict |
| whiteboardEraser (ours) | e | none | no Capacities key (ours) |
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
9. turnIntoTask: drop `Mod-Alt-k`. Capacities' only trigger is the markdown `()` + Space.
10. heading1–4, toDo, toggle, textAlignLeft/Center/Right: Capacities lists no key. Remove the keys, or keep them marked as Object-only. StarterKit's own Mod-Alt-1… still fire (M7 known issue 3).
11. openTabList: `Mod-Shift-a` → `Mod-Shift-ArrowUp`.
12. navigateBack: `Alt-ArrowLeft` → `Mod-ArrowLeft` and `Mod-[`. navigateForward: `Alt-ArrowRight` → `Mod-ArrowRight` and `Mod-]`. Inside an editor these clash with word and line moves; Capacities must scope them too, but I did not find where.
13. toggleSidepanel: `Mod-Shift-\` → `Mod-Shift-ArrowRight`.
14. toggleLeftSidebar: `Mod-\` → `Mod-Shift-ArrowLeft`.
15. toggleCalendarSidebar: `Mod-Shift-y` → `Mod-Alt-s`.
16. toggleDarkMode: `Mod-Shift-d` → `Mod-Shift-l` (in both `lib/shortcuts.ts` and `theme/shortcuts.ts`).
17. toggleShortcutsMenu: `Mod-/` → `Mod-Shift-b`.
18. toggleFocusMode: `Mod-Shift-f` → `Mod-Shift-m`.
19. openPresentationMode: Windows matches; Mac should be Ctrl+Cmd+P.
20. Search palette: `Mod-p` should open search, the same as `Mod-k`. Capacities lists no key for the action palette, so the action palette needs another way in (or our key, flagged).
21. Whiteboard (`whiteboard/shortcuts.ts`):
    - Arrow `a` → `Shift-l`.
    - Triangle `Shift-r` → `p`.
    - Bring to front `Mod-Shift-]` → `]`; send to back `Mod-Shift-[` → `[`.
    - Wrap in frame `Mod-Alt-g` → `Mod-g`.
    - Resize `Mod-Alt-Arrow` → `Mod-Arrow`; resize farther → `Mod-Shift-Arrow`.
    - Give pen and highlighter keys that don't clash with Triangle (P) and the move menu (M), or drop them.
22. Whiteboard nudge and resize distances (`whiteboard/shortcuts.ts` `NUDGE = GRID` (30), `NUDGE_FAR = GRID * 5` (150), same for RESIZE). Capacities uses **1 px**, and **30 px** with Shift or while grid snap is on: `let y=o(e.isGridSnapActive)||t.shiftKey?30:1` in `RootEntity36682.js`. Resize uses the same step.
23. Optional additions Capacities has: whiteboard Ctrl+Shift+R (paste to replace the selection), Alt-drag (duplicate), held Ctrl (no snap). Global: `goToDailyNotesDashboard` Ctrl+Alt+H, `openExploreDashboard` Ctrl+J, `createNewTask` Ctrl+Shift+T (Pro), `toggleAllToggles` Ctrl+O, `openToggles` → / `closeToggles` ← (block selection), `groupBlocks` Ctrl+G, `increaseHierarchy` Ctrl++ / `decreaseHierarchy` Ctrl+-, `mergeTextBlocks` Ctrl+Shift+G.

### Matches already
bold, italic, underline, strikethrough, codeToken, highlightText, selectActiveBlock, expand selection up/down, selectAllBlocks, deleteBlocks, duplicateBlocks, copyBlocksAsMarkdown, indent/unindent, toggleTodoInBlockWithCursor, insertBlockAbove/Below, closeTab, openNewTab, navigateTabs, openSettings, openSearchPalette (Ctrl+K), findInPage, openAddEntityMenu, createNewEntityOfType, deleteCurrentPage, presentation slide keys, undo/redo, every calendar view key, goToPrevious/Next, and these whiteboard keys: select, hand, text, line, rectangle, ellipse, frame, bring forward / send backward, zoom, fit, duplicate, the nudge keys, flip, cycle, pan.

---

## 2. Side-panel areas, breadcrumbs, pinned tabs, slash menu, block menu

### 2a. Side panel (`LocationManager36682.js`; model `recovered-ts/src/shared-logic/models/RootSpace.model.ts` lines 45–75)

Evidence:
- Width: `sidepanelWidth:Rb.string(\`sidepanel-width\`,\`45%\`,…)` (`storing36682.js`, `zb={space:H({ui:…`). It is stored per space as a percentage, not in px.
- Drag-resize: `C.value.ui.sidepanelWidth=\`${Math.max(.1,Math.min(n,.9))*100}%\``, a share of (main column + panel), clamped to 10–90 %.
- Double-click on the resizer resets it: `function Ae(){C.value.ui.sidepanelWidth=\`45%\`}` with `onDblclick:Ae`.
- Areas are stacked vertically (`flex h-full min-w-0 grow flex-col`; `data-area` `area1`, `area2`, `area3`). Area 2 and 3 heights are in **px**: `Math.max(nV,b.value?.sidepanelLayout?.area2Size||220)` with `nV=120`. So the default is 220 px and the minimum 120 px. Area 1 takes the rest (`Math.max(nV,R.value-e)`, minimum 120). There is a 5 px gap per resizer (`Ce.value*5`). An area with no entries shows a 64 px drop zone while you drag.
- New tabs start with the side panel hidden: `hideSidepanel:e.hideSidepanel??!0` (`storing36682.js`).

Change needed:
1. `frontend/src/nav/sidepanel.ts`: `DEFAULT_SIDEPANEL_WIDTH = 500` (px), `MIN_SIDEPANEL_WIDTH = 320`, `MAX_SIDEPANEL_FRACTION = 0.6`. Capacities: 45 % of the main column plus the panel, clamped to 10–90 %, stored per space, reset to 45 % on double-click.
2. `frontend/src/nav/sidepanel.ts` area sizes: `area2Size`/`area3Size` are height fractions (`MIN_AREA_FRACTION = 0.1`). Capacities stores them in px (default 220, minimum 120) and area 1 has a 120 px minimum. Note that the model field names are the same but the units differ.
3. `frontend/src/calendar/CalendarPage.tsx:67` `w-[300px]` (M7: "the calendar sidebar is 300 px wide", our choice). Capacities: `calendarSidebarWidth` default **`26rem`** (416 px), stored per space and resizable.
4. For reference: the left sidebar (space overview) defaults to `spaceOverviewWidth` `18rem`, in the same schema. I did not check Object's left sidebar width.

Matches already: three vertically stacked areas, `area2Size`/`area3Size` names, the per-tab `sidepanel` entries.

### 2b. Breadcrumbs (`RootEntity36682.js` `__name:\`RenderBreadcrumbs\`` and `RenderBreadcrumb`)

Evidence:
- Collapse rule: `f.value.length>3?{dropdown:f.value.slice(0,f.value.length-3).reverse(),inline:f.value.slice(f.value.length-3,…)}`. The path includes the current page as its last crumb. More than 3 crumbs means the last 3 show inline and **all earlier ones** go into the dropdown, most recent first.
- Dropdown trigger: an icon button with `ph-dots-three-bold`, `variant:\`subtle\``, `w-sm h-sm`, menu `width:\`w-64\``. It has no text label.
- Separator: `/` text in `shrink-0 px-1 select-none text-subtle`.
- Each crumb: `rounded-base select-none px-1 h-sm flex min-w-0 max-w-full …`, `hover:bg-back cursor-pointer` unless it is the last one. Crumbs other than the last are `opacity-80 hover:opacity-100`; the text is `text-sm`. The object icon comes before the title.
- Click opens in place; ⌘/Ctrl-click opens in a new tab; Shift-click opens in the side panel.
- On hover the row shows a `+` (`ph-plus-bold`) button, tooltip `SpaceHeader.createNewTab`, which opens search in a new tab.
- The container is `w-12 grow flex items-center justify-start`, which suggests it sits in the panel's top chrome. I could not pin the exact host element.

Change needed (`frontend/src/shell/Breadcrumbs.tsx`):
1. `MAX_VISIBLE_CRUMBS = 3` with "first crumb, …, last two, current". Capacities: at most 3 crumbs inline **including the current page**, with every earlier crumb (most recent first) in a menu behind a leading "…" button. Object's current page is not counted, so Object shows up to 4 + current.
2. Separator `ph-caret-right` icon → a `/` character in the subtle text colour with `px-1`.
3. "…" button: text "…" → the `ph-dots-three-bold` icon button. The menu is `w-64` (256 px). Object's label "Show hidden breadcrumbs" (our string) can stay as an aria-label only.
4. Crumb look: `max-w-[220px]`, `text-fg-muted`, `text-[14px]`, `h-7`, `px-1.5`, `rounded-md` → `px-1`, `h-sm`, `rounded-base`, `text-sm`, `opacity-80` (100 on hover) for the earlier crumbs and full opacity for the last, hover `bg-back`.
5. Add Ctrl/Cmd-click (new tab) and Shift-click (side panel) on crumbs, and the hover `+` button.

Not verified: the M7 rules "cut the trail when returning to a page already in it" and "the trail travels with a link opened in a new tab". I did not trace Capacities' trail-update code (`TabEntry.breadcrumbs: string[][]`).

### 2c. Pinned tabs (`LocationManager36682.js` `__name:\`SpaceHeader\``; `storing36682.js` tab functions)

Evidence:
- Close: `async function wA(e,t){if(dA(e).tabs.find(e=>e.tabId===t)?.pinned)return!1;…` means closing a pinned tab is **refused** on the shared close path.
- After closing the active tab, the next active tab is the most recently opened one: `Jk(n.tabs)[0]`, sorted by `lastOpened` descending. Closing the last tab opens a fresh one.
- Pin toggle: `function TA(e,t){…n&&(n.pinned=!n.pinned)}`. It only flips the flag; I found no code that moves pinned tabs to the front.
- Pin button on the tab: `icon … e.pinned?\`ph-push-pin-fill\`:\`ph-push-pin-bold\``, tooltip `SpaceTab.unpinTab` / `SpaceTab.pinTab` ("Unpin tab" / "Pin tab"), `alwaysVisible:!!e.pinned`. The filled pin always shows on a pinned tab; the outline pin shows on hover otherwise.
- Tab sizing: `aW=200` (max), `oW=60` (min), `sW=5` (gap). Tabs share the width equally, `Math.min(aW, available/n)`. When cramped, only a window of tabs around the active one shows (`Math.floor((T.value+sW)/65)` slots).

Change needed:
1. `frontend/src/shell/TabStrip.tsx` context menu: "Close tab" closes a pinned tab (M7 "Rules the build chose"). Capacities refuses to close a pinned tab on every path. Hide or disable "Close tab" for pinned tabs.
2. `frontend/src/nav/tabs.ts` `close()`: next active = `tabs[i] ?? tabs[i-1]` (a neighbour) → Capacities picks the most recently opened tab. Closing the last tab should leave one fresh tab.
3. `nav/tabs.ts` `sortPinned`: pinned tabs sort first. I found no such sort in Capacities (medium confidence: absence of evidence). Check on screen.
4. Pinned tab look: Object shows no close button and adds `pr-2`. Capacities shows a filled `ph-push-pin-fill` action button on the pinned tab, which unpins on click.
5. Tab widths: `max-w-[220px] min-w-[72px]` → max 200 px, min 60 px, 5 px gap, equal widths, and a sliding window of tabs when cramped. Object scrolls instead.

Matches already: "Pin tab" / "Unpin tab" strings, "Double click to make tab persistent." (`SpaceTab.doubleClickToPersist`), middle-click doesn't close a pinned tab.

### 2d. Slash menu (`RootEntity36682.js` `__name:\`CreateMenu\`` ~byte 735000–760000; items from `function FA(` at byte 747998; lists in `storing36682.js` `yke=[…]`, `bke={…}`, `Dee=[…]`)

Evidence:
- Menu box: `width:… h.isInEditor?\`w-[22rem]\`:\`w-[18rem]\``, `maxHeight:…\`max-h-72\`` on desktop. Fuzzy search over `aliases.description` (weight 0.5), `aliases.alias` (0.75) and `aliases.command` (0.5). A footer slot holds "press "/" to search".
- Section order:
  1. "Create a block"
  2. "Create an object"
  3. "Link to a date"
  4. "Use the AI Assistant"
  5. "Apply a template"
  6. "Create an object from a template"
  7. an unlabelled final "Create '<query>'" item.
- "Create a block" item order = `[...operations, recordAudio, transcribeAudio, ...blocks, ...(search ? colors : []), ...(search ? Mermaid : [])]`:
  - operations = `yke` minus colour and AI items: Standard, Small, Heading 1, Heading 2, Heading 3, Heading 4, Bullet list, Alphabetical list, Numbered list, Roman list, Quote block, To-do, Toggle, Icon, Group.
  - then Record audio and Transcribe audio (when audio is available).
  - blocks = `Dee` filtered: Math, Code, Horizontal line, Two Columns, Table.
  - **Only while searching:** the 36 colours ("<Colour> background", text colours) and "Mermaid Diagram" (alias `mmd`).
- Item icons (`bke`, `Ze`): Standard `ph-text-t`, Small `ph-text-aa`, H1 `ph-text-h`, H2 `ph-text-h-two`, H3 `ph-text-h-three`, H4 `ph-text-h-four`, Bullet `ph-list-bullets`, Alphabetical/Numbered/Roman `ph-list-numbers`, Quote `ph-quotes`, To-do `ph-check-square`, Toggle `ph-caret-right-fill`, Icon `ph-smiley`, Group `ph-rectangle`, text colour `ph-text-aa`, background `ph-stop`, Math `ph-function`, Code `ph-code`, Horizontal line `ph-minus`, Two Columns `ph-columns`, Table `ph-table`. Icons are drawn with `hasBorder:!0` (a bordered chip).
- Descriptions are not a second line. They are a right-aligned `ph-text-align-justify` icon whose **tooltip** is the description, shown on hover: `right:[…{icon:\`ph-text-align-justify\`,tooltip:t,visibility:\`hover\`}]`.
- Names: `ControlDropdown.custom.block_Base.name` = "Standard" ("Turn block into a standard text block"); `blocks.MathBlock` "Math" / "A display style math block"; `blocks.GridBlock` "Two Columns"; `blocks.SimpleTableBlock` "Table"; `blocks.HorizontalLineBlock` "Horizontal line"; `blocks.CodeBlock` "Code" / "A code block".

Change needed (`frontend/src/editor/slash/slashItems.ts` `BLOCK_ITEMS`, `SlashMenu.tsx`):
1. First item "Text" / "Just text" (`blocks.TextBlock`) → "Standard" / "Turn block into a standard text block" (`ControlDropdown.custom.block_Base`).
2. Order. Object: Text, H1–H4, Small, Bullet, Numbered, Alphabetical, Roman, To-do, Toggle, Quote, Group, Icon, text colour, background, Two Columns, Horizontal line, Code, Math, Table, Insert image/PDF/audio. Capacities: Standard, Small, H1, H2, H3, H4, Bullet list, Alphabetical list, Numbered list, Roman list, Quote block, To-do, Toggle, Icon, Group, (Record audio, Transcribe audio), Math, Code, Horizontal line, Two Columns, Table.
3. The colour items ("Text" / "Background" sub-views) are not in Capacities' unfiltered list. Capacities lists the 36 individual colour items **only when there is search text**. "Mermaid Diagram" shows only when searching.
4. "Insert image / PDF / audio" are not in "Create a block". Capacities reaches media through "Create an object" (the media types). These are Object additions; flag or move them.
5. The "Reuse any content" section (`ControlDropdown.reuseContent.heading`) is not one of CreateMenu's sections. CreateMenu's are blocks, structure, date, ai, applyTemplate, template. Flag it as ours.
6. Icons: H1 `ph-text-h-one` → `ph-text-h`; Alphabetical `ph-list-dashes` → `ph-list-numbers`; Toggle `ph-caret-right` → `ph-caret-right-fill`; Group `ph-bounding-box` → `ph-rectangle`; text colour `ph-text-a-underline` → `ph-text-aa`; background `ph-paint-bucket` → `ph-stop`. Draw icons in a bordered chip.
7. Description as a hover tooltip on a right-hand `ph-text-align-justify` icon, not a second line.
8. Width 22rem (352 px) in the editor, max height 18rem (288 px).

Matches already: the section labels "Create a block", "Create an object", "Link to a date"; the footer `press "/" to search`; the Small, Heading, list, To-do, Toggle, Quote, Group, Icon, Math, Code, Horizontal line, Two Columns and Table names and descriptions.

### 2e. Block menu (`RootEntity36682.js` `__name:\`BlockMenu\`` at byte 1080217; item factory `useSyncedSpacePreferences36682.js` `function wi(){return{block:{…` ~byte 47000)

Evidence:
- Placement `left-start`, offset `[0,4]`. The meta slot shows "<n> selected" (`blocksMenu.blocksSelected`) for multi-selection, and "AI generated". An icon picker slot is present.
- Sections, in order:
  1. **Hierarchy (<current>)** ▸ (`ph-text-h`; label "Hierarchy (Standard)" etc.), **List** ▸ (`ph-list`), **To-do** (`ph-check-square`), **Icon** ▸ (`ph-smiley`), **Quote** (`ph-quotes`), **Toggle** (`ph-caret-right-fill`), **Group** ("Group selected blocks or ungroup selected group block", `ph-arrows-in`). The first six are text blocks only.
  2. **Insert block above** (`ph-rows-plus-top`), **Insert block below** (`ph-rows-plus-bottom`), each showing its shortcut.
  3. **Launch AI assistant with block selection** (AI only).
  4. **Turn into...** (`ActionItems.turnBlocksInto.title`), **Copy** ▸ (Copy selected blocks / Copy selected blocks as Markdown / Copy block reference, the last for a single block of a referencable type), **Duplicate selected blocks** (`ph-copy`), **Delete selected blocks** (`ph-trash`, red).
- Hierarchy submenu order: Standard, Small, Heading 1, Heading 2, Heading 3, Heading 4. List submenu: "No listing" (`ph-placeholder`) in its own section, then Bulleted, Numbered, Alphabetical (icon text `a)`), Roman (icon text `i)`).

Change needed (`frontend/src/editor/handles/BlockMenu.tsx`, `frontend/src/editor/menus/BlockStyleMenu.tsx`):
1. `HIERARCHY_ITEMS` order Standard, H1–H4, Small → Standard, **Small**, H1, H2, H3, H4.
2. Menu structure. Object: "Turn Into" ▸ (Text, H1–H4, Small, lists, To-do, Toggle, Quote, Code), Hierarchy, List, Quote, Color, Icon, Copy block reference, Turn into object / task object / whiteboard, Insert above/below, Move up/down, Duplicate, Remove style, Delete. Capacities has the four sections above: no "Turn Into" type list (its "Turn into..." opens the object picker), no Color, Move up/down or Remove style in this menu, Copy as a submenu, and To-do / Toggle / Quote as direct toggles.
3. Labels: "Duplicate" → "Duplicate selected blocks"; "Delete" → "Delete selected blocks" (red trash icon); "Copy block reference" goes under "Copy" ▸.
4. The "<n> selected" header for multi-block selections.

Matches already: "Insert block above" / "Insert block below" strings; the "Hierarchy" and "List" item names (Standard, Small, Heading n, No listing, Bulleted, Numbered, Alphabetical, Roman).

---

## 3. Search highlight colour and graph limits

### 3a. Search highlight (`index36682.css`; theme values in `storing36682.js`)

Evidence:
- `.search-highlights b{background-color:var(--color-bg-search-highlight);…font-weight:var(--font-weight-medium);color:var(--color-text-search-highlight);border-radius:1px}`
- `.search-highlights-bold b{…font-weight:var(--font-weight-semibold)…}`, used for the command-palette result titles (`CommandPalette36682.js` `search-highlights-bold`).
- Light theme: `"bg-search-highlight":\`#fef08a4b\`,"text-search-highlight":$.yellow[900]`, with yellow 900 = `oklch(0.3495 0.0387 62.84)`.
- Dark theme: `"bg-search-highlight":\`#fddf472c\`,"text-search-highlight":$.yellow[100]`, with yellow 100 = `oklch(0.9729 0.0693 103.22)`. Only these two value sets exist (two light copies, one dark).
- Find in page uses the CSS Custom Highlight API, not the search tokens: `::highlight(find-in-page){color:inherit;background-color:#facc1573}` and `::highlight(find-in-page-active){color:inherit;background-color:#f97316b3}` (orange for the current match).

Change needed:
1. `frontend/src/theme/themes.css` (light, lightDimmed): `--text-search-highlight: var(--text)` → `oklch(0.3495 0.0387 62.84)`.
2. `frontend/src/theme/tokens.css:51-53` (dark) and `themes.css:431-433` (darkDimmed): `--bg-search-highlight: rgb(255 240 168 / 0.3)` → `#fddf472c`; `--text-search-highlight: var(--text)` → `oklch(0.9729 0.0693 103.22)`.
3. Find in page (`frontend/src/index.css` `.find-match`, `.find-match-current`; tokens `--bg-search-highlight-current: #fef08a99` and the 0.55 dark value): all matches `#facc1573`, the current match `#f97316b3`, text colour inherited, in every theme. The `--bg-search-highlight-current` token can go.
4. Add `.search-highlights-bold b` (weight 600) and use it for palette result titles.

Matches already: light `--bg-search-highlight: #fef08a4b`; weight 500 and radius 1px on `.search-highlights b`.

### 3b. Graph (`RootEntity36682.js` graph UI; graph build in `assets/worker-heavy-Dz4rtcoC.js` and `worker-casual-…`, functions `cA`, `uA`, `eA`)

Evidence:
- Large-node limit is **20**: the UI has `hideLargeNodesTooltip\`,{limit:20}`, and the worker uses `skipEdges:!!t?.hideLargeNodes&&w>20` with w = links + backlinks + collections. In the local-graph walk, `if(!(n?.hideLargeNodes&&d.length+m.length+h.length+y.length>20))` stops expanding from such a node. The node itself is **not removed**: its own link lists aren't drawn and the local walk doesn't continue through it.
- Tags: `omitBacklinks:n.type===\`RootTag\`&&S.length>=10`. A tag with 10 or more backlinks doesn't draw its backlink edges.
- Hidden objects: filtered-out objects (type filter or exclude, `hideDates`) become **reduced nodes** (`isReducedNode:eA(…)`) that **stay in the graph**. Edges between two reduced nodes are dropped. Reduced nodes connected to 1 or fewer other nodes are pruned, repeatedly (`uA`). With "Hide indirect links" on, every reduced node and its edges are removed. No synthetic node-to-node edges are made and there is no neighbour cap.
- Two-way links: `lA` sets `twoWayLink` and joins both labels as `"a • b"`.
- Hops: `function s7(){return{hops:1}}` (default 1). "Show more" works while `hops<5` and "Show less" while `hops>1`, so the range is 1–5, one step at a time. The label is "Maximum distance" (`GraphViewModal.hops.label`).
- The layout cache keeps global layouts with more than 500 nodes (`t.length<=500?!1:…`) for 10 minutes (`>6e5`).

Change needed:
1. `frontend/src/graph/filterGraph.ts`: `LARGE_NODE_LIMIT = 100` → **20**, and the tests in `GraphCustomization.test.tsx` that expect 100.
2. Same file, `hiddenByFilters`: `hideLargeNodes` **hides** nodes with degree > limit. Capacities keeps them but drops their own edges and doesn't expand past them in the local graph.
3. Same file, indirect links: Object draws synthetic edges between the shown neighbours of a hidden node (`INDIRECT_MAX_NEIGHBOURS = 10`, `INDIRECT_MAX_EDGES`). Capacities instead keeps hidden objects as "reduced" nodes, pruning those with 1 or fewer links, and draws real edges. The "indirect edge at 0.6 / 22 % alpha" style has no counterpart. I did not find how reduced nodes are drawn (likely as minimal nodes; not confirmed).
4. Tags with 10 or more backlinks: omit their backlink edges. Object has no such rule.
5. `frontend/src/graph/LocalGraphPanel.tsx`: hops `1 | 2` toggle → 1–5 with separate "Show less" / "Show more" buttons (±1), default 1. Also `filterGraph.ts` `GraphScope` `hops: 1 | 2`.

Not found in .reference: the node size formula (Object `3 + 2·sqrt(degree)`, cap 18) and node colours. I searched `RootEntity36682.js`, `storing36682.js` and the workers for `Math.sqrt(` near degree, link or count, and for size or radius in graph code. Mark these as still our choice.

Matches already: the customization labels and option set (`showCompletedTasks`, `showMinimalNodes` "Show simplified graph", `hideLargeNodes`, `hideDates`, `hideIndirectLinks`, `showTagsNetwork`, `showSpaceTagsNetwork`). "Show tags network" is offered for a Tag centre or the space graph (`Sqe(e){return e.entityType===\`RootTag\`||e.mode===\`space\`}`), which matches Object's rule. The loading step labels.

---

## 4. M8 file formats

Capacities stores JSON, not Markdown. The closest fidelity targets are its **Markdown export** (`storing36682.js` around byte 1284470–1302470, `return{componentToMd:w,blocksToMd:v,tokensToMd:m,…`; config `isAsWikiLink`, `isIncludingMedia`, `isIncludingEmbedded`) and a second, **annotated** Markdown the AI uses to round-trip blocks (`RootEntity36682.js` byte ~1469500–1476000: `XG=\`<!-- cap:\``, `QG=/<!-- cap:(\w+)=(.*?) -->/g`). Models: `recovered-ts/src/shared-logic/public-api/public-api-blocks.ts`, `public-api-date.ts`, `util/colorThemes.ts`.

What Capacities does:
- **Block ids**: UUIDs (`crypto.randomUUID()`). The Markdown export writes **no** block ids. The AI format writes `<!-- cap:id=<uuid> -->` at the end of the block's line.
- **Block references**: the export writes a referenced block's content inline (an `EntityBlock` whose `link.data.references` has `type:\`block\`` exports the referenced blocks). Deep links use `…/<spaceId>/<objectId>?bid=<blockId>`, or `?block=` for whiteboards.
- **Inline colour / highlight**: the model has a **single** `color` per `TextToken`, either a text or a background theme (`color: textOrBackgroundColorThemeSchema.optional()`), so a run can't have both. The export **drops** colours. The AI format appends `<!-- cap:tokenColor=<c> -->` after the token. Highlight fallback colour: `FALLBACK_HIGHLIGHT_COLOR = 'bg-amber'` (`colorThemes.ts`). The highlight action uses `textHighlightColorLastUsed||\`bg-amber\``.
- **Underline**: exported only for pandoc (`<span class="underline">`), otherwise plain text. The AI format uses `<u>…</u>`. Only one inline style is written (bold-italic > bold > italic > strike > underline).
- **Date tokens**: a `LinkToken` to a `UtilDate` object with `{dateResolution:'day'|'time', start, end}` (ranges and times possible). Export: `[[Date/YYYY-MM-DD]]` or `[[Date/YYYY-MM-DD HH:mm]]` (`function BR`, `ea.UtilDate.singular` = "Date").
- **Table formulas**: kept on the cell's `TextBlock.formula`. The cell's tokens hold the computed value; the export writes the value (table cells use tokens).
  - Detection: `n$`, must start with `=` and contain exactly one `=`.
  - References: `qQ` allows `$` absolute refs (`$A$1`) and whole-column ranges (`A:B` → rows 1..n). `ZQ` counts rows from 1 at the first row, header included.
  - Evaluation: `GQ` uses mathjs, empty cells are `null`; MIN, MAX, ABS and similar treat null as 0; `COUNT:(...e)=>e.length` counts every value passed, empties included.
  - Function names work in UPPER, lower and Capitalised forms.
- **Embeds**: an `EntityBlock` pointing at the object (collections and queries are `RootDatabase` / `RootQuery` objects). Export: a link (`[[Title]]` with `isAsWikiLink`, else `[Title](path)`). With "include embedded", `# Title` and then the content. Media export as `![title](path)`.

Change needed (only where Capacities gives a concrete value):
1. `frontend/src/editor/nodes/textStyle.ts` (and the M8 plan table): a bare `<mark>` reads as `bg-yellow` → **`bg-amber`**. The `highlightText` action (`textStyle.ts:69`, `tokens/TokensMenu.tsx:171`, `setHighlight('yellow')`) → the last-used highlight colour, falling back to `amber`.
2. `frontend/src/editor/table/formulas.ts`:
   - add `$` absolute references and whole-column ranges (`A:A`);
   - a cell is a formula only when it starts with `=` and has no other `=`;
   - accept lower-case and Capitalised function names (already case-insensitive per the header, so this matches);
   - `COUNT` over a range counts every cell, not only numbers (medium confidence: depends on how empty cells reach `GQ`).
3. Optional: Capacities can't give one run both a text colour and a highlight. Object allows both marks. Keep it as a superset or block it; Gene's call.
4. Optional: date tokens with a time or a range are possible in Capacities (`dateResolution:'time'`, `end`). Object's `<time datetime="YYYY-MM-DD">` covers day only.

Matches already / no Capacities Markdown form to match:
- block ids `^id` and references `![[Title#^id]]`: no Capacities Markdown form; the export transcludes, which `![[…]]` matches in spirit;
- `<span data-color="text-<c>">` / `<mark data-color="bg-<c>">` with the 18 theme colour names, which are the same names as `themeColors`;
- `<time datetime>`;
- formula cells as `=<expr>` with rows counted from 1 including the header (matches `ZQ`);
- `![[collection:<id>]]` / `![[query:<id>]]` (no Capacities form; the export only links).

---

## 5. Layout switch points

Evidence:
- Container breakpoints (`RootEntity36682.js` `xZ=475;function SZ(e){let{width:t}=fg(e),n=V(()=>t.value<=xZ),r=…<=Yh.sm…` with `{sm:640,md:768,lg:1024,xl:1280,"2xl":1536}` from `shortcuts36682.js`): xxs ≤ 475 px, xs 476–639, sm ≥ 640, md ≥ 768, lg ≥ 1024, xl ≥ 1280, xxl ≥ 1536. They are measured on the **container**, which then gets `xxs-container` … `xxl-container` classes.
- Property sidebar (`QEe=w({__name:\`PropertiesSidebar\`…`):
  - shown only when `hasPropertySidebarLayout` is true: `Ze=V(()=>x.value===\`profile\`||x.value===\`encyclopedia\`||x.value===\`indexCard\`&&Ue.value)`, where `Ue` = the object has visible properties. **The Standard design has no property sidebar**; its properties render inline in the page (the `group/properties` block with the `xxs-container` stacking).
  - `UEe(e){return!(!e.hasPropertySidebarLayout||(e.viewDesign===\`encyclopedia\`||e.viewDesign===\`profile\`)&&!e.isMd)}`. Profile and Encyclopedia show the sidebar only when the page container is **md (≥ 768 px)**; below that, inline.
  - Index card below md: the sidebar **overlays** the page (`absolute z-30 top-0 left-0 shadow-lg`) instead of pushing it.
  - Width: `r.value.ui.propertiesSidebarStates[i.entity.structureId]?.width??\`19rem\``, i.e. 19rem (304 px) by default. Drag-resizable between 14 and 30rem (`Math.max(14,Math.min(t,30))`), stored per type in the space's UI preferences.
  - Side: rendered before the content column, so on the **left**, for all three designs. It is `sticky … top-0`.
  - Hidden state per object: `entity.data.hidePropertySection`, default hidden for Index card (`propertySidebarHidden: e===void 0?l.value===\`indexCard\`:e`).
- No minimum main-column width found. The right side panel is a percentage (10–90 %, see 2a).

Change needed (`frontend/src/object/PageLayout.tsx`, `object/PropertyPanel.tsx`, `index.css` `[data-main-column]` rules at lines ~136–144):
1. `PROPERTIES_BESIDE_WIDTH = 850` (370 + 480) → **768 px** (container md), and applied to Profile and Encyclopedia.
2. Standard design: Object puts the properties in a left panel (`panelVariant` → `'side'`) and goes inline below 850. Capacities' Standard **never** has a property sidebar; properties are always inline. This is the largest layout difference. `docs/ui-reference/05` shows a left panel; its type's design is unknown, and the toggle button in it matches the sidebar's own hide button, so it is probably Index card, Profile or Encyclopedia, not Standard. Gene should confirm on screen before this changes.
3. `PROPERTY_PANEL_WIDTH = 370` (`w-[370px]`) → 19rem (304 px) by default, resizable 14–30rem and stored per type.
4. Index card: Object draws a bordered card under the header (`panelVariant` → `'card'`). Capacities uses the same left sidebar (hidden by default, toggled), shown when the object has visible properties, and as an overlay below md.
5. Encyclopedia: Object uses a right-hand infobox (`--infobox-width: 300px` in `theme/tokens.css`). Capacities uses the same **left** sidebar. Medium confidence on the side: the sidebar is rendered before the content and I found no order or `flex-row-reverse` class.
6. `MIN_CONTENT_WIDTH = 480` and the `index.css` `min-width: min(480px|850px, calc(100% - 320px))` rules have no Capacities counterpart. Drop them, or keep them as ours.

Matches already: the designs' names and descriptions (`DesignThemes.*`); inline stacking of property rows in the narrowest (`xxs`) containers.

---

## 6. Default type-dashboard sections (M3)

Evidence (`RootEntity36682.js` `function eKe(e,t,n=\`xx\`)` ~byte 2885900, `builtInDashboardSections`):
- Generic types:
  - `allContent` "All": tab only (`inDashboard:!1,inFullView:!0`), initial, can't be removed.
  - `recentlyAccessed` "Recently Opened": dashboard only, initial, removable.
  - `collections` "Collections" (when the type can have collections): dashboard only, initial, **not removable**.
  - `queries` "Queries": dashboard only, initial, **not removable**.
  - `inNoCollection` "Not in any collection": both, **not initial**.
  - `notTagged` "Not tagged" (type has `tags`): both, **not initial**.
  - `noBacklinks` "No backlinks": both, not initial.
- Daily notes: `defaultSection:\`allContent\``, plus `unreviewed` "Unreviewed" (initial unless a matching query section already exists, `$Ge`).
- Tasks: `defaultSection:\`tasksInbox\``, `hideDashboard:!0`, built-ins hidden (`recentlyAccessed`, `collections`, `queries`, `inNoCollection`, `notTagged`, `noBacklinks`).
  - Custom sections, all initial, in this order: Inbox, Today, Scheduled, Status, Context (`tasksSource`; the title string is "Context"), Tags, Open, Deadline, Recurring, Reminders (when reminders are available), Completed.
  - The initial sort puts `allContent` **last** for RootTask and first for other types.

Change needed:
1. `backend/objectapp/jsonstore.py:200` `default_views`: `keys = ["recentlyAccessed","collections","queries","inNoCollection"]` plus `notTagged` → **`["recentlyAccessed","collections","queries"]`**. "Not in any collection" and "Not tagged" are offered through "Add a section", not added by default. Update `frontend/src/types/dashboardSections.ts` comments and tests to match.
2. `types/dashboardSections.ts`: Capacities doesn't allow removing `collections` and `queries` (`canBeRemoved:!1`). I did not check whether Object allows it.
3. `frontend/src/tasks/taskSections.ts`:
   - `TASK_SECTION_KEYS` order (status, today, inbox, open, deadline, scheduled, recurring, reminders, tags, source, completed) → Inbox, Today, Scheduled, Status, Source ("Context"), Tags, Open, Deadline, Recurring, Reminders, Completed, then All.
   - `DEFAULT_TASK_SECTION = 'status'` → **`inbox`**.
   - The Task page hides the dashboard (`hideDashboard:!0`).
   - Check that the Source tab is titled "Context".

Matches already: the section titles and descriptions; "Recently Opened"; `inFullView` per section (`sectionInFullView`); the `unreviewed` section on the basic DailyNote type; `noBacklinks` only through "Add a section".

---

## Not found in .reference (what was searched)
- The block editor's key handler as plain key checks. I searched `RootEntity`, `storing`, `LocationManager` and `index` for `ctrlKey`, `metaKey`, `KeyB` and similar. The display table was used, and spot-checks matched it.
- The graph node size formula and colours: `Math.sqrt(`, size or radius near degree, link or count in the bundles and workers.
- How reduced graph nodes are drawn.
- Breadcrumb trail-update rules (cut on revisit, carry to a new tab).
- The exact host element of the breadcrumb row.
- A pinned-tabs-first sort. None was found; the evidence is that it is absent.
