# Object, Milestone 6: Whiteboards and Pen. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Whiteboards work as they do in Object, on plain files, plus Gene's pressure-sensitive pen:
- A **whiteboard is an object** of the basic Whiteboard type: `Whiteboards/<Title>.md` (frontmatter and the board's Notes as the body), `Whiteboards/<Title>.whiteboard.json` (the canvas) and `Whiteboards/<Title>.ink.svg` (the freehand ink). It is created from "+ New" ("Create whiteboard"), listed on its type page like any type, and opens full width as a page or in the peek.
- **Canvas:** the 30 px dotted grid, pan and zoom (2 % to 400 %, the zoom presets, Zoom to fit / to selection / to 100 %), marquee and Shift multi-select, snap to grid and snap to nodes, the "Canvas display" options (Snap to grid, Snap to nodes, Show dots, Zoom with scroll wheel, Engineering mode), board lock.
- **Items:** text blocks and embedded objects (which open in the peek), the 12 Object shapes (9 in the picker, as Object), frames with "Frame N" titles, points, and the logic-circuit gates NOT, AND, NAND, OR, NOR, XOR, XNOR, HIGH, LOW (Engineering mode).
- **Connectors:** Straight / Cornered / Curved; Solid / Dashed / Dotted; start and end tips None / Arrow / Dot / Double arrow; colour; labels.
- **Selection controls** (Object's `Whiteboard.control.*`): colour, fill, text alignment, flip, order (front, forward, backward, back), place (left … grid), duplicate, wrap in new frame, delete; "Clear Whiteboard".
- **Freehand ink (Gene's addition, no Object original):** Wacom pen pressure through Pointer Events and `perfect-freehand`; pen, highlighter and eraser (including the Wacom eraser end); colours and widths; stored as SVG beside the board.
- **Undo/redo** over everything on the board (ink included); **drag objects in** from the sidebar's pinned objects (and M5's search results) and pick them with the "Existing object" tool.

**Architecture:**
- **Built concurrently with M5 in the same working tree.** M5 owns every pre-existing shared file. So **every M6 task except Task 13 only creates new files**: backend logic in new `backend/objectapp/whiteboard*.py` modules (pure functions plus a FastAPI `APIRouter` factory that takes the `Space` and an `announce` callback), tests in new `backend/tests/test_whiteboard*.py` with their own synthetic space, frontend code in `frontend/src/whiteboard/**` and two new API files. No M6 new path collides with a path the M5 plan creates (M5 creates `roles.py`, `resolver.py`, `linkindex.py`, `apictx.py`, `searchindex.py`, `searchtext.py`, `fuzzy.py`, `references.py`, `graphdata.py`, `api_search.py`, `api_references.py`, `api_graph.py`, `fixtures/space-links/`, `bigspace.py`, `test_{roles,resolver,linkindex,listeners,backlinks_api,searchtext,fuzzy,searchindex,search_api,references,mention_link,graphdata,fixtures_m5}.py`, `frontend/src/{palette,find,references,graph}/**`, `editor/extensions/findInPage.ts`, `scripts/m5_acceptance.py`). **Task 13 (integrate)** runs after M5 is integrated (M5's `chore: milestone 5 acceptance` commit) and makes every edit to a pre-existing file (router mount, Space hooks for trash/rename, the change-type category in `changetype.py`, the watcher, the basic type name, `media.py`, M5's `roles.py`, `linkindex.py` and `searchindex.py` hooks, `api/types.ts`, `api/client.ts`, `ObjectPage`/`ObjectPeek`, `NewObjectMenu`, `PinnedSection`, M5's `palette/SearchView.tsx`), then runs acceptance.
- **Three build lanes with disjoint files** (see "Build lanes"): **A backend** (Tasks 1–4), **B ink** (Tasks 5–6, a self-contained module under `frontend/src/whiteboard/ink/`), **C canvas** (Tasks 7–12). Lane B and Lane C never import each other: the canvas takes the ink as an injected **ink plugin** (contract below), which Task 13 passes in. Inside Lane C, Task 9 creates stub `index.ts` files for `nodes/`, `edges/` and `chrome/` with the final export names and prop types; Tasks 10, 11 and 12 replace them in parallel.
- **Back end:** the board JSON is validated against Object's `WhiteboardData` shape (`whiteboard.model.ts`) and written exactly as the client sent it (unknown keys kept), atomically, against a revision (sha256 of the file's bytes; `''` when it doesn't exist). The ink SVG is serialized by the server from validated strokes into a standalone SVG that any browser renders, and parsed back; a file with anything the app didn't write opens read-only. Opening a board or its ink never writes. Board saves never touch the `.md` (title, tags and description go through M1/M2's object routes).
- **Front end:** React Flow (`@xyflow/react`), the React sibling of the Vue Flow canvas Object uses (`whiteboard.model.ts`: "The shape mirrors the canvas library's node/edge model so mapping in both directions stays a plain projection"; `cornered` "is Vue Flow smoothstep"; the shipped CSS is Vue Flow's). A pure projection maps board data to React Flow nodes and edges and back without loss. A per-board zustand store holds the document (board plus ink strokes), selection, tool and an undo history; `useBoard` loads, debounces saves (400 ms), and on a 409 merges the local changes onto the server copy key by key (nodes, edges and blocks are keyed by id, which is why Object keys them so: "concurrent edits to different nodes merge independently").
- **Why the ink is not a node kind:** Object's node kinds are exactly `block`, `shape`, `point`, `frame`; adding a fifth would invent schema in the board file. The spec stores ink "as SVG beside the board", so ink is its own layer and file.

**Tech Stack:** as M5. **New dependencies (frontend only), already installed and committed in `ccfb23d` (`chore(deps): add M5 and M6 frontend dependencies up front`; verified in `frontend/package.json` and `node_modules`); no task edits `package.json`, `package-lock.json`, `pyproject.toml` or `uv.lock`, and builds use `npm ci`:**
- **`@xyflow/react@12.12.0`** (published 2026-09-24; MIT). The canvas: pan/zoom with min/max, dotted `Background`, `snapGrid`, marquee selection, `NodeResizer`, handles and connections, `getSmoothStepPath`/`getBezierPath`/`getStraightPath`, `EdgeLabelRenderer`, `ViewportPortal` (the ink layer in flow coordinates), `NodeToolbar`, `onlyRenderVisibleElements`. Chosen because Object's whiteboard is built on Vue Flow and its data model mirrors that library's node/edge model, so React Flow gives the same behaviour (smoothstep = "cornered", bezier = "curved") with a plain projection. Peer deps `react`/`react-dom >=17` (we have 19.3). It depends on `zustand ^4.4.0`, which npm installs nested beside our `zustand@5`; that is expected. `13.0.0-next.0` is a pre-release and is not used.
- **`perfect-freehand@1.2.3`** (published 2026-02-01; MIT; no dependencies). Turns pen samples `[x, y, pressure]` into a variable-width outline polygon, with `simulatePressure` for mouse and touch. Named in the spec (§6).
- **Backend: none.** SVG and JSON are written with the standard library (`xml.etree.ElementTree`, `json`).

**Spec:** `docs/superpowers/specs/2026-10-23-object-design.md` §3 (Whiteboards: "grid of 30 px; blocks (text and objects), 12 shapes, frames, points, logic-circuit gates; connectors straight/cornered/curved, solid/dashed/dotted, end markers none/arrow/dot/double; plus our freehand ink"), §4 (`Whiteboards/Network map.md + Network map.whiteboard.json (+ ink SVGs)`), §7 item 5 ("The Wacom pen draws pressure-sensitive ink on whiteboards"). Scope: the "M6: whiteboards and pen" bullets of `remaining-work.md`.
- **Reference paths.** Read the trimmed, tracked `reference/` (older plans and the build script say `.reference/`; in a clone it is `reference/`). Behaviour and names only, never code.
  - `docs/design-notes`: **the source of the data model and constants** (`WHITEBOARD_GRID_SIZE = 30`, default/min/auto sizes, node kinds, shapes, picker shapes, shape-menu order, circuit labels and their texts, markers and picker markers, connections, lines, dasharrays `'8 8'`/`'0 10'`, the node/edge/viewport/data schemas, tools and their order, one-shot tools, z-order helpers, `nextWhiteboardFrameTitle`, the resolve-last-tool rules, zoom limits and presets, snap helpers).
  - `docs/design-notes` (`RootWhiteboardData`, `RootWhiteboard_canvas`/`RootWhiteboard_notes`, the user-level `whiteboard` settings `isSnappingToGrid`, `isSnappingToNodes`, `isShowingDots`, `isZoomingOnScroll`, `isEngineeringMode` and `boardTools`).
  - `docs/design-notes` (`RootWhiteboard`: name "Whiteboard", plural "Whiteboards", icon `ph-presentation`, `labelColor: 'neutral'`, `wideLayoutMode: true` "The canvas owns the page, so it always renders full width", properties title, description, icon, tags, Canvas, Notes, lastUpdated, createdAt).
  - `docs/design-notes` (`themeColors`, `backgroundColorThemes`, `colorValues` for fill and border).
  - `docs/design.css`: `.whiteboard-canvas` custom properties (`--whiteboard-node-ring: 3px`, `--whiteboard-block-pad-x/y: 15px`, `--whiteboard-auto-min-width: 420px`, `--whiteboard-auto-max-width: 480px`, `--whiteboard-auto-max-height: 420px`, `--whiteboard-auto-text-min-height: 60px`, `--whiteboard-node-radius: .75rem`, `--whiteboard-resize-handle-size: 12px`, `--whiteboard-handle-dot: 12px`, `--whiteboard-embed-caption-height: 30px`, `--whiteboard-embed-caption-gap: 6px`, …), background `var(--color-bg-back)`, dot colour `var(--color-border-base)`, the frame's dashed 3 px border, the selection ring `var(--color-border-block-selection)`, `.whiteboard-title-fade`, the edge label box, cursors per tool.
- **en-US strings:** `docs/strings.txt` (compiled message ASTs; flatten once with a throwaway script outside the repo and grep `Whiteboard.*`, `components.RootWhiteboard.*`, `EntityMenu.clearWhiteboard.*`, `shortcuts.whiteboard*`, `shortcuts.undo`, `shortcuts.redo`, `changeStack.*`, `general.*`). **Every quoted UI string in this plan exists verbatim there unless marked "our string".** Task 7 collects all of them in `whiteboard/strings.ts` with their keys, and a test checks each non-"our" string against the reference file.
- **Not in the trimmed reference** (the full bundle is only on Gene's machine): the **shortcut key bindings** (only their names are in the strings file), the **screen layout** of the toolbox and zoom controls (`docs/` has no whiteboard screenshot; README "Still unseen" lists it), how gates are drawn beyond "rectangle plus this exact label", the entity node "View" options, handle ids, nudge distances, and whether dragging a frame moves what is inside it. This plan makes a stated choice for each, marked "our choice", and Task 13's checklist asks Gene to compare them. Never invent past that.
- **Two reference inconsistencies, resolved:** `component.model.ts` says "nodes do not snap to the 20px grid" while `whiteboard.model.ts` has `WHITEBOARD_GRID_SIZE = 30` and the spec says 30: we use **30**. The model's `WHITEBOARD_EMBED_CAPTION_HEIGHT = 40` vs the CSS `--whiteboard-embed-caption-height: 30px` plus `--whiteboard-embed-caption-gap: 6px`: we use the **CSS values** (what renders).

## Roadmap (one plan per milestone)

| M | Delivers |
|---|---|
| 1 (built; Gene's checks pending) | shell, objects on disk, page + peek, block editor with byte preservation, wikilinks, external changes |
| 2 (built; checks pending) | object types and all property kinds, type settings, title edit and relink, change type, templates, tags, trash |
| 3 (built and gated; checks pending) | views, filters, sorts, group-by, collections, queries, pinned, All notes |
| 4 (built and gated at `4fc0b85`; checks pending) | calendar, daily notes, tasks, recurrence, reminders |
| 5 (building concurrently with M6) | SQLite FTS index, Ctrl+K, backlinks, graph |
| **6 (this plan)** | whiteboards (canvas, items, connectors, controls, undo/redo, drag-in) and pressure-sensitive pen ink |
| 7 | remaining blocks, light mode, settings modal, polish |

## Pre-build: dependencies (done)

- [x] Installed with exact versions and committed in `ccfb23d` together with M5's graph dependencies (`"@xyflow/react": "12.12.0"`, `"perfect-freehand": "1.2.3"` in `frontend/package.json`; `@xyflow/react` carries its nested `zustand@4` as expected). Nothing left to do; tasks run `npm ci` if `node_modules` is missing.

## Global Constraints

**Carried forward from M1–M5** (all of them, unchanged):
- **Server and toolchain:** `127.0.0.1:8790`, no outbound network, Python `>=3.13` with uv, Node `>=22`. Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Opening never writes.** Opening a space, `GET /api/whiteboard`, `GET /api/whiteboard/ink`, opening a board page or peek, panning, zooming and selecting write nothing. A board with no `.whiteboard.json` reads as the empty board and **no file is created until the first edit**. The camera and the per-board tool memory are per-viewer `localStorage` conveniences (every access in try/catch), never written to the space.
- **Writes:** atomic (`textfile.atomic_write`, temp file then replace), checked against the revision the client edited (409 `{currentRevision}` on a stale one, nothing written), recorded in `space.own_writes` so the watcher stays quiet, announced as a `ChangeEvent` with `origin=clientId`. A file the app can't read is never rewritten (423). Object `.md` writes keep EOL/BOM/trailing newline (M1); the board JSON is ours and written like `.object/` definitions (`jsonstore.dump_json`: `indent=2`, `ensure_ascii=False`, LF, trailing newline).
- **Only the board's own files.** A board or ink save writes exactly one file (`<stem>.whiteboard.json` or `<stem>.ink.svg`) beside its `.md`; never the `.md`, never another file. Deletes go to the trash (with the sidecars) and restore byte-identically.
- **Tests:** the M4 final gate (`4fc0b85`; HEAD `63a2dbd` only adds docs) is 611 back-end tests and 654 front-end tests in 99 files; M5 adds its own while M6's lanes run, so record the counts when the build launches and again before Task 13. Every task keeps all earlier tests green. A test that passes before its task's code exists is labelled "regression guard (green from the start)". M6 backend tests use their own synthetic space (`space-whiteboard`, Task 1) through `backend/tests/wb_support.py`, never `conftest.py` (M5's file); no test asserts absolute counts of other fixtures.
- **Fidelity.** Labels, option keys, defaults, orders and CSS values come from the reference. "our string" marks text with no Object original; "our choice" marks behaviour the trimmed reference doesn't show.

**New in M6**
- **Lane isolation (critical).** Tasks 1–12 create files only; their Files lists contain no pre-existing path. A task that finds it "needs" a pre-existing file writes a function or prop for Task 13 to wire, and records it in its commit message. Task 13 starts only after M5's integrate task has committed.
- **Storage.**

  | What | Where | Written by |
  |---|---|---|
  | The whiteboard object | `Whiteboards/<Title>.md`: frontmatter `id`, `type: 'Whiteboard'`, `title`, `createdAt`, `lastUpdated` (and `tags`, `description`, `icon` when set through M2's property routes); the body is the board's **Notes** (`RootWhiteboard_notes`), kept as written | `POST /api/whiteboards`, M1/M2 object routes |
  | The canvas | `Whiteboards/<Title>.whiteboard.json` (same folder, same stem as the `.md`) | `PUT /api/whiteboard` |
  | The ink | `Whiteboards/<Title>.ink.svg` (same stem) | `PUT /api/whiteboard/ink` |
  | The Whiteboard type | `.object/types/whiteboard.json`, written the first time a whiteboard is created (M2's lazy `_persist_type`, as for daily notes) | `POST /api/whiteboards` |
  | Canvas display settings | `.object/ui.json` key `whiteboard`: `{isSnappingToGrid?, isSnappingToNodes?, isShowingDots?, isZoomingOnScroll?, isEngineeringMode?}` (Object's user-level names; absent = defaults true, true, true, true, false) | `PUT /api/ui` (key added by Task 13) |
  | Camera per board, tool memory per board (`WhiteboardBoardToolMemory`) | `localStorage` keys `object.wb.camera.<board id or path>`, `object.wb.tools.<board id or path>` | the client |

- **Board file format** (Object's `WhiteboardData`, plus one key). Exactly the `whiteboardDataSchema` fields `version` (1), `nodes` (record by id), `edges` (record by id), `viewport?`, `locked?`, `readingOrder?`, with node and edge fields exactly as `whiteboardNodeSchema`/`whiteboardEdgeSchema`. **The one addition is `blocks`**: Object keeps the canvas blocks on the entity's `RootWhiteboard_canvas` property beside `data.whiteboard`; we keep that property in the same file, as `blocks: {<blockId>: Block}`. Blocks are the minimum the spec's "blocks: text and embedded objects" needs:
  - `{"type": "text", "markdown": "<Markdown>", "align"?: "left"|"center"|"right"}`: a text block's content, a shape's in-shape text, a gate's label, a connector's label (horizontal alignment "lives on the TextBlock", as in the model);
  - `{"type": "entity", "link": "[[Title]]"}`: an embedded object (a wikilink, like every link in Object, so rename relinks it).
  Unknown keys at any level are kept on read and on save. `version` greater than 1 opens read-only ("This whiteboard was saved by a newer version of Object." our string). The empty board is `{"version": 1, "nodes": {}, "edges": {}, "blocks": {}}`.
- **Item semantics** (from `whiteboard.model.ts`):
  - **Block nodes** (`kind: 'block'`): a text block or an embedded object. Fresh text nodes are 420 × 60 (`GRID × 14`, `GRID × 2`) and size themselves to content up to 480 wide and 420 tall until resized; resize floor 40 × 30. Embedded objects show the object as M3's small card with a 30 px caption bar above (6 px gap); link-block minimum width 360. **Double-click opens the object in the peek; Ctrl/Cmd+double-click in a new tab** (our choice). A dangling link renders the link text in M1's dangling-link style.
  - **Shapes** (`kind: 'shape'`, `shape` one of the 12 `whiteboardShapes`): all 12 render; the picker offers the 9 `whiteboardPickerShapes` in `whiteboardShapeMenuTools` order (Line, Arrow, Rectangle, Ellipse, Diamond, Parallelogram, Triangle, Star, Bubble, Arrow right, Heart); `roundedRectangle`, `triangleDown` and `blockArrowLeft` "stay renderable for existing boards but are not in the picker" (the remaining-work bullet lists all 12; we follow Object, flagged for Gene). Floor 90 × 90. `fillColor` (`bg-*`), `borderColor` (theme colour), `rotation` (degrees, shapes only), `flipX`/`flipY`, `textVerticalAlign` (unset = center). In-shape text is a text block.
  - **Gates** "Persist as `rectangle` plus this exact label; never as `node.shape`": a gate is a rectangle shape (90 × 90) whose text block's Markdown is exactly `NOT`, `AND`, `NAND`, `OR`, `NOR`, `XOR`, `XNOR`, `HIGH` or `LOW`. They are offered only in Engineering mode ("Gates", with "I/O" for HIGH/LOW); HIGH and LOW get the circuit ring style (`data-circuit-bit`); other drawing is a labelled rectangle (our choice: the gate symbols are not in the trimmed reference).
  - **Frames** (`kind: 'frame'`): default 480 × 420, dashed 3 px border, always behind content (`nextWhiteboardFrameZ`, content z ≥ 1 via `nextWhiteboardContentZ`), title from `nextWhiteboardFrameTitle` ("Frame 1", "Frame 2", …; custom titles don't use a number), "Add frame title"/"Remove frame title". **Dragging a frame moves the nodes wholly inside it** (our choice: the schema has no parent field; containment is computed at drag start).
  - **Points** (`kind: 'point'`): free-standing connector ends, size 0; "Points never take arrows" (`isWhiteboardConnectableNode`).
  - **Connectors:** `connection` (unset = cornered, React Flow smoothstep; curved = bezier; straight), `line` (unset = solid; dashed `8 8`, dotted `0 10` with round caps), `markerStart`/`markerEnd` (`arrowClosed` parses and renders as `arrow`), `color`, label = a text block (`blockId`; created by double-click; the deprecated `label` string renders and becomes a block on edit). A new connector copies the board's remembered last connection and line (`rememberedWhiteboardEdgeStyle`). The Line tool draws without tips, the Arrow tool with `markerEnd: 'arrow'`; drawn in empty space they create two points. Handle ids `top`/`right`/`bottom`/`left` (our choice).
  - **Tools** (`whiteboardTools` order): Move (`select`), Hand, Text, Existing object (`link`), New object (`create`), Shapes (re-arms the last shape-menu tool, else Rectangle), Gates (Engineering mode; re-arms the last gate, else NAND), Frame, and our pen group (Pen, Highlighter, Eraser). The pointer button re-arms Move or Hand, whichever was last. One-shot tools (`whiteboardOneShotTools`) return to Move after placing one item; click places the default size, drag places a box snapped with `snapWhiteboardBox`. The media tools (image, PDF, audio, file, web link) are **not in M6**.
  - **Zoom:** `WHITEBOARD_ZOOM_MIN` 0.02, `MAX` 4, presets `[0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3]`. With "Zoom with scroll wheel" off the wheel pans. Space+drag pans with any tool.
  - **Lock:** "Lock whiteboard" sets `locked: true` (view only for everyone, written to the board); "Unlock whiteboard" clears it. Per-node `locked` is kept and honoured (not draggable, not deletable) but has no UI in M6.
- **Shortcut keys (our choice; the names are Object's `shortcuts.whiteboard*`).** Active only while the canvas has focus and no editor or input has it:

  | Name (reference) | Key |
  |---|---|
  | Select tool / Hand tool / Text / Rectangle / Ellipse / Triangle / Line / Arrow / Frame | V / H / T / R / O / Shift+R / L / A / F |
  | Pan | Space+drag |
  | Zoom in / Zoom out / Zoom to 100% / Zoom to fit / Zoom to selection | Ctrl+= / Ctrl+- / Ctrl+0 / Shift+1 / Shift+2 |
  | Duplicate selection / Duplicate while dragging | Ctrl+D / Alt+drag |
  | Disable snapping while dragging | hold Ctrl while dragging |
  | Nudge selection / Nudge selection farther | arrows (one grid cell, 30) / Shift+arrows (five cells) |
  | Bring to front / Bring forward / Send backward / Send to back | Ctrl+Shift+] / Ctrl+] / Ctrl+[ / Ctrl+Shift+[ |
  | Flip horizontal / Flip vertical | Shift+H / Shift+V |
  | Wrap in frame | Ctrl+Alt+G |
  | Cycle selected objects / … backward | Tab / Shift+Tab |
  | Undo last change / Redo last change | Ctrl+Z / Ctrl+Shift+Z and Ctrl+Y |
  | Delete | Delete, Backspace |
  | Pen / Highlighter / Eraser (Gene's; our strings) | P / M / E |

  App-wide shortcuts (M1: Ctrl+N, Ctrl+U, Ctrl+Backspace) keep working; Escape first clears the selection, then (in the peek) closes it.
- **Freehand ink (Gene's addition; all ink UI strings are our strings).**
  - **Stroke model:** `InkStroke {id, tool: 'pen'|'highlighter', color: '#rrggbb', width, points: [x, y, pressure][], d}` in canvas (flow) units. `id` is a ULID-like `[A-Za-z0-9_-]{1,64}`, unique in the file. `d` is the SVG path of the `perfect-freehand` outline, computed by the client.
  - **Pressure:** `pointerType === 'pen'` uses `PointerEvent.pressure` (0–1) and every coalesced sample (`getCoalescedEvents()`), so fast strokes have no gaps; mouse and touch use `simulatePressure: true`. The Wacom **eraser end** (`buttons & 32`, or `pointerType 'pen'` with `button === 5`) erases while held, whatever tool is selected; the barrel button (`buttons & 2`) never draws. While a pen is in contact, touch input on the canvas is ignored (palm rejection).
  - **Tools:** Pen (widths 2, 4, 8; default 4; `thinning 0.5, smoothing 0.5, streamline 0.5`), Highlighter (widths 16, 32; default 16; `thinning 0`, flat; drawn at `fill-opacity 0.35`), Eraser (removes every stroke whose path passes within 10 screen pixels of the eraser path; whole strokes, no partial erase). Colours: the 18 theme colours (`THEME_COLORS` in `theme/palette.ts`, the same set as the app's `ColorPicker`), each as the hex behind `palette.ts` `lineColor()`. `lineColor()` returns `var(--line-<theme>)`, not a hex, and an SVG file can't use the app's CSS variables, so `inkModel.ts` copies the values of the `--line-*` tokens from `theme/tokens.css` as constants (gray `#5c5959`; every other colour is its `--label-border-<theme>` hex, e.g. blue `#3f80eb`, yellow `#daaa14`), checked by a test that reads `tokens.css`. Default gray. The stored value is the hex, plus `data-color` with the theme name.
  - **Layer:** ink renders above nodes and connectors (an overlay in flow coordinates), is not selectable or movable in M6, and is included in undo/redo (one stroke or one erase gesture is one step). A board whose ink file is read-only shows the ink and disables the pen group with the tooltip "This ink file has content Object didn't write, so it opens read-only." (our string).
  - **SVG file:**
    ```xml
    <?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg" version="1.1" data-object-ink="1" viewBox="<minX> <minY> <w> <h>">
      <path id="s-<id>" data-tool="pen" data-color="blue" data-width="4" data-points="x,y,p x,y,p …" fill="#3f80eb" d="M …"/>
      <path id="s-<id>" data-tool="highlighter" data-color="yellow" data-width="16" data-points="…" fill="#daaa14" fill-opacity="0.35" d="M …"/>
    </svg>
    ```
    Numbers are written with at most 2 decimals (pressure 3). `viewBox` is the bounds of all strokes plus 15 units (`0 0 1 1` when empty); saving zero strokes writes this empty SVG (the file is never deleted by a save). The file opens in any browser and shows the same ink. On read, only this shape is accepted: a DOCTYPE, an entity, any element other than our `<path>`s, or a `<path>` without `data-points` makes the ink read-only (423 on save), never rewritten.
- **Display settings:** read from `ui.json` `whiteboard`, written only when a toggle changes (`PUT /api/ui`, 409 refetch and re-apply once, as M3's `useViewState`).
- **Change events:** the board and ink routes announce `ChangeEvent(kind='whiteboard', path=<the .md path>, version=<new revision>, origin=clientId)`. Task 13 adds `'whiteboard'` to the `ChangeEvent.kind` Literal (`watcher.py`) and the client's `ChangeKind` (`api/types.ts`), and makes the watcher announce it when a sidecar changes on disk outside the app. Until then the frontend compares `(e.kind as string) === 'whiteboard'` (a plain `e.kind === 'whiteboard'` is a `tsc` "no overlap" error against today's union). `api.onChange` drops server echoes of this window's own writes (`origin === CLIENT_ID`) and `api`'s own writes announce themselves locally through the private `emitLocal`; the whiteboard and ink clients can't reach `emitLocal`, so a board open in a page and in the peek of the same window only sees its own saves on the next load (our choice for M6; Task 13 may add a local emit when it touches `api/client.ts`).
- **Decisions flagged for Gene** (listed again in `m6-acceptance.md`): board edits don't bump the `.md`'s `lastUpdated` (Object does; we keep canvas work out of the `.md`); the camera is per viewer, so the file's `viewport` is kept but never written by panning; the screen layout (title top left, toolbox bottom centre, zoom bottom right, our choice); the shortcut keys; frames dragging their contents; 9 of 12 shapes in the picker; "Clear Whiteboard" also clears the ink; change type is refused for whiteboards (a sidecar can't follow a type change): M2's existing rule does it once `changetype.type_category` knows the Whiteboard category, giving its existing 422 messages "The type of a Whiteboard object can't be changed" / "An object can't be changed to a Whiteboard" (M2's strings, no new one).
- **Not in M6** (so they are not built by accident): the media tools and headless media nodes (`Whiteboard.tools.image|pdf|audio|file|weblink`), the connector-drop quick-create menu (`Whiteboard.quickCreate.*`), the Floating Inspector (Outline / Frames / Stats), reading-order editing (`readingOrder` is kept, used by `board_text`), presentation (`Whiteboard.control.play`, pages), system-clipboard copy/paste (`WHITEBOARD_CLIPBOARD_PREFIX`), version history, PNG export, "Turn into whiteboard" / "Add to whiteboard" / "New whiteboard" from a selection, the phone outline view, the entity node "View" menu (`Whiteboard.control.view`), keyboard resize (`shortcuts.whiteboardResize*`), per-node lock UI, a Notes editor on the board page, moving or resizing ink, partial erase, pen tilt.

## API contract (M6): shared by the three lanes

```
WhiteboardNode   { id, kind: 'block'|'shape'|'point'|'frame', blockId?, position: {x, y}, width?, height?, z?,
                   shape?: WhiteboardShape, fillColor?: 'bg-<theme>', borderColor?: <theme>, locked?, flipX?, flipY?,
                   rotation?, textVerticalAlign?: 'top'|'center'|'bottom', headless?, title?, [unknown: kept] }
WhiteboardEdge   { id, source, target, sourceHandle?, targetHandle?, markerStart?, markerEnd?: 'none'|'arrow'|'arrowClosed'|'dot'|'double',
                   connection?: 'straight'|'cornered'|'curved', line?: 'solid'|'dashed'|'dotted', color?: <theme>, blockId?, label?, [unknown: kept] }
WhiteboardBlock  { type: 'text', markdown: string, align?: 'left'|'center'|'right' } | { type: 'entity', link: '[[Title]]' }
WhiteboardData   { version: 1, nodes: {[id]: WhiteboardNode}, edges: {[id]: WhiteboardEdge}, blocks: {[id]: WhiteboardBlock},
                   viewport?: {x, y, zoom, paneWidth?, paneHeight?}, locked?: boolean, readingOrder?: string[], [unknown: kept] }
BoardResponse    { path, board: WhiteboardData, revision: string /* '' = no file yet */, readOnlyReason?: string }
InkStroke        { id, tool: 'pen'|'highlighter', color: '#rrggbb', width: number, points: [x, y, pressure][], d: string }
InkResponse      { path, strokes: InkStroke[], revision: string, readOnlyReason?: string }
WhiteboardSettings { isSnappingToGrid?, isSnappingToNodes?, isShowingDots?, isZoomingOnScroll?, isEngineeringMode? }   /* ui.json `whiteboard` */
ChangeEvent.kind += 'whiteboard'   /* path = the board's .md path (Task 13 adds it to the Literal and the TS union) */
```

| Route (router from `whiteboardapi.whiteboard_router(space, announce)`, prefix `/api`) | Request | Success | Errors |
|---|---|---|---|
| `GET /api/whiteboard?path=` | | `BoardResponse` (empty board and `revision: ''` when the file is missing; nothing written) | 400 (outside the space, not an object), 404, 422 (not a Whiteboard) |
| `PUT /api/whiteboard` | `{path, board, baseRevision, clientId?}` | `{revision}`; announces `whiteboard` | 409 `{currentRevision}`, 422 `{detail}` (invalid board), 423 `{reason}` (existing file unreadable or newer version), 404, 400 |
| `GET /api/whiteboard/ink?path=` | | `InkResponse` (`strokes: []`, `revision: ''` when missing) | 400, 404, 422 |
| `PUT /api/whiteboard/ink` | `{path, strokes, baseRevision, clientId?}` | `{revision}`; announces `whiteboard` | 409, 422, 423, 404, 400 |
| `POST /api/whiteboards` | `{title?, clientId?}` | 201 `{path, version, typeIds}` (as `POST /api/objects`; `typeIds` holds `whiteboard` when its JSON was written now); announces `created` (and `types`) | 422 (title only whitespace is fine: "Untitled", as M1) |
| `PUT /api/ui` (Task 13) | the patch accepts `whiteboard` | as M3 | 422 for a wrong shape (`whiteboard_ui_problem`) |

- A `baseRevision` of `''` means "the file must not exist yet" (a create, exclusive); anything else must equal the current sha256.
- Reads and writes of the sidecars hold `space._lock`; the write records `space.own_writes[<sidecar rel>] = <sha256>`.
- **Ink plugin** (Lane B produces `whiteboard/ink/index.ts` `inkPlugin`; Lane C consumes the structural type `InkPlugin` from `whiteboard/plugin.ts`; Task 13 passes it to `WhiteboardPage`):
  ```ts
  interface InkToolState { tool: 'pen' | 'highlighter' | 'eraser'; color: string; width: number }
  interface InkLayerProps {   // rendered as a child of <ReactFlow>; may use useReactFlow/useViewport/ViewportPortal
    strokes: InkStroke[]; tool: InkToolState | null; readOnly: boolean; panning: boolean
    onStrokesChange(next: InkStroke[], label: 'draw' | 'erase'): void
    onWheel(e: WheelEvent): void   // the canvas zooms or pans; the capture overlay forwards wheels while an ink tool is on
  }
  interface InkToolbarProps { value: InkToolState | null; readOnly: boolean; onChange(next: InkToolState | null): void }
  interface InkDoc { strokes: InkStroke[] | null /* null while loading */; readOnlyReason: string | null
                     save(next: InkStroke[]): void /* debounced 400 ms, merges by stroke id on 409 */; flush(): Promise<void> }
  interface InkPlugin { Layer: ComponentType<InkLayerProps>; Toolbar: ComponentType<InkToolbarProps>; useInkDoc(path: string): InkDoc }
  ```
  Lane C types strokes as `InkStroke` re-declared structurally in `plugin.ts` (the same six fields); `tsc` at Task 13 proves the two match.
- **Whiteboard host** (`whiteboard/host.ts`, Task 9): `{openObject(path, e: {ctrlKey, metaKey}), linkFor(path): string, resolve(link, from): Promise<string|null>, rows(paths): Promise<Row[]>, requestDelete(path, mode: 'page'|'peek'), createObject(typeId): Promise<string>, objects(): Promise<ObjectSummary[]>}`. Defaults use the real modules, imports only: `openObject` → `usePeek.getState().peek(path)` for a plain double-click, and `openObject(path, {ctrlKey, metaKey})` from `@/create/createAndOpen` with Ctrl/Cmd (its `openModeFor` maps Ctrl/Cmd to a new tab; a plain call would open in the current tab, not the peek); `linkFor` → `` `[[${summaryOf(path)?.title ?? stemOf(path)}]]` `` (`@/links/linkIndex`); `resolve` → `resolveLink(link, from)`; `rows` → `api.rows({paths})`; `createObject` → `api.createObject(typeId).then((r) => r.path)`; `objects` → `api.objects()`; `requestDelete` → `useDeleteRequest.getState().requestDelete(path, mode)` (`@/object/DeleteObjectDialog`, the store App.tsx's Ctrl+Backspace already uses; `WhiteboardPage` answers it, see Task 9). Tests inject fakes.

## Review Focus

1. **Opening and viewing write nothing.** `GET` of a board and its ink (also when missing), opening the page or peek, panning, zooming, selecting and changing tools write no file; a missing `.whiteboard.json` is not created on open; display settings are written only on a toggle.
   - *(Task 1: `test_space_opens_without_writing`; Task 3: `test_get_board_writes_nothing`, `test_get_missing_board_returns_empty_and_creates_nothing`, `test_get_ink_writes_nothing`; Task 9: `test open, pan, zoom and select save nothing`, `test camera and tool memory go to localStorage only`; Task 13 Step 2 check 1)*
2. **Board and ink saves are atomic, revision-checked and touch only their own file.**
   - *(Task 3: `test_save_board_writes_only_its_file`, `test_save_stale_revision_409_nothing_written`, `test_create_requires_empty_base`, `test_save_over_unreadable_423_file_untouched`, `test_save_is_atomic_temp_then_replace`, `test_own_writes_recorded`, `test_md_bytes_never_change_on_board_save`; Task 9: `test 409 merges local changes onto the server copy and saves once`; Lane B Task 6: `test ink 409 merges by stroke id`)*
3. **Trash, restore and rename carry the sidecars, byte for byte.** Deleting a whiteboard moves `.md`, `.whiteboard.json` and `.ink.svg` into the trash; restore puts all three back byte-identical (with " (2)" stems that match when the original name is taken, never adopting an orphan sidecar); purge removes them; rename moves all three or none.
   - *(Task 4: `test_trash_sidecars_moves_both`, `test_restore_sidecars_byte_identical`, `test_restore_collision_follows_md_stem`, `test_free_stem_skips_orphan_sidecar`, `test_purge_removes_sidecars`, `test_move_sidecars_rolls_back_on_failure`; Task 13: `test_delete_whiteboard_trashes_sidecars`, `test_restore_whiteboard_byte_identical`, `test_rename_whiteboard_moves_sidecars`, `test_change_type_refused_for_whiteboards`; Step 2 checks 7–10)*
4. **The board file round-trips without loss.** Validation matches Object's schema; unknown keys are kept; `arrowClosed` loads; the client projection board → React Flow → board is the identity for every fixture board.
   - *(Task 2: `test_validate_accepts_fixture_board`, `test_validate_rejects_bad_boards`, `test_unknown_keys_kept`, `test_dump_is_stable`; Task 8: `test projection round trip is identity on every fixture board`, `test unknown node and edge keys survive the projection`; Task 13 Step 2 check 5)*
5. **It reads the same as Object.** Grid 30, sizes, z rules, tool and shape-menu orders, picker sets, connector defaults and dasharrays, zoom limits and presets, frame titles, and every quoted string match the reference.
   - *(Task 7: `test constants match the reference model`, `test every reference string exists verbatim in the strings file`; Task 8: `test frame z stays below content`, `test next frame title skips used numbers`; Task 11: `test unset connection renders cornered and unset line solid`, `test dash arrays`; Task 12: `test shape menu order and picker set`, `test gates only in engineering mode`)*
6. **Pressure makes the ink, and the SVG is real.** Pen pressure changes width, mouse simulates it, the eraser end erases, the SVG renders standalone and round-trips, foreign SVG content is never rewritten.
   - *(Task 5: `test higher pressure gives a wider outline`, `test mouse uses simulated pressure`, `test eraser hit test within 10 screen pixels`; Task 6: `test pen pointer events record pressure and coalesced samples`, `test wacom eraser end erases while held`; Task 2: `test_ink_svg_round_trip_byte_identical`, `test_ink_svg_renders_standalone`, `test_foreign_svg_read_only`, `test_ink_parse_rejects_doctype`; Task 13 Step 5 Wacom check)*
7. **Undo/redo is exact.** Every change (ink included) is one undoable step, drags coalesce into one, undo after a save saves the earlier state, an external reload clears the history.
   - *(Task 8: `test history coalesces a drag into one step`, `test undo redo restore exact documents`; Task 9: `test undo after save saves the earlier state`, `test stroke and node changes share one history`)*
8. **Lane isolation held.** No M6 task before Task 13 changed a pre-existing file.
   - *(Task 13 Step 1: the M6 lane commits add files only, apart from Tasks 10–12 replacing Task 9's stubs; M5's commits in the same range are not counted)*

---

## File Structure

```
backend/objectapp/   whiteboardfile.py whiteboardink.py whiteboardstore.py whiteboardapi.py whiteboardtrash.py     NEW (Tasks 2-4)
backend/tests/       fixtures/space-whiteboard/   wb_support.py                                                     NEW (Task 1)
                     test_whiteboard_fixtures.py test_whiteboard_file.py test_whiteboard_ink.py
                     test_whiteboard_api.py test_whiteboard_trash.py test_whiteboard_integration.py                 NEW (Tasks 1-4, 13)
frontend/src/api/    whiteboardTypes.ts whiteboardClient.ts (+ whiteboardClient.test.ts)                           NEW (Task 7)
frontend/src/whiteboard/
  ink/               types.ts inkModel.ts inkStrings.ts inkClient.ts (+ tests)                                      NEW (Task 5)
                     InkLayer.tsx InkToolbar.tsx useInkDoc.ts index.ts (+ tests)                                    NEW (Task 6)
  model.ts strings.ts colors.ts dnd.ts whiteboard.css test/{flowEnv.ts,boards.ts,mockWhiteboardApi.ts}             NEW (Task 7)
  shapes.ts history.ts merge.ts flowMapping.ts actions.ts snapGuides.ts camera.ts (+ tests)                        NEW (Task 8)
  plugin.ts host.ts canvasTypes.ts store.ts useBoard.ts useWhiteboardSettings.ts toolMemory.ts shortcuts.ts
  WhiteboardCanvas.tsx WhiteboardPage.tsx BoardHeader.tsx (+ tests)                                                NEW (Task 9)
  nodes/index.ts edges/index.ts chrome/index.ts                                                                    STUBS by Task 9
  nodes/        BlockNode.tsx EntityNode.tsx ShapeNode.tsx FrameNode.tsx PointNode.tsx NodeChrome.tsx TextBlockEditor.tsx index.ts   Task 10
  edges/        ConnectorEdge.tsx Markers.tsx EdgeLabel.tsx connectorStyle.ts index.ts                             Task 11
  chrome/       Toolbox.tsx ShapeMenu.tsx GatesMenu.tsx DisplayMenu.tsx ZoomMenu.tsx SelectionToolbar.tsx
                EdgeStyleMenu.tsx ObjectPicker.tsx BoardMenu.tsx ClearBoardDialog.tsx index.ts                     Task 12
scripts/m6_acceptance.py   docs/superpowers/plans/m6-acceptance.md                                                 NEW (Task 13)
Pre-existing, Task 13 only: backend/objectapp/{server.py,space.py,typemodel.py,changetype.py,watcher.py,media.py,
  roles.py linkindex.py searchindex.py (M5)}
  frontend/src/{api/types.ts,api/client.ts,object/ObjectPage.tsx,object/ObjectPeek.tsx,create/NewObjectMenu.tsx,
  shell/PinnedSection.tsx,palette/SearchView.tsx (M5)} (+ their tests), remaining-work.md
```

### Shared files and ordering

| File | Edited by | Why it forces order |
|---|---|---|
| Every pre-existing file (`server.py`, `space.py`, `typemodel.py`, `changetype.py`, `watcher.py`, `media.py`, `conftest.py`, `api/types.ts`, `api/client.ts`, `test/mockApi.ts`, `test/setup.ts`, `nav/tabs.ts`, `App.tsx`, `shell/*`, `object/*`, `create/*`, `index.css`, `package*.json`) and every file M5 creates (`roles.py`, `linkindex.py`, `searchindex.py`, `palette/SearchView.tsx`, …) | **Task 13 only** (package files: already committed in `ccfb23d`) | M5 owns them during the concurrent build; Task 13 runs after M5's `chore: milestone 5 acceptance` commit |
| `backend/objectapp/whiteboardfile.py`, `whiteboardink.py` | Task 2 | Tasks 3 and 4 import them, so both wait for Task 2 |
| `backend/objectapp/whiteboardstore.py`, `whiteboardapi.py` | Task 3 | sub-lane A1 |
| `backend/objectapp/whiteboardtrash.py` | Task 4 | sub-lane A2 (disjoint from A1) |
| `backend/tests/wb_support.py`, `fixtures/space-whiteboard/**` | Task 1 | every backend task uses them; Task 13 may add a file only through a new fixture copy in its own test |
| `frontend/src/whiteboard/ink/**` | Tasks 5 → 6 (Lane B) | Lane C never imports `ink/`; Task 13 imports `ink/index.ts` |
| `api/whiteboardTypes.ts`, `api/whiteboardClient.ts`, `whiteboard/{model,strings,colors,dnd}.ts`, `whiteboard.css`, `whiteboard/test/*` | Task 7 | every Lane C task imports them |
| `whiteboard/{shapes,history,merge,flowMapping,actions,snapGuides,camera}.ts` | Task 8 | Tasks 9–12 import them |
| `whiteboard/{plugin,host,canvasTypes,store,useBoard,…}.ts`, `WhiteboardCanvas.tsx`, `WhiteboardPage.tsx` | Task 9 | Tasks 10–12 consume `canvasTypes.ts` and the store's action hook |
| `whiteboard/nodes/index.ts`, `edges/index.ts`, `chrome/index.ts` | stubs by Task 9, replaced in full by Tasks 10, 11, 12 respectively | the owner overwrites the stub; export names and prop types are fixed by `canvasTypes.ts` |

Dependency edges: 1 → 2 → {3, 4}; 5 → 6; 7 → 8 → 9 → {10, 11, 12}; everything → 13. No edge crosses lanes.

## Build lanes

| Lane | Run first, in order | Then sub-lanes in parallel (each in order) | Owns |
|---|---|---|---|
| **A backend** | Task 1 → Task 2 | **A1:** Task 3 · **A2:** Task 4 | `backend/objectapp/whiteboard*.py`, `backend/tests/{wb_support.py,fixtures/space-whiteboard/**,test_whiteboard_{fixtures,file,ink,api,trash}.py}` |
| **B ink** | Task 5 → Task 6 | (none) | `frontend/src/whiteboard/ink/**` |
| **C canvas** | Task 7 → Task 8 → Task 9 | **C1:** Task 10 · **C2:** Task 11 · **C3:** Task 12 | `frontend/src/api/whiteboard*`, `frontend/src/whiteboard/**` except `ink/` |
| **integrate** | Task 13, after every lane **and after M5's integrate commit** (`chore: milestone 5 acceptance`) | | the pre-existing files listed above, `scripts/m6_acceptance.py`, `m6-acceptance.md`, `test_whiteboard_integration.py` |

Lanes A, B and C start together. Each task runs only its own test files plus `npx tsc -b --noEmit` (frontend) during the build; the full suites run at Task 13 and the gate. Commits from parallel lanes may hit `index.lock`: wait and retry, and always `git add` explicit paths.

---

### Task 1: Fixture space `space-whiteboard` and test support (lane A)

**Files:**
- Create: `backend/tests/fixtures/space-whiteboard/**`, `backend/tests/wb_support.py`, `backend/tests/test_whiteboard_fixtures.py`

**Interfaces:**
- Produces: `wb_support.copy_whiteboard_space(tmp_path) -> Path` (a `shutil.copytree` into `tmp_path`), `wb_support.tree_hashes(root) -> dict[str, str]` (sha256 per file, dot-folders included), `wb_support.FIXTURE`. Test files define their own fixture `@pytest.fixture def wb_dir(tmp_path): return copy_whiteboard_space(tmp_path)` and import with `from wb_support import …` (pytest's default rootdir-prepend import mode; `backend/tests` has no `__init__.py`). `conftest.py` is not touched.

The space (all content invented):
- `.object/types/`: `whiteboard.json` (the basic Whiteboard type: `id: whiteboard`, `name: Whiteboard`, `pluralName: Whiteboards`, `folder: Whiteboards`, icon `ph-presentation`, `color: gray`, `basic: true`), `page.json`, `person.json`, `tag.json`, all in the `schemaVersion: 2` shape of `fixtures/space-calendar/.object/types/*.json` (icon as `{"type": "iconify", "val": "ph-…"}`, the system property definitions written out as there; copy `page.json`, `person.json` and `tag.json` from `space-calendar` and adapt).
- `Pages/Router A.md`, `Pages/Router B.md`, `People/Ada Example.md`, `Tags/Network.md`.
- `Whiteboards/Network map.md` (a body of Notes with two lines) + `Network map.whiteboard.json` with: one text block node (with `align: center`), two entity block nodes (`[[Router A]]`, `[[Router B]]`), one shape of each of the 12 shapes (some with `fillColor`, `borderColor`, `rotation`, `flipX`, `textVerticalAlign: top`, in-shape text), the nine gates (rectangles labelled `NOT` … `LOW`), two frames (`Frame 1`, a custom title "Core"), two points, edges covering every `connection`, every `line`, every marker (including `arrowClosed`), a `color`, a label block, a deprecated `label` string, `viewport`, `readingOrder`, and an unknown key at board, node and edge level (`"x-future": 1`) + `Network map.ink.svg` (three pen strokes with varying pressure, one highlighter stroke).
- `Whiteboards/Empty board.md` (no sidecars).
- `Whiteboards/Broken board.md` + `Broken board.whiteboard.json` (not valid JSON).
- `Whiteboards/Future board.md` + JSON with `"version": 2`.
- `Whiteboards/Foreign ink.md` + valid JSON + `Foreign ink.ink.svg` containing a `<rect>`.
- `Whiteboards/Dotted v1.2 plan.md` + `Dotted v1.2 plan.whiteboard.json` (a stem with dots).
- `Whiteboards/Orphan (2).whiteboard.json` (a sidecar with no `.md`, for the free-stem rule).
- `ui.json` absent. No `.gitattributes` of its own: `backend/tests/fixtures/.gitattributes` already has `* -text` for every fixture file (sidecars included), so git never normalises them; do not edit that file (pre-existing).

- [ ] **Step 1: Write failing tests** (`test_whiteboard_fixtures.py`)
  - `test_every_md_has_frontmatter_and_unique_paths`
  - `test_space_opens_without_writing`: `Space(wb_dir)` twice; `tree_hashes` unchanged.
  - `test_expected_inventory`: the Network map board has all 12 shapes, all 9 gate labels, every connection/line/marker value, both deprecated and block labels, the three unknown keys; the ink file has 4 `<path>`s with distinct pressures; Broken, Future, Foreign and Orphan files exist as described.
  - `test_sidecars_are_not_objects` (regression guard once the files exist): `Space(wb_dir).list()` contains no `.json`/`.svg` path (`typedefs.iter_object_paths` and `Space._rel` take `.md` only).
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_whiteboard_fixtures.py -q`. Expected: FAIL.
- [ ] **Step 3:** Write the files and `wb_support.py`.
- [ ] **Step 4:** Run `uv run pytest backend/tests/test_whiteboard_fixtures.py -q`. Expected: PASS.
- [ ] **Step 5:** Commit `test(fixtures): synthetic whiteboard space` (blank line, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).

### Task 2: Board JSON and ink SVG formats (lane A)

**Files:**
- Create: `backend/objectapp/whiteboardfile.py`, `backend/objectapp/whiteboardink.py`
- Test: `backend/tests/test_whiteboard_file.py`, `backend/tests/test_whiteboard_ink.py`

**Interfaces:**
- Consumes: Task 1; `jsonstore.dump_json(data) -> bytes` (imports only). Revisions are `space.version_of(bytes)` (sha256 hex) of bytes already read; `jsonstore.json_revision(path: Path)` gives the same for a file, `''` when missing.
- Produces (`whiteboardfile.py`, pure, no `Space`):
  - `BOARD_SUFFIX = ".whiteboard.json"`, `INK_SUFFIX = ".ink.svg"`; `board_rel(md_rel) -> str`, `ink_rel(md_rel) -> str` (replace the final `.md`; `Dotted v1.2 plan.md` → `Dotted v1.2 plan.whiteboard.json`); `sidecar_owner(rel) -> str | None` (the `.md` path a sidecar belongs to, else `None`); `sidecar_rels(md_rel) -> tuple[str, str]`.
  - The model's enums as frozensets (`NODE_KINDS`, `SHAPES`, `MARKERS` incl. `arrowClosed`, `CONNECTIONS`, `LINES`, `THEME_COLORS`, `BG_COLORS`, `TEXT_ALIGNS`, `V_ALIGNS`); `DATA_VERSION = 1`.
  - `empty_board() -> dict`; `class BoardInvalid(Exception)` (`.detail`); `validate_board(data) -> None`: the rules of `whiteboardDataSchema` plus `blocks`: each node/edge key equals its `id`; enums; finite numbers; `width`/`height` > 0; edge `source`/`target` name existing nodes; `blockId` names an existing block; block `type` `text` (string `markdown`, optional `align`) or `entity` (`link` matching `^\[\[[^\[\]\n]+\]\]$`); `readingOrder` a list of strings; at most 20,000 nodes and 50,000 edges. Messages are short English sentences (our strings), e.g. "Edge e3 points to a node that doesn't exist."
  - `load_board(data: bytes) -> tuple[dict, str | None]`: `(board, None)` when readable and valid; `(empty_board(), reason)` for invalid JSON, a non-object, a failed validation ("This whiteboard's file can't be read, so it opens read-only: …", our string) or `version > 1` (the newer-version string).
  - `dump_board(board) -> bytes` (`dump_json`; key order as given).
- Produces (`whiteboardink.py`, pure):
  - `HIGHLIGHTER_OPACITY = 0.35`; `class InkInvalid(Exception)`; `validate_strokes(strokes) -> None` (ids `[A-Za-z0-9_-]{1,64}` unique; tool; `#rrggbb`; `0.5 <= width <= 200`; 1–20,000 points of 3 finite numbers with pressure in `[0, 1]`; `d` matching `^[MLQCZmlqcz0-9 ,.eE+-]*$` and at most 1 MB; at most 50,000 strokes; optional `colorName` a theme colour).
  - `dump_ink(strokes) -> bytes`: the SVG of Global Constraints, deterministic (attribute order `id, data-tool, data-color, data-width, data-points, fill, fill-opacity, d`; 2-decimal coordinates, 3-decimal pressure; LF; trailing newline; `viewBox` from the bounds of every point padded by 15).
  - `load_ink(data: bytes) -> tuple[list[InkStroke], str | None]`: parses with `xml.etree.ElementTree` after rejecting any `<!DOCTYPE` or `<!ENTITY` in the bytes; accepts only our root (`data-object-ink="1"`) with only our `<path>` children; otherwise `([], reason)` with the read-only string. A parsed stroke's `d` is kept as written.

- [ ] **Step 1: Write failing tests**
  - `test_sidecar_names` (incl. the dotted stem and a title ending in `.whiteboard`), `test_sidecar_owner_maps_back_and_ignores_others`
  - `test_validate_accepts_fixture_board` (Network map and Dotted)
  - `test_validate_rejects_bad_boards`: one case each for an unknown kind, an unknown shape, a key/id mismatch, an edge to a missing node, a missing `blockId`, `NaN`, a negative width, an entity link without brackets, a non-list `readingOrder`; each raises `BoardInvalid` with a message.
  - `test_arrow_closed_and_deprecated_label_accepted`
  - `test_unknown_keys_kept`: `dump_board(load_board(x)[0])` keeps every `x-future` key.
  - `test_dump_is_stable`: LF, trailing newline, `indent=2`, non-ASCII kept; dumping the parsed fixture twice gives the same bytes.
  - `test_unreadable_and_future_boards_read_only`: Broken and Future give the empty board and a reason.
  - `test_empty_board_shape`
  - `test_ink_svg_round_trip_byte_identical`: `dump_ink(load_ink(dump_ink(s))[0]) == dump_ink(s)`; the fixture's strokes parse with their pressures.
  - `test_ink_svg_renders_standalone`: the root has the SVG namespace and a `viewBox` covering every point; every `<path>` has `fill` and `d`; the highlighter has `fill-opacity="0.35"`; empty strokes give `viewBox="0 0 1 1"`.
  - `test_foreign_svg_read_only` (the `<rect>` fixture) and `test_ink_parse_rejects_doctype` (a billion-laughs style `<!DOCTYPE>` is refused before parsing).
  - `test_validate_strokes_rejects_bad_strokes`: bad colour, pressure 1.5, duplicate id, a `d` with `javascript:` or `<`, 0 points.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_whiteboard_file.py backend/tests/test_whiteboard_ink.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): whiteboard board json and ink svg formats`.

### Task 3: Whiteboard store, type and routes (lane A, sub-lane A1)

**Files:**
- Create: `backend/objectapp/whiteboardstore.py`, `backend/objectapp/whiteboardapi.py`
- Test: `backend/tests/test_whiteboard_api.py`

**Interfaces:**
- Consumes: Tasks 1–2; `Space` (`root`, `_lock` (an `RLock`), `_rel(path)` (raises `ValueError` for a path outside the space or not a `.md`: 400), `own_writes`, `get(path)` (`ObjectSummary`, `KeyError` when unknown: 404), `type_by_id`, `types` (a list), `create_object(type_id, title='', template_id=None, values=None) -> (path, version)` (it calls `_persist_type` itself), `_ensure_daily_note_type` as the pattern to copy), `typemodel.TypeDefinition.from_json(data, fallback_id=None)`, `typemodel.type_revision(root, type_id)` (`''` when the type has no file: how `POST /api/objects` in `server.py` detects a first persist), `textfile.atomic_write(path, data, check=None)`/`create_new(path, data)` (raises `FileExistsError`), `space.version_of`, `watcher.ChangeEvent` (frozen dataclass `kind, path, version, origin=None, oldPath=None`; imports only; `kind='whiteboard'` is passed as a string; the Literal is widened in Task 13).
- Produces (`whiteboardstore.py`):
  - `WHITEBOARD_TYPE_ID = "whiteboard"`; `whiteboard_type_json() -> dict` (the Task 1 type JSON: name, plural, folder, icon `ph-presentation`, colour `gray` for Object's `neutral`, `basic: true`, no extra properties: title, description, icon, tags, created and last updated are M2's system definitions); `whiteboard_type(space) -> TypeDefinition | None` (the basic Whiteboard type, matched by name case-insensitively, stored or inferred); `ensure_whiteboard_type(space) -> TypeDefinition` (appends the type in memory when missing, as `_ensure_daily_note_type` does; never writes); `is_whiteboard(space, path) -> bool`.
  - Exceptions `NotAWhiteboard`, `BoardConflict(current_revision)`, `BoardReadOnly(reason)`; `BoardInvalid`/`InkInvalid` re-raised from Task 2.
  - `read_board(space, path) -> dict` (`BoardResponse`), `save_board(space, path, board, base_revision) -> str` (validate → under `space._lock`: read the current bytes, refuse 423 if the existing file is unreadable or newer, 409 if the revision differs; write with `create_new` when `base_revision == ''`, else `atomic_write(full, data, check=…)` re-checking the revision just before the replace; record `own_writes`), `read_ink(space, path)`, `save_ink(space, path, strokes, base_revision)` (same rules; the `.md` must exist and be a whiteboard).
  - `create_whiteboard(space, title) -> (path, version, type_ids)`: `ensure_whiteboard_type`, then `space.create_object(WHITEBOARD_TYPE_ID, title)` (M2's lazy persist writes `whiteboard.json` the first time; `type_ids` reports it). Writes no sidecar.
  - `whiteboard_ui_problem(value) -> str | None`: `value` must be an object whose present keys are the five booleans ("whiteboard must be an object of true/false settings.", our string); the shape of `server.py`'s `_calendar_ui_problem`/`_tasks_ui_problem`, which Task 13 calls it beside.
- Produces (`whiteboardapi.py`): `whiteboard_router(space, announce: Callable[[ChangeEvent], None]) -> APIRouter` (`APIRouter(prefix="/api")`, like `server.py`'s `api` router) with the four whiteboard routes of the contract (the `PUT /api/ui` row is Task 13's); request models `SaveBoardRequest`, `SaveInkRequest`, `CreateWhiteboardRequest` (pydantic `BaseModel`, `clientId: str | None = None` as `server.py`'s models). A path outside the space or not an object is 400, a missing object 404, as `server.py` (errors as `JSONResponse({"detail": …})`; 409 `{"currentRevision"}`, 423 `{"reason", "detail"}` as `PUT /api/ui` does). `POST /api/whiteboards` announces `types` (when `type_revision` went from `''` to set) and `created`, like `POST /api/objects`.

- [ ] **Step 1: Write failing tests** (a bare `FastAPI()` with only `whiteboard_router(space, events.append)` mounted, so nothing depends on `server.py`; `wb_dir`)
  - `test_router_mounts_standalone`
  - `test_get_board_writes_nothing` (all fixture boards; `tree_hashes` unchanged), `test_get_missing_board_returns_empty_and_creates_nothing` (Empty board), `test_get_ink_writes_nothing`
  - `test_get_unreadable_board_has_reason` (Broken, Future) and `test_get_foreign_ink_has_reason`
  - `test_save_board_writes_only_its_file`: one `PUT`, then exactly one file differs.
  - `test_md_bytes_never_change_on_board_save` (regression guard: green as soon as saving works; listed for the review)
  - `test_save_stale_revision_409_nothing_written`, `test_create_requires_empty_base` (base `''` on an existing file → 409; a non-empty base on a missing file → 409)
  - `test_save_invalid_422_nothing_written`, `test_save_over_unreadable_423_file_untouched` (Broken, Future; the ink twin over Foreign ink)
  - `test_save_is_atomic_temp_then_replace`: a monkeypatched `os.replace` that raises leaves the old bytes and no temp file behind.
  - `test_own_writes_recorded` and `test_announces_whiteboard_event_with_origin`
  - `test_ink_save_and_get_round_trip`: the strokes come back equal; the file is `dump_ink` of them.
  - `test_not_a_whiteboard_422` (a Page path) and `test_outside_space_400`
  - `test_create_whiteboard_writes_md_only` (with the type stored) and `test_create_whiteboard_persists_inferred_type_once` (a copy without `whiteboard.json`: first create writes it and returns `typeIds: ['whiteboard']`, the second doesn't)
  - `test_whiteboard_type_matches_reference` (name, plural, folder, icon, colour)
  - `test_whiteboard_ui_problem_shapes`
  - `test_concurrent_saves_one_wins`: two threads save with the same base; one 200, one 409, the file equals the winner's bytes.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_whiteboard_api.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified.
- [ ] **Step 4:** Run `uv run pytest backend/tests/test_whiteboard_*.py -q`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): whiteboard store, type and routes (router not yet mounted)`.

### Task 4: Sidecars in trash, restore, rename and relink (lane A, sub-lane A2)

**Files:**
- Create: `backend/objectapp/whiteboardtrash.py`
- Test: `backend/tests/test_whiteboard_trash.py`

**Interfaces:**
- Consumes: Tasks 1–2; `Space` (`root`, `trash` (`trash.Trash`: `dir` = `.object/trash`, `Trash._safe_id(trash_id)`; its listings only glob top-level `*.json` and the `types/`, `collections/`, `queries/` folders, so a `whiteboards/` folder beside them is never mistaken for an entry), `own_writes`, `own_deletes`, `_lock`), `textfile.move_no_overwrite(src, dest)`/`retry_os(fn)`/`atomic_write`, `space.unique_path(root, folder, stem, same_as=None)`, `space.version_of`, `relink.replace_wikilinks(text, should_rewrite, new_target)` and `relink.wikilink_targets(text)` (M2's wikilink rewriting, code spans skipped; reuse it for text block Markdown). Never calls `Space.delete_object`/`restore` (Task 13 calls these functions from them).
- Produces:
  - `sidecar_trash_dir(space, trash_id) -> Path` = `.object/trash/whiteboards/<trash_id>/` (files `board.json`, `ink.svg`, bytes unchanged).
  - `trash_sidecars(space, trash_id, md_rel) -> list[str]`: moves the sidecars that exist into that folder (recording `own_deletes`); returns the moved space paths. A failure moves back what it moved and re-raises.
  - `restore_sidecars(space, trash_id, md_rel) -> list[str]`: puts them back beside `md_rel` (the restored path) with exclusive creates; removes the folder; returns the restored paths.
  - `purge_sidecars(space, trash_id) -> None`.
  - `free_whiteboard_stem(root, folder, stem, same_as=None) -> str`: like `unique_path` but a stem is free only when `<stem>.md`, `<stem>.whiteboard.json` and `<stem>.ink.svg` are all absent (`same_as` allows the object's own current files, for a rename).
  - `move_sidecars(space, old_md, new_md) -> list[str]`: moves the existing sidecars to the new stem (never overwriting), recording `own_deletes`/`own_writes`; on failure moves back what moved and re-raises, so the caller can move the `.md` back.
  - `relink_board(board, old_targets: set[str], new_text: str) -> dict | None`: rewrites `entity` block links whose inner text is one of `old_targets` (case-insensitive, like M2's relink) and `[[…]]` wikilinks inside text block Markdown; returns the new board or `None` when nothing changed. `relink_board_file(space, md_rel, old_targets, new_text) -> str | None` (reads, relinks, writes atomically with an unchanged-revision check, records `own_writes`; returns the sidecar path when written; skips unreadable files).
  - `board_links(board) -> list[str]` (every entity link and text wikilink, for M5's link index) and `board_text(board) -> str` (text block Markdown in reading order: `readingOrder` first, then the rest top-to-bottom, left-to-right by position, as the model's comment says; for M5's search). Both are pure; whether Task 13 can feed them to M5 depends on what M5 builds (see Task 13).
  - `sidecar_event_owner(space, rel) -> str | None` (for the watcher: the owning `.md` when it exists and is a whiteboard).

- [ ] **Step 1: Write failing tests** (`wb_dir`; a fake trash id)
  - `test_trash_sidecars_moves_both` and `test_trash_with_no_sidecars_is_noop` (Empty board)
  - `test_restore_sidecars_byte_identical`
  - `test_restore_collision_follows_md_stem`: restored `.md` at `Network map (2).md` gets `Network map (2).whiteboard.json` and `.ink.svg`.
  - `test_free_stem_skips_orphan_sidecar`: with `Orphan (2).whiteboard.json` present, `free_whiteboard_stem(…, "Orphan")` skips `Orphan (2)`.
  - `test_purge_removes_sidecars`
  - `test_move_sidecars_on_rename` and `test_move_sidecars_rolls_back_on_failure` (a patched move that fails on the second file leaves both at the old stem)
  - `test_relink_board_updates_links_only`: renaming Router A rewrites its entity block and a text wikilink; a JSON diff shows only those values changed; `relink_board` returns `None` when no link matches.
  - `test_relink_board_file_skips_unreadable` (Broken board untouched)
  - `test_board_links_and_text_reading_order`
  - `test_sidecar_event_owner`
  - `test_no_md_written` (regression guard: no function here writes a `.md`)
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_whiteboard_trash.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified.
- [ ] **Step 4:** Run `uv run pytest backend/tests/test_whiteboard_*.py -q`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): whiteboard sidecars in trash, restore, rename and relink`.

### Task 5: Ink model, strings and client (lane B)

**Files:**
- Create: `frontend/src/whiteboard/ink/{types.ts,inkModel.ts,inkStrings.ts,inkClient.ts}`
- Test: `frontend/src/whiteboard/ink/{inkModel.test.ts,inkClient.test.ts}`

**Interfaces:**
- Consumes: `perfect-freehand` (`getStroke`); `@/api/client` (`CLIENT_ID`, `ApiError`, `RevisionConflictError`, `ReadOnlyError`; imports only. `ConflictError` carries `currentVersion`; its subclass `RevisionConflictError(currentRevision)` adds the `currentRevision` getter and is what `api` throws for a `{currentRevision}` 409, so the ink client throws it too and callers catch `ConflictError`); `@/theme/palette` (`THEME_COLORS`; the hexes are constants, see Global Constraints, because `lineColor()` returns a CSS variable).
- Produces:
  - `types.ts`: `InkStroke`, `InkTool`, `InkToolState`, `InkResponse`, `InkLayerProps`, `InkToolbarProps`, `InkDoc`, `InkPlugin` exactly as the contract.
  - `inkModel.ts`: `PEN_WIDTHS = [2, 4, 8]`, `HIGHLIGHTER_WIDTHS = [16, 32]`, `HIGHLIGHTER_OPACITY = 0.35`, `ERASER_RADIUS_PX = 10`, `INK_COLORS` (`{name, hex}` for the 18 `THEME_COLORS`, hexes from the `--line-*` tokens of `theme/tokens.css`), `DEFAULT_INK: InkToolState` (pen, gray, 4); `strokeOptions(tool, width, pointerType)` (the options in Global Constraints; `simulatePressure` unless `pointerType === 'pen'`; `last: true` on finish); `samplesFrom(e: PointerEvent, toFlow) -> [x, y, p][]` (coalesced events when available; pressure only for pens, else 0.5); `isEraserEnd(e)`, `isBarrelButton(e)`; `outlineFor(points, opts) -> number[][]` and `svgPathFromOutline(outline) -> string` (quadratic midpoint path, 2 decimals, matching the server's `d` charset); `finishStroke(id, tool, color, width, points, pointerType) -> InkStroke`; `strokeBounds`, `hitStrokes(strokes, eraserPath, radiusFlow) -> Set<id>` (segment-to-segment distance against each stroke's points, bounds pre-check); `mergeStrokes(base, local, remote) -> InkStroke[]` (strokes added/removed locally since `base` applied to `remote`, by id); `newStrokeId()`.
  - `inkStrings.ts`: "Pen", "Highlighter", "Eraser", "Width", "Ink colour", the read-only tooltip (all our strings, marked so).
  - `inkClient.ts`: `inkClient = {load(path): Promise<InkResponse>, save(path, strokes, baseRevision): Promise<{revision}>}` over `GET/PUT /api/whiteboard/ink`, sending `clientId`; 409 → `RevisionConflictError(currentRevision)`, 423 → `ReadOnlyError(reason)`, other → `ApiError(status, detail)` (a 20-line `fetch` helper of its own: `api/client.ts`'s `request` is not exported, and Lane B does not import Lane C).
- [ ] **Step 1: Write failing tests**
  - `test higher pressure gives a wider outline`: the same path at pressure 0.2 and 1.0 (pen) gives outline polygons whose areas differ by more than 2×.
  - `test mouse uses simulated pressure`: `strokeOptions(…, 'mouse').simulatePressure === true`, `'pen'` false; highlighter `thinning === 0`.
  - `test samples use coalesced events and pen pressure` (a fake event with `getCoalescedEvents` returning three samples; a mouse event records 0.5)
  - `test eraser end and barrel button detection`
  - `test svg path charset matches the server rule` (the regex from Task 2)
  - `test eraser hit test within 10 screen pixels` (at zoom 1 and zoom 2: the flow radius is `10 / zoom`)
  - `test mergeStrokes keeps both sides' additions and removals`
  - `test ink colours match the line tokens` (reads `src/theme/tokens.css` with `node:fs`; every `INK_COLORS` hex equals its `--line-<name>` value, following `var(--label-border-<name>)`)
  - `test ink client maps 409, 423 and sends clientId` (the 409 is a `ConflictError` whose `currentRevision` is the server's)
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/whiteboard/ink`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified.
- [ ] **Step 4:** Run `npx vitest run src/whiteboard/ink && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ink): pressure stroke model, eraser hit test and ink client`.

### Task 6: Ink layer, toolbar and document hook (lane B)

**Files:**
- Create: `frontend/src/whiteboard/ink/{InkLayer.tsx,InkToolbar.tsx,useInkDoc.ts,index.ts}`
- Test: `frontend/src/whiteboard/ink/{InkLayer.test.tsx,InkToolbar.test.tsx,useInkDoc.test.ts}`

**Interfaces:**
- Consumes: Task 5; `@xyflow/react` (`ViewportPortal`, `useReactFlow().screenToFlowPosition`, `useViewport`); `@/api/client` `api.onChange(cb) -> unsubscribe` (for `whiteboard` events on its path, compared as `(e.kind as string) === 'whiteboard'` until Task 13 widens `ChangeKind`).
- Produces:
  - `<InkLayer>` (`InkLayerProps`): inside `ViewportPortal`, one memoized `<path>` per stroke (`fill`, highlighter `fill-opacity`) and the live stroke while drawing; when `tool` is set and not `readOnly`/`panning`, an absolutely positioned capture overlay (`touch-action: none`, crosshair cursor) over the pane: `pointerdown` captures the pointer, `pointermove` collects `samplesFrom` (flow coordinates via `screenToFlowPosition`), `pointerup` calls `onStrokesChange([...strokes, finishStroke(…)], 'draw')`; the eraser (or the pen's eraser end) collects its path and on release calls `onStrokesChange(strokes minus hitStrokes, 'erase')` only if something was hit; touch while a pen is down is ignored; wheel events go to `onWheel`. Without a tool the layer has `pointer-events: none`.
  - `<InkToolbar>` (`InkToolbarProps`): three toggle buttons (Pen `ph-pen-nib`, Highlighter `ph-highlighter`, Eraser `ph-eraser`; tooltips with the keys P, M, E), and for pen/highlighter a colour row (`INK_COLORS`) and the width choices; clicking the active tool turns ink off (`onChange(null)`); disabled with the read-only tooltip when `readOnly`.
  - `useInkDoc(path, client = inkClient): InkDoc`: loads once (no write), `save(next)` debounced 400 ms, one save in flight at a time (the latest queued), on `ConflictError` reloads, `mergeStrokes(lastSaved, local, remote)` and saves once with the new revision; a second 409 reloads and keeps the server copy; reloads on an external `whiteboard` event for its path when nothing is pending; `flush()` sends a pending save now (called on unmount and `pagehide`).
  - `index.ts`: `export const inkPlugin: InkPlugin = { Layer: InkLayer, Toolbar: InkToolbar, useInkDoc }` and the types.
- [ ] **Step 1: Write failing tests** (mount inside `ReactFlowProvider` with a minimal `<ReactFlow>`; jsdom pointer events built with `pointerType`, `pressure`, `buttons`)
  - `test pen pointer events record pressure and coalesced samples`: one stroke, its points carry the event pressures, `onStrokesChange` called once with label `draw`.
  - `test mouse stroke uses simulated pressure`
  - `test wacom eraser end erases while held` (buttons 32 with the pen tool selected) and `test eraser removes only hit strokes; no call when nothing is hit`
  - `test touch ignored while the pen is down`
  - `test no capture overlay without a tool, when read-only or while panning`
  - `test wheel is forwarded while an ink tool is on`
  - `test toolbar toggles tools, colours and widths; clicking the active tool turns ink off`
  - `test toolbar disabled with the read-only tooltip`
  - `test ink loads without saving` (no `save` call after load)
  - `test saves are debounced and serialized`
  - `test ink 409 merges by stroke id` (one reload, one save with the merged strokes and the new revision)
  - `test external whiteboard event reloads when nothing is pending`
- [ ] **Step 2:** Run `npx vitest run src/whiteboard/ink`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified.
- [ ] **Step 4:** Run `npx vitest run src/whiteboard/ink && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ink): pressure-sensitive ink layer, toolbar and ink document`.

### Task 7: Whiteboard foundation: API client, model, strings, colours (lane C)

**Files:**
- Create: `frontend/src/api/whiteboardTypes.ts`, `frontend/src/api/whiteboardClient.ts`, `frontend/src/whiteboard/{model.ts,strings.ts,colors.ts,dnd.ts,whiteboard.css}`, `frontend/src/whiteboard/test/{flowEnv.ts,boards.ts,mockWhiteboardApi.ts}`
- Test: `frontend/src/api/whiteboardClient.test.ts`, `frontend/src/whiteboard/{model.test.ts,strings.test.ts,colors.test.ts}`

**Interfaces:**
- Consumes: the contract; `@/api/client` error classes (`ApiError`, `ConflictError`, `RevisionConflictError`, `ReadOnlyError`), `CLIENT_ID` and `api.ui()` (`GET /api/ui` → `{ui: UiState, revision}`; `UiState` has an `[extra: string]: unknown` index, so `ui.whiteboard` reads as `unknown` until Task 13 types it) (imports only).
- Produces:
  - `whiteboardTypes.ts`: every board type of the contract, `BoardResponse`, `WhiteboardSettings`, and the union types (`WhiteboardShape`, `WhiteboardMarker`, `WhiteboardTool`, …).
  - `whiteboardClient.ts`: `whiteboardApi = { board(path), saveBoard(path, board, baseRevision) /* 409 → RevisionConflictError(currentRevision) */, createWhiteboard(title?) /* POST /api/whiteboards */, settings(): Promise<{settings, revision}> /* api.ui() → ui.whiteboard ?? {} */, saveSettings(settings, baseRevision) /* PUT /api/ui {patch: {whiteboard}, baseRevision, clientId} */ }`, all sending `clientId`, over a small `fetch` helper of its own (`api/client.ts`'s `request` is private). `saveSettings` can't use `api.patchUi`: its `UiPatch` type has no `whiteboard` key until Task 13 (an excess-property `tsc` error), so it sends the PUT itself; Task 13 may switch it to `api.patchUi`.
  - `model.ts`: our implementation of the reference model's constants and rules (values from `whiteboard.model.ts`): grid 30 and half 15, default/min/auto sizes, frame defaults, `CONTENT_Z_MIN`, zoom min/max/presets, the lists `NODE_KINDS`, `SHAPES`, `PICKER_SHAPES`, `SHAPE_MENU_TOOLS`, `CIRCUIT_LABELS` with `CIRCUIT_TEXT`, `MARKERS`, `PICKER_MARKERS`, `CONNECTIONS`, `LINES`, `TOOLS` (without the media tools, which M6 doesn't offer), `ONE_SHOT_TOOLS`, `POINTER_TOOLS`; the functions `normalizeConnection`, `normalizeLine`, `normalizeMarker`, `dasharray`, `rememberedEdgeStyle`, `snap`, `snapPosition`, `snapSpanMin`, `snapBox`, `minSizeFor`, `nextContentZ`, `nextFrameZ`, `contentSendToBackStartZ`, `nextFrameTitle`, `resolvePointerTool`, `resolveShapeMenuTool`, `resolveCircuitTool`, `resolveLastUsedTool(lastUsed, engineering)`, `isConnectable`, `isCircuitNode(node, blocks)`, `connectorFromNodeBox`, `DEFAULT_SETTINGS`.
  - `strings.ts`: `WB = { key: {text, ref} }` for every UI string the canvas uses, each with its reference key or `ref: 'ours'`: the `Whiteboard.tools.*`, `Whiteboard.control.*`, `Whiteboard.align.*`, `Whiteboard.edgeTips.*`, `Whiteboard.edgeConnection.*`, `Whiteboard.edgeLine.*`, `Whiteboard.display.*`, `Whiteboard.emptyState.description`, `Whiteboard.lost.*`, `EntityMenu.clearWhiteboard.*`, `components.RootWhiteboard.*`, `shortcuts.whiteboard*.name`, `shortcuts.undo.name`/`redo.name`, `changeStack.undo`/`redo`, `general.cancel`, `general.delete`, `EntityMenu.delete`; ours: the read-only and newer-version texts, "Changed elsewhere. Reloaded.", "Search objects", "Pick a type".
  - `colors.ts`: `fillStyle(bg)`, `borderStyle(theme)` from `colorThemes.ts` `colorValues` (`bgDark`/`borderDark` in dark mode, `bgLight`/`borderLight` in light), and the default ring `var(--color-border-base)`.
  - `dnd.ts`: `OBJECT_DRAG_MIME = 'application/x-object-path'`, `readDroppedObject(dataTransfer) -> {path} | {link} | null` (also accepts `text/plain` holding one `[[…]]`).
  - `whiteboard.css`: the `.whiteboard-canvas` custom properties and the rules quoted in the Spec header (values from the reference CSS, our selectors on React Flow's `react-flow__*` classes), imported by `WhiteboardCanvas.tsx` with `@xyflow/react/dist/base.css`.
  - Test helpers: `flowEnv.ts` (jsdom stubs React Flow needs: `DOMMatrixReadOnly`, element `offsetWidth/Height`, `getBBox`; `ResizeObserver` is already stubbed by `test/setup.ts`), `boards.ts` (the Network map board as a TS object, mirrored from the backend fixture, plus builders `node(partial)`, `edge(partial)`, `textBlock(md)`), `mockWhiteboardApi.ts` (a `vi.fn()` per `whiteboardApi` function).
- [ ] **Step 1: Write failing tests**
  - `test constants match the reference model` (grid 30, 420 × 60, 480/420 auto max, 40/30 block floor, 90 shape floor, frame 480 × 420, zoom 0.02–4 and the 10 presets, the shape lists and the shape-menu order, the 9 gate texts, markers and picker markers)
  - `test unset connection is cornered, unset line solid, arrowClosed is arrow; dash arrays 8 8 and 0 10`
  - `test snapBox lands both edges on the grid with the floor`
  - `test z rules`: content z ≥ 1 and above other content; a new frame below every frame; send-to-back stays above frames.
  - `test next frame title skips used numbers and ignores custom titles`
  - `test resolve tools fall back to Move, Rectangle and NAND; gates fall back to Move without engineering mode`
  - `test every reference string exists verbatim in the strings file`: reads `../docs/strings.txt` with `node:fs` and checks every `WB` entry whose `ref` is not `'ours'` appears as a compiled message text.
  - `test fill and border colours from the reference values`
  - `test dropped object reader accepts the mime and a plain wikilink`
  - `test client sends clientId and maps 409 to a ConflictError with currentRevision` (a `RevisionConflictError`)
- [ ] **Step 2:** Run `npx vitest run src/api/whiteboardClient.test.ts src/whiteboard/model.test.ts src/whiteboard/strings.test.ts src/whiteboard/colors.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified.
- [ ] **Step 4:** Run the same plus `npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(whiteboard): model, strings, colours and client`.

### Task 8: Pure engines: shapes, projection, history, merge, actions, snapping, camera (lane C)

**Files:**
- Create: `frontend/src/whiteboard/{shapes.ts,flowMapping.ts,history.ts,merge.ts,actions.ts,snapGuides.ts,camera.ts}`
- Test: one `*.test.ts` beside each

**Interfaces:**
- Consumes: Task 7.
- Produces (pure, no React):
  - `shapes.ts`: `shapePath(shape, w, h, {flipX, flipY}) -> string` (SVG path in a `w × h` box) for all 12 shapes, `textInset(shape, w, h)` (the box text sits in: the bubble without its tail, the triangle's lower part, …).
  - `flowMapping.ts`: `BoardDoc = {board: WhiteboardData, strokes: unknown[]}`; `toFlow(board) -> {nodes: FlowNode[], edges: FlowEdge[]}` (`type` `objectBlock`/`objectShape`/`objectFrame`/`objectPoint`, the names of Object's Vue Flow node types in the CSS; `zIndex` from `z`; `data.node` the original node object, `data.block` its block; edges `type: 'connector'`, `data.edge`, `data.block`); `fromFlowChange(board, changes) -> board` (positions, sizes, selection ignored) that only rewrites the fields that changed, so unknown keys survive.
  - `history.ts`: `History<T>` with `push(doc, label, coalesceKey?)`, `undo()`, `redo()`, `canUndo/canRedo`, cap 200; a push with the same `coalesceKey` as the top entry within one gesture replaces it.
  - `merge.ts`: `mergeBoards(base, local, remote) -> WhiteboardData`: for `nodes`, `edges`, `blocks`, keys added, changed or removed locally since `base` are applied to `remote`; top-level keys take local when changed since `base`, else remote; afterwards edges whose ends no longer exist are dropped.
  - `actions.ts` (each `(board, …) -> board`, ids from `newId()`): `createFromTool(board, tool, box | point, opts)` (text, shapes, gates, frame with `nextFrameTitle`, line/arrow with two points, honouring defaults, z rules and `rememberedEdgeStyle`), `createEntity(board, link, at)`, `connect(board, source, target, handles, style)`, `updateNode`, `updateEdge`, `setBlock`, `removeSelection` (also removes edges touching removed nodes and their now-unused blocks; skips `locked` nodes), `duplicate(board, ids, offset = 30)`, `nudge(board, ids, dx, dy)`, `order(board, ids, 'front'|'forward'|'backward'|'back')` (frames among frames, content above frames), `place(board, ids, 'left'|'center'|'right'|'top'|'middle'|'bottom'|'row'|'column'|'grid')` (row/column/grid spaced one grid cell), `flip(board, ids, 'x'|'y')`, `wrapInFrame(board, ids)` (padding one cell, snapped, `nextFrameTitle`), `frameContents(board, frameId) -> ids` (wholly inside), `clearBoard(board)` (no nodes, edges or blocks; other keys kept), `setLocked`, `addEdgeLabel`/`removeEdgeLabel`, `addFrameTitle`/`removeFrameTitle`.
  - `snapGuides.ts`: `snapToNodes(moving: Box, others: Box[], threshold = 6) -> {dx, dy, guides}` (edges and centres).
  - `camera.ts`: `wheelViewport(viewport, e: {deltaX, deltaY, ctrlKey, clientX, clientY}, zoomOnScroll) -> viewport` (zoom about the pointer within limits, or pan), `fitBox(boxes, pane, padding) -> viewport`, `zoomStep(zoom, 'in'|'out')` (next/previous preset).
- [ ] **Step 1: Write failing tests**
  - `test every shape path is closed and inside its box; flips mirror`
  - `test projection round trip is identity on every fixture board` and `test unknown node and edge keys survive the projection`
  - `test projection of 5000 nodes under 50 ms`
  - `test history coalesces a drag into one step` and `test undo redo restore exact documents`; `test history cap 200`
  - `test mergeBoards applies local adds, edits and deletes onto remote; drops dangling edges`
  - `test create from each tool uses defaults and snapping`; `test line in empty space creates two points and an edge`; `test arrow tool sets end arrow; new edges copy the remembered style`
  - `test gates persist as rectangle plus label`
  - `test remove selection removes touching edges and unused blocks; skips locked`
  - `test frame z stays below content` (create, order back/front)
  - `test place left center right top middle bottom row column grid`
  - `test wrap in frame pads one cell and titles Frame N`
  - `test duplicate offsets one cell and copies blocks`
  - `test clear board keeps viewport, readingOrder and unknown keys`
  - `test snap to nodes aligns edges and centres within threshold`
  - `test wheel zooms about the pointer within limits; pans when zoom on scroll is off`
  - `test zoom steps through presets`
- [ ] **Step 2:** Run `npx vitest run src/whiteboard/{shapes,flowMapping,history,merge,actions,snapGuides,camera}.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified.
- [ ] **Step 4:** Run the same plus `npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(whiteboard): shapes, projection, history, merge and board actions`.

### Task 9: Canvas shell, board store and page (lane C)

**Files:**
- Create: `frontend/src/whiteboard/{plugin.ts,host.ts,canvasTypes.ts,store.ts,useBoard.ts,useWhiteboardSettings.ts,toolMemory.ts,shortcuts.ts,WhiteboardCanvas.tsx,WhiteboardPage.tsx,BoardHeader.tsx}`; **stubs** `frontend/src/whiteboard/nodes/index.ts`, `edges/index.ts`, `chrome/index.ts`
- Test: `frontend/src/whiteboard/{store.test.ts,useBoard.test.ts,useWhiteboardSettings.test.ts,shortcuts.test.ts,WhiteboardCanvas.test.tsx,WhiteboardPage.test.tsx}`

**Interfaces:**
- Consumes: Tasks 7–8; `@xyflow/react`; `@/api/client` `api.onChange`, `api.object(path)` (`ObjectDetail`: `summary.title`, `version`), `api.renameObject(path, title, baseVersion) -> RenameResult` (`path` is the new path when the file moved), `api.deleteObject(path, {baseVersion})`, `api.restore(trashId)`; `@/links/linkIndex` (`resolveLink`, `summaryOf`, `stemOf`, `useLinkIndex`), `@/nav/tabs` (`usePeek`, `useTabs().retarget(oldPath, newPath)`; `usePeek().retarget` likewise, as `ObjectView` does after a rename), `@/create/createAndOpen` `openObject`, `@/object/DeleteObjectDialog` (`DeleteObjectDialog`, `DELETE_OBJECT_TEXT`, `useDeleteRequest`), `@/object/DeletedBanner` (`DeletedBanner {onBack, onUndo, busy, error}`) (imports only; `host.ts` defaults as in the contract).
- Produces:
  - `plugin.ts`: the structural `InkPlugin` family of types (contract). `host.ts`: `WhiteboardHost` and `defaultHost`.
  - `canvasTypes.ts` (fixed prop types the sub-lanes implement): `FlowNode`/`FlowEdge` data shapes; `nodeTypes` keys; `ToolboxProps {tool, onTool, settings, onSettings, locked, onLock, inkSlot?: ReactNode, onUndo, onRedo, canUndo, canRedo}`; `SelectionToolbarProps {nodes, edges, blocks, actions: BoardActions}`; `ZoomMenuProps {zoom, onZoom(z: number | 'in' | 'out' | 'fit' | 'selection' | 'reset')}`; `BoardMenuProps {onClear(), onDelete(), onOpenAsPage?()}`; `ObjectPickerProps {mode: 'link' | 'create', host, onPick(result: {path}), onClose()}`; `BoardActions` (the store actions below).
  - `store.ts`: `createBoardStore()` (zustand, one per mounted board) with `doc: BoardDoc`, `selection`, `tool`, `editingId`, `history`; actions `apply(label, fn, coalesceKey?)`, `undo`, `redo`, `select`, `setTool`, `beginEdit`, `endEdit`, and wrappers for every Task 8 action; `BoardStoreContext` and `useBoardActions()` (what nodes, edges and chrome call). `apply` marks the board or the strokes dirty.
  - `useBoard(path, client = whiteboardApi)`: loads the board (no write); after each dirty change schedules a save (400 ms; not during a drag; one in flight, latest queued); on `ConflictError` fetches, `mergeBoards(lastSaved, local, remote)`, saves once with the new revision; a second 409 reloads with the toast "Changed elsewhere. Reloaded." (our string); a `ReadOnlyError` switches to read-only; reloads on an external `whiteboard` event for its path when nothing is pending (clearing the history); flushes on unmount and `pagehide`.
  - `useWhiteboardSettings(client)`: settings with defaults; `set(key, value)` writes once (409 refetch and re-apply once).
  - `toolMemory.ts`: per-board `WhiteboardBoardToolMemory` in `localStorage` (try/catch), with the camera.
  - `shortcuts.ts`: `keyToCommand(e, ctx) -> Command | null` for the key table in Global Constraints (pure); ignored when the target is editable.
  - `<WhiteboardCanvas>`: `<ReactFlow>` with `nodeTypes`/`edgeTypes` from the three index files, `minZoom 0.02`, `maxZoom 4`, `snapToGrid`/`snapGrid [30, 30]` per settings (off while Ctrl is held), `Background` dots gap 30 (hidden when Show dots is off), `zoomOnScroll`/`panOnScroll` per setting, `selectionOnDrag` with Move, pan with Hand or Space, `onlyRenderVisibleElements`, `deleteKeyCode={null}` (deletes go through the store), `data-tool` on the wrapper for the reference cursors; tool placement (click = default size, drag = rubber band through `snapBox`), connections via handles (`connect`), frame drag moving its contents, snap-to-nodes guides, Alt-drag duplicate, the drop of `OBJECT_DRAG_MIME`/wikilinks (`createEntity` at the drop point), the empty state ("You can change this by creating a new node.") and the lost state ("Nothing in this view", "But don't worry, we can just take you back.", "Back to content" → fit); when an ink plugin is given, renders `<ink.Layer>` as a child of `<ReactFlow>` with the store's strokes, the ink tool, `panning` and `onWheel` (`wheelViewport`). Initial camera: saved camera, else the file's `viewport`, else fit (zoom 1 at the origin when empty). Panning never marks the board dirty.
  - `<WhiteboardPage path mode="page"|"peek" ink? host? onExpand? onDismiss? footer?>` (the last three are what `ObjectPeek` passes to `ObjectView` today: the expand-to-page action, close, and its `<Pager />`; `WhiteboardPage` shows them in peek mode the same way): full width (Object's `wideLayoutMode`), the canvas with the `.whiteboard-title-fade` title overlay top left (`BoardHeader`: title, click to rename via `api.renameObject` after a flush, then `useTabs`/`usePeek` `retarget(old, res.path)` when the file moved; the board `…` menu from `chrome`), the delete flow as `ObjectView` has it (`DeleteObjectDialog`, opened by the board menu's "Delete" through `host.requestDelete(path, mode)` or by a `useDeleteRequest` request matching its path and mode, i.e. App.tsx's Ctrl+Backspace; confirm calls `api.deleteObject(path, {baseVersion})` after a flush), `Toolbox` bottom centre with `ink.Toolbar` as its `inkSlot`, `ZoomMenu` bottom right, `SelectionToolbar` over the selection (React Flow `NodeToolbar`), the read-only banner (our strings), M1's `DeletedBanner` after a `deleted` event, the Clear Whiteboard flow (store `clearBoard`, ink cleared too, one undo step).
  - **Stubs** (replaced by Tasks 10–12; the export names are final): `nodes/index.ts` exports `nodeTypes` (four plain boxes); `edges/index.ts` exports `edgeTypes` (a straight `BaseEdge`) and `MarkerDefs` (empty); `chrome/index.ts` exports `Toolbox`, `SelectionToolbar`, `ZoomMenu`, `BoardMenu`, `ObjectPicker` (minimal placeholders that satisfy `canvasTypes.ts`). Task 9's tests drive the store and callbacks, never the stub UI, so the replacements don't break them.
- [ ] **Step 1: Write failing tests** (`flowEnv`, mocked `whiteboardApi`, a fake host, a fake ink plugin)
  - `test open, pan, zoom and select save nothing`
  - `test camera and tool memory go to localStorage only` (and survive a throwing `localStorage`)
  - `test edit saves once after 400 ms with the loaded revision; no save during a drag`
  - `test 409 merges local changes onto the server copy and saves once`; `test second 409 reloads with the toast`
  - `test read-only board disables editing and shows the reason`; `test locked board is view only`
  - `test external whiteboard event reloads and clears history when nothing is pending`
  - `test undo after save saves the earlier state`; `test stroke and node changes share one history`
  - `test settings toggle writes ui once; defaults when absent`
  - `test keys map to commands and are ignored in editors` (the whole key table)
  - `test click and rubber band placement with one-shot tools returning to Move`
  - `test dropping an object path creates an entity node at the drop point`
  - `test dragging a frame moves the nodes inside it`
  - `test empty and lost states`
  - `test ink layer rendered only with a plugin, with the store strokes and tool`
  - `test clear whiteboard clears board and ink in one undo step`
  - `test rename flushes pending saves first` (and retargets the tab when the path changed)
  - `test delete request for this board opens the delete dialog and deletes with the version`
- [ ] **Step 2:** Run `npx vitest run src/whiteboard/{store,useBoard,useWhiteboardSettings,shortcuts,WhiteboardCanvas,WhiteboardPage}.test.*`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified.
- [ ] **Step 4:** Run `npx vitest run src/whiteboard src/api/whiteboardClient.test.ts && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(whiteboard): canvas shell, board store with undo and merge, whiteboard page`.

### Task 10: Nodes: text, objects, shapes, gates, frames, points (lane C, sub-lane C1)

**Files:**
- Create: `frontend/src/whiteboard/nodes/{BlockNode.tsx,EntityNode.tsx,ShapeNode.tsx,FrameNode.tsx,PointNode.tsx,NodeChrome.tsx,TextBlockEditor.tsx}`; replace the stub `nodes/index.ts`
- Test: `frontend/src/whiteboard/nodes/{BlockNode,EntityNode,ShapeNode,FrameNode,PointNode,TextBlockEditor}.test.tsx`

**Interfaces:**
- Consumes: Tasks 7–9 (`canvasTypes.ts`, `useBoardActions`, `shapes.ts`, `colors.ts`, `model.ts`); `@tiptap/react` with `editorExtensions()`/`loadBody(editor, body)`/`serializeBody(editor)` from `@/editor/document` (imports only); M3's `SmallCard` from `@/views/cards/SmallCard` (`{row: Row, type?: TypeDef, props: CardProperty[], onOpen?, …}`; import only) fed by `host.rows`, with `typeOf(row.summary.type)` from `@/links/linkIndex`.
- Produces:
  - `NodeChrome`: the selection ring (3 px, `--color-border-block-selection`), four handles (`top/right/bottom/left`, 12 px dots) hidden for points, `NodeResizer` with the kind's floor (`minSizeFor`), a rotation knob for shapes, all inert when the board or node is locked.
  - `BlockNode` (`objectBlock`): a text block: auto size (420–480 wide, up to 420 tall) until resized, 15 px padding, `.75rem` radius, the 3 px ring; double-click edits with `TextBlockEditor`, Escape or blur ends and writes `setBlock` once (one undo step); `align` applied. An entity block delegates to `EntityNode`.
  - `EntityNode`: resolves the link (`host.resolve`), loads its row (`host.rows`, batched per board render), renders the 30 px caption (icon and title) above M3's `SmallCard`, minimum width 360; double-click → `host.openObject(path, e)` (peek; Ctrl/Cmd → new tab); a dangling link shows the link text in the dangling style.
  - `ShapeNode` (`objectShape`): the `shapePath` SVG filled with `fillStyle`, stroked with `borderStyle` or the default ring, rotated and flipped; in-shape text in `textInset` with `textVerticalAlign`; gates show their label centred (HIGH/LOW with `data-circuit-bit`).
  - `FrameNode` (`objectFrame`): dashed 3 px border, transparent fill, the title bar when `title` is set (double-click edits the title).
  - `PointNode` (`objectPoint`): a small dot, draggable, no handles, not a connection target.
  - `TextBlockEditor`: a small Tiptap editor over Markdown (wikilinks included), `onCommit(markdown)`.
- [ ] **Step 1: Write failing tests**
  - `test text node auto sizes until resized; resize respects the 40 × 30 floor`
  - `test double click edits text and commits one setBlock on blur`
  - `test entity node shows caption and card; double click peeks, ctrl double click opens a new tab`
  - `test dangling entity link shows the link text`
  - `test all 12 shapes render with fill, border, rotation and flip`
  - `test in-shape text vertical alignment`
  - `test gate labels render; HIGH and LOW have the circuit bit marker`
  - `test frame title shows and edits; dashed border`
  - `test point has no handles and is not connectable`
  - `test locked board hides handles and resizers`
- [ ] **Step 2:** Run `npx vitest run src/whiteboard/nodes`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified.
- [ ] **Step 4:** Run `npx vitest run src/whiteboard && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(whiteboard): text, object, shape, gate, frame and point nodes`.

### Task 11: Connectors (lane C, sub-lane C2)

**Files:**
- Create: `frontend/src/whiteboard/edges/{ConnectorEdge.tsx,Markers.tsx,EdgeLabel.tsx,connectorStyle.ts}`; replace the stub `edges/index.ts`
- Test: `frontend/src/whiteboard/edges/{ConnectorEdge,Markers,EdgeLabel,connectorStyle}.test.*`

**Interfaces:**
- Consumes: Tasks 7–9; `@xyflow/react` (`BaseEdge`, `getStraightPath`, `getSmoothStepPath`, `getBezierPath`, `EdgeLabelRenderer`); `TextBlockEditor` is Task 10's, so the label uses its own small `contentEditable`-free input over Markdown text (one line, our choice) to keep the sub-lanes disjoint.
- Produces:
  - `connectorStyle.ts`: `pathFor(connection, geometry)` (straight / smoothstep / bezier; unset → smoothstep), `strokeFor(edge)` (`dasharray` from `model.ts`, round caps, colour from `borderStyle(color)` or the default edge colour, width 2), `markerIds(edge)` (`arrowClosed` → arrow).
  - `Markers` (`MarkerDefs`): SVG `<marker>` definitions for arrow, dot and double arrow at both ends, coloured per edge (one def per colour in use).
  - `ConnectorEdge` (`connector`): the path with an invisible wide hit stroke, the selection outline, the markers, the label (`EdgeLabel`) at the path midpoint; double-click adds a label block (`addEdgeLabel`) and edits it; an emptied label removes its block (`removeEdgeLabel`), as the model says ("cleared again if the text is empty"); a deprecated `label` string renders and turns into a block when edited.
- [ ] **Step 1: Write failing tests**
  - `test unset connection renders cornered and unset line solid`
  - `test straight, cornered and curved paths`
  - `test dash arrays` (dashed `8 8`, dotted `0 10`, round caps)
  - `test markers none, arrow, dot, double at start and end; arrowClosed renders as arrow`
  - `test edge colour applies to stroke and markers`
  - `test double click adds a label; emptying it removes the block`
  - `test deprecated label renders and converts to a block on edit`
- [ ] **Step 2:** Run `npx vitest run src/whiteboard/edges`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified.
- [ ] **Step 4:** Run `npx vitest run src/whiteboard && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(whiteboard): connectors with connection, line, tips, colour and labels`.

### Task 12: Toolbox, menus and selection controls (lane C, sub-lane C3)

**Files:**
- Create: `frontend/src/whiteboard/chrome/{Toolbox.tsx,ShapeMenu.tsx,GatesMenu.tsx,DisplayMenu.tsx,ZoomMenu.tsx,SelectionToolbar.tsx,EdgeStyleMenu.tsx,ObjectPicker.tsx,BoardMenu.tsx,ClearBoardDialog.tsx}`; replace the stub `chrome/index.ts`
- Test: `frontend/src/whiteboard/chrome/{Toolbox,ShapeMenu,GatesMenu,DisplayMenu,ZoomMenu,SelectionToolbar,EdgeStyleMenu,ObjectPicker,BoardMenu}.test.tsx`

**Interfaces:**
- Consumes: Tasks 7–9 (`canvasTypes.ts`, `strings.ts`, `model.ts`, `actions` via `BoardActions`); shadcn `@/components/ui/{dropdown-menu,popover,tooltip,alert-dialog,command,switch}` (all exist; imports); `@/components/ColorPicker` (`{value, onChange, className}`; import); the types list for "New object" from `useLinkIndex((s) => s.types)`.
- Produces (labels from `strings.ts`):
  - `Toolbox`: Move/Hand (one button re-arming the last pointer tool, a caret for both), "Text", "Existing object", "New object", "Shapes" (re-arms the last shape-menu tool; `ShapeMenu` lists Line, Arrow, Rectangle, Ellipse, Diamond, Parallelogram, Triangle, Star, Bubble, Arrow right, Heart), "Gates" only in Engineering mode (`GatesMenu`: NOT, AND, NAND, OR, NOR, XOR, XNOR, then "I/O": HIGH, LOW), "Frame", the `inkSlot`, "Undo"/"Redo" (`changeStack.*`; tooltips "Undo last change"/"Redo last change"), "Lock whiteboard"/"Unlock whiteboard", and "More options" with "Canvas display" (`DisplayMenu`: "Snap to grid", "Snap to nodes", "Show dots", "Zoom with scroll wheel", "Engineering mode" as switches). Tooltips carry the shortcut-name strings and our keys.
  - `ZoomMenu`: the current percentage; "Zoom in", "Zoom out", "Zoom to fit", "Zoom to selection", "Zoom to 100%", and the presets.
  - `SelectionToolbar` (nodes selected): "Color" (border, theme colours), "Fill" (shapes and frames; `bg-*`), "Text alignment" ("Align text left/center/right"), "Flip" ("Flip horizontal", "Flip vertical"; shapes), "Align" ("Place left/center/right/top/middle/bottom", "Place in a row/column/grid"; two or more), order ("Bring to front", "Bring forward", "Send backward", "Send to back"), "Duplicate", "Wrap in new frame", "Add frame title"/"Remove frame title" (one frame), "Delete". Edges selected: `EdgeStyleMenu` with "Start tip"/"End tip" (None, Arrow, Dot, Double arrow), "Connection" (Straight, Cornered, Curved), "Line" (Solid, Dashed, Dotted), "Color", "Add arrow label"/"Remove arrow label"; a change also updates the board's remembered connection and line (tool memory).
  - `ObjectPicker`: "Existing object" mode: a `command` list over `host.objects()` filtered by title (placeholder "Search objects", our string), Enter or click → `onPick({path})`; "New object" mode: the types list ("Pick a type", our string) → `host.createObject(typeId)` → `onPick`.
  - `BoardMenu` (`…`): "Clear Whiteboard" (opens `ClearBoardDialog`: "Clear this whiteboard?", "This removes every object and connector from the canvas. You can undo it.", "Cancel", "Clear Whiteboard"), "Delete" (`BoardMenuProps.onDelete`, which `WhiteboardPage` wires to `host.requestDelete(path, mode)`).
- [ ] **Step 1: Write failing tests**
  - `test toolbox order and labels`; `test pointer button re-arms the last of Move and Hand`
  - `test shape menu order and picker set` (11 entries; no Rounded rectangle, Triangle down or left arrow)
  - `test gates only in engineering mode, with I/O group, falling back to NAND`
  - `test display menu switches call onSettings with Object's keys`
  - `test zoom menu presets and commands`
  - `test selection toolbar shows the controls that apply to the selection` (text only, shape, frame, several nodes, a locked node)
  - `test edge style menu writes tips, connection, line and colour and remembers the style`
  - `test object picker filters titles and picks; new object creates then picks`
  - `test clear whiteboard dialog strings and confirm`
  - `test undo redo buttons follow canUndo and canRedo`
- [ ] **Step 2:** Run `npx vitest run src/whiteboard/chrome`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified.
- [ ] **Step 4:** Run `npx vitest run src/whiteboard && npx tsc -b --noEmit && npm run lint`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(whiteboard): toolbox, shape and gate menus, display, zoom and selection controls`.

### Task 13: Integrate and milestone acceptance (integrate; after Tasks 1–12 and after M5's integrate commit)

**Files:**
- **First, re-read what M5 actually built** (it ran concurrently; this plan names M5's planned interfaces): `server.py`'s `create_app` (M5 plans `ctx = ApiContext(space, announce, search)` from `apictx.py` and three `include_router` calls), `roles.py`, `linkindex.py`, `searchindex.py`/`searchtext.py`, `Space.add_listener`/`SpaceChange`, `palette/SearchView.tsx`, the hook points `LinkIndex._extract(path)` and `SearchIndex._document(path)`, and M5's `conftest.py` autouse `OBJECT_CACHE_DIR` fixture. Correct the names below to match before editing.
- Modify (backend): `server.py` (mount `whiteboard_router(space, announce)` after `announce` is defined (a closure inside `create_app`; with M5's `ApiContext`, `ctx.space`/`ctx.announce`): M5 includes its three routers on the existing `api = APIRouter(prefix="/api")` before `app.include_router(api)`; ours carries its own `/api` prefix, so it goes in with `app.include_router(...)` next to `app.include_router(api)` (or build it without a prefix and include it on `api`, whichever matches what M5 left); `_UI_PATCH_KEYS` (today `pinned, sections, allNotesLayout, calendar, tasks, reminders`, plus M5's `graph`) gains `whiteboard` and `_ui_problem` calls `whiteboard_ui_problem`; the module docstring lists the new routes), `space.py` (`delete_object`: after `_move_out(rel, self.trash.object_file(item.id))`, `trash_sidecars(self, item.id, rel)` when the object is a whiteboard, and on failure the `.md` goes back and the meta file is removed, as the existing `except` does; `trash_type` reaches this through its `delete_object(rel, type_trash_id=…)` calls; `_restore_object_entry(trash_id, meta)`: for a whiteboard entry choose the stem with `free_whiteboard_stem` instead of `_restore_file`'s own `unique_path`, then `restore_sidecars`; `purge` (and therefore `empty_trash`, `purge_expired`, which call it): `purge_sidecars` next to each `trash.remove_object`; `rename_object`/`_rename_target`: a whiteboard's new stem from `free_whiteboard_stem`, `move_sidecars` after `_move_file`; if it fails, move the `.md` back and keep the old name (the title change stands, as `rename_object` already does when `_move_file` raises `OSError`); the referrer relink pass also calls `relink_board_file` for every whiteboard whose board links the renamed object and reports written sidecars in `relinked`; change type: `changetype.py`'s `type_category` returns `"whiteboard"` for the basic Whiteboard type; it is in neither `CHANGE_FROM_ALLOWED` nor `CHANGE_TO_ALLOWED`, so `Space._change_type_pair` (used by both `change_type` and `suggest_change_type`) already raises its `InvalidValue` messages and the routes return 422; no `space.py` change for this), `changetype.py` (that one line), `typemodel.py` (`BASIC_TYPE_NAMES = ("Page", "Tag", "Task", "DailyNote")` += `"Whiteboard"`, `_TYPE_ICONS["Whiteboard"] = "ph-presentation"`), `watcher.py` (`ChangeEvent.kind` Literal += `"whiteboard"`; `_relpath` today accepts only `.md`, so add a sidecar branch: a non-dot `*.whiteboard.json`/`*.ink.svg` change whose `sidecar_event_owner` is a whiteboard announces `whiteboard` with the owner's path, unless it is an own write (`own_writes`/`own_deletes` on the sidecar's path)), `media.py` (`list_images(root)` and `image_path(root, path)` (behind `GET /api/file`) skip `*.ink.svg` sidecars of whiteboards; `.svg` is in `IMAGE_EXTENSIONS`), `roles.py` (M5: add `RootWhiteboard` as the M5 plan asks, the `...whiteboard(config)` entries of `structureHeuristicsBackbone.ts`), and M5's link and search indexes fed with `board_links`/`board_text` through the hook points the reconciled M5 plan names: `linkindex.LinkIndex._extract(path)` (one per-source extraction method) and `searchindex.SearchIndex._document(path)` (one per-object document builder); for a whiteboard `.md`, each also reads its `.whiteboard.json` (read only, `load_board`; an unreadable board adds nothing) and adds the board's links / text, a one-line addition each. Freshness: sidecar saves and external sidecar edits never pass through `Space.rescan_file`, so no `SpaceChange` fires for them; after a successful board save (in `whiteboardapi`, or from the router's caller) and in the watcher's sidecar branch, fire the listeners for the owning `.md` through what M5 built (e.g. `space.rescan_file(md_rel)`, which re-reads the `.md`, writes nothing, and fires `SpaceChange('object', md_rel)`). If M5 built these methods differently, use its equivalent; if there is none, record for Gene that boards' links stay out of backlinks and the graph and board text out of search. Test: `test_board_links_reach_backlinks_and_search` (a board linking Router A makes the board a backlink of Router A after a save; a word only in a text block finds the board).
- Modify (frontend): `api/types.ts` (`ChangeKind` += `'whiteboard'`; `UiState.whiteboard?: WhiteboardSettings`), `api/client.ts` (`UiPatch` += `whiteboard`; optionally a local `whiteboard` emit, see Global Constraints), `object/ObjectPage.tsx` (today one line: `<ObjectView key={path} path={path} mode="page" />`) and `object/ObjectPeek.tsx` (renders `ObjectView` with `mode="peek"`, `onExpand`, `onDismiss={close}`, `footer={<Pager />}`): render `<WhiteboardPage key={path} path mode ink={inkPlugin} />` (with the same `onExpand`/`onDismiss`/`footer` in the peek; `defaultHost` already wires `useDeleteRequest`) when the object's type (`typeOf(summaryOf(path)?.type)`) is the basic Whiteboard type, else `ObjectView` as now; `create/NewObjectMenu.tsx` (a two-step menu over `useLinkIndex` types: "Whiteboard" with `ph-presentation` is listed in step 1 even when the type isn't stored yet; its "New Untitled"/"New '…'" calls `whiteboardApi.createWhiteboard(title)` and opens the board, then `invalidateLinkIndex()`), `shell/PinnedSection.tsx` (`PinRow` in `PinList`: object pins get `draggable` and an `onDragStart` setting `OBJECT_DRAG_MIME` and a `[[Title]]` text, without breaking the dnd-kit `PointerSensor` (distance 4) reordering), M5's `palette/SearchView.tsx` result rows (the same drag data), and their tests.
- Create: `backend/tests/test_whiteboard_integration.py`, `scripts/m6_acceptance.py`, `docs/superpowers/plans/m6-acceptance.md`; modify `docs/superpowers/plans/remaining-work.md` (the M6 rows only).

- [ ] **Step 1: Check isolation, then wire.** M5's commits land in the same range, so check the M6 lane commits only (their subjects are the Step 5 messages of Tasks 1–12): `git log --name-status --format=%h%x09%s <M6 base>..HEAD` filtered to those commits shows every path as `A`, or as `M` only for a path an earlier M6 commit added (the `nodes/`, `edges/`, `chrome/` `index.ts` stubs that Tasks 10–12 replace), and none outside `backend/objectapp/whiteboard*.py`, `backend/tests/{wb_support.py,test_whiteboard_*.py,fixtures/space-whiteboard/**}`, `frontend/src/api/whiteboard*`, `frontend/src/whiteboard/**` (Review Focus 8; report any exception). Then make the edits above. Tests in `test_whiteboard_integration.py` (through `create_app`): `test_router_mounted`, `test_delete_whiteboard_trashes_sidecars`, `test_restore_whiteboard_byte_identical` (also with a collision), `test_purge_and_expiry_remove_sidecars`, `test_type_delete_trashes_board_sidecars`, `test_rename_whiteboard_moves_sidecars` (and rollback), `test_rename_target_object_relinks_board`, `test_change_type_refused_for_whiteboards`, `test_watcher_announces_external_sidecar_change`, `test_ui_accepts_whiteboard_key`, `test_ink_svg_not_listed_as_image`, `test_whiteboard_is_basic_with_icon`, `test_whiteboard_role` (M5's `roles.role_of` gives `RootWhiteboard`). Frontend: `test whiteboard object opens WhiteboardPage in page and peek with the ink plugin`, `test New menu creates a whiteboard before its type exists`, `test pinned object drag carries the object path; reordering still works`. Then `uv run pytest backend/tests -q` and `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run lint && npm run build`. Expected: all green.
- [ ] **Step 2:** Write `scripts/m6_acceptance.py SPACE [--keep]` (run as `uv run python scripts/m6_acceptance.py SPACE`), shaped like `m4_acceptance.py` (the newest; `create_app(space, None, watch=True)` under `uvicorn.Server` on a free `127.0.0.1` port in a thread): a temporary git-committed copy, `OBJECT_STATE_DIR` and (as `m5_acceptance.py` does) `OBJECT_CACHE_DIR` pointed at temporary folders, and whole-tree snapshots that skip `.git` and `.object-cache/` (M5's derived index). Over HTTP it checks:
  1. Opening twice and calling `GET /api/whiteboard` and `GET /api/whiteboard/ink` for every whiteboard (and one without sidecars) changes no file (`git status` clean).
  2. `POST /api/whiteboards` creates exactly `Whiteboards/<title>.md` (plus `.object/types/whiteboard.json` the first time); no sidecar.
  3. The first `PUT /api/whiteboard` (base `''`) creates only `<title>.whiteboard.json`; the `.md` is byte-identical; a second `PUT` with the old revision is 409 and the file is unchanged.
  4. `PUT /api/whiteboard/ink` with pen strokes of varying pressure creates only `<title>.ink.svg`; it parses as XML, has a `viewBox` and one `<path>` per stroke with the pressures in `data-points`; `GET` returns the same strokes.
  5. On a board with every item kind (the copy of `Network map`, or one built over the API on other spaces): `GET` then `PUT` of the same board leaves the file byte-identical.
  6. An invalid board is 422 and nothing is written; a save over an unreadable board is 423 and the file is untouched.
  7. Renaming the board moves the `.md` and both sidecars, bytes identical.
  8. Renaming an object the board links to rewrites only that link in the board JSON.
  9. Deleting the board moves all three files out of the space; restoring puts them back byte-identical; with the title taken first, the three come back as `… (2)` together.
  10. Purging the trash entry removes its sidecar folder.
  11. `GET /api/images` does not list the ink file.
  12. The M1 no-edit pass: 0 files changed.
- [ ] **Step 3:** Run it on copies of `backend/tests/fixtures/space-whiteboard`, `space-sample` and `space-v1` (boards are created over the API where missing). Expected: every check prints `[ok]`.
- [ ] **Step 4:** `npm run build`, then serve the built app on a scratch copy of `space-whiteboard` (on Gene's PC `uv run objectapp --space <copy>`; in a cloud container with no display, never the pywebview window: run `objectapp.__main__.build_server_config(space, port, static_dir)` (it calls `create_app` with `frontend/dist`) under `uvicorn.Server` on `127.0.0.1` headless and drive it with Playwright Chromium, `chromium.launch()` with no options, leaving no process running), and walk through: create a board from "+ New"; every tool; every shape and gate (Engineering mode on); text editing and alignment; an object dragged from Pinned and one from "Existing object", opened in the peek by double-click; connectors in all styles with labels; frames (wrap, title, drag with contents); align, order, flip, duplicate, delete; lock; Canvas display switches; zoom menu and keys; undo/redo across nodes and ink; an external edit of the JSON in VS Code appearing live; two windows editing different nodes at once (merge); delete and restore from the Trash; rename. If Playwright is available, also draw a stroke headless with CDP `Input.dispatchMouseEvent` (`pointerType: 'pen'`, varying `force`) and check the saved SVG's pressures vary.
- [ ] **Step 5:** Write `docs/superpowers/plans/m6-acceptance.md` with Gene's hand-check list (on a scratch copy and on his CPI copy outside the repo, `git init` done there):
  - **Wacom pressure test:** in Wacom Tablet Properties → Mapping, "Use Windows Ink" is on (Chromium/WebView2 gets pen pressure through Windows Ink); with the Pen, a light stroke is thin and a heavy one thick, smoothly varying within one stroke; a fast scribble has no gaps or corners; the Highlighter is flat and translucent; turning the pen over (eraser end) erases strokes it crosses, whatever tool is selected; the barrel button never draws; a mouse stroke draws with simulated taper; resting the palm on a touch screen while drawing adds nothing; each stroke undoes and redoes as one step; the ink is still there after closing and reopening the app; `Whiteboards/<title>.ink.svg` opened in Edge or Chrome shows the same strokes. Note any lag between pen and line.
  - Opening his existing space changes nothing (`git status` clean); a new board is three files at most, beside each other in `Whiteboards/`.
  - Side by side with Object (the trimmed reference has no whiteboard screenshot, so these are judged by eye): the toolbox position and contents, the zoom control, the selection toolbar, node rings and handles, the dotted grid, connector looks, the frame look, gates (only labelled rectangles here), entity node caption and card.
  - The decisions flagged in Global Constraints: our shortcut keys, frames dragging their contents, 9 of 12 shapes in the picker, board edits not bumping `lastUpdated`, the per-viewer camera, "Clear Whiteboard" clearing the ink, change type refused, ink colours and widths, and (only if Task 13 found no M5 hook) boards' links missing from backlinks and search.
  - A `git diff` after moving one shape shows only that node's `position` lines in the `.whiteboard.json`.
- [ ] **Step 6:** Update the M6 section of `remaining-work.md` to "built" with what Task 13 found, then commit `chore: milestone 6 integrate and acceptance`.
