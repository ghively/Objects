# Milestone 4 acceptance

Plan: `2026-10-26-m4-calendar-daily-tasks.md`, Task 16. Date: 2026-10-26. Built on a Linux cloud container, not Gene's Windows PC.

## Automated results

| Suite | Command | Result |
|---|---|---|
| Back end | `uv run pytest backend/tests -q` | 611 passed |
| Front end | `cd frontend && npx vitest run` | 652 passed (99 files) |
| Type check | `cd frontend && npx tsc -b --noEmit` | clean |
| Lint | `cd frontend && npm run lint` | 0 errors (warnings only, mostly the React-compiler `refs` / `set-state-in-effect` rules) |
| Build | `cd frontend && npm run build` | built (`dist/`) |
| M4 acceptance | `uv run python scripts/m4_acceptance.py backend/tests/fixtures/space-calendar` | PASS (24/24 `[ok]`) |
| M4 acceptance | `uv run python scripts/m4_acceptance.py backend/tests/fixtures/space-sample` | PASS (24/24 `[ok]`) |
| M4 acceptance | `uv run python scripts/m4_acceptance.py backend/tests/fixtures/space-v1` | PASS (24/24 `[ok]`) |
| M4 acceptance, other zone | `TZ=Pacific/Auckland uv run python scripts/m4_acceptance.py backend/tests/fixtures/space-calendar` | PASS (the midnight check then covers a UTC+13 local day) |
| Earlier milestones | `m1_roundtrip.py`, `m2_acceptance.py`, `m3_acceptance.py` on `space-sample`; `m3_acceptance.py` on `space-calendar` | PASS |

`m2_acceptance.py` was not written for `space-calendar`. It expects `space-sample` content such as `Pages/Notes.md` and a Server type, so it fails on that space by design.

### `scripts/m4_acceptance.py`

The script works on a temporary git-committed copy of the space. It serves that copy on a free `127.0.0.1` port with the Task 6 test hooks set: `OBJECT_CLOCK_FILE` (the script moves time by rewriting that file), `OBJECT_FAKE_NOTIFY_FILE` (notifications go to a file, never to the OS, and `POST /api/_test/tick` is enabled) and `OBJECT_STATE_DIR` (a temporary ledger folder). It runs the plan's nine checks:

1. Two starts plus the read routes (`GET /api/calendar` over the month, `POST /api/rows` over Tasks) leave `git status` clean, and there is no daily note for today.
2. `POST /api/daily-notes` writes exactly `DailyNotes/<today>.md` with keys `id, type, title, createdAt, lastUpdated, date, reviewed`. A second call returns 409 with that path.
3. Setting `date`, `repeat: every week` and `remind: 1 day before at 09:00` gives one added line per key.
4. Completing that recurring task touches only `status`/`date`/`completed`/`lastUpdated`. The date moves to the next weekly occurrence on or after today, the status goes back to Not Started, and the response has `advanced: true`.
5. A one-off task: completing it touches `status` and `completed`. Reopening removes `completed`.
6. The calendar shows:
   - the daily note
   - the task on its date, with its later occurrences
   - an object created at 00:00:30 local time, on the right local day
   - a three-day range on each of its days
   - no `hidden` or `hideCalendarEvents` property
7. Reminders:
   - nothing fires at 08:59
   - exactly one fake notification at 09:00:30, and a second tick adds none
   - the space stays clean, and the ledger is in `OBJECT_STATE_DIR`
   - after a restart there is still only one notification
8. `PUT /api/ui` with `calendar`/`tasks` writes only `.object/ui.json`. A stale revision returns 409.
9. The M1 no-edit pass changes 0 files.

Deviation: `space-sample` and `space-v1` infer their Task status options from their tasks, and none of those tasks is Done. Opening keeps a type's own options (Task 3), so these spaces have no done-category status, and the front end's checkbox says "This type has no status for that." Before check 3, the script adds a "Done" option (`statusCategory: done`) through `PUT /api/types/{id}`, as the type settings would, and logs it. On `space-calendar` the option already exists and nothing is added.

