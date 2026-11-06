# Object: remaining work

Status as of 2026-11-05. **All fifteen milestones (M1-M15) are built, reviewed, fixed and gated, and all are on `master`; M10-M15 were gated on Windows on 2026-11-05 (see "2026-11-05: Windows gate" below).** The 2026-11-01 full audit is merged (PR #4, `84f3c16`). The 2026-11-02 behaviour study's polish backlog was built on 2026-11-03 in nine parallel lanes, reviewed once, fixed once and gated (see "2026-11-03: the polish backlog" below). Pushed to origin (`55a4059`). On 2026-11-04 the repo was clean-roomed (`28d55b1`) and the rest of the polish backlog was built (see "2026-11-04" below).

**Next: Object agents, M16-M21** (approved by Gene 2026-11-05). Design: `specs/2026-11-05-agents-design.md`. Every agent is its own Claude Code project folder (soul in `CLAUDE.md`, skills, settings, hooks, MCP servers, memory, chats), loading only that folder's settings, never Gene's user setup; every tool on and switchable per agent (the shell off by default, file tools fenced from every space so "Exclude from AI" holds); a model picker; an Agents section at the top of the sidebar; memory, self-written skills, background learning reviews and a curator; an MCP gateway (in); A2A (outbound) and delegation; schedules. Runs only through the `claude` CLI under Gene's login. Order: M16 chat Markdown and model picker; M17 agents, folders and tools; M18 learning; M19 MCP gateway; M20 A2A and delegation; M21 schedules. Plans `plans/2026-11-05-m16-*.md` to `m21-*.md`.

**Then: the work dashboard, M22-M24** (approved by Gene 2026-11-05). Design: `specs/2026-11-05-work-dashboard-design.md`. Gene's ticket dashboard rebuilt in Object's look: Tasks and Projects are the work and "ticket" is a set of fields any of them can carry (a Tickets view lists them); work fields and an ordered step list (Question / Do / Approve / Agent) replace the hand-kept `## Dashboard` block; a Work section with Now, Flow, Projects map, Today, On the floor, queues, agent queue, Stuck, Wins, Alerts, Everything; brain dump; focus lines; the agent loop through Object's agents (read-only runs narrowed in code; the Work agent has the shell on). Done = Object's status; Tasks get a Project relation; desk sync Jira first. Order: M22 work model; M23 the Work section; M24 brain dump and the agent loop (after M21).

**What remains, in one list** (details: `polish-audit-2026-11-02.md`, "Remaining tasks"):
0. **M10-M15: built and merged** (PRs #5-#11), gated on Windows 2026-11-05. Still open for each: the hand-checks in `m10-acceptance.md` to `m15-acceptance.md` (37 items), the app's own window (pywebview), the AI panel against the real `claude` CLI, and the MCP server under a live Claude Code or Claude Desktop session.
1. **Polish backlog: done** (2026-11-04). Built: local Help & Resources (shortcuts, Getting started, Markdown reference; no external links), empty daily-note placeholders (Day view), Default list view type setting, a saved query per starter template, the empty icon list item fix, Wall card details. Closed by Gene: the per-tool import guides, the `@` picker's Collection badge (collections stay unlinkable), block tags. Deleting a type (our choice, 2026-11-05): its saved queries of only that type go to the Trash with it, other queries drop its id (kept in the trash entry), and a restore brings both back as they were.
2. **Decisions for Gene:** (decided 2026-11-02: all Pro features are unlocked, nothing gated; AI is in, through the Claude Code CLI, planned as M10; the integrations come later at lower priority); whether the how-to guides ship as built-in seeds; scrub the plaintext credentials found in his Work and Personal source spaces before any import.
3. **Gene's hands-on checking** (M1-M9 acceptance docs, 255 unchecked items), and the fixes it produces. **Settled 2026-10-28:** the Standard design shows properties in the side column; they go inline below 768 px.
4. **Not yet catalogued** (needs a scratch view or approval): filter, sort and group editors, Customize card view, Tasks page, Queries, Weblink and PDF viewers, image and file objects, Two Columns/Code/Math/Toggle/Group/Horizontal line blocks, Word and Latex export, Three days view in the other spaces, drag and drop, markdown list shortcuts with real key events.
5. ~~One known test failure on Windows~~ fixed 2026-11-03 (`ba43e66`): the gzip test compared newline-translated text; it now compares bytes.
5b. ~~The M15 test `test_15_previews_of_several_sources_can_start` failing on Windows~~ fixed 2026-11-05: the test made a space "S1" next to its source folder "s1", the same name on a case-insensitive file system, so the app rightly answered 409; the spaces now go in their own folder.
6. **Wiki import follow-ups** (outside the repo, in Gene's `ObjectSpaces` folder): review the 10 "possible secrets" pages listed in `ai-pass/review.md`; the wiki copy is a snapshot (refresh = recopy and AI-reread only new or changed pages).

## 2026-11-05: Windows gate (M10-M15, after the merge)

Local master (the 2026-11-04 decisions and review fixes) merged with origin (M10-M15, PR #9) at `2fc84bb`. The two builds of "a type delete takes its saved queries along" were reconciled on PR #9's, with the local behaviours it lacked ported onto it (a query listing the type twice, a delete or restore that fails partway). Gate on Windows: back end 2053 passed, 13 skipped, 3 xpassed; front end 3123 passed, 1 skipped; `tsc` clean; lint 0 errors; build ok; `m1_roundtrip.py` PASS; `m2`-`m15_acceptance.py` PASS on `space-sample` and `space-v1` (28 runs). M11's run logs four "Tool ... failed" lines: its deliberate error-reply checks.

## 2026-11-05: M15, importers

Import a Notion "Markdown & CSV" export, an Obsidian vault or an Anytype Markdown export (zip or folder, read in place by path) into a new space or, when picked, this space: a preview that writes nothing, editable type and property mappings, a polled job with Stop, new files only, and an "Import report" page. Built on `feat/m15-importers` off `master` in two lanes (back end; dialog), one review, one fix pass in two parts (`b16bc66`, `90af287`) and the gate. Plan `2026-11-05-m15-importers.md`; results, our choices and hand-checks in `m15-acceptance.md`. Built on Linux; not yet run on Windows. The Anytype reader is unverified until a real export is checked.

## 2026-11-05: M14, local automations

Rules that run on this machine: triggers on create, property change, schedule and button; conditions from the view filters; actions that set properties, tag, file into collections, create from templates, append to the daily note and notify; a template "Repeat"; a Button block and a Button property; Settings > Automations with each rule's run log; and a catch-up dialog for missed schedule runs. Built on `feat/m14-automations` off `master` in two lanes (back end; editor and screens), one review, one fix pass (`a4544c5`, `cc2c407`) and the gate. Plan `2026-11-05-m14-automations.md`; results, our choices and hand-checks in `m14-acceptance.md`. Built on Linux; not yet run on Windows.

## 2026-11-05: M13, calendar, timeline and chart layouts

Three new view layouts plus sub-items and dependencies, built on `feat/m13-view-layouts` off `master` in three lanes (calendar; timeline, relation pairs and nested rows; chart), one review, one fix pass (`d6b2d45`) and the gate. Plan `2026-11-05-m13-view-layouts.md`; results, our choices and hand-checks in `m13-acceptance.md`. Built on Linux; not yet run on Windows.

## 2026-11-05: M12, computed and new property kinds

Formula, Rollup, ID, Email, Phone and Files, built on `feat/m12-property-kinds` off `master` in three lanes (back end, property settings, cells and views), one review, one fix pass (`4a81fe2`, `881faf6`) and the gate. Plan `2026-11-05-m12-property-kinds.md`; results, our choices and hand-checks in `m12-acceptance.md`. Built on Linux; not yet run on Windows.

## 2026-11-05: M10, the AI assistant (branch `feat/m10-ai-assistant`, on top of M11)

Built in three lanes (back end; chat panel and settings; editor and object entries), reviewed once, fixed once, gated on Linux. The assistant runs `claude -p` with only Object's MCP read tools, in an empty folder, with a read-only token that lives only in memory; "Exclude from AI" pages and templates are never sent; nothing the assistant proposes is written without a click. Results and our choices: `m10-acceptance.md`.

## 2026-11-05: M11, the local API and MCP server (branch `feat/m11-local-api-mcp`, merged 2026-11-05, PR #5)

Next plan: `2026-11-04-notion-anytype-features-plan.md` (Notion and Anytype comparison; order M11, M10, M12, M13, M14, M15, one branch and PR each, Gene merges). M11 is built and gated on Linux: tokens in the state dir, `/api/v1`, `objectapp-mcp`, Settings > Integrations, "Exclude from AI". Results and our choices: `m11-acceptance.md`.
## 2026-11-04 (later): Gene's six decisions, built

From the walkthrough and the hands-on checklist (`hands-on-checklist.md`, "Decisions"): the slash menu opens only at a block's start or after whitespace; a failed lazy chunk after an update flushes and reloads once (toast if the flush fails, hangs 5 s, or it recurs within 60 s); icon button names and tooltips checked; deleting a type trashes its saved queries and restore brings them back; role values renamed to Object's own names; the page title commits on Escape. Three lanes, one review, one fix pass, gate below.

## 2026-11-04: clean room and the rest of the polish backlog

**Clean room** (`28d55b1`): the repo no longer names or cites the original app. `reference/`, the screenshots and the design notes moved to `a private folder` (outside the repo; history not rewritten, Gene's choice). Space metadata is now `.object/` and `.object-cache/`; `backend/objectapp/legacy.py` renames old folders once on open. The behaviour catalog is `docs/behavior-catalog.md`. The backend role values were renamed to Object's own (`page`, `dailyNote`, ...) the same day.

**Polish** in five worktree lanes, merged `--no-ff`, one review, one fix pass (backend `002306a`, `4b81aea`, `44ecf14`; frontend `3de8d7b`, `38d3d48`, `34f0860`). Our choices to check by hand: Help sits below Graph and Trash; placeholders are Day view only (Week and Three days keep "+ Daily Note", as the catalog says); the type setting is stored as `defaultDataViewLayout`; the 14 template queries (e.g. Books "Currently reading", Projects "Active projects", Films "Top rated films") are in `typetemplates.py` `TEMPLATE_QUERIES`; wall cards show the description under the title and one labelled row per card property with "Empty".

Gate (Windows, at `cf90118`): back end 1592 passed, 12 skipped, 3 xpassed; front end 2528 passed, 1 skipped; `tsc` clean; lint 0 errors; build ok; `m1_roundtrip.py` and `m2`-`m9_acceptance.py` PASS (16 runs).

## 2026-11-03: the polish backlog

Built in nine lanes, one background agent each in its own git worktree, split by file ownership (Gene: work everything in parallel, test once at the end). Merged into `master` with `--no-ff` (one conflict, the shortcut registry, resolved by keeping both lists). Then one two-half review, one fix pass (`8b66d59`, `76401a4`, `0dacbad`, `f4a227a`, `13e7972`, `4052227`, `28e2ce7`) and the gate. Item by item, with the lanes' "our choice" notes: `polish-audit-2026-11-02.md`, "2026-11-03: the parallel pass".

Gate (Windows, at `4052227`; the api-mock fix `28e2ce7` came after, with its tests rerun): back end 1557 passed, 12 skipped, 3 xpassed (the 5,000-object month timing test passes on a quiet machine; it failed once under the nine-lane load); front end 2466 passed, 1 skipped; the one failure, the api-mock contract test, is fixed in `28e2ce7`; `tsc` clean; lint 0 errors; build ok; `m1_roundtrip.py` and `m2`-`m9_acceptance.py` PASS on `space-sample` and `space-v1`.

For Gene's hands-on check: `@` or `[[` in an empty block now inserts an object block (the default; Settings > Editor > Always create inline links keeps the inline form); the root font is 15.5px so the whole app is about 3% smaller; the properties-pane toggle writes `hideProperties` to the object; the types gallery's property kinds are our choice; PDF export prints from a hidden frame, untried inside the pywebview window; Enter in the tag picker picks the closest tag before Create.

## 2026-11-02: the behaviour study

Behaviour reference: `docs/behavior-catalog.md` (sections 1-11). Differences, fixes and backlog: `plans/polish-audit-2026-11-02.md`. **Unlinked mentions must stay** (ground rule in `CLAUDE.md`; built in M5).

Fixed and committed on `master`: daily-note header pill and the calendar section toolbars; Three days view; nested collections in the sidebar and the type context menu (with Pin to Sidebar); how-to guides imported into the wiki space; PDF, Image, Weblink and Audio get their extra fields; the keyboard-hint footer under the slash menu, New menu, link picker and search palette; slash "In a week" and "A week ago"; Find/Present/Delete key hints in the object menu; a Search field in the space switcher; Graph moved beside Trash; the New menu as a popover under the New button (picking a type creates at once); the `@` and `[[` picker as a popover at the caret with recents and a row per type.

Gate at the end of 2026-11-02 (Windows): front end `npx vitest run` 2326 passed, 1 skipped; `tsc -b --noEmit` clean; lint 0 errors; `npm run build` ok. Back end 1463 passed, 12 skipped, 3 xpassed, plus the one pre-existing failure in item 5 (run before the last front-end-only commits; no back-end change since).

**Done on 2026-10-28, on Windows:**
- **Audit bugs:** all ~65 in `audit-2026-10-28.md`, plus every "unconfirmed" item that proved real, fixed one per commit with a failing-first test, in six area branches merged into master (whiteboard, backend API, views and properties, shell, backend storage, editor).
- **Guessed values:** checked (`reference-check-2026-10-28.md`) and applied in four merged branches: keyboard shortcuts (one registry in `lib/shortcuts.ts`), side panel, breadcrumbs, pinned tabs, the 768 px breakpoint, dashboard default sections, Tasks tab order, slash and block menus, highlight and formula formats, search highlight colours and graph limits.
- **Windows-only failures** from the baseline are fixed (non-portable tests, the M5 acceptance cache check, an icon first-render flicker).
- **Gate:** pytest 1202 passed; vitest 1829 passed; `tsc` clean; build ok; `m1_roundtrip.py` and `m2`–`m8_acceptance.py` PASS on `space-sample` and `space-v1`.

**2026-11-02: the polish audit.** A live behaviour study was run (three spaces, read-only except two scratch pages, trashed). Findings: `docs/behavior-catalog.md` (everything observed: Settings, shortcuts, menus, editor chrome, views, graph, export; sections 1-10) and `plans/polish-audit-2026-11-02.md` (what differed from Object, what is fixed, and a consolidated backlog A-H). Fixed so far and committed on `master` (not pushed): daily-note header pill, calendar toolbars, three-days view, nested collections in the sidebar, the type context menu, the how-to guides import. **Unlinked mentions must stay** (Gene's requirement; already built in M5). Backlog progress (media-type fields, the keyboard-hint footer, week date links, the `@` trigger) is tabled in the audit doc's "Progress on the backlog"; next: the rest of the backlog from the top, with tests. Open for Gene: which Pro-gated features to unlock.

Spec: `docs/superpowers/specs/2026-10-23-object-design.md`. How to resume: `HANDOFF.md`, `CONTINUE.md`. Rules: `CLAUDE.md`. Process: `docs/superpowers/build-process.md`.

Behaviour reference: `docs/behavior-catalog.md` and the spec.

## Done

Each milestone's plan holds its full scope. Each acceptance doc holds its automated results, its "our choice" list and Gene's unchecked hand-checks.

| Milestone | Plan | Built, reviewed, gated | Hand-checks |
|---|---|---|---|
| **M1** shell, objects on disk, block editor | `2026-10-23-m1-shell-objects-editor.md` | 2026-10-23 | `m1-acceptance.md` (9) |
| **M2** object types and all property kinds | `2026-10-23-m2-types-properties.md` | `32c7fe2..39432ce` | `m2-acceptance.md` (20) |
| **M3** views, collections, queries, pinned, All notes | `2026-10-26-m3-views-collections-queries.md` | `a89c8cb..925b023`, gate 2026-10-26 | `m3-acceptance.md` (13) |
| **M4** calendar, daily notes, tasks (recurrence, reminders), Tasks page | `2026-10-26-m4-calendar-daily-tasks.md` | `c771907..4fc0b85`, gate 2026-10-27 | `m4-acceptance.md` (22) |
| **M5** SQLite FTS5 search, Ctrl+K palette, backlinks and references, global and local graph | `2026-10-26-m5-search-palette-backlinks-graph.md` | `bb9c57b..5193e60`, gate 2026-10-27 (built alongside M6) | `m5-acceptance.md` (23) |
| **M6** whiteboards: shapes, frames, connectors, gates, pressure ink | `2026-10-26-m6-whiteboards-pen.md` | `ebcdcc8..c4a087c`, same gate | `m6-acceptance.md` (53, incl. Wacom) |
| **M7** remaining blocks, light mode, settings, spaces, tabs, side panel | `2026-10-26-m7-blocks-lightmode-polish.md` | `f98e401..338a42f`, gate 2026-10-27; known-issue fixes `fc0bff2..96af06e` | `m7-acceptance.md` (57, incl. the side-by-side pass) |
| **M8** every feature M4–M7 deferred, local only (31 tasks) | `2026-10-27-m8-deferred-features.md` | `61b6fed..0e7c748`, gate 2026-10-28; review-minor fixes `1721a4b..9383a9b` | `m8-acceptance.md` (40) |
| **M9** the audit's completeness gaps (Tasks 1–23; 13 skipped by Gene) | `2026-10-28-m9-completeness-gaps.md` | `19a8167..c138f1d`, review fixes `3d46450..d17bd90`, gate 2026-10-28 | `m9-acceptance.md` (19) |
| **M10** AI assistant through the Claude Code CLI and M11's MCP read tools | `2026-11-02-m10-ai-assistant.md` | branch `feat/m10-ai-assistant`, gate 2026-11-05 (Linux) | `m10-acceptance.md` (7) |
| **M11** local API, tokens, MCP server, Settings > Integrations | `2026-11-04-notion-anytype-features-plan.md` | branch `feat/m11-local-api-mcp`, gate 2026-11-05 (Linux) | `m11-acceptance.md` (4) |
| **M12** computed and new property kinds (Formula, Rollup, ID, Email, Phone, Files) | `2026-11-05-m12-property-kinds.md` | `01289a8..` on `feat/m12-property-kinds`, gate 2026-11-05 (Linux) | `m12-acceptance.md` (7) |
| **M13** calendar, timeline and chart layouts; sub-items and dependencies | `2026-11-05-m13-view-layouts.md` | `0d9b7db..` on `feat/m13-view-layouts`, gate 2026-11-05 (Linux) | `m13-acceptance.md` (5) |
| **M14** local automations: rules, schedules and catch-up, template repeat, buttons | `2026-11-05-m14-automations.md` | `dbb09d9..` on `feat/m14-automations`, gate 2026-11-05 (Linux) | `m14-acceptance.md` (7) |
| **M15** importers: Notion, Obsidian and Anytype exports | `2026-11-05-m15-importers.md` | `80973d0..` on `feat/m15-importers`, gate 2026-11-05 (Linux) | `m15-acceptance.md` (7) |

M8's "Coverage" section maps every deferred item to a task, or to a spec §2 exclusion: AI, network at runtime, accounts and sharing, mobile, telemetry.

## Linux verification (2026-11-02, after both audit fix passes, at `71ef3b6`)

| Check | Result |
|---|---|
| `uv run pytest backend/tests -q` | 1469 passed, 1 skipped (needs a non-root user), 3 xpassed |
| `cd frontend && npx vitest run` | 2284 passed, 1 skipped (needs `OBJECT_ROUNDTRIP_SPACE`) |
| `npx tsc -b --noEmit` / `npm run lint` / `npm run build` | clean / 0 errors / built |
| `scripts/m1_roundtrip.py`, `m2`–`m9_acceptance.py` on `space-sample` and `space-v1`; `m9` on `space-m8`, `space-blocks`, `space-whiteboard` | all PASS |

## Linux verification (2026-11-01, after the first audit fix pass, at `b7e8761`)

| Check | Result |
|---|---|
| `uv run pytest backend/tests -q` | 1381 passed, 1 skipped (needs a non-root user), 3 xpassed (at `4c4b726`; the two tests added after it pass) |
| `cd frontend && npx vitest run` | 2138 passed, 1 skipped (needs `OBJECT_ROUNDTRIP_SPACE`) |
| `npx tsc -b --noEmit` / `npm run lint` / `npm run build` | clean / 0 errors / built; the entry chunk is 273 KB (76 KB gzip), down from 3.4 MB |
| `scripts/m1_roundtrip.py`, `m2`–`m9_acceptance.py` on `space-sample` and `space-v1`; `m9` on `space-m8`, `space-blocks`, `space-whiteboard` | all PASS (m2 52/52 and 50/50, m3 14/14, m4 24/24, m5 18/18, m6 19/19, m7 23/23, m8 26/26, m9 23/23 on each of the five spaces) |
| Performance after the fixes (synthetic 5,001-object space, headless Chromium) | see `audit-2026-11-01.md`, "Measured after the fixes" |

## Windows verification (2026-10-29, after merging M9 into master as PR #3, at `6ef3df8`)

| Check | Result |
|---|---|
| `uv run pytest backend/tests -q` | 1238 passed, 2 skipped |
| `cd frontend && npx vitest run` | 1965 passed, 1 skipped; 1 timed out under load (`ObjectView.writes.test.tsx` "a renamed event retargets the tabs", 5 s limit), which passed 3 of 3 runs alone |
| `npx tsc -b --noEmit` / `npm run lint` / `npm run build` | clean / 0 errors (warnings only) / built |
| `scripts/m9_acceptance.py` on `space-m8`, `space-blocks`, `space-sample`, `space-v1`, `space-whiteboard` | all PASS, after fixing a Windows path bug in the script (check 6 built the sidecar path with `\`) |
| `scripts/m1_roundtrip.py` and `m2`–`m8_acceptance.py` on `space-sample` and `space-v1` | all PASS |

## Linux verification (2026-10-28, after M9 and Gene's answers, at `35bbd88`)

| Check | Result |
|---|---|
| `uv run pytest backend/tests -q` | 1239 passed, 1 skipped (needs a non-root user) |
| `cd frontend && npx vitest run` | 1966 passed in 308 files, 1 skipped (needs `OBJECT_ROUNDTRIP_SPACE`) |
| `npx tsc -b --noEmit` / `npm run lint` / `npm run build` | clean / 0 errors / built |
| `scripts/m9_acceptance.py` on `space-m8`, `space-blocks`, `space-sample`, `space-v1`, `space-whiteboard` | all PASS (23/23 each) |
| `scripts/m1_roundtrip.py` on a copy of `space-sample` and of `space-v1` | PASS |
| `scripts/m2_acceptance.py` … `m8_acceptance.py` on `space-sample` and `space-v1` | all PASS (m2 52/52 and 50/50, m3 14/14, m4 24/24, m5 18/18, m6 19/19, m7 23/23, m8 26/26) |
| The app (`uv run objectapp --browser`) driven in headless Chromium | every M9 feature used once with 0 console errors and 0 requests leaving 127.0.0.1 (see `m9-acceptance.md`) |

The synthetic fixture spaces are `space-sample`, `space-v1`, `space-calendar`, `space-links`, `space-whiteboard`, `space-blocks` and `space-m8`.

## What is left

0. **Both audit lists are done:** 2026-10-28 (bugs fixed, completeness gaps built as M9) and 2026-11-01 (bugs and optimization, every item, fixed on `ccr-bcf6e946-bf8moc`; merge it). One open question for Gene: should the object page title also commit on Escape, as table title cells now do?
1. **Gene's hands-on checks, M1–M9:** 255 unchecked items. Run them on a copy of the CPI export kept outside the repo, with `git init` there: `npm run build` in `frontend/`, then `uv run objectapp --space <copy>`. These can only be checked on his Windows machine:
   - the pywebview window
   - Windows toast reminders
   - Wacom pressure and tilt
   - microphone and clipboard permissions
   - a type page with 1,000+ real objects
   - the look against the behaviour catalog in Light, Light Dimmed, Dark and Dark Dimmed
2. **Guessed values to confirm or correct** (nothing specifies them):
   - the shortcut keys (`frontend/src/lib/shortcuts.ts`, listed in Settings → Shortcuts)
   - the side-panel area layout, breadcrumbs and pinned tabs
   - the slash and block menu looks
   - the search highlight colour and the graph limits
   - the 480/850 px layout switch points
   - the M8 file formats (block ids and references, inline colours, date tokens, indent and list-item annotations, table formulas, collection and query embeds)
   - M3's default dashboard section tabs (`inNoCollection`/`notTagged`), still to confirm
3. **Check the CPI export for a Task type with no Done-category status option.** Inferred status sets, as in the sample spaces, have none, so those tasks can't be completed until one is added in type settings (M4 finding).
4. **Fix what the hand-checks find.** One finding per commit, each with a regression test, then the full gate.
5. **Not in M9 (Gene's call):** the sidebar types block's Sort Alphabetically / Manually (needs a key kept in each type's default collection); bulk Edit property / Edit tags / Export; export to PDF, Word or LaTeX; duplicating whiteboards; the "name contains status" group ordering (Gene: no).
6. **Deferred by Gene:** TODO handling in the editor. Logseq-style markers were considered and rejected on 2026-10-26.
7. **Later:**
   - an installer (spec §6: "an installer comes later")
   - the in-app Claude Code agent (spec §2)
   - migrating `C:\Git\wiki` into Object's format (a separate project)
   - **Object Team (next version, parked):** a team server, offline desktop sync with merge, user spaces and an MCP agent layer modelled on KiwiFS. Approved 2026-10-28 but not to be started until Gene expands to the team. Spec: `docs/superpowers/specs/2026-10-28-object-team-design.md`; KiwiFS evaluation: `docs/kiwifs-evaluation.md`.

## How we build

- **Plan:** each piece of work gets one plan: a writer, then critics and one resolve pass. Gene cut the critics from M5 on to save time.
- **Build:** one workflow builds it in lanes with disjoint files. Each task commits with its own tests.
- **Finish:** one review, one fix pass, then the gate and a push. No per-task reviews (Gene, 2026-10-26).
- **Gene's checks:** he checks each milestone hands-on. On 2026-10-26 he asked for all milestones to be built first, so his checks of M1–M8 come together.
- **Lessons:** see `build-process.md`: parallel planning, two milestones at once, dependencies up front, the 4-CPU agent cap, resuming after limits.

## Out of scope (by design)

Accounts, login, billing, sync, sharing/publishing, mobile, integrations (Readwise, Kindle, calendar feeds, messaging), AI features (a Claude Code agent comes later), telemetry, importing data from other apps, migrating `C:\Git\wiki` (a separate later project). Accounts, sync, sharing and agent features return in the parked Object Team spec, not in this version.
