# Object work dashboard: design

Date: 2026-11-05. Owner: Gene Hively. Status: **approved by Gene, 2026-11-05** (the whole document, our calls included). Plans: `docs/superpowers/plans/2026-11-05-m22-*.md` to `2026-11-05-m24-*.md`.

Builds on M1-M15 (types, properties, queries, daily notes, Tasks, calendar, automations, version history) and on the agents milestones M16-M21 (`specs/2026-11-05-agents-design.md`).

## Why

Gene runs his day from a dashboard he built (`C:\Git\ticket-dashboard`, a local web page over his wiki's ticket, task and project pages). It shows one thing to do now, the queues of what waits on him, the day's timeline, a production-floor checklist, wins, alerts, and a brain-dump box, and it lets him approve, answer and add notes without going back to a chat; an agent picks up his approvals and answers, does the work and writes back.

He wants that functionality **inside Object**, with **Object's own look** (adapting the dashboard's design language, not keeping its UI). Gene opted out of questions on 2026-11-05 ("you can see the functionality that exists"): this design takes the features from the existing dashboard (analysed read-only on 2026-11-05) and settles the model with the one point Gene decided:

> All tickets are tasks, but not all tasks are tickets; sometimes a project is a ticket, but not always. (Gene, 2026-11-05)

## Goals

