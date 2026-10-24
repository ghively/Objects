# Object, Milestone 2: Object Types and Properties. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Object types and properties work as they do in Capacities:
- Object Type Settings, applied to the object page (layout, font, wide mode, cover image).
- Every property kind, edited in the property panel and written to frontmatter with minimal diffs.
- Title edit with rename-with-relink, change type, create, and delete to a restorable trash.
- Templates, and tags as objects.
- M1's simplified type JSON migrates to the full shape without loss.

**Architecture:**
- **Two parallel tracks.** **backend** (`backend/**`, `scripts/**`) and **frontend** (`frontend/**`) never touch the same file. The frontend builds against the **API contract** below and mocks it in tests. **integrate** (Task 20) adds fixtures and runs end to end.
- **Back end:** a v2 type model with lossless migration; a per-kind value codec; one safe write engine (`Space._write`) for every write; a trash for objects and types; ChangeEvent kinds `renamed` and `types`.
- **Front end:** pure formatting; one cell per kind; Capacities' menus and strings; a property panel whose writes are serialized with the body autosave; Object Type Settings; the page layouts; the lifecycle UI.

**Tech Stack:** as M1. Front-end additions: shadcn `input textarea popover command checkbox switch select context-menu alert-dialog`, `@dnd-kit/core` + `@dnd-kit/sortable`, and `@iconify-json/vscode-icons` (offline, next to M1's `@iconify-json/ph`). No new Python dependencies.

**Spec:** `docs/superpowers/specs/2026-10-23-object-design.md` §3–§4.
- Reference for behaviour and names only (never copy code): `.reference/recovered-ts/src/shared-logic/models/{property,component,date,blocks}.model.ts`, `util/{structureHeuristicsBackbone,colorThemes,basicStructures,propertyHelper}.ts`.
- **en-US UI strings: `.reference/app-unpacked/dist/virtual_intlify-i18n-0366822.js`.** `defaultLocale36682.js` is only d3-format's number locale. Quoted strings below come from that bundle; take any others from it too.
- Behaviour not in the strings: grep the renderer bundle (`useSyncedSpacePreferences36682.js` holds AddPropertyMenu, the number-format menu and the progress ring; `storing36682.js` holds the basic structures and the number formatter). Layout sizes: `index36682.css`.

## Roadmap (one plan per milestone, written when the previous one is accepted)

| M | Delivers |
|---|---|
| 1 (accepted) | shell, objects on disk, page + peek, block editor with byte preservation, wikilinks, external changes |
| **2 (this plan)** | object types and all property kinds: type settings UI and page layouts, property panel editing, title edit and rename-with-relink, change type, templates, tags as objects |
| 3 | views (list, grid, wall, table, embed, kanban, gallery), filters, sorts, group-by, calculations, collections, queries, pinned; per-type card and link views |
| 4 | calendar (day / three days / week / month, mini month), daily notes, tasks (status categories, priority, due, recurrence, reminders); type calendar options |
| 5 | SQLite FTS index, Ctrl+K command palette, backlinks + unlinked mentions, global and local graph; per-property searchable |
| 6 | whiteboards (blocks, 12 shapes, frames, circuits, connectors) + Wacom freehand ink |
| 7 | remaining block options (toggles, colours, columns, math, media embeds), media objects (Image, PDF, Audio, Video, Weblink, File behaviour), light mode, side-by-side polish against Capacities |

## Global Constraints

**Carried forward from M1**
- **Server:** `127.0.0.1:8790` only, no outbound network. Python `>=3.13` with uv; Node `>=22` with npm.
- **Writes:**
  - **Opening never writes an object (`.md`) file.** A write with no effective change writes nothing. The only writes on open are inside `.capacities/`, and only these: (1) the first-open type JSON when `types/` is missing (M1 behaviour); (2) the one-time v1→v2 type migration with its backups; (3) the built-in Page and Tag type JSON when missing; (4) purging trash entries older than 30 days. A second open writes nothing at all.
  - Writes are atomic: `atomic_write(check=…)` re-checks the version just before `os.replace`.
  - EOL, BOM and the trailing newline are preserved (`encode_like`).
- **Space:** app data lives in `.capacities/`; dot-folders are ignored. Missing frontmatter is editable (the first write creates the fence block). Malformed frontmatter, a fence with trailing whitespace, or non-UTF-8 text is read-only (423).
- **UI:** M1 tokens (`--border-subtle`); no light theme until M7.
- **Data:** no real CPI data in the repo.
- **Tests:** baseline backend 95, frontend 8 files and 67 tests. Every task keeps all earlier tests green.

**New in M2**
- **Tracks.** Tasks 1–10 touch only `backend/**` and `scripts/**`; Tasks 11–19 touch only `frontend/**`. The API contract is the only coupling, and changing it is a plan change.
- **One write engine.** `Space._write` does, in order:
  1. Re-read the file.
  2. Check `base_version` (409) and read-only (423).
  3. Edit with `set_keys` / `delete_keys` / `rename_key` / the in-place link rewriters. A file with no frontmatter gets a new fence block (`---\n…---\n` before the unchanged body, in the file's EOL).
  4. `encode_like`.
  5. Register `own_writes` (and `own_deletes` for moves).
  6. `atomic_write(check)`.
  7. `rescan_file`.
  8. The route announces `ChangeEvent(origin=clientId)` for **every** path it wrote: the main path and each `synced`, `relinked` and `rewritten` path. The client emits the same events locally, because it drops SSE events with its own `origin`.
- **Stamping.**
  - User edits to an object stamp `lastUpdated` (adding `id` if missing): properties, title, change type, template apply and relation sync of the target.
  - **Rewrites of *other* files on the user's behalf change only the affected lines and stamp nothing.** This covers relinks, tag lists, type renames (`type:` lines), label-option renames and deletes, deleted-property keys, relation-rule enforcement, kind-change copies, sync backfill, and the `id` inserted by `ensure-id`.
  - Those rewrites retry once on `Conflict`; if it fails again, or the file is read-only, they are reported in `skipped: [{path, reason}]` and the file's bytes are left unchanged.
- **Confirmation (428).** These return `428 {detail, affected}` unless the request has `confirm: true`: deleting a property; deleting a label option that is in use; a relation or label config change that removes values (multi→single, changed linked types, a new or narrower fixed set); deleting a type. `affected` is the number of files that would change. Renaming an option, a property or a type, and changing a property's kind (which adds a new property, see Task 6), need no confirmation.
- **Keys.** A property's frontmatter `key` never changes; renaming changes `name` only. A new key is the camelCase of the name, unique within the type, and never a **reserved key**: `id type template title icon iconColor description aliases tags collections createdAt lastUpdated coverImage color`, plus the basic media fields (`url domain iframeUrl previewImage mimeType fileSize width height source`) and DailyNote's `date reviewed`. A collision with a reserved key or an existing key of the type appends `_` as the export does (`type_`), then `_2`, `_3`.
- **Value forms** (spec §4; the shapes the export uses). "Same form" means the encoder keeps the form the existing line already uses, so the first edit of an exported value changes only the value.

  | Kind | On disk | API value |
  |---|---|---|
  | text, url, textBlock (inline Markdown) | string, single-quoted when YAML needs quotes | `string\|null` |
  | blocks (extra content properties; the first is the body), simpleTableBlock (GFM) | YAML literal `\|-` of Markdown (design choice) | `string\|null` |
  | number | int or float. **percentage** stores the fraction (`0.25` shows 25%); **progress** stores the count of steps done (`4` with 10 steps shows 40%) | `number\|null` |
  | boolean | `true` / `false` | `boolean` |
  | datetime, datetimeSimple | day `2026-10-30`; time `2026-10-30T14:00:00.000Z`; range `start -> end`; all unquoted. **Export form:** on a property whose `resolutionConstraint` or `resolutionPreference` is `day`, a midnight-UTC timestamp (`2026-03-26T00:00:00.000Z`) decodes as a day, and a day value written to a line already in timestamp form is written as midnight UTC (same form). New lines use the date-only form. | `{start, end?, resolution:'day'\|'time'}\|null` |
  | entity | `'[[Title]]'` or a list of them. When the title does not resolve to the chosen object from this file (duplicate titles), the link is the space path without `.md`: `'[[Pages/Untitled]]'` | read: `EntityRef[]` = `{target, path\|null}` (single-select: ≤1); write: `EntityRef[]`, where `path` wins and `target` is used verbatim when `path` is null |
  | label | option text or a list of texts | `string[]` (single-select: ≤1) |
  | tags, aliases (max 8, unique) | flow list | `string[]` |
  | icon | `icon: ph-…` (any Iconify id) or an emoji; a colour, only when set, as `iconColor: <c>` | `Icon\|null` |
  | coverImage | space-relative image path (`Attachments/cover.png`) | `string\|null` |
  | color (Tag objects) | `bg-<c>` | `string\|null` |
  | cleared | `key: null` if the key exists, else nothing | `null` / `[]` |
- **System properties** are definitions whose id equals their key, in this order: `title, collections, description, createdAt, lastUpdated, tags, icon, aliases`, plus `type`, `backlinks` and `coverImage` when added, and `color` on Tag. Collections are display-only until M3; backlinks show a count until M5.
- **Types.**
  - **Basic types:** Page, Tag, Task and DailyNote, plus Capacities' media types when the space has objects of them (`Weblink`, `File`, `Image`, `PDF`, `Audio`, `Video`, `Tweet`, matched by name case-insensitively). Their media fields become system definitions (read-only cells) and their media behaviour comes in M7.
  - **On a basic type**, adding, removing or re-kinding a property, changing its key or `isArray`, renaming the type and deleting it are refused (422, "Properties of basic object types cannot be edited."). Allowed: label options (add, rename, recolour, re-icon, reorder, delete), property name, icon, description and visibility, number format, date constraints, type icon, colour and description, templates, and the layout settings.
  - Page and Tag always exist. Tag: folder `Tags` (the folder is created by the first tag, never on open), icon `ph-tag`, no templates.
  - **Status mode** exists only on Task's built-in `status` label (`isStatus: true`), as in Capacities' basic Task structure. Users cannot turn other labels into status labels.
  - An object finds its type through `type: '<Name>'`: matched against the type's name, then its id, then its `formerNames` (case-insensitively). Renaming a type rewrites the `type:` lines and keeps the old name in `formerNames`, so a skipped file still resolves.
  - `folder` is fixed when the type is created (from `pluralName`). Renaming the type or its plural never moves files or templates.
- **File names.**
  - `safe_filename(title)` follows the export: the title up to its first character that is illegal in a Windows file name (`\ / : * ? " < > |` and control characters), with whitespace collapsed and trailing dots and spaces stripped, capped at 120 characters. If that is empty, the illegal characters are dropped instead; if still empty, `Untitled`. (`What if? A/B: "test" <1|2>` → `What if`, matching `Pages/What if.md`. This rule is inferred from one sample; the acceptance run checks it against the CPI copy.)
  - A collision appends ` (2)`, ` (3)`, and so on. A case-only rename of the same file is not a collision.
  - `title:` keeps the full title.
- **Templates** are files with a `template: <name>` key. A template belongs to the type named by its `type:` key; its folder `Templates/<last segment of the type's folder>/` is placement only.
  - They are excluded from `list()`, the resolver, counts and inference.
  - Load discovers them: a type's template list is its `templates.ids` order, followed (in memory, never written on open) by discovered templates of that type not in `ids`. `defaultTemplateId` comes only from the type JSON.
  - Allowed for Page, custom types and Task; DailyNote templates come in M4.
- **Trash.** This is the app's own trash in `.capacities/trash/`, as in Capacities' SpaceTrashMenu ("Trash is empty", "Empty Trash"). It is **not** the Windows Recycle Bin; nothing is sent there.
  - An object goes to `.capacities/trash/<ulid>.md` plus `<ulid>.json` `{id, kind:'object', originalPath, title, type, deletedAt, typeTrashId?}`.
  - A type goes to `.capacities/trash/types/<ulid>/` with `type.json`, its template files, and `manifest.json` `{id, kind:'type', typeId, name, deletedAt, objectTrashIds, allowedTypesRefs}`. Its objects become object entries with `typeTrashId`.
  - Entries are purged after 30 days, when the space opens. This is safer than Capacities' hard delete, so our delete dialogs say the items move to the Trash.
- **Colours.**
  - 18, in this order: `gray rose pink fuchsia purple violet indigo blue sky cyan teal emerald green lime yellow amber orange red`.
  - Names are capitalised, except sky = "Light blue".
  - New label options and tags get a random colour.
  - Numbers format as `en-US` by default; the per-property "Separators" (`isGroupingThousands`, default on; `isRadixComma`, which swaps `,` and `.`) are part of M2.
- **Store-only fields.** Kept and round-tripped, with no UI and no effect in M2: the type's `structureViews`, `defaultViewType`, `defaultViewIds`, `defaultPageViewId`, `smallCardViewConfig` (M3/M7), `createInCalendarOption`, `hideFromCalendarSidebar` (M4), and the property's `hideCalendarEvents`, `supportsReminders` (M4) and `isNotSearchable` (M5). Collections likewise until M3.

## API contract (M2): shared by both tracks

```
TypeDef { schemaVersion: 2, id, name, pluralName, folder, formerNames: string[], icon: Icon, color, description, basic,
  propertyDefinitions: PropertyDef[], collectionsPropertyPosition,
  viewDesign: null|'indexCard'|'profile'|'encyclopedia', font: 'sans-serif'|'serif'|'monospace',
  wideLayoutMode, wideCoverImage, cropCoverImage, templates: {ids, defaultTemplateId|null},
  readOnlyReason: string|null /* API only: set when the type file can't be read */,
  revision /* API only: sha256 of the file, '' if unsaved */, ...unknown and store-only keys kept }
Icon { type: 'emoji'|'iconify', val, color? }
PropertyDef { id, key, name, type: PropertyType, description, icon: Icon|null, visibility: 'alwaysShow'|'hideWhenEmpty'|'hidden',
  isNotSearchable?, options, ...unknown keys kept }
PropertyType = text|textBlock|simpleTableBlock|number|boolean|url|datetime|datetimeSimple|entity|label|blocks|coverImage|color
  |entity_title|entity_icon|entity_description|entity_aliases|entity_tags|entity_type|entity_collections
  |entity_createdAt|entity_lastUpdated|entity_backlinks
options number:    {numberFormat?: {type:'number'|'currency'|'percentage'|'progress', options:{currency?, decimals?:{min?,max?},
                    progress?:{steps,color}, separators?:{isGroupingThousands?, isRadixComma?}}}}
        datetime*: {constraints?: {resolutionConstraint?, resolutionPreference?, endTimeSettings?: 'required'|'notAllowed',
                    endTimePreference?, startTimeDefault?: iso, endTimeDefault?: iso, hideDeleteOption?}, hideCalendarEvents?}
        entity:    {isArray=true, allowedTypes: typeId[], hasFixedSet, fixedSet: objectId[], propertySyncing?: {propertyIds}}
        label:     {isArray=false, set: LabelOption[], isStatus?}
LabelOption { id, text (≤100), color|null, icon|null, statusCategory?: 'not-started'|'in-progress'|'blocked'|'done' }
EntityRef     { target, path: string|null }
KIND_TRANSFORMS  text,textBlock → text,textBlock,url,number,boolean,label · url → text,textBlock · number → text,textBlock,label
                 boolean → text,textBlock · label → text,textBlock · entity → label,text,textBlock
                 datetime ↔ datetimeSimple · datetime, datetimeSimple → text,textBlock · everything else: none
TrashItem     { id, kind: 'object'|'type', originalPath, title, type, deletedAt, typeTrashId?, objectCount? }
ObjectSummary += description, aliases, template: str|None, color: str|None (tags: 'bg-<c>'), coverImage: str|None, iconColor: str|None
ObjectDetail  += links: {[key]: (path|null)[]}   /* GET /api/object: each entity value resolved from this file */
ChangeEvent   += kinds 'renamed' (oldPath set) and 'types' (path = type id); field oldPath = None
```

| Route | Request | Success | Errors |
|---|---|---|---|
| `PUT /api/object/properties` | `{path, updates:{key: v\|null}, remove?, baseVersion, clientId?}` | `{version, frontmatter, links, synced, skipped}` | 409 `{currentVersion}`, 423, 422 `{detail}`, 404 |
| `POST /api/object/ensure-id` | `{path, clientId?}` | `{id, version}` | 423, 404 |
| `POST /api/object/rename` | `{path, title, baseVersion, clientId?}` | `{path, version, relinked, skipped}` | 409, 423, 422 |
| `GET`/`POST /api/object/change-type` | `?path=&typeId=` / `{path, typeId, mapping:{from: to\|null}, baseVersion, clientId?}` | `{rows:[{fromKey,toKey,lossy}]}` / `{path, version, relinked, skipped}` | 409, 423, 422 |
| `POST /api/objects` | `{typeId, title?, templateId?: id\|null\|"none", clientId?}` | 201 `{path, version}` | 404, 422 |
| `DELETE /api/object?path=&baseVersion=&clientId=` | `baseVersion` optional | `{trashId}` | 404, 409 |
| `GET /api/trash` · `POST /api/trash/{id}/restore` · `DELETE /api/trash[/{id}]` | `?clientId=` on writes | `TrashItem[]` · `{paths, typeIds}` · `{purged}` | 404 |
| `POST /api/types` | `{name, pluralName, icon?, color?, clientId?}` | 201 `TypeDef` | 422 |
| `PUT /api/types/{id}` | `{type, baseRevision, confirm?, clientId?}` | `{type, rewritten, skipped}` (`type.revision` is the new revision) | 409 `{currentRevision}`, 422, 423, 428 `{detail, affected}` |
| `POST /api/types/{id}/properties/{pid}/change-kind` | `{toType, baseRevision, clientId?}` | `{type, newPropertyId, rewritten, skipped, lossy}` | 409, 422 |
| `POST /api/types/{id}/properties/{pid}/sync` | `{targetPropertyId: id\|null, createName?, baseRevision, clientId?}` | `{types: TypeDef[], rewritten, skipped}` | 409, 422 `{detail}` |
| `DELETE /api/types/{id}?confirm=true&clientId=` | | `{trashId}` | 422, 428 |
| `GET`/`POST /api/types/{id}/templates` | `{name?, clientId?}` | `ObjectSummary[]` / 201 `{path, version}` | 422 |
| `POST /api/object/apply-template` | `{path, templateId, baseVersion, clientId?}` | `{version}` | 409, 422 |
| `POST /api/tags/ensure` | `{name, clientId?}` | `{path, created}` | |
| `GET /api/images` · `POST /api/images?name=` (raw bytes) · `GET /api/file?path=` | | `{path}[]` · 201 `{path}` · image bytes | 404, 415 |

Every write route announces a ChangeEvent with `origin = clientId` for each path it wrote (`created`, `changed`, `deleted`, `renamed`, `types`); the watcher stays silent for them through `own_writes` / `own_deletes`.

## Review Focus

1. **Migration loses nothing, and opening writes no object.**
   - A v1 type with an unknown key, an unknown property field and a malformed property entry keeps all three. A type file that isn't valid JSON is left alone and its type is read-only.
   - The original is backed up, and a second load writes nothing. Opening `space-v1` writes zero `.md` files.
   - *(Task 1: `test_migrate_v1_preserves_every_property`, `test_bad_property_entry_preserved`, `test_migrate_backs_up_v1_and_writes_once`, `test_unparseable_type_file_untouched`, `test_open_writes_no_md_files`)*
2. **A property edit is a minimal diff.**
   - One label change touches that line plus `lastUpdated`. Each kind renders the bytes in the value-forms table.
   - A stale version returns 409 and leaves the file untouched. A rewrite of another file that keeps conflicting is skipped, never overwritten.
   - *(Task 2: `test_set_keys_bytes_per_kind`; Task 3: `test_update_label_changes_one_line`, `test_update_stale_version_409_no_write`, `test_sync_target_conflict_retried_then_skipped`)*
3. **Rename relinks exactly the right links.**
   - Only link text changes, and CRLF, quote style and the other list items survive.
   - `[[Old|alias]]` keeps its alias.
   - `[[Alpha]]` that resolves to the *other* Alpha is untouched.
   - The count is reported.
   - *(Task 7: `test_rename_relinks_only_link_lines`, `test_rename_relinks_list_item_keeps_quotes`, `test_rename_keeps_alias_and_heading_suffix`, `test_rename_referrer_crlf_preserved`, `test_rename_skips_links_to_colliding_title`)*
4. **Change type keeps data.**
   - A file without frontmatter gets an `id` that survives the move; a file with frontmatter keeps its `id` and the quotes of `type:`.
   - Unmapped keys stay, and links that pointed at the old file name still resolve.
   - *(Task 8: `test_change_type_inserts_id_and_moves`, `test_change_type_keeps_quotes_and_collides`, `test_change_type_keeps_unmapped_keys`, `test_links_resolve_after_move`)*
5. **Body and property edits interleave without loss.**
   - A property edit while the body is dirty flushes the body first, writes on the new version, and resumes the editor on the returned version.
   - If the body flush itself conflicts, the queue stops: one ConflictDialog, no second 409, and the property edit is replayed after the conflict is resolved.
   - *(Task 15: `test property edit while body dirty keeps both`, `test body flush conflict stops queue and replays property edit`)*
6. **Type edits cascade safely.** A type rename keeps every object attached; deleting a type is restorable; relation rule changes ask first.
   - *(Task 5: `test_rename_type_rewrites_type_lines_unstamped`, `test_entity_multi_to_single_requires_confirm_and_keeps_first`; Task 4: `test_restore_type_restores_objects_and_templates`)*

---

## File Structure

```
backend/objectapp/  typemodel.py propvalues.py relink.py changetype.py templates.py trash.py media.py   NEW
                    typedefs.py frontmatter.py space.py watcher.py server.py                              MOD
backend/tests/      test_{typemodel,propvalues,properties,lifecycle,types_api,kindsync,rename,changetype,templates,tags}.py
frontend/src/       api/ test/mockApi.ts theme/palette.ts components/{Icon,IconPicker,ColorPicker}.tsx
                    properties/{kinds,format,currencies,typeEdits}.ts  properties/*.tsx  properties/cells/*Cell.tsx
                    object/{useObjectWrites.ts,useTypeEditor.ts,…Dialog.tsx,TemplateMarker,UseTemplateMenu,DeletedBanner,
                            CoverImage,PageLayout}  types/{TypeSettings,…}.tsx
                    create/  trash/  nav/tabs.ts  shell/Sidebar.tsx  App.tsx
scripts/m2_acceptance.py   backend/tests/fixtures/space-sample/{Projects,Tags,Templates,Attachments}/   backend/tests/fixtures/space-v1/
```

---

### Task 1: Type model v2 and lossless migration (track: backend)

**Files:**
- Create: `backend/objectapp/typemodel.py`.
- Modify:
  - `typedefs.py`: keeps the scanning helpers (`RawObject`, `read_raw`, `iter_object_paths`, `is_ignored`, `has_undecodable`, `slug`) and `infer_types_from`, which now returns `list[TypeDefinition]`: it builds the v1-shaped dict it built before and passes it through `TypeDefinition.from_json`, so inferred and stored types share one migration path. `SYSTEM_KEYS` becomes the reserved-key set. The v1 `PropertyDef`, `TypeDef`, `PropertyKind`, `load_types` and `infer_types` are **removed**; `infer_types` callers use `infer_types_from(read_raw…)`.
  - `space.py`: `ObjectSummary` gains `description`, `aliases`, `coverImage` and `iconColor`; `self.types` is `list[TypeDefinition]`; `_merge_types` and `rescan_file` merge inferred `TypeDefinition`s **in memory only** (an inferred type is written the first time the user saves it, `PUT` with `baseRevision: ''`, or creates an object of it); `_type_id` also matches `formerNames`.
  - `server.py`: `/api/space` returns `[t.to_api() for t in space.types]` (the v2 JSON plus `revision` and `readOnlyReason`; never the Python-only `extra` / `invalid_property_entries` attributes, whose contents are already flattened into the JSON).
- Test: `test_typemodel.py`. Update `test_space.py` (Tag is present, `tags` is a system def) and any test importing the removed names.

**Interfaces:**
- Consumes: `atomic_write`, `infer_types_from`, `slug`.
- Produces:
  - `Icon(type, val, color=None)`, `Icon.parse(v) -> Icon|None`
  - `LabelOption(id, text, color, icon=None, statusCategory=None)`
  - `PropertyDefinition(id, key, name, type, description="", icon=None, visibility="alwaysShow", options={}, extra={})`; `isNotSearchable` and other unknown fields live in `extra`.
  - `TypeDefinition`: all contract fields, plus `extra` and `invalid_property_entries`, with `.to_json()`, `.to_api(revision)` and `.from_json(data)`. `from_json` reads v1 or v2 and never raises on unknown keys.
  - `UnreadableType(id, path, error)`: a type file that isn't valid JSON (or isn't an object). It is never written, backed up, migrated or replaced by an inferred type. Its objects get an in-memory placeholder `TypeDefinition` with `readOnlyReason` set, and saving it returns 423.
  - `THEME_COLORS`, `system_property_defs(include_type=False)`, `BUILTIN_TYPES`, `BASIC_MEDIA_TYPES`, `RevisionConflict(current_revision)`
  - `type_revision(root, id) -> str`, `write_type_json(root, t, base_revision) -> str` (the low-level writer; returns the new revision), `load_types(root, inferred=None) -> (list[TypeDefinition], list[UnreadableType])`

- [ ] **Step 1: Write failing tests.** v1 JSON is built inline in the tests (the `space-v1` fixture arrives only in Task 20).
  - `test_migrate_v1_preserves_every_property`: a top-level `foo` and a property field `extra: 1` survive `to_json`; every `key` keeps its `type`; `isArray` moves to `options.isArray`.
  - `test_bad_property_entry_preserved`: `"oops"` is written back verbatim, and the type still loads.
  - `test_migrate_backs_up_v1_and_writes_once`: the original is copied to `.capacities/backup/types-v1/<id>.json`; a second load leaves every file under `.capacities/` byte- and mtime-identical.
  - `test_unparseable_type_file_untouched`: `types/server.json` containing `{"id": "server",` is not backed up or rewritten, no `server` type is inferred in its place, `Servers/Alpha.md` gets a type with `readOnlyReason`, and `write_type_json` for it raises.
  - `test_open_writes_no_md_files`: open a tmp copy of the sample with v1 type JSON; every `.md` file is byte- and mtime-identical.
  - `test_inferred_type_not_written_on_open`: a type that only exists in objects (`type: 'Gadget'`) is listed, and no `gadget.json` is written.
  - `test_v1_tags_label_becomes_system_tags`
  - `test_icon_string_becomes_iconify`
  - `test_inferred_status_label_has_options_and_categories`: Task `status` has `isStatus`; "Not Started" maps to `not-started` and "In Progress" to `in-progress`. A `status` label on a non-Task type has no `isStatus`.
  - `test_inferred_day_dates_prefer_day`: a key whose values are all date-only or midnight UTC gets `resolutionPreference: 'day'`.
  - `test_media_types_basic`: a v1 `Weblink` type with `url, domain, iframeUrl, previewImage` migrates with `basic: true` and those four as system defs.
  - `test_save_type_conflict_on_stale_revision`
  - `test_tag_and_page_builtin_present`
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_typemodel.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **v1 detection:** a type with no `schemaVersion` is v1.
  - **Migration:** keep `id` and `key`. Take default icons from Capacities' `propertyIcons`. Insert the missing system defs and set `basic`. Write the backup first, then the JSON (`indent=2`, `ensure_ascii=False`, LF, trailing newline).
  - **Inferred labels:** options are the distinct observed values, coloured round-robin.
  - **Status categories** (Task `status` only):

    | Value text | Category |
    |---|---|
    | not started, next up | `not-started` |
    | in progress | `in-progress` |
    | on hold, blocked | `blocked` |
    | done, complete | `done` |
    | anything else | `not-started` |
- [ ] **Step 4:** Run `uv run pytest -q`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): v2 type model with lossless v1 migration`.

### Task 2: Frontmatter key removal and value codec (track: backend)

**Files:**
- Modify: `frontmatter.py`
- Create: `propvalues.py`
- Test: `test_frontmatter.py` (new cases), `test_propvalues.py`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `delete_keys(src, keys) -> str`: removes each key's full line span.
  - `rename_key(src, old, new) -> str`: keeps the position and the value bytes.
  - `set_keys(..., {"k": None})` renders `k: null`.
  - `replace_in_value(src, key, fn) -> str`: applies `fn` to the raw value text of one key's span (scalar, flow list, block list or literal block) and returns the source with only that span's changed characters replaced; used by the relinkers (Tasks 7 and 10).
  - `InvalidValue(ValueError)` (422).
  - `encode_value(pdef, value, existing_raw=None)` validates and keeps the existing line's form (see the date rule); `decode_value(pdef, raw)` is lenient.
  - `convert_value(src, dst, raw) -> (value, lossy)`, implementing exactly `KIND_TRANSFORMS`:
    - string → number with `float`; unparsable → `null`, lossy
    - string → boolean: `true`/`yes`/`1` → true, `false`/`no`/`0`/empty → false, anything else → false, lossy
    - string → label: the trimmed text becomes an option (created if missing)
    - entity → label strips `[[ ]]`; label → text joins with `, `; number → text with `str`; date → text uses the on-disk string
  - `label_lookup(pdef, text) -> LabelOption|None`: matches the trimmed text case-insensitively, or the id.

- [ ] **Step 1: Write failing tests**
  - `test_delete_key_removes_only_its_lines`: input
    ```
    ---
    title: X
    url: >-
      https://example.org/a
      /b
    tags: [A]
    ---
    ```
    Deleting `url` leaves exactly `---\ntitle: X\ntags: [A]\n---\n`.
  - `test_delete_absent_key_noop`, `test_rename_key_keeps_value_bytes`, `test_set_none_renders_null`
  - `test_set_keys_bytes_per_kind`: for each value-forms row, `set_keys` on `---\ntitle: X\n---\n` appends exactly: `t: hello`; `t: 'a: b'`; `b: |-\n  # H\n  - [ ] x`; `n: 1200.5`; `c: true`; `d: 2026-10-30`; `d: 2026-10-30T14:00:00.000Z`; `d: 2026-10-30 -> 2026-11-02`; `o: '[[Ada Lovelace]]'`; `m: ['[[A]]', '[[B]]']`; `s: Not Started`; `tags: [Docs, Math]`; `icon: ph-user` plus `iconColor: blue`.
  - `test_roundtrip_each_kind`: `decode(encode(v)) == v` for every value-forms row
  - `test_decode_range`
  - `test_midnight_utc_on_day_property_decodes_as_day`: with `resolutionPreference: 'day'`, `2026-03-26T00:00:00.000Z -> 2026-03-26T00:00:00.000Z` decodes to `{start:'2026-03-26', end:'2026-03-26', resolution:'day'}`; without it, to a time.
  - `test_day_value_keeps_timestamp_form`: re-encoding `2026-03-27` over that line writes `2026-03-27T00:00:00.000Z -> 2026-03-27T00:00:00.000Z`; a new key gets `2026-03-27`.
  - `test_label_matches_case_insensitively`: "not started" → "Not Started"
  - `test_label_unknown_text_422`, `test_entity_single_rejects_two_422`, `test_aliases_max_8_and_unique_422`, `test_number_rejects_string_422`, `test_day_constraint_rejects_time_value_422` (`resolutionConstraint: 'day'` with `resolution: 'time'`)
  - `test_convert_entity_to_label_lossy`, `test_convert_string_to_boolean_table`
  - `test_replace_in_value_flow_list_keeps_other_items`: `m: ['[[A]]', "[[B]]", C]` with `[[A]]`→`[[Z]]` gives `m: ['[[Z]]', "[[B]]", C]`
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_frontmatter.py backend/tests/test_propvalues.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `delete_keys` reuses `set_keys`' span finder; the span stops before trailing blank and comment lines.
  - Times are written `YYYY-MM-DDTHH:MM:SS.sssZ`, unquoted.
  - `replace_in_value` re-parses the result and raises if the key's value no longer parses; a replacement containing the enclosing quote character is escaped for that quote style (`''` in single quotes), and a plain scalar that would need quoting is single-quoted (that item only).
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): frontmatter key removal and per-kind value codec`.

### Task 3: Write engine, property updates and change events (track: backend)

**Files:**
- Modify: `space.py`, `watcher.py` (ChangeEvent kinds `renamed`, `types`, field `oldPath`), `server.py`
- Test: `test_properties.py`, plus new cases in `test_watcher.py`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `Space._write(rel, base_version: str|None, edit: Callable[[ObjectFile, dict], ObjectFile|None], stamp=True) -> str`
    - `None` means "use the current version".
    - An unchanged result writes nothing.
    - `save_body` is rebuilt on top of it.
  - `Space._rewrite_other(rel, edit) -> str|Skip`: the unstamped rewrite with one retry on `Conflict`; returns `Skip(path, reason)` on a second conflict or read-only.
  - `ChangeEvent.kind` adds `"renamed"` and `"types"`; `ChangeEvent.oldPath = None`.
  - `UpdateResult(version, frontmatter, links, synced, skipped)`
  - `Space.update_properties(path, updates, base_version, remove=()) -> UpdateResult`
  - `Space.ensure_id(path) -> (id, version)`: inserts `id` first in the frontmatter, unstamped; an existing id writes nothing.
  - `Space.resolve` also accepts a path target (`Pages/Untitled`, exact space path without `.md`) before its M1 order.
  - `Space.links_of(path, fm) -> {key: (path|None)[]}`.
  - Routes: `PUT /api/object/properties` (announces `changed` for the path and each synced path); `POST /api/object/ensure-id`; `GET /api/object` adds `links`.

- [ ] **Step 1: Write failing tests**
  - `test_update_label_changes_one_line`: `status` → `["In Progress"]` on `Tasks/Write docs.md`. The diff is exactly `status`, `lastUpdated` and the inserted `id`.
  - `test_update_no_frontmatter_creates_fence`: `Pages/Notes.md` with `{mood: 'ok'}` (no definition, passed as a JSON scalar) gives exactly `---\nid: <ulid>\nmood: ok\nlastUpdated: <stamp>\n---\n# Meeting notes\n\nNo frontmatter here. Mentions [[Alpha]].\n` (ids and stamps patched for the comparison).
  - `test_update_stale_version_409_no_write`, `test_update_readonly_423` (`Pages/Bad yaml.md`), `test_update_invalid_value_422`
  - `test_clear_existing_writes_null`, `test_clear_absent_key_writes_nothing`, `test_update_adds_missing_key_at_end`, `test_remove_key`
  - `test_crlf_preserved_on_property_update` (`Tasks/Fix printer.md`)
  - `test_key_without_definition_passes_json_scalar`
  - `test_entity_write_uses_path_form_for_duplicate_title`: two tmp objects titled "Untitled" in `Pages/` and `Notes/`; writing `[{target:'Untitled', path:'Notes/Untitled.md'}]` from a Page writes `'[[Notes/Untitled]]'`, and `links` resolves it to `Notes/Untitled.md`.
  - `test_relation_sync_adds_and_removes_backlink`:
    - tmp types A and B have synced entity defs
    - `a.rel=["B1"]` adds `'[[A1]]'` to B1, stamped
    - clearing it removes `'[[A1]]'` again
    - `synced == ["B/B1.md"]`
  - `test_sync_target_missing_is_ignored`: a link to a title that resolves nowhere syncs nothing and reports nothing.
  - `test_sync_target_readonly_reported_in_skipped`: B1 has malformed frontmatter; A1 is still written, `skipped == [{path:'B/B1.md', reason}]`, B1's bytes unchanged.
  - `test_sync_target_conflict_retried_then_skipped`: monkeypatch B1's `atomic_write` check to change B1 on disk once → one retry, then written; change it twice → `skipped`, B1's bytes equal the externally changed bytes.
  - `test_fixed_set_rejects_outsider_422`
  - `test_ensure_id_inserts_first_unstamped`
  - `test_watcher_silent_for_property_update_and_sync` (in `test_watcher.py`): neither A1 nor B1 produces a watcher event.
  - M1 body-save tests stay green.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_properties.py backend/tests/test_watcher.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Keys map through `propertyDefinitions[].key`; system keys go to system defs.
  - `title` and `type` → 422; those changes go through rename and change type.
  - Sync writes run after the main write; a sync failure never undoes the main write.
