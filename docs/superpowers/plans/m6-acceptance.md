# Milestone 6 acceptance

Plan: `2026-10-26-m6-whiteboards-pen.md`, Task 13. Date: 2026-10-27. Built on a Linux cloud container, not Gene's Windows PC, so the Wacom checks below have not been run on real hardware.

## Automated results

| Suite | Command | Result |
|---|---|---|
| Back end | `uv run pytest backend/tests -q` | 852 passed, 1 skipped (the read-only-folder test, skipped as root) |
| Front end | `cd frontend && npx vitest run` | 1003 passed (161 files) |
| Type check | `cd frontend && npx tsc -b --noEmit` | clean (this also proves Lane B's `InkStroke` matches Lane C's `plugin.ts`) |
| Lint | `cd frontend && npm run lint` | exit 0 (warnings only, none new) |
| Build | `cd frontend && npm run build` | built (`dist/`) |
| M6 acceptance | `uv run python scripts/m6_acceptance.py backend/tests/fixtures/space-whiteboard` | PASS (20 checks) |
| M6 acceptance | `… space-sample`, `… space-v1` (boards created over the API) | PASS (19 checks each) |
| Earlier milestones | `m1_roundtrip.py`, `m2_acceptance.py`, `m3_acceptance.py`, `m4_acceptance.py`, `m5_acceptance.py` on `space-sample` | PASS |

`test_search_p95_under_50ms_at_5000` (M5) failed in full backend runs once boards were indexed: one query out of 20 took 60–130 ms while the others took 3–15 ms, and the test passed when run alone. The slow query was a full garbage collection of what earlier tests left behind. The test now runs `gc.collect()` before timing and turns the collector off while timing, so it measures the search and not the collector. No search code changed for this.

### Lane isolation (Review Focus 8)

`git log --name-status` over the twelve M6 lane commits (`ebcdcc8`, `69a63f9`, `752c3dc`, `604b98e`, `04f3e19`, `b02af6d`, `ee3cb84`, `83ced63`, `dd39387`, `a9d4295`, `db9d26b`, `182a20f`) shows every path as `A` inside the lane folders. The only `M` paths are `frontend/src/whiteboard/{nodes,edges,chrome}/index.ts`, the stubs that Tasks 10–12 replaced. No exceptions.

### `scripts/m6_acceptance.py`

The script works on a temporary git-committed copy of the space, with `OBJECT_STATE_DIR` and `OBJECT_CACHE_DIR` in temporary folders outside the copy. It serves the copy with `create_app(space, None, watch=True)` on a free `127.0.0.1` port. Snapshots skip `.git` and `.object-cache/`. On spaces with no whiteboards it creates its boards over the API. The checks:

1. `GET /api/whiteboard` and `GET /api/whiteboard/ink`, twice, for every whiteboard (on `space-whiteboard`: 6 boards, 1 with no sidecars) change no file, and `git status` is clean.
2. `POST /api/whiteboards` creates exactly `Whiteboards/M6 acceptance board.md`, plus `.object/types/whiteboard.json` on spaces that didn't have it. No sidecar is created.
3. The first `PUT /api/whiteboard` (base `''`) creates only the `.whiteboard.json`, and the `.md` stays byte-identical. Saves with base `''` and with a wrong revision both return 409 with the current revision, and the file is unchanged.
4. `PUT /api/whiteboard/ink` with three strokes of varying pressure creates only the `.ink.svg`. The file parses as XML, has a `viewBox`, and has one `<path>` per stroke whose `data-points` hold the pressures. `GET` returns the same strokes.
5. `GET` then `PUT` of the same board is byte-identical, for `Network map` (28 nodes of all four kinds, 5 edges) and for the board built in 3 (all 12 shapes, the 9 gates, a frame, points, three connectors covering every connection, line and tip, a label, and an unknown top-level key).
6. An invalid node kind returns 422 and writes nothing. A board file replaced by garbage opens read-only, and a save over it returns 423 with the file untouched.
7. Renaming the board moves the `.md` and both sidecars, bytes identical.
8. Renaming an object the board embeds rewrites only that block's link in the board JSON. The rename's `relinked` list reports the board file, and nothing else is written beyond what `relinked` reports. On `space-whiteboard`, `Network map`'s board, which also links Router A, is relinked too.
9. Deleting the board moves all three files out of the space, and restoring brings them back byte-identical. Then, with the title taken while the board is in the trash, the three files come back together as `… (2)`.
10. Purging the trash entry removes its `.object/trash/whiteboards/<id>/` folder.
11. Ink files are not listed by `GET /api/images`. (This check runs before 9 and 10, while the board still has its ink.)
12. The M1 no-edit pass changes 0 files.

