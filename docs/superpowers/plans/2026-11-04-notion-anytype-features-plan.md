# Object, Milestones 11–15: features from Notion and Anytype. Plan (not built)

Written 2026-11-04 from a read-only look at `ghively/objects` (`master` at `55a4059`) and the current Notion and Anytype help pages. Nothing in the repo was changed. This file can be dropped into `docs/superpowers/plans/` once Gene is happy with it.

## Start condition

1. Gene pushes the polish work that is on his work PC, and `master`'s full gate is green (back end, front end, `tsc`, lint, build, `m1_roundtrip.py`, `m2`–`m9_acceptance.py`).
2. M11 is built first, then M10 (Gene, 2026-11-04). See "How this fits with M10".
3. Each milestone below gets expanded into the M8/M9 plan format (contract task, lanes by file ownership, storage table, API contract, review focus, acceptance checklist) right before it is built, re-reading the files at the then-current `master`.

## Summary: what to add, in order

| # | Milestone | What it adds | Why it matters | Size |
|---|---|---|---|---|
| M11 | Agent access: local API and MCP server | A token-protected local API and a stdio MCP server so Claude Code (or any MCP client) can find, read and safely edit a space through Object's own services | Both Notion and Anytype now ship an official MCP server. For an agent builder this is the biggest multiplier, and the spec already lists "the local API with scoped tokens (useful for agents)" as wanted. It is also phase one of the parked Object Team agent layer | L (about 12 tasks, 3 lanes) |
| M12 | Computed and new property kinds | Formula, Rollup, Unique ID, Email, Phone, Files | Formulas and rollups are what make Notion databases feel "smart". Object can already relate objects both ways, but it can't compute across them | L (about 11 tasks, 3 lanes) |
| M13 | New view layouts | Calendar and Timeline layouts for any type, collection or query, with sub-items and dependencies; a Chart layout | Object's calendar only shows dated objects on its own page. Notion and Anytype both let any set of objects be viewed by date, and Notion adds timelines and charts | L (about 12 tasks, 3 lanes) |
| M14 | Local automations | Repeating templates, button blocks and button properties, and simple "when X, do Y" rules, all local | Notion's buttons, automations and repeating templates remove most routine clicks. Object already has the pieces (templates, recurrence rules, local reminders) | M–L (about 10 tasks, 2 lanes) |
| M15 | Importers | Notion Markdown & CSV export, Obsidian vault, Anytype Markdown export | Object imports only CSV. Anytype imports from Notion and Obsidian; Object should too, so moving content in is a few clicks | M (about 7 tasks, 2 lanes) |

The second tier (sidebar widgets, quick-capture forms, editable synced blocks, comments, custom CSS, a web clipper) is in "Backlog" with sizes. Sharing, publishing, chat, sync and accounts stay out, as `CLAUDE.md` says.

## What this plan has to respect

From `CLAUDE.md` and `specs/2026-10-23-object-design.md`, carried into every milestone below:

- **127.0.0.1 only, no outbound network at runtime.** Nothing here fetches a URL. The MCP server talks over stdio to its client and over 127.0.0.1 to Object. Webhooks, email and Slack actions (which Notion's automations have) are left out for that reason.
- **Never write on read.** Formulas, rollups, charts, timelines and the MCP read tools write nothing. Imports and automations write only on a user's action or a rule the user made.
- **Derived data never goes inside object files.** Formula and rollup values are computed, never stored in frontmatter. Run logs and API tokens live in the per-user state dir, never in the space.
- **Plain Markdown first; byte preservation of untouched blocks is sacred.** New block syntax (the button block) uses the M7 annotation grammar and a plain-text fallback.
- **Edits change only their own lines; deletes go to the trash; writes are atomic and keep CRLF/BOM; every write announces a `ChangeEvent`.** The API and MCP writes go through the same write funnels as the app, so history, the trash and version checks (409 on a stale `baseVersion`) hold.
- **Review once, at the end; lanes by file ownership; tests first; no full suites until the integrate task.** As in `build-process.md`.

**The one rule these features bend:** "Fidelity to the behaviour catalog and design spec is the bar … don't invent schema." Everything below is, by definition, something the behaviour catalog doesn't have, so every new key, kind and file is "our schema". The plan handles that the same way M6 handled pen ink:

- The spec gets a new §2 entry, **"Beyond the catalog (Gene, 2026-11)"**, listing each feature as it is approved.
- New things never change how an existing catalogued feature looks or behaves. They are added beside it (a new property kind, a new view layout, a new menu entry).
- Every label and default is marked "our string" or "our choice" and listed in that milestone's hand-check doc, as now.
- New on-disk shapes are listed in each milestone's storage table, so a later import or the Object Team server can map them.

## What Notion and Anytype have, against Object today

| Feature | Notion | Anytype | Object today |
|---|---|---|---|
| Two-way relations | yes ([relations & rollups](https://www.notion.com/help/relations-and-rollups)) | properties shared across types ([properties](https://doc.anytype.io/anytype/organize/properties.md)) | **has it** (relation "property syncing", M2) |
| Formula property | yes ([formulas](https://www.notion.com/help/formulas), [syntax](https://www.notion.com/help/formula-syntax)) | column-footer calculations only ([formulas](https://doc.anytype.io/anytype/features/formulas)) | column calculations (M3); table-block formulas (M8); **no formula property** |
| Rollup property | yes ([relations & rollups](https://www.notion.com/help/relations-and-rollups)) | no | **no** |
| Unique ID, email, phone, files properties | yes ([database properties](https://www.notion.com/help/database-properties)) | email, phone, file & media ([properties](https://doc.anytype.io/anytype/organize/properties.md)) | **no** (media are object types, not a property) |
| Calendar view of any database | yes ([calendars](https://www.notion.com/help/calendars)) | yes ([views](https://doc.anytype.io/anytype/organize/views.md)) | calendar page for dated objects only; **no calendar layout in a view** |
| Timeline / Gantt view | yes ([timelines](https://www.notion.com/help/timelines)) | no | **no** |
| Sub-items and dependencies | yes ([Notion 2.19 release](https://www.notion.com/releases/2022-12-15)) | no | relations only; **no nesting or dependency arrows** |
| Chart view | yes ([charts](https://www.notion.com/nb/help/charts)) | no | **no** (graph PNG export exists) |
| AND/OR filter groups | yes ([views, filters, sorts](https://www.notion.com/help/views-filters-and-sorts)) | yes ([advanced filters](https://doc.anytype.io/anytype/features/advanced-filters.md)) | **has it** (M3) |
| Inline / embedded views | linked databases | yes ([inline queries](https://doc.anytype.io/anytype/features/inline-queries.md)) | **has it** (M8, M9 `localDataViewInfo`) |
| Buttons | yes ([buttons](https://www.notion.com/help/buttons), [database buttons](https://www.notion.com/help/database-buttons)) | no | **no** |
| Rule automations | yes ([database automations](https://www.notion.com/help/database-automations)) | no | **no** (task recurrence and local reminders only) |
| Repeating templates | yes ([repeating database templates](https://www.notion.com/help/guides/automate-work-repeating-database-templates)) | no | templates (M2), **no repeat** |
| Synced (editable) blocks | yes ([synced blocks](https://www.notion.com/help/synced-blocks)) | no | read-only block references (M8) |
| Forms | yes ([forms](https://www.notion.com/en-gb/help/forms)) | no | **no** |
| Sidebar widgets with live views | no | yes ([widgets](https://doc.anytype.io/anytype/basics/sidebar/widgets)) | pinned items and custom sidebar sections; **no live view in the sidebar** |
| Dates as pages | no | yes ([dates](https://doc.anytype.io/anytype/features/dates)) | **has it** (daily notes and the Day view's backlinks, date references and timeline, M8) |
| Version history, trash, graph | yes | yes | **has it** |
| Local API | public cloud API | yes, on localhost with API keys ([local API](https://doc.anytype.io/anytype/features/local-api), [developer portal](https://developers.anytype.io/docs/examples/overview)) | **no** (listed as wanted in spec §2 "Later") |
| MCP server | yes ([Notion MCP tools](https://developers.notion.com/guides/mcp/tools-faqs)) | yes ([Anytype MCP](https://developers.anytype.io/docs/examples/featured/mcp), [Agents skill](https://doc.anytype.io/anytype/features/integrations/anytype-agents-skill.md)) | **no** (designed for the parked Team server, spec §7) |
| Import from other apps | many ([import data](https://www.notion.com/help/import-data-into-notion)) | Notion, Obsidian, Markdown and more ([import & export](https://doc.anytype.io/anytype-docs/advanced/data-and-security/import-export)) | CSV into a type only (M9) |
| Export | Markdown & CSV, HTML, PDF ([export](https://www.notion.com/help/export-your-content)) | Markdown, Any-Block, PDF, HTML ([import & export](https://doc.anytype.io/anytype-docs/advanced/data-and-security/import-export)) | Markdown, zip with media, PDF print (M9) |
| Web clipper | yes ([web clipper](https://notion.com/help/web-clipper)) | yes | **no** (spec "Later": web extension) |
| Sharing, publishing, chat, multiplayer sync | yes | yes | **out for good** (Team spec covers the team case) |

## Ranked gaps

**Tier 1 (this plan, M11–M15)**

1. **Local API and MCP server.** Agents get structured, safe access instead of scraping files. It also gives M10 a better way to read context, and it is the first slice of the Team spec's agent layer, so nothing is thrown away later. Size L.
2. **Formula and rollup properties.** The biggest gap in what a type page can say about its objects (days until due, % of sub-tasks done, total hours across related tasks). Size L, mostly the formula language.
3. **Calendar, timeline and chart layouts, with sub-items and dependencies.** Turns any type or query into a schedule, a plan or a picture. Size L.
4. **Local automations.** Repeating templates (a weekly review that creates itself), buttons and simple rules (status Done sets a Completed date). Size M–L.
5. **Importers.** Lowers the cost of moving content in from the two tools being compared and from Obsidian. Size M.
6. **Unique ID, email, phone and files properties.** Small and useful; built inside M12. Size S.

**Tier 2 (backlog, sized, not planned in detail)**

7. **Sidebar widgets** ([Anytype widgets](https://doc.anytype.io/anytype/basics/sidebar/widgets)): a pinned query or collection shows its live rows in the sidebar, with an item limit and a compact or tree layout. Size S–M. Lane: `shell/Sidebar.tsx` plus `ui.json` keys.
8. **Quick capture and forms** ([Notion forms](https://www.notion.com/en-gb/help/forms)): a form per type that maps questions to properties, opened from the palette or a global shortcut. Local only, so no sharing or respondent settings. Size S–M.
9. **Editable synced blocks** ([Notion synced blocks](https://www.notion.com/help/synced-blocks)): let M8's block references be edited in place, writing to the source object. Size M, with byte-preservation risk, so it needs its own review focus.
10. **Comments on blocks** (Notion comments; Anytype [discussions](https://doc.anytype.io/anytype/llms.txt)): margin notes stored as an annotation or a sidecar. Low value for one user, but useful as the place M10 and agents leave review notes. Size M.
11. **Custom CSS** (Anytype custom CSS; see the [docs index](https://doc.anytype.io/anytype/llms.txt)): a user stylesheet in the space's `.object/`. Size S.
12. **Web clipper** ([Notion web clipper](https://notion.com/help/web-clipper)): a browser extension posting to M11's local API. Already on the spec's "Later" integrations list, so it follows M11. Size M.
13. **HTML export of a collection or space** ([Anytype export](https://doc.anytype.io/anytype-docs/advanced/data-and-security/import-export)). Size S–M.

**Out:** sharing and publishing, chat and discussions between people, multiplayer sync, accounts, Notion's webhook, email and Slack actions, Notion Mail and Calendar, and the cloud AI agents (M10 covers AI through Claude Code).

---

## M11: Agent access (local API and MCP server)

**Goal.** Claude Code, Claude Desktop or any MCP client can find, read and safely edit a space through Object's own services, with no network beyond 127.0.0.1 and no way around history, the trash or version checks.

**Architecture.**
- **A versioned local API, `/api/v1/*`,** on the existing server, for external clients only. The app's own `/api/*` stays as it is. `/api/v1` requires `Authorization: Bearer <token>`; the existing DNS-rebinding and cross-origin guards in `server.py` stay in front of it.
- **Tokens:** Settings > Integrations (our string) lists tokens per space: create (shown once), name, scope `read` or `read-write`, revoke. Stored hashed in the per-user state dir (`appstate.state_dir()/tokens.json`), never in the space. Anytype's model (named keys, revocable) is the pattern ([local API](https://doc.anytype.io/anytype/features/local-api)).
- **The MCP server is a thin client of `/api/v1`.** A new console script `objectapp-mcp --space <path>` speaks MCP over stdio, reads its token from an env var, and calls the running app on 127.0.0.1. If the app isn't running it says so and exits; it never opens the space folder itself, so there is one writer. New dependency: the official Python `mcp` SDK.
- **Tool set:** the Team spec §7 groups, single-user:
  - Find: `search` (FTS5, both modes), `query` (Object's filter model: type, property values, tags, collections, the same JSON as saved queries), `run_saved_query`, `backlinks`, `neighbours` (graph hops), `list_types`, `list_collections`.
  - Read cheaply: `peek` (title, type, properties, heading outline, size; no body), `read` (whole body or one heading's section), `schema` (types and their properties), `changes_since` (from the watcher and history), `daily_note` (by date).
  - Write safely (`read-write` tokens only): `create_object` (type, title, properties, body, optional template), `set_properties`, `append_to_section`, `replace_section`, `add_tags`, `add_to_collection`, `rename`, `move_to_trash`, `create_task`. Every write takes the object's `version`; a stale one is refused with the current version, like the app's 409.
- **Exclude from AI** (M10 open question 2): objects tagged or flagged that way are invisible to every tool, in results and by path. If M10 settles a different answer, M11 follows it.
- **Writes are attributed.** A write through the API records `origin: "api:<token name>"` on its `ChangeEvent` and in version history, so the app can show "edited by <token name>" (our string).

**Storage.**

| What | Where | Form |
|---|---|---|
| Tokens | state dir `tokens.json` | `{id, name, spaceId, scope, hash, createdAt, lastUsedAt}`; never in the space |
| Write attribution | history entries (state dir) | `origin` string |
| MCP client config | the user's own Claude settings | a snippet the Settings page shows to copy |

**Lanes.**
- **T1 contract:** `api/types.ts`, `api/client.ts`, `test/mockApi.ts` gain the token methods; the `/api/v1` OpenAPI shapes are written once.
- **Lane B (back end, sequential):** a new `api_v1.py` router, `tokens.py`, attribution in the write funnels, the query endpoint reusing the M3 filter code server-side, section read and write reusing the editor's heading rules (`exportdoc.py`, `references.py`), the exclude rule, tests for every route including "never writes on read" and "no outbound network".
- **Lane M (MCP package):** `backend/objectapp_mcp/` (new folder) with the tool definitions, a fake-server test harness and a stdio smoke test.
- **Lane U (UI):** Settings > Integrations, the copy-config snippet, "edited by" in version history.
- **Ready for M10:** M11 ships a read-only token kind and a documented `--mcp-config` snippet, so M10's runner can use the MCP read tools from its first task. See "How this fits with M10".
- **Integrate:** one review (auth, file safety, no-write-on-read, no-network, exclusion), one fix pass, gate, `scripts/m11_acceptance.py` (starts the app on a fixture copy, runs an MCP client through every tool).

**Open questions for Gene (the plan assumes the answer in brackets).**
1. Should the app need to be running for the MCP server to work? [Yes, one writer. A headless `objectapp --serve` mode is a small follow-up.]
2. Should agent writes go straight in, or through Team-style drafts that you accept? [Straight in, with history and trash as the safety net, on `read-write` tokens only. Drafts come with Object Team.]
3. Should local embeddings for semantic search come here? [No. FTS5 first; semantic search would add a model dependency and belongs with Team's hybrid search.]

## M12: Computed and new property kinds

**Goal.** Six new property kinds in "+ Add Property": Formula, Rollup, ID, Email, Phone, Files.

**Formula** (pattern: [Notion formulas](https://www.notion.com/help/formulas)).
- A small expression language of our own (a hand-written parser, no `eval`, no new dependency): `prop("Name")`, numbers, text, booleans and dates; `+ - * / %`, comparisons, `and or not`, `if`, `ifs`, `empty`, `length`, `contains`, `concat`, `lower`, `upper`, `replace`, `round`, `floor`, `ceil`, `abs`, `min`, `max`, `now`, `today`, `dateAdd`, `dateSubtract`, `dateBetween`, `formatDate`; on a relation, `.length()` and `.first()`. No loops and no random.
- **Computed only on the server** (one implementation), served in rows, object reads and the API like any value, so filters, sorts, groups, column calculations, search and agents all see it. Values that depend on `now`/`today` are computed per request and never cached across days.
- **Never stored in object files.** The type JSON holds only the expression and an output format (number format reuses the M2 number options).
- Errors show in the cell as "Formula error" (our string) with the message on hover; a property can't reference itself (cycles are refused when saving the type).

**Rollup** (pattern: [Notion rollups](https://www.notion.com/help/relations-and-rollups)).
- Settings: the relation property, a property on the related objects, and a calculation. Calculations follow Notion's list: show original, show unique, count all, count values, count unique, count empty, count not empty, percent empty, percent not empty; for numbers sum, average, median, min, max, range; for dates earliest, latest, date range. Reuse the semantics of `views/calc.ts`.
- A rollup can't roll up another rollup (Notion's rule; keeps the dependency graph shallow). It can roll up a formula.
- Computed on the server, never stored, like a formula.

**ID** (pattern: Notion's ID property).
- Settings: an optional prefix (`TASK-`). The next number is kept in the type JSON (`nextNumber`) and bumped under the type file's revision, so two creates can't get the same number.
- The value is written into frontmatter **when the object is created** (it is user data, like `createdAt`). Existing objects get numbers only from an explicit "Number existing objects" action in property settings (never on read), ordered by `createdAt`. Read-only in the UI.

**Email, Phone.** Text with a format check and a `mailto:` or `tel:` link that hands off to the OS. The app itself sends nothing.

**Files.** A list of attachments, stored as wikilinks to files under `Attachments/` (the M1 media rules and `media.py`), with upload, drag-in, reorder and open.

**Storage.**

| What | Where | Form |
|---|---|---|
| Formula definition | type JSON `propertyDefinitions[]` | `{type: "formula", expression, format}` |
| Rollup definition | type JSON | `{type: "rollup", relationId, targetId, calc, format}` |
| ID definition and counter | type JSON | `{type: "uniqueId", prefix, nextNumber}` |
| ID value | object frontmatter | `<key>: TASK-12` |
| Email, Phone | object frontmatter | plain strings |
| Files | object frontmatter | `["[[Attachments/a.pdf]]", …]` |

**Lanes.** T1 contract (shared client types, the new `PropertyType` members, `KIND_META` entries); **Lane B** formula parser and evaluator (`formula.py`), rollups (`rollup.py`), computed values in `rows.py` and object reads, ID counter and back-fill, type-validation (cycles, rollup-of-rollup), tests; **Lane P** property settings for each kind with a formula editor (syntax highlight, function list, live preview against the open object); **Lane C** the cells (`FormulaCell`, `RollupCell`, `IdCell`, `EmailCell`, `PhoneCell`, `FilesCell`) in new files, view filters and sorts for the new kinds. Integrate as usual; `scripts/m12_acceptance.py`.

**Review focus.** Formula values never reach a file; a formula-only edit of the type never bumps any object's `lastUpdated`; a 5,000-object type page with three formulas and two rollups stays within the M5 row-load budget.

## M13: Calendar, timeline and chart layouts

**Goal.** Three new layouts in a view's layout menu, available on type pages, collections, queries and embedded views.

**Calendar layout** (pattern: [Notion calendars](https://www.notion.com/help/calendars), Anytype's calendar view).
- Pick the date property; month and week views reuse M4's calendar components. Drag an object to another day to change that property through the normal write path; click a day to create an object there with the date set.

**Timeline layout** (pattern: [Notion timelines](https://www.notion.com/help/timelines)).
- Uses a date range property, or a start and an end property. Zoom: day, week, month, quarter, year. A table sidebar on the left with chosen columns (and the M3 column calculations). Drag an item's edges to change dates, its body to move it. Items without dates are listed in a "No date" tray (our choice).
- **Sub-items** (pattern: [Notion 2.19](https://www.notion.com/releases/2022-12-15)): a "Turn on sub-items" action in the view's `…` menu creates a two-way relation pair "Parent item"/"Sub-items" (our strings) with property syncing, single-valued on the parent side. Table and timeline layouts then nest rows under a toggle.
- **Dependencies:** "Turn on dependencies" creates a two-way pair "Blocked by"/"Blocking". The timeline draws arrows; dragging from an item's arrow handle to another item sets the relation. Moving an item doesn't shift its dependents (our choice for v1; a "shift dependents" setting is a follow-up).
- Both are ordinary relations, so they show on the object page, in the graph, and to agents, with no new schema beyond the view's settings.

**Chart layout** (pattern: [Notion charts](https://www.notion.com/nb/help/charts)).
- Vertical bar, horizontal bar, line, donut and a single number. X axis groups by a property (the M3 group-by code); Y axis is a count or a calculation of a number property (the M3 calculations), optionally split by a second property; a cumulative switch for line charts. Clicking a bar opens a filtered table, which can be saved as a view. PNG and SVG export, using `html-to-image` as the graph export does.
- Drawn as SVG by our own small components (our choice), so no chart library is added unless the builder finds one needed.

**Storage.** The view JSON (`views/<typeId>.json`, collection and query files, and `localDataViewInfo` for embeds) gains `layout: "calendar" | "timeline" | "chart"` and a `calendar`, `timeline` or `chart` settings object (date property ids, zoom, sidebar columns, chart kind, axes). Sub-item and dependency pairs are relation properties in the type JSON.

**Lanes.** T1 contract; **Lane Ca** `views/layouts/CalendarLayout.tsx`; **Lane Ti** `views/layouts/TimelineLayout.tsx`, the sub-items and dependencies actions, nested table rows; **Lane Ch** `views/layouts/ChartLayout.tsx` and export. `views/DataView.tsx` and the layout menu are T1's, so the lanes only fill their own files. Back end needs no new routes (the rows API already returns dates and relations); one small task adds the relation-pair creation to `typedefs.py`. Integrate; `scripts/m13_acceptance.py`.

## M14: Local automations

**Goal.** Routine edits happen by themselves or with one click, all on the user's machine.

**Pieces** (pattern: Notion's [buttons](https://www.notion.com/help/buttons), [database buttons](https://www.notion.com/help/database-buttons), [database automations](https://www.notion.com/help/database-automations) and [repeating templates](https://www.notion.com/help/guides/automate-work-repeating-database-templates)).
- **Triggers:** an object is created in a type or collection; a property changes (to any value, or to a chosen value); a schedule (reusing M8's recurrence rule grammar and `recurrence.py`); a button is pressed.
- **Actions:** set or clear a property (including "now" for a date); add or remove a tag or collection; create an object from a template, optionally related back to the triggering object; append a line or block to today's daily note; show a local notification (`notify.py`, as reminders do).
- **Repeating templates:** a "Repeat" option on a template, which is a scheduled "create from template" rule underneath.
- **Button block:** a new editor block, written with the M7 annotation grammar (`<!-- block: button rule="<id>" -->` then the label as a plain line, so the file still reads cleanly). **Button property:** a new kind whose click runs a rule on that object.

**Rules for safety.**
- Rules run in the back end, on app writes and API writes only. External edits seen by the watcher don't trigger rules (our choice: a file synced in from elsewhere shouldn't cause new writes).
- An automation's own writes never trigger automations (Notion's rule), so there are no loops.
- Every rule write goes through the write funnels: history, `ChangeEvent` with `origin: "automation:<id>"`, version checks. A rule that hits a 409 retries once on the fresh version, then logs a failure.
- Schedules run while the app is running. On start, missed runs are shown in a catch-up dialog like M8's overdue dialog ("Create the 3 missed weekly reviews?" our string), never created silently.
- A run log (last 200 runs per rule) lives in the state dir. Settings > Automations lists rules, their last run and their log, and can turn each off.

**Storage.** `.object/automations/<id>.json` per rule (`{name, enabled, trigger, conditions, actions}`), so rules travel with the space and are versionable; a template's repeat lives in its own definition; run logs in the state dir.

**Lanes.** T1 contract; **Lane B** `automations.py` (engine, scheduler, catch-up, loop guard, log), hooks in the write funnels, routes, tests; **Lane U** the rule editor, Settings > Automations, the template "Repeat" option, the button block (editor data layer first, then the node view) and the button property cell. Integrate; `scripts/m14_acceptance.py` with the test clock (`OBJECT_CLOCK_FILE`).

## M15: Importers

**Goal.** Import a Notion export, an Obsidian vault or an Anytype Markdown export into a space, with a preview before anything is written.

- **Flow:** New space > Import from… (or Settings > Import, our string). Pick a zip or folder; Object reads it into memory and shows a preview: how many objects per type, properties found and their guessed kinds, links that will resolve, attachments, and anything it will skip. Nothing is written until "Import". By default the import goes into a new space (our choice), so an existing space is never at risk.
- **Notion Markdown & CSV export** ([format](https://www.notion.com/help/export-your-content)): each page becomes an object; each database CSV becomes a type, with property kinds guessed by M9's Import CSV code and its rows matched to their page files; Notion's id suffixes are stripped from titles; links between pages become `[[Title]]`; images and files move to `Attachments/`; callouts (written as HTML in the export) become standout quotes.
- **Obsidian vault:** Markdown with frontmatter and `[[links]]` maps almost directly. Each folder, or a chosen frontmatter key, maps to a type in a mapping step; attachments are found by Obsidian's short-name rule, which `export.py` and `media/upload.ts` already follow.
- **Anytype Markdown export** ([formats](https://doc.anytype.io/anytype-docs/advanced/data-and-security/import-export)): pages become objects; its frontmatter properties become properties.
- **After import:** the search index rebuilds; an "Import report" object (our choice) lists what was skipped.
- This is a general tool. It doesn't touch `C:\Git\wiki`; that migration stays its own project, though it could reuse the Obsidian path.

**Lanes.** **Lane B** `importers/` (a common writer plus one reader per source), dry-run preview, tests on small synthetic exports in `backend/tests/fixtures/` (no real data); **Lane U** the import dialog and mapping step. M15 touches almost nothing the other milestones touch, so it can be built alongside M11 (`build-process.md`: two milestones at once).

---

## How this fits with M10

- **Decided by Gene, 2026-11-04: M11 first, then M10.**
- **M10 is revised before it is built** to use Object's MCP server: its `claude -p` runner gets `--mcp-config` for `objectapp-mcp` with a read-only token and an allowed-tools list of the M11 read tools only, instead of reading files with `Read`. That gives the assistant structured search and queries, and enforces "Exclude from AI" in one place (so M10's open question 2 is settled by M11's exclusion rule).
- M10's other tasks (chat panel, block and object entries, accept or reject UI, settings, shortcuts) stay as planned.

## Order and sizes

| Order | Milestone | Size | Can run beside |
|---|---|---|---|
| 0 | Polish push from the work PC, gate green | | |
| 1 | M11 local API and MCP | L | M15 |
| 2 | M10 AI assistant (revised to use M11's MCP tools) | M | M15 |
| 3 | M12 computed and new properties | L | |
| 4 | M13 calendar, timeline, chart | L | M14 back-end lane only |
| 5 | M14 local automations | M–L | |
| 6 | M15 importers | M | M11 or M10 |
| later | Tier 2 backlog, one small milestone at a time | S–M each | |

Sizes are relative: S is a few tasks in one lane, M is one milestone of about 6 to 8 tasks in two lanes, L is about 10 to 12 tasks in three lanes, like M9.

## Decisions for Gene

1. **Approve the "Beyond the catalog" spec entry** for the features you want, since each one is new schema.
2. ~~Order~~ **Decided 2026-11-04:** M11 first, then M10.
3. **M11's three open questions** above (app must be running; writes straight in vs drafts; no semantic search yet).
4. **Which tier 2 items to keep,** and whether any should jump into tier 1 (sidebar widgets and quick capture are the cheapest).

## Sources

Notion: [database properties](https://www.notion.com/help/database-properties) · [relations & rollups](https://www.notion.com/help/relations-and-rollups) · [formulas](https://www.notion.com/help/formulas) · [formula syntax](https://www.notion.com/help/formula-syntax) · [calendars](https://www.notion.com/help/calendars) · [timelines](https://www.notion.com/help/timelines) · [charts](https://www.notion.com/nb/help/charts) · [views, filters, sorts](https://www.notion.com/help/views-filters-and-sorts) · [sub-items and dependencies (2.19)](https://www.notion.com/releases/2022-12-15) · [buttons](https://www.notion.com/help/buttons) · [database buttons](https://www.notion.com/help/database-buttons) · [database automations](https://www.notion.com/help/database-automations) · [repeating templates](https://www.notion.com/help/guides/automate-work-repeating-database-templates) · [synced blocks](https://www.notion.com/help/synced-blocks) · [forms](https://www.notion.com/en-gb/help/forms) · [web clipper](https://notion.com/help/web-clipper) · [export](https://www.notion.com/help/export-your-content) · [import](https://www.notion.com/help/import-data-into-notion) · [MCP tools](https://developers.notion.com/guides/mcp/tools-faqs)

Anytype: [docs index](https://doc.anytype.io/anytype/llms.txt) · [views](https://doc.anytype.io/anytype/organize/views.md) · [properties](https://doc.anytype.io/anytype/organize/properties.md) · [advanced filters](https://doc.anytype.io/anytype/features/advanced-filters.md) · [formulas](https://doc.anytype.io/anytype/features/formulas) · [widgets](https://doc.anytype.io/anytype/basics/sidebar/widgets) · [dates](https://doc.anytype.io/anytype/features/dates) · [local API](https://doc.anytype.io/anytype/features/local-api) · [developer portal](https://developers.anytype.io/docs/examples/overview) · [MCP server](https://developers.anytype.io/docs/examples/featured/mcp) · [Agents skill](https://doc.anytype.io/anytype/features/integrations/anytype-agents-skill.md) · [API repo](https://github.com/anyproto/anytype-api) · [import & export](https://doc.anytype.io/anytype-docs/advanced/data-and-security/import-export)

Object (in the repo): `CLAUDE.md`, `docs/superpowers/specs/2026-10-23-object-design.md`, `docs/superpowers/specs/2026-10-28-object-team-design.md` §7, `docs/superpowers/plans/2026-11-02-m10-ai-assistant.md`, `docs/superpowers/plans/remaining-work.md`, `docs/superpowers/build-process.md`.
