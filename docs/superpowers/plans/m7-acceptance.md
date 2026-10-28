# Milestone 7 acceptance

Plan: `2026-10-26-m7-blocks-lightmode-polish.md`, Task 19. Date: 2026-10-27. This was built on a Linux cloud container, not on Gene's Windows PC. The walkthrough ran headless (Playwright with Chromium), because the container has no display for the pywebview window.

## Automated results

| Suite | Command | Result |
|---|---|---|
| Back end | `uv run pytest backend/tests -q` | 933 passed, 1 skipped (the read-only-folder test, which is skipped when running as root) |
| Front end | `cd frontend && npx vitest run` | 1332 passed, 1 skipped (225 files passed, 1 skipped: `roundtrip.space.test.ts`, which runs only when `OBJECT_ROUNDTRIP_SPACE` is set) |
| Type check | `cd frontend && npx tsc -b --noEmit` | clean |
| Lint | `cd frontend && npm run lint` (oxlint) | exit 0 (warnings only) |
| Build | `cd frontend && npm run build` | built (`dist/`) |
| M7 acceptance | `uv run python scripts/m7_acceptance.py backend/tests/fixtures/space-blocks` | PASS (23 checks; round trip: 6 files, 29 annotated blocks, 0 differences) |
| M7 acceptance | the same script on `space-sample`, `space-v1`, `space-calendar`, `space-links`, `space-whiteboard` | PASS on each (round trip: 14, 11, 33, 21 and 10 files, 0 differences) |
| Earlier milestones | `m1_roundtrip.py`, `m2_acceptance.py`, `m3_acceptance.py`, `m4_acceptance.py`, `m5_acceptance.py`, `m6_acceptance.py` on `space-sample` | PASS |

Step 1 also covered:

- `theme/noRawColours.test.ts`: `PENDING` is now empty. `editor/editor.css` and `object/ObjectView.tsx` no longer contain raw colour literals, and the test passes.
- Wikilinks and embedded objects both open with `via: 'link'`:
  - wikilinks, on a new-tab open: `links/wikilinkPresenter.ts`
  - the peek's "Open as page": `object/ObjectPeek.tsx`
  - an embedded object's card: `editor/embed/ObjectEmbedView.tsx`

### `scripts/m7_acceptance.py`

Usage: `uv run python scripts/m7_acceptance.py SPACE [--keep] [--skip-roundtrip]`.

Like `m6_acceptance.py`, the script works on a temporary git-committed copy of the space. It points `OBJECT_STATE_DIR`, `OBJECT_CACHE_DIR` and `OBJECT_FAKE_OPEN_FILE` at temporary paths. It registers the copy in the temporary spaces registry, as the launcher does, and then serves it with `create_app(space, None, watch=True)` on a free `127.0.0.1` port. The checks:

