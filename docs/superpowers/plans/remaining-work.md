# Object: remaining work

Status as of 2026-11-07: **M1-M27 are all built, reviewed, fixed and gated, and all are on `master`** (the default branch; there is no `main`). The feature branches `feat/m10` to `feat/m15`, `feat/m16-m24`, `feat/m22-m23` and `fix/deleted-type-queries`, and the old `ccr-*` branches, are merged or obsolete. M16-M24 were merged and gated on 2026-11-06 (`78c5785` M16-M21, `a11a5f4` M22-M23, M24 built on `ccr-381ccf85-cjstne`); M25 (provenance and re-runs), M26 (readers and the scan) and M27 (the agent workflow) were built 2026-11-06/07 and gated. M23, M24 and M25-M27 each had one review and one fix pass; M19-M22 were reviewed on their build tracks.

**2026-11-08: bug and polish sweep** (`bug-audit-2026-11-08.md`): at `cbfde62` (after PR #13's copy rewrite and `structure` to `type` rename), eight read-only reviewers found 60 bugs and polish gaps; 52 are fixed on `ccr-ad9683a8-vdfntz` with regression tests, seven lanes by file ownership merged `--no-ff`; eight are Gene's decisions (the PR #13 labels against the catalog, week start, whiteboard constants, the fence's glob characters, casing and message style, two small features). **Gate after the sweep (Linux, 2026-11-08):** back end 3259 passed, 15 skipped, 3 xpassed, 0 failed; front end 3919 passed, 1 skipped (one timing flake under load, green alone); `tsc`, lint (0 errors) and `npm run build` clean; acceptance 52/52 PASS (`m1`, `m2`-`m21`, `m25`, `m27` on `space-sample` and `space-v1`; `m15`, `m22`-`m25`, `m27` on their default spaces; `m26`).

**2026-11-08: bug audit fixed** (`bug-audit-2026-11-07.md`): 45 of 46 findings fixed on `ccr-3a9c4e35-cqxd9s` with regression tests, reviewed once, one fix pass; finding 24 left by design; ten decisions for Gene listed under "Fix status" there. **Gate after the fixes (Linux, 2026-11-08):** back end 3206 passed, 15 skipped, 3 xpassed, 0 failed; front end 3879 passed; `tsc`, lint (0 errors) and `npm run build` clean; every acceptance script PASS.

**Gate before the audit (Linux, 2026-11-07):** back end 3139 passed, 15 skipped, 3 xpassed (`test_m24_loop.py::test_not_before_and_reorder` failed once under full-suite load and passes alone and with its file: a timing flake); front end 3803 passed; `tsc`, lint and `npm run build` clean; `m1_roundtrip.py` and every `m2`-`m27_acceptance.py` PASS (`m1`-`m21` and `m25`-`m27` on `space-sample` and `space-v1`; `m15` and `m22`-`m27` also on their default spaces). M10-M15 were gated on Windows on 2026-11-05 (see "2026-11-05: Windows gate"), M16-M18 on Windows on 2026-11-06 (their sections below); nothing has been gated on Windows since.

The history below is in the order it was written: the per-milestone sections newest first, then the table of everything built, then older verification tables.

**What remains, in one list:**
1. **Gene's hands-on checks, M1-M27** (all unticked: 255 boxes in `m1-acceptance.md` to `m9-acceptance.md`, 37 in `m10` to `m15`, 134 in `m16` to `m27`, and 9 in `m27-ui-acceptance.md`), and the fixes they produce, one finding per commit with a regression test. Run them on a copy of a work export kept outside the repo (`git init` there; `npm run build` in `frontend/`, then `uv run objectapp --space <copy>`). `hands-on-checklist.md` merges the M1-M9 ones. Only his Windows machine can check: the pywebview window, Windows toast reminders, Wacom pressure and tilt, microphone and clipboard permissions, a type page with 1,000+ real objects, and the look against the behaviour catalog in Light, Light Dimmed, Dark and Dark Dimmed.
2. **Never exercised, only tested against fakes:** the real `claude` CLI (the AI panel, agents, the Work agent, the import filing pass), the Atlassian/Jira MCP behind Desk sync, an MCP server under a live Claude Code or Claude Desktop session, OCR (needs `tesseract` installed; untested), SharePoint fetching (M27 ships the skill text and M25's manifest only, no fetch code), the Anytype reader (unverified until a real export is checked), and the M15 import dialog on Windows.
3. **Open review items for Gene's call** (not changed): the M24 list (Retry re-runs a timed-out Approve step with full tools and no new approval; learning and A2A routes rely on the CLI tool lists only; a full-tool work run can reach local app routes; `file_capture` is not atomic; no auto-run depth cap); the M25-M27 list in `m27-acceptance.md` under "Open review items" (agents with a shell can reach the import routes, so 'an agent cannot approve its own schema' rests on the missing MCP tool; MCP `start_import` into a new space skips the proposal check; moving a source folder makes the next run create new objects; a flagged file cannot be imported without protection); M20 review item 5 (Refresh sends the stored token to the card's host even when the card moved its endpoint to another host; the plan contradicts itself); whether any CLI built-in outside the Tools tab should be denied by default, and whether an agent may change an excluded member's collections through `delete_collection` (both from M17).
4. **The bug-audit decisions** (`bug-audit-2026-11-07.md`, "Fix status", items 1-10; the branch is merged, PR #12) and **the sweep's decisions** (`bug-audit-2026-11-08.md`, "Decisions for Gene" and "Choices made in the fixes"). **Other decisions for Gene:** whether the how-to guides ship as built-in seeds; scrub the plaintext credentials found in his Work and Personal source spaces before any import; the guessed values (item 2 of "What is left" below). Settled already: all features unlocked, nothing gated (2026-11-02); AI is in, through the Claude Code CLI; the Standard design shows properties in the side column and inline below 768 px (2026-10-28); deleting a type trashes its saved queries and restore brings them back (2026-11-05).
5. **Not yet catalogued** (needs a scratch view or approval; see `polish-audit-2026-11-02.md`, "Not yet poked"): filter, sort and group editors, Customize card view, Tasks page, Queries, Weblink and PDF viewers, image and file objects, Two Columns/Code/Math/Toggle/Group/Horizontal line blocks, Word and Latex export, Three days view in the other spaces, drag and drop, markdown list shortcuts with real key events.
6. **Wiki import follow-ups** (outside the repo, in Gene's `ObjectSpaces` folder): review the 10 "possible secrets" pages listed in `ai-pass/review.md`; the wiki copy is a snapshot (refresh = recopy and AI-reread only new or changed pages).
7. **Later:** an installer; migrating `C:\Git\wiki` into Object's format (a separate project; M25-M27 are the tooling for it); the network integrations (calendar feeds, Readwise, Kindle, Telegram, WhatsApp, email, Raycast); Object Team (parked, see below).

Done and closed (details in the sections below): the polish backlog (2026-11-03/04), both audits (2026-10-28 and 2026-11-01, merged: PR #4 `84f3c16`), the Windows-only gzip and M15 test failures, M10-M15 (PRs #5-#11), the agents milestones M16-M21 (design `specs/2026-11-05-agents-design.md`), the work dashboard M22-M24 (design `specs/2026-11-05-work-dashboard-design.md`) and import and migration M25-M27 (design `specs/2026-11-06-import-migration-design.md`).

## 2026-11-06/07: M25-M27, import and migration

Plans `2026-11-06-m25-provenance-and-reruns.md`, `2026-11-06-m26-readers-and-scan.md`, `2026-11-06-m27-agent-workflow.md`; results, deviations and hand-checks in `m25-acceptance.md` (10), `m26-acceptance.md` (6), `m27-acceptance.md` (6) and `m27-ui-acceptance.md` (9). **M25**: the `importSource` provenance block and the object page's Source line (Open original, Show file), the Files source kind with `_manifest.jsonl`, originals kept in `Attachments/Originals/` (or as File objects), re-runs that update in place and flag "Changed in both" and "Removed at source", batches with Move batch to Trash, "Try on a copy of this space", a reconciling Import report, and the queryable fields Imported from, Import batch and Source modified. **M26**: file readers (docx, pdf, xlsx/csv, pptx, html, images, original-only) and the local sensitive-content scan with the "Leave out" list (`POST /api/import/scan`, the wizard's "Check for sensitive content" step). **M27**: the schema proposal (only the app applies it), the AI filing pass with a 50-object trial, normalise and the Import inbox collection, five new MCP tools (`import_scan`, `import_proposal`, `import_report`, `save_import_proposal`, `save_import_decisions`; tool counts are now 25 read and 43 write), the "Migrate a source" skill and the wizard's agent steps. One review and one fix pass (the `fix(m27)` commits, `e75e3ac..65553fe`); the open items are in the list above. Built on Linux; gated 2026-11-07 (numbers at the top).

## 2026-11-06: M19-M24, merged and gated

**M19** (the MCP gateway (in): outside MCP servers by command or URL in Settings > Integrations, their secrets in `<state>/secrets.json`, every enabled server in each chat turn's `--mcp-config` filtered by the agent's switches, secret variables for agent folders' `.mcp.json`, server groups on the Tools tab; `m19-acceptance.md`, 11 hand-checks; the review fix added `McpServersAnswer.unreadable`, a Contract addition for Gene to approve; spike in `m19-cli-spike.md`). **M20** (A2A (outbound) and delegation: remote agents added by their Agent Card URL with an optional bearer token or header, listed with a "remote" mark and chatted with over A2A 1.0 JSON-RPC, the once-per-agent context notice, and the `remote_agents_list`, `remote_agent_call` and `delegate` agent tools, flat, at most 3 at once per turn; `m20-acceptance.md`, 12 hand-checks; spike in `m20-spike.md`). **M21** (agent schedules: an M14 rule with a `schedule` trigger and one `runAgent` action, made on the agent page's Schedules tab, in Settings > Automations or by the agent with `schedule_manage`; each run is a new chat saved as an AI Chat; no learning review for schedule runs; a machine-wide `agent-schedules.json` keeps the curator off skills a schedule uses; runs cut off by closing the space go back to the catch-up; `m21-acceptance.md`, 11 hand-checks). **M22** (the work model: ticket and work fields on Tasks and Projects, the step list with whose turn and the approval gate, List and Floor items, `## Activity` and `## Work notes`, the resolution note, the Tickets view, "Add work fields", the work routes and eight `objectapp-mcp` work tools; built on `feat/m22-m23`, cut after M18; `m22-acceptance.md`, 10 hand-checks). **M23** (the Work section: top bar, brain-dump bar, focus rail and the views, focus lines, today's meetings, wins, the Alert type and the monitoring-folder watch, the floor list, keep on top; review fixes are the `fix(m23)` commits; `m23-acceptance.md`, 19 hand-checks). **M24** (the brain dump and the agent loop: Captures, the Work agent, the work loop that queues Gene's approvals, answers, notes, requests and current Agent steps and, with **Agent acts on my approvals** on, runs them one at a time as headless chats with read-only runs narrowed in code; Desk sync; the Captures view; Settings > Work; review fixes `5bb153f`; `m24-acceptance.md`, 12 hand-checks). M16-M21 were merged as `78c5785` and M22-M23 as `a11a5f4` on 2026-11-06; M24 followed on `ccr-381ccf85-cjstne`, which is now `master`. Each milestone passes its own `scripts/mNN_acceptance.py`; the 2026-11-06 merge gate and the 2026-11-07 final gate (numbers at the top) are green.

## 2026-11-06: M18, learning

Each agent saves memories (`MEMORY.md`, `USER.md`, with caps and a frozen per-chat snapshot) and writes and improves its own skills through Object's `memory` and `skill_manage` tools; every change goes to `.object-agent/ledger.jsonl` with its before and after content and the Skills tab can undo it. Background reviews run after a reply (and on demand from "Learn from this chat") and the chat shows "Learning…" then a summary; the curator marks unused agent-made skills stale and archives them while Object is idle, and "Tidy up now" runs the consolidation pass; `session_search` and the Chats tab search the agent's own chats. Built on `feat/m16-m24` (shared with M16-M24; merged to `master` 2026-11-06), commits `bcc01de..5fb14d2` (the review fixes are `8cdc7f9`, `4cf20f5`, `774a339`, `6fa763b` and `5fb14d2`). Plan `2026-11-05-m18-learning.md`; results, deviations and hand-checks in `m18-acceptance.md`; CLI notes in `m18-cli-notes.md`. Gate on Windows (re-run 2026-11-06 at `5fb14d2`): back end 2364 passed, 19 skipped, 3 xpassed (the live tests skip without `OBJECT_LIVE_CLAUDE=1`; 1 warning: a test's background server thread exiting at startup, as in M16 and M17); front end 434 files passed, 1 skipped, 3285 tests passed, 1 skipped; `tsc` clean; lint 0 errors (567 warnings, of kinds the code base already has); build ok; `m1_roundtrip.py` PASS; `m2`-`m18_acceptance.py` PASS on `space-sample` and `space-v1` (34 runs; `m18_acceptance.py` 37 checks on each), plus `m4` on `space-calendar`, `m5` on `space-links`, `m6` on `space-whiteboard`, `m7` on `space-blocks` and `m14` on `space-m8`. Left for Gene by hand: the 15 checks in `m18-acceptance.md` (a memory about him saved and seen in a new chat but not the old one, the "Learning…" line and its summary after about ten messages, the chat going on normally after a review, "Learn from this chat", an agent-made skill on the Skills tab, Undo and undo of the undo in a skill's History, archive, restore and pin, "Tidy up now" merging two skills, the Learning tab's numbers and a 0 interval, the Chats tab search, "Searched past chats", an "Exclude from AI" page staying unread and unremembered, "Memory & skills" opening the Memory tab, unlinked mentions), plus real agent chats with the installed CLI and the app's own window.

## 2026-11-06: M17, agents, agent folders and full tooling

Every agent is its own folder under `<state>/agents/` (the default agent Assistant made on first use), each turn runs the `claude` CLI there with only that folder's settings and a fence that keeps the file tools out of every space, Object's MCP server has 20 read and 35 write tools, and the sidebar has an Agents section, an agent page (Profile, Instructions, Tools, Chats) and a chat agent picker. Built on `feat/m16-m24` (shared with M16-M24; merged to `master` 2026-11-06), commits `a4f42e9..3c1857f` (the review fixes are `9af040b`, `c1edd04` and `3c1857f`). Plan `2026-11-05-m17-agents-and-tools.md`; results, deviations and hand-checks in `m17-acceptance.md`; the live spike in `m17-cli-spike.md`. Gate on Windows (re-run 2026-11-06 at `3c1857f`): back end 2227 passed, 18 skipped, 3 xpassed (the live spike tests skip without `OBJECT_LIVE_CLAUDE=1`; 1 warning: a test's background server thread exiting at startup, as in M16); front end 423 files passed, 1 skipped, 3234 tests passed, 1 skipped; `tsc` clean; lint 0 errors (549 warnings, of kinds the code base already has); build ok; `m1_roundtrip.py` PASS; `m2`-`m17_acceptance.py` PASS on `space-sample` and `space-v1` (32 runs), plus `m4` on `space-calendar`, `m5` on `space-links`, `m6` on `space-whiteboard`, `m7` on `space-blocks` and `m14` on `space-m8`. Left for Gene by hand: the 13 checks in `m17-acceptance.md` (the Agents section, the chat from Assistant and Ctrl+Alt+J, direct writes without Accept and the proposal modes still asking, a new agent's folder and instructions, the Tools tab and the shell warning, the fence on an "Exclude from AI" page, none of his `~/.claude` setup reaching an agent, the Chats tab, delete and restore, "Add agent folder…", an M10 AI Chat continuing with Assistant, unlinked mentions), plus real agent chats beyond the live spike and the app's own window. Also for Gene: whether any CLI built-in outside the Tools tab should be denied by default, and whether an agent may change an excluded member's collections through `delete_collection`.

## 2026-11-06: M16, chat Markdown, tool steps and the model picker

The chat renders every message as safe Markdown (raw HTML shown as text), shows each tool call as a collapsed step between messages, and has a model picker in the chat header and in Settings > AI Assistant; the model list is one back-end constant (`aimodels.MODELS`, served by `GET /api/ai/models`). Built on `feat/m16-m24` (shared with M17-M24; merged to `master` 2026-11-06), commits `d4a9d89..ff60aea`. Plan `2026-11-05-m16-chat-polish-model-picker.md`; results, our calls and hand-checks in `m16-acceptance.md`. Gate on Windows (re-run 2026-11-06 at `59b9df4`, after the review fixes `b13752e`, `9017f92` and M17's contract `a4f42e9`): back end 2094 passed, 17 skipped, 3 xpassed (1 warning: a test's background server thread exiting at startup); front end 410 files passed, 1 skipped, 3177 tests passed, 1 skipped (the first run failed `appIcons.test.ts` twice: M17's contract added `ph-robot` in `src/` without regenerating the icon subset; fixed in `59b9df4` and the file re-run green); `tsc` clean; lint 0 errors (526 warnings, of kinds the code base already has); build ok; `m1_roundtrip.py` PASS; `m2`-`m16_acceptance.py` PASS on `space-sample` and `space-v1` (30 runs), plus `m4` on `space-calendar`, `m5` on `space-links`, `m6` on `space-whiteboard`, `m7` on `space-blocks` and `m14` on `space-m8`. M11's run logs four "Tool ... failed" lines: its deliberate error-reply checks. Left for Gene by hand: the 9 checks in `m16-acceptance.md` (a real reply's rendering in both themes, Copy pasting the source, tool steps, object-link chips, a hostile reply staying inert, the picker's list and a mid-chat switch, the `haiku` alias with the installed CLI, the Settings picker, New chat resetting to Default), plus the real `claude` CLI and the app's own window.

## 2026-11-05: Windows gate (M10-M15, after the merge)

Local master (the 2026-11-04 decisions and review fixes) merged with origin (M10-M15, PR #9) at `2fc84bb`. The two builds of "a type delete takes its saved queries along" were reconciled on PR #9's, with the local behaviours it lacked ported onto it (a query listing the type twice, a delete or restore that fails partway). Gate on Windows: back end 2053 passed, 13 skipped, 3 xpassed; front end 3123 passed, 1 skipped; `tsc` clean; lint 0 errors; build ok; `m1_roundtrip.py` PASS; `m2`-`m15_acceptance.py` PASS on `space-sample` and `space-v1` (28 runs). M11's run logs four "Tool ... failed" lines: its deliberate error-reply checks.

## 2026-11-05: M15, importers

Import a Notion "Markdown & CSV" export, an Obsidian vault or an Anytype Markdown export (zip or folder, read in place by path) into a new space or, when picked, this space: a preview that writes nothing, editable type and property mappings, a polled job with Stop, new files only, and an "Import report" page. Built on `feat/m15-importers` off `master` in two lanes (back end; dialog), one review, one fix pass in two parts (`b16bc66`, `90af287`) and the gate. Plan `2026-11-05-m15-importers.md`; results, our choices and hand-checks in `m15-acceptance.md`. Built on Linux; gated on Windows 2026-11-05 after the merge (see "2026-11-05: Windows gate"). The Anytype reader is unverified until a real export is checked.

## 2026-11-05: M14, local automations

Rules that run on this machine: triggers on create, property change, schedule and button; conditions from the view filters; actions that set properties, tag, file into collections, create from templates, append to the daily note and notify; a template "Repeat"; a Button block and a Button property; Settings > Automations with each rule's run log; and a catch-up dialog for missed schedule runs. Built on `feat/m14-automations` off `master` in two lanes (back end; editor and screens), one review, one fix pass (`a4544c5`, `cc2c407`) and the gate. Plan `2026-11-05-m14-automations.md`; results, our choices and hand-checks in `m14-acceptance.md`. Built on Linux; gated on Windows 2026-11-05 after the merge (see "2026-11-05: Windows gate").

## 2026-11-05: M13, calendar, timeline and chart layouts

Three new view layouts plus sub-items and dependencies, built on `feat/m13-view-layouts` off `master` in three lanes (calendar; timeline, relation pairs and nested rows; chart), one review, one fix pass (`d6b2d45`) and the gate. Plan `2026-11-05-m13-view-layouts.md`; results, our choices and hand-checks in `m13-acceptance.md`. Built on Linux; gated on Windows 2026-11-05 after the merge (see "2026-11-05: Windows gate").

## 2026-11-05: M12, computed and new property kinds

Formula, Rollup, ID, Email, Phone and Files, built on `feat/m12-property-kinds` off `master` in three lanes (back end, property settings, cells and views), one review, one fix pass (`4a81fe2`, `881faf6`) and the gate. Plan `2026-11-05-m12-property-kinds.md`; results, our choices and hand-checks in `m12-acceptance.md`. Built on Linux; gated on Windows 2026-11-05 after the merge (see "2026-11-05: Windows gate").

## 2026-11-05: M10, the AI assistant (branch `feat/m10-ai-assistant`, on top of M11, merged to `master`)

Built in three lanes (back end; chat panel and settings; editor and object entries), reviewed once, fixed once, gated on Linux. The assistant runs `claude -p` with only Object's MCP read tools, in an empty folder, with a read-only token that lives only in memory; "Exclude from AI" pages and templates are never sent; nothing the assistant proposes is written without a click. Results and our choices: `m10-acceptance.md`.

## 2026-11-05: M11, the local API and MCP server (branch `feat/m11-local-api-mcp`, merged 2026-11-05, PR #5)

Next plan: `2026-11-04-notion-anytype-features-plan.md` (Notion and Anytype comparison; order M11, M10, M12, M13, M14, M15, one branch and PR each, Gene merges). M11 is built and gated on Linux: tokens in the state dir, `/api/v1`, `objectapp-mcp`, Settings > Integrations, "Exclude from AI". Results and our choices: `m11-acceptance.md`.
## 2026-11-04 (later): Gene's six decisions, built

From the walkthrough and the hands-on checklist (`hands-on-checklist.md`, "Decisions"): the slash menu opens only at a block's start or after whitespace; a failed lazy chunk after an update flushes and reloads once (toast if the flush fails, hangs 5 s, or it recurs within 60 s); icon button names and tooltips checked; deleting a type trashes its saved queries and restore brings them back; role values renamed to Object's own names; the page title commits on Escape. Three lanes, one review, one fix pass, gate below.

## 2026-11-04: folder names, roles and the rest of the polish backlog

**Names** (`28d55b1`): space metadata is `.object/` and `.object-cache/`. The behaviour catalog is `docs/behavior-catalog.md`. The backend role values were renamed (`page`, `dailyNote`, ...) the same day.

**Polish** in five worktree lanes, merged `--no-ff`, one review, one fix pass (backend `002306a`, `4b81aea`, `44ecf14`; frontend `3de8d7b`, `38d3d48`, `34f0860`). Our choices to check by hand: Help sits below Graph and Trash; placeholders are Day view only (Week and Three days keep "+ Daily Note", as the catalog says); the type setting is stored as `defaultDataViewLayout`; the 14 template queries (e.g. Books "Currently reading", Projects "Active projects", Films "Top rated films") are in `typetemplates.py` `TEMPLATE_QUERIES`; wall cards show the description under the title and one labelled row per card property with "Empty".

Gate (Windows, at `cf90118`): back end 1592 passed, 12 skipped, 3 xpassed; front end 2528 passed, 1 skipped; `tsc` clean; lint 0 errors; build ok; `m1_roundtrip.py` and `m2`-`m9_acceptance.py` PASS (16 runs).

## 2026-11-03: the polish backlog

Built in nine lanes, one background agent each in its own git worktree, split by file ownership (Gene: work everything in parallel, test once at the end). Merged into `master` with `--no-ff` (one conflict, the shortcut registry, resolved by keeping both lists). Then one two-half review, one fix pass (`8b66d59`, `76401a4`, `0dacbad`, `f4a227a`, `13e7972`, `4052227`, `28e2ce7`) and the gate. Item by item, with the lanes' "our choice" notes: `polish-audit-2026-11-02.md`, "2026-11-03: the parallel pass".

Gate (Windows, at `4052227`; the api-mock fix `28e2ce7` came after, with its tests rerun): back end 1557 passed, 12 skipped, 3 xpassed (the 5,000-object month timing test passes on a quiet machine; it failed once under the nine-lane load); front end 2466 passed, 1 skipped; the one failure, the api-mock contract test, is fixed in `28e2ce7`; `tsc` clean; lint 0 errors; build ok; `m1_roundtrip.py` and `m2`-`m9_acceptance.py` PASS on `space-sample` and `space-v1`.

For Gene's hands-on check: `@` or `[[` in an empty block now inserts an object block (the default; Settings > Editor > Always create inline links keeps the inline form); the root font is 15.5px so the whole app is about 3% smaller; the properties-pane toggle writes `hideProperties` to the object; the types gallery's property kinds are our choice; PDF export prints from a hidden frame, untried inside the pywebview window; Enter in the tag picker picks the closest tag before Create.

## 2026-11-02: the behaviour catalog

Behaviour reference: `docs/behavior-catalog.md` (sections 1-11). Differences, fixes and backlog: `plans/polish-audit-2026-11-02.md`. **Unlinked mentions must stay** (ground rule in `CLAUDE.md`; built in M5).

Fixed and committed on `master` (since pushed): daily-note header pill and the calendar section toolbars; Three days view; nested collections in the sidebar and the type context menu (with Pin to Sidebar); how-to guides imported into the wiki space; PDF, Image, Weblink and Audio get their extra fields; the keyboard-hint footer under the slash menu, New menu, link picker and search palette; slash "In a week" and "A week ago"; Find/Present/Delete key hints in the object menu; a Search field in the space switcher; Graph moved beside Trash; the New menu as a popover under the New button (picking a type creates at once); the `@` and `[[` picker as a popover at the caret with recents and a row per type.

Gate at the end of 2026-11-02 (Windows): front end `npx vitest run` 2326 passed, 1 skipped; `tsc -b --noEmit` clean; lint 0 errors; `npm run build` ok. Back end 1463 passed, 12 skipped, 3 xpassed, plus the one pre-existing failure in item 5 (run before the last front-end-only commits; no back-end change since).

**Done on 2026-10-28, on Windows:**
- **Audit bugs:** all ~65 in `audit-2026-10-28.md`, plus every "unconfirmed" item that proved real, fixed one per commit with a failing-first test, in six area branches merged into master (whiteboard, backend API, views and properties, shell, backend storage, editor).
- **Guessed values:** settled on 2026-10-28 and applied in four merged branches: keyboard shortcuts (one registry in `lib/shortcuts.ts`), side panel, breadcrumbs, pinned tabs, the 768 px breakpoint, dashboard default sections, Tasks tab order, slash and block menus, highlight and formula formats, search highlight colours and graph limits.
- **Windows-only failures** from the baseline are fixed (non-portable tests, the M5 acceptance cache check, an icon first-render flicker).
- **Gate:** pytest 1202 passed; vitest 1829 passed; `tsc` clean; build ok; `m1_roundtrip.py` and `m2`–`m8_acceptance.py` PASS on `space-sample` and `space-v1`.

**2026-11-02: the polish audit.** The behaviour catalog was written out in full (`docs/behavior-catalog.md`: Settings, shortcuts, menus, editor chrome, views, graph, export; sections 1-10) and Object was checked against it (`plans/polish-audit-2026-11-02.md`: what differed, what is fixed, and a consolidated backlog A-H). Fixed and committed on `master` (since pushed): daily-note header pill, calendar toolbars, three-days view, nested collections in the sidebar, the type context menu, the how-to guides import. **Unlinked mentions must stay** (Gene's requirement; already built in M5). Backlog progress (media-type fields, the keyboard-hint footer, week date links, the `@` trigger) is tabled in the audit doc's "Progress on the backlog"; next: the rest of the backlog from the top, with tests. (Gene decided on 2026-11-02 to unlock them all.)

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
| **M10** AI assistant through the Claude Code CLI and M11's MCP read tools | `2026-11-02-m10-ai-assistant.md` | `feat/m10-ai-assistant`, merged to `master`; gate 2026-11-05 (Linux, then Windows) | `m10-acceptance.md` (7) |
| **M11** local API, tokens, MCP server, Settings > Integrations | `2026-11-04-notion-anytype-features-plan.md` | `feat/m11-local-api-mcp`, merged (PR #5); gate 2026-11-05 (Linux, then Windows) | `m11-acceptance.md` (4) |
| **M12** computed and new property kinds (Formula, Rollup, ID, Email, Phone, Files) | `2026-11-05-m12-property-kinds.md` | `01289a8..` on `feat/m12-property-kinds`, merged to `master`; gate 2026-11-05 (Linux, then Windows) | `m12-acceptance.md` (7) |
| **M13** calendar, timeline and chart layouts; sub-items and dependencies | `2026-11-05-m13-view-layouts.md` | `0d9b7db..` on `feat/m13-view-layouts`, merged to `master`; gate 2026-11-05 (Linux, then Windows) | `m13-acceptance.md` (5) |
| **M14** local automations: rules, schedules and catch-up, template repeat, buttons | `2026-11-05-m14-automations.md` | `dbb09d9..` on `feat/m14-automations`, merged to `master`; gate 2026-11-05 (Linux, then Windows) | `m14-acceptance.md` (7) |
| **M15** importers: Notion, Obsidian and Anytype exports | `2026-11-05-m15-importers.md` | `80973d0..` on `feat/m15-importers`, merged to `master`; gate 2026-11-05 (Linux, then Windows) | `m15-acceptance.md` (7) |
| **M16** chat Markdown, tool steps and the model picker | `2026-11-05-m16-chat-polish-model-picker.md` | `d4a9d89..ff60aea` on `feat/m16-m24`, merged to `master` 2026-11-06; gate 2026-11-06 (Windows) | `m16-acceptance.md` (9) |
| **M17** agents, agent folders and full tooling | `2026-11-05-m17-agents-and-tools.md` | `a4f42e9..3c1857f` on `feat/m16-m24`, merged to `master` 2026-11-06; gate 2026-11-06 (Windows) | `m17-acceptance.md` (13) |
| **M18** learning: memory, skills, ledger and Undo, reviews, curator, chat search | `2026-11-05-m18-learning.md` | `bcc01de..5fb14d2` on `feat/m16-m24`, merged to `master` 2026-11-06; gate 2026-11-06 (Windows) | `m18-acceptance.md` (15) |
| **M19** the MCP gateway (in): outside MCP servers, secrets, secret variables, server tool groups | `2026-11-05-m19-mcp-gateway.md` | `0ced74b..bf6efce` plus the integration commit on `feat/m16-m24`, merged and gated 2026-11-06 (`78c5785`) | `m19-acceptance.md` (11) |
| **M20** A2A (outbound) and delegation: remote agents, `remote_agents_list`, `remote_agent_call`, `delegate` | `2026-11-05-m20-a2a-and-delegation.md` | `d2554b3..2b26f0b` plus the integration commit, merged and gated 2026-11-06 | `m20-acceptance.md` (12) |
| **M21** agent schedules: the Schedules tab, `runAgent` rules, `schedule_manage`, catch-up | `2026-11-05-m21-schedules.md` | `02c584d..40e8cec` plus the integration commit, merged and gated 2026-11-06 | `m21-acceptance.md` (11) |
| **M22** the work model: work and ticket fields, steps and the approval gate, Activity, the Tickets view | `2026-11-05-m22-work-model.md` | `822e467..` on `feat/m22-m23`, merged 2026-11-06 (`a11a5f4`); gate 2026-11-06 (Linux) | `m22-acceptance.md` (10) |
| **M23** the Work section: views, focus lines, wins, alerts, floor, seams | `2026-11-05-m23-work-section.md` | merged 2026-11-06; review fixes `fix(m23)`; gate 2026-11-06 (Linux) | `m23-acceptance.md` (19) |
| **M24** brain dump and the agent loop: Captures, the Work agent, the work loop, Desk sync | `2026-11-05-m24-brain-dump-and-agent-loop.md` | `f348dd8..c45b4ae` plus the integration commit, one review fix pass (`5bb153f`); on `master`; gate 2026-11-06 (Linux) | `m24-acceptance.md` (12) |
| **M25** provenance and re-runs: `importSource`, the Source line, the Files kind, originals, batches, Move batch to Trash | `2026-11-06-m25-provenance-and-reruns.md` | `b7cecad..d691f51`, built 2026-11-06/07; gate 2026-11-07 (Linux) | `m25-acceptance.md` (10) |
| **M26** readers (docx, pdf, xlsx/csv, pptx, html, images) and the sensitive-content scan | `2026-11-06-m26-readers-and-scan.md` | `803e4d8..cb5c06d`, 2026-11-06/07; gate 2026-11-07 (Linux) | `m26-acceptance.md` (6) |
| **M27** the agent workflow: proposal, trial, normalise, Import inbox, MCP tools, the Migrate a source skill | `2026-11-06-m27-agent-workflow.md` | `371ff1d..9f0687a`, review fixes `e75e3ac..65553fe`; gate 2026-11-07 (Linux) | `m27-acceptance.md` (6) and `m27-ui-acceptance.md` (9) |

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

## What is left (older detail; the current list is at the top)

0. **Both audit lists are done and merged:** 2026-10-28 (bugs fixed, completeness gaps built as M9) and 2026-11-01 (bugs and optimization, PR #4). The object page title commits on Escape (Gene's decision of 2026-11-04).
1. **Gene's hands-on checks, M1–M9:** 255 unchecked items (M10-M27 are in the list at the top). Run them on a copy of the CPI export kept outside the repo, with `git init` there: `npm run build` in `frontend/`, then `uv run objectapp --space <copy>`. These can only be checked on his Windows machine:
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
- **Gene's checks:** he checks each milestone hands-on. On 2026-10-26 he asked for all milestones to be built first, and on 2026-11-05 for M16-M24 to be built straight through (and M25-M27 after), so his checks of M1-M27 come together.
- **Lessons:** see `build-process.md`: parallel planning, two milestones at once, dependencies up front, the 4-CPU agent cap, resuming after limits.

## Out of scope (by design)

Accounts, login, billing, sync, sharing/publishing, mobile, telemetry, migrating `C:\Git\wiki` (a separate later project; M25-M27 are its tooling). The network integrations (Readwise, Kindle, calendar feeds, messaging, email, Raycast) are wanted later at lower priority. AI (M10, M16-M21), the local API and MCP server (M11), the Work section (M22-M24) and importing from other apps (M15, M25-M27) are built. Accounts, sync and sharing return only in the parked Object Team spec (`specs/2026-10-28-object-team-design.md`), not in this version.
