# Object, Milestone 5: Search, Command Palette, Backlinks, Graph. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finding and connecting things works as it does in Object, on plain Markdown files:
- A **full-text search index** (SQLite FTS5, standard library) in `.object-cache/`, built from the files, kept current by the app's own writes and the watcher, and rebuildable at any time. It is derived data: deleting it loses nothing.
- The **search palette** (Ctrl+K, "Search this space"): fuzzy titles and aliases plus full text with highlighted snippets, recently opened objects on an empty query, type include/exclude and tag filters, "Create new … with title …". The **action palette** ("Open action palette"): create an object of any type, open the calendar, today, the global graph or the open object's graph view, toggle the left sidebar and the right side panel.
- **Find in page** (Ctrl+F and the `…` menu): find, match case, whole word, next/previous, replace and replace all in the body editor.
- The **references section** at the bottom of an object: tabs All / Backlinks / Related Content / Mentions / Related tags; backlinks with the text around each link, unlinked mentions with a one-click "Link", related content (a lexical stand-in for Object's semantic one, see Global Constraints), related tags. The **backlinks system property** becomes live (property panel, rows, filters, grouping, table and card fields), with the "No backlinks" Overview section and the Task "Context" section M4 deferred.
- The **global graph** page (nodes coloured by type and sized by links; the Object graph filters: filter and exclude object types, show completed tasks, show simplified graph, hide objects with many links, hide dates, hide indirect links, show tags network; search a note in the graph; fit to view; click to peek) and the **local graph** of the open object in the right panel (1–2 hops).
- Smooth at **5,000 objects / 50,000 links**.

**Architecture:**
- **Four build lanes** (see "Build lanes"): **backend** (`backend/**`, Tasks 1–5), **shell and palette** (Tasks 6–8), **references** (Tasks 9–10) and **graph** (Tasks 11–12), then **integrate** (Task 13). The frontend lanes build against the **API contract** below and mock it in tests. Task 6 owns every shared frontend file and lands first; after it the three frontend lanes own disjoint folders. Inside the backend lane, Task 2 owns every shared backend file (`space.py`, `server.py`, `rows.py`, `relink.py`) and creates stub modules that Tasks 3, 4 and 5 replace, so those three never edit a shared file.
- **Back end:** a **link index** (`linkindex.py`) built lazily in memory from `Space._raw` and kept current through a new `Space` change-listener hook (every in-memory change already funnels through `Space.rescan_file` and `Space._move_file`); a **fast resolver** (`resolver.py`) that answers exactly what `Space.resolve` answers today but with dictionaries instead of a scan per call (today's `resolve` is O(objects) per link, which is 250 million comparisons at 50,000 links); **roles** (`roles.py`) mapping our types to Object's structures (`RootPage`, `RootTag`, `RootTask`, `RootDailyNote`, `Media*`, `RootEntity`) with the lists from `structureHeuristicsBackbone.ts`; a **search index** (`searchindex.py`, `searchtext.py`, `fuzzy.py`) on its own thread with one SQLite connection; **references** (`references.py`); **graph data** (`graphdata.py`). New routes live in three router modules (`api_search.py`, `api_references.py`, `api_graph.py`) that `server.py` includes once (Task 2).
- **Front end:** a palette (`palette/`, on the `cmdk` already in the project), a find bar with a ProseMirror decoration plugin (`find/`, `editor/extensions/findInPage.ts`), the references section (`references/`), the backlinks property in M3's view engine, and the graph (`graph/`) on sigma (WebGL) with ForceAtlas2 running in a web worker; graph filtering and neighbourhoods are pure, unit-tested TypeScript over one compact `GET /api/graph` payload.
- **Why the link index is in memory and the search index on disk:** links must be exact and instantly current after every write (backlinks, rows, the graph), and the space is already fully read into `Space._raw` at start-up, so extracting links is a pass over memory (well under 2 s at 5,000 objects). Full-text search needs an inverted index; FTS5 builds it, and keeping it in `.object-cache/` (spec §4) means a restart only re-indexes files whose version changed.

**Tech Stack:** as M4, plus these **new dependencies, installed up front in one commit before the build** (no M5 task edits `package.json`, `package-lock.json`, `pyproject.toml` or `uv.lock`):

| Package | Version (exact pin) | Where | Why |
|---|---|---|---|
| `sigma` | `3.0.3` | `frontend` dependencies | WebGL graph renderer; draws 5,000 nodes / 50,000 edges smoothly where SVG or canvas-2D renderers stall. 3.0.3 (2026-04-30) is the latest 3.x; 4.0.x is under two weeks old and is not used. |
| `graphology` | `0.26.0` | `frontend` dependencies | The graph data structure sigma renders. |
| `graphology-layout-forceatlas2` | `0.10.1` | `frontend` dependencies | ForceAtlas2 layout, run in a web worker (`graphology-layout-forceatlas2/worker`) with Barnes-Hut above 500 nodes, so layout never blocks the UI. |
| `graphology-types` | `0.24.8` | `frontend` devDependencies | TypeScript types that `sigma` and `graphology` import. |

Install command (run once by the build's setup step, then committed as `chore(deps): sigma, graphology and forceatlas2 for the M5 graph`): `cd frontend && npm install --save-exact sigma@3.0.3 graphology@0.26.0 graphology-layout-forceatlas2@0.10.1 && npm install --save-exact -D graphology-types@0.24.8`.
**Back end: no new dependency.** Search uses the standard library's `sqlite3` with FTS5, verified on this machine (SQLite 3.45.1, `uv run python -c "import sqlite3; sqlite3.connect(':memory:').execute('create virtual table t using fts5(x)')"` succeeds; the `trigram` tokenizer is also compiled in but not used). Fuzzy title matching is our own small scorer, not a library. The palette uses `cmdk@1.1.1`, already a dependency (`components/ui/command.tsx`).

**Spec:** `docs/superpowers/specs/2026-10-23-object-design.md` §2 (search, backlinks, the command palette, the graph), §3 (system property "backlinks"), §4 (`.object-cache/` search index, derived and rebuildable), §5 (the Ctrl+K command palette), §6 (a force-graph library, a SQLite search index). `docs/superpowers/plans/remaining-work.md` "M5: search, command palette, backlinks, graph" is the scope.
- **Reference paths.** Read the trimmed, tracked `reference/` (older docs say `.reference/`): models in `docs/design-notes`, behaviour lists in `docs/design-notes`, English strings in `docs/strings.txt`, CSS in `docs/design.css`. Never copy code.
- **Models used:** `search.model.ts` (`FullTextSearchHighlight` fields `title | aliases | description | properties | blocksContent | tags`, `WorkerSearchConfiguration` `mode: 'fullText' | 'title'`, `excludeStructureIds`, `filterStructureIds`), `RootSpace.model.ts` (`GraphViewCustomization`: `filterStructureIds`, `excludeStructureIds`, `showCompletedTasks`, `showMinimalNodes`, `hideLargeNodes`, `hideDates`, `hideIndirectLinks`, `showTagsNetwork`, `showSpaceTagsNetwork`, with their doc comments), `component.model.ts` (`ReferencesSectionTab = 'all' | 'backlinks' | 'related' | 'mentions' | 'relatedTags'`, `referencesSectionTab`, `referencesSectionClosed`, `backlinksClosed`, `unlinkedMentionsClosed`, `relatedTagsClosed`), `property.model.ts` (`entity_backlinks`, `isNotSearchable`), `structureHeuristicsBackbone.ts` (`canHaveBacklinks`, `canHaveBacklinksSection`, `hasUnlinkedMentions`, `canBeUnlinkedMention`, `hasNoGraphViewSupport`).
- **en-US strings:** every quoted UI string below is verbatim in `strings.txt` unless marked "our string". The file is compiled message ASTs; flatten it once with a throwaway script outside the repo (evaluate the `var e={…}` object in a Node `vm` context with no globals, then walk it, joining `t:3` text and `t:4` named placeholders) and grep. Groups to read: `CommandPalette.*`, `Search.*`, `shortcuts.openSearchPalette`, `shortcuts.openCommandPalette`, `shortcuts.toggleLeftSidebar`, `shortcuts.toggleSidepanel`, `FindInPage.*`, `PageBacklinkSection.*`, `components.RootTag.relatedTags`, `textEditBar.link`, `GraphViewModal.*`, `GraphViewCustomization.*`, `DatabaseDashboard.sections.noBacklinks.*`, `DatabaseDashboard.sections.tasks.source.*`, `ConvolutionEditor.backlinkCountInfo`, `ContentLoadingStateIndicator.recomputeBacklinkIndex.*`, `general.customize`.
- **CSS:** `.find-in-page-chrome{flex-shrink:1;width:20rem;min-width:12rem;max-width:100%}`, `.command-palette-list .menu-row{padding:.375rem .5rem}`, `.search-highlights b{background-color:var(--color-bg-search-highlight)}`. The value of `--bg-search-highlight` is set outside the trimmed CSS (no definition in `design.css`), so its colour is our token (Task 6), listed for Gene's check.
- **What the trimmed reference lacks** (so the plan decides and says so, never invents silently): the **key bindings** of `openSearchPalette` and `openCommandPalette` (the shortcut ids and names are in the strings, the keys are in the bundle, which is not in the trimmed set): we bind **Ctrl+K** (spec §5, and `docs/README.md` "the command palette (Ctrl K)") for search and **Ctrl+P** for actions (our binding, from Object's public shortcut docs as remembered, not verified; Gene confirms). **Ctrl+F** for Find in page is in `docs/README.md` (the `…` menu shows "Find in Page (Ctrl F)"). The `{limit}` of "Nodes with more than {limit} links are hidden" (we use **100**, our value). How Object renders indirect links, node sizes and colours in the graph (no screenshot; ours, listed for Gene). What "Related tags" contains for a non-tag object (only the tab id and the label exist; our rule is in Global Constraints). There are no screenshots of the palette or the graph ("Still unseen" in `docs/README.md`).

## Roadmap (one plan per milestone, written when the previous one is accepted)

| M | Delivers |
|---|---|
| 1 (accepted) | shell, objects on disk, page + peek, block editor with byte preservation, wikilinks, external changes |
| 2 (accepted) | object types and all property kinds, type settings and page layouts, title edit and relink, change type, templates, tags as objects, trash |
| 3 (built, reviewed and fixed; Gene's hands-on checks pending) | views, filters, sorts, group-by, collections, queries, pinned, All notes |
| 4 (being built; Gene's hands-on checks pending) | calendar, daily notes, tasks, recurrence, reminders |
| **5 (this plan)** | SQLite FTS index, Ctrl+K search palette and action palette, Find in page, references section (backlinks, mentions, related content, related tags), live backlinks property, "No backlinks" and Task "Context" sections, global and local graph |
| 6 (built concurrently with M5) | whiteboards and pen |
| 7 | remaining blocks, light mode, Settings modal, spaces (create, switch, rename), side-panel areas, polish |

## Global Constraints

**Carried forward from M1–M4** (all of them, unchanged):
- **Server and toolchain:** `127.0.0.1:8790`, no outbound network, Python `>=3.13` with uv, Node `>=22`. Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Opening never writes an object file.** Opening, every M5 GET (`/api/search`, `/api/references`, `/api/graph`, the extended `/api/object` and `/api/rows`) and the index threads write nothing to an object file, a `.object/` file or anything else in the space outside `.object-cache/`.
- **Writes:** every object write goes through `Space._write`; writes are atomic and keep EOL/BOM/trailing newline and every untouched byte; a route that writes announces `ChangeEvent(origin=clientId)`. M5 adds exactly one object write: **linking an unlinked mention** (Task 4), which changes only the mention's characters in the mentioning object's body, plus `lastUpdated` (it is a deliberate user edit of that object, so it is stamped, unlike M2's cascading relinks). Find-in-page replace goes through the editor's normal autosave (M1), never a new route.
- **Definition files and `ui.json`** follow M3/M4: `JsonStore`/`uistate`, revisions, 409 on a stale `baseRevision`, 423 on an unreadable file; `PUT /api/ui` accepts only `_UI_PATCH_KEYS` (unknown key 422) with shapes checked by `_ui_problem`.
- **Tests:** baseline is this branch after M4's final gate (counts recorded by M4 Task 16). Every task keeps all earlier tests green. A test that passes before its task's code exists is labelled "regression guard (green from the start)". M5 backend tests use their own synthetic space (`space-links`, Task 1) and a generated large space (`big_space_dir`, Task 1); no test asserts absolute fixture counts where a computed count can be compared.
- **Fidelity.** Labels, icons, option keys, defaults and orders come from the reference. A string marked "our string" has no Object original; every other quoted string must be found verbatim in `strings.txt`.

**New in M5**
- **Start condition.** M4 built on this branch (its final gate may still be running; M5 plans against the code that exists plus what the M4 plan adds, and gets a reconcile pass after M4 lands). Before building, re-read what M4 actually produced and correct names in this plan (`tasks/taskSections.ts`, `TaskSectionKey`, `_TASK_SECTION_KEYS`, `types/dashboardSections.ts`, `object/ObjectView.tsx`'s `mode: 'inline'`, `views/group.ts`'s `GROUP_OPTIONS(kind, def?)`).
- **Concurrent M6.** M6 (whiteboards and pen) is built at the same time in the same working tree. M6 confines itself to new files and makes all its edits to pre-existing shared files in its own integrate task, which runs **after** M5's integrate (Task 13). So M5 owns the shared app files as usual (`App.tsx`, `shell/Sidebar.tsx`, `nav/tabs.ts`, `api/client.ts`, `api/types.ts`, `object/ObjectView.tsx`, `index.css`, `server.py`, `space.py`, `watcher.py`). M5 **never creates or edits** `frontend/src/whiteboard/**`, `backend/objectapp/whiteboard*.py`, any `space-whiteboard` fixture or `scripts/m6_acceptance.py`. Whiteboard objects are ordinary `.md` objects to M5 (indexed, linkable, graph nodes); M6's integrate adds `RootWhiteboard` to `roles.py` (the `...whiteboard(config)` entries of `structureHeuristicsBackbone.ts`) in one place.
- **Storage (all derived data is rebuildable; nothing new in object files).**

  | What | Where | Written by |
  |---|---|---|
  | Full-text index | `<space>/.object-cache/search.sqlite` (SQLite, rollback journal; a transient `search.sqlite-journal` during a write) and `<space>/.object-cache/.gitignore` containing `*` (so git, and a git-tracked or synced space, never sees the cache: the pattern also matches the `.gitignore` itself); override with `OBJECT_CACHE_DIR` → `<OBJECT_CACHE_DIR>/<first 16 hex of sha256(space root)>/search.sqlite` (tests, acceptance) | the search index thread only |
  | Link index, resolver, graph data | memory only (rebuilt from `Space._raw` on demand) | nothing is written |
  | Graph filters (`GraphViewCustomization`, verbatim keys) | `.object/ui.json` key `graph` | `PUT /api/ui` |
  | Tasks page Context section view | `.object/ui.json` `tasks.views.source` (M4's `tasks` key) | `PUT /api/ui` |
  | Per-object references tab and closed state (Object keeps `referencesSectionTab`/`referencesSectionClosed` on the object's data; we never write an object file for view state) | `localStorage` key `object.references:<object id or path>` | the client |
  | Local graph hop count, palette recent filters | `localStorage` | the client |

- **The cache is never a source of truth.** A missing, stale, corrupt, locked or unwritable cache is rebuilt or bypassed silently: corrupt (`sqlite3.DatabaseError` on open or on the format check) → the index deletes only the files it owns (`search.sqlite`, `search.sqlite-journal`) inside the cache folder and rebuilds; unwritable folder or a lock that persists for 2 s (a second app instance on the same space) → an in-memory index (`:memory:`) for this run, logged once. `PRAGMA user_version` holds `INDEX_FORMAT` (starts at 1); a mismatch rebuilds. Start-up sync compares each object's version (`sha256` of its bytes, M1's `version_of`) with the `meta` table and re-indexes only changed paths, so **a second start on an unchanged space writes nothing, not even the cache** (no write transaction, so the database file's bytes and mtime are unchanged).
- **Space change hook.** `Space.add_listener(fn)` (Task 2): `fn(SpaceChange)` with `SpaceChange(kind: 'object' | 'types', path: str | None)`, called after every change to the in-memory scan (`rescan_file`, both paths of `_move_file`, and type changes: `save_type`, `change_property_kind`, `set_property_sync`, `delete_type`, `create_type`, `change_type`, `refresh_type`, `_merge_types`). Listeners run while the space lock may be held, so they **only record or enqueue** (never block, read files or take another lock). The watcher already turns external edits into `rescan_file`, so it needs no change.
- **Link semantics (the link index; one rule for backlinks, rows, references and the graph).**
  - A **link** from object A to object B is any of: a `[[target]]` (with or without `#heading`/`|alias`, `![[…]]` included) in A's body **outside fenced code and inline code** (M2's `relink` segmenting), an `entity` (relation) property value of A, or a `[[target]]` inside any other frontmatter string value of A (the same values M2's `relink_frontmatter` rewrites on rename); its target resolves to B by `Space.resolve` from A's path.
  - Not links: unresolved targets, links to self, links from or to templates (`template:` set), Markdown `[text](file.md)` links, and `tags:` membership (tags are their own relation: the index keeps it separately as `tagged`, resolving each name to the Tag object with that title, case-insensitively, as M2's `ensure_tag` finds it).
  - **Backlinks** of B are the **distinct** objects linking to B (`ConvolutionEditor.backlinkCountInfo`: "Backlinked object counts is not equal to the number of backlinks. Multiple links in one object count as one here."), sorted by title then path.
  - Freshness: a body or frontmatter change re-extracts that object's links; any change to the set of names (an object created, deleted, moved or retyped, or a change of `title`, `aliases`, `createdAt` or `template`) invalidates the resolver and re-resolves every stored target lazily on the next read (50,000 resolves stay well under 1 s with the dictionary resolver); a type change re-extracts property links lazily.
  - `Space.resolve` keeps today's exact order (space path form, title in the linking folder, title anywhere by oldest `createdAt` then path, alias, case-insensitive title or stem; folder, then oldest `createdAt`, then path within each step). The fast resolver must return **identical** results; Task 2 proves it against a copy of today's algorithm.
- **Search semantics.**
  - Indexed per object (templates excluded): `title`, `aliases`, `description`, `tags`, `props` (one `Name: value` line per property that is not `isNotSearchable` and is a text, URL, number, label (option texts), relation (target titles) or checkbox-free kind; dates and system properties excluded), `body` (Markdown to plain text: headings, list markers, emphasis and link brackets stripped, link labels and targets kept, table cells and code text kept). Tokenizer `unicode61 remove_diacritics 2` with prefix indexes `2 3`, so "cafe" finds "Café" and typing finds word prefixes.
  - A query is split on whitespace; each token of 2+ characters becomes a quoted prefix term `"tok"*` (FTS syntax characters and the words AND/OR/NOT/NEAR are neutralised by the quoting); terms are AND-ed. Tokens shorter than 2 characters only feed the title matcher.
  - Ranking: **title and alias matches first** (our fuzzy scorer over every object's title and aliases: exact 1000, prefix 800, every query word a word-prefix 600, substring 400, in-order subsequence 100–300 by contiguity; an alias scores 50 less), then full-text hits by `bm25` with column weights title 10, aliases 8, tags 5, description 3, props 2, body 1. An object found both ways keeps its title rank and gains its snippets. At most 50 results (`limit`, max 200).
  - Highlights follow `FullTextSearchHighlight`: `field` is `title`, `aliases`, `description`, `properties`, `blocksContent` or `tags`; `snippets` come from FTS5 `snippet()` (about 12 tokens, `…` ellipses) with U+0002 before and U+0003 after each match (control characters, so the client renders `<b>` without parsing HTML); title matches come back as `titleMatches: [start, end][]`.
  - Filters (palette options): `type` (repeatable, "Only search for type …"), `excludeType` (repeatable, "Exclude type …"), `tag` ("Only search content tagged with …", by tag name). Mode `title` (Object's `mode: 'title'`) skips full text.
  - `partial: true` until the start-up sync has finished, so the palette shows "Your content in not fully indexed yet. Search results might not return all matches." (`CommandPalette.onlyPartialResults`, sic) and still returns title matches and whatever is indexed.
  - Freshness: a write or external change is searchable within 2 s (the index thread debounces 200 ms).
- **References semantics** (Task 4).
  - **Roles** (`roles.py`): basic `Page` → `RootPage`, `Tag` → `RootTag`, `Task` → `RootTask`, `DailyNote` → `RootDailyNote`, the basic media types `Weblink`, `File`, `Image`, `PDF`, `Audio`, `Video`, `Tweet` → `MediaWebResource`, `MediaFile`, `MediaImage`, `MediaPDF`, `MediaAudio`, `MediaVideo`, `MediaTweet`; every other type → `RootEntity`. The lists are copied from `structureHeuristicsBackbone.ts`, restricted to roles we have: `HAS_REFERENCES_SECTION` = `canHaveBacklinksSection` (RootPage, RootEntity, MediaImage, MediaPDF, MediaAudio, MediaWebResource, MediaFile, MediaTweet, RootTask; **not** RootTag, RootDailyNote, MediaVideo); `HAS_UNLINKED_MENTIONS` = `hasUnlinkedMentions` (RootPage, RootEntity, MediaImage, MediaPDF, MediaAudio, MediaWebResource, MediaFile, MediaTweet, RootTag, RootTask); `CAN_BE_UNLINKED_MENTION` = `canBeUnlinkedMention` (RootPage, RootEntity, MediaImage, MediaPDF, MediaAudio, MediaWebResource, MediaFile, MediaTweet, RootDailyNote, RootTask); `CAN_HAVE_BACKLINKS` = `canHaveBacklinks` (RootPage, RootEntity, the media roles but Video, RootTag, RootTask); `NO_GRAPH_SUPPORT` = none of our roles.
  - **Tabs** an object offers (`References.tabs`, order of `ReferencesSectionTab`): none unless its role is in `HAS_REFERENCES_SECTION`; otherwise `all`, `backlinks`, `related`, then `mentions` when the role is in `HAS_UNLINKED_MENTIONS`, then `relatedTags` when the object has tags.
  - **Backlinks** with context: per linking object, every body link to this object with its block (the source line, list marker and emphasis stripped, at most 280 characters around the link) and the link's span inside it ("Mentions in text"), plus the keys of the properties that link ("via {property}", our string). An object that links only through properties has no body context.
  - **Unlinked mentions:** occurrences of the object's title or any alias (each at least **3 characters**, our threshold) in the body of another object whose role is in `CAN_BE_UNLINKED_MENTION`, case-insensitive, on Unicode word boundaries (`(?<!\w)…(?!\w)`), longest name first, non-overlapping, **outside** wikilinks, Markdown links and code; never in templates or the object itself. Candidates are prefiltered with an FTS phrase query on `body` when the index is ready (full scan of `Space._raw` otherwise). Each occurrence carries `start`/`end` offsets into the mentioning object's body (the `\n`-normalised text that `Space._write` edits) and its context.
  - **Linking a mention** writes `[[text]]` when the matched text, from the mentioning object, resolves to this object exactly; otherwise `[[<link text of this object>|text]]` (M2's `_link_text`, the title or the path form). The route re-checks that the body still has `text` at `[start, end)` (else 422 "The text has changed. Reload and try again." (our string)) and the `baseVersion` (409).
  - **Related Content** (Object's is semantic, AI embeddings: "Semantically related objects from your spaces will appear here."; out of scope by spec §2): we offer a **lexical stand-in**, labelled with Object's tab name and info "Similar objects": the object's 12 strongest terms by tf-idf (from `fts5vocab`) OR-ed into one FTS query ranked by `bm25`, excluding the object itself; 20 results, "Show more" adds 20. Listed for Gene's check as a proxy, not a match.
  - **Related tags** (our rule; the reference has only the tab id `relatedTags` and the label "Related tags", `components.RootTag.relatedTags`): the tags that appear together with this object's tags on other objects, by how many objects share them, excluding the object's own tags; shown only when the object has tags.
- **Graph semantics** (Tasks 5, 11, 12).
  - Nodes: every non-template object whose role is not in `NO_GRAPH_SUPPORT`. Edges: the distinct undirected pairs of the link index. `degree` = distinct linked neighbours. `done` = a Task whose status is in the `done` category (M4's `status_category`). `daily` = role `RootDailyNote`. `tag` = role `RootTag`. The `tagged` pairs (object, tag) travel separately.
  - Filters (`GraphViewCustomization`, defaults all off/empty, applied on the client so toggles are instant): `filterStructureIds` (empty = every type) and `excludeStructureIds` (wins over filter); `showCompletedTasks` false hides `done` nodes; `hideDates` hides `daily` nodes (our analogue of Object's date objects); `hideLargeNodes` hides nodes with more than `LARGE_NODE_LIMIT = 100` links (our value); `showMinimalNodes` ("Show simplified graph") draws dots without labels.
  - **Indirect links** (our reading of the `hideIndirectLinks` model comment "Drop a hidden object that only sits between shown objects, and the links through it" and its tooltip): by default, a node hidden by a filter that connects shown nodes contributes a dashed **indirect** edge between each pair of its shown neighbours, only when it has at most **10** shown neighbours (our cap; a hidden hub would otherwise add thousands of edges), and at most 50,000 indirect edges in total. `hideIndirectLinks` drops them ("Links that only pass through a hidden object are not shown.").
  - **Tags network:** on the global graph, "Show tags network" sets `showSpaceTagsNetwork`: every Tag object is shown and two tags get an edge whenever one object carries both (the `showSpaceTagsNetwork` model comment: "every tag, and a link wherever one object points at two tags"). On a Tag's local graph it sets `showTagsNetwork`: the tag's neighbourhood includes the objects tagged with it.
  - Size: radius `3 + 2·sqrt(degree)` px, capped at 18 (our values). Colour: the type's colour from M2's palette (`theme/palette.ts`), tags in their tag colour. Labels at sigma's default label threshold, always for the hovered node and its neighbours.
  - Local graph: breadth-first neighbourhood of the open object over link edges (plus `tagged` for a Tag with `showTagsNetwork`), **1 hop by default, 2 at most** ("Maximum distance", "Show more" / "Show less"), the same filters except that the centre is never hidden.
- **Performance bar** (asserted by tests; a CI-slow environment variable `OBJECT_PERF_SLACK=3` multiplies every budget): on the generated 5,000-object / 50,000-link space, link index build < 2 s; one backlinks lookup < 1 ms; 50,000 resolves < 1 s; `GET /api/graph` < 300 ms; search p95 < 50 ms over 20 queries after the sync; `GET /api/references` < 150 ms; full index build in the background < 30 s and a second start's sync < 2 s; client `filterGraph` on 5,000/50,000 < 100 ms; the palette keeps typing responsive (requests debounced 100 ms, stale responses dropped).
- **Test hooks.** `OBJECT_CACHE_DIR` (Storage table). An autouse fixture in `conftest.py` (Task 1) points it at a per-test temporary folder, like M4's `OBJECT_STATE_DIR` fixture, so no existing test's space tree ever gains a cache; M5 tests that check the default location unset it.
- **Not in M5** (recorded so they are not rebuilt by accident): the extended search page (`LocalSpaceQuery.*`, "Open extended search", "Save as Query"); clipboard actions (`CommandPalette.paste.*`); semantic related content (AI); `CommandPalette.actions.options.openSpace` and switching spaces (M7 owns spaces; the server serves one space; the remaining-work bullet's "switch space" moves there); "Open settings" (M7); focus mode, Readwise, AI chat, help and feedback actions; block references and transclusion (`BlockReferences.referencedIn`); the calendar's "Backlinks" and "Date references" sections (`CalendarDaily.backlinksToThisDay.*`, `CalendarDaily.references.*`); the references section on daily notes and tags (Object shows none: `canHaveBacklinksSection`); the backlink content view and section-default settings (`EditorSettings.backlinkSectionsDefault.*`, M7 Settings); nested backlink display modes; side-panel areas and the backlinks side-panel entry (`RenderSidepanel.backlinks.tooltip`, M7); graph PNG export ("Export view as PNG"); find in raw mode; merge object.

## API contract (M5): shared by all lanes

```
SpaceChange   { kind: 'object'|'types', path: str|None }                     /* backend only: Space.add_listener */
EntityRef     { target: string, path: string|null }                          /* M2 */
ObjectDetail += { backlinks: EntityRef[] }                                   /* GET /api/object: distinct linking objects, title then path */
Row.values   += { [key of the type's entity_backlinks definition]: EntityRef[] }   /* POST /api/rows; [] when none */
SearchHighlight { field: 'title'|'aliases'|'description'|'properties'|'blocksContent'|'tags', snippets: string[] }  /* matches wrapped in \u0002 … \u0003 */
SearchResult  { path, title, type /* type id */, icon: Icon|null, tags: string[], score: number,
                titleMatches: [number, number][], highlights: SearchHighlight[] }
SearchResponse { results: SearchResult[], partial: boolean }
BodyContext   { context: string, start: number, end: number }                /* the link's span inside context */
BacklinkEntry { path, contexts: BodyContext[], properties: string[] /* property keys that link */ }
Occurrence    { start: number, end: number /* offsets in the body */, text: string, context: string, contextStart: number /* offset of context in the body */ }
MentionEntry  { path, version, occurrences: Occurrence[] }
RelatedEntry  { path, score: number }
RelatedTagEntry { name: string, path: string|null, count: number }
ReferencesTab = 'all'|'backlinks'|'related'|'mentions'|'relatedTags'
References    { tabs: ReferencesTab[], backlinks: BacklinkEntry[], mentions: MentionEntry[], related: RelatedEntry[],
                relatedTags: RelatedTagEntry[], summaries: { [path]: ObjectSummary } }
GraphNode     { path, title, type, icon: Icon|null, degree: number, tag: boolean, daily: boolean, done: boolean }
GraphData     { nodes: GraphNode[], links: number[] /* flat [a0,b0,a1,b1,…], node indexes, a < b, each pair once */,
                tagged: number[] /* flat [object0, tag0, …] */ }
GraphCustomization { filterStructureIds?: string[], excludeStructureIds?: string[], showCompletedTasks?: boolean,
                     showMinimalNodes?: boolean, hideLargeNodes?: boolean, hideDates?: boolean, hideIndirectLinks?: boolean,
                     showTagsNetwork?: boolean, showSpaceTagsNetwork?: boolean }           /* RootSpace.model.ts verbatim */
UiState      += { graph?: GraphCustomization }
TaskSectionKey += 'source'                                                   /* server: _TASK_SECTION_KEYS */
Target       += { kind: 'graph' }
ChangeEvent: unchanged (linking a mention is `changed` on the mentioning object)
```

| Route | Request | Success | Errors |
|---|---|---|---|
| `GET /api/search?q=&type=&excludeType=&tag=&limit=&mode=` | `type`/`excludeType` repeatable; `mode` `auto` (default) or `title`; `q` at most 200 characters | `SearchResponse` (empty `q` → no results) | 422 (bad mode, limit, or `q` too long) |
| `POST /api/search/reindex` | `{clientId?}` | 202 `{started: true}` (drops and rebuilds the index in the background; `partial` until done) | |
| `GET /api/references?path=&relatedLimit=` | `relatedLimit` default 20, max 200 | `References` | 400 bad path, 404 no object |
| `POST /api/references/link` | `{path /* the mentioning object */, target /* the mentioned object */, start, end, text, baseVersion, clientId?}` | 200 `{version}` | 409 `{currentVersion}`, 422 (text changed, unknown target, range not a mention), 423 read-only, 404 |
| `GET /api/graph` | | `GraphData` | |
| `GET /api/object` (extended) | as M1 | `ObjectDetail` + `backlinks` | as M1 |
| `POST /api/rows` (extended) | as M3 | `Row.values` carries backlinks | as M3 |
| `GET /api/ui` · `PUT /api/ui` (extended) | the patch accepts `graph`; `tasks.activeTab`/`tasks.views` accept `source` | as M3 | 409, 423, 422 (unknown key, wrong shape, unknown `graph` key) |

- After `POST /api/references/link` the client reloads references (one `api.references` call) and toasts "Link created" (`PageBacklinkSection.linkCreated`); on 409 it reloads and toasts "Changed elsewhere. Reloaded." (our string, as M3).
- The client never computes backlinks itself; it reads `ObjectDetail.backlinks`, `Row.values` and `References`.

## Review Focus

1. **Reading writes nothing; the cache stays in its folder.** No M5 read touches an object, a `.object/` file or anything outside `.object-cache/`; a second start on an unchanged space writes nothing at all; git never sees the cache; a read-only space still searches (in memory).
   - *(Task 2: `test_open_twice_writes_nothing` (M3's, in `test_jsonstore.py`) extended with `GET /api/object` and `POST /api/rows`; Task 3: `test_index_writes_only_cache_dir`, `test_second_start_unchanged_space_writes_nothing`, `test_cache_gitignore_hides_everything`, `test_cache_dir_env_override`, `test_unwritable_cache_falls_back_to_memory`, `test_search_routes_write_nothing_to_space`; Task 4: `test_references_get_writes_nothing`; Task 5: `test_graph_get_writes_nothing`; Task 13 check 1)*
2. **The index is current and self-healing.** Writes, renames, deletes, restores and external edits reach search within 2 s; a corrupt or old-format cache is rebuilt; reindex works; `partial` is honest.
   - *(Task 3: `test_index_follows_write_rename_delete_restore`, `test_external_change_reindexed`, `test_corrupt_cache_rebuilt`, `test_format_bump_rebuilds`, `test_reindex_route_rebuilds`, `test_partial_until_initial_sync`; Task 13 checks 2–3)*
3. **Links are exact.** The fast resolver equals today's `Space.resolve` on every case; backlinks are distinct objects; code-block links, templates, self links and dangling links don't count; property and frontmatter links do; renames and new same-title objects re-resolve.
   - *(Task 2: `test_fast_resolver_matches_reference_resolver`, `test_backlinks_distinct_objects`, `test_links_in_code_ignored`, `test_templates_never_sources_or_targets`, `test_self_and_dangling_links_ignored`, `test_property_and_frontmatter_links_counted`, `test_rename_keeps_backlinks`, `test_new_same_title_object_reresolves`, `test_listener_fires_on_every_change`)*
4. **Linking a mention edits only the mention.** One stamped write that changes exactly the matched characters (plus `lastUpdated`), byte-identical elsewhere (CRLF/BOM kept), refused when stale or when the text moved.
   - *(Task 4: `test_link_mention_changes_only_span`, `test_link_mention_crlf_bom_kept`, `test_link_mention_uses_alias_form_when_needed`, `test_link_mention_stale_409`, `test_link_mention_text_changed_422`)*
5. **Mentions and references follow the rules.** Word boundaries, case-insensitivity, exclusions (links, Markdown links, code, self, templates, role lists), the tab list per role, related tags.
   - *(Task 4: `test_mentions_word_boundaries_and_case`, `test_mentions_exclude_links_code_and_self`, `test_mentions_respect_roles`, `test_tabs_per_role`, `test_backlink_contexts_and_property_links`, `test_related_tags_cooccurrence`, `test_related_excludes_self_and_ranks_by_shared_terms`)*
6. **It is fast at 5,000 / 50,000.**
   - *(Task 2: `test_link_index_5000_objects_50000_links_under_2s`, `test_resolve_50000_links_under_1s`; Task 3: `test_search_p95_under_50ms_at_5000`, `test_second_start_sync_under_2s`; Task 4: `test_references_under_150ms_at_5000`; Task 5: `test_graph_5000_objects_under_300ms`; Task 11: `test filterGraph 5000 nodes 50000 links under 100ms`)*
7. **It reads the same as Object.** Every string is verbatim or marked; `GraphViewCustomization` keys and `ReferencesSectionTab` ids verbatim; role lists equal `structureHeuristicsBackbone.ts`; key bindings and our values (search highlight colour, node sizes, `LARGE_NODE_LIMIT`, indirect-link styling, related tags, lexical related content) are listed for Gene.
   - *(Task 2: `test_role_lists_match_reference`; Task 7: `test palette strings match reference`; Task 8: `test find bar strings and chrome width`; Task 9: `test tab labels, info tooltips and empty states match reference`; Task 11: `test customization labels and tooltips match reference`; Task 13 Step 5)*
8. **The UI writes safely.** The palette writes only through `createAndOpen`; the mention "Link" sends the row's version and reloads, never retries; Find replace edits go through the editor's autosave with its version and change only the replaced text.
   - *(Task 7: `test create new with title creates once and opens`; Task 8: `test replace all saves once through autosave and changes only matches`; Task 9: `test link a mention sends version and reloads`, `test 409 on link reloads without retry`)*

---

## File Structure

```
backend/objectapp/  roles.py resolver.py linkindex.py apictx.py                                  NEW (Task 2)
                    searchindex.py api_search.py api_references.py api_graph.py                   NEW as stubs (Task 2), replaced by Tasks 3, 4, 5
                    searchtext.py fuzzy.py                                                        NEW (Task 3)
                    references.py                                                                 NEW (Task 4)
                    graphdata.py                                                                  NEW (Task 5)
                    space.py server.py rows.py relink.py                                          MOD (Task 2 only)
backend/tests/      fixtures/space-links/  bigspace.py  conftest.py (MOD)  test_fixtures_m5.py    (Task 1)
                    test_roles.py test_resolver.py test_linkindex.py test_listeners.py test_backlinks_api.py   (Task 2)
                    test_jsonstore.py (MOD: Task 2) test_rows.py (MOD: Task 2)
                    test_searchtext.py test_fuzzy.py test_searchindex.py test_search_api.py       (Task 3)
                    test_references.py test_mention_link.py                                       (Task 4)
                    test_graphdata.py                                                             (Task 5)
scripts/m5_acceptance.py  scripts/m1_roundtrip.py scripts/m2_acceptance.py (MOD: snapshots skip .object-cache)   (Task 13)
frontend/src/api/{types,client}.ts test/mockApi.ts nav/tabs.ts App.tsx shell/Sidebar.tsx
             object/ObjectView.tsx object/PropertyPanel.tsx index.css                             MOD (Task 6 only)
frontend/src/palette/  usePalette.ts (Task 6)  CommandPalette.tsx (stub by 6, replaced by 7)
                       SearchView.tsx ActionsView.tsx actions.ts searchOptions.ts Highlight.tsx   (Task 7)
frontend/src/find/     useFind.ts (Task 6, extended by 8)  FindBar.tsx (stub by 6, replaced by 8)  findText.ts  (Task 8)
frontend/src/editor/   Editor.tsx useAutosave.ts (MOD)  extensions/findInPage.ts (NEW)            (Task 8 only)
frontend/src/references/ ReferencesSection.tsx (stub by 6, replaced by 9) useReferences.ts referencesUi.ts
                       BacklinksTab.tsx MentionsTab.tsx RelatedTab.tsx RelatedTagsTab.tsx         (Task 9)
frontend/src/properties/cells/SystemFieldCell.tsx views/{filter,group,properties}.ts views/table/tableConfig.ts
             views/cards/cardConfig.ts types/dashboardSections.ts types/TypeOverview.tsx tasks/taskSections.ts   MOD (Task 10 only)
frontend/src/graph/    GraphPage.tsx (stub by 6, replaced by 11)  LocalGraphPanel.tsx (stub by 6, replaced by 12)
                       useGraphData.ts useGraphUi.ts filterGraph.ts neighbourhood.ts graphStyle.ts layout.ts
                       GraphCanvas.tsx GraphToolbar.tsx GraphCustomization.tsx GraphLoading.tsx __fixtures__/bigGraph.ts   (Task 11)
```

### Shared files and ordering

| File | Edited by | Why it forces order |
|---|---|---|
| `backend/objectapp/space.py`, `server.py`, `rows.py`, `relink.py` | **Task 2 only** | Task 2 adds the listener hook, the resolver delegation, backlinks on `/api/object` and rows, the `graph` and `source` ui keys, the `SearchIndex` lifespan and the three router includes; Tasks 3–5 then touch only their own modules |
| `backend/objectapp/searchindex.py`, `api_search.py`, `api_references.py`, `api_graph.py` | stubs by Task 2; replaced in full by Task 3 (`searchindex.py`, `api_search.py`), Task 4 (`api_references.py`), Task 5 (`api_graph.py`) | the owner overwrites the stub; the stub's public names (below) are the contract |
| `backend/tests/conftest.py` | Task 1 only | the `links_space_dir`, `big_space_dir` and cache-isolation fixtures |
| `backend/tests/test_jsonstore.py`, `test_rows.py` | Task 2 only | Tasks 3–5 put their write-nothing tests in their own files |
| `backend/objectapp/watcher.py` | **no M5 change** | external edits already reach `Space.rescan_file`, which fires the listeners |
| `frontend/src/api/{types,client}.ts`, `test/mockApi.ts`, `nav/tabs.ts`, `App.tsx`, `shell/Sidebar.tsx`, `object/ObjectView.tsx`, `object/PropertyPanel.tsx`, `index.css` | **Task 6 only** | Task 6 lands before Tasks 7–12 start; after it no M5 task touches these files (M6's integrate edits them after Task 13) |
| `palette/CommandPalette.tsx`, `find/FindBar.tsx`, `references/ReferencesSection.tsx`, `graph/GraphPage.tsx`, `graph/LocalGraphPanel.tsx` | stubs by Task 6; replaced by Tasks 7, 8, 9, 11, 12 | the owner overwrites the stub and keeps its props |
| `find/useFind.ts` | Task 6 (the store), then Task 8 (extends it) | Task 6 → Task 8, same lane |
| `editor/Editor.tsx`, `editor/useAutosave.ts` | Task 8 only | the find plugin and the `BodyEditorHandle.find` member |
| `views/filter.ts`, `views/group.ts`, `views/properties.ts`, `views/table/tableConfig.ts`, `views/cards/cardConfig.ts`, `properties/cells/SystemFieldCell.tsx`, `types/dashboardSections.ts`, `types/TypeOverview.tsx`, `tasks/taskSections.ts` (and their tests) | **Task 10 only** | M3/M4 files, edited once M4 has landed (M4 Tasks 10, 11 and 15 own them during M4) |
| `graph/*` | Task 11, then Task 12 (`LocalGraphPanel.tsx` only, reusing Task 11's modules) | Task 11 → Task 12 |

Dependency edges: Task 1 → 2 → {3 → 4, 5}; Task 6 → {7 → 8, 9 → 10, 11 → 12}. The frontend never waits for the backend (it mocks the contract). **Lanes 3 and 4 start only once Task 6's commit (`feat(shell): search palette, graph target and M5 mounts`) is on the branch** (check `git log`; wait and re-check if not). Task 13 runs after all of Tasks 1–12.

---

### Task 1: Fixtures, `space-links`, the large-space generator and cache isolation (lane: backend)

**Files:**
- Create: `backend/tests/fixtures/space-links/**`, `backend/tests/bigspace.py`, `backend/tests/test_fixtures_m5.py`
- Modify: `backend/tests/conftest.py` (adds `links_space_dir`, `big_space_dir` (session scope) and the autouse `_search_cache_stays_in_the_sandbox`; existing fixtures untouched)

**Interfaces:**
- Produces: a synthetic, self-contained space for every M5 backend test; `make_big_space(root, objects=5000, links=50000, seed=1) -> BigStats` (deterministic: `Object 00001` … titles across Page, Person, Project, Task and Tag types, ~10 body links per object to seeded random others, some relation and frontmatter links, tags on a third of objects, a sprinkling of shared words for search, `BigStats(objects, links, distinct_pairs, sample_titles)` computed from what it wrote); `big_space_dir` builds it once per session under `tmp_path_factory` (tests only read it). The autouse fixture sets `OBJECT_CACHE_DIR` to `tmp_path_factory.mktemp("object-cache")`.

The space (all content invented, LF unless stated):
- `.object/types/`: `page.json`, `tag.json`, `task.json` (status options as M4), `dailynote.json`, `person.json` (custom: `aliases`, a relation `manager` to Person, a text `bio`, a text `notes` with `isNotSearchable: true`, and the system `backlinks` definition), `project.json` (custom: a multiple relation `members` to Person, a text `summary` that holds a wikilink, and the system `backlinks` definition).
- `People/Ada Lovelace.md` (aliases `Ada`, `Countess of Lovelace`; tags `Mathematics`, `Computing`; `createdAt` 2026-01-01), `People/Charles Babbage.md` (`manager: "[[Ada Lovelace]]"`, tags `Computing`, `History`, `bio` with the word "difference"), `Archive/Ada Lovelace.md` (a Page also titled "Ada Lovelace", created later, in a folder of its own, for resolution order: from anywhere but `Archive/` the People one wins by oldest `createdAt`, from inside `Archive/` this one wins by folder) and `Archive/Mention from archive.md` (plain text "Ada Lovelace", unlinked).
- `Pages/Analytical Engine.md`: links `[[Ada Lovelace]]` twice and `[[Charles Babbage|Babbage]]` once in the body; a fenced code block containing `[[Not A Link]]` and `[[Ada Lovelace]]`; an inline-code `` `[[Charles Babbage]]` ``; an unlinked plain "Charles Babbage" in a later paragraph; the lowercase word "ada" as a whole word.
- `Pages/Notes on mentions.md`: "Analytical Engine" unlinked twice (one at the start of a line, one mid-sentence with different case "analytical engine"), once inside `[Analytical Engine](https://example.invalid)`, once inside inline code, once as "Analytical Engines" (not a whole word), once already linked `[[Analytical Engine]]`.
- `Pages/CRLF mention.md`: CRLF line endings and a UTF-8 BOM, one unlinked "Analytical Engine".
- `Pages/Self link.md` (links itself), `Pages/Dangling.md` (links `[[Nobody Here]]`), `Pages/Unicode Café.md` (title with an accent; body "Crème brûlée recipe"), `Pages/Broken.md` (unterminated frontmatter fence, opens read-only; body links `[[Ada Lovelace]]`).
- `Projects/Difference Engine.md`: `members: ["[[Ada Lovelace]]", "[[Charles Babbage]]"]`, `summary: "Successor of [[Analytical Engine]]"`, tags `Computing`, `History`.
- `Tasks/Write paper.md` (status Done; body links `[[Analytical Engine]]`), `Tasks/Draft outline.md` (open; links `[[Difference Engine]]`; tags `Computing`), `Tasks/Loose task.md` (open, no links).
- `Tags/Computing.md`, `Tags/History.md`, `Tags/Mathematics.md`, `Tags/Unused.md`.
- `DailyNotes/2026-10-23.md`: links `[[Ada Lovelace]]`, mentions "Difference Engine" unlinked.
- `Templates/Pages/Linking template.md` (`template: Linking template`; links `[[Ada Lovelace]]`, mentions "Analytical Engine").
- `ui.json` absent; `.gitattributes` like the other fixture spaces plus `-text` on `Pages/CRLF mention.md`.

- [ ] **Step 1: Write failing tests** (`test_fixtures_m5.py`)
  - `test_every_md_has_unique_path_and_expected_inventory`: the files above exist; `Pages/CRLF mention.md` really is CRLF with a BOM; `Pages/Broken.md` opens read-only.
  - `test_space_opens_without_writing`: open twice; no file changed.
  - `test_big_space_is_deterministic_and_sized`: two generations with the same seed are byte-identical; 5,000 objects; the written body and relation links number 50,000 ± 1 %.
  - `test_cache_env_points_into_tmp` (the autouse fixture sets `OBJECT_CACHE_DIR` outside every space).
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_fixtures_m5.py -q`. Expected: FAIL.
- [ ] **Step 3:** Write the files, `bigspace.py` and the fixtures.
- [ ] **Step 4:** Run `uv run pytest backend/tests -q`. Expected: PASS.
- [ ] **Step 5:** Commit with the message:
  ```
  test(fixtures): synthetic links space, large-space generator and cache isolation

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

### Task 2: Roles, fast resolver, link index, live backlinks and the M5 server wiring (lane: backend)

**Files:**
- Create: `roles.py`, `resolver.py`, `linkindex.py`, `apictx.py`; stubs `searchindex.py`, `api_search.py`, `api_references.py`, `api_graph.py`
- Modify: `space.py`, `server.py`, `rows.py`, `relink.py`
- Test: `test_roles.py`, `test_resolver.py`, `test_linkindex.py`, `test_listeners.py`, `test_backlinks_api.py`; new cases in `test_rows.py` and `test_jsonstore.py` (`test_open_twice_writes_nothing` extended)

**Interfaces:**
- Consumes: Task 1; M1 `Space._raw`/`_summaries`/`_lock`, `rescan_file`, `_move_file`, `resolve`, `_link_text`; M2 `decode_value(pdef, raw, fm)`, `relink._segments`, `wikilink_targets`; M3 `rows.build_rows`/`_row`; M4 `typemodel.status_category`, `is_task_type`, `server._UI_PATCH_KEYS`/`_ui_problem`/`_TASK_SECTION_KEYS`, the `create_app` lifespan (both branches start the reminder scheduler).
- Produces:
  - `roles.py`: `role_of(t: TypeDefinition | None) -> str` and the frozensets `HAS_REFERENCES_SECTION`, `HAS_UNLINKED_MENTIONS`, `CAN_BE_UNLINKED_MENTION`, `CAN_HAVE_BACKLINKS`, `NO_GRAPH_SUPPORT` exactly as in Global Constraints (M6's integrate adds `RootWhiteboard` here).
  - `relink.py` (additions only; existing functions unchanged): `wikilink_spans(text) -> list[tuple[str, int, int]]` (target, start and end of the whole `[[…]]` or `![[…]]`, outside code) and `code_ranges(text) -> list[tuple[int, int]]` (fenced blocks and inline code spans).
  - `resolver.py`: `Resolver.build(summaries, aliases) -> Resolver` and `Resolver.resolve(link, from_path) -> str | None`, with dictionaries for the path form, exact title, alias (lowercased) and case-insensitive title/stem, each bucket sorted by the existing tie-break at lookup. `Space.resolve` delegates to a cached `Resolver`, rebuilt lazily when the names change (Global Constraints).
  - `linkindex.py`: `LinkIndex(space)` with `outgoing(path) -> set[str]`, `backlinks(path) -> list[str]` (distinct, title then path), `link_keys(src, dst) -> tuple[bool, list[str]]` (body link present, property keys), `edges() -> Iterator[tuple[str, str]]` (each undirected pair once), `tags_of(path) -> list[str]`, `tagged(tag_path) -> set[str]`, `revision: int` (bumped on every effective change). It records stored targets per source and resolves lazily; `on_change(SpaceChange)` only marks dirt.
  - `space.py`: `SpaceChange` (frozen dataclass), `Space.add_listener(fn) -> Callable[[], None]` (returns an unsubscribe), fired as in Global Constraints (inside `rescan_file` after the summary update, for both paths of `_move_file`, and from one `_types_changed()` helper called by every type mutation); `Space.links` (the lazy `LinkIndex`, registered as the first listener); `Space.backlinks(path) -> list[EntityRef dict]` (`{target: <link text of it from that object>, path}`) and `Space.outgoing(path) -> list[str]`; names-change detection in `rescan_file` (old vs new summary's `title`, `aliases`, `createdAt`, `template`, presence, path).
  - `rows.py`: `_row` sets every `entity_backlinks` definition's key to `space.backlinks(path)`; entity resolution keeps calling `space.resolve` (now fast).
  - `server.py`: `GET /api/object` adds `backlinks`; `_UI_PATCH_KEYS` gains `graph` and `_ui_problem` checks it (an object whose keys are only the nine `GraphViewCustomization` keys: two lists of strings and seven booleans; anything else 422 "Cannot patch: graph.<key>" (our string, M3's "Cannot patch: …" form)); `_TASK_SECTION_KEYS` gains `source`; `create_app` builds `ctx = ApiContext(space, announce, search)` (`apictx.py`: a dataclass holding the space, the `announce(ChangeEvent)` function `create_app` already defines and the `SearchIndex`), creates `search = SearchIndex(space)` (stub), starts it in **both** lifespan branches next to the reminder scheduler and stops it after the watcher, and includes `api_search.router(ctx)`, `api_references.router(ctx)`, `api_graph.router(ctx)` under `/api`.
  - **Stubs (the contract Tasks 3–5 keep):** `searchindex.SearchIndex(space, cache_dir: Path | None = None)` with `start()`, `stop()`, `ready: threading.Event` (set by the stub at `start()`), `search(q, types=(), exclude_types=(), tag=None, limit=50, mode='auto') -> dict` (stub: `{"results": [], "partial": True}`), `reindex()`, `phrase_candidates(text) -> set[str] | None` (stub: `None`, meaning "not available, scan"), `similar(path, limit) -> list[tuple[str, float]]` (stub: `[]`); `api_search.router(ctx)`, `api_references.router(ctx)`, `api_graph.router(ctx)` each return an `APIRouter()` with no routes.

- [ ] **Step 1: Write failing tests**
  - `test_role_lists_match_reference` (`test_roles.py`): each frozenset equals the lists above; `role_of` for every basic type, a media type and a custom type.
  - `test_fast_resolver_matches_reference_resolver` (`test_resolver.py`): a copy of today's `Space.resolve` algorithm lives in the test as `reference_resolve`; over `space-links`, `space-sample`, `space-v1` and a seeded random space (duplicate titles in several folders, aliases colliding with titles, case variants, path forms, templates), every (link text, from path) pair resolves identically, including `None`.
  - `test_resolver_invalidated_on_names_change`: renaming, creating a same-title object, adding an alias and deleting change resolution on the next call.
  - `test_wikilink_spans_and_code_ranges` (in `test_linkindex.py`): spans skip fenced and inline code, cover `![[…]]`, `#heading` and `|alias` forms; existing `relink` tests stay green (regression guard).
  - `test_backlinks_distinct_objects`: Analytical Engine links Ada twice → Ada's backlinks list it once.
  - `test_links_in_code_ignored`, `test_self_and_dangling_links_ignored`, `test_templates_never_sources_or_targets`.
  - `test_property_and_frontmatter_links_counted`: `manager`, `members` and the `summary` wikilink are links; `link_keys` reports their keys.
  - `test_tags_separate_from_links`: `tags_of`/`tagged` resolve names to Tag objects case-insensitively; tags never appear in `edges()`.
  - `test_rename_keeps_backlinks` (M2 rename relinks the referrers; the index follows) and `test_new_same_title_object_reresolves`.
  - `test_body_edit_updates_only_that_source`: after `save_body`, the index re-extracts one source (a spy counts extractions).
  - `test_listener_fires_on_every_change` (`test_listeners.py`): write, rename (old and new path), delete to trash, restore, external change through `rescan_file`, and a type save each fire the right `SpaceChange`; a listener that raises is logged and doesn't break the write.
  - `test_rows_carry_backlinks` (`test_rows.py`): Person rows have `values.backlinks` as `EntityRef` lists; types without the definition are unchanged.
  - `test_object_route_returns_backlinks` (`test_backlinks_api.py`).
  - `test_ui_graph_key` (`test_backlinks_api.py`): round trip, other keys kept, an unknown `graph` key 422, a wrong type 422, stale revision 409; `tasks.activeTab: 'source'` accepted.
  - `test_open_twice_writes_nothing` extended with `GET /api/object` for every object and `POST /api/rows` (green once the routes exist; the snapshot covers the whole tree).
  - `test_routers_mounted_and_search_stub_started`: the app starts and stops the stub index in both lifespan branches.
  - `test_link_index_5000_objects_50000_links_under_2s` and `test_resolve_50000_links_under_1s` (`big_space_dir`).
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_roles.py backend/tests/test_resolver.py backend/tests/test_linkindex.py backend/tests/test_listeners.py backend/tests/test_backlinks_api.py backend/tests/test_rows.py -q`. Expected: FAIL for the new tests.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `uv run pytest backend/tests -q`. Expected: PASS.
- [ ] **Step 5:** Commit with the message:
  ```
  feat(backend): link index, fast resolver, live backlinks and M5 server wiring

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

### Task 3: Full-text search index and the search route (lane: backend, sub-lane 1a)

**Files:**
- Create: `searchtext.py`, `fuzzy.py`; replace the stubs `searchindex.py`, `api_search.py`
- Test: `test_searchtext.py`, `test_fuzzy.py`, `test_searchindex.py`, `test_search_api.py`

**Interfaces:**
- Consumes: Task 2 (`Space.add_listener`, `SpaceChange`, `ApiContext`, the stub's public names), M1 `version_of`, `textfile.atomic_write` (for `.gitignore`), M2 `decode_value`, `PropertyDefinition.extra` (`isNotSearchable`).
- Produces:
  - `searchtext.plain_body(body) -> str`, `searchtext.property_text(t, fm, link_title) -> str` (the indexed `props` column, per Global Constraints).
  - `fuzzy.score(query, text) -> tuple[int, list[tuple[int, int]]] | None` (the scale in Global Constraints; spans index into `text`).
  - `searchindex.cache_dir_for(space) -> Path` and `SearchIndex` (the stub's names, now real): one `sqlite3` connection (`check_same_thread=False`) behind a lock; schema `meta(path TEXT PRIMARY KEY, version TEXT NOT NULL)` and `fts USING fts5(path UNINDEXED, type UNINDEXED, title, aliases, description, props, body, tags, tokenize='unicode61 remove_diacritics 2', prefix='2 3')` plus `vocab USING fts5vocab(fts, 'row')`; `PRAGMA user_version = INDEX_FORMAT`; the cache folder and its `.gitignore` (`*\n`) created only when absent; `start()` runs the sync on a thread and then drains a queue fed by the listener (debounce 200 ms; a `types` change re-indexes `props` for that type's members); `stop()` joins; `search(...)` per Global Constraints (title candidates from `space._summaries` and aliases from `space._raw`, filtered by type, excluded types and tag; FTS hits through `MATCH` with `bm25(fts, 0, 0, 10, 8, 3, 2, 1, 5)` and `snippet()` per matched column); `reindex()` (drop, recreate, `partial` until done); `phrase_candidates(text)` (paths whose `body` matches the phrase, or `None` before `ready`); `similar(path, limit)` (the lexical related-content query); the corrupt, locked and unwritable fallbacks.
  - `api_search.router(ctx)`: the two routes of the contract; `type`/`excludeType` are repeated query parameters; a type id that doesn't exist is ignored.

- [ ] **Step 1: Write failing tests** (`links_space_dir`; the cache in `tmp_path` unless the test unsets `OBJECT_CACHE_DIR`)
  - `test_plain_body_strips_markdown_keeps_text` (headings, lists, emphasis, link labels and targets, table cells, code text) and `test_property_text_skips_not_searchable_and_dates`.
  - `test_fuzzy_scale` (exact > prefix > word-prefix > substring > subsequence; `None` when not a subsequence; spans correct) and `test_fuzzy_alias_penalty`.
  - `test_body_word_found_with_snippet`: "difference" finds Charles Babbage through `props` (`properties` highlight) and Difference Engine through its title; snippets carry `\u0002…\u0003`.
  - `test_diacritics_and_prefix`: "cafe" and "cré" find Unicode Café.
  - `test_title_matches_rank_first` and `test_alias_match_found` ("Countess" finds Ada Lovelace with an `aliases` highlight).
  - `test_type_exclude_and_tag_filters`, `test_title_mode_skips_full_text`, `test_query_syntax_is_neutralised` (`"`, `*`, `NEAR`, `-`, `:` and `OR` never raise).
  - `test_templates_and_unreadable_files_excluded_or_readonly_indexed`: templates are never results; `Pages/Broken.md` is searchable by its body.
  - `test_index_follows_write_rename_delete_restore` (poll up to 2 s each) and `test_external_change_reindexed` (`rescan_file` after an outside write).
  - `test_partial_until_initial_sync` (a sync held by a test hook reports `partial: true`, then `false`).
  - `test_index_writes_only_cache_dir`: with `OBJECT_CACHE_DIR` unset, after start, search and stop the only new files are `.object-cache/search.sqlite` and `.object-cache/.gitignore`; no other byte in the space changed.
  - `test_cache_gitignore_hides_everything`: in a `git init`ed copy, `git status --porcelain -uall` is empty after indexing.
  - `test_cache_dir_env_override`: with `OBJECT_CACHE_DIR` set, nothing is created in the space.
  - `test_second_start_unchanged_space_writes_nothing`: bytes and `st_mtime_ns` of every cache file unchanged after a second start, sync and stop.
  - `test_only_changed_paths_reindexed_on_start`: edit one file while stopped; the second start re-indexes exactly that path (a spy).
  - `test_corrupt_cache_rebuilt` (garbage bytes in `search.sqlite`), `test_format_bump_rebuilds` (`user_version` changed), `test_unwritable_cache_falls_back_to_memory` (read-only cache folder; skipped on Windows when permissions can't be dropped, stated in the reason), `test_locked_cache_falls_back_to_memory` (a second connection holding an exclusive lock).
  - `test_reindex_route_rebuilds` (202, `partial` then results again) and `test_search_route_422s` (mode, limit, length).
  - `test_search_routes_write_nothing_to_space` (whole-tree snapshot before and after, cache outside the space).
  - `test_phrase_candidates_and_similar` (candidates contain the objects with the phrase; `similar` excludes the object itself and ranks objects sharing its strongest terms first; both `None`/`[]`-safe before `ready`).
  - `test_search_p95_under_50ms_at_5000` and `test_second_start_sync_under_2s` (`big_space_dir`, cache in `tmp_path`); `test_full_build_under_30s_at_5000`.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_searchtext.py backend/tests/test_fuzzy.py backend/tests/test_searchindex.py backend/tests/test_search_api.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `uv run pytest backend/tests -q`. Expected: PASS.
- [ ] **Step 5:** Commit with the message:
  ```
  feat(backend): FTS5 search index in .object-cache with fuzzy titles and the search route

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

### Task 4: References: backlinks in context, mentions, related, related tags, linking a mention (lane: backend, sub-lane 1a)

**Files:**
- Create: `references.py`; replace the stub `api_references.py`
- Test: `test_references.py`, `test_mention_link.py`

**Interfaces:**
- Consumes: Tasks 2–3 (`roles`, `Space.links`, `relink.wikilink_spans`/`code_ranges`, `SearchIndex.phrase_candidates`/`similar`, `ApiContext.announce`), M1 `Space._write(rel, base_version, edit)` (stamped), `Conflict`, `ReadOnly`, M2 `_link_text`.
- Produces:
  - `references.references(space, index, path, related_limit=20) -> dict` (the `References` shape, `summaries` for every path mentioned), built from `backlink_entries`, `unlinked_mentions`, `related`, `related_tags` (each per Global Constraints).
  - `references.link_mention(space, path, target, start, end, text, base_version) -> str` (the new version): one `Space._write` whose edit replaces `body[start:end]` after checking it equals `text`, the span is outside links and code, and `target` names an object with that title or alias; raises `InvalidValue` (→ 422) otherwise.
  - `api_references.router(ctx)`: `GET /api/references`, `POST /api/references/link` (announces `changed` for the mentioning path with `origin=clientId`).

- [ ] **Step 1: Write failing tests** (`links_space_dir`, the index started and `ready`)
  - `test_tabs_per_role`: Page and Person get all five (Person has tags) or four (no tags); a Task without tags `all, backlinks, related, mentions`; a Tag and a DailyNote get `[]`; Video (a generated media object) gets `[]`.
  - `test_backlink_contexts_and_property_links`: Ada's backlinks include Analytical Engine (two contexts, spans on the link label; the code-block link adds none), Charles Babbage (`properties: ['manager']`, no contexts), Difference Engine (`members`), the daily note and `Pages/Broken.md` (a read-only object is still an object); never the template.
  - `test_mentions_word_boundaries_and_case`: Analytical Engine's mentions in `Notes on mentions.md` are exactly the two unlinked occurrences (one lowercase); "Analytical Engines" and the Markdown-link and code ones are absent.
  - `test_mentions_exclude_links_code_and_self` and `test_mentions_respect_roles` (a Tag never mentions; the template never mentions; a DailyNote does).
  - `test_mentions_use_aliases_min_length`: "ada" (alias `Ada`) counts in Analytical Engine; a 2-letter alias added in the test never matches.
  - `test_mentions_scan_fallback_before_ready`: with `phrase_candidates` returning `None`, results are the same.
  - `test_related_excludes_self_and_ranks_by_shared_terms` and `test_related_limit`.
  - `test_related_tags_cooccurrence`: Ada (Mathematics, Computing) → History (shared with Computing on Babbage and Difference Engine), counts right; own tags excluded.
  - `test_link_mention_changes_only_span`: linking the first occurrence in `Notes on mentions.md` makes one version bump; difflib shows only that line changed plus `lastUpdated`; the inserted text is `[[Analytical Engine]]`, and for the lowercase occurrence `[[Analytical Engine|analytical engine]]`.
  - `test_link_mention_crlf_bom_kept` (`Pages/CRLF mention.md`: CRLF and BOM survive, every other byte identical).
  - `test_link_mention_uses_alias_form_when_needed`: linking the "Ada Lovelace" mention in `Archive/Mention from archive.md` to People/Ada Lovelace (from `Archive/` the Archive "Ada Lovelace" wins resolution) writes `[[People/Ada Lovelace|Ada Lovelace]]` (the path form) so it links the right object.
  - `test_link_mention_stale_409`, `test_link_mention_text_changed_422`, `test_link_mention_inside_link_or_code_422`, `test_link_mention_readonly_423`.
  - `test_link_route_announces_changed` and `test_references_get_writes_nothing`.
  - `test_references_under_150ms_at_5000` (`big_space_dir`, index ready).
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_references.py backend/tests/test_mention_link.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `uv run pytest backend/tests -q`. Expected: PASS.
- [ ] **Step 5:** Commit with the message:
  ```
  feat(backend): references with backlink context, unlinked mentions, related content and tags

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

### Task 5: Graph data (lane: backend, sub-lane 1b)

**Files:**
- Create: `graphdata.py`; replace the stub `api_graph.py`
- Test: `test_graphdata.py`

**Interfaces:**
- Consumes: Task 2 (`Space.links.edges()`, `tags_of`, `roles`), M2 `decode_value`, M4 `status_category`, `is_task_type`.
- Produces: `graphdata.graph_data(space) -> dict` (`GraphData`: nodes in path order, `links` flat with `a < b`, `tagged` flat, `degree`, `tag`, `daily`, `done`, `icon`), `api_graph.router(ctx)` with `GET /api/graph`.

- [ ] **Step 1: Write failing tests** (`links_space_dir`)
  - `test_nodes_are_non_template_objects`; `test_links_are_distinct_undirected_pairs` (Analytical Engine ↔ Ada once even though linked twice; `a < b`; equal to `set(space.links.edges())`).
  - `test_degree_counts_distinct_neighbours`, `test_flags_tag_daily_done` (Write paper `done`, Draft outline not; the daily note `daily`; the four tags `tag`).
  - `test_tagged_pairs` (Ada → Mathematics and Computing; Unused has none).
  - `test_graph_follows_edits` (a new link appears after `save_body`).
  - `test_graph_get_writes_nothing`.
  - `test_graph_5000_objects_under_300ms` (`big_space_dir`, route timed end to end through `TestClient`).
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_graphdata.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `uv run pytest backend/tests -q`. Expected: PASS.
- [ ] **Step 5:** Commit with the message:
  ```
  feat(backend): graph data route with link pairs, tags and node flags

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

### Task 6: Client v5, the graph target, M5 mounts and stubs (lane: shell and palette; first frontend task)

**Files:**
- Modify: `api/types.ts`, `api/client.ts`, `test/mockApi.ts`, `nav/tabs.ts`, `App.tsx`, `shell/Sidebar.tsx`, `object/ObjectView.tsx`, `object/PropertyPanel.tsx`, `index.css` (and their tests: `shell/Sidebar.test.tsx`, `nav/tabs.test.ts`)
- Create: `palette/usePalette.ts`, `find/useFind.ts`; stubs `palette/CommandPalette.tsx`, `find/FindBar.tsx`, `references/ReferencesSection.tsx`, `graph/GraphPage.tsx`, `graph/LocalGraphPanel.tsx`
- Test: `api/client.m5.test.ts`, `App.m5.test.tsx`, new cases in `nav/tabs.test.ts`, `shell/Sidebar.test.tsx`, `object/ObjectView.writes.test.tsx` and `object/PropertyPanel.test.tsx`

**Interfaces:**
- Consumes: the API contract; M1 `TopBar`, `RightPanel`, `MainPanel`, `App`'s `sidebarOpen`/`rightOpen` state; M3 `Sidebar`'s `onOpenTarget(t, o)`/`MainNavButton`; M4's `Target` kinds and `ObjectView` modes (`'page' | 'peek' | 'inline'`).
- Produces:
  - TS types for every contract shape; `ObjectDetail.backlinks: EntityRef[]`; `UiState.graph?: GraphCustomization`; `TaskSectionKey` gains `'source'`.
  - `api.search(q, {types?, excludeTypes?, tag?, limit?, mode?, signal?})`, `api.reindex()`, `api.references(path, {relatedLimit?})`, `api.linkMention({path, target, start, end, text, baseVersion})` (409 → `ConflictError` as M2; emits the local `changed` event for `path` like `saveBody`), `api.graph()`, and `api.patchUi`'s patch type widened with `graph`. `mockApi` defaults and the builders `searchResult(partial)`, `references(partial)`, `graphData(partial)`.
  - `Target` adds `{kind: 'graph'}`; `sameTarget` handles it; `TabLabel` shows "Graph" with `ph-graph`.
  - `palette/usePalette.ts` (zustand, not persisted): `{open: boolean, mode: 'search' | 'actions', show(mode), hide(), toggle(mode)}`. `find/useFind.ts`: `{path: string | null, open(path), close()}`.
  - `App.tsx`: renders `<GraphPage onOpenTarget={(t, o) => tabs.open(t, o)} />` for the graph target; `<RightPanel open={rightOpen}>` children become `<CalendarSidePanel />` for the calendar (M4, unchanged) and `<LocalGraphPanel path={target.path} />` for an object target; mounts `<CommandPalette onOpenTarget={(t, o) => tabs.open(t, o)} onToggleSidebar={() => setSidebarOpen(v => !v)} onToggleRightPanel={() => setRightOpen(v => !v)} onShowRightPanel={() => setRightOpen(true)} />` once beside `ObjectPeek`.
  - `Sidebar.tsx`: the square search button (today "Search (M5)") opens `usePalette.show('search')` with the tooltip "Search this space" (`shortcuts.openSearchPalette.name`); the Graph `NavItem` becomes a `MainNavButton` "Graph" (`GraphViewModal.globalGraph`, `ph-graph`) opening `{kind: 'graph'}` (Ctrl+click a new tab) with a new `graphActive` prop that `App` sets. M4's "Graph arrives in M5" hint and its test are removed.
  - `ObjectView.tsx`: in `page` and `peek` modes (never `inline`), below the editor inside `body`: `<ReferencesSection path={path} summary={summary} type={type} />`; in the toolbar area: `<FindBar path={path} editorRef={editorRef} />`; the `…` menu gains "Find in page" (`FindInPage.menuItem`, with the shortcut hint "Ctrl F" as `docs/README.md` shows it) calling `useFind.open(path)`; **Ctrl+F** opens it too while this view is the active one (`peek` mode, or `page` mode while no peek is open), also with focus in the editor (`preventDefault` stops the browser's find). Passes `backlinks={detail.backlinks ?? []}` to `PropertyPanel`.
  - `PropertyPanel.tsx`: `PropertyPanelProps.backlinks?: EntityRef[]`; `cellValue` returns it for `entity_backlinks` (today `null`), so M2's `BacklinksCell` shows the count until Task 10 renders chips.
  - `index.css`: the tokens and classes the lanes use: `--bg-search-highlight` (our value: the accent at 30 % alpha in dark, listed for Gene), `.search-highlights b { background-color: var(--bg-search-highlight); font-weight: inherit; border-radius: 2px }`, `.find-match` and `.find-match-current` (editor decorations), `.find-in-page-chrome { flex-shrink: 1; width: 20rem; min-width: 12rem; max-width: 100% }` (reference CSS), `.command-palette-list .menu-row { padding: .375rem .5rem }` (reference CSS), `.graph-canvas` (fills its box).
  - Stubs render `null` and accept the props above; their owners replace them.

- [ ] **Step 1: Write failing tests**
  - `test search builds repeated type params and passes the abort signal` (one `GET /api/search?q=…&type=a&type=b&excludeType=c&tag=…`)
  - `test references, graph and reindex call their routes` and `test linkMention 409 throws ConflictError and success emits changed`
  - `test graph target opens, goes back, dedupes; tab label Graph`
  - `test sidebar search button opens the search palette with its tooltip`; `test sidebar Graph item opens the graph target and shows active state`; `test M3 and M4 sidebar items still present` (regression guard, green from the start)
  - `test right panel shows the local graph for an object target and the calendar panel for the calendar`
  - `test object view mounts references and find bar in page and peek, not inline`
  - `test Find in page menu item and Ctrl+F open the find bar for the active view only`
  - `test property panel passes backlinks to the backlinks cell`
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/api src/nav src/shell src/object src/App.m5.test.tsx`. Expected: FAIL (all new tests except the labelled regression guard).
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit with the message:
  ```
  feat(shell): search palette, graph target and M5 mounts

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

### Task 7: The search palette and the action palette (lane: shell and palette)

**Files:**
- Create: `palette/{SearchView.tsx,ActionsView.tsx,actions.ts,searchOptions.ts,Highlight.tsx}`; replace the stub `palette/CommandPalette.tsx`
- Test: `palette/CommandPalette.test.tsx`, `palette/actions.test.ts`, `palette/searchOptions.test.ts`, `palette/Highlight.test.tsx`

**Interfaces:**
- Consumes: Task 6 (`usePalette`, `api.search`, the `CommandPalette` props); M1 `useTabs`, `usePeek`, `nav/recent.ts` (`useRecent.paths`), `links/linkIndex` (summaries and types for recents and type names), `create/createAndOpen.ts`, `isEditableTarget` (App); M4 `calendar/useCalendar` (`setView`, `today`); shadcn `Command` (`cmdk`).
- Produces:
  - `<CommandPalette>` (a `Dialog` with `Command`, the list classed `command-palette-list`): **Ctrl+K** toggles the search mode and **Ctrl+P** the action mode, from a window listener in the capture phase (so they work with the caret in the editor), while no other modal dialog is open. Esc closes. A footer button switches modes: "Switch to actions" / "Switch to search".
  - **Search mode** (`SearchView`): placeholder "Search content" (`CommandPalette.search.placeholderSearch`; the longer desktop placeholder mentions pasting, which M5 doesn't offer). Empty query: "Recently Opened" (`CommandPalette.recentlyOpened`) from `useRecent` (existing objects only), or "Nothing here yet" / "Objects you open will show up here for quick access." when there are none. Typing: `api.search` debounced 100 ms, the previous request aborted, stale responses dropped; each result shows the icon, the title with `titleMatches` in bold, the type name, and its first two snippets through `<Highlight>` (U+0002/U+0003 → `<b>` inside a `.search-highlights` span; no HTML parsing). Below the results, the option rows (`searchOptions.ts`, pure): "Create new {structureTitle} with title "{title}"" (the type filter's type if one is set, else Page), "Only search for type "{structureName}"" and "Exclude type "{structureName}"" for types whose name or plural fuzzy-matches the query, "Only search content tagged with "{tagName}"" for matching tags. Active filters show as chips in the input row with "Clear filter". No results: `No results for "{query}"` and "Try a different term, or remove filters to widen the search." (`CommandPalette.emptyState.*`). `partial` shows the line "Your content in not fully indexed yet. Search results might not return all matches." (verbatim, typo included).
  - Keys on a result: **Enter** opens it in the current tab, **Ctrl/Cmd+Enter** in a new tab, **Shift+Enter** in the peek (our bindings; Object's `openInTab`/`openInPreviewModal` keys are not in the trimmed reference).
  - **Action mode** (`ActionsView`, `actions.ts` pure: `buildActions(ctx) -> Action[]`): placeholder "Search for actions", group heading "All actions", items "Create {structureName}" for every type (by name; `createAndOpen`), "Open calendar", "Open today" (the calendar in Day view on today; never creates a daily note, as M4), "Open global graph", "Open graph view" (only while an object is the active target: shows the right panel, whose local graph Task 12 fills), "Toggle left sidebar", "Toggle right sidepanel" (`shortcuts.toggleLeftSidebar.name`, `shortcuts.toggleSidepanel.name`). Filtering is `cmdk`'s.

- [ ] **Step 1: Write failing tests**
  - `test Ctrl+K opens search, Ctrl+P opens actions, also with focus in the editor; Esc closes`
  - `test empty query lists recently opened objects; empty recents state`
  - `test typing debounces one request and drops stale responses`
  - `test results show bold title matches and snippets without parsing HTML` (a snippet containing `<img>` renders as text)
  - `test enter opens in the current tab, ctrl+enter in a new tab, shift+enter in the peek`
  - `test type include and exclude and tag options add chips and refetch; clear filter`
  - `test create new with title creates once and opens` (one `createObject` call with the title; uses the filter's type)
  - `test no results and partial index messages`
  - `test actions list and each action's effect` (calendar target, Day view on today with no `createDailyNote` call, graph target, right panel shown, sidebar toggled, create of a type)
  - `test open graph view only offered with an object open`
  - `test palette strings match reference`
- [ ] **Step 2:** Run `npx vitest run src/palette`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit with the message:
  ```
  feat(palette): Ctrl+K search palette and action palette

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

### Task 8: Find in page (lane: shell and palette)

**Files:**
- Create: `find/findText.ts`, `editor/extensions/findInPage.ts`; replace the stub `find/FindBar.tsx`
- Modify: `find/useFind.ts` (query and options state), `editor/Editor.tsx` (registers the extension), `editor/useAutosave.ts` (`BodyEditorHandle` gains an optional `find?: FindControl`)
- Test: `find/findText.test.ts`, `find/FindBar.test.tsx`, new cases in `editor/Editor.test.tsx`

**Interfaces:**
- Consumes: Task 6 (`useFind`, the `FindBar` props `{path, editorRef}`, the `.find-match*` and `.find-in-page-chrome` classes); M1 `Editor`, `useAutosave` (`BodyEditorHandle`), the byte-preserving save path (`editor/preserve.ts`).
- Produces:
  - `findText.findMatches(text, query, {matchCase, wholeWord}) -> {from, to}[]` (pure; whole word on Unicode word boundaries).
  - `findInPage` Tiptap extension: plugin state `{query, matchCase, wholeWord, index}`, decorations `find-match`/`find-match-current` over text nodes (wikilink atoms are matched by their label), commands `setFind`, `findNext`, `findPrevious` (wrapping, scrolling the current match into view), `replaceCurrent(text)`, `replaceAll(text)` (one transaction, so one autosave).
  - `FindControl` (on `BodyEditorHandle.find`): `{set(query, opts) -> count, next() -> index, previous() -> index, replace(text), replaceAll(text) -> count, clear()}`.
  - `<FindBar>`: the chrome (`find-in-page-chrome`) at the top right of the object view while `useFind.path === path`: input "Find" (`FindInPage.searchPlaceholder`), toggles "Match case" and "Match whole word", the count `{i}/{n}` (our format), buttons "Previous match" and "Next match" (Enter / Shift+Enter in the input do the same), "Toggle replace" revealing "Replace" (input placeholder) with "Replace" and "Replace all" buttons, and "Close" (Esc). No matches: `No results for "{query}"`. Closing clears the decorations. In raw mode the bar opens disabled with the line "Find works in the formatted editor." (our string).

- [ ] **Step 1: Write failing tests**
  - `test findMatches case and whole word` (Unicode letters, overlapping candidates, empty query)
  - `test decorations mark every match and the current one; next and previous wrap`
  - `test replace changes only the current match and autosaves with the version`
  - `test replace all saves once through autosave and changes only matches` (one `saveBody` call; the saved body differs from the original only at the matches, per `preserve`)
  - `test wikilink labels are matched but never split by replace` (replace skips atoms)
  - `test find bar opens from useFind, Esc closes and clears decorations`
  - `test find bar strings and chrome width`
  - `test raw mode shows the disabled bar`
- [ ] **Step 2:** Run `npx vitest run src/find src/editor`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit with the message:
  ```
  feat(find): find in page with match case, whole word and replace

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

### Task 9: The references section (lane: references)

**Files:**
- Create: `references/{useReferences.ts,referencesUi.ts,BacklinksTab.tsx,MentionsTab.tsx,RelatedTab.tsx,RelatedTagsTab.tsx}`; replace the stub `references/ReferencesSection.tsx`
- Test: `references/ReferencesSection.test.tsx`, `references/MentionsTab.test.tsx`, `references/referencesUi.test.ts`, `references/useReferences.test.ts`

**Interfaces:**
- Consumes: Task 6 (`api.references`, `api.linkMention`, `ConflictError`, the stub's props `{path, summary, type}`); M1 `usePeek.peek(path, list)`, `useTabs.open`, `api.onChange`; M2 `ObjectIcon`, `TypeChip`, `LabelPill`-style tag pills, the app's toast.
- Produces:
  - `useReferences(path, relatedLimit) -> {data, loading, reload}`: one `api.references` call; reloads (300 ms debounce) on any `created`, `deleted`, `renamed`, `changed` or `types` event while mounted.
  - `referencesUi.ts`: per-object `{tab: ReferencesTab, closed: boolean}` in `localStorage` (`object.references:<id or path>`, every access in try/catch; default `{tab: 'all', closed: false}`).
  - `<ReferencesSection>`: nothing when `data.tabs` is empty; otherwise a tab row: "All" (`PageBacklinkSection.all`), "Backlinks" (`.incoming`, info tooltip "Links to this object"), "Related Content" (`.relatedContent.label`, info "Similar objects"), "Mentions" (`.unlinkedMentions.label`, info "Unlinked name matches"), "Related tags" (`components.RootTag.relatedTags`), each with a muted count (our addition). The active tab is a filled pill; clicking it again hides the content (tooltip "Click again to hide", `PageBacklinkSection.clickAgainToHide`) and clicking any tab shows it. "All" stacks the other tabs' content in tab order, each under its tab label.
  - `BacklinksTab`: one entry per backlink: the object's icon, title and type chip, then its contexts with the link span highlighted ("Mentions in text"), or "via {property}" (our string, the property names from the object's type) for property links. Click opens the peek with the backlinks as the pager list; Ctrl/Cmd+click opens a tab. Empty: "No backlinks yet" and "Link to this object from another page to create a backlink." (`PageBacklinkSection.emptyTitle`, `.emptyDescription`).
  - `MentionsTab`: entries per mentioning object with each occurrence's context (match highlighted) and a "Link" button (`textEditBar.link`) that calls `api.linkMention({path, target, start, end, text, baseVersion: entry.version})`, toasts "Link created" and reloads; on `ConflictError` or 422 it reloads and toasts "Changed elsewhere. Reloaded." (our string). Empty: "No unlinked mentions" (our string).
  - `RelatedTab`: object entries with "Show more" (`PageBacklinkSection.relatedContent.showMore`, +20); empty "No related content yet" (`.relatedContent.emptyTitle`) with the line "Objects that share words with this one will appear here." (our string; Object's text says "Semantically", which ours isn't).
  - `RelatedTagsTab`: tag pills with counts; click opens the Tag object; empty "No related tags" (our string).

- [ ] **Step 1: Write failing tests**
  - `test no section when the object offers no tabs`
  - `test tab labels, info tooltips and empty states match reference`
  - `test all stacks tabs in order; clicking the active tab hides and remembers per object`
  - `test backlink contexts highlight the link and property backlinks say via`
  - `test backlink click peeks with the backlinks list; ctrl+click opens a tab`
  - `test link a mention sends version and reloads` (one `linkMention` with the entry's version, then one `references` call, "Link created")
  - `test 409 on link reloads without retry`
  - `test related show more raises the limit` and `test related tags open the tag`
  - `test reloads once on a burst of change events`
- [ ] **Step 2:** Run `npx vitest run src/references`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit with the message:
  ```
  feat(references): references section with backlinks, mentions, related content and related tags

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

### Task 10: The backlinks property becomes live; "No backlinks" and Task "Context" sections (lane: references)

**Files:**
- Modify: `properties/cells/SystemFieldCell.tsx` (`BacklinksCell`), `views/filter.ts`, `views/group.ts`, `views/properties.ts`, `views/table/tableConfig.ts`, `views/cards/cardConfig.ts`, `types/dashboardSections.ts`, `types/TypeOverview.tsx`, `tasks/taskSections.ts` (with their tests)
- Test: new cases in `properties/cells/cells.test.tsx`, `views/filter.test.ts`, `views/group.test.ts`, `views/table/*.test.tsx` (the table config test), `types/dashboardSections.test.ts`, `tasks/taskSections.test.ts` (M4's `test no Context section` is replaced)

**Interfaces:**
- Consumes: Tasks 6 and 9 (`Row.values[backlinks key]`, `PropertyPanel`'s `backlinks`); M3 `FILTER_OPTIONS.entity_backlinks` (`contains`), `rowValue`, `matchFilter`, `entityPaths`, `GROUP_OPTIONS`, `groupRows`'s `entity` grouping and `GroupCtx.entityTitles`, `tableColumns`, `cardFields`; M3 `BUILTIN_KEYS`/`BUILTIN_META`/`describe`/`buildSections`/`addableSections`; M4 `TASK_SECTIONS`, `TaskSectionKey`.
- Produces:
  - `BacklinksCell`: the linking objects as M2's read-only link chips (click peeks with them as the list), "Empty" when none; the count stays the cell's value in tables where chips don't fit (`density`).
  - `views/filter.ts`: `rowValue(row, 'backlinks')` returns the row's backlinks refs (today `undefined`); `matchFilter` evaluates `entity_backlinks` like `entity` (`contains`/`notContains` by referenced object, through `entityPaths`; today it returns `option === 'notContains'`). The operators offered stay M3's list.
  - `views/group.ts`: `entity_backlinks` groups like `entity` (one group per linking object, "Other" for none).
  - `views/properties.ts`, `tableConfig.ts`, `cardConfig.ts`: the backlinks definition is no longer skipped (a read-only column and card field).
  - `dashboardSections.ts`/`TypeOverview.tsx`: built-in `noBacklinks` ("No backlinks", "All objects that are not linked in any other content.", `DatabaseDashboard.sections.noBacklinks.*`; icon `ph-line-segment`, `inFullView: true` like `notTagged`) for types whose role can have backlinks (every type but DailyNote and Video), rows with no backlinks, list layout; offered in "Add a section", not in the default set; `buildSections` no longer drops it.
  - `tasks/taskSections.ts`: `source` "Context" ("Tasks organized by the objects they are mentioned in.", `DatabaseDashboard.sections.tasks.source.*`): open tasks grouped by the backlinks property, list layout; its view saved in `ui.tasks.views.source` like the others.

- [ ] **Step 1: Write failing tests**
  - `test backlinks cell shows chips and peeks; empty`
  - `test backlinks filter contains and not contains by object`
  - `test group by backlinks gives one group per linking object and Other`
  - `test table and cards offer the backlinks field read-only`
  - `test no backlinks section addable, lists unlinked objects, title and description match reference`
  - `test Context section groups open tasks by linking objects` (replaces M4's `test no Context section`)
  - all M3 and M4 `views`, `types` and `tasks` tests still green.
- [ ] **Step 2:** Run `npx vitest run src/properties src/views src/types src/tasks`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit with the message:
  ```
  feat(views): live backlinks property, No backlinks section and the Task Context section

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

### Task 11: The global graph (lane: graph)

**Files:**
- Create: `graph/{useGraphData.ts,useGraphUi.ts,filterGraph.ts,neighbourhood.ts,graphStyle.ts,layout.ts,GraphCanvas.tsx,GraphToolbar.tsx,GraphCustomization.tsx,GraphLoading.tsx,__fixtures__/bigGraph.ts}`; replace the stub `graph/GraphPage.tsx`
- Test: `graph/filterGraph.test.ts`, `graph/neighbourhood.test.ts`, `graph/graphStyle.test.ts`, `graph/useGraphUi.test.ts`, `graph/GraphPage.test.tsx`, `graph/GraphCustomization.test.tsx`

**Interfaces:**
- Consumes: Task 6 (`api.graph`, `api.ui`/`api.patchUi` with `graph`, the `GraphPage` props `{onOpenTarget}`, `.graph-canvas`); M1 `usePeek`, `api.onChange`; M2 `theme/palette.ts` (type colours), `TypeDef.color`; the new dependencies (`sigma`, `graphology`, `graphology-layout-forceatlas2/worker`). In tests `sigma` and the layout worker are mocked (`vi.mock`), since jsdom has no WebGL or workers; every rule lives in the pure modules.
- Produces:
  - `useGraphData()` (zustand): `{data: GraphData | null, loading, reload}`; one `api.graph()`; reloads (500 ms debounce) on `created`, `deleted`, `renamed`, `changed`, `types`. Shared by Task 12.
  - `useGraphUi() -> {custom: GraphCustomization, patch(partial)}`: reads `ui.graph`, writes `api.patchUi({graph}, {baseRevision})` debounced 400 ms, refetches and re-applies once on 409 (M3's `useViewState` pattern).
  - `filterGraph(data, custom, scope: {kind: 'global'} | {kind: 'local', center: number, hops: 1 | 2}) -> VisibleGraph` (`{nodes: number[], links: [a, b][], indirect: [a, b][], tagLinks: [a, b][]}`), every rule of "Graph semantics", `LARGE_NODE_LIMIT = 100`, `INDIRECT_MAX_NEIGHBOURS = 10`, `INDIRECT_MAX_EDGES = 50000`. `neighbourhood(data, center, hops, includeTagged) -> Set<number>`.
  - `graphStyle`: `nodeSize(degree)`, `nodeColor(node, typesById)`, `edgeStyle(kind)` (indirect dashed at lower alpha).
  - `layout.ts`: `runLayout(graph, {signal}) -> Promise<void>` around the FA2 worker: initial positions from a hash of the path (deterministic), `inferSettings` plus Barnes-Hut above 500 nodes, stops when the mean displacement falls below a threshold or after 4 s; exposes progress for `GraphLoading`.
  - `<GraphCanvas data visible custom onNodeClick(path, event) focusPath? fitSignal?>`: one sigma instance per mount (killed on unmount), node and edge reducers for hover (the hovered node's neighbours stay bright, others dim), labels hidden with `showMinimalNodes`, `focusPath` animates the camera to that node, `fitSignal` resets the camera ("Fit graph to view").
  - `<GraphLoading>`: the step lines while loading and laying out: "Reading objects", "Calculating connections", "Applying filters", "Arranging the layout", "Drawing the graph" (`GraphViewModal.loading.steps.*`).
  - `<GraphCustomization>`: a popover from the toolbar button "Customize" (`general.customize`): "Filter object types" and "Exclude object types" (type multi-selects with "Deselect all"), switches "Show completed tasks", "Show simplified graph", "Hide objects with many links" (tooltip "Nodes with more than {limit} links are hidden" with 100), "Hide dates", "Hide indirect links" (tooltip "Links that only pass through a hidden object are not shown."), "Show tags network" (writes `showSpaceTagsNetwork` on the global graph, `showTagsNetwork` on a Tag's local graph).
  - `<GraphPage>`: header "Graph" with the `ph-graph` tile; `GraphToolbar` with the search field "Search for a note in the graph" (fuzzy over visible titles; Enter focuses the best match), "Fit graph to view" and "Customize"; the canvas; empty states "Nothing to show" with "There is nothing in this graph yet." or, when filters hide everything, "The current filters are hiding everything in this graph." (`GraphViewModal.empty.*`). Clicking a node opens it in the peek with the visible nodes as the pager list; Ctrl/Cmd+click opens a tab.

- [ ] **Step 1: Write failing tests**
  - `test type filter and exclude, exclude wins`
  - `test completed tasks hidden by default and shown with the switch`
  - `test hide dates hides daily notes; hide large nodes uses the limit`
  - `test indirect links through a hidden node, capped by neighbours and total; hideIndirectLinks drops them`
  - `test space tags network shows every tag and co-tag edges`
  - `test neighbourhood one and two hops; tag centre with tags network includes tagged objects; centre never hidden`
  - `test node size and colour by degree and type`
  - `test filterGraph 5000 nodes 50000 links under 100ms` (`__fixtures__/bigGraph.ts`)
  - `test graph ui patch debounced and 409 refetches once`
  - `test customization labels and tooltips match reference`
  - `test page shows loading steps, then the canvas; empty and filtered-empty states`
  - `test node click peeks with visible nodes; ctrl+click opens a tab` (through the mocked sigma's click handler)
  - `test search in graph focuses the best match; fit resets the camera`
  - `test graph data reloads once on a burst of change events`
- [ ] **Step 2:** Run `npx vitest run src/graph`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit && npm run build`. Expected: PASS (the build proves sigma and the worker bundle).
- [ ] **Step 5:** Commit with the message:
  ```
  feat(graph): global graph with sigma, forceatlas2 layout and Object filters

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

### Task 12: The local graph in the right panel (lane: graph)

**Files:**
- Replace the stub: `graph/LocalGraphPanel.tsx`
- Test: `graph/LocalGraphPanel.test.tsx`

**Interfaces:**
- Consumes: Task 11 (`useGraphData`, `useGraphUi`, `filterGraph` with the local scope, `GraphCanvas`, `GraphCustomization`, `GraphLoading`); Task 6 (the `{path}` prop; `RightPanel` renders it for an object target); M1 `usePeek`, `useTabs`.
- Produces: `<LocalGraphPanel path>`: heading "Graph View" (`GraphViewModal.label`), "Maximum distance" (`GraphViewModal.hops.label`) with the current hops and "Show more" / "Show less" (`.hops.showMore`/`.showLess`, 1 ↔ 2; default 1; remembered in `localStorage`), "Customize" (the same popover; "Show tags network" writes `showTagsNetwork` when the centre is a Tag), "Fit graph to view", the canvas with the centre node highlighted and labelled, the same empty states, and clicks as on the global graph. It follows the active object (re-centres on a path change) and the graph data reloads.

- [ ] **Step 1: Write failing tests**
  - `test local graph shows the centre and its one-hop neighbours; show more adds the second hop and remembers it`
  - `test centre stays visible under filters that would hide it`
  - `test tag centre with tags network includes tagged objects`
  - `test re-centres when the active object changes`
  - `test node click peeks; ctrl+click opens a tab`
  - `test labels match reference`
- [ ] **Step 2:** Run `npx vitest run src/graph`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit && npm run lint && npm run build`. Expected: PASS, clean.
- [ ] **Step 5:** Commit with the message:
  ```
  feat(graph): local graph of the open object in the right panel

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

### Task 13: Milestone acceptance (lane: integrate; after Tasks 1–12)

**Files:**
- Create: `scripts/m5_acceptance.py`, `docs/superpowers/plans/m5-acceptance.md`
- Modify: `scripts/m1_roundtrip.py` and `scripts/m2_acceptance.py` (their whole-tree `snapshot` helpers skip `.object-cache/`, derived data like `.git`; nothing else changes), `docs/superpowers/plans/remaining-work.md` (the M5 rows only)

- [ ] **Step 1:** Run `uv run pytest backend/tests -q` and `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run lint && npm run build`. Expected: all green.
- [ ] **Step 2:** Write `scripts/m5_acceptance.py SPACE [--keep] [--big]` (run as `uv run python scripts/m5_acceptance.py SPACE`). Like `m3_acceptance.py`, it works on a temporary git-committed copy and starts the server on a free port **without** `OBJECT_CACHE_DIR` (so the default `.object-cache/` is exercised). Over HTTP it checks:
  1. Starting, waiting for `partial: false`, calling every M5 read (`GET /api/search` for a few words, `GET /api/references` and `GET /api/object` for every object, `GET /api/graph`, `POST /api/rows`) leaves `git status --porcelain -uall` empty and every file outside `.object-cache/` byte-identical; `.object-cache/` holds only `search.sqlite` and `.gitignore`. A second start changes no byte or mtime in the cache.
  2. Search: a word that occurs only in one body finds that object with a snippet; a misspelt-by-omission title ("Analytcal Engne" on `space-links`, or a title subsequence chosen from the space) finds it by title; `type`, `excludeType` and `tag` filter; after `PUT /api/object/body` adds a new word it is found within 2 s; after `DELETE` the object is gone; after an external write to a file (the watcher) its new word is found within 2 s.
  3. Deleting `.object-cache/search.sqlite` while running and calling `POST /api/search/reindex` rebuilds it; writing garbage into it and restarting rebuilds it with no error.
  4. References: for objects with links, `GET /api/references` backlink paths equal `GET /api/object` `backlinks` paths and the set computed by the script from the files (a minimal wikilink scan that skips code); a mention is linked with `POST /api/references/link` and the `git diff` of that file is exactly the mention line plus `lastUpdated`; a stale `baseVersion` is 409.
  5. Graph: `GET /api/graph` node count equals `GET /api/objects`, its link pairs equal the script's pair set; `PUT /api/ui` with `graph` changes only `.object/ui.json`; a stale revision is 409; an unknown `graph` key is 422.
  6. Renaming an object (`PUT /api/object/rename`) keeps its backlinks (paths updated) and search finds the new title.
  7. With `--big`: on a generated 5,000-object / 50,000-link space (`backend/tests/bigspace.py`), prints the timings of the full build, a second start, 20 searches (p95), `GET /api/references` for 20 objects (max) and `GET /api/graph`, and fails if a budget of the Performance bar is exceeded (with `OBJECT_PERF_SLACK` honoured).
  8. The M1 no-edit pass (`scripts/m1_roundtrip.py` logic, with the cache skipped): 0 files changed.
- [ ] **Step 3:** Run it on copies of `backend/tests/fixtures/space-links`, `space-sample`, `space-v1` and `space-calendar`, and once with `--big`. Expected: every check prints `[ok]`. Also run `scripts/m1_roundtrip.py`, `m2_acceptance.py`, `m3_acceptance.py` and `m4_acceptance.py` on fixture copies: still PASS (the cache never shows in `git status`).
- [ ] **Step 4:** Run `npm run build`, then `uv run objectapp --space <copy of space-links>`, and walk through: Ctrl+K with an empty query (recents), typing a body word, a fuzzy title, the type/exclude/tag options and their chips, "Create new … with title …", Enter / Ctrl+Enter / Shift+Enter; Ctrl+P and every action; Find in page from the `…` menu and Ctrl+F (match case, whole word, next/previous, replace, replace all, then `git diff`); the references section on Ada Lovelace (all five tabs, hiding by clicking the active tab, linking a mention, then `git diff`); the backlinks property in the panel, a table column, a backlinks filter and group; the "No backlinks" Overview section; the Tasks page Context tab; the global graph (filters, tags network, search, fit, click to peek) and the local graph (hops); on a `--big` copy, the global graph's pan and zoom and the palette's typing at 5,000 objects.
- [ ] **Step 5:** Gene runs the app on his CPI copy outside the repo (with `git init` done there). Record in `m5-acceptance.md`, unchecked until he does them:
  - opening creates only `.object-cache/` and `git status` stays clean; deleting the folder loses nothing and it comes back
  - search finds what he expects by title and by text; the snippets read well; `partial` disappears after the first indexing
  - backlinks match what Object showed for a few objects he knows well; linking a mention changes only that text (`git diff`)
  - the graph at his space's size pans, zooms and filters without stalls
  - side by side with Object, **explicitly the things this plan decided without a reference:** the Ctrl+K / Ctrl+P / Enter-variant key bindings, the search highlight colour, node sizes and colours, the indirect-link styling and the 10-neighbour cap, `LARGE_NODE_LIMIT = 100`, the "Related tags" rule, the lexical "Related Content" (a proxy for Object's semantic one), the tab counts, "via {property}" and the other "our strings" (note what Object does differently so a fix pass can follow)
- [ ] **Step 6:** Update the M5 section of `remaining-work.md` to "built" with what Task 13 found, then commit with the message:
  ```
  chore: milestone 5 acceptance

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

## Build lanes

Each lane runs its first tasks in order, then its sub-lanes in parallel (each in order). Lanes run side by side; their file sets are disjoint (see "Shared files and ordering"). The dependency install commit (Tech Stack) lands before any lane starts.

| Lane | First, in order | Then, sub-lanes in parallel (each in order) | Files it owns |
|---|---|---|---|
| **1. Backend** | Task 1 → Task 2 | **1a:** Task 3 → Task 4 · **1b:** Task 5 | `backend/**` (Task 2 alone touches `space.py`, `server.py`, `rows.py`, `relink.py`, `test_jsonstore.py`, `test_rows.py`; 1a owns `searchindex.py`, `searchtext.py`, `fuzzy.py`, `api_search.py`, `references.py`, `api_references.py` and their tests; 1b owns `graphdata.py`, `api_graph.py`, `test_graphdata.py`) |
| **2. Shell and palette** | Task 6 → Task 7 → Task 8 | (none) | the shared frontend files (Task 6 only), `palette/**`, `find/**`, `editor/Editor.tsx`, `editor/useAutosave.ts`, `editor/extensions/findInPage.ts` |
| **3. References** | Task 9 → Task 10 (**starts once Task 6's commit is on the branch**) | (none) | `references/**`; Task 10's M3/M4 files (`views/{filter,group,properties}.ts`, `views/table/tableConfig.ts`, `views/cards/cardConfig.ts`, `properties/cells/SystemFieldCell.tsx`, `types/dashboardSections.ts`, `types/TypeOverview.tsx`, `tasks/taskSections.ts`) |
| **4. Graph** | Task 11 → Task 12 (**starts once Task 6's commit is on the branch**) | (none) | `graph/**` |
| **Integrate** | **Task 13**, after every task of lanes 1–4 | | `scripts/m5_acceptance.py`, the snapshot helpers of `scripts/m1_roundtrip.py` and `scripts/m2_acceptance.py`, `docs/superpowers/plans/m5-acceptance.md`, `remaining-work.md` (M5 rows) |

- For the saved two-track build script (`scripts/workflows/object-milestone-build.js`), the equivalent args are `{"backend":[1,2,3,4,5],"frontend":[6,7,8,9,10,11,12],"integrate":13,"milestone":"Milestone 5","perTaskReview":false}`; run the four lanes when the script supports more tracks (`build-process.md`).
- **With M6:** M6's lanes run beside these and touch only new files; **M6's integrate starts after Task 13** and is the only M6 step that edits the shared files listed in Global Constraints, `roles.py` included.
- Concurrent commits can hit `index.lock`: wait and retry; `git add` explicit paths only.
- Then, per `build-process.md`: one whole-milestone review (correctness and integration, file safety, fidelity), one fix pass, the final gate.

## Change history

- **2026-10-26, first version**, written against the code on this branch while M4 was being built (M4 Tasks 1–9 and 12 committed, 10, 11 and 13–16 in progress). Reconcile after M4 lands: the M4 names this plan uses (`TASK_SECTIONS`, `TaskSectionKey`, `_TASK_SECTION_KEYS`, `GROUP_OPTIONS(kind, def?)`, `dashboardSections.ts`'s M4 `unreviewed` key, `ObjectView`'s `inline` mode and `onChangeMany` prop, `RightPanel` children for the calendar) and the test baseline counts.
