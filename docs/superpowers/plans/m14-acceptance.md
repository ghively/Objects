# Milestone 14 acceptance: local automations

Plan: `2026-11-05-m14-automations.md` (expanded from the 2026-11-04 features plan, M14). Date: 2026-11-05. Built on a Linux cloud container, not on Gene's Windows PC, on branch `feat/m14-automations` off `master` at `c72567f` (it does not need M10, M11, M12 or M13).

## What was built

- **Rules** (`backend/objectapp/automations.py`, `automations_model.py`, `api_automations.py`): each rule is one JSON file in `.object/automations/<id>.json`, so rules travel with the space and can be versioned. A rule has a trigger, conditions (the view filter group) and 1 to 20 actions. Schedule state and run logs live in the per-user state dir; opening a space writes nothing.
- **Triggers**: an object is created (in a type or a collection, including being added to one), a property changes (optionally "changes to" a filter), a schedule (M8 repeat text at a time of day), and a button press.
- **Actions**: set or clear a property (a date can be set to "now"), add or remove a tag, add to or remove from a collection, create an object from a template (optionally related back to the triggering object), append a line to the daily note, and show a notification. `{title}`, `{link}` and `{date:FMT}` fill in titles, appended text and notifications.
- **Running** (`automations.py`): triggered runs go on one worker thread after the user's request returns, so a save is never slowed. Every automation write is a normal write: history snapshot, `lastUpdated`, only its own frontmatter lines, version-checked, announced with `automation:<id>`. A rule's own writes never trigger rules, so nothing loops. External edits (the watcher, a `git checkout`) never run a rule.
- **Conditions on the server** (`automation_filter.py`): a port of the view filter code, kept in step by one shared table of cases (`frontend/src/views/__fixtures__/filter-cases.json`) run by both a pytest and a vitest file.
- **Schedules and catch-up**: missed schedule runs are never run silently. After the app was closed or the computer slept, a catch-up dialog lists what was missed (at most 50 per rule) with "Run all", per-item choices and "Later"; answering creates exactly the chosen occurrences, dated by occurrence.
- **Template "Repeat"** (`types/TemplateManager.tsx`, `object/TemplateMarker.tsx`): a template can repeat on a schedule, which is an ordinary schedule rule whose action creates an object from that template.
- **Button block** (`editor/nodes/buttonBlock.ts`, `annotations.ts`, `blockTree.ts`, `document.ts`): a "Button" slash item puts a button in a page that runs a rule on that page. The file reads cleanly without the app and round-trips byte for byte, CRLF and BOM included.
- **Button property** (`properties/cells/ButtonCell.tsx` and its settings): a property kind that holds no value and shows a button in the object page, table, kanban and cards.
- **Settings > Automations** (`settings/sections/Automations.tsx`, `frontend/src/automations/`): the list with an on/off switch per rule, the rule editor (trigger, conditions with the view filter editor, actions), each rule's run log, and Trash rows for deleted rules.
- **Create with text**: `POST /api/objects` now takes `body` and `appendBody`, so "Move to new page", "Create page" from a paste and Turn into create the page with its text in one write (review fix 2).

## Our choices (for Gene to check)

1. Rule ids are ULIDs and are only the file name; a rule file with an unknown `schemaVersion` loads read-only ("made by a newer version"), never runs and hides Edit and Delete.
2. Conditions reuse the view filter group, at most 3 groups deep. In rule conditions "this week" always runs Monday to Sunday, as views show it, whatever the space's week start.
3. A collection-scoped "object created" also fires when an existing object is added to the collection. "Changes to" means the object didn't match before the write and does after.
4. A schedule's start day is its first occurrence, as a Task's date is; a new schedule defaults to weekly on Monday at 09:00. Schedule rules have no conditions and no actions on an object; "after completion" repeats are refused.
5. Tags are referenced by Tag object id, collections by collection id.
6. A run's object actions are applied as one write, first; the other actions follow in order; one failed action doesn't stop the rest. A write that hits a conflict is retried once (finding the object again if it was renamed), then logged as "The object changed while the automation was running.", never forced.
7. Placeholders work only in created titles, appended text and notifications. "Now", `{date:…}` and the daily note use the run's time; catch-up runs use the missed occurrence's time.
8. Daily-note appends add lines with no blank line, creating the note when it's missing. Notifications obey "Activate notifications".
9. Rules fire for the app's stamped writes and its create paths, not for unstamped rewrites, body-only saves, version restores, trash restores or templates. A repeating task marked Done fires "changes to Done" even though the task moves on to its next date (review fix 4).
10. Nothing is owed on a first start, an unreadable state file, or a new, turned-on or rescheduled rule. A gap of more than 10 minutes while running (sleep) becomes catch-up. Quitting between ticks keeps what is owed (review fix 1).
11. On quit, queued runs that haven't started are dropped with one log line, and the running one gets up to 5 seconds.
12. Condition misses of automatic triggers aren't logged; button presses and catch-up answers always are.
13. A template's repeat lives only in its rule file. Buttons are disabled in templates. The button block's rule id is always written quoted; a label starting with `_`, or shaped like `[x]:`, is escaped so the file reads back the same.
14. A new button's label is "Run automation". The Button property holds no value; its settings hold the rule.
15. A rule that can no longer be checked against the space (say its template was deleted) can still be turned off and saved while off; turning it on with other edits is still checked (review fix 5).
16. An unreadable rule file answers 423 and keeps its schedule state and pending catch-up; only a deleted or turned-off rule drops them. Run logs whose rule is gone (and not in the Trash) are removed on start.
17. The catch-up dialog has "Later" and shows "50+" when the cap was hit. Settings > Automations sits in the Space group after Task management. Trash rows read "Automation".
18. `POST /api/objects` takes `body` (replaces the body the object would get) and `appendBody` (added below it after one blank line), both in the creating write.
19. All labels are our strings.

