# Object, Milestone 7: Remaining Blocks, Light Mode, Polish. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The last Object features that Object lacks, then a final side-by-side pass:
- **Every block option Object has**, written so that plain Markdown carries everything it can and a small comment annotation carries the rest: toggles, text and background colours, alignment, "Small" text, block icons, standout quotes, alphabetical and roman lists, groups, columns ("Two Columns", with a grid layout), simple tables with header row and header column, math (KaTeX, block and inline), code blocks with language, line wrap, lock and the Markdown and Mermaid previews, horizontal lines, embedded objects with their own view (Link block, Small card, Wide card, Embed), and media blocks (image, PDF, audio, video, file, web link).
- **The editor works like Object's:** the `/` menu with every block, object and date item, drag and `+` handles on every block, the block menu, block selection, and Object's block keyboard shortcuts.
- **Tabs and the side panel:** persistent (non-italic) and pinned tabs, the tab menu, breadcrumbs, and the three-area side panel with resizing, "Open in side panel", Shift+click and "Swap".
- **Light mode** (Light and Light Dimmed, plus Dark Dimmed) with tokens taken from Object's theme definitions; a **Settings modal** with every option that applies locally; **spaces** (create, open, switch, rename, remove from the list).
- **The final side-by-side fidelity pass** on every screen, in dark and light, recorded for Gene.

