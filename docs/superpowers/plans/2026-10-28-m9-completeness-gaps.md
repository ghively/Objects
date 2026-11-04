# Object, Milestone 9: Completeness Gaps. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal.** On 2026-10-28 Gene approved building every row of the "Completeness gaps" table in `audit-2026-10-28.md`, plus one reversal (whiteboard edits bump `lastUpdated`). M9 delivers:
- **Objects:** Duplicate, Text Stats, Export (local Markdown, optionally a zip with media) in the object `…` menu; a page **Floating Inspector** (Outline, Stats); a per-object **wide layout** and **wide cover** override; **reposition cover image**.
- **Properties:** the `textBlock` ("Text") property edits with formatting and `[[links]]`; the `blocks` ("Content") property uses the block editor; template **date variables** ("Day of creation" …) in the date cell; the "searchable" flag in property settings.
- **Editor:** embedded collection and query views keep their own layout, filters, sorts and group (`localDataViewInfo`); an "Alignment" entry in the block menu.
- **Views and space:** the row context menu and multi-select on type and query pages; **Import CSV** on a type page; type-constrained query tabs with "release constraint"; the sidebar's `workspaceOrder`.
- **App:** a "Recalculate content index" control; whiteboard edits bump the board's `lastUpdated`.

**Two items are a confirmation, not a feature**, because the target behaviour has no such feature:
- **Custom label as status:** a user cannot turn a label into a status. Task 15 confirms this and keeps today's behaviour.
- **Default collection and `defaultPageViewId`:** there is no user-facing behaviour here that Object lacks. See "Coverage" and "Decisions for Gene".

**Architecture.**
- **One contract task, then five lanes** with disjoint files: **B** back end, **O** object page, **E** editor and rich property cells, **P** properties and settings, **V** views and sidebar. An **integrate** task follows.
- **Task 1 owns the three shared client files** (`api/types.ts`, `api/client.ts`, `test/mockApi.ts`) and writes every M9 type and method once. After Task 1, no other task edits them.
- **Lane B owns every back-end file**, in one sequential lane (all its tasks touch `server.py` or `space.py`).
- **`object/ObjectView.tsx` and `object/PageLayout.tsx` belong to lane O only.** `TypePage.tsx`, `views/DataView.tsx` and `shell/Sidebar.tsx` belong to lane V only.

**Dependencies: none new.** The plan uses only what is already installed or built in:
- `Intl.Segmenter` (Chromium, WebView2 and Node 22) for text stats.
- Python's stdlib `zipfile` for the media export.
- A small RFC 4180 CSV parser for Import CSV (~40 lines; the inverse of `editor/table/csv.ts` `toCsv`).

Considered and not added: `papaparse` (the parser is small), `jszip`/`fflate` (the zip is built server-side with `zipfile`).

**Spec:** `docs/superpowers/specs/2026-10-23-object-design.md` §2 (in scope: everything the app does with objects and properties locally; out of scope: AI, sync, accounts, mobile, telemetry, network), §3, §4 (plain Markdown first, never write on read, edits change only their own lines), §5.

**Labels and behaviour.** The behaviour catalog (`docs/behavior-catalog.md`) and the design spec. Every quoted label below is verbatim unless it is marked "our string".

## In-flight branches: start condition

Four fix branches (from the 2026-10-28 check of guessed values) are open while this plan is written, and they edit files M9 needs:

| Branch (worktree) | Files that M9 also needs |
|---|---|
| shortcuts (`worktree-agent-adad4e41c4a8ae615`) | `editor/extensions/blockSelection.ts`, `editor/document.ts`, `lib/shortcuts.ts`, `shell/Sidebar.test.tsx`, `settings/SettingsModal.test.tsx` |
| slash and block menu (`worktree-agent-af4a68fa6bca70397`) | `editor/handles/BlockMenu.tsx`, `editor/menus/BlockStyleMenu.tsx` (+ tests) |
| side panel, breadcrumbs, tabs, layout, dashboard (`worktree-agent-ad803535eb07be3af`) | `object/PageLayout.tsx` (+ test), `types/TypeOverview.tsx`, `types/TypePage.test.tsx`, `types/dashboardSections.ts`, `shell/MainPanel.tsx` |
| search highlight and graph (`worktree-agent-a05a7e0edb3722254`) | `api/types.ts` (uncommitted), `index.css` |

**Rule:** Task 1 starts only when all four are merged into `master` and `master`'s gate is green. Task 1's Step 1 checks this. Because every other task waits for Task 1, nothing in M9 can race those branches.

The lanes that need the merged versions are:
- **E** (Task 12: the block menu)
- **O** (Tasks 6 and 7: `PageLayout.tsx`)
- **V** (Tasks 17 and 20: `TypeOverview.tsx` and the dashboard; Task 21: the sidebar)

Each of those tasks re-reads its files at the merged `master`, not at `fb931dc`, where this plan was written.

## Global Constraints

Carried forward unchanged from M1–M8 (see the M8 plan "Global Constraints"):
- `127.0.0.1` only, and no outbound network at runtime. Export downloads from our own server.
- **Never write on read.** Export, text stats, the inspector and reindex status write nothing inside the space.
- Property edits change only their own lines. Deletes go to the trash. Writes are atomic and keep CRLF/BOM.
- 409 on a stale `baseVersion`, 428 for destructive confirmations, 422 for bad shapes.
- Every write announces `ChangeEvent(origin=clientId)`.
- Byte preservation of untouched blocks is sacred: a no-edit save is byte-identical.

Also carried forward:
- **Tests:** every task writes its tests first (TDD) and runs only its own tests plus those of the modules it touched. Full suites run at Task 22.
  - Back-end tests use `tmp_path` or the copied fixture spaces (`m8_space_dir`, `blocks_space_dir` …). They never assert absolute fixture counts and rely on `conftest.py`'s autouse state, cache and clock isolation.
  - Front-end tests mock `api` through `test/mockApi.ts`. **No task edits `properties/cells/cells.test.tsx`**; new cell tests go in new files.
  - The 1MB split timing test is load-sensitive: rerun it alone before calling it a failure.
- **Commits:** each task commits only its own files, by explicit path. On `index.lock`, wait and retry. The message is the subject line, a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or whichever model made the commit).
- **Fidelity:** labels, keys, defaults and orders come from the behaviour catalog and the design spec. Anything they don't define is marked **"our choice"** or **"our string"** and listed in Task 22's hand-check.
- **Review once, at the end:** no per-task review. After Task 22: one whole-milestone review (correctness, file safety, fidelity), one fix pass, then the gate.

### Storage (new on-disk keys)