- [ ] **Step 4:** Run `uv run pytest -q`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): safe property updates with relation syncing`.

### Task 4: Create, delete, trash for objects and types (track: backend)

**Files:**
- Create: `trash.py`
- Modify: `space.py`, `watcher.py` (`own_deletes`), `server.py`
- Test: `test_lifecycle.py`, plus new cases in `test_watcher.py`

**Interfaces:**
- Consumes: Tasks 1 and 3.
- Produces:
  - `safe_filename(title) -> str`, `unique_path(root, folder, stem, same_as=None) -> str` (`same_as` lets a case-only rename keep its own path)
  - `Space.create_object(type_id, title="", template_id=None) -> (path, version)`
    - Frontmatter: `id`, `type: '<Name>'`, `title` (only when non-empty), `createdAt`, `lastUpdated`.
    - Body: `# <title>\n`, or empty; the display title of an untitled object is "Untitled".
    - Creates the folder if needed. Persists an inferred-only type first (Task 1).
    - Template handling arrives in Task 9.
  - `TrashItem` as in the contract.
  - `Space` trash methods:
    - `delete_object(path, base_version=None) -> TrashItem`: a stale `base_version` → 409. Read-only objects can be deleted (the file is moved, not rewritten).
    - `trash_type(type_def, object_paths) -> TrashItem` (the mechanism; Task 5 decides when): moves the type JSON and its template files into `trash/types/<ulid>/`, its objects into object entries with `typeTrashId`, and records in `allowedTypesRefs` which other types' relation properties pointed at it.
    - `list_trash()`
    - `restore(id) -> {paths, typeIds}`: an object returns to its original path (` (2)` on a collision); if its type is in the trash, the type definition and templates are restored with it (not its other objects). A type entry restores the type, its templates, its remaining objects, and its `allowedTypesRefs`.
    - `purge(id)`, `empty_trash()`, `purge_expired(now)`: `purge_expired` runs in `__init__`
  - `own_deletes`: the watcher pops the entry and stays silent.
  - Routes: `POST /api/objects` (announces `created`), `DELETE /api/object` (announces `deleted`), `/api/trash…` (restore announces `created` per path and `types` per type). All carry `origin`.