### Wiring done in this task

Back end:

- **The router is mounted.** `server.py` mounts `whiteboard_router` next to the main `/api` router. Its announce callback re-scans the board's `.md` after a board or ink save. That writes nothing, and it fires the space's listeners, so the link index and search re-read the board.
- **`PUT /api/ui` accepts `whiteboard`.** It is validated by `whiteboard_ui_problem`.
- **`ChangeEvent.kind` gains `whiteboard`**, on the server and in the client's `ChangeKind`.
- **The watcher handles sidecars.** A `*.whiteboard.json` or `*.ink.svg` changed outside the app announces `whiteboard` with the board's `.md` path, but only when that `.md` is a whiteboard, and it re-scans the `.md`. The app's own writes and moves stay quiet, and an orphan sidecar announces nothing.
- **Trash, restore and purge carry the sidecars.**
  - `delete_object` moves them into the trash. If that fails, the `.md` goes back.
  - Restore picks one free stem for all three files (`free_whiteboard_stem`, so an orphan sidecar is never adopted), then restores the sidecars. If that fails, the entry stays whole in the trash.
  - Purge (and so empty trash and 30-day expiry) removes the sidecars. Type trash and type restore go through the same paths.
- **Rename carries the sidecars.**
  - A whiteboard's new stem must be free for all three names. The sidecars move after the `.md`. If they can't move, the `.md` goes back and the title change stands, as when a file is locked.
  - Renaming any object also relinks every board file that links to it by its old name, using the same rule as `.md` referrers. Those board files are listed in `relinked`, and the server announces `whiteboard` for them, not `changed`.
- **Change type is refused.** `changetype.type_category` returns `whiteboard` for the basic Whiteboard type, so M2's existing 422 messages refuse changing a board's type and changing an object to a board.
- **Whiteboard is a basic type.** It is in `BASIC_TYPE_NAMES` with the icon `ph-presentation`. `roles.py` maps it to `RootWhiteboard`, which is in all four of M5's role lists.
- **Ink files are not images.** `media.py` neither lists nor serves `<stem>.ink.svg` when `<stem>.md` sits beside it.
- **Boards are in backlinks and search.**
  - New module `whiteboardindex.py` reads the board read-only, for both indexes.
  - The link index adds a board's links (entity blocks and wikilinks in text blocks) to the whiteboard's body links, so a board linking Router A is a backlink of Router A.
  - The search index adds board text to the body column. Its stored version for a whiteboard is now the `.md` version plus the board revision, so a board edit re-indexes the board without touching the `.md`.

Front end:

- **Whiteboards open the canvas.** `ObjectPage` and `ObjectPeek` render `WhiteboardPage`, with Lane B's `inkPlugin`, when the object's type is the basic Whiteboard type. The peek keeps its expand, dismiss and pager.
- **"+ New" offers Whiteboard.** It is listed in step 1 even before the space has the type. Its "New Untitled" and "New '…'" call `POST /api/whiteboards` and open the board.
- **Pinned objects drag onto a board.**
  - Object pins are `draggable` and set `OBJECT_DRAG_MIME` plus a `[[Title]]` text.
  - dnd-kit's pointer sensor cancels native drags, so a pin released outside its list hands the object to whatever is under the pointer, through a synthetic `dragover`/`drop` (`shell/objectDrag.ts`). Only a target that accepts objects receives it, as the board canvas does. Reordering inside the list works as before.
  - Horizontal auto-scroll is off for the pinned list, so dragging a pin out no longer scrolls the sidebar sideways.
