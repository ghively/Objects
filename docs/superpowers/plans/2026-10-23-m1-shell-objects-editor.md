# Object, Milestone 1: Shell, Objects on Disk, Editor. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a space folder in a native window that matches the design spec. Browse objects by type in the sidebar, open an object as a page or peek, and edit its body in a formatted editor. Saving changes only what was edited.

**Architecture:**
- **Back end:** a Python FastAPI service (`127.0.0.1:8790`) owns the space folder. It does file scanning, frontmatter round-trips (ruamel.yaml), atomic writes, conflict detection and file watching (pushed to the UI over Server-Sent Events).
- **Front end:** a React + TypeScript SPA (Vite, Tailwind v4, shadcn/ui), served by the same process, renders the shell and a Tiptap editor. Byte preservation lives in the front end's Markdown layer: every top-level block keeps its original source and is re-emitted verbatim unless edited; tables and lists are preserved per row/item.
- **Window:** `pywebview` hosts the UI in a WebView2 window.

**Tech Stack:** Python 3.13, uv, FastAPI, uvicorn, ruamel.yaml, watchdog, pywebview, pytest · Node 24, Vite, React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Tiptap 3, `marked` (lexer), CodeMirror 6, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-23-object-design.md` (read §3–§5 before starting). Behaviour and option names: the behaviour catalog (`docs/behavior-catalog.md`) and the design spec.

## Roadmap (one plan per milestone, written when the previous one is accepted)

| M | Delivers |
|---|---|
| **1 (this plan)** | shell, objects on disk, page + peek, block editor with byte preservation, wikilinks, external changes |
| 2 | object types and all property kinds: type settings UI, property panel editing, title edit and rename-with-relink, change type, templates, tags as objects |
| 3 | views (list, grid, wall, table, embed, kanban, gallery), filters, sorts, group-by, calculations, collections, queries, pinned |
| 4 | calendar (day / three days / week / month, mini month), daily notes, tasks (status categories, priority, due, recurrence, reminders) |
| 5 | SQLite FTS index, Ctrl+K command palette, backlinks + unlinked mentions, global and local graph |
| 6 | whiteboards (blocks, 12 shapes, frames, circuits, connectors) + Wacom freehand ink |
| 7 | remaining block options (toggles, colours, columns, math, media embeds), light mode, polish against the design spec |

## Global Constraints

- The back end binds `127.0.0.1` only. Default port `8790` (`8765` is taken). No outbound network at runtime: fonts and icons are bundled.
- Python `>=3.13`, managed with `uv`. Node `>=22`, managed with `npm`.
- **Reading, indexing, rendering or opening an object never writes its file.** A save with no edits writes nothing. Writes are atomic (temp file in the same folder + `os.replace`).
- **Object file shape** (spec §4): YAML frontmatter, then the body. Keys used in M1: `id`, `type`, `title`, `icon`, `createdAt`, `lastUpdated`, `tags`; all others pass through untouched.
- **On a body save the back end sets:**
  - `lastUpdated` to the current UTC time as `YYYY-MM-DDTHH:MM:SS.sssZ`, updated in place, or added after the last existing key if absent
  - `id`, a 26-character ULID, inserted as the first frontmatter key, only if absent
- **Line endings** (LF or CRLF), a UTF-8 BOM and the presence or absence of a trailing newline are preserved exactly.
- **Space app data** lives in `<space>/.object/`; the derived cache in `<space>/.object-cache/`. The scanner ignores both, plus any dot-folder.
- **Theme tokens** (the design spec's dark theme): `--bg-app`, `--bg-panel`, `--bg-raised`, `--bg-raised-2`, `--bg-hover`, `--bg-hover-2`, `--border`, `--danger`, with values in `frontend/src/theme/tokens.css`. Font: Inter at a 15px base; radii 2/4/6/8/12/16/24px.
- **No real CPI data in the repo.** Test fixtures are synthetic. The manual acceptance space is a copy of the export **outside** the repo.

## Review Focus

1. **CRLF files, a UTF-8 BOM, no trailing newline** → round-trip byte-identical; a one-line edit keeps CRLF on every line. *(tests in Tasks 1 and 7)*
2. **Malformed or missing frontmatter** (unterminated `---`, invalid YAML, no frontmatter at all) → the object opens read-only as type Page with a banner, and its file is never written. *(tests in Tasks 1 and 3)*
3. **Titles that collide or contain `\ / : * ? " < > |`**, and a `[[link]]` that matches two objects → resolution is deterministic: same type folder first, then the oldest `createdAt`. An unresolved link renders dimmed and doesn't crash. *(tests in Tasks 3 and 9)*
4. **A ~1 MB body with hundreds of tables** → opens in under 2 s; editing one cell rewrites exactly one line. *(tests in Task 7)*
5. **The file changes on disk while unsaved edits exist** → the save is rejected with a conflict (no overwrite) and the UI asks keep-mine / take-theirs. *(tests in Tasks 4 and 10)*

