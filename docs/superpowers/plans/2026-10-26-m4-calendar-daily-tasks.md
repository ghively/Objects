# Object, Milestone 4: Calendar, Daily Notes, Tasks. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Time and to-dos work as they do in Object, on plain Markdown files:
- A **Calendar** page with Month, Week, Three days and Day views, "‹ Today ›", the Day header (coloured weekday, Today pill, large date, week number), the mini month in the right panel, and the day sections (daily note inline, tasks, objects with this date, created, updated) behind the All / Daily note / Tasks / Created Today tabs, with quick-create chips.
- **Daily notes:** one per date as `DailyNotes/YYYY-MM-DD.md`, "+ Daily Note", the Reviewed flag, daily note templates.
- **Calendar options per type** (create-in-calendar, hide-from-calendar) and **date properties in the calendar**: any object with a date or datetime value appears on its dates, ranges included.
- **Tasks:** the Task fields (status with its categories, priority, date, deadline, completed), **recurrence** (every N day/week/weekday/month/year, by due date or by completion date), **reminders** (local OS notifications only), the Tasks page (grouped by status category, list and kanban, filters, drag between columns changes status) and the Task dashboard sections M3 deferred.

**Architecture:**
- **Two parallel tracks.** **backend** (`backend/**`, `scripts/**`, Tasks 1–6) and **frontend** (`frontend/**`, Tasks 7–15) never touch the same file. The frontend builds against the **API contract** below and mocks it in tests. **integrate** (Task 16) runs end to end. The frontend splits again into a **tasks** sub-track (Tasks 8–11) and a **calendar** sub-track (Tasks 12–15) that own disjoint folders and files after Task 7 (see "Shared files and ordering").
- **Back end:** two pure modules (`taskmodel.py` for the `repeat` and `remind` text forms, `recurrence.py` for date arithmetic); a Task status hook inside `Space.update_properties` so completing, reopening and recurring happen in the one stamped write; a daily note index and `POST /api/daily-notes`; one calendar range query that returns, per day, only *paths* and flags (the client loads rows through M3's `POST /api/rows`); a small reminder scheduler thread with an injectable notifier.
- **Front end:** pure, fully unit-tested date helpers and `repeat`/`remind` parsers; `TaskCheckbox` and the task actions; the date picker's Repeat and Reminder rows; a few additions to M3's view engine (status-category groups, "Scheduled" date groups, recurring/reminder filters); the Tasks page; the Calendar page with its four views, mini month and day sections, all built on M3's `DataView`, `ObjectCard` and `useRows`.
- **Why the server answers the calendar query:** a month view needs every object's date values, `createdAt` and `lastUpdated` converted to *local days*, and recurring tasks expanded; doing that once next to the in-memory objects keeps the client from loading every row for every calendar page. Rendering still goes through rows (`api.rows({paths})`), so cards and cells have one owner.

**Tech Stack:** as M3. **No new dependencies.** Reminders use the standard library only: Windows toast through `powershell.exe` (WinRT `ToastNotificationManager`, in the box on Windows 11), `notify-send` on Linux, `osascript` on macOS. No network, no account, no push service.

**Spec:** `docs/superpowers/specs/2026-10-23-object-design.md` §3 (Daily notes, Tasks) and §4 (the Task example: `status`, `priority`, `deadline` in frontmatter).
- Reference for behaviour and names only (never copy code): `docs/design-notes{date,component,property}.model.ts` (`DateObject`, `Recurrence`, `Reminder`, `RootSpace.calendar`, `createInCalendarOption`, `hideFromCalendarSidebar`, `hideCalendarEvents`), `docs/design-notes` (the `RootTask` and `RootDailyNote` property sets, status options, priority options).
- **en-US strings:** `docs/strings.txt`. Every quoted string below comes from it unless marked "our string". The file is compiled message ASTs; flatten it once with a small throwaway script (outside the repo) and grep: the groups to read are `RenderWeek.*`, `CalendarDaily.*`, `CalendarView.*`, `components.RootDailyNote.*`, `components.RootTask.*`, `RootTask*` (`RootTaskCheckbox`, `RootTaskDeadlinePicker`, `RootTaskFastCreation`, `RootTaskPriorityToggle`), `DatePicker.recurrence*`, `DatePicker.reminder*`, `DatabaseDashboard.sections.tasks.*`, `DatabaseDashboard.sections.dailyNotes.*`, `StructureSpecificSettings.calendarSettings.*`, `StructureSpecificSettings.dailyNoteReviewing.*`, `DateOptions.*`, `shortcuts.setViewTo*`.
- Behaviour not in the strings: `RootEntity36682.js` (grep `RenderDay`, `DailyNoteReviewedStatus`: weekday colours, Today pill, week number rule, the "+ Daily Note" button) and `LocationManager36682.js` (grep `CalendarMainChrome`, `calendar.daily`, `tasksViewDefinition`, `createdOnDayViewDefinition`: the view tabs, the pager, the daily section list and its hide flags). Shortcut keys: grep the bundle for `calendar.goToToday`, `calendar.goToNext`, `calendar.goToPrevious`, `calendar.setViewToMonth|Week|Rolling|Day`, and bind the same keys.
- Visual: `docs/01-calendar-day.png` (Day view, mini month), `02-calendar-three-days.png`, and the "Calendar (01, 02)" section of `docs/README.md`. **Not visible in any screenshot:** the Week view, the Month view, and how a daily-note day is marked in the mini month. Those are our rendering (marked below) and are the first things Gene compares at acceptance.

## Roadmap (one plan per milestone, written when the previous one is accepted)

| M | Delivers |
|---|---|
| 1 (accepted) | shell, objects on disk, page + peek, block editor with byte preservation, wikilinks, external changes |
| 2 (accepted) | object types and all property kinds, type settings and page layouts, title edit and relink, change type, templates, tags as objects, trash |
| 3 (built) | views, filters, sorts, group-by, collections, queries, pinned, All notes |
| **4 (this plan)** | calendar, daily notes, tasks (status categories, priority, date, deadline, recurrence, reminders); Task dashboard sections; "Scheduled" date grouping; recurring/reminder filters |
| 5 | SQLite FTS index, Ctrl+K, backlinks (the Task "Context" section), graph |
| 6 | whiteboards and pen |
| 7 | remaining blocks, light mode, a Settings modal (reminder toggle lives there), polish |

## Global Constraints

**Carried forward from M1, M2 and M3** (all of them, unchanged):
- **Server and toolchain:** `127.0.0.1:8790`, no outbound network, Python `>=3.13` with uv, Node `>=22`. Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Opening never writes an object file.** M4 adds none: opening, `GET /api/calendar`, the daily note index and the reminder scheduler write nothing to an object. Today's daily note is **not** created on open or on visiting the Calendar; only the "+ Daily Note" button (or a quick action that links to a day, M5+) creates one. The scheduler writes only `.object-cache/reminders.json`, and only when it fires a reminder (a per-machine cache, git-ignored with the rest of that folder).
- **Writes:** every object write goes through `Space._write`; rewrites of *other* files are unstamped; writes are atomic and keep EOL/BOM/trailing newline; destructive confirmations use 428. A route that writes announces `ChangeEvent(origin=clientId)` for each path it wrote.
- **Type files are not written on open.** The Task type's added fields (below) exist in memory from load and reach `task.json` the first time that type is persisted (M2's lazy `_persist_type`, e.g. creating a Task, or saving the type).
- **Definition files and `ui.json`** follow M3: `JsonStore`/`uistate.patch_ui`, revisions, 409 on a stale `baseRevision`, 423 on an unreadable file.
- **Tests:** baseline is master after M3 Task 16. Every task keeps all earlier tests green. M4 backend tests use their own synthetic space (`space-calendar`, Task 1), never assert absolute fixture counts where `len(space.list())` can be compared instead, and inject the clock (`now`) and the time zone; no test depends on the machine's date or zone.
- **Fidelity.** Labels, icons, option keys, defaults and orders come from the reference extract. A string marked "our string" has no Object original; every other quoted string must be found verbatim in `strings.txt`.

**New in M4**
- **Start condition.** M3 accepted on master. This plan cites M3 by task number and by the interfaces in `2026-10-26-m3-views-collections-queries.md`; at the start of Task 1 re-read what M3 actually built (`jsonstore.py`, `uistate.py`, `rows.py`, `views/*`, `types/*`, `shell/Sidebar.tsx`, `nav/tabs.ts`, `App.tsx`) and fix names in this plan that drifted, in the plan, before building.
- **Storage (spec §4 conventions; nothing new in object bodies).**

  | What | Where | Written by |
  |---|---|---|
  | Daily note | `DailyNotes/YYYY-MM-DD.md` with `type: 'DailyNote'`, `title: YYYY-MM-DD`, `date: YYYY-MM-DD`, `reviewed: true\|false`, M1's `createdAt`/`lastUpdated` (the shape of the existing fixture `DailyNotes/2026-10-23.md`) | `POST /api/daily-notes`, `PUT /api/object/properties` (`reviewed`) |
  | Task fields | frontmatter keys of the Task type: `status`, `priority`, `date`, `deadline`, `completed`, `repeat`, `remind` | `PUT /api/object/properties` |
  | Calendar and task view preferences (week start, section hide flags, section views, Tasks page tab and views, reminders on/off) | `.object/ui.json` keys `calendar`, `tasks`, `reminders` | `PUT /api/ui` |
  | Type calendar options | the type JSON keys M2 already round-trips: `createInCalendarOption` (`'disabled'` \| `'createOnce'` \| absent = show), `hideFromCalendarSidebar`; the property key `hideCalendarEvents`; and our key `hideReviewing` on the DailyNote type | `PUT /api/types/{id}` |
  | Fired-reminder ledger | `.object-cache/reminders.json` | the scheduler |
  | The selected calendar view and day | `localStorage` (a per-viewer convenience, never needed to render) | the client |

- **Task fields** (the Object `RootTask` set; names, icons and options from `basicStructures.ts`). The basic Task type has these definitions in memory (added by `topup_task_type`, Task 3, only for keys it does not already have, so a type that already has `priority` or `deadline` from an export keeps its own definition and option set):

  | key | kind | notes |
  |---|---|---|
  | `status` | label, `isStatus` | options Not Started (red, not-started), Next Up (yellow, not-started), In Progress (blue, in-progress), On Hold (pink, blocked), Done (green, done); M2 already infers this set. An existing set is never replaced. |
  | `priority` | label | Low (amber), Medium (orange), High (red); icon `ph-flag` |
  | `date` | `datetimeSimple`, `resolutionPreference: 'day'`, `endTimeSettings: 'notAllowed'`, `supportsReminders: true` | "Date": when to work on it; icon `ph-calendar`; carries `repeat` and `remind` |
  | `deadline` | `datetimeSimple`, day preference, no end | "Deadline"; icon `ph-hourglass-medium` |
  | `completed` | `datetimeSimple`, `resolutionPreference: 'time'`, visibility `hidden` | "Completed"; written by the status hook only |
  | `repeat` | `text`, visibility `hidden` | the text form below |
  | `remind` | `text`, visibility `hidden` | the text form below |

  `repeat` and `remind` have no cell of their own in the property panel: the date picker edits them together with `date` in one `updateProperties` call.
