# Milestone 23: the Work section

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal.** A **Work** entry in the sidebar, below Agents, opens the work dashboard as an Object page: a top bar (energy, Just one thing, the agent pill, search), a brain-dump bar, the focus rail from today's daily note, and eleven views (Now, Flow, Projects map, Today, On the floor, Your queues, Agent queue, Stuck, Wins, Alerts, Everything) plus the Tickets view. Steps are acted on inline wherever they show (two-press Approve, Not before, Decline with a reason, Withdraw, Run now, Done, answers), rows vanish at once and come back with a toast on failure, and Done/Decline/Approve offer a 5-second Undo. The item panel shows a work header above the object's own page. A focus session overlay, Keep on top, Make it smaller, keyboard shortcuts, an Alert type with a folder watch for monitoring JSON files, and Wins from Object's own history complete it. Agent actions are queued through M22's step rules but nothing runs them yet: the agent's data, the capture save and the agent switch are seams M24 fills.

**Architecture.** The front end reads one **board** (`GET /api/work/board`: M22's summaries plus each item's steps, floor items, deadline and the people its Blocked on names) and computes every view from it with pure functions (`frontend/src/work/logic/`: scoring, energy, focus filter, Flow lanes, project lines, day slots, queues, Stuck, Make it smaller's splitter). Every write to a work item goes through M22's routes (`/api/work/step`, `/steps`, `/fields`, `/note`, `/close`, `/floor`) through one front-end wrapper (`state/workActions.ts`) that hides the row, runs the call, restores the row with a toast on failure and offers Undo. The item panel is the object page in the side panel with a work header, whose writes go through M22's `ObjectWrites.work` so the open editor never loses an Activity line. Small new back-end modules read and write what M22 doesn't cover: the daily note's Focus section (`workfocus.py`), today's meetings (`workday.py`), Wins (`workwins.py`, with a read-only history scan), the general floor list (`workfloor.py`), the Alert type and folder watch (`alerttype.py`, `alertwatch.py`), the keep-on-top window host (`windowhost.py`) and the M24 seams (`workseams.py`), all served by one router (`api_work_section.py`). The Work page's own UI state (energy, calm, view, Not now, the selected focus line) is per-space browser storage, so using the page writes no file.

**Tech Stack.** Python 3 (FastAPI, pydantic), `uv`; React, TypeScript, zustand, shadcn/ui, Tailwind, vitest; pywebview (already a dependency) for the keep-on-top window. No new dependencies. No agent runs in this milestone, so no `claude` CLI flags are named.

**Spec.** `docs/superpowers/specs/2026-11-05-work-dashboard-design.md`: section **5** (the Work section: top bar, brain-dump bar's place and `B`, focus rail, the views table, Now scoring, item panel, step actions, focus session, Keep on top, Make it smaller, keyboard), section **6** (focus lines, meetings, alerts with the folder watch, wins), and **Design language**. Section 7's capture save and section 8's agent loop are M24's; this plan defines the seams M24 fills (Contract, "Seams for M24"). Behaviour details the spec leaves to "today's dashboard" (energy matching, Up next, day slots, Make it smaller, the monitoring file format) were read read-only from `C:\Git\ticket-dashboard\tracker.html` and `monitoring.py` and are marked "ported". The wiki was not read.

Built on `feat/m22-m23` (worktree `C:\Git\object-work`, the second of the two parallel tracks Gene chose on 2026-11-06) after M22 (`822e467..bc53bab`, see `m22-acceptance.md` for its deviations). This track has M16-M18 and part of M19 but not M20-M21; M23 uses none of them. Reconciled with the built code on 2026-11-06. Consumes M22's Contract as written (`docs/superpowers/plans/2026-11-05-m22-work-model.md`): `workrules`, `workfields`, `workread`, `workservice.WorkService`, the `/api/work/*` routes, the `steps`/`textList`/`floorItems` kinds, `StepList.tsx`, `ResolutionNote.tsx`, `stepRules.ts`, the Tickets view `work-tickets`, `ObjectWrites.work`, and its TS types. Nothing here redefines them. Every label the spec gives is verbatim; every other label and default is "our string" or "our choice".

## Global Constraints

- Never write on read: `GET /api/work/board`, `/focus` (no daily note is created by reading), `/today`, `/wins`, `/alerts`, `/agent`, `/captures`, `/floor/general`, `/keep-on-top`, opening the Work page and every view write no file (`.md`, `.object/`, state dir). The Work page's UI state lives in per-space browser storage only.
- Every change to a work item goes through M22's routes; M23 adds no other way to write a work item. The only new writes are: the Focus section of a daily note (Focus Edit), the general floor list `.object/work/floor.json`, the Alert type file and Alert objects (folder watch, "Add the Alert type").
- Focus Edit changes only the Focus section's list lines of that day's daily note (heading and other text kept), creating the daily note through `Space.create_daily_note` when it is missing; version-checked; CRLF and BOM kept; atomic.
- Alert objects are ordinary objects (stamped, in version history, deletes to the Trash). A scan whose files are unchanged writes nothing; a restart never duplicates an alert.
- Toasts only for problems; success just happens (the row vanishes). The exception is the **Undo** toast, **5 s**, for Done, Decline and Approve (Approve's Undo withdraws it).
- Every inline action makes its row vanish at once; on failure the row comes back with a toast. A stale step answers HTTP 409 and the toast reads exactly `This step changed. Look again.`
- A step is never offered before the current one: actions render only for a step whose `current` is true, and only the actions in its `actions` list (M22's `allowedActions(steps, i, 'user')`).
- Approve takes two presses: the first turns the button into `Press again to approve` (spec wording).
- A selected focus line filters Now to the work linked to that line only; never a fallback to unrelated work.
- Now scoring: priority weight (Critical 100, High 60, Medium 30, Low 10; Desk priority for tickets, else the item's own priority) + `max(0, 25 - 2 × rank)` + 15 if touched in the last day − 25 if its stage is Not started; parked items and items whose turn isn't yours are never picked. Stale = untouched for more than **7** days. Step energy: Question low / 5 min, Approve low / 2 min, Do high / 30 min.
- Up next shows at most **3**, matched to energy, then `+N more hidden on purpose`. Flow's Doing for You has a limit of **3**, flagged `Overloaded`. Done items show for **14** days (M22's `DONE_VISIBLE_DAYS`), then only in Everything.
- Today's timeline runs **07:00-17:30**; focus lines go into gaps of **45** minutes or more; a now-line; deadline countdowns.
- Focus session: a **25**-minute timer.
- View keys: `g` then `n` Now, `w` Flow, `p` Projects map, `t` Today, `o` On the floor, `q` Your queues, `h` Agent queue, `s` Stuck, `y` Wins, `l` Alerts, `e` Everything. Also `/` search, `B` brain dump, `j`/`k` move, Enter open, Space peek, `[`/`]` previous/next item, Esc closes, `?` the shortcut sheet. Keys never fire while typing in a field or editor.
- Design language: you = Object's accent (indigo), agent = teal, others = grey, Approve = amber, Critical = red, High = amber (text-and-dot chips, never big coloured badges), capture = pink. Every colour is a theme token (`theme/noRawColours.test.ts` stays green) and works in all four themes. List rows about 36 px; the Now card is the one large element.
- Empty states reassure: `Nothing is waiting on you`, `Focus {n} cleared`, `All quiet`.
- Every feature unlocked; no badge, upsell or limit beyond the values named here.
- No agent runs in M23. Object never reads `~/.claude/.credentials.json` or any Claude token and never calls Anthropic's API. Tests use `OBJECT_STATE_DIR` in a temp folder and never touch `~/.claude`.
- The server binds 127.0.0.1 only. No network at runtime (a ticket link opens in the browser only when Gene clicks it).
- Fixtures are synthetic (`INC0012345`, `OPS-123`, "Printer jams on line 3", "Pat Example", `printer-watch`); no real ticket, host, person or monitoring job name. Never touch `C:\Git\wiki`.
- Never name the original notes app, or the open-source agent whose patterns the agents design adopts, in code, strings, fixtures or docs.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

The five failure modes no task's ordinary tests would catch, most likely first. Each has its test in the owning task.

1. **Work keys fire while Gene types.** `B`, `j`, `k`, `g`, Space, `[`, `]`, `/` and `?` pressed in the brain-dump bar, an answer box, the side panel's body editor, the property panel or a dialog must type, not act; Space on a focused button must press the button, not open the peek. Test: `frontend/src/work/keys/useWorkKeys.test.tsx::test keys never act in fields, editors, dialogs or on buttons` (T16).
2. **A header action in the item panel bypasses the open editor.** The work header's actions must go through `ObjectWrites.work` (flush the body, run, adopt the version, load the returned body), or a pending body save 409s or overwrites the new Activity line; actions from the views must make an open page of that item reload. Test: `frontend/src/work/panel/WorkHeader.test.tsx::test an action with a pending body edit saves the body first and shows the new Activity line` and `::test an action from the Now card reloads an open page of the item` (T14).
3. **The focus filter falls back, or a later step is offered.** With a focus line selected and no work of it on Gene's turn, Now must show the focus empty state, never another item; a card, queue or panel must never show actions for a step after the current one (both were real bugs in the old dashboard). Test: `frontend/src/work/logic/scoring.test.ts::test a focus line never falls back to unrelated work` (T7) and `frontend/src/work/views/QueuesView.test.tsx::test only the current step offers actions` (T13).
4. **Focus Edit writes more than the Focus section, or reading writes.** A GET with no daily note must create none; a save must change only the list lines (prose inside the section, other sections, front matter untouched), keep CRLF/BOM and refuse a stale version. Test: `backend/tests/test_m23_focus.py::test_save_changes_only_focus_list_lines` and `::test_reading_never_creates_a_note` (T3).
5. **The folder watch rewrites or duplicates.** A second scan of unchanged files, a restart (new `AlertWatch` on the same state), a file that turns unreadable, or an alert that moves between files must not create duplicates or touch unchanged Alert objects; secrets in alert text are redacted. Test: `backend/tests/test_m23_alerts.py::test_rescan_and_restart_write_nothing` and `::test_unreadable_file_keeps_its_alerts` (T5).

## Contract (T1)

### Storage

| What | Where | Written by |
|---|---|---|
| Work items (steps, fields, Activity, Work notes) | M22's storage | M22's routes only |
| Focus lines | the `Focus` section (a bullet list) of the day's daily note | `PUT /api/work/focus` |
| General floor list | `.object/work/floor.json` (`space.store("work")`, id `floor`): `{"schemaVersion": 1, "items": [<M22 floor mapping>]}`, `jsonstore.dump_json` | `POST /api/work/floor/general` |
| Alert type | `.object/types/<id>.json` made by `Space.create_type("Alert", "Alerts", …)` then `save_type` with the Alert fields (below) | `alerttype.ensure_alert_type`, on the first alert or "Add the Alert type" |
| Alert objects | ordinary objects in the type's folder (`Alerts/`) | the folder watch; agents and automations through the generic object routes |
| Folder-watch state | `<state dir>/work-alerts-<hash>.json` (`<hash>`: `reminders.space_key(space.root)`, the hash `reminders.ledger_path_for` uses) | `AlertWatch` |
| Alert folder, per-source intervals | device settings `workAlertFolder` (absolute path or null, at most 500 characters), `workAlertIntervals` (`{source: minutes}`, 1-10080, at most 50 entries); defaults also in `frontend/src/settings/defaults.ts` and `backend/tests/test_settings.py`'s `CONTRACT_DEFAULTS` | `PUT /api/settings` |
| Work page UI state | browser storage `object.work:<space root>` (energy, calm, view, Not now of today, selected focus line, Flow area, Everything sort) | the front end |

Nothing is written into the state dir for the board, focus, today, wins or the seams.

### The Alert type (`backend/objectapp/alerttype.py`)

```python
ALERT_NAME = "Alert"; ALERT_PLURAL = "Alerts"; ALERT_ICON = "ph-warning"; ALERT_COLOR = "red"
ALERT_FIELDS: tuple[FieldSpec, ...]      # M22's workfields.FieldSpec, in this order:
#   source "Source" text | severity "Severity" label single: Critical (red), Warning (amber), Info (gray)
#   message "Message" text | raisedAt "Raised at" datetime (resolutionPreference "time")
#   clearedAt "Cleared at" datetime (time) | link "Link" url | alertKey "Alert key" text (visibility hidden)
def is_alert_type(t: TypeDefinition | None) -> bool          # has property key "alertKey" of kind text and "severity" of kind label
def alert_type(space: Space) -> TypeDefinition | None        # the first alert type by id; reads only
def ensure_alert_type(space: Space) -> tuple[TypeDefinition, bool]   # (type, created); idempotent; announces ("types", id, revision, origin)
```

Keys are ids (`id == key`). A space may already have an "Alert" type that isn't an alert type: `ensure_alert_type` then makes "Alert" with the next free id `create_type` gives (`InvalidValue` for the name in use is answered by naming it "Monitoring alert" / "Monitoring alerts", our fallback).

### Folder watch (`backend/objectapp/alertwatch.py`)

```python
POLL_SECONDS = 60.0; DEFAULT_INTERVAL_MIN = 1440; MAX_ALERTS_PER_FILE = 200; MAX_FIELD = 1200
@dataclass
class AlertScanReport: files: int; created: int; updated: int; cleared: int; unchanged: int; errors: list[str]
class AlertWatch:
    def __init__(self, space: Space, *, folder: Callable[[], Path | None], intervals: Callable[[], dict[str, int]],
                 announce: Callable[[ChangeEvent], None] = lambda _e: None,
                 poll_seconds: float = POLL_SECONDS) -> None
    # `announce`: server.py passes its own (the SSE hub); the scan thread is no request, and the
    # file watcher is silent about the app's own writes, so the watch announces its writes itself.
    def start(self) -> None          # a daemon thread scanning every poll_seconds; idle while folder() is None
    def stop(self) -> None
    def scan_once(self) -> AlertScanReport
    def sources(self) -> list[dict]  # AlertSourceStatus per file of the last scan (read from the state file; never writes)
def read_alert_file(path: Path) -> dict     # the ported reader (below); never raises
def is_stale(generated: datetime | None, interval_min: int, now: datetime) -> bool   # generated None or now - generated > 2 × interval
```

**File format** (ported from the old dashboard's monitoring contract; today's scripts keep working unchanged): every `*.json` in the folder is one job's latest result, read as `utf-8-sig`; other files are ignored.

```jsonc
{"source": "printer-watch", "generated": "2026-11-05T09:50:00Z", "ok": true, "error": null,
 "intervalMinutes": 15,            // optional (ours); else Settings' workAlertIntervals[source]; else 1440
 "alerts": [{"key": "tray-2", "severity": "crit|warn|info", "title": "Tray 2 jammed",
             "detail": "…", "host": "PRN-TEST-01", "since": "2026-11-05T09:40:00Z", "due": null, "link": "https://…"}]}
```

- `source` defaults to the file's stem. Severity `crit` → Critical, `warn` → Warning, `info` → Info, anything else → Warning (ported: shown rather than hidden). At most 200 alerts per file; each field cut to 1200 characters; values after `password|passwd|pwd|secret|api key|token|apikey|client secret` followed by `:`, `=` or `|` become `[redacted]` (ported regex). A link written `[[x|y]]` is unwrapped to `x` (ported).
- **One Alert object per `alertKey = "{source}|{key or title}"`**: title = the alert's title (`"(no title)"` when empty); Source; Severity; Message = `"{host}: {detail}"` (or the part that exists); Raised at = `since` when it parses, else the scan instant; Link = the link when it is `http(s)://`, else appended to the Message as `" See: {link}"`; Cleared at empty.
- An existing object whose values differ is updated in **one** `update_properties` write (only the changed keys); a re-raised alert clears Cleared at. A key no longer in its file (the file read fine) gets Cleared at = the scan instant (once). Writes run inside `writeorigin.acting_as(writeorigin.ALERTS)` (`ALERTS = "alerts"`, a new constant in `writeorigin.py`, ours; `writeorigin` is a context variable, not a list of values) and are announced through `announce` as `ChangeEvent("created" | "changed", path, version, origin="alerts")`, plus `ChangeEvent("types", id, revision, origin="alerts")` when the scan makes the type.
- A file whose `(mtime_ns, size, sha256)` equals the state file's entry is skipped (`unchanged`). A file that can't be read or isn't a JSON object becomes a source with `error` `"Can't read {name}: {reason}"` and `stale: true`; its alerts are left as they are.
- The type is ensured only when an alert is about to be created; a folder with no alerts creates nothing.

### Seams for M24 (`backend/objectapp/workseams.py`)

```python
AGENT_LATER = "The agent loop comes with M24."            # ours
CAPTURE_LATER = "Saving a brain dump comes with M24."     # ours
class SeamUnavailable(Exception): detail: str              # routes answer 501 {"detail": detail}
class SeamRefused(Exception): status: int; detail: str     # a filled seam refusing a request (409 or 422):
                                                           # routes answer `status` {"detail": detail}; M24 raises subclasses
class AgentProvider(Protocol):
    def status(self, space: Space, board: list[dict]) -> dict      # AgentStatus
    def set_acts(self, space: Space, on: bool) -> dict             # AgentStatus; SeamRefused -> its status
    def retry(self, space: Space, entry_id: str) -> dict           # AgentStatus; KeyError -> 404; SeamRefused -> its status
class CaptureSink(Protocol):
    def save(self, space: Space, req: CaptureRequestModel, now: datetime) -> dict   # CaptureSummary; InvalidValue -> 422;
                                                                                    # SeamRefused -> its status
    def list(self, space: Space, status: str | None) -> list[dict]                  # CaptureSummary[], newest first
@dataclass(frozen=True)
class WorkSeams: agent: AgentProvider; captures: CaptureSink
class NoAgent:      # status: {"available": False, "agentName": None, "actsOnApprovals": False,
                    #          "carrying": <board items whose turn is "agent">, "rows": [], "note": AGENT_LATER}
                    # set_acts / retry raise SeamUnavailable(AGENT_LATER)
class NoCaptures:   # save raises SeamUnavailable(CAPTURE_LATER); list returns []
def build_seams(space: Space, service: WorkService) -> WorkSeams   # M23: WorkSeams(NoAgent(), NoCaptures()); M24 replaces this body only
```

M24 also plugs in through M22's `workservice.add_work_listener` (queue entries for approvals, answers, Run now, notes and requests). The front end is final in M23: M24 changes no M23 file but `build_seams`' body. Its Captures view registers itself from its own `frontend/src/work/captures/registerView.ts`, which `WorkPage.tsx` loads with `import.meta.glob('../*/registerView.ts', { eager: true })` (any `frontend/src/work/<folder>/registerView.ts` that calls `registerWorkView`; none exists in M23). `useWorkEvents` already reloads the agent status on `workQueue` events, a kind M23 declares for M24 to announce (below).

| Front-end seam (M23, final) | Calls | Effect in M23 | Effect once M24 fills it |
|---|---|---|---|
| Brain-dump bar Enter, the focus session's "Tell the agent what you see", Keep on top's box | `api.workCapture({text, fromView, linkedPath})` | 501: the text stays in the box, the detail shows under it | a Capture object, filed by the agent |
| **Ask the agent** (panel note box) | `api.workNote(path, 'request', text)` (M22) | Activity `… asked the agent to act: …` and a Work notes `request:` line | plus a queue entry (listener) |
| **Ask the agent to break it down** (Make it smaller) | `api.workCapture({text: "Break down {ref} step {n}: {step text}", fromView, linkedPath})` (spec prefix) | 501 toast with the detail | the agent replaces the step |
| **Run now** (Agent step) | `api.workStep(… 'run')` (M22) | the step becomes Approved (queued); whose turn `agent` | plus a queue entry, then a run |
| Agent pill, Agent queue view, Stuck's failed runs, Now's "Agent is carrying" | `api.workAgent()` | `available: false`, `carrying` from the board, no rows, the switch disabled with `note` | live queue rows, the switch |
| "Parked dumps need you" (Now side) | `api.workCaptures('needsYou')` | `[]` (the widget hides) | captures with a question |
| "Agent acts on my approvals" switch, Retry | `api.setAgentActs(on)`, `api.retryAgentEntry(id)` | disabled (501 never sent) | live |

`{ref}` is the ticket id when the item is a ticket, else its title (ported prefix with the item's name).

### Keep-on-top host (`backend/objectapp/windowhost.py`)

```python
KEEP_ON_TOP_LATER = "Keep on top needs the Object window."     # ours
def set_opener(fn: Callable[[str], None] | None) -> None      # __main__ sets it when it runs the pywebview window
def can_open() -> bool
def open_window(url: str) -> None                              # SeamUnavailable(KEEP_ON_TOP_LATER) without an opener
```

`__main__` (pywebview mode) sets `lambda url: webview.create_window("Object focus", url, width=360, height=470, on_top=True)`. The window loads `/?mini=work` (the front end's `WorkMini`). In browser mode the front end uses Document Picture-in-Picture where the browser has it, else the button is hidden ("skip quietly").

### Back-end modules (exact public signatures)

```python
# workboard.py
def board_item(space: Space, item: dict) -> dict          # WorkBoardItem from M22's WorkItem dict
def board(space: Space, service: WorkService, scope: Literal["active", "all"]) -> dict   # WorkBoard; order = service.items(scope)
# workfocus.py
FOCUS = "Focus"; MAX_FOCUS_LINES = 20; MAX_FOCUS_TEXT = 500
FOCUS_CHANGED = "Today's note changed. Look again."        # ours
def parse_focus(body: str) -> list[str]                    # the section's top-level list items' texts, in order
def replace_focus(body: str, lines: list[str]) -> str
def focus_day(space: Space, day: str) -> dict              # FocusDay; reads only
def save_focus(space: Space, day: str, lines: list[str], base_version: str | None) -> dict   # FocusDay; Conflict when stale
# workday.py
MEETING_DEFAULT_MINUTES = 30
def meetings_on(space: Space, day: str) -> list[dict]      # MeetingSlot[], by start
def today(space: Space, day: str | None) -> dict           # WorkToday
# workwins.py
def wins(space: Space, service: WorkService, history: HistoryStore, *, days: int = 14) -> dict   # WorkWins
# history.py (added, read only)
def HistoryStore.key_for(self, md_rel: str, object_id: str | None) -> str
def HistoryStore.changed_keys_by_day(self, lo: datetime, hi: datetime, tz: tzinfo) -> dict[str, set[str]]
# workfloor.py
FLOOR_ID = "floor"
def general_floor(space: Space) -> dict                    # GeneralFloor; missing file -> {"items": [], "revision": ""}
def general_floor_op(space: Space, op: FloorOp, *, item_id: str | None = None, item_rev: str | None = None,
                     place: str | None = None, what: str | None = None, found: str | None = None) -> dict
# api_work_section.py
def router(ctx: ApiContext, service: WorkService, seams: WorkSeams, watch: AlertWatch) -> APIRouter
# worksection_model.py (pydantic request bodies)
class FocusRequest(BaseModel): day: str; lines: list[str]; baseVersion: str | None = None; clientId: str | None = None
class GeneralFloorRequest(BaseModel): op: Literal["add", "edit", "collect", "uncollect", "remove"]; itemId: str | None = None; itemRev: str | None = None; place: str | None = None; what: str | None = None; found: str | None = None; clientId: str | None = None
class CaptureRequestModel(BaseModel): text: str; fromView: str; linkedPath: str | None = None; clientId: str | None = None
class AgentActsRequest(BaseModel): on: bool; clientId: str | None = None
class AgentRetryRequest(BaseModel): id: str; clientId: str | None = None
class ClientOnly(BaseModel): clientId: str | None = None
```

- **Board item** = every `WorkItemSummary` key of the item (`workread.summary`), plus `steps`, `floorItems` and `hypothesis` (from M22's `WorkItem`, `service.item(path)`; the Now card shows the Hypothesis, which the built summary doesn't carry), `typeName`, `isProject` (`typetemplates.template_for(type) == "project"`), `deadline` (the object's `deadline` value as a day when its type has a `deadline` property of a date kind, `datetime` or `datetimeSimple` (the basic Task's is `datetimeSimple`), else null), `blockedOnPeople` (each `[[link]]` in Blocked on resolving, with `space.resolve(link, path)`, to an object whose type's template is `person` or whose type id is `person`: `{path, title}`). No other key of `WorkItem` (fields, verified, assumed, toRaiseConfidence, findings, confidenceReason, activity, work notes, resolution) is sent.
- **Focus section**: the first heading whose text is `Focus` (any level, case-insensitive, outside fenced code; the `apiquery._headings(lines)` scan, which gives `(line index, level, text)` for `body.splitlines(keepends=True)`), up to the next heading of the same or a higher level. Its **top-level list items** are lines `^ {0,3}([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.+)$` (a to-do box is dropped from the text); indented lines under an item belong to it and are dropped on save. `replace_focus` puts `- {line}` lines where the first item was (right after the heading, one blank line between, when there was none) and removes the old items; every other line of the body is kept byte for byte. A body without the section gets `## Focus`, a blank line and the list at its end, after one blank line. Lines: 1-20, each 1-500 characters on one line, whitespace trimmed (422 `"Write at least one line."` (ported), `"A focus line is one line."`, `"At most 20 focus lines."`). A missing note is created with `create_daily_note(day)` (its default template applies) and the section is then written with `save_body` against the created version.
- **Focus line** `label`: the text with each `[[a|b]]` shown as `b` and `[[a]]` as `a`; `links`: each `[[target]]` with its resolved path or null.
- **Meetings**: objects of a type whose template is `meeting` or whose id is `meeting`, with a `date` datetime value that has a time and starts on the local `day` (`space.tz`); `end` = the value's end when it has one, else start + 30 minutes (ours); templates excluded.
- **Wins** over the last `days` local days (today included): `stepsDone` = steps with state `done` whose `doneAt` falls on the day, over `service.items("all")`; `itemsClosed` = done items whose `doneAt` falls on the day; `objectsChanged` = the number of distinct objects with a version-history entry on the day, plus objects whose `lastUpdated` is on the day (keys unified with `HistoryStore.key_for`), templates excluded. `got`: one entry per done step (`text` = `Step {n}: {one_line(step text, 70)}`) and per closed item (`text` = `Closed`), newest first, at most 50.
- **General floor**: M22's floor mapping keys, codec (`workvalues.read_floor_strict`, `floor_api`, `floor_rev`, `encode_floor`, `new_id`), caps (`workmodel.MAX_FLOOR` 50, message `At most 50 floor items.` as `WorkService.floor`), ids, revisions and op rules as `WorkService.floor` applies them (`collect` sets `collected` to today in `space.tz`, `found` optional; `uncollect` clears `collected` (as M22 does); `edit` changes `place`/`what`/`found`; neither place nor what → `workservice.FLOOR_NEEDS`); a stale `itemRev` raises M22's `workservice.FloorItemChanged`. `FloorOp` is `Literal["add", "edit", "collect", "uncollect", "remove"]` (M22 has no named alias; `workfloor.py` defines it).

### Routes (`api_work_section.py`, mounted on `/api`)

| Route | Body / query | Answer | Errors |
|---|---|---|---|
| `GET /work/board` | `scope=active\|all` (default `active`) | `WorkBoard` | |
| `GET /work/focus` | `day` (default today, `space.tz`) | `FocusDay` | 422 bad day |
| `PUT /work/focus` | `FocusRequest` | `FocusDay` | 409 `{currentVersion, detail: FOCUS_CHANGED}`; 422; 423 |
| `GET /work/today` | `day` | `WorkToday` | 422 |
| `GET /work/wins` | `days` (1-31, default 14) | `WorkWins` | 422 |
| `GET /work/alerts` | | `WorkAlerts` | |
| `POST /work/alerts/scan` | `ClientOnly` | `{report: AlertScanReport, alerts: WorkAlerts}` | |
| `POST /work/alert-type` | `ClientOnly` | `{type: TypeDef, created: boolean}` | 423 |
| `GET /work/floor/general` | | `GeneralFloor` | |
| `POST /work/floor/general` | `GeneralFloorRequest` | `GeneralFloor` | 409 `{detail: "This floor item changed. Look again."}`; 422; 423 |
| `GET /work/agent` | | `AgentStatus` | |
| `PUT /work/agent/acts` | `AgentActsRequest` | `AgentStatus` | a `SeamRefused`'s status (409 / 422) `{detail}`; 501 |
| `POST /work/agent/retry` | `AgentRetryRequest` | `AgentStatus` | 404; a `SeamRefused`'s status (409 / 422) `{detail}`; 501 |
| `POST /work/captures` | `CaptureRequestModel` | 201 `{capture: CaptureSummary}` | 422 (`InvalidValue`); a `SeamRefused`'s status `{detail}`; 501 |
| `GET /work/captures` | `status=new\|filed\|needsYou` | `{captures: CaptureSummary[]}` | |
| `GET /work/keep-on-top` | | `{window: boolean}` | |
| `POST /work/keep-on-top` | `ClientOnly` | 204 (the window opened at `{base}/?mini=work`) | 501 |

Events: a Focus save announces `changed` (and `created` when it made the note); a general floor op announces `ChangeEvent("work", "floor", revision, origin)`; `work` and `workQueue` (announced by M24 on every queue change; nothing in M23 announces it) join `watcher.ChangeEvent.kind`, `server.RESYNC_EVENTS` (a tuple of `ChangeEvent(kind, "*", None)`: two more entries) and the client's `ChangeKind` and `RESYNC_EVENTS` (`api/client.ts`); "Add the Alert type" announces `("types", id, revision, origin)`; the folder watch's writes are announced by the watch (`announce`, above). `server.py` builds one `AlertWatch` per app (folder and intervals from `read_settings()[0]`, the server's import of `settings.read`, which returns `(merged, revision)`; `announce=announce`), starts it in the lifespan beside `automations.start()` and stops it in both of the lifespan's `finally` branches beside `automations.stop`, and mounts the router with `build_seams(space, work)` right after M22's `api_work`/`api_v1_work` routers (the app's `WorkService` is the local `work`). `server._UI_PATCH_KEYS` is unchanged (the Work page writes no `ui.json`).

### API types (`frontend/src/api/types.ts`)

```ts
export type WorkViewId = 'now' | 'flow' | 'projects' | 'today' | 'floor' | 'queues' | 'agent' | 'stuck' | 'wins'
  | 'alerts' | 'everything' | 'tickets' | (string & {})          // M24 adds 'captures'
export type Energy = 'low' | 'medium' | 'high'
export interface PersonRef { path: string; title: string }
export interface WorkBoardItem extends WorkItemSummary {
  typeName: string; isProject: boolean
  steps: WorkStep[]; floorItems: FloorItemValue[]; hypothesis: string | null
  deadline: string | null                 // YYYY-MM-DD
  blockedOnPeople: PersonRef[]
}
export interface WorkBoard { items: WorkBoardItem[]; now: string; today: string; timeZone: string }
export interface FocusLine { n: number; text: string; label: string; links: { target: string; path: string | null }[] }
export interface FocusDay { day: string; notePath: string | null; version: string | null; hasSection: boolean; lines: FocusLine[] }
export interface MeetingSlot { path: string; title: string; start: string; end: string; startLocal: string; endLocal: string }  // "HH:MM"
export interface WorkToday { day: string; now: string; nowLocal: string; meetings: MeetingSlot[] }
export interface WinDay { day: string; stepsDone: number; itemsClosed: number; objectsChanged: number }
export interface WinEntry { at: string; kind: 'step' | 'closed'; path: string; title: string; text: string }
export interface WorkWins { days: WinDay[] /* oldest first */; stepsDone: number; itemsClosed: number; objectsChanged: number; got: WinEntry[] }
export type AlertSeverity = 'Critical' | 'Warning' | 'Info'
export interface AlertRow { path: string; title: string; source: string | null; severity: AlertSeverity; message: string | null
  raisedAt: string | null; clearedAt: string | null; link: string | null; active: boolean }
export interface AlertSourceStatus { source: string; file: string; generated: string | null; ok: boolean; error: string | null
  stale: boolean; staleAfterMinutes: number }
export interface WorkAlerts { alerts: AlertRow[]  /* active first; Critical, Warning, Info; newest raised first */
  sources: AlertSourceStatus[]; counts: Record<AlertSeverity, number> /* active only */; folder: string | null; typeExists: boolean }
export interface AlertScanReport { files: number; created: number; updated: number; cleared: number; unchanged: number; errors: string[] }
export type AgentQueueState = 'pending' | 'running' | 'done' | 'failed' | 'withdrawn'
export interface AgentQueueRow { id: string; path: string; title: string; stepId: string | null; n: number | null
  stepText: string | null; reason: string /* M24's: what queued it */; state: AgentQueueState; notBefore: string | null
  createdAt: string; claimedAt: string | null; finishedAt: string | null; result: string | null; error: string | null }
export interface AgentStatus { available: boolean; agentName: string | null; actsOnApprovals: boolean; carrying: number
  rows: AgentQueueRow[]; note: string | null }
export type CaptureFrom = WorkViewId | 'focusSession' | 'keepOnTop' | 'panel'
export interface CaptureRequest { text: string; fromView: CaptureFrom; linkedPath?: string | null }
export interface CaptureSummary { path: string; text: string; status: 'new' | 'filed' | 'needsYou'; question: string | null
  capturedAt: string; linkedPath: string | null }
export interface GeneralFloor { items: FloorItemValue[]; revision: string }
```

`ChangeKind` gains `'work'` and `'workQueue'`; `DeviceSettings` gains `workAlertFolder: string | null` and `workAlertIntervals: Record<string, number>` (and `settings/defaults.ts`' `settingsDefaults` gains `workAlertFolder: null, workAlertIntervals: {}`, which `mockApi.deviceSettings()` spreads).

### Client (`frontend/src/api/client.ts`)

`api.workBoard(scope?)`, `api.workFocus(day?)`, `api.saveWorkFocus(day, lines, baseVersion)`, `api.workToday(day?)`, `api.workWins(days?)`, `api.workAlerts()`, `api.scanAlerts()`, `api.ensureAlertType()`, `api.generalFloor()`, `api.generalFloorOp(req)`, `api.workAgent()`, `api.setAgentActs(on)`, `api.retryAgentEntry(id)`, `api.workCapture(req)`, `api.workCaptures(status?)`, `api.keepOnTopInfo()`, `api.openKeepOnTop()`. A 501 throws `UnavailableError extends Error` (`message` = the detail); the focus 409 throws `ConflictError` (its constructor takes only `currentVersion`; its `message` is `conflict`, so the UI shows `FOCUS_CHANGED`'s text from `WORK_TEXT`); the general floor 409 throws M22's `StepChangedError` (through the same `stepChanged` handler `api.workFloor` uses). Every write emits its own event locally (as `saveBody`), so this window's views refresh. Test helpers in `test/mockApi.ts`: `workBoardItem(over?)`, `workBoard(items)`, `focusDay(lines)`, `agentStatus(over?)`, `workAlerts(over?)`.

### Navigation (`frontend/src/nav/tabs.ts`)

`Target` gains `{ kind: 'work'; view?: WorkViewId }` (tab title "Work"), and the object target gains an optional flag: `{ kind: 'object'; path: string; work?: true }`. `work: true` in the side panel is the **item panel** (the object page with the work header). `sameTarget` compares `work` too (and `view` for a work target); `retarget` keeps it (both the tabs store's `retarget` in `nav/tabs.ts` and `retargetEntries` in `nav/sidepanel.ts` rebuild `{kind: 'object', path}` today, so both must carry `work` over). Adding the `work` kind makes the exhaustive switches in `nav/tabs.ts` (`sameTarget`) and `shell/TabStrip.tsx` (`useTargetTitle`) fail to type-check, so T1 adds the target types with those two cases and `App.tsx`'s `pageFor` case `'work'` (rendering the stub `WorkPage`); T17 does the rest.

### Front-end modules (exact exports; under `frontend/src/work/`)

```ts
// workText.ts: WORK_TEXT (every string below; spec labels verbatim, the rest ours). M22's
//   settings/sections/Work.tsx already exports its own `WORK_TEXT` (the settings section's strings):
//   a file that needs both imports this one under another name.
// workIcons.ts: WORK_ICONS: open 'ph-circle', doing 'ph-circle-half', done 'ph-check-circle', parked 'ph-circle-dashed',
//   you 'ph-user', agent 'ph-robot', approval 'ph-shield-check', work 'ph-briefcase', capture 'ph-lightbulb',
//   low 'ph-battery-low', medium 'ph-lightning', high 'ph-flame', focus 'ph-target', meeting 'ph-users-three',
//   deadline 'ph-hourglass', alert 'ph-warning', win 'ph-trophy', floor 'ph-map-pin', print 'ph-printer',
//   timer 'ph-timer', pin 'ph-push-pin', smaller 'ph-stairs', ticket 'ph-ticket', flow 'ph-columns',
//   map 'ph-path', today 'ph-clock', queues 'ph-tray', stuck 'ph-traffic-cone', everything 'ph-stack'
// logic/ (pure, T7)
export const PRIORITY_WEIGHT: Record<'Critical' | 'High' | 'Medium' | 'Low', number>   // 100, 60, 30, 10
export const NO_PRIORITY_WEIGHT = 20                                                     // ported
export const STALE_DAYS = 7
export const STEP_ENERGY: Record<StepKind, Energy | null>   // question low, approve low, do high, agent null
export const STEP_MINUTES: Record<StepKind, number>         // 5, 2, 30, 0
export function effectivePriority(i: WorkBoardItem): 'Critical' | 'High' | 'Medium' | 'Low' | null
export function quietDays(i: WorkBoardItem, now: Date): number
export function isStale(i: WorkBoardItem, now: Date): boolean
export function score(i: WorkBoardItem, now: Date): number
export function isYours(i: WorkBoardItem): boolean
export function energyMatches(i: WorkBoardItem, energy: Energy | null): boolean
export interface FocusFilter { n: number; paths: ReadonlySet<string> }
export function nowPool(items: WorkBoardItem[], o: { now: Date; energy: Energy | null; notNow: ReadonlySet<string>; focus: FocusFilter | null }): WorkBoardItem[]
export function upNext(pool: WorkBoardItem[]): { shown: WorkBoardItem[]; hidden: number }
export function linkedPaths(line: FocusLine, items: WorkBoardItem[]): Set<string>
export function isCleared(line: FocusLine, items: WorkBoardItem[]): boolean
export function focusProgress(line: FocusLine, items: WorkBoardItem[]): { done: number; total: number }
export function currentLine(lines: FocusLine[], items: WorkBoardItem[], top: WorkBoardItem | null): number | null
export type Lane = 'you' | 'agent' | 'others'
export const FLOW_COLUMNS: Stage[]; export const DOING_LIMIT = 3
export function laneOf(i: WorkBoardItem): Lane
export function flowBoard(items: WorkBoardItem[], area: string | null): { cells: Record<Lane, Record<Stage, WorkBoardItem[]>>; youDoing: number; overloaded: boolean; areas: string[] }
export type StationState = 'done' | 'doing' | 'waiting' | 'notStarted'
export interface Station { key: string; label: string; state: StationState; path: string; stepId: string | null }
export interface MapLine { key: string; title: string; projectPath: string | null; stations: Station[]; percentDone: number; nextForYou: { path: string; text: string } | null }
export function projectLines(items: WorkBoardItem[]): MapLine[]
export interface DayBlock { start: number; end: number /* minutes after midnight */; kind: 'brief' | 'meeting' | 'focus' | 'wrapUp'; label: string; path: string | null }
export function dayBlocks(meetings: MeetingSlot[], focus: FocusLine[], nowMinutes: number): DayBlock[]
export function deadlines(items: WorkBoardItem[], today: string): { path: string; title: string; deadline: string; daysLeft: number }[]
export type QueueKey = 'answer' | 'do' | 'approve' | 'agent'
export function queues(items: WorkBoardItem[], now: Date): Record<QueueKey, WorkBoardItem[]>
export function stuck(items: WorkBoardItem[], now: Date): { blocked: WorkBoardItem[]; waitingOn: WorkBoardItem[] }
export interface FloorRow { key: string; place: string; what: string; found: string | null; collected: string | null; item: FloorItemValue; owner: WorkBoardItem | null }
export function floorGroups(items: WorkBoardItem[], general: FloorItemValue[]): { open: { place: string; rows: FloorRow[] }[]; collected: FloorRow[] }
export type EverythingKey = 'type' | 'ticketId' | 'title' | 'area' | 'stage' | 'turn' | 'priority' | 'quietDays' | 'score'
export function everythingRows(items: WorkBoardItem[], now: Date, sort: { key: EverythingKey; dir: 1 | -1 }): WorkBoardItem[]
export function splitStep(text: string): string[]
export function itemRef(i: { ticket: TicketInfo | null; title: string }): string           // ticket id, else title
// state/ (T8)
export const useWorkData: UseBoundStore<StoreApi<WorkDataState>>
//   {board, all, focus, today, alerts, agent, needsYou, wins, general, error, hidden: ReadonlySet<string>,
//    load(parts?: WorkPart[]): Promise<void>, hide(key: string), unhide(key: string)}; WorkPart = 'board' | 'all' | 'focus' | 'today' | 'alerts' | 'agent' | 'needsYou' | 'wins' | 'general'
export function useWorkEvents(): void            // while mounted: reloads on change events, debounced 300 ms
export const useWorkUi                           // persisted per space: {energy, calm, view, focusLine: {day, n} | null, notNow: {day, paths}, flowArea, everythingSort} + setters
export const useWorkSelection                    // {list: string[], index: number, setList(paths), move(delta), selected(): string | null}
export const useWorkOverlay                      // {session: {path} | null, smaller: {path, stepId} | null, openSession(path), openSmaller(path, stepId), close()}
export type WorkRunner = (call: (path: string) => Promise<WorkWriteResult>) => Promise<WorkWriteResult | null>
//   (M22's `ObjectWrites.work` takes `run: (path, baseVersion) => Promise<WorkWriteResult>`; a step,
//    steps, note or floor call ignores `baseVersion`, so a header runner is `(call) => work((p) => call(p))`)
export function directRunner(path: string): WorkRunner
export function stepAction(o: { item: { path: string }; step: WorkStep; action: StepAction; text?: string; notBefore?: string; run?: WorkRunner }): Promise<boolean>
export function openItemPanel(path: string): void   // openInSidepanel({kind: 'object', path, work: true})
export const UNDO_MS = 5000; export const APPROVE_ARM_MS = 4000
export function workToast(text: string): void; export function undoToast(text: string, undo: () => Promise<unknown>): void
export function WorkToasts(): JSX.Element          // mounted once by App
// components (T8)
export function StepActions(p: { item: { path: string; title: string; ticket: TicketInfo | null }; step: WorkStep; run?: WorkRunner; compact?: boolean }): JSX.Element | null
export function Chip(p: { tone: 'you' | 'agent' | 'others' | 'approve' | 'critical' | 'high' | 'ok' | 'capture' | 'muted'; icon?: string; children: ReactNode }): JSX.Element
export function StatusIcon(p: { state: StationState | 'you' | 'agent' | 'approval' }): JSX.Element
export function ItemChips(p: { item: WorkBoardItem | WorkItem }): JSX.Element     // type, area, priority, ticket id
// page (T9)
export function WorkPage(p: { view?: WorkViewId }): JSX.Element
export interface WorkViewProps { data: WorkDataState; now: Date }
export interface WorkViewDef { id: WorkViewId; label: string; icon: string; key: string | null; count(data: WorkDataState, now: Date): number; Component: ComponentType<WorkViewProps> }
export const WORK_VIEWS: WorkViewDef[]; export function registerWorkView(def: WorkViewDef): void; export function workViews(): WorkViewDef[]
export function focusBrainDump(): void              // `B`
export function focusWorkSearch(): void             // `/`
// views (T10-T13): NowView, FlowView, ProjectsMapView, TodayView, FloorView, QueuesView, AgentQueueView, StuckView,
//   WinsView, AlertsView, EverythingView, TicketsView — each (p: WorkViewProps) => JSX.Element, file views/<Name>.tsx
// panel (T14)
export function WorkHeader(p: { path: string; work: ObjectWrites['work'] }): JSX.Element | null
// session (T15)
export function WorkOverlays(): JSX.Element          // the focus session and Make it smaller, from useWorkOverlay; mounted once by App
export function KeepOnTopButton(): JSX.Element | null
export function WorkMini(): JSX.Element              // the keep-on-top page (`/?mini=work`)
// keys (T16)
export function useWorkKeys(): void                  // mounted by WorkPage
export const WORK_SHORTCUTS: ShortcutDef[]
```

`ObjectPage` (`object/ObjectPage.tsx`, today `({ path })`) gains `workHeader?: boolean` and passes it to `ObjectView` (`ObjectViewProps.workHeader?: boolean`), which renders `<WorkHeader path work={writes.work} />` above the title when set and the object is a work item, and then leaves out M22's under-panel `ResolutionNoteSection` (the `isTicket` mount under the property panel; the header carries the note). `App.tsx`'s `pageFor` renders `ObjectPage` for both the main panel and side-panel entries, so passing `workHeader={target.work}` there covers the item panel.

### Theme tokens (`theme/tokens.css`, T17)

Defined once on `:root` as references to Object's label tokens, which every theme (dark, light, lightDimmed, darkDimmed) already redefines, so all four themes follow (our mapping of the dashboard's palette: accent `#7b8cff` → indigo, agent teal `#2cc7b0` → teal, ok `#34c37a` → green, warn `#f5b041` → amber, critical `#ef5a5f` → red, capture `#e0479e` → pink):

| Token | Value |
|---|---|
| `--work-you`, `--work-you-bg` | `var(--label-text-indigo)`, `var(--label-bg-indigo)` |
| `--work-agent`, `--work-agent-bg` | `var(--label-text-teal)`, `var(--label-bg-teal)` |
| `--work-others`, `--work-others-bg` | `var(--label-text-gray)`, `var(--label-bg-gray)` |
| `--work-approve`, `--work-high` | `var(--label-text-amber)` |
| `--work-critical` | `var(--label-text-red)` |
| `--work-ok` | `var(--label-text-green)` |
| `--work-capture`, `--work-capture-bg` | `var(--label-text-pink)`, `var(--label-bg-pink)` |

Components use these through Tailwind arbitrary values (`text-[var(--work-agent)]`); chips are a dot plus text in the tone's colour on the tone's `-bg` at most, never a filled badge.

## Tasks

Each task: write the failing test, run it and see it fail, implement, run it and see it pass, commit. Each task runs only its own tests and those of modules it touched (`uv run pytest backend/tests/test_m23_<x>.py -q`, `npx vitest run <files>`); T18 runs M23's set and the track's full gate runs the full suites. Back-end tests use a copy of the fixture space (`m23_helpers.copy_space(tmp_path)`), `OBJECT_STATE_DIR` and `OBJECT_CLOCK_FILE` (2026-11-05T10:00:00Z) in `tmp_path`, and the space time zone UTC. Commit messages end with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Task 1: Contract, stubs and fixtures

**Files**
- Create: `backend/objectapp/worksection_model.py`, `backend/objectapp/workseams.py` (final: it is small), `backend/objectapp/windowhost.py` (final), stubs `backend/objectapp/api_work_section.py` (`router(...)` with no routes) and `backend/objectapp/alertwatch.py` (`AlertWatch` whose `start`/`stop` do nothing, `scan_once` returns an empty report, `sources()` returns `[]`), `backend/tests/m23_helpers.py`, `backend/tests/fixtures/space-work-m23/` (overlay, below), `backend/tests/fixtures/monitoring/` (below), `backend/tests/test_m23_contract.py`, `frontend/src/work/workText.ts`, `frontend/src/work/workIcons.ts`, `frontend/src/work/__fixtures__/board.json`, `frontend/src/work/section.contract.test.ts`, stub components (each renders its name as text and has the Contract signature): `frontend/src/work/page/WorkPage.tsx`, `frontend/src/work/views/{Now,Flow,ProjectsMap,Today,Floor,Queues,AgentQueue,Stuck,Wins,Alerts,Everything,Tickets}View.tsx`, `frontend/src/work/panel/WorkHeader.tsx`, `frontend/src/work/session/{WorkOverlays,KeepOnTopButton,WorkMini}.tsx`, `frontend/src/work/state/WorkToasts.tsx`, `frontend/src/work/keys/useWorkKeys.ts` (a no-op hook)
- Modify: `backend/objectapp/server.py` (build one `AlertWatch` from `read_settings()[0]` with `announce=announce`, start it beside `automations.start()` and stop it in both lifespan `finally` branches beside `automations.stop`; mount `api_work_section.router(ctx, work, build_seams(space, work), watch)` right after M22's `api_work`/`api_v1_work` routers; `ChangeEvent("work", "*", None)` and `ChangeEvent("workQueue", "*", None)` in `RESYNC_EVENTS`; route docstring lines), `backend/objectapp/watcher.py` (`"work"` and `"workQueue"` in `ChangeEvent.kind`), `backend/objectapp/settings.py` (`workAlertFolder` default None: null or an absolute path of at most 500 characters, else `SettingsProblem("workAlertFolder", "Pick a folder (a full path).")`; `workAlertIntervals` default `{}`: at most 50 entries, keys 1-100 characters, whole minutes 1-10080, else `"Intervals are whole minutes from 1 to 10080."`. The built `SettingsProblem(key)` takes only the key and its `message` is `Cannot patch: {key}`, which `PUT /api/settings` answers as the 422 detail; it gains an optional second argument `message` (default unchanged), and `patch` raises the two keys' own messages), `backend/tests/test_settings.py` (`CONTRACT_DEFAULTS` gains the two keys; its `test_defaults` compares `settings.DEFAULTS` whole), `backend/objectapp/writeorigin.py` (`ALERTS = "alerts"`, used with `acting_as`), `frontend/src/api/types.ts`, `frontend/src/api/client.ts` (the calls, `UnavailableError`, local announcement, `'work'`/`'workQueue'` in `RESYNC_EVENTS`), `frontend/src/settings/defaults.ts` (`workAlertFolder: null`, `workAlertIntervals: {}`), `frontend/src/test/mockApi.ts` (helpers), `frontend/src/nav/tabs.ts` (the `Target` variants of "Navigation" and their `sameTarget` cases only), `frontend/src/shell/TabStrip.tsx` (`useTargetTitle`'s `case 'work'` → `'Work'` only), `frontend/src/App.tsx` (`pageFor`'s `case 'work'` → `<WorkPage view={target.view} />` only), `frontend/src/icons/appIcons.ts` (regenerated with `node scripts/app-icons.mjs`)

**Interfaces**
- Produces: every type, call, model, seam class, constant and stub signature in the Contract; `m23_helpers.copy_space(tmp: Path) -> Path` (copies `space-work`, then `space-work-m23` over it), `m23_helpers.monitoring(tmp: Path) -> Path` (a copy of `fixtures/monitoring`), `m23_helpers.service(space: Space) -> WorkService` (`WorkService(space, jira_site=lambda: None, user_name=lambda: "Gene")`, the built constructor), `m23_helpers.add_project_work_fields(space: Space) -> None` (what `POST /api/types/project/work-fields` does: `t, rev = space.refresh_type("project")`, `new, _added, _skipped = workfields.with_work_fields(t, space.types)`, `space.save_type(new, rev)`).
- `test_m23_contract.py` checks signatures, constants, models, the seams and the fixtures only, never a stub's empty behaviour (M22's `test_stub_routers` called its stub routers with `None` and broke once they were filled; check `inspect.signature` instead).

**Fixture overlay** `backend/tests/fixtures/space-work-m23/` (synthetic; added on top of M22's `space-work`, whose own tests stay as they are):
- `.object/types/meeting.json` and `.object/types/person.json`: the basic-setup Meeting and Person types (`basicsetup.basic_types()`, written as `write_basic_types` does). `.object/types/dailynote.json`: the DailyNote type as `space-m8` has it. Without a stored file an inferred type is written the first time an object of it is created (`Space._persist_type`; `create_daily_note` calls it), so a focus save for a new day would add `dailynote.json` to the changed files.
- `DailyNotes/2026-11-05.md` (CRLF, UTF-8 BOM, `type: DailyNote`, `date: 2026-11-05`): a `## Plan` paragraph, then `## Focus` with a prose line `Keep it to three.` and the items `- Clear the jams on [[Printer jams on line 3]]`, `- [ ] Finish [[Scanner rollout]]`, `- Plan next week`, then `## Notes` with one line.
- `Meetings/Line 3 standup.md`: Meeting, `date` 2026-11-05T09:00:00.000Z with end 09:30. `Meetings/Vendor call.md`: 2026-11-05T13:00:00.000Z, no end. `Meetings/Tomorrow sync.md`: 2026-11-06T09:00:00.000Z.
- `People/Pat Example.md`: Person.
- `Tasks/Waiting on Pat.md`: Task In Progress, `blockedOn: "[[Pat Example]] to send the badge list"`, `lastUpdated: 2026-10-25T09:00:00.000Z`, one open Do step `Collect the badge list`, `deadline: 2026-11-12`, one Activity line dated 2026-10-25.
- `Tasks/Scanner firmware.md`: Task In Progress, `lastUpdated: 2026-11-03T09:00:00.000Z` (so Printer jams on line 3 stays Now's top pick), `project: "[[Scanner rollout]]"`, `area: Scanners`, Rank 2, one done Do step `Flash the floor units` (doneAt 2026-11-03T08:30:00.000Z) and one open Question `Which firmware build is on the floor units?`.

**Monitoring fixtures** `backend/tests/fixtures/monitoring/`: `printer-watch.json` (`ok: true`, generated 2026-11-05T09:50:00Z, `intervalMinutes: 15`; alerts `tray-2` crit "Tray 2 jammed", host `PRN-TEST-01`, since 09:40Z, link `https://example.org/prn`; `toner` warn "Toner low", detail `token: abc123 seen`, link `[[Order toner]]`), `backup-check.json` (`ok: false`, `error: "share unreachable"`, generated 2026-11-01T06:00:00Z, no alerts: stale), `broken.json` (`{not json`), `history.jsonl` (ignored).

**Front-end fixture** `frontend/src/work/__fixtures__/board.json`: a `WorkBoard` mirroring the overlay space at 2026-11-05T10:00Z (every item's turn, stage, steps with ids and revs, floor items, deadline, blockedOnPeople), written by hand from the Contract's shapes and the M22 fixture.

**Steps**
1. Failing tests:
   - `test_m23_contract.py::test_models_and_constants` (`AGENT_LATER == "The agent loop comes with M24."`, `CAPTURE_LATER`, `KEEP_ON_TOP_LATER`; the request models parse the Contract's bodies; `GeneralFloorRequest(op="burn")` fails), `::test_seam_defaults` (`NoAgent().status(space, [{"turn": "agent"}, {"turn": "you"}])["carrying"] == 1` and `available` False; `NoCaptures().save(...)` raises `SeamUnavailable` with `CAPTURE_LATER`; `windowhost.open_window("x")` without an opener raises it with `KEEP_ON_TOP_LATER`, with one calls it; `SeamRefused(409, "x")` keeps `status` and `detail`; `ChangeEvent("workQueue", "x", None)` constructs and `{"work", "workQueue"} <= {e.kind for e in server.RESYNC_EVENTS}`), `::test_settings_keys` (a relative `workAlertFolder` and `{"printer-watch": 0}` give their messages; defaults null and `{}`), `::test_fixtures_are_synthetic` (no fixture names a real host, person or job; the daily note starts with the BOM and has `\r\n`).
   - `section.contract.test.ts`: every `WORK_ICONS` id exists in the full Phosphor set and in `appIcons`; `WORK_TEXT.approveArmed === 'Press again to approve'`, `WORK_TEXT.focusCleared(2) === 'Focus 2 cleared'`, `WORK_TEXT.agentPill(3, 1) === 'Agent is carrying 3 · 1 alerts'`; `api.workCapture` posts to `/api/work/captures` and a 501 rejects with `UnavailableError` whose `message` is the detail; `api.saveWorkFocus`'s 409 rejects with `ConflictError`; `board.json` type-checks as `WorkBoard` (`satisfies`).
2. Run: `uv run pytest backend/tests/test_m23_contract.py -q`; `npx vitest run src/work/section.contract.test.ts`; `npx tsc -b --noEmit`. They fail.
3. Implement the contract files, stubs and fixtures; regenerate `appIcons.ts`.
4. Run again: pass; `tsc` clean; `uv run pytest backend/tests/test_m22_api.py backend/tests/test_settings.py -q` (server and settings touched) passes; `npx vitest run src/nav src/icons src/work/contract.test.ts` (tabs, the icon subset, M22's contract test reading `settingsDefaults`) passes.
5. Commit: `feat(m23): Work section contract, seams, stubs and fixtures`.

### Task 2: The board and the general floor list

**Files**
- Create: `backend/objectapp/workboard.py`, `backend/objectapp/workfloor.py`, `backend/tests/test_m23_board.py`

**Interfaces**
- Consumes: M22's `WorkService.items`/`item`, `workvalues.read_floor_strict`/`floor_api`/`floor_rev`/`encode_floor`/`new_id`, `workservice.FloorItemChanged` and `FLOOR_NEEDS`, `workmodel.MAX_FLOOR` and `FloorItem`, `workbody.floor_label` (none needed for the general list, which has no Activity); `space.resolve`, `space.get`, `space.type_by_id`, `space.store("work")` (a `JsonStore`: `read(id) -> (data | None, revision)`, `write(id, data, base_revision) -> revision`), `typetemplates.template_for`; `m23_helpers.service`/`add_project_work_fields` in the tests.
- Produces: `board_item`, `board`, `general_floor`, `general_floor_op` (Contract).

**Steps**
1. Failing tests in `test_m23_board.py`:
   - `test_board_items_and_extras`: `board(space, service, "active")["items"]` has the paths of `service.items("active")` in the same order; Waiting on Pat has `deadline == "2026-11-12"` and `blockedOnPeople == [{"path": "People/Pat Example.md", "title": "Pat Example"}]`; after Add work fields on Project, Scanner firmware has `projectPath == "Projects/Scanner rollout.md"` and two `steps`, Scanner rollout `isProject` True; every item has `typeName` and `floorItems`; no item has `fields`, `activity`, `workNotes` or `resolution`.
   - `test_board_all_scope`: `"all"` adds Old cleanup.
   - `test_board_reads_write_nothing`: file bytes, the `.object` listing and the state dir listing are unchanged after both scopes.
   - `test_general_floor_ops`: a missing file gives `{"items": [], "revision": ""}` and writes nothing; `add` (place "Line 3", what "Photo of the panel") writes `.object/work/floor.json` with one item and a 6-character id; `collect` with found "E-12" sets `collected: "2026-11-05"` and `found: "E-12"`; `uncollect` clears `collected` (M22's rule keeps `found`); `remove` empties the list; a stale `itemRev` raises `FloorItemChanged`; no place and no what raises M22's message; the 51st item raises the cap.
2. Run: `uv run pytest backend/tests/test_m23_board.py -q`. Fails.
3. Implement.
4. Run: pass.
5. Commit: `feat(m23): work board read and the general floor list`.

### Task 3: Focus lines and today's meetings

**Files**
- Create: `backend/objectapp/workfocus.py`, `backend/objectapp/workday.py`, `backend/tests/test_m23_focus.py`

**Interfaces**
- Consumes: `apiquery._headings` (import, don't copy), `space.daily_notes`, `create_daily_note`, `save_body`, `read`, `resolve`, `space.tz`, `space.clock`, `localtime.to_local`, `dailynotes.parse_day`.
- Produces: the Contract's `workfocus` and `workday` functions.

**Steps**
1. Failing tests in `test_m23_focus.py`:
   - `test_parse_focus_items`: the fixture note gives `["Clear the jams on [[Printer jams on line 3]]", "Finish [[Scanner rollout]]", "Plan next week"]` (the to-do box dropped, the prose line not an item); a `## Focus` inside a fenced block is ignored; `### focus` matches; a nested item belongs to its parent.
   - `test_focus_day_links`: `focus_day(space, "2026-11-05")` has lines `n` 1-3, `label == "Clear the jams on Printer jams on line 3"`, `links[0]["path"] == "Tasks/Printer jams on line 3.md"`; an unresolvable link has `path` None.
   - `test_reading_never_creates_a_note` (Review Focus 4): `focus_day(space, "2026-11-06")` is `{notePath: None, version: None, hasSection: False, lines: []}` (plus `day`) and no file or folder appears.
   - `test_save_changes_only_focus_list_lines` (Review Focus 4): saving `["Clear the jams", "Ship the scanner"]` with the note's version turns the three item lines into two `- ` lines; `## Plan`, `Keep it to three.`, `## Notes`, the front matter (but `lastUpdated`), CRLF and BOM are byte-identical; one history snapshot; a stale version raises `Conflict`; `[]` gives `"Write at least one line."`, a two-line text `"A focus line is one line."`, 21 lines `"At most 20 focus lines."`.
   - `test_save_creates_the_note_and_section`: saving for 2026-11-06 creates `DailyNotes/2026-11-06.md` whose body ends with `## Focus\n\n- …\n`; a note without the section gets it at the end after one blank line.
   - `test_meetings_on_today`: `meetings_on(space, "2026-11-05")` is Line 3 standup 09:00-09:30 then Vendor call 13:00-13:30 (`startLocal`/`endLocal`), not Tomorrow sync; a template Meeting is left out; `today(space, None)` has `day == "2026-11-05"` and `nowLocal == "10:00"`.
2. Run: `uv run pytest backend/tests/test_m23_focus.py -q`. Fails.
3. Implement.
4. Run: pass.
5. Commit: `feat(m23): focus lines in the daily note and today's meetings`.

### Task 4: Wins from Object's own history

**Files**
- Create: `backend/objectapp/workwins.py`, `backend/tests/test_m23_wins.py`
- Modify: `backend/objectapp/history.py` (`key_for`, `changed_keys_by_day`: read only, create no folder)

**Interfaces**
- Consumes: `HistoryStore._keys_for`, `_load_index`, `dir` (the space's history folder under the state dir; not created on access), the module's `_parse_iso` (index entries carry `"at"`), `HistoryStore(space.root)` as `api_history.py` builds it, `snapshot(rel, data, now, force=True)` in the tests, `WorkService.items("all")`/`item`, `localtime.to_local`, `workbody.one_line(text, limit)`, `m23_helpers.service`.
- Produces: `wins(...)`, `HistoryStore.key_for`, `HistoryStore.changed_keys_by_day` (Contract).

**Steps**
1. Failing tests in `test_m23_wins.py`:
   - `test_changed_keys_by_day`: three snapshots of one object on 2026-11-04 and one of another on 2026-11-05 (`snapshot(..., force=True)` at given instants) give `{"2026-11-04": {k1}, "2026-11-05": {k2}}`; an empty state dir gives `{}` and creates no folder; an index that isn't JSON is skipped.
   - `test_wins_counts`: `wins(space, service, history, days=14)["days"]` has 14 entries, oldest first, the last `2026-11-05`; Scanner firmware's done step counts on 2026-11-03; Last week fix counts in `itemsClosed` on 2026-10-30; an object with a history entry and a `lastUpdated` on the same day counts once in `objectsChanged`; `got` is newest first and its step entry reads `Step 1: Flash the floor units` (the fixture's step text).
   - `test_wins_reads_write_nothing`.
2. Run: `uv run pytest backend/tests/test_m23_wins.py backend/tests/test_history.py -q`. Fails.
3. Implement.
4. Run: pass.
5. Commit: `feat(m23): wins from steps, closed items and version history`.

### Task 5: The Alert type and the folder watch

**Files**
- Create: `backend/objectapp/alerttype.py`, `backend/tests/test_m23_alerts.py`
- Fill: `backend/objectapp/alertwatch.py` (T1's stub)

**Interfaces**
- Consumes: `Space.create_type(name, plural_name, icon, color)`, `refresh_type`, `save_type(t, base_revision)`, `create_object(type_id, title, values=…)`, `update_properties(path, updates, base_version)`, `type_by_id`, `list(type_id)`, `writeorigin.acting_as` and `ALERTS` (T1), `workfields.FieldSpec` (`key, name, kind, options, visibility`), `reminders.space_key`, `appstate.state_dir`, `textfile.atomic_write`, `jsonstore.dump_json`, `watcher.ChangeEvent` (for `announce`).
- Produces: the Contract's `alerttype` and `alertwatch` APIs; `alertwatch.alerts_view(space, watch) -> dict` (`WorkAlerts`, used by T6's routes; reads only).

**Steps**
1. Failing tests in `test_m23_alerts.py` (`watch = AlertWatch(space, folder=lambda: mon, intervals=lambda: {}, announce=events.append)`, no thread):
   - `test_scan_announces`: the first scan announces `types` once and `created` for each new Alert object with origin `alerts`; a scan that changes nothing announces nothing.
   - `test_ensure_alert_type`: the first call creates the type (`.object/types/<id>.json` with the seven fields in order, `alertKey` hidden, Severity options Critical/Warning/Info) and returns `created` True; a second call returns the same type, `created` False, and writes nothing; `is_alert_type` is False for Task.
   - `test_scan_creates_alerts`: `scan_once()` reports `files == 3` (`*.json` only), `created == 2`, `errors == ["Can't read broken.json: …"]`; the Tray 2 object has title "Tray 2 jammed", Severity Critical, Message `PRN-TEST-01: …`, Raised at 2026-11-05T09:40Z, Link `https://example.org/prn`, `alertKey == "printer-watch|tray-2"`; the Toner object's Message contains `token: [redacted]` and ends `See: Order toner`, Severity Warning.
   - `test_rescan_and_restart_write_nothing` (Review Focus 5): a second `scan_once()` reports `unchanged == 3`, `created == updated == 0`, and no file changes (bytes, history, `lastUpdated`); a new `AlertWatch` on the same state dir does the same; touching `printer-watch.json` without changing its alerts updates nothing.
   - `test_cleared_and_reraised`: removing `toner` from the file sets its Cleared at to the scan instant (one write, `cleared == 1`); a rescan writes nothing; putting it back clears Cleared at (`updated == 1`); an alert whose severity changes updates only `severity` and `lastUpdated`.
   - `test_unreadable_file_keeps_its_alerts` (Review Focus 5): after a good scan, `printer-watch.json` turns into invalid JSON: its source shows the error and `stale: true`, and both its Alert objects stay as they were (no Cleared at).
   - `test_stale_sources`: at 2026-11-05T10:00Z `printer-watch` (15-minute interval, generated 09:50) is fresh; at 10:31 it is stale (more than 2 × 15); `backup-check` (default 1440, generated 2026-11-01) is stale and `ok` False with its error; `intervals={"backup-check": 10080}` makes it fresh; `intervalMinutes` in the file beats the setting.
   - `test_alerts_view_reads_only`: `alerts_view(space, watch)` lists active alerts first, Critical before Warning, with `counts` of active ones, `folder`, `typeExists`; calling it writes nothing; with no folder set and no type: `{alerts: [], sources: [], counts: {…0}, folder: None, typeExists: False}`.
   - `test_no_alerts_no_type`: a folder holding only `backup-check.json` creates no type.
2. Run: `uv run pytest backend/tests/test_m23_alerts.py -q`. Fails.
3. Implement. The thread polls every `poll_seconds` and stops within a second of `stop()`; each scan holds no space lock while reading files and writes each object through the normal space calls.
4. Run: pass; `uv run pytest backend/tests/test_m14_*.py -q` (writes share `update_properties`).
5. Commit: `feat(m23): Alert type and the monitoring folder watch`.

### Task 6: The Work section's routes and the keep-on-top window

**Files**
- Create: `backend/tests/test_m23_api.py`
- Fill: `backend/objectapp/api_work_section.py` (T1's stub, already mounted)
- Modify: `backend/objectapp/__main__.py` (pywebview mode: `windowhost.set_opener(...)` as the Contract says, after `webview.create_window("Object", url, width=1440, height=900)` and before `webview.start()`)

**Interfaces**
- Consumes: `workboard`, `workfocus`, `workday`, `workwins`, `workfloor`, `alerttype`, `alertwatch.alerts_view`, `workseams`, `windowhost`, M22's `WorkService` and its `StepChanged`/`FloorItemChanged` → 409 mapping as `api_work.py` writes it, `HistoryStore(space.root, is_whiteboard=…)` built per call as `api_history.py` does, `ApiContext` (`ctx.space`, `ctx.announce`), `space.Conflict`/`ReadOnly` (409/423) and `propvalues.InvalidValue` (422) as `api_work.py` maps them.
- Produces: every route in the Contract's table with its status codes and bodies.

**Steps**
1. Failing tests in `test_m23_api.py` (TestClient over `create_app` on a copy of the overlay space made into a git repo; `workAlertFolder` set to a copy of the monitoring fixtures through `PUT /api/settings`):
   - `test_reads_write_nothing`: `GET /api/work/board`, `?scope=all`, `/focus`, `/focus?day=2026-11-06`, `/today`, `/wins`, `/alerts`, `/agent`, `/captures`, `/floor/general`, `/keep-on-top` leave `git status --porcelain` empty and the state dir's file list unchanged.
   - `test_board_and_focus_routes`: the board's shape; `PUT /api/work/focus` with a stale `baseVersion` → 409 `{currentVersion, detail: "Today's note changed. Look again."}`; with the current one → the new `FocusDay` and one `changed` event with the client id; `day=2026-13-01` → 422; a read-only note → 423.
   - `test_alert_routes`: `POST /api/work/alerts/scan` answers the report and the alerts; `POST /api/work/alert-type` twice gives `created` True then False; events `types` once.
   - `test_floor_general_routes`: add, collect, a stale rev → 409 `{"detail": "This floor item changed. Look again."}`; each write announces `("work", "floor", …)`.
   - `test_seams_until_m24`: `GET /api/work/agent` → `available` False, `carrying` = the active items whose turn is `agent`, `note == "The agent loop comes with M24."`; `PUT /api/work/agent/acts` and `POST /api/work/agent/retry` → 501 with that detail; `POST /api/work/captures {text: "x", fromView: "now"}` → 501 `{"detail": "Saving a brain dump comes with M24."}`; `GET /api/work/captures?status=needsYou` → `{captures: []}`; with a fake `WorkSeams` passed through `build_seams` (monkeypatched), the routes return its values and 201 for a capture; a fake whose `retry` raises `SeamRefused(409, "This step changed. Look again.")` and whose `set_acts` raises `SeamRefused(422, "x")` gives 409 and 422 with those `detail`s.
   - `test_keep_on_top_routes`: without an opener `GET` gives `{window: False}` and `POST` 501 `{"detail": "Keep on top needs the Object window."}`; with `windowhost.set_opener(fake)` `POST` → 204 and `fake` got `http://testserver/?mini=work`.
   - `test_step_actions_still_go_through_m22`: approving Printer step 2 through `POST /api/work/step` changes the next `GET /api/work/board` (turn `agent`); the Work section router has no write route for steps or fields (`[r.path for r in router.routes]` holds none of `/work/step`, `/work/steps`, `/work/fields`).
2. Run: `uv run pytest backend/tests/test_m23_api.py -q`. Fails.
3. Implement.
4. Run: pass; `uv run pytest backend/tests/test_m22_api.py backend/tests/test_spaces*.py -q`.
5. Commit: `feat(m23): Work section routes and the keep-on-top window`.

### Task 7: The views' pure logic

**Files**
- Create: `frontend/src/work/logic/scoring.ts`, `focusLines.ts`, `flow.ts`, `stations.ts`, `daySlots.ts`, `queues.ts`, `stuck.ts`, `floor.ts`, `everything.ts`, `splitStep.ts`, `deadlines.ts`, and one test file per module (`*.test.ts`)

**Interfaces**
- Consumes: the Contract's types, `__fixtures__/board.json`, M22's `STAGE_LABELS`.
- Produces: every function in the Contract's `logic/` block, with these rules (ported from the old dashboard where marked):
  - `effectivePriority`: `ticket.deskPriority` for a ticket, else `priority` when it is Critical/High/Medium/Low (case-insensitive), else null. `score` = weight (`NO_PRIORITY_WEIGHT` 20 when null, ported) + (`rank` ? `max(0, 25 - 2*rank)` : 0) + (now − `lastTouched` < 24 h ? 15 : 0) − (`stage === 'notStarted'` ? 25 : 0). `quietDays` = whole days since `lastTouched`; `isStale` = not done and `quietDays > 7`.
  - `isYours`: active, stage not `parked`, and turn `you` or `approve` with a current step, or turn `close` (our call: closing is Gene's). `energyMatches`: no energy or `high` → every item; `medium` → any item whose current step's energy isn't `high`; `low` → `low` only (ported). `nowPool`: with a focus filter, only `isYours` items whose path is in it, by score (no energy filter, no fallback); else `isYours` items, those in `notNow` last, then by score descending, then filtered by energy, falling back to the unfiltered list when the filter leaves none (ported). `upNext(pool)` = `pool.slice(1, 4)`, `hidden = max(0, pool.length - 4)`.
  - `linkedPaths`: the line's resolved link paths plus every item whose `projectPath` is one of them. `isCleared`: at least one linked item and none active. `focusProgress`: steps finished / steps over the linked items. `currentLine`: the first line whose linked paths hold `top`'s path.
  - `laneOf`: turn `agent` → `agent`; turn `parked` or `none`, or `blockedOn` set → `others`; else `you`. `FLOW_COLUMNS` = notStarted, ready, doing, parked, done; the done column holds `recentlyDone` items only; cells sorted by score; `youDoing` = items in (you, doing); `overloaded = youDoing > DOING_LIMIT`; `areas` = the active items' areas, by name.
  - `projectLines`: one line per Project item: its steps as stations (done/declined → `done`; the current step → `doing` when the turn is `you`, else `waiting` (an approval or the agent); later → `notStarted`), then its tasks (`projectPath` = the project) as one station each by stage (`done` → done, `doing` → doing, `parked` → waiting, `notStarted`/`ready` → notStarted); then one line per Area for work items with no project that aren't Projects ("No area" for none); `percentDone = round(done / stations × 100)` (0 for none); `nextForYou` = the first station whose item `isYours` with a current step (its text); lines ordered by active stations descending, then title.
  - `dayBlocks` (ported): the morning brief 07:00-07:24 and the wrap-up 16:30-17:12 are fixed blocks; busy = meetings + the wrap-up; gaps start at the later of 08:00 and now rounded up to the quarter hour; a gap is kept when at least 45 minutes; a gap longer than 132 minutes is split in two at its middle; focus lines take the slots in order, each ending 3 minutes before its slot ends; blocks outside 07:00-17:30 are dropped.
  - `deadlines`: active items with a `deadline` from today to 60 days ahead (ours), soonest first; `daysLeft` whole days.
  - `queues`: by the current step: Question → answer, Do → do, Approve open → approve, Agent (any state) or Approve approved → agent; each by score.
  - `stuck`: `blocked` = active items with `blockedOn`, Desk status Blocked, or stage parked, and `quietDays >= 7`; `waitingOn` = active items with `blockedOnPeople`, not already in `blocked`.
  - `floorGroups` (ported): the place is the text without parenthesised parts, spaces collapsed, `Anywhere` when empty; open rows grouped by place, groups by size then name; `collected` rows newest first, at most 25; general rows have `owner` null.
  - `everythingRows`: sorted by the key, ties by title; `stage` and `turn` by their label order.
  - `splitStep` (ported split, our framing): split on `;`, `,`, ` and `, ` then `, `(`, drop a trailing `)`, trim, keep pieces longer than 3 characters, capitalise, at most 4; with fewer than 2 pieces: `["Get what you need for this step", <text>, "Write down what you found"]`.
  - `itemRef`: the ticket id when there is one, else the title.

**Steps**
1. Failing tests (each module's file):
   - `scoring.test.ts`: `test score adds weight, rank, recency and the not-started penalty` (a Critical ticket, rank 2, touched 2 h ago, doing → 100 + 21 + 15 = 136; no priority, rank 20, quiet 3 days, not started → 20 + 0 + 0 − 25 = −5; Desk priority beats the item's own); `test parked and other turns are never picked`; `test energy low offers only low steps and falls back when none match`; `test not now goes to the back`; `test up next shows three and counts the rest` (`hidden` for 6 items is 2); `test a focus line never falls back to unrelated work` (Review Focus 3: a line linked only to Parked thing and an agent-turn item gives `[]`, though other items are yours); `test stale after more than 7 days` (7 days false, 8 true).
   - `focusLines.test.ts`: a line linked to Scanner rollout includes Scanner firmware; cleared when its linked items are all done; `currentLine` finds Printer's line.
   - `flow.test.ts`: lanes for agent, parked and blocked items; four You items in Doing → `overloaded`; the area filter; done column only within 14 days.
   - `stations.test.ts`: Scanner rollout's line is its Approve step (`waiting`) then Scanner firmware (`doing`), 0 % then 50 % after the step is done; an Area line for Printers; `nextForYou`.
   - `daySlots.test.ts`: with meetings 09:00-09:30 and 13:00-13:30 at 08:10 and three focus lines: the brief, the gaps 08:15-09:00, 09:30-13:00 (split at 11:15), 13:30-16:30 (split), focus blocks in the first three slots ending 3 minutes early, the wrap-up; a 40-minute gap is skipped.
   - `queues.test.ts`, `stuck.test.ts` (Waiting on Pat in `blocked`: quiet 11 days; a fresh item with a person in `waitingOn`), `floor.test.ts`, `everything.test.ts`, `deadlines.test.ts`, `splitStep.test.ts` (`"Check the spooler; restart it and test print"` → `["Check the spooler", "Restart it", "Test print"]`; `"Reboot"` → the three framing lines).
2. Run: `npx vitest run src/work/logic`. Fails.
3. Implement (no React, no I/O).
4. Run: pass; `npx tsc -b --noEmit`.
5. Commit: `feat(m23): work views' pure logic (scoring, focus, flow, map, day, queues)`.

### Task 8: Stores, step actions, Undo and toasts

**Files**
- Create: `frontend/src/work/state/useWorkData.ts`, `useWorkUi.ts`, `useWorkSelection.ts`, `useWorkOverlay.ts`, `workActions.ts`, `workToasts.ts`, `frontend/src/work/components/StepActions.tsx`, `Chip.tsx`, `StatusIcon.tsx`, `ItemChips.tsx`, tests `frontend/src/work/state/workActions.test.ts`, `useWorkData.test.ts`, `useWorkUi.test.ts`, `frontend/src/work/components/StepActions.test.tsx`, `ItemChips.test.tsx`
- Fill: `frontend/src/work/state/WorkToasts.tsx` (T1's stub)

**Interfaces**
- Consumes: the client calls, M22's `api.workStep`, `StepChangedError`, `STEP_KIND_LABELS`, `TURN_LABELS`, `stepRules.ts` (for nothing but labels: the server decides), `useSpaceInfo` (the root for the storage key), `useTabs.openInSidepanel`, `lib/zonedTime.ts` (Not before: a local date-time in the space zone to a UTC instant), `WORK_ICONS`, `WORK_TEXT`.
- Produces: the Contract's `state/` and `components/` exports. Behaviour:
  - `useWorkData.load(parts)` fetches the named parts in parallel (default: board, focus, today, alerts, agent, needsYou); `all` and `wins` load only when a view asks; one failed part sets `error` for it and keeps the others. `useWorkEvents` reloads `board` (and `all` when loaded) after `changed`/`created`/`deleted`/`renamed`/`types` events, `needsYou` with `board` (after the same events; M24's captures are ordinary objects), `focus` and `today` when the changed path is a daily note or a Meeting, `alerts` when it is an Alert object, `general` on `work` events, `agent` on `workQueue` events (M24 announces them); debounced 300 ms.
  - `useWorkUi` persists `{energy, calm, view, focusLine, notNow, flowArea, everythingSort}` in `localStorage` under `object.work:<space root>` (wrapped in try/catch: blocked storage keeps it in memory); `notNow` and `focusLine` of an earlier day read as empty.
  - `stepAction` hides `"{path}#{stepId}"` at once, runs `run(path => api.workStep({path, stepId, stepRev, action, text, notBefore}))` (default `directRunner`), and on success for `answer`, `done`, `decline` and `approve` shows `undoToast` (`Marked done`, `Declined`, `Approved`, ours) whose Undo sends `reopen` with the step's new `rev` from the result; on failure it unhides the row, shows the error's message as a toast (the 409's is `This step changed. Look again.`), reloads the board and returns false. `run` is `reopen` only for an Approved step (shown as **Withdraw**).
  - `StepActions` renders nothing unless `step.current`; otherwise, by kind and `step.actions`: Question → an answer box (`Type the answer`, ours) and **Send** (Enter sends; empty does nothing); Do → **Done** and an optional note box (`What you found`, ours, sent as `text`); Approve open → **Approve** (first press: `Press again to approve`, back to Approve after `APPROVE_ARM_MS`), **Not before** (reveals a date-time field; the value goes with the second press), **Decline** (reveals `Reason (optional)` and a confirming **Decline**); Approve approved → **Withdraw**; Agent open → **Run now**, **Done**; Agent approved → **Done**. Chips and buttons use the Contract's tokens.
  - `Chip` is a dot and text (`data-tone`), `StatusIcon` maps to `WORK_ICONS`, `ItemChips` shows type, area, priority (Critical red, High amber, else muted) and the ticket id.

**Steps**
1. Failing tests:
   - `workActions.test.ts`: `test the row hides at once and returns on failure with the server's text` (a 409 `StepChangedError` → `hidden` empty again, one toast `This step changed. Look again.`, a board reload); `test undo reopens with the new rev` (done → Undo → `workStep({action: 'reopen', stepRev: <rev from the result>})`); `test undo lasts five seconds` (fake timers: gone at 5000 ms); `test approve's undo withdraws`; `test success shows no toast besides Undo` (a `run` shows nothing).
   - `StepActions.test.tsx`: `test approve needs two presses` (first press shows `Press again to approve` and sends nothing; second sends `approve`; after 4 s it is `Approve` again); `test not before goes with the approval` (`notBefore` is the UTC instant of the local value in the space zone); `test decline with a reason`; `test withdraw on an approved step`; `test run now and done on an agent step`; `test answer box sends on Enter`; `test a step that is not current renders nothing` (Review Focus 3 part); `test only the actions the server allows show` (an open Do step with `actions: []` shows none).
   - `useWorkData.test.ts`: parts load in parallel; a failing `alerts` keeps the board; events reload the right parts once per burst (a `workQueue` event reloads `agent` once; a `changed` event reloads `board` and `needsYou`).
   - `useWorkUi.test.ts`: values survive a reload of the store under the space key; another space has its own; yesterday's Not now reads empty; a throwing `localStorage` doesn't break it.
   - `ItemChips.test.tsx`: chips carry `data-tone` (`critical` for Critical) and no element has a filled background class.
2. Run: `npx vitest run src/work/state src/work/components`. Fails.
3. Implement.
4. Run: pass; `npx tsc -b --noEmit`.
5. Commit: `feat(m23): work stores, inline step actions, Undo and toasts`.

### Task 9: The Work page: top bar, brain-dump bar, focus rail, view switcher

**Files**
- Create: `frontend/src/work/page/WorkTopBar.tsx`, `BrainDumpBar.tsx`, `FocusRail.tsx`, `FocusEditor.tsx`, `AgentPill.tsx`, `ViewSwitcher.tsx`, `frontend/src/work/views/registry.ts`, tests `frontend/src/work/page/WorkPage.test.tsx`, `BrainDumpBar.test.tsx`, `FocusRail.test.tsx`, `frontend/src/work/views/registry.test.ts`
- Fill: `frontend/src/work/page/WorkPage.tsx` (T1's stub)

**Interfaces**
- Consumes: T8's stores and `workToast`, T7's `nowPool`, `isCleared`, `currentLine`, `focusProgress`, `queues`, `stuck`, `floorGroups`, `flowBoard`, `projectLines`, `deadlines`; the views (T1 stubs, filled by T10-T13); `api.workCapture`, `api.saveWorkFocus`; `KeepOnTopButton` (T1 stub).
- Produces: `WorkPage`, `WORK_VIEWS`, `registerWorkView`, `workViews`, `focusBrainDump`, `focusWorkSearch` (Contract). Behaviour:
  - Layout: the top bar, then the brain-dump bar, then the focus rail, then the view switcher, then the view; the top three stay on every view. The page runs `useWorkEvents()`, loads its parts on mount, and calls `useWorkKeys()` (T1's no-op until T16).
  - **Top bar**: Energy (`Low`, `Medium`, `High`; pressing the chosen one clears it, ported), **Just one thing** (a toggle: the switcher shows Now only, the page switches to Now, and `html[data-work-calm]` is set while the Work tab is active and removed on unmount), the **agent pill** (`WORK_TEXT.agentPill(carrying, active non-Info alerts)`, opens the Agent queue view), and search (`Search work`, ours): typing switches to Everything filtered by title, ticket id or area; Esc clears.
  - **Brain-dump bar**: a single-line field (`Brain dump: type and press Enter`, ours) with the capture tone (pink icon and focus ring). Enter sends `api.workCapture({text, fromView: <current view>})`; success clears the field; failure keeps the text and shows the error's message as a muted line under the field (in M23: `Saving a brain dump comes with M24.`).
  - **Focus rail**: today's lines as chips (`{n}. {label}`); the current line (`currentLine` of Now's top item) uses the you tone; a cleared line is struck through and muted; `{cleared}/{total} cleared` when any is cleared; clicking a chip selects it (`useWorkUi.focusLine`) and shows Now, clicking it again clears it; no lines: `No focus lines today.` (ours) with **Edit**. **Edit** opens `FocusEditor`: a text area, one line per line (the lines' raw `text`, links as `[[…]]`), **Save focus** (ported) and **Cancel**; Save sends `api.saveWorkFocus(day, lines, version)`; a 409 shows `Today's note changed. Look again.` and reloads.
  - **View switcher**: `workViews()` in order (Now, Flow, Projects map, Today, On the floor, Your queues, Agent queue, Stuck, Wins, Alerts, Everything, Tickets), each with its icon, label and count badge (hidden at 0): Now = `nowPool` length; Flow = active items; Projects map = lines; Today = deadlines; On the floor = open floor rows; Your queues = items in the four queues; Agent queue = `agent.carrying`; Stuck = blocked + waiting on; Wins = steps done in 14 days (loads `wins`); Alerts = active non-Info alerts; Everything = all items; Tickets = active tickets. The selected view is `useWorkUi.view` (a `{kind: 'work', view}` target sets it).
  - `registerWorkView(def)` appends (or replaces by id) a view. `WorkPage.tsx` imports `views/registry.ts` and then `import.meta.glob('../*/registerView.ts', { eager: true })`, so a later milestone's `frontend/src/work/<folder>/registerView.ts` registers its views before the switcher renders without editing M23's files (M24's Captures view).

**Steps**
1. Failing tests:
   - `WorkPage.test.tsx`: `test the bars stay on every view`; `test just one thing shows only Now and dims the app` (the switcher has one entry, `document.documentElement` has `data-work-calm`, removed on unmount); `test energy filters Now`; `test the agent pill counts and opens the agent queue` (`Agent is carrying 2 · 1 alerts`); `test search switches to Everything and filters`; `test a work target with a view opens it`.
   - `BrainDumpBar.test.tsx`: Enter posts the text and the view; success clears; a 501 keeps the text and shows `Saving a brain dump comes with M24.`; empty Enter sends nothing; no toast on success.
   - `FocusRail.test.tsx`: chips in order; the current one marked; a cleared one struck through with `1/3 cleared`; clicking selects and Now shows the focus empty state for a line with nothing of Gene's (`Focus 1 cleared` when all its work is done); Edit → Save sends the lines with the version; a 409 shows `Today's note changed. Look again.`.
   - `registry.test.ts`: the default order and keys (`n w p t o q h s y l e`, Tickets none); counts on `board.json`; `registerWorkView` adds and replaces; a view registered before the page renders shows in the switcher after Tickets.
2. Run: `npx vitest run src/work/page src/work/views/registry.test.ts`. Fails.
3. Implement.
4. Run: pass; `npx tsc -b --noEmit`.
5. Commit: `feat(m23): the Work page frame (top bar, brain dump, focus rail, views)`.

### Task 10: The Now view

**Files**
- Create: `frontend/src/work/views/NowCard.tsx`, `NowSide.tsx`, `frontend/src/work/views/NowView.test.tsx`
- Fill: `frontend/src/work/views/NowView.tsx` (T1's stub)

**Interfaces**
- Consumes: T7's `nowPool`, `upNext`, `score`, `STEP_ENERGY`, `STEP_MINUTES`, `linkedPaths`, `deadlines`; T8's stores, `StepActions`, `ItemChips`, `openItemPanel`, `useWorkOverlay`; `KeepOnTopButton` (T1 stub); `FocusEditor` (T9); `api.workClose` (M22) for a `close` item.
- Produces: `NowView`. Behaviour (spec views table, Now row):
  - **The card** (the page's one large element) for `pool[0]`: a line `{energy} energy · ~{minutes} min` (ours, ported), the chips, the title, **First tiny step**: the current step's text, **Blocked on** (when set), **Hypothesis** with `{confidence} confidence` (when set), the step's `StepActions`, **Where you left off**: the last Activity line (else `Last touched {n} days ago`, ported), `Step {n} of {N}`; buttons **Start together** (opens the focus session), **Make it smaller** (opens it for the current step), **Not now** (adds the path to today's Not now: the card moves to the back), **Details** (`openItemPanel`). A `close` item shows `Every step is done.` (ours) and **Close** (`api.workClose`, M22; a ticket then shows its resolution note in the panel), with `Desk says Resolved` (or Closed) when `deskSays` is set. A click on the card's empty area opens the panel.
  - **Empty**: `Nothing is waiting on you`; with a focus line selected: `Focus {n} cleared` when the line is cleared, else `No work is linked to this focus line yet.` (ported, when it links nothing) or `Nothing in focus {n} is waiting on you.` (ours), each with **Show everything again** (ported) that clears the selection.
  - **Side**: **Up next** (`upNext`: up to 3 rows with the current step and its energy icon, then `+{n} more hidden on purpose`), **Agent is carrying** (up to 5 items whose turn is `agent`, or `agent.rows` that are running or pending when available), the focus widget (today's lines with progress meters, **Edit**, `KeepOnTopButton`), **Parked dumps need you** (only when `needsYou` has rows: text and question), **Next meeting** (the first meeting after now: time and title, or none), **Deadlines** (`{n} days`, amber under 21, ported), **Alerts** (up to 5 active non-Info: dot and title; none: `All quiet`), **Wins** (steps done today and in 14 days). Rows are about 36 px; a click opens the panel.

**Steps**
1. Failing tests in `NowView.test.tsx` (on `board.json`, clock 2026-11-05T10:00Z):
   - `test the card shows the best item for you`: Printer jams on line 3 (Desk priority Moderate read as Medium: 30, rank 1: +23) has the highest `score` of the items that are Gene's; its card shows `First tiny step` with step 2's text, `Step 2 of 3`, the Approve buttons, `Where you left off` with the last Activity line.
   - `test not now moves it to the back for today` (the next item shows; tomorrow it is first again).
   - `test up next shows three and the rest hidden on purpose`.
   - `test a selected focus line shows only its work` (Review Focus 3 part: the line of Scanner rollout shows Scanner firmware's Question, never Printer).
   - `test the empty states` (`Nothing is waiting on you`, `Focus 1 cleared`, `All quiet`).
   - `test close offers Close and the desk mark` (Desk closed it: `Desk says Resolved`, Close calls `api.workClose` with its version).
   - `test the buttons open the session, Make it smaller and the panel`.
2. Run: `npx vitest run src/work/views/NowView.test.tsx`. Fails.
3. Implement.
4. Run: pass; `npx tsc -b --noEmit`.
5. Commit: `feat(m23): the Now view`.

### Task 11: Flow, Projects map, Everything and Tickets

**Files**
- Create: tests `frontend/src/work/views/FlowView.test.tsx`, `ProjectsMapView.test.tsx`, `EverythingView.test.tsx`, `TicketsView.test.tsx`
- Fill: `frontend/src/work/views/FlowView.tsx`, `ProjectsMapView.tsx`, `EverythingView.tsx`, `TicketsView.tsx` (T1's stubs)

**Interfaces**
- Consumes: T7's `flowBoard`, `laneOf`, `isStale`, `quietDays`, `projectLines`, `everythingRows`, `score`; T8's stores, `ItemChips`, `StatusIcon`, `openItemPanel`, `useWorkSelection`; M22's `STAGE_LABELS`, `TURN_LABELS`, `QueryPage` (`queries/QueryPage.tsx`, id `work-tickets`).
- Produces: the four views:
  - **Flow**: a board, lanes **You** / **Agent** / **Others** (rows, with the you, agent and others icons and tones) by columns **Not started**, **Ready**, **Doing**, **Waiting / parked**, **Done (14 days)** (ours: the stage labels, Done with its window); the Doing header shows `You: {n} / 3` and `Overloaded` (the critical tone) above 3; an area filter (`All areas` plus each area, ported); tiles show title, ticket id and the current step; stale tiles dimmed with `{n} days quiet` (ported). A tile click opens the panel.
  - **Projects map**: one card per line: title, `{n} open`, a line of stations (done filled, doing glowing (an accent ring), waiting dashed, not started hollow: `StatusIcon`), a progress meter, `{p}% done` and `Next for you: {text}` (ours, ported wording); a station click opens its item.
  - **Everything** (board `all`, loaded on first show): a sortable table, columns **Type**, **Ticket ID**, **Title**, **Area**, **Stage**, **Whose turn**, **Priority**, **Quiet days**, **Score**; a header click sorts (again: reverses; `useWorkUi.everythingSort`, default Score descending); the top bar's search filters it; rows about 36 px; a row click opens the panel; `j`/`k` order = the shown rows (`useWorkSelection.setList`).
  - **Tickets**: M22's Tickets view embedded (`<QueryPage id="work-tickets" />`), so its list, board (by Desk status) and table layouts work here.

**Steps**
1. Failing tests:
   - `FlowView.test.tsx`: items land in their lane and column (an agent-turn item under Agent, Parked thing under Others · Waiting / parked); four You items in Doing show `Overloaded`; the area filter narrows; Old cleanup is not in Done; a stale tile is dimmed with `11 days quiet`.
   - `ProjectsMapView.test.tsx`: Scanner rollout's line has two stations with `data-state` `waiting` and `doing`, `0% done`, `Next for you:` its step; the Printers area line.
   - `EverythingView.test.tsx`: the nine headers in order; default sort by Score descending; clicking Title sorts ascending, again descending; Old cleanup is listed (scope all); the search filter.
   - `TicketsView.test.tsx`: renders the `work-tickets` query page.
2. Run: `npx vitest run src/work/views/FlowView.test.tsx src/work/views/ProjectsMapView.test.tsx src/work/views/EverythingView.test.tsx src/work/views/TicketsView.test.tsx`. Fails.
3. Implement.
4. Run: pass; `npx tsc -b --noEmit`.
5. Commit: `feat(m23): Flow, Projects map, Everything and Tickets views`.

### Task 12: Today and On the floor

**Files**
- Create: tests `frontend/src/work/views/TodayView.test.tsx`, `FloorView.test.tsx`
- Fill: `frontend/src/work/views/TodayView.tsx`, `FloorView.tsx` (T1's stubs)

**Interfaces**
- Consumes: T7's `dayBlocks`, `deadlines`, `floorGroups`; T8's stores, `openItemPanel`; `api.workFloor` (M22, an item's floor items), `api.generalFloorOp`, `api.generalFloor`.
- Produces:
  - **Today**: the day's name, a horizontal 07:00-17:30 timeline with hour marks, the blocks (`Morning brief`, meetings, focus lines, `Wrap-up`, ported labels) in the tones (meetings you, focus accent, brief and wrap-up muted), a now-line while now is inside the range (updated every minute), and the deadline countdowns (`{n} days`, amber under 21) under it; the focus lines listed with their slot times. A meeting click opens it in the side panel.
  - **On the floor**: a summary `{n} to gather in {p} places · {c} collected` (ported); one card per place with its rows: a checkbox (collect), `what` in bold, the place and the owner (ticket id and title, or `General list`), and a `What you found` field (Enter collects with the text, ported); ticking vanishes the row and sends `api.workFloor({path, op: 'collect', itemId, itemRev, found})` for an item's row or `api.generalFloorOp({op: 'collect', …})` for a general one; failure brings it back with a toast. A **Collected** list (newest first, 25) whose checkbox un-ticks. An add row: place, what, and the item (`General list` or an active item) with **Add**. **Print checklist** prints the open list only (a `@media print` rule in `work.css`, T17, hides the rest; the view marks its printable part `data-work-print`). Empty: `Nothing to gather on the floor` (ported).

**Steps**
1. Failing tests:
   - `TodayView.test.tsx` (now 10:00, the two fixture meetings, three focus lines): the brief at 07:00, the standup at 09:00, focus blocks in the gaps from 10:00, the wrap-up at 16:30; the now-line at 10:00; Waiting on Pat's deadline `7 days` in the amber tone.
   - `FloorView.test.tsx`: groups by place with the summary; ticking an item's row calls `api.workFloor` with its id and rev and the row vanishes; ticking a general row calls `api.generalFloorOp`; a 409 brings the row back with `This floor item changed. Look again.`; the add row with `General list` calls `generalFloorOp({op: 'add', place, what})`; un-ticking a collected row sends `uncollect`; Print calls `window.print`.
2. Run: `npx vitest run src/work/views/TodayView.test.tsx src/work/views/FloorView.test.tsx`. Fails.
3. Implement.
4. Run: pass; `npx tsc -b --noEmit`.
5. Commit: `feat(m23): Today timeline and On the floor checklist`.

### Task 13: Your queues, Agent queue, Stuck, Wins and Alerts

**Files**
- Create: tests `frontend/src/work/views/QueuesView.test.tsx`, `AgentQueueView.test.tsx`, `StuckView.test.tsx`, `WinsView.test.tsx`, `AlertsView.test.tsx`
- Fill: `frontend/src/work/views/QueuesView.tsx`, `AgentQueueView.tsx`, `StuckView.tsx`, `WinsView.tsx`, `AlertsView.tsx` (T1's stubs)

**Interfaces**
- Consumes: T7's `queues`, `stuck`, `quietDays`; T8's stores, `StepActions`, `openItemPanel`; `api.workAgent`, `api.setAgentActs`, `api.retryAgentEntry`, `api.workWins`, `api.workAlerts`, `api.scanAlerts`.
- Produces:
  - **Your queues**: four columns **Answer**, **Do**, **Approve**, **Agent running**, each with its count and one card per item (title, the current step, `+{n} later steps waiting`, ported) and the step's `StepActions` inline (answer box and Send, Done, the two-press Approve and Decline; the Agent column shows Run now/Done or `Queued` for an approved step). Only the current step of an item ever shows.
  - **Agent queue**: sections **Working on** (rows `running`), **Queued** (rows `pending`, with `Not before {time}` when set) and **Failed** (rows `failed`, with the error and **Retry**), plus the **Agent acts on my approvals** switch (`actsOnApprovals`). While `available` is false: the switch is disabled with `agent.note` beside it, Working on and Failed are empty, and Queued lists the board's items whose turn is `agent` (approved Approve steps and Agent steps, `Waiting for the agent`, ours), so Run now's effect is visible.
  - **Stuck**: **Blocked and quiet for 7+ days** (`blocked`, with `{n} days quiet` and Blocked on), **Waiting on someone** (`waitingOn`, with the people's names as links), **Failed agent runs** (`agent.rows` with state `failed`; the section is hidden while `available` is false). Empty: `Nothing is stuck` (ours).
  - **Wins**: KPIs (steps done in 14 days, items closed in 14 days, objects changed in 14 days, changed today), a done-per-day chart (14 bars of `stepsDone + itemsClosed`, weekday labels, CSS bars in the ok tone, no chart library), **What got done** (`got`: time, item title, text), and the line `No streaks to break. This only grows.`
  - **Alerts**: grouped by severity **Critical**, **Warning**, **Info** (counts in the header), each row: dot, title, source, message, raised time, link; cleared alerts in a folded `Cleared` list (ours); a source strip listing stale or failing sources (`{source} isn't fresh: last report {time}` / its error, ours); **Check now** (`api.scanAlerts`); when no folder is set, the line `Pick a monitoring folder in Settings > Work.` (ours) above the list (agents and automations can still write Alerts). Empty: `All quiet`.

**Steps**
1. Failing tests:
   - `QueuesView.test.tsx`: Parked thing is in no column; Badge reader is in Do; Printer is in Approve with two-press Approve; `test only the current step offers actions` (Review Focus 3: an item whose step 3 is an open Agent step behind an open Approve step 2 is in Approve only, and no Run now shows for step 3); answering sends `answer` with the text and the card vanishes.
   - `AgentQueueView.test.tsx`: with `available: false` the switch is disabled with `The agent loop comes with M24.` and Queued lists the agent-turn items; with a live status (mock) the three sections fill, Retry calls `api.retryAgentEntry(id)`, the switch calls `api.setAgentActs(true)`.
   - `StuckView.test.tsx`: Waiting on Pat under Blocked and quiet with `11 days quiet`; a fresh item naming Pat under Waiting on someone; Failed agent runs hidden while unavailable, shown with rows.
   - `WinsView.test.tsx`: the KPIs from a `WorkWins` mock, 14 bars, What got done newest first, the closing line verbatim.
   - `AlertsView.test.tsx`: Critical before Warning; counts; cleared folded; the stale `backup-check` source line; Check now calls `api.scanAlerts` and shows the new list; `All quiet` with none.
2. Run: `npx vitest run src/work/views/QueuesView.test.tsx src/work/views/AgentQueueView.test.tsx src/work/views/StuckView.test.tsx src/work/views/WinsView.test.tsx src/work/views/AlertsView.test.tsx`. Fails.
3. Implement.
4. Run: pass; `npx tsc -b --noEmit`.
5. Commit: `feat(m23): queues, agent queue, Stuck, Wins and Alerts views`.

### Task 14: The item panel's work header

**Files**
- Create: `frontend/src/work/panel/NoteBox.tsx`, `ConfidenceMeter.tsx`, `EvidenceColumns.tsx`, `ActivityList.tsx`, `FloorList.tsx`, tests `frontend/src/work/panel/WorkHeader.test.tsx`, `ConfidenceMeter.test.tsx`
- Fill: `frontend/src/work/panel/WorkHeader.tsx` (T1's stub)
- Modify: `frontend/src/object/ObjectPage.tsx` (`workHeader?: boolean`, passed on; the whiteboard branch ignores it), `frontend/src/object/ObjectView.tsx` (`ObjectViewProps.workHeader?: boolean`; renders `<WorkHeader path work={writes.work} />` above the title when `workHeader` is set; leaves out M22's `ResolutionNoteSection` mount then)

**Interfaces**
- Consumes: `api.workItem`, `api.workSteps`, `api.workStep`, `api.workFloor`, `api.workNote`, `api.workClose` (M22); M22's `StepList`, `ResolutionNote`, `ObjectWrites.work`; T8's `StepActions`, `stepAction`, `ItemChips`, `useWorkOverlay`.
- Produces: `WorkHeader` (Contract). It loads `api.workItem(path)` (nothing for a non-work object), then shows, in this order: the chips (plus Object's status and `Desk says Resolved/Closed`), **Open ticket** (the ticket's `url`, a new browser window; hidden without one), the current step with its `StepActions`, **Start together**, **Make it smaller**, **Waiting on** (Blocked on), **Findings**, **Hypothesis** and **Confidence** (a three-segment meter: High 3, Medium 2, Low 1, N/A 0, with the reason under it), **Verified** and **Assumed** as two columns (and To raise confidence under them), the step list (M22's `StepList` wired to `api.workSteps`/`api.workStep`), **Floor items** (each with collect/un-tick, `api.workFloor`), the note box (**Add note** → `api.workNote(path, 'note', text)`, **Ask the agent** → `api.workNote(path, 'request', text)`, the M24 seam row), **Close** when the turn is `close` (`api.workClose`), the **Resolution note** for a ticket (M22's `ResolutionNote`, open), and **Activity** newest first (the last 20, then `Show all`, ours). Every write goes through the given `work` (M22's `ObjectWrites.work(run: (path, baseVersion) => Promise<WorkWriteResult>)`, which flushes the body first, then `onWorkWritten` merges `res.frontmatter` and loads `res.body` at `res.version`): the runner is `(call) => work((p) => call(p))`, Close is `work((p, v) => api.workClose(p, v))` (the flushed version), and the header adopts the returned `item`.

**Steps**
1. Failing tests in `WorkHeader.test.tsx` (rendering `ObjectView` with `workHeader` on the mock API):
   - `test the header shows the work parts in order` (for Printer: chips, Open ticket, the current step's two-press Approve, Waiting on, Findings, Hypothesis with the meter, Verified/Assumed columns, the step list, Floor items, the note box, the Resolution note's two Copy blocks, Activity newest first); a plain Page shows no header; M22's under-panel Resolution note is not rendered twice.
   - `test an action with a pending body edit saves the body first and shows the new Activity line` (Review Focus 2: type in the body, approve step 2 in the header: `saveBody` is called once before `workStep`, the editor then shows the returned body, and the next body save uses the returned version with no 409).
   - `test an action from the Now card reloads an open page of the item` (Review Focus 2: with Printer open in the side panel and no pending edit, `stepAction` with the direct runner makes the page show the new body).
   - `test ask the agent sends a request note` and `test add note sends a note`; empty text sends nothing.
   - `test close shows for a close turn`.
   - `ConfidenceMeter.test.tsx`: three segments, `data-filled` 2 for Medium, 0 for N/A.
2. Run: `npx vitest run src/work/panel src/object`. Fails.
3. Implement.
4. Run: pass; `npx tsc -b --noEmit`.
5. Commit: `feat(m23): the item panel's work header`.

### Task 15: Focus session, Make it smaller, Keep on top

**Files**
- Create: `frontend/src/work/session/FocusSession.tsx`, `MakeSmallerDialog.tsx`, `pip.ts`, tests `frontend/src/work/session/FocusSession.test.tsx`, `MakeSmallerDialog.test.tsx`, `KeepOnTop.test.tsx`
- Fill: `frontend/src/work/session/WorkOverlays.tsx`, `KeepOnTopButton.tsx`, `WorkMini.tsx` (T1's stubs)
- Modify: `frontend/src/main.tsx` (`?mini=work` renders `<WorkMini standalone />` instead of the app)

**Interfaces**
- Consumes: T7's `splitStep`, `itemRef`, `nowPool`, `currentLine`; T8's stores, `StepActions`, `stepAction`, `workToast`; `api.workCapture`, `api.workSteps`, `api.keepOnTopInfo`, `api.openKeepOnTop`.
- Produces:
  - **Focus session** (`useWorkOverlay.session`; a full-window dialog): the item's title, the current step, a 25:00 timer counting down with a progress ring, **Pause** (stops and closes; sends the capture `[{ref}] paused a focus session here`, ported, silently skipped on 501), **Step done** (Do and Agent: `done`; Question: reveals the answer box; Approve: reveals its `StepActions`; the session closes after the action lands), **Too big** (opens Make it smaller for the step), and **Tell the agent what you see** (a field; each Enter sends the capture `[{ref}] {text}` with `fromView: 'focusSession'` and `linkedPath`; a failure keeps the text and shows the message under it). At 0:00 the timer shows `Time's up` (ours) and stays open. Esc closes.
  - **Make it smaller** (`useWorkOverlay.smaller`): the step's text, the drafts from `splitStep` (2-4, each editable, each `~2 min`, ported), **Replace the step with these** (ours: one `api.workSteps(path, [...adds as Do steps before the step, {op: 'remove', stepId, stepRev}])`; only for an open step; a refusal shows its message), **Ask the agent to break it down** (the capture `Break down {ref} step {n}: {text}`, `linkedPath`; on 501 a toast with the detail), **Close**.
  - **Keep on top**: `KeepOnTopButton` asks `api.keepOnTopInfo()` once; with `window: true` a press calls `api.openKeepOnTop()`; else, when `window.documentPictureInPicture` exists, a press opens a 340×430 picture-in-picture window (ported size), copies the page's style sheets and the `html` theme attributes into it, and renders `<WorkMini />` there (`pip.ts`); else the button renders nothing.
  - **WorkMini**: the selected (or current) focus line, Now's top item with its current step, and a brain-dump field (`fromView: 'keepOnTop'`). `standalone` loads the data itself and runs `useWorkEvents`.

**Steps**
1. Failing tests:
   - `FocusSession.test.tsx`: starts at `25:00` and counts down (fake timers); Step done on a Do step sends `done` and closes; on a Question it reveals the answer box; Tell the agent sends `[INC0012345] saw E-12` with the item's path; a 501 keeps the text with `Saving a brain dump comes with M24.`; Pause sends the paused capture and closes; Too big opens Make it smaller.
   - `MakeSmallerDialog.test.tsx`: drafts from the step text; Replace sends one `workSteps` call with the adds before the step and its removal; Ask the agent sends `Break down INC0012345 step 2: …`; a 501 shows a toast with the detail.
   - `KeepOnTop.test.tsx`: `window: true` → the press posts; no window and no PiP → nothing renders; with a fake `documentPictureInPicture` → `requestWindow({width: 340, height: 430})` and `WorkMini` renders into it.
2. Run: `npx vitest run src/work/session`. Fails.
3. Implement.
4. Run: pass; `npx tsc -b --noEmit`.
5. Commit: `feat(m23): focus session, Make it smaller and Keep on top`.

### Task 16: Keyboard shortcuts

**Files**
- Create: `frontend/src/work/keys/workShortcuts.ts`, `frontend/src/work/keys/useWorkKeys.test.tsx`, `frontend/src/lib/shortcuts.m23.test.ts`
- Fill: `frontend/src/work/keys/useWorkKeys.ts` (T1's no-op)
- Modify: `frontend/src/lib/shortcuts.ts` (`ShortcutScope` gains `'work'`; `CATEGORY_LABELS.work = 'Work'`; a key spec with a space is a two-key sequence: `formatKeys('g n') === 'G then N'` (ours), `matches` never matches a sequence), `frontend/src/lib/shortcuts.test.ts` (the collision test compares sequences as whole strings), `docs/behavior-catalog.md` (section 2: a **Work** line listing the keys; section 4: the Work entry below Agents)

**Interfaces**
- Consumes: `isEditableTarget`, `registerShortcuts`, `usePeek`, `useTabs`, `useSettingsModal.toggleShortcuts`, T8's `useWorkSelection`, `useWorkUi`, `openItemPanel`, T9's `focusBrainDump`, `focusWorkSearch`, `workViews()` keys.
- Produces: `WORK_SHORTCUTS` (category `work`, scope `work`, `bound: false`, our names: `Search work` `/`, `Brain dump` `b`, `Go to Now` `g n` … `Go to Everything` `g e`, `Next row` `j`, `Previous row` `k`, `Open` `Enter`, `Peek` `Space`, `Previous item` `[`, `Next item` `]`, `Close` `Escape`, `Shortcuts` `?`), registered at load; `useWorkKeys()` (one `keydown` listener while the Work page is mounted):
  - ignored when a modifier other than Shift is held, when the target or the focused element is editable (`isEditableTarget`), when a dialog is open or the peek shows, and, for Space and Enter, when focus is on a button, link, checkbox or `[role=button]`;
  - `g` then a view key within 1500 ms (ours) opens that view (in calm mode only `g n`); `/` focuses the search; `b`/`B` focuses the brain-dump bar; `j`/`k` move the selection (`useWorkSelection`) and scroll the row (`[data-work-row]`, `aria-selected`) into view; Enter opens the selected item's panel; Space peeks it (`usePeek.peek(path, list)`); `[`/`]` select the previous/next item and, when the side panel shows a work item, open it there; Esc closes the side panel when it shows a work item, else clears the focus line and the search; `?` toggles the Shortcuts sheet.

**Steps**
1. Failing tests:
   - `useWorkKeys.test.tsx`: `test keys never act in fields, editors, dialogs or on buttons` (Review Focus 1: `b`, `j`, `g n`, `[`, `/`, `?` typed in the brain-dump bar, an answer box, a contenteditable body and a CodeMirror element change nothing but the text; with a dialog open nothing happens; Space on a focused button presses it and opens no peek); `test g then a key opens the view` (and expires after 1500 ms); `test j k Enter Space` (selection moves, Enter calls `openItemPanel`, Space calls `peek` with the list); `test brackets move through items in the panel`; `test esc closes the work panel`; `test question mark toggles the shortcut sheet`; `test calm mode keeps only g n`.
   - `shortcuts.m23.test.ts`: `formatKeys('g n') === 'G then N'`; every `WORK_SHORTCUTS` entry is in `shortcutsByCategory().get('work')`; the Shortcuts sheet lists the Work group; no collision in scope `work`.
2. Run: `npx vitest run src/work/keys src/lib/shortcuts`. Fails.
3. Implement; update the catalog.
4. Run: pass; `npx tsc -b --noEmit`.
5. Commit: `feat(m23): Work keyboard shortcuts`.

### Task 17: Shell wiring, theme and settings

**Files**
- Create: `frontend/src/work/work.css`, tests `frontend/src/shell/Sidebar.work.test.tsx`, `frontend/src/App.work.test.tsx`, `frontend/src/theme/workTokens.test.ts`, `frontend/src/settings/sections/Work.m23.test.tsx`, `frontend/src/queries/QueriesPage.tickets.test.tsx`
- Modify: `frontend/src/shell/Sidebar.tsx` (a `<nav aria-label="Work">` with one `MainNavButton` (`ph-briefcase`, "Work") directly below `<AgentsSection onOpenTarget>`, above `<nav aria-label="Main">`; prop `workActive`, beside `allNotesActive` and the others; Ctrl+click opens a new tab), `frontend/src/App.tsx` (T1 added `pageFor`'s `case 'work'`; here the object case passes `workHeader={target.work}` (T14's prop); `workActive`; mounts `<WorkToasts />` and `<WorkOverlays />` once), `frontend/src/nav/tabs.ts` (T1 added the targets and `sameTarget`; here the store's `retarget` keeps `work`), `frontend/src/nav/sidepanel.ts` (`retargetEntries` keeps `work`), `frontend/src/shell/TabStrip.tsx` (T1 added the title; here `TargetLabel`'s icon `ph-briefcase` for the Work tab), `frontend/src/queries/QueriesPage.tsx` (the built-in Tickets view, the query with `builtIn === 'tickets'` (id `work-tickets`), is listed under Work, not here), `frontend/src/settings/sections/Work.tsx` (adds **Alert folder** (`workAlertFolder`; a path field, empty = off), **Alert intervals** (rows source + minutes, `workAlertIntervals`), **Add the Alert type** (`api.ensureAlertType()`; disabled with `The Alert type exists.` once it does, ours)), `frontend/src/theme/tokens.css` (the work tokens), `frontend/src/index.css` (imports `work/work.css`)

**Interfaces**
- Consumes: T1's stubs and targets; T14's `ObjectPage` `workHeader` prop (T17 runs after T14); `useSettings`, `api.ensureAlertType`, `api.workAlerts` (`typeExists`). `settings/sections/Work.tsx` keeps M22's own `WORK_TEXT` export and adds its strings there (M23's `work/workText.ts` is imported under another name if needed).
- Produces: the sidebar entry and routing; `work.css`: `html[data-work-calm]` dims the sidebar, the tab strip and the breadcrumbs to 35 % opacity (full on hover, 150 ms); `[data-work-vanish]` collapses a row (opacity and height, 200 ms); `@media print` shows only `[data-work-print]`; the work tokens.

**Steps**
1. Failing tests:
   - `Sidebar.work.test.tsx`: the Work entry is the first item after the Agents section and before All notes; it opens `{kind: 'work'}`; `aria-current` when active; it shows while AI features are hidden (the Agents section isn't).
   - `App.work.test.tsx`: a work target renders `WorkPage` with tab title "Work"; `{kind: 'object', path, work: true}` in the side panel renders the object page with the work header; renaming the object keeps `work`; `WorkToasts` and `WorkOverlays` mount once.
   - `workTokens.test.ts`: each `--work-*` token is defined in `tokens.css` as a `var(--label-…)` of a label token that `tokens.css` and each of `light`, `lightDimmed`, `darkDimmed` in `themes.css` define; `noRawColours` still passes for `work/`.
   - `Work.m23.test.tsx`: the alert folder saves `workAlertFolder` and a 422 shows the server's message; an interval row saves `{"printer-watch": 15}`; Add the Alert type calls `ensureAlertType` and then shows `The Alert type exists.`.
   - `QueriesPage.tickets.test.tsx`: the `work-tickets` query is not listed; other queries are.
2. Run: `npx vitest run src/shell src/App.work.test.tsx src/theme src/settings src/queries`. Fails.
3. Implement.
4. Run: pass; `npx tsc -b --noEmit`; `npm run build`.
5. Commit: `feat(m23): Work in the sidebar, routing, theme tokens and Work settings`.

### Task 18: Integrate: acceptance and docs

**Files**
- Create: `scripts/m23_acceptance.py`, `docs/superpowers/plans/m23-acceptance.md`
- Modify: `docs/superpowers/plans/remaining-work.md` (M23 status line), `CONTINUE.md` (M23 built; M24 next)

**Interfaces**
- Consumes: everything above; `scripts/m2_acceptance.py` helpers (`Http`, `Run`, `commit`, `git`, `changed_paths`, `hunk_keys`, `free_port`) as `m22_acceptance.py` uses them. No agent runs, so the fake `claude` is not needed.

**Steps**
1. Write `scripts/m23_acceptance.py [SPACE] [--keep]` (default: `backend/tests/fixtures/space-work` with `space-work-m23` copied over it). It copies the space and `backend/tests/fixtures/monitoring` to a temp folder (the originals are never touched), commits the space copy to a throw-away git repo, sets `OBJECT_STATE_DIR`, `OBJECT_CACHE_DIR` and `OBJECT_CLOCK_FILE` (2026-11-05T10:00:00Z) to temp paths outside the copy, serves `create_app` on a free `127.0.0.1` port, sets the space time zone to UTC and `workAlertFolder` to the monitoring copy (`PUT /api/settings`), then checks over HTTP, printing `[ok]`/`[FAIL]` per check and `RESULT: PASS` at the end (non-zero exit on any failure):
   1. reads write nothing: every M23 `GET` route (board both scopes, focus for today and tomorrow, today, wins, alerts, agent, captures, floor/general, keep-on-top) → `git status` clean, the state dir unchanged;
   2. the board: Printer `turn == "approve"`, Waiting on Pat has `deadline` and `blockedOnPeople`, Scanner firmware's `projectPath` after `POST /api/types/project/work-fields`;
   3. focus: `PUT /api/work/focus` with the note's version → the diff of `DailyNotes/2026-11-05.md` is only the Focus list lines and `lastUpdated` (`hunk_keys`), CRLF and BOM kept; the old version → 409 `Today's note changed. Look again.`; a focus save for 2026-11-06 creates that note;
   4. today: two meetings, 09:00-09:30 and 13:00-13:30;
   5. a step action through M22: approve Printer step 2 (`POST /api/work/step`) → the board shows turn `agent`; the same rev again → 409 `This step changed. Look again.`; reopen (Undo) with the new rev → `approve` again;
   6. alerts: `POST /api/work/alerts/scan` creates two Alert objects and the Alert type (`git status` shows exactly those three files), the toner message holds `[redacted]`, `backup-check` is stale, `broken.json` is an error; a second scan writes nothing; removing `toner` from the file and scanning sets its Cleared at only;
   7. the general floor: add, collect → `.object/work/floor.json` holds one collected item;
   8. wins: after step 5 and a `POST /api/work/close` on Badge reader (after its Do step is done), today's `itemsClosed == 1` and `stepsDone >= 1`;
   9. the seams: `GET /api/work/agent` `available` False with `carrying` equal to the agent-turn items; `POST /api/work/captures` → 501 `Saving a brain dump comes with M24.`; `POST /api/work/keep-on-top` → 501 `Keep on top needs the Object window.`;
   10. `git status` lists only the files the checks changed (the edited Tasks, the two daily notes, the Project type, the Alert type and objects, `.object/work/floor.json`) and the state dir holds no work file besides `work-alerts-<hash>.json` and history.
2. Write `docs/superpowers/plans/m23-acceptance.md`: how to run the script, then hand checks for Gene (`- [ ]`) on a copy of his space:
   - [ ] Work sits below Agents in the sidebar; it opens the Work page with the top bar, the brain-dump bar and the focus rail on every view.
   - [ ] Now shows one card: chips, title, First tiny step, Blocked on, Hypothesis with confidence, the step's buttons, Where you left off, Step n of N; Up next shows at most 3 and "+N more hidden on purpose".
   - [ ] Energy Low offers only quick steps; Just one thing hides every view but Now and dims the sidebar and tabs.
   - [ ] Approve needs two presses ("Press again to approve"); Not before goes with it; Decline takes a reason; Withdraw puts it back; the row vanishes at once; Undo (5 s) brings it back.
   - [ ] Act on a step in two windows: the second gets "This step changed. Look again." and the row comes back.
   - [ ] Write focus lines with `[[links]]` to work items (Edit on the focus widget); the rail shows them; clicking one shows only that line's work, never other work; a line whose work is all done is struck through.
   - [ ] Today places focus lines in the gaps between meetings, with a now-line; deadlines count down.
   - [ ] On the floor: tick an item with "What you found"; add a general item; Print checklist prints only the list.
   - [ ] Flow lanes and columns; more than 3 of your items in Doing shows Overloaded; stale tiles are dimmed. Projects map shows each project's stations and % done.
   - [ ] Everything sorts by each column; Tickets shows the M22 Tickets view (list, board, table).
   - [ ] Click any item: the side panel shows the work header above the page; act on a step there while you have unsaved body text: nothing is lost and the Activity line appears.
   - [ ] Start together: a 25-minute timer, Step done, Pause, Too big; Make it smaller drafts 2-4 steps and can replace the step with them.
   - [ ] Keep on top opens a small window that stays above others (in the Object window; in a browser, picture-in-picture where it exists).
   - [ ] Keys: `/`, `B`, `g` + n/w/p/t/o/q/h/s/y/l/e, `j`/`k`, Enter, Space, `[`/`]`, Esc, `?`; none of them fire while typing.
   - [ ] Settings > Work: pick your monitoring folder (a copy) and set an interval; Alerts lists them by severity, stale sources are named, Check now rescans; restarting Object creates no duplicate alerts.
   - [ ] Wins shows steps done, items closed, objects changed and the per-day chart, with "No streaks to break. This only grows."
   - [ ] Light and dark themes: the you (indigo), agent (teal), approve (amber), critical (red) and brain-dump (pink) colours read well in both.
   - [ ] The brain-dump bar, the agent switch and Ask the agent to break it down say they come with M24; nothing else is missing.
   - [ ] Opening Work and browsing every view changes no file (git status clean).
3. Run M23's own checks (the machine is shared with the other track; the full suites, `npm run lint` and the earlier milestones' acceptance scripts run once in this track's full gate, after the review and fix pass, as M22 did): `uv run pytest backend/tests/test_m23_*.py backend/tests/test_m22_api.py backend/tests/test_settings.py backend/tests/test_history.py -q`; `cd frontend && node scripts/app-icons.mjs --check` (regenerate `src/icons/appIcons.ts` when a task added a `ph-` id it didn't), `npx vitest run src/work src/lib/shortcuts src/shell src/App.work.test.tsx src/theme src/settings/sections src/queries src/object src/nav src/icons`, `npx tsc -b --noEmit`, `npm run build`; `uv run python scripts/m23_acceptance.py` (prints `RESULT: PASS`) and `uv run python scripts/m22_acceptance.py` (M22's routes are touched by the board).
4. Commit: `test(m23): acceptance script and hand checks; docs status`. The acceptance doc lists every task's reported deviations, as `m22-acceptance.md` does.

## Shared files and ordering

| Shared file | Owner | Others needing a change say so in their report |
|---|---|---|
| `frontend/src/api/types.ts`, `api/client.ts`, `test/mockApi.ts`, `settings/defaults.ts` | T1 | T7-T17 |
| `backend/tests/test_settings.py` | T1 | |
| `frontend/src/nav/tabs.ts`, `App.tsx`, `shell/TabStrip.tsx` | T1 (the `Target` variants, `sameTarget`, `pageFor`'s `work` case, the tab title), then T17 | |
| `frontend/src/work/workText.ts`, `work/workIcons.ts`, `icons/appIcons.ts` (generated) | T1 | every front-end task (a missing string stays a local constant in the task's own file until the review; a missing icon is reported) |
| `frontend/src/work/__fixtures__/board.json`; `backend/tests/fixtures/space-work-m23/`, `fixtures/monitoring/`, `backend/tests/m23_helpers.py` | T1 | T2-T17 read them |
| `backend/objectapp/server.py`, `watcher.py`, `settings.py`, `writeorigin.py`, `workseams.py`, `windowhost.py`, `worksection_model.py` | T1 | T6 (M24 later replaces only `build_seams`' body) |
| `backend/objectapp/alertwatch.py` | T1 stub; T5 fills | |
| `backend/objectapp/api_work_section.py` | T1 stub; T6 fills | |
| `backend/objectapp/history.py` | T4 | |
| `backend/objectapp/__main__.py` | T6 | |
| `frontend/src/work/page/WorkPage.tsx`, `views/registry.ts` | T1 stub; T9 | T10-T13, T16 |
| `frontend/src/work/views/*View.tsx` | T1 stubs; Now T10; Flow, ProjectsMap, Everything, Tickets T11; Today, Floor T12; Queues, AgentQueue, Stuck, Wins, Alerts T13 | |
| `frontend/src/work/state/WorkToasts.tsx` | T1 stub; T8 | |
| `frontend/src/work/panel/WorkHeader.tsx`; `object/ObjectPage.tsx`, `object/ObjectView.tsx` | T1 stub; T14 | |
| `frontend/src/work/session/*.tsx`; `main.tsx` | T1 stubs; T15 | |
| `frontend/src/work/keys/useWorkKeys.ts`; `lib/shortcuts.ts`, `lib/shortcuts.test.ts`; `docs/behavior-catalog.md` | T1 stub; T16 | |
| `frontend/src/shell/Sidebar.tsx`, `nav/sidepanel.ts`, `queries/QueriesPage.tsx`, `theme/tokens.css`, `index.css`, `work/work.css` (and the T17 parts of `App.tsx`, `nav/tabs.ts`, `shell/TabStrip.tsx`) | T17 | T12 (print rule), T9 (calm attribute) rely on `work.css` |
| `frontend/src/settings/sections/Work.tsx` (M22's file; M23 adds its alert rows after M22's two rows, and M24 later adds its work agent group after them) | T17 | |
| `docs/superpowers/plans/remaining-work.md`, `CONTINUE.md` | T18 | |

## Lanes

T1 runs first, alone. Then four tracks (counted from the Files lists; no file is in two tracks):

| Track | Tasks, in order | Waits for |
|---|---|---|
| B (back end) | T2, T3, T4, T5, T6 | T6 waits for T2-T5 (its routes call them) |
| F1 (logic and views) | T7, T11, T12, T10 | T11 and T12 wait for T8 (F2: stores, `ItemChips`, `openItemPanel`); T10 waits for T8 and T9 (F2: `FocusEditor`) |
| F2 (state, frame, views) | T8, T9, T13 | T9 waits for T7 (F1) |
| F3 (panel, session, keys, shell) | T14, T17, T15, T16 | T14 and T15 wait for T8; T15 for T7; T17 for T14 (`ObjectPage`'s `workHeader`); T16 for T9 |

Reconciled 2026-11-06: T10 was after T7 in F1 although it consumes T9's `FocusEditor`, and T17 was first in F3 although `App.tsx` passes T14's `workHeader` prop, so both moved later; T1 now also adds the `work` target types (T8's `openItemPanel` needs `work: true` on the object target, and the new kind breaks two exhaustive switches). No file is in two tracks.

Front-end tests use the mock API and `board.json`, so no front-end task waits for the back end. T18 integrates after all tracks. Then one whole-milestone review (correctness, file safety, fidelity to the spec and catalog), one fix pass, this track's full gate (every suite, `npm run lint`, `npm run build`, the acceptance scripts), and Gene's hands-on check.

## Our calls

1. **The board** is one read (`GET /api/work/board`) of M22's summaries plus steps, floor items, deadline and the people Blocked on links; every view is computed from it in the front end. (ours)
2. **The Work page's state** (energy, Just one thing, view, Not now, the selected focus line, Flow's area, Everything's sort) is per-space browser storage, so using the page writes no file. Not now and the focus line reset each day. (ours)
3. **The brain-dump bar** is in place and sends `POST /api/work/captures`, which answers 501 `Saving a brain dump comes with M24.` until M24 fills `CaptureSink`; the text stays in the box. This is the least throwaway shell: the front end is final, M24 only implements the back-end seam. (ours)
4. **The seams** (`workseams.build_seams`: `AgentProvider`, `CaptureSink`, `SeamRefused`), their routes, the `workQueue` event kind and the `registerView.ts` glob are M23's; M24 replaces only `build_seams`' body, adds listeners through M22's `add_work_listener`, and adds its own files. "Ask the agent" is M22's request note, "Run now" M22's `run`, so both work now and M24 adds the queue behind them. (ours)
5. **Whose turn is "yours" on Now**: `you` and `approve` with a current step, and `close` (closing is Gene's action; the card offers Close). (ours)
6. **Energy matching** (Low only low, Medium anything but high, High everything, falling back to everything when none match), **no priority weighs 20**, Up next = the next 3 of the pool, and Not now moves an item to the back for the day. (ported)
7. **A selected focus line** offers only that line's own work that is Gene's turn (linked items, and the tasks of a linked project), with three empty states; it never falls back. (ours, spec rule)
8. **Focus lines** are the top-level list items of the daily note's `Focus` section; a line is done ("struck through") when every work item it links is done; the current one holds Now's top item; Edit replaces only the list lines and creates the daily note when missing; at most 20 lines. (ours)
9. **Flow lanes**: agent turn → Agent; parked, no steps, or Blocked on set → Others; else You. Stages are M22's. (ours)
10. **Projects map stations**: a project's own steps, then its tasks; the current step glows when it is Gene's turn, is dashed while it waits on an approval or the agent; Areas without a project get their own line. (ours)
11. **Today's slots** keep the old dashboard's fixed morning brief (07:00-07:24) and wrap-up (16:30-17:12), gaps from now (not before 08:00), gaps over 132 minutes split in two, focus blocks ending 3 minutes early. Meetings without an end last 30 minutes. (ported; 30 minutes ours)
12. **Deadlines** are work items' `deadline` dates within 60 days, amber under 21 days. (21 ported, 60 ours)
13. **Stuck**: blocked (Blocked on, Desk status Blocked, or parked) and quiet 7+ days; waiting on someone = Blocked on links a Person object; failed agent runs come from M24. (ours)
14. **The general floor list** lives in `.object/work/floor.json` with M22's floor item shape and rules. (ours)
15. **Alerts**: a normal type made on first need (or by "Add the Alert type" in Settings > Work), one object per `source|key`, updated in place, Cleared at set when an alert leaves its file; the folder watch polls every 60 s, skips unchanged files, keeps its state in the state dir, reads today's monitoring JSON unchanged (severity, redaction, link unwrapping ported); a file may state `intervalMinutes`, else Settings' per-source interval, else 1440; stale = older than twice the interval. The old per-job run windows are not kept. (ours / ported)
16. **Wins** count steps done (their `doneAt`), items closed (`completed`) and objects changed (version history entries plus `lastUpdated`), per local day for 14 days. (ours)
17. **The item panel** is the object page in the side panel with `work: true`; its header writes through M22's `ObjectWrites.work`; it carries the Resolution note, so M22's under-panel copy is left out there (ordinary object pages keep it). (ours)
18. **Undo** labels `Marked done`, `Declined`, `Approved`; the two-press Approve re-arms after 4 s. (ours)
19. **Make it smaller** can also **Replace the step with these** (the drafts as Do steps, one `edit_steps` write). (ours)
20. **Keep on top**: a pywebview `on_top` window at `/?mini=work` in the Object window; Document Picture-in-Picture in a browser that has it; otherwise the button doesn't show. (ours, the spec leaves the mechanism to the builder)
21. **Keyboard**: `g` waits 1500 ms for the view key; Space and Enter on a focused button stay the button's; Esc closes the work panel first; the keys are listed in the Shortcuts sheet under "Work" and in the catalog. (ours)
22. **Colours** map onto Object's label tokens (indigo, teal, gray, amber, red, green, pink), so the four themes follow with no new per-theme values. (ours)
23. **The Tickets view** moves from the Queries list to the Work view switcher (no key). (ours, as M22 planned)

## Points planned with a guess

- **"Agent is carrying N"** before M24 counts the items whose turn is `agent` (approved Approve steps and Agent steps); once M24 runs the queue, `AgentProvider.status` decides. (guess: matches the old pill, which counted the agent's lane)
- **"Waiting on a named person"** is read as Blocked on linking a Person object (`[[Pat Example]]`), not free text. (guess)
- **The morning brief and wrap-up blocks** on Today are kept as fixed times from the old dashboard; the spec names them without times. (guess: ported)
