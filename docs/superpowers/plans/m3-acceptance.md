# Milestone 3 acceptance

Plan: `2026-10-26-m3-views-collections-queries.md`, Task 16. Date: 2026-10-26.

## Automated results

| Suite | Command | Result |
|---|---|---|
| Back end | `uv run pytest backend/tests -q` | 445 passed |
| Front end | `cd frontend && npx vitest run` | 465 passed |
| Type check | `cd frontend && npx tsc -b --noEmit` | clean |
| Build | `cd frontend && npm run build` | built (`dist/`) |
| M3 acceptance | `uv run python scripts/m3_acceptance.py backend/tests/fixtures/space-sample` | PASS (all checks `[ok]`) |
| M3 acceptance | `uv run python scripts/m3_acceptance.py backend/tests/fixtures/space-v1` | PASS (all checks `[ok]`) |

### `scripts/m3_acceptance.py`

Works on a temporary git-committed copy and serves it over HTTP. Checks: reading routes change no file; `POST /api/rows` returns one row per object with matching versions; membership diffs are the `collections:` line plus `lastUpdated` (and an inserted `id:`), giving `[Other, Tooling]`; renaming rewrites only list items and `rewritten` equals the changed files; delete (428, then confirmed, nothing skipped) and restore leave every file outside `.object/` byte-identical; views, ui and query writes each touch exactly one `.object/` file, and a stale `PUT /api/ui` is 409; `POST /api/objects` with `values` creates one file; the M1 no-edit pass changes nothing.

### Front-to-back wiring check

The app was started on port 8791 against a copy of `space-sample` with `build_server_config`, serving the built front end. `POST /api/rows`, `GET /api/views/task`, `GET /api/ui`, `POST/GET /api/collections`, `POST /api/queries` and `DELETE /api/collections/{id}` (428 without confirm) answered with the shapes the front end's `api/client.ts` expects. The server was stopped afterwards.

No contract mismatches were found, so no wiring changes were needed.

## Gene's hand-run checks (not yet done)

Run the app on a scratch copy of `space-sample` first (`npm run build`, then `uv run objectapp --space <copy>`), then on the CPI copy outside the repo with `git init` done there.

### Sample walk-through

- [ ] Task type page, All tab: each of the six full-view layouts (list, grid, wall, table, embed, kanban) renders.
- [ ] A filter group `status includes Done OR done is selected`, a sort, and group by status work.
- [ ] Overview sections show and can be collapsed, reordered and removed. A type with no saved views starts with Recently Opened, Collections and Queries plus the "All" tab; "Not in any collection" and "Not tagged" come from "Add a section"; Collections and Queries can't be removed (reference: `builtInDashboardSections`, reference-check section 6). Views already saved keep their sections.
- [ ] Table: resize a column, pin, hide, wrap, a Sum calculation, inline edit of a label and a date.
- [ ] An external edit in VS Code updates the table row.
- [ ] Kanban: drag a task between status columns; "+" in a column creates a task with that status.
- [ ] A collection: "Add existing", rename, delete, restore from the Trash.
- [ ] A query built from the type page with "Save as query"; pinned to the sidebar, to its type (new header tab) and to a collection's dashboard.
- [ ] A custom sidebar section "In Progress" holding that query; the Queries sidebar item and its page; All notes.

### CPI copy

- [ ] Each type page opens with its default layout; Weblinks shows the grid cards of `docs/04-collection-weblinks-cards.png`.
- [ ] A membership edit's `git diff` is the `collections:` line plus `lastUpdated` (plus `id:` on an object that had none); view changes touch only `.object/`.
- [ ] A type page with 1,000+ objects stays responsive (filter edit under 200 ms, measured in DevTools).
- [ ] Side by side with Object, these look and read the same: the toolbar pill, filter popover, table, cards, kanban, type-page tabs, collection page, query builder, and the sidebar's Pinned, custom sections and Queries entry.
