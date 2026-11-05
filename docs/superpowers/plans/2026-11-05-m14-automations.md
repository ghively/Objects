# Milestone 14: local automations

Expanded 2026-11-05 from the 2026-11-04 features plan (its "M14: Local automations" section; that plan is not on `master`), against `master` at `c72567f`. Built on branch `feat/m14-automations`. Everything here is new schema ("Beyond the catalog"); every label and default is "our string" or "our choice".

**Goal.** Routine edits happen by themselves or with one click, all on this machine: no network and no account. Rules live in the space (they travel with it and can be versioned); their run log and schedule state live in the per-user state dir.

## Contract (T1)

### Storage

| What | Where | Written by |
|---|---|---|
| One rule | `.object/automations/<id>.json` (JSON, `indent=2`, `ensure_ascii=False`, LF, trailing newline: `jsonstore.dump_json`) | the automation routes, through a `JsonStore("automations")` (`Space.store`), so writes are atomic, revision-checked and in `own_writes` |
| A template's "Repeat" | an ordinary rule file with `templateRepeat` set (below) | the same routes |
| Schedule state (last run per rule, pending catch-up) | `<state dir>/automations-<hash>.json` | the engine |
| Run log | `<state dir>/automation-logs-<hash>/<id>.json` | the engine |

`<hash>` is the reminder ledger's: the first 16 hex characters of sha256 of the normcased, resolved space path (`reminders.ledger_path_for`'s rule; share the helper). Opening a space never writes any of these; the state dir is created lazily by a writer (`appstate`).

The **id** is a ULID (`ids.new_ulid`, our choice: buttons in files and Button properties point at it, so it must never change and never collide when spaces are merged), and it is the file name only: the JSON holds no `id`, as query files are read ("the file name is the id"). A file whose name isn't a valid `JsonStore` id is ignored.

### Rule file schema (`schemaVersion: 1`)

`backend/objectapp/automations_model.py` (pydantic, T1) and `AutomationRule` in `frontend/src/api/types.ts` (T1) are the two copies of this; they must agree.

```jsonc
{
  "schemaVersion": 1,                    // a file with any other value loads read-only and never runs
  "name": "Stamp completion date",       // 1-100 characters, whitespace collapsed
  "description": "",
  "enabled": true,
  "trigger": { /* one of the four triggers */ },
  "conditions": { "type": "filterGroup", "operator": "and", "elements": [] },
  "actions": [ /* 1-20 actions, run in order */ ],
  "templateRepeat": null,                // or {"typeId", "templateId"}
  "createdAt": "2026-11-05T09:00:00.000Z" // set by the server on create, kept on save
}
```

Unknown top-level keys are kept on every save (as other definition files keep theirs). A file that isn't valid JSON, or that doesn't validate against the model (an unknown trigger or action kind, a newer `schemaVersion`), lists with `readOnlyReason` (`"This automation can't be read."` / `"This automation was made by a newer version of Object."`, our strings), never runs, and is never rewritten (`PUT` answers 423).

**API-only keys** (added by every read, ignored and dropped by every save): `id`, `revision` (sha256 of the file, `json_revision`), `readOnlyReason`, `lastRun` (the newest `AutomationRun`, or null).

### Triggers

`Scope` is `{"kind": "type" | "collection", "id": "<type id or collection id>"}`.