**Architecture:**
- **Four build lanes** (see "Build lanes"): **backend** (`backend/**`, Tasks 1–4), **editor** (`frontend/src/editor/**` plus `links/LinkPicker.tsx`, Tasks 6–12), **shell** (tabs, breadcrumbs, side panel, Tasks 13–15) and **look** (contract, light mode, settings, spaces, Tasks 5 and 16–18). Lanes own disjoint files (see "Shared files and ordering"); the frontend builds against the **API contract** below and mocks it in tests. **integrate** (Task 19) runs end to end.
- **Editor: one data layer, then parallel UI.** Task 6 (pure) parses the annotation syntax and groups the body's source blocks into a tree (leaves, annotated leaves, containers). Task 7 is the single owner of round-tripping: it defines every new node (schema, Markdown load and save, data-level commands) with plain rendering, extends `BlockSource` to nested blocks, and makes `serializeBody` recurse into containers. After Task 7 the four UI sub-lanes (styles and toggles then the slash menu and handles; code and math; tables and layout; media and embeds) each add node views and menus in files Task 7 created for them, never touching `document.ts`, `blocks.ts`, `preserve.ts` or `blockSource.ts`.
- **Back end:** attachments of every kind (serve with safe headers and HTTP ranges, import, list, open with the OS), `.object/space.json` (name, icon, description, hide task management), device settings and the spaces registry in per-user app data (beside M4's reminder ledger, never inside a space), and a launcher loop that restarts the server on another space when the UI switches.
- **Front end, outside the editor:** tabs gain `persistent`, `pinned`, per-step breadcrumbs and a per-tab side panel (Object's `TabEntry`); the theme becomes four token sets selected by `data-theme` on `<html>`; a Settings modal and a spaces menu use the new routes.

**Tech Stack:** as M6, plus these frontend dependencies, **installed up front in one commit before the build** (`cd frontend && npm install --save-exact katex@0.19.0 mermaid@12.1.0 @tiptap/suggestion@3.32.0 @tiptap/extension-code-block@3.32.0`, commit `chore(deps): katex, mermaid, tiptap suggestion and code block for M7` with the Co-Authored-By trailer). No M7 task edits `package.json`, `package-lock.json`, `pyproject.toml` or `uv.lock`.

| Package | Exact version | Why |
|---|---|---|
| `katex` | `0.19.0` (released 2026-10-01) | Math blocks and inline formulas (spec §3 "math (KaTeX)"). Ships its own types and fonts; `katex/dist/katex.min.css` is bundled by Vite, so nothing loads from the network. |
| `mermaid` | `12.1.0` (released 2026-10-02) | The Mermaid preview of code blocks (spec §3). Loaded with a dynamic `import('mermaid')` so it is code-split out of the main bundle; rendered with `securityLevel: 'strict'`. |
| `@tiptap/suggestion` | `3.32.0` | The `/` menu trigger, query tracking and keyboard handling. Must equal the installed `@tiptap/core` (3.32.0 today; at the reconcile pass, use whatever `@tiptap/core` is then). |
| `@tiptap/extension-code-block` | `3.32.0` | Already in the tree through `@tiptap/starter-kit`; listed as a direct dependency so Task 7 can extend `CodeBlock` (language, options, node view) instead of importing a transitive package. Same version rule as above. |

**No new Python dependencies.** HTTP range requests come from Starlette's `FileResponse` (1.9.0 here, ranges supported); opening a file with the OS uses `os.startfile` / `open` / `xdg-open`. **Considered and not added:** `@tiptap/extension-drag-handle(-react)` (it pulls in the collaboration and Yjs peers; Task 12's handle is ~150 lines over ProseMirror's own drag), `@tiptap/extension-mathematics` (our nodes need our annotation and byte rules), `pdfjs-dist` (WebView2 and Chromium display PDFs natively in an `<iframe>`), `react-resizable-panels` (one pointer-drag divider component serves the side panel, columns and embeds), `dompurify` (the Markdown preview renders through our own read-only editor, which never injects raw HTML; Mermaid sanitises in strict mode), a syntax highlighter (spec §3 asks for language, wrap and previews, not highlighting).

**Spec:** `docs/superpowers/specs/2026-10-23-object-design.md` §3 (Blocks), §4 (body rules: plain Markdown first, a small inline annotation for options Markdown can't hold, files read cleanly in any editor, saving never rewrites parts that weren't edited; `space.json` "space name, icon, settings"), §5 (light mode from the shipped CSS; slash menu and drag handles, tabs with breadcrumbs, the three-area side panel, hover states and keyboard shortcuts; "the test: side by side, the same app"), §2 (spaces; settings that apply locally).
- **Reference paths.** In a clone read the trimmed, tracked `reference/` (Gene's full app is the git-ignored `.reference/`, same sub-paths):
  - Block model: `docs/design-notes` (`TextBlock` hierarchy `Base | S | H1–H4`, `list.type` `bullet | alphabetical | numerical | roman`, `toggle.isOpen`, `quote.layout` `normal | standout`, `textAlignment`, `icon`, `colorTheme`; `CodeBlock` `lang`, `previewMode` `edit | display`, `lineWrapping`, `lockEditing`; `MathBlock`; `HorizontalLineBlock`; `GroupBlock`; `GridBlock` `columns`, `dividers`, `gridLayout` `columns | grid`; `SimpleTableBlock` `hasHeaderRow`, `hasHeaderColumn`; `EntityBlock` with `EmbedViewConfig` `width`, `height`, `alignment`, `caption`).
  - Colours: `docs/design-notes` (the 18 `themeColors`, `text-<c>` and `bg-<c>` themes); **theme tokens:** `docs/design-notes` (the four themes `light`, `lightDimmed`, `dark`, `darkDimmed`: `ui` tokens, `code` tokens, `content` colours and the `grayToneMappings`/`colorToneMappings`) and `docs/design-notes` (the oklch scales). `design.css` does **not** define `--bg-base` and its siblings (the app sets them from `themes.ts` at run time), so the theme values come from `themes.ts` + `colors.ts`; the CSS gives spacing and block styles (grep `.editor-prose`, `--ep-`, `.quote>`, `.block-outer`, `toggle-outline-color`, `bg-block-selection`, `.col-`).
  - Tabs and side panel: `docs/design-notes` (`TabEntry`: `persistent`, `pinned`, `breadcrumbs: string[][]`, `sidepanel: SidepanelEntry[]`, `sidepanelLayout {area2Size, area3Size}`, `hideSidepanel`; `SidepanelEntry`: `id`, `isOpen`, `panelArea: 'area1'|'area2'|'area3'`, `isPersistent`), `component.model.ts` (`RootSpaceData.calendar.hideCalendarSidebar`, `hideTaskManagement`).
  - **en-US strings:** `docs/strings.txt` (compiled message ASTs; flatten once with a throwaway script outside the repo and grep). Groups to read: `blocks.*`, `blocksMenu.*`, `BlockMenu.*`, `ControlDropdown.*`, `CreateDropdown.*`, `RenderBlock.*`, `ResizableEmbed.*`, `tokensMenu.*`, `styles.*`, `colorThemes.*`, `colors.*`, `structureViewTypes.*`, `pasteInput.*`, `EntityMenu.*`, `EntityPicker.upload*`, `RenderImage.*`, `SpaceTab.*`, `SpaceHeader.*`, `RenderSidepanel.*`, `CrossSurfaceTabDrag.*`, `CalendarDaily.sidebar.*`, `AppSettings.*`, `AppearanceSettings.*`, `ThemeMenu.*`, `EditorSettings.*`, `DateAndTimeSettings.*`, `NotificationsSettings.*`, `CurrentSpaceSettings.*`, `SpaceDashboard.general.*`, `StructureGeneralSettings.*`, `StructureSettings.*`, `TaskManagementSettings.*`, `SpacesMenu.*`, `SpaceOverview.*`, `OnboardingSpace.*`, `components.RootSpace.*`, `MultiSpacePicker.*`, `ShortcutsCheatSheet.*`, `shortcuts.*`, `general.*`. Every quoted string below is verbatim from it unless marked "our string".
  - Visual: `docs/` (01, 02, 04, 05, 06 and the README's descriptions, including the Settings modal of `03-settings-account.png`, which is described there but not committed because it shows an email address), `docs/design-notes` §7.
  - **Not in the trimmed set:** the shortcut key bindings (they live in the renderer bundle, not in the strings file; the strings give only the shortcut ids, names and categories), the code-editor language list (`util/codeEditor.js`), and any screenshot of light mode, the side panel, breadcrumbs, the slash menu or the block menu. Where this plan needs them it says "unverified" and lists the item for Gene's check; the shortcut keys are collected in one registry so they can be corrected in one place (Global Constraints, "Shortcut keys").

## Roadmap (one plan per milestone)

| M | Delivers |
|---|---|
| 1 (built) | shell, objects on disk, page + peek, block editor with byte preservation, wikilinks, external changes |
| 2 (built) | object types and all property kinds, type settings and page layouts, title edit and relink, change type, templates, tags as objects, trash |
| 3 (built) | views, filters, sorts, group-by, collections, queries, pinned, All notes |
| 4 (built by the time M7 builds) | calendar, daily notes, tasks, recurrence, reminders |
| 5 (built by the time M7 builds) | SQLite FTS index, Ctrl+K palette, find in page, references and backlinks, global and local graph |
| 6 (built by the time M7 builds) | whiteboards and pen |
| **7 (this plan)** | remaining blocks and the annotation syntax, slash menu, handles, block selection, editor shortcuts; persistent and pinned tabs, breadcrumbs, the three-area side panel; light mode; the Settings modal; spaces; the final side-by-side pass |

## Global Constraints

**Carried forward from M1–M6** (all of them, unchanged):
- **Server and toolchain:** `127.0.0.1` only (default port 8790), no outbound network from the server, Python `>=3.13` with uv, Node `>=22`. Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Never write on read.** Opening a space, any GET, listing attachments, reading settings and the spaces list write nothing inside the space. Property edits change only their own lines. Deletes go to the trash and are restorable. Writes are atomic and keep CRLF/BOM and the trailing-newline state. Destructive confirmations use 428. Every route that writes an object announces `ChangeEvent(origin=clientId)` for each path it wrote.
- **Byte preservation of untouched blocks is sacred** (M1's `editor/preserve.ts`, `editor/blocks.ts`, `editor/document.ts`, `editor/extensions/blockSource.ts`): loading a body and saving it without an edit gives the identical bytes; an edit changes only the lines of the blocks it touched; an unedited block is emitted byte for byte, whatever kind it is, including every annotation line and every container line around it. M7 adds kinds of blocks, never a way to rewrite one that wasn't edited. Undoing an edit restores the original bytes; moving a block keeps its bytes.
- **Definition files and `ui.json`** follow M3/M4: `JsonStore`/`uistate.patch_ui`, revisions, 409 on a stale `baseRevision`, 423 on an unreadable file (never replaced), `PUT /api/ui` accepts only `server.py`'s `_UI_PATCH_KEYS` and checks shapes in `_ui_problem`.
- **Per-user app data, never the space,** holds machine state: M4's reminder ledger, and now device settings and the spaces registry (Storage table). `OBJECT_STATE_DIR` overrides the folder in tests and acceptance.
- **Tests:** baseline is this branch after M6's integration and final gate (the reconcile pass records the counts). Every task keeps all earlier tests green. A test that passes before its task's code exists is labelled "regression guard (green from the start)". Backend tests use the synthetic `space-blocks` space (Task 1) or `tmp_path`, never assert absolute fixture counts, and set `OBJECT_STATE_DIR` to a temp folder. Frontend tests mock `api` (`test/mockApi.ts`) and `mermaid`.
- **Fidelity.** Labels, icons, option keys, defaults and orders come from the reference extract. A string marked "our string" has no Object original; every other quoted string must be found verbatim in `strings.txt`. A Object string that names "Object" or a cloud feature is adapted and marked "our string, adapted from `<key>`".
- **Out of scope** (spec §2): accounts, sync, sharing and publishing, AI, telemetry, integrations, mobile.

**New in M7**
- **Start condition.** M4, M5 and M6 are built and integrated on this branch. This plan was written on 2026-10-26 against the code at `a8e0d7f` (M4 mid-build) and the M4 plan; **a reconcile pass must run before the build** (see "Reconcile before building") and correct names, files and the test baseline to what M4–M6 actually built.
- **Annotation syntax** (spec §4: "the annotation syntax is the builder's choice"; this plan fixes it so every task agrees). An annotation is an **HTML comment on a line of its own**. Markdown renderers (GitHub, VS Code, Obsidian) hide comments, so the file reads as ordinary Markdown in any editor: toggle children show expanded, columns show stacked, colours are simply absent.

  ```
  <!-- block: color=bg-blue align=center -->       leaf options: styles the block on the very next line (no blank line between)
  ## Rollout notes

  <!-- toggle open -->                             container open; the first block inside is the toggle's own line,
  ### Server checklist                             the rest are its children
  - [ ] Patch the hosts
  Details in [[Runbook]].
  <!-- /toggle -->                                 container close

  <!-- columns widths=40,60 -->                    columns: blocks of column 1, then each "<!-- column -->" starts the next
  Left side text.
  <!-- column -->
  Right side text.
  <!-- /columns -->

  <!-- group color=bg-gray -->                     group: a box around its blocks
  Box heading
  Body of the box.
  <!-- /group -->

  $$                                               math block (plain Markdown, as GitHub and Obsidian read it)
  E = mc^2
  $$

  <!-- block: width=480 caption="Rack layout" -->  media and embeds keep their view settings in a leaf annotation
  ![rack](Attachments/rack.png)
  ![[Attachments/Quarterly report.pdf]]            PDF, audio, video and other files: an embed line naming the attachment
  <!-- block: view=wideCard -->
  ![[Ada Lovelace]]                                an embedded object (any line that is exactly ![[Title]] and not a media file)
  <!-- block: bookmark -->
  [Proxmox docs](https://pve.proxmox.com/wiki)     a web link block: an annotated line holding exactly one link
  ```

  **Grammar.** An annotation line is up to 3 spaces of indent, `<!--`, a body, `-->`, optional trailing spaces or tabs, then the line end (or end of file). The body is read after stripping `<!--` and `-->`, so spaces around it are optional (`<!--block:color=bg-red-->` is valid). Bodies: `block:` followed by options (a leaf annotation); `toggle`, `group` or `columns` followed by options (open); `column` (separator); `/toggle`, `/group`, `/columns` (close). Options are separated by whitespace; each is `key` (a flag) or `key=value`; a key is `[a-z][a-zA-Z0-9-]*`; a value is bare (`[A-Za-z0-9_.,:#/+-]+`) or double-quoted (`"…"`, with `\"` and `\\` escapes, no line break). Container and `block:` names are matched case-insensitively; keys and values are case-sensitive.

  | Option | Value | Applies to | Object field |
  |---|---|---|---|
  | `small` | flag | paragraph | `hierarchy: S` |
  | `color` | `text-<c>` or `bg-<c>`, `<c>` one of the 18 theme colours | paragraph, heading, list, blockquote, math block, group, columns | `colorTheme` |
  | `align` | `center` or `right` (left is the default and is never written) | paragraph, heading, math block, group, image, PDF, video, object embed | `textAlignment`; `embedViewConfig.alignment` (`start/center/end` map to `left/center/right`) |
  | `icon` | an Iconify id (`ph-star`) or an emoji (quoted when it is not a bare value) | paragraph, heading | `icon` |
  | `quote` | `standout` | blockquote | `quote.layout` |
  | `list` | `alphabetical` or `roman` | ordered list (the whole list block, nested items included) | `list.type` |
  | `wrap`, `lock` | flags | code block | `lineWrapping`, `lockEditing` |
  | `preview` | `edit`, `split` or `display` | code block in `markdown` or `mermaid` | `previewMode` (`split` is "Edit & Display") |
  | `header-column`, `no-header-row` | flags | table | `hasHeaderColumn`, `hasHeaderRow: false` |
  | `width`, `height` | integer pixels | image, PDF, video, object embed (`embed` view) | `embedViewConfig.width/height` |
  | `caption` | quoted text | image, PDF, video, audio, file | `embedViewConfig.caption` |
  | `view` | `inline`, `smallCard`, `wideCard`, `embed` | object embed | the block's view type ("Link block", "Small card", "Wide card", "Embed") |
  | `bookmark` | flag | a paragraph holding exactly one link | the web link block |
  | `open` (container) | flag | toggle | `toggle.isOpen` (absent = closed) |
  | `color`, `align` (container) | as above | group | `colorTheme`, `textAlignment` |
  | `widths`, `layout`, `color` (container) | `widths=40,60` (integers summing to 100, one per column); `layout=grid` | columns | `dividers`, `gridLayout`, `colorTheme` |

  **Rules (the byte contract).**
  1. An unedited block, annotation or container is emitted exactly as read, whatever spelling it used.
  2. Changing a block's options rewrites only its annotation line, in canonical form (`<!-- block: ` + options in the table's order, unknown options after them in their original order, + ` -->`), with the document's line ending. Removing the last option removes the line and nothing else. Adding the first option inserts one line directly above the block.
  3. An unknown option or an unknown value of a known option is kept and re-emitted, never applied, never dropped.
  4. A leaf annotation followed by a blank line, or followed by a block it doesn't apply to, stays an ordinary HTML comment (M1's raw block). A container open line without a matching close (or a close without an open, or nesting deeper than 8) leaves every line of it as ordinary blocks. An unknown container name (`<!-- callout -->`) is an ordinary comment. Malformed input never loses a byte.
  5. Inside a container each child block follows rules 1–4 by itself: editing one child rewrites that child's lines only; the open, separator and close lines are kept as read unless their own options changed.
  6. Inline formulas are `$…$` (Pandoc's rule: the opening `$` is followed by a non-space, the closing `$` is preceded by a non-space and not followed by a digit; `\$` is a literal dollar; `$$` never starts an inline formula). A math block starts with a line that begins with `$$` (up to 3 spaces of indent) and ends at the next line that ends with `$$`; blank lines inside are part of it. `$$x$$` alone on a line is a one-line math block.
  7. Embeds: a paragraph whose whole text is one `![alt](src)` is an image block; one `![[target]]` (or `![[target|label]]`) is a media block when the target's extension is a media or file extension (Task 2's kinds; a target with any extension other than `.md` counts), otherwise an object embed. Anything else stays a paragraph.
- **Storage.**

  | What | Where | Written by |
  |---|---|---|
  | Block options | annotation lines in the body (above) | the editor's body save (M1 `PUT /api/object/body`) |
  | Attachments | `Attachments/<safe name>.<ext>` (M2's folder for images; now any kind; `name (2).ext` when taken, never overwritten) | `POST /api/attachments` |
  | Space name, icon, description, hide task management | `.object/space.json` keys `name`, `icon`, `description`, `hideTaskManagement` (spec §4; absent file = folder name and defaults; never written on open; other keys in the file kept) | `PUT /api/space` |
  | Device settings (theme, font, editor and date options, start-up choices) | `<state dir>/settings.json` | `PUT /api/settings` |
  | Spaces registry | `<state dir>/spaces.json`: `{"spaces": [{"path", "lastOpened"}], "lastOpened": path}` (registry only; folders are never deleted) | the launcher at start-up and the `/api/spaces*` routes |
  | Calendar sidebar open/closed | `.object/ui.json` key `calendar.hideCalendarSidebar` (Object's `RootSpaceData.calendar` key; M4's `calendar` object gains it) | `PUT /api/ui` |
  | Week start, reminders on/off | M4's `ui.json` keys `calendar.weekStart` and `reminders.enabled` (the Settings modal edits them) | `PUT /api/ui` |
  | Tabs (persistent, pinned, breadcrumbs, side panel per tab), recent | `localStorage`, keyed per space root (`object.tabs:<root>`, `object.recent:<root>`); Object keeps tabs in local navigation too (`RootSpaceData.tabs` is deprecated "Copied into local navigation") | the client |
  | Theme for first paint | `localStorage` `object.theme` (a cache of the device setting) | the client |

  `<state dir>` is `OBJECT_STATE_DIR` when set, else `%LOCALAPPDATA%/object` on Windows, else `~/.local/state/object` (M4's ledger folder; Task 3 makes `appstate.state_dir()` its single owner).
- **Theme tokens.** Our dark tokens stay the screenshot-measured values in `theme/tokens.css` (unchanged bytes for every existing token). Light, Light Dimmed and Dark Dimmed are computed from `themes.ts` + `colors.ts` with this mapping (Task 16 computes the values with a throwaway script outside the repo and commits only the CSS):

  | Our token | Object token | Light | Light Dimmed | Dark Dimmed |
  |---|---|---|---|---|
  | `--bg-app` | `bg-back` | gray 50 | gray 100 | gray 900 |
  | `--bg-panel` | `bg-base` | gray 0 | gray 25 | gray 850 |
  | `--bg-raised` | `bg-front` | gray 0 | gray 0 | gray 825 |
  | `--bg-raised-2` | `bg-el` | gray 100 | gray 125 | gray 725 |
  | `--bg-hover` | `bg-front-hover` | gray 50 | gray 50 | gray 775 |
  | `--bg-hover-2` | `bg-el-hover` | gray 150 | gray 150 | gray 700 |
  | `--border-subtle` | `border-front` | gray 200 | gray 200 | gray 725 |
  | `--border-chrome` | `color-mix(in srgb, border-front 80%, bg-back)` | computed | computed | computed |
  | `--text` | `text-primary` | gray 900 | gray 750 | gray 200 |
  | `--text-muted` | `text-subtle` | gray 500 | gray 450 | gray 450 |
  | `--primary-btn` / `--primary-btn-text` (new) | `bg-button-primary` / `text-button-primary` | gray 700 / gray 100 | gray 675 / gray 125 | gray 200 / gray 800 |
  | `--text-section` (new; dark `#a7a2a1`, the sidebar section headings) | `text-subtle` | gray 500 | gray 450 | gray 450 |
  | `--chrome-btn-border` (new; dark `#2a292d`, the "+ New" and search buttons) | `border-el-subtle` | gray 200 | gray 200 | gray 700 |
  | `--block-selection-bg` / `--block-selection-border` / `--text-selection-bg` (new) | `bg-block-selection` / `border-block-selection` / `bg-text-selection` | `#4494f748` / blue 400 / `#4494f748` | same | dark's `#5090dd3a` / blue 400 / `#5090dd3a` |
  | `--editor-bullet`, `--editor-bullet-nested`, `--editor-quote-line`, `--editor-hr`, `--editor-toggle`, `--editor-toggle-empty`, `--editor-toggle-outline` (new; dark = today's `#e4e3e2`, `#7c7c7d`, `#4e4b4c`, `--border-subtle`, and `content.*` dark values) | `content.bulletColor`, nested bullet (our: `text-subtle`), `quoteLineColor`, `horizontalLineColor`, `toggleColor`, `toggleColorEmpty`, `toggleOutlineColor` | from `content` | from `content` | from `content` |
  | `--code-bg`, `--code-border`, `--code-text` (new) | `code.code-bg`, `code-border`, `code-text` | gray 25 / 200 / 900 | from `lightDimmed.code` | from `darkDimmed.code` |
  | `--type-<c>-fg` / `--type-<c>-bg` | type label text / bg | colour 650 / 75 (gray 700 / 50) | from mappings | from mappings |
  | `--tag-bg-<c>` / `--tag-text-<c>` | `tagBg` / `tagText` | 100 / 800 | from mappings | from mappings |
  | `--label-bg-<c>` / `--label-text-<c>` / `--label-border-<c>` / `--line-<c>` | `blockBg` / `tokenText` / `typeLabelBorder` / `bulletColor` | 50 / 500 (gray 600) / 300 / 500 | from mappings | from mappings |

  Block colours in the editor use the label tokens: `text-<c>` is `color: var(--label-text-<c>)`, `bg-<c>` is `background: var(--label-bg-<c>)` (Object's `blockText`/`blockBg`, which our dark `--label-*` values already are). `--accent-today` and `--danger` are the same in every theme. `color-scheme` is `light` for the light themes.
- **No raw colour literals** (hex, `rgb()`, `oklch()`) in `frontend/src/**/*.{ts,tsx,css}` outside `theme/`; every component uses tokens. Task 16 adds the test; a file with a content palette (for example M6's whiteboard shape colours) opts out with a first-line comment `/* colour-literals: content palette */` (or `//` in TS), listed in the test's allowlist at the reconcile pass.
- **Shortcut keys.** One registry, `lib/shortcuts.ts` (Task 5), holds every shortcut by its Object id (`heading1`, `toggleDarkMode`, …), its category (`shortcuts.categories.*`), its name (`shortcuts.<id>.name`) and its keys. **The keys are not in the trimmed reference.** The keys in this plan are **provisional** (marked so in the registry); before the build, whoever has `.reference/` (Gene's machine, or the reconcile pass there) greps the renderer bundle for the ids, adds that single bundle file under `reference/` at the same relative path (as `CONTINUE.md` allows), and corrects the table in `lib/shortcuts.ts` and below. Gene confirms them in the hand-check.

  | Id (category) | Provisional keys |
  |---|---|
  | `bold`, `italic`, `underline`, `strikethrough`, `codeToken`, `mathToken` (text) | Mod-b, Mod-i, Mod-u, Mod-Shift-s, Mod-e, Mod-Shift-m |
  | `heading1`–`heading4` (block) | Mod-Alt-1 … Mod-Alt-4 |
  | `toDo`, `toggle`, `toggleCodeBlock`, `toggleMathBlock` (block) | Mod-Alt-t, Mod-Alt-g, Mod-Alt-c, Mod-Alt-m |
  | `textAlignLeft`, `textAlignCenter`, `textAlignRight` (block) | Mod-Shift-l, Mod-Shift-e, Mod-Shift-r |
  | `selectActiveBlock`, `expandBlockSelectionUpwards/Downwards`, `selectAllBlocks` (block) | Escape, Shift-ArrowUp/Shift-ArrowDown (while blocks are selected), Mod-a (twice) |
  | `deleteBlocks`, `duplicateBlocks`, `copyBlocksAsMarkdown`, `moveSelectedBlocksUp/Down`, `indentBlocks`, `unindentBlocks` (block) | Backspace/Delete, Mod-d, Mod-Shift-c, Mod-Shift-ArrowUp/Down, Tab, Shift-Tab |
  | `toggleTodoInBlockWithCursor`, `toggleToggleInBlockWithCursor` (block) | Mod-Enter, Mod-Shift-Enter |
  | `insertBlockAbove`, `insertBlockBelow` (block) | Alt-Shift-Enter, Alt-Enter |
  | `closeTab`, `openNewTab`, `navigateTabs`, `openTabList` (navigation) | Mod-w, Mod-t, Ctrl-Tab, Mod-Shift-a |
  | `navigateBack`, `navigateForward` (navigation) | Alt-ArrowLeft, Alt-ArrowRight |
  | `toggleSidepanel`, `toggleLeftSidebar`, `toggleCalendarSidebar` (global) | Mod-Shift-\\, Mod-\\, Mod-Shift-y |
  | `toggleDarkMode`, `openSettings`, `toggleShortcutsMenu` (global) | Mod-Shift-d, Mod-, (comma), Mod-/ |

  These avoid M1–M4's bindings (Ctrl+U, Ctrl+N, Ctrl+Backspace outside the editor; Tiptap's defaults inside it). A key that collides with an M5/M6 binding found at the reconcile pass is changed here first.
- **Not in M7** (recorded so they are not built by accident): block references and "Copy block reference" (`BlockMenu.copyBlockReference.*`); inline text colour and highlight marks (`tokensMenu.color.*`: M7 colours whole blocks, `ControlDropdown.custom.block_color_*`); indenting non-list blocks (`tokensMenu.indent.*` applies to list items only); a list item's own annotation (options apply to the whole list block); table formulas, sorting and CSV export (`blocks.simpleTable.formulas.*`, `sortColumn*`, `export`); "Turn into object/task" (`shortcuts.turnIntoObject`, `turnBlockIntoTaskObject`); web embeds, iframes and bookmark metadata fetching (`blocks.BookmarkBlock.dataProtection.*`, `pasteInput.embed`; no network); audio recording and transcription; Mermaid AI and PNG/SVG export; embedding collections or queries as data views (they are not Markdown objects in our model); code syntax highlighting; "Start with basic setup" and onboarding (`OnboardingSpace.howToStart.basicSetup.*`); deleting a space folder (`DeleteHandler.space.*`: Object only removes a space from its list); language, decimal separator and time-zone settings (English only; the system zone, as M4); presentation and focus modes; version history; anything AI.

## API contract (M7): shared by all lanes

```
AttachmentKind = 'image'|'pdf'|'audio'|'video'|'file'
Attachment     { path: string, kind: AttachmentKind, size: number }
SpaceInfo     += { icon: string|null, description: string|null, hideTaskManagement: boolean, revision: string }   /* name: space.json name, else the folder name */
DeviceSettings {
  themeMode: 'light'|'dark'                          /* default 'dark' (ThemeMenu.options.*) */
  lightTheme: 'light'|'lightDimmed'                  /* default 'light' */
  darkTheme: 'dark'|'darkDimmed'                     /* default 'dark' */
  font: 'sans-serif'|'serif'|'monospace'             /* default 'sans-serif' (AppearanceSettings.font.*) */
  monochromeTags: boolean; monochromeTypeLabels: boolean            /* default false */
  toggleStyle: 'toggle'|'bullet'                     /* default 'toggle' (EditorSettings.toggleStyle.*) */
  disableNumberedListTransformation: boolean; disableSpellcheck: boolean; alwaysOpenAsFullPage: boolean;
  hideEntityIconsOnInlineLinks: boolean; hideOutlinerLines: boolean                                /* default false */
  twentyFourHourTime: boolean                        /* default false (today's display) */
  dateFormatting: 'localized'|'DMY'|'MDY'|'YMD'      /* default 'localized' */
  openOnStart: { [spaceRoot: string]: { mode: 'lastOpenedPage'|'today'|'calendar'|'specificObject', path?: string } }   /* default {} = lastOpenedPage */
  startupSpace: 'lastOpened'|'specific'; startupSpacePath: string|null                            /* default 'lastOpened', null */
}
SpaceEntry     { path: string, name: string, icon: string|null, current: boolean, missing: boolean, lastOpened: string|null }
UiState.calendar += { hideCalendarSidebar?: boolean }
```

| Route | Request | Success | Errors |
|---|---|---|---|
| `GET /api/attachments` | | `Attachment[]` (every file under the space outside dot-folders whose kind is not `file`, plus everything under `Attachments/`), sorted by path | |
| `POST /api/attachments?name=` | raw bytes | 201 `{path, kind}` (`Attachments/<safe name>.<ext>`, ` (2)` when taken) | 413 over 100 MiB (detail: `EntityPicker.uploadLimitSize`), 422 empty or unusable name |
| `GET /api/file?path=` (extended from M2's images) | | images as M2 (CSP `sandbox`); `pdf` `application/pdf` inline; `audio`/`video` their type, inline, with `Accept-Ranges` and 206 for a `Range`; every other file `application/octet-stream` with `Content-Disposition: attachment`; all with `X-Content-Type-Options: nosniff` | 404 (missing, outside the space, in a dot-folder) |
| `POST /api/attachments/open` | `{path}` | `{ok: true}` (opened with the OS default app) | 404 as above; 415 for executable or script extensions, detail "Open it from the file manager instead." (our string) |
| `GET /api/space` (extended) | | `SpaceInfo` with the new fields | |
| `PUT /api/space` | `{patch: {name?, icon?, description?, hideTaskManagement?}, baseRevision, clientId?}` | `SpaceInfo` | 409 stale, 422 empty/over-long name or wrong type, 423 unreadable `space.json` |
| `GET /api/settings` | | `{settings: DeviceSettings, revision}` (defaults merged; a missing file is not created) | 423 unreadable |
| `PUT /api/settings` | `{patch: Partial<DeviceSettings>, baseRevision}` | `{settings, revision}` | 409 stale, 422 unknown key or wrong shape, 423 |
| `GET /api/spaces` | | `{spaces: SpaceEntry[]}` (registry order; the current space is always listed) | |
| `POST /api/spaces` | `{name, location}` | 201 `{path}` (creates `<location>/<safe name>/.object/space.json` with `{"name": name}` and registers it) | 409 the folder exists, 422 bad name, 404 `location` is not a folder |
| `POST /api/spaces/open` | `{path}` | `{path}` (registers an existing folder) | 404 not a folder |
| `DELETE /api/spaces?path=` | | `{ok: true}` (removes from the registry only) | 409 it is the current space |
| `POST /api/spaces/switch` | `{path}` | 202 `{path}`; the launcher then restarts the server on that space on the same port | 404 not a folder; 503 "Switching spaces needs the Object launcher." (our string) when the app runs without the launcher |
| `PUT /api/ui` (extended) | `calendar.hideCalendarSidebar: boolean` accepted | as M4 | as M4 |

- **Test hooks (server).** Ignored unless set: `OBJECT_FAKE_OPEN_FILE` (Task 2: the "open with the OS" call appends the absolute path to this file instead of launching anything), plus M4's `OBJECT_STATE_DIR`.
- **Client:** `api.attachments()`, `api.uploadAttachment(blob, name)`, `api.openAttachment(path)`, `api.fileUrl(path)` (M2's, now for every kind), `api.patchSpace(patch, {baseRevision})`, `api.settings()`, `api.patchSettings(patch, {baseRevision})`, `api.spaces()`, `api.createSpace(name, location)`, `api.openSpace(path)`, `api.removeSpace(path)`, `api.switchSpace(path)`.

## Review Focus

1. **Untouched bytes stay untouched, annotations included.** Loading and saving any body without an edit is byte-identical (CRLF, BOM, no trailing newline, hand-written annotation spellings, malformed annotations, unknown options and containers); an option change rewrites only its annotation line; editing a child inside a container rewrites only that child; undo restores the bytes; moving a block keeps its bytes.
   - *(Task 6: `test every fixture body groups and joins back byte for byte`, `test lenient spellings parse and keep their text`, `test malformed containers fall back to plain blocks`, `test detached annotation stays a comment`, `test math block spans blank lines`; Task 7: `test no-edit save is byte identical for every fixture`, `test option change rewrites only the annotation line`, `test removing the last option removes only its line`, `test edit inside a toggle rewrites only that child`, `test undo restores original bytes`, `test moving a block keeps its bytes`, `test unknown options survive an edit`, `test CRLF document inserts CRLF annotation lines`; Task 19: the round-trip harness over every acceptance space)*
2. **The annotation syntax is the one in Global Constraints, and it reads cleanly.** Canonical writing order, quoting and escaping, case rules, the option table per block kind, the container shapes, the embed and inline-math rules.
   - *(Task 6: `test canonical format orders options and quotes values`, `test caption with quotes and backslashes round trips`, `test inline math follows Pandoc dollar rules`, `test embed line rules pick image, media or object embed`)*
3. **Opening writes nothing, inside the space or out.** `GET /api/space`, `/api/settings`, `/api/spaces`, `/api/attachments` and `/api/file` change no file; a missing `space.json` or `settings.json` is not created by a read; start-up writes only the registry in the state dir.
   - *(Task 2: `test_listing_and_serving_write_nothing`; Task 3: `test_get_space_and_settings_write_nothing`, `test_space_json_absent_reads_folder_name`; Task 4: `test_startup_writes_only_registry_outside_space`)*
4. **File safety for attachments and spaces.** Paths stay inside the space (no `..`, absolute, drive-letter or dot-folder paths); an HTML or SVG attachment can never run in the app's origin; uploads never overwrite; opening refuses executables; creating a space never touches an existing folder; removing a space never deletes a folder; a switch is refused for a non-folder.
   - *(Task 2: `test_file_route_rejects_traversal_and_dot_folders`, `test_html_attachment_served_as_download`, `test_svg_keeps_sandbox_csp`, `test_upload_never_overwrites`, `test_open_refuses_executables`, `test_range_request_206`; Task 4: `test_create_space_refuses_existing_folder`, `test_remove_space_keeps_folder`, `test_switch_rejects_non_folder`)*
5. **Space switching is clean.** Pending editor saves are flushed before the switch; the launcher restarts on the new space on the same port; tabs and recent items are per space, so the old space's tabs never open paths in the new one.
   - *(Task 4: `test_host_restarts_on_new_space`; Task 13: `test tabs are stored per space root`, `test old global tabs key migrates to the current space once`; Task 18: `test switch flushes editors, posts switch, waits for the new root and reloads`)*
6. **Light mode is complete and faithful.** Every token has a value in all four themes, the values follow the mapping table, no component carries a raw colour, Mermaid follows the theme, the first paint uses the cached theme.
   - *(Task 16: `test every dark token is defined in every theme`, `test light token values follow themes.ts`, `test no raw colour literals outside theme files`, `test theme attribute and dark class follow settings`, `test first paint applies the cached theme`; Task 9: `test mermaid rerenders on theme change`)*
7. **Tabs and the side panel behave as Object documents them.** Non-persistent tabs are italic and navigate in place; in a persistent tab any new page opens a new tab; double-click toggles; pinned tabs stay first; breadcrumbs follow in-page navigation; Shift+click and "Open in side panel" fill area 1; areas resize and persist per tab; "Swap" exchanges with the main view.
   - *(Task 13: `test persistent tab opens new pages in a new tab`, `test double click toggles persistent`, `test pinned tabs sort first and have no close button`; Task 14: `test link navigation extends the trail and sidebar navigation resets it`, `test clicking a crumb goes back to it`; Task 15: `test shift click opens in side panel area 1`, `test areas resize and persist per tab`, `test swap exchanges side panel entry and main target`)*
8. **It reads the same as Object.** Slash menu sections and items, block menu, colour names, table and embed menus, settings sections and every quoted string match the reference; provisional shortcut keys are listed for Gene.
   - *(Task 8: `test colour menu lists 18 text and 18 background colours with reference names`; Task 12: `test slash menu sections and item names match reference`; Task 17: `test settings nav groups and section headings match reference`; Task 19 Step 5)*

---

## File Structure

```
backend/objectapp/  appstate.py spaceconfig.py settings.py spaces.py                                   NEW
                    media.py rows.py server.py space.py reminders.py __main__.py                       MOD
backend/tests/      fixtures/space-blocks/   conftest.py (MOD: `blocks_space_dir`)
                    test_{fixtures_m7,attachments,spaceconfig,settings,appstate,spaces,spacehost}.py
scripts/m7_acceptance.py
frontend/index.html                                                                                    MOD (Task 16)
frontend/src/main.tsx  api/{types,client}.ts  test/mockApi.ts                                           MOD (Task 5 only)
frontend/src/lib/{shortcuts,flush}.ts  settings/useSettings.ts  shell/GlobalOverlays.tsx               NEW (Task 5)
frontend/src/editor/  annotations.ts blockTree.ts                                                      NEW (Task 6)
                      blocks.ts                                                                         MOD (Task 6)
                      document.ts extensions/blockSource.ts preserve.ts (only if needed) editor.css      MOD (Task 7; editor.css then Task 8)
                      nodes/{blockOptions,toggle,group,columns,mathBlock,inlineMath,codeBlock,media,objectEmbed,bookmark}.ts
                      nodes/*.css  extensions/{slashMenu,blockSelection,fileDrop}.ts                    NEW (Task 7), then each one task (table below)
                      menus/{BlockStyleMenu.tsx,colors.ts}                                              NEW (Task 8)
                      code/{CodeBlockView.tsx,MermaidPreview.tsx,MarkdownPreview.tsx,languages.ts}
                      math/{MathBlockView.tsx,InlineMathView.tsx,renderMath.ts}                         NEW (Task 9)
                      table/{TableMenu.tsx,tableCommands.ts,table.css} layout/{ColumnsView.tsx,GroupView.tsx,Divider.tsx}   NEW (Task 10)
                      media/{MediaView.tsx,ResizableEmbed.tsx,upload.ts} embed/ObjectEmbedView.tsx       NEW (Task 11)
                      slash/{SlashMenu.tsx,slashItems.ts} handles/{BlockHandles.tsx,BlockMenu.tsx,dragMove.ts,handles.css}
                      shortcuts.ts  Editor.tsx (MOD)                                                    NEW/MOD (Task 12)
frontend/src/links/LinkPicker.tsx                                                                      MOD (Task 11)
frontend/src/nav/{tabs,recent}.ts  App.tsx                                                              MOD (Tasks 13, 14, 15 in order; recent.ts Task 13)
frontend/src/shell/{TabStrip,TabMenu}.tsx shell/shortcuts.ts                                           NEW (Task 13)
frontend/src/shell/Breadcrumbs.tsx  create/createAndOpen.ts links/wikilinkPresenter.ts                  NEW/MOD (Task 14; createAndOpen also Task 15)
frontend/src/shell/{SidePanel,SidePanelArea,Resizer}.tsx nav/sidepanel.ts                              NEW (Task 15)
frontend/src/shell/{RightPanel,MainPanel}.tsx object/ObjectView.tsx calendar/{CalendarPage,CalendarSidePanel}.tsx   MOD (Task 15)
frontend/src/theme/{themes.css,applyTheme.ts,shortcuts.ts,noRawColours.test.ts}                         NEW (Task 16)
frontend/src/theme/{tokens.css,palette.ts} index.css shell/{Sidebar,PinnedSection,SidebarSections}.tsx
             components/ui/dropdown-menu.tsx components/ImagePicker.tsx                                 MOD (Task 16; Sidebar also Task 17)
frontend/src/settings/{SettingsModal.tsx,sections/*.tsx,ShortcutsSheet.tsx} properties/format.ts       NEW/MOD (Task 17)
frontend/src/spaces/{SpacesMenu.tsx,CreateSpaceDialog.tsx,switchSpace.ts} shell/TopBar.tsx             NEW/MOD (Task 18)
docs/superpowers/plans/m7-acceptance.md  docs/superpowers/plans/remaining-work.md                      Task 19
```

### Shared files and ordering

| File | Edited by | Why it forces order |
|---|---|---|
| `backend/objectapp/server.py` | Tasks 2, 3, 4 | one backend lane, strictly in order; `media.py`, `rows.py`: Task 2; `space.py`, `reminders.py`, `appstate.py`, `spaceconfig.py`, `settings.py`: Task 3; `spaces.py`, `__main__.py`: Task 4; `backend/tests/conftest.py`: Task 1 |
| `frontend/src/api/{types,client}.ts`, `test/mockApi.ts`, `main.tsx`, `lib/shortcuts.ts`, `lib/flush.ts`, `settings/useSettings.ts` | **Task 5 only** | Tasks 8, 11, 12, 13 and 16–18 start only once Task 5's commit (`feat(app): M7 client contract, settings store, shortcut registry`) is on the branch (check `git log`; wait and re-check). After it no task touches these files. |
| `shell/GlobalOverlays.tsx` | Task 5 (stub mounted in `main.tsx`), then 16, 17, 18 | one lane, in order |
| `editor/blocks.ts`, `editor/annotations.ts`, `editor/blockTree.ts` | Task 6 only | |
| `editor/document.ts`, `editor/extensions/blockSource.ts`, `editor/preserve.ts` | **Task 7 only** | the round-trip owner; every sub-lane task consumes them unchanged |
| `editor/nodes/blockOptions.ts`, `nodes/toggle.ts`, `editor/editor.css` | Task 7, then Task 8 | lane order |
| `editor/nodes/{codeBlock,mathBlock,inlineMath}.ts` (+ their `.css`) | Task 7, then Task 9 | lane order |
| `editor/nodes/{group,columns}.ts` (+ `.css`) | Task 7, then Task 10 | lane order |
| `editor/nodes/{media,objectEmbed,bookmark}.ts` (+ `.css`), `editor/extensions/fileDrop.ts`, `links/LinkPicker.tsx` | Task 7 (not LinkPicker), then Task 11 | lane order |
| `editor/extensions/{slashMenu,blockSelection}.ts`, `editor/Editor.tsx` | Task 7 (stubs, not Editor.tsx), then Task 12 | Task 12 runs after Task 8 in sub-lane B1 (it uses `menus/BlockStyleMenu.tsx`) |
| `nav/tabs.ts`, `App.tsx` | Tasks 13, 14, 15 | one lane, in order; `nav/recent.ts`: Task 13 |
| `create/createAndOpen.ts` | Task 5 (the `OpenMods.via` type only), then Tasks 14, 15 | in order (lane C waits for Task 5) |
| `links/wikilinkPresenter.ts` | Task 14 only (in-page `via: 'link'` and the inline-link icon setting) | |
| `object/ObjectView.tsx`, `calendar/CalendarPage.tsx`, `calendar/CalendarSidePanel.tsx`, `shell/RightPanel.tsx`, `shell/MainPanel.tsx` | Task 15 only | |
| `theme/*`, `index.css`, `frontend/index.html`, `shell/PinnedSection.tsx`, `shell/SidebarSections.tsx`, `components/ui/dropdown-menu.tsx`, `components/ImagePicker.tsx` | Task 16 only (`theme/noRawColours.test.ts`: Task 16, then Task 19 empties its pending list) | |
| `shell/Sidebar.tsx` | Tasks 16, 17 | one lane, in order |
| `properties/format.ts` | Task 17 only | |
| `shell/TopBar.tsx` | Task 18 only (space switcher; the `+` label "Create new tab", `SpaceHeader.createNewTab`; the side-panel button's tooltips) | |
| `docs/superpowers/plans/remaining-work.md` | Task 19 only | |

Dependency edges: Task 5 → Tasks 8, 11, 12, 13, 16; Task 6 → 7 → 8, 9, 10, 11; Task 8 → 12; 13 → 14 → 15; 16 → 17 → 18; the backend lane is independent of the frontend lanes (the frontend mocks the contract). Task 18's flush of open editors uses `lib/flush.ts` (Task 5); editors register with it in Task 12, so before Task 12 lands the flush is a no-op and nothing waits on it.

---

Every commit message named in a task's last step is the subject line; the full message is that line, a blank line, and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit only the task's own files, by explicit path; on `index.lock`, wait and retry.

### Task 1: Fixtures, `space-blocks` (lane: backend)

**Files:**
- Create: `backend/tests/fixtures/space-blocks/**`, `backend/tests/test_fixtures_m7.py`
- Modify: `backend/tests/conftest.py` (adds `blocks_space_dir`, a `shutil.copytree` into `tmp_path`; existing fixtures untouched)

**Interfaces:**
- Produces: a synthetic, self-contained space for every M7 backend test and for Task 19's acceptance run. Nothing here touches `space-sample`, `space-v1` or `space-calendar`.

The space (all content invented):
- `.object/types/page.json`, `person.json`; **no** `space.json`, **no** `ui.json`.
- `Pages/Every block.md`: one of every form in the Global Constraints example and option table: a leaf-annotated heading (`color`, `align`), a `small` paragraph, an `icon` paragraph, a standout quote, an alphabetical and a roman list (with nested items), a closed and an open toggle (heading title, mixed children), a group with `color=bg-gray`, two-column `widths=40,60` and three-column `layout=grid widths=33,33,34` blocks, a code block with `wrap lock`, a `mermaid` fence with `preview=split`, a `markdown` fence, a multi-line math block with a blank line inside, a paragraph with inline `$a^2+b^2=c^2$` and a price `$5 and $6` (not math), `---`, a table with `header-column` and one with `no-header-row`, `![pixel](Attachments/pixel.png)` with `width=120 align=center caption="A \"tiny\" pixel"`, `![[Attachments/report.pdf]]` with `height=500`, `![[Attachments/clip.wav]]`, `![[Attachments/clip.mp4]]`, `![[Attachments/data.xlsx]]`, a bookmark, `![[Ada Lovelace]]` with `view=wideCard` and a plain `![[Embedded target]]`.
- `Pages/Hand written.md`: `<!--block:color=bg-red-->` (no spaces), `<!--   TOGGLE   open-->` (upper case, extra spaces), an unknown option `foo=bar` beside a known one, an unknown value `color=bg-purplish`, an unknown container `<!-- callout -->…<!-- /callout -->`, a `<!-- toggle -->` with no close, a stray `<!-- /group -->`, a leaf annotation followed by a blank line, an ordinary comment `<!-- TODO: tidy -->`, nesting: a toggle inside a group inside a column.
- `Pages/CRLF BOM blocks.md` (CRLF line endings, UTF-8 BOM, a toggle, a columns block, a math block), `Pages/No trailing newline blocks.md` (LF, ends without a newline right after `<!-- /toggle -->`).
- `Pages/Embedded target.md`, `People/Ada Lovelace.md` (embed targets).
- `Attachments/`: `pixel.png` (a valid 1×1 PNG), `report.pdf` (a minimal valid PDF), `clip.wav` (a valid 0.1 s silent WAV), `clip.mp4` (placeholder bytes), `data.xlsx` (placeholder bytes), `page.html` (`<script>alert(1)</script>`, to prove it is served as a download), `tool.exe` (placeholder bytes, to prove opening is refused), `notes.svg` (an SVG with a `<script>`, to prove the sandbox CSP stays).
- `.gitattributes`: like the other fixture spaces, plus `-text` on the CRLF/BOM and no-trailing-newline files and `binary` on the attachments.

- [ ] **Step 1: Write failing tests** (`test_fixtures_m7.py`)
  - `test_every_md_has_frontmatter_and_unique_paths`
  - `test_space_opens_without_writing`: open twice (`Space(root)`); no file changed, no file created.
  - `test_expected_inventory`: the annotation lines above are present verbatim; the CRLF/BOM file is CRLF with a BOM; the other file has no trailing newline; every attachment exists.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_fixtures_m7.py -q`. Expected: FAIL.
- [ ] **Step 3:** Write the files and the `blocks_space_dir` fixture.
- [ ] **Step 4:** Run `uv run pytest backend/tests -q`. Expected: PASS.
- [ ] **Step 5:** Commit `test(fixtures): synthetic blocks and attachments space`.

### Task 2: Attachments of every kind (lane: backend)

**Files:**
- Modify: `media.py` (kinds, serving rules, import of any file, listing, open with the OS), `rows.py` (`body_preview` drops `$$` fence lines and annotation lines), `server.py` (the routes in the contract; `GET /api/file` extended; `GET /api/images` and `POST /api/images` kept unchanged for M2's image picker)
- Test: `test_attachments.py`, new cases in the existing rows/preview tests (`test_rows.py` or wherever `body_preview` is tested today)

**Interfaces:**
- Consumes: M2's `media.py` (`image_path` checks, `import_image` naming, `safe_filename`, `create_new`), Starlette `FileResponse` (ranges), Task 1.
- Produces:
  - `media.kind_of(name) -> AttachmentKind`: image `png jpg jpeg gif webp svg` (M2's set); pdf `pdf`; audio `mp3 wav m4a ogg oga flac aac opus`; video `mp4 webm mov m4v ogv`; everything else `file`.
  - `media.attachment_path(root, path) -> Path`: M2's `image_path` checks for any kind (raises `FileNotFoundError` for traversal, absolute, drive-letter, dot-folder or missing paths).
  - `media.list_attachments(root) -> list[Attachment]` per the contract (stat errors skipped, never raised).
  - `media.import_attachment(root, name, data) -> (path, kind)`: `Attachments/<safe_filename(stem)>.<ext>` where `ext` is the lower-cased extension reduced to `[a-z0-9]{1,10}` (none when it doesn't fit), ` (2)`… when taken (case-insensitive, `create_new`, never overwrites); 100 MiB limit (`TooLarge` → 413).
  - `media.serve_headers(kind) -> dict`: the per-kind headers of the contract (image: M2's CSP sandbox; pdf: inline, no sandbox, `nosniff`; audio/video: inline, `nosniff`; file: `application/octet-stream`, `Content-Disposition: attachment; filename*=UTF-8''…`, `nosniff`).
  - `media.open_with_system(full)`: `os.startfile` on Windows, `open` on macOS, `xdg-open` elsewhere, arguments as a list, never a shell; refuses `exe bat cmd com ps1 psm1 vbs vbe js jse wsf wsh msi msp scr lnk url hta cpl reg jar sh bash zsh app command` with `RefusedToOpen` (415). With `OBJECT_FAKE_OPEN_FILE` set it appends the absolute path to that file instead.
  - `body_preview`: lines that are only an annotation comment and `$$` fence lines contribute nothing (the comment lines already vanish through `_TAG_RE`; this pins it with a test).

- [ ] **Step 1: Write failing tests** (`blocks_space_dir`, `OBJECT_STATE_DIR` and `OBJECT_FAKE_OPEN_FILE` in `tmp_path`)
  - `test_kind_of_table` (one case per extension group, upper-case extensions, no extension → `file`)
  - `test_list_attachments_kinds_and_sizes`
  - `test_file_route_serves_each_kind_with_headers`: png (CSP sandbox), pdf (`application/pdf`, inline), wav (`audio/wav` or `audio/x-wav`, `Accept-Ranges: bytes`), xlsx (octet-stream, attachment).
  - `test_range_request_206`: `Range: bytes=0-9` on the wav returns 206 with 10 bytes and `Content-Range`.
  - `test_html_attachment_served_as_download`: `page.html` comes back `application/octet-stream` with `Content-Disposition: attachment` and `nosniff`.
  - `test_svg_keeps_sandbox_csp` (regression guard, green from the start)
  - `test_file_route_rejects_traversal_and_dot_folders`: `../x`, `/etc/passwd`, `C:/x`, `.object/types/page.json`, `Attachments/../../x` → 404.
  - `test_upload_creates_attachment_and_never_overwrites`: two uploads named `Report.PDF` give `Attachments/Report.pdf` and `Attachments/Report (2).pdf`; the first file's bytes are unchanged.
  - `test_upload_name_sanitised` (`../../evil.sh` → `Attachments/evil.sh`; `con.txt` and illegal characters follow M2's `safe_filename`; empty name 422) and `test_upload_over_limit_413` (monkeypatched limit).
  - `test_open_uses_os_and_refuses_executables`: the fake opener records `report.pdf`; `tool.exe` → 415 with the detail, nothing recorded; a path outside the space → 404.
  - `test_listing_and_serving_write_nothing`: hashes of every file in the space are unchanged after the GET routes.
  - `test_preview_skips_annotations_and_math_fences`
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_attachments.py -q`. Expected: FAIL (all but the regression guard).
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `uv run pytest backend/tests -q`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): attachments of every kind (serve, ranges, import, open)`.

### Task 3: Space settings, device settings, app state (lane: backend)

**Files:**
- Create: `appstate.py`, `spaceconfig.py`, `settings.py`
- Modify: `reminders.py` (`_state_dir()` delegates to `appstate.state_dir()`; nothing else), `space.py` (`Space.name` reads `space.json`'s `name`, else the folder name, re-read on access), `server.py` (`GET /api/space` adds the fields; `PUT /api/space`; `GET`/`PUT /api/settings`; `_ui_problem` accepts `calendar.hideCalendarSidebar` as a boolean)
- Test: `test_appstate.py`, `test_spaceconfig.py`, `test_settings.py`, a new case in M4's ui test for `hideCalendarSidebar`

**Interfaces:**
- Consumes: `jsonstore.dump_json`/`parse_json_object`/`json_revision`, `textfile.atomic_write`, M4's `reminders._state_dir` (moved, same behaviour), M3's `_ui_problem`.
- Produces:
  - `appstate.state_dir() -> Path` (the Storage rule; created lazily only by a writer, never by a reader).
  - `spaceconfig.read(root) -> (data, revision, error)`; `spaceconfig.patch(root, patch, base_revision) -> (data, revision)`: keys `name` (non-empty after trim, ≤ 120 characters), `icon` (string or null), `description` (string or null), `hideTaskManagement` (bool); other keys already in the file are kept; atomic; `RevisionConflict` (409) on a stale revision (the revision of a missing file is `''`); an unreadable file is `ReadOnly` (423) and never replaced.
  - `settings.DEFAULTS` (the contract's `DeviceSettings` defaults), `settings.read() -> (merged, revision)` (a missing file reads as defaults, revision `''`), `settings.patch(patch, base_revision)` with per-key shape checks (`SettingsProblem` → 422 "Cannot patch: <key>" (our string), as M3's ui patch words it), 409, 423; unknown keys already in the file are kept.
  - Routes per the contract. `PUT /api/space` changes nothing else (no folder rename, no type or object file).

- [ ] **Step 1: Write failing tests** (`OBJECT_STATE_DIR` in `tmp_path`, `blocks_space_dir`)
  - `test_state_dir_env_override_and_platform_default` (`test_appstate.py`), `test_reminders_ledger_uses_state_dir` (regression guard, green from the start: M4's ledger path is unchanged).
  - `test_space_json_absent_reads_folder_name`; `test_patch_space_creates_only_space_json` (the tree diff is exactly `.object/space.json`); `test_patch_space_keeps_unknown_keys`; `test_stale_revision_409`; `test_unreadable_space_json_423_not_replaced`; `test_empty_or_long_name_422`; `test_name_change_does_not_rename_folder`.
  - `test_settings_defaults_without_file`; `test_settings_patch_round_trip_and_unknown_kept`; `test_settings_bad_shape_422` (one case per key type, an unknown patch key); `test_settings_stale_409`; `test_settings_file_lives_in_state_dir`.
  - `test_get_space_and_settings_write_nothing`: no file created or changed in the space or the state dir.
  - `test_ui_accepts_hide_calendar_sidebar` (and a non-boolean is 422).
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_appstate.py backend/tests/test_spaceconfig.py backend/tests/test_settings.py -q`. Expected: FAIL (all but the regression guard).
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `uv run pytest backend/tests -q`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): space.json, device settings and the app state folder`.

### Task 4: Spaces: registry, create, open, remove, switch (lane: backend)

**Files:**
- Create: `spaces.py`
- Modify: `server.py` (`create_app(space, static_dir=None, watch=True, on_switch=None)`; the `/api/spaces*` routes), `__main__.py` (`--space` becomes optional; the `SpaceHost` loop; the start-up choice)
- Test: `test_spaces.py`, `test_spacehost.py`

**Interfaces:**
- Consumes: Task 3 (`appstate`, `spaceconfig`, `settings.read()` for `startupSpace`), M2's `safe_filename`, M4's lifespan (watcher and reminder scheduler stop cleanly on server exit).
- Produces:
  - `spaces.Registry(state_dir)`: `list() -> list[SpaceEntry]` (name and icon from each folder's `space.json`, `missing` when the folder is gone; never writes), `register(path, now)` (adds or moves `lastOpened`; atomic write of `spaces.json`), `remove(path)`, `last_opened() -> Path | None`. An unreadable `spaces.json` reads as empty and is replaced on the next write (it holds no user content).
  - `spaces.create_space(name, location) -> Path`: `location` must be an existing folder; the target is `<location>/<safe_filename(name)>`; it must not exist (`FileExistsError` → 409); creates the folder, `.object/`, and `space.json` `{"name": name}` (the original name, not the safe one), nothing else.
  - `__main__.SpaceHost(port, static_dir)`: `run(first_root)` loops: build `Space(root)`, `registry.register(root)`, serve `create_app(space, static_dir, on_switch=self.request_switch)` on `127.0.0.1:port` until it exits; when `request_switch(path)` was called, start again on that path (same port), otherwise stop. `request_switch` records the path and sets the uvicorn server's `should_exit`. The window (pywebview) or browser stays open throughout; the server thread is replaced.
  - Start-up root: `--space PATH` if given; else `settings.startupSpace == 'specific'` and that folder exists; else the registry's `lastOpened` if it exists; else `parser.error("Pass --space PATH the first time.")` (our string).
  - `POST /api/spaces/switch` calls `on_switch(path)` after the response is sent (a background task), so the client gets its 202; without `on_switch` it is the 503 of the contract.

- [ ] **Step 1: Write failing tests**
  - `test_registry_register_list_remove` and `test_registry_missing_folder_flagged`
  - `test_create_space_writes_only_space_json` and `test_create_space_refuses_existing_folder` (an existing folder with files stays byte-identical)
  - `test_create_space_bad_location_404_bad_name_422`
  - `test_remove_space_keeps_folder` and `test_remove_current_space_409`
  - `test_open_space_registers_existing_folder` and `test_switch_rejects_non_folder`
  - `test_switch_route_calls_host_after_response`: a fake `on_switch` is called with the path after the 202 is returned.
  - `test_switch_without_launcher_503`
  - `test_startup_space_choice`: `--space` wins; then `specific`; then `lastOpened`; else the parser error.
  - `test_startup_writes_only_registry_outside_space`: building the host for a space creates `spaces.json` in the state dir and nothing in the space.
  - `test_host_restarts_on_new_space` (`test_spacehost.py`): a real `SpaceHost` on a free port in a thread with two temp spaces; `POST /api/spaces/switch` to the second; `GET /api/space` reports the second root within 10 s; stopping the host joins its thread.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_spaces.py backend/tests/test_spacehost.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `uv run pytest backend/tests -q`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): spaces registry, create, open, remove and switch`.

### Task 5: Client contract, settings store, shortcut registry (lane: look; first)

**Files:**
- Modify: `api/types.ts`, `api/client.ts`, `test/mockApi.ts`, `main.tsx` (mounts `<GlobalOverlays />` beside `<App />`), `create/createAndOpen.ts` (type only: `OpenMods` gains `via?: 'link' | 'nav'`, ignored until Task 14)
- Create: `lib/shortcuts.ts`, `lib/flush.ts`, `settings/useSettings.ts`, `shell/GlobalOverlays.tsx` (renders nothing yet; Tasks 16–18 fill it)
- Test: `api/client.m7.test.ts`, `lib/shortcuts.test.ts`, `lib/flush.test.ts`, `settings/useSettings.test.ts`

**Interfaces:**
- Consumes: the API contract.
- Produces:
  - TS types for every contract shape; `SpaceInfo` gains its fields; `UiState['calendar']` gains `hideCalendarSidebar?`; `api.*` methods of the contract (a 409 throws M3's `ConflictError`; `uploadAttachment` sends the raw bytes with `?name=`; `api.fileUrl(path)` unchanged). `mockApi` defaults plus builders `deviceSettings(partial)`, `spaceEntry(partial)`, `attachment(partial)` next to M3's `row(partial)`.
  - `useSettings` (zustand): `{settings: DeviceSettings (the defaults until loaded), revision, loaded, load(), patch(partial): Promise<void>}`; `patch` applies optimistically, sends one `api.patchSettings`, and on `ConflictError` reloads and re-applies the patch once (M3's `useViewState` rule); `settingsDefaults` is exported for tests.
  - `lib/shortcuts.ts`: `type ShortcutDef = {id, category, name, keys: string[], scope: 'global'|'editor'|'calendar'|'table', provisional: boolean}`; `registerShortcuts(defs)`, `allShortcuts()` (for the cheat sheet), `keysFor(id)`, `matches(e: KeyboardEvent, keys)` (`Mod` = Ctrl on Windows/Linux, Cmd on macOS), and `useGlobalShortcut(id, handler, {allowInEditable?})` (one window `keydown` listener; ignores events from editable targets unless allowed, with `App.tsx`'s `isEditableTarget` rule copied here; Task 13 makes `App.tsx` import it from here).
  - `create/createAndOpen.ts`: `OpenMods.via?: 'link' | 'nav'` (the type only; no behaviour).
  - `lib/flush.ts`: `registerFlusher(fn: () => Promise<void>) -> unregister`, `flushAll(): Promise<void>` (awaits every registered flusher; errors are collected and rethrown after all ran).

- [ ] **Step 1: Write failing tests**
  - `test client calls every M7 route with the contract shapes` (one case per method, including the raw upload body and the 202 of `switchSpace`)
  - `test settings store loads defaults, patches optimistically and reapplies once on 409`
  - `test shortcut matches Mod per platform and skips editable targets unless allowed`
  - `test registry lists registered shortcuts by category`
  - `test flushAll awaits every flusher and reports errors after all ran`
  - `test GlobalOverlays is mounted beside App` (renders without error)
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/api src/lib src/settings`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(app): M7 client contract, settings store, shortcut registry`.

### Task 6: Annotation codec and block tree (lane: editor; first)

**Files:**
- Create: `editor/annotations.ts`, `editor/blockTree.ts`, fixtures `editor/__fixtures__/blocks-every.md`, `blocks-handwritten.md`, `blocks-crlf.md` (CRLF + BOM; add `-text` to `editor/__fixtures__/.gitattributes`), `blocks-no-eol.md` (the same forms as Task 1's Pages, written from the Global Constraints table; this lane does not read the backend fixtures)
- Modify: `editor/blocks.ts` (a local `Marked` instance with a block-level `math` extension for rule 6; `splitBlocks` keeps its join invariant and its exported shape)
- Test: `editor/annotations.test.ts`, `editor/blockTree.test.ts`, new cases in `editor/blocks.test.ts` (or wherever `splitBlocks` is tested today)

**Interfaces:**
- Consumes: M1's `splitBlocks(body) -> SourceBlock[]` (`{kind, raw}`; `joinBlocks` invariant), `marked` (already a dependency).
- Produces (pure; no Tiptap):
  - `parseAnnotation(line: string) -> Annotation | null` where `Annotation = {type: 'leaf'|'open'|'separator'|'close', name?: 'toggle'|'group'|'columns', options: Option[]}` and `Option = {key, value: string | true, raw: string}`; `null` for anything that is not an annotation line (including ordinary comments and unknown container names).
  - `formatAnnotation(a: Annotation) -> string` (canonical, no line ending) and `optionsEqual(a, b)` (order-insensitive for known keys, order-sensitive for unknown ones).
  - `KNOWN_OPTIONS`: the option table (key, value pattern, the node kinds it applies to, canonical order).
  - `buildTree(blocks: SourceBlock[]) -> TreeNode[]` with `TreeNode = {kind: 'leaf', block: SourceBlock, annotation?: {raw: string /* the line with its EOL */, parsed: Annotation}} | {kind: 'container', name, open: {raw, parsed}, columns: TreeNode[][] /* one list for toggle and group */, separators: (string | null)[] /* the raw separator lines, null for the first column */, close: {raw}}`, applying rules 4 and 7 (a leaf annotation attaches only when its `html` token's raw ends with exactly one line break and the next block is a kind it applies to; containers pair by a stack with the depth limit; anything unmatched becomes plain leaves).
  - `flattenTree(nodes) -> SourceBlock[]` with `joinBlocks(flattenTree(buildTree(splitBlocks(body)))) === body` for every input.
  - `splitBlocks` emits `kind: 'math'` blocks (rule 6).

- [ ] **Step 1: Write failing tests**
  - `test annotation line lexes as its own html token` (regression guard, green from the start: pins marked's comment-block behaviour this design relies on)
  - `test parse leaf, open, separator, close and reject ordinary comments`
  - `test lenient spellings parse and keep their text` (no spaces, upper case, extra spaces; `raw` is the exact input)
  - `test canonical format orders options and quotes values` and `test caption with quotes and backslashes round trips`
  - `test unknown options and values are kept in order`
  - `test detached annotation stays a comment` (followed by a blank line; followed by a block it doesn't apply to)
  - `test containers pair, nest and respect the depth limit`
  - `test malformed containers fall back to plain blocks` (open without close, stray close, unknown name)
  - `test math block spans blank lines` and `test one-line math block`
  - `test inline math follows Pandoc dollar rules` (a helper `findInlineMath(text)` exported for Task 7: `$a$` yes; `$5 and $6` no; `\$` no; `$$` no; `$ a$` no; `$a $` no; `$a$5` no)
  - `test embed line rules pick image, media or object embed` (`classifyEmbedLine(raw)`, exported for Task 7)
  - `test every fixture body groups and joins back byte for byte` (all four fixtures, plus every existing `editor/__fixtures__` file)
- [ ] **Step 2:** Run `npx vitest run src/editor/annotations.test.ts src/editor/blockTree.test.ts src/editor/blocks.test.ts`. Expected: FAIL (all but the regression guard).
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS (the M2 timing nit in `preserve.test.ts` excepted when the machine is loaded, as recorded in `remaining-work.md`).
- [ ] **Step 5:** Commit `feat(editor): annotation syntax and block tree`.

### Task 7: Document model: every node, containers, nested preservation (lane: editor)

**Files:**
- Create: `editor/nodes/{blockOptions,toggle,group,columns,mathBlock,inlineMath,codeBlock,media,objectEmbed,bookmark}.ts` and one `.css` file beside each (imported by its node module), `editor/extensions/{slashMenu,blockSelection,fileDrop}.ts` (empty `Extension.create` stubs, registered now so later tasks never touch `document.ts`)
- Modify: `editor/document.ts` (`editorExtensions(opts?: {numberedListInputRule?: boolean})`, `loadBody` builds from `buildTree`, `serializeBody` recurses), `editor/extensions/blockSource.ts` (nested blocks, the keep rule), `editor/preserve.ts` (only if a helper must be exported; no behaviour change for existing kinds), `editor/editor.css` (the hard-coded `#4e4b4c`, `#e4e3e2`, `#7c7c7d` become `var(--editor-quote-line)`, `var(--editor-bullet)`, `var(--editor-bullet-nested)`; `hr` uses `var(--editor-hr)`)
- Test: `editor/document.blocks.test.ts`, `editor/blockSource.nested.test.ts`, `editor/roundtrip.space.test.ts` (skipped unless `OBJECT_ROUNDTRIP_SPACE` is set; Task 19 runs it); all M1–M6 editor tests stay green

**Interfaces:**
- Consumes: Task 6; M1's `loadBody`/`serializeBody`/`preserveBlock`/`serializeWithPreservation`, `BlockSource` (`blockSource`, `blockOrigin`, `blockTrailing`, `BLOCK_SOURCE_META`, `TOP_LEVEL_TYPES`), `RawBlock`, `Wikilink`, `@tiptap/markdown` (`markdownTokenizer`/`parseMarkdown`/`renderMarkdown`, the Wikilink pattern), `@tiptap/extension-code-block` (`CodeBlock.extend`).
- Produces:
  - **`blockOptions` global attributes** on `paragraph`, `heading`, `bulletList`, `orderedList`, `taskList`, `blockquote`, `codeBlock`, `table`, `mathBlock`, `media`, `objectEmbed`, `bookmark`: `blockOptions: Option[] | null` and `blockAnnotation: string | null` (the original line with its EOL; not rendered, not kept on split). Rendering here is minimal: `data-*` attributes only (Task 8 styles them).
  - **Containers:** `toggle` (content `block+`; the first child is the toggle's line), `group` (content `block+`), `columns` (content `column{1,6}`) and `column` (content `block+`); each container and column carries `blockSource`/`blockOrigin` (the whole region, for the verbatim fast path), `containerOpen`/`containerClose` (raw lines with EOL), `containerLeading` (blank lines after the open line), the parsed options, and `column.separator` (raw line or null). Rendering is a plain `div` per container and column (Tasks 8 and 10 add node views).
  - **Leaves:** `mathBlock` (attrs `text`; markdown: the `math` source block; edited form `$$⏎text⏎$$`), `inlineMath` (inline atom, attrs `text`; `markdownTokenizer` using `findInlineMath`; renders `$text$`), `codeBlock` (`CodeBlock.extend` with `language`; StarterKit's own `codeBlock: false`; the M1 "mermaid fence → raw block" rule is removed, so a Mermaid fence becomes a code block whose language is `mermaid`; the content-key fallback to a raw block still applies to anything that doesn't round-trip), `media` (atom; attrs `form: 'md'|'wiki'`, `src`/`alt` or `target`/`label`, `kind` from the extension), `objectEmbed` (atom; attrs `target`, `label`), `bookmark` (atom; attrs `href`, `title`; only with the `bookmark` option and a one-link paragraph).
  - **Loading:** `loadBody` walks `buildTree`: a leaf becomes the node `sourceToNode` gives (now also `math`, image/media/object-embed lines and bookmarks) with `blockAnnotation` and `blockOptions` when annotated; a container becomes its node with its children loaded the same way (recursively), each child stamped with its own `blockSource`/`blockOrigin`/`blockTrailing`.
  - **Serializing:** a node whose `blockSource` survives is emitted verbatim (for a container, the whole region). Otherwise: a leaf emits its annotation (the original `blockAnnotation` when `optionsEqual(current, parsed original)`, else `formatAnnotation` with the document's EOL, nothing when no options are left) and then its block through M1's `preserveBlock` against `blockOrigin` (or its fresh Markdown when new); a container emits `containerOpen` (or the canonical open line if its options changed), `containerLeading`, its children (recursively, with their `blockTrailing`), each `column.separator`, and `containerClose`. New containers and columns are emitted canonically with the document's EOL.
  - **`BlockSource` for nested blocks:** the global attributes cover every node type above; the clearing plugin walks `doc.descendants`, so an edit inside a container clears the container's `blockSource` and the edited child's, never the siblings'. **Keep rule:** a node whose content and non-source attributes equal the snapshot taken at load (a `WeakMap` from its `blockOrigin` string to the loaded node's JSON) keeps or regains its `blockSource`. This is what makes undo and block moves byte-exact.
  - **Data-level commands** (the UI tasks call them; tested here): `setBlockOption(key, value | null)` (on the block at the selection, or on every selected block once Task 12's selection exists), `setListType('bullet'|'numerical'|'alphabetical'|'roman'|'todo'|null)`, `setHierarchy('Base'|'S'|'H1'|'H2'|'H3'|'H4')`, `wrapInToggle()`, `unwrapToggle()`, `setToggleOpen(pos, open)`, `wrapInGroup()`, `unwrapGroup()`, `insertColumns(n = 2)`, `setColumnWidths(pos, widths)`, `insertMathBlock(text = '')`, `insertInlineMath(text)`, `insertMedia(attrs)`, `insertObjectEmbed(target)`, `insertBookmark(href, title)`; stubs that return `false` until Task 11 implements them: `pickMedia(kind)`, `pickObjectEmbed()`.
  - `editorExtensions({numberedListInputRule})`: when false, the ordered-list input rule is left out (`EditorSettings.disableNumberedListTransformation`; Task 12 passes the setting).
  - `roundtrip.space.test.ts`: for every `.md` under `OBJECT_ROUNDTRIP_SPACE`, the body (after M1's frontmatter split) loads into a headless editor and serializes byte-identical; for every annotated leaf and container, toggling one option on and off again gives the identical bytes. It prints a one-line summary (`N files, M annotated blocks, 0 differences`) and fails on any difference.

- [ ] **Step 1: Write failing tests**
  - `test no-edit save is byte identical for every fixture` (Task 6's four fixtures and every existing `editor/__fixtures__` file)
  - `test annotated leaves load with their options` (one case per option row)
  - `test containers load with their children and columns`
  - `test option change rewrites only the annotation line` (diff of the output: one changed line)
  - `test removing the last option removes only its line` and `test adding the first option inserts one line above`
  - `test edit inside a toggle rewrites only that child` (the open and close lines and the siblings byte-identical)
  - `test toggling open rewrites only the open line`
  - `test new containers serialize canonically with the document EOL` and `test CRLF document inserts CRLF annotation lines`
  - `test unknown options survive an edit` and `test malformed annotations survive an edit elsewhere`
  - `test undo restores original bytes` (type, then undo, then serialize)
  - `test moving a block keeps its bytes` (a block moved below its neighbour with a `BLOCK_SOURCE_META`-free transaction: the output is the original blocks reordered, each byte-identical)
  - `test math block, inline math, media, object embed and bookmark round trip and edit canonically`
  - `test mermaid fence loads as a code block` (it was a raw block in M1; its bytes are unchanged)
  - `test numbered list input rule can be turned off`
  - `test commands set options, wrap and unwrap containers and insert every new block`
- [ ] **Step 2:** Run `npx vitest run src/editor`. Expected: FAIL (the new tests).
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit && npm run build`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(editor): every block kind, containers and nested byte preservation`.

### Task 8: Block styles and toggles (lane: editor, sub-lane B1; after Task 7, and once Task 5's commit is on the branch)

**Files:**
- Modify: `editor/nodes/blockOptions.ts` (+ `.css`), `editor/nodes/toggle.ts` (+ `.css`), `editor/editor.css`
- Create: `editor/menus/BlockStyleMenu.tsx` (the Hierarchy, List, Quote and Color menus, used by Task 12's block menu), `editor/menus/colors.ts`
- Test: `editor/nodes/blockOptions.test.tsx`, `editor/nodes/toggle.test.tsx`, `editor/menus/BlockStyleMenu.test.tsx`

**Interfaces:**
- Consumes: Task 7 (attributes, `setBlockOption`, `setListType`, `setHierarchy`, `setToggleOpen`, `wrapInToggle`), Task 5 (`useSettings`: `toggleStyle`, `hideOutlinerLines`), M2's `THEME_COLORS`, `colorName` (`theme/palette.ts`), `IconPicker` (`components/IconPicker.tsx`).
- Produces:
  - **Rendering** (values from `design.css`: grep `.editor-prose`, `--ep-`, `.quote>`, `.block-outer`, `toggle-outline-color`): `small` is Object's "S" size; `color=text-<c>` / `bg-<c>` per Global Constraints (a background block gets Object's block padding and radius); `align`; `icon` shows the icon before the block's text (Iconify or emoji, as M2's `Icon`/`IconOrEmoji`); `quote=standout` is the standout layout (larger, no rail); `list=alphabetical|roman` sets `list-style-type: lower-alpha|lower-roman` on the list and its nested lists.
  - **Toggle node view:** a caret before the toggle's first child, rotated when open; children hidden when closed; clicking the caret calls `setToggleOpen` (so the file's open line changes, rule 2); an empty toggle (no children) shows the caret in `--editor-toggle-empty`; the outliner line (a vertical rule along the children, `--editor-toggle-outline`) unless `hideOutlinerLines`; `toggleStyle: 'bullet'` shows a bullet that turns into the caret on hover (`EditorSettings.toggleStyle.description`).
  - **`<BlockStyleMenu>`** (sub-menus, each item applying to the current block or the block selection): "Hierarchy" (`blocksMenu.hierarchy.title`) with "Standard", "Heading 1"–"Heading 4", "Small" (`blocksMenu.hierarchy.*`); "List" (`blocksMenu.list.title`) with "No listing", "Bulleted", "Numbered", "Alphabetical", "Roman" (`blocksMenu.list.*`); "Quote" (`blocksMenu.quote.title`) toggling a quote and its standout layout; "Color" (`styles.color`) with "Text color" and "Background color" (`tokensMenu.color.title`, `.background`), each listing the 18 colours as "<Colour> text" / "<Colour> background" (`colorThemes.theme-text-*`, `theme-bg-*`) with a swatch, and "Remove text color" / "Remove background color" (`colorThemes.theme-remove-*`); "Icon" (`ControlDropdown.custom.block_icon.name`) opening M2's icon picker.
  - `colors.ts`: the menu order (Object's `themeColors` order, M2's `THEME_COLORS`) and the token for each.

- [ ] **Step 1: Write failing tests**
  - `test small, colour, align, icon, standout and list types render from options`
  - `test background colour uses label tokens`
  - `test toggle caret opens and closes and writes the open option once`
  - `test closed toggle hides children; empty toggle uses the empty colour`
  - `test bullet toggle style and hidden outliner lines follow settings`
  - `test colour menu lists 18 text and 18 background colours with reference names`
  - `test hierarchy, list and quote menus apply to the current block`
- [ ] **Step 2:** Run `npx vitest run src/editor`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(editor): block colours, alignment, small, icons, standout quotes, list types and toggles`.

### Task 9: Code, math and horizontal line (lane: editor, sub-lane B2; after Task 7)

**Files:**
- Modify: `editor/nodes/{codeBlock,mathBlock,inlineMath}.ts` (+ their `.css`)
- Create: `editor/code/{CodeBlockView.tsx,MermaidPreview.tsx,MarkdownPreview.tsx,languages.ts}`, `editor/math/{MathBlockView.tsx,InlineMathView.tsx,renderMath.ts}`
- Test: `editor/code/CodeBlockView.test.tsx`, `editor/code/MermaidPreview.test.tsx` (with `vi.mock('mermaid')`), `editor/code/MarkdownPreview.test.tsx`, `editor/math/renderMath.test.ts`, `editor/math/MathBlockView.test.tsx`

**Interfaces:**
- Consumes: Task 7 (`codeBlock`, `mathBlock`, `inlineMath`, `setBlockOption`), `katex@0.19.0`, `mermaid@12.1.0` (dynamic import), `@tiptap/react` `ReactNodeViewRenderer`, `editorExtensions`/`loadBody` (the Markdown preview), the current theme (`document.documentElement.dataset.theme`, Task 16; `dark` when absent).
- Produces:
  - **Code block view:** the code area (monospace, `--code-bg`, `--code-border`, `--code-text`); a hover bar with the language button "Select language" (`blocks.CodeBlock.selectLanguage`; `languages.ts`: plain text and common languages, our list, since Object's list is not in the trimmed set), "Wrap lines" (`blocks.CodeBlock.wrapText`, option `wrap`), "Lock editing" (`blocks.CodeBlock.lockEditing`, option `lock`: the code becomes read-only until unlocked), "Copy to clipboard" (`blocks.CodeBlock.copySnippet`) and "Download as file" (`blocks.CodeBlock.downloadSnippet`, a client-side `Blob` download).
  - **Previews** for `markdown` and `mermaid`: a segmented control "Edit" / "Edit & Display" / "Display" (`blocks.CodeBlock.viewModeEdit`, `.viewModeSplit`, `.viewModeDisplay`) writing `preview=edit|split|display`; absent means "Display" for these two languages (our default; listed for Gene's check). Markdown preview: a read-only editor built from `editorExtensions()` and `loadBody` (raw HTML is shown as text, never injected). Mermaid preview: `mermaid.initialize({startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default'})` and `mermaid.render(id, text)`; empty text shows "Write a Mermaid diagram to see the preview" (`blocks.CodeBlock.mermaidEmpty`); an error shows "Diagram rendering error" (`blocks.CodeBlock.mermaidError`) with the message; it re-renders when the text or the theme changes (a `MutationObserver` on `<html data-theme>`).
  - **Math block view:** KaTeX display rendering (`renderMath(text, {display: true})`: `throwOnError: false`, `trust: false`, `output: 'htmlAndMathml'`); clicking opens an editing panel (a textarea with the live preview) with "Close" (`blocks.MathBlock.closeEditor`) and the hint "↵ to insert above/below" (`blocks.MathBlock.insertNewBlock`, after the key glyph); invalid TeX renders KaTeX's error colouring, never throws.
  - **Inline math view:** KaTeX inline rendering; clicking it opens a small input to edit the TeX; an empty formula is removed on close.
  - **Horizontal line:** StarterKit's `horizontalRule` with Object's spacing and `--editor-hr` (CSS only).
  - KaTeX CSS (`katex/dist/katex.min.css`) is imported by `renderMath.ts`; no network request is made (asserted by a test that the CSS's font URLs are relative).

- [ ] **Step 1: Write failing tests**
  - `test language picker, wrap and lock write their options`
  - `test copy and download use the code text`
  - `test preview modes for markdown and mermaid write preview and default to display`
  - `test markdown preview shows raw html as text`
  - `test mermaid renders strict with the theme and shows empty and error states` and `test mermaid rerenders on theme change`
  - `test renderMath display and inline never throw on bad input`
  - `test math block editor opens, previews and closes`
  - `test inline math edits and removes when emptied`
  - `test katex assets are local`
- [ ] **Step 2:** Run `npx vitest run src/editor/code src/editor/math`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit && npm run build`. Expected: PASS (Mermaid lands in its own chunk).
- [ ] **Step 5:** Commit `feat(editor): code blocks with previews, math with KaTeX, horizontal lines`.

### Task 10: Tables, columns and groups (lane: editor, sub-lane B3; after Task 7)

**Files:**
- Modify: `editor/nodes/{group,columns}.ts` (+ `.css`)
- Create: `editor/table/{TableMenu.tsx,tableCommands.ts,table.css}`, `editor/layout/{ColumnsView.tsx,GroupView.tsx,Divider.tsx}`
- Test: `editor/table/TableMenu.test.tsx`, `editor/table/tableCommands.test.ts`, `editor/layout/ColumnsView.test.tsx`, `editor/layout/GroupView.test.tsx`

**Interfaces:**
- Consumes: Task 7 (`table` with `blockOptions`, `columns`/`column`/`group`, `setColumnWidths`, `setBlockOption`), Tiptap's `TableKit` commands (`addRowBefore/After`, `addColumnBefore/After`, `deleteRow`, `deleteColumn`, `deleteTable`), M1's table preservation (edits keep the original alignment and padding through `preserveTable`).
- Produces:
  - **Table:** the header row shown as header cells unless `no-header-row`; the first column shown as header cells with `header-column`. A table menu on hover, "Edit table" (`blocks.simpleTable.optionsMenu.label`), with "Header row" and "Header column" switches (`showHeaderRow`, `showHeaderColumn`) and "Delete table"; a row menu "Edit row" (`rowMenu.label`) with "Insert row above", "Insert row below", "Delete row", "Clear row"; a column menu "Edit column" (`colMenu.label`) with "Insert column before", "Insert column after", "Delete column", "Clear column"; a cell's "Clear cell contents" (all `blocks.simpleTable.*`). Hiding the header row never removes the GFM separator line (the file stays a valid table); the flag only changes the display.
  - **Columns:** a CSS grid with one track per column at its `widths`; a `Divider` between columns that drags and writes `widths` (integers summing to 100, rounded, each ≥ 10) on pointer up only; "Column layout" (`styles.gridLayout.heading`) with "Columns" / "Grid" (`styles.gridLayout.*`) writing `layout=grid` (grid wraps the columns into a responsive grid); "Add column" and "Remove column" (our strings) between 1 and 6 columns, redistributing widths evenly; colour from the container options. An empty column shows a placeholder line that accepts typing. The slash item is "Two Columns" (`blocks.GridBlock.name`, Task 12).
  - **Group:** a box with Object's group padding and radius, its `color` (default none: the neutral `--bg-raised-2` fill) and `align`; the placeholder "Box heading..." (`blocks.GroupBlock.placeholder`) on an empty first child; "Ungroup" (`ActionItems.ungroupBlocks.title`) through `unwrapGroup` (`shortcuts.groupBlocks` toggles).

- [ ] **Step 1: Write failing tests**
  - `test header row and header column switches write their options and change cells`
  - `test row and column menus insert, delete and clear`
  - `test table edit keeps the original alignment of untouched rows` (regression guard over M1's `preserveTable`, green from the start)
  - `test dragging a divider writes widths once on release`
  - `test column layout writes layout=grid; add and remove column redistribute widths`
  - `test group renders colour and placeholder; ungroup keeps children`
- [ ] **Step 2:** Run `npx vitest run src/editor/table src/editor/layout`. Expected: FAIL (all but the regression guard).
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(editor): simple tables with header row and column, columns and groups`.

### Task 11: Media blocks and object embeds (lane: editor, sub-lane B4; after Task 7, and once Task 5's commit is on the branch)

**Files:**
- Modify: `editor/nodes/{media,objectEmbed,bookmark}.ts` (+ `.css`), `editor/extensions/fileDrop.ts`, `links/LinkPicker.tsx` (an `embed` mode)
- Create: `editor/media/{MediaView.tsx,ResizableEmbed.tsx,upload.ts}`, `editor/embed/ObjectEmbedView.tsx`
- Test: `editor/media/MediaView.test.tsx`, `editor/media/upload.test.ts`, `editor/embed/ObjectEmbedView.test.tsx`, new cases in `links/LinkPicker.test.tsx`

**Interfaces:**
- Consumes: Task 7 (nodes, `setBlockOption`, `insertMedia`, `insertObjectEmbed`, the `pickMedia`/`pickObjectEmbed` stubs to implement), Task 5 (`api.attachments`, `api.uploadAttachment`, `api.openAttachment`, `api.fileUrl`), M3's `ObjectCard` (`views/cards/ObjectCard.tsx`, views `inline | smallCard | wideCard | embed`), `cardProperties`, `api.rows({paths})`, `useLinkIndex` (`resolve`, summaries), `openObject` (`create/createAndOpen.ts`), `TypeDef.defaultViewType`.
- Produces:
  - **`ResizableEmbed`:** a right-edge drag handle writing `width` on release, alignment buttons "Align left" / "Align center" / "Align right" (`ResizableEmbed.align*`, writing `align`; left removes it), and "Add caption" / "Remove caption" with the placeholder "Caption..." (`ResizableEmbed.*`, writing `caption`).
  - **Media views:** image (`<img>` from `api.fileUrl`, or the URL as written for `http(s)` sources; a failed load shows "This image could not be loaded. Please try again or delete the object." (`RenderImage.loadingError`)); PDF (an `<iframe>` of `api.fileUrl` at `height`, default 600 px, our value, with a bottom resize handle writing `height`); audio (`<audio controls>`); video (`<video controls>`, resizable width); file (a card with a file icon by extension, the name, the size from `api.attachments()`, "Open {type} on system" (`EntityMenu.openMediaOnSystem`, `api.openAttachment`), "Download {mediaType}" (`EntityMenu.downloadMedia.text`, an anchor with `download`)); a missing attachment shows "File not found." (our string). Every media block has a `…` menu with "Remove Block" (`EntityMenu.deleteEntityBlock.text`).
  - **Bookmark view:** a card with the link title, the domain and the URL; clicking opens the URL in the system browser (`target="_blank"`, `rel="noopener noreferrer"`); nothing is fetched.
  - **Object embed view:** resolves `target` through the link index and loads its `Row` with one `api.rows({paths})` call; renders `ObjectCard` with `view` (absent: the type's `defaultViewType`, else `smallCard`); a `…` menu with "Change Block View" (`EntityMenu.groups.view.text`) listing "Link block", "Small card", "Wide card", "Embed" (`structureViewTypes.*.name`), writing `view`, and "Remove Block"; clicking opens the object with `openObject(path, {...modifiers, via: 'link'})` (the `via` type is Task 5's; Task 14 makes it extend the breadcrumb trail); an unresolved target shows the muted `[[target]]` chip, as M1's unresolved wikilinks.
  - **`pickMedia(kind)`:** a hidden `<input type=file>` with an `accept` list per kind; the chosen file goes through `upload.ts` (`api.uploadAttachment`; over 100 MiB is refused before sending with the toast `EntityPicker.uploadLimitSize`); then `insertMedia` (`![name](Attachments/…)` for an image, `![[Attachments/…]]` otherwise).
  - **`pickObjectEmbed()`:** opens `LinkPicker` in `embed` mode, which inserts `objectEmbed` instead of a wikilink.
  - **`fileDrop`:** pasting or dropping files into the editor uploads each and inserts its media block at the drop point (`pasteInput.image_from_file` "Insert image", `pasteInput.file` "Insert file" as the toast wording).

- [ ] **Step 1: Write failing tests**
  - `test image, pdf, audio, video and file render from their nodes`
  - `test resize, align and caption write their options on release`
  - `test missing image and missing file states`
  - `test open on system and download for files`
  - `test bookmark card opens externally and fetches nothing`
  - `test object embed renders each view and change block view writes view`
  - `test object embed default view comes from the type`
  - `test unresolved embed shows the muted chip`
  - `test pickMedia uploads and inserts the right form per kind` and `test upload over 100 MiB is refused before sending`
  - `test link picker embed mode inserts an object embed`
  - `test dropped and pasted files upload and insert media blocks`
- [ ] **Step 2:** Run `npx vitest run src/editor/media src/editor/embed src/links`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(editor): media blocks, web links and embedded objects with their own view`.

### Task 12: Slash menu, handles, block menu, block selection, editor shortcuts (lane: editor, sub-lane B1; after Task 8)

**Files:**
- Modify: `editor/extensions/{slashMenu,blockSelection}.ts`, `editor/Editor.tsx`
- Create: `editor/slash/{SlashMenu.tsx,slashItems.ts}`, `editor/handles/{BlockHandles.tsx,BlockMenu.tsx,dragMove.ts,handles.css}`, `editor/shortcuts.ts`
- Test: `editor/slash/slashItems.test.ts`, `editor/slash/SlashMenu.test.tsx`, `editor/handles/BlockHandles.test.tsx`, `editor/handles/BlockMenu.test.tsx`, `editor/extensions/blockSelection.test.ts`, `editor/shortcuts.test.ts`, new cases in `editor/Editor.test.tsx`

**Interfaces:**
- Consumes: Tasks 7 and 8 (commands, `BlockStyleMenu`), Task 5 (`useSettings`: `disableSpellcheck`, `disableNumberedListTransformation`; `registerShortcuts`, `keysFor`; `registerFlusher`), `@tiptap/suggestion@3.32.0`, M3's `fuzzyScore` (`links/LinkPicker.tsx`), M4's `api.createDailyNote` is **not** used (a daily-note link is a wikilink; the note need not exist yet), `api.createObject`, the types list (`useLinkIndex().types`), `typeOf`.
- Produces:
  - **Slash menu** (`/` anywhere in a text block; the query is the text typed after it; Escape or a space with no match closes): the filter is `fuzzyScore` over each item's name and description. Sections and items, in order:
    - "Create a block" (`CreateDropdown.sections.blocks.label`): "Text" (`blocks.TextBlock.name`), "Heading 1"–"Heading 4", "Small", "Bullet list", "Numbered list", "Alphabetical list", "Roman list", "To-do", "Toggle", "Quote block", "Group", "Icon", "Text" and "Background" colour items opening the colour lists (`ControlDropdown.custom.block_*.name`, each with its `.description` as the row's second line), "Two Columns", "Horizontal line", "Code", "Math", "Table" (`blocks.*.name` and `.description`), "Insert image", "Insert PDF", "Insert audio", "Insert video", "Insert file", "Create bookmark" (`pasteInput.*`).
    - "Create an object" (`CreateDropdown.sections.structure.label`): one item per type, "Create {structureTitle}" or, with a query, `Create {structureTitle} with title "{potentialTitle}"` (`ControlDropdown.structure.*`); it creates the object with `api.createObject(typeId, {title})` and inserts `[[Title]]` at the cursor.
    - "Link to a date" (`CreateDropdown.sections.dates.label`): "Today", "Tomorrow", "Yesterday" (`ControlDropdown.custom.entity_dailyNote_*`, inserting `[[YYYY-MM-DD]]`, the daily note's title), "Today - date link" (`token_date`, the same link inline), "Now – timestamp" (`token_time`, inserting the local time as text, `HH:mm` with `twentyFourHourTime`, else `h:mm AM/PM`).
    - "Reuse any content" (`ControlDropdown.reuseContent.heading`): opens `pickObjectEmbed()`.
    The footer hint is `press "/" to search` (`ControlDropdown.structure.slashCommand`); no match shows "No results" (`AppSettings.search.noResults`).
  - **Handles** (`BlockHandles`, one overlay per editor): on hover of any block (top level or inside a container), a drag handle (`ph-dots-six-vertical`) and a `+` (`ph-plus`) at its left, with the tooltips "**Drag** to move block around" and "**Click** to insert block below" (`RenderBlock.dragHandleTooltip`, `.plusHandleTooltip`; the `<b>` rendered as bold). `+` inserts an empty paragraph below and opens the slash menu in it. Clicking the drag handle selects the block and opens the block menu; dragging moves it (ProseMirror's own drag of a node selection, with M1's drop cursor), so `BlockSource`'s keep rule leaves its bytes intact.
  - **Block menu:** "Turn Into" (`tokensMenu.turnInto.name`: Text, Heading 1–4, Small, Bullet list, Numbered list, Alphabetical list, Roman list, To-do, Toggle, Quote block, Code), Task 8's "Hierarchy", "List", "Quote", "Color" and "Icon" menus, "Insert block above" / "Insert block below" (`BlockMenu.insertAbove`, `.insertBelow`), "Move up" / "Move down" (`tokensMenu.moveUp.shortName`, `.moveDown.shortName`), "Duplicate" (`EntityMenu.duplicateObject.text`), "Remove style" (`blocksMenu.operations.removeStyle`: clears every option) and "Delete" (`general.delete`). Each row shows its shortcut keys from the registry.
  - **Block selection** (`blockSelection` extension; plugin state `{anchor, head}` over sibling blocks, drawn as decorations with `--block-selection-bg` and `--block-selection-border`): Escape selects the block holding the cursor; Shift+Up/Down extend; Mod-a in a block selects all its siblings, again selects the top level; Backspace/Delete deletes the selection; Mod-c copies the selected blocks' **serialized source** (their original bytes when unedited) as `text/plain`, Mod-x cuts; Mod-d duplicates; Mod-Shift-Up/Down moves; Tab/Shift-Tab indent and unindent list items; typing replaces the selection with a paragraph; a click in text clears it. A small pill shows "{count} block | {count} blocks" (`EditorPanel.selectionStats.blocks`) while two or more are selected.
  - **Editor shortcuts:** `editor/shortcuts.ts` registers the editor-scope ids of the Global Constraints table (names from `shortcuts.<id>.name`, categories `shortcuts.categories.text` / `.block`, `provisional: true`) and `blockSelection` binds them through `addKeyboardShortcuts` from `keysFor(id)`, so correcting a key in `lib/shortcuts.ts`/this file needs no other edit.
  - **`Editor.tsx`:** renders `BlockHandles` and `SlashMenu`; `spellcheck` follows `disableSpellcheck`; `editorExtensions({numberedListInputRule: !disableNumberedListTransformation})`; registers its autosave's `settle()` with `registerFlusher` for its lifetime; the empty-body placeholder is "Write your text or search for blocks..." (`components.RootSpace.text.main.placeholder`).

- [ ] **Step 1: Write failing tests**
  - `test slash menu sections and item names match reference` (every name and description above, in order)
  - `test slash filter matches names and descriptions; no match shows No results`
  - `test each block item runs its command` (one case per item)
  - `test create object item creates with the query as title and inserts a link`
  - `test date items insert daily-note links and the timestamp in the chosen time format`
  - `test plus handle inserts a paragraph and opens the slash menu`
  - `test drag handle selects the block and opens the block menu with shortcut hints`
  - `test move via handle keeps the moved block's bytes` (serialize after a drag-move: the blocks reordered, each byte-identical)
  - `test turn into, insert above and below, move, duplicate, remove style and delete`
  - `test block selection: escape, shift arrows, select all twice, delete, duplicate, move, indent`
  - `test copy of selected blocks gives their original source`
  - `test editor shortcuts come from the registry and a changed key takes effect`
  - `test spellcheck and numbered list detection follow settings`
  - `test editor registers its flusher and unregisters on unmount`
- [ ] **Step 2:** Run `npx vitest run src/editor`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit && npm run lint`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(editor): slash menu, block handles and menu, block selection, shortcuts`.

### Task 13: Persistent and pinned tabs, tab menu, per-space tabs (lane: shell; first, once Task 5's commit is on the branch)

**Files:**
- Modify: `nav/tabs.ts`, `nav/recent.ts`, `App.tsx`
- Create: `shell/TabStrip.tsx` (moved out of `App.tsx`), `shell/TabMenu.tsx`, `shell/shortcuts.ts`
- Test: `nav/tabs.m7.test.ts`, `shell/TabStrip.test.tsx`, `shell/TabMenu.test.tsx`, `App.m7.test.tsx`

**Interfaces:**
- Consumes: M1–M4 `useTabs` (`tabs`, `activeId`, `open(target, {newTab})`, `back`, `forward`, `close`, `activate`, `newTab`, `retarget`), `sameTarget`, `TabLabel` (moves with the strip), Task 5 (`useGlobalShortcut`, `registerShortcuts`, `useSettings().settings.openOnStart`), `api.space()` (`root`).
- Produces:
  - `Tab` gains `persistent?: boolean`, `pinned?: boolean`, `crumbs: Target[][]` (one trail per history entry, parallel to `history`, Object's `breadcrumbs: string[][]`; Task 14 fills and renders it; here it is kept in step with `history` on open, back, forward and history trimming) and the side-panel fields Task 15 uses (`sidepanel?`, `sidepanelLayout?`, `hideSidepanel?`), typed now so the persisted shape changes once.
  - **Semantics** (`SpaceHeader.tabsExplanation`): a non-persistent tab (the default) navigates in place, as today; **in a persistent tab any new page opens in a new tab** (inserted right after it, non-persistent, active); back and forward stay in the tab. `togglePersistent(id)`, `pin(id)`, `unpin(id)`. Pinned tabs sort before the others (keeping their order) and have no close button; middle-click does not close them (our rule, flagged for Gene).
  - **Per-space storage:** `setTabsSpace(root)` switches the persist key to `object.tabs:<root>` and rehydrates (App calls it once `api.space()` resolves, before rendering content); the old global `object.tabs` key is migrated into the current space once and deleted. `nav/recent.ts` does the same with `object.recent:<root>`.
  - **`TabStrip`:** the M1 strip (moved), non-persistent titles in italic with the tooltip "Double click to make tab persistent." (`SpaceTab.doubleClickToPersist`); double-click toggles; a context menu with "Pin tab" / "Unpin tab" (`SpaceTab.*`) and "Close tab" (M1's label, our string); scroll buttons "Scroll tab list left" / "Scroll tab list right" (`SpaceHeader.scroll*`) when the tabs overflow; a "Tab menu" button (`SpaceHeader.tabList`).
  - **`TabMenu`:** a searchable list of the tabs ("Search tabs", "No tabs found": `SpaceHeader.*`); Enter activates.
  - **Start-up** (`EditorSettings.openOnStart.*`, per space from `settings.openOnStart[root]`): `lastOpenedPage` (the default: the restored tabs), `today` (the Calendar on today), `calendar` (the Calendar), `specificObject` (that object in the active tab).
  - `shell/shortcuts.ts` registers `closeTab`, `openNewTab`, `navigateTabs`, `openTabList`, `navigateBack`, `navigateForward` (provisional keys) and binds them with `useGlobalShortcut` in `App`.

- [ ] **Step 1: Write failing tests**
  - `test persistent tab opens new pages in a new tab` (inserted after it; back and forward stay)
  - `test non-persistent tab navigates in place` (regression guard, green from the start)
  - `test double click toggles persistent and italic`
  - `test pinned tabs sort first and have no close button`
  - `test crumbs stay parallel to history through open, back, forward and trimming`
  - `test tabs are stored per space root` and `test old global tabs key migrates to the current space once`
  - `test tab menu searches and activates; empty shows No tabs found`
  - `test scroll buttons appear on overflow`
  - `test open on start modes`
  - `test tab shortcuts close, open, cycle and navigate`
- [ ] **Step 2:** Run `npx vitest run src/nav src/shell src/App.m7.test.tsx`. Expected: FAIL (all but the regression guard).
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(shell): persistent and pinned tabs, tab menu, per-space tabs`.

### Task 14: Breadcrumbs (lane: shell)

**Files:**
- Create: `shell/Breadcrumbs.tsx`
- Modify: `nav/tabs.ts` (`open(target, {newTab?, via?: 'link'|'nav'})`), `App.tsx` (renders `Breadcrumbs` above the content), `create/createAndOpen.ts` (`openObject` hands `mods.via` to `useTabs().open`), `links/wikilinkPresenter.ts` (wikilink clicks pass `via: 'link'`; the type icon before inline links honours `hideEntityIconsOnInlineLinks`)
- Test: `shell/Breadcrumbs.test.tsx`, new cases in `nav/tabs.m7.test.ts`, `links/wikilinkPresenter.test.ts`

**Interfaces:**
- Consumes: Task 13 (`crumbs`), Task 5 (`useSettings`; `OpenMods.via?: 'link' | 'nav'`, which Task 5 adds to `create/createAndOpen.ts` as a type only, so Task 11's embed view can already pass `{...mods, via: 'link'}`), M3/M4 `openObject(path, mods, typeId)`.
- Produces:
  - **Trail rule:** opening with `via: 'link'` (a wikilink, an embedded object, a link inside the side panel) sets the new entry's trail to the current entry's trail plus the current target; `via: 'nav'` (the default: sidebar, tab menu, palette, start-up, calendar) starts an empty trail. Back and forward show each entry's own trail.
  - **`Breadcrumbs`:** when the trail is not empty, a row at the top of the main panel content: each crumb is its target's icon and title (as `TabLabel` shows them), separated by `ph-caret-right`, the current page last and not clickable; clicking a crumb navigates back to that history entry (the tab's `index` moves; no new entry). Long trails collapse the middle into "…" with a menu. The row's position and styling have no reference screenshot (flagged for Gene's check).

- [ ] **Step 1: Write failing tests**
  - `test link navigation extends the trail and sidebar navigation resets it`
  - `test back and forward show each entry's trail`
  - `test clicking a crumb goes back to it`
  - `test long trails collapse the middle`
  - `test wikilink click opens via link` and `test inline link icon follows the setting`
  - `test openObject passes via from its modifiers to the tabs store`
- [ ] **Step 2:** Run `npx vitest run src/shell src/nav src/links`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(shell): breadcrumbs per tab`.

### Task 15: The three-area side panel (lane: shell)

**Files:**
- Create: `shell/SidePanel.tsx`, `shell/SidePanelArea.tsx`, `shell/Resizer.tsx`, `nav/sidepanel.ts` (pure helpers over a tab's entries)
- Modify: `nav/tabs.ts` (side-panel actions), `App.tsx` (the side panel replaces `RightPanel` in `MainPanel`'s `aside`; the top-bar toggle drives it), `shell/RightPanel.tsx` (deleted; its one use is gone), `shell/MainPanel.tsx`, `create/createAndOpen.ts` (Shift → side panel; `alwaysOpenAsFullPage`), `object/ObjectView.tsx` ("Open in side panel" in the `…` menu's Open group; the two raw colours at its header buttons become `--chrome-btn-border`/`--bg-raised` tokens), `calendar/CalendarPage.tsx` and `calendar/CalendarSidePanel.tsx` (the calendar sidebar moves inside the Calendar page)
- Test: `nav/sidepanel.test.ts`, `shell/SidePanel.test.tsx`, `shell/Resizer.test.tsx`, new cases in `create/createAndOpen.test.ts`, `object/ObjectView.menu.test.tsx` (or the existing `…` menu test), `calendar/CalendarPage.test.tsx`

**Interfaces:**
- Consumes: Tasks 13–14, Task 5 (`useSettings`: `alwaysOpenAsFullPage`; `registerShortcuts`), M1 `ObjectView` (`mode='page'` renders inside an area), M4's `CalendarPage` (`rightPanelOpen`/`onToggleRightPanel` props from `App`) and `CalendarSidePanel`, M3's `api.patchUi` (`calendar.hideCalendarSidebar`), M5's side content (see "Reconcile before building").
- Produces:
  - **Model** (Object's `TabEntry`/`SidepanelEntry`, per tab): `SidepanelEntry {id, target: Target | null /* null = the empty "Explore" entry */, isOpen, panelArea: 'area1'|'area2'|'area3', isPersistent?}`; `Tab.sidepanelLayout {width?: number /* px, default 500, M1's width */, area2Size?: number, area3Size?: number /* fractions of the panel height */}`; `Tab.hideSidepanel`. Actions: `openInSidepanel(target, {area?: 'area1'|'area2'|'area3'})` (area 1 by default; replaces that area's open non-persistent entry, else adds a new open entry), `newSidepanelEntry(area)`, `closeSidepanelEntry(id)`, `activateSidepanelEntry(id)`, `moveSidepanelEntry(id, area)`, `swapWithMain(id)` (the entry's target and the tab's current target exchange places; the main side gets a new history entry), `setSidepanelLayout(patch)`, `toggleSidepanel()`.
  - **Layout** (no reference screenshot; flagged for Gene's check): the side panel is a column at the right of the main card behind a 1 px rule (M1's `RightPanel` place); each area with an open entry is shown stacked top to bottom (area 1, area 2, area 3); area 2 and area 3 take `area2Size`/`area3Size` of the height and area 1 the rest; a horizontal `Resizer` between areas and a vertical one on the panel's left edge (min 320 px, max 60 % of the window) write the layout on pointer up. Each area has a header: the entry's icon and title, "Browse sidepanel tabs" (`RenderSidepanel.tabList`: the entries of that area), "Swap" (`RenderSidepanel.swapWithMainWindow.button`, tooltip `.tooltip`), "Open as page" (`EntityMenu.navigateToEntity`), "Open sidepanel menu" (`RenderSidepanel.openSidepanelMenu`: move to area 1 / 2 / 3, our strings "Move to area 1" etc., and close), and a close button. "New Sidepanel Tab" (`RenderSidepanel.createNewSidepanelEntry`) adds an empty entry, which shows "Explore" (`RenderSidepanel.emptyState.title`) and "Open relevant content or view the graph view to expand the context of your work." (our string, adapted from `RenderSidepanel.emptyState.description` without the AI chat).
  - **Opening:** `openModeFor` returns `'sidepanel'` for Shift (Object's rule; M2/M4's "Shift opens the peek until the side panel exists" deviation ends); Alt+Shift stays the peek; Ctrl/Meta a new tab; with `alwaysOpenAsFullPage`, a plain click on a Task opens it as a page instead of the peek (`EditorSettings.alwaysOpenAsFullPage.description`). The `…` menu's Open group gains "Open in side panel" (`EntityMenu.openInSidepanel`). Links clicked inside a side-panel entry navigate that entry (with `via: 'link'` trails of its own: the entry keeps a small history; back and forward buttons in its header).
  - **Toggle:** the top-bar button (M1's, wired through `TopBar`'s existing `onToggleRightPanel`/`rightPanelOpen` props, which `App` now feeds from the active tab's `hideSidepanel`) toggles the panel; `toggleSidepanel` shortcut. Opening content while hidden shows the panel. (The button's tooltips become "Show sidepanel" / "Hide sidepanel" in Task 18, which owns `TopBar.tsx`.)
  - **Calendar sidebar:** `CalendarPage` renders `CalendarSidePanel` itself at its right edge, open unless `ui.calendar.hideCalendarSidebar`; its chrome button keeps M4's tooltips ("Hide calendar sidebar" / "Show calendar sidebar") and writes the key; `toggleCalendarSidebar` shortcut. `App` no longer passes `rightPanelOpen`/`onToggleRightPanel` and no longer renders `CalendarSidePanel`.

- [ ] **Step 1: Write failing tests**
  - `test shift click opens in side panel area 1` (and Alt+Shift still peeks, Ctrl a new tab)
  - `test open replaces a non-persistent entry and adds beside a persistent one`
  - `test areas stack, resize and persist per tab` (switching tabs shows each tab's own panel)
  - `test swap exchanges side panel entry and main target`
  - `test new sidepanel tab shows the Explore empty state`
  - `test entry header actions: browse, open as page, move area, close`
  - `test links inside an entry navigate the entry with its own back and forward`
  - `test top bar toggle and shortcut hide and show the panel per tab`
  - `test always open as full page opens tasks as pages`
  - `test object menu offers Open in side panel`
  - `test calendar sidebar lives in the calendar page and writes hideCalendarSidebar`
- [ ] **Step 2:** Run `npx vitest run src/nav src/shell src/create src/object src/calendar`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(shell): three-area side panel with resizing, swap and open in side panel`.

### Task 16: Light mode and the four themes (lane: look; after Task 5)

**Files:**
- Create: `theme/themes.css` (Light, Light Dimmed, Dark Dimmed, monochrome and font overrides), `theme/applyTheme.ts`, `theme/shortcuts.ts`, `theme/noRawColours.test.ts`
- Modify: `theme/tokens.css` (the new tokens' dark values; existing dark values unchanged; `body` uses `var(--app-font)`), `theme/palette.ts` (only if a helper must read a monochrome flag; CSS overrides are preferred), `index.css` (shadcn's `:root` neutrals become the same token mapping as `.dark`, so both modes use our tokens), `frontend/index.html` (an inline script applies the cached theme before first paint; `class="dark"` stays the no-cache default), `shell/GlobalOverlays.tsx` (applies the theme from `useSettings` and binds `toggleDarkMode`), `shell/Sidebar.tsx` (the footer's sun button toggles the mode with the tooltips "Dark mode" / "Light mode" (`SpaceOverview.setDarkMode`, `.setLightMode`); raw colours → tokens), `shell/PinnedSection.tsx`, `shell/SidebarSections.tsx`, `components/ui/dropdown-menu.tsx`, `components/ImagePicker.tsx` (raw colours → tokens)
- Test: `theme/themes.test.ts`, `theme/applyTheme.test.ts`, `theme/noRawColours.test.ts`, new cases in `shell/Sidebar.test.tsx`

**Interfaces:**
- Consumes: Task 5 (`useSettings`, `registerShortcuts`, `useGlobalShortcut`), the token mapping table (Global Constraints), `themes.ts`/`colors.ts`.
- Produces:
  - `themes.css`: `html[data-theme='light']`, `[data-theme='lightDimmed']`, `[data-theme='darkDimmed']` blocks overriding **every** token in `tokens.css` (the dark block stays the default under `:root`); `html[data-mono-tags]` maps every `--tag-bg-<c>`/`--tag-text-<c>` to gray's; `html[data-mono-type-labels]` maps every `--type-<c>-*` to gray's; `html[data-font='serif'|'monospace']` sets `--app-font` to M2's `--object-font-serif`/`--object-font-monospace` (Georgia, Courier New: `AppearanceSettings.font.*`). A comment at the top records the mapping and the source files.
  - `applyTheme(settings, root = document.documentElement)`: `data-theme` = `themeMode === 'light' ? lightTheme : darkTheme`, the `dark` class only for the dark themes (so Tailwind `dark:` variants keep working), `data-mono-*`, `data-font`; it writes the result to `localStorage` `object.theme` (try/catch); `index.html`'s inline script reads that cache (try/catch) and sets the same attributes before the bundle loads.
  - `theme/shortcuts.ts` registers `toggleDarkMode` (provisional key); toggling flips `themeMode` through `useSettings().patch`.
  - `noRawColours.test.ts`: scans `src/**/*.{ts,tsx,css}` (tests and `theme/` excluded) for hex, `rgb(a)(`, `hsl(a)(` and `oklch(` literals; a file whose first line carries the `colour-literals: content palette` marker is skipped; a `PENDING` list names files other lanes still have to convert (`object/ObjectView.tsx`, Task 15) and Task 19 empties it.

- [ ] **Step 1: Write failing tests**
  - `test every dark token is defined in every theme` (parse both CSS files; every custom property of the dark `:root` block appears in each of the three theme blocks)
  - `test light token values follow themes.ts` (spot checks: light `--bg-panel` is `oklch(1.0000 0.0001 263.28)` (gray 0), light `--bg-app` `oklch(0.9856 0.0016 67.00)` (gray 50), light `--text` `oklch(0.2191 0.0058 285.84)` (gray 900), Light Dimmed `--bg-panel` `oklch(0.9916 0.0016 67.00)` (gray 25), Dark Dimmed `--bg-panel` `oklch(0.2574 0.0056 285.92)` (gray 850), and one colour token per mapping row)
  - `test existing dark token values are unchanged` (regression guard, green from the start: the dark values of M1–M6 tokens byte-equal the baseline)
  - `test theme attribute and dark class follow settings` (all four themes, monochrome flags, fonts)
  - `test first paint applies the cached theme` (the inline script with a cached value; with none, dark)
  - `test sidebar sun button toggles the mode with reference tooltips` and `test toggle dark mode shortcut`
  - `test no raw colour literals outside theme files`
- [ ] **Step 2:** Run `npx vitest run src/theme src/shell`. Expected: FAIL (all but the regression guard).
- [ ] **Step 3:** Compute the three themes' values from `themes.ts` + `colors.ts` with a throwaway script outside the repo (as the strings flattening is done), write `themes.css`, then implement the rest as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit && npm run build`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(theme): light, light dimmed and dark dimmed themes from Object's tokens`.

### Task 17: Settings modal (lane: look)

**Files:**
- Create: `settings/SettingsModal.tsx`, `settings/sections/{Appearance,Editor,DateTime,Notifications,SpaceSettings,ObjectTypes,TaskManagement}.tsx`, `settings/ShortcutsSheet.tsx`, `settings/useSettingsModal.ts` (open state and the requested section)
- Modify: `shell/GlobalOverlays.tsx` (mounts the modal and the sheet; binds `openSettings` and `toggleShortcutsMenu`), `shell/Sidebar.tsx` (the footer gear opens the modal, tooltip "Settings" (`SpaceOverview.settings.tooltip`); the Tasks item is hidden while `hideTaskManagement`), `properties/format.ts` (dates and times follow `twentyFourHourTime` and `dateFormatting`)
- Test: `settings/SettingsModal.test.tsx`, one test file per section, `settings/ShortcutsSheet.test.tsx`, new cases in `properties/format.test.ts` and `shell/Sidebar.test.tsx`

**Interfaces:**
- Consumes: Task 5 (`useSettings`, `api.space`/`api.patchSpace`, `allShortcuts`, `useGlobalShortcut`), M3/M4's `api.ui`/`api.patchUi` (`calendar.weekStart`, `reminders.enabled`), M2's `IconPicker`, the types list, `useTabs().open` (Object Types rows open Type Settings).
- Produces:
  - **Modal layout** (README's description of `03-settings-account.png`): a left nav (~340 px) with "Search settings" (`AppSettings.search.placeholder`; filters sections by heading and option labels; "No results"), group headings and section rows; the content shows an icon tile, the section heading and description, then sections with a bold title, muted help and the control. Title "Settings" (`AppSettings.heading`). Changes save immediately (device settings through `useSettings().patch`, `ui.json` keys through `api.patchUi`, space keys through `api.patchSpace`); a 409 reloads and re-applies once.
  - **General** (`general.general`):
    - "Appearance" (`AppearanceSettings.heading`, `.description`): "Theme" (`ThemeMenu.heading`; description "Define the theme you want to use for Object" (our string, adapted from `ThemeMenu.description`)) with "Light" / "Dark" (`ThemeMenu.options.*`); "Light theme" and "Dark theme" (`AppearanceSettings.theme.light.*`, `.dark.*`) with "Light"/"Light Dimmed" and "Dark"/"Dark Dimmed" and their descriptions (`AppearanceSettings.theme.themes.*`); "Font" (`AppearanceSettings.font.heading`; description: our string, adapted from `.font.description` without the per-object sentence) with "Sans Serif", "Serif", "Monospace" and their descriptions; "Colors" (`AppearanceSettings.colors.*`) with "Monochrome type labels" and "Monochrome tags".
    - "Editor" (`EditorSettings.heading`; description "Manage your preferences for how the editor of Object should work." (our string, adapted)): "Toggle style" ("Toggle"/"Bullet"), "Disable automatic detection of numbered lists", "Disable spellcheck", "Always open as full page", "Show object type icon for inline object links" (switch on = `hideEntityIconsOnInlineLinks: false`), "Hide outliner lines", "When this space opens" ("Where I left off", "Calendar today", "Calendar", "Specific object" with "Select object"), and "Space on this device" ("Last opened space", "Specific space"; under the heading "When Object starts", our string adapted from `EditorSettings.startup.label`) (labels and descriptions from `EditorSettings.*`).
    - "Date & Time" (`DateAndTimeSettings.*`): "Start of the week" (Monday / Sunday → `ui.calendar.weekStart`), "24-hour time", "Date formatting" ("Localized", "day-month-year", "month/day/year", "year-month-day (ISO 8601)").
    - "Notifications" (`NotificationsSettings.heading`; description: our string "Control reminder delivery on this computer.", adapted): "Activate notifications" (`NotificationsSettings.activation.heading` → `ui.reminders.enabled`), and the limits note "Notifications only work while Object is open" / "Reminder banners appear on this computer only while Object is running." (our strings, adapted from `deliveryLimits.desktop.*`).
  - **Space** (`AppSettings.currentSpace.label`):
    - "Space Settings" (`CurrentSpaceSettings.heading`; description "Modify global properties of your space." (our string, adapted)): "Name", "Icon", "Description" with their headers and placeholders (`SpaceDashboard.general.spaceName.*`, `.spaceIcon.*`, `.spaceDescription.*`).
    - "Object Types" (`StructureGeneralSettings.heading`, `.explanation`): "Your object types" (`contentTypes.heading`, `.explanation`), grouped "Basic object types" / "Custom object types" (`StructureSettings.*`); a row opens that type's Type Settings tab and closes the modal.
    - "Task management" (`TaskManagementSettings.heading`, `.description`): "Hide Task Management" with its description and info (`hideTaskManagement.*` → `space.json`), and "Task Object Customization" with "Open settings" (`taskObjectCustomization.*`, opening the Task type's settings).
  - **`ShortcutsSheet`** ("Shortcuts", `ShortcutsCheatSheet.tooltip`): every registered shortcut grouped by `shortcuts.categories.*`, name and keys, provisional keys marked with a small "unverified" tag (our string) until Gene confirms; opened with `toggleShortcutsMenu` and from a "Shortcuts" row at the bottom of the settings nav.
  - `properties/format.ts`: `formatTime`/`formatDateTime` use 24-hour time when set; `dateFormatting` `DMY`/`MDY`/`YMD` switch the numeric date order (`localized` keeps today's output byte for byte).

- [ ] **Step 1: Write failing tests**
  - `test settings nav groups and section headings match reference`
  - `test search filters sections and shows No results`
  - `test appearance controls patch device settings` (mode, light and dark themes, font, monochrome)
  - `test editor controls patch device settings; show icons switch is inverted`
  - `test start of the week and notifications patch ui.json keys`
  - `test space settings patch space.json and refresh the space name`
  - `test object types rows open type settings`
  - `test hide task management hides the Tasks sidebar item`
  - `test shortcuts sheet lists every registered shortcut by category with unverified tags`
  - `test gear, openSettings and toggleShortcutsMenu open the modal and the sheet`
  - `test date and time formats follow settings; localized output unchanged`
- [ ] **Step 2:** Run `npx vitest run src/settings src/shell src/properties`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(settings): settings modal with appearance, editor, date and time, notifications, space and task options`.

### Task 18: Spaces: switcher, create, open, rename, remove (lane: look)

**Files:**
- Create: `spaces/SpacesMenu.tsx`, `spaces/CreateSpaceDialog.tsx`, `spaces/switchSpace.ts`
- Modify: `shell/TopBar.tsx` (the space button opens `SpacesMenu`, tooltip "Change space" (`SpaceOverview.changeSpace.tooltip`); the `+` button's label becomes "Create new tab" (`SpaceHeader.createNewTab`); the right-panel button's label becomes "Hide sidepanel" / "Show sidepanel" (`RenderSidepanel.hideSidepanel`, `.showSidepanel`) from its `rightPanelOpen` prop), `shell/GlobalOverlays.tsx` (mounts the dialog and the switching overlay)
- Test: `spaces/SpacesMenu.test.tsx`, `spaces/CreateSpaceDialog.test.tsx`, `spaces/switchSpace.test.ts`, new cases in `shell/TopBar.test.tsx`

**Interfaces:**
- Consumes: Task 5 (`api.spaces`, `createSpace`, `openSpace`, `removeSpace`, `switchSpace`, `space`, `patchSpace`; `flushAll`), Task 17 (`useSettingsModal().open('space')`).
- Produces:
  - **`SpacesMenu`** ("Spaces", `SpacesMenu.heading`): one row per registered space (icon, name, a check on the current one, muted when `missing`); clicking another switches to it; each row's `…` has "Rename" (`general.rename`, current space only: an inline name field writing `api.patchSpace`) and "Remove" (`MultiSpacePicker.remove`, not on the current space; removes it from the list, the folder stays: confirmation text "Object forgets this space. Its folder and files stay where they are." (our string)). Below: "Space settings" (`SpacesMenu.spaceSettings`, opens the Settings modal on Space Settings), "Add space" (`components.RootSpace.addSpace`) opening `CreateSpaceDialog`, and "Open folder…" (our string: a path field, then `api.openSpace`).
  - **`CreateSpaceDialog`** ("Create new space", `OnboardingSpace.heading`): "Name your space" (`OnboardingSpace.intro`) with the placeholder "Name" (`OnboardingSpace.namePlaceholder`), "Location" (our string; default the parent folder of the current space), the explanation "Do I need a new space?" / "Only if this work should stay isolated. You cannot link notes across spaces." (`OnboardingSpace.explain.*`), "Cancel" and "Create space" (`general.cancel`, `components.RootSpace.create`). Create calls `api.createSpace`, then offers to switch (the switch flow below). A 409 shows "A folder with that name already exists here." (our string).
  - **`switchSpace(path)`:** `await flushAll()` (every open editor saves first; a failure stops the switch and shows the error), then `api.switchSpace(path)`, then an overlay "Switching space…" (our string) while it polls `api.space()` every 200 ms (up to 15 s) until `root` equals `path`, then `window.location.reload()`; a timeout shows "The space didn't open. Try again." (our string) and stays on the current space if it still answers.

- [ ] **Step 1: Write failing tests**
  - `test spaces menu lists spaces, marks current and missing`
  - `test rename current space patches space.json`
  - `test remove asks, removes from the list only and is not offered for the current space`
  - `test create dialog validates, creates and offers to switch; 409 message`
  - `test open folder registers an existing folder`
  - `test switch flushes editors, posts switch, waits for the new root and reloads`
  - `test switch stops when a flush fails` and `test switch timeout message`
  - `test top bar space button, create new tab label and sidepanel tooltips`
- [ ] **Step 2:** Run `npx vitest run src/spaces src/shell`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit && npm run lint && npm run build`. Expected: PASS, clean.
- [ ] **Step 5:** Commit `feat(spaces): switch, create, open, rename and remove spaces`.

### Task 19: Milestone acceptance (lane: integrate; after Tasks 1–18)

**Files:**
- Create: `scripts/m7_acceptance.py`, `docs/superpowers/plans/m7-acceptance.md`
- Modify: `theme/noRawColours.test.ts` (empties `PENDING` once every listed file is converted), `docs/superpowers/plans/remaining-work.md` (the M7 rows only)

- [ ] **Step 1:** Run `uv run pytest backend/tests -q` and `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run lint && npm run build`. Expected: all green. Empty `noRawColours.test.ts`'s `PENDING` list and re-run it; check that wikilinks and embedded objects both open with `via: 'link'` (Tasks 11 and 14).
- [ ] **Step 2:** Write `scripts/m7_acceptance.py SPACE [--keep]` (run as `uv run python scripts/m7_acceptance.py SPACE`). Like `m4_acceptance.py`, it works on a temporary git-committed copy, sets `OBJECT_STATE_DIR` and `OBJECT_FAKE_OPEN_FILE` to temp paths, and starts the server on a free port. Over HTTP it checks:
  1. Starting twice and calling every M7 read route (`GET /api/space`, `/api/settings`, `/api/spaces`, `/api/attachments`, `/api/file` for one file of each kind) changes no file (`git status` clean); no `space.json` or `settings.json` appears; the state dir holds only `spaces.json` (and M4's ledger if a reminder fired, which none does here).
  2. Uploading a PNG, a PDF, a WAV and an XLSX creates exactly those files under `Attachments/`; a second upload with the same name adds ` (2)`; `GET /api/file` returns each with the contract's headers; a `Range` request on the WAV is 206; an uploaded `.html` comes back as an octet-stream download; `POST /api/attachments/open` records the PDF with the fake opener and refuses an `.exe` with 415.
  3. `PUT /api/space` with a new name changes only `.object/space.json` (created if absent); the folder name is unchanged; a stale revision is 409.
  4. `PUT /api/settings` writes only `settings.json` in the state dir; the space is unchanged.
  5. Spaces: `POST /api/spaces` in a temp location creates a folder holding only `.object/space.json`; a second create is 409 and leaves the folder byte-identical; `DELETE /api/spaces` removes it from the list and the folder stays; a `SpaceHost` on a free port switches to it and `GET /api/space` reports its root.
  6. The editor round trip: `cd frontend && OBJECT_ROUNDTRIP_SPACE=<copy> npx vitest run src/editor/roundtrip.space.test.ts` reports 0 differences (every body byte-identical without edits; every annotated block's option toggled on and off restores the bytes).
  7. The M1 no-edit pass over HTTP: 0 files changed.
- [ ] **Step 3:** Run it on `backend/tests/fixtures/space-blocks`, `space-sample`, `space-v1` and `space-calendar` (and the M5/M6 fixture spaces, if any). Expected: every check prints `[ok]`.
- [ ] **Step 4:** Run `npm run build`, then `uv run objectapp --space <copy of space-blocks>`, and walk through: every block kind from the slash menu (and its menus), drag and `+` handles, block selection and copy, a toggle opened and closed with `git diff` showing one line, columns resized, a table's header row and column, a Mermaid diagram and a formula in light and dark, an image resized with a caption, a PDF, audio and video, a file opened with the OS, an embedded object switched between its four views, files pasted and dropped; tabs (persistent, pinned, the tab menu), breadcrumbs, the side panel (Shift+click, three areas, resizing, swap, the calendar sidebar inside the Calendar); all four themes on every screen; every Settings section; creating, renaming, switching and removing a space. Record anything that differs from this plan in `m7-acceptance.md`.
- [ ] **Step 5:** Write `m7-acceptance.md` with Gene's hand-check list, to run on his CPI copy outside the repo with `git init` done there:
  - opening his space changes no file; his existing notes with HTML comments, Mermaid fences and `$` signs keep their bytes (`git status` clean after opening and scrolling every note); editing one block changes only its lines
  - **the shortcut keys:** compare each provisional key in the Shortcuts sheet with Object and list the ones that differ (the reconcile pass fixes them in `lib/shortcuts.ts` and the editor registry)
  - the unverified designs, each against Object: the side panel's area layout, breadcrumbs' position and look, pinned tabs' look, the code-preview default ("Display"), the column add/remove controls, the PDF default height, the slash menu's grouping and look, the block menu's look
  - **the final side-by-side fidelity pass on every screen, in dark and in light** (Light and Dark; Light Dimmed and Dark Dimmed once each): the app shell and sidebar (section headings, "+ New" and search, footer), the tab strip and tab menu, breadcrumbs, the side panel, the object page in each layout (standard, profile, index card, encyclopedia) and the peek with its pager and property panel, the `…` menus, the editor (every block kind, the slash menu, handles, the block menu, block selection), the type page (Overview and All, every view layout: list, grid, wall, table, embed, kanban, gallery), filters, sorts and group-by popovers, card settings, collections and their pages, queries and the Queries page, All notes, Trash, Object Type Settings and the property menus, the Calendar (Month, Week, Three days, Day, the mini month and the calendar sidebar), the Tasks page (list and kanban), the command palette, search and find in page (M5), the references section and the graph (M5), whiteboards and pen (M6), the Settings modal (every section), the spaces menu and the create-space dialog. For each screen note what differs (spacing, colour, label, behaviour) so one fix pass can follow.
- [ ] **Step 6:** Update the M7 section of `remaining-work.md` to "built" with what Task 19 found, then commit `chore: milestone 7 acceptance`.

## Build lanes

Each lane runs its "first" tasks in order, then its sub-lanes in parallel (each in order). Lanes run side by side; the only cross-lane waits are on Task 5's commit (noted on Tasks 8, 11, 12 and 13).

| Lane | First (in order) | Then sub-lanes (parallel, each in order) | Files it owns (summary) |
|---|---|---|---|
| **A: backend** | 1 → 2 → 3 → 4 | (none) | `backend/**`, `scripts/` (Task 19 adds the acceptance script) |
| **B: editor** | 6 → 7 | **B1:** 8 → 12 · **B2:** 9 · **B3:** 10 · **B4:** 11 | `frontend/src/editor/**`, `links/LinkPicker.tsx` |
| **C: shell** | 13 → 14 → 15 | (none) | `nav/**`, `App.tsx`, `shell/{TabStrip,TabMenu,Breadcrumbs,SidePanel,SidePanelArea,Resizer,RightPanel,MainPanel,shortcuts}`, `create/createAndOpen.ts`, `links/wikilinkPresenter.ts`, `object/ObjectView.tsx`, `calendar/CalendarPage.tsx`, `calendar/CalendarSidePanel.tsx` |
| **D: look** | 5 → 16 → 17 → 18 | (none) | `api/**`, `test/mockApi.ts`, `main.tsx`, `lib/**`, `settings/**`, `theme/**`, `index.css`, `frontend/index.html`, `shell/{GlobalOverlays,Sidebar,PinnedSection,SidebarSections,TopBar}.tsx`, `components/ui/dropdown-menu.tsx`, `components/ImagePicker.tsx`, `properties/format.ts`, `spaces/**` (and the `OpenMods.via` type in `create/createAndOpen.ts`, Task 5) |
| **integrate** | 19 (after every lane) | | `scripts/m7_acceptance.py`, `docs/superpowers/plans/m7-acceptance.md`, `remaining-work.md`, `theme/noRawColours.test.ts` (its `PENDING` list) |

Workflow args (for `scripts/workflows/object-milestone-build.js`, which takes tracks): `{"plan":"docs/superpowers/plans/2026-10-26-m7-blocks-lightmode-polish.md","base":"<HEAD sha after the deps commit>","backend":[1,2,3,4],"frontend":[5,6,7,8,9,10,11,12,13,14,15,16,17,18],"integrate":19,"milestone":"Milestone 7","perTaskReview":false}`, with the frontend split into the lanes above when the script's track support allows (B's sub-lanes B1–B4 after Task 7; C and D beside B).

## Reconcile before building

M4 is being built while this plan is written, and M5 and M6 build before M7. Before any M7 task starts, re-read what they produced and correct this plan (names, files, test baseline, and anything below), recording each change in "Change history":
- **M4:** `CalendarPage`'s props and `App`'s right-panel wiring (Task 15 moves the calendar sidebar into the page); `_UI_PATCH_KEYS`/`_ui_problem` for `calendar` (Task 3 adds `hideCalendarSidebar`); `reminders._state_dir` (Task 3 delegates it); the Task "Date" picker's time display (Task 17's `format.ts` change must not alter M4's stored values, only display); `ObjectView`'s modes (`inline` exists; Task 15 adds the menu item); `createAndOpen`'s Shift rule.
- **M5:** the graph's colours under light mode (M5 renders with `sigma` 3.0.3 on a canvas, so its node, edge and label colours must read tokens through `getComputedStyle` and repaint on a theme change; Task 16's acceptance covers it); where the local graph, the references/backlinks views and the command palette live. If M5 put the local graph or references in the right panel, they become side-panel entry kinds in Task 15 (`target` gains `{kind: 'localGraph'}` etc.); the palette's "switch space" and "toggle panels" commands call Task 18's `switchSpace` and Task 15's `toggleSidepanel`; M5's shortcuts (Ctrl+K, Ctrl+F) move into `lib/shortcuts.ts` and the provisional keys here must not collide with them. If M5's FTS indexing reads bodies, check that annotation lines and `$$` fences are skipped like Task 2's preview.
- **M6:** whiteboard canvas colours under light mode (Task 16: the canvas, grid, selection and default shape colours get tokens; content palettes take the `colour-literals` marker; M6 builds on `@xyflow/react` 12.12.0, whose `colorMode` follows the theme); whiteboard pages inside a side-panel entry (Task 15); M6's keyboard shortcuts in the registry; whether M6 added an attachment or SVG route that Task 2's `GET /api/file` must stay compatible with.
- **All:** the test baseline counts; any new file in `editor/` (Task 7 owns `document.ts`, `blockSource.ts`, `preserve.ts`); any new raw colour literals (Task 16's `PENDING` list or the marker); the `@tiptap/*` version the deps commit must match.

## Change history

- **2026-10-26:** written against `a8e0d7f` (M4 mid-build) and the M4 plan (the M5/M6 dependency commit `ccfb23d` adds no package M7 needs); M5 and M6 plans were being written at the same time and are not yet reflected (see "Reconcile before building").