0. Opening twice changes no `.md` file.
1. Every M7 read route is called twice and changes no file, and `git status` stays clean. The routes are `GET /api/space`, `/api/settings`, `/api/spaces`, `/api/attachments`, and `/api/file` for one file of each kind the space has. No `space.json` or `settings.json` appears. The state dir holds only `spaces.json` (M4's reminder ledger would also be allowed). Every served file has the contract's headers.
2. Uploads:
   - Uploading a PNG, a PDF, a WAV and an XLSX creates exactly those four files, byte-identical. A second upload with the same name gives `m7 pixel (2).png`, and the first file is untouched.
   - `GET /api/file` returns each upload with the contract's headers.
   - A `Range` request on the WAV returns 206 with the right bytes.
   - An uploaded `.html` comes back as `application/octet-stream` with `Content-Disposition: attachment`.
   - `POST /api/attachments/open` records the PDF with the fake opener. An uploaded `tool.exe` is refused with 415 and nothing is launched. (Task 1 could not commit an `.exe` fixture, so the script uploads its own.)
   - Traversal and dot-folder paths return 404.
3. `PUT /api/space` with a new name changes only `.capacities/space.json` (created on every fixture space) and leaves the folder name unchanged. A stale revision returns 409 and writes nothing.
4. `PUT /api/settings` writes only `settings.json` in the state dir, and the space is unchanged. A stale revision returns 409 and an unknown key returns 422.
5. Spaces:
   - `POST /api/spaces` in a temporary location creates a folder holding only `.capacities/space.json`. A second create returns 409 and the folder is byte-identical.
   - The new space is listed, and the current space is the only one marked `current`. `DELETE /api/spaces` removes the new space from the list and keeps its folder. Removing the open space returns 409.
   - Switching without the launcher returns 503.
   - A real `SpaceHost` on a free port refuses a non-folder with 404. It then switches with 202, and `GET /api/space` reports the new root.
   - Serving the new space wrote only the built-in `page.json` and `tag.json` type files. That is existing M3 behaviour, and `space.json` keeps its bytes.
6. `OBJECT_ROUNDTRIP_SPACE=<copy> npx vitest run src/editor/roundtrip.space.test.ts` passes with 0 differences.
7. The M1 no-edit pass changes 0 files.

### Contract check

`api/client.ts` was compared with `server.py` route by route: attachments (list, upload, open, file), space (GET and PUT), settings (GET and PUT), spaces (list, create, open, remove, switch). Paths, verbs, bodies and status handling match, and every client method has a caller:

| Client method | Caller |
|---|---|
| upload | `editor/media/upload.ts` |
| open | `editor/media/MediaView.tsx` |
| `patchSpace` | `settings/useSpaceInfo.ts`, `SettingsModal.tsx` |
| `patchSettings` | `settings/useSettings.ts` |
| spaces | `spaces/SpacesMenu.tsx`, `CreateSpaceDialog.tsx`, `switchSpace.ts` |

`SettingsModal`, `CreateSpaceDialog` and `SpaceSwitchOverlay` are mounted in `shell/GlobalOverlays.tsx`, and `SpacesMenu` is in `TopBar.tsx`. Checks 1–5 above exercise every route over HTTP. No wiring was missing, so this task made no source change beyond the `PENDING` list.

### Headless walkthrough (Step 4)

The built app was served on a scratch copy of `space-blocks` (`build_server_config` with uvicorn on `127.0.0.1`) and driven with Playwright. It produced 0 page errors and 0 console errors. Afterwards `git status` in the copy was clean: the walkthrough typed `/` and removed it again. No process was left running. Screens captured:

- shell
- every block in "Every block", dark, plus four scrolls
- the slash menu ("Create a block": Text, Heading 1–4, Small, Bullet list…)
- block handles
- the tab menu
- the side panel (empty entry: "Explore" with "Graph View")
- the spaces menu (Spaces, Space settings, Add space, Open folder…)
- the Settings modal, with every section: Appearance, Editor, Date & Time, Notifications, Space Settings, Object Types, Task management, Shortcuts
- Light, Light Dimmed and Dark Dimmed (shell and editor)
- the Calendar

The walkthrough did not cover every interaction in Step 4. These were not driven and are left for Gene's hands-on pass:

- dragging blocks
- resizing columns and images
- pasting and dropping files
- switching an embedded object between its four views
- swap and resizing in the side panel
- creating and switching spaces in the UI (checked over HTTP in check 5 instead)

## Found in this pass (for the whole-milestone review and fix pass)

These are known issues. Task 19 did not fix them, because they are in files other tasks own. They are listed so the review and fix pass picks them up.

1. **Fixed in the review fix pass:** `loadBody` records the body's final line break and `serializeBody` keeps that state. **The final newline is lost (file safety; confirmed).** When the last block of a body is replaced by a new node, or a block is inserted after it, saving drops the body's final newline. Both cases were reproduced against `editor/document.ts`:
   - `Hello world\n` → `toggleBulletList` → `- Hello world`
   - `First\n\nHello\n` with a paragraph appended → `First\n\nHello\n\nNew`

   The trailing line break is part of the last block's `raw`, not a `trailing` edge, so it goes with the block. One fix: `loadBody` records whether the body ended with a line break, and `serializeBody` adds `eol` back when the output doesn't. Tasks 8 and 11 reported this; their tests work around it.
2. **Fixed in the review fix pass:** `unwrapAt` now keeps the container's trailing blank line on its last child, for every container. **`unwrapToggle` loses the blank line after a container.** `nodes/containers.ts` `unwrapAt` has this problem, reported by Task 10. Groups use Task 10's own `ungroupAt`, but toggles still go through `unwrapAt`.
3. **Fixed (2026-10-27): `fc0bff2`.** `editorExtensions` takes the registry-owned keys out of the built-in key maps (`withoutRegistryKeys` in `editor/document.ts`: StarterKit's mark and heading keys, the code block's Mod-Alt-c, the task list's Mod-Shift-9, the list items' Tab/Shift-Tab), and Tab/Shift-Tab in a list item go through the registry's `indentBlocks`/`unindentBlocks`; a changed registry key leaves no old key working (`editor/shortcuts.test.ts`). **StarterKit's own key bindings still fire** (Task 12). An example is Mod-Alt-1 for Heading 1. If the shortcut registry changes a key, the old StarterKit key keeps its action. Fixing this needs `document.ts` to configure StarterKit's keymaps off.
4. **Fixed (2026-10-27): `cddb70e`.** Hierarchy, quote, standout, colour and icon run on every selected block (`forEachTargetBlock`), and List makes the selected blocks one list (`withTargetSelection`), as Turn Into does (`editor/menus/BlockStyleMenu.test.tsx`, multi-block cases). **The block style menu acts only on the block at the cursor** (Task 8's `BlockStyleMenu`). The block menu and the shortcuts act on every selected block.
5. **The main column gets very narrow when the side panel opens** (seen in the walkthrough). With the property panel open, the editor column shrinks to about 150 px at a 1440 px window, because the side panel and the property panel both keep their widths. Capacities' behaviour here needs checking. Fixed (2026-10-27): 34693ce. The main column keeps 480 px, or 850 px (the 370 px property panel plus 480 px) while a Standard page shows its properties, never leaving the side panel under its 320 px minimum, so the side panel shrinks first. A Standard page narrower than 850 px puts its properties inline under the title (the card look). At 1440x900 with both panels open the content column went from 202 px to 752 px (side panel 500 to 320 px). The reference has no rule for this (its CSS only stacks property rows in its narrowest containers), so the widths and the inline fallback are our choice, for Gene's check.
6. **Fixed (2026-10-27): `5e63ef1`.** Not toggle-specific: Tiptap's task-list tokenizer read one line per item, so any to-do with a lazy (or indented) continuation line, and any quote with a lazy line, loaded raw. The to-do list's tokenizer now takes the list and item extents from marked's GFM list tokenizer (`editor/extensions/taskListMarkdown.ts`), and the loose content check ignores quote markers; the lazy line is part of the item's paragraph, and the file round-trips byte for byte (`editor/document.blocks.test.ts`, "lazy continuation lines"). **Lazy continuation in a toggle shows as a raw block** (seen in the walkthrough). In "Every block", the open toggle's `- [ ] Patch the hosts` is followed by the lazy continuation line `Details in [[Embedded target]].`. They show as one raw (monospace) block. This is byte-safe, but the toggle's children look like source.
7. **Fixed (2026-10-27): `b11a362`.** The math block renders each blank-line-separated part as its own KaTeX display row (`renderDisplayMath` in `editor/math/renderMath.ts`), except across an open `{` group or environment; the source bytes are unchanged. The trimmed reference has nothing on Capacities' handling, so Gene compares this in the hand-check. **A math block with a blank line inside renders as one line.** `E = mc^2`, a blank line, then `a^2+b^2=c^2` shows as `E=mc²a²+b²=c²`. KaTeX ignores the blank line. Compare with Capacities.

## Rules the build chose, for Gene to confirm

The lane agents chose these where the reference was silent:

- **Tabs:**
  - Ctrl+W does not close a pinned tab, but the right-click "Close tab" does.
  - The "Calendar today" start-up option opens the Calendar's Day view on today.
  - `navigateTabs` only moves forward.
- **Breadcrumbs:**
  - Following a link back to a page already on the trail cuts the trail at that page.
  - A link opened in a new tab carries the trail with it.
  - When the trail is longer than 3 crumbs it collapses behind a "…" button, labelled "Show hidden breadcrumbs" (our string).
- **Side panel:**
  - A plain click on a resolved wikilink inside an entry navigates the entry.
  - Swap works by click only; dragging an entry onto the main view is not built.
  - The calendar sidebar is 300 px wide.
- **Blocks:**
  - "Standout" is our label.
  - Small text is 0.9em.
  - A background block has 0.375rem padding.
  - The language list is ours.
  - Downloads are named `snippet.<ext>`.
  - The group padding, the 24px column gap and the 14rem grid track are ours.
  - "Remove style" keeps structural options.
  - Mod-a selects the block's siblings first, then the top level.
- **Look:**
  - The `--focus-ring` token is new.
  - The current search match uses `#fef08a99`.
  - The settings nav icons are Phosphor icons we chose.
  - Numeric dates use dashes or slashes as the option labels show.
  - The space icon is stored as a plain string (an Iconify id or an emoji), and its colour is not kept.
- **Spaces:**
  - "Space created. Switch to it now?", "Switch space", "Later" and "Folder path" are our strings.
  - A missing space can be removed from the list but not switched to.

## Gene's hand-run checks

Run these on his CPI copy outside the repo, with `git init` and a first commit done there first. None of them has been ticked by the build.

### File safety on real notes

- [ ] Opening the space changes no file.
- [ ] Notes with HTML comments, Mermaid fences and `$` signs keep their bytes: `git status` is clean after opening and scrolling every note.
- [ ] Editing one block changes only its lines (`git diff`).
- [ ] Opening and closing a toggle changes one line.
- [ ] Changing a block's colour or alignment changes only its annotation line, and removing the style removes that line.
- [ ] Turning the last paragraph of a note into a list, or adding a block at the very end, keeps the file's final newline. This is known issue 1 above. Check it after the fix pass.
- [ ] Uploading, pasting and dropping a file never overwrites an existing attachment.
- [ ] Removing a space from the list keeps its folder.

### Shortcut keys

- [x] The keys in Settings → Shortcuts were compared with Capacities' shortcut table (`reference-check-2026-10-28.md` §1) and corrected in `lib/shortcuts.ts`. Ids Capacities gives no key (headings, to-do, toggle, text alignment) have none and are left out of the sheet. "Unverified" now marks only Object's own keys (pen, highlighter, eraser).
- [ ] Hand-check the changed keys: side panel Ctrl+Shift+→, left sidebar Ctrl+Shift+←, calendar sidebar Ctrl+Alt+S, dark mode Ctrl+Shift+L, shortcuts menu Ctrl+Shift+B, tab menu Ctrl+Shift+↑, back/forward Ctrl+←/→ or Ctrl+[/], math Ctrl+M, code/math block Ctrl+E/Ctrl+M with blocks selected, move blocks Alt+↑/↓.

### Unverified designs, each against Capacities

- [ ] the side panel's area layout (and the narrow main column, issue 5)
- [ ] the breadcrumbs' position and look
- [ ] the look of pinned tabs
- [ ] the code preview's default ("Display")
- [ ] the column add and remove controls
- [ ] the PDF's default height
- [ ] the slash menu's grouping and look
- [ ] the block menu's look
- [ ] the rules listed under "Rules the build chose" above

### Interactions the headless walkthrough did not drive

- [ ] every block kind from the slash menu, and its menus
- [ ] the drag and `+` handles
- [ ] block selection and copy
- [ ] resizing columns
- [ ] a table's header row and header column
- [ ] a Mermaid diagram and a formula, in light and in dark
- [ ] an image resized with a caption
- [ ] a PDF, audio and video
- [ ] a file opened with the OS
- [ ] an embedded object switched between its four views
- [ ] files pasted and dropped
- [ ] tabs (persistent, pinned, the tab menu)
- [ ] breadcrumbs
- [ ] the side panel (Shift+click, three areas, resizing, swap, the calendar sidebar inside the Calendar)
- [ ] creating, renaming, switching and removing a space in the window (the launcher restarts on the same port)

### The final side-by-side fidelity pass, in dark and in light

Run every screen in Light and in Dark, and the shell and editor once each in Light Dimmed and Dark Dimmed. For each screen, note what differs (spacing, colour, label, behaviour) so one fix pass can follow.

- [ ] the app shell and sidebar (section headings, "+ New" and search, footer)
- [ ] the tab strip and tab menu
- [ ] breadcrumbs
- [ ] the side panel
- [ ] the object page in each layout (standard, profile, index card, encyclopedia)
- [ ] the peek, with its pager and property panel
- [ ] the `…` menus
- [ ] the editor (every block kind, the slash menu, handles, the block menu, block selection)
- [ ] the type page, Overview and All, in every view layout: list, grid, wall, table, embed, kanban, gallery
- [ ] the filter, sort and group-by popovers
- [ ] card settings
- [ ] collections and their pages
- [ ] queries and the Queries page
- [ ] All notes
- [ ] Trash
- [ ] Object Type Settings and the property menus
- [ ] the Calendar (Month, Week, Three days, Day, the mini month and the calendar sidebar)
- [ ] the Tasks page (list and kanban)
- [ ] the command palette, search and find in page (M5)
- [ ] the references section and the graph (M5)
- [ ] whiteboards and the pen (M6)
- [ ] the Settings modal (every section)
- [ ] the spaces menu and the create-space dialog