---

## File Structure

```
pyproject.toml                     uv project; console script `objectapp`
backend/objectapp/
  __init__.py
  __main__.py                      CLI: --space PATH --port 8790 --browser
  textfile.py                      read/write preserving BOM + EOL; atomic write
  objfile.py                       split frontmatter/body; ObjectFile dataclass
  frontmatter.py                   ruamel round-trip; set_keys()
  ids.py                           new_ulid()
  space.py                         Space: scan, types, objects, resolve link, save body
  typedefs.py                      TypeDef model, infer from folders, load/save .object/types
  watcher.py                       watchdog → asyncio queue of change events
  server.py                        create_app(space) FastAPI: /api/*, SSE, static frontend
backend/tests/
  conftest.py                      fixture `space_dir` = copy of fixtures/space-sample to tmp
  fixtures/space-sample/…          synthetic space (see Task 3)
  test_textfile.py test_objfile.py test_frontmatter.py test_space.py test_server.py test_watcher.py
frontend/
  package.json vite.config.ts tsconfig.json index.html
  src/main.tsx  src/App.tsx
  src/theme/tokens.css              CSS variables + Tailwind @theme mapping
  src/api/client.ts                 typed fetch wrappers + SSE subscription
  src/api/types.ts                  TS mirrors of API JSON
  src/shell/TopBar.tsx Sidebar.tsx MainPanel.tsx RightPanel.tsx
  src/nav/tabs.ts                   tab + history store (zustand)
  src/types/TypePage.tsx            M1: simple list of a type's objects
  src/object/ObjectPage.tsx ObjectPeek.tsx ObjectHeader.tsx PropertyPanel.tsx
  src/editor/blocks.ts              split body → SourceBlock[]; join
  src/editor/preserve.ts            serializeWithPreservation(); table/list line splice
  src/editor/Editor.tsx             Tiptap setup, autosave
  src/editor/extensions/*.ts        Wikilink node, RawBlock node, block-source attr
  src/editor/RawMode.tsx            CodeMirror on full file text
  src/links/LinkPicker.tsx
  src/**/*.test.ts(x)               Vitest
```

---

### Task 1: Text files and object-file splitting (back end)

**Files:**
- Create: `pyproject.toml`, `backend/objectapp/__init__.py`, `backend/objectapp/textfile.py`, `backend/objectapp/objfile.py`, `backend/objectapp/ids.py`
- Test: `backend/tests/test_textfile.py`, `backend/tests/test_objfile.py`

**Interfaces:**
- Produces:
  - `TextFile(text: str, eol: Literal["\n","\r\n"], bom: bool)`; `read_text(path: Path) -> TextFile`, where `text` is normalised to `\n`
  - `encode(tf: TextFile) -> bytes`
  - `atomic_write(path: Path, data: bytes) -> None`
  - `ObjectFile(frontmatter_src: str | None, body: str, fm_ok: bool, fm_error: str | None)`
  - `split_object(text: str) -> ObjectFile`, `join_object(of: ObjectFile) -> str`
  - `new_ulid() -> str`