- [ ] **Step 1: Write failing tests**
  - `test_create_writes_minimal_frontmatter`: exact bytes for "Plan sprint" in `Tasks/Plan sprint.md`: `---\nid: <ulid>\ntype: 'Task'\ntitle: Plan sprint\ncreatedAt: <t>\nlastUpdated: <t>\n---\n# Plan sprint\n`
  - `test_create_collision_suffix`: `Tasks/Write docs (2).md`
  - `test_safe_filename_matches_export`: `What if? A/B: "test" <1|2>` → `What if`; `?Why` → `Why`; `***` → `Untitled`; a 200-character title → 120 characters.
  - `test_create_untitled`: `Pages/Untitled.md` is exactly `---\nid: <ulid>\ntype: 'Page'\ncreatedAt: <t>\nlastUpdated: <t>\n---\n` (no `title` key).
  - `test_create_unknown_type_404`
  - `test_delete_moves_to_trash_and_unlists`: bytes identical
  - `test_delete_stale_version_409`, `test_delete_readonly_allowed` (`Pages/Bad yaml.md`)
  - `test_delete_leaves_links_dangling`
  - `test_restore_returns_to_original_path`, `test_restore_collision_suffix`
  - `test_restore_type_restores_objects_and_templates`: trash a tmp type with two objects and one template, restore it, and all four files and the JSON are back byte-identical.
  - `test_restore_object_of_trashed_type_restores_type_only`
  - `test_purge_expired_30_days`
  - `test_own_delete_emits_no_event`, `test_create_emits_no_watcher_event`
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_lifecycle.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Delete: `os.replace` into the trash after the optional version check.
  - Create: `atomic_write` with `check` asserting the target is absent.