- **Search results drag onto a board.** Search palette result and recent rows are `draggable` with the same data, and the palette closes once the drag has started, so the board under it receives the drop.
- **Typing starts right away.** A text block placed with the Text tool now opens for typing at once (our choice). Before this, typing after placing a text block went to the canvas shortcuts (`t`, `o`, `r`, …).
- **`UiPatch` and `UiState` gain `whiteboard`.**

### Headless walkthrough (built app, Playwright Chromium)

I served `frontend/dist` with `build_server_config` on a scratch copy of `space-whiteboard` and first called the new routes with curl:

- `GET /api/whiteboard` and `GET /api/whiteboard/ink`: 200
- `POST /api/whiteboards`: 201
- `PUT /api/ui` with `whiteboard` and `pinned`: 200

Then I drove the app with Playwright. There were 0 console errors, and the server was stopped afterwards.

- Ctrl+U → "Whiteboard" → "New 'PW board'" created `Whiteboards/PW board.md`, and no board file existed before the first edit.
- The canvas rendered. The Text tool placed a block, and typed text was saved to the board file.
- The Pen tool drew a CDP pen stroke (`pointerType: 'pen'`, force 0.1 → 1). The saved SVG has 31 distinct pressures.
- Router A, pinned, dragged from the sidebar onto the board became an embedded object card.
- `Network map` rendered its 28 nodes: text, two object cards, all 12 shapes, the 9 gates with HIGH and LOW ringed, a frame, points and connectors with labels.

Not walked in the browser: every shape and gate picker, alignment, order, flip, wrap in frame, lock, Canvas display switches, zoom keys, undo across nodes and ink, live external edits, two windows merging, Trash restore and rename from the UI. The tests and the acceptance script cover these, but Gene checks them by hand below.

Things noticed for Gene:

- On `Network map`, the first "zoom to fit" puts content under the title overlay at the top left: the title and the frame's "Frame 1" label overlap the board text.
- The pen colour popover opens over the toolbox and its colour column is tall: 18 colours in two columns.

### Items the lane tasks left for Gene

- **Our choices in Task 7:**
  - `whiteboard.css` uses blue for the selection colour and text-muted for the strong line colour; neither is a catalog value (our choice).
  - `saveSettings` still sends `PUT /api/ui` itself. It works the same as `api.patchUi`, but it emits no local `ui` event.
- **Task 9:**
  - The camera and tool-memory key is the board path.
  - The peek's pager sits bottom left.
  - Zoom to fit and Zoom to selection pad by two grid cells.
  - "Changed elsewhere" stays 4 s.
  - Tab cycles nodes by position.
  - P, M and E arm pen 4, highlighter 16 and gray.
  - Zoom to fit never zooms in past 100 %.
- **Task 10:**
  - Unfilled shapes use `var(--color-bg-base)`.
  - Dangling links in nodes use inline dotted-underline classes.
- **Task 11:**
  - Connector width is 3 px (reference CSS), not the plan's 2.
  - The tip drawings are ours.
  - Escape saves a label.
- **Task 12:**
  - These strings are our own: "Choose pointer tool", "Choose shape", "Choose gate", "Order", "Nothing found", "Open as page", "Whiteboard tools", "Selection", "Zoom".
  - Two buttons on the board page are named "More options".
  - Tip "None" writes `'none'`.