| `kind` | Fields | Fires when |
|---|---|---|
| `objectCreated` | `scope` | an object in the scope is created (any create path below). For a collection scope, also when a write adds an existing object to that collection (its `collections:` gains the collection's name). |
| `propertyChanged` | `scope`, `propertyKey`, `to: Filter \| null` | a write changes `propertyKey`'s decoded value (`propvalues.decode_value`, compared before and after). With `to`, only when the object didn't match `to` before the write and does after ("changes to"). `to` is a view `Filter` whose `propertyId` is `propertyKey`. |
| `schedule` | `repeat`, `time`, `start` | at `time` (`HH:mm`, the space's time zone `space.tz`) on `start` and on every later day the M8 recurrence reaches from it (below). |
| `button` | `scope: Scope \| null` | a button block or a Button property is pressed on an object (`null`: any object). |

- `propertyKey` may be any key of the scope's type(s) (a collection scope: the union over its `typeIds`) except `type`, `createdAt`, `lastUpdated`, `backlinks` and `button` kinds; `title`, `tags`, `collections`, `description`, `icon`, `aliases` are allowed. `to` uses the operators `views/filter.ts` offers for that kind (`filterOptionsFor`).
- **Schedule**: `repeat` is M8 repeat text (`taskmodel.parse_repeat`; `tasks/repeat.ts` `parseRepeat` on the client), stored canonical (`format_repeat`). "after completion" is refused (422). `until` is honoured. Occurrences are exactly a by-due-date Task's: `start` is the first, then each `recurrence.step` from it, so `recurrence.scheduled_between(rule, start_day, lo, hi, tz, week_start_of(root))` lists them (our choice: `start` counts even when it doesn't match an `on` pattern, as a Task's own date does; the editor defaults `start` to the next matching day). An occurrence's instant is `localtime.from_local(datetime.combine(day, time), space.tz)`.

### Conditions

`conditions` is the view `FilterGroup` (nested `and`/`or`, `Filter {type, propertyId, option, referenceValue?, structureId?}`), so the rule editor reuses `views/FilterEditor.tsx`. It is evaluated on the triggering object as it is after the triggering write. An empty group passes. Nesting is at most 3 groups deep (the top group counts). A schedule rule's conditions must be empty (422).

The back end gets a port of `views/filter.ts`'s `matchGroup`/`matchFilter` (Lane B, `backend/objectapp/automation_filter.py`) with the same operators, the same handling of invalid filters (ignored), relative dates resolved against the run instant in `space.tz` with weeks running Monday to Sunday as `views/dates.ts` has them, whatever the space's week start (our choice, review fix: a rule's "this week" is the one views show), tag references as Tag object ids, entity references as object ids. **Parity is tested**: one table of cases in `frontend/src/views/__fixtures__/filter-cases.json` (rows, filters, expected matches) is run by a vitest file and by a pytest file; both must pass.

### Actions

| `kind` | Fields | Does |
|---|---|---|
| `setProperty` | `key`, `value`, `now?` | sets `key` to `value` in the `PUT /api/object/properties` value form; with `now: true` (and `value` null) to the run instant: a `datetime` with day resolution (by its `resolutionConstraint`/`resolutionPreference`) gets the local day, otherwise the instant. `now` is only for `datetime`/`datetimeSimple` keys (422). |
| `clearProperty` | `key` | removes the key's value (as the panel's clear). |
| `addTag` / `removeTag` | `tagId` | adds/removes the Tag object with that frontmatter `id` (its title goes in `tags:`). A missing Tag fails the action. |
| `addToCollection` / `removeFromCollection` | `collectionId` | adds/removes the collection (its name goes in `collections:`). |
| `createFromTemplate` | `typeId`, `templateId`, `title`, `relateVia` | `Space.create_object(typeId, title, template_id, values)`: `templateId` null = the type's default template, `"none"` = none, else that template's id. `title` takes placeholders; empty = the template's title rules. `relateVia`: a relation (`entity`) property key of `typeId`, set to `[triggering object]` in the creating write (synced relations then fill the other side); it must allow the scope's type (422). |
| `appendToDailyNote` | `text` | appends the expanded text as new line(s) at the end of the body of the daily note of the run's local day (`Space.daily_notes`), creating the note first when missing (`create_daily_note(day)`, its default template applies). The note's line ending is used; a body not ending in a line break gets one first; no blank line is added (our choice). |
| `notify` | `title`, `body` | one notification through the engine's `notify.Notifier` (empty title: the rule's name), only while `ui.json` `reminders.enabled` ("Activate notifications") is on (our choice: one switch for this computer's notifications). |

- **Placeholders** (our choice; in `createFromTemplate.title`, `appendToDailyNote.text`, `notify.title`/`body` only): `{title}` the triggering object's title (`""` without one), `{link}` a wiki link to it (`[[...]]` in the app's link-text form, `Space._link_text`; `""` without one), `{date:FMT}` the run instant in `space.tz` with the template token subset (`templates.format_date`). Anything else is kept as written.
- **Object actions** (`setProperty` … `removeFromCollection`) edit the triggering object and are refused on schedule rules (422). All of a run's object actions are applied as **one** `update_properties` write, first, in list order (a later action on the same key wins); then the other actions run in list order. Each action has its own result in the log; a failed action doesn't stop the others (our choice).
- Values are validated at save with a dry `encode_value` against the property's definition (422 naming the action) and again at run time (a type edited since fails the action, logged). `setProperty`/`clearProperty` refuse read-only kinds (`title`, `type`, `createdAt`, `lastUpdated`, `backlinks`, `button`): title changes are a rename, not a property.

### Running

- **Write funnel hook (Lane B, `space.py`).** `Space.after_write: Callable[[WriteNotice], None] | None` (beside `before_write`), with `WriteNotice(kind: "created" | "changed", path, before: dict | None, after: dict, origin: str | None, requested: dict | None)` (parsed frontmatter before and after; `before` None for a create; `requested`: the asked-for values a hook replaced, e.g. `{status: Done}` when completing a repeating Task reset its status, which `propertyChanged` matches against). It is called after the replace, once the writing thread's outermost hold of the space's lock ends (so a rename's or type change's notice comes after the file has moved), and never raises (logged):
  - `changed`: by `_write` for **stamped** writes whose frontmatter changed (property edits, relation-sync writes, task status hooks, merges, renames). Not for unstamped type-driven rewrites (option renames, kind changes, relinks), body-only saves, version-history restores (`_write_exact`) or trash restores.
  - `created`: by `create_object`, `duplicate_object`, `create_daily_note`, `ensure_tag` (and the whiteboard create), never for a template file (`template:` key) or a restore.
- **Origin.** A context variable (Lane B, `backend/objectapp/writeorigin.py`: `current() -> str | None`, `acting_as(origin)` context manager) supplies `WriteNotice.origin`. App and API requests leave it None. The engine runs every action inside `acting_as("automation:<id>")` (`automations_model.origin_for`).
- **Loop guard.** A notice whose origin starts with `automation:` triggers nothing, so an automation's own writes (and the relation syncs and tag creates they cause) never trigger automations. Watcher-seen external edits never reach `after_write` (the watcher only rescans), so they trigger nothing (our choice: a file synced in from elsewhere shouldn't cause new writes).
- **Order and threads.** Notices go on the engine's queue and are handled on its one worker thread after the request returns (the user's save is never slowed). On quit, queued runs that haven't started are dropped (our choice, one log line), the one in progress finishes, and the wait for it is bounded (5 s). For each notice, enabled rules are checked in `createdAt`, then id, order; each matching rule is one run. Rules are re-read from the store by revision (an external edit of a rule file takes effect on the next notice). Templates are never triggering objects.
- **New objects with text.** `POST /api/objects` takes `body` (replaces the body the object would get) and `appendBody` (added below it after one blank line), written in the creating write; the app's create-then-fill flows ("Move to new page", "Create page" from a paste, "Turn into") use them, so a creation rule's write can't make a separate body save a 409 (review fix).
- **Writes and 409.** Every rule write goes through the public `Space` methods (history snapshot, `lastUpdated`, version checks). The engine reads the object's current version and writes against it; a `Conflict` re-reads and retries **once** on the fresh version, then the action fails with `"The object changed while the automation was running."` (our string). Each write is announced like a route's: `ChangeEvent("changed" | "created", path, version, origin="automation:<id>")` for the object, synced objects and created ones (so every window, including the one whose save triggered it, reloads).
- **Run instant.** "now", `{date:FMT}` and "today's daily note" use the run instant: the clock (`Space.clock`) for trigger and button runs, the occurrence's instant for schedule and catch-up runs (so a missed Monday review is dated Monday). `createdAt`/`lastUpdated` are always the real clock.
- **Disabled rules** never run; a button on one answers 422 `"This automation is turned off."` (our string).