## Review

One whole-milestone review after the two lanes were merged found one high finding (quitting saved "now" as the last tick, so a schedule run due before the next start was lost), four medium (pages created and then saved separately hit a conflict when a creation rule ran in between; rename and type-change notices went out before the file moved; a repeating task's "changes to Done" never fired; a rule with a missing template couldn't be turned off) and four low (the week start differed between the server and the views; button labels starting with `_` or `[` didn't round-trip; quitting waited for the whole queue, an unreadable rule lost its pending runs, run logs were left behind; a type alias). All were fixed in one pass, each with a test seen failing before and passing after (choices 2, 6, 9, 10, 11, 13, 15, 16 and 18).

## Automated results

| Suite | Command | Result |
|---|---|---|
| Baseline before M14 | `uv run pytest backend/tests -q` at `c72567f` | 1603 passed, 1 skipped, 3 xpassed |
| Back end | `uv run pytest backend/tests -q` | 1750 passed, 1 skipped, 3 xpassed (M14 adds 147, mostly in `test_m14_*.py`) |
| Front end | `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run lint && npm run build` | vitest 2721 passed, 1 skipped; `tsc` clean; lint 0 errors (warnings only, of kinds the code base already has); build ok; app icons current |
| M14 acceptance | `uv run python scripts/m14_acceptance.py backend/tests/fixtures/<space>` | PASS on `space-sample` and `space-m8` |
| Earlier acceptance | `m2` (`space-sample`), `m8` (`space-m8`), `m9 --skip-roundtrip` (`space-m8`) | PASS |

`scripts/m14_acceptance.py` runs a git-committed temp copy served on `127.0.0.1` with a test clock, a test state dir and a fake notifier: a status-to-Done rule stamps a date; a creation rule tags new objects and appends to the daily note; a button run; a weekly template repeat runs at its time; the server stops, the clock moves three weeks, the server starts and the catch-up lists 3, and "Run all" creates 3 dated objects; an external edit of a matching file triggers nothing; no rule's write triggers another rule; `git status` of the space shows only the intended files.

Not verified here: the Windows run, the app's own window (pywebview), real desktop notifications, the editor and dialogs in a real browser (tested in jsdom only), and a real sleep and wake of the computer (simulated with the test clock).

## Known gaps

- "Move to today's daily note" and pasting to the daily note still create the note and then save its text separately; a daily-note creation rule can cause a conflict in a narrow window (the save re-reads the note first).
- The front end's calendar week start defaults to Sunday while the server's defaults to Monday; this predates M14 and rule conditions don't depend on it.
- Some rule checks happen only on the server (the editor shows the server's message); the run log has no paging.
- The rule editor's action list has no drag-and-drop test.

## Hand-checks for Gene

- [ ] Settings > Automations: make a rule "Task status changes to Done: set Completed to now". Mark a task Done: only its Completed line and `lastUpdated` change (`git diff`), and the run log shows the run.
- [ ] Make a creation rule that adds a tag and appends `Created {link}` to the daily note; create an object and check both.
- [ ] Put a Button block in a page (slash "Button"), pick a rule, press it; add a Button property to a type and press it from the table.
- [ ] Give a template a weekly Repeat; close the app, move the clock past two occurrences (or wait), reopen: the catch-up dialog lists them, and "Run all" creates them with their own dates.
- [ ] Edit a matching file outside the app (or `git checkout`): no rule runs.
- [ ] Turn a rule off and on from the list; delete one and restore it from the Trash.
- [ ] Each screen in Light and Dark.