1. **Tasks and Projects are the work; "ticket" is something a work item can have.** Any Task or Project can carry ticket fields (an id in a service desk or Jira, a link, the desk's status). A Tickets view lists every work item that has them.
2. **Every dashboard feature Gene uses today**, rebuilt on Object's objects: Now, Up next, Flow, Projects map, Today, On the floor, Your queues, Wins, Alerts, Everything; the item panel; brain dump; focus lines; focus sessions; energy and calm mode; the agent's queue.
3. **What the newer tracker lost, back**: the "agent acts on my approvals" switch, "not before" times on approvals, two-press Approve, the agent's queue and failed view, the Stuck view, copy buttons for the resolution note.
4. **No hand upkeep.** Today every agent session hand-maintains a `## Dashboard` Markdown block and a lint script checks it. In Object these are real properties and a structured step list, edited by the app and by agents through tools; the lint becomes validation at write time plus a "Needs attention" list.
5. **Agents do the follow-through**, through Object's agents (M17-M21): an approval, answer or request queues work for Gene's work agent, which runs it, writes the result back to the item and asks a question when it can't proceed.
6. **The calm, one-thing-at-a-time feel** of the dashboard, in Object's look.

## Non-goals

- Keeping the old UI, its code or its server. Object replaces it; nothing in the old repo changes.
- Direct ServiceNow or Jira API connectors built into Object. Syncing desk data is an agent's job, through MCP servers Gene adds (M19) on a schedule (M21).
- Writing to ServiceNow. Resolution notes are for copy and paste, as today.
- Moving Gene's existing wiki tickets into Object. That is the separate wiki-import project; this design states the mapping it needs (section 9).
- Teams posting, meeting recording capture, and the external monitoring scripts themselves (Object reads what they produce; section 6).

## Anti-goals

- **Two status systems fighting over one item.** The desk's status is a ticket field; Object's own Task/Project status is Gene's; neither overwrites the other.
- **A step offered before the current one**, or an item from an unrelated line of work shown under a focus line (both were real bugs).
- **Success pop-ups.** Problems get a toast; success just happens (the item vanishes from its list).
- **A lost brain dump.** A capture is saved before anything else happens, and never deleted by filing.
- **Breaking Object's ground rules**: never write on read, property edits change only their own lines, deletes to the Trash, atomic writes, CRLF/BOM kept, no real CPI data in the repo (fixtures are synthetic), everything unlocked.
- **An agent acting on a change without Gene's approval.** Only "read-only" steps run without approval, and only when Gene's switch allows it.

## The model

### 1. Work items and ticket fields

A **work item** is any object of a type that has the **work fields** (section 2). Object ships them on **Task** (the basic type) and **Project** (the template type); "Add work fields" on any type's settings adds them to another type (our call).

**Ticket fields** (a work item is a ticket when Ticket ID is set):

| Field | Kind | Notes |
|---|---|---|
| Ticket ID | text | e.g. `INC0012345`, `OPS-123` (synthetic examples) |
| System | label: ServiceNow, Jira | set from the id's shape when empty (`ABC-123` = Jira, else ServiceNow), editable |
| Ticket link | URL | the desk page; Jira falls back to its browse URL when empty |
| Desk status | label: Open, In progress, Active, Blocked, Waiting response, Resolved, Closed | the desk's status, never Object's Task status |
| Desk priority | label: Critical, High, Medium, Low | "Moderate" reads as Medium |
| Requester | text | |
| Group | text | the desk's assignment group |
| Location | text | |
| Opened / Desk updated / Resolved | date | the desk's dates |

**Tickets view**: a built-in saved view (query) "Tickets" over every type with work fields where Ticket ID is not empty, with list, board (by Desk status) and table layouts; it appears under the Work section (section 5). **Done is Object's status, not the desk's** (our call). A work item is **done** when its own status is Done (Task) or Completed (Project); otherwise it is **active**. Done items stay visible for 14 days (from the status change), then only in Everything. The Desk status never changes Object's status: a ticket the desk resolved while Object still has it open shows a "Desk says Resolved" mark and lands in the "close" turn.

**Stage** (Flow's columns and Everything's Stage column) follows Object's status: Task Not Started / Project Planned = **Not started**; Task Next Up = **Ready**; Task In Progress / Project In Progress = **Doing**; Task On Hold / Project On Hold = **Waiting / parked**; Done / Completed = **Done**. **On Hold is "parked"**: it takes the item out of Now and the queues (whose turn = parked).

### 2. Work fields

On every work item (ticket or not):

| Field | Kind | Replaces the old `## Dashboard` key |
|---|---|---|
| Rank | number (1 = most urgent) | Rank |
| Area | label (free options) | Group |
| Cause | label: Likely, Confirmed, Unknown, Not found, Need to ask | Cause (key \| label) |
| Priority note | text | Priority note |
| Blocked on | text | Blocked on |
| Findings | text block | Findings |
| Hypothesis | text block | Hypothesis |
| Confidence | label: High, Medium, Low, N/A | Confidence (level) |
| Confidence reason | text | Confidence (why) |
| Verified | list of text | Verified |
| Assumed | list of text | Assumed |
| To raise confidence | list of text | To raise confidence |
| Floor items | list of floor items (place, what, collected date, what was found) | Floor |
| Steps | step list (section 3) | Next |
| Project | relation to Project (Tasks only; Gene, 2026-11-05) | the task's `project:` front matter |

"List of text" and "Step list" and "Floor items" are new property kinds (section 3); the rest are existing kinds. **Activity** stays a body section (section 4).

### 3. Steps, the step list kind

Each work item has an ordered **step list**. A step has:

- **kind**: **Question** (Gene answers), **Do** (Gene does it), **Approve** (a change the agent will make once Gene approves), **Agent** (read-only work the agent can do without approval);
- **state**: Open, Approved (queued for the agent), Done, Declined;
- **text**, and optional **not before** (date-time, Approve steps), **answer** (Question steps), **result** (what the agent reported), **at** timestamps.

Rules (from today's dashboard, kept exactly):
- The **current step** is the first step that is neither Done nor Declined.
- **Whose turn** follows from it: Question/Do → **you**; Approve (Open) → **approve**; Approve (Approved) or Agent → **agent**; On Hold → **parked**; every step done while the item is active, or the desk says Resolved/Closed → **close**: the item offers **Close**, which sets Object's status to Done/Completed and, for a ticket, shows the resolution note with Copy buttons; no steps → **none**.
- Allowed moves: Question and Do: Open → Done. Approve: Open → Approved → Done (only the agent marks it done), Open or Approved → Declined; Approved can be withdrawn back to Open; a Done Approve step never reopens. Agent: Open → Approved (queued) → Done, or Open → Done.
- A step is never offered (in Now, queues or the panel's buttons) before the current one.

**Storage** (our call): the step list is a property stored in the object's front matter as a YAML list, one mapping per step, so a step edit changes only that property's lines (ground rule) and the Markdown body stays prose. The page shows it as an editor: drag to reorder, kind and state chips, the current step highlighted. Same for "list of text" and "Floor items" (YAML lists).

### 4. Activity and work notes

- Every change the dashboard or an agent makes to a work item's steps or fields appends one line to the item's **`## Activity`** body section: `- YYYY-MM-DD HH:MM <who> <what>` (who = Gene or the agent's name). Newest first in the UI; append-only on disk.
- An answer, note or step decision with text also appends to **`## Work notes`**: `- [YYYY-MM-DD] Gene: <verb> step n "<step>": <text>` (the form the desk's work notes are copied from).
- **Resolution note**: the item's `## Wrap-up` section (Result, Prevention, Follow-up) and any "Suggested work note" quote are shown in the panel as copy-ready blocks with **Copy** buttons (never raw JSON).

### 5. The Work section

A **Work** entry in the sidebar, below Agents (our call), opens the dashboard as a page with its own views. The top bar, the brain-dump bar and the focus rail stay on every view.

**Top bar**
- **Energy**: Low / Medium / High. Filters what Now and Up next offer.
- **Just one thing** (calm mode): hides every view but Now and dims the rest of the app's navigation.
- **Agent pill**: "Agent is carrying N · M alerts", opening the agent queue.
- Search within work items (`/`).

**Brain-dump bar** (every view): type and Enter. `B` focuses it. Section 7.

**Focus rail**: today's focus lines as chips (from the daily note, section 6); the current one highlighted, done ones struck through; clicking one filters Now to the work linked to that line only (no fallback to unrelated work).

**Views** (each with a count badge in the view switcher; `g` then a key, our keys from today's classic board):

| View | What it shows | Key |
|---|---|---|
| **Now** | One card: the best item for you right now (scoring below): chips (type, area, priority, ticket id), title, the current step as "First tiny step", Blocked on, Hypothesis with confidence, the step's action row, "Where you left off" (last Activity line), "Step n of N". Buttons: Start together (focus session), Make it smaller, Not now (back of the line for today), Details. Side: Up next (3 max, matched to energy, "+N more hidden on purpose"), Agent is carrying, focus widget (Edit), parked dumps that need you, next meeting, deadlines, alerts, wins. | g n |
| **Flow** | Board: lanes You / Agent / Others; columns Not started, Ready, Doing, Waiting/parked, Done (14 days). Doing for You has a limit of 3, flagged "Overloaded". Area filter. Stale items dimmed. | g w |
| **Projects map** | Each Project as a line of stations: its own steps, then its tasks (Tasks whose Project links to it), each task one station by its stage; Areas with work but no Project get a line of their own: done filled, doing glowing, waiting dashed, not started hollow; % done; "next for you". | g p |
| **Today** | 07:00-17:30 timeline: calendar meetings, the morning brief, focus lines placed in gaps of 45 minutes or more, wrap-up; a now-line; deadline countdowns. | g t |
| **On the floor** | Every active item's Floor items plus a general list, grouped by place; tick with an optional "what you found"; add an item (place, what, item); Print checklist. | g o |
| **Your queues** | Four columns: Answer (Question steps), Do, Approve, Agent running; inline answer box and buttons. | g q |
| **Agent queue** | What the agent is working on, queued, and failed (with the reason and Retry); the "Agent acts on my approvals" switch. | g h |
| **Stuck** | Blocked and untouched for 7+ days, waiting on a named person, or a failed agent run. | g s |
| **Wins** | Steps done, items closed in 14 days, a done-per-day chart, "What got done". "No streaks to break. This only grows." | g y |
| **Alerts** | Alerts by source, Critical/Warning/Info (section 6). | g l |
| **Everything** | Sortable table: Type, Ticket ID, Title, Area, Stage, Whose turn, Priority, Quiet days, Score. | g e |

**Now scoring** (kept from today): score = priority weight (Critical 100, High 60, Medium 30, Low 10; Desk priority for tickets, else the item's own priority) + `max(0, 25 - 2 × rank)` + 15 if touched in the last day − 25 if its stage is Not started; parked (On Hold) items and items whose turn isn't yours are never picked. Stale = untouched for more than 7 days. Energy per step kind: Question low/5 min, Approve low/2 min, Do high/30 min. (A task's old checklist lines become its Do steps.)

**Item panel** (Details, or a click anywhere): opens the work item's own Object page in the side panel with a **work header** on top: chips, Open ticket (link), the current step and its action row, Start together, Make it smaller, Waiting on, Findings, Hypothesis and confidence, the step list, Floor items, a note box with **Ask the agent**, the resolution note with Copy buttons, Activity. Below it, the page itself (body, other properties, backlinks).

**Step actions** (inline wherever a step shows):
- Question: answer box + **Send**.
- Do: **Done**.
- Approve: **Approve** (press twice: the first press turns it into "Press again to approve", our wording), optional **Not before** time, **Decline** with a reason; once approved, **Withdraw**.
- Agent: **Run now**, **Done**.
- Every action: the row vanishes at once; on failure it comes back with a toast; stale-step check: if the step changed since the page loaded, the action is refused with "This step changed. Look again." (HTTP 409).
- Undo toast (5 s) for Done, Decline and Approve (our call; Approve's undo withdraws it).

**Focus session** (Start together): a 25-minute timer overlay with the current step, a "Tell the agent what you see" box (each entry is a brain dump tied to the item), Step done, Pause, Too big (opens Make it smaller). **Keep on top**: a small always-on-top window with the focus line, the current step and a brain-dump box (pywebview's on-top window or the browser's picture-in-picture, builder's choice; skip quietly where neither works).

**Make it smaller**: Object drafts 2-4 smaller steps from the step's text locally; **Ask the agent to break it down** sends it to the agent, which replaces the step with real steps.

**Keyboard**: `/` search, `B` brain dump, `g` + key views, `j`/`k` move, Enter open, Space peek, `[`/`]` previous/next item, Esc closes, `?` the shortcut sheet; recorded in the behaviour catalog's shortcut list.

### 6. What the dashboard reads

- **Focus lines**: a **Focus** section in today's daily note (a bullet list, each line optionally linking work items with `[[...]]`); the focus widget's Edit writes that section only. An agent schedule (M21) can draft it each morning.
- **Meetings**: Object's calendar (Meeting objects and, when the later calendar-feed integration exists, its events).
- **Alerts**: **Alert** objects (a new type: Source, Severity Critical/Warning/Info, Message, Raised at, Cleared at, Link), written by agents or automations. A small built-in **folder watch** (our call) turns JSON files that Gene's existing monitoring scripts drop in a chosen folder into Alert objects (stale when older than twice its stated interval), so today's scripts keep working unchanged.
- **Wins**: Object's own record: steps done (Activity), items closed, objects changed per day (version history), not git commits.

### 7. Brain dump

- Enter saves a **Capture** object at once (a new type: Text, Captured at, From view, Linked item, Status New / Filed / Needs you, Filed to, Question). Saved before anything else; never deleted by filing.
- The work agent **files** each new capture: a Work notes line on an item, at most one new non-Approve step, a new Task, or a fact on a page; or it sets **Needs you** with a question, shown on Now as "Parked dumps need you".
- Prefixes kept from today: `Break down <item> step n: ...` (Make it smaller) and `Question about <item>: ...` (Ask the agent) route the capture to that item.
- A **Captures** view (list) under Work.

### 8. The agent loop

All agent work goes through Object's agents (M17-M21); there is no separate inbox process.

- **The work agent**: Work settings name which agent does the follow-through (default: a "Work" agent created on first use, **with the shell on** (Gene, 2026-11-05: approved changes need it; the shell warning applies to this agent, so "Exclude from AI" isn't guaranteed for it; read-only runs still get no shell), with instructions and a "work-follow-through" skill that carry today's rules: act on exactly one approved step, the change-review gate, one question at a time, 3-6 ordered steps).
- **A queue entry** is created when Gene approves an Approve step, answers a Question, declines or completes a step, sends a note or a request, files a capture, or when an Agent step becomes current and **Auto-run read-only steps** is on (once per step text). Queue entries live in the state dir per space (pending, running, done, failed, withdrawn; not before; claimed at, finished at, result), our call.
- **Running**: when **Agent acts on my approvals** is on, Object runs due entries one at a time per space as headless chats of the work agent (M20's runner), with the item and step in the prompt. The agent uses Object's tools to mark the step Done with a result, fix the remaining steps, append Activity, or, when it can't proceed, insert a Question step before the failed one (it becomes Gene's turn) and mark the entry failed with the reason. A run that doesn't finish in 30 minutes is failed and can be retried.
- **Change review gate**: for an Approve step the agent first writes a plan (targets, commands, backup, rollback, verification) into the step's result and checks it; any gap (including unstated timing for a restart of a production machine) makes it ask instead of act. This lives in the work agent's skill, so Gene can tune it.
- Re-deciding or reopening a step withdraws its pending entries.
- **Read-only is enforced by code** (our call): a run for an Agent step, an auto-run, a filing run or Desk sync gets the run's tool lists narrowed to Object's read tools, the step and Activity write tools, web fetch and Gene's MCP servers' tools marked read (his switches still apply); only a run for an **approved** Approve step gets the work agent's full tool set. Object checks the step's kind and state before starting the run, not the agent.
- **The work agent is a local Object agent** (our call): remote A2A agents can't be picked, since they can't use Object's tools to write results back.
- **Change review**: when Gene's own change-reviewer definition is installed for his Claude Code (a `change-reviewer` agent file), "Create the Work agent" offers to copy it into the Work agent's folder as one of its subagents, so the gate uses it; the copy is the agent's own from then on (agent runs never load Gene's user setup).
- **Desk sync**: an agent schedule (M21, our default 07:00 on weekdays, off until Gene turns it on) that uses Gene's MCP servers (M19) to read the desk and update ticket fields; it never writes to ServiceNow. **Jira first** (through an Atlassian MCP server); **ServiceNow later**, when a ServiceNow MCP server is available (our call: Gene's ServiceNow access today drives his signed-in browser, which agent runs can't use). Until then ServiceNow tickets get their fields from the agent's own work and Gene's edits.

### 9. For the wiki-import project (not built here)

The wiki-to-Object converter maps a wiki ticket/task/project page to a Task or Project: front matter `ticket_id`, `url`, `status`, `priority`, `source_person`, `sn_group`, `sn_location`, `created`, `updated`, `resolved` to the ticket fields; the `## Dashboard` keys to the work fields (table in section 2); `- [s] [kind] text` steps to the step list (`[ ]` Open, `[a]` Approved, `[x]` Done, `[-]` Declined; `gene` Question, `do` Do, `ap` Approve, `ro` Agent); `## Activity` and `## Work Notes` kept as body sections; `work/focus/<date>.md` focus blocks to the daily note's Focus section; `work/braindumps.md` entries to Captures.

## Design language

Object's look stays (its fonts, spacing, shadcn components, light/dark themes). From the dashboard we adopt:

- **Calm by default**: one thing at a time; at most 3 in Up next; things vanish when done; toasts only for problems; empty states that reassure ("Nothing is waiting on you", "Focus 2 cleared", "All quiet").
- **Whose-turn colours**, one meaning each, used for chips, lanes and the step highlight: you = Object's accent (indigo), agent = teal, others = grey; Approve = amber; Critical = red, High = amber (as text-and-dot chips, never big coloured badges); capture gets its own colour (pink) so the brain-dump bar is always findable.
- **Status icons**: empty circle open, half circle doing, check done, dashed circle parked, person = you, robot = agent, shield = approval.
- **Confidence** as a three-segment meter; Verified and Assumed as two columns.
- **Density**: list rows about 36 px; the Now card is the one large element on the page.
- Exact token values (the dashboard's dark palette for reference: background `#0e0f14`, accent `#7b8cff`, agent teal `#2cc7b0`, ok `#34c37a`, warn `#f5b041`, critical `#ef5a5f`, capture `#e0479e`) are mapped to Object's theme variables by the builder, so both themes work.

## Phases (milestones after M21; order is ours)

1. **M22: work model** — sections 1-4: work and ticket fields on Task and Project, the list, step list and floor item property kinds, Activity and Work notes, the Tickets view, the resolution note. Needs no agent.
2. **M23: the Work section** — sections 5-6 and the design language: every view, the panel's work header, step actions (with agent actions queued but not yet run), focus lines, focus session, keep on top, alerts (type and folder watch), wins.
3. **M24: brain dump and the agent loop** — sections 7-8: Captures, the work agent and its skill, the queue, runs, the change-review gate, the Agent queue and Stuck views' agent parts, Desk sync. Needs M17, M19, M20 and M21.

## Decided by Gene (2026-11-05)

- Rebuild the dashboard's functionality in Object, adapting its design language to Object's look, not keeping its UI.
- No more questions: take the features from the existing dashboard.
- Tasks and Projects are the work; "ticket" is a set of fields any of them can carry; a Tickets view lists them.
- The Work agent starts with the shell on (approved changes need it), so "Exclude from AI" isn't guaranteed for that one agent.
- Tasks get a Project relation to Project objects (new schema).

## Our calls (for Gene to check while reading)

- Work fields ship on Task and Project; "Add work fields" adds them to any other type.
- Steps, lists and floor items are front-matter properties (YAML lists) with their own editors, not Markdown in the body.
- Activity and Work notes stay body sections, appended.
- The Work entry sits below Agents in the sidebar; the views and keys above.
- Two-press Approve wording, Undo toasts, the 30-minute run limit, the state-dir queue.
- Alerts as objects, plus a folder watch for today's monitoring JSON files.
- Wins from Object's own history, not git.
- Done = Object's own status; the desk status never changes it; On Hold is "parked" (no separate Parked field); Flow's stages follow Object's status.
- Read-only runs (Agent steps, auto-runs, filing, Desk sync) get narrowed tool lists enforced by code; only approved Approve steps get the full set.
- The work agent must be a local agent; Gene's change-reviewer is offered for copying into its folder.
- Desk sync as an agent schedule, off until turned on; Jira first, ServiceNow when an MCP server exists.
- The phase order.

## Left to the builder

The editors' exact look, how the Now card and Flow board are laid out within Object's components, the keep-on-top mechanism, the mapping of the dashboard's colours onto Object's theme variables, the Make it smaller local splitter, the folder-watch file format details (from the existing scripts' JSON), and synthetic fixtures (never real tickets).
