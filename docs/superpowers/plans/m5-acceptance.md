# Milestone 5 acceptance

Plan: `2026-10-26-m5-search-palette-backlinks-graph.md`, Task 13. Date: 2026-10-27. Built on a Linux cloud container, not Gene's Windows PC.

## Automated results

| Suite | Command | Result |
|---|---|---|
| Back end | `uv run pytest backend/tests -q` | 836 passed, 1 skipped (the read-only-folder test, skipped as root) |
| Front end | `cd frontend && npx vitest run` | 998 passed (160 files) |
| Type check | `cd frontend && npx tsc -b --noEmit` | clean |
| Lint | `cd frontend && npm run lint` | exit 0 (warnings only) |
| Build | `cd frontend && npm run build` | built (`dist/`; sigma in its own chunk) |
| M5 acceptance | `uv run python scripts/m5_acceptance.py backend/tests/fixtures/space-links` | PASS |
| M5 acceptance | `… space-sample`, `… space-v1`, `… space-calendar` | PASS |
| M5 acceptance, large space | `uv run python scripts/m5_acceptance.py backend/tests/fixtures/space-links --big` | PASS (timings below) |
| Earlier milestones | `m1_roundtrip.py` on `space-sample` and `space-links`; `m2_acceptance.py` and `m3_acceptance.py` on `space-sample`; `m3_acceptance.py` on `space-links`; `m4_acceptance.py` on `space-calendar` and `space-sample` | PASS |

In one full backend run, `test_search_p95_under_50ms_at_5000` failed under load. It passed when run alone and in the next full run. It is load-sensitive, like the vitest "1MB body splits under 300ms" case.

`--big` timings with `OBJECT_PERF_SLACK=1`, measured over HTTP on the generated 5,000-object / 50,000-link space:

| Measure | Took | Budget |
|---|---|---|
| Full index build in the background | 824 ms | 30 s |
| Second start's sync | 8 ms | 2 s |
| First `GET /api/references` (it builds the link index) | 604 ms | 2 s (the link index budget) |
| Search p95 over 20 queries | 19 ms | 50 ms |
| `GET /api/references`, max over 20 objects (warm) | 34 ms | 150 ms |
| `GET /api/graph` (warm) | 90 ms | 300 ms |

### `scripts/m5_acceptance.py`

The script works on a temporary git-committed copy of the space. It serves the copy on a free `127.0.0.1` port with `OBJECT_CACHE_DIR` unset, so the default `.capacities-cache/` inside the space is used. It runs the plan's checks:

1. Start, wait for `partial: false`, then call every M5 read: search, references and object for every object, graph, rows. Afterwards `git status` is empty, and every file outside the cache is byte-identical. The cache gains only `search.sqlite` and `.gitignore` (`*`); `ignored.md` in `space-sample` and `space-v1` is unchanged. A second start changes no byte or mtime in the cache.
2. Search:
   - A word that only one body contains finds that object, with a snippet.
   - A title with letters left out finds its object (on `space-links`, "Analytcal Engne").
   - `type`, `excludeType` and `tag` filter correctly.
   - A word added with `PUT /api/object/body` is found within 2 s (0.21 s).
   - A deleted object disappears from search.
   - A file written from outside the app is found within 2 s (0.21 s).
3. Rebuilding the index:
   - Delete `search.sqlite` while the server runs, then `POST /api/search/reindex`: the file is rebuilt.
   - Write garbage into it and restart: it is rebuilt to a valid SQLite file with no error.
4. References:
   - For every object, the backlinks from `GET /api/references`, the `backlinks` from `GET /api/object` and the script's own count from the files all match. The script's count uses a minimal wikilink scan that skips code, plus its own copy of the resolver order.
   - Linking a mention changes only the mention line plus `lastUpdated`, and keeps BOM and CRLF. A second call with the stale `baseVersion` returns 409. On `space-links` the linked mention is "Ada Lovelace" in `Archive/Mention from archive.md`. The other fixtures have no unlinked mentions, so this part is skipped there and the script logs that.
