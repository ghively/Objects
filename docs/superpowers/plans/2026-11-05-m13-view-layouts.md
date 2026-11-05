# Milestone 13: calendar, timeline and chart layouts

Expanded 2026-11-05 from `2026-11-04-notion-anytype-features-plan.md`, M13, against `master` at `c72567f`. Built on branch `feat/m13-view-layouts` (built, reviewed and fixed 2026-11-05; results in `m13-acceptance.md`). Everything here is new ("Beyond the catalog"); every label and default is "our string" or "our choice".

## Contract (T1)

### Layouts

`Layout` gains `calendar`, `timeline` and `chart` (`LAYOUTS`: "Calendar" `ph-calendar-dots`, "Timeline" `ph-chart-bar-horizontal`, "Chart" `ph-chart-pie-slice`). They are in `FULL_VIEW_LAYOUTS`, so type pages, collections, queries, the Tasks page, sections and embedded views offer them; the search page (`STANDARD_LAYOUTS`) doesn't. The back end's `DATA_VIEW_LAYOUTS` accepts them, so the view JSON (`views/<typeId>.json`, collection and query files, an embed's `localDataViewInfo`) stores them like any layout.

`WHOLE_SET_LAYOUTS` (the three) draw every row themselves: `DataView` shows no "Load more" for them, and they read `props.flat` (every row that survives the view's filters and sorts, in sort order). They ignore `groups`/`grouped`; group-by settings stay saved but unused while one of them is chosen.

Each layout keeps its settings in its own optional key of `DataViewDefinition`; a missing key means the defaults below. `DataView` adds a Customize page for the chosen layout ("Calendar", "Timeline", "Chart") that renders the layout file's `XSettings({types, state, onState})`.

`LayoutProps.onCreate?(values, typeId)` is present when the view allows creating; `DataView` merges the values the view's filters imply (as the "+ New" button does), and the owner creates and opens the object. Layouts may also write directly, as the kanban does: `api.updateProperties(path, {key: value}, version)`, then `props.patchRow` / `props.onWritten` with the result; a 409 reloads the row and shows the usual conflict notice.

### Calendar (`CalendarViewConfig`)

- `dateProperty: string | null` (a property key of a `date` property of the view's types, or `createdAt`/`lastUpdated`; `null`: the first date property of the first view type, else `createdAt`), `mode: 'month' | 'week'` (default `month`).
- A month grid (weeks start on the space's week start, as the Calendar page) or a week strip, with previous / today / next. Each object sits on the day of its date (a range sits on every day it covers); a day shows at most 4 chips in the month grid and 12 in the taller week strip, then "+N more" (our choice), which opens the day's list.
- Drag a chip to another day: writes that day into the property (a range keeps its length; a time keeps its time). `createdAt` and `lastUpdated` can't be dragged.
- Click an empty spot of a day: `onCreate({[key]: day}, typeId)` with the first view type, when `onCreate` is present.
- Objects without the date are counted in a "No date (N)" button (our string) that lists them.
- May reuse `calendar/dates.ts` and `calendar/calendarUi.ts` helpers; it must not use `useCalendarRange` (the rows come from the view).

### Timeline (`TimelineViewConfig`)

- `startProperty` (a date property key; `null`: the first date property), `endProperty` (`null`: the start's own range end, else the same day), `zoom` (default `week`; `day` is one wide column per day, `year` one narrow column per month), `showTable` (default `true`), `tableColumns` (property keys after the title, default `[]`), `showDependencies` (default `true`, used only when `dependenciesConfig` is set).
- A table on the left (title plus chosen columns, with the column calculations of `views/calc.ts` in its footer), bars on the right on a scrolled time axis, a "Today" button. Drag a bar's body to move both dates; drag its left or right edge to change one. A drag writes once, on drop. Items without a start are in a "No date (N)" tray (our string) below; dragging one onto the axis sets its dates. The axis spans at most 10 years each side of the middle of the items' starts and today (our choice); an item outside it (a typo date such as year 0202) is listed in an "Out of range (N)" tray (our string) with its date, and dragging it onto the axis gives it a new start.
- With `subItemsConfig`, rows nest under their parent with a toggle (as in the table, below).
- With `dependenciesConfig` and `showDependencies`, arrows go from each "Blocked by" item's bar end to the blocked item's bar start. A handle on a bar's right end (pointer only, out of the tab order; our choice) can be dragged onto another bar: the target becomes blocked by the source (the source is added to the target's `blockedByPropertyId`; syncing fills the other side). Moving an item never moves its dependents (our choice for v1).

### Sub-items and dependencies

- A Customize page "Sub-items and dependencies" (`views/RelationPairsPage.tsx`, icon `ph-tree-structure`) is offered on table and timeline views of a single type. "Turn on sub-items" and "Turn on dependencies" call `api.createRelationPair(typeId, kind, type.revision)` and then store the pair's keys in `subItemsConfig: {parentPropertyId, childrenPropertyId}` or `dependenciesConfig: {blockedByPropertyId, blockingPropertyId}` (property keys). "Turn off" clears only the view key; the properties stay (they are ordinary relations with values in files).
- `POST /api/types/{typeId}/relation-pair` with `{kind, baseRevision, clientId}`: adds two `entity` properties targeting the type itself and links them with property syncing, or reuses an existing synced pair with those names. `subItems`: "Parent item" (single, `isArray: false`) and "Sub-items" (list). `dependencies`: "Blocked by" and "Blocking" (both lists). Answers `RelationPairResult {type, firstId, secondId, created}` (property ids; first is "Parent item"/"Blocked by"); 409 `{currentRevision}` on a stale revision, 404, 422 when a property of that name exists but isn't a matching relation (the message names it). Rewrites no object. The change event announces `types` with the origin.
- **Nested rows in the table layout:** with `subItemsConfig`, a row whose parent is also in the view is drawn under it, indented, behind a toggle on the parent (open by default, our choice); parents whose children are all filtered out show no toggle. A row whose parent isn't in the view is a top-level row. Cycles are broken by showing the row at top level. Sorting applies among siblings. Grouping turns nesting off (rows are flat in groups).

### Chart (`ChartViewConfig`)

- `kind` (default `bar`): `bar`, `horizontalBar`, `line`, `donut`, `number`. `xProperty` (`null`: the first label property, else `type`): groups rows with the group-by code (`views/group.ts`), so the same properties and the same group names; `xDateBucket` (default `month`) when the X property is a date. `yCalc` (default `countAll`) with `yProperty` for number calculations (`views/calc.ts`). `splitBy` (`null`, or a property key: stacks bars, one line per value, ignored by `donut` and `number`). `cumulative` (line only), `sort` (default `xAscending`), `hideEmptyGroups` (default `true`), `showLegend` (default `true`), `showValues` (default `false`).
- Drawn as SVG by our own components in `views/layouts/chart/` (no chart library). Colours: label colours when X or split is a label property, else the app's palette, readable in light and dark.
- Clicking a bar, point or slice lists its rows under the chart (opening one opens the object as rows do), with "Show as table" (our string), which turns this view into a table with an added filter for that group (one `onState`).
- Export: "Export PNG" and "Export SVG" in the Chart Customize page and a small button on the chart, with `html-to-image` (`toPng`, `toSvg`) as the whiteboard export does, downloading `<view name or "Chart">.png|.svg`.

### Client

`api.createRelationPair(typeId, kind, baseRevision)`; `DataViewDefinition.calendarConfig`, `timelineConfig`, `chartConfig`, `subItemsConfig`, `dependenciesConfig`.

## Lanes

- **Lane Ca (calendar):** `views/layouts/CalendarLayout.tsx` (and helpers under `views/layouts/calendar/`), its settings page, tests.
- **Lane Ti (timeline, sub-items, dependencies, back end):** `views/layouts/TimelineLayout.tsx` (and `views/layouts/timeline/`), `views/RelationPairsPage.tsx`, nested rows in `views/table/TableLayout.tsx`, the relation-pair route (`space.py`, `server.py`, tests `backend/tests/test_m13_*.py`) and `scripts/m13_acceptance.py`.
- **Lane Ch (chart):** `views/layouts/ChartLayout.tsx`, `views/layouts/chart/`, export, tests.

`DataView.tsx`, `model.ts`, `types.ts` and `client.ts` are T1's; a lane that needs a change there says so in its report rather than editing them.

## Review focus

Drags write only the date property's line (and `lastUpdated`); nothing is written on read or on opening a layout; a 2,000-row view stays responsive in each layout; the relation pair never rewrites objects; nested rows never lose a row (every filtered row shows exactly once).