- [ ] **Step 4:** Run `uv run pytest -q`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): create objects, delete objects and types to trash, restore`.

### Task 5: Type API with cascading rewrites (track: backend)

**Files:**
- Modify: `space.py`, `server.py`
- Test: `test_types_api.py`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `Space.create_type(name, plural_name, icon=None, color=None) -> TypeDefinition`
    - Defaults: icon `ph-note-pencil`, colour gray.
    - Seeds the system defs, Tags, and a `blocks` property named "Content".
    - Id is `slug(name)`, made unique; folder is `pluralName`. Both never change afterwards.
  - `ConfirmRequired(affected)` (428), `SaveTypeResult(type, rewritten, skipped)` (`type.revision` is the new revision; this is exactly the route's response).
  - `Space.save_type(t, base_revision, confirm=False) -> SaveTypeResult` diffs against the stored type and rewrites other files without stamping (via `_rewrite_other`):
    - **type renamed** → every object and template whose `type:` matches the old name gets its `type:` line rewritten keeping its quotes; the old name is appended to `formerNames`. `pluralName` changes move nothing.
    - deleted property → its key is stripped (428)
    - renamed label option → values rewritten
    - deleted label option → values removed (single becomes `null`; in a multi-list the item is dropped); 428 when in use
    - **label multi→single** → a list with two or more items keeps its first item, written as a scalar; one item or none is left as it is; 428 when any file has two or more
    - **entity config** (`isArray` true→false, a changed `allowedTypes`, `hasFixedSet` turned on or a smaller `fixedSet`) → links that break the new rules are removed (multi→single keeps the first link); dangling links (no resolved object) are kept; 428 when any file changes
    - single→multi (label or entity) → no rewrite; the next edit writes a list
    - a changed `key`, a changed property `type` (that is Task 6's route), a new or removed property on a basic type, renaming or deleting a basic type → 422
    - `propertySyncing` edits are validated as in Task 6
    - a `fixedSet` entry that is not the `id` of an existing object → 422 (the client calls `ensure-id` first for objects without one)
    - a type with `readOnlyReason` → 423
  - `Space.delete_type(id, confirm) -> TrashItem`: 428 without confirm (`affected` = objects of the type); 422 for basic types; removes the id from other types' `allowedTypes` (recorded for restore); uses Task 4's `trash_type`.
  - The type routes announce `types` for each saved type and `changed` / `deleted` for each file.

- [ ] **Step 1: Write failing tests**
  - `test_create_type_seeds_tags_and_content`, `test_create_type_requires_name_and_plural_422`
  - `test_rename_type_rewrites_type_lines_unstamped`: rename Server → Machine; `Servers/Alpha.md` changes only `type: 'Machine'` (quotes kept), no `lastUpdated`; the folder stays `Servers`; `formerNames == ['Server']`.
  - `test_former_name_still_resolves`: with `Servers/Alpha.md` read-only during the rename, it is in `skipped` and still lists under the `server` type.
  - `test_rename_type_rewrites_its_templates`: a tmp `Templates/Servers/Rack.md` with `type: 'Server'` follows the rename.
  - `test_rename_label_option_rewrites_one_line_each`: Task "Not Started" → "Todo" without `confirm`; only `Tasks/Write docs.md`'s `status:` line changes, no `lastUpdated` change.
  - `test_basic_type_options_editable_properties_locked`: on Task, adding an option, recolouring one and changing `status` visibility save; adding a property, removing `status` or changing its `isArray` → 422.
  - `test_delete_property_requires_confirm_428`: tmp copy with a second Server `Servers/Beta.md` (`cores: 4`); deleting `cores` without confirm → 428 with `affected == 2` and nothing written.
  - `test_delete_property_strips_key_with_confirm`: both files lose only their `cores:` line.
  - `test_label_multi_to_single_keeps_first`: tmp type with `topics: [A, B]` and `topics: [C]`; 428 `affected == 1`; with confirm the first becomes `topics: A`, the second is unchanged.
  - `test_entity_multi_to_single_requires_confirm_and_keeps_first`: `members: ['[[Ada Lovelace]]', '[[Alpha]]']` → `members: '[[Ada Lovelace]]'`.
  - `test_entity_allowed_types_change_strips_links`: restricting `allowedTypes` to Person drops `'[[Alpha]]'` (a Server) and keeps a dangling `'[[Nobody]]'`.
  - `test_fixed_set_enforced_with_confirm`
  - `test_change_key_rejected_422`, `test_change_property_type_via_put_422`
  - `test_rewrite_conflict_retried_then_skipped`: as in Task 3, for a deleted-property strip.
  - `test_save_type_stale_revision_409` (body `{currentRevision}`)
  - `test_save_unreadable_type_423`
  - `test_delete_type_moves_objects_to_trash`: `delete_type('server', confirm=True)`; `Servers/Alpha.md` is in the trash; Person's relation `allowedTypes` loses `server`.
  - `test_delete_basic_type_422` (Page, Tag, Task)
  - `test_types_event_announced`
  - `test_watcher_silent_for_type_cascade` (in `test_watcher.py`)
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_types_api.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Build the whole op list before any write; a 428 is raised before anything is written.
  - The type JSON is written last.
- [ ] **Step 4:** Run `uv run pytest -q`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): type definition API with cascading value rewrites`.

### Task 6: Property kind change and two-way linking (track: backend)

**Files:**
- Modify: `space.py`, `server.py`
- Test: `test_kindsync.py`

**Interfaces:**
- Consumes: Tasks 2, 3 and 5.
- Produces:
  - `Space.change_property_kind(type_id, pid, to_type, base_revision) -> ChangeKindResult(type, newPropertyId, rewritten, skipped, lossy)`, as Capacities does ("creates a new property of the new type and will match your existing property values as best as possible…"):
    - `to_type` must be in `KIND_TRANSFORMS[from]`, else 422 with Capacities' `noTransformations` text.
    - A new definition is inserted right after the old one: same name, icon and description, a new id, and a new unique key (`budget` → `budget_`… by the key rule); entity → label builds the option set from the values.
    - Each object with a value gets the converted value under the new key (an unstamped rewrite; one added line). `lossy` counts values that converted lossily.
    - The old property and its values stay, so the user can check the result and delete it.
  - `Space.set_property_sync(type_id, pid, target_pid|None, create_name=None, base_revision) -> SyncResult(types, rewritten, skipped)`:
    - Allowed only when both properties are entity, multi-select (`isArray`), without a fixed set, on non-basic types, and the source's `allowedTypes` is exactly the target's type. Otherwise 422 with `syncing.multiSelectOnly.info` or `syncing.notAllowed.info`.
    - `create_name` creates the counterpart ('Create property "X" for "Y"'): an entity property on the linked type with `allowedTypes: [type_id]`, `isArray: true`, and `propertySyncing` pointing back.
    - Both type JSONs get each other's id in `propertySyncing.propertyIds`.
    - Backfill ("Synchronizing"): for every existing link A1 → B1, `[[A1]]` is added to B1's counterpart value (unstamped). `target_pid: null` unlinks both sides and rewrites nothing.
  - Routes: `POST /api/types/{id}/properties/{pid}/change-kind`, `POST /api/types/{id}/properties/{pid}/sync`; both announce `types` and `changed`.