### Schedules and catch-up

- An `AutomationScheduler` thread (like `ReminderScheduler`: a 30 s tick, started and stopped in the app's lifespan) runs each enabled schedule's occurrences in `(last check, now]`, oldest first, and records each run's occurrence as the rule's `lastDone` in the state file before running it (at most once).
- State file: `{"lastRunning": iso, "rules": {"<id>": {"since": iso, "lastDone": iso | null, "pending": [iso, ...]}}}`. `lastRunning` is the instant occurrences were handled through (the last tick), never the clock at quitting. A rule file that can't be read keeps its entry and pending items; a deleted or turned-off rule drops them. `since` is when this machine started counting the rule: set when the rule is first seen, created, turned on, or its trigger changes (our choice: a changed or re-enabled schedule starts fresh, nothing is owed from before). `lastRunning` is written on a clean stop and every 5 minutes while running.
- **On start** (before the first tick): for each enabled schedule rule with a state entry, the occurrences in `(max(lastRunning, since, lastDone), start]` are added to its `pending` (deduplicated, the newest 50 kept, our cap). A rule with no entry gets `since = start` and owes nothing. A missing state file means nothing is owed (first M14 start); an unreadable one also owes nothing and is replaced on the next write. **Nothing missed is ever run without the user's answer.**
- **A gap while running** (the computer slept): a tick that finds more than 10 minutes since the last one (our choice) puts the gap's occurrences in `pending` instead of running them, and announces `automationRuns` with path `catch-up`.
- The client asks `GET /api/automations/catch-up` once the space has loaded and on every `automationRuns`/`catch-up` event; a non-empty answer opens the catch-up dialog (below). The answer for a rule (`all`, `latest`, `skip`) runs those occurrences now, in order, each with its occurrence as run instant, and clears that rule's `pending`. Unanswered items stay pending across restarts.

### Run log

Per rule, `<state dir>/automation-logs-<hash>/<id>.json` = `{"runs": [AutomationRun, ...]}`, newest first, the newest **200** kept. A run is logged when its trigger fired and its conditions matched, and for every button press and catch-up answer (a press whose object misses the conditions is logged `skipped`). Condition misses of automatic triggers are not logged (they'd flood the log). A deleted rule's log stays while the rule is in the trash and is removed when its trash entry is purged. On start, logs whose rule file is gone and isn't in the trash (deleted outside the app) are removed (state dir only).

```ts
interface AutomationRun {
  id: string                      // ULID
  ruleId: string
  at: string                      // ISO UTC, when the run started
  trigger: { kind: AutomationTriggerKind; path: string | null; scheduledFor: string | null; catchUp: boolean }
  status: 'ok' | 'failed' | 'skipped' // failed: any action failed
  actions: { index: number; kind: AutomationActionKind; status: 'ok' | 'failed' | 'skipped'; path: string | null; detail: string | null }[]
  error: string | null            // a failure before any action ran (the object is gone, a template is missing...)
}
```

A no-op action (the tag is already there) is `ok`. A missing template, type, Tag or collection fails its action with a plain message (`"The template no longer exists."`, our strings). Rules are not changed or disabled by failures.

### Routes (Lane B, a router module `api_automations.py` mounted on `/api`)

| Route | Body / query | Answer | Errors |
|---|---|---|---|
| `GET /automations` | | `AutomationRule[]` by name (casefold), then id | |
| `GET /automations/{id}` | | `AutomationRule` | 404 |
| `POST /automations` | `{rule: AutomationRuleInput, clientId?}` | 201 `AutomationRule` | 422 `{detail}` naming the problem |
| `PUT /automations/{id}` | `{rule, baseRevision, clientId?}` | `{rule}` | 404, 409 `{currentRevision}`, 422, 423 |
| `DELETE /automations/{id}?clientId=` | | `{trashId}` (to the trash, restorable) | 404, 423 |
| `POST /automations/{id}/run` | `{path, clientId?}` | `AutomationRun` (synchronous) | 404 (rule or object), 422 (not a `button` rule, turned off, object out of scope, a template), 423 |
| `GET /automations/{id}/runs?limit=` | `limit` 1–200, default 200 | `{runs: AutomationRun[]}` newest first | 404 |
| `GET /automations/catch-up` | | `{items: AutomationCatchUpItem[]}` (rules by name) | |
| `POST /automations/catch-up` | `{ruleId, choice: 'all' \| 'latest' \| 'skip', clientId?}` | `{runs: AutomationRun[]}` | 404 (no such rule or nothing pending) |

- Validation at create and save (422, one message): the model's shape rules; the scope's type or collection exists; `propertyKey` and every action key exist on the scope's type(s) (not checked for `button` with a null scope, our choice: checked at run time); `repeat` parses and isn't "after completion"; `createFromTemplate`'s type exists, its template exists when an id is given, `relateVia` is an `entity` property of that type; at most one rule per `templateRepeat.templateId`. A save that only turns a rule on or off, or leaves it off, skips the checks against the space (the shape is still checked), so a rule whose template, type or collection is gone can be turned off and edited.
- **Trash:** a deleted rule moves unchanged to `.object/trash/automations/<trashId>.json` with a meta file `{id, deletedAt}` (as queries do); `GET /api/trash` lists it as `TrashItem {kind: 'automation', automationId, name, ...}`; restore puts it back under its id (409 when that id exists) and answers `automationIds: [id]`; purge also removes its run log.
- **Events:** create, save, delete and restore announce `ChangeEvent("automations", id, revision or None, origin=clientId)`. A logged run announces `ChangeEvent("automationRuns", ruleId, None, origin="automation:<id>")`; a change of the catch-up list announces `("automationRuns", "catch-up", None)`. The watcher announces external edits of `.object/automations/*.json` as `automations` (add the folder to its definition folders). `automations` joins the resync list on both sides (`server.RESYNC_EVENTS`, client `RESYNC_EVENTS`; the client side is done in T1).
- **Test hooks** (only with `OBJECT_FAKE_NOTIFY_FILE`, as `POST /api/_test/tick`): `/api/_test/tick` also runs one scheduler tick at the clock's instant and adds `automationRuns: AutomationRun[]` to its answer; `POST /api/_test/automations/idle` waits up to 10 s until the trigger queue is empty and answers `{idle: boolean}`. The clock is `OBJECT_CLOCK_FILE`, the state dir `OBJECT_STATE_DIR`, notifications land in `OBJECT_FAKE_NOTIFY_FILE`.

### Template "Repeat"

- A template's repeat **is** a rule: `trigger` a schedule, exactly one action `{kind: "createFromTemplate", typeId, templateId, title: "", relateVia: null}`, empty conditions, and `templateRepeat: {typeId, templateId}` naming the same type and template. Its name is `Repeat “<template name>”` (our string), set when made and kept.
- It lives only in its rule file (our choice). The template file and the type JSON are not written: a template's frontmatter is copied into every object made from it, and a Task template's own `repeat:` key is the Task's recurrence. The link is the `templateRepeat.templateId` (the template's frontmatter `id`; the UI calls `api.ensureId` first when the template has none). The UI finds a template's repeat with `rules.find(r => r.templateRepeat?.templateId === id)`; the server allows one per template.
- Deleting the template leaves the rule; its runs fail and log `"The template no longer exists."` until the template is restored or the repeat removed. Removing the repeat deletes the rule (to the trash).

### Button block

- **Grammar** (M7 leaf annotation, our option names): the option `button` (flag) and `rule` (the rule id, always written quoted) on a one-line paragraph, the button's label:

  ```
  <!-- block: button rule="01JC7ZK3T9Q4M2X8B5N6R1V0WE" -->
  Start weekly review
  ```

- Exact text written when inserted: `<!-- block: button rule="<id>" -->` + the document's line ending + the label + line ending, as its own block (blank lines around it as any block). A missing or empty `rule` value means no automation chosen yet (`<!-- block: button -->`). Editing the label rewrites only the label line; choosing another rule rewrites only the annotation line (M7 rule 2). Both forms of `rule=` (bare or quoted) are read.
- `KNOWN_OPTIONS` gains `{key: 'button', value: 'flag', appliesTo: ['button']}` and `{key: 'rule', value: /^[\w.-]{0,100}$/, appliesTo: ['button'], quoted: true}` after `bookmark` in canonical order; `OptionTarget` gains `'button'`; `blockTree` offers `'button'` for a paragraph whose source is one line. Anything else (two lines, a list) keeps the annotation as an ordinary comment (M7 rule 4), losing no byte.
- **Without the app** the comment is hidden by every Markdown renderer and the label reads as a plain paragraph; export (`exportdoc.py`) already drops annotation lines.
- Pressing it calls `api.runAutomation(ruleId, path)` with the path of the object whose body holds the block. In a template file the button is shown disabled with `"Buttons run in objects made from this template."` (our string). A rule id that isn't found shows the label with `"Automation not found"` (our string); nothing is written.

### Button property kind

- `PropertyType` gains `button` (T1, done): name "Button", description "Run an automation on this object with one click", icon `ph-cursor-click` (our strings and choice; `KIND_META`, `PROPERTY_ICONS`). It is the last "+ Add Property" item. It is no "Change property type" source or target (`KIND_TRANSFORMS.button = []`), has no filter operators (`FILTER_OPTIONS.button = []`), no sort, group or column calculation.
- **Stored value: none.** It never appears in frontmatter; `decode` gives `null`, rows serve `null`, `PUT /api/object/properties` of its key answers 422 (Lane B adds `button` to `propvalues._READ_ONLY_KINDS`), templates and duplicates have nothing to copy. Deleting the property rewrites no object and needs no confirm.
- **Options:** `ruleId: string | null` (our key; default `null`, set by `typeEdits.addProperty` and `typemodel._default_options`). The rule should be a `button` rule; any scope is accepted (a mismatch answers 422 on press).
- **Cell:** a button labelled with the property's name; pressing runs the rule on the cell's object (`CellExtras.path`, which the table, kanban and card layouts must now pass); while it runs it shows a spinner; afterwards a short notice `"Done"` / the run's failure message (our strings). Disabled with a tooltip when `ruleId` is null (`"Choose an automation in the property's settings"`), the rule is missing (`"Automation not found"`) or turned off (`"This automation is turned off."`). Its property settings add an "Automation" picker (button rules, plus "New automation…" which opens the rule editor with a button trigger scoped to this type).

### Settings > Automations

In the **Space** group, after "Task management" (registered in T1 as a stub: heading "Automations", `ph-lightning`, description "Rules that edit your objects for you, on this computer.").

- A **"New automation"** button opens the rule editor.
- One row per rule (the list route's order): a switch (enabled; `PUT` the whole rule with `enabled` flipped, one reload and retry on 409), the name, a one-line summary of the trigger ("When a Task is created", "When Status changes to Done", "Every week on Monday at 09:00", "When pressed", our strings), and the last run ("Ran 5 minutes ago", "Failed 2 hours ago: <error>", "Never ran", our strings) from `lastRun`. A row whose `readOnlyReason` is set shows the reason and no switch. A row menu: "Edit", "Run log", "Delete" (to the trash, no confirm). A template repeat shows "Repeats template “<name>”" and "Edit" opens the Repeat dialog instead of the rule editor.
- **Run log:** a sub-page listing `api.automationRuns(id)` newest first: time, trigger (with its object as a link), status, and each action's line (status, the object it wrote or created as a link, the detail). It refreshes on `automationRuns` events for that rule.
- The list reloads on `automations` events and on `automationRuns` events (for `lastRun`).

### Rule editor

A dialog ("New automation" / "Edit automation", our strings), wide like the type settings:

1. **Name** (required).
2. **When**: the trigger kind ("An object is created", "A property changes", "On a schedule", "A button is pressed", our strings) and its fields: a type-or-collection picker; for property changes a property picker and "to any value" / "to" + the filter value editor (`FilterEditor`'s value row for that kind); for schedules the M8 repeat picker (`tasks/RepeatMenu.tsx` and `CustomRepeatDialog.tsx`, by due date only), a time field (24-hour or 12-hour by the device setting) and a start date (default: the next day the rule matches); for buttons "Any object" or a type-or-collection picker.
3. **Only if** (not for schedules): `FilterEditor` over the scope's properties; empty means always.
4. **Then**: the action list, "+ Add action" menu (the nine kinds; the object ones hidden on schedules), each row with its fields (property picker and that property's cell as value editor with a "Now" choice for dates; tag picker; collection picker; type, template and "Relate back through" pickers; a text field with a placeholder hint `{title} {link} {date:YYYY-MM-DD}`; notification title and body), drag to reorder, remove.
5. Footer: "Turned on" switch, "Cancel", "Save". A 422 shows its message above the footer; a 409 reloads the rule and asks to save again.

### Catch-up dialog

Opened as described under Schedules. Title "Missed automations" (our string); one row per item: `Create the {count} missed “{name}”?` when `createsObjects` (the plan's "Create the 3 missed weekly reviews?"), else `Run “{name}” for the {count} missed times?` (our strings); `{count}` shows `50+` when `capped`. The server sends a template repeat's item with the template's name as `name` (so "Create the 3 missed “Weekly review”?"), any other rule's with the rule's name. Buttons "Run all", "Only the latest", "Skip" (our strings) answer that row; the dialog closes when every row is answered. Closing it without answering leaves the items pending (it opens again on the next start). Mounted with the app's global overlays.

### Client (T1, done)

`api.automations()`, `automation(id)`, `createAutomation(input)`, `saveAutomation(rule, {baseRevision})`, `deleteAutomation(id)`, `runAutomation(id, path)`, `automationRuns(id, limit?)`, `automationCatchUp()`, `confirmAutomationCatchUp(ruleId, choice)`. Types: `AutomationRule`, `AutomationRuleInput`, `AutomationTrigger` (+ the four), `AutomationAction` (+ the nine), `AutomationScope`, `AutomationRun`, `AutomationCatchUpItem`, `AutomationCatchUpChoice`, `OBJECT_ACTION_KINDS`; `ChangeKind` gains `automations` and `automationRuns`; `TrashItem.kind` gains `automation` (`automationId`); `RestoreResult.automationIds`; `PropertyOptions.ruleId`. Test helpers `automationRule()` and `automationRun()` in `test/mockApi.ts`.

### Our choices (summary)

1. Rule ids are ULIDs, the file name only.
2. Conditions reuse the view filter group, max 3 deep; a back-end port with a shared parity fixture.
3. A collection-scoped "object created" also fires when an object is added to the collection.
4. "Changes to" means it didn't match before and matches after.
5. A schedule's `start` is its first occurrence, as a Task's date is; the editor defaults it to a matching day.
6. Schedule rules have no conditions and no object actions.
7. Tags are referenced by Tag object id, collections by collection id.
8. A run's object actions are one write, first; other actions follow in order; one failed action doesn't stop the rest.
9. Placeholders `{title}`, `{link}`, `{date:FMT}` in titles, appended text and notifications only.
10. "Now", `{date:...}` and the daily note use the run instant; catch-up runs use the occurrence's instant.
11. Daily-note appends add lines with no blank line, creating the note when missing.
12. Notifications obey "Activate notifications".
13. The hook fires for stamped writes and the create paths; not for unstamped rewrites, body-only saves, version restores, trash restores or templates.
14. Triggered runs are queued on one worker thread after the request returns; buttons and catch-up answers run synchronously.
15. Nothing is owed on a first start, an unreadable state file, a new, re-enabled or rescheduled rule; at most 50 missed per rule are kept; a gap over 10 minutes while running becomes catch-up.
16. Condition misses of automatic triggers aren't logged; button presses and catch-up answers always are.
17. A template's repeat lives only in its rule file, linked by `templateRepeat.templateId`.
18. The button block's `rule` is always written quoted; buttons are disabled in templates.
19. The Button property holds no value; its options hold `ruleId`.
20. Settings > Automations sits in the Space group after Task management.

## Lanes

T1 owns `api/types.ts`, `api/client.ts`, `test/mockApi.ts`, `properties/kinds.ts`, `cellFor.ts`, `typeEdits.ts`, `views/filter.ts`'s kind table, `settings/SettingsModal.tsx`, `useSettingsModal.ts`, `typemodel.py`'s icon and default options, and `automations_model.py`. A lane that needs a change there says so in its report rather than editing them (Lane U may replace the bodies of the two stubs it owns, `properties/cells/ButtonCell.tsx` and `settings/sections/Automations.tsx`).

- **Lane B (back end):** `automations.py` (rule store over `JsonStore`, validation against the space, the engine and its queue and worker, the scheduler, catch-up, state file, run log, placeholders), `automation_filter.py` (the filter port), `writeorigin.py`, `WriteNotice` and `after_write` in `space.py` and its calls in the write funnels, `button` in `propvalues._READ_ONLY_KINDS`, automation trash entries in `trash.py`/`space.py` (delete, list, restore, purge with the log), the watcher's `automations` folder, `api_automations.py` and its mount and lifespan start/stop in `server.py`, the server's resync list, the test hooks, tests (`backend/tests/test_m14_*.py`, the parity pytest and vitest over the shared fixture), and `scripts/m14_acceptance.py`, which runs on a copy of a fixture space with `OBJECT_CLOCK_FILE`, `OBJECT_STATE_DIR` and `OBJECT_FAKE_NOTIFY_FILE`: a status-to-Done rule stamps a date; a creation rule tags new objects and appends to the daily note; a button run; a weekly template repeat runs at its time; the server stops, the clock moves three weeks, the server starts and the catch-up lists 3, "Run all" creates 3 dated objects; an external edit of a matching file triggers nothing; no rule write triggers another rule; `git status` of the space shows only the intended files.
- **Lane U (front end):** the rule editor (`frontend/src/automations/`), Settings > Automations (list, switch, run log) in `settings/sections/Automations.tsx`, the catch-up dialog (in `automations/`, mounted in the global overlays), the template "Repeat" option (`types/TemplateManager.tsx` row menu and `object/TemplateMarker.tsx`, with its dialog in `automations/`), the button block (editor data layer first: `annotations.ts` options, `blockTree.ts`, `document.ts` parse and serialize, round-trip tests with CRLF and BOM fixtures; then the node view `editor/nodes/buttonBlock.ts` with its label edit and rule picker, and a "Button" slash item), the Button property cell and its settings picker (`properties/cells/ButtonCell.tsx`, a settings file under `properties/settings/`, passing `path` to cells in the table, kanban and card layouts), Trash rows for automation entries, tests.

## Review focus

- No loop: a rule whose action matches its own trigger (status → set status) runs once per user write; two rules that trigger each other run once each.
- External edits (the watcher, a `git checkout`) never run a rule; opening the space writes nothing (no rule file, state file or log written on read).
- Every automation write is a normal write: history snapshot, `lastUpdated`, only its own frontmatter lines changed, CRLF/BOM kept, version-checked, announced with `automation:<id>`; a 409 retries once and is then logged, never forced.
- Missed schedule runs are never run silently, on start or after sleep; answering creates exactly the chosen occurrences, once each, dated by occurrence.
- A button block's file reads cleanly without the app and round-trips byte for byte; a Button property never writes a value.
- A user's save is never slowed by rules (the queue), and a 5,000-object CSV import with one creation rule keeps the app responsive.
- The open editor keeps its unsaved body when an automation changes only that object's frontmatter (`ObjectView`'s frontmatter-only merge).
- No network at runtime, nothing outside the space and the state dir, no product names in code.