- **Status categories** are the four of `LabelOption.statusCategory`: `not-started`, `in-progress`, `blocked`, `done`, in that order, labelled "Not started", "In progress", "Blocked", "Done" (`RootTaskCheckbox.menu.statusGroup.*`). **Open** means the status is not in the `done` category; a task with no status is open (and "Inbox"). The checkbox toggles between the first `not-started` option and the first `done` option.
- **`repeat` text form** (one line; hand-editable; case and spacing are forgiven on read, the canonical form is written):

  ```
  every day | every 2 weeks | every weekday | every month after completion | every 3 months until 2027-06-30
  every [N] (day|week|month|year)[s] [after completion] [until YYYY-MM-DD]      N is an integer >= 1; N = 1 is written without the number and with the singular unit
  every weekday [until YYYY-MM-DD]                                              Monday to Friday; no N, no "after completion"
  ```

  Without "after completion" the mode is **by due date** (`schedulingMode: 'dueDate'`: the fixed schedule, "Repeats on a fixed schedule relative to the due date, regardless of when you complete the task."); with it **by completion date** (`'completionDate'`: "The next occurrence is scheduled relative to when you actually complete the task."). A `repeat` that does not parse, or that has no `date` beside it, is **ignored** (kept in the file, shown as plain text in the picker with the hint "Not a valid repeat." (our string), and the task completes normally).