- [ ] **Step 1: Write failing tests**
  - `test_change_kind_creates_new_property_and_keeps_old`: tmp Project type, `budget` text values `"1200.5"` and `"n/a"` → number; new key `budget_`, values `1200.5` and `null`, `lossy == 1`; every `budget:` line unchanged.
  - `test_change_kind_not_allowed_422`: blocks → number.
  - `test_change_kind_entity_to_label_builds_options`
  - `test_sync_requires_multi_without_fixed_set_422`, `test_sync_not_allowed_for_basic_types_422`
  - `test_sync_creates_counterpart`: Project `lead` (Person, multi) with `create_name='Projects'` adds a Person entity property `projects` with back-pointing `propertySyncing`.
  - `test_sync_backfills_existing_links`: a tmp Project linking `[[Ada Lovelace]]` adds `projects: ['[[<Project>]]']` to `People/Ada Lovelace.md` without stamping.
  - `test_sync_backfill_skips_readonly`
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_kindsync.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `uv run pytest -q`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): property kind change and two-way linking`.

### Task 7: Title edit and rename-with-relink (track: backend)

**Files:**
- Create: `relink.py`
- Modify: `space.py`, `server.py`
- Test: `test_rename.py`, plus a new case in `test_watcher.py`

**Interfaces:**
- Consumes: Task 2 (`replace_in_value`), Task 3 (`_write`, `_rewrite_other`, `resolve`, ChangeEvent `renamed` and `oldPath`), Task 4 (`safe_filename`, `unique_path`, `own_deletes`).
- Produces:
  - `replace_wikilinks(text, should_rewrite, new_target) -> str`: handles `[[T]]`, `[[T|alias]]` and `[[T#h]]`, keeping the suffixes. Skips fenced and inline code.
  - `relink_frontmatter(src, fm, should_rewrite, new_target) -> str`: for every key whose value holds a qualifying link, `replace_in_value` with `replace_wikilinks` on that span only (scalars, flow lists, block lists and literal `|-` blocks). Other items, quotes and lines keep their bytes.
  - `RenameResult(path, version, relinked, skipped)`
  - `Space.rename_object(path, new_title, base_version) -> RenameResult`
  - `POST /api/object/rename`: announces `renamed` (with `oldPath`) and `changed` for each referrer.

- [ ] **Step 1: Write failing tests**
  - `test_rename_moves_file_updates_title_and_heading`: "Ada Lovelace" → "Ada King" gives `People/Ada King.md`; `title:` and `# Ada King` are rewritten; `lastUpdated` is stamped and an `id` inserted.
  - `test_rename_relinks_only_link_lines`:
    - `Tasks/Write docs.md` changes only its body line `Write the user guide. See [[Ada King]].`
    - `Servers/Alpha.md` changes exactly two lines: `owner: '[[Ada King]]'` (single quotes kept) and `Owner: [[Ada King]]`; nothing else
    - no `lastUpdated` changes in either
    - `relinked` lists both files
  - `test_rename_relinks_list_item_keeps_quotes`: a tmp referrer with `members: ['[[Ada Lovelace]]', "[[Alpha]]", '[[X]]']` becomes exactly `members: ['[[Ada King]]', "[[Alpha]]", '[[X]]']`; one with a block list `  - '[[Ada Lovelace]]'` changes that item line only; one with a `notes: |-` literal block changes only the link's line inside it.
  - `test_rename_keeps_alias_and_heading_suffix`: `[[Ada Lovelace|Ada L]]` → `[[Ada King|Ada L]]`, `[[Ada Lovelace#Life]]` → `[[Ada King#Life]]`.
  - `test_rename_skips_links_to_colliding_title`: rename `Servers/Alpha.md` to "Alpha One"; `[[Alpha]]` in `Pages/Notes.md` resolves to `Pages/Alpha.md` and stays.
  - `test_rename_leaves_alias_references`: a tmp `Pages/Ref.md` with `[[Ada]]` and `[[Countess of Lovelace]]` is unchanged, not in `relinked`, and both still resolve to `People/Ada King.md`.
  - `test_rename_skips_code_spans`, `test_rename_referrer_crlf_preserved` (a CRLF tmp referrer keeps CRLF on every line)
  - `test_rename_no_frontmatter_creates_fence`: renaming `Pages/Notes.md` to "Standup notes" writes `---\nid: <ulid>\ntitle: Standup notes\nlastUpdated: <t>\n---\n# Standup notes\n…` and moves it to `Pages/Standup notes.md`.
  - `test_rename_case_only_keeps_path_without_suffix`: "Ada Lovelace" → "Ada lovelace" gives `People/Ada lovelace.md`, never ` (2)`, on case-insensitive file systems too.
  - `test_rename_collision_suffix`, `test_rename_same_title_noop`
  - `test_dailynote_title_locked_422`, `test_rename_stale_409`
  - `test_readonly_referrer_reported_in_skipped`
  - `test_referrer_conflict_retried_then_skipped`: as in Task 3; the referrer's bytes equal the externally changed bytes.
  - `test_watcher_silent_for_rename_and_relinked_referrer` (in `test_watcher.py`)
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_rename.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  1. Collect the referrers first. A link qualifies when its target text equals the old title or stem (case-insensitively) **and** `resolve(target, from_path=file)` returns the old path.
  2. `_write` the new `title` (and the first `# Old` heading).
  3. Rename the file (never overwriting; a case-only rename goes through a temporary name), registering `own_deletes` and `own_writes`.
  4. Rewrite the referrers, unstamped.
- [ ] **Step 4:** Run `uv run pytest -q`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): rename with minimal relinking`.

### Task 8: Change type (track: backend)

**Files:**
- Create: `changetype.py`
- Modify: `space.py`, `server.py`
- Test: `test_changetype.py`

**Interfaces:**
- Consumes: `convert_value`, `rename_key`, `delete_keys` (Task 2), `_write` (Task 3), `unique_path`, `safe_filename` (Task 4), the referrer collection and relinkers (Task 7).
- Produces:
  - `CHANGE_FROM_ALLOWED` (page, custom, task), `CHANGE_TO_ALLOWED` (page, custom, tag, task)
  - `MappingRow(fromKey, toKey|None, lossy)`
  - `suggest_mapping(src, dst, fm, remembered) -> list[MappingRow]`. Match priorities:

    | Match | Priority |
    |---|---|
    | remembered | 100 |
    | same system id | 50 |
    | exact name | 45 |
    | normalised name | 40 |
    | case-insensitive name | 35 |
    | same `type` | 20 |
    | same data type | 15 |

    - Each target is used once, and only compatible targets (`KIND_TRANSFORMS`) count.
    - Title, icon, description, tags and aliases always carry over.
  - `load_ui(root)`, `save_change_type_preference(root, from_id, to_id, rows)`: writes `.capacities/ui.json` `changeTypePreferences` and keeps other keys.
  - `Space.change_type(path, type_id, mapping, base_version) -> ChangeTypeResult(path, version, relinked, skipped)`
  - Routes: `GET`/`POST /api/object/change-type`. The POST announces `renamed` and `changed` for each relinked file.

- [ ] **Step 1: Write failing tests**
  - `test_suggest_exact_name_then_type`, `test_suggest_uses_remembered_mapping`
  - `test_change_type_inserts_id_and_moves`: `Pages/Notes.md` (no frontmatter) → Task gives `Tasks/Meeting notes.md` starting `---\nid: <ulid>\ntype: 'Task'\ntitle: Meeting notes\nlastUpdated: <t>\n---\n# Meeting notes\n`; the inserted `id` is the one `GET /api/object` reports after the move.
  - `test_change_type_keeps_quotes_and_collides`: `Servers/Alpha.md` → Page gives `Pages/Alpha (2).md` (Pages/Alpha.md exists), `type: 'Page'` with single quotes, and its new `id`.
  - `test_change_type_keeps_unmapped_keys`: `People/Ada Lovelace.md` → Page with `website` mapped to `None`; the `website:` line is byte-identical in `Pages/Ada Lovelace.md`.
  - `test_change_type_renames_mapped_key_in_place`
  - `test_change_type_converts_text_to_label_and_flags_lossy`
  - `test_change_type_from_dailynote_422`
  - `test_links_resolve_after_move`: a tmp `Pages/Ref.md` containing `[[Notes]]` (which resolved to `Pages/Notes.md` by stem) and `[[Meeting notes]]`; after the change, `[[Notes]]` is rewritten to `[[Meeting notes]]` (unstamped, in `relinked`), and both resolve to `Tasks/Meeting notes.md`.
  - `test_preference_remembered_in_ui_json`
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_changetype.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - A file without frontmatter gets a fence block with `id`, `type`, `title` (its display title) and `lastUpdated`. Otherwise rewrite `type:` keeping its quotes.
  - An unchanged value: `rename_key`. A converted value: `set_keys` on the target plus `delete_keys` on the source.
  - Stamp, then move to `<target folder>/<safe_filename(title)>.md` (`unique_path`); the file name is re-derived from the title.
  - Collect the referrers before the move as rename does; links whose text no longer resolves to the moved file are relinked to the title.
- [ ] **Step 4:** Run `uv run pytest -q`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): change object type with property mapping`.

### Task 9: Templates (track: backend)

**Files:**
- Create: `templates.py`
- Modify:
  - `space.py`: `ObjectSummary.template`, exclusions, template discovery, `create_object` applies templates
  - `typedefs.py`: inference ignores templates
  - `server.py`
- Test: `test_templates.py` (its templates are created in a tmp copy; the shared fixture arrives in Task 20)

**Interfaces:**
- Consumes: Tasks 3–5.
- Produces:
  - `TemplateError` (422 "Could not apply the template")
  - `expand_title(title, created) -> str`: expands `{date:FMT}` using the dayjs subset `YYYY YY MMMM MMM MM M DD D dddd ddd HH mm`; any other letter inside `FMT` → `TemplateError`.
  - `resolve_date_variable('day'|'week'|'month'|'year', created) -> str`
    - Day gives a date; week (Monday–Sunday), month and year give a `start -> end` range.
    - Templates store the variable as `{creation:<var>}`. It is valid only on `datetime` properties (whose values are date links in Capacities); on `datetimeSimple` it is a `TemplateError`.
  - `Space.create_template(type_id, name="New template")`: creates `Templates/<folder segment>/<name>.md` with `id`, `type: '<Name>'` and `template: <name>`, and appends the id to `templates.ids` (a type save).
  - `Space.list_templates(type_id)`: discovered templates as in Global Constraints; a template without an `id` gets one (`ensure_id`) when it is registered, applied or made default, never on open.
  - `Space.apply_template(path, template_id, base_version) -> str`
  - `create_object(template_id)`: `None` applies the default template; `"none"` skips it.
  - Template routes. `DELETE /api/object` on a template also drops its id from `templates.ids` and `defaultTemplateId`.

- [ ] **Step 1: Write failing tests**
  - `test_create_template_registers_in_type`
  - `test_template_discovered_by_type_key`: a tmp `Templates/Misc/Bug.md` with `type: 'Task'` and `template: Bug` lists under Task, not under its folder's type; opening writes nothing.
  - `test_templates_excluded_from_list_resolve_and_counts`
  - `test_default_template_applied_on_create`: a tmp template, made default through `save_type`, then `create_object('task')`.
  - `test_template_none_skips_default`
  - `test_title_date_placeholder`: `Meeting {date:YYYY-MM-DD}` → `Meeting 2026-10-23`
  - `test_bad_date_format_422`: `Meeting {date:YYYY-QQ}`
  - `test_date_variable_week_range`: created 2026-10-23 (a Friday) → `2026-10-19 -> 2026-10-25`
  - `test_creation_variable_on_datetime_simple_422`
  - `test_apply_overwrites_props_and_appends_body`:
    - template properties overwrite the target's
    - the body is appended, or replaces a body that is only `# Title`
    - `template`, `id`, `createdAt` and `lastUpdated` are never copied
  - `test_templates_not_allowed_for_tag_422`
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_templates.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `uv run pytest -q`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): per-type templates`.

### Task 10: Tags as objects, icons and cover images (track: backend)

**Files:**
- Create: `media.py`
- Modify: `space.py`, `relink.py`, `server.py`
- Test: `test_tags.py`

**Interfaces:**
- Consumes: Tasks 3, 4 and 7.
- Produces:
  - `Space.ensure_tag(name) -> (path, created)`
    - Matches an existing Tag case-insensitively.
    - Otherwise creates `Tags/<safe name>.md` with `id`, `type: 'Tag'`, `title`, `color: bg-<random>`, `createdAt` and `lastUpdated`, and an empty body.
  - Tag colour and icon are ordinary property updates (`color`, `icon`, `iconColor` system keys) through `update_properties`.
  - `ObjectSummary.color`, `.coverImage`, `.iconColor`
  - `rewrite_tag_lists(src, fm, old, new) -> str`: renaming a Tag rewrites its item in every `tags:` list through `replace_in_value` (flow or block style, other items and quotes untouched), unstamped.
  - `list_images(root)`: image files (`png jpg jpeg gif webp svg`) outside dot-folders. `import_image(root, name, data) -> path`: writes `Attachments/<safe name>` (unique). `GET /api/file` serves only those extensions from inside the space (415 otherwise).
  - Routes: `POST /api/tags/ensure`, `GET`/`POST /api/images`, `GET /api/file`.

- [ ] **Step 1: Write failing tests.** `Tags/Docs.md` is created in the tmp copy by each test that needs it.
  - `test_ensure_tag_creates_once`, `test_ensure_tag_matches_case_insensitively`
  - `test_tag_color_from_palette`, `test_summary_has_tag_color`
  - `test_set_tag_color_and_icon`: `update_properties` on a Tag with `{color:'bg-red', icon:{type:'iconify', val:'ph-star', color:'red'}}` writes `color: bg-red`, `icon: ph-star`, `iconColor: red`.
  - `test_rename_tag_rewrites_tags_lists_one_line_each`: "Docs" → "Documentation" changes only the `tags:` line of `Tasks/Write docs.md` (`tags: [Documentation]`, flow style kept); a tmp block-style `tags:` list changes only its item line.
  - `test_tag_type_listed_when_tags_folder_missing`: the Tag type is listed with folder `Tags` although no `Tags/` exists, and opening does not create it.
  - `test_import_image_and_serve`, `test_file_route_refuses_non_image_415`, `test_file_route_refuses_outside_space`
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_tags.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `uv run pytest -q`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): tags as objects, icons and cover images`.

### Task 11: API client v2, palette, icons, shared mock (track: frontend)