5. Graph:
   - The node count equals `GET /api/objects`, and the link pairs equal the files' pairs. Each pair is `a < b` and appears once.
   - `PUT /api/ui` with `graph` writes only `.capacities/ui.json`. A stale revision returns 409, and an unknown `graph` key returns 422.
6. Renaming an object (`POST /api/object/rename`) keeps its backlinks, and search finds the new title.
7. `--big`: the timings above, with `OBJECT_PERF_SLACK` applied. The first references call is timed on its own, because it builds the link index, and then the warm budget is applied (as `test_references_under_150ms_at_5000` does).
8. The M1 no-edit pass changes 0 files. Finally, `git status` never shows the cache.

`m1_roundtrip.py` (`snapshot`) and `m2_acceptance.py` (`snapshot`) now skip `.capacities-cache/`, as they skip `.git`. Nothing else in those scripts changed.

### Wiring fixes made in this task

1. **Rows now carry backlinks on every type.** Before this fix, `rows.py` sent `values.backlinks` only for types that had the `entity_backlinks` definition. Page, Task and most built-in types don't have it. As a result, in real use every task fell into "Other" in the Tasks page Context section, and "No backlinks" could only be offered on Person/Project-like types (reported by Task 10).
   - Backlinks are a system property of every object in Capacities (`systemPropertyTypeToIdMap`: `entity_backlinks` → `backlinks`). Each row now carries `values.backlinks` under that id when no definition already uses the key `backlinks`.
   - On the client, the `typeHasBacklinks` gate in `types/dashboardSections.ts` is removed, so "No backlinks" is offered on every type that can have backlinks.
   - Tests updated: `test_rows_carry_backlinks` and `dashboardSections.test.ts`.
   - This widens the contract line `Row.values += { [key of the type's entity_backlinks definition]: EntityRef[] }`. Rows now also carry the key `backlinks` on types without that definition.
2. **Reindex after the cache file is deleted.**
   - The problem: deleting `search.sqlite` while the app ran, then calling `POST /api/search/reindex`, failed with "attempt to write a readonly database". The old connection still pointed at the unlinked file, so the index fell back to memory and never recreated the file (acceptance check 3).
   - The fix: `SearchIndex._rebuild` now closes the connection and reopens the file before it drops and rebuilds.
   - New test: `test_reindex_recreates_deleted_cache_file`.

All 12 build tasks reported done, so nothing partial or blocked was left to finish. The route shapes in `api/client.ts` and `api/types.ts` match the server: I checked them with curl against the headless server, for `/search`, `/graph`, `/references`, `/rows` and the 409/422 cases.

### Headless walkthrough (built app, Playwright Chromium)

I served `frontend/dist` with `build_server_config` on a scratch copy of `space-links` (port 8795) and drove it with Playwright. There were 0 console errors across all runs. The server was stopped afterwards.

- **Search palette:**
  - Ctrl+K opened it with recents.
  - "journal" found Write paper with the highlighted snippet.
  - "Analytcal Engne" found Analytical Engine.
  - "ada pers" offered the type option.
  - Enter opened the object.
- **References section:**
  - On Ada Lovelace, the All, Backlinks, Related Content and Mentions tabs showed counts.
  - On Analytical Engine, clicking "Link" on the CRLF mention gave the `git diff` "the mention line plus `lastUpdated`", with CRLF kept.
- **Find in page:** Ctrl+F, then Replace all "Ada" → "Augusta Ada" with match case off. The `git diff` showed only the matched text (in a paragraph and in a code block) plus `lastUpdated`. The `[[Ada Lovelace]]` link text was not touched.
- **Action palette:** Ctrl+P opened it. "Open graph view" opened the local graph and "Open global graph" opened the global graph. The Customize popover showed every label.
- **Tasks page:** the Context tab showed "Tasks organized by the objects they are mentioned in." No task in `space-links` is linked from another object, so both open tasks are under "Other".

Not walked in the browser: the global graph's pan and zoom and palette typing on a `--big` copy, a backlinks table column, filter and group, and "Create new … with title". The tests and the `--big` timings cover these, but Gene should still check them by hand (below).

Things noticed for Gene:

- The global graph's layout overlay ("Arranging the layout") ran for about 4 s even on `space-links`' 21 nodes.
- With two objects both titled "Ada Lovelace", Enter in the palette opened the older-path Page (`Archive/`), not the Person.
- The lexical Related Content for a short body lists weak matches: 13 objects for a one-line page.

## Gene's hand-run checks (not yet done)

Run `npm run build`, then `uv run objectapp --space <copy of backend/tests/fixtures/space-links>` (and a copy of a `--big` space, made with `backend/tests/bigspace.py`), and walk through the following.

### In the app

- [ ] Ctrl+K: recents on an empty query, a body word with its snippet, a fuzzy title, the type, exclude and tag options and their chips, Backspace removing a chip, "Create new … with title …", and Enter / Ctrl+Enter / Shift+Enter.
- [ ] Ctrl+P: every action ("Open calendar", "Open today", "Open global graph", "Open graph view", the sidebar and side panel toggles, "Create {type}").
- [ ] Find in page from the `…` menu and with Ctrl+F: match case, whole word, next and previous, replace, replace all, then `git diff`.
- [ ] The references section on Ada Lovelace: all five tabs, hiding the section by clicking the active tab, linking a mention, then `git diff`.
- [ ] The backlinks property in the panel, as a table column, as a backlinks filter and as a group; the "No backlinks" Overview section; the Tasks page Context tab with a task linked from a page.
- [ ] The global graph: filters, tags network, search, fit and click to peek. The local graph: hops "Show more" / "Show less".
- [ ] On the `--big` copy: the global graph's pan and zoom, and typing in the palette at 5,000 objects.

### On the CPI copy (outside the repo, `git init` done there)

- [ ] Opening creates only `.capacities-cache/`, and `git status` stays clean. Deleting the folder loses nothing, and it comes back.
- [ ] Search finds what you expect by title and by text. The snippets read well. `partial` disappears after the first indexing.
- [ ] Backlinks match what Capacities showed for a few objects you know well. Linking a mention changes only that text (`git diff`).
- [ ] The graph at your space's size pans, zooms and filters without stalls.

### Side by side with Capacities: decisions this plan made without a reference

Note what Capacities does differently, so a fix pass can follow.

- [ ] Key bindings: Ctrl+K and Ctrl+P (both also work while the peek is open), the Enter / Ctrl+Enter / Shift+Enter variants, Ctrl+Enter in Replace doing "Replace all", and Esc in the find bar.
- [ ] Search highlight colour: `--bg-search-highlight` is the yellow type colour at 30% alpha, 55% for the current find match, with text `var(--text)`. Weight 500 and radius 1px come from the reference CSS.
- [ ] Graph:
  - node sizes (`3 + 2·sqrt(degree)`, capped at 18) and colours (type colour; tags in their tag colour)
  - indirect links drawn thin (0.6) at about 22% alpha, not dashed (sigma 3 has no dashed edges)
  - the 10-neighbour cap
  - `LARGE_NODE_LIMIT = 100`
  - "Show tags network" offered on a local graph only when the centre is a Tag
- [ ] The palette's type and tag option matching (prefix, word-prefix, or substring of 3+ characters), the cap of 5 tag options and 10 Recently Opened, and the way picking an option removes the words that named it.
- [ ] Find bar icons: an underlined "ab" for whole word, `ph-text-aa` for match case. The bar shows Replace even in read-only editors, where it does nothing.
- [ ] "Related tags" rule: tags that appear together with this object's tags on other objects.
- [ ] Lexical "Related Content", a stand-in for Capacities' semantic one.
- [ ] Tab counts (All is the sum of the other tabs it offers).
- [ ] Where the Tasks "Context" tab sits (after Tags, before Completed).
- [ ] Our strings:
  - "via {property}"
  - "Changed elsewhere. Reloaded."
  - "Could not create the link."
  - "No unlinked mentions"
  - "No related tags"
  - the Related Content empty line
  - "The text has changed. Reload and try again."
- [ ] BacklinksCell: a count in a one-line table cell and in a small card, chips in a wrapped cell and in the property panel.
- [ ] Rows carry `backlinks` on every type (wiring fix 1 above), so "No backlinks" is offered on Page, Task and others.