- [ ] **Step 1:** `uv init --package --name objectapp`, then move the package to `backend/objectapp` and set `[tool.uv] package = true` and `[project.scripts] objectapp = "objectapp.__main__:main"`. Add deps `fastapi uvicorn ruamel.yaml watchdog pywebview sse-starlette`, and dev deps `pytest httpx`.
- [ ] **Step 2: Write failing tests**
  - `test_roundtrip_lf`, `test_roundtrip_crlf`, `test_roundtrip_bom`, `test_roundtrip_no_trailing_newline`: `encode(read_text(p)) == p.read_bytes()`
  - `test_atomic_write_replaces`: the temp file doesn't linger
  - `test_split_join_identity` over these inputs: normal, no frontmatter, empty body, `---` inside a code block in the body, frontmatter-only file → `join_object(split_object(t)) == t`
  - `test_unterminated_frontmatter`: `fm_ok is False` and `body == t`
  - `test_ulid_shape`: 26 chars, Crockford base32
- [ ] **Step 3:** Run `uv run pytest backend/tests -q`. Expected: FAIL (module missing).
- [ ] **Step 4:** Implement. `split_object`: frontmatter exists only if the text starts with `---\n` and a later line is exactly `---`. `frontmatter_src` is the text between the fences, excluding them; `body` is everything after the closing fence line.
- [ ] **Step 5:** Run the tests. Expected: PASS.
- [ ] **Step 6:** Commit `feat(backend): byte-preserving text files and object splitting`.

### Task 2: Frontmatter round-trip edits

**Files:**
- Create: `backend/objectapp/frontmatter.py`
- Test: `backend/tests/test_frontmatter.py`

**Interfaces:**
- Consumes: `ObjectFile` (Task 1)
- Produces:
  - `parse_fm(src: str) -> dict`, plain Python values for reading
  - `set_keys(src: str, updates: dict[str, Any], insert_first: dict[str, Any] | None = None) -> str`: changes only those keys; keys absent from `src` are appended at the end, except `insert_first` keys, which go at the top