**Files:**
- Modify:
  - `frontend/src/api/{types,client}.ts`
  - every consumer of the changed `TypeDef.icon` (now `Icon`) and `PropertyDef.isArray` (now `options.isArray`): `shell/Sidebar.tsx` (`TypeChip`), `shell/Sidebar.test.tsx` (`chip.dataset.icon` still `'ph-check-circle'`, read from `icon.val`), `object/ObjectHeader.tsx`, `object/PropertyPanel.tsx` (`KIND_ICON` becomes `Record<PropertyType,…>` from Task 12's metadata; a temporary map here), `types/TypePage.tsx`, `links/LinkPicker.tsx`, `App.tsx`
  - `components/Icon.tsx`: resolves any Iconify id by its longest bundled prefix (`ph`, `vscode-icons`); an unknown prefix renders `ph-cube` and keeps the original id in `data-icon` and the title
  - `shell/typeColor.ts`, `theme/tokens.css`
  - `editor/Editor.test.tsx`, `links/LinkPicker.test.tsx`, `object/{ObjectPeek,ConflictDialog}.test.tsx`: all four move to the shared mock
  - `package.json`
- Create: `theme/palette.ts`, `test/mockApi.ts`, shadcn `components/ui/*`
- Test: `api/client.test.ts`, `theme/palette.test.ts`, `components/Icon.test.tsx`

**Interfaces:**
- Consumes: the API contract.
- Produces:
  - TS types for every contract shape, plus `DateValue`, `EntityRef`, `TrashItem`, `RenameResult`, `UpdateResult`, `MappingRow`, `KIND_TRANSFORMS`.
  - `iconName(icon: Icon|string|null, fallback) -> string`.
  - Errors: `ConflictError` now reads `currentVersion ?? currentRevision`; `RevisionConflictError extends ConflictError` (409 on a type route); `ConfirmRequiredError extends ApiError {affected}` (428).
  - One `api.*` function per route:
    - objects: `updateProperties(path, updates, baseVersion, remove?)`, `ensureId`, `renameObject`, `changeType`, `suggestMapping`, `createObject(typeId, {title?, templateId?})`, `deleteObject(path, {baseVersion?})`
    - trash: `trash`, `restore`, `purge`, `emptyTrash`
    - types: `createType`, `saveType(type, {baseRevision, confirm?})`, `changePropertyKind`, `setPropertySync`, `deleteType`
    - templates, tags and media: `templates`, `createTemplate`, `applyTemplate`, `ensureTag`, `images`, `importImage`, `fileUrl(path)`
    - every write sends `clientId` and emits locally, as `saveBody` does, **one event per path the response names**: the main path, each `synced`, `relinked` and `rewritten` path (`changed`), `renamed` with `oldPath`, `created`/`deleted`, and `types` for each saved type
  - `mockApi(overrides?) -> Api`: every function is a `vi.fn()` with a sensible default. Tests inject it with `vi.mock('@/api/client', async (orig) => ({ ...(await orig()), api: (await import('@/test/mockApi')).mockApi() }))` and reach it as `vi.mocked(api)`.
  - `THEME_COLORS`, `colorName`, `tagStyle`, `labelStyle`, `lineColor`; `chipStyle` covers all 18 colours.

- [ ] **Step 1:** Run `npx shadcn@latest add input textarea popover command checkbox switch select context-menu alert-dialog`, then `npm i @dnd-kit/core @dnd-kit/sortable @iconify-json/vscode-icons`.
- [ ] **Step 2:** Add these dark tokens to `tokens.css`:
  - `--tag-bg-<c>` and `--tag-text-<c>`
  - `--label-border-<c>`, which also serves as `--line-<c>` (gray's line is `#5c5959`)
  - `--type-<c>-{fg,bg}` for the 9 colours M1 lacks: fg = tokenText, bg = blockBg

  Values per colour:

  | Colour | tagBg | tagText | border | blockBg | tokenText |
  |---|---|---|---|---|---|
  | gray | #333337 | #f5f4f3 | #636060 | #28282b | #7b7776 |
  | rose | #742c40 | #fff1f2 | #ea4561 | #672d3d | #f45a73 |
  | pink | #742f4b | #fdf2f8 | #e34d97 | #662f45 | #ec5fa7 |
  | fuchsia | #632c67 | #fdf4ff | #d14be5 | #562c59 | #de62f0 |
  | purple | #5c377a | #faf5ff | #a558ee | #513469 | #b26ef6 |
  | violet | #573a85 | #f5f3ff | #8a5fed | #4f3773 | #9975f4 |
  | indigo | #434078 | #eef2ff | #6568e8 | #3e3c67 | #7279f1 |
  | blue | #35467d | #eff6ff | #3f80eb | #334069 | #4f93f3 |
  | sky | #1d455a | #f0f9ff | #199dd9 | #1f3d4e | #26aeeb |
  | cyan | #22434d | #ecfeff | #11a9c3 | #213a43 | #19bed8 |
  | teal | #1f4644 | #f0fdfa | #1dad9d | #1f3e3c | #25c0af |
  | emerald | #184739 | #ecfdf5 | #19ae7d | #183e33 | #26c18b |
  | green | #265237 | #f0fdf4 | #2bbb60 | #254833 | #3ace70 |
  | lime | #34451e | #f7fee7 | #7fbe1f | #2f3d1e | #92d22a |
  | yellow | #5f4323 | #fefce8 | #daaa14 | #543c24 | #ecbc13 |
  | amber | #704429 | #fffbeb | #e89a17 | #633f2a | #f2ad1d |
  | orange | #733d2c | #fff7ed | #ec731f | #63392b | #f4832d |
  | red | #723131 | #fef2f2 | #e54a4a | #643131 | #f05d5d |
- [ ] **Step 3: Write failing tests**
  - `test updateProperties sends clientId and emits local changed for path and each synced path`
  - `test renameObject emits local renamed and changed for each relinked path`
  - `test saveType sends baseRevision and emits types and changed for rewritten paths`
  - `test 409 on saveType maps to RevisionConflictError with currentRevision`
  - `test 428 maps to ConfirmRequiredError with affected`
  - `test renamed SSE event delivered with oldPath`
  - `test palette has 18 colours in order and sky is "Light blue"`
  - `test unknown colour falls back to gray`
  - `test Icon renders vscode-icons-file-type-excel offline and unknown prefix falls back`
- [ ] **Step 4:** Run `cd frontend && npx vitest run src/api src/theme src/components`. Expected: FAIL.
- [ ] **Step 5:** Implement as specified in Interfaces, update the consumers, and move the four existing test files onto `mockApi()`.
- [ ] **Step 6:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 7:** Commit `feat(frontend): v2 API client, theme palette, offline icons, shared api mock`.

### Task 12: Kind metadata and formatting (track: frontend)

**Files:**
- Create: `frontend/src/properties/{kinds,format,currencies}.ts`
- Modify: `object/PropertyPanel.tsx` (`KIND_ICON` from `KIND_META`)
- Test: `properties/format.test.ts`, `properties/kinds.test.ts`

**Interfaces:**
- Consumes: Task 11.
- Produces:
  - `KIND_META: Record<PropertyType, {name, description, icon}>`: names and descriptions from `propertyTypes.<type>.*`; icons from Capacities' `propertyIcons`. `datetime` and `datetimeSimple` both read "Date time"; only `datetime` is ever created.
  - `ADD_PROPERTY_ITEMS`, as the bundle builds AddPropertyMenu: the items whose key is in its order list, sorted by it. That gives 15 items: Text (`textBlock`), Content (`blocks`), Tags, Label, **Object Select** (with a submenu, below), Checkbox, Date time, Number, Title, Description, **Cover Image**, Icon, Created at, Last updated, Aliases.
    - "Object Select" ("Link to objects of a specific type.") opens "Search Object Types" listing the types allowed as relation targets: Page, Tag, the media types the space has, and custom types; not Task or DailyNote. Picking one creates a multi-select entity property bound to that type.
    - "Single select" and the tag-multi keys are in the bundle's order list, but this bundle builds no item for them, so neither do we.
    - Cover Image ("A single select image property.") adds the `coverImage` system property.
    - `text`, `url`, `simpleTableBlock` and `datetimeSimple` cannot be added, as in Capacities; they come from migration, inference and "Change property type", and are fully editable.
  - `CURRENCIES: {code, name, symbol}[]`: in the bundle's menu order (EUR, USD, GBP, CNY, JPY…), deduplicated (TWD and XAF appear twice).
  - `formatNumber(v, fmt?)`: honours `isGroupingThousands` (default on) and `isRadixComma` (swaps the group and decimal separators).
  - `progressFraction(v, fmt) = clamp(v / steps, 0, 1)`.
  - `parseNumberInput(s, fmt?) -> number|null|undefined`: `''` gives null; NaN gives undefined, which callers ignore; with `isRadixComma`, `1.234,5` parses as 1234.5.
  - `formatDate(v)`, `propertyIsEmpty(def, value)` and `placeholderFor(def)` (the description, else "Empty").

- [ ] **Step 1: Write failing tests**
  - `test currency EUR 2 decimals → "€1,234.50"`
  - `test percentage 0.25 → "25%"`
  - `test grouping off → "1234.5"`
  - `test radix comma → "1.234,5"`
  - `test progress fraction 4 of 10 steps is 0.4 and clamps to [0,1]`
  - `test propertyIsEmpty quirks: number 0, boolean false, label [] empty; createdAt always empty`
  - `test formatDate day, time, range with " → "`: en-US, `dateStyle:'medium'`, plus `timeStyle:'short'` for times
  - `test parseNumberInput`
  - `test ADD_PROPERTY_ITEMS order has 15 entries and Object Select lists Page, Tag and custom types but not Task`
- [ ] **Step 2:** Run `npx vitest run src/properties`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(properties): kind metadata, number and date formatting`.

### Task 13: Scalar cells and the date picker (track: frontend)

**Files:**
- Create: `frontend/src/properties/cells/{Text,TextBlock,Number,Checkbox,Url,Date,Blocks,SimpleTable,ReadOnlyDate}Cell.tsx`, `cells/types.ts`, `properties/DatePicker.tsx`
- Test: `properties/cells/cells.test.tsx`, `properties/DatePicker.test.tsx`

**Interfaces:**
- Consumes: Task 12.
- Produces:
  - `CellProps<T> = {def: PropertyDef; value: T; readOnly?: boolean; onChange(next: T): void}`, implemented by one `XCell` per file.
  - `ReadOnlyDateCell` for `entity_createdAt` and `entity_lastUpdated`.
  - `parseDateInput(s, now) -> DateValue|null`, which accepts:
    - ISO dates
    - Yesterday, Today, Tomorrow
    - "in N days" and "in N weeks"
    - "March 14th at 1:59 PM"
  - `<DatePicker value constraints onChange />`: on an empty value it starts from `startTimeDefault` / `endTimeDefault` when set (else now); `hideDeleteOption` hides the remove action.

- [ ] **Step 1: Write failing tests**
  - `test NumberCell saves on 250ms debounce and on blur; empty → null; "abc" ignored`
  - `test NumberCell renders progress bar width 40% for value 4 with 10 steps`
  - `test CheckboxCell toggles and shows description`
  - `test UrlCell renders external link; "Edit link" modal saves; "Remove link" clears`
  - `test TextCell Esc blurs and commits`
  - `test DatePicker hides "Range" when endTimeSettings notAllowed and forces time when resolutionConstraint time`
  - `test DatePicker starts from startTimeDefault and hides delete when hideDeleteOption`
  - `test parseDateInput natural phrases`
  - `test SimpleTableCell edits a cell and serialises a GFM table`
  - `test placeholder is description else "Empty"`
- [ ] **Step 2:** Run `npx vitest run src/properties`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - DatePicker strings: "All-day", "Include Time", "Range", "End Date", "Starts", "Ends", plus the suggestion lists.
  - BlocksCell is CodeMirror Markdown; Tiptap comes in M7.
  - TextBlockCell renders with `marked.parseInline`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(properties): scalar cells and date picker`.

### Task 14: Choice and system cells; icon, colour and image pickers (track: frontend)

**Files:**
- Create: `frontend/src/properties/{LabelMenu,RelationPicker,TagPicker}.tsx`, `properties/cells/{Label,Relation,Tags,Aliases,Icon,Description,CoverImage,Color,TypeChip,SystemField}Cell.tsx`, `properties/cellFor.ts`, `components/{IconPicker,ColorPicker,ImagePicker}.tsx`
- Test: `properties/LabelMenu.test.tsx`, `properties/RelationPicker.test.tsx`, `properties/cells/choice.test.tsx`, `properties/cellFor.test.ts`, `components/IconPicker.test.tsx`

**Interfaces:**
- Consumes: Tasks 11–13, and `fuzzyMatch` and `useLinkIndex` from M1.
- Produces:
  - `cellFor(type: PropertyType)`: every PropertyType has exactly one cell:

    | PropertyType | Cell |
    |---|---|
    | text, url, textBlock, number, boolean, datetime, datetimeSimple, blocks, simpleTableBlock | Task 13's cells |
    | label | LabelCell · entity: RelationCell · entity_tags: TagsCell · entity_aliases: AliasesCell |
    | entity_icon | IconCell (IconPicker, with "Remove") |
    | entity_description | DescriptionCell (multi-line plain text) |
    | coverImage | CoverImageCell (ImagePicker) · color: ColorCell (Tag objects) |
    | entity_createdAt, entity_lastUpdated | ReadOnlyDateCell |
    | entity_type | TypeChipCell (read-only; click opens "Change type ▸" from Task 19) |
    | entity_collections | "—" until M3 · entity_backlinks: a count until M5 |
    | entity_title | none (the header edits it) |
    | basic media fields | SystemFieldCell (read-only text) |
  - `<LabelMenu def value onChange onDefChange(next) />`: edits to the option set go to `onDefChange`; the parent saves the type **before** it applies the value (Task 15).
    - In status mode (Task `status` only) options sit in four sections; dragging an option to another section changes its `statusCategory`; "Create" in a section creates an option in that category.
  - `<RelationPicker def value onChange />`: offers objects of the `allowedTypes`, restricted to the fixed set when there is one; values are `EntityRef` with `path`. Two objects with the same title show their folder.
  - `<TagPicker value onChange onOpenTag />`.
  - `<IconPicker value onChange />`: Emoji and Icons tabs, with search; the Icons tab lists the bundled `ph` set (other bundled sets render but aren't offered); for an Iconify icon a ColorPicker row sets `Icon.color`; "Remove".
  - `<ColorPicker value onChange />`: the 18 colours, with no "none" option.
  - `<ImagePicker value onChange />`: the space's images (`api.images`), "Upload" (`api.importImage`), "Remove".

- [ ] **Step 1: Write failing tests**
  - `test cellFor covers every PropertyType`
  - `test LabelMenu search shows "New 'x'" and creates option with random theme colour`
  - `test duplicate label name warns "A label with this name already exists…"`
  - `test single-select closes, multi-select stays open`
  - `test status menu shows "Open" then Not started / In progress / Blocked / Done; empty section shows "Create"`
  - `test dragging a status option to Done sets statusCategory done`
  - `test last Done label cannot be deleted`
  - `test edit label submenu renames on blur and changes color`
  - `test RelationPicker lists only allowed type and fixed set ("Selection set") and disambiguates duplicate titles`
  - `test TagPicker placeholder "Search for tags or create one"; create calls onChange`
  - `test AliasesCell 9th alias shows "You can only add up to 8 aliases."`
  - `test IconPicker search "user" offers ph-user; colour row sets Icon.color`
  - `test ImagePicker upload calls importImage and selects the new path`
- [ ] **Step 2:** Run `npx vitest run src/properties src/components`. Expected: FAIL.
- [ ] **Step 3:** Implement. LabelMenu is `w-64` with a 20rem max height and `labelStyle` pills, and is sortable with `@dnd-kit` when not searching.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(properties): choice and system cells, icon, colour and image pickers`.

### Task 15: Editable panel, header, serialized writes (track: frontend)

**Files:**
- Create: `frontend/src/object/{useObjectWrites,useTypeEditor}.ts`
- Modify: `object/{PropertyPanel,ObjectHeader,ObjectView}.tsx`, `nav/tabs.ts` (`retarget`), `App.tsx` (handle `renamed` and `types` events)
- Test: `object/PropertyPanel.test.tsx`, `object/ObjectView.writes.test.tsx`, `object/ObjectHeader.test.tsx`, `object/useTypeEditor.test.ts`, `nav/tabs.test.ts`

**Interfaces:**
- Consumes: Tasks 11–14, plus `BodyEditorHandle` and `reconcile` from M1.
- Produces:
  - `useObjectWrites({path, versionRef, bodyControl, adoptVersion, onConflict}) -> {updateProperties(updates, remove?), rename(title)}`. A promise queue that, in order:
    1. awaits `bodyControl.flush()`, which resolves `{ok: false}` when the body save hit a conflict
    2. if not ok, stops: the pending write stays queued and nothing is sent; `onConflict` has already run once (from the body save)
    3. sends with `versionRef.current`
    4. calls `adoptVersion(v)` and `bodyControl.resume(v)`
    5. merges the returned `frontmatter` and `links`

    A 409 on the property write calls `onConflict`. When the conflict is resolved (reload or keep mine), the queue replays the pending property writes on the resolved version; they are key-level, so replaying is safe.
  - `useTypeEditor(typeId) -> {type, save(next, opts?), changeKind, setSync}`:
    - Sends `baseRevision` and adopts `type.revision` from each response.
    - On 428, shows an AlertDialog with `detail` and `affected`, and resends with `confirm`.
    - On `RevisionConflictError`, reloads the index and reports the error.
  - `PropertyPanel({type, frontmatter, links, summary, readOnly, onChange, onTypeChange})`:
    - Rows render `cellFor(def.type)`.
    - `hideWhenEmpty` uses `propertyIsEmpty`; `hidden` rows collapse under "Hidden (N)".
    - Keys without a definition show read-only under the bundle's `RenderProperties.additional` heading.
    - A new label option from LabelMenu: `onTypeChange(next)` (awaited `useTypeEditor.save`), **then** `onChange` with the value.
  - `ObjectHeader({summary, type, readOnly, onRename, onPropertiesChange, onOpenTag})`, in Capacities' order:
    - Cover image (Task 18 renders it), icon, title, description, tags.
    - Hover actions "Add icon", "Add cover image", "Add description", "Add aliases" for whichever is empty; each writes through `updateProperties`.
    - The icon opens IconPicker (with "Remove"). On a Tag object a colour swatch next to the icon opens ColorPicker (`color`).
    - The title is an inline input with placeholder "Untitled". It trims and commits on Enter or blur; Esc reverts.
    - `#query` (at most 50 characters, at the start or after a non-word character) opens TagPicker. Picking a tag cuts `#query` and adds the tag.
    - Tag chips use `tagStyle`.
    - DailyNote titles are read-only.
  - `useTabs.retarget(oldPath, newPath)`, which also updates `usePeek`.

- [ ] **Step 1: Write failing tests**
  - `test property edit while body dirty keeps both`: type in the body, then change a label. Expect:
    - `saveBody` runs before `updateProperties`
    - `updateProperties` uses the body save's version as `baseVersion`
    - the editor resumes on the version that `updateProperties` returned
    - the next body save uses that version
    - no ConflictDialog appears
  - `test body flush conflict stops queue and replays property edit`: `saveBody` rejects with 409 while a label change is queued; exactly one ConflictDialog; `updateProperties` is not called before the user resolves; after "Reload", it is called once with the reloaded version; no second 409.
  - `test 409 on property update runs reconcile`
  - `test editing a label calls updateProperties with option text`
  - `test new label option saves the type before updateProperties`
  - `test hideWhenEmpty hides number 0 and hidden collapses under "Hidden (1)"`
  - `test title commit on Enter calls renameObject; Esc reverts`
  - `test #do opens tag picker and adds tag, removing "#do" from title`
  - `test Add icon and Add description write icon and description`
  - `test tag object shows colour swatch that writes color`
  - `test daily note title read-only`
  - `test tag chip coloured from tag object; click calls ensureTag then opens`
  - `test useTypeEditor 428 dialog resends with confirm; 409 reloads`
  - `test retarget rewrites history and peek list`
- [ ] **Step 2:** Run `npx vitest run src/object src/nav`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces. "+ Add Property" is enabled in Task 16.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(object): editable properties, header and title with serialized writes`.

### Task 16: Property definition editing (track: frontend)

**Files:**
- Create: `frontend/src/properties/typeEdits.ts`, `properties/{PropertyMenu,AddPropertyMenu,NumberFormatMenu,PropertySettings}.tsx`
- Modify: `object/PropertyPanel.tsx`: row labels open PropertyMenu; add "Add Property"
- Test: `properties/typeEdits.test.ts`, `properties/AddPropertyMenu.test.tsx`, `properties/PropertySettings.test.tsx`

**Interfaces:**
- Consumes: Tasks 11–15 (`useTypeEditor` from Task 15).
- Produces:
  - Type-editing helpers:
    - `addProperty(type, kind, {name, icon?, description?, options?}) -> TypeDef`: creates a unique camelCase key that is never a reserved key (`type` → `type_`).
    - `updateProperty`, `removeProperty` and `moveProperty(type, id, toIndex)`.
    - `setNumberFormat(def, 'none'|'number'|'progress'|'percentage'|{currency})`: a currency sets decimals to 2/2; Progress sets steps 10 and a random colour; any other format drops `progress`.
    - `setSeparators(def, {isGroupingThousands?, isRadixComma?})`.
    - `allowedKindChanges(kind) = KIND_TRANSFORMS[kind]`.
  - `<PropertyMenu>`:
    - The header has an editable icon and name, saved on blur.
    - Items: "Format" (number properties only); "Visibility" with "Always Show", "Hide When Empty" and "Hidden"; "Edit Property"; "Delete".
    - System kinds hide items as Capacities does.
  - `<AddPropertyMenu>`:
    - Title "Add Property", search placeholder "Search Properties", `ADD_PROPERTY_ITEMS` with the Object Select submenu.
    - System properties the type already has are hidden. On a basic type the menu is disabled.
    - The form has Icon, Name, Description and "Create"; Ctrl+Enter submits.
    - Adding a second Content asks "Add another content property?".
  - `<NumberFormatMenu>`: "Standard" and "Currencies" sections, search placeholder "Choose a format".
  - `<PropertySettings>`, in order:
    - Name and Description.
    - Kind-specific sections:
      - Number: Type, Decimals ("+ Enforce", a 0–5 stepper, delete), Progress (Steps, Color), Separators ("Grouping thousands", "Separator comma").
      - Dates: Time and Range, each Optional / Required / Disallowed with its follow-ups, and "Default" (Now / Custom, writing `startTimeDefault` / `endTimeDefault`; Now removes the key).
      - Relation: "Linked object type", "Single or Multi-Select", "Enable fixed set" (picking an object without an `id` calls `api.ensureId` first), "Two-way linking". Changes to the first three are collected and saved by "Apply changes" (its explanation text, then the 428 confirm). "Two-way linking" offers the linked type's eligible properties and 'Create property "X" for "Y"' (`setSync`); when not allowed it shows `syncing.multiSelectOnly.info` or `syncing.notAllowed.info` instead.
      - Label: "Single or Multi-Select" (multi→single goes through the 428 confirm), "Label set".
    - Visibility.
    - "Change property type": shows the explanation, offers only `allowedKindChanges` (or `noTransformations`), behind the checkbox "I understand the process and know that some data might be lost."; calls `changeKind` and then opens the new property.
    - "Delete property": the user types `delete`, or `delete-all-content` for blocks.
    - No "Searchable" control: `isNotSearchable` is kept and round-tripped, and M5 decides.

- [ ] **Step 1: Write failing tests**
  - `test addProperty creates unique camelCase key, avoids reserved keys, and default icon`
  - `test setNumberFormat currency sets decimals 2/2; progress sets steps 10; none removes`
  - `test allowedKindChanges matches KIND_TRANSFORMS`
  - `test AddPropertyMenu lists 15 items in order, hides existing Title, and Object Select › Person creates an entity bound to person`
  - `test PropertySettings delete requires typing "delete"`
  - `test relation Apply changes sends confirm after the 428 dialog`
  - `test two-way linking shows multiSelectOnly info for a single-select relation`
  - `test change property type calls changeKind and keeps the old property listed`
  - `test date Default Custom writes startTimeDefault`
  - `test Visibility menu not offered for title`
- [ ] **Step 2:** Run `npx vitest run src/properties`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(properties): add, edit, format, re-kind, sync and delete property definitions`.

### Task 17: Object Type Settings, create and delete type, sidebar (track: frontend)

**Files:**
- Create: `frontend/src/types/{TypeSettings,CreateTypeDialog,DeleteTypeDialog,TemplateManager,PageLayoutCards}.tsx`
- Modify: `shell/Sidebar.tsx`; `nav/tabs.ts` (`Target` adds `{kind:'typeSettings', typeId}` and `{kind:'trash'}`); `App.tsx`
- Test: `types/TypeSettings.test.tsx`, `types/CreateTypeDialog.test.tsx`, `shell/Sidebar.test.tsx`

**Interfaces:**
- Consumes: Tasks 14–16.
- Produces:
  - `<TypeSettings typeId />`, in Capacities' order. Edits save immediately (400 ms debounce and on blur) through `useTypeEditor`.
    1. The breadcrumb "Object Types / <name>".
    2. Icon, Name, "Plural of name", Color, Description. (A Name change renames the type everywhere, Task 5; it is disabled on basic types.)
    3. "Properties": a sortable list, plus the basic-type info box.
    4. "Templates".
    5. "Configuration", group "Page": "Page layout" (our own SVG cards for Standard, Index card, Profile and Encyclopedia), "Font", "Wide layout", "Cover image mode", "Display of cover image". Task 18 applies them to the page.
    6. "Delete Object Type" (hidden on basic types).
    - The "Card view and linking" and "Calendar" groups are not shown in M2; their fields are store-only (M3/M7 and M4).
    - A type with `readOnlyReason` shows it and disables every control.
  - `<TemplateManager typeId />`: "Edit Template", "Mark as Default", "Delete Template", drag to reorder, "+ New Template".
  - `<CreateTypeDialog open onCreated />`:
    - Title "Create your object type".
    - Name and "Plural of name", both required.
    - The tip "Do I need a new type?".
    - The button "Create object type".
  - `<DeleteTypeDialog type />`: "Delete this object type?" / "Moves the type, all its objects and its templates to the Trash. You can restore them from there for 30 days." / "Delete object type". (Capacities' "This can't be undone." doesn't apply: our delete is restorable.)
  - `SidebarProps` adds `onNew`, `onCreateType`, `onOpenTypeSettings`, `onDeleteType` and `onOpenTrash`:
    - "+ New" is enabled.
    - "Object Types" gets a `+`.
    - A type row's context menu has "Object Type Settings" and, for non-basic types, "Delete object type".
    - A "Trash" item is added.

- [ ] **Step 1: Write failing tests**
  - `test section headings render in order and no Calendar or Card view group`
  - `test editing Name saves type on blur with baseRevision`
  - `test basic type shows "Properties of basic object types cannot be edited.", disables Add Property and Name, and hides Delete`
  - `test Mark as Default sets templates.defaultTemplateId`
  - `test create button disabled until both fields filled; submit calls createType then opens typeSettings tab`
  - `test delete type dialog says it moves to the Trash and calls deleteType with confirm`
  - `test sidebar "+ New" enabled and type context menu items`
- [ ] **Step 2:** Run `npx vitest run src/types src/shell`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(types): object type settings, create and delete types`.

### Task 18: Object page layout (track: frontend)

**Files:**
- Create: `frontend/src/object/{PageLayout,CoverImage}.tsx`
- Modify: `object/{ObjectView,ObjectPage,ObjectPeek}.tsx`, `theme/tokens.css`
- Test: `object/PageLayout.test.tsx`

**Interfaces:**
- Consumes: Tasks 11, 14 and 15.
- Produces:
  - `<PageLayout type summary header properties body />` applies the type's page settings. Class names, widths and heights are taken from `index36682.css` and checked side by side in acceptance:
    - `viewDesign`: Standard (null) puts the properties under the header; `indexCard` puts them in a bordered card under the header; `profile` shows the cover or icon as a large round image beside the title, with the properties in a side column; `encyclopedia` puts the properties in a right-hand infobox next to the body.
    - `wideLayoutMode` removes the content max-width.
    - `font` sets the title and body font family (sans-serif, serif, monospace).
  - `<CoverImage path wide crop onChange />`: renders `api.fileUrl(coverImage)`; `wideCoverImage` spans the whole panel, otherwise the content width; `cropCoverImage` fixes the height with `object-fit: cover`, otherwise the natural height. Hover actions "Change" (ImagePicker) and "Remove".
  - The peek uses the same layout at peek width.

- [ ] **Step 1: Write failing tests**
  - `test each viewDesign renders its layout container`
  - `test wide layout removes max width`
  - `test font serif applies to title and body`
  - `test cover renders from fileUrl, cropped and wide per type settings`
  - `test Add cover image then Remove writes coverImage then null`
- [ ] **Step 2:** Run `npx vitest run src/object`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(object): page layouts, font, wide mode and cover image`.

### Task 19: Object lifecycle UI (track: frontend)

**Files:**
- Create: `frontend/src/create/{NewObjectMenu.tsx,createAndOpen.ts}`, `trash/TrashView.tsx`, `object/{DeleteObjectDialog,DeletedBanner,ChangeTypeDialog,TemplateMarker,UseTemplateMenu}.tsx`
- Modify: `object/ObjectView.tsx` (the `…` menu, the template banner, the deleted page), `types/TypePage.tsx` (the "New" split button), `App.tsx` (shortcuts)
- Test: `create/NewObjectMenu.test.tsx`, `object/lifecycle.test.tsx`, `trash/TrashView.test.tsx`, `App.shortcuts.test.tsx`

**Interfaces:**
- Consumes: Tasks 11, 15 and 17.
- Produces:
  - `createAndOpen(typeId, {title?, templateId?}, mods)`:
    - Plain: opens in the current tab.
    - Ctrl or Meta: opens in a new tab.
    - Alt+Shift: opens in the peek.
    - Shift: also opens the peek, until the side panel exists (a deviation).
    - Tasks open in the peek by default.
  - `<NewObjectMenu>`:
    - Step 1: "Search Object Types".
    - Step 2: "Search or Create", "New '<q>'" (or "New Untitled"), and existing objects; picking an existing object opens it.
  - Shortcuts, handled only when focus is **not** in an editable element (input, textarea, contenteditable, CodeMirror):
    - Ctrl+U opens the menu.
    - Ctrl+N creates an object of the current type (Page by default), with `preventDefault`. It works in the default native window (pywebview), which delivers it to the page. In `--browser` mode Chrome keeps Ctrl+N for itself, so there "+ New" and Ctrl+U are the way in.
    - Ctrl+Backspace opens DeleteObjectDialog; it never deletes without the dialog. Inside the editor and the title input it stays "delete previous word".
  - The `…` menu adds:
    - "Change type ▸".
    - "Use template ▸": Apply, Edit, Make default and Delete per template, plus "New template".
    - "Object Type Settings".
    - "Delete Object" (in red).
  - `<DeleteObjectDialog>`: "Delete this object?" / "Moves it to the Trash.". It sends the current `baseVersion`.
  - `<DeletedBanner>`: "Deleted content", "Go back", "Undo Delete".
  - `<TrashView>`: object and type entries (a type shows its object count); "Restore", "Delete permanently", "Empty Trash" (requires typing "Delete"), "Trash is empty", and the 30-day info. This is the app's trash, not the Windows Recycle Bin.
  - `<ChangeTypeDialog>`:
    - Title "Change object type?" with the "Property Mappings" rows and the lossy warning.
    - The checkbox "I know that with this transformation all or parts of my notes will get lost." is required when anything is lossy.
    - The button "Change type". On success the tab is retargeted to the new path.
  - `<TemplateMarker>`: "Template", a "Template Name" input, "Templates prefill new objects.", a "Make default" star, "Manage".
  - TypePage split button: "New {TypeName}", plus "New '{TemplateName}'" per template.

- [ ] **Step 1: Write failing tests**
  - `test NewObjectMenu type step then "New 'Foo'" calls createObject(typeId,{title:'Foo'}) and opens it`
  - `test ctrl-click opens new tab`
  - `test Ctrl+N creates object of current type`
  - `test Ctrl+Backspace in the title input and in the editor does not open the delete dialog`
  - `test Ctrl+Backspace outside editable elements opens the delete dialog, and cancel deletes nothing`
  - `test delete confirms, calls deleteObject with baseVersion; Undo Delete restores`
  - `test Empty Trash requires typing "Delete"`
  - `test restoring a type entry calls restore and lists the type again`
  - `test ChangeTypeDialog preselects suggested mapping and requires checkbox when lossy`
  - `test Use template ▸ Apply calls applyTemplate with current version`
  - `test TemplateMarker star sets default via saveType`
  - `test TypePage split button lists templates`
- [ ] **Step 2:** Run `npx vitest run src/create src/object src/trash src/App.shortcuts.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit && npm run lint && npm run build`. Expected: PASS, clean.
- [ ] **Step 5:** Commit `feat(ui): new object, delete and trash, change type, templates`.

### Task 20: Milestone acceptance (track: integrate; after Tasks 1–19)

**Files:**
- Create fixtures:
  - `backend/tests/fixtures/space-sample/Projects/Object app.md`, with:
    - `type: 'Project'`, `budget: 1200.5`, `progress: 4` (a progress format with 10 steps is set by the acceptance script), `done: false`, `site: https://example.test`
    - `timeFrame: 2026-10-01 -> 2026-12-31`
    - `kickoff: 2026-03-26T00:00:00.000Z -> 2026-03-26T00:00:00.000Z` (the export's day form)
    - `lead: '[[Ada Lovelace]]'` and `members: ['[[Ada Lovelace]]', '[[Alpha]]']`
    - a body containing `[[Ada Lovelace|Ada L]]` and the inline code `` `[[Ada Lovelace]]` ``
  - `…/Tags/Docs.md` (`color: bg-blue`)
  - `…/Templates/Tasks/Bug report.md` (`id`, `type: 'Task'`, `template: Bug report`, `title: 'Bug {date:YYYY-MM-DD}'`, `status: Not Started`, a checklist body)
  - `…/Attachments/cover.png` (a small generated PNG)
  - `backend/tests/fixtures/space-v1/`: the M1 sample space plus the `.capacities/types/*.json` that M1 writes. Produce them by running M1's code from the master commit `9214781` (`git worktree add <tmp> 9214781`, then `uv run python -c "from objectapp.typedefs import load_types; load_types(Path('<copy>'))"` in it), and commit the resulting JSON.
- Create: `scripts/m2_acceptance.py`, `docs/superpowers/plans/m2-acceptance.md`
- Modify: tests that count fixture objects or types (the counts only)

- [ ] **Step 1:** Add the fixtures, then run `uv run pytest -q` and `cd frontend && npx vitest run`, adjusting only the counts. Expected: all green.
- [ ] **Step 2:** Write `scripts/m2_acceptance.py SPACE [--keep]`. Like `m1_roundtrip.py`, it works on a temporary git-committed copy and starts the server. Over HTTP it then checks:
  1. Migration writes v2 types and v1 backups, no `.md` file changes, and a second start changes nothing.
  2. For one property of each kind, `PUT /api/object/properties` changes only what the kind should. The script parses `git diff -U0` hunks and maps each changed line to its frontmatter key. Expected: single-line kinds change the key's line plus `lastUpdated` (and `id` when inserted); blocks, simpleTableBlock and block-style lists change only lines inside that key's span; a key that was absent adds only its own lines; `kickoff` keeps its timestamp form.
  3. Renaming "Ada Lovelace" to "Ada King": `relinked` equals the set of files whose changed lines contain only link text changes, and `members:` reads `['[[Ada King]]', '[[Alpha]]']`.
  4. Changing `Pages/Notes.md` to Task moves it to `Tasks/Meeting notes.md` and inserts an `id` that survives the move.
  5. Mark "Bug report" as Task's default (`PUT /api/types/task`, `templates.defaultTemplateId`), create a Task and check the template was applied; then delete it, restore it, and empty the trash.
  6. Ensure the tag "Math", rename it, and check the `tags:` lines.
  7. Rename Task's label option "Not Started" through `PUT /api/types/task` **without** confirm (200); then delete an in-use option: 428, then 200 with confirm.
  8. Rename the type Server to Machine and check every `type:` line; delete the type Project, restore it from the trash, and compare bytes.
  9. Run the M1 no-edit pass: 0 files changed.
  10. Print every object whose file stem differs from `safe_filename(title)`, and every icon id whose Iconify prefix isn't bundled (both must be empty on the sample; on the CPI copy they are reviewed by hand).
- [ ] **Step 3:** Run it on `backend/tests/fixtures/space-sample` and on `backend/tests/fixtures/space-v1`. Expected: every check prints `[ok]`.
- [ ] **Step 4:** Run `npm run build`, then `uv run objectapp --space <copy of space-sample>` (the native window, where Ctrl+N reaches the page), and walk through:
  - "+ New" → Task → title; Ctrl+N; Ctrl+Backspace while typing in the title deletes a word, not the object
  - editing every property kind, adding an icon, a description and a cover image
  - a title rename, then checking the referring file
  - Project settings: a Number in EUR with "Separator comma", a Label set, "Two-way linking" with 'Create property', and each page layout with wide mode and cover crop
  - creating and deleting a type "Meeting", then restoring it from the Trash
- [ ] **Step 5:** Gene runs the app on his CPI copy outside the repo, with `git init` done there. Record in `m2-acceptance.md`:
  - the 13 types migrate (Weblinks and Files as basic types) and their settings open
  - a property edit gives a one-line `git diff`
  - a rename relinks and shows the count
  - the step-10 lists from `m2_acceptance.py` on the copy, and what was done about them
  - side by side with Capacities, the Object Type Settings, the property menus and the page layouts look and read the same
- [ ] **Step 6:** Commit `chore: milestone 2 acceptance`.