| What | Where | Form | Notes |
|---|---|---|---|
| Per-object wide layout | object frontmatter `wideLayoutMode: true\|false` (absent means the type's default) | YAML bool | |
| Per-object wide cover | object frontmatter `wideCoverImage: true\|false` (absent means the type's default) | YAML bool | |
| Cover position | object frontmatter `coverImageOffset: 0–100` (y percent; absent means 50) | YAML number | Only the offset is stored. A changed image drops the offset: Object removes the key in the same write that changes `coverImage` (our choice) |
| Embed view state | the embed's annotation option `localDataViewInfo="<JSON>"` on the `<!-- block: … -->` line before `![[collection:<id>]]` / `![[query:<id>]]`, written only after the first view change in the embed | M7 annotation grammar, one quoted option | `{viewDefinition, filterGroup, sorts, groupBy}` |
| Template date variable | template frontmatter on a `datetime` property: `{creation:day\|week\|month\|year}` (**already built** in `templates.py`; M9 adds only the UI and the write rule) | text | |
| Searchable | type JSON `propertyDefinitions[].isNotSearchable: true` (absent means searchable; **already honoured** by `searchtext.py:144-147`) | JSON | |
| Sidebar section order | `ui.json` `workspaceOrder: ["objects", "pinned", "<sectionId>", …]` | JSON | |
| Inspector pinned | `localStorage` (per viewer, like the whiteboard inspector) | | |

## API contract (M9)

| Route | Request | Response | Errors | Owner |
|---|---|---|---|---|
| `POST /api/object/duplicate` | `{path}` | 201 `{path, version, summary}`; announces `created` | 404 unknown path; 422 for a daily note, template, whiteboard or read-only file ("This object can't be duplicated.", our string) | Task 2 |
| `GET /api/object/export?path=&media=0\|1` | | `media=0`: 200 `text/markdown; charset=utf-8`, `Content-Disposition: attachment; filename="<stem>.md"`, the file's bytes exactly as on disk. `media=1`: 200 `application/zip` `<stem>.zip` holding `<stem>.md` plus every image and attachment the file references, at their space-relative paths. Writes nothing | 404; 400 for a path outside the space | Task 3 |
| `PUT /api/object/properties` (rule) | a `datetime` value `{creation:<var>}` | accepted only on a template file (`template:` key) | 422 on a non-template, or an unknown `<var>` | Task 4 |
| `PUT /api/object/properties` (rule) | `wideLayoutMode`, `wideCoverImage` (bool or null), `coverImageOffset` (number 0–100 or null) | null removes the key; setting `coverImage` also removes `coverImageOffset` in the same write | 422 for a wrong type or out of range | Task 4 |
| `PUT /api/ui` (extended) | `workspaceOrder: string[]` | as today | 422 not a list of strings, or duplicates | Task 4 |
| `PUT /api/whiteboard`, `PUT /api/whiteboard/ink` (extended) | as today | gains `mdVersion` (the board `.md`'s version after a `lastUpdated` bump, else its current version) | as today | Task 5 |
| `POST /api/search/reindex` | (exists, M5) | 202 `{started: true}` | | — |

**Client (Task 1 only):**
- In `api/client.ts`: `api.duplicateObject(path): Promise<{path, version, summary}>` and `api.exportObjectUrl(path, {media}): string`, a same-origin URL builder; the download is an `<a href download>`, never `fetch`.
- In `api/types.ts`:
  - `UiState.workspaceOrder?: string[]`
  - `WhiteboardSaveResult.mdVersion?` goes in `api/whiteboardTypes.ts`, but that file is Task 5's, not Task 1's.
  - `ObjectFrontmatterLayout = {wideLayoutMode?, wideCoverImage?, coverImageOffset?}`
- In `test/mockApi.ts`: the mock returns valid empty shapes.

## Review focus (for the single end review)

1. **File safety.**
   - Duplicate writes one new file and changes nothing else.
   - Export and every read write nothing.
   - Per-object layout and cover edits change only their own frontmatter lines.
   - An embed's view change rewrites only that embed's annotation line.
   - A board save changes only the `lastUpdated` line of the `.md`, at most once a minute.
   - Import CSV only creates files.
   - Tests: Tasks 2, 3, 4, 5, 11 and 19 (named below); Task 22 runs the round-trip harness.
2. **Fidelity.** The strings are verbatim. Every "our choice" is listed for Gene.
3. **No network.** Export and Import are local only. Task 22 extends `noNetwork.m8.test.ts` to M9 files.

## File structure

```
backend/objectapp/ space.py server.py                                          MOD (Tasks 2, 3, 4, 5 in order)
                   export.py                                                   NEW (Task 3)
                   typedefs.py uistate.py                                      MOD (Task 4)
                   whiteboardstore.py whiteboardapi.py                         MOD (Task 5)
backend/tests/     test_duplicate.py (2) test_export.py (3) test_m9_props.py (4) test_whiteboard_m9.py (5)
frontend/src/api/{types,client}.ts test/mockApi.ts                             MOD (Task 1 only)
frontend/src/object/ textStats.ts PageInspector.tsx (6) CoverImage.tsx PageLayout.tsx (6, 7)
                   ObjectView.tsx (7, 8) TextStatsMenu.tsx ExportDialog.tsx (8)  NEW / MOD (lane O)
frontend/src/lib/download.ts properties/typeEdits.ts                           NEW (8) / MOD (7)
frontend/src/editor/StringEditor.tsx (9) properties/cells/BlocksCell.tsx (9) TextBlockCell.tsx (10)
             editor/annotations.ts editor/embed/DataViewEmbedView.tsx (11) editor/menus/BlockStyleMenu.tsx (12)   lane E
frontend/src/properties/PropertySettings.tsx (13) properties/cells/DateCell.tsx (14)
             settings/sections/SpaceSettings.tsx (16)                          lane P
frontend/src/views/{DataView.tsx,rowMenu.ts,SelectionBar.tsx} views/table/TableLayout.tsx
             views/layouts/{ListLayout,KanbanLayout,CardItem}.tsx (17, 18)
             types/{TypePage,SectionView,TypeOverview}.tsx queries/QueryPage.tsx collections/CollectionPage.tsx (17)
             types/ImportCsvDialog.tsx lib/csvParse.ts (19) queries/QueryBuilder.tsx (20)
             shell/{Sidebar,SidebarSections}.tsx (21)                          lane V
frontend/src/whiteboard/WhiteboardPage.tsx api/whiteboardTypes.ts             MOD (Task 5)
scripts/m9_acceptance.py docs/superpowers/plans/m9-acceptance.md remaining-work.md (M9 rows)   Task 22
```

### Shared files and ordering

| File | Owner(s), in order | Why |
|---|---|---|
| `api/types.ts`, `api/client.ts`, `test/mockApi.ts` | **Task 1 only** | the contract; every front-end task waits for Task 1's commit |
| `backend/objectapp/space.py` | Task 2 → Task 4 → Task 5 | lane B, sequential |
| `backend/objectapp/server.py` | Task 2 → Task 3 → Task 4 | lane B, sequential (`_UI_PATCH_KEYS` and `_ui_problem` live here) |
| `typedefs.py`, `uistate.py` | Task 4 only | reserved keys are never inferred as properties |
| `whiteboardstore.py`, `whiteboardapi.py`, `whiteboard/WhiteboardPage.tsx`, `api/whiteboardTypes.ts` | Task 5 only | the Notes editor must adopt the bumped `.md` version |
| `object/PageLayout.tsx` | Task 6 → Task 7 | lane O, sequential |
| `object/ObjectView.tsx` | Task 7 → Task 8 | lane O, sequential |
| `object/CoverImage.tsx`, `properties/typeEdits.ts` | Task 7 only | |
| `object/textStats.ts` | Task 6 (creates), then read by Task 8 | |
| `lib/download.ts` | Task 8 only | `editor/table/csv.ts` is left alone |
| `editor/StringEditor.tsx` | Task 9 (creates), then used unchanged by Task 10 | lane E, 9 → 10 |
| `editor/annotations.ts`, `editor/embed/DataViewEmbedView.tsx` | Task 11 only | |
| `editor/menus/BlockStyleMenu.tsx` | Task 12 only | after the block-menu branch merges (start condition) |
| `properties/PropertySettings.tsx` | Task 13 only | |
| `properties/cells/DateCell.tsx` | Task 14 only | |
| `views/group.ts` | Task 15 only, and only if Gene picks the heuristic (see Task 15) | |
| `settings/sections/SpaceSettings.tsx` | Task 16 only | |
| `views/DataView.tsx`, `views/rowMenu.ts`, layouts and cards | Task 17 → Task 18 | lane V, sequential |
| `types/TypePage.tsx` | Task 17 → Task 19 → Task 20 | lane V, sequential |
| `queries/QueryPage.tsx` | Task 17 → Task 20 | lane V, sequential |
| `queries/QueryBuilder.tsx` | Task 20 only | |
| `shell/Sidebar.tsx`, `shell/SidebarSections.tsx` | Task 21 only | |
| `properties/cells/cells.test.tsx` | nobody | new test files instead |
| `scripts/m9_acceptance.py`, `m9-acceptance.md`, `remaining-work.md` (M9 rows) | Task 22 only | |

**Dependency edges:**
- Merge of the four branches → 1. Then 1 → every front-end task; 1 → 2 (lane B starts after Task 1 too, so its route shapes match the contract).
- 2 → 3 → 4 → 5.
- 6 → 7 → 8.
- 9 → 10 → 11 → 12. Task 12 is last in lane E because of the block-menu file.
- 13 → 14 → 15 → 16 (lane P runs in order only to keep one agent per lane; the files are disjoint).
- 17 → 18 → 19 → 20 → 21.
- Cross-lane calls go through Task 1's client and are mocked in tests, so no front-end task waits on lane B to finish. Task 22 needs every task.

---

### Task 1: Contract and start check (lane A; first)

**Files:** Modify `frontend/src/api/types.ts`, `frontend/src/api/client.ts`, `frontend/src/test/mockApi.ts`. Test `frontend/src/api/client.m9.test.ts`.

- [ ] **Step 1: Start check.**
  - `git log --oneline master` must show the shortcuts, slash/block menu, side panel/layout/dashboard and search-highlight/graph merges.
  - Run the baseline: `uv run pytest backend/tests -q`, then `cd frontend && npm ci && npx vitest run && npx tsc -b --noEmit && npm run build`.
  - Record the counts in the commit body. Stop and report if any branch is missing or the gate is red.
- [ ] **Step 2: Failing tests.**
  - `test duplicateObject posts path`.
  - `test exportObjectUrl builds a same-origin url with media flag` (no `http`).
  - `test patchUi accepts workspaceOrder` (type-level, through `tsc`).
- [ ] **Step 3:** Implement the contract's client part.
- [ ] **Step 4:** Run `npx vitest run src/api && npx tsc -b --noEmit`. Expected: pass.
- [ ] **Step 5:** Commit `feat(app): M9 client contract`.

### Task 2: Duplicate, back end (lane B; item 7)

**Target behaviour:**
- "Duplicate", icon `ph-copy`.
- Title rule: **"<Title> (Copy)"** ("Untitled (Copy)" for an untitled object).
- Properties are copied; linked objects stay links.
- Not offered for media types, daily notes, type definitions and collections, nor for templates.

**Files:** Modify `backend/objectapp/space.py` (`Space.duplicate_object(path, now)`), `backend/objectapp/server.py` (route). Create `backend/tests/test_duplicate.py`.

**Behaviour:**
- Copy the raw frontmatter source and the body byte for byte, except for these lines:
  - a new `id`
  - `title: <Title> (Copy)`
  - fresh `createdAt` and `lastUpdated`
- A body whose first line is `# <Title>` gets `# <Title> (Copy)`.
- Same folder, with a unique stem via `unique_path`.
- Whiteboards are refused with 422. A board's sidecars would need copying too, and whiteboard duplicate is not in our scope list (our choice; listed for Gene).

**Tests:**
- `test_duplicate_copies_bytes_except_id_title_stamps`
- `test_duplicate_keeps_crlf_bom`
- `test_duplicate_unique_name_when_copy_exists` ("X (Copy).md" exists, so the result gets the next unique stem)
- `test_duplicate_refuses_daily_note_template_whiteboard_422`
- `test_duplicate_changes_no_other_file`
- `test_duplicate_announces_created`

**Steps:** write the tests, then run `uv run pytest backend/tests/test_duplicate.py -q` (FAIL). Implement, then run the same command (PASS). Commit `feat(backend): duplicate an object`.

### Task 3: Export, back end (lane B; item 7)

**Target behaviour:**
- Object menu item "Export".
- Dialog heading "Export", "Format", options heading "Options".
- Format "Markdown".
- Option "Include media", with the description "Adds files and images to the zip."
- Success toast "The export is ready and will be downloaded."
- Other formats (PDF, Microsoft Word, LaTeX) and the options "Include title as heading 1", "Export folder containing all subpages", "Links as wikilinks" and "Include embedded content" are out of scope here. Object's file already **is** Markdown with wikilinks, so M9 offers Markdown with "Include media" only (our choice, listed).

**Files:** Create `backend/objectapp/export.py` and `backend/tests/test_export.py`. Modify `backend/objectapp/server.py` (the route).

**Behaviour:**
- `media=0` streams the file's bytes as they are.
- `media=1` builds a zip in memory with `zipfile`: the `.md` plus the referenced images and attachments. It reuses the media path resolution in `media.py` and M5's link extraction for `![…](Attachments/…)` and `coverImage`.
- Missing referenced files are skipped. Paths outside the space are never read.

**Tests:**
- `test_export_md_bytes_identical`
- `test_export_zip_holds_md_and_media`
- `test_export_skips_missing_and_outside_paths`
- `test_export_writes_nothing` (snapshot of the space and the state dir)
- `test_export_content_disposition_names`

**Steps:** TDD as in Task 2. Commit `feat(backend): export an object as Markdown or zip`.

### Task 4: Back-end rules for template variables, per-object layout keys, `workspaceOrder` (lane B; back-end parts of items 3, 5–6, 12)

**Target behaviour:**
- A date property's template variable is set only on templates.
- `coverImageOffset` and `wideLayoutMode` are per-object keys.
- Changing the cover image clears the offset.
- `workspaceOrder` is a space-level UI key.

**Files:** Modify `backend/objectapp/space.py` (`update_properties` rules), `backend/objectapp/typedefs.py` (add `wideLayoutMode`, `wideCoverImage` and `coverImageOffset` to the reserved keys at line ~43, so v1 inference never makes them properties), `backend/objectapp/server.py` (`_UI_PATCH_KEYS` gains `workspaceOrder`; `_ui_problem` checks it), `backend/objectapp/uistate.py` (only if the shape check lives there). Create `backend/tests/test_m9_props.py`.

**Tests:**
- `test_creation_variable_accepted_on_template_only`
- `test_unknown_creation_variable_422`
- `test_layout_keys_shape_422`
- `test_null_removes_layout_key_only_that_line`
- `test_setting_cover_image_drops_offset_same_write`
- `test_layout_keys_not_inferred_as_properties`
- `test_ui_workspace_order_roundtrip_and_422`

**Steps:** TDD. Commit `feat(backend): template date variables, per-object layout keys, workspaceOrder`.

### Task 5: Whiteboard edits bump `lastUpdated` (lane B; item 15)

**Target behaviour:**
- A whiteboard has the system property `lastUpdated`.
- `lastUpdated` belongs to the object, and the canvas is part of the object.
- **The bump on canvas edits is an inference, not a confirmed behaviour.** Gene chose the bump anyway (audit, "Choices worth revisiting").

**Files:** Modify `backend/objectapp/whiteboardstore.py` (after `_save_sidecar` in `save_board`/`save_ink`, call a stamp-only `Space.touch(md_rel, now)`), `backend/objectapp/space.py` (add `touch`: sets only `lastUpdated` through `frontmatter.set_keys`, with `encode_like` and `atomic_write`, under the lock; a no-op when the stored stamp is under **60 s** old (our choice); no history snapshot for a stamp-only write (our choice)), `backend/objectapp/whiteboardapi.py` (return `mdVersion`; announce `changed` for the `.md`), `frontend/src/api/whiteboardTypes.ts`, `frontend/src/whiteboard/WhiteboardPage.tsx` (the Notes state adopts `mdVersion` so its next body save doesn't hit 409). Also revise the M6 docstring in `whiteboardstore.py` lines 8–13.

**Note:** `Space.touch` is added to `space.py` after Task 4's edit (same lane, in order).

**Tests:**
- Back end:
  - `test_board_save_bumps_md_last_updated_only_that_line`
  - `test_bump_throttled_under_60s`
  - `test_ink_save_bumps`
  - `test_bump_keeps_crlf_bom`
  - `test_bump_takes_no_history_version`
  - `test_save_returns_md_version`
- Front end: `whiteboard/WhiteboardPage.m9.test.tsx`, `test notes save after a board save uses the new md version`.

**Steps:** TDD. Commit `feat(whiteboard): board edits bump lastUpdated`.

### Task 6: Text stats and the page Floating Inspector (lane O; item 4)

**Target behaviour:**
- The Encyclopedia design's description: "Side properties, with a table of contents, linked objects, and text stats."
- **The current design has no such sidebar.** The old sidebar strings ("Table of contents", "Objects inside", "Text stats") are unused. The table of contents and the stats live in a Floating Inspector on every page:
  - tabs "Outline" and "Stats", empty state "No headings in this page", "Pin" / "Unpin".
- The stats are computed on the page's plain text with math excluded:
  - words: `Intl.Segmenter` word segments with `isWordLike`, where hyphen-joined words count as one
  - characters: graphemes, whitespace included
  - sentences: sentence segments
  - paragraphs: `split(/\n/).length`, or 0 when empty
- Order: words, sentences, paragraphs, characters; then "Created" and "Last updated" (Created is hidden for daily notes).
- Labels: "word | words", and the same pattern for sentences, paragraphs and characters.
- The encyclopedia cover sits above the content column when the layout isn't wide.

**Files:**
- Create `frontend/src/object/textStats.ts` (`plainText(markdown)` strips Markdown syntax and `$…$`/`$$` math; `textStats(text, locale)`), `frontend/src/object/textStats.test.ts`, `frontend/src/object/PageInspector.tsx` (tabs Outline and Stats; the Outline lists headings and scrolls to them; pinned state in `localStorage`; the look follows `whiteboard/chrome/FloatingInspector.tsx`, which is read, not edited) and `frontend/src/object/PageInspector.test.tsx`.
- Modify `frontend/src/object/PageLayout.tsx` (mount the inspector; for the encyclopedia design with a non-wide layout, the cover goes above the content column).

**Tests:**
- `test counts words sentences paragraphs characters` (with a hyphenated word, emoji graphemes and an empty text)
- `test math is excluded`
- `test outline lists headings and empty state string`
- `test stats tab order and created hidden for daily notes`
- `test encyclopedia cover above content`

**Steps:** run `npx vitest run src/object/textStats.test.ts src/object/PageInspector.test.tsx src/object/PageLayout.test.tsx` (FAIL), implement, run again (PASS). Commit `feat(object): page inspector with outline and text stats`.

### Task 7: Per-object wide layout, wide cover, reposition cover (lane O; items 5, 6)

**Target behaviour:**
- Wide layout:
  - "Wide layout" / "Normal layout" (icons `ph-arrows-out-simple` / `ph-arrows-in-simple`). Hidden for whiteboards and for the `indexCard` design.
  - The type setting's description says entries can "override this default setting for individual entries".
- Wide cover:
  - "Toggle wide cover image".
  - Logic: when the object has no value, set it to the opposite of the type's mode; otherwise flip it.
- Reposition:
  - "Reposition cover image", hint "Drag image to reposition", "Save", "Cancel".
  - The offset is a y percent from 0 to 100, default 50, applied as `object-position: 0% <offset>%` with `object-fit: cover`.
  - Dragging sets offset = start − dy / renderedHeight × 100, clamped. Clicking outside saves.

**Files:**
- Modify `frontend/src/object/PageLayout.tsx` (`wide = design==='standard' && (fm.wideLayoutMode ?? type.wideLayoutMode)`; `wideCover = fm.wideCoverImage ?? type.wideCoverImage`).
- Modify `frontend/src/object/CoverImage.tsx` (hover buttons "Toggle wide cover image" and "Reposition cover image"; drag mode with the hint and Save / Cancel; `objectPosition`).
- Modify `frontend/src/object/ObjectView.tsx`:
  - the `…` items "Wide layout" / "Normal layout"
  - writing the keys through `writeProperties`
  - `onCoverChange` also sends `coverImageOffset: null`
- Modify `frontend/src/properties/typeEdits.ts` (add the three keys to `RESERVED_KEYS`).
- Create `frontend/src/object/CoverImage.test.tsx` and `frontend/src/object/ObjectView.m9layout.test.tsx`.

**Tests:**
- `test object value overrides type wide layout`
- `test wide layout item hidden for index card and whiteboard`
- `test toggle wide cover from type default`
- `test drag repositions and save writes offset`
- `test cancel restores`
- `test offset clamps 0 to 100`
- `test changing cover clears offset`
- `test layout keys not shown as properties`

**Steps:** TDD. Commit `feat(object): per-object wide layout, wide cover and cover position`.

### Task 8: Object `…` menu: Duplicate, Text Stats, Export (lane O; item 7)

**Target behaviour:**
- Object menu sections, in order:
  - … Share, Presentation mode, **Export**, Import, Download
  - Version history, **Text Stats**
  - Copy ▸
  - **Duplicate**, …, Delete
- "Text Stats" (icon `ph-chart-bar`) opens a submenu titled "Text stats", showing the same rows as the inspector's Stats.
- **Import CSV is not an object-menu item.** It is a type or collection import, so it moves to Task 19.

**Files:**
- Modify `frontend/src/object/ObjectView.tsx`:
  - "Export" after "Present"
  - "Text Stats" ▸ after "Version History"
  - "Duplicate" just above "Merge"
  - Duplicate is hidden for daily notes, templates and whiteboards
  - Duplicate calls `api.duplicateObject`, then opens the copy
- Create `frontend/src/object/TextStatsMenu.tsx` (uses `object/textStats.ts`), `frontend/src/object/ExportDialog.tsx` (Format: Markdown; Option "Include media"; button "Export"; on success the toast "The export is ready and will be downloaded."), `frontend/src/lib/download.ts` (`downloadUrl(url, filename)` through an `<a download>`), and `frontend/src/object/ObjectView.m9menu.test.tsx`.

**Tests:**
- `test menu order export, text stats, duplicate`
- `test duplicate opens the copy`
- `test duplicate hidden for daily note, template, whiteboard`
- `test text stats submenu rows`
- `test export downloads same-origin url with and without media`

**Steps:** TDD. Commit `feat(object): duplicate, text stats and export in the object menu`.

### Task 9: `blocks` (Content) property uses the block editor (lane E; item 9)

**Target behaviour:**
- The property kind is named "Content", described as "The main notes area of an object — rich text with formatting and linking."
- Its data type is `blocks`.
- It uses the same block editor as the body.

**Files:**
- Create `frontend/src/editor/StringEditor.tsx`:
  - a Tiptap editor over a string: `editorExtensions()`, `loadBody(value)` once, a debounced `onChange(serializeBody(editor))`, and a flush on blur
  - optional `singleParagraph` (Enter blocked) for Task 10
  - mounts `SlashMenu`, `TokensMenu` (with the owning object's `path`) and `BlockHandles` when it is multi-block
  - the pattern is `whiteboard/nodes/TextBlockEditor.tsx`
  - it strips one trailing `\n` before reporting, because the YAML `|-` style drops it
- Modify `frontend/src/properties/cells/BlocksCell.tsx` (replace the CodeMirror box).
- Create `frontend/src/properties/cells/BlocksCell.test.tsx` and `frontend/src/editor/StringEditor.test.tsx`.

**Tests:**
- `test no-edit blur writes nothing`
- `test value round trips byte for byte` (headings, lists, a callout, wikilinks)
- `test edit saves serialized markdown after debounce and on blur`
- `test empty saves null`
- `test slash menu opens inside the cell`

**Steps:** TDD. Run `npx vitest run src/editor/StringEditor.test.tsx src/properties/cells/BlocksCell.test.tsx src/editor/preserve.test.ts`. Commit `feat(properties): Content property edits with the block editor`.

### Task 10: Rich-text (`textBlock`) property with links (lane E; item 8; after Task 9)

**Target behaviour:**
- The property kind is named "Text", described as "A single paragraph that allows formatting and linking."
- The value is one text block with inline tokens.
- Links use the body's token editor.
- No textBlock-specific picker string exists, so the `[[` picker is the body's.

**Files:**
- Modify `frontend/src/properties/cells/TextBlockCell.tsx`:
  - edit mode: `StringEditor` with `singleParagraph`, which gives the `[[` picker through `setWikilinkTrigger` and `links/LinkPicker.tsx` for free
  - display mode: `[[Title]]` and `[[Title|label]]` render as link chips that open the object (reuse `links/wikilinkPresenter.ts`)
- Create `frontend/src/properties/cells/TextBlockCell.test.tsx`.
- No back-end change: frontmatter strings are already link-indexed (`linkindex.py`) and relinked on rename (`relink.py`).

**Tests:**
- `test wikilink renders as chip and opens`
- `test typing [[ opens picker and inserts link`
- `test enter commits single paragraph`
- `test bold and link round trip`
- `test unchanged value not rewritten`

**Steps:** TDD. Commit `feat(properties): rich-text property with links`.

### Task 11: Embedded views keep their own layout, filters, sorts and group (lane E; item 2)

**Target behaviour:**
- An embed block can carry its own view state.
- That state is `{viewDefinition, filterGroup, sorts, groupBy}`.
- The block uses its own view state when present, else the collection's or query's view. The first change copies that view into the block.

**Files:**
- Modify `frontend/src/editor/annotations.ts` (a `KNOWN_OPTIONS` entry `localDataViewInfo`, quoted, `appliesTo` `dataView`; the value is one line, with `\"`, `\\` and `\>` escapes).
- Modify `frontend/src/editor/embed/DataViewEmbedView.tsx`:
  - seed `useEmbedState` from the parsed option
  - on each view change, `setBlockOption('localDataViewInfo', JSON.stringify(state))` (debounced)
  - remove the "not saved" header comment
- Tests go in the new `frontend/src/editor/annotations.m9.test.ts` and `frontend/src/editor/embed/DataViewEmbedView.m9.test.tsx`.

**Tests:**
- `test embed without option uses the source view and writes nothing`
- `test first change writes option on the annotation line only`
- `test reload restores layout filters sorts group`
- `test value with quotes and --> survives`
- `test details flag and localDataViewInfo coexist`
- `test CRLF body keeps CRLF`

**Steps:** TDD. Then run `npx vitest run src/editor` (the round-trip owners). Commit `feat(editor): embedded collection and query views keep their own view`.

### Task 12: Alignment entry in the block menu (lane E; item 10; last in lane E, after the block-menu branch is in `master`)

**Target behaviour:**
- Text and group blocks have a text alignment: `'left'|'center'|'right'`.
- The editor panel renders an "Alignment" dropdown (icon `ph-text-align-left-bold`) with items "Align text left" / "Text align center" / "Text align right" (icons `ph-text-align-*-bold`).
- **That dropdown is shown only when the selection contains a simple-table cell.**
- The block menu (reference-check §2e) has **no** alignment item, and no keys are bound to these actions (reference-check §1).

**Decision for Gene:** the audit asked for a block-menu entry. Alignment is otherwise offered only for table cells. **Recommended:** an "Alignment" ▸ submenu with the three labels above in `BlockStyleMenu`, shown only for blocks that take the `align` option. This is a superset, since Object already aligns any block by key. **Alternative:** no menu entry at all.

**Files:** Modify `frontend/src/editor/menus/BlockStyleMenu.tsx` (the submenu calls the exported `setOptionOnBlocks(editor, 'align', null|'center'|'right')` from `editor/extensions/blockSelection.ts`, unchanged; active state from the block's options). Test in `frontend/src/editor/menus/BlockStyleMenu.m9.test.tsx`.

**Tests:**
- `test alignment submenu labels verbatim`
- `test choosing center writes align=center on selected blocks only`
- `test left removes the option`
- `test hidden for blocks without align`

**Steps:** TDD. Commit `feat(editor): alignment in the block menu`.

### Task 13: "Searchable" toggle in property settings (lane P; item 1)

**Target behaviour:**
- `isNotSearchable` is set only on built-in definitions (media MIME type, file size, duration, and a type's plural name).
- **No user-facing label exists** for "searchable", "Include in search" or "exclude".

**Decision for Gene:** fidelity alone says no toggle. Gene approved the item, so the label is **our string**: "Include in search", with the description "Off: this property's values don't appear in search results." (our string).

**Files:** Modify `frontend/src/properties/PropertySettings.tsx` (a `Switch` section after "Visibility", for the kinds search indexes: text, textBlock, url, number, label, entity; it saves `isNotSearchable: true` or removes the key). Test in `frontend/src/properties/PropertySettings.m9.test.tsx`. No back-end change: `searchindex.py`'s `_types_fingerprint` already reindexes on the change.

**Tests:**
- `test toggle off writes isNotSearchable true`
- `test toggle on removes key`
- `test hidden for kinds that are never indexed`

**Steps:** TDD. Commit `feat(properties): searchable flag in property settings`.

### Task 14: Template date variables in the date cell (lane P; item 3)

**Target behaviour:**
- Empty state "Select variable"; options "Day of creation", "Week of creation", "Month of creation", "Year of creation".
- They are offered only on a template, for a `datetime` property that is not a system date.
- Picking one clears the date value. "Select variable" removes the variable.
- They are resolved when the template is applied. Object's resolver is already built (`backend/objectapp/templates.py` `resolve_date_variable`, used by `space.py` `_template_edit`).

**Files:** Modify `frontend/src/properties/cells/DateCell.tsx` (when the open object is a template and `def.type === 'datetime'`, add the variable picker; a `{creation:<v>}` value displays as its label, not as an invalid date). Test in `frontend/src/properties/cells/DateCell.m9.test.tsx`.

**Tests:**
- `test variable picker only on templates and datetime`
- `test choosing week writes {creation:week}`
- `test select variable clears it`
- `test value shows label`

**Steps:** TDD. Commit `feat(templates): date variables in the date cell`.

### Task 15: Custom label as status: confirm and keep (lane P; item 13)

**Target behaviour:**
- A label property can be a status (`isStatus`), and its options carry a status category.
- **`isStatus` is set in exactly one place**: the basic Task `status` definition.
- No string offers "Use as status". The only status strings are the task checkbox, "New status" in the label cell, and the task dashboard sections.
- One heuristic: a label counts as status-like **for group ordering** when it is the Task status, has `isStatus`, or its name contains "status".
- Verdict: **there is no custom-label status.** Object already matches: `space.py` `_check_label` refuses a new `isStatus` ("Only the basic Task status is a status label"), as the M2 plan line 87 intended.

**Files:** lane B owns the back end, so this task only adds the front-end regression guard `frontend/src/properties/PropertySettings.status.m9.test.tsx` (`test no status toggle on custom labels`, green from the start). Optional, only if Gene picks it: the "name contains status" group ordering in `frontend/src/views/group.ts`, with `views/group.m9.test.ts`.

**Also check:** the M8 plan line 501 says the basic Project type has "Status (label as status)". If `basicsetup.py` seeds `isStatus` on Project, report it to Task 22 as a finding (lane B is done by then; the fix goes in the end fix pass).

**Steps:** write the guard test (green from the start), commit `test(properties): custom labels are not status labels`.

### Task 16: "Recalculate content index" control (lane P; item 14)

**Target behaviour:**
- Button "Recalculate content index" (icon `ph-file-magnifying-glass`).
- Description "If some of your views are inconsistent or search results are not returning content, you can reindex your notes. This is usually not needed, only use it if you are having issues."
- While it runs: heading "Content is being indexed", description "Your notes are getting analyzed for search, backlinking, and your content views."
- It would sit under an "Offline & Sync" › "Offline" settings section. Object has no such section, so it goes in the Space section (our choice).

**Files:** Modify `frontend/src/settings/sections/SpaceSettings.tsx` (a row with the button calling `api.reindex()`; while search reports `partial`, it shows the indexing heading and description). Test in `frontend/src/settings/sections/SpaceSettings.m9.test.tsx`.

**Tests:**
- `test button calls reindex`
- `test indexing state strings while partial`
- `test strings verbatim`

**Steps:** TDD. Commit `feat(settings): recalculate content index`.

### Task 17: Row context menu on type and query pages (lane V; item 11, part 1)

**Target behaviour** (the data-view row context menu):
- "Select multiple"
- "Open in side panel", "Open in new tab"
- "Change type"
- "Copy object reference" (toast "Link to object copied")
- "Duplicate"
- "Delete Object"
- "Remove from collection" only in a collection.

**Files:**
- Create `frontend/src/views/rowMenu.ts` (`commonRowMenu(row, ctx)` returning the items above; Duplicate is hidden where Task 8 hides it).
- Modify `frontend/src/types/TypePage.tsx` (AllTab), `frontend/src/types/SectionView.tsx` (RowsSection), `frontend/src/types/TypeOverview.tsx` and `frontend/src/queries/QueryPage.tsx` (pass `rowMenu`).
- Modify `frontend/src/collections/CollectionPage.tsx` (its items are appended to `commonRowMenu`).
- Test in `frontend/src/views/rowMenu.test.ts`, `frontend/src/types/TypePage.m9.test.tsx` and `frontend/src/queries/QueryPage.m9.test.tsx`.

**Tests:**
- `test type page row menu items and order`
- `test query page row menu`
- `test collection page keeps its items after common ones`
- `test delete opens the delete dialog`

**Steps:** TDD. Commit `feat(views): row context menu on type and query pages`.

### Task 18: Multi-select and bulk actions (lane V; item 11, part 2)

**Target behaviour:**
- Header "<n> selected".
- Bulk actions: "Change type of selected objects", "Open selected objects in side panel", "Delete objects".
- The confirm button reads "Delete {count} object | Delete {count} objects".
- Entering selection: "Select multiple" in the row menu. Ctrl/Shift-click also selects (our choice).

**Files:**
- Modify `frontend/src/views/DataView.tsx` (`selectedPaths` state; Esc clears).
- Create `frontend/src/views/SelectionBar.tsx` (the count and the three actions).
- Modify `frontend/src/views/table/TableLayout.tsx`, `frontend/src/views/layouts/{ListLayout,KanbanLayout,CardItem}.tsx` (`data-selected` and the selected style).
- Test in `frontend/src/views/DataView.m9.test.tsx`.
- Bulk delete reuses `object/DeleteObjectDialog.tsx`, and change type reuses `object/ChangeTypeDialog.tsx` (both used unchanged).

**Not in M9** (listed for Gene): bulk "Edit property", "Edit tags", "Export".

**Tests:**
- `test select multiple then click toggles rows`
- `test shift click selects range`
- `test bar shows count`
- `test bulk delete confirms with count string`
- `test bulk change type`
- `test escape clears`

**Steps:** TDD. Commit `feat(views): multi-select and bulk actions`.

### Task 19: Import CSV on a type page (lane V; item 7)

**Target behaviour:**
- Type or collection menu item "Import CSV" (icon `ph-file-csv`).
- Dialog heading "Batch import to collection".
- Description "You can upload a CSV that will be transformed into a collection. Every row will create one entity."
- "Has a header row", described as "First row in CSV holds column names and is not itself a data row."
- 'New collection "{title}"'.
- Warning heading "Use this with caution", text ("…You can quickly spam your whole space if you import big tables.").
- `.notSupported` ("…up to {rowLimit} rows"); the `rowLimit` value was not found, so it is **1000** (our choice).
- `.errors.readingError`.
- "Add {entriesLength} new {structurePlural} to"; heading "Property Mappings"; description "Multiple values can be mapped to the same property, but only the first transferred value is kept."

**Files:**
- Create `frontend/src/lib/csvParse.ts` (RFC 4180: quotes, doubled quotes, CRLF, a BOM; the inverse of `editor/table/csv.ts` `toCsv`), `frontend/src/lib/csvParse.test.ts`, `frontend/src/types/ImportCsvDialog.tsx` and `frontend/src/types/ImportCsvDialog.test.tsx`.
- Modify `frontend/src/types/TypePage.tsx` (the "More" menu item).
- Mapping: by default the first column maps to the title, and other columns map to a property of the same name (case-insensitive). Values are parsed per kind with the existing property parsers.
- Each row becomes `api.createObject(typeId, {title, values})` in sequence, with progress shown. An optional new collection uses `api.createCollection`, then `collections` values.

**Tests:**
- `test parse quotes newlines bom`
- `test header row toggle`
- `test mapping defaults and first value wins`
- `test creates one object per row`
- `test over row limit shows not supported`
- `test new collection option`

**Steps:** TDD. Commit `feat(types): import CSV into a type`.

### Task 20: Type-constrained query tabs and "release constraint" (lane V; item 12)

**Target behaviour:**
- Release button tooltip: "Turn into a normal query and remove the single type constraint. Opens the query as a page and removes this tab from the type dashboard."
- The constraint is computed, not stored: a query in `structures` mode with exactly one type. A query has no constraint field.

**Files:**
- Modify `frontend/src/queries/QueryBuilder.tsx`: when shown as a tab on a type dashboard for a single-type query, the type picker is locked to that type, with a release button carrying the tooltip.
- Modify `frontend/src/types/TypePage.tsx`: release removes the `query:<id>` section through `api.saveViews` and opens the query page.
- Modify `frontend/src/queries/QueryPage.tsx` (pass the context).
- Tests in `frontend/src/queries/QueryBuilder.m9.test.tsx`.
- No new disk key.

**Tests:**
- `test single type query tab locks type picker`
- `test release removes tab and opens query page`
- `test multi type query is not constrained`

**Steps:** TDD. Commit `feat(queries): type-constrained query tabs`.

### Task 21: Sidebar `workspaceOrder` (lane V; item 12)

**Target behaviour:**
- `workspaceOrder` orders the sidebar's top-level sections: `'objects'` (the types block), `'pinned'` and custom section ids. They can be dragged into order.
- Unknown ids are ignored. Missing ones keep their default place after the listed ones (our reading).

**Files:** Modify `frontend/src/shell/Sidebar.tsx` and `frontend/src/shell/SidebarSections.tsx` (render order from `ui.workspaceOrder`; drag the section headers to reorder, saved with `api.patchUi({workspaceOrder})`). Test in `frontend/src/shell/Sidebar.m9.test.tsx`.

**Not in M9:** the types block's own "Sort Alphabetically" / "Sort Manually" / "Reorder". A manual order there would need a new key. That is Gene's call.

**Tests:**
- `test sections render in workspaceOrder`
- `test drag reorders and patches ui`
- `test unknown and missing ids`

**Steps:** TDD. Commit `feat(shell): sidebar section order (workspaceOrder)`.

### Task 22: Milestone acceptance (integrate; after Tasks 1–21)

**Files:** Create `scripts/m9_acceptance.py` and `docs/superpowers/plans/m9-acceptance.md`. Modify `frontend/src/noNetwork.m8.test.ts` (add M9 sources) and `docs/superpowers/plans/remaining-work.md` (the M9 rows).

- [ ] **Step 1: The gate.** Run `uv run pytest backend/tests -q` and `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run lint && npm run build`.
- [ ] **Step 2: Write `scripts/m9_acceptance.py SPACE [--keep]`**, built like `m8_acceptance.py`: import `Http`, `Run`, `changed_paths`, `commit`, `free_port`, `git`, `snapshot` from `m2_acceptance`; a git-committed temp copy; `OBJECT_STATE_DIR`, `OBJECT_CACHE_DIR` and `OBJECT_CLOCK_FILE` in temp paths; `create_app` with uvicorn on a free `127.0.0.1` port. The script seeds a page with an image, a template with a datetime property, and a board when the space lacks them (`SEEDS`, as in M8). The checks:
  1. Starting twice, plus every read (`GET /api/object/export` with and without media, `/api/search`, `/api/ui`), gives a clean `git status` and nothing new in the state dir.
  2. Duplicate: exactly one new file, and its `git diff --no-index` against the source differs only in `id`, `title`, the stamps and the `# Title` line. A daily note gives 422.
  3. Export: the `.md` bytes are identical. The zip holds the `.md` plus the referenced image.
  4. Layout keys: setting `wideLayoutMode`, `wideCoverImage` and `coverImageOffset` changes only those lines. Changing `coverImage` drops the offset. Wrong shapes give 422.
  5. Template variable: `{creation:week}` is accepted on the template and refused on a page. Creating from the template gives the week range.
  6. Whiteboard: a board save changes only the `.md`'s `lastUpdated` line, and a second save inside 60 s leaves it alone. The Notes body save that follows succeeds with `mdVersion`.
  7. `PUT /api/ui` `workspaceOrder` round-trips.
  8. Reindex: `POST /api/search/reindex` gives 202, and search reports complete afterwards.
  9. The editor round trip (`OBJECT_ROUNDTRIP_SPACE=<copy> npx vitest run src/editor/roundtrip.space.test.ts`) reports 0 differences, including a body with a `localDataViewInfo` embed.
  10. The M1 no-edit pass changes 0 files.
- [ ] **Step 3:** Run it on `space-m8`, `space-blocks`, `space-sample`, `space-v1` and `space-whiteboard`. Then rerun `m1_roundtrip.py` and `m2`–`m8_acceptance.py` on `space-sample` and `space-v1`. All must PASS.
- [ ] **Step 4:** Drive the built app headless (Playwright, as M8 Task 31 did) through every M9 feature. Record differences in `m9-acceptance.md`.
- [ ] **Step 5:** Write `m9-acceptance.md`, Gene's hand-check (below), unchecked.
- [ ] **Step 6:** Update `remaining-work.md` (M9 built, the audit's completeness table closed). Commit `chore: milestone 9 acceptance`.

## Acceptance checklist for Gene (goes into `m9-acceptance.md`)

On a copy of the CPI export outside the repo, with `git init` done there:
- [ ] Opening the space, exporting and reading stats change nothing (`git status` clean).
- [ ] Duplicate a page, a task and a tag: the copies are named "<Title> (Copy)" and the source is untouched. The menu offers no Duplicate on a daily note, template or whiteboard.
- [ ] Export a page as Markdown, then with "Include media": the zip opens, and images and attachments are inside.
- [ ] Text Stats in the `…` menu and the inspector's Stats tab agree with a hand count on the same note (words, sentences, paragraphs, characters).
- [ ] The page inspector: the Outline jumps to headings, and Pin/Unpin is remembered.
- [ ] Wide layout / Normal layout per object overrides the type. Toggling the wide cover and repositioning the cover (drag, Save, Cancel) look as specified. A new cover image resets the position.
- [ ] Content property: the full block editor works in the property panel. A note edited there reloads identically.
- [ ] Text property: `[[` opens the picker, links show as chips, and renaming the target updates the link.
- [ ] Template date variables: "Day/Week/Month/Year of creation" on a template's date property; a new object from it gets the right date or range.
- [ ] An embedded collection and an embedded query: change the layout, filter, sort and group, close and reopen, and they are kept. The note's diff is one annotation line.
- [ ] Alignment in the block menu (see Decisions).
- [ ] The row menu on a type page, a type dashboard section and a query page; Select multiple; bulk change type, open in side panel and delete.
- [ ] Import CSV into a type (with and without a header row, and a new collection); the warning shows.
- [ ] A single-type query tab: the type is locked and the release button works.
- [ ] Sidebar sections: drag to reorder, restart, and the order is kept.
- [ ] "Recalculate content index" runs and the indexing state shows.
- [ ] Draw on a whiteboard: its "Last updated" moves, at most once a minute. The board's Notes still save.
- [ ] Every "our choice" and "our string" in this plan: the 60 s bump throttle and no history snapshot for it; whiteboard Duplicate refused; Export only Markdown and media; the 1000-row CSV limit; Ctrl/Shift-click selection; the reindex control's place; the "Include in search" label; alignment as a block-menu superset; dropping `referenceImageId`.
- [ ] The side-by-side look of every M9 screen in Light and Dark.

## Coverage

| Audit row (2026-10-28) | Task |
|---|---|
| Property "searchable" flag | 13 (our label: there is no existing one) |
| Embedded collection/query views keep their own view | 11 |
| Template date variables | 4 (write rule), 14 (UI); the resolver is already built |
| Encyclopedia layout: table of contents, linked objects, text stats | 6 (a Floating Inspector: Outline and Stats on every page; encyclopedia cover placement). The old sidebar ("Objects inside") is not built (see Decisions) |
| Per-object wide layout and wide-cover override | 4, 7 |
| Reposition cover image (`coverImageOffset`) | 4, 7 |
| Object `…` menu: Duplicate, Text Stats, Import CSV, Export | 2, 3, 8; Import CSV is on the type page, 19 |
| Rich-text property with links | 10 |
| `blocks` (Content) property | 9 |
| Text alignment entry | 12 |
| Row context menu and multi-select on type and query pages | 17, 18 |
| M2/M3 deferral: type-constrained queries | 20 |
| M2/M3 deferral: `workspaceOrder` | 4, 21 |
| M2/M3 deferral: default collection | **no build:** a type page already is the type's default collection (`isDefaultDatabase`). The key round-trips in `collections.py` today. Gene confirms |
| M2/M3 deferral: `defaultPageViewId` | **no build:** it selects a custom page design from a design studio, which Object doesn't have. The key round-trips in the type JSON. Gene confirms |
| Custom label as status | 15 (confirmed: not a feature; regression guard) |
| Search reindex control | 16 |
| Choice reversed: board edits bump `lastUpdated` | 5 |

## Build lanes

Lane A runs first. Then lanes B, O, E, P and V run side by side, each in order, in **separate worktrees** (their file sets are disjoint). Integrate runs last.

| Lane | Tasks (in order) | Files it owns |
|---|---|---|
| **A: contract** | 1 (after the four branches merge) | `api/types.ts`, `api/client.ts`, `test/mockApi.ts` |
| **B: back end** | 2 → 3 → 4 → 5 | `space.py`, `server.py`, `export.py`, `typedefs.py`, `uistate.py`, `whiteboardstore.py`, `whiteboardapi.py`, `api/whiteboardTypes.ts`, `whiteboard/WhiteboardPage.tsx`, `backend/tests/test_{duplicate,export,m9_props,whiteboard_m9}.py` |
| **O: object page** | 6 → 7 → 8 | `object/{textStats.ts,PageInspector.tsx,PageLayout.tsx,CoverImage.tsx,ObjectView.tsx,TextStatsMenu.tsx,ExportDialog.tsx}`, `lib/download.ts`, `properties/typeEdits.ts` |
| **E: editor and rich cells** | 9 → 10 → 11 → 12 | `editor/StringEditor.tsx`, `properties/cells/{BlocksCell,TextBlockCell}.tsx`, `editor/annotations.ts`, `editor/embed/DataViewEmbedView.tsx`, `editor/menus/BlockStyleMenu.tsx` |
| **P: properties and settings** | 13 → 14 → 15 → 16 | `properties/PropertySettings.tsx`, `properties/cells/DateCell.tsx`, `views/group.ts` (optional), `settings/sections/SpaceSettings.tsx` |
| **V: views and sidebar** | 17 → 18 → 19 → 20 → 21 | `views/{DataView.tsx,rowMenu.ts,SelectionBar.tsx}`, `views/table/TableLayout.tsx`, `views/layouts/{ListLayout,KanbanLayout,CardItem}.tsx`, `types/{TypePage,SectionView,TypeOverview,ImportCsvDialog}.tsx`, `queries/{QueryPage,QueryBuilder}.tsx`, `collections/CollectionPage.tsx`, `lib/csvParse.ts`, `shell/{Sidebar,SidebarSections}.tsx` |
| **integrate** | 22 | `scripts/m9_acceptance.py`, `m9-acceptance.md`, `remaining-work.md` (M9 rows), `noNetwork.m8.test.ts` |

On a 4-CPU box only two agents run at once, so the lanes queue. V is the longest lane: start it first.

Workflow args, if lanes aren't supported: `{"plan":"docs/superpowers/plans/2026-10-28-m9-completeness-gaps.md","base":"<master after the four merges>","backend":[1,2,3,4,5],"frontend":[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21],"integrate":22,"milestone":"Milestone 9","perTaskReview":false}`.

## Gene's answers (2026-10-28) — these override the recommendations below

- **Alignment (Task 12): keep block alignment.** Build the "Alignment" ▸ submenu in the block menu for any block that takes `align`, with the three labels, AND the table-cell "Alignment" dropdown shown when a table cell is selected (if Object lacks it). Block alignment no longer has keys (the shortcuts fix removed them), so the menu is its only entry point.
- **Searchable (Task 13): skip.** Do not build the toggle; the flag stays file-only. Lane P drops Task 13.
- **Encyclopedia (Task 6): Floating Inspector,** as recommended.
- **Default collection and `defaultPageViewId`: build anyway.** New Task 23 (lane V, after Task 21): find every user-facing behaviour behind `isDefaultDatabase` (label "Default collection") and `defaultPageViewId` (per object and per type) and build exactly that. Do not invent behaviour: if there is no UI for one of them, keep the key round-tripping and report it in the lane's final message.
- **Custom label as status (Task 15):** keep today's guard; do not add the "name contains status" ordering.

## Decisions for Gene

1. **Alignment (Task 12):** alignment is otherwise offered only for selected table cells, never in the block menu. Build the block-menu superset (recommended, as the audit asked), or skip it.
2. **Searchable (Task 13):** there is no UI for it. Build with our label "Include in search" (recommended, since you approved it), or keep it JSON-only.
3. **Encyclopedia (Task 6):** show the TOC and stats in a Floating Inspector on every page, with no encyclopedia sidebar ("Objects inside"). Recommended: the Floating Inspector. Alternative: build the old sidebar sections for encyclopedia types only.
4. **Default collection and `defaultPageViewId`:** recommend closing them as "no build" (see Coverage).
5. **Custom label as status (Task 15):** not supported; keep today's guard. Optional: the "name contains status" group ordering.
6. **Whiteboard `lastUpdated` (Task 5):** the bump on canvas edits is inferred, not confirmed. The 60 s throttle is ours.
7. **Not in M9:** the sidebar types' Sort Alphabetically / Manually (needs a new key); bulk Edit property / Edit tags / Export; export to PDF, Word or LaTeX; duplicating whiteboards.

## Change history

- **2026-10-28:** written at `fb931dc`, with four fix branches open (see "In-flight branches"). Built-code facts used:
  - `templates.py` already resolves `{creation:…}`
  - `searchtext.py` honours `isNotSearchable`
  - `typemodel.py` keeps unknown type and property keys
  - `_UI_PATCH_KEYS` is in `server.py`
  - `views/DataView.tsx` already has a generic `rowMenu` prop (only `CollectionPage` passes it)
  - `api.reindex` and `POST /api/search/reindex` exist
  - `whiteboard/nodes/TextBlockEditor.tsx` already edits a string with the block editor (the pattern for `StringEditor`)
  - `editor/table/csv.ts` writes CSV only
  - `whiteboardstore.save_board`/`save_ink` never write the `.md`