- **Task 5:** `InkStroke` has an optional `colorName` (the theme name behind the hex, written to `data-color`).
- **Not wired:** a local `whiteboard` emit in `api/client.ts`. A board open in a page and in the peek of the same window sees its own saves only on the next load (the plan's stated choice).

## Gene's hand-run checks (not yet done)

Run `npm run build`, then `uv run objectapp --space <copy of backend/tests/fixtures/space-whiteboard>`, and also on his CPI copy outside the repo (`git init` done there).

### Wacom pressure test

- [ ] In Wacom Tablet Properties → Mapping, "Use Windows Ink" is on (Chromium/WebView2 gets pen pressure through Windows Ink).
- [ ] With the Pen, a light stroke is thin and a heavy one thick, varying smoothly within one stroke.
- [ ] A fast scribble has no gaps or corners.
- [ ] The Highlighter is flat and translucent.
- [ ] Turning the pen over (eraser end) erases the strokes it crosses, whatever tool is selected.
- [ ] The barrel button never draws.
- [ ] A mouse stroke draws with a simulated taper.
- [ ] Resting the palm on a touch screen while drawing adds nothing.
- [ ] Each stroke undoes and redoes as one step.
- [ ] The ink is still there after closing and reopening the app.
- [ ] `Whiteboards/<title>.ink.svg` opened in Edge or Chrome shows the same strokes.
- [ ] Note any lag between pen and line.

### Files

- [ ] Opening his existing space changes nothing (`git status` clean).
- [ ] A new board is at most three files, side by side in `Whiteboards/`.
- [ ] A `git diff` after moving one shape shows only that node's `position` lines in the `.whiteboard.json`.
- [ ] Delete a board and restore it from the Trash: all three files come back. Rename a board: all three files follow.
- [ ] Edit a board's `.whiteboard.json` in VS Code while it is open: the board reloads ("Changed elsewhere. Reloaded.").
- [ ] Two windows editing different nodes of one board at once both keep their changes (merge).

### In the app

- [ ] Create a board from "+ New".
- [ ] Every tool.
- [ ] Every shape and gate, with Engineering mode on.
- [ ] Text editing and alignment.
- [ ] An object dragged from Pinned, one dragged from the search palette, and one picked with "Existing object", each opened in the peek by double-click.
- [ ] Connectors in all styles, with labels.
- [ ] Frames: wrap, title, drag with contents.
- [ ] Align, order, flip, duplicate, delete.
- [ ] Lock.
- [ ] Every Canvas display switch.
- [ ] The zoom menu and the zoom keys.
- [ ] Undo and redo across nodes and ink.
- [ ] Boards in backlinks and search: an object embedded on a board lists the board in its references, and a word typed in a board text block finds the board in Ctrl+K.

### Against the behaviour catalog (judge by eye)

- [ ] The toolbox position and contents.
- [ ] The zoom control.
- [ ] The selection toolbar.
- [ ] Node rings and handles.
- [ ] The dotted grid.
- [ ] How connectors look, including the 3 px width and our tip drawings.
- [ ] How frames look.
- [ ] Gates: here they are only labelled rectangles.
- [ ] The entity node's caption and card.
- [ ] The first "zoom to fit" against the title overlay (see above).

### Decisions made without a reference

- [ ] The shortcut keys follow the whiteboard shortcut table (`reference-check-2026-10-28.md` §1): V, H, T, L, Shift+L (arrow), R, O, P (triangle), F, ] and [ (front and back), Ctrl+] and Ctrl+[, Ctrl+G (wrap in frame), Ctrl+Arrow (resize), and a nudge of 1 px, or 30 px with Shift or while snap to grid is on. Pen D, highlighter Shift+D and eraser E are ours: Object-only tools, kept off P (triangle) and M (move menu).
- [ ] Frames dragging their contents.
- [ ] 9 of the 12 shapes in the picker.
- [ ] Board edits don't bump `lastUpdated`.
- [ ] The camera is per viewer.
- [ ] "Clear Whiteboard" also clears the ink.
- [ ] Change type is refused for boards.
- [ ] Ink colours and widths.
- [ ] A placed text block opens for typing at once.
- [ ] Dragging a search result closes the palette.
- [ ] Whiteboard is offered in "+ New" before the space has the type.
- [ ] The Task 7, 9, 10, 11 and 12 choices and strings listed above.