### Front-to-back wiring check

I built the app and served it with `build_server_config` against a scratch copy of `space-calendar` on port 8794, with the fake notifier and a temporary state folder. The routes answered with the shapes in `api/client.ts` and `api/types.ts`:

- `GET /api/calendar` gives a `CalendarRange` that includes the duplicate-note warning for 2026-10-23. A 365-day range returns 422.
- `POST /api/daily-notes` returns 201 `{path, version, typeIds}`. For an existing day it returns 409 `{detail, path}`, and for `2026-13-01` it returns 422.
- `PUT /api/object/properties` with status Done returns `task: {completed, advanced, date}` and the hook's keys in `frontmatter`.
- `PUT /api/ui` accepts `calendar` and `reminders`. An unknown key returns 422 "Cannot patch: bogus".
- `POST /api/rows` decodes `repeat`, `remind`, `status` and `date`.

In Playwright (Chromium), the Calendar (Day view: header, chips, tabs, inline daily note, Tasks with Overdue) and the Tasks page (Status kanban by category) both rendered with 0 console errors. The server was stopped afterwards.

No contract mismatches were found, so no wiring changes were needed. All 15 build tasks reported done, so there was nothing partial or blocked to finish.

## Gene's hand-run checks (not yet done)

Run `npm run build`, then `uv run objectapp --space <copy of backend/tests/fixtures/space-calendar>`, and walk through the following.

### Calendar

- [ ] All four views (Day, Three days, Week, Month); the pager, Today, Shift+Today and the arrow keys in each view. M, W, R, D, T and ←/→ are Object's calendar keys (its shortcut table; `reference-check-2026-10-28.md` §1). ↑/↓ (previous/next higher unit) have no key in Object's table; they stay ours until Gene decides.
- [ ] The mini month: month and year dropdowns, today, the daily-note dots; the Day header and week numbers around a Sunday and the year boundary.
- [ ] "+ Daily Note", typing in the inline note, the Reviewed button, an external edit of the note in VS Code appearing in the page, a daily note template.
- [ ] The Day sections and tabs, quick-create chips (including a `createOnce` type and a hidden type), a dated object with a range on each of its days, "Move all open tasks to".
- [ ] Three days: should empty sections ("No tasks on this day") be hidden, as in `02-calendar-three-days.png`? (Task 14 shows them.)

### Tasks

- [ ] The Tasks page: the Status tab as list and kanban, a drag between categories, the Today, Inbox, Deadline, Scheduled, Recurring, Reminders and Completed tabs, quick add, the Task type page without an Overview tab.
- [ ] A task with Repeat (daily, weekday, custom by completion, with an end date) completed twice.
- [ ] A reminder set a minute ahead fires one Windows notification while the app is open, and none once the task is done.
- [ ] A reminder set to a time already past stays silent, also across a restart.

### On the CPI copy (outside the repo, `git init` done there)

- [ ] His existing Task type keeps its own `priority`/`deadline` definitions and options. If its status has no Done option, note it: the checkbox can't complete tasks until one is added.
- [ ] His existing daily notes appear on their days, including any whose `date` key is missing.
- [ ] Opening the Calendar and Tasks changes no file.
- [ ] Completing a recurring task: the `git diff` is the status, date and completed lines plus `lastUpdated`.
- [ ] A month with 5,000+ objects switches views without a visible stall.
- [ ] Side by side with Object:
  - [ ] the Day view and Three days, against the `01`/`02` screenshots
  - [ ] the mini month
  - [ ] the pager and the segmented control
  - [ ] the Tasks page
  - [ ] the Week view (stacked days) and the Month view (daily-note card list)
  - [ ] the daily-note marker in the mini month, which this plan designed without a reference; note what Object does differently so a fix pass can follow
- [ ] Reminders: one banner per reminder, none after quitting the app, one catch-up after reopening within 12 hours.