- **`remind` text form** (the reminder only applies to the Task's `date`, and only when it parses *and fits the date's resolution*; otherwise it is ignored like an invalid `repeat`):

  ```
  time dates (date has a time):   at time | N minutes before | N hours before       N >= 1; both forms are read; canonical output is "N minutes before" below 60 or when not a multiple of 60, else "N hours before" (so 60 is written "1 hour before")
  day dates (date is a day):      on the day at HH:mm | 1 day before at HH:mm | N days before at HH:mm
  ```

  Parsed form: `{minutesBefore, daysBefore, timeOfDay?}` (Object's `Reminder` without `active`, which is simply "the key is present").
- **Shared test vectors.** Both tracks test the two text forms against the same table (Task 2 backend, Task 8 frontend; the table below is the source and is copied into each test file):

  | text | parsed |
  |---|---|
  | `every day` | `{every:1, unit:'day', mode:'dueDate'}` |
  | `Every  2 Weeks` | `{every:2, unit:'week', mode:'dueDate'}`, canonical `every 2 weeks` |
  | `every weekday` | `{every:1, unit:'weekday', mode:'dueDate'}` |
  | `every month after completion` | `{every:1, unit:'month', mode:'completionDate'}` |
  | `every 3 months until 2027-06-30` | `{every:3, unit:'month', mode:'dueDate', until:'2027-06-30'}` |
  | `every 0 days`, `every -1 week`, `weekly`, `every 2 fortnights`, `every 2 weekdays`, `every weekday after completion`, `every day until 2027-13-01` | invalid |
  | `at time` | `{minutesBefore:0, daysBefore:0}` (time dates) |
  | `15 minutes before`, `1 hour before` | `{minutesBefore:15}`, `{minutesBefore:60}` |
  | `on the day at 09:00` | `{daysBefore:0, timeOfDay:'09:00'}` |
  | `1 day before at 18:30`, `3 days before at 08:00` | `{daysBefore:1, timeOfDay:'18:30'}`, `{daysBefore:3, timeOfDay:'08:00'}` |
  | `on the day`, `2 days before`, `at 9:00`, `15 minutes before at 09:00`, `0 minutes before`, `on the day at 25:00` | invalid |

- **Recurrence semantics** (`recurrence.py`, mirrored only for display in the client; the server is the single owner of "what happens on completion"):
  - Completing an open task with a valid `repeat` and a `date` does **not** leave it done: the write sets `date` to the next occurrence, resets `status` to the first `not-started` option, sets `completed` to the completion time, and keeps everything else. There is no occurrence log, streak or stats (deferred).
  - **By due date:** the next occurrence is the first date in the series `current + k × (every unit)`, k ≥ 1, that is on or after today (missed occurrences are skipped silently; Object asks, we don't). `weekday` steps to the next Monday–Friday day after `current`, then to one on or after today. **By completion date:** the next occurrence is the completion's local day plus the interval; a time-resolution date keeps its local time of day.
  - Months and years add calendar units and clamp to the month's last day (31 Jan + 1 month = 28/29 Feb); each step is computed from the *current* date, so a task that clamped stays on the clamped day (documented drift, deferred).
  - `until`: when the next occurrence would be after `until`, the recurrence has ended: the task completes normally (becomes done, `repeat` kept).
  - A time-resolution `date` does its arithmetic on the **local wall clock** (so 09:00 stays 09:00 across a DST change) and is stored back as UTC `…Z` like every M2 datetime.
  - Reopening a done task (status leaves the `done` category) clears `completed`. It never rewinds a recurrence.
- **Calendar semantics.**
  - **Local days.** `createdAt`, `lastUpdated`, time-resolution dates and `completed` are UTC in the files; the calendar converts them to the machine's local zone before taking the day. Day-resolution dates are days, as written.
  - **Daily note identity.** A DailyNote's day is its `date` value, else its `title` when that is `YYYY-MM-DD`, else its file stem when that is. If two notes claim a day, the first by path wins and the range response lists the others under `warnings`.
  - **Objects with this date** (`dated`): every object (except templates) with a `datetime`/`datetimeSimple` property value that covers the day (a range covers every day from start to end), except: properties with `hideCalendarEvents`, types with `hideFromCalendarSidebar`, DailyNote's own `date`, and the Task type's `date` and `deadline` (those are the Tasks section).
  - **Tasks of a day**: open or done tasks whose `date` covers the day (`kind:'date'`); tasks whose `deadline` is the day (`'deadline'`); virtual future occurrences of open recurring by-due-date tasks (`'occurrence'`, never duplicating the real `date`); and on **today only**, open tasks whose `date` is before today (`'overdue'`, "Overdue ({count})", with `day` = their own date). A past day lists the tasks that were on it (so "N done" works).
  - **Created / Updated:** objects (not templates, not DailyNote) with `createdAt` / `lastUpdated` on the day; Updated leaves out objects also created that day.
  - **Quick-create chips** (under the Day header): the types that have a date property, minus `createInCalendarOption: 'disabled'`, minus `'createOnce'` types that already have an object whose first date property is that day. Clicking one creates an object with its first date property set to the day (`values`, M3 Task 4's `POST /api/objects`).
- **Reminders.** Local only: a scheduler thread, started with the app and stopped with it, checks every 30 s; a reminder fires when its trigger time falls in `(lastCheck, now]`, or, once at start-up, when it fell in the last 12 hours and the ledger has no entry (the app was closed). It fires one OS notification (title: the task's title; body: "Due {date}" / "Due today" (our strings)). Done tasks and tasks whose `date` is empty never fire. For a recurring task the trigger is computed from its current `date`, so completing it re-arms the next one. The ledger key is `path|date|trigger`; entries older than 30 days are dropped. Object's limits apply and are stated in the UI: reminders show only while Object is running. A global `ui.json` `reminders.enabled` (default true) switches the scheduler off; its toggle waits for the Settings modal (M7).
- **Not in M4** (recorded so they are not rebuilt by accident): the occurrence log, completion stats and Excuse/Skip (`RootTaskCheckbox.menu.skipRecurrence`, `components.RootTask.habitStats`), custom weekday and "second Tuesday" rules (`DatePicker.recurrenceCustom.on`), the overdue catch-up dialog (`RecurringTaskOverdueModal`), Task "Context"/backlinks (`DatabaseDashboard.sections.tasks.source`, M5), task actions and calendar integrations (network), reminders on dates other than the Task `date` (`supportsReminders` stays store-only elsewhere), to-do blocks in the editor as task objects (`components.RootTask.turnBlockIntoTaskObject`), the Timeline and "Date references" sections of the Day view (they need M5's references), and the `{date}`/link shortcuts of the slash menu (`ControlDropdown.custom.entity_dailyNote_*`, M7).

## API contract (M4): shared by both tracks

```
RepeatRule   { every: number, unit: 'day'|'week'|'weekday'|'month'|'year', mode: 'dueDate'|'completionDate', until?: 'YYYY-MM-DD' }
ReminderRule { minutesBefore: number, daysBefore: number, timeOfDay?: 'HH:mm' }
Row.values   /* M3: gains the Task keys decoded as above; `repeat` and `remind` are the raw text ('' when absent) */
CalendarRange { from, to /* YYYY-MM-DD, inclusive */, today /* the server's local day */,
                days: { [day]: CalendarDay }, summaries: { [path]: ObjectSummary }, warnings: { day, paths: string[] }[] }
CalendarDay  { dailyNote: { path, reviewed: boolean } | null,
               tasks: TaskEntry[], dated: DatedEntry[], created: string[], updated: string[] }
TaskEntry    { path, kind: 'date'|'deadline'|'occurrence'|'overdue', day: 'YYYY-MM-DD' /* the date this entry stands for */, done: boolean }
DatedEntry   { path, key, start, end?, resolution: 'day'|'time' }
TaskResult   { completed: boolean, advanced: boolean, date?: DateValue /* the new date after an advance */ }   /* on UpdateResult, only when a Task's status changed category */
CalendarUi   { weekStart: 'sunday'|'monday', daily: { hideDailyNote?, hideTasks?, hideDated?, hideCreated?, hideUpdated?,
                 tasksView?: ViewState, createdView?: ViewState, updatedView?: ViewState, datedView?: ViewState } }
TasksUi      { activeTab: TaskSectionKey, views: { [TaskSectionKey]: ViewState } }
TaskSectionKey = 'status'|'today'|'inbox'|'open'|'deadline'|'scheduled'|'recurring'|'reminders'|'tags'|'completed'
UiState     += { calendar?: CalendarUi, tasks?: TasksUi, reminders?: { enabled: boolean } }
Target      += { kind: 'calendar' } | { kind: 'tasks' }
ChangeEvent.kind: unchanged (a daily note is `created`; completing a task is `changed`)
```

| Route | Request | Success | Errors |
|---|---|---|---|
| `GET /api/calendar?from=&to=` | | `CalendarRange` (at most 100 days) | 422 |
| `POST /api/daily-notes` | `{date, templateId?: string\|null\|'none', clientId?}` | 201 `{path, version}` | 409 `{detail, path}` (a note for the day exists), 422, 404 template |
| `PUT /api/object/properties` (extended) | as M2; a Task `status` update runs the Task hook | `UpdateResult` + `task?: TaskResult`; `frontmatter` holds every key the hook also wrote (`date`, `completed`) | as M2 |
| `GET /api/ui` · `PUT /api/ui` (extended) | the patch accepts `calendar`, `tasks`, `reminders` | as M3 | 409, 423 |

- The status hook is the only place that completes, reopens or advances a task; no separate `complete` route exists. Kanban drags, the checkbox, the status cell and the day sections all go through `updateProperties`.
- `POST /api/rows` (M3) is how the client gets cards for `CalendarDay` paths: `api.rows({paths})`.
- Time and zone are injectable on the server (`Space.clock`, `Space.tz`, defaults: the system clock and zone) and are used by the status hook, the calendar query and the scheduler alike.

## Review Focus

1. **Completion and recurrence are exact and minimal.** A completion writes `status`, `completed` and (recurring) `date` plus `lastUpdated`, in one write, never the body or other keys. By-due-date and by-completion-date, month clamping, `weekday`, `until`, time-of-day across DST, and "missed occurrences are skipped" all match the semantics above; an invalid `repeat` or a missing `date` completes the task normally; reopening clears `completed` only.
   - *(Task 2: `test_next_by_due_date`, `test_month_end_clamp`, `test_weekday_skips_weekend`, `test_completion_mode_from_completion_day`, `test_until_ends_recurrence`, `test_time_keeps_local_wall_clock_across_dst`; Task 3: `test_complete_recurring_advances_in_one_write`, `test_complete_nonrecurring_sets_completed`, `test_invalid_repeat_completes_normally`, `test_reopen_clears_completed_only`, `test_status_hook_touches_only_expected_keys`)*
2. **Opening and viewing write nothing.** The calendar GET, the daily note index, `GET /api/rows` over Tasks and the scheduler's idle ticks change no file; visiting the Calendar never creates today's note; the only scheduler write is the ledger, only when a reminder fires.
   - *(Task 5: `test_calendar_get_writes_nothing`, `test_open_twice_writes_nothing` extended; Task 4: `test_no_daily_note_created_on_open`; Task 6: `test_idle_tick_writes_nothing`, `test_firing_writes_only_ledger`)*
3. **One daily note per date, with the right file.** Creation is `DailyNotes/<date>.md` with `title`, `date`, `reviewed: false`; a second creation for the day is a 409 carrying the existing path (also when two clients race); a template's body and values are applied but title and date are not overridden; duplicates found on disk are reported, not merged or deleted.
   - *(Task 4: `test_create_daily_note_shape`, `test_second_create_409_with_path`, `test_concurrent_create_one_file`, `test_template_applied_title_date_kept`, `test_day_from_date_title_or_stem`, `test_duplicates_reported`)*
4. **The calendar query is correct at the edges.** Local-day conversion (a `23:30Z` object on the next local day in a +2 zone), date ranges, hidden properties and types, the overdue rule (today only, open only), virtual occurrences not duplicating the real date, createOnce chips, a 5,000-object space answering a month in under 300 ms.
   - *(Task 5: `test_created_uses_local_day`, `test_range_covers_each_day`, `test_hidden_property_and_type_excluded`, `test_overdue_only_today_and_open`, `test_occurrences_not_duplicated`, `test_range_over_100_days_422`, `test_month_5000_objects_under_300ms`)*
5. **Reminders stay local and fire once.** No socket is opened; the notifier is injected; a reminder fires once across restarts (ledger), fires after a short outage once, never for done tasks, re-arms after a recurring completion, and stops when the app stops.
   - *(Task 6: `test_fires_once_across_restart`, `test_catch_up_window_12h`, `test_done_task_never_fires`, `test_recurring_rearms_after_completion`, `test_no_network_import`, `test_stop_joins_thread`)*
6. **The UI writes safely.** Checkbox, kanban drop and picker edits call `updateProperties` with the row's version and patch from the returned frontmatter; a 409 reloads the row and never retries blindly; a recurring completion shows what happened (the new date) instead of silently re-opening the task.
   - *(Task 8: `test checkbox completes with row version`, `test 409 reloads without retry`, `test recurring completion toast shows next date`; Task 9: `test picker writes date repeat remind in one call`; Task 11: `test kanban drop to a category writes first status of the category`)*
7. **It reads the same as Object.** Week numbers (including the Sunday rule), weekday colours, Today pill, the segmented control, the pager, the section order and every quoted string match the reference; the three views Object's screenshots don't show are listed for Gene's check.
   - *(Task 12: `test week number with Sunday start`, `test weekday colours`; Task 13: `test section order and tabs`; Task 16 Step 5)*

---

## File Structure

```
backend/objectapp/  taskmodel.py recurrence.py dailynotes.py calendar.py reminders.py notify.py                  NEW
                    typemodel.py space.py server.py uistate.py templates.py (if the DailyNote template rule lives there)  MOD
backend/tests/      fixtures/space-calendar/   conftest.py (MOD: `calendar_space_dir`)
                    test_{taskmodel,recurrence,taskhook,dailynotes,calendar,reminders}.py
scripts/m4_acceptance.py
frontend/src/api/{types,client}.ts  test/mockApi.ts  nav/tabs.ts  App.tsx  shell/Sidebar.tsx                    MOD (Task 7 only)
frontend/src/tasks/  statusCategory.ts repeat.ts remind.ts taskActions.ts TaskCheckbox.tsx DeadlineLabel.tsx
                     RepeatMenu.tsx CustomRepeatDialog.tsx ReminderMenu.tsx
                     TasksPage.tsx taskSections.ts QuickAddTask.tsx
frontend/src/views/{filter,group,model}.ts                                                                      MOD (Task 10 only)
frontend/src/properties/{DatePicker.tsx,cells/DateCell.tsx}                                                     MOD (Task 9 only)
frontend/src/types/TypePage.tsx                                                                                 MOD (Task 11 only)
frontend/src/calendar/ dates.ts useCalendar.ts CalendarPage.tsx CalendarChrome.tsx CalendarSidePanel.tsx MiniMonth.tsx
                       DayView.tsx DayHeader.tsx DaySections.tsx DailyNoteSlot.tsx QuickCreateChips.tsx
                       ThreeDaysView.tsx WeekView.tsx MonthView.tsx useCalendarRange.ts
frontend/src/object/ObjectView.tsx                                                                              MOD (Task 13 only)
frontend/src/types/{TypeSettings.tsx,TemplateManager.tsx,dashboardSections.ts,TypeOverview.tsx}                 MOD (Task 15 only)
```

### Shared files and ordering

| File | Edited by | Why it forces order |
|---|---|---|
| `backend/objectapp/space.py`, `server.py` | Tasks 3, 4, 5, 6 | one backend track, so strictly in that order; `typemodel.py`: Task 3; `uistate.py` + the ui route model: Task 5; `server.py` lifespan: Task 6 |
| `frontend/src/api/{types,client}.ts`, `test/mockApi.ts`, `nav/tabs.ts`, `App.tsx`, `shell/Sidebar.tsx` | **Task 7 only** (stubs for the pages; later tasks replace the stub files they own) | Task 7 must land before any of Tasks 8–15; after it no task touches these files |
| `calendar/CalendarPage.tsx`, `calendar/CalendarSidePanel.tsx`, `tasks/TasksPage.tsx` | stubs by Task 7, replaced in full by Tasks 12 and 11 | the owner overwrites the stub |
| `properties/DatePicker.tsx`, `properties/cells/DateCell.tsx` | Task 9 only | |
| `views/filter.ts`, `views/group.ts`, `views/model.ts` | Task 10 only (Task 11 needs its output) | |
| `types/TypePage.tsx` | Task 11 only; `types/{TypeSettings,TemplateManager,dashboardSections,TypeOverview}.tsx` Task 15 only | M3's files; M4 extends, never reorders |
| `object/ObjectView.tsx` | Task 13 only (`mode: 'inline'`) | |

Dependency edges inside the frontend: Task 7 → everything; Task 8 → Tasks 9, 11, 13; Task 10 → Task 11; Task 12 → Tasks 13, 14; Task 13 → Task 14 (it reuses the day sections); Task 15 is independent of 13–14. So the two sub-tracks run in parallel after Task 7 with one cross-edge, Task 8 → Task 13.

---

### Task 1: Fixtures, `space-calendar` (track: backend)

**Files:**
- Create: `backend/tests/fixtures/space-calendar/**`, `backend/tests/test_fixtures_m4.py`
- Modify: `backend/tests/conftest.py` (adds `calendar_space_dir`; the existing fixtures and `M2_FOLDERS` are untouched)

**Interfaces:**
- Produces: a synthetic, self-contained space for every M4 backend test. Nothing here touches `space-sample` or `space-v1`, so no earlier count changes.

The space (all content invented):
- `.object/types/`: `task.json` (the Task type *with* the M4 fields written out, so tests can also load a type that already has them), `dailynote.json`, `page.json`, `meeting.json` (a custom type with a `when` datetime property, a `datetime` range property `span`, and `hideCalendarEvents: true` on a second datetime `internalStamp`), `person.json`, `tag.json`, `event.json` (a custom type whose type JSON has `hideFromCalendarSidebar: true` and a `when` property).
- `DailyNotes/`: `2026-10-21.md`, `2026-10-22.md` (`reviewed: true`), `2026-10-23.md`, and `Odd name.md` (no `date`, title `2026-10-25`) plus `2026-10-23 copy.md` (a duplicate of the 23rd, to exercise `warnings`).
- `Tasks/`: open and done tasks, covering: a plain dated task; a task with `deadline` only; `repeat: every week` (due-date mode) with `remind: 1 day before at 09:00`; `repeat: every 3 days after completion`; a monthly task on `2026-01-31`; `repeat: every weekday`; a recurring task with `until`; a task with an invalid `repeat: weekly`; a task with `repeat` but no `date`; a time-resolution task (`date: 2026-10-23T08:30:00.000Z`, `remind: 15 minutes before`); an overdue open task (`date: 2026-10-14`); a done task on `2026-10-22`; one with `priority: High`; one with no status.
- `Meetings/`, `Events/`, `Pages/`, `People/`, `Tags/`: objects whose `createdAt`/`lastUpdated` straddle local midnight in a +02:00 zone (`2026-10-23T22:30:00.000Z` is the 24th locally), a range `span: 2026-10-26 -> 2026-10-28`, a hidden-property object, a hidden-type object, a template under `Templates/DailyNotes/Standup.md`.
- `ui.json` is **absent** (defaults read as `{}`).

- [ ] **Step 1: Write failing tests** (`test_fixtures_m4.py`)
  - `test_every_md_has_frontmatter_and_unique_paths`
  - `test_space_opens_without_writing`: open twice; no file changed.
  - `test_expected_inventory`: the set of task `repeat`, `remind`, `date`, `deadline` values listed above is present (so later tests can rely on them).
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_fixtures_m4.py -q`. Expected: FAIL.
- [ ] **Step 3:** Write the files (LF, `.gitattributes` like the other fixture spaces) and the `calendar_space_dir` fixture (a `shutil.copytree` into `tmp_path`).
- [ ] **Step 4:** Run `uv run pytest -q`. Expected: PASS.
- [ ] **Step 5:** Commit `test(fixtures): synthetic calendar and tasks space`.

### Task 2: `repeat`/`remind` text forms and recurrence arithmetic (track: backend)

**Files:**
- Create: `taskmodel.py`, `recurrence.py`
- Test: `test_taskmodel.py`, `test_recurrence.py`

**Interfaces:**
- Consumes: nothing from `Space` (pure; stdlib `datetime` only).
- Produces:
  - `taskmodel.parse_repeat(text) -> RepeatRule | None`, `format_repeat(rule) -> str` (canonical), `parse_remind(text, resolution: 'day'|'time') -> ReminderRule | None`, `format_remind(rule, resolution) -> str`. Both parsers return `None` for anything that is not valid, never raise.
  - `recurrence.next_date(rule, current: date | datetime, completed_at: datetime, today: date, tz: tzinfo) -> date | datetime | None`: the next occurrence per Global Constraints, or `None` when `until` ends the series. `current` is a `date` for day resolution, a UTC-aware `datetime` for time resolution; the result has the same kind.
  - `recurrence.occurrences(rule, current, start: date, end: date, tz, limit=366) -> list[date | datetime]`: the by-due-date series after `current` inside `[start, end]` (empty for completion mode, whose next date is unknown until completion).
  - `reminders_due`-style helpers live in Task 6, not here.

- [ ] **Step 1: Write failing tests**
  - `test_parse_repeat_vectors` and `test_parse_remind_vectors`: the shared table from Global Constraints, row for row, plus `format_*` round trips of every valid row (`format_repeat(parse_repeat("Every  2 Weeks")) == "every 2 weeks"`).
  - `test_remind_resolution_mismatch_is_none`: `on the day at 09:00` with `'time'` and `15 minutes before` with `'day'` → `None`.
  - `test_next_by_due_date`: weekly from 2026-10-14 completed on 2026-10-23, today 2026-10-23 → 2026-10-28 (the first Wednesday on or after today), not 10-21.
  - `test_next_by_due_date_future_task_completed_early`: current 2026-11-04, today 2026-10-23, weekly → 2026-11-11.
  - `test_month_end_clamp`: monthly from 2026-01-31 → 2026-02-28; from 2028-01-31 → 2028-02-29; yearly from 2024-02-29 → 2025-02-28.
  - `test_weekday_skips_weekend`: from Friday 2026-10-23 → Monday 2026-10-26; from Saturday 2026-10-24 (a manually set weekend date) → Monday.
  - `test_completion_mode_from_completion_day`: every 3 days after completion, completed 2026-10-23 → 2026-10-26, regardless of `current`.
  - `test_until_ends_recurrence`: `until 2026-10-30`, next would be 11-04 → `None`; next on exactly the until day is kept (inclusive).
  - `test_time_keeps_local_wall_clock_across_dst`: with `Europe/Berlin` fixed through `zoneinfo` (skipped with a clear reason when tzdata is missing), daily 09:00 local across 2026-10-25 stays 09:00 local, so UTC changes from 07:00Z to 08:00Z.
  - `test_occurrences_window`: weekly series inside a 4-week window; completion mode → `[]`; `limit` caps.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_taskmodel.py backend/tests/test_recurrence.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement. Month arithmetic is a small helper (year/month overflow, day clamp), not `dateutil`.
- [ ] **Step 4:** Run `uv run pytest -q`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): task repeat and reminder text forms and recurrence arithmetic`.

### Task 3: Task fields and the status hook (track: backend)

**Files:**
- Modify: `typemodel.py` (`topup_task_type`), `space.py` (clock and zone, the hook in `update_properties`, `UpdateResult.task`), `server.py` (the response)
- Test: `test_taskhook.py`, `test_typemodel.py` (new cases)

**Interfaces:**
- Consumes: Tasks 1–2; M2's `update_properties` (`apply(src, fm)`), `PropertyDefinition`, `status_category`, `LabelOption`, `_persist_type`.
- Produces:
  - `typemodel.topup_task_type(t: TypeDefinition) -> TypeDefinition`: in memory, for the basic Task type only, appends the definitions from the Task fields table for each key the type lacks (an existing `priority`, `date`, … is kept untouched), after the existing user properties. Called wherever a type is built or reloaded (the same seam as M2's migration; `refresh_type` and `_stored_type` go through it). It never marks the type dirty and never writes.
  - `Space.clock: Callable[[], datetime]` and `Space.tz: tzinfo`: defaults `lambda: datetime.now(UTC)` and the system zone (`datetime.now().astimezone().tzinfo`); tests set them.
  - `taskhook.on_status_change(t, fm, sets, removals, clock, tz) -> TaskResult | None` (in `space.py` or a small `tasks.py`; the builder picks, one place): called inside `update_properties.apply` after the generic encoding when the type is the basic Task type and `sets` contains the status key. It computes the category before and after (an unknown option text counts as `not-started`) and, in the same write:
    - into `done`, with a valid `repeat` and a `date`, and not ended by `until`: `date` ← `recurrence.next_date(...)` (encoded with the M2 date codec in the form the line already uses), `status` ← the first `not-started` option, `completed` ← now; `TaskResult(completed=True, advanced=True, date=…)`;
    - into `done` otherwise: `completed` ← now; `TaskResult(completed=True, advanced=False)`;
    - out of `done`: `completed` removed; `TaskResult(completed=False, advanced=False)`;
    - any other status change (same category): no extra key, no `TaskResult`.
    A caller that sets `date`, `repeat` or `completed` in the same update keeps its explicit value for that key (the hook only fills what the update left alone).
  - `UpdateResult.task: TaskResult | None`; the route returns it as `task` and the returned `frontmatter` includes the hook's keys.

- [ ] **Step 1: Write failing tests** (`calendar_space_dir`, `space.clock`/`space.tz` set)
  - `test_topup_adds_missing_task_fields_in_memory`: the fixture type minus its extra fields gains `priority`, `date`, `deadline`, `completed`, `repeat`, `remind`; `task.json` bytes are unchanged until the type is saved; a type that already defines `priority` keeps its own options.
  - `test_topup_not_applied_to_other_types`
  - `test_complete_nonrecurring_sets_completed`: status → Done on a dated task: `status`, `completed` (UTC, ms) and `lastUpdated` change, nothing else.
  - `test_complete_recurring_advances_in_one_write`: `repeat: every week` task, `date: 2026-10-14` → one version bump; `date` is the next Wednesday on or after today, `status` is Not Started, `completed` is now; the result says `advanced` with the new date; difflib of the file shows only those lines plus `lastUpdated`.
  - `test_complete_completion_mode_uses_completion_day`
  - `test_complete_recurring_until_ended_completes_normally`: the status stays Done, `date` unchanged.
  - `test_invalid_repeat_completes_normally` and `test_repeat_without_date_completes_normally`
  - `test_reopen_clears_completed_only`: Done → In Progress removes `completed`, writes the status; `date` and `repeat` untouched.
  - `test_same_category_change_no_extra_keys`: Not Started → Next Up changes only `status`.
  - `test_explicit_date_in_same_update_wins`
  - `test_status_hook_touches_only_expected_keys`: for every transition above, the set of changed frontmatter keys equals the expected set.
  - `test_other_types_unaffected`: a Page with a `status` key and a custom type with a status label get no hook.
  - `test_time_resolution_task_advances_keeping_time`
  - `test_put_properties_returns_task_result` (route).
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_taskhook.py backend/tests/test_typemodel.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces. The hook lives inside the existing `apply` so the single-write, conflict and read-only handling are M2's.
- [ ] **Step 4:** Run `uv run pytest -q`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): task fields and the status hook (completed, recurring advance)`.

### Task 4: Daily notes (track: backend)

**Files:**
- Create: `dailynotes.py`
- Modify: `space.py` (`create_daily_note`, `daily_note_day`, `daily_notes()`, `_templates_allowed` now allows DailyNote), `server.py`
- Test: `test_dailynotes.py`

**Interfaces:**
- Consumes: Tasks 1 and 3; `create_object`'s building blocks (`set_keys`, `_place`, `_template_edit`, `_find_template`), `_is_title_locked` (a DailyNote's title is already locked in M2).
- Produces:
  - `Space.daily_note_day(raw) -> str | None`: the identity rule from Global Constraints.
  - `Space.daily_notes() -> tuple[dict[str, str], list[tuple[str, list[str]]]]`: `{day: path}` (first by path wins) and the duplicates.
  - `Space.create_daily_note(day, template_id=None) -> (path, version)`: 422 for a malformed day (`InvalidValue`), `DailyNoteExists(path)` when the day has a note (checked and written under the space lock, with `_place`'s create-exclusive write as the second guard, so two clients racing produce one file). The file is `DailyNotes/<day>.md` (the DailyNote type's folder), frontmatter `id`, `type: 'DailyNote'`, `title: <day>`, `date: <day>`, `reviewed: false`, `createdAt`, `lastUpdated`; body empty. A template (explicit, or the type's default when `template_id` is `None`, `'none'` for none) contributes its body and any values for keys other than `title`, `date`, `id`, `createdAt`, `lastUpdated`.
  - M2's `_templates_allowed` lets the DailyNote type have templates (M2 listed it as "M4"); `list_templates`, `create_template`, the default template and the Type Settings templates group therefore work for it.
  - Route `POST /api/daily-notes` (see the contract); it announces `created` with `origin=clientId`. A `DailyNoteExists` is a 409 `{detail: "There is already a daily note for this day.", path}` (our string).

- [ ] **Step 1: Write failing tests** (`calendar_space_dir`)
  - `test_create_daily_note_shape`: a new day yields exactly the frontmatter above, an empty body, path `DailyNotes/2026-10-27.md`.
  - `test_second_create_409_with_path`: also for a day whose note has no `date` key (identified by title or stem).
  - `test_concurrent_create_one_file`: two threads create the same day; exactly one file exists and one caller gets the 409.
  - `test_malformed_day_422`: `2026-13-01`, `2026-1-5`, `today`, `''`.
  - `test_template_applied_title_date_kept`: the `Templates/DailyNotes/Standup.md` body and an extra value are applied, and the title and `date` stay the day.
  - `test_default_template_used_when_set` and `test_none_template_skips_it`
  - `test_day_from_date_title_or_stem`: `Odd name.md` (title `2026-10-25`) maps to the 25th; a note with neither is `None` and never indexed.
  - `test_duplicates_reported`: the fixture's copy of the 23rd is listed; the first by path is the one in the index.
  - `test_no_daily_note_created_on_open`: opening a space with no notes writes none.
  - `test_daily_note_title_stays_locked`: renaming one is refused as before.
  - `test_reviewed_toggle_is_a_property_write`: `reviewed: true` changes one line plus `lastUpdated`.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_dailynotes.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `uv run pytest -q`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): daily notes, one per date, with templates`.

### Task 5: Calendar range query and ui keys (track: backend)

**Files:**
- Create: `calendar.py`
- Modify: `space.py` (`Space.calendar(from_, to)`), `uistate.py` and the `PUT /api/ui` request model (accept `calendar`, `tasks`, `reminders`; unknown keys still kept), `server.py`
- Test: `test_calendar.py`; extend `test_open_twice_writes_nothing` (M3 Task 1) with `GET /api/calendar`

**Interfaces:**
- Consumes: Tasks 1–4; the in-memory `_raw`/`_summaries`, `decode_value`, `recurrence.occurrences`, `Space.clock`/`tz`, M3's `uistate.patch_ui`.
- Produces:
  - `Space.calendar(from_day, to_day) -> CalendarRange` per the contract and the "Calendar semantics" rules. One pass over the in-memory objects; no file reads. `summaries` holds an `ObjectSummary` for every path mentioned. At most 100 days (422 otherwise); `from_day > to_day` is 422.
  - `GET /api/calendar?from=&to=`.
  - `uistate`: the patch whitelist gains `calendar` (object), `tasks` (object), `reminders` (`{enabled: bool}`); a patch of the wrong shape is 422.

- [ ] **Step 1: Write failing tests** (`calendar_space_dir`, clock fixed at `2026-10-23T09:00:00Z`, tz `+02:00`)
  - `test_range_covers_each_day`: `days` has a key for every day in range, empty days have empty lists and `dailyNote: null`.
  - `test_daily_note_in_day`: `dailyNote.path`, `.reviewed` from the file; the odd-named note appears on the 25th; the duplicate is in `warnings`.
  - `test_dated_range_covers_each_day`: `span: 2026-10-26 -> 2026-10-28` appears on all three days with `start`/`end`.
  - `test_created_uses_local_day`: an object created `2026-10-23T22:30:00.000Z` is in `created` of the 24th, not the 23rd; `updated` omits objects also created that day; DailyNote and templates are in neither.
  - `test_hidden_property_and_type_excluded`: `hideCalendarEvents` on `internalStamp` and the Event type's `hideFromCalendarSidebar` keep them out of `dated`.
  - `test_task_date_and_deadline_not_in_dated`: they appear only in `tasks`, with the right `kind`.
  - `test_overdue_only_today_and_open`: the open task dated 2026-10-14 is `overdue` on 2026-10-23 only (with `day: '2026-10-14'`) and also a plain `date` entry on the 14th; a done old task is never overdue.
  - `test_occurrences_not_duplicated`: the weekly task shows real `date` on its day and `occurrence` entries on later weeks only; completion-mode recurring tasks produce none; `until` stops them.
  - `test_done_tasks_listed_with_done_flag`
  - `test_time_task_day_is_local`: `date: 2026-10-23T22:30:00.000Z` in +02:00 is on the 24th.
  - `test_range_over_100_days_422` and `test_from_after_to_422`
  - `test_calendar_get_writes_nothing`: the hash of every file is unchanged.
  - `test_month_5000_objects_under_300ms`: a generated in-memory space (built in the test, not a fixture) answers a 42-day range in under 300 ms (asserted with a generous 3× margin only in CI-slow mode via an env var; the default asserts 300 ms).
  - `test_ui_accepts_calendar_tasks_reminders_keys` (patch round trip, unknown keys kept, wrong shape 422, stale revision 409).
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_calendar.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `uv run pytest -q`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): calendar range query and calendar/tasks/reminders ui keys`.

### Task 6: Reminders (track: backend)

**Files:**
- Create: `reminders.py`, `notify.py`
- Modify: `server.py` (the scheduler starts in `lifespan` next to the watcher and stops with it)
- Test: `test_reminders.py`

**Interfaces:**
- Consumes: Tasks 2, 3, 5; `Space.clock`/`tz`; the `.object-cache/` folder; M3's `read_ui` (`reminders.enabled`).
- Produces:
  - `notify.Notifier` (a protocol: `send(title, body) -> None`), `notify.system_notifier() -> Notifier`: Windows runs `powershell.exe -NoProfile -NonInteractive -Command` with a WinRT toast script (the title and body passed as arguments, never interpolated into the script text); macOS `osascript`; Linux `notify-send`; anything else, or a failure to launch, logs once and does nothing. It never opens a socket.
  - `reminders.trigger_time(task, rule, tz) -> datetime | None`: UTC trigger from the Task's `date` and `remind` (time dates: `date − minutesBefore`; day dates: local `date − daysBefore days` at `timeOfDay`), `None` when the task is done, has no `date`, or the reminder is invalid or doesn't fit the resolution.
  - `reminders.due(space, since, now, ledger) -> list[Due]`.
  - `ReminderScheduler(space, notifier, interval=30.0)`: `.start()`, `.stop()` (joins the thread), `.tick(now)` (what the thread calls; directly testable). The first tick adds the 12-hour catch-up window. A fired reminder is recorded in `.object-cache/reminders.json` (atomic write) as `{"<path>|<date>|<trigger>": "<firedAt>"}`; entries older than 30 days are dropped on write. With `reminders.enabled` false it does nothing.
  - Title: the task's title; body: "Due today" or "Due {date}" (our strings), the date as the task's `date` in the viewer's locale-neutral ISO form.

- [ ] **Step 1: Write failing tests** (a fake notifier, a controllable clock, `calendar_space_dir`)
  - `test_trigger_time_time_and_day_dates`: the fixture's `15 minutes before` and `1 day before at 09:00` give the right UTC instants in +02:00.
  - `test_done_task_never_fires` and `test_invalid_or_mismatched_remind_ignored`
  - `test_fires_once_across_restart`: tick, build a new scheduler over the same space, tick again: one notification total.
  - `test_catch_up_window_12h`: started 3 h after the trigger → fires once; 13 h after → doesn't.
  - `test_recurring_rearms_after_completion`: completing the weekly task (Task 3 hook) moves `date`, and a later tick after the *new* trigger fires again.
  - `test_idle_tick_writes_nothing`: no files change, including `.object-cache/`.
  - `test_firing_writes_only_ledger`: only `.object-cache/reminders.json` appears; no object or `.object/` file changes.
  - `test_disabled_by_ui_flag`
  - `test_ledger_pruned_after_30_days`
  - `test_notifier_arguments_not_in_script`: the Windows script text is constant; a title containing quotes and `$(...)` reaches the process only as an argument.
  - `test_no_network_import`: importing `objectapp.reminders` and `objectapp.notify` leaves `socket`'s connect functions uncalled (a guard monkeypatches them to fail) and the modules import no HTTP client.
  - `test_stop_joins_thread`
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_reminders.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `uv run pytest -q`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): local reminders with OS notifications`.

### Task 7: API client v4, targets, sidebar and page stubs (track: frontend; first)

**Files:**
- Modify: `api/types.ts`, `api/client.ts`, `test/mockApi.ts`, `nav/tabs.ts`, `App.tsx`, `shell/Sidebar.tsx` (and `shell/Sidebar.test.tsx`, `nav/tabs.test.ts`)
- Create (stubs, replaced by later tasks): `calendar/CalendarPage.tsx`, `calendar/CalendarSidePanel.tsx`, `tasks/TasksPage.tsx`
- Test: `api/client.m4.test.ts`, new cases in `nav/tabs.test.ts` and `shell/Sidebar.test.tsx`, `App.m4.test.tsx`

**Interfaces:**
- Consumes: the API contract above; M3 Tasks 6 and 15 (`api` shape, `onOpenTarget`, `Sidebar`'s items).
- Produces:
  - TS types for every new contract shape; `DashboardSection.key` gains `'unreviewed'`; `TypeDef` gains optional `createInCalendarOption?: 'disabled'|'createOnce'`, `hideFromCalendarSidebar?: boolean`, `hideReviewing?: boolean`; `UpdateResult` gains `task?: TaskResult`.
  - `api.calendar(from, to)`, `api.createDailyNote(date, {templateId?})` (a 409 throws `DailyNoteExistsError` carrying `path`), and `api.updateProperties` returning `task`. `mockApi` defaults and the builders `calendarDay(partial)`, `calendarRange(partial)`, `taskEntry(partial)`.
  - `Target` adds `{kind:'calendar'}` and `{kind:'tasks'}`; `sameTarget` handles them; `App.tsx` renders `CalendarPage` and `TasksPage` (the stubs, "Loading results…" placeholders), `TabLabel` shows "Calendar" (`ph-calendar-blank`) and "Tasks" (`ph-check-circle`); the right panel renders `CalendarSidePanel` for the calendar target.
  - The Sidebar's Calendar and Tasks items (today `NavItem` with "arrives in M4" hints) become live: they open the targets through `onOpenTarget`, show the active state, and Ctrl+click opens a new tab. The hints are removed.

- [ ] **Step 1: Write failing tests**
  - `test calendar posts range query and returns days`
  - `test createDailyNote 409 throws DailyNoteExistsError with path`
  - `test updateProperties returns task result`
  - `test calendar and tasks targets open, go back, same target dedupes`
  - `test sidebar Calendar and Tasks items open targets and show active state` (no "arrives in M4" hint)
  - `test M3 sidebar items still present` (All notes, Queries, Pinned, M2's New, Trash)
  - `test tab labels for calendar and tasks`
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/api src/nav src/shell src/App.m4.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(shell): calendar and tasks targets, client v4 and live sidebar items`.

### Task 8: Task primitives: status categories, repeat and remind parsers, checkbox, actions (track: frontend, tasks)

**Files:**
- Create: `tasks/{statusCategory.ts,repeat.ts,remind.ts,taskActions.ts,TaskCheckbox.tsx,DeadlineLabel.tsx}`
- Test: `tasks/statusCategory.test.ts`, `tasks/repeat.test.ts`, `tasks/remind.test.ts`, `tasks/taskActions.test.ts`, `tasks/TaskCheckbox.test.tsx`, `tasks/DeadlineLabel.test.tsx`

**Interfaces:**
- Consumes: Task 7; M2 `cellValue`, `LabelPill`, `useTypeEditor`; M3 `useRows` (`patchRow`).
- Produces:
  - `STATUS_CATEGORIES` (order and labels), `categoryOf(row, type) -> StatusCategory`, `isOpen(row, type)`, `statusOptionsByCategory(type)`, `firstOptionOf(type, category) -> LabelOption|undefined`.
  - `parseRepeat`/`formatRepeat`/`describeRepeat(rule, date) -> string` ("Daily", "Weekly on {day}", "Monthly on day {date}", "Yearly on {date}", "Every weekday", "Custom": the `DatePicker.recurrencePreset.*` strings), `parseRemind`/`formatRemind` with the shared vectors.
  - `taskActions.setStatus(api, row, type, optionText) -> Promise<TaskOutcome>`: calls `api.updateProperties(row.path, {status: [text]}, row.version)`, returns the `TaskResult`, and reports `ConflictError` as "reload this row". `toggleDone(...)`: the checkbox's action (open → first done option, done → first not-started option). `completionToast(outcome) -> string | null`: `Moved to {date}` (our string) when `advanced`.
  - `<TaskCheckbox row type onChange?>`: the round checkbox; click toggles Open/Done; Ctrl/Cmd-click (or the caret) opens the menu "Status" with the options grouped by category (`RootTaskCheckbox.menu.statusGroup.*`), "Open" being the first not-started option (`RootTaskCheckbox.menu.status.open`); a done task shows the check and struck-through title where the caller asks.
  - `<DeadlineLabel deadline today>`: "1 day left", "{count} days left", months and years likewise, "Missed" (`RootTaskDeadlinePicker.*`); it also shows "Scheduled after deadline" when `date` is after `deadline`.

- [ ] **Step 1: Write failing tests**
  - `test repeat vectors` and `test remind vectors` (the shared tables, row for row; the same canonical outputs as the backend).
  - `test describeRepeat presets`: weekly from a Friday → "Weekly on Friday"; monthly from the 31st → "Monthly on day 31"; weekday → "Every weekday"; two weeks → "Custom".
  - `test categoryOf unknown status counts as not-started; no status is open`
  - `test checkbox completes with row version`: click → `updateProperties(path, {status:['Done']}, version)`; the row is patched from the returned frontmatter.
  - `test checkbox reopen goes to first not-started option`
  - `test menu groups options by category in order`
  - `test 409 reloads without retry`: one call, then `api.rows({paths:[path]})`, toast "Changed elsewhere. Reloaded." (our string, as M3 Task 10).
  - `test recurring completion toast shows next date`: `task.advanced` → "Moved to 2026-10-28" style message and the row shows the new date and an open status.
  - `test deadline label counts days, months, years; Missed`
- [ ] **Step 2:** Run `npx vitest run src/tasks`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(tasks): status categories, repeat and reminder parsers, checkbox and actions`.

### Task 9: Date picker: Repeat and Reminder (track: frontend, tasks)

**Files:**
- Create: `tasks/{RepeatMenu.tsx,CustomRepeatDialog.tsx,ReminderMenu.tsx}`
- Modify: `properties/DatePicker.tsx`, `properties/cells/DateCell.tsx` (only for the Task `date` property: `isTaskDate(type, def)`; every other date property is unchanged)
- Test: `tasks/RepeatMenu.test.tsx`, `tasks/CustomRepeatDialog.test.tsx`, `tasks/ReminderMenu.test.tsx`, new cases in `properties/DatePicker.test.tsx`

**Interfaces:**
- Consumes: Tasks 7–8; M2 `DatePicker`, `DateCell`, `CellProps`.
- Produces:
  - In the Task `date` picker: the quick suggestions ("Schedule task for today / tomorrow / the next week / the next month", the `DatePicker.suggestions.schedule.*` tooltips), a **Repeat** row (`DatePicker.recurrence`) with the presets "No repeat", "Daily", "Every weekday", "Weekly on {day}", "Monthly on day {date}", "Yearly on {date}", "Custom"; and, when `supportsReminders`, a **Reminder** row (`DatePicker.reminder.label`) with "No reminder" and the presets for the date's resolution (time dates: "At time of event", "{count} minutes before", "1 hour before"; day dates: "On the day", "1 day before", "{count} days before", plus a "Time" field with the suggestions Morning, Noon, Afternoon, Evening, Night).
  - `<CustomRepeatDialog>` "Custom repeat": "Every" N and a unit, "Based on" with "Scheduled date" and "Completed date" (their tooltips), "Ends" with "Never" or "On date (inclusive)", "Cancel", "Save".
  - The picker's output is one `onChange` that carries `{date, repeat, remind}`; `DateCell` turns it into **one** `updateProperties(path, {date, repeat, remind}, version)` (a cleared repeat or reminder removes the key). Removing the date removes `repeat` and `remind` with it.
  - An unparseable existing `repeat` shows as plain text with the hint "Not a valid repeat." (our string); a reminder that no longer fits the resolution shows "Doesn't fit this date." (our string) and is kept until the user changes it.
  - The first time a reminder is set on this machine, a one-time info toast: "Reminders show as system notifications while Object is running." (our string, after `NotificationsSettings.deliveryLimits.desktop.body`); remembered in `localStorage`.
  - Switching a task's date between day and time resolution drops a reminder that no longer fits (with the same hint) rather than rewriting it.

- [ ] **Step 1: Write failing tests**
  - `test picker writes date repeat remind in one call`: pick a day, "Weekly on Friday", "1 day before" with a time → one `updateProperties` call with `{date, repeat:'every week', remind:'1 day before at 09:00'}`.
  - `test no repeat and no reminder remove the keys`
  - `test removing the date removes repeat and remind`
  - `test non-task date properties show no Repeat or Reminder rows`
  - `test reminder presets follow resolution`: day date → "On the day"…; time date → "At time of event"…
  - `test custom repeat dialog saves every N unit, based on, ends` and `test completed date writes "after completion"; on date writes "until"`
  - `test invalid repeat shown with hint and kept`
  - `test changing resolution drops a mismatched reminder with a hint`
  - `test first reminder shows the one-time notice once`
- [ ] **Step 2:** Run `npx vitest run src/tasks src/properties`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(tasks): repeat and reminder in the task date picker`.

### Task 10: View engine additions for tasks (track: frontend, tasks)

**Files:**
- Modify: `views/group.ts`, `views/filter.ts`, `views/model.ts`, with their M3 tests extended
- Test: `views/group.test.ts`, `views/filter.test.ts` (new cases)

**Interfaces:**
- Consumes: M3 Task 7 (`FILTER_OPTIONS`, `matchFilter`), Task 8 (`GROUP_OPTIONS`, `groupRows`, `valueForGroup`, the date bucket labels), Task 6 (`LAYOUTS`); Task 8 above (`categoryOf`, `firstOptionOf`).
- Produces:
  - **Status category grouping:** for a label property with `isStatus`, `GROUP_OPTIONS` adds `statusCategory` ("By category", our string: Object groups the Tasks page by category without a named option). Groups are the four categories in order with the labels "Not started", "In progress", "Blocked", "Done"; an option with no category counts as not-started; "Other" (no status) joins Not started. `valueForGroup` for a category group returns `{key:'status', value:[firstOptionOf(category).text]}`; so kanban drops write the first status of the category. M3's `groupRows` `hideByDefault`/`hideEmptyGroups`/`manual` apply to it as to any group.
  - **"Scheduled" date grouping:** dates gain `scheduled` in `GROUP_OPTIONS` ("Scheduled"): one group per relative bucket in the order Overdue, Today, Tomorrow, This week, Next week, Later, "No date" last (bucket labels from `DateOptions.*`; "Later" and "No date" are our strings if the reference has none, check `DatabaseDashboard.sections.tasks.scheduled`).
  - **Filters:** `FILTER_OPTIONS` for dates adds `isRecurring` and `hasReminder` (M3 omitted them "until M4"), valid only when the property is the Task `date` (the label and negation follow the reference's `convolution.filter.options` strings: grep `isRecurring`, `hasReminder`); `matchFilter` evaluates them from the row's `values.repeat`/`values.remind` using Task 8's parsers (a `repeat` that doesn't parse is not recurring).
  - `LAYOUTS`, `FULL_VIEW_LAYOUTS` unchanged.

- [ ] **Step 1: Write failing tests**
  - `test status category groups in order with no-category and Other in Not started`
  - `test category group labels match reference`
  - `test valueForGroup category writes first option of the category`
  - `test scheduled buckets against fixed now` (Overdue, Today, Tomorrow, This week, Next week, Later, No date last)
  - `test isRecurring and hasReminder filters` (`isNot` variants; invalid repeat is not recurring)
  - `test new options only offered on the Task date property`
  - all M3 `views` tests still green.
- [ ] **Step 2:** Run `npx vitest run src/views`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces. Pure functions, no React.
- [ ] **Step 4:** Run `npx vitest run`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(views): status-category and scheduled grouping, recurring and reminder filters`.

### Task 11: Tasks page and the Task type page (track: frontend, tasks)

**Files:**
- Create: `tasks/{TasksPage.tsx,taskSections.ts,QuickAddTask.tsx}` (replaces the stub)
- Modify: `types/TypePage.tsx` (the basic Task type has no Overview tab, as Object's `hideDashboard`)
- Test: `tasks/taskSections.test.ts`, `tasks/TasksPage.test.tsx`, `tasks/QuickAddTask.test.tsx`, a new case in `types/TypePage.test.tsx`

**Interfaces:**
- Consumes: Tasks 7, 8, 10; M3 `DataView`, `useRows`, `useViewState`, `KanbanLayout`, `ListLayout`, `matchingValues`; `api.rows`, `api.patchUi` (key `tasks`).
- Produces:
  - `taskSections.ts`: `TASK_SECTIONS: Record<TaskSectionKey, {title, description, icon, preset(now) -> ViewState}>`. Titles and descriptions are `DatabaseDashboard.sections.tasks.*` verbatim (Today, Inbox, Open, Deadline, Scheduled, Recurring, Reminders, Status, Tags, Completed; **Context** is not offered until M5). Presets over the Task rows:
    - `status` (the default): all tasks, grouped by status category, layouts list and kanban;
    - `today`: open tasks whose `date` is today or earlier (overdue first); `inbox`: no status or no `date`; `open`: not done; `deadline`: open with a `deadline`, sorted by nearest first; `scheduled`: open with a `date`, grouped by Scheduled; `recurring`: open with a valid `repeat`, grouped by Scheduled; `reminders`: open with a valid `remind`, grouped by Scheduled; `tags`: grouped by `tags`; `completed`: done, sorted by `completed` newest first.
  - `<TasksPage>`: heading "Tasks" with the `ph-check-circle` tile, a "Create task" button (`SpaceOverview.tasks.createTask`) and `<QuickAddTask>` (placeholder "Task title", button "Add task", toast `Created task "{taskName}"`: `RootTaskFastCreation.*`; Enter creates through `createAndOpen`-less `api.createObject('task', {title, values: matchingValues(...)})` and keeps focus), then tabs, one per section (the active one a filled pill, saved as `tasks.activeTab`). Each tab renders a `DataView` with `FULL_VIEW_LAYOUTS` minus table and gallery-less (list, grid, wall, kanban; table only for the `status` tab), the preset as its initial `ViewState`, **user changes saved per section** in `ui.tasks.views[key]` (`useViewState`, 400 ms debounce, 409 refetch and re-apply as M3). A "Reset view" item in Customize restores the preset.
  - The Task rows come from `api.rows({typeIds:[taskTypeId]})`, kept current by `useRows`.
  - Cards and list rows of Tasks show `TaskCheckbox`, the title, the date with its repeat icon (`ph-repeat`) and reminder icon (`ph-bell`), a `DeadlineLabel` and the priority pill; `ListLayout`/`SmallCard` get this through `cellForDef` plus a `taskRowExtras(row, type)` helper exported from `tasks/` (M3's `InlineToken` and cards accept a `leading` slot; if M3 built none, this task adds the slot to `views/cards/InlineToken.tsx` and `SmallCard.tsx` and says so in its commit).
  - Kanban on the `status` tab: one column per category in order; a drop calls `updateProperties(path, {status:[firstOption]}, version)` (via `taskActions.setStatus`), so dropping a recurring task into Done advances it and the card jumps back with the toast from Task 8. Dropping a card into a column of its own category does nothing.
  - `types/TypePage.tsx`: for the basic Task type the tabs are All plus section tabs, `activeTab` defaults to `all`, and a saved `overview` is ignored. The type page still has M3's header and "New" split button.
  - The Sidebar's Tasks item (Task 7) opens this page.

- [ ] **Step 1: Write failing tests** (mockApi Task rows across all categories)
  - `test sections titles and descriptions match reference` and `test no Context section`
  - `test status tab groups tasks by category and offers list and kanban`
  - `test today section includes overdue and today, not done`
  - `test inbox deadline scheduled recurring reminders completed presets` (one case each against a fixed now)
  - `test section view changes saved to ui.tasks.views and active tab saved`
  - `test ui 409 refetches and reapplies once`
  - `test kanban drop to a category writes first status of the category`
  - `test dropping a recurring task into Done shows the moved toast and the card stays open`
  - `test quick add creates a task and keeps focus` and `test Create task button creates and opens in the peek`
  - `test Task type page has no Overview tab`
  - `test task rows show checkbox, repeat and reminder icons, deadline label and priority`
- [ ] **Step 2:** Run `npx vitest run src/tasks src/types`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(tasks): tasks page with status-category kanban, sections and quick add`.

### Task 12: Calendar shell: dates, state, chrome, mini month (track: frontend, calendar)

**Files:**
- Create: `calendar/{dates.ts,useCalendar.ts,CalendarChrome.tsx,MiniMonth.tsx,useCalendarRange.ts}`; replaces the stubs `calendar/CalendarPage.tsx` (header and view switch; the views arrive in Tasks 13–14) and `calendar/CalendarSidePanel.tsx`
- Test: `calendar/dates.test.ts`, `calendar/useCalendar.test.ts`, `calendar/CalendarChrome.test.tsx`, `calendar/MiniMonth.test.tsx`, `calendar/useCalendarRange.test.ts`

**Interfaces:**
- Consumes: Task 7 (`api.calendar`, `api.patchUi`, the calendar target); M3 `useRows`.
- Produces:
  - `dates.ts` (pure): `ymd(date)`, `parseYmd`, `addDays`, `startOfWeek(day, weekStart)`, `monthGrid(year, month, weekStart) -> day[][]` (6 rows, with the muted outside days), `weekNumber(day, weekStart)`: the ISO week, where `weekStart: 'sunday'` first adds one day (Object's `startWeekOnSunday` rule: Sunday belongs to the next ISO week), `weekdayColor(isoWeekday)` (Monday yellow, Tuesday pink, Wednesday green, Thursday orange, Friday blue, Saturday purple, Sunday red; the 500 shade in light, 400 in dark), `formatLong(day)` ("October 23, 2026"), `formatMonthTitle(day)` ("Oct 2026"), `rangeFor(view, anchor, weekStart) -> {from, to, days}`: **Day** the anchor; **Three days** the anchor with the day before and after (Object's "rolling", the anchor in the middle: 22, 23, 24 in `02-calendar-three-days.png`); **Week** the 7 days of the anchor's week; **Month** the 6-row grid (42 days).
  - `useCalendar` (zustand, persisted to `localStorage`, every read in try/catch): `{view: 'month'|'week'|'rolling'|'day', anchor: 'YYYY-MM-DD', setView, setAnchor, previous(), next(), today()}`; previous/next step by one day, one day, 7 days or one month; today = the viewer's local day; the persisted `anchor` is dropped on load (the calendar opens on today, as `EditorSettings.openOnStart.today`), the view is kept.
  - `useCalendarRange(range) -> {data: CalendarRange|null, loading, reload}`: calls `api.calendar`, reloads (one debounce window of 150 ms) on any `created`, `deleted`, `renamed`, `changed` or `types` event, and on the first event after midnight changes `today`.
  - `<CalendarChrome>`: the centred segmented control (labels `RenderWeek.month`, `.week`, `.rolling`, `.day` = "Month", "Week", "Three days", "Day"; the active one a filled pill; tooltips from `shortcuts.setViewTo*.name`), the pager with the tooltips `shortcuts.goToNext/Previous/Today`, "Today" (`RenderWeek.today`, semibold when the anchor is today), and a "show mini calendar" toggle (the right-panel toggle in the screenshot) wired to the App's right panel. In Month, Week and Three days the left of the chrome shows the period title ("Oct 2026"). Keys: the reference's calendar shortcut keys (grep as noted in the header), only while the Calendar is the active target and no input has focus.
  - `<CalendarSidePanel>` (the right panel): `<MiniMonth>`: a month ▾ and year ▾ dropdown (`RenderWeek.jumpTo`, the year list ±50), ‹ › buttons (`RenderWeek.previousMonth`, `RenderWeek.nextMonth`), weekday initials "Su Mo Tu We Th Fr Sa" (Monday-first with `weekStart: 'monday'`), days outside the month muted, **today a filled red rounded square**, the selected day (when not today) a neutral filled square, and **a small dot under each day that has a daily note** (our marker; Object's is not in the screenshots), from `api.calendar` for the shown grid. Clicking a day sets the anchor (and keeps the view, except that Month/Week navigate to the period holding it).
  - `ui.calendar.weekStart` (default `'sunday'`, as the screenshots) is read from `ui` and used everywhere; there is no UI to change it until the Settings modal (M7), so the plan notes it as a file-level preference.
  - `<CalendarPage>`: `CalendarChrome` over the view for `useCalendar.view`; until Tasks 13–14 each view renders "Loading results…".

- [ ] **Step 1: Write failing tests**
  - `test week number with Sunday start`: 2026-10-23 → 43 for both; 2026-10-25 (a Sunday) → 44 with `'sunday'`, 43 with `'monday'`; 2026-01-01 → 1; 2025-12-29 → 1.
  - `test weekday colours` (the seven, by ISO weekday) and `test long and month title formats`
  - `test monthGrid starts on week start and has 42 days` (Oct 2026: the grid starts 27 Sep with Sunday start, 28 Sep with Monday start)
  - `test rangeFor each view` (rolling is anchor−1..anchor+1; week is Sunday–Saturday or Monday–Sunday; month is 42 days)
  - `test previous next step by view; today resets anchor`
  - `test persisted view kept, anchor reset to today`
  - `test chrome labels, tooltips and active pill`
  - `test shortcuts switch views only when calendar is active and not typing`
  - `test mini month marks today, selected and daily-note days; outside days muted`
  - `test mini month dropdowns and arrows change the shown month; click sets anchor`
  - `test useCalendarRange reloads once on a burst of events and when the day changes`
- [ ] **Step 2:** Run `npx vitest run src/calendar`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(calendar): calendar shell with date helpers, chrome and mini month`.

### Task 13: Day view: header, daily note, sections, quick-create (track: frontend, calendar)

**Files:**
- Create: `calendar/{DayView.tsx,DayHeader.tsx,DaySections.tsx,DailyNoteSlot.tsx,QuickCreateChips.tsx}`
- Modify: `object/ObjectView.tsx` (adds `mode: 'inline'`), `calendar/CalendarPage.tsx` (the Day view branch)
- Test: `calendar/DayView.test.tsx`, `calendar/DayHeader.test.tsx`, `calendar/DaySections.test.tsx`, `calendar/DailyNoteSlot.test.tsx`, `calendar/QuickCreateChips.test.tsx`, a new case in `object/ObjectView.writes.test.tsx`

**Interfaces:**
- Consumes: Tasks 7, 8, 12; M3 `DataView` (`compact`), `useRows`, `useViewState`, `ObjectCard`; M1/M2 `ObjectView`, `Editor`, `useObjectWrites`; `api.createDailyNote`.
- Produces:
  - `<DayHeader day size>`: the weekday in its colour, the **Today** pill (red-tinted: `bg-red-50/50 text-red-500`, dark `bg-red-400/10`) only on today, the large bold date ("October 23, 2026", `main-heading` ≈ 36 px, 18 px bold at `size='sm'` for the multi-day views), and the muted "Week {n}" (`CalendarView.calendarWeek`). Beside the header: the **Reviewed** control (a small checkbox button labelled "Reviewed", highlighted when checked; it writes `reviewed` on the daily note, `components.RootDailyNote.propertyDefinitions.RootDailyNote_reviewed.name`), hidden when the DailyNote type has `hideReviewing` or the day has no note.
  - `<QuickCreateChips day>`: one chip per eligible type (the rule in Global Constraints), each with the type icon and name; the chip creates an object with its first date property set to the day (`api.createObject(typeId, {values})`) and opens it as `createAndOpen` does (Tasks in the peek). `createOnce` chips disappear once such an object exists for the day. A tooltip: "Create {object} linked to this day." (`CalendarDaily.objectsOfDay.create`).
  - **Filter tabs** under the chips: "All" (`CalendarDaily.all.heading`), "Daily note", "Tasks", then "Dates" only when the day has dated entries (`CalendarDaily.objectsOfDay.heading` is "Objects with this date"; the tab label is the short "Dates", our string), "Created Today" (`components.RootDailyNote.createdToday`; "Created Yesterday" and "Created on This Day" for other days), and "Updated Today" (our string, "Updated Yesterday", "Updated on This Day") only when non-empty. The active tab is a filled pill; "All" stacks the sections in the order Daily note, Tasks, Dates, Created, Updated (the screenshot's order).
  - `<DailyNoteSlot day>`: with a note, the **inline editor** (`ObjectView mode='inline'`: the body editor and its autosave only, no property panel, header or `…` menu; a `…` button at the section heading opens the note as a page or in a new tab and offers "Open as Page" (`components.RootDailyNote.openAsPage`) and Delete); without one, an outlined **"+ Daily Note"** button (the `ph-plus` icon and `components.RootDailyNote.name`), which calls `api.createDailyNote(day)` and then shows the editor focused. A 409 (`DailyNoteExistsError`) simply opens the existing note. Placeholder: "Start your daily note" (`components.RootDailyNote.placeholder`). A future day's note is created the same way.
  - `<DaySections>`: each section has a bold heading on the left and the small toolbar on the right (layout ▾, filter/customize, `+`, and a count for Created), using M3's `DataView` with `compact` and `layouts` list/grid/wall/embed; the layout and view state are saved per section in `ui.calendar.daily.{tasksView,createdView,updatedView,datedView}` (created default layout `wall`, tasks default list, as `Do('wall')` and `Jl` in the reference). Empty states: Tasks "No tasks today" / "No tasks on this day" with "You can change this by creating a new object." (M3's empty state), Created "There's nothing here (yet)." The Tasks section shows the stats line ("{openCount} open, {closedCount} done" today, "{totalCount} open" or "{totalCount} done" on other days: `CalendarDaily.tasks.stats*`), the `TaskCheckbox` on every row, the group "Overdue ({count})" (`components.RootTask.overdueWithCount`) on today, entries tagged "Deadline" or with a repeat icon for occurrences, and in its `+` menu "Create task" and "Move all open tasks to" (`CalendarDaily.moveAllTasksTo`) with "Today"/"Tomorrow"/"Pick a date", which loops `updateProperties` over the open tasks' `date` (a recurring task's `repeat` is untouched; a 409 on one task reports it and continues).
  - Rows for the sections come from `api.rows({paths})` for the paths of the day (one call per day, reloaded with `useCalendarRange`), never one call per section.
  - `ObjectView mode='inline'`: renders `Editor` (formatted mode) with `useObjectWrites` and `useAutosave`; conflicts, external changes and the deleted banner behave as in the page.
  - The Day view (`DayView`): header, chips, tabs and sections in one scrolling column at `.main-content-width`.

- [ ] **Step 1: Write failing tests** (mockApi calendar range and rows)
  - `test header shows weekday colour, Today pill only on today, long date and week number`
  - `test reviewed button writes reviewed and is hidden without a note or with hideReviewing`
  - `test + Daily Note creates for the day and shows the editor; 409 opens the existing note`
  - `test inline editor autosaves the body with the note's version`
  - `test section order and tabs`: All stacks Daily note, Tasks, Dates, Created, Updated; Dates and Updated tabs only when non-empty; labels for today, yesterday and other days.
  - `test tasks section stats today, past and future`
  - `test overdue group on today only with count`
  - `test deadline and occurrence entries are marked`
  - `test task checkbox completes through updateProperties`
  - `test move all open tasks to tomorrow writes each date and reports a conflict`
  - `test created and updated sections use saved layout and persist changes to ui.calendar.daily`
  - `test quick-create chip creates object with first date property set to the day`; `test createOnce chip hides after creation`; `test disabled type has no chip`
  - `test one rows call per day`
  - `test ObjectView inline mode has no property panel or header`
- [ ] **Step 2:** Run `npx vitest run src/calendar src/object`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(calendar): day view with header, inline daily note, sections and quick-create chips`.

### Task 14: Three days, Week and Month views (track: frontend, calendar)

**Files:**
- Create: `calendar/{ThreeDaysView.tsx,WeekView.tsx,MonthView.tsx}`
- Modify: `calendar/CalendarPage.tsx` (the three view branches)
- Test: `calendar/ThreeDaysView.test.tsx`, `calendar/WeekView.test.tsx`, `calendar/MonthView.test.tsx`

**Interfaces:**
- Consumes: Tasks 12–13.
- Produces:
  - `<ThreeDaysView>`: three equal columns separated by 1 px vertical dividers (`02-calendar-three-days.png`), each a compact day: `<DayHeader size='sm'>`, the daily note slot (the outlined "+ Daily Note" button when empty, the inline editor otherwise), and the same sections, *without* the chips and the filter tabs. The period title ("Oct 2026") sits at the left of the chrome. The anchor's day has the Today pill when it is today.
  - `<WeekView>` (**our design**, the screenshots show no Week view; same column structure as Three days): seven columns (scrolling horizontally below ≈ 900 px) of compact days with the daily note slot and a condensed list of the day's tasks, dated objects and created objects (titles with the type icon, the `TaskCheckbox` on tasks); the title "Week {n}" at the left of the chrome.
  - `<MonthView>` (**our design**): a 7-column grid of 6 rows. Each cell: the day number (today a filled red rounded square, outside days muted), the daily note's first line when it has one (a daily-note chip), up to three entry chips (tasks first, then dated, then created; type icon and title) and "+{n} more"; click a cell to open that day in the Day view; right-click or `+` on hover creates a daily note for the day. When the month has no daily notes at all, the line "No daily notes created for this month." (`components.RootDailyNote.emptyStates.month`) shows above the grid.
  - All three views read one `api.calendar` range (Task 12's `rangeFor`) and load rows only for what they render (Month renders summaries, not rows).

- [ ] **Step 1: Write failing tests**
  - `test three days renders anchor and neighbours with headers and no tabs or chips`
  - `test three days columns have daily note slot per day and create works per day`
  - `test week renders seven columns starting on the week start`
  - `test month renders 42 cells with outside days muted and today marked`
  - `test month cell shows daily note line, chips and plus-n-more`
  - `test month click opens the day view for that day`
  - `test month empty line when no daily notes in the month`
  - `test month renders from summaries without rows calls`
  - `test views reload when a daily note is created elsewhere`
- [ ] **Step 2:** Run `npx vitest run src/calendar`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(calendar): three days, week and month views`.

### Task 15: Calendar type settings, Daily Note type bits (track: frontend, calendar)

**Files:**
- Modify: `types/TypeSettings.tsx` (a "Calendar" group), `types/TemplateManager.tsx` (`templatesAllowed` includes DailyNote), `types/dashboardSections.ts` and `types/TypeOverview.tsx` (the DailyNote type's "Unreviewed" section)
- Test: `types/CalendarSettings.test.tsx`, new cases in `types/dashboardSections.test.ts` and `types/TemplateManager.test.tsx`

**Interfaces:**
- Consumes: Task 7 (`TypeDef.createInCalendarOption`, `hideFromCalendarSidebar`, `hideReviewing`); M2 `useTypeEditor`, Type Settings (Task 17); M3 Task 12 (`buildSections`, `TypeOverview`).
- Produces:
  - **"Calendar" group** in Object Type Settings (heading `StructureSpecificSettings.configuration.calendar` = "Calendar", panel heading "Calendar Settings"), shown only when the type has a date property (the explanation "This object type has a date property. It is therefore integrated in the calendar. You can select your preferences here."): "Create object from calendar" (`showCreateButton.heading`, with its description) with the segmented choices "Show" / "Show for one per day" / "Hide" (`enabled`, `createOnce`, `disabled`: absent, `'createOnce'`, `'disabled'` in the file); "Hide object in calendar sidebar" (`PropertySettings.calendarSettings.hideFromCalendarSidebar.*`) as a switch → `hideFromCalendarSidebar`. The Task and DailyNote basic types don't show the group (their dates have fixed roles).
  - On each date property's settings (M2 Task 16's property settings): "Hide in calendar" → `hideCalendarEvents` (our string: the reference's `hideCalendarEvents` flag has no property-settings label).
  - **DailyNote type settings:** "Reviewing" with "Hide reviewing" (`StructureSpecificSettings.dailyNoteReviewing.*`) → `hideReviewing`; the Templates group works for DailyNote ("Empty Note", "New Template", "Mark as Default", "No templates yet": `components.RootDailyNote.templates.*`), because `templatesAllowed` now includes it.
  - **DailyNote Overview:** a built-in dashboard section "Unreviewed" (`DatabaseDashboard.sections.dailyNotes.unreviewed.title`/`.description`): DailyNote rows with `reviewed` not true, newest first, list layout; appended by `buildSections` when absent from the saved list and not in `removedSections` (the same rule M3 uses for collection sections), hidden when `hideReviewing`. It is also listed in "Customize Overview" → "Add a section" once removed.

- [ ] **Step 1: Write failing tests**
  - `test calendar group only for types with a date property; not for Task or DailyNote`
  - `test create-from-calendar choices write createInCalendarOption (absent, createOnce, disabled)`
  - `test hide in sidebar switch writes hideFromCalendarSidebar`
  - `test date property Hide in calendar writes hideCalendarEvents`
  - `test Reviewing hide writes hideReviewing and hides the Reviewed button and section`
  - `test DailyNote template group enabled with Empty Note and Mark as Default`
  - `test DailyNote Overview gets Unreviewed section appended, removable and re-addable`
  - `test unreviewed lists notes with reviewed not true, newest first`
- [ ] **Step 2:** Run `npx vitest run src/types`. Expected: FAIL.
- [ ] **Step 3:** Implement as specified in Interfaces.
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b --noEmit && npm run lint && npm run build`. Expected: PASS, clean.
- [ ] **Step 5:** Commit `feat(types): calendar settings, daily note reviewing and templates, unreviewed section`.

### Task 16: Milestone acceptance (track: integrate; after Tasks 1–15)

**Files:**
- Create: `scripts/m4_acceptance.py`, `docs/superpowers/plans/m4-acceptance.md`
- Modify: `docs/superpowers/plans/remaining-work.md` (the M4 rows only)

- [ ] **Step 1:** Run `uv run pytest -q` and `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run lint && npm run build`. Expected: all green.
- [ ] **Step 2:** Write `scripts/m4_acceptance.py SPACE [--keep]`. Like `m3_acceptance.py`, it works on a temporary git-committed copy and starts the server on a free port with a controllable clock and a **fake notifier** (a flag that writes notifications to a file; it never calls the real OS). Over HTTP it checks:
  1. Starting twice and calling every M4 GET route (`/api/calendar` over a month, `/api/rows` over Tasks) changes no file (`git status` clean); no daily note exists for today.
  2. `POST /api/daily-notes` for today creates exactly `DailyNotes/<today>.md` with the Task 4 shape; a second call is 409 with its path; the tree changed by that one file.
  3. A Task with `date`, `repeat: every week`, `remind: 1 day before at 09:00`, set through `PUT /api/object/properties`, shows a one-line diff per key plus `lastUpdated` (and `id`).
  4. Completing it (status Done) changes exactly `status`, `date`, `completed` and `lastUpdated`; `date` is the next occurrence on or after today; the status is Not Started; the response says `advanced`.
  5. Completing a non-recurring task changes `status`, `completed`, `lastUpdated`; reopening removes `completed` only.
  6. `GET /api/calendar` for the month lists the daily note, the task on its date and its later occurrences, an object created near local midnight on the right day, a range on each of its days, and none of the hidden ones.
  7. The scheduler (driven by the controllable clock) fires the reminder once to the fake notifier, writes only `.object-cache/reminders.json`, and does not fire again after a restart.
  8. `PUT /api/ui` with `calendar`/`tasks` keys changes only `.object/ui.json`; a stale revision is 409.
  9. The M1 no-edit pass: 0 files changed.
- [ ] **Step 3:** Run it on `backend/tests/fixtures/space-calendar`, `backend/tests/fixtures/space-sample` and `backend/tests/fixtures/space-v1` (tasks and daily notes are created over the API first on the spaces that lack them, so it also works on a copy of a real export). Expected: every check prints `[ok]`.
- [ ] **Step 4:** Run `npm run build`, then `uv run objectapp --space <copy of space-calendar>`, and walk through:
  - the Calendar in all four views; the pager, Today and the keys; the mini month (month and year dropdowns, today, the daily-note dots); the Day header and week numbers around a Sunday and the year boundary
  - "+ Daily Note", typing in the inline note, the Reviewed button, an external edit of the note in VS Code appearing in the page, a daily note template
  - the Day sections and tabs, quick-create chips (including a `createOnce` type and a hidden type), a dated object with a range on each of its days, "Move all open tasks to"
  - the Tasks page: the Status tab as list and kanban, a drag between categories, the Today, Inbox, Deadline, Scheduled, Recurring, Reminders and Completed tabs, quick add, the Task type page without an Overview tab
  - a task with Repeat (daily, weekday, custom by completion, with an end date) completed twice, and a reminder set a minute ahead firing one Windows notification while the app is open (and not after the task is done)
- [ ] **Step 5:** Gene runs the app on his CPI copy outside the repo, with `git init` done there. Record in `m4-acceptance.md`:
  - his existing Task type keeps its own `priority`/`deadline` definitions and options; his existing daily notes appear on their days (including any whose `date` key is missing); no file changes just by opening the Calendar and Tasks
  - completing a recurring task's `git diff` is the status, date and completed lines plus `lastUpdated`
  - a month with 5,000+ objects switches views without a visible stall
  - side by side with Object: the Day view and Three days against `01`/`02` screenshots, the mini month, the pager and segmented control, the Tasks page; and, **explicitly, the Week view, the Month view and the daily-note marker in the mini month, which this plan designed without a reference screenshot** (note what Object does differently so a fix pass can follow)
  - reminders: one banner per reminder, none after quitting the app, one catch-up after reopening within 12 hours
- [ ] **Step 6:** Update the M4 section of `remaining-work.md` to "built" and list what Task 16 found, then commit `chore: milestone 4 acceptance`.
