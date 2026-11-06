# Milestone 24: brain dump and the agent loop

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

Written 2026-11-05 against `master` at `28c760f`, to be built after M22 (`2026-11-05-m22-work-model.md`) and after M23 (`2026-11-05-m23-work-section.md`, the Work section). M23's plan appeared while this one was being written; this plan **fills M23's seams as M23 defines them** (`workseams.py`'s `AgentProvider`, `CaptureSink` and `SeamRefused`, the `/api/work/agent*` and `/api/work/captures` routes, `AgentStatus`, `AgentQueueRow`, `CaptureSummary`, the `workQueue` event kind, `registerWorkView` and the `registerView.ts` glob) and edits no M23 file but `build_seams`' body (plus M23's `test_seams_until_m24`, which pinned the default seams); see "Filling M23's seams". Every label and default not quoted from the spec is "our string" / "our choice".

**Goal.** Enter in the brain-dump bar saves a **Capture** object at once; the work agent files it (a Work notes line, at most one new non-Approve step, a new Task, a fact on a page, or **Needs you** with a question). Gene's approvals, answers, decisions, notes and requests, and Agent steps that become current, queue work for his **work agent** (a local Object agent with the shell on and a `work-follow-through` skill). When **Agent acts on my approvals** is on, Object runs due queue entries one at a time per space as headless chats of that agent, writes the outcome back to the queue, and fails an entry with a question when the agent can't proceed. Read-only runs get narrowed tool lists **enforced in code**; only a run for an approved Approve step gets the agent's full set. **Desk sync** is an M21 schedule (off by default, 07:00 on weekdays) that reads Jira through an Atlassian MCP server and updates ticket fields, never writing to ServiceNow. M23's brain-dump bar, agent pill, Agent queue view, Stuck view's failed runs, Now's "Agent is carrying" and "Parked dumps need you", **Ask the agent** and **Ask the agent to break it down** get live data through M23's seams; M24 adds the Captures view (its own `registerView.ts`, which M23's `WorkPage.tsx` loads) and the work agent's settings.

**Architecture.** Back end, new modules:

- `workagentmodel.py`: the pydantic shapes, constants and strings of this Contract.
- `workqueue.py`: the per-space queue file in the state dir, its states and the pure rule that turns a `WorkNotice` (M22) into queue entries and withdrawals.
- `captures.py`: the Capture type, the save, the two prefixes, and the filing outcomes.
- `worktools.py`: the purposes, the two run contributors (`work-guidance` 57, `work-tools` 66), the read-only tool lists, the v1 write guard and the step guard.
- `workagent.py` and `workprompts.py`: the work agent setting, "Create the Work agent", the soul, the skill, the change-reviewer copy, the run prompts.
- `workloop.py`: the listener (`add_work_listener`), auto-run, the runner thread (M20's `headless.run_chat`), the pre-run check, outcomes, the 30-minute limit, Retry and stop; `AgentSeam`, M23's `AgentProvider`.
- `captures.py`: also `CaptureSeam`, M23's `CaptureSink`.
- `desksync.py`: setting up the Desk sync schedule, M21's purpose hook, and applying ticket fields.
- Routers `api_work_agent.py`, `api_captures.py`, `api_desksync.py` (app, `/api`, only routes M23 doesn't have), `api_v1_captures.py`, `api_v1_desksync.py` (agent, `/api/v1/agent/work`), and agent tool modules `agent_tools_captures.py`, `agent_tools_desksync.py` in M17's `object-agent` server. M23's `workseams.build_seams` body is replaced to return M24's two seams; nothing else of M23's changes.

Front end: `frontend/src/work/agent/` (the work agent's settings in Settings > Work) and `frontend/src/work/captures/` (the Captures view; its `registerView.ts` calls M23's `registerWorkView` and is loaded by M23's `import.meta.glob('../*/registerView.ts', { eager: true })`).

No separate inbox process: every run is an M17 agent run built by `agentrun.build_run` and run by M20's `headless.run_chat`.

**Tech Stack.** Python 3 (FastAPI, pydantic), `uv`; React, TypeScript, zustand, shadcn/ui, Tailwind, vitest. No new dependencies. Claude Code CLI **2.1.317** (checked with `claude --version`); this milestone names **no new CLI flag**: every run's arguments come from M17's `build_run` (`CLI_FLAGS`, `--allowedTools`, `--disallowedTools`, `--mcp-config`, `--settings`, `--append-system-prompt-file`, `--model`), all already checked by M17.

**Spec.** `docs/superpowers/specs/2026-11-05-work-dashboard-design.md`, sections **7** (brain dump) and **8** (the agent loop), plus the agent parts of section **5** that M23's views show: the Agent queue view (queued, running, failed with reason and Retry, the "Agent acts on my approvals" switch), the Stuck view's "a failed agent run", the top bar's agent pill ("Agent is carrying N · M alerts"), Now's "Parked dumps need you" and "Agent is carrying", the item panel's **Ask the agent**, Make it smaller's **Ask the agent to break it down**, and Agent steps' **Run now**. The protocol being ported was read (read-only) from `C:\Git\ticket-dashboard` (`inbox.py`, `actions.py`, `braindump.py`, `integrations/dashboard-inbox-job.md`, `docs/INBOX-AND-APPROVALS.md`); the wiki was not read.

**Consumed exactly, not redefined:** M22's `WorkService`, `add_work_listener`, `WorkNotice`, `Actor`, `workrules.apply_action` / `allowed_actions` / `current_index` / `IllegalMove`, `StepChanged`, the MCP work tools and `toolcatalog.WORK_STEP_TOOLS`, `workfields.TICKET_KEYS` / `is_work_type`, `workbody.one_line`; M17's `AgentRegistry`, `AgentInput`, `agentrun.add_contributor` / `RunScope` / `RunParts` / `rule_path`, `toolcatalog` (`OBJECT_READ`, `OBJECT_WRITE`, `AGENT_TOOLS`, `BUILTINS`, `ALWAYS_ALLOWED`), `tokens`, `v1guard.agent_auth` / `WRITE_GUARDS`, `ai.Turn.timeout` and the registry of contributor orders (57 `work-guidance` and 66 `work-tools` are listed there for M24); M18's `agentskills.user_create` and `reviews.REVIEW_PURPOSES`; M19's `TOOL_CACHE`, `ProbeResult` (with its `read_only` hints), `GATEWAY_PURPOSES`, `mcpstore.McpStore`; M20's `headless.run_chat` (its `timeout` reaches `ai.Turn`) / `HeadlessResult`; M21's `automations_model.RunAgentAction`, `agentschedules.rule_payload` / `default_start`, `schedulerun.run_schedule` / `PURPOSE_FOR`, `AutomationEngine.create/save`; M22's `api_v1_work.STEP_GUARD`; M23's `workseams` (`AgentProvider`, `CaptureSink`, `WorkSeams`, `SeamUnavailable`, `SeamRefused`, `build_seams`), `worksection_model.CaptureRequestModel`, its routes `GET /work/agent`, `PUT /work/agent/acts`, `POST /work/agent/retry`, `POST`/`GET /work/captures`, its types `AgentStatus`, `AgentQueueRow`, `CaptureSummary`, `CaptureRequest`, its client calls, `useWorkEvents` (which reloads `agent` on `workQueue` and `needsYou` with the board) and `registerWorkView` / `WorkViewDef`. The few edits this milestone makes to those files are listed in "Changes to earlier milestones' files".

## Global Constraints

- A capture is **saved before anything else** happens (one create write of the Capture object with Status New), and **never deleted by filing**: filing only sets Status, Filed to and Question. No route or tool of this milestone deletes or trashes a capture.
- Filing does exactly one of: a Work notes line on an item, **at most one** new step that isn't Approve, a new Task, a fact on a page, or Status **Needs you** with a question.
- Prefixes: `Break down <item> step n: ...` (Make it smaller) and `Question about <item>: ...` (Ask the agent) route the capture to that item.
- Queue entry states: `pending`, `running`, `done`, `failed`, `withdrawn`; fields include not before, claimed at, finished at and result. The queue lives in the state dir per space.
- A queue entry is created when Gene approves an Approve step, answers a Question, declines or completes a step, sends a note or a request, files a capture, or when an Agent step becomes current and **Auto-run read-only steps** is on (**once per step text**).
- Re-deciding or reopening a step **withdraws** its pending entries.
- Running needs **Agent acts on my approvals** on. Due entries run **one at a time per space** as headless chats of the work agent (M20's `headless.run_chat`), with the item and step in the prompt.
- A run that doesn't finish in **30 minutes** (`WORK_RUN_TIMEOUT = 1800` seconds) is failed and can be retried.
- When the agent can't proceed it inserts a Question step before the failed one (M22's `fail` with `ask`) and the entry is failed with the reason.
- **Read-only is enforced by code**: a run for an Agent step, an auto-run, a filing run or Desk sync (and every other run that isn't an approved Approve step) gets Object's read tools, the step and Activity write tools (`WORK_STEP_TOOLS`), web fetch, and the MCP tools marked read; the agent's switches still apply; no shell. Only a run for an **approved** Approve step gets the work agent's full tool set. Object checks the step's kind and state before starting the run.
- The work agent is a **local** Object agent; remote (A2A) agents can't be picked.
- "Create the Work agent" makes an agent named "Work" **with the shell on**, instructions and the `work-follow-through` skill; when Gene's `change-reviewer` agent file is installed for his Claude Code it offers to copy it into the agent's folder (the copy is the agent's own from then on; runs never load Gene's user setup).
- The change-review gate lives in the skill: for an Approve step the agent writes a plan (targets, commands, backup, rollback, verification) and checks it; any gap, including unstated timing for a restart of a production machine, makes it ask instead of act.
- Desk sync: an M21 agent schedule, **07:00 on weekdays**, **off** until Gene turns it on; Jira first through an Atlassian MCP server; ServiceNow later; it **never writes to ServiceNow** (only tools marked read are allowed, plus Object's ticket-field write).
- Never write on read: listing the queue, the captures, the agent status, the read-tools list or the Desk sync status writes no file (`.md`, type, state file, agent folder). Opening a space writes nothing.
- Every `.md` write is atomic and version-checked through `Space` (CRLF and BOM kept); every state-dir write is atomic (`textfile.atomic_write` via `jsonstore.dump_json`).
- Agents run only through the `claude` CLI under Gene's own login. Object never reads `~/.claude/.credentials.json` or any Claude token and never calls Anthropic's API. The only file read under `~/.claude` is a `change-reviewer` agent file, read only when Gene opens "Create the Work agent" or confirms the copy.
- The server binds `127.0.0.1` only.
- Fixtures are synthetic (`INC0012345`, `OPS-123`, "Printer jams on line 3", `PRN-TEST-01`). Tests set `OBJECT_STATE_DIR` to a temp folder, use a temp `home` for the change-reviewer lookup, and never touch `~/.claude` or the real state dir.
- Everything is unlocked: no badge, upsell or limit beyond the caps named here.
- Never name the original notes app or the open-source agent whose patterns the agents design adopts, in code, strings, fixtures, prompts or docs. Prompts ported from the old dashboard are rewritten with "the work agent" / the agent's name.
- No success pop-ups: problems get a toast; success just happens.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

The five failure modes the spec implies that no task's ordinary tests would catch, most likely first. Each has its test in the owning task.

1. **A read-only run reaches a write.** The work agent has the shell on and Gene may add allow rules to its `.claude/settings.local.json`; M19's `gateway-tools` contributor allows whole servers (`mcp__<name>`); Task subagents inherit tools; a server whose tools weren't listed since start brings unknown tools; the run's token is read-write (M20's `run_chat`), so an Object write route could be called through `curl` in an allowed tool or by a misbehaving server; an agent in an answer run marks an approved Approve step `complete`. Tests: `backend/tests/test_m24_tools.py::test_read_only_runs_get_no_write_tool` (parametrised over `work-read`, `work-file`, `work-sync`; agent with Bash on, an allow rule `Bash(*)` in its `settings.local.json`, a gateway server with two cached tools of which one is marked read, a folder server never listed), `::test_v1_guard_refuses_writes_from_read_only_tokens`, `::test_step_guard_refuses_approve_complete_outside_its_run` (T4).
2. **An Approve step runs with the full set without a valid approval at the moment of starting.** Between queueing and claiming, the step is withdrawn, declined, reordered so it isn't current, has a not-before in the future, or a second approve entry exists after withdraw-and-approve; an Agent step or a Question is queued as `approve`; auto-run picks an Approve step. Test: `backend/tests/test_m24_loop.py::test_full_tools_only_for_a_current_approved_approve_step` (T6).
3. **A brain dump is lost.** The queue write fails after the save; the filing run errors or times out; the agent calls `file_capture` twice or with `needsYou` and no question; a prefix names an unknown item; the space has no Capture type yet; the text has CRLF, `---`, `[[links]]` or 4,000+ characters; a capture is filed to an excluded page. Test: `backend/tests/test_m24_captures.py::test_capture_saved_first_and_never_deleted` (T3) and `test_m24_loop.py::test_failed_filing_keeps_the_capture_new` (T6).
4. **The queue misbehaves across time.** Two due entries in one space run at once; a `running` entry left by a crash is reread on open (no write on read), then shown as failed and retryable; stopping the space kills the run; a withdraw during a run kills it; a run past 30 minutes is cut by M10's 300-second `TURN_TIMEOUT` instead (the default deadline of `ai.run_turn`, unless `run_chat`'s `timeout` reaches M17's `Turn.timeout`) or not cut at all; auto-run fires twice for the same step text (after a fail, after a restart). Tests: `test_m24_loop.py::test_one_run_at_a_time_and_restart_safety`, `::test_run_limit_is_thirty_minutes_not_turn_timeout`, `::test_withdraw_during_a_run_stops_it` (T6); `test_m24_queue.py::test_auto_run_once_per_step_text` (T2).
5. **Feedback loops.** The agent's own step and Activity writes (`by.role == "agent"`) queue more work; Desk sync's ticket-field writes queue work; Object's own auto-run `run` (role `app`) is queued twice (once as auto-run, once as a `run` notice); the agent's `fail` with `ask` makes a Question current and the Agent step after it is auto-run again on the next answer with unchanged text. Test: `backend/tests/test_m24_queue.py::test_agent_and_app_writes_never_queue_work` (T2).

## Contract (T1)

### Storage

| What | Where | Written by |
|---|---|---|
| Work queue (one per space) | `<state>/work-queue-<appstate.space_key(root)>.json` (schema below), `dump_json`, atomic, a module lock per file | `workqueue.QueueStore` |
| Work settings (machine) | device settings (`settings.py`): `workAgentId` (`null` or an M17 `AGENT_ID`), `workAgentActs` (`false`), `workAutoRun` (`true`), `workReadTools` (`[]`, at most 500 tool ids `mcp__<server>__<tool>`) | `PUT /api/work/agent-settings` through `settings.patch` |
| Captures | Capture objects (`.md`) in the Capture type's folder `Captures/` | `captures.save` (create), `captures.apply_outcome` / `set_status` (property lines only) |
| Capture type | `.object/types/<id>.json`, made by the first capture (`captures.ensure_capture_type`, as `aichat.ensure_chat_type`) | `captures` |
| The work agent | an M17 agent folder (`<state>/agents/Work/` by default), plus `.claude/skills/work-follow-through/SKILL.md` (M18 `user_create`, `created_by: user`) and, when Gene says so, `.claude/agents/change-reviewer.md` | `workagent.create_work_agent` |
| Run chats | the work agent's `.object-agent/sessions/<chatId>.jsonl` (M17 format, written by `headless.run_chat`); the entry keeps `chatId` | M20 |
| Desk sync | an M21 agent schedule `.object/automations/<ruleId>.json`; its id in `.object/space.json` key `deskSyncRuleId` (internal, not a `PATCH_KEYS` key) | `desksync.setup` |

Nothing is written by a read. The queue file is created by its first entry, the Capture type by the first capture, the agent folder by "Create the Work agent" (or by first use, below). A `running` entry whose `runner` isn't this process's `RUNNER_ID` (left by a crash) is **served** as `failed` with `CRASHED` and saved that way only by the next queue write, so opening a space writes nothing.

### Queue file (`workqueue.py`; pydantic `WorkQueueEntry` in `workagentmodel.py`)

```jsonc
{ "v": 1,
  "entries": [
    { "id": "01JC…",                 // ULID
      "kind": "approve",             // EntryKind (table below)
      "state": "pending",            // pending | running | done | failed | withdrawn
      "path": "Tasks/Printer jams on line 3.md", "objectId": "…", "title": "Printer jams on line 3",
      "stepId": "r8k1pd", "stepN": 2, "stepKind": "approve", "stepText": "Restart the print spooler on PRN-TEST-01",
      "text": null,                  // Gene's words (answer, decline reason, note, request, capture text)
      "capturePath": null,           // capture / breakDown / question
      "notBefore": null,             // ISO UTC (approve only)
      "auto": false,                 // true: queued by Auto-run read-only steps
      "by": "Gene",
      "createdAt": "…", "claimedAt": null, "finishedAt": null,
      "result": null,                // done: what the agent reported (one_line, 500)
      "reason": null,                // failed / withdrawn: why (one_line, 500)
      "chatId": null, "agentId": null, "purpose": null, "runner": null,
      "attempt": 1, "retryOf": null }
  ],
  "autoRuns": ["<auto_run_key>"]     // steps already auto-run, newest last
}
```

```python
class QueueStore:
    def __init__(self, space_root: Path, state: Path | None = None) -> None
    def entries(self) -> list[dict[str, Any]]                 # served form (due, retryable, CRASHED applied); never writes
    def get(self, entry_id: str) -> dict[str, Any]            # KeyError
    def apply(self, plan: QueuePlan, *, now: datetime) -> tuple[list[dict], dict | None]   # (withdrawn, created); one write
    def add(self, fields: dict[str, Any], *, now: datetime) -> dict[str, Any]
    def update(self, entry_id: str, **fields: Any) -> dict[str, Any]
    def claim_next(self, now: datetime, runner: str) -> dict[str, Any] | None   # first due entry -> running (one write)
    def has_auto_run(self, key: str) -> bool
    def record_auto_run(self, key: str) -> None
    def problem(self) -> str | None
```

- Every `pending`, `running` and `failed` entry is kept; `done` and `withdrawn` keep the newest `KEEP_FINISHED = 500` (our cap); `autoRuns` keeps the newest `KEEP_AUTO_RUNS = 2000`.
- An unreadable file is copied aside as `work-queue-<key>.unreadable-<stamp>.json` before the next write (as `agents.json`), and served as an empty queue with `problem` "The work queue file can't be read." (our string).
- **Due**: `state == "pending"` and (`notBefore` is null or `<=` now). Order: `createdAt`, then `id`.
- **Retryable**: `state == "failed"` and no later entry has `retryOf == id`.

**Entry kinds** (spec section 8's list; ported from the old dashboard's item types):

| Kind | Created by | Needs a step | Purpose of its run |
|---|---|---|---|
| `approve` | Gene approved an Approve step (`approve` notice) | yes | `work` (the full set) when the pre-run check passes |
| `run` | Run now on an Agent step (`run` by the user), or Auto-run (`run` by `app`, `auto: true`) | yes | `work-read` |
| `answer` | Gene answered a Question | yes | `work-read` |
| `done` | Gene completed a Do or Agent step (`done` by the user) | yes | `work-read` |
| `decline` | Gene declined an Approve step | yes | `work-read` |
| `note` / `request` | Gene sent a note or a request (M22's `note` / `request` notice) | no | `work-read` |
| `capture` | a capture saved with route `file` | no | `work-file` |
| `breakDown` | a capture with route `breakDown` (Ask the agent to break it down) | yes | `work-read` |
| `question` | a capture with route `question` (Ask the agent) | no | `work-read` |

### From a work notice to the queue (`workqueue.plan_for_notice`, pure)

```python
@dataclass(frozen=True)
class QueuePlan:
    path: str
    withdraw_step: str | None          # pending entries of this step id are withdrawn (WITHDRAWN_REDECIDED)
    withdraw_item: bool                # every pending entry of the item is withdrawn
    stop_running: bool                 # a running entry of that step (or item) is stopped and ends withdrawn
    create: dict[str, Any] | None      # the new entry's fields (kind, step fields, text, notBefore, auto, by)
def plan_for_notice(notice: WorkNotice) -> QueuePlan | None     # None: nothing to do
def auto_run_key(path: str, step_id: str, text: str) -> str     # sha256(f"{path}|{step_id}|{text}").hexdigest()[:20]
```

| Notice (`event`, `by.role`) | Withdraws pending entries of | Stops a running one | Creates |
|---|---|---|---|
| `approve` (user) | that step | no | `approve` (`notBefore` = `notice.not_before`) |
| `answer` (user) | that step | no | `answer` (`text`) |
| `done` (user) | that step | no | `done` (`text` when given) |
| `decline` (user) | that step | yes | `decline` (`text` = the reason) |
| `run` (user) | that step | no | `run` |
| `run` (app) | that step | no | `run`, `auto: true`, `by` "Object" |
| `reopen` (user) | that step | yes | nothing (spec: withdraw on reopen) |
| `edit`, `remove` (user) | that step | yes | nothing (our call: an edited or removed step was decided again) |
| `note`, `request` (user) | nothing | no | `note` / `request` (`text`) |
| `close` (user) | every step of the item | yes | nothing |
| every notice by `agent`; `complete`, `fail`, `log`, `fields`, `floor`, `add`, `move` by anyone | nothing | no | nothing |

After the plan, `WorkLoop` runs the **auto-run check** for every notice, whoever made it (below). No agent write ever creates an entry (Review Focus 5).

### Purposes and tools (`worktools.py`)

```python
WORK = "work"; WORK_READ = "work-read"; WORK_FILE = "work-file"; WORK_SYNC = "work-sync"
WORK_PURPOSES = frozenset({WORK, WORK_READ, WORK_FILE, WORK_SYNC})
READ_ONLY_PURPOSES = frozenset({WORK_READ, WORK_FILE, WORK_SYNC})
EXTRA_AGENT_TOOLS = {WORK_READ: (), WORK_FILE: ("file_capture",), WORK_SYNC: ("sync_ticket_fields",)}
STEP_WRITE_ROUTES = ("/api/v1/work/step", "/api/v1/work/steps", "/api/v1/work/activity", "/api/v1/work/note")
READ_ONLY_WRITE_ROUTES = {WORK_READ: STEP_WRITE_ROUTES,
                          WORK_FILE: STEP_WRITE_ROUTES + ("/api/v1/agent/work/file-capture",),
                          WORK_SYNC: STEP_WRITE_ROUTES + ("/api/v1/agent/work/ticket-fields",)}

def read_run_tools(purpose: str, tools_off: Iterable[str], marked: Iterable[str],
                   servers: Mapping[str, dict[str, Any]],
                   listed: Callable[[str], tuple[str, ...] | None]) -> tuple[list[str], list[str], list[str]]
    # (allowed, disallowed, dropped server names). `servers` = parts.mcp_servers; `listed(name)` = that server's tool names
    # from M19's TOOL_CACHE (its gateway or folder key), None when it hasn't been listed since Object started.
    # allowed    = "mcp__object__<t>" for t in OBJECT_READ + WORK_STEP_TOOLS (each unless switched off)
    #            + "WebFetch" (unless off) + ALWAYS_ALLOWED ("Skill")
    #            + "mcp__object-agent__<t>" for t in EXTRA_AGENT_TOOLS[purpose] (unless off)
    #            + each marked id "mcp__<srv>__<tool>" whose server is in `servers`, is listed, has that tool, and isn't off
    # disallowed = every BUILTINS cli name except "WebFetch" (Bash, PowerShell, Read, Write, Edit, MultiEdit, Glob, Grep,
    #              WebSearch, Task, Agent, NotebookEdit, TodoWrite) + "mcp__object__<t>" for every OBJECT_WRITE tool not in
    #              WORK_STEP_TOOLS + "mcp__object-agent__<t>" for every AGENT_TOOLS name not allowed
    #              + every listed but unmarked "mcp__<srv>__<tool>" of a kept server
    # dropped    = every server but "object"/"object-agent" that isn't listed or has no allowed tool
def work_guidance_contributor(scope: RunScope, parts: RunParts) -> None     # order 57 "work-guidance"
    # scope.purpose in WORK_PURPOSES: parts.append_prompt += [WORK_GUIDANCE] (+ [DESK_SYNC_GUIDANCE] for work-sync)
def work_tools_contributor(scope: RunScope, parts: RunParts) -> None        # order 66 "work-tools"
    # READ_ONLY_PURPOSES only: parts.allowed / parts.disallowed := read_run_tools(...); dropped servers are removed from
    # parts.mcp_servers with a note "Left out <name> in a read-only run: list its tools on the Work agent's Tools tab and
    # mark the read ones in Settings > Work." (our string). Purpose "work" is left exactly as M17/M19/M20 built it.
def read_only_write_guard(record: TokenRecord, request: Request) -> str | None
    # a v1guard.WRITE_GUARDS entry: a write by a token whose purpose is in READ_ONLY_PURPOSES to a path not in
    # READ_ONLY_WRITE_ROUTES[purpose] -> "This run is read-only." (403)
def step_guard(record: TokenRecord, path: str, step_id: str, action: str) -> str | None
    # api_v1_work.STEP_GUARD: `complete` / `fail` of an Approve step -> 403 "Only the run for this approved step can report it."
    # for a READ_ONLY_PURPOSES token, and for a "work" token unless loop.running_for_chat(record.chat) is that (path, step).
    # Tokens of other purposes (Gene's own chats with any agent) keep M22's rules.
def install(loop: "WorkLoop", service: WorkService) -> None   # idempotent: both contributors and both guards
```

`work-tools` at 66 runs after M17's `tools` (60), M19's `gateway-tools` (62) and M20's `delegation` (64), so nothing re-adds a tool after it; M18's `review-tools` (68) does nothing for work purposes; M17's `fence` (70) still adds every path deny rule. A disallowed name beats an allow rule in the agent folder's own settings, which is why the narrowed lists also **disallow** the shell and file tools rather than only leaving them out.

### Prompts and guidance (`workprompts.py`, our texts; tests assert the quoted sentences)

- `WORK_GUIDANCE`: "This run was started by Object (its work queue or a Desk sync schedule). No one is watching it live. Do the one entry below with Object's tools, write the outcome on the item (the step's result, Activity, Work notes), and keep your reply to at most three lines. If you can't proceed, don't guess: fail the step with one question for {user} (step_action with action \"fail\" and ask), or, for a brain dump, set it to Needs you with file_capture." (`{user}` = the `activityName` setting.)
- `DESK_SYNC_GUIDANCE`: "This is Desk sync. Read the desk with the MCP tools you have and change only ticket fields, with sync_ticket_fields. Never change anything in ServiceNow or Jira."
- `ENTRY_PROMPT_FIRST = "Work queue entry {id}: {kind}."`, the first line of every entry prompt (the fake keys on it).
- `entry_prompt(entry: dict, item: dict | None, capture: dict | None, *, user: str, step_rev: str | None) -> str`: the first line; `Ref: path=<path> step=<stepId or -> rev=<rev or -> capture=<capturePath or ->`; the item (title, ticket id, whose turn, "Step n of N", the step's kind and text, its not-before time); Gene's text quoted; then the kind's rule, ported from the old dashboard's type rules:

| Kind | Sentence the prompt contains |
|---|---|
| `approve` | "{user} approved exactly this one step. Follow the change-review gate in your work-follow-through skill before you change anything; then do this step and nothing more, and report it with step_action \"complete\" (the plan and the evidence in the result), or fail it with one question." |
| `run` | "Do this Agent step read-only, record what you found, and complete it. If you can't finish it, fail it with the one thing you need from {user}." |
| `answer` | "{user} answered this question. Work the answer into the item: fix the fields and the remaining steps it changes. Changes must be Approve steps; never do them here." |
| `done` | "{user} did this step. Work any note into the item and adjust the remaining steps." |
| `decline` | "{user} declined this step. Remove or replace it and note why." |
| `note` / `request` | "Work this note into the item." / "Do what {user} asks if it is read-only; otherwise add an Approve step for it." |
| `capture` | "File this brain dump with file_capture: a Work notes line on an item, at most one new step that isn't an Approve step, a new Task, a fact on a page, or Needs you with one question." |
| `breakDown` | "Replace step {n} with 3 to 6 smaller ordered steps (edit_steps), keeping its kind unless a smaller step needs another." |
| `question` | "Answer {user}'s question on the item: a Work notes line (add_work_note) and, when the answer changes a fact, the field." |

### The work agent (`workagent.py`, texts in `workprompts.py`)

```python
WORK_AGENT_NAME = "Work"; WORK_AGENT_ICON = "ph-briefcase"; WORK_AGENT_COLOR = "teal"
SKILL_NAME = "work-follow-through"
SKILL_DESCRIPTION = "Carry work items: steps, approvals, questions"   # M18: 1-60 characters
CHANGE_REVIEWER = "change-reviewer.md"; CHANGE_REVIEWER_MAX = 256 * 1024
WORK_SOUL: str     # CLAUDE.md (our text): the agent carries {user}'s work items through Object's tools only, and
                   # "Load the work-follow-through skill before acting on any work queue entry."
WORK_SKILL: str    # SKILL.md body with these headings, verbatim: "## One entry, one step", "## Change-review gate",
                   # "## Questions", "## Steps", "## Never"

def find_change_reviewer(home: Path) -> Path | None
    # home/.claude/agents/change-reviewer.md, else the newest (mtime) home/.claude/plugins/cache/*/*/*/agents/change-reviewer.md;
    # only a regular file of at most CHANGE_REVIEWER_MAX bytes whose front matter says `name: change-reviewer`
def create_work_agent(registry: AgentRegistry, *, user: str, copy_change_reviewer: bool, home: Path) -> AgentRecord
    # 1. AgentRegistry.create(AgentInput(name="Work" (or "Work 2", "Work 3"… when the name or default folder is taken),
    #    icon=WORK_AGENT_ICON, color=WORK_AGENT_COLOR, description=<our string>, toolsOff=[]), WORK_SOUL.format(user=user))
    #    -> toolsOff is empty, so the shell is ON (spec; M17's shell warning applies)
    # 2. agentskills.user_create(folder, SKILL_NAME, SKILL_DESCRIPTION, WORK_SKILL.format(user=user))
    # 3. when copy_change_reviewer and find_change_reviewer(home): its bytes to <folder>/.claude/agents/change-reviewer.md
    #    (create_new, atomic; never overwrites)
    # 4. settings.patch({"workAgentId": id}). Returns the record.
def work_agent(registry: AgentRegistry, settings: dict[str, Any]) -> tuple[AgentRecord | None, str | None]
    # (record, problem): NOT_SET when workAgentId is null; M17's texts for unknown / missing / read-only;
    # REMOTE_REFUSED for an M20 remote agent
def ensure_work_agent(registry: AgentRegistry, settings: dict[str, Any], *, user: str, home: Path) -> AgentRecord
    # "created on first use": work_agent(), else create_work_agent(copy_change_reviewer=False)
```

`WORK_SKILL` carries the old rules as our text:

- **One entry, one step**: act on exactly one approved step, exactly as written, nothing wider; read the item first and check the step is still Approved.
- **Change-review gate**: before acting on an Approve step, write a plan: targets (hosts, paths, accounts), the exact commands, the backup and where it goes, the rollback, and the verification before and after. Check it point by point. Any gap blocks, including "a restart, stop or reboot of a production machine whose timing neither the step nor {user}'s note states" (then ask "When is <host> idle?"). A block fails the step with the one question that would let it pass. A pass is logged with log_activity before acting, and the result starts "Change review: PASS". The review never widens the step. "If a change-reviewer subagent is available, have it check the plan."
- **Questions**: one question at a time: the one that unblocks the step.
- **Steps**: add 3 to 6 ordered steps; a Question when information is needed back, a Do when only the fact it happened is; a change is always an Approve step; Agent steps only for read-only work.
- **Never**: write to ServiceNow (put the work note text in the result for {user} to paste); contact vendors or people; retry a destructive action; touch more than one host at a time; go on after the first error.

**First use** (the spec's "created on first use"): a `PUT /api/work/agent-settings` that turns `acts` on (or M23's `PUT /work/agent/acts`) while no usable work agent is set, calls `ensure_work_agent` (our reading: the first time Gene asks the agent to act). Until then entries simply wait, and the status says `NOT_SET`. The UI opens the "Create the Work agent" dialog first wherever it can, so the change-reviewer offer is seen.

### Captures (`captures.py`)

Capture type (our keys; names and options verbatim from spec section 7):

| Key | Name | Kind | Options |
|---|---|---|---|
| `captureText` | Text | `textBlock` | |
| `capturedAt` | Captured at | `datetime` (`resolutionPreference: "time"`) | |
| `fromView` | From view | `text` | |
| `linkedItem` | Linked item | `entity`, `isArray: false`, any type | |
| `captureStatus` | Status | `label` single | New (pink), Filed (green), Needs you (amber); option ids `new`, `filed`, `needs-you` |
| `filedTo` | Filed to | `entity`, `isArray: false`, any type | |
| `question` | Question | `text` | |

Type name "Capture", plural "Captures", icon `ph-lightbulb`, colour `pink` (the design's capture colour). Title = `one_line(text, 80)`. The body is empty: the text is a property, so filing never touches a body.

```python
CAPTURE_TYPE_NAME = "Capture"; CAPTURE_TYPE_PLURAL = "Captures"; CAPTURE_TEXT_MAX = 8000   # M22's note cap
CaptureStatus = Literal["new", "filed", "needsYou"]; Route = Literal["file", "breakDown", "question"]
BREAK_DOWN = re.compile(r"(?is)^\s*break\s*down\s+(?P<item>.+?)\s+step\s+(?P<n>\d{1,2})\s*:\s*(?P<rest>.*)$")
QUESTION = re.compile(r"(?is)^\s*question\s+about\s+(?P<item>.+?)\s*:\s*(?P<rest>.+)$")
@dataclass(frozen=True)
class Parsed: route: Route; item_ref: str | None; step_n: int | None; rest: str
def parse_prefix(text: str) -> Parsed                  # "BREAKDOWN …" (the old dashboard's spelling) matches too
def resolve_item(service: WorkService, ref: str) -> dict | None
    # a [[Title]] link's target, else a work item whose Ticket ID equals ref (casefold), else whose title equals ref
    # (casefold), else an object id; excluded objects and templates never match
def ensure_capture_type(space: Space) -> tuple[TypeDefinition, bool]          # (type, changed)
def save(space: Space, service: WorkService, *, text: str, from_view: str | None, linked_path: str | None,
         now: datetime) -> tuple[dict, Parsed, dict | None]
    # (CaptureItem, parsed, the linked work item or None). ONE create_object write carrying every value, Status New.
    # A given linked_path wins over the prefix's item; an unresolved item makes the route "file" (the text is kept as typed).
    # breakDown: step n must name an existing, unfinished step of the item, else the route is "file".
    # Empty text: InvalidValue(EMPTY_CAPTURE); over CAPTURE_TEXT_MAX: InvalidValue("A brain dump is at most 8,000 characters.")
def capture(space: Space, path: str) -> dict                                   # CaptureItem; KeyError
def list_captures(space: Space, status: CaptureStatus | None = None) -> list[dict]   # CaptureItem[], newest first; never writes

class CaptureSeam:                    # M23's CaptureSink (workseams.build_seams returns it)
    def __init__(self, service: WorkService) -> None
    def save(self, space: Space, req: CaptureRequestModel, now: datetime) -> dict
        # save(...) then workloop.loop_for(space).enqueue_capture(...); a failing enqueue is logged and never undoes the
        # save (scan_unqueued_captures picks it up). Answers the CaptureItem (M23's CaptureSummary keys plus ours).
    def list(self, space: Space, status: str | None) -> list[dict]          # list_captures
Outcome = Literal["workNote", "step", "task", "fact", "needsYou"]
def apply_outcome(space: Space, service: WorkService, capture_path: str, outcome: Outcome, actor: Actor, *,
                  item: str | None = None, text: str | None = None, step_kind: str | None = None,
                  step_text: str | None = None, task_title: str | None = None, page: str | None = None,
                  section: str | None = None, question: str | None = None) -> dict
    # workNote: service.note(item, "note", text or the capture's text, actor)
    # step:     service.edit_steps(item, [{"op": "add", "kind": step_kind, "text": step_text}], actor), step_kind in
    #           question / do / agent ("A brain dump adds no Approve step." 422)
    # task:     space.create_object(<the basic Task type>, task_title, body=<the capture's text>)
    # fact:     M11's append_to_section(<page body>, section or "Notes", text) saved with the version just read
    # needsYou: needs `question` ("Say what you need to know." 422)
    # then one property write on the capture: Status Filed + Filed to (the item, task or page), or Status Needs you + Question.
    # A capture whose Status isn't New: 409 ALREADY_FILED. Nothing is deleted or trashed.
def set_status(space: Space, capture_path: str, status: CaptureStatus, *, base_version: str | None,
               filed_to: str | None = None, question: str | None = None, reply: str | None = None) -> dict
    # Mark filed (Gene), Reply (Gene: Status back to New, Question cleared, "Reply: <text>" added to Text as a new
    # paragraph, one property write), and Object's own Filed-to after a breakDown / question run
```

### The loop (`workloop.py`)

```python
WORK_RUN_TIMEOUT = 1800.0; POLL_SECONDS = 30.0; RUNNER_ID: str       # a ULID made at import
TEST_TIMEOUT_ENV = "OBJECT_TEST_WORK_TIMEOUT"   # seconds; honoured only while OBJECT_FAKE_NOTIFY_FILE is set (M14's test-hook rule)
def run_timeout() -> float                      # WORK_RUN_TIMEOUT, or the test value under that rule
def precheck(entry: dict, item: dict | None, capture: dict | None, now: datetime
             ) -> tuple[Literal["run", "wait", "withdraw"], str | None, str | None]      # (verdict, purpose, reason); pure
    # approve:  the step exists, is kind approve, state approved, is the item's current step, the item isn't done,
    #           and notBefore <= now (later: "wait")  -> ("run", "work"); otherwise withdraw WITHDRAWN_CHANGED
    # run:      an Agent step, approved, current -> "work-read"; otherwise withdraw WITHDRAWN_CHANGED
    # breakDown: the step exists and isn't done or declined -> "work-read"
    # answer / done / decline / note / request / question: the item exists -> "work-read"
    # capture:  the capture exists with Status New -> "work-file"; otherwise withdraw ALREADY_FILED
    # an item that is gone or no longer a work item: withdraw GONE
def outcome(entry: dict, result: HeadlessResult, notices: list[WorkNotice], filed: bool, *, timed_out: bool,
            withdrawn: bool) -> tuple[WorkEntryState, str | None, str | None]                  # (state, result, reason); pure
    # withdrawn -> ("withdrawn", None, WITHDRAWN_REDECIDED); timed_out -> failed TIMED_OUT; result.state "stopped" -> failed
    # STOPPED; "error" -> failed with result.error. approve / run: the agent's `complete` (or `done`) notice on the entry's
    # step -> done (result = its text); its `fail` notice -> failed (reason = its text); neither -> failed NOT_MARKED.
    # capture: filed -> done, else failed NOT_FILED. Other kinds: done (result = one_line(reply, 500)).

class WorkLoop:
    def __init__(self, space: Space, service: WorkService, *, announce: Callable[[ChangeEvent], None],
                 base_url: Callable[[], str | None], registry: Callable[[], AgentRegistry] = AgentRegistry,
                 read_settings: Callable[[], dict[str, Any]] = ..., home: Callable[[], Path] = Path.home,
                 clock: Callable[[], datetime] = ...) -> None
    store: QueueStore
    def start(self) -> None                 # add_work_listener(self.on_notice); one worker thread
    def stop(self, timeout: float = 5.0) -> None   # unsubscribe; a running run is stopped (its entry failed STOPPED)
    def on_notice(self, space: Space, notice: WorkNotice) -> None   # plan_for_notice -> store.apply; auto-run check; wake
    def enqueue_capture(self, capture: dict, parsed: Parsed, item: dict | None) -> dict   # the capture/breakDown/question entry
    def scan_auto_runs(self) -> int         # Auto-run switched on: the auto-run check for every active work item
    def scan_unqueued_captures(self) -> int # each worker pass: a New capture with no entry of any state gets one
                                            # (a capture saved while the queue write failed is never stranded)
    def retry(self, entry_id: str) -> dict  # the new entry; KeyError (404), QueueRefused (409 / 422)
    def set_acts(self, on: bool) -> None    # the device setting; on with no usable agent: ensure_work_agent (first use)
    def running_for_chat(self, chat_id: str | None) -> dict | None
    def settings_status(self) -> dict       # WorkAgentSettings (the settings page)
    def agent_status(self) -> dict          # M23's AgentStatus (below)
    def wake(self) -> None
    def wait_idle(self, timeout: float) -> bool    # tests; POST /api/_test/work/idle
def loop_for(space: Space) -> "WorkLoop"    # the app's loop, registered by WorkLoop.__init__ (KeyError when none)

class AgentSeam:                            # M23's AgentProvider (workseams.build_seams returns it)
    def status(self, space: Space, board: list[dict]) -> dict      # loop_for(space).agent_status()
    def set_acts(self, space: Space, on: bool) -> dict             # set_acts, then the status
    def retry(self, space: Space, entry_id: str) -> dict           # retry, then the status
```

**M23's `AgentStatus`** from the queue: `available` True (M24 is installed); `agentName` the work agent's name or null; `actsOnApprovals` = `workAgentActs`; `carrying` = pending + running entries; `note` = the work agent problem (`NOT_SET`, a missing folder …) or null; `rows` = every running and pending entry, every **retryable** failed entry (a failed entry that was retried is left out, so M23's Retry, shown on failed rows, is offered once), and the newest 20 done or withdrawn, in the order running, due pending, waiting pending (by `notBefore`), failed (newest first), finished. A row is `{id, path, title, stepId, n: stepN, stepText, reason: WORK_ENTRY_LABELS[kind] (+ " (auto)" when auto), state, notBefore, createdAt, claimedAt, finishedAt, result, error: <the entry's reason>}`.

```python
WORK_ENTRY_LABELS = {"approve": "Approved step", "run": "Agent step", "answer": "Answer", "done": "Done",
                     "decline": "Declined", "note": "Note", "request": "Request", "capture": "Brain dump",
                     "breakDown": "Break down", "question": "Question"}        # our strings
class QueueRefused(workseams.SeamRefused): ...                              # 409 / 422 from retry; M23's routes map it
```

- **Auto-run check** (after every notice, and in `scan_auto_runs`): when `workAutoRun` is on, read the item; when its turn is `agent`, its current step is an **Agent** step in state **open**, and `auto_run_key(path, id, text)` isn't recorded: record the key first, then `service.step(path, id, rev, "run", Actor("app", "Object"))`. Its `run` notice creates the `auto` entry. A `StepChanged` or `IllegalMove` is logged and dropped. Approve, Question and Do steps are never auto-run. Auto-run doesn't need "Agent acts on my approvals" (the spec ties it only to its own switch); the entry then waits for that switch.
- **The worker** wakes on `wake()` (every queue change) and every `POLL_SECONDS`. While `workAgentActs` is off, or no usable work agent is set, it runs nothing (entries stay pending). Otherwise it takes the first **due** entry, reads its item (and capture) and runs `precheck`: "wait" skips it; "withdraw" stores `withdrawn` with the reason; "run" claims it (`running`, `claimedAt`, `runner`, `purpose`, `agentId`), builds the prompt with the step's **current** rev, and calls `asyncio.run(headless.run_chat(agent, settings=…, space_root=…, space_name=…, space_key=…, api_url=base_url(), prompt=entry_prompt(…), title=f"{one_line(title, 60)} · {kind}", purpose=purpose, model=agents.effective_model(agent, settings), timeout=run_timeout(), stop=<the entry's stop flag>, announce=announce))`. While it runs, the listener collects the agent's notices on that path, and `file_capture` marks the entry filed. Then `outcome(...)` is stored; a `breakDown` or `question` entry that ended `done` sets its capture Filed to the item (`set_status`, by Object).
- **One at a time per space**: one worker per `WorkLoop`, and one `WorkLoop` per app (an app serves one space).
- **Run now** is M22's `run` step action on an Agent step (M23's button): its notice queues a `run` entry, which runs as soon as "Agent acts on my approvals" is on. There is no separate "run this entry now".
- **Retry**: only a retryable entry (`QueueRefused(422, NOT_RETRYABLE)`); its `precheck` must not withdraw (`QueueRefused(409, "This step changed. Look again.")`); makes a new `pending` entry with `attempt + 1` and `retryOf`.
- **Withdraw during a run**: a `QueuePlan.stop_running` that names the running entry's step sets its stop flag (`run_chat`'s `stop` kills the CLI's process tree); the entry ends `withdrawn`.

### Strings (`workagentmodel.py`, our strings)

```python
NOT_SET = "Create the Work agent first."
REMOTE_REFUSED = "The work agent must be one of Object's own agents."
TIMED_OUT = "The run didn't finish within 30 minutes."
CRASHED = "Object closed during this run."
STOPPED = "Stopped because the space was closed."                  # = M21's schedulerun.STOPPED
NOT_MARKED = "The agent finished without marking the step done."
NOT_FILED = "The agent didn't file this brain dump."
WITHDRAWN_REDECIDED = "Withdrawn: the step was decided again."
WITHDRAWN_CHANGED = "Withdrawn: the step changed before the run started."
GONE = "Withdrawn: the item is gone or isn't a work item any more."
ALREADY_FILED = "This brain dump is already filed."
NOT_RETRYABLE = "Only a failed entry can be retried."
EMPTY_CAPTURE = "A brain dump needs text."
```

### Desk sync (`desksync.py`)

```python
DESK_SYNC_NAME = "Desk sync"; DESK_SYNC_REPEAT = "every weekday"; DESK_SYNC_TIME = "07:00"
DESK_SYNC_PROMPT: str   # our text: list the active tickets (work_items); read each Jira ticket with the Atlassian MCP tools
                        # you have and set the changed ticket fields with sync_ticket_fields; ServiceNow tickets only when a
                        # ServiceNow MCP tool is available to you, else leave them; never write to ServiceNow or Jira;
                        # reply with one line per ticket changed.
def rule_id(space: Space, engine: AutomationEngine) -> str | None     # deskSyncRuleId while that rule exists
def setup(space: Space, engine: AutomationEngine, agent_id: str, now: datetime) -> dict
    # engine.create(agentschedules.rule_payload(agent_id, name=DESK_SYNC_NAME, prompt=DESK_SYNC_PROMPT,
    #   repeat=DESK_SYNC_REPEAT, time=DESK_SYNC_TIME, start=agentschedules.default_start(...), model=None, enabled=False)),
    # then spaceconfig.set_internal(root, "deskSyncRuleId", id). 409 "Desk sync is already set up." when rule_id() is set.
def purpose_for(space: Space, rule_id: str) -> str     # schedulerun.PURPOSE_FOR: "work-sync" for the Desk sync rule, else "schedule"
def apply_ticket_fields(service: WorkService, path: str, version: str, values: dict[str, Any], actor: Actor) -> dict
    # only workfields.TICKET_KEYS ("{key} isn't a ticket field." 422), through service.fields (Activity "<agent> set …")
def status(space: Space, engine: AutomationEngine, read_tools: list[str]) -> dict    # DeskSyncStatus
```

Its runs are M21's (`run_schedule`: the AI Chat note, the notification, the run log) with purpose `work-sync`, so `work-tools` narrows them and `sync_ticket_fields` is their only extra write. Turning it on or off and moving its time use M14's existing rule routes (`saveAutomation`); the schedule also shows on the Work agent's Schedules tab (M21).

### Routes

**M23's routes, filled by M24's seams** (M23's `api_work_section.py`, unchanged: it already maps a `SeamRefused` such as `QueueRefused` to its status with `{detail}`, and `InvalidValue` to 422):

| M23 route | M24 behind it |
|---|---|
| `GET /work/agent` → `AgentStatus` | `AgentSeam.status` (live rows; `available` True) |
| `PUT /work/agent/acts {on}` → `AgentStatus` | `AgentSeam.set_acts` (first use creates the Work agent) |
| `POST /work/agent/retry {id}` → `AgentStatus` | `AgentSeam.retry`: 404 unknown; 409 "This step changed. Look again."; 422 `NOT_RETRYABLE` |
| `POST /work/captures` (`CaptureRequestModel`) → 201 `{capture}` | `CaptureSeam.save`: 422 `EMPTY_CAPTURE`, "A brain dump is at most 8,000 characters."; the capture is saved even when queueing fails |
| `GET /work/captures?status=` → `{captures}` | `CaptureSeam.list` (each a `CaptureItem`) |

**M24's own app routes** (`/api`; `Actor("user", activityName)` where an actor is needed). Every router is `router(ctx: ApiContext, loop: WorkLoop, service: WorkService) -> APIRouter` (`api_desksync` also takes the `AutomationEngine`).

| Route | Module | Body / query | Answer | Errors |
|---|---|---|---|---|
| `GET /work/agent-settings` | `api_work_agent` | | `WorkAgentSettings` | |
| `PUT /work/agent-settings` | `api_work_agent` | `{agentId?, acts?, autoRun?, readTools?, baseRevision, clientId?}` | `WorkAgentSettings` | 409 `{currentRevision}` (settings revision); 422 (`REMOTE_REFUSED`; M17's "That agent isn't listed any more."; a read tool id not matching `^mcp__[A-Za-z0-9_-]{1,64}__\S{1,128}$`; more than 500 ids) |
| `GET /work/agent/create-info` | `api_work_agent` | | `{name: string, changeReviewer: string \| null}` (the name "Create" will use; the found file's path) | |
| `POST /work/agent/create` | `api_work_agent` | `{copyChangeReviewer: boolean, clientId?}` | 201 `{agent: Agent, settings: WorkAgentSettings}` | 409 "A work agent is already set." (a usable one) |
| `GET /work/read-tools` | `api_work_agent` | | `{servers: ReadToolServer[]}`: the work agent's folder servers and every enabled gateway server, from `TOOL_CACHE` | |
| `POST /work/captures/reply` | `api_captures` | `{path, version, text, clientId?}` | `{capture: CaptureItem}` | 409 `{currentVersion}`; 422 "This brain dump isn't waiting on you."; 404 |
| `POST /work/captures/mark-filed` | `api_captures` | `{path, version, clientId?}` | `{capture: CaptureItem}` | 409; 404 |
| `GET /work/desk-sync` | `api_desksync` | | `DeskSyncStatus` | |
| `POST /work/desk-sync/setup` | `api_desksync` | `{clientId?}` | 201 `DeskSyncStatus` | 409; 422 `NOT_SET` |
| `POST /_test/work/idle` | `api_work_agent` | | `{idle: boolean}` (waits up to 30 s) | 404 unless `OBJECT_FAKE_NOTIFY_FILE` is set (M14's test-hook rule) |

Agent routes (`/api/v1/agent/work`, through `v1guard.agent_auth`, read-write scope; writes announced `api:<agent name>` and logged in the activity log). The tools live in `agent_tools_captures.py` and `agent_tools_desksync.py` (`register(server, client)`), in M17's `object-agent` server.

| Route | Tool | Answer | Errors |
|---|---|---|---|
| `POST /api/v1/agent/work/file-capture` `{capture, outcome, item?, text?, stepKind?, stepText?, taskTitle?, page?, section?, question?}` | `file_capture(capture, outcome, item=None, text=None, step_kind=None, step_text=None, task_title=None, page=None, section=None, question=None)` | `{capture: CaptureItem, filedTo: string \| null}` | 403 "This run can't file brain dumps." (token purpose isn't `work-file`); 404 (capture, item or page hidden or missing); 409 `ALREADY_FILED`; 422 (`apply_outcome`'s and M22's messages) |
| `POST /api/v1/agent/work/ticket-fields` `{path, version, values}` | `sync_ticket_fields(path, version, values)` | `WorkWriteResult` | 403 "Only Desk sync updates ticket fields this way." (purpose isn't `work-sync`); 409; 422 |

Events: `ChangeEvent("workQueue", <entry id or "settings">, None, origin)` on every queue change and work-settings save (the kind M23 declares in `watcher.ChangeEvent.kind`, `server.RESYNC_EVENTS` and the client's `ChangeKind` and `RESYNC_EVENTS`). Captures are ordinary `created` / `changed` object events.

### TypeScript (T1, `frontend/src/api/types.ts`; pydantic mirrors in `workagentmodel.py`)

M23 already defines `AgentStatus`, `AgentQueueRow`, `AgentQueueState`, `CaptureRequest` and `CaptureSummary`; M24 adds only:

```ts
export interface WorkAgentSettings {
  agentId: string | null; agent: Agent | null; problem: string | null   // NOT_SET, M17's texts, REMOTE_REFUSED
  acts: boolean; autoRun: boolean; readTools: string[]; settingsRevision: string
}
export type CaptureRoute = 'file' | 'breakDown' | 'question'
export interface CaptureItem extends CaptureSummary {   // what M24's sink answers for every capture
  objectId: string | null; version: string; title: string; fromView: string | null; linkedTitle: string | null
  filedTo: { path: string; title: string } | null
  route: CaptureRoute                              // parse_prefix of the text, at read
}
export interface ReadToolRow { id: string; name: string; description: string; marked: boolean; serverSaysReadOnly: boolean }
export interface ReadToolServer { name: string; source: 'gateway' | 'folder'; listed: boolean; tools: ReadToolRow[] }
export interface DeskSyncStatus {
  ruleId: string | null; enabled: boolean; repeat: string | null; time: string | null
  lastRun: { at: string; status: string; detail: string | null } | null
  markedReadTools: number                          // marked tools listed right now
}
// DeviceSettings gains workAgentId: string | null; workAgentActs: boolean; workAutoRun: boolean; workReadTools: string[]
// (ChangeKind already has 'workQueue', from M23)
```

`api/client.ts` (T1) adds `workAgentSettings()`, `saveWorkAgentSettings(patch, baseRevision)`, `workAgentCreateInfo()`, `createWorkAgent(copyChangeReviewer)`, `workReadTools()`, `captureItems(status?)` (M23's `GET /work/captures`, typed `CaptureItem[]`), `replyCapture(path, version, text)`, `markCaptureFiled(path, version)`, `deskSync()`, `setUpDeskSync()`. M23's `workAgent()`, `setAgentActs(on)`, `retryAgentEntry(id)`, `workCapture(req)` and `workCaptures(status?)` are used as they are. `test/mockApi.ts` (T1) adds `workAgentSettings()`, `captureItem()`, `deskSyncStatus()` and the mocks. M23's `useWorkEvents` already reloads its `agent` part on `workQueue` events and its `needsYou` part with the board, so no M23 front-end file changes.

### Fake `claude` (T1, `backend/tests/fake_claude.py`)

`FAKE_CLAUDE_WORK_ACTIONS` (environment; JSON `{"<entry kind>": [{"server", "tool", "args"}]}`): when the prompt's first line matches `ENTRY_PROMPT_FIRST`, the fake runs that kind's calls as M18's `FAKE:mcp` markers (the same allow/deny matcher), after filling `{path}`, `{stepId}`, `{stepRev}` and `{capture}` in string arguments from the prompt's `Ref:` line. Gene's own text in the prompt may carry M17/M18/M20 markers (`FAKE:wait`, `FAKE:mcp:…`), so a capture or an answer can steer a run. No other marker changes.

### Changes to earlier milestones' files (explicit; one owner task each)

| File (milestone) | Change | Task |
|---|---|---|
| `backend/objectapp/mcpmodel.py` (M19) | `GATEWAY_PURPOSES` gains `"work"`, `"work-read"`, `"work-file"`, `"work-sync"` after M19's three (M19's comment and test allow it) | T1 |
| `backend/objectapp/toolcatalog.py` (M17) | `AGENT_TOOLS` gains `"file_capture"` ("File a brain dump") and `"sync_ticket_fields"` ("Update ticket fields (Desk sync)"), on by default, in "Object agent tools" | T1 |
| `backend/objectapp/agent_mcp.py` (M17) | `TOOL_MODULES` gains `"objectapp.agent_tools_captures"` and `"objectapp.agent_tools_desksync"` | T1 |
| `backend/objectapp/settings.py` | the four `work…` keys, defaults and checks | T1 |
| `backend/objectapp/spaceconfig.py` | `INTERNAL_KEYS = ("deskSyncRuleId",)`; `set_internal(root, key, value) -> str` (atomic, every other key kept); `space_fields` leaves internal keys out | T1 |
| `backend/objectapp/server.py` | mount the five routers; one `WorkLoop` per app beside the `WorkService` M22 builds, made **before** M23's `build_seams(space, service)` is called; `worktools.install(loop, service)` (appends to M17's `v1guard.WRITE_GUARDS`, sets M22's `api_v1_work.STEP_GUARD`, adds the two contributors); `schedulerun.PURPOSE_FOR = desksync.purpose_for` (M21's hook); the lifespan starts the loop after `automations.start()` and stops it before `automations.stop()` | T1 |
| `backend/objectapp/workseams.py` (M23) | `build_seams`'s body only: `WorkSeams(workloop.AgentSeam(), captures.CaptureSeam(service))` (M23: "M24 replaces this body only") | T1 |
| `backend/tests/fake_claude.py` | `FAKE_CLAUDE_WORK_ACTIONS` | T1 |
| `frontend/src/settings/sections/Work.tsx` (M22) | mounts `<WorkAgentSettings />` after M22's two rows and M23's alert rows | T9 |

**Provided by the earlier plans, only used here:** M17's `ai.Turn.timeout` (fed by M20's `run_chat(timeout=)`), `v1guard.WRITE_GUARDS` and the order registry's rows 57 and 66 and the four work purposes; M19's `ProbeResult.read_only`; M21's `schedulerun.PURPOSE_FOR`; M22's `api_v1_work.STEP_GUARD`; M23's `SeamRefused` mapping on its acts, retry and captures routes, its `workQueue` reload, and its `registerView.ts` glob.

**Not changed:** M18's `reviews.REVIEW_PURPOSES` stays `{"chat"}`, so work runs never start a background review (Our calls 10). M10's `ai.py`, M17's `agentrun.py`, `run_tool_lists`, `transcripts.py`, M20's `headless.py`, M19's `mcpprobe.py` and `gateway_*` contributors, M21's `schedulerun.py`, M22's `api_v1_work.py` and every M23 file but `workseams.py` are not edited.

### Filling M23's seams

M23's front end is final: its brain-dump bar, agent pill, Agent queue view, Stuck view, Now's "Agent is carrying" and "Parked dumps need you", the item panel's **Ask the agent**, Make it smaller's **Ask the agent to break it down**, the focus session's and Keep on top's boxes, and **Run now** already call M23's routes and M22's. M24 makes those calls live:

| M23 seam (M23's call) | What M24 does behind it |
|---|---|
| Brain-dump bar, "Tell the agent what you see", Keep on top's box (`api.workCapture`) | `CaptureSeam.save`: the Capture object first, then a `capture`, `breakDown` or `question` entry (prefix parsing) |
| **Ask the agent** (`api.workNote(path, 'request', text)`, M22) | the `request` notice queues a `request` entry |
| **Ask the agent to break it down** (`api.workCapture({text: "Break down {ref} step {n}: …", linkedPath})`) | a `breakDown` entry for that step; the run replaces it with 3 to 6 steps |
| **Run now** (`api.workStep(… 'run')`, M22) | the `run` notice queues a `run` entry |
| Agent pill, Agent queue view, Stuck's failed runs, Now's "Agent is carrying" (`api.workAgent()`) | `AgentSeam.status`: `available` True, the queue as `rows`, `carrying`, `note` |
| "Agent acts on my approvals" switch, Retry (`api.setAgentActs`, `api.retryAgentEntry`) | `AgentSeam.set_acts`, `AgentSeam.retry` |
| "Parked dumps need you" (`api.workCaptures('needsYou')`) | `CaptureSeam.list("needsYou")`, each with its question |
| `registerWorkView` (from `frontend/src/work/captures/registerView.ts`, loaded by M23's glob) | M24 registers **Captures** (`id: 'captures'`, label "Captures", icon `ph-lightbulb`, `key: null`, count = New + Needs you captures) |

Note: M23 sends **Ask the agent** as an M22 `request` note, not as a `Question about <item>: …` capture; M24 accepts that (the spec's `Question about` prefix still works when typed into the brain-dump bar).

## Tasks

Each task: write the failing test, run it and see it fail, implement, run it and see it pass, commit. Each task runs only its own tests and those of the modules it touched (`uv run pytest backend/tests/test_m24_<x>.py -q`, `npx vitest run <files>`); the full suites run in T11. Tests use `OBJECT_STATE_DIR` in `tmp_path` (conftest's autouse fixture), a temp `home` for `find_change_reviewer`, a copy of the fixture space, and the fake `claude`. Commit messages end with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

Fixtures: M22's `backend/tests/fixtures/space-work/` (its `Tasks/Printer jams on line 3.md` has a done Question, an open Approve "Restart the print spooler on PRN-TEST-01" and an open Agent step; `Tasks/Badge reader audit.md` is CRLF + BOM with one open Do step), plus T1's synthetic `backend/tests/fixtures/home-reviewer/` (below). Clock 2026-11-05T10:00Z, space time zone UTC.

### Task 1: Contract, seams and the fake (first, alone)

**Files**
- Create: `backend/objectapp/workagentmodel.py` (the models, constants and strings), stubs with the Contract's signatures raising `NotImplementedError` or returning empty values: `workqueue.py`, `captures.py`, `worktools.py`, `workagent.py`, `workprompts.py`, `workloop.py` (a `WorkLoop` whose `start`/`stop` do nothing, `loop_for`, and an `AgentSeam` answering M23's `NoAgent` status with `available` True and no rows), `desksync.py`; empty routers `api_work_agent.py`, `api_captures.py`, `api_desksync.py`, `api_v1_captures.py`, `api_v1_desksync.py`; `agent_tools_captures.py`, `agent_tools_desksync.py` (`register` adds nothing yet); fixture `backend/tests/fixtures/home-reviewer/.claude/agents/change-reviewer.md` and `backend/tests/fixtures/home-reviewer-plugin/.claude/plugins/cache/example/change-reviewer/0.1.0/agents/change-reviewer.md` (synthetic: front matter `name: change-reviewer`, `description: Reviews a proposed change`, a short body; no real host or person); tests `backend/tests/test_m24_contract.py`, `frontend/src/work/agent/contract.test.ts`
- Modify: `frontend/src/api/types.ts`, `api/client.ts`, `test/mockApi.ts`; `backend/objectapp/mcpmodel.py`, `toolcatalog.py`, `agent_mcp.py`, `settings.py`, `spaceconfig.py`, `server.py`, `workseams.py` (M23: `build_seams`'s body); `backend/tests/fake_claude.py`; M23's `test_m23_api.py::test_seams_until_m24` (it now runs against a monkeypatched `NoAgent`/`NoCaptures` `build_seams`, as its own fake-seams case does, so it keeps checking M23's 501 path)

**Interfaces**
- Produces: everything in the Contract; the edits in "Changes to earlier milestones' files" except `Work.tsx` (T9).
- Consumes: M22's `WorkService` (built in `server.py`), M17-M21 as named, M23's `workseams` and routes.

**Steps**
1. Failing tests:
   - `test_m24_contract.py::test_constants` — `WORK_ENTRY_LABELS["capture"] == "Brain dump"`, `WORK_RUN_TIMEOUT == 1800`, `DESK_SYNC_TIME == "07:00"`, `DESK_SYNC_REPEAT == "every weekday"`, `len(SKILL_DESCRIPTION) <= 60`, `STOPPED == schedulerun.STOPPED`, `WORK_PURPOSES` has the four names and `READ_ONLY_PURPOSES` excludes `"work"`.
   - `::test_models_parse_contract_json` — `WorkQueueEntry`, `WorkAgentSettings`, `CaptureItem`, `DeskSyncStatus` and M23's `AgentQueueRow` shape (as `AgentSeam` builds it) parse the Contract's examples; an unknown kind or state is refused.
   - `::test_settings_keys` — `settings.read()` defaults `workAgentId None`, `workAgentActs False`, `workAutoRun True`, `workReadTools []`; `patch({"workReadTools": ["bad"]})` raises `SettingsProblem`; 501 ids are refused.
   - `::test_hooks_filled` — after `create_app`: `schedulerun.PURPOSE_FOR is desksync.purpose_for` and it answers `"schedule"` for any rule but the Desk sync one; `worktools.read_only_write_guard in v1guard.WRITE_GUARDS` (once, however often `install` runs); `api_v1_work.STEP_GUARD is worktools.step_guard`; `mcpmodel.GATEWAY_PURPOSES[3:] == ("work", "work-read", "work-file", "work-sync")`; `workagentmodel.QueueRefused(409, "x")` is a `workseams.SeamRefused`; `spaceconfig.set_internal(root, "deskSyncRuleId", "01J…")` keeps every other key and byte of `space.json` except that key, and `space_fields` doesn't show it.
   - `::test_agent_tools_catalogue` — `AGENT_TOOLS` ends with `("file_capture", "sync_ticket_fields")`; both default on; `agent_mcp.TOOL_MODULES` ends with the two modules.
   - `::test_fake_work_actions` — the fake, run with a prompt starting `Work queue entry 01J…: run.` and a `Ref:` line, and `FAKE_CLAUDE_WORK_ACTIONS={"run": [{"server": "object", "tool": "work_item", "args": {"path": "{path}"}}]}`, emits a `tool_use` for `mcp__object__work_item` with the path filled.
   - `::test_routers_mounted_and_reads_write_nothing` — `GET /api/work/agent` (M23's route, now `available: true`), `/api/work/captures`, `/api/work/agent-settings`, `/api/work/desk-sync`, `/api/work/read-tools` answer 200 on a copy of `space-work`; the state dir's file list and the space copy's bytes are unchanged; `workQueue` is in `RESYNC_EVENTS`; `build_seams(space, service).agent` is an `AgentSeam`.
   - `contract.test.ts` — `api.workAgentSettings()` gets `/api/work/agent-settings`; `api.replyCapture(p, v, 't')` posts to `/api/work/captures/reply`; `api.captureItems('needsYou')` gets `/api/work/captures?status=needsYou`; `ChangeKind` accepts `'workQueue'` (a type-level `satisfies` check).
2. Run `uv run pytest backend/tests/test_m24_contract.py -q`, `npx vitest run src/work/agent/contract.test.ts`, `npx tsc -b --noEmit`: they fail.
3. Implement the contract files, stubs and seams, with the exact signatures.
4. Run again: pass; `tsc` clean; M17/M19/M20/M21's own suites for the touched files pass (`uv run pytest backend/tests/test_m17_*.py backend/tests/test_m19_*.py backend/tests/test_m20_*.py backend/tests/test_m21_*.py -q`).
5. Commit: `feat(m24): contract, seams and fake for the agent loop`.

### Task 2: The queue store and the notice rule (Lane A)

**Files**
- Modify: `backend/objectapp/workqueue.py`
- Test: `backend/tests/test_m24_queue.py`

**Interfaces**
- Consumes: M22's `WorkNotice`, `Actor`; `appstate.space_key`, `jsonstore.dump_json`, `ids.new_ulid`.
- Produces: `QueueStore`, `QueuePlan`, `plan_for_notice`, `auto_run_key` (Contract).

**Steps**
1. Failing tests (`WorkNotice`s built by hand; the store on `tmp_path`):
   - `test_plan_table` — parametrised over every row of the notice table: the `approve` notice by `Actor("user","Gene")` with `not_before` gives `create.kind == "approve"` and that `notBefore`; `decline` gives `stop_running` True and the reason as `text`; `run` by `Actor("app","Object")` gives `auto: True`, `by == "Object"`; `reopen` gives no create and `withdraw_step` set; `close` gives `withdraw_item`.
   - `test_agent_and_app_writes_never_queue_work` (Review Focus 5) — every event by `Actor("agent","Work")` (including `note`, `request`, `answer`-shaped and `fields` from Desk sync) gives `None`; `complete`, `fail`, `log`, `fields`, `floor`, `add`, `move` by the user give `None`; the only `app` notice that creates is `run`.
   - `test_states_and_due` — a pending entry with `notBefore` 2026-11-05T12:00Z is not due at 10:00 and due at 12:00; `claim_next` takes the oldest due one and sets `running`, `claimedAt`, `runner`; the store does not enforce one at a time (T6's worker does).
   - `test_withdraw_on_redecide` — two pending `approve` entries for step `r8k1pd` (approve, withdraw, approve again): applying the `reopen` plan withdraws both with `WITHDRAWN_REDECIDED`; an entry of another step stays.
   - `test_auto_run_once_per_step_text` (Review Focus 4) — `record_auto_run(auto_run_key(p, "s1", "Check the spooler log"))`, a new `QueueStore` on the same file: `has_auto_run` is True; the same step with text "Check the spooler log again" is False; the key list keeps the newest 2000.
   - `test_crashed_running_is_served_failed_without_a_write` — a file with a `running` entry whose `runner` is another id: `entries()` serves it `failed` with `CRASHED` and `retryable: True`; the file's bytes are unchanged until the next `add`, which saves it as failed.
   - `test_unreadable_file_kept_aside` — garbage bytes: `entries()` is `[]`, `problem()` is "The work queue file can't be read."; the next `add` copies it to `work-queue-<key>.unreadable-<stamp>.json` first.
   - `test_finished_entries_capped` — 520 done entries keep the newest 500; pending and failed are never dropped.
2. Run: `uv run pytest backend/tests/test_m24_queue.py -q`: fails.
3. Implement.
4. Run: passes.
5. Commit: `feat(m24): work queue store and notice rule`.

### Task 3: Captures (Lane B)

**Files**
- Modify: `backend/objectapp/captures.py`, `api_captures.py`, `api_v1_captures.py`, `agent_tools_captures.py`
- Test: `backend/tests/test_m24_captures.py`

**Interfaces**
- Consumes: `Space.create_type`, `save_type`, `create_object`, `update_properties`, `save_body`, `read`; M11's `append_to_section`; M22's `WorkService.items/item/note/edit_steps`, `workbody.one_line`; `v1guard.agent_auth`; `workloop.loop_for(...).enqueue_capture` (T1 stub; T6 fills); M23's `CaptureRequestModel` and its `/work/captures` routes.
- Produces: the Captures section of the Contract with `CaptureSeam`; `POST /api/work/captures/reply`, `/mark-filed`; `POST /api/v1/agent/work/file-capture`; the `file_capture` tool.

**Steps**
1. Failing tests (a copy of `space-work`; `TestClient`):
   - `test_capture_type_made_once` — the first `POST /api/work/captures` makes the "Capture" type with the seven properties (keys, names, kinds and the three Status options in order) and announces `types`; a second capture leaves the type file unchanged.
   - `test_capture_saved_first_and_never_deleted` (Review Focus 3) — through M23's `POST /api/work/captures` with `WorkLoop.enqueue_capture` patched to raise: the answer is still 201 `{capture}`, the capture file exists with Status New, `capturedAt` 2026-11-05T10:00Z and the full text (CRLF text, a `---` line, a `[[Badge reader audit]]` link and 5,000 characters, all kept); then `file_capture` with every outcome on fresh captures never removes or trashes a capture file (the Trash listing is unchanged); a second `file_capture` on the same capture is 409 `ALREADY_FILED`; `needsYou` without a question is 422 "Say what you need to know."
   - `test_prefixes` — `parse_prefix("Break down INC0012345 step 2: restart is too big")` gives route `breakDown`, item `INC0012345`, n 2; `"BREAKDOWN OPS-123 step 1: x"` the same route; `"question about Printer jams on line 3: which tray?"` gives `question`; `"Question about nothing here"` (no colon) and plain text give `file`.
   - `test_prefix_routes_to_the_item` — `Break down INC0012345 step 2: …` links `Tasks/Printer jams on line 3.md` and step `r8k1pd`; `Question about Badge reader audit: …` links by title; `Question about NOPE-1: …` saves with route `file` and no link; `Break down INC0012345 step 9: …` (no step 9) saves with route `file`; a given `linkedPath` wins over the prefix.
   - `test_outcomes` — through `POST /api/v1/agent/work/file-capture` with a `work-file` token for the agent "Work": `workNote` appends one `## Work notes` line `[2026-11-05] Work: note: …` to the item and sets Filed + Filed to the item; `step` with kind `do` adds one open Do step at the end; `step` with kind `approve` is 422 "A brain dump adds no Approve step."; `task` creates a Task titled as given whose body is the capture's text; `fact` appends to the page's `## Notes` (created when missing) keeping the page's CRLF and BOM (on `Badge reader audit.md`); `needsYou` sets Status Needs you and Question.
   - `test_file_capture_needs_a_filing_run` — the same call with a `work-read` token or a `chat` token is 403 "This run can't file brain dumps."; a capture filed to an excluded page is 404.
   - `test_reply_and_mark_filed` — `reply` on a Needs you capture sets New, clears Question, appends `Reply: …` as a new paragraph of Text, and calls `enqueue_capture`; on a New capture it is 422 "This brain dump isn't waiting on you."; a stale version is 409; `mark-filed` sets Filed and nothing else (the diff is the one property line and `lastUpdated`).
   - `test_list_captures_writes_nothing` — `GET /api/work/captures?status=needsYou` lists only those, newest first; no byte of the space changes.
2. Run: `uv run pytest backend/tests/test_m24_captures.py -q`: fails.
3. Implement.
4. Run: passes.
5. Commit: `feat(m24): captures, prefixes and filing outcomes`.

### Task 4: Read-only runs, enforced (Lane C)

**Files**
- Modify: `backend/objectapp/worktools.py`
- Test: `backend/tests/test_m24_tools.py`

**Interfaces**
- Consumes: `agentrun.add_contributor`, `RunScope`, `RunParts`, `build_run`; `toolcatalog` lists and `WORK_STEP_TOOLS`; M19's `TOOL_CACHE`, `mcpgateway.tool_id`; M17's `v1guard.WRITE_GUARDS`, M22's `api_v1_work.STEP_GUARD`; `WorkLoop.running_for_chat` (T1 stub).
- Produces: `read_run_tools`, the two contributors, `read_only_write_guard`, `step_guard`, `install` (Contract).

**Steps**
1. Failing tests:
   - `test_read_only_runs_get_no_write_tool` (Review Focus 1) — parametrised over `work-read`, `work-file`, `work-sync`: an agent with `toolsOff: []` (shell on), an allow rule `Bash(*)` in its `.claude/settings.local.json`, a gateway server `jira` whose `TOOL_CACHE` entry lists `get_issue` and `edit_issue` with only `mcp__jira__get_issue` in `workReadTools`, and a folder server `notes` never listed. `build_run` for that purpose gives `--allowedTools` with exactly the Object read tools, the four `WORK_STEP_TOOLS`, `WebFetch`, `Skill`, `mcp__jira__get_issue` and the purpose's extra tool; `--disallowedTools` holds `Bash`, `PowerShell`, `Write`, `Edit`, `MultiEdit`, `Read`, `Task`, `Agent`, `mcp__object__set_properties`, `mcp__object__set_work_fields`, `mcp__object__move_to_trash` and `mcp__jira__edit_issue`; no bare `mcp__jira` is allowed; `notes` is not in the run's `mcp.json` and a note says why; `mcp__object-agent__memory` is disallowed.
   - `test_switches_still_apply` — with `WebFetch` and `mcp__jira__get_issue` in `toolsOff`, neither is allowed.
   - `test_full_set_for_approved_runs` — purpose `work` gives exactly the arguments M17/M19/M20 give a `chat` run of that agent (Bash allowed, `mcp__jira` allowed), plus `WORK_GUIDANCE` in `append.md`.
   - `test_guidance` — `work-sync` runs carry both `WORK_GUIDANCE` and `DESK_SYNC_GUIDANCE` after M17's guidance; a `chat` run carries neither.
   - `test_v1_guard_refuses_writes_from_read_only_tokens` — a `work-read` ephemeral token: `POST /api/v1/object/properties` and `POST /api/v1/work/fields` answer 403 "This run is read-only."; `POST /api/v1/work/activity` passes; a `work-sync` token may call `/api/v1/agent/work/ticket-fields`, a `work-read` one may not; a `chat` token is untouched.
   - `test_step_guard_refuses_approve_complete_outside_its_run` — with the Approve step approved: `complete` by a `work-read` token is 403 "Only the run for this approved step can report it."; by a `work` token whose chat is the running entry of that step it passes; by a `work` token of another entry it is 403; `complete` of an Agent step by a `work-read` token passes; a `chat` token keeps M22's behaviour.
   - `test_read_only_hint_never_marks` — a `TOOL_CACHE` entry whose `ProbeResult.read_only` (M19) names `get_issue`, with `workReadTools` empty: `get_issue` is not allowed in a `work-read` run (the hint never marks a tool by itself).
2. Run: `uv run pytest backend/tests/test_m24_tools.py -q`: fails.
3. Implement.
4. Run: passes; `uv run pytest backend/tests/test_m19_*.py -q` still passes.
5. Commit: `feat(m24): narrowed tool lists and write guards for read-only work runs`.

### Task 5: The work agent, its skill and the prompts (Lane C, after T4)

**Files**
- Modify: `backend/objectapp/workagent.py`, `backend/objectapp/workprompts.py`
- Test: `backend/tests/test_m24_agent.py`

**Interfaces**
- Consumes: `AgentRegistry.create/get/list`, `AgentInput`, M18's `agentskills.user_create`, `list_skills`; `settings.patch`; `textfile.atomic_write`.
- Produces: `create_work_agent`, `work_agent`, `ensure_work_agent`, `find_change_reviewer`, `WORK_SOUL`, `WORK_SKILL`, `WORK_GUIDANCE`, `DESK_SYNC_GUIDANCE`, `ENTRY_PROMPT_FIRST`, `entry_prompt` (Contract).

**Steps**
1. Failing tests:
   - `test_create_work_agent` — `create_work_agent(registry, user="Gene", copy_change_reviewer=False, home=tmp)`: an agent "Work" with icon `ph-briefcase`, `toolsOff == []` (Bash on), `CLAUDE.md` containing "Load the work-follow-through skill before acting on any work queue entry."; `list_skills(folder)` has `work-follow-through` with `created_by: user` and the five headings; the device setting `workAgentId` is its id. A second call (name taken) makes "Work 2".
   - `test_skill_carries_the_rules` — `WORK_SKILL` contains "Change review: PASS", "When is <host> idle?", "3 to 6", "never" + "ServiceNow" in the Never section, "one question at a time" (case-insensitive), and "If a change-reviewer subagent is available, have it check the plan."
   - `test_change_reviewer_copy` — with `home = fixtures/home-reviewer`: `find_change_reviewer` returns its file; `copy_change_reviewer=True` writes byte-identical `<folder>/.claude/agents/change-reviewer.md`; with `home-reviewer-plugin` the plugin-cache copy is found; a candidate without `name: change-reviewer`, a directory, or one over 256 KiB is ignored; with an empty home nothing is copied and nothing fails; the temp home's files are unchanged.
   - `test_work_agent_problems` — `workAgentId` null gives `NOT_SET`; an unknown id gives "That agent isn't listed any more."; a remote agent record (M20 kind `remote`) gives `REMOTE_REFUSED`; `ensure_work_agent` creates one only when none is usable.
   - `test_entry_prompts` — parametrised over the ten kinds: the first line is `Work queue entry <id>: <kind>.`, the `Ref:` line carries the path, step id and the rev passed in, and the kind's sentence from the Contract table is present with `{user}` filled as "Gene"; Gene's text is included verbatim; an approve prompt names the not-before time when set.
2. Run: `uv run pytest backend/tests/test_m24_agent.py -q`: fails.
3. Implement.
4. Run: passes.
5. Commit: `feat(m24): the Work agent, its skill and the entry prompts`.

### Task 6: The loop (Lane A, after T2; needs T3, T4, T5)

**Files**
- Modify: `backend/objectapp/workloop.py`
- Test: `backend/tests/test_m24_loop.py`

**Interfaces**
- Consumes: `QueueStore`, `plan_for_notice`, `auto_run_key` (T2); `captures.capture`, `set_status`, `list_captures` (T3); `worktools.install` and the purposes (T4); `workagent.work_agent`, `ensure_work_agent`, `workprompts.entry_prompt` (T5); M22's `add_work_listener`, `WorkService`, `Actor`; M20's `headless.run_chat` (its `timeout` reaches M17's `Turn.timeout`).
- Produces: `WorkLoop`, `precheck`, `outcome` (Contract).

**Steps**
1. Failing tests (a copy of `space-work`, the Work agent created in `tmp_path`'s state dir, the fake `claude`, `workAgentActs` on unless said, `loop.wait_idle(10)` after each action):
   - `test_approve_runs_with_full_tools_and_completes` — approve the Approve step through `WorkService.step(..., Actor("user","Gene"))`: one `approve` entry; it runs once with purpose `work`; with `FAKE_CLAUDE_WORK_ACTIONS={"approve": [{"server":"object","tool":"step_action","args":{"path":"{path}","step_id":"{stepId}","step_rev":"{stepRev}","action":"complete","text":"Change review: PASS. Spooler restarted."}}]}` the step is Done with that result, the entry `done` with that result, the item's Activity has `Work completed step 2: …`; the fake's log shows `Bash` in `--allowedTools`; the transcript is in the Work agent's sessions.
   - `test_full_tools_only_for_a_current_approved_approve_step` (Review Focus 2) — with the switch off, queue an approve entry, then (separately per case) withdraw it, decline it, move another step before it, or give it `notBefore` 2026-11-05T12:00Z; switch on: in the withdrawn, declined and reordered cases the approve entry ends `withdrawn` (`WITHDRAWN_REDECIDED` or `WITHDRAWN_CHANGED`) and no run with purpose `work` starts (the decline case's own `decline` entry runs as `work-read`); the not-before case stays pending (no run) until the clock passes 12:00, then runs; an `approve` entry written by hand for an Agent step is withdrawn; after approve, withdraw and approve again exactly one run happens; no run of any other kind has `Bash` allowed.
   - `test_fail_with_question` — `FAKE_CLAUDE_WORK_ACTIONS` with `fail` and `ask: "When is PRN-TEST-01 idle?"`: a Question step is inserted before the Approve step (Gene's turn), the Approve step is Open again, the entry is `failed` with the reason, `retryable` True; Retry answers 409 "This step changed. Look again." (the step isn't approved any more).
   - `test_not_marked_and_timeout` — a run that does nothing ends `failed` `NOT_MARKED`; with `WORK_RUN_TIMEOUT` patched to 2 s and `FAKE:wait` in the step text the run is stopped after about 2 s and the entry is `failed` `TIMED_OUT`; Retry makes a new pending entry with `attempt == 2` and `retryOf`.
   - `test_run_limit_is_thirty_minutes_not_turn_timeout` (Review Focus 4) — `ai.TURN_TIMEOUT` patched to 1 s and `WORK_RUN_TIMEOUT` to 3 s: a `FAKE:wait` run lasts longer than 1 s and is cut at about 3 s (the work limit governs, not the chat limit); `run_chat` was called with `timeout=WORK_RUN_TIMEOUT`.
   - `test_one_run_at_a_time_and_restart_safety` (Review Focus 4) — three due entries, each run waiting 1 s: the fake's log shows the runs never overlap and run oldest first; a queue file with a `running` entry from another `RUNNER_ID` is served failed `CRASHED` and never re-run by itself; `stop()` during a run kills it and fails the entry `STOPPED`.
   - `test_withdraw_during_a_run_stops_it` — while an approve run waits (`FAKE:wait`), Gene's `reopen` of that step stops the CLI and the entry ends `withdrawn`.
   - `test_switch_off_means_nothing_runs` — with `workAgentActs` off, approve, answer, Run now on an Agent step and a capture make four pending entries and no CLI starts; `set_acts(True)` runs them one by one, oldest first.
   - `test_agent_status_for_m23` — `AgentSeam().status(space, board)` answers M23's `AgentStatus`: `available` True, `actsOnApprovals`, `carrying` = pending + running, rows in the Contract's order with `reason` "Approved step" / "Agent step (auto)" and `error` = the entry's reason; a retried failed entry is not in `rows`; `note` is `NOT_SET` with no agent.
   - `test_auto_run` — on `Badge reader audit.md` set up with `edit_steps` (its Do step removed; an open Question, then an open Agent step "Check the badge reader log"), Gene answers the Question (with `workAutoRun` on): Object's `run` (Activity `Object asked the agent to run step 2 "Check the badge reader log"`) makes one `auto` entry with purpose `work-read`; after that entry fails with an ask and Gene answers the new Question, the same Agent step text is not auto-run again; an edited text is; with `workAutoRun` off nothing is auto-run; `scan_auto_runs()` after switching it on auto-runs the eligible step once.
   - `test_capture_entries` — a plain capture runs with purpose `work-file`; with `file_capture` `workNote` in the fake's actions the capture is Filed and the entry `done`; a `question` capture runs `work-read` and, done, its capture is Filed to the item by Object; a `breakDown` capture whose run replaces the step with three steps (`edit_steps`) ends `done`.
   - `test_failed_filing_keeps_the_capture_new` (Review Focus 3) — a filing run that ends in an error, one that times out, and one that never calls `file_capture`: each entry is `failed` (`NOT_FILED` for the last), the capture still exists with Status New, and `scan_unqueued_captures()` doesn't queue it again (it has an entry); a capture saved while the queue write failed is queued by the next pass.
   - `test_no_agent_set` — with `workAgentId` null, entries stay pending and `settings_status()["problem"] == NOT_SET` and M23's `note` says the same; turning the switch on through `ensure_work_agent` creates "Work" once.
2. Run: `uv run pytest backend/tests/test_m24_loop.py -q`: fails.
3. Implement.
4. Run: passes.
5. Commit: `feat(m24): the work loop: queueing, auto-run, runs and outcomes`.

### Task 7: App routes for the agent (Lane A, after T6)

**Files**
- Modify: `backend/objectapp/api_work_agent.py`
- Test: `backend/tests/test_m24_api.py`

**Interfaces**
- Consumes: `WorkLoop` (T6), `workagent` (T5), `settings.read/patch`, M19's `McpStore`, `TOOL_CACHE`, `ProbeResult.read_only`, `mcpgateway.server_groups`.
- Produces: the `api_work_agent` rows of the routes table.

**Steps**
1. Failing tests (`TestClient`, a copy of `space-work`):
   - `test_status_and_settings` — `GET /api/work/agent-settings` before anything: `agentId` null, `problem` `NOT_SET`, `acts` False, `autoRun` True; `PUT /api/work/agent-settings {acts: true}` with no agent creates "Work" (first use) and answers `acts` True; a stale `baseRevision` is 409 `{currentRevision}`; `agentId` of a remote agent is 422 `REMOTE_REFUSED`; `autoRun` switched on calls `scan_auto_runs`; every save announces `workQueue`/`settings`.
   - `test_create_info_and_create` — with `home` patched to `fixtures/home-reviewer`, `create-info` answers `{name: "Work", changeReviewer: <its path>}` and writes nothing; `POST /api/work/agent/create {copyChangeReviewer: true}` is 201 with the copy in place; a second create is 409 "A work agent is already set."
   - `test_queue_rows_order` — M23's `GET /api/work/agent` `rows`: running first, then due pending, then waiting pending by `notBefore`, then retryable failed newest first, then at most 20 done/withdrawn; the read writes nothing.
   - `test_m23_agent_routes_are_live` — `PUT /api/work/agent/acts {on: true}` with no agent creates "Work" and answers `actsOnApprovals` True; `POST /api/work/agent/retry {id}`: 404 for an unknown id, 422 `NOT_RETRYABLE` on a done entry, 409 "This step changed. Look again." when the step changed, else the status with the new pending row.
   - `test_read_tools` — with a gateway server cached as `get_issue` (hinted read-only) and `edit_issue`, `GET /api/work/read-tools` lists both with `serverSaysReadOnly` True for `get_issue` only and `marked` from `workReadTools`; a server never listed is `listed: false` with no tools; nothing is probed or written.
   - `test_test_hook_gated` — `POST /api/_test/work/idle` is 404 without `OBJECT_FAKE_NOTIFY_FILE`.
2. Run: `uv run pytest backend/tests/test_m24_api.py -q`: fails.
3. Implement.
4. Run: passes.
5. Commit: `feat(m24): work agent settings, M23's agent routes live, read-tools route`.

### Task 8: Desk sync (Lane B, after T3)

**Files**
- Modify: `backend/objectapp/desksync.py`, `api_desksync.py`, `api_v1_desksync.py`, `agent_tools_desksync.py`
- Test: `backend/tests/test_m24_desksync.py`

**Interfaces**
- Consumes: M21's `agentschedules.rule_payload`, `default_start`, `AutomationEngine.create`, `schedulerun.run_schedule`, `PURPOSE_FOR` (T1); `spaceconfig.set_internal` (T1); M22's `WorkService.fields`, `TICKET_KEYS`; `v1guard.agent_auth`.
- Produces: the Desk sync section of the Contract; `GET /api/work/desk-sync`, `POST /api/work/desk-sync/setup`, `POST /api/v1/agent/work/ticket-fields`, the `sync_ticket_fields` tool.

**Steps**
1. Failing tests:
   - `test_setup_makes_an_off_weekday_schedule` — with the Work agent set: `POST /api/work/desk-sync/setup` makes one rule named "Desk sync" with a `runAgent` action for the work agent, trigger `repeat: "every weekday"`, `time: "07:00"`, `enabled: false`, the `DESK_SYNC_PROMPT`; `space.json` gains only `deskSyncRuleId`; a second setup is 409 "Desk sync is already set up."; without a work agent it is 422 `NOT_SET`; `GET` writes nothing.
   - `test_desk_sync_runs_read_only` — `run_schedule` for that rule (M21's test path, the fake `claude`) builds the run with purpose `work-sync`: `--allowedTools` has `mcp__object-agent__sync_ticket_fields` and no `Bash`, no `mcp__object__set_work_fields`; a gateway server named `servicenow` with no marked tool is left out of the run; another schedule of the same agent still runs with purpose `schedule`.
   - `test_ticket_fields_only` — through `sync_ticket_fields` with a `work-sync` token: setting `deskStatus` to "Resolved" and `deskUpdated` changes those two lines (plus `lastUpdated` and one Activity line `Work set Desk status to Resolved; set Desk updated to 2026-11-05`) and never `status`; `rank` is 422 "rank isn't a ticket field."; a `work-read` or `chat` token is 403 "Only Desk sync updates ticket fields this way."; the notice queues nothing (T2's rule).
   - `test_status` — `GET /api/work/desk-sync` answers `ruleId`, `enabled`, `repeat`, `time`, the last run from M14's run log, and `markedReadTools`; after the rule is deleted (to the Trash) `ruleId` is null and setup works again.
2. Run: `uv run pytest backend/tests/test_m24_desksync.py -q`: fails.
3. Implement.
4. Run: passes.
5. Commit: `feat(m24): Desk sync schedule and ticket-field updates`.

### Task 9: Work settings: the work agent, read tools, Desk sync (Lane D)

**Files**
- Create: `frontend/src/work/agent/WorkAgentSettings.tsx`, `CreateWorkAgentDialog.tsx`, `ReadToolsList.tsx`, `DeskSyncRow.tsx`, `workAgentText.ts` (every string below, as `WORK_AGENT_TEXT`)
- Modify: `frontend/src/settings/sections/Work.tsx` (M22's file: mounts `<WorkAgentSettings />` after M22's two rows and M23's alert rows)
- Test: `frontend/src/work/agent/WorkAgentSettings.test.tsx`

**Interfaces**
- Consumes: T1's client calls (`workAgentSettings`, `saveWorkAgentSettings`, `workAgentCreateInfo`, `createWorkAgent`, `workReadTools`, `deskSync`, `setUpDeskSync`); M17's `useAgents` (local agents only); M14's `saveAutomation` for Desk sync's switch and time.
- Produces: the settings UI (strings are ours unless the spec gives them).

**UI** (Settings > Work, after M22's two rows and M23's alert rows; group heading "Work agent"):
- "Work agent": a picker of local agents (remote ones are not listed) with "None"; when none is set, the button **Create the Work agent**. Its dialog: title "Create the Work agent"; text "Object makes a local agent named Work with the work-follow-through skill. Its shell is on, so approved changes can run." followed by M17's `SHELL_WARNING` verbatim; when `create-info` finds a change-reviewer file, a checkbox (on) "Copy your change-reviewer into the Work agent's folder" with the hint "The copy is the agent's own from then on."; buttons "Cancel", "Create".
- Switches: **Agent acts on my approvals** (the spec's label) and **Auto-run read-only steps** (the spec's label), with the help lines "Off: entries wait in the Agent queue." and "Agent steps run by themselves when they become current, once per step text."; turning **Agent acts on my approvals** on with no work agent opens the Create dialog first.
- "Read tools" (`ReadToolsList`): per server, its tools with a checkbox each (marked = may run in read-only runs), "Server says read-only" as a small tag, and "Mark the ones the server calls read-only"; a server not listed shows "Open the Work agent's Tools tab to list its tools." Help: "Read-only runs (Agent steps, brain dumps, Desk sync) can use only the tools you mark here."
- "Desk sync" (`DeskSyncRow`): before setup, **Set up Desk sync** with "Reads Jira (and ServiceNow, once an MCP server for it exists) each weekday at 07:00 and updates ticket fields. Never writes to the desk."; after, its switch (off by default), the time, the last run, and "No read tools marked yet" when `markedReadTools` is 0.

**Steps**
1. Failing tests (mock API): the picker lists only `kind: 'local'` agents; Create opens the dialog with the shell warning text and the reviewer checkbox only when `changeReviewer` is set, and posts `createWorkAgent(true)`; turning the acts switch on with `agentId: null` opens the dialog instead of saving; ticking a tool saves `readTools` with the new id and the current `settingsRevision`, and a 409 reloads and shows a toast; Set up Desk sync calls `setUpDeskSync`; its switch calls `saveAutomation` with `enabled: true`; no success toast anywhere.
2. Run: `npx vitest run src/work/agent/WorkAgentSettings.test.tsx`: fails.
3. Implement.
4. Run: passes; `npx tsc -b --noEmit` clean.
5. Commit: `feat(m24): work agent settings, read tools and Desk sync`.

### Task 10: The Captures view (Lane E)

**Files**
- Create: `frontend/src/work/captures/CapturesView.tsx`, `registerView.ts` (picked up by M23's `import.meta.glob('../*/registerView.ts', { eager: true })` in `WorkPage.tsx`), `captureText.ts` (strings)
- Test: `frontend/src/work/captures/CapturesView.test.tsx`

**Interfaces**
- Consumes: T1's `captureItems`, `replyCapture`, `markCaptureFiled`; M23's `registerWorkView`, `WorkViewProps`, `Chip` (tone `capture`), `useWorkData`, `workToast`.
- Produces: the Captures view (`id: 'captures'`).

**UI** (`CapturesView`, in M23's look): list rows about 36 px: the title, Captured at, From view, a Status chip (New in the capture tone, Filed, Needs you in the approve tone), Filed to (a link that opens the item panel), Linked item (a link); filters All / New / Needs you / Filed (our labels); a Needs you row shows the agent's Question and a reply box with **Send** (`replyCapture` with the row's version) and **Mark filed**; a 409 reloads and toasts M23's conflict text; success shows nothing; empty state "Nothing waiting to be filed." (our string, calm). `registerView.ts` calls `registerWorkView({id: 'captures', label: 'Captures', icon: 'ph-lightbulb', key: null, count: <New + Needs you from the view's own small store>, Component: CapturesView})`.

**Steps**
1. Failing tests (mock API): the view lists `captureItem()`s, filters by status, and a Needs you row posts `replyCapture(path, version, text)`; Mark filed posts and the row's chip turns Filed after the reload; the view is in `workViews()` after importing `registerView.ts`, with label "Captures" and its count, and M23's `WorkPage` lists it in the switcher (the glob found it).
2. Run: `npx vitest run src/work/captures`: fails.
3. Implement.
4. Run: passes; `tsc` clean.
5. Commit: `feat(m24): the Captures view, registered in the Work section`.

### Task 11: Integrate (alone, last)

**Files**
- Create: `scripts/m24_acceptance.py`, `docs/superpowers/plans/m24-acceptance.md`
- Modify: `docs/behavior-catalog.md` (the Captures view, the Work agent settings rows, what the brain-dump bar and the Agent queue now do; M23 lists their labels and `B`); `docs/superpowers/plans/remaining-work.md`, `CONTINUE.md`
- Test: the full suites

**Steps**
1. `scripts/m24_acceptance.py` (copies `backend/tests/fixtures/space-work` itself to a temp folder, sets `OBJECT_STATE_DIR`, `OBJECT_CACHE_DIR`, `OBJECT_CLOCK_FILE`, `OBJECT_FAKE_NOTIFY_FILE` and `FAKE_CLAUDE_LOG` to temp paths, points `claudePath` at the fake `claude` as `scripts/m10_acceptance.py` does, starts the app on 127.0.0.1, never touches the original fixture or `~/.claude`, and prints `RESULT: PASS` only when every check passes):
   1. **Create the Work agent** with a temp home holding the synthetic change-reviewer: the agent "Work" exists with Bash on, the skill and the copied file.
   2. **Brain dump**: `POST /api/work/captures` "Order more toner for line 3" with the switch off: the Capture object exists at once with Status New and a pending `capture` entry; no CLI started.
   3. **Switch on and filing**: `PUT /api/work/agent-settings {acts: true}`; with `FAKE_CLAUDE_WORK_ACTIONS` filing it as `task`: the capture is Filed to a new Task "Order more toner"; the capture file still exists; the run's `--allowedTools` has no `Bash` and `--disallowedTools` has `Bash`.
   4. **Approve**: approve the Approve step through `POST /api/work/step` (two-press is UI; the API takes one call): one run with `Bash` allowed; the fake completes it with "Change review: PASS …"; the step is Done; the entry is `done`.
   5. **Auto-run**: the Agent step now current is auto-run once (`auto: true`, purpose `work-read`); the fake fails it with an ask: a Question is inserted before it, the entry is failed with the reason, and it shows in M23's `GET /api/work/agent` `rows` as failed.
   6. **Withdraw**: approve, then reopen before switching on: the entry is withdrawn and never runs.
   7. **Prefixes**: `Question about INC0012345: which tray jams?` and `Break down OPS-123 step 1: …` link the right items and run `question` / `breakDown` entries.
   8. **Guards**: a `work-read` token's `POST /api/v1/object/properties` is 403 "This run is read-only."
   9. **Timeout**: after restarting the app with `OBJECT_TEST_WORK_TIMEOUT=3` (honoured because `OBJECT_FAKE_NOTIFY_FILE` is set; the restart also checks that the queue survives it) and `FAKE:wait` in a capture's text, the entry fails `TIMED_OUT`; Retry queues it again.
   10. **Desk sync**: setup makes an off "Desk sync" schedule at 07:00 every weekday; running it (M21's test tick) uses purpose `work-sync` and `sync_ticket_fields` changes Desk status only.
   11. **No write on read**: every GET route above leaves the space copy's bytes and the state dir's file list unchanged.
2. `docs/superpowers/plans/m24-acceptance.md`, hand checks for Gene (each `- [ ]`), on a copy of his work export kept outside the repo:
   - [ ] Settings > Work: **Create the Work agent** shows the shell warning and offers to copy your change-reviewer; afterwards the Work agent is in the Agents section with the shell on and the skill on its Skills tab.
   - [ ] Type a brain dump in the bar and press Enter: it is in Captures at once (Status New), before the agent does anything; with the switch off it waits in the Agent queue.
   - [ ] Turn on **Agent acts on my approvals**: the capture gets filed (Status Filed, Filed to set) and the capture is still there.
   - [ ] A brain dump the agent can't place shows on Now as "Parked dumps need you" with its question; Send a reply and it is filed.
   - [ ] **Ask the agent** on an item and **Ask the agent to break it down** in Make it smaller: the answer lands on the item / the step is replaced by smaller steps.
   - [ ] Approve an Approve step (two presses): the agent writes a change plan, and when timing for a restart is unstated it asks you instead of acting (a Question step appears before it).
   - [ ] Set a **Not before** time: nothing runs before it.
   - [ ] Withdraw an approval while it waits: it disappears from the queue as withdrawn.
   - [ ] An Agent step that becomes current runs by itself once; a failed run shows under Failed with its reason and **Retry**, and in Stuck.
   - [ ] The agent pill reads "Agent is carrying N · M alerts" and opens the Agent queue.
   - [ ] Settings > Work > Read tools: mark your Atlassian server's read tools; **Set up Desk sync**, turn it on, run it once (Run now on the Work agent's Schedules tab): ticket fields update, nothing is written to Jira or ServiceNow, and Object's own status never changes.
   - [ ] Unlinked mentions still show on a work item's page.
3. Run the full suites: `uv run pytest backend/tests -q`, `npx vitest run`, `npx tsc -b --noEmit`, `npm run build`, `uv run python scripts/m24_acceptance.py` (prints `RESULT: PASS`); then `scripts/m22_acceptance.py` and `scripts/m21_acceptance.py` still pass.
4. Commit: `feat(m24): integrate the brain dump and the agent loop; acceptance`.

Then one whole-milestone review (correctness, file safety, fidelity to the spec), one fix pass, the final gate (step 3 again), and Gene's hands-on check.

## Shared files and ordering

| Shared file | Owner | Others needing a change say so in their report |
|---|---|---|
| `frontend/src/api/types.ts`, `api/client.ts`, `test/mockApi.ts` | T1 | T9, T10 |
| `backend/objectapp/workagentmodel.py` | T1 | T2-T8 consume |
| `backend/objectapp/server.py`, `settings.py`, `spaceconfig.py` | T1 | |
| `backend/objectapp/mcpmodel.py` (M19), `toolcatalog.py`, `agent_mcp.py` (M17) | T1 | |
| `backend/objectapp/workseams.py` (M23: `build_seams`' body only), `backend/tests/test_m23_api.py` (M23) | T1 | |
| `backend/tests/fake_claude.py` | T1 | T6, T11 may ask for a marker |
| `backend/objectapp/workqueue.py` | T1 (stub), then T2 | T6 consumes |
| `backend/objectapp/captures.py`, `api_captures.py`, `api_v1_captures.py`, `agent_tools_captures.py` | T1 (stubs), then T3 | T6, T8 consume |
| `backend/objectapp/worktools.py` | T1 (stub), then T4 | T6, T7 consume |
| `backend/objectapp/workagent.py`, `workprompts.py` | T1 (stubs), then T5 | T6, T7, T8 consume |
| `backend/objectapp/workloop.py` | T1 (stub), then T6 | T3 calls `enqueue_capture` (patched in its tests), T4 `running_for_chat`, T7 |
| `backend/objectapp/api_work_agent.py` | T1 (stub), then T7 | |
| `backend/objectapp/desksync.py`, `api_desksync.py`, `api_v1_desksync.py`, `agent_tools_desksync.py` | T1 (stubs), then T8 | |
| `frontend/src/settings/sections/Work.tsx` (M22) | T9 | |
| `docs/behavior-catalog.md`, `remaining-work.md`, `CONTINUE.md` | T11 | |

## Lanes

T1 runs first, alone. Then five lanes (counted from the Files lists; no file is in two lanes):

| Lane | Tasks, in order | Waits for |
|---|---|---|
| A (queue, loop, routes) | T2, T6, T7 | T6 also needs T3 (B), T4 and T5 (C) |
| B (captures, Desk sync) | T3, T8 | |
| C (tools, agent) | T4, T5 | |
| D (front end: settings) | T9 | only T1 |
| E (front end: Captures view) | T10 | only T1 (and M23 built) |

With two agents at a time (the CPU limit), run B and C first, then A, with D and E filling the gaps. T11 integrates after every lane. Then one whole-milestone review, one fix pass, the final gate and Gene's hands-on check.

## Our calls

1. **Four purposes** (`work`, `work-read`, `work-file`, `work-sync`) and two contributors at **57 `work-guidance`** and **66 `work-tools`**, listed in M17's registry of orders. (ours)
2. **"Read-only" means every run that isn't an approved Approve step** (answers, notes, requests, declines, completions and break-downs included): the spec lists four read-only cases and says "only a run for an approved Approve step gets the full set". (ours, from the spec's "only")
3. **Filing and Desk sync get one extra write each** (`file_capture`, `sync_ticket_fields`), because the spec's filing outcomes (a new Task, a fact on a page, the capture's own Status) and Desk sync's "update ticket fields" can't be done with the step and Activity tools alone. Each is refused outside its purpose, and Desk sync's touches only ticket fields. (ours; see Guesses 1)
4. **Enforced twice**: the CLI's lists (allow and **deny**, so the folder's own allow rules can't lift them) and Object's own routes (a read-only token's writes outside the step and Activity routes answer 403; only the running approve entry's token may report an Approve step). Unlisted MCP servers are left out of read-only runs. (ours)
5. **Read marking is Gene's**: M19 has no notion of a "read" tool, so Settings > Work lists every listed tool with a checkbox (`workReadTools`, machine-wide); a server's own `readOnlyHint` is shown, never trusted on its own. (ours)
6. **The queue's states, file and caps**: `<state>/work-queue-<space key>.json`; done and withdrawn keep 500; a crashed `running` entry is shown failed (`CRASHED`) and never re-run by itself (an approved change may have half-run). (ours; the old dashboard re-queued expired claims, which is unsafe for changes)
7. **What creates an entry** follows the old dashboard's item types, and only Gene's (and Object's auto-run) actions do; the agent's own writes never queue work. Editing or removing a step, and Close, withdraw like a re-decision; a reopen or decline of a running entry's step stops that run. (ours)
8. **Auto-run** needs only its own switch (default on, as the old dashboard); its entries wait for "Agent acts on my approvals" (default **off**: a safety switch Gene turns on). "Once per step text" is per item and step id; a changed text runs again. (ours)
9. **The 30-minute limit** is a per-run timeout passed down to `ai.run_turn` through M20's `run_chat(timeout=)` and M17's `Turn.timeout` (M10's 300 s stays everyone else's default). Retry makes a new entry; a step that changed can't be retried. Run now is M22's step action; nothing runs while the switch is off. (ours)
10. **No background reviews for work runs**: `REVIEW_PURPOSES` stays `{"chat"}`. Every queue entry is a short unattended run; reviews after each would churn the Work agent's memory and skills, and the spec's skill is Gene's to tune (made with `created_by: user`, so the curator leaves it alone). (ours)
11. **The Work agent**: named "Work" (or "Work 2"…), icon `ph-briefcase`, teal; shell on; `CLAUDE.md` + the `work-follow-through` skill; "created on first use" means when Gene first turns "Agent acts on my approvals" on. The change-reviewer is looked for in `~/.claude/agents/` and then in Claude Code's plugin cache, and copied to the agent's `.claude/agents/`. (ours)
12. **Captures**: type "Capture" (`ph-lightbulb`, pink), keys `captureText`, `capturedAt`, `fromView`, `linkedItem`, `captureStatus`, `filedTo`, `question`; the text is a property and the body stays empty; text up to 8,000 characters; titles from the first 80 characters. Reply and Mark filed for Needs you captures. A filing run that fails leaves the capture New with its failed entry and Retry. (ours)
13. **Prefixes** match case-insensitively, also the old `BREAKDOWN …` spelling; the item is a `[[link]]`, a Ticket ID, a title or an object id; an unresolved item or step files the capture normally, text kept. (ours)
14. **Desk sync**: a "Desk sync" rule made by **Set up Desk sync**, its id kept in `space.json` (`deskSyncRuleId`); M21 runs it as any schedule (AI Chat note, notification) but with purpose `work-sync`, through M21's `schedulerun.PURPOSE_FOR` hook. (ours)
15. **Settings live on the machine** (device settings `workAgentId`, `workAgentActs`, `workAutoRun`, `workReadTools`), as agents do; the queue lives per space. (ours)
16. All strings marked "our string" above, including "Nothing waiting to be filed.", the entry kind labels (`WORK_ENTRY_LABELS`, shown as M23's row `reason`), and the settings texts. (ours)

## Guesses (spec points I could not plan without guessing)

1. **Filing's and Desk sync's writes under "read-only".** The spec's read-only list (Object's read tools, the step and Activity write tools, web fetch, read-marked MCP tools) can't create a Task, write a fact on a page, set the capture's Status, or update ticket fields. **Guess:** one narrow, purpose-checked tool each (Our calls 3), rather than giving those runs `create_task`, `append_to_section`, `set_properties` or `set_work_fields`.
2. **"Marked read".** M19 has no read marking. **Guess:** Gene marks tools in Settings > Work, helped by the server's `readOnlyHint` (M19's `ProbeResult.read_only`).
3. **"Created on first use".** **Guess:** when Gene first turns "Agent acts on my approvals" on with no work agent set; the UI shows the Create dialog first so the change-reviewer copy is offered.
4. **Whether the work runs' prompts may name Gene.** **Guess:** they use the `activityName` setting (default "Gene"), as M22's Activity lines do.
5. **The default of "Agent acts on my approvals".** The old dashboard defaulted it on. **Guess:** off in Object until Gene turns it on, since a fresh Work agent has the shell on.
6. **M23's seams.** Settled in the reconcile pass: M23 provides the `SeamRefused` mapping (M24's `QueueRefused` subclasses it), the `workQueue` kind and its reload, and the `registerView.ts` glob, so M24 edits only `build_seams`' body. (no guess left)
7. **Ask the agent.** M23 sends it as an M22 `request` note, while spec section 7 names `Question about <item>: …` "(Ask the agent)". **Guess:** both are fine: the note queues a `request` entry, and the prefix still routes a typed brain dump as a `question` entry.