- [ ] **Step 1: Write failing tests.** The input `src` uses the export's shapes: `type: 'Task'` (quoted), `tags: [AI, LLM]` (flow list), `description: null`, `url: >-\n  https://…` (folded), `timeFrame: 2026-03-26T00:00:00.000Z -> 2026-03-26T00:00:00.000Z`.
  - `test_set_one_key_changes_one_line`: `difflib` over lines shows exactly one changed line
  - `test_append_missing_key_last`
  - `test_insert_id_first`
  - `test_preserves_quotes_nulls_folded_flow`: every untouched line is identical
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_frontmatter.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement with `ruamel.yaml` `YAML(typ="rt")`, `preserve_quotes=True`, `width=4096`. If ruamel re-emits an untouched line differently, fall back to line-level replacement: rewrite only the lines whose key is in `updates`, using the ruamel output for those keys alone.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): minimal-diff frontmatter edits`.

### Task 3: Space scanning, type inference, link resolution

**Files:**
- Create: `backend/objectapp/typedefs.py`, `backend/objectapp/space.py`, `backend/tests/fixtures/space-sample/**`, `backend/tests/conftest.py`
- Test: `backend/tests/test_space.py`

**Fixture `space-sample`** (synthetic, mirrors the export shape):
- `Tasks/Write docs.md` (`type: 'Task'`, `status: Not Started`)
- `Tasks/Fix printer.md` (CRLF line endings)
- `People/Ada Lovelace.md`
- `Servers/Alpha.md`: body with two GFM tables and a `[[Ada Lovelace]]` link
- `Pages/Notes.md`: no frontmatter
- `Pages/Broken.md`: unterminated frontmatter
- `DailyNotes/2026-10-23.md` (`type: 'DailyNote'`, `date`, `reviewed: false`)
- `Pages/Alpha.md`: a title colliding with the server

**Interfaces:**
- Consumes: Tasks 1–2
- Produces:
  - `TypeDef(id: str, name: str, pluralName: str, folder: str, icon: str, color: str, propertyDefinitions: list[PropertyDef])`
  - `PropertyDef(id: str, key: str, name: str, type: Literal["text","number","boolean","url","datetime","label","entity","blocks"], isArray: bool = False)`
  - `infer_types(root: Path) -> list[TypeDef]`; `load_types(root) -> list[TypeDef]`, which writes `.object/types/<id>.json` only when that folder doesn't exist yet
  - `ObjectSummary(path: str, id: str | None, type: str, title: str, icon: str | None, createdAt: str | None, lastUpdated: str | None, tags: list[str], readOnly: bool)`
  - `Space(root: Path)` with `.types`, `.list(type_id: str | None) -> list[ObjectSummary]`, `.get(path) -> ObjectSummary`, `.read(path) -> tuple[ObjectFile, dict, str]` (the `str` is a version: sha256 of the file bytes), `.resolve(link: str, from_path: str | None) -> str | None`, `.rescan_file(path) -> None`

- [ ] **Step 1: Write failing tests**
  - `test_infers_types_from_type_field`: Task, Person, Server, DailyNote, Page, with `pluralName` = folder name
  - `test_property_kinds_inferred`: `reviewed` → boolean, `date` → datetime, `tags` → label isArray, `status` → label
  - `test_type_files_written_once`: a second load doesn't rewrite them (mtime is unchanged)
  - `test_no_frontmatter_is_page_readonly_false`, `test_broken_frontmatter_readonly_true`
  - `test_title_fallbacks`: frontmatter `title`, then the first `# heading`, then the file stem
  - `test_resolve_same_folder_first`: from `Pages/x.md`, `[[Alpha]]` → `Pages/Alpha.md`; from `Servers/…` → `Servers/Alpha.md`
  - `test_resolve_alias_and_case_insensitive`; `test_resolve_unknown_none`
  - `test_open_never_writes`: hash every file before and after `list()` and `read()` on every object; all equal
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - **Types:** a type's `id` is the slug of its name, and the folder is the most common folder among its objects. `icon` defaults from a name map (Task `ph-check-circle`, Person `ph-user`, Server `ph-hard-drives`, DailyNote `ph-calendar-blank`, Page `ph-file-text`, otherwise `ph-cube`). `color` cycles through `[blue, green, orange, purple, pink, teal, yellow, red]`.
  - **Resolution order:** exact title in the same folder; exact title anywhere (oldest `createdAt`, then path); alias; case-insensitive file stem.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): space scan, type inference, link resolution`.

### Task 4: HTTP API with safe body saves

**Files:**
- Create: `backend/objectapp/server.py`
- Modify: `backend/objectapp/space.py` (add `save_body`)
- Test: `backend/tests/test_server.py`

**Interfaces:**
- Consumes: `Space` (Task 3)
- Produces:
  - `Space.save_body(path: str, body: str, base_version: str) -> str`, which returns the new version and raises `Conflict(current_version)` or `ReadOnly`
  - `create_app(space: Space, static_dir: Path | None) -> FastAPI`
- **Routes:**
  - `GET /api/space` → `{name, root, types: TypeDef[]}`
  - `GET /api/objects?type=` → `ObjectSummary[]`
  - `GET /api/object?path=` → `{summary, frontmatter, body, version}`
  - `PUT /api/object/body` with `{path, body, baseVersion}` → `200 {version}` | `409 {currentVersion}` | `423 {reason}`
  - `GET /api/resolve?link=&from=` → `{path}` | `404`
  - static files at `/`

- [ ] **Step 1: Write failing tests** (FastAPI `TestClient` on a tmp copy of the fixture):
  - `test_save_identical_body_writes_nothing`: the mtime is unchanged and the version is the same
  - `test_save_sets_lastUpdated_and_id`: the diff is the body change + the `lastUpdated` line + an `id` line inserted first, nothing else
  - `test_save_preserves_crlf`: on `Tasks/Fix printer.md`, every line still ends with `\r\n`
  - `test_conflict_on_stale_version`: modify the file on disk, then PUT with the old version → 409, and the file holds the disk content
  - `test_readonly_broken_frontmatter`: 423
  - `test_binds_localhost_only`: `__main__` builds its uvicorn config with `host == "127.0.0.1"`
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. `save_body`:
  1. Re-read the file and compare its version with `base_version` (409 on mismatch).
  2. If the body is unchanged, return without writing.
  3. Otherwise apply `set_keys` (with `lastUpdated`, and `id` first if absent).
  4. `join_object`, then `encode` with the original EOL/BOM, then `atomic_write`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): object API with conflict-safe saves`.

### Task 5: File watcher and live events

**Files:**
- Create: `backend/objectapp/watcher.py`
- Modify: `backend/objectapp/server.py` (add `GET /api/events`, SSE)
- Test: `backend/tests/test_watcher.py`

**Interfaces:**
- Produces:
  - `SpaceWatcher(space: Space, loop)` with `.start()`, `.stop()` and `.events: asyncio.Queue[ChangeEvent]`
  - `ChangeEvent(kind: Literal["created","changed","deleted"], path: str, version: str | None)`
  - SSE event name `change`, whose data is the ChangeEvent as JSON
- **Debounce:** 150 ms per path. **Self-write suppression:** writes made by `save_body` don't produce events. Ignore `.object*` and dot-folders.

- [ ] **Step 1: Write failing tests**
  - `test_external_edit_emits_changed`: within 2 s, the summary is refreshed in `Space`
  - `test_own_save_emits_nothing`
  - `test_new_file_emits_created_and_is_listed`
  - `test_ignored_folders_silent`
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement with `watchdog.observers.Observer` and `loop.call_soon_threadsafe`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): watch space and stream changes`.

### Task 6: Front-end scaffold, theme and app shell

**Files:**
- Create: `frontend/**` scaffold (`npm create vite@latest frontend -- --template react-ts`), `src/theme/tokens.css`, `src/api/client.ts`, `src/api/types.ts`, `src/shell/{TopBar,Sidebar,MainPanel,RightPanel}.tsx`, `src/App.tsx`
- Modify: `backend/objectapp/__main__.py` (launcher)
- Test: `frontend/src/shell/Sidebar.test.tsx`

**Interfaces:**
- Consumes: the API routes (Task 4)
- Produces:
  - `api.space()`, `api.objects(type?)`, `api.object(path)`, `api.saveBody(path, body, baseVersion)`, `api.resolve(link, from?)`
  - `api.onChange(cb: (e: ChangeEvent) => void): () => void`
  - TS types mirroring the Task 3 dataclasses, with the same field names

- [ ] **Step 1:** Scaffold the app. Add Tailwind v4 (`@tailwindcss/vite`) and shadcn/ui (`npx shadcn@latest init`; add `button`, `dialog`, `dropdown-menu`, `scroll-area`, `tooltip`). Add `@fontsource/inter` and `@iconify/react` with the offline `@iconify-json/ph` set. The Vite dev proxy sends `/api` → `http://127.0.0.1:8790`.
- [ ] **Step 2:** Write `tokens.css`: the Global Constraints colours as CSS variables, mapped in `@theme` (`--color-app`, `--color-panel`, `--color-raised`…). `body` uses Inter with `font-size: 15px`.
- [ ] **Step 3: Write a failing test.** `Sidebar` renders "+ New", Calendar/Tasks/Graph placeholders (disabled until M4/M5), "Pinned" with an italic "No pinned content", and "Object Types" listing a mocked `TypeDef[]` with icon chips in each type's colour, in alphabetical order.
- [ ] **Step 4:** Run `cd frontend && npx vitest run`. Expected: FAIL.
- [ ] **Step 5:** Implement the layout to match `01-calendar-day.png`:
  - **Sidebar:** about 330 px on `--bg-app`, with the "+ New" (disabled until M2) and search buttons and the section headers
  - **Main panel:** inset 8 px, radius 12 px, `--bg-panel`
  - **Top bar:** about 44 px, with the space name + chevron, sidebar toggle, ‹ ›, a tab strip slot, `+`, and the right-panel toggle
  - **Right panel:** about 500 px wide, toggleable, empty
- [ ] **Step 6:** Implement `__main__.py`:
  1. Parse `--space`, `--port` (default 8790) and `--browser`.
  2. Build `Space`, start the watcher, then run uvicorn on `127.0.0.1` in a thread.
  3. Open `webview.create_window("Object", url, width=1440, height=900)` (or `webbrowser.open` with `--browser`).
  4. Serve the static files from `frontend/dist`.
- [ ] **Step 7:** Verify:
  - `cd frontend && npx vitest run` → PASS
  - `npm run build`
  - `uv run objectapp --space backend/tests/fixtures/space-sample` → a window opens showing the sidebar with Task, Person, Server, DailyNote and Page types
- [ ] **Step 8:** Commit `feat(frontend): themed app shell and launcher`.

### Task 7: Markdown blocks with byte preservation

**Files:**
- Create: `frontend/src/editor/blocks.ts`, `frontend/src/editor/preserve.ts`
- Test: `frontend/src/editor/preserve.test.ts`, fixtures in `frontend/src/editor/__fixtures__/` (copies of the Task 3 bodies, plus a generated 1 MB body with 300 tables)

**Interfaces:**
- Produces:
  - `SourceBlock = { kind: string; raw: string }`
  - `splitBlocks(body: string): SourceBlock[]`, which uses `marked.lexer(body)` and keeps each token's `.raw`. Invariant: `joinBlocks(splitBlocks(b)) === b`.
  - `joinBlocks(bs: SourceBlock[]): string`
  - `preserveBlock(original: string, regenerated: string, kind: string): string`, which returns `original` if the normalised versions match. For `table` and `list` it does line alignment: keep each original line whose normalised content (cells trimmed; bullet marker and indent stripped) equals a regenerated line. Changed lines take the regenerated text but copy the original's bullet character, indent width and table cell padding style.
  - `serializeWithPreservation(blocks: { raw?: string; markdown: string; kind: string }[]): string`

- [ ] **Step 1: Write failing tests**
  - `test split/join identity` on every fixture, including CRLF-normalised text, HTML, `Field::` lines, Mermaid and nested lists
  - `test unchanged block keeps raw`
  - `test one table cell edit changes one line` (the line diff count is 1)
  - `test one list item edit keeps '*' bullets and 4-space indent`
  - `test column added rewrites table` (allowed)
  - `test 1MB body splits under 300ms`
- [ ] **Step 2:** Run `npx vitest run src/editor`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(editor): block-level and line-level markdown preservation`.

### Task 8: Formatted editor with autosave and raw mode

**Files:**
- Create: `frontend/src/editor/Editor.tsx`, `frontend/src/editor/extensions/{blockSource,rawBlock,wikilink}.ts`, `frontend/src/editor/RawMode.tsx`
- Test: `frontend/src/editor/Editor.test.tsx`

**Interfaces:**
- Consumes: `splitBlocks`, `serializeWithPreservation` (Task 7); `api.saveBody` (Task 6)
- Produces:
  - `<Editor path: string body: string version: string readOnly: boolean onSaved(version: string) onConflict(currentVersion: string) />`
  - `<RawMode path text version onSaved />`
- **Extensions:** StarterKit (headings 1–4, lists, quote, code, hr), TaskList/TaskItem, Table, `@tiptap/markdown`; the `blockSource` attribute on every top-level node (holds the `SourceBlock.raw`, cleared when the node changes); `rawBlock` (an atom node rendering unmodelled source, such as HTML, `Field::` or Mermaid, as monospace editable text); `wikilink` (inline atom, attrs `{target, label}`).

- [ ] **Step 1: Write failing tests** (Vitest + jsdom, Tiptap headless):
  - `test load then serialize without edits returns original body`
  - `test typing in paragraph 3 only changes paragraph 3`
  - `test Field:: line survives untouched`
  - `test autosave debounced 1000ms calls saveBody once`
  - `test no save when content unchanged`
  - `test conflict calls onConflict`
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - **Load:** for each `SourceBlock`, parse its raw text into nodes; stamp `blockSource` on the first top-level node of each; blocks that `@tiptap/markdown` can't parse cleanly become `rawBlock`.
  - **Save:** walk the top-level nodes; stamped and unchanged nodes emit `raw`; others emit markdown via `preserveBlock`.
  - **Autosave:** 1000 ms after the last change, and on blur.
- [ ] **Step 4:** Add `RawMode`: CodeMirror 6 with the markdown language over the **body** text, saving through the same `saveBody`.
- [ ] **Step 5:** Run. Expected: PASS.
- [ ] **Step 6:** Commit `feat(editor): formatted block editor with preserving autosave`.

### Task 9: Objects as page and peek, tabs, wikilinks

**Files:**
- Create: `frontend/src/nav/tabs.ts`, `frontend/src/types/TypePage.tsx`, `frontend/src/object/{ObjectPage,ObjectPeek,ObjectHeader,PropertyPanel}.tsx`, `frontend/src/links/LinkPicker.tsx`
- Test: `frontend/src/nav/tabs.test.ts`, `frontend/src/object/ObjectPeek.test.tsx`

**Interfaces:**
- Consumes: Tasks 6 and 8
- Produces:
  - **Store** (zustand): `useTabs()` with `tabs: Tab[]`, `activeId`, `open(target: Target, opts?: {newTab?: boolean})`, `back()`, `forward()`, `close(id)`, persisted to `localStorage`
  - `Target = {kind: "type", typeId} | {kind: "object", path}`
  - `usePeek()` with `peek(path, list?: string[])`, `close()`, `next()`, `prev()`

- [ ] **Step 1: Write failing tests**
  - `test back/forward history per tab`
  - `test open newTab adds tab`
  - `test peek pager steps through list and shows "2 / 5"`
  - `test unresolved wikilink renders dimmed`
  - `test link click opens peek; ctrl+click opens new tab`
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement to match `05-object-peek-person.png`.
  - **Peek:** a modal about 1240×850, radius 12, `--bg-raised-2`.
  - **PropertyPanel:** left side, about 370 px, `--bg-panel`, read-only in M1. Rows have an icon and label, the value or a muted "Empty", and dividers.
  - **Header:** a type chip in the type's colour; the icon and title (36 px, bold); muted tags.
  - **Controls:** the body Editor; the ‹ › pager bottom-right; expand ↗ and `…` (M1 items: Open in new tab, Reveal in Explorer via `POST /api/reveal`, Raw Markdown toggle).
  - **TypePage (M1):** header (icon tile + plural name) and a plain list of titles, with click to peek.
  - **Wikilink chip:** coloured by the target type; hovering shows the title.
  - **`[[` trigger:** opens `LinkPicker`, which fuzzy-matches titles from `api.objects()` and inserts `[[Title]]`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ui): tabs, type list, object page and peek, wikilinks`.

### Task 10: External changes and conflicts in the UI

**Files:**
- Modify: `frontend/src/editor/Editor.tsx`, `frontend/src/App.tsx`
- Create: `frontend/src/object/ConflictDialog.tsx`
- Test: `frontend/src/object/ConflictDialog.test.tsx`

**Interfaces:**
- Consumes: `api.onChange` (Task 6), `onConflict` (Task 8)

- [ ] **Step 1: Write failing tests**
  - `test clean editor reloads on external change`
  - `test dirty editor shows dialog with Keep mine / Take theirs`
  - `test Keep mine saves against new version`
  - `test Take theirs discards local edits`
  - `test sidebar counts refresh on created/deleted`
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. A change event for the open path reloads the editor if it's clean, and shows `ConflictDialog` (side-by-side text) if it's dirty.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ui): live reload and conflict resolution`.

### Task 11: Milestone acceptance

**Files:**
- Create: `scripts/m1_roundtrip.py`, `docs/superpowers/plans/m1-acceptance.md` (results)

- [ ] **Step 1:** Write `scripts/m1_roundtrip.py SPACE`:
  1. Start the server on a free port against a **copy** of SPACE.
  2. For every object, GET it, then PUT the identical body.
  3. Assert that no file's bytes changed.
  4. Then, for 10 objects, replace one word in the first paragraph line of the body, PUT that body, and print `git diff --stat`. (Editor-side preservation is already covered by the Task 7 and 8 tests; this pass checks the server's write path.)
- [ ] **Step 2:** Run it against `backend/tests/fixtures/space-sample`. Expected: "0 files changed" on the no-edit pass, and one body line + `lastUpdated` (+ `id`) per edited file.
- [ ] **Step 3:** Gene copies his work export (a `.zip`), extracts it **outside the repo** (for example `C:\Users\genehively\Object Spaces\CPI\`), and runs `git init` there so diffs are visible. Then `uv run objectapp --space <that folder>`.
- [ ] **Step 4:** Manual checks, recorded in `m1-acceptance.md`:
  - the sidebar shows the 13 CPI types
  - an object opens in the peek, and the pager works
  - editing a paragraph changes only that line in `git diff`
  - an edit in VS Code while the app is open reloads in the app
  - side by side with `01-` and `05-`, the shell and peek look right
- [ ] **Step 5:** Commit `chore: milestone 1 acceptance`.
