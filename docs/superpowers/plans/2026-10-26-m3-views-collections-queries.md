# Object, Milestone 3: Views, Collections, Queries. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Objects can be seen and organised as the design spec and behaviour catalog describe:
- All seven layouts. Six of them (list, grid, wall, table, embed, kanban) are offered by the layout pickers of type pages, collections and query results. `gallery` (a one-row strip) is used only by dashboard sections (Recently Opened, a collection's pinned items); no picker offers a gallery choice.
- Table features: resize, wrap, pinned column, hidden columns, calculations, and inline cell editing with the M2 cells.
- Filters with groups and per-kind operators, sorts, and group-by with group order, hide, collapse and hide empty.
- Saved views per type: the Overview tab, the All tab, and one header tab per full-view section (pinned queries, the type's collections, "Not in any collection", "Not tagged"). The card render settings (small card, wide card, inline, embed) are applied.
- Collections: CRUD, membership through the `collections:` key, their own views, pinned items, templates and dashboard sections. The collections system property is live.
- Queries as objects, with a "Queries" entry in the sidebar's object types and a page listing them; the sidebar's Pinned section and custom sidebar sections such as "In Progress" (objects, types, collections and queries, with drag to reorder); the All notes view.

**Architecture:**
- **Two parallel tracks.** **backend** (`backend/**`, `scripts/**`, Tasks 1–5) and **frontend** (`frontend/**`, Tasks 6–15) never touch the same file. The frontend builds against the **API contract** below and mocks it in tests. **integrate** (Task 16) runs end to end.
- **Back end:** a bulk **rows** endpoint (decoded property values, version, links and a body preview per object); a small JSON store for `.object/` definitions (collections, queries, per-type views, `ui.json`) with revisions and atomic writes; collection membership as a writable system property, with a rename cascade and a restorable delete; new ChangeEvent kinds for definition files.
- **Front end:** a pure, fully unit-tested view engine (filter, sort, group, calculate) that runs on rows in the browser; one `DataView` component (toolbar, popovers, seven layouts, cards, table) reused by type pages, collections, queries and All notes; pages for collections, queries and the query list; the Pinned and custom sidebar sections.
- **Why the engine runs in the client:** filter edits re-evaluate without a round trip, relative dates use the viewer's clock, and inline edits patch one row. The server narrows the scope (types, collections, paths, search) and decodes values with M2's codec, so the value forms have one owner.

**Tech Stack:** as M2. No new dependencies: `@dnd-kit/core` + `@dnd-kit/sortable` (already present) serve kanban, column reorder and pinned reorder. There is no virtualisation library; long views page with "Load more".

**Spec:** `docs/superpowers/specs/2026-10-23-object-design.md` §3 (Collections, Queries, Views) and §4 (`.object/collections/`, `queries/`, `views/`, `ui.json`; the `collections:` key). §4 was amended for M3 (see "Spec amendment" under Global Constraints).
- Behaviour and names: the behaviour catalog (`docs/behavior-catalog.md`) and the design spec.
- **en-US strings:** the quoted strings below are the app's labels; take any others from the behaviour catalog.
- Behaviour not in the strings (the filter, sort and group engine, query helpers, the DataView UI, toolbar, table and dashboard sections) and sizes (card base and core, data-view heading, main and wide content widths): as specified in the tasks below.
- Visual: the design spec (type header, Overview/All tabs, toolbar pill, filter popover, `grid` cards).

## Roadmap (one plan per milestone, written when the previous one is accepted)

| M | Delivers |
|---|---|
| 1 (accepted) | shell, objects on disk, page + peek, block editor with byte preservation, wikilinks, external changes |
| 2 (building) | object types and all property kinds, type settings and page layouts, title edit and relink, change type, templates, tags as objects, trash |
| **3 (this plan)** | views (list, grid, wall, table, embed, kanban, gallery), filters, sorts, group-by, calculations, collections, queries, pinned; per-type card and link views; All notes |
| 4 | calendar, daily notes, tasks (status categories, priority, due, recurrence, reminders); Task dashboard sections; "Scheduled" date grouping; recurring/reminder filters |
| 5 | SQLite FTS index (real Exact/Semantic query search), Ctrl+K, backlinks (the `noBacklinks` section, backlink and linked-object filters and sorts), graph |
| 6 | whiteboards and pen |
| 7 | remaining blocks (object blocks use M3's link views), light mode, polish |

## Global Constraints

**Carried forward from M1 and M2** (all of them, unchanged):
- **Server and toolchain:** `127.0.0.1:8790`, no outbound network, Python `>=3.13` with uv, Node `>=22`.
- **Opening never writes an object file.** The only writes on open are the four in M2's list. M3 adds none: a missing collections, queries or views file, or a missing `ui.json`, reads as defaults and is written the first time the user changes something. M2's write #4 (purging trash entries older than 30 days) now also covers `trash/collections/` and `trash/queries/` (Tasks 4 and 5); it stays the only trash write on open.
- **Writes:** every object write goes through `Space._write`; rewrites of *other* files are unstamped, retry once on `Conflict` and are otherwise reported in `skipped`; writes are atomic and keep EOL/BOM/trailing newline; destructive confirmations use 428.
- **Event rule:** every write route announces `ChangeEvent(origin=clientId)` for each path it wrote. The client emits the same events locally and drops SSE echoes of its own origin.
- **Other carried rules:** the 18 colours in order; reserved keys (including `collections`); no real CPI data in the repo.
- **Tests:** baseline is master after M2 Task 20. Every task keeps all earlier tests green. Backend tests build their collections and queries in the tmp copy (`space_dir`) and never assert absolute fixture counts: compare to `len(space.list())` instead, so fixture changes don't ripple.

**New in M3**
- **Start condition.** Backend Tasks 1–5 need M2 Tasks 1–10 on master; frontend Tasks 6–11 need M2 Tasks 11–16. Frontend Tasks 12–15 modify files that M2 Tasks 17–19 also modify (`types/TypePage.tsx`, `types/TypeSettings.tsx`, `shell/Sidebar.tsx`, `nav/tabs.ts`, `App.tsx`, `object/ObjectView.tsx`, and M2 Task 19's `create/createAndOpen.ts`), so they start only after M2 Task 19 is committed. They extend M2's versions and keep everything M2 put there, in particular TypePage's "New {TypeName}" split button with templates, the Sidebar's `onNew`/`onCreateType`/`onOpenTypeSettings`/`onDeleteType`/`onOpenTrash` props, the Trash item, and the `typeSettings` and `trash` targets.
- **Tracks.** Tasks 1–5 touch only `backend/**` and `scripts/**`; Tasks 6–15 touch only `frontend/**`. The API contract below is the only coupling, and changing it is a plan change.
- **Where definitions live** (spec §4 as amended below; nothing about views goes in object files):

  | What | File | Written by |
  |---|---|---|
  | Collection | `.object/collections/<id>.json` | collection routes |
  | Query | `.object/queries/<id>.json` | query routes |
  | A type page's views (Overview, All, section tabs) | `.object/views/<typeId>.json` | views route |
  | Pinned items, custom sidebar sections, All notes layout | `.object/ui.json` (keys `pinned`, `sections`, `allNotesLayout`; `changeTypePreferences` and unknown keys kept) | ui route |
  | Card and link view settings (`typeViews`, `defaultViewType`, `defaultViewIds`, `defaultPageViewId`, `smallCardViewConfig`) | the type JSON, as M2 already round-trips them | `PUT /api/types/{id}` |
  | Membership | the object's `collections:` key, a flow list of collection names (`collections: [Tooling]`) | `PUT /api/object/properties` |

  - **Type page views** sit beside the type file, not inside it. A column resize must not bump the type's revision and turn an open Type Settings into a 409.
  - **File names:** `<id>` is `slug(name)` at creation, made unique with `-2`, `-3`, and so on, skipping ids that are live **or held by a trash entry** (so a pin, a `query:<id>` or `collection:<id>` section, or a restore never resolves to a different definition). It never changes on rename.
  - **Spec amendment (M3).** Spec §4 listed `collections/<name>.json`, `queries/<name>.json` and per-type views inside `types/<type>.json`. M3 stores them by a stable `<id>` (a rename must not move the file or break references) and puts type views in `.object/views/<typeId>.json` (a column resize must not bump the type's revision). Spec §4 was updated to match when this plan was written; later milestones follow this table.
  - **Type delete and restore** (M2 `trash_type` / `restore`): the type's `views/<typeId>.json` moves into the type's trash folder and comes back on restore (Task 1). Collections whose `typeIds` include the type, and queries whose `types` or `excludeTypeIds` include it, are left unchanged: an unknown type id is ignored when evaluating, shown as "Invalid" in the builder, and becomes valid again on restore. Saving a definition rejects only unknown ids that were *not already* in the stored version (Tasks 3 and 5).
  - **Format:** JSON with `indent=2`, `ensure_ascii=False`, LF and a trailing newline. Unknown keys are kept. A file that isn't valid JSON is never rewritten: it is listed with `readOnlyReason`, and writes to it return 423.
- **Collections.**
  - Names are unique case-insensitively (422 "A collection with this name already exists.", our string).
  - A collection holds objects of the types in `typeIds`. Adding an object of another type returns 422 "This collection doesn't hold objects of this type." (our string).
  - The `collections:` names resolve to collections case-insensitively by name, then by `formerNames`. A name that doesn't resolve stays in the file and is ignored.
  - **Rename** rewrites the `collections:` items in every member (unstamped, `replace_in_value`, quote style kept) and appends the old name to `formerNames`.
  - **Delete** follows the confirmation dialog (an entry is deleted with its collection unless it is also in another collection, where it stays), but restorably. The collection goes to `.object/trash/collections/<ulid>/` (`collection.json` + `manifest.json {id, kind:'collection', collectionId, name, deletedAt, objectTrashIds, removedFrom, skipped}`).
    - Members in no other collection become object trash entries with `collectionTrashId` (the files are moved as they are). A member is "in no other collection" only when every non-empty item of its `collections:` names this collection; an item that names another collection, an unreadable one or nothing known keeps the object, which only loses this collection's item.
    - For every other member, the item naming this collection is removed (unstamped) from its `collections:` list with `frontmatter.remove_from_list`. Each entry of `removedFrom` is `{path, index, versionAfter}` (the item's position in the list and the file's version after the removal), and the member's bytes before the removal are kept as `before/<n>.md` in the trash folder.
    - A member that is read-only or still conflicts after the one retry is left unchanged, listed in `skipped`, and returned by the route; its `collections:` still names the deleted collection, which then simply doesn't resolve.
    - **Restore** reverses all three: the JSON comes back; the object entries with this `collectionTrashId` are restored; for each `removedFrom` entry whose file still has `versionAfter`, the saved `before/<n>.md` bytes are written back (atomic, unstamped), so an untouched member is byte-identical. A member changed since the delete instead gets the current name re-inserted at `index` (clamped to the list length) with `frontmatter.insert_in_list`; such a member is equal in content but not guaranteed byte-identical. A member that is read-only or conflicting at restore is reported in `skipped`.
- **Queries** are definition files with a view. They open in a tab like an object and can be pinned, but they are not `.md` objects, have no body and don't appear in `list()` or type counts. The sidebar lists them under a "Queries" entry among the object types, which opens a page listing every query (Task 14). Deleting one moves it to `.object/trash/queries/<ulid>.json` unchanged, with a `<ulid>.meta.json` `{id, deletedAt}` recording the original id (restorable, always under that id). A collection's or query's id is its file name; an `id` inside the JSON that differs is ignored.
- **Restore never re-keys a definition.** Because `new_id` skips ids held in the trash, the app never reuses one. If `<id>.json` exists anyway (created outside the app), restoring a collection or query returns 409 `{detail: "Its id is used by another definition."}` (our string) and changes nothing; a restore never falls back to `<id>-2`, which would silently break pins and sections.
- **Collections have no space-level page**: they are reached from their types' Overview "Collections" section and header tabs, from pins and from the collections property. There is no default-collection concept in M3 (`isDefaultDatabase` / "Default collection" is not modelled; an unknown `isDefault` key in a file is kept).
- **References inside definitions** use stable ids, never titles or paths: object ids (an object without an `id` gets one through `api.ensureId` when it is picked, as M2's fixed set does), type ids, collection ids, label option ids, and Tag object ids for query tags.
- **Store-only or deferred in M3:** `ui.json` `workspaceOrder` (kept, not used); `typeViews` per-view settings other than the small card, and `defaultPageViewId`; search modes `fullText` and `semantic` behave as `auto` until M5; the computed backlink and linked-object filters (M5); the Task dashboard sections and the Tasks type's `hideDashboard` (no Overview tab) (M4); type-constrained queries and their "release constraint" action : a query pinned to a type is an ordinary query in M3, so removing its tab only removes the section; the default collection (`isDefaultDatabase`).
- **Fidelity.** The labels, icons, option keys, defaults and orders in the API contract and the tasks come from the behaviour catalog and the design spec. A string marked "our string" is new to Object; every other quoted string must be used verbatim (including typographic apostrophes such as "Query isn’t ready").

## API contract (M3): shared by both tracks

```
Row        { summary: ObjectSummary, version, values: {[key]: value}, links: {[key]: (path|null)[]}, preview: string }
           /* values: every key of the type's propertyDefinitions (system keys included), in the M2 API value form via decode_value;
              entity values carry resolved paths; preview: plain text of the body, Markdown stripped, ≤ 280 chars, '' when empty */
ObjectSummary += collections: string[]           /* raw names from `collections:`, [] when absent */
Layout     = 'list'|'grid'|'wall'|'table'|'embed'|'kanban'|'gallery'
FilterGroup { type:'filterGroup', operator:'and'|'or', elements: (Filter|FilterGroup)[] }
Filter      { type:'filter', propertyId /* the property key */, option, referenceValue?, typeId? /* type id */ }
            referenceValue: text → string · number → number · label → optionId[] · entity, entity_tags → objectId[]
                            entity_type → typeId[] · entity_collections → collectionId[]
                            dates → {relative: DateRelative} | {exactDate: 'YYYY-MM-DD'}
DateRelative = overdue|today|yesterday|tomorrow|thisWeek|thisMonth|thisYear|oneWeekAgo|inOneWeek|oneMonthAgo|inOneMonth
Sort        { propertyId, option: 'ascending'|'descending'|'ascendingExists'|'descendingExists', typeId? }
GroupBy     { groups: [{propertyId, option, typeId?, numberRangeConfig?: {min?, max?, step?}}],
              sortOption?: 'default'|'defaultDescending'|'ascending'|'descending'|'createdAscending'|'createdDescending'
                          |'sizeAscending'|'sizeDescending'|'manual' }
TableColumn { id, type, isHidden, wrapContent, colWidth /* rem, 2..50 */, calculation? }
TableViewConfig { wrapAllContent: boolean, pinnedColumnIndex?: number, properties: TableColumn[] }
SmallCardViewConfig { entityViewType: 'smallCard', properties: [{propertyType, propertyId}] }   /* propertyId 'computed_preview' = body preview */
DataViewDefinition { dataViewLayout: Layout, tableConfigs?: {[typeId]: TableViewConfig},
              groupByConfig?: {groups: [{id, isHidden, isClosed}], hideByDefault?, hideEmptyGroups?},
              calculations?: [{propertyId, typeId, kind: CalcKind}], smallCardViewConfigs?: {[typeId]: SmallCardViewConfig} }
ViewState   { viewDefinition: DataViewDefinition, filterGroup: FilterGroup, sorts: Sort[], groupBy: GroupBy|null, showDataViewDetails?: boolean }
DashboardSection { key: 'allContent'|'recentlyAccessed'|'collections'|'queries'|'inNoCollection'|'notTagged'|'noBacklinks'|'pinned'
                        |`query:${id}`|`collection:${id}`,
              collapsed: boolean, viewDefinition?: DataViewDefinition, title?: string /* a tab rename; our addition */ }
              /* Whether a section is also a header tab ("inFullView") is fixed per kind, not stored:
                 dashboard only: recentlyAccessed, collections, queries, pinned
                 dashboard and header tab: inNoCollection, notTagged, query:<id>, collection:<id> */
Views       { activeTab: 'overview'|'all'|string /* a full-view section key */, all: ViewState,
              dashboard: {sections: DashboardSection[], removedSections: string[]} }
Collection  { schemaVersion: 1, id, name, formerNames: string[], icon: Icon|null, color: string|null, description, typeIds: string[],
              views: Views, pinned: {ids: string[], isHidden: boolean}, templates: {ids: string[], defaultTemplateId: string|null},
              readOnlyReason /* API only */, revision /* API only */, ...unknown keys kept }
QueryDefinition { types: [{id, collectionIds?, excludeCollectionIds?, inAnyCollection?, inNoCollection?}], excludeTypeIds?: string[],
              tags?: {ids: string[], operator: 'or'|'and'}, excludeTags?: {ids: string[]},
              search?: {searchTerms: [{text}], searchMode: 'auto'|'fullText'|'semantic'|'title'},
              filterGroup, sorts, groupBy: GroupBy|null, limit?: {size, random?: boolean} }
Query       { schemaVersion: 1, id, name, titleIsCustom, icon: Icon|null, description, definition: QueryDefinition,
              view: {viewDefinition: DataViewDefinition, showDataViewDetails?: boolean} /* filter/sort/group live only in definition */,
              readOnlyReason, revision, ...unknown keys kept }
              /* titleIsCustom: false on create without a name; when loading a file where it is absent, true if name is non-empty, else false */
PinRef      { kind: 'object'|'type'|'collection'|'query', id }      /* object: its frontmatter id */
SidebarSection { id /* ulid */, name, icon: Icon|null, items: PinRef[] }   /* a custom sidebar section such as "In Progress" */
UiState     { pinned: PinRef[], sections: SidebarSection[], allNotesLayout: 'list'|'grid'|'wall'|'embed', ...other keys kept }
TrashItem.kind += 'collection'|'query'
TrashItem  += collectionTrashId? /* object entries trashed by a collection delete */, collectionId?, queryId?, name? /* collection and query entries */
ChangeEvent.kind += 'collections' (path = collection id), 'queries' (path = query id), 'views' (path = type id), 'ui' (path = 'ui.json')
```

| Route | Request | Success | Errors |
|---|---|---|---|
| `POST /api/rows` | `{typeIds?, collectionIds?, paths?, search?: {terms: string[], mode}}` | `{rows: Row[]}` | 422 |
| `POST /api/objects` (extended) | adds `values?: {key: v}` (written in the creating write, validated like `updates`) | 201 `{path, version}` | 404, 422 |
| `GET /api/views/{typeId}` · `PUT /api/views/{typeId}` | `{views, baseRevision, clientId?}` | `{views, revision}` (defaults and `''` when missing; a partial file is filled from the defaults on read, the file untouched) · `{revision}` | 404, 409 `{currentRevision}`, 422 (not a Views shape, or a type id no file name can hold), 423 |
| `GET /api/collections` · `POST /api/collections` | `{name, typeIds, icon?, clientId?}` | `Collection[]` · 201 `Collection` | 422 |
| `PUT /api/collections/{id}` | `{collection, baseRevision, clientId?}` | `{collection, rewritten, skipped}` | 404, 409, 422, 423 |
| `DELETE /api/collections/{id}?confirm=true&clientId=` | | `{trashId, removedFrom: string[], skipped: [{path, reason}], deleted: string[]}` (`deleted`: sole members moved to the trash) | 404, 428 `{detail, affected}` |
| `GET /api/queries` · `POST /api/queries` | `{name?, definition?, view?, clientId?}` | `Query[]` · 201 `Query` | 422 |
| `PUT /api/queries/{id}` · `DELETE /api/queries/{id}?clientId=` | `{query, baseRevision, clientId?}` | `{query}` · `{trashId}` | 404, 409, 422, 423 |
| `GET /api/ui` · `PUT /api/ui` | `{patch: {pinned?, sections?, allNotesLayout?}, baseRevision, clientId?}` | `{ui, revision}` · `{ui, revision}` | 409 `{currentRevision}`, 422 (pinned not a list of `{kind, id}`, sections not a list with list `items`), 423 |
| `POST /api/trash/{id}/restore` (extended) | collection and query entries | `{paths, typeIds, collectionIds, queryIds, skipped, rewritten}` (`rewritten`: members whose item was written back) | 404, 409 (name taken, or id used by another definition) |

- `PUT /api/object/properties` accepts `updates: {collections: string[]}`: names of existing collections, written as a flow list. An unknown name, or a collection that doesn't hold the object's type, returns 422.
- Definition writes announce `collections`, `queries`, `views` or `ui` events. A collection rename, delete or restore also announces `changed` for each rewritten object. The watcher reports external edits of those JSON files with the same kinds, and stays silent for the app's own writes.
- `PUT /api/ui` checks `baseRevision` like the other definition routes: two pin reorders, or an external edit of `ui.json`, must not silently overwrite each other. On 409 the client refetches, re-applies its patch once to the fresh state and saves again (as `useViewState` does).

## Review Focus

1. **Membership writes are minimal and never lose data.** Adding a collection to an object that has an `id` changes only the `collections:` line plus `lastUpdated` (an object without one also gains the `id:` line that every stamped write adds). A rename rewrites only the matching list item, in CRLF files too, unstamped, and a conflicting member is skipped and left unchanged. Delete then restore gives back byte-identical members when they weren't edited in between, keeping the item's position in the list; a member that can't be rewritten is reported, never silently dropped.
   - *(Task 4: `test_add_collection_changes_one_line`, `test_rename_collection_rewrites_items_only`, `test_rename_collection_crlf_and_quotes_kept`, `test_rename_conflict_skipped_untouched`, `test_remove_from_list_forms`, `test_delete_collection_restore_byte_identical`, `test_delete_collection_reports_skipped_member`)*
2. **Views never touch object files, and opening writes nothing.** View, table, pin and query changes write only their own `.object/` file. A `ui.json` patch keeps `changeTypePreferences` and unknown keys, and a stale one is refused. A second open writes nothing.
   - *(Task 1: `test_views_write_only_views_file`, `test_ui_patch_keeps_other_keys`, `test_ui_put_stale_revision_409`, `test_unparseable_definition_untouched_423`, `test_open_twice_writes_nothing`, extended in Tasks 3 and 5)*
3. **Filter and search semantics match the specification exactly.** Nested AND/OR works, an empty group passes, and an invalid filter is ignored. Text comparisons are case-insensitive, a text filter with an empty reference value passes every row, `typeId` scoping holds, and relative dates use an injected `now`. Every per-kind operator is covered. Search terms are ORed, and a query's sorts and property filters pause while it has a search term.
   - *(Task 7: `test nested and/or groups`, `test empty group passes`, `test filter on deleted property is ignored`, `test text filters with empty reference value pass every row`, `test typeId scopes filter to one type`, `test relative dates against fixed now`, `test operator table per kind`; Task 2: `test_rows_search_terms_or`; Task 14: `test search pauses filters and sorts`)*
4. **Grouping, sorting and calculations are exact.** "Other" comes last, or first for a status label. Hide-empty, manual order and number ranges work, and the sort fallback is createdAt newest first. `countValues` sums multi-value cells, percentages are relative to the row count, and median and date range are right.
   - *(Task 8: `test Other group last except status first`, `test number range groups drop out-of-range`, `test manual group order`, `test countValues sums multi-value cells`, `test median and date range duration`; Task 7: `test sort fallback createdAt newest first`)*
5. **Inline edits from views are safe.** A table cell or kanban drop calls `updateProperties` with that row's version. A 409 reloads the row and never retries blindly. Creating from a filtered view or a kanban column pre-fills values that match.
   - *(Task 10: `test cell edit sends row version and patches row`, `test 409 on cell edit reloads row without retry`; Task 11: `test kanban drop writes matching label`, `test create from filtered view prefills matching values`)*

---

## File Structure

```
backend/objectapp/  jsonstore.py rows.py collections.py queries.py uistate.py                              NEW
                    space.py propvalues.py frontmatter.py trash.py watcher.py server.py changetype.py (load_ui moves to uistate)  MOD
backend/tests/      test_{jsonstore,rows,collections,membership,queries}.py   test_watcher.py (new cases)
docs/superpowers/specs/2026-10-23-object-design.md   §4 amended with this plan (not by a task)
scripts/m3_acceptance.py
frontend/src/api/{types,client}.ts  test/mockApi.ts                                                        MOD
frontend/src/views/ model.ts dates.ts filter.ts sort.ts group.ts calc.ts useRows.ts useViewState.ts
                    DataView.tsx Toolbar.tsx FilterEditor.tsx SortEditor.tsx GroupEditor.tsx CustomizeMenu.tsx ViewSummary.tsx
                    layouts/{List,Grid,Wall,Gallery,Embed,Kanban}Layout.tsx  table/{TableLayout,ColumnMenu,CalcFooter}.tsx table/tableConfig.ts
                    cards/{ObjectCard,SmallCard,WideCard,InlineToken,EmbedCard}.tsx cards/cardConfig.ts  matching.ts
frontend/src/types/ TypePage.tsx TypeSettings.tsx (MOD)  TypeOverview.tsx dashboardSections.ts queryRecommendations.ts CardViewSettings.tsx
frontend/src/collections/ CollectionPage.tsx CollectionDialogs.tsx CollectionPicker.tsx useCollections.ts
frontend/src/queries/ QueryPage.tsx QueriesPage.tsx QueryBuilder.tsx autoTitle.ts runQuery.ts useQueries.ts
frontend/src/allnotes/AllNotesView.tsx   frontend/src/nav/recent.ts   frontend/src/create/createAndOpen.ts (MOD: values)
frontend/src/shell/{Sidebar.tsx (MOD), PinnedSection.tsx, SidebarSections.tsx, PinToMenu.tsx, usePinned.ts}   nav/tabs.ts App.tsx object/ObjectView.tsx  (MOD)
frontend/src/properties/cells/{types.ts, SystemFieldCell.tsx}  (MOD: table density, live CollectionsCell)
```

---

### Task 1: JSON definition store, views and ui.json routes, new change kinds (track: backend)

**Files:**
- Create: `jsonstore.py`, `uistate.py`
- Modify: `changetype.py` (imports `load_ui` from `uistate`; `save_change_type_preference` goes through `uistate.patch_ui`), `space.py` (`Space.store(folder)`, `trash_type`/`restore` carry the views file), `watcher.py`, `server.py`
- Test: `test_jsonstore.py`, new cases in `test_watcher.py`

**Interfaces:**
- Consumes: `atomic_write`, `slug`, `ChangeEvent`, `version_of`, `Space.own_writes`.
- Produces:
  - `DefinitionUnreadable(path, error)`; `json_revision(path) -> str` (`version_of` of the bytes, i.e. sha256, `''` when missing; the same value the watcher computes, so own-write suppression compares like for like)
  - `JsonStore(root: Path, folder: str, own_writes: dict[str, str], trash_ids: Callable[[], set[str]] = lambda: set())` (`folder` is `collections`, `queries` or `views`). It is never built from a bare root in app code: `Space.store(folder)` returns one bound to `self.root` and `self.own_writes`, so suppression reaches the watcher. Methods: `.path(id) -> Path`; `.read(id) -> (dict|None, revision)`: raises `DefinitionUnreadable` for invalid JSON; `.list() -> list[(id, dict|None, revision, error|None)]`; `.new_id(name) -> str`: `slug(name)`, unique with `-2`, `-3` and so on against live ids and `trash_ids()`; `.write(id, data, base_revision) -> revision`: raises `RevisionConflict` or `ReadOnly`; before the atomic write it sets `own_writes['.object/<folder>/<id>.json'] = revision` (popped again if the write fails), exactly as `Space._write` does for objects; `.remove(id)` (also registers, so the watcher's `deleted` is suppressed).
  - `default_views(t: TypeDefinition) -> dict`: the Views default.
    - `activeTab` is `'all'`.
    - `all` is `{viewDefinition: {dataViewLayout}, filterGroup: {type:'filterGroup', operator:'and', elements:[]}, sorts: [], groupBy: None}`. `dataViewLayout` is `'grid'` for the media types Image, Weblink and Tweet, otherwise `'list'`.
    - `dashboard.sections` are `recentlyAccessed`, `collections`, `queries` and `inNoCollection`, plus `notTagged` when the type has a `tags` definition. All have `collapsed: False`.
  - `load_ui(root) -> dict` (M2's signature, unchanged for `changetype.py`); `read_ui(root) -> (dict, revision)`; `patch_ui(space, patch: dict, base_revision: str | None) -> (dict, revision)`. It takes the Space (for `root` and `own_writes`, registered as `JsonStore.write` does). It replaces only the patched top-level keys, raises `RevisionConflict` when `base_revision` is given and stale, and refuses (`ReadOnly`) to replace an unreadable file. `save_change_type_preference` passes `base_revision=None` (it patches one key on the freshly read state under the space lock, so it cannot lose another key).
  - `default_views` is for types only; a collection's defaults are `default_collection_views()` in Task 3.
  - `ChangeEvent.kind` adds `collections`, `queries`, `views` and `ui`.
  - `SpaceWatcher` watches `.object/{collections,queries,views}/*.json` and `.object/ui.json`, maps them to those kinds, applies `own_writes` suppression and the 150 ms debounce, and still ignores every other dot-folder path. (Refreshing `Space.collections` on a `collections` event is Task 3's.)
  - M2's `trash_type` also moves `.object/views/<typeId>.json`, when present, into the type's trash folder as `views.json`; `restore` moves it back (or leaves it in the trash entry if a live views file now exists).
  - Routes `GET`/`PUT /api/views/{typeId}`, `GET`/`PUT /api/ui` (see the contract). An unknown type is 404.

- [ ] **Step 1: Write failing tests**
  - `test_store_roundtrip_keeps_unknown_keys`: write `{id, name, foo: {bar: 1}}`; read returns `foo`; the file ends with `\n` and uses `indent=2`.
  - `test_store_revision_conflict`: a write with a stale revision raises `RevisionConflict`, and the bytes are unchanged.
  - `test_unparseable_definition_untouched_423`: `.object/queries/q.json` = `{"id":`. `list()` reports the error; `PUT /api/queries/q` returns 423 (asserted here through the store, via `ReadOnly`), and the bytes and mtime are unchanged.
  - `test_new_id_unique_slug`: "Reading List" twice gives `reading-list` and `reading-list-2`.
  - `test_get_views_defaults_without_writing`: `GET /api/views/task` returns `revision == ''` and the default sections; no `.object/views/` folder exists afterwards.
  - `test_views_write_only_views_file`: `PUT /api/views/task` changes exactly one file under the space, `.object/views/task.json`; every `.md` and the type JSON keep their bytes and mtime; the SSE hub receives `views` with path `task`.
  - `test_views_put_stale_revision_409`
  - `test_ui_patch_keeps_other_keys`: an existing `ui.json` with `changeTypePreferences` and `zzz: 1`; patching `pinned` keeps both byte-equal as JSON values.
  - `test_ui_patch_unreadable_refused`: an invalid `ui.json` → 423, untouched.
  - `test_ui_put_stale_revision_409`: two PUTs with the same `baseRevision`; the second → 409 `{currentRevision}`, and the file holds the first patch.
  - `test_open_twice_writes_nothing`: open a tmp copy, GET every route that exists after this task (`/api/views/{id}` for every type, `/api/ui`), open again; no file under the space changed. Tasks 3 and 5 add their GET routes to this test.
  - `test_watcher_reports_external_collection_edit`: an external write to `.object/collections/x.json` emits `collections` with path `x` within 2 s; a write through `space.store('collections').write` emits nothing.
  - `test_type_trash_carries_views_file`: delete a type with a views file → the file is gone from `views/`; restore → it is back, byte-identical.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_jsonstore.py backend/tests/test_watcher.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces. The PUT routes announce their event with `origin=clientId`.
- [ ] **Step 4:** Run `uv run pytest -q`. Expected: PASS (M2's change-type preference tests still green through `uistate`).
- [ ] **Step 5:** Commit `feat(backend): json definition store, per-type views and ui state`.

### Task 2: Rows endpoint (track: backend)

**Files:**
- Create: `rows.py`
- Modify: `space.py` (`ObjectSummary.collections`), `server.py`
- Test: `test_rows.py`

**Interfaces:**
- Consumes: `decode_value`, `Space._raw`, `Space.resolve`, `links_of`.
- Produces:
  - `Row(summary, version, values, links, preview)`
  - `body_preview(body: str, limit=280) -> str`, which: drops the first line when it is `# <title>`; strips heading, list, quote and emphasis markers, code fences, tables and HTML tags; renders `[[A|b]]` as `b` and `[[A]]` as `A`; collapses whitespace and cuts at a word boundary with `…`.
  - `Space.rows(type_ids=None, collection_ids=None, paths=None, search=None) -> list[Row]`, sorted by path.
    - Templates are excluded; read-only objects are included with `values` decoded leniently.
    - `collection_ids` keeps members of any of them (name resolution as in Global Constraints). Task 2 resolves names by reading `self.store('collections').list()` (`name` and `formerNames`) through a helper `_collection_names() -> {id: [names]}`; Task 3 rebases that helper on `Space.collections` without changing behaviour.
    - `search` keeps objects where **any** term appears (the builder's hint says a result may match any one term). Terms are case-insensitive substrings, at least 2 characters, at most 5 (a shorter or extra term is a 422). Places searched: mode `title`: the title or an alias; otherwise: the title, an alias, the description or the body.
  - `ObjectSummary.collections: list[str]`.
  - Route `POST /api/rows`.

- [ ] **Step 1: Write failing tests**
  - `test_rows_values_per_kind`: for `Tasks/Write docs.md`, `values['status'] == ['Not Started']`, `values['tags']` is a list, `values['createdAt']` is the raw string, and a missing key gives the empty value (`[]` or `None`).
  - `test_rows_entity_paths_resolved`: a tmp object with `lead: '[[Ada Lovelace]]'` → `values['lead'] == [{'target': 'Ada Lovelace', 'path': 'People/Ada Lovelace.md'}]` and `links['lead'] == ['People/Ada Lovelace.md']`.
  - `test_rows_version_matches_read`: each row's version equals `space.read(path)[2]`.
  - `test_rows_scope_types_collections_paths`: `type_ids=['task']` returns only tasks; `paths=[p]` returns one row; `collection_ids=['tooling']` returns the members (the collection is written through `space.store('collections')` in the test).
  - `test_rows_search_title_mode_vs_auto`: a word that appears only in the body matches in `auto` but not in `title`; a 1-character term → 422.
  - `test_rows_search_terms_or`: terms `['alpha', 'zzbody']`, where "alpha" is only in A's title and "zzbody" only in B's body → `auto` returns A and B; `title` returns only A; a term that matches nothing doesn't remove A.
  - `test_body_preview_strips_markdown`: `# T\n\n## Head\n- [x] **done** [[A|b]]\n` → `Head done b`.
  - `test_rows_exclude_templates_include_readonly`
  - `test_summary_collections_raw_names`: `collections: [Tooling, 'Reading list']` → `['Tooling', 'Reading list']`.
  - `test_rows_never_write`: the hash of every file is the same before and after `POST /api/rows` over everything.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_rows.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement from the in-memory `_raw` (no re-read per call). `version` comes from the cached version. The body comes from the cached `ObjectFile`.
- [ ] **Step 4:** Run `uv run pytest -q`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): bulk rows with decoded values and previews`.

### Task 3: Collections: model and CRUD (track: backend)

**Files:**
- Create: `collections.py`
- Modify: `space.py` (`self.collections`, loaded on open; `reload_collection(id)`), `watcher.py` (the refresh hook), `server.py`
- Test: `test_collections.py`, a new case in `test_watcher.py`

**Interfaces:**
- Consumes: Task 1 (`Space.store`, `JsonStore`).
- Produces:
  - `default_collection_views() -> dict`, **the only definition of a collection's default views**: `activeTab: 'all'`; `all` as in `default_views` with `dataViewLayout: 'list'`; `dashboard.sections: [{key: 'pinned', collapsed: False}]`, `removedSections: []`. Type-level sections (`recentlyAccessed`, `collections`, `queries`, `inNoCollection`, `notTagged`) don't apply to a collection; `query:<id>` sections are added by "Pin to dashboard" (Task 14) or "Add a section" (Task 13).
  - `CollectionDef.from_json(data, fallback_id)`, `.to_json()`, `.to_api(revision)`. These carry every contract field; a missing `views` reads as `default_collection_views()`.
  - `Space.reload_collection(id)`: re-reads one file (or drops it when gone) into `self.collections`. `SpaceWatcher._refresh` calls it for every `collections` event before broadcasting, so an external edit changes name resolution (`collection_by_name`, the rows scope, membership validation) before any client reloads.
  - `Space.list_collections() -> list[CollectionDef]`, ordered by name case-insensitively.
  - `Space.collection_by_name(name) -> CollectionDef|None`: name first, then `formerNames`, both case-insensitive.
  - `Space.create_collection(name, type_ids, icon=None) -> CollectionDef`: an empty name becomes "New Collection" (the default title) made unique with ` 2`, ` 3`; a duplicate explicit name or an unknown type id → 422.
  - `Space.save_collection(c, base_revision) -> SaveCollectionResult(collection, rewritten, skipped)`. A name change is handled in Task 4; here a name change without members just saves. An unknown type id in `typeIds` is a 422 only when it wasn't in the stored version (a deleted type's id stays until the type is restored).
  - Routes `GET`/`POST /api/collections` and `PUT /api/collections/{id}`.

- [ ] **Step 1: Write failing tests**
  - `test_create_collection_writes_one_file`: `POST {name:'Tooling', typeIds:['server']}` → 201; exactly `.object/collections/tooling.json` is created; `collections` event announced.
  - `test_create_default_name_new_collection`: two empty names give "New Collection" and "New Collection 2".
  - `test_duplicate_name_case_insensitive_422`: "tooling" after "Tooling".
  - `test_unknown_type_422`
  - `test_save_keeps_unknown_keys_and_checks_revision`: 409 on a stale revision.
  - `test_collection_by_former_name`
  - `test_list_unreadable_collection_readonly`: an invalid JSON file lists with `readOnlyReason`, and `PUT` → 423.
  - `test_collection_default_views_pinned_only`: a new collection's `views.dashboard.sections` is exactly `[pinned]`.
  - `test_saved_unknown_type_kept_new_unknown_422`: a stored `typeIds` with a since-deleted type saves unchanged; adding another unknown id → 422.
  - `test_watcher_external_collection_edit_refreshes_space` (in `test_watcher.py`): change the collection's `name` to "Gear" by editing its JSON outside the app (no `formerNames`) → within 2 s `space.collection_by_name('Gear')` finds it, `collection_by_name('Tooling')` is None, and `space.rows(collection_ids=[id])` returns a tmp object whose `collections:` says `Gear` and no longer the one that says `Tooling`.
  - Extend `test_open_twice_writes_nothing` with `GET /api/collections`.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_collections.py backend/tests/test_watcher.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `uv run pytest -q`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): collections model and routes`.

### Task 4: Collection membership, rename cascade, delete and restore (track: backend)

**Files:**
- Modify: `propvalues.py` (`entity_collections` leaves `_READ_ONLY_KINDS`; encodes `string[]` as a flow list), `frontmatter.py` (`remove_from_list`, `insert_in_list`), `space.py` (`update_properties` validation, `create_object(values=)`, rename cascade, `delete_collection`, `purge_expired` scope), `trash.py` (collection entries), `server.py`
- Test: `test_membership.py`

**Interfaces:**
- Consumes: Tasks 2–3; `replace_in_value`, `_scan_items`/`_key_spans` (frontmatter internals), `_rewrite_other`.
- Produces:
  - `frontmatter.remove_from_list(src, key, pred: Callable[[str], bool]) -> (str, list[int])`: removes every scalar item for which `pred` is true from one key's flow or block list and returns the new source plus the removed indexes. Every other character is kept:
    - flow list: the item and one adjacent separator go (`[Tooling, Other]` → `[Other]`, `[Other, Tooling]` → `[Other]`, `[A, Tooling, B]` → `[A, B]`), quotes of the other items are untouched;
    - block list: the item's whole `- item` line (with its EOL) goes;
    - a list that becomes empty becomes `key: []` on the key's own line, keeping its EOL;
    - a scalar value equal to a removed name becomes `key: []`; an absent key or no match returns `src` unchanged.
  - `frontmatter.insert_in_list(src, key, index, value) -> str`: the inverse, inserting `value` (encoded as `_encode_item` does, plain when safe) at `index` (clamped) in the list's own style; on `key: []` or an absent key it writes a flow list `key: [value]`.
  - `update_properties(path, {'collections': [...]}, base_version)`: validates each name against `collection_by_name` and the collection's `typeIds` (422 with the Global Constraints strings); writes each name as the collection's **current** name, deduplicated case-insensitively, keeping the form of an existing line; `[]` writes `collections: []` when the key exists, otherwise writes nothing.
  - `Space.create_object(type_id, title="", template_id=None, values=None)`: `values` go through the same encoder as `update_properties` and land in the creating write. After a template, `values` win; `collections` are merged with the template's.
  - Rename cascade in `save_collection`: for every object whose `collections:` resolves to this collection by its old name, `_rewrite_other` with `replace_in_value(src, 'collections', …)` replaces that item only. The old name is appended to `formerNames`. The cascade returns `rewritten` and `skipped`.
  - `Space.delete_collection(id, confirm) -> DeleteCollectionResult(trash_id, removed_from, skipped)`: 428 `{detail, affected}` without `confirm`, where `affected` = members only in this collection + members in others. With `confirm`, it does what Global Constraints says (removal with `remove_from_list`, the `before/<n>.md` copies, `{path, index, versionAfter}` entries, `skipped` for read-only or still-conflicting members). The manifest records every path it touched.
  - `Space.restore` (M2) of a collection entry, as Global Constraints says: 409 when a live collection now has the name or the id file exists; restores the object entries with this `collectionTrashId`; per `removedFrom` entry, writes back `before/<n>.md` when the file still has `versionAfter`, otherwise `insert_in_list` at `index` with the collection's name (both unstamped via `_rewrite_other`); a member that fails goes in `skipped`. It announces `collections` and a `changed` per rewritten member.
  - `TrashItem` gains `collectionTrashId?` (object entries), `collectionId?` and `name?` (collection entries); `GET /api/trash` lists collection entries with `kind: 'collection'`.
  - `purge_expired` and `purge(id)` also cover `trash/collections/` (the folder, its `before/` copies and its object entries). `JsonStore.new_id` for collections gets the ids held by `trash/collections/*/manifest.json` as `trash_ids`.
  - Routes `DELETE /api/collections/{id}`, and `POST /api/objects` with `values`.

- [ ] **Step 1: Write failing tests** (a tmp collection "Tooling" holding `server` and `page`)
  - `test_add_collection_changes_one_line`: `Servers/Alpha.md` has no `id` in the fixture, so the test first calls `space.ensure_id('Servers/Alpha.md')` (an unstamped write that only inserts `id:`) and snapshots the bytes after it. Adding Tooling then adds exactly `collections: [Tooling]` plus the `lastUpdated` change (difflib). A second case on a fixture copy without the `ensure_id` step expects the same two lines plus the `id:` line that `Space._write(stamp=True)` inserts first.
  - `test_remove_from_list_forms`: `remove_from_list` on `[Tooling, Other]`, `[Other, Tooling]`, `['Tooling']` (→ `[]`), a block list of two (one line gone) and of one (→ `collections: []`), a CRLF file; then `insert_in_list` at the returned index gives back the original bytes in each case where the list didn't become empty (an emptied list comes back as the flow list `[Tooling]`, which is why restore prefers the `before/` copy).
  - `test_collections_unknown_name_422`, `test_collections_wrong_type_422`
  - `test_collections_written_with_current_name`: sending "tooling" writes `Tooling`.
  - `test_rename_collection_rewrites_items_only`: members with `collections: [Tooling, Other]` and with block-list form both change only the `Tooling` item; nothing is stamped; `rewritten` lists both.
  - `test_rename_collection_crlf_and_quotes_kept`: on a CRLF member with `collections: ['Tooling']`, the result is `collections: ['Gear']\r\n` and every line still ends in CRLF.
  - `test_rename_conflict_skipped_untouched`: patch `_rewrite_other`'s read to conflict twice → the path is in `skipped` with its bytes unchanged; an object whose `collections:` still says `Tooling` resolves through `formerNames`.
  - `test_delete_collection_requires_confirm_428`: `affected` == 2 for one sole member plus one shared member.
  - `test_delete_collection_trashes_sole_members_only`: the sole member is in the trash with `collectionTrashId`; the shared member keeps its other collection and lost only the `Tooling` item.
  - `test_delete_collection_restore_byte_identical`: one shared member has `collections: [Tooling, Other]` (Tooling first). After restore, every touched file is byte-identical to before the delete (Tooling is first again), and `GET /api/collections` lists Tooling again.
  - `test_restore_after_member_edit_reinserts_at_index`: edit the shared member's body after the delete; restore puts `Tooling` back at index 0 and keeps the body edit.
  - `test_delete_collection_reports_skipped_member`: a shared member that is read-only (unparseable frontmatter) is returned in `skipped` with its reason, its bytes unchanged; the delete still succeeds.
  - `test_restore_refused_when_id_file_exists`: after delete, an externally created `.object/collections/tooling.json` with another name → restore 409, nothing changed; `new_id('Tooling')` while the entry is in the trash gives `tooling-2`.
  - `test_purge_expired_covers_collections`: a collection entry dated 31 days ago is purged on open, with its `before/` copies and object entries.
  - `test_create_object_with_values_single_write`: `POST /api/objects {typeId:'task', title:'X', values:{status:['Done'], collections:['Tooling']}}`, with Tooling extended to `task` → one created file containing both keys; one `created` event.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_membership.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `uv run pytest -q`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): collection membership, rename cascade and restorable delete`.

### Task 5: Queries (track: backend)

**Files:**
- Create: `queries.py`
- Modify: `space.py` (query methods, `purge_expired` scope), `trash.py` (query entries), `server.py`
- Test: `test_queries.py`

**Interfaces:**
- Consumes: Tasks 1 and 3.
- Produces:
  - `QueryDef.from_json`, `.to_json()` and `.to_api(revision)`. `definition` defaults to `{types: [], filterGroup: <empty and>, sorts: [], groupBy: None}`; `view` defaults to `{viewDefinition: {dataViewLayout: 'list'}}` and holds only `viewDefinition` and `showDataViewDetails` (any `filterGroup`/`sorts`/`groupBy` found in `view` are kept as unknown keys but never read). A file without `titleIsCustom` reads as `titleIsCustom = bool(name)`.
  - `Space.list_queries()`, `create_query(name=None, definition=None, view=None)` (an absent name is `"New Query"` with `titleIsCustom: false`; a given name sets it true), `save_query(q, base_revision)`, and `delete_query(id) -> trash_id`. Delete needs no confirm: it is restorable and touches no object.
  - Validation (422): every `types[].id` and `excludeTypeIds` entry is a known type id unless it was already in the stored version; `limit.size` is one of 1, 3, 5, 10, 25, 50; there are at most 5 search terms.
  - Routes per the contract. Trash restore re-creates `queries/<id>.json` under its original id, or returns 409 when that file exists (Global Constraints). `JsonStore.new_id` for queries gets the ids held in `trash/queries/` as `trash_ids`. `TrashItem` gains `queryId?` and `name?`.
  - `purge_expired` and `purge(id)` also cover `trash/queries/`.

- [ ] **Step 1: Write failing tests**
  - `test_create_query_writes_one_file_and_event`
  - `test_query_validation_422`: an unknown type id; `limit.size` 0 and 7; 6 search terms.
  - `test_save_query_revision_conflict`
  - `test_delete_query_restorable`: delete → a trash entry of kind `query` → restore → a byte-identical file at the same id.
  - `test_query_id_not_reused_while_trashed`: delete "Open tasks" → creating "Open tasks" again gets `open-tasks-2`; restoring the first gives back `open-tasks`; an externally created `open-tasks.json` makes restore 409.
  - `test_title_is_custom_inferred_on_load`: a file with `name: "Mine"` and no `titleIsCustom` → `true`; with `name: ""` → `false`.
  - `test_purge_expired_covers_queries`
  - `test_queries_not_in_objects`: `GET /api/objects` and `POST /api/rows` are unchanged by creating queries.
  - Extend `test_open_twice_writes_nothing` with `GET /api/queries`.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_queries.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `uv run pytest -q`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): saved queries`.

### Task 6: API client v3 and view model (track: frontend)

**Files:**
- Modify: `api/types.ts`, `api/client.ts`, `test/mockApi.ts`
- Create: `views/model.ts`
- Test: `api/client.m3.test.ts`, `views/model.test.ts`

**Interfaces:**
- Consumes: the API contract.
- Produces:
  - TS types for every contract shape. `TypeDef` gains typed optional `typeViews?`, `defaultViewType?: 'inline'|'smallCard'|'wideCard'|'embed'`, `smallCardViewConfig?: SmallCardViewConfig`. `ChangeKind` gains the four kinds.
  - `api` methods, each emitting local events like M2's: `rows(scope)`; `views(typeId)`, `saveViews(typeId, views, baseRevision)`; `collections()`, `createCollection(name, typeIds, icon?)`, `saveCollection(c, {baseRevision})`, `deleteCollection(id, {confirm})`; `queries()`, `createQuery(init?)`, `saveQuery(q, {baseRevision})`, `deleteQuery(id)`; `ui()`, `patchUi(patch, {baseRevision})` (throws `ConflictError` with `currentRevision` on 409); `createObject(typeId, {title?, templateId?, values?})`. `deleteCollection` returns `{trashId, removedFrom, skipped}`.
  - `mockApi` defaults for each, plus the builders `row(partial)`, `collection(partial)` and `query(partial)`.
  - `views/model.ts`:
    - `LAYOUTS`: key → `{label, icon, requiresGroupByEntity, hasSeparateBlocksGroup}`, with these values (`grid` is labelled "Gallery"; `gallery` has no label of its own because no picker offers it; ours is "Gallery strip", our string, used only in tooltips and tests).
    - `STANDARD_LAYOUTS = [list, grid, wall, table, embed]`, `FULL_VIEW_LAYOUTS = [...STANDARD_LAYOUTS, kanban]`, `ALL_NOTES_LAYOUTS = [list, grid, wall, embed]`. **None of the picker lists contains `gallery`**: it is set only by code for dashboard sections (Recently Opened, a collection's pinned items).
    - `emptyFilterGroup()`, `defaultViewState(type?)`, `defaultSmallCard(type) -> SmallCardViewConfig`. The card default is `[type, title, tags, computed_preview]`; for DailyNote it is `type`, `title` plus the type's first four non-system properties.
    - `CARD_WIDTH = {phone: 168, desktop: 208}` (the gallery strip's card widths), `CARD_GAP = 12` (px, `gap-3`), and `columnCount(width, minCardWidth = 224)`, computed as: `width <= 0` → 1, otherwise `min(10, max(1, floor((width + 12) / (minCardWidth + 12))))`. Floor (cards never overflow), capped at 10 columns.
    - `MIN_ROW_HEIGHT`, `LOAD_PAGE = 50`.

- [ ] **Step 1: Write failing tests**
  - `test saveCollection emits local collections event with own origin`
  - `test rows posts scope and returns rows`
  - `test createObject sends values`
  - `test patchUi sends baseRevision and emits ui event; 409 throws ConflictError`
  - `test LAYOUTS labels and icons match the catalog`: `grid` → "Gallery" / `ph-grid-four`; `wall` → `ph-wall`; `table` → `ph-table`; no picker list contains `gallery`.
  - `test columnCount`: 0 → 1, 216 → 1 (`floor(228/236)`, clamped), 236 → 1, 472 → 2, 1000 → 4 (`floor(1012/236)`), 3000 → 10 (capped); with `minCardWidth` 168: 360 → 2.
  - `test defaultSmallCard common and daily note`
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/api src/views/model.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(api): views, collections, queries and rows client`.

### Task 7: Filter and sort engine (track: frontend)

**Files:**
- Create: `views/dates.ts`, `views/filter.ts`, `views/sort.ts`
- Test: `views/filter.test.ts`, `views/sort.test.ts`, `views/dates.test.ts`

**Interfaces:**
- Consumes: Task 6; `propertyIsEmpty` (M2 `properties/format.ts`).
- Produces:
  - `FILTER_OPTIONS: Record<PropertyType, {key, label}[]>`, exactly this operator list per kind, in this order and with these labels ("includes", "does not include", "is", "is not", "starts with", "ends with", "is empty", "is not empty"; number "=", "≠", "≥", ">", "≤", "<"; boolean "is selected" / "is not selected"; entity_type "is" / "is not"; dates "is", "is before", …, "ends on or after"). Date options: `start*`/`end*` only when `constraints.endTimeSettings !== 'notAllowed'`; `isRecurring`/`hasReminder` are omitted until M4; `blocks` and `simpleTableBlock` get only the two empty options.
  - `DATE_RELATIVE_OPTIONS`, in this order with these labels: "overdue", "today", …, "in one month", "Specific date".
  - `resolveRelative(rel, now: Date) -> {start: Date, end: Date}`. Weeks run Monday to Sunday, as M2's templates do. `overdue` means before today.
  - `rowValue(row, propertyId) -> unknown` (`title`, `type`, `collections` and the other system ids map to summary fields).
  - `filterIsValid(filter, typesById) -> boolean`, `matchFilter(row, filter, ctx) -> boolean`, `matchGroup(row, group, ctx) -> boolean`, `applyFilters(rows, group, ctx) -> Row[]`, with `ctx = {types, collections, tagIdsToTitles, now}`. An invalid filter passes; an empty group passes; text is compared case-insensitively; a text-kind filter with option `contains`, `notContains`, `is`, `isNot`, `startsWith` or `endsWith` whose `referenceValue` is missing or `''` passes every row (`isEmpty`/`isNotEmpty` ignore the reference value); the `title` filter compares against the display title (the summary title, or the type's untitled fallback that the UI shows when the title is empty); a filter with a `typeId` applies only to rows of that type (other rows pass it); `textBlock` matches the first paragraph of its value; collections compare by resolved collection id; a date range value matches `is` when the reference day falls within the range.
  - `SORT_OPTIONS(kind)`: dates get "Oldest first", "Newest first", "is empty first", "is empty last"; `entity_type` is not sortable; everything else gets "ascending" / "descending".
  - `applySorts(rows, sorts, ctx) -> Row[]`: stable, applied in order. The final fallback is `createdAt` newest first. Empty values go last in `ascending` and `descending` order. `ascendingExists` ("is empty first") and `descendingExists` ("is empty last") sort by emptiness only: empties first or last respectively, and rows within each part keep the order given by the next sort (or the fallback). Text uses `localeCompare(…, {numeric: true, sensitivity: 'base'})`, labels use option order, and entities use the first title.

- [ ] **Step 1: Write failing tests** (`now = 2026-10-23T12:00 local`)
  - `test operator table per kind`: snapshot of `FILTER_OPTIONS` keys and labels for text, number, boolean, label, entity, entity_type, entity_aliases, entity_icon and datetime.
  - `test nested and/or groups`: `a AND (b OR c)` over 4 rows → the 2 expected paths.
  - `test empty group passes`
  - `test filter on deleted property is ignored`: also a filter whose option no longer exists.
  - `test typeId scopes filter to one type`
  - `test text contains is case-insensitive; startsWith/endsWith; isEmpty on null and ''`
  - `test text filters with empty reference value pass every row`: for each of `contains`, `notContains`, `is`, `isNot`, `startsWith`, `endsWith`, with `referenceValue` `''` and absent, every row (including rows with an empty value) passes.
  - `test title filter uses display title`: an untitled row matches `title is` the untitled fallback text.
  - `test label contains by option id; notContains true for empty`
  - `test number operators`
  - `test relative dates against fixed now`: `today`, `thisWeek` (2026-10-19 to 10-25), `overdue`, `inOneWeek`, and `exactDate` with `isOnOrBefore`.
  - `test date range value matches is when the day is inside`
  - `test collections contains by id via former name`
  - `test sort fallback createdAt newest first`
  - `test sort empty last; ascendingExists empty first; descendingExists empty last keeping fallback order`
  - `test label sort follows option order`
  - `test numeric-aware title sort`: "Item 2" sorts before "Item 10".
- [ ] **Step 2:** Run `npx vitest run src/views`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces. These are pure functions with no React.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(views): filter and sort engine with the specified operators`.

### Task 8: Group-by and calculations (track: frontend)

**Files:**
- Create: `views/group.ts`, `views/calc.ts`
- Test: `views/group.test.ts`, `views/calc.test.ts`

**Interfaces:**
- Consumes: Task 7.
- Produces:
  - `GROUP_OPTIONS(kind)`: textBlock: "By Text" / "By Linked Objects"; number: "By Exact Value" / "By Range"; dates: "By Hour", "By Day", "By Week", "By Month", "By Year", "Relative" ("Scheduled" comes in M4); every other groupable kind: `default`; not groupable: `blocks`, `simpleTableBlock`, `entity_createdAt` with `default`.
  - `GROUP_SORT_OPTIONS(kind)`: everything gets "default", "ascending", "descending", "smallest first", "largest first", "manual"; label adds "Order" and "Order inverse"; entity adds "Created oldest first" and "Created newest first"; the first option is the default. `manual` has no label of its own (it is set implicitly when groups are dragged); ours is "Manual" (our string), shown checked once groups have been reordered.
  - `Group { id, label, rows: Row[], color?, icon?, isOther? }`
  - `groupRows(rows, groupBy, config, ctx) -> {groups: Group[], hidden: Group[]}`:
    - Label: one group per option in option order, plus "Other".
    - Boolean: groups with ids `true`/`false`, labelled "Checked" / "Unchecked".
    - Entity, tags and collections: one group per linked object. A row with several values is in several groups. (Every resolvable collection makes a group; there is no default collection in M3.)
    - entity_type: one group per type.
    - Text: the exact text, cut at 500 characters.
    - Number range: `min`, `max`, `step` (default 1). Values outside the range get no group.
    - Dates: the bucket labels "Today", "Yesterday", "Tomorrow", "This week", "Last week", "Next week", "Overdue", "Earlier", "The day after tomorrow", "The day before yesterday", or the period label.
    - **"Other"** (no value) comes last, or first when the property is a status label.
    - `config.groups[].isHidden`/`isClosed`, `hideByDefault` (unknown groups are hidden), `hideEmptyGroups` (label options with no rows are dropped), and the `manual` order from `config.groups`.
  - `CALC_KINDS(kind)` and `CALC_LABELS` (full and short), per kind. Blocks get none.
  - `calculate(rows, propertyId, kind, ctx) -> {value: number|string|null, display: string}`:
    - `countValues` sums every value in multi-value cells; `countUnique` counts the distinct set.
    - `checked` = `countNotEmpty`; percentages are relative to the row count and shown with 0–1 decimal and "%".
    - Median uses the midpoint of the two middle values.
    - Number results use the property's number format (M2 `formatNumber`).
    - `dateRange` shows the largest unit that fits ("{n} year(s)", "month(s)", "day(s)", "hour(s)", "minute(s)"; 30-day months, 365-day years).
  - `valueForGroup(groupBy, group, def) -> {key, value}|null`: the update that moves a row into `group`. It returns null for `createdAt`, `lastUpdated`, `type`, number ranges and date periods (kanban drag is disabled there).

- [ ] **Step 1: Write failing tests**
  - `test label groups in option order with Other last`
  - `test Other group last except status first`
  - `test multi-value entity row appears in each group`
  - `test boolean groups labelled Checked and Unchecked`
  - `test number range groups drop out-of-range`: min 0, max 10, step 5 → `0–5`, `5–10`; 12 is in no group.
  - `test date Relative buckets against fixed now`
  - `test hideEmptyGroups drops empty label options`; `test hideByDefault hides unknown groups`
  - `test manual group order`
  - `test sizeDescending orders by count`
  - `test countValues sums multi-value cells`: rows `[A,B]`, `[A]`, `[]` → 3; `countUnique` → 2; `percentEmpty` → "33.3%".
  - `test median and date range duration`: `[1,3,10,20]` → 6.5; 2026-01-01 → 2026-03-15 is "2 months".
  - `test boolean calc kinds limited to five`
  - `test valueForGroup label gives option text and null for createdAt`
- [ ] **Step 2:** Run `npx vitest run src/views`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(views): group-by with customization and column calculations`.

### Task 9: DataView, toolbar and editors, list layout (track: frontend)

**Files:**
- Create: `views/{useRows.ts,useViewState.ts,DataView.tsx,Toolbar.tsx,FilterEditor.tsx,SortEditor.tsx,GroupEditor.tsx,CustomizeMenu.tsx,ViewSummary.tsx,matching.ts}`, `views/layouts/ListLayout.tsx`, `views/cards/InlineToken.tsx`
- Test: `views/DataView.test.tsx`, `views/FilterEditor.test.tsx`, `views/matching.test.ts`

**Interfaces:**
- Consumes: Tasks 6–8; `usePeek`, `useLinkIndex`, `fuzzyMatch`, `LabelMenu`, `RelationPicker`, `DatePicker`.
- Produces:
  - `useRows(scope) -> {rows, loading, reload, patchRow(path, row)}`. Events are batched in one 150 ms debounce window:
    - any `created`, `deleted`, `renamed`, `types` or `collections` event in the window → one full reload (value shapes and collection-name resolution may have changed);
    - otherwise the `changed` paths seen in the window are coalesced into **one** `api.rows({...scope, paths})` call, merged into the current rows (a requested path the scoped call no longer returns is dropped);
    - other kinds (`queries`, `views`, `ui`) are ignored.
  - `useViewState(initial, save: (next) => Promise<void>) -> [state, update]`: optimistic, with saves debounced 400 ms. On a 409 from the save, it refetches, re-applies the same patch once, and saves again.
  - `<DataView rows types scope state onState layouts allowCreate? onCreate? heading? compact? pipeline? pausedHint? />`:
    - Runs `applyFilters` → `applySorts` → `groupRows`, or the caller's `pipeline(rows, state)` when given (QueryPage passes `runQuery`). With `pausedHint`, the Filter and Sort buttons are dimmed (still editable) with that text as tooltip, and `ViewSummary` shows it.
    - Renders the toolbar pill, right-aligned, left to right: the count, with the tooltip "N entries" / "1 entry" (our strings; the pill shows the bare number); Filter (`ph-funnel-simple`, highlighted when active), Sort (`ph-sort-ascending`), "Group by" (`ph-square-split-vertical`); the layout picker: the active icon plus a caret, a menu headed "Layout" with checked items, offering only `layouts`; "Customize view" (`ph-sliders-horizontal`).
    - The toolbar collapses the layout picker into Customize when it is narrower than 480 px.
    - "Show details" / "Hide details" toggles `ViewSummary` ("Filtered by …", "Sorted by …", "Grouped by …").
    - Groups render as collapsible headers with counts (`isClosed` persisted).
    - "Load more" (no count) pages by `LOAD_PAGE`.
    - Shows "Loading results…" while loading, and the empty state "There's nothing here (yet)." / "Create an object to fill it." with "Create {name}".
    - Clicking an item peeks it with the view's current order as the pager list; Ctrl+click opens a new tab.
  - `<FilterEditor>`:
    - Row 0 is labelled "where", row 1 has the `and`/`or` dropdown, and rows 2+ have a static chip.
    - Each row has a property picker, an operator picker, and a value editor per kind (text input, number input, LabelMenu multi, RelationPicker multi, a type multi-select, a collection multi-select, a date relative list plus "Specific date").
    - The `ph-dots-three-bold` menu has "Turn into group", "Ungroup" and "Remove". It is shown at depth ≤ 1.
    - "+ Filter" (the first eligible property) and "+ Filter group" (a group with two filters).
    - Removing the last filter of a nested group ungroups it.
    - An invalid filter shows "Invalid" / "Will be ignored". With no eligible property it shows "No eligible properties available".
  - `<SortEditor>`: "Add sort", "No sort", per-row option and "Move to top".
  - `<GroupEditor>`: the property, the option, "Sort groups by", the number range fields ("Group range", "Min", "Max", "Group every").
  - `<CustomizeMenu>` (w-64): Table ▸ (Task 10), Card view ▸ (Task 11), Groups ▸ ("Customize groups": "Visible groups", "Hidden groups", "Show all groups", "Hide all groups", "Hide new groups", "Hide empty groups"), Calculations ▸ ("Add calculation").
  - `matchingValues(filterGroup, types, typeId) -> {key: value}` (a new object matches the active filter): it reads only top-level filters under `and`, or a single-element `or`; text `is`/`contains`/`startsWith` sets the text; boolean `isChecked` sets true; label and entity `contains` add the first reference; `collections` contains adds the names; number `equal` sets it; date `is` sets the day; any other filter contributes nothing.
  - `<ListLayout>`: rows of `InlineToken` (icon + title, a type chip when the view spans types), 40 px minimum height.
  - `<InlineToken row />`: the linkToken (inline) view of an object.

- [ ] **Step 1: Write failing tests** (mockApi rows over two types)
  - `test toolbar shows count and tooltips`
  - `test filter popover adds filter and narrows rows`: "+ Filter" → title contains "alp" → 2 rows; `onState` called with the filter.
  - `test second row shows and/or dropdown that sets group operator`
  - `test turn into group then remove last nested filter ungroups`
  - `test invalid filter shown as Will be ignored`
  - `test sort Newest first reorders`
  - `test group by label renders headers with counts and collapse persists isClosed`
  - `test load more pages by 50`
  - `test empty state Create calls onCreate`
  - `test click peeks with view order as pager list`
  - `test useRows patches only the changed path`
  - `test useRows coalesces changed paths into one rows call`: three `changed` events within 150 ms (as from a collection rename) → exactly one `api.rows({paths:[a,b,c]})`.
  - `test useRows reloads on types and collections events`: one `types` event → one full `api.rows(scope)`; a `views` event → no call.
  - `test useViewState 409 refetches and reapplies once`
  - `test matchingValues from and-group`: status contains Done + done isChecked → `{status:['Done'], done:true}`; an `or` group of two gives `{}`.
- [ ] **Step 2:** Run `npx vitest run src/views`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces. Width follows `.main-content-width` (50rem) when embedded and `.wide-content-width` on a full page.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(views): data view with toolbar, filter, sort and group editors`.

### Task 10: Table layout (track: frontend)

**Files:**
- Create: `views/table/{TableLayout.tsx,ColumnMenu.tsx,CalcFooter.tsx,tableConfig.ts}`
- Modify: `properties/cells/types.ts` (`CellProps.density?: 'panel'|'table'`), the cells that need a compact rendering for `density='table'` (text truncation, a single-line label row, smaller pills), `views/CustomizeMenu.tsx` (Table ▸)
- Test: `views/table/tableConfig.test.ts`, `views/table/TableLayout.test.tsx`

**Interfaces:**
- Consumes: Tasks 6–9; `cellForDef`, `cellValue`, `PropertyMenu` (M2 Task 16, for "Edit Property").
- Produces:
  - `DEFAULT_COL_WIDTH`: text 13, textBlock 16, entity 12, entity_tags 10, entity_title 10, entity_description 16, url 16, label 12, entity_collections 10 (`collections_property`), everything else 12. A property's `tableColWidth` overrides the default.
  - **Column ids.** `TableColumn.id`, like `Filter.propertyId`, `Sort.propertyId` and `calculations[].propertyId`, is the property **key** (the frontmatter key, e.g. `status`, and the system ids `title`, `tags`, `collections`, `createdAt`…). M2's separate `PropertyDef.id` is never stored in view definitions; columns are matched to definitions by key, so a key rename (M2's cascade) is seen as delete + add.
  - `normalizeTableConfig(type, config?) -> TableViewConfig`: `wrapAllContent` defaults to true; new properties are appended; deleted ones are pruned; a missing or non-numeric `colWidth` takes the property's `tableColWidth`, else `DEFAULT_COL_WIDTH` for its kind; any width is then clamped to 2–50 rem; the title column can't be hidden and comes first.
  - `<TableLayout>`:
    - One type only. A view spanning several types shows "A table needs a single object type."
    - Header cells resize by drag (rem, with a live preview, saved on release) and reorder by drag (dnd-kit).
    - Columns up to `pinnedColumnIndex` are `position: sticky` on the left.
    - Hidden columns are left out, and `wrapContent` (or `wrapAllContent`) switches truncation.
    - Group headers span the row. The `CalcFooter` shows `CALC_LABELS` short label + value per column, and an empty column offers "Calculate" on hover.
    - Rows are 36 px minimum height.
  - `<ColumnMenu>` (the header click): "Sort" (`ph-sort-ascending`), "Filter" (`ph-funnel-simple`), "Calculate" (`ph-sigma`) ▸ kinds, "Hide", "Wrap Text" / "Unwrap Text", "Pin Columns" / "Unpin cClumns" (the shipped string, typo kept), "Edit Property" (opens M2's PropertyMenu).
  - Customize ▸ Table: "Property visibility" ("Shown in table" / "Hidden in table", "Show all in table" / "Hide all in table") and "Text wrapping" ("Wrap all" / "Wrap none").
  - **Inline edit:**
    - Each cell is `cellForDef(def)` with `density='table'`. `onChange` calls `api.updateProperties(row.path, {key: v}, row.version)`, then `patchRow` with the returned version and frontmatter-derived values.
    - On `ConflictError` it reloads that row (`api.rows({paths})`), never retries, and shows the toast "Changed elsewhere. Reloaded." (our string).
    - A read-only row renders read-only cells.
    - A new label option goes through `useTypeEditor` first, as in the M2 panel.
    - The title cell renames through `api.renameObject`.

- [ ] **Step 1: Write failing tests**
  - `test normalize appends new and prunes deleted columns, title unhideable`
  - `test width clamped and default widths per kind`: a column without `colWidth` gets its kind's default (or `tableColWidth`), never 50; 1 → 2, 80 → 50.
  - `test multiple types shows refusal text`
  - `test drag resize saves colWidth in rem on release`
  - `test pinned column is sticky`
  - `test Hide removes column and Show all in table restores`
  - `test Wrap none truncates cells`
  - `test calc footer shows Sum with number format`
  - `test cell edit sends row version and patches row`
  - `test 409 on cell edit reloads row without retry`
  - `test title cell rename calls renameObject`
- [ ] **Step 2:** Run `npx vitest run src/views/table src/properties`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(views): table layout with resize, pin, hide, wrap, calculations and inline edit`.

### Task 11: Cards and the card layouts (grid, wall, gallery, embed, kanban) (track: frontend)

**Files:**
- Create: `views/cards/{ObjectCard,SmallCard,WideCard,EmbedCard}.tsx`, `views/cards/cardConfig.ts`, `views/layouts/{GridLayout,WallLayout,GalleryLayout,EmbedLayout,KanbanLayout}.tsx`
- Modify: `views/CustomizeMenu.tsx` (Card view ▸), `views/DataView.tsx` (layout switch)
- Test: `views/cards/cardConfig.test.ts`, `views/layouts/layouts.test.tsx`, `views/layouts/KanbanLayout.test.tsx`

**Interfaces:**
- Consumes: Tasks 6–10; `api.fileUrl`, `LabelPill`, `tagStyle`, `ObjectIcon`, M1 `Editor` (`readOnly`).
- Produces:
  - `cardProperties(type, view?) -> {propertyType, propertyId}[]`: the view's `smallCardViewConfigs[typeId]` when set ("Use default" off), otherwise `type.smallCardViewConfig`, otherwise `defaultSmallCard(type)`.
  - `<SmallCard row type props />` (`.preview-card-base` + `.preview-card-core`: radius-xl, a 1 px front border, the layered shadow, `:active` brightness 1.02): the type label (icon + name); the cover image or media `previewImage`; the title (bold, 2 lines); each configured property as a compact read-only cell; `computed_preview` as 4 muted lines; empty tags and collections show the placeholders "Tags" / "Collections".
  - `<WideCard>`: a horizontal card (image left, title, preview, properties).
  - `<EmbedCard>`: the header plus the body rendered with the read-only Editor, fetched lazily (`api.object`) when visible (IntersectionObserver).
  - `<ObjectCard view='inline'|'smallCard'|'wideCard'|'embed'>`: the dispatcher used by layouts now and by object blocks in M7.
  - **Layouts:**
    - `grid`: a CSS grid with `columnCount` columns and `gap-3`, using small cards.
    - `wall`: masonry, N flex columns of `flex-col gap-y-3`, with cards dealt round-robin by index.
    - `gallery`: one horizontally scrolling strip of `CARD_WIDTH` cards (208 px, 168 px below the phone breakpoint). Rendered only for dashboard sections; no layout picker offers it.
    - `embed`: a stack of EmbedCards.
    - `kanban`:
      - one column per group (the view's groupBy, defaulting to the first label property, "Other" included), horizontally scrolling
      - cards drag between columns with dnd-kit; a drop calls `api.updateProperties` with `valueForGroup` and the row's version (409 → reload row)
      - columns whose `valueForGroup` is null don't accept drops
      - a "+" at the end of each column creates an object with `matchingValues` merged with the group's value (`api.createObject(typeId, {values})`), then peeks it
      - grouping a Task by status hides the status pill on cards
  - Customize ▸ Card view, per type: a "Use default" switch (turning it off copies the type default into `smallCardViewConfigs`), a gear for "Open settings" (opens Type Settings), and "Selected Properties" (sortable, removable) / "Add Properties" ("No further properties available").

- [ ] **Step 1: Write failing tests**
  - `test cardProperties prefers view override then type then default`
  - `test small card shows type label, title, tags and preview`
  - `test grid uses columnCount columns`
  - `test wall deals cards round-robin into columns`
  - `test gallery is single horizontal strip`
  - `test embed card loads body when visible`
  - `test kanban columns follow label option order plus Other`
  - `test kanban drop writes matching label`: dragging from "Not Started" to "Done" → `updateProperties(path, {status:['Done']}, version)`.
  - `test kanban drop on createdAt grouping disabled`
  - `test create from filtered view prefills matching values`: a view filtered on `done isChecked`, "+" in the "Done" column → `createObject('task', {values:{done:true, status:['Done']}})`.
  - `test Use default off copies type default into view`
- [ ] **Step 2:** Run `npx vitest run src/views`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(views): cards, grid, wall, gallery, embed and kanban layouts`.

### Task 12: Type page Overview/All and card settings (track: frontend; after M2 Task 19)

**Files:**
- Create: `types/{TypeOverview.tsx,dashboardSections.ts,queryRecommendations.ts,CardViewSettings.tsx}`, `nav/recent.ts`
- Modify: `types/TypePage.tsx` (rewritten around DataView, keeping M2's "New" split button), `types/TypeSettings.tsx` (adds the "Card view and linking" group), `create/createAndOpen.ts` (M2 Task 19: accepts `values`), `nav/tabs.ts` (`Target` adds `{kind:'collection', id}`, `{kind:'query', id}`, `{kind:'queries'}` and `{kind:'allNotes'}`, so later tasks only fill in pages), `App.tsx` (`TabLabel` and content branches for the four targets, rendering a muted "Loading results…" placeholder until Tasks 13–15 replace them)
- Test: `types/TypePage.test.tsx`, `types/dashboardSections.test.ts`, `types/queryRecommendations.test.ts`, `types/CardViewSettings.test.tsx`, a new case in `create/NewObjectMenu.test.tsx`

**Interfaces:**
- Consumes: Tasks 6–11; `api.views`/`saveViews`; `useTypeEditor`; M2 `createAndOpen`.
- Produces:
  - `createAndOpen(typeId, {title?, templateId?, values?}, mods)`: M2's function, extended to pass `values` through to `api.createObject`; everything else (modifiers, Tasks in the peek) is unchanged. `NewObjectMenu` keeps calling it without `values`.
  - `useRecent` (zustand, persisted to localStorage, max 50): fed by `useTabs.open` and `usePeek.peek` for objects. This is a per-viewer convenience.
  - `<TypePage type>`:
    - **Header** (`.dataview-heading`, 22 px bold / 20 px on desktop): the icon tile (2 rem box), the plural name, a "Search title..." field, `…` ("Create collection", disabled until Task 13 wires it; "Object Type Settings" and "Delete object type" from M2), and M2's "New" split button.
    - **"Search title..."** filters **client-side**: a case-insensitive substring match on the title and aliases of the rows already loaded for the active tab, applied before the view's filters. It never calls `api.rows`, isn't saved, has no minimum length, and clears when the tab changes.
    - **Tabs** (left to right, the active one a filled pill, saved to `activeTab`): "Overview" (`ph-layout`), "All" (`ph-list-bullets`), then one tab per **visible full-view section** in the saved section order: `inNoCollection` ("Not in any collection", `ph-placeholder`), `notTagged` ("Not tagged", `ph-tag`), each `query:<id>` (the query's icon and title) and each `collection:<id>` (the collection's icon and name). A section's `title`, when set, replaces its label. Each section tab renders that section's DataView full-width with `FULL_VIEW_LAYOUTS`, its `viewDefinition` saved in the section.
    - **Section tab menu** (right-click or the tab's caret): "Open" (`ph-arrows-out-simple`; opens the query or collection page; absent for built-in sections), "Rename" (`ph-pencil-simple`; sets the section's `title`), "Pin to sidebar" / "Unpin from space" (`ph-push-pin`; queries and collections; Task 15 wires it), "Remove" (`ph-x`; moves the key to `removedSections`, which removes both the Overview section and the tab) and, for queries and collections, "Delete" (their own delete flow; Tasks 13 and 14 wire it, it is hidden until then).
    - **All:** a DataView over `api.rows({typeIds:[type.id]})` with `FULL_VIEW_LAYOUTS`, state saved to `.object/views/<id>.json`. Its `…` adds "Save as query", which creates a query with this type and the current filters/sorts/groupBy and opens it.
    - **New** from the All tab calls `createAndOpen(type.id, {values: matchingValues(...)}, mods)` with the view's filters.
  - `buildSections(type, views, ctx) -> RenderedSection[]` (visible, hidden, empty state; each with `inFullView` derived from its kind as in the contract), in the saved order. Sections not yet in `dashboard.sections` (a `collection:<id>` for each collection holding the type, unless in `removedSections`) are appended at the end. Task 12 reads collections and queries with `api.collections()` / `api.queries()` (reloaded on `collections` / `queries` events); Tasks 13 and 14 swap in `useCollections` / `useQueries`:
    - `recentlyAccessed` ("Recently Opened", `ph-clock-clockwise`, gallery layout of up to 10 recent objects of the type; empty "No recently accessed content" / "Recently opened objects show up here.")
    - `collections` ("Collections": a grid of the type's collections; empty "No collections" / "Make a collection to fill it." with "Create collection")
    - `queries` ("Queries": queries whose `types` include the type; empty "No queries" / "Saved queries show up here." with "Create query")
    - `inNoCollection` ("Not in any collection", `ph-placeholder`)
    - `notTagged` ("Not tagged", `ph-tag`), only when the type has tags
    - `query:<id>` (a pinned query: its title and its own view)
    - `collection:<id>` (a collection holding the type: its name and its All view's rows)
    - `noBacklinks` is not offered until M5
    - Each section can collapse and has "Open all" (switch to the section's own tab when it is full-view, otherwise open the All tab with the equivalent filter, where one exists) and "View all {name}".
  - "Customize Overview" menu: "Visible Sections" / "Hidden Sections", "Add a section" (the removed built-ins, the type's collections and the queries of the type: "Queries & Views"), and drag reorder. Entries of dashboard-only sections are suffixed " (Overview only)".
  - `queryRecommendations(type) -> {title, definition, layout}[]`, shown as "Query Recommendations" when the Overview has no query sections: "Kanban by {propertyName}" for each label property; "Filter {propertyName} is empty"; "Filter {propertyName} by" with one item per option, titled "Type · Property · Option"; for booleans, "Checked" / "Unchecked"; picking one creates the query.
  - `<CardViewSettings typeId>` inside Type Settings' "Card view and linking" group:
    - "Default link view" ("How an object of this type looks when it is embedded as a block.") with Link block / Small card / Wide card / Embed → `defaultViewType`.
    - "Default card view" ("Which properties a small card of this type shows by default.") with Selected / Add Properties and a live SmallCard preview → `smallCardViewConfig`.
    - Saved through `useTypeEditor`.

- [ ] **Step 1: Write failing tests**
  - `test tabs Overview and All persist activeTab via saveViews`
  - `test All tab renders DataView with full layouts including kanban and no gallery`
  - `test full-view sections become header tabs`: a `query:<id>` section, a collection of the type and `notTagged` give three extra tabs after All; `recentlyAccessed`, `collections` and `queries` give none.
  - `test section tab menu Rename sets title and Remove moves key to removedSections`
  - `test Customize Overview marks dashboard-only sections (Overview only)`
  - `test New split button from M2 still lists templates`
  - `test New on filtered All tab passes matching values`: `createAndOpen` receives `values`, and `api.createObject` is called with them.
  - `test Save as query creates query with type and filters and opens it`
  - `test buildSections default order and notTagged only with tags`
  - `test recently opened shows only this type in a gallery strip`
  - `test hidden section moves to Hidden Sections and back`
  - `test queryRecommendations for a label and a boolean property`
  - `test CardViewSettings writes defaultViewType and smallCardViewConfig`
  - `test search title filters the All view client-side`: typing "a" narrows the rows with no `api.rows` call.
  - `test collection, query, queries and allNotes targets open, go back and show tab labels`
- [ ] **Step 2:** Run `npx vitest run src/types src/nav src/create`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(types): type page Overview and All, dashboard sections, card view settings`.

### Task 13: Collections UI (track: frontend; after M2 Task 19)

**Files:**
- Create: `collections/{CollectionPage.tsx,CollectionDialogs.tsx,CollectionPicker.tsx,useCollections.ts}`
- Modify: `properties/cells/SystemFieldCell.tsx` (`CollectionsCell` becomes live), `object/ObjectView.tsx` (the `…` menu adds "Edit Collections"), `types/TypePage.tsx` and `types/TypeOverview.tsx` (wire "Create collection" and the collection tabs' "Delete"), `App.tsx` (the `collection` branch renders CollectionPage)
- Test: `collections/CollectionPage.test.tsx`, `collections/CollectionPicker.test.tsx`, `collections/CollectionDialogs.test.tsx`

**Interfaces:**
- Consumes: Tasks 6–12.
- Produces:
  - `useCollections() -> {collections, byId, byName(name), reload}`: zustand, reloaded on `collections` events.
  - `<CollectionPicker value: string[] typeId onChange>`: search placeholder "Search collections or create one"; lists only collections holding `typeId`; "Create '{q}'" calls `createCollection(q, [typeId])`, then selects it; the multi-select summary reads "No Collection" / "{n} Collection" / "{n} Collections".
  - `CollectionsCell`: chips, plus the picker (writes `collections` through the M2 panel's `onChange`).
  - `<CollectionPage id>`:
    - The header: the icon (IconPicker) and name (editable inline; a rename saves through `saveCollection` and reports `skipped` as M2 does), `…`, and "New" (`createAndOpen(typeId, {values: {collections: [name]}, templateId: the collection's defaultTemplateId, else the type default}, mods)`, using Task 12's `values` extension).
    - The tabs: "Overview" (`ph-layout`), "All", then a tab per `query:<id>` section (same tab menu as Task 12). **Overview:** the sections of `views.dashboard`, defaulting to Task 3's `[pinned]`: the `pinned` section (a gallery of pinned objects; each card's menu has "Pin to collection" / "Unpin", our strings) and any `query:<id>` sections. "Customize Overview" offers "Add a section" with the space's queries (adding `query:<id>`), hide and reorder, as on type pages. **All:** a DataView over `api.rows({collectionIds:[id]})` with `FULL_VIEW_LAYOUTS` (no gallery); table only when the collection holds one type.
    - "Add existing" (a fuzzy object picker over the collection's types, writing `collections` on the picked object) and "Create entry".
    - The empty state "Nothing in this collection yet. Add a new entry or an existing object."
    - `…` holds: "Rename", "Icon", "Types" (edit `typeIds`), "Templates" (the type templates, "Mark as Default" for this collection), "Pin to sidebar" (Task 15), "Delete collection".
  - Removing an item from the card or row menu "Remove from collection" opens "Remove from collection?" / "Take it out of this collection, or delete it entirely below." with "Remove from collection" and "Delete {count} object(s)" (the latter through M2's delete, to the Trash).
  - `<DeleteCollectionDialog>`: a delete confirmation title; body: the rule above, plus "Everything moves to the Trash, where you can restore it for 30 days."; it calls `deleteCollection(id, {confirm: true})` after the 428 count is shown. When the result's `skipped` is non-empty it shows the toast "{n} object(s) couldn't be updated and still list this collection." (our string) naming the paths.
  - `<CreateCollectionDialog typeId?>`: "Create collection", with its tooltip text, the name defaulting to "New Collection".

- [ ] **Step 1: Write failing tests**
  - `test picker lists only collections of the type and creates on Create`
  - `test CollectionsCell writes names through onChange`
  - `test collection page All tab loads rows by collectionIds`
  - `test New in collection passes collections value and collection default template`
  - `test Add existing writes collections on picked object with its version`
  - `test rename saves with baseRevision and shows skipped count`
  - `test remove from collection dialog offers remove and delete`
  - `test delete dialog shows affected count then confirms`
  - `test delete reports skipped members`
  - `test collection Overview defaults to pinned and Add a section adds a query section`
  - `test table refused when collection holds two types`
- [ ] **Step 2:** Run `npx vitest run src/collections src/properties`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(collections): collection pages, membership picker and dialogs`.

### Task 14: Queries UI (track: frontend; after M2 Task 19)

**Files:**
- Create: `queries/{QueryPage.tsx,QueriesPage.tsx,QueryBuilder.tsx,autoTitle.ts,runQuery.ts,useQueries.ts}`
- Modify: `App.tsx` (the `query` and `queries` branches render QueryPage and QueriesPage), `shell/Sidebar.tsx` (the "Queries" entry), `types/TypePage.tsx` (the query tabs' "Delete")
- Test: `queries/runQuery.test.ts`, `queries/autoTitle.test.ts`, `queries/QueryPage.test.tsx`, `queries/QueriesPage.test.tsx`

**Interfaces:**
- Consumes: Tasks 6–13.
- Produces:
  - `useQueries()`, like `useCollections`.
  - `queryScope(def) -> RowsScope`: the query's type ids when any are set; otherwise all types minus `excludeTypeIds` (exclusion only applies with no types selected, and only when a search term or tag is set, matching the builder's hints); plus the search terms and mode.
  - `isQueryReady(def) -> boolean`: a search term, a tag or a type is set.
  - `isSearching(def) -> boolean`: at least one search term.
  - `runQuery(def, rows, ctx, rng = Math.random) -> {rows, groups, paused: boolean}`, which applies, in order:
    1. per type entry: `collectionIds` / `excludeCollectionIds` / `inAnyCollection` / `inNoCollection`
    2. tags: each tag id compiles to a filter `tags contains`, joined with the operator
    3. `excludeTags`, only when a search term or an included tag is set (otherwise ignored, as the disabled builder control says)
    4. when **not** searching: `filterGroup` (ANDed with step 2) through `applyFilters`, then `applySorts(def.sorts)`. When searching, the property filters and sorts **pause** (the builder says so in a hint): step 2's tag filter still applies, `filterGroup` doesn't, and the order is `applySorts(rows, [])` (the createdAt fallback); `paused` is true. The stored `filterGroup`/`sorts` are kept unchanged.
    5. `limit` (first N, or random N through `rng`), only when there is no groupBy
    6. `groupRows`
  - `autoTitle(def, ctx) -> string`: the type plural names joined with ", " (or "All notes" with no types), then " tagged {tags}", " not tagged {tags}" and ` "{term}"`. It is used while `titleIsCustom` is false; editing the title sets it true. A loaded query whose `titleIsCustom` is absent counts as custom when its name is non-empty (as the backend reads it).
  - `<QueryPage id>`:
    - The header: icon, editable title, `…` with:
      - "Pin to sidebar" (Task 15; then also "Pin to..." for custom sidebar sections)
      - "Pin to object type" / "Unpin from object type" on each of its types, which adds or removes a `query:<id>` section in that type's views (so it also appears as a type-page tab)
      - "Pin to dashboard" / "Unpin from dashboard": a submenu of the collections that hold at least one of the query's types (all collections when it has none), each checked when its views contain `query:<id>`; picking one adds or removes that section through `saveCollection`
      - "Delete"
    - "Edit query" (`ph-pencil-simple`) toggles the QueryBuilder ("Close editor").
    - The results: a DataView with `FULL_VIEW_LAYOUTS` (kanban included, because the "Kanban by {propertyName}" recommendations of Task 12 create kanban queries; still no gallery), `pipeline = runQuery` and `pausedHint` set while `paused`; filter/sort/group are read from and saved to `definition`, and `view` holds only `viewDefinition` (layout, table, calculations, cards) and `showDataViewDetails`. While `paused`, the toolbar's Filter and Sort buttons show the pause hint "Sorting and property filters are paused while a search term is set." as their tooltip and in `ViewSummary`.
    - When `!isQueryReady`: "Query isn’t ready" (typographic apostrophe) with a hint that the saved draft returns nothing until it has a search term, a tag or a type.
    - When ready with no results: "No content found".
  - `<QueriesPage>` (the `{kind:'queries'}` target): heading "Queries" with the RootQuery icon, a "New" button (`createQuery()` then open it), and a list of every query (icon, title, `autoTitle` as subtitle when the title is custom, its types), sorted by title; empty state "No queries" / "Saved queries show up here."; each row's menu has "Open", "Pin to sidebar" and "Delete".
  - Sidebar: `SidebarProps` gains `onOpenTarget(target, {newTab})` (App wires it; Task 15 reuses it), and a "Queries" item (RootQuery icon) in the Object Types list, placed where a type named "Queries" would be in M2's by-name order, opening `{kind:'queries'}`. It has no type context menu and no count.
  - `<QueryBuilder>` sections:
    - **"Types":** "All" with the tooltip "Do not filter by object type", type chips, "+{count} more", "Exclude object types", "Clear", and per type a collection filter ("All", "In any collection", "In no collection", "{count} collections selected"). "Exclude object types" is disabled, with a hint saying why, until a search term or tag is set, and a hint says it does nothing while specific types are selected.
    - **"Tags or backlinks":** a tag picker over Tag objects (`ensureId` on pick), "Any of" / "All of", and a hint on the types row that "All of" cannot apply because an object has only one type. "Exclude tags or backlinks" is disabled, with a hint saying it needs a search term or an included tag, until one is set.
    - **"Search":** up to 5 terms of at least 2 characters (any of them may match, as a hint says), and the modes Auto, Exact, Semantic and Title with their descriptions. Exact and Semantic carry our note "Works like Auto until full-text search arrives.". With a term set, a hint says the property filters and sorts are paused.
    - **"Limit":** "No limit", then "first N" (`ph-list-bullets`) for N in 1, 3, 5, 10, 25, 50, then "random N" (`ph-shuffle`) for the same N.

- [ ] **Step 1: Write failing tests**
  - `test runQuery collection filters per type`: `inNoCollection` keeps only rows with no resolvable collection.
  - `test tags any vs all`
  - `test excludeTags removes tagged rows`
  - `test limit first and random with seeded rng, ignored when grouped`; the Limit menu lists No limit, first 1…50, random 1…50.
  - `test search pauses filters and sorts`: a definition with a `filterGroup` that would drop row A and a title sort → with a search term, A is kept, the order is createdAt newest first and `paused` is true; without the term, A is dropped and the sort applies.
  - `test excludeTags and excluded types ignored without search or tag; hints shown`: the builder shows both "needs a search term or tag" hints; with a type selected, the "no effect" hint
  - `test isQueryReady false for empty definition shows Query isn’t ready` (the exact string, with U+2019)
  - `test autoTitle types and tags, All notes without types; custom title sticks; absent titleIsCustom with a name counts as custom`
  - `test builder All clears types; Exclude object types writes excludeTypeIds`
  - `test filter edits save definition with baseRevision; layout saves view.viewDefinition only`
  - `test Pin to object type adds query section to type views`
  - `test Pin to dashboard adds query section to the chosen collection`
  - `test Queries sidebar item opens QueriesPage listing every query; New creates and opens one`
- [ ] **Step 2:** Run `npx vitest run src/queries src/shell`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(queries): query pages, builder and evaluation`.

### Task 15: Sidebar Pinned, All notes, navigation wiring (track: frontend; after M2 Task 19)

**Files:**
- Create: `shell/{PinnedSection.tsx,SidebarSections.tsx,PinToMenu.tsx,usePinned.ts}`, `allnotes/AllNotesView.tsx`
- Modify: `shell/Sidebar.tsx`, `App.tsx` (the `allNotes` branch), `object/ObjectView.tsx` (the `…` menu: "Pin to sidebar" / "Unpin from space", "Pin to..."), `types/TypePage.tsx`, `collections/CollectionPage.tsx` and `queries/QueryPage.tsx` (their `…` and section-tab pin items)
- Test: `shell/PinnedSection.test.tsx`, `shell/SidebarSections.test.tsx`, `allnotes/AllNotesView.test.tsx`, `App.m3.test.tsx`

**Interfaces:**
- Consumes: Tasks 6–14; M2's Sidebar props.
- Produces:
  - `usePinned() -> {pinned, sections, isPinned(ref), pin(ref, sectionId?), unpin(ref, sectionId?), move(sectionId|null, from, to), addSection(name), renameSection(id, name), deleteSection(id)}` (`null` = the Pinned section). Optimistic, saved with `api.patchUi({pinned} | {sections}, {baseRevision})`; on 409 it refetches, re-applies the same operation once and saves again (never a blind overwrite); reloaded on `ui` events. Pinning an object without an `id` calls `api.ensureId` first and pins by that id. A ref may be in Pinned and in custom sections at once, at most once per section.
  - `<PinnedSection>` replaces the static "Pinned" body: each pin renders by kind: an object with ObjectIcon and title; a type with TypeChip and plural name; a collection with its icon and name; a query with its icon (`ph-magnifying-glass` default) and title; items reorder by dnd-kit drag; a context menu has "Unpin from space"; a pin whose target no longer exists is shown dimmed with "Unpin from space" only; with no pins: "No pinned content".
  - `<SidebarSections>`: the custom sections from `ui.sections` (such as "In Progress"), rendered above Pinned in their saved order, each with its icon (`ph-star` default) and name as heading, the same item rendering, drag reorder and dimmed dangling items as PinnedSection, and "No pinned content" when empty. An item's context menu has "Unpin from {section}". The heading's context menu has "Edit Section" (name via "Section Name", icon) and "Delete Section" (removes the section only; its items stay wherever else they are pinned). The sidebar's section area has "Add Section" (a "Section Name" field; the description "A named heading that groups pages and collections in the sidebar." as its hint). The Pinned section itself is fixed and can't be deleted, so a last-section warning doesn't apply.
  - `<PinToMenu ref>`: the "Pin to..." submenu used by every `…` menu that has "Pin to sidebar": it lists "Pinned" and every custom section, each checked when the ref is in it; picking toggles membership.
  - The Sidebar adds an "All notes" item (`ph-note`) above Calendar, opened through Task 14's `onOpenTarget`.
  - `<AllNotesView>`: the heading "All notes" and "Every note in the space, by creation date."; rows from every type except DailyNote and the basic Task; grouped by `createdAt` Relative, sorted newest first; layouts `ALL_NOTES_LAYOUTS`; the choice is saved to `ui.allNotesLayout`; empty state "No notes yet" / "Notes you create will appear here.".
  - `App.tsx`: `onOpenTarget` for pins and sections; `retarget` on `renamed` keeps working for pinned objects (pins are by id).

- [ ] **Step 1: Write failing tests**
  - `test pinned shows four kinds in saved order`
  - `test drag reorder calls patchUi with new order and baseRevision`
  - `test patchUi 409 refetches and reapplies the reorder once`
  - `test Add Section then Pin to... adds the item to that section; Unpin from {section} removes it only there`
  - `test Edit Section renames and Delete Section keeps the items pinned elsewhere`
  - `test custom sections render above Pinned with No pinned content when empty`
  - `test pinning object without id calls ensureId first`
  - `test dangling pin dimmed with unpin only`
  - `test No pinned content when empty`
  - `test M2 sidebar items still present (+ New, Trash, type context menu) and the Queries item from Task 14`
  - `test All notes excludes daily notes and tasks and groups by created`
  - `test All notes layout saved to ui`
  - `test opening collection, query and allNotes targets renders their pages and tab labels`
  - `test pin from TypePage and CollectionPage menus adds a PinRef`
- [ ] **Step 2:** Run `npx vitest run src/shell src/allnotes src/App.m3.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit && npm run lint && npm run build`. Expected: PASS, clean.
- [ ] **Step 5:** Commit `feat(shell): pinned sidebar, All notes and view navigation`.

### Task 16: Milestone acceptance (track: integrate; after Tasks 1–15)

**Files:**
- Create: `scripts/m3_acceptance.py`, `docs/superpowers/plans/m3-acceptance.md`
- Modify: `docs/superpowers/plans/remaining-work.md` (the M3 rows only)

- [ ] **Step 1:** Run `uv run pytest -q` and `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run build`. Expected: all green.
- [ ] **Step 2:** Write `scripts/m3_acceptance.py SPACE [--keep]`. Like `m2_acceptance.py`, it works on a temporary git-committed copy and starts the server. Over HTTP it then checks:
  1. Starting twice and calling every M3 GET route changes no file (`git status` is clean).
  2. `POST /api/rows` returns one row per `GET /api/objects` entry, with versions equal to `GET /api/object`.
  3. Create collection "Tooling" for `server` and `page`, then add it to two objects, one of them already in another collection created first ("Other", so its list becomes `[Other, Tooling]`). Each diff is the `collections:` line plus `lastUpdated`, plus an inserted `id:` line for an object that had no `id` (the fixtures have none, and every stamped write adds one). The script commits after this step so later diffs are measured from here.
  4. Rename "Tooling" to "Gear". Only the list items change, `lastUpdated` is not touched, and `rewritten` equals the set of changed files.
  5. Delete "Gear": 428, then delete with confirm; `skipped` is empty. Restore it from the trash; the tree is byte-identical to before the delete (`git diff` empty apart from `.object/`), including `[Other, Gear]` in its original order.
  6. `PUT /api/views/task`, `PUT /api/ui` (a pin) and a query create/save each change exactly one file under `.object/` and no `.md` file; a second `PUT /api/ui` with the old `baseRevision` returns 409.
  7. `POST /api/objects` with `values` creates one file holding them.
  8. The M1 no-edit pass: 0 files changed.
- [ ] **Step 3:** Run it on `backend/tests/fixtures/space-sample` and `backend/tests/fixtures/space-v1`. Expected: every check prints `[ok]`.
- [ ] **Step 4:** Run `npm run build`, then `uv run objectapp --space <copy of space-sample>`, and walk through:
  - the Task type page: All with each of the six full-view layouts; a filter group `status includes Done OR done is selected`; a sort; group by status; the Overview sections
  - the table: resize, pin, hide, wrap, a Sum calculation, inline edits of a label and a date; an external edit in VS Code updating the row
  - kanban: drag a task between status columns, "+" in a column
  - a collection with "Add existing", a rename and delete/restore; a query built from the type page with "Save as query", pinned to the sidebar, to its type (a new header tab) and to a collection's dashboard; a custom sidebar section "In Progress" holding that query; the Queries sidebar item and page; All notes
- [ ] **Step 5:** Gene runs the app on his CPI copy outside the repo, with `git init` done there. Record in `m3-acceptance.md`:
  - each type page opens with its default layout; Weblinks shows the grid cards of `04-collection-weblinks-cards.png`
  - a membership edit's `git diff` is the `collections:` line plus `lastUpdated` (plus `id:` on an object that had none); view changes touch only `.object/`
  - a type page with 1,000+ objects stays responsive (filter edit under 200 ms, measured in DevTools)
  - against the design spec and behaviour catalog: the toolbar pill, filter popover, table, cards, kanban, type-page tabs, collection page, query builder, and the sidebar's Pinned, custom sections and Queries entry look and read as specified
- [ ] **Step 6:** Update the M3 section of `remaining-work.md` to "built", then commit `chore: milestone 3 acceptance`.
