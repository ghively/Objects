# Decisions memo, 2026-11-08

> **Approved by Gene, 2026-11-08: every Recommendation below, as written** ("I am going to accept your
> recommendations"). S4 and S7 were settled by the live-CLI run the same day (`live-cli-check-2026-11-08.md`:
> S4 fixed by escaping `[ ]`, `fix(sweep-18)`; S7 `--resume` PASS). Also approved the same day, from the
> live-CLI and acceptance runs: **A-1** hide/grey the Glob and Grep switches when the shell is on (CLI 2.1.319
> gives shell runs neither), with a note why; **A-2** accept and document that a `\` in a Linux folder name
> can't be fenced; **AC-1** allow sub-items and dependencies on the basic Task type; **AC-2** imported images
> become Image objects (the design's call), not a Page holding the image (2026-11-09: the preview lists them under an Image row); **OCR** fix mixed PDFs (OCR the
> scanned pages of a PDF that has a text layer elsewhere) and the double OCR in the scan step, English only
> for now; **Q-1** hide the query modes Exact and Semantic until real full-text search exists; **C9** the
> Three days tooltip says "Show the day before and after".

Every open decision and review item from `remaining-work.md` ("What remains", items 3-5; "What is left", item 2),
`bug-audit-2026-11-07.md` ("Fix status"), `bug-audit-2026-11-08.md` ("Decisions for Gene", "Choices made in
the fixes", "Open items", LOW 13-22), `m17`, `m20`, `m24`, `m27-acceptance.md` and `polish-audit-2026-11-02.md`
("Not yet poked"), checked against the code at `da12f82` (master). Paths are under `backend/objectapp/` or
`frontend/src/` unless written in full. Each **Recommendation** line can be approved with "yes".

Answer with the IDs, for example: "S1-S5 yes, D3 change: ...".

## 0. Already closed in code (no decision needed)

Checked in code; listed so nobody reopens them.

| Item | Where it is closed |
|---|---|
| M24: Retry re-runs a timed-out Approve step | `workloop.py:516-531`: Retry on an Approve entry calls `_reapprove` and answers 409 `REAPPROVE` (`:84`), so the step goes back to Open and needs a new approval |
| M24/M27: a full-tool run reaching the app's own routes | `runfence.py` (peer PID through `psutil`, refuses `/api` to a run's process tree), installed at `server.py:1008`; `psutil>=7.2.2` in `pyproject.toml:17`. Limits in S6 |
| M24: `file_capture` not atomic | `captures.py:377` `_write_props` goes through `Space._write`; pinned by `test_m24_captures.py` (`m24-acceptance.md`, "Review items closed") |
| M27: MCP `start_import` into a new space skips the proposal check | `api_v1_tools.py:1123` sends `requireApproved: True` (commit `879c746`) |
| M27: a moved source folder creates new objects | matched by `(system, id)`; the report says "Source moved" (`importers/report.py:165`, commit `35dc66d`) |
| M20 item 5: Refresh sends the token to a moved host | pending address plus `POST /remote-agents/{id}/confirm-endpoint` (`api_remote_agents.py:16-18,368`) |
| 2026-11-08 finding 4: read-only runs delegate to a full-write run | `api_agent_a2a_v1.py:109-117` `flat()` now runs every `WRITE_GUARDS` check |
| LOW 13-17, 19-22 (2026-11-08) | fixed: 13 `server.py:1112` "Choose a folder by its full path.", `spaces.py:281` NUL refused; 14, 15, 16, 20, 21, 22 by the `fix(sweep)` commits of the same names (`a2a.py:219` catches `httpx.InvalidURL`; `export.py` `_MD_LINK_RE` holds one level of parentheses); 17 `api_ai.py:135,372-374` `CHAT_BUSY`; 19 `workloop.py:166-173` (a run that completed its step before erring counts as done). **18 is still open (S4).** |

## 1. Safety and review items, highest risk first

**S1 / CLI built-ins outside the Tools tab are on in every run**
- Current: every run passes `--tools default` (`agentrun.py:107-108`) and builds `--allowedTools`/`--disallowedTools` only from the eleven `toolcatalog.BUILTINS` rows (`toolcatalog.py:139-151`) plus `Skill` (`:156`). The CLI 2.1.317 also offers `CronCreate`, `CronDelete`, `CronList`, `RemoteTrigger`, `ScheduleWakeup`, `SendMessage`, `PushNotification`, `PublishPlugin`, `ShareOnboardingGuide`, `DesignSync`, `Workflow`, `Monitor`, `EnterWorktree`, `ExitWorktree`, `ListAgents`, `ReportFindings`, `TaskStop` (`m17-cli-spike.md:124-128`). Under `dontAsk` the ones that need a permission are refused; "whether each of these needs one was not checked" (`m17-cli-spike.md:146-149`).
- Risk: a run (including a read-only Work run or an import-filing run over untrusted documents) may schedule or trigger work outside Object's fence, ledger and Agent queue, and nothing in Object shows it.
- Options: (a) leave as is; (b) add the known extra names to every run's `--disallowedTools`; (c) replace `--tools default` with the explicit list: the on `BUILTINS` names, `Skill`, `ToolSearch` (MCP tools are deferred behind it, `m17-cli-spike.md:141-144`), so a new CLI tool is off until it gets a Tools-tab row.
- **Recommendation: (c) explicit `--tools` list (Tools-tab built-ins + `Skill` + `ToolSearch`), with one live-CLI check that Object's MCP tools still load.**

**S2 / Learning and agent-tool routes trust the CLI's tool lists**
- Current: `/api/v1/agent/memory`, `/skills/manage` and the A2A/delegate routes check only `v1guard.agent_tool_allowed` (`v1guard.py:203-207`), which passes whenever the token's `tools` is None (`tokens.py:103-104`). Only review and curator runs set `tools` (`reviews.py:544-546`, `curator.py:424-426`); chat turns (`api_ai.py:375-377`) and every headless run (Work, filing, schedules, delegate: `headless.py:181-183`) mint tokens without it. The learning routes need no `read-write` scope by design (`api_learning_v1.py:19-22`). So a read-only Work run (`work-read`), an import-filing run or a proposal-mode chat (scope `read`) is kept from `memory`/`skill_manage` only by the CLI's `--disallowedTools` names (`worktools.py:110-112`), and an agent's own Tools-tab switch-off of `memory`, `skill_manage`, `delegate` or `remote_agent_call` is enforced only by the CLI (`toolcatalog.py:255-257`).
- Risk: a prompt injection in an imported or filed document could write the agent's `MEMORY.md` or a skill, which then reaches every later chat of that agent (undoable from the ledger, but silent).
- Options: (a) leave; (b) stamp every run's token with `tools` = the agent tools its CLI lists allow (the same set `run_tool_lists` / `read_run_tools` already compute), so the server refuses the rest with "This run can't use {tool}."; (c) (b) plus refuse memory and skill writes from the read-only purposes (`work-read`, `work-file`, `work-sync`, import filing).
- **Recommendation: (c): mint every run's token with its allowed agent-tool list, and no memory/skill writes from read-only purposes.**

**S3 / No auto-run depth cap**
- Current: `on_notice` calls `_auto_check` for every work notice, the agent's own included (`workloop.py:328-331`). When an Agent step becomes current and is Open, with **Agent acts on my approvals** on and **Agent runs by itself** on (default `True`, `settings.py:102`), `_auto_check` runs it as the app (`workloop.py:424-447`), which queues an `auto` entry (`workqueue.py:68-70,91-92`). A `work-read` run may complete Agent steps and add steps (`worktools.py:50-55`; `workrules.py:476-487` refuses only an Agent step placed before an open Approve gate) and remove done Agent steps (`workrules.py:454-455` locks only Approve steps). The dedupe key is path + step id + text (`workqueue.py:108-109`), and each new step gets a new id. The chain is bounded only by `MAX_STEPS = 50` steps per item (`workmodel.py:101`), and removing done steps resets that.
- Risk: an agent that keeps adding "next" Agent steps runs read-only CLI sessions back to back with no human in the loop (up to 30 minutes each, `workagentmodel.py:67`). That costs usage and fills the queue; it can't write outside the step tools.
- Options: (a) leave; (b) cap consecutive auto-runs per item since the last user action at N, then leave the step Open with a reason shown in Stuck; (c) never auto-run a step the agent itself added.
- **Recommendation: (b) with N=3 consecutive auto-runs per work item, reset by any user action on that item; the 4th waits for Run now.** (2026-11-09: a property or body edit made in the app counts as the user's action too.)

**S4 / Glob characters in fence rule paths (sweep finding 18)**
- Current: `rule_path` (`agentrun.py:322-329`) writes the folder path as is into `Read(<path>/**)`/`Edit(<path>/**)`; `[`, `]`, `{`, `}`, `*`, `?` are not escaped. Whether the CLI reads `[2024]` as a character class is unchecked (live CLI only).
- Risk: if it is a class, a space in a folder like `Notes [2024]` is unfenced, and the file tools can read its "Exclude from AI" pages.
- Options: (a) wait for the live check; (b) fail closed now: refuse to start a run whose fenced paths contain any of `[ ] { } * ?`, with "Rename the folder … to use agents on it."; then escape once the check shows the CLI's syntax.
- **Recommendation: (b): fail closed now, then do the one live check and switch to escaping.**

**S5 / `delete_collection` touches excluded members**
- Current: the v1 route (`api_v1_tools.py:958-980`) answers the 428 with `affected` (visible members) and `hiddenCount` (excluded ones), and on `confirm=true` calls the app route, which moves excluded sole members to the Trash and edits excluded shared members' `collections:` line (`space.py:1481-1514`). The answer hides their paths (`api_v1_tools.py:409-415`). Every other v1 write to an excluded page is a 404 (sweep "Checked and found fine", HTTP).
- Risk: one indirect path by which an agent changes or trashes "Exclude from AI" pages (restorable from the Trash for 30 days).
- Options: (a) keep; (b) refuse with 409 when `hiddenCount > 0` ("This collection holds pages excluded from AI; delete it in Object."); (c) delete but leave excluded members untouched (their `collections:` line then names a collection in the Trash).
- **Recommendation: (b): refuse `delete_collection` over the API when the collection has any excluded member.**

**S6 / Run-fence limits**
- Current: `runfence.py:22-34`: a process that detaches from the run's tree (`setsid`, `nohup`, a scheduled task) is not seen. Where `psutil` can't list connections with owners (macOS without root, some sandboxes), it logs once and lets every `/api` request through. No Windows hand-check yet.
- Risk: the Work agent has the shell (HANDOFF, decisions 2026-11-05), so a detached `curl` still reaches the import-approval routes. On macOS the fence is off.
- Options: (a) accept and document; (b) add a per-launch random header (or cookie) that the browser UI sends and `/api` requires, so a process without it is refused whatever its parentage; (c) (b) on macOS only.
- **Recommendation: (b): a per-launch `/api` secret the UI carries, keeping the PID fence as the second layer; do the Windows hand-check with it.**

**S7 / `--resume` under the `~/.claude/projects/**` deny rule**
- Current: `agentrun.py:362-368` denies `Read` of `projects/**`, `settings.json`, `settings.local.json`, `.claude.json`; resumed chats pass `--resume <session>` (`agentrun.py:674-675`). The sweep judged the CLI reads its own session itself, not through the Read tool (`bug-audit-2026-11-08.md`, choice 2). Unchecked live.
- Risk: if wrong, every second turn of a chat loses its context (fails visibly, nothing leaks).
- **Recommendation: one live-CLI check (two-turn chat); keep the deny rule either way and, if resume breaks, narrow the rule to other folders' sessions.**

**S8 / Remote-agent chats have no in-flight guard**
- Current: a remote agent returns through `remotechat.respond` before the `_RUNNING` check (`api_ai.py:285-286` vs `:371-374`); sweep choice 3.
- Risk: the same chat open in two tabs interleaves its transcript and sends two A2A calls (LOW).
- **Recommendation: apply the same `CHAT_BUSY` guard to remote chats.**

**S9 / The learning ledger has no cap (2026-11-07 decision 6)**
- Current: `ledger.py:14-16`: reads reuse the last parse; the file grows without a cap.
- Risk: slow growth only (LOW).
- **Recommendation: keep uncapped; revisit when a ledger passes 10 MB.**

**S10 / A flagged file can't be imported plain (M27)**
- Current: `importers/agentwire.py:67-68`: flagged files are always in `excludeFromAi`; the scan choices can only add to it.
- Risk: none (fails safe); a false positive needs the property cleared by hand after import.
- **Recommendation: keep.**

**S11 / A "Changed in both" re-run keeps the new original and images (M27, held back on purpose)**
- Risk: disk only; identical bytes are reused (`m27-acceptance.md`, "Open review items").
- **Recommendation: keep.**

## 2. Other decisions

**D1 / How-to guides as built-in seeds**
- Current: "Start with basic setup" writes only the four type definitions (`basicsetup.py:1-27`, `write_basic_types`); Help bundles two read-only texts, Getting started and Markdown reference (`help/HelpSection.tsx:2`, `help/getting-started.md`, `help/markdown-reference.md`). The guides exist only in the imported wiki space (`polish-audit-2026-11-02.md` item 18).
- Options: (a) no seeds; (b) seed one "How to use …" object per basic-setup type into new spaces; (c) ship them as more read-only Help pages, like Getting started.
- **Recommendation: (c): guides as read-only Help pages; never seed objects into a space (they would land in All notes and the counts).**

**D2 / Plaintext credentials in the Work and Personal source spaces: scrub procedure**
1. Treat every credential found as exposed: rotate it at its system first (AD, Jira/Atlassian tokens, database and service passwords, API keys).
2. Redact in the source app itself (its own version history keeps the old text), then make a fresh export.
3. Copy the export outside the repo and outside `~/Spaces/main`; run `git init` there, so each redaction is a diff.
4. Scan the copy with Object's local scan: the import wizard's "Check for sensitive content" step, or `POST /api/import/scan {"path": "<absolute path>", "leaveOut": []}` (`api_importscan.py:1-60`). It finds private keys, API keys and tokens by format, password assignments, connection strings and card numbers (`importscan.py:28-64`), and names only file, kind and line, never the value (`importscan.py:3-4`).
5. The scan misses prose ("pw is Hunter2", credential tables), so also grep the copy case-insensitively for `pass|pw|pwd|login|creds|token|secret|key` and hand-check the hits, attachments and spreadsheets included.
6. Redact the copy (`[REDACTED]`) and commit. Re-scan until "0 flagged" and "0 could not be checked" (unscanned nested zips over 256 MiB are counted, `bug-audit-2026-11-08.md` choice 5).
7. Put any folder that must stay (for example a credentials folder) in the import's "Leave out" list, so it is never read (spec `2026-11-06-import-migration-design.md:131`). Then import.
8. Do the same for the 10 "possible secrets" wiki pages (`ai-pass/review.md`, `remaining-work.md` item 6).
- **Recommendation: adopt this procedure as written.**

**D3 / Guessed shortcut keys** (`lib/shortcuts.ts`; `OURS` marks Object-only keys, `:305-306`)

| Key | Action (id) | Evidence | Recommendation |
|---|---|---|---|
| Ctrl+Alt+J | Open AI chat (`openAiChat`) | `:577`, ours: the catalog gives "open" no key | keep |
| D / Shift+D / E | Whiteboard Pen / Highlighter / Eraser | `:444-446`, ours (P and M are taken) | keep |
| Ctrl+Enter, Ctrl+Shift+Enter (beside the catalog's Ctrl+Up/Down) | Expand or collapse the toggle | `:363-371` | keep both: Ctrl+Enter is shared with the to-do tick by design (`:528`) |
| Ctrl+P and Ctrl+K | Search this space | `:398`; Ctrl+K is taken in the capture phase, so the catalog's "Insert/format as link Ctrl+K" can't exist | keep (decided 2026-11-08); mark the link row "(not bound)" in catalog §2 |
| Ctrl+F | Find in page | `:400-401`, "our id and our string", now catalogued | keep |
| Ctrl+I on a type page | Opens the type's CSV import | `:561-562` | keep |
| Work page: `g` + n w p t o q h s y l e | Go to the Work views | `work/keys/workShortcuts.ts:22-32`; the views added since (Inbox, Captures, the `list-*` views, Tickets) have none (`work/views/registry.ts:149-152`, `work/views/groups.ts:15-24`) | keep; give **`g i` to Inbox** and **`g c` to Captures** (Drive row) |
| Unbound catalog keys: Ctrl+Shift+P, Ctrl+J, Ctrl+Shift+J, Ctrl+Shift+Down, Ctrl+Alt+Right, Ctrl+Shift+A, Ctrl+S, Ctrl+Shift+Y; the Table, Date picker (Ctrl+R), PDF viewer and Weblink groups | — | no entries in the registry; `properties/DatePicker.tsx` binds only Enter (`:274`); Object has no PDF or Weblink viewer (section 3, C6) | leave unbound; mark them "(not in Object)" in catalog §2 so the gap is stated |

**D4 / Other guessed values**

| Value | Where | Recommendation |
|---|---|---|
| Toolbar folds the layout picker into Customize below 480 px | `views/Toolbar.tsx:16` | keep |
| Peek size: up to 1240 × 850 px | `object/ObjectPeek.tsx:119` | keep (this is the "850" of the old 480/850 item) |
| Search highlight `#fef08a66` on `#713f12` | `theme/themes.css:58-59,245` | keep |
| Graph: "Hide heavily linked objects" above 20 links + backlinks; tag backlink edges dropped at 10 | `graph/filterGraph.ts:19,21` | keep |
| PDF block default height 600 px | `editor/media/MediaView.tsx:35` | keep |
| Work Today timeline 07:00-17:30 | `work/views/TodayView.tsx:16-17` (the spec's, `specs/2026-11-05-work-dashboard-design.md:132`) | keep (T1 may move it) |

**D5 / Leftovers from the sweep's "Open items"**
- The Settings footer's Diagnostics row: the catalog lists it, the app shows only version and Reload (`settings/SettingsModal.tsx:38`). **Recommendation: drop the Diagnostics row from catalog §1.**
- The edited line of a block is rewritten in the editor's standard form (`_b_` to `*b*`, `[X]` to `[x]`, setext to ATX; `bug-audit-2026-11-07.md`, "Still open"). It renders the same, and only the edited line changes. **Recommendation: keep; add one catalog line saying so.**

**D6 / Choices already built: ratify** (each took the safest reading)
- 2026-11-07 Fix status 1-10 (CR-only files read-only; raw blocks for what can't round-trip; agent secrets in the run's `mcp.json`; `CLAUDE_CONFIG_DIR` passed with its `CLAUDE.md`/rules excluded; the Agent Card refusals; the uncapped ledger (S9); delegated runs not charged back; reader limits; new strings; re-queue after a withdraw only). **Recommendation: keep all ten.**
- 2026-11-08 "Choices made in the fixes" 1-12 (key compat skips value maps; `~/.claude` read denies (S7); `CHAT_BUSY` (S8 extends it); the Work loop hears space writes; nested-zip scan one level deep; absolute paths only; merge drops collections it can't hold; v1 saved queries resolve ids; a missing option matches nothing (or everything when negated); the kanban refusal texts; Underline unbound and toggles on Ctrl+Up/Down; the new strings). **Recommendation: keep all twelve.**

## 3. Not yet catalogued: what the code does today

Written as catalog lines; approve them to paste into `docs/behavior-catalog.md` (§8 views, §10 calendar/export/blocks). Where the current catalog already says something else, the line is marked **(catalog differs)**.

**C1 / Filter editor** (`views/FilterEditor.tsx`, `views/filter.ts`)
- Popover body: rows that start "where", then the group operator (a menu "and | or" on the second row, plain text on the rest), Property, Operator, value editor and a `…` menu (Turn into group, Remove; Remove only, one level down).
- Buttons "+ Filter" and "+ Filter group"; a new group takes the opposite operator and two filters. A nested group is boxed and titled "Filter group", with `…` Ungroup and Remove and its own "+ Filter". Removing a group's last filter removes the group. Nesting goes two levels deep (`:135`).
- No filterable property: "No properties can be filtered here". A broken filter shows "Invalid — Will be ignored".
- Operators by kind (`filter.ts:52-170`):
  - Text, URL, email, phone, ID: is empty, is not empty, includes, does not include, is, is not, starts with, ends with.
  - Number: = ≠ ≥ > ≤ <.
  - Checkbox: is selected, is not selected.
  - Label, relation, tags: is empty, is not empty, includes, does not include.
  - Object type: is, is not. Collections and backlinks: includes.
  - Date: is empty, is not empty, is, is before, is after, is on or before, is on or after. A date with an end adds the "start …" and "end …" forms. The Task date adds is recurring, is not recurring, has reminder, has no reminder.
  - Files, steps, floor items, blocks: is empty, is not empty.
- Date values (`views/dates.ts:9-22`): overdue, today, yesterday, tomorrow, this week, this month, this year, one week ago, in one week, one month ago, in one month, Specific date. "This week" follows "Start of the week".

**C2 / Sort editor** (`views/SortEditor.tsx`, `views/sort.ts:13-27`)
- Rows of Property and Order, a "Move to top" arrow on every row but the first, and an × to remove. "Add sort" adds the next unused property; with no sorts it reads "No sort". **(catalog differs: "+ Sort")**
- Dates: Oldest first, Newest first, is empty first, is empty last. Everything else: ascending, descending. Object type, steps and floor items can't be sorted.

**C3 / Group editor** (`views/GroupEditor.tsx`, `views/group.ts:40-95`)
- "Group by": a property menu starting with "None", then "Group option" and "Sort groups by"; one level of grouping.
- Options: status label default | By category; long text By Text | By Linked Objects; number By Exact Value | By Range (Min, Max, Group every); date By Hour | By Day | By Week | By Month | By Year | Relative | Scheduled.
- Group order: label Order | Order inverse, others default; then ascending, descending, (relations: Created oldest first, Created newest first), smallest first, largest first, Manual.
- Long text with paragraphs, files, steps, text lists and floor items can't be grouped.

**C4 / Customize view and Card view** (`views/CustomizeMenu.tsx`, `views/cards/CardCustomize.tsx`, `views/DataView.tsx:615-640`)
- "Customize view" (a 16rem menu):
  - "Layout" (only when the toolbar is under 480 px).
  - The layout's own page: Table (one type only), Card view (Wall, Gallery, Gallery strip, Kanban), Calendar, Timeline, Chart.
  - "Sub-items and dependencies".
  - "Groups", "Calculations", and "Show details" / "Hide details".
- "Groups" (`:71-129`): "Visible groups" and "Hidden groups" with an eye per row; "Show all groups", "Hide all groups"; switches "Hide new groups" and "Hide empty groups". Ungrouped: "Group the view by a property first."
- "Calculations": one row per calculation ("<Property>: <kind>", ×), and an add row with Property and Calculation. Kinds (`views/calc.ts:58-80`): Count all, Count values, Count unique values, Count empty, Count not empty, Percent empty, Percent not empty, Checked, Unchecked, Percent checked, Percent unchecked, Earliest date, Latest date, Date range, Sum, Average, Median, Min, Max, Range.
- "Card view", per type: the type name with a gear (opens Object type settings) and a "Use default" switch. "Selected Properties" can be dragged to reorder and removed with ×; "Add Properties" lists the rest, or "All properties are already added". With "Use default" on, the list is read-only. **(catalog §8 differs: it lists only "Card view" and "Calculations")**
- Layout menu (`views/model.ts:14-25`): List, Wall, Kanban, Gallery, Table, Embed, Calendar, Timeline, Chart, Gallery strip. **(catalog §8 lists six)**

**C5 / Queries page and a query** (`queries/QueriesPage.tsx`, `QueryPage.tsx`, `QueryBuilder.tsx`, `runQuery.ts`)
- Sidebar "Queries" (`shell/Sidebar.tsx:286`) opens a list headed "Queries" with "New". Each row has Open, Pin to Sidebar, Delete. Empty: "No queries" / "Queries you save show up here."
- "New" creates a draft and opens it. A query page has an icon, an editable name (Enter commits, Escape reverts) and `…`: Pin to Sidebar, Pin to object type / Unpin, Pin to dashboard / Unpin, Delete. "Edit query" / "Close editor" toggles the builder. Results are a data view.
- A draft with no search term, tag or type: "Query isn’t ready" / "The draft is kept, but it lists nothing until it has a search term, a tag or an object type." No results: "No content found".
- Builder:
  - Types: All, or picked types (four shown), plus "Exclude object types". Excluding needs a search term or a tag first, and is ignored while particular types are picked.
  - Collection: All | In any collection | In no collection.
  - "Tags or backlinks": Any of | All of, plus "Leave out tags or backlinks".
  - Search: up to five terms of two or more characters; Enter adds a term, and a result needs to match one.
  - Mode: Auto, Exact, Semantic, Title. Limit: 1, 3, 5, 10, 25, 50, No limit.
- During a search, sorting and property filters are off: "Sorting and property filters are off during a search." (`runQuery.ts:8`).
- Today **Exact and Semantic match like Auto**: a case-folded substring in title, aliases, description or body. Only Title differs (`backend/objectapp/rows.py:239-244`). Their note says "Works like Auto until full-text search arrives." (`QueryBuilder.tsx:41`).
- A query's automatic title: "Tasks, Pages tagged work …", or "All notes" with no types (`queries/autoTitle.ts`).

**C6 / PDF, Weblink, image and file objects** (`backend/objectapp/typemodel.py:150-170,953-968`, `editor/media/MediaView.tsx:1-20`)
- There is no separate PDF or Weblink viewer: an object of a media type is a page whose body holds the media block.
- Media types (Weblink, File, Image, PDF, Audio, Video, Tweet) have fixed system fields:
  - Weblink: URL, domain, iframe URL, preview image. Tweet: URL, source.
  - File, PDF, Audio: MIME type, file size, source. Image and Video add width and height.
- Editable extras with built-in option sets:
  - PDF: Number of Pages, Table of Contents, Document type, Topic.
  - Image: Category, Colors. Weblink: Category, Topic.
  - Audio: Duration, Origin, Category.
- A Weblink's preview image is the card image when it is a space file (`views/cards/SmallCard.tsx:17-22`).
- Import makes File, PDF or Image objects when "Keep originals as File objects" is picked (`importers/writer.py:450-454`). Otherwise originals go to `Attachments/Originals/`.
- Media blocks:
  - Image: resizable, alignable, caption.
  - PDF: an iframe, 600 px tall by default, with a bottom drag handle.
  - Audio: controls and caption. Video: resizable, alignable, caption.
  - File: a card with icon, name, size, "Open … on system" and "Download …".
  - Missing file: "File not found." Every media block's `…` menu has "Remove Block".
- Web link block: a card with title, domain and URL that opens in the system browser. Nothing is fetched (`editor/nodes/bookmark.ts`).
- Resizing writes once, on release. Align left, center or right; "Add caption" / "Remove caption", placeholder "Caption..." (`editor/media/ResizableEmbed.tsx`).
- Files dropped or pasted into the editor upload to `Attachments/` (never overwriting, 100 MiB limit checked first) and insert a media block at the drop point (`editor/extensions/fileDrop.ts`, `editor/media/upload.ts`).

**C7 / Blocks**
- **Two Columns** (`editor/nodes/columns.ts`, `editor/layout/ColumnsView.tsx`, `editor/layout/Divider.tsx`):
  - Slash "Two Columns" inserts 2 even columns (`<!-- columns widths=… -->`).
  - Dividers drag in whole percent, each column at least 10, and write `widths` on release.
  - Hover shows "Column layout" (Columns | Grid: Grid wraps responsively, without dividers), "Add column" and "Remove column", for 1 to 6 columns. Widths are spread evenly again.
- **Code** (`editor/nodes/codeBlock.ts`, `editor/code/CodeBlockView.tsx`):
  - The bar shows on hover or focus: "Select language", "Wrap lines", "Lock editing" (text read-only until unlocked; moving or deleting the block still works), "Copy to clipboard", "Download as file".
  - Markdown and Mermaid blocks add Edit | Edit & Display | Display (default Display).
  - Highlighting is a decoration only; the bytes never change.
  - Slash "Mermaid Diagram" shows only while searching.
- **Math** (`editor/nodes/mathBlock.ts`, `editor/math/MathBlockView.tsx`): `$$…$$` rendered with KaTeX, one row per blank-line-separated part. A click opens the TeX source with a live preview and "Close". Enter inserts a paragraph (above at the very start, else below); Shift+Enter is a line break; Escape closes and selects the block.
- **Toggle** (`editor/nodes/toggle.ts`): `<!-- toggle open -->…<!-- /toggle -->`; the first child is the toggle's line. A caret rotates when open and dims with no children; an outliner line runs along the children unless "Hide outliner lines" is on. With Toggle style Bullet, the caret shows as a bullet until hovered. A click writes `open` to the file.
- **Group** (`editor/nodes/group.ts`, `editor/layout/GroupView.tsx`): `<!-- group color=… -->`; a rounded box, neutral fill by default, with `color` and `align`. Placeholder "Box heading..." on an empty first line. Hover shows "Ungroup". Ctrl+G groups or ungroups the selected blocks.
- **Horizontal line** (`editor/slash/slashItems.ts:151-157`): slash "Horizontal line" inserts it below the block (in place of an empty block); `---` at a block start does the same.

**C8 / Word and LaTeX export** (`object/ExportDialog.tsx:1-17`, `backend/objectapp/exportdoc.py`)
- Format tiles: PDF, Markdown, Microsoft Word, Latex. Markdown is selected on open.
- Word and Latex options: "Hide empty properties", "Show type labels" and the Properties list ("All properties" plus one per property). No Style or paper choice.
- Both come from one reading of the body (headings, paragraphs, lists and to-dos, quotes, code, math, tables, horizontal lines, images, object embeds; block annotations dropped).
- Word (`exportdoc.py:600-720`):
  - Paper is A4 with 2 cm margins; the title uses the Title style, the type the Subtitle style.
  - To-dos show as ☐/☑. Code and math are Consolas "Code" paragraphs (math as its TeX source).
  - Tables have a bold first row. Images keep only their alt text, in italics. Embeds show a bold blue title, then the embedded blocks.
  - Web and mail links become real hyperlinks; wikilinks are blue text.
- Latex (`exportdoc.py:803-870`):
  - An `article` with `amssymb`, `ulem` and `hyperref`; unnumbered headings (`\section*` …).
  - Lists map to `itemize` / `enumerate`; to-dos to `[$\square$]` / `[$\boxtimes$]`.
  - Code in `verbatim`, math in `\[ … \]`, tables in a ruled `tabular` with a bold first row. Images become a `% image: <src>` comment plus their alt text.
- PDF styles Essay and Academic are both available, not marked Experimental (`ExportDialog.tsx:4`). **(catalog §10 differs: "both Experimental")**

**C9 / Three days view** (`calendar/ThreeDaysView.tsx`, `calendar/dates.ts:155-164`, `calendar/useCalendar.ts:29-42`)
- Three equal columns: **the anchor day with the day before and after**. Each is the small day header over the daily-note slot, and nothing else (Tasks, Created and Backlinks are Day-view sections).
- The pill (Reviewed, "Open as Page", `…`) shows on an existing note. A missing note shows "+ Daily Note" (`calendar/DailyNoteSlot.tsx:15-17`).
- Previous and next move one day; Up and Down move one week.
- **(catalog wording differs: the switcher tooltip and shortcut say "Show three days from today", `calendar/CalendarChrome.tsx:16`; the range is yesterday-today-tomorrow when anchored on today.)** Recommendation: change the tooltip to "Show the day before and after", not the range.

**C10 / Drag and drop** (where it exists; tabs do not drag, `shell/TabStrip.tsx`)
- Editor: a block moves by its handle with its bytes intact (`editor/handles/dragMove.ts`). Columns dividers and media sizes drag and write on release. Files dropped in upload (C6).
- Sidebar: sections reorder by drag (`shell/SidebarSections.tsx:4`). Pinned and custom-section items reorder; an object pin dragged onto a whiteboard adds it there (`shell/PinnedSection.tsx:1-4`). Types drag in manual sort (`shell/Sidebar.tsx:171`).
- Side panel: an entry's title dragged onto the main view swaps them (`shell/SidePanelArea.tsx:8-9`). The divider drags between 10 % and 90 %; a double click resets it to 45 % (`nav/sidepanel.ts:14`).
- Search palette: a result row dragged onto a whiteboard adds that object; the palette closes as the drag starts (`palette/SearchView.tsx:25-26`).
- Views:
  - Kanban cards drag between columns and write the group value. A card that can't move gets "This card can't be moved here." and no drag starts (sweep choice 10).
  - Calendar-layout chips move by whole days and write one property; a range moves whole (`views/layouts/CalendarLayout.tsx:4,113`).
  - Timeline: the bar body moves both dates, an edge moves one, written on drop; "No date" tray items drag onto the axis (`views/layouts/TimelineLayout.tsx:3-5`).
  - Table columns resize, clamped live (`views/table/TableLayout.tsx:430`).
- Lists that reorder by drag: label options (on Task status, dragging to another section changes its category, `properties/LabelMenu.tsx:95-96`), text-list items, templates, Overview sections, card properties, automation actions (`automations/RuleEditor.tsx:3`) and Work steps (`work/StepList.tsx:2-3`).
- Cover image: "Drag to move the image" while repositioning (`object/CoverImage.tsx:9`).

**C11 / Markdown list shortcuts** (`editor/extensions/markdownShortcuts.ts:1-30`, `editor/document.ts:130-138`)
- At a block's start, typed marks followed by Space convert:
  - `|` quote, `>` toggle, `*` or `-` bullet, `1.` numbered, `a)` alphabetical, `i)` roman, `[]` to-do, `()` icon, `#`-`####` heading.
  - `---` makes a horizontal line.
- Marks combine, with Space only after the last (`>#` + Space = heading 1 in a toggle). They apply inside out: heading, icon, quote, list, toggle.
- Two marks of one kind (two lists, two headings) stay text.
- A single bullet, number or heading mark is StarterKit's own rule. `> ` makes a toggle, not a quote; `[] ` makes a to-do list like the menus.
- `()` always gives the same icon (Object keeps no last-used icon).
- "Turn off automatic numbered lists" removes `1.` as a mark, alone and combined (`markdownShortcuts.ts:56,69`; `editor/Editor.tsx:83-86`).

## 4. Calendar's Day view and the Tasks dashboard's Today

What each shows today:
- **Tasks › Today** (`work/views/TodayWithTasks.tsx`): the M23 day timeline (`TodayView`: 07:00-17:30, meetings, Morning brief, focus lines in gaps of 45 minutes or more, Wrap-up, the now-line, deadline countdowns amber under 21 days, `work/views/TodayView.tsx:1-20`) over "Today’s tasks", the `today` task section: open tasks whose `date` is today or earlier (`tasks/taskSections.ts:84-91`). Meetings are typed Meeting objects with a timed `date` (`backend/objectapp/workday.py:1-8`). Today only.
- **Calendar › Day** (`calendar/DayView.tsx`, `calendar/DaySections.tsx`): any day. It shows the header, quick-create chips and filter tabs (All, Daily note, Tasks, Dates, Created, Updated). Its sections are the Daily note (with Reviewed), Tasks, Objects with this date, Created and Updated, then Backlinks, Date references and Timeline under All. Its task list (`backend/objectapp/calendarquery.py:9-12`) holds tasks whose `date` covers the day, tasks whose **deadline** is the day, future occurrences of recurring tasks, and on today the open overdue ones under "Overdue (n)". **Done tasks stay** ("N open, M done"). Its `+` has "Create task" and "Move all open tasks to" Today / Tomorrow / a date.
- So the two lists differ on today: the Calendar also lists deadline-only and done tasks; Tasks › Today does not.

**Option A: the Calendar's Day view, on today, embeds the Work timeline.** `DayView` renders `TodayView` above its sections when `day === today` (and Tasks › Today stays as it is).
- Pros: one place answers "what's my day" with the daily note, focus lines and tasks together. The daily note holds the Focus section the timeline reads (`specs/2026-11-05-work-dashboard-design.md:161`). No data-model change.
- Cons: two task lists on one page if the Day view's Tasks section stays. It needs `useWorkData` outside the Work page, and the timeline only means something for today.

**Option B: one task list everywhere: Tasks › Today uses the Calendar's rule.** `TodayWithTasks` keeps the timeline but shows the Calendar Day view's Tasks section for today instead of `TaskSectionPanel sectionKey="today"`, and the Calendar Day header gets a "Tasks dashboard" link (Tasks › Today gets "Open in Calendar").
- Pros: the same tasks in both places (deadline-today tasks no longer disappear from Today; done ones show struck). Each page keeps its job: Calendar for any day plus notes, Tasks for driving today. Small change.
- Cons: still two pages to choose between for today. The `today` section key and its count badge (`work/views/registry.ts:88-95`) must follow the new rule or they disagree.

**Option C: keep them separate and align only the definitions.** Change `TASK_SECTIONS.today.match` to also take open tasks whose `deadline` is today, and leave both pages alone.
- Pros: the smallest change; no layout surgery.
- Cons: two different "today" views remain. Done tasks still only on the Calendar.

**Recommendation: B. Tasks › Today shows the Calendar's day task list for today, under the timeline, with "Open in Calendar" ↔ "Tasks dashboard" links between the two. One definition of today's tasks, and each page keeps one job.**

```
Tasks › Today                         Calendar › Day (today)
┌───────────────────────────────┐     ┌──────────────────────────────┐
│ 07:00 ─ meetings/focus ─ 17:30│     │ Header · chips · tabs        │
│ deadlines                     │     │ Daily note (Reviewed)        │
├───────────────────────────────┤     │ Tasks  ← same list ──────────┤
│ Today's tasks (Calendar rule) │◄───►│ Dates · Created · Updated    │
│ Open in Calendar →            │     │ ← Tasks dashboard            │
└───────────────────────────────┘     └──────────────────────────────┘
```
