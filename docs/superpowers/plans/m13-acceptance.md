# Milestone 13 acceptance: calendar, timeline and chart layouts

Status (2026-11-07): built, reviewed and gated (Linux and, after the merge, Windows, 2026-11-05); merged to `master`. Gene's 5 hand-checks below are unticked.

Plan: `2026-11-05-m13-view-layouts.md` (expanded from the 2026-11-04 features plan, M13). Date: 2026-11-05. Built on a Linux cloud container, not on Gene's Windows PC, on branch `feat/m13-view-layouts` off `master` at `c72567f` (it does not need M10, M11 or M12).

## What was built

- **Three new layouts** in the layout menu of type pages, collections, queries, the Tasks page, sections and embedded views: Calendar, Timeline and Chart. Each keeps its settings in the view (`calendarConfig`, `timelineConfig`, `chartConfig`) and has its own page in Customize view.
- **Calendar** (`views/layouts/CalendarLayout.tsx`, `calendar/`): a month grid or a week strip on any date property (or Created at / Last updated), previous, Today and next; drag an object to another day (only that property's line changes; a range keeps its length, a time keeps its time); click an empty spot of a day, or its "+" button, to create an object on that day; "+N more" and a "No date (N)" list.
- **Timeline** (`views/layouts/TimelineLayout.tsx`, `timeline/`): bars from a start and an optional end property (or a range), five zooms (day to year), Today, a table on the left with chosen columns and their calculations, drag a bar or its edges (written once, on drop), a "No date" tray whose items can be dragged onto the axis, nested sub-items and dependency arrows with a handle to add one.
- **Sub-items and dependencies** (`views/RelationPairsPage.tsx`, `POST /api/types/{id}/relation-pair`): "Turn on sub-items" adds the two-way pair "Parent item" (one) and "Sub-items" (many) to the type; "Turn on dependencies" adds "Blocked by" and "Blocking". They are ordinary relations, so they show on the object page, in the graph and to agents. Table and timeline views nest rows under their parent.
- **Chart** (`views/layouts/ChartLayout.tsx`, `chart/`): bar, horizontal bar, line, donut and a single number, drawn as our own SVG. X groups by any groupable property (date buckets day to year), Y is a count or a column calculation of a number property, optionally split by a second property; cumulative lines, sort, hide empty groups, legend and values. Clicking a bar lists its objects with "Show as table". Export as PNG or SVG.

## Our choices (for Gene to check)

1. The layout names and icons; the three draw every row of the view (no "Load more") and ignore group-by; the calendar and timeline still draw with no rows, so a day click can create the first object.
2. Calendar: a missing or wrong date property falls back to the first date property of the first type, else Created at; Date & time properties count; Created at and Last updated are listed after the type's own dates and can't be dragged or created on; read-only rows can't be dragged.
3. Calendar: a range dropped by its middle day moves as a whole by the difference; a drop on the same day writes nothing; an end before its start is drawn on the start day; times show their start time on their first day.
4. Calendar: the month grid shows only the weeks that hold a day of the month, with outside days muted but usable; at most 4 chips a day in the month grid and 12 in the week strip, then "+N more", which lists the whole day; the shown period always opens on today and isn't saved; Month and Week are switched in the layout's own header as well as in Customize.
5. Calendar: clicking a day creates an object of the first view type that has the property; the "No date" list opens objects but can't be dragged onto a day.
6. Timeline: the start property defaults to the first date property, else Created at; without an end property, the start's own range gives the end, and shrinking it to one day drops the end only for a day value; an end before the start draws one day.
7. Timeline: zoom scales (pixels per day) day 44, week 18, month 6, quarter 2.5, year 1.2; weeks start on Monday; rows are 32 px; the table is read-only (click a title to open it); Today scrolls into view on open and on zoom; toggles are open by default and not saved; the tray starts closed.
8. Timeline: the axis covers 10 years either side of the middle of the items' dates and today; items further out go to an "Out of range (N)" tray and can be dragged back onto the axis.
9. Timeline: dependency arrows go from the blocking item's end to the blocked item's start; the link handle is for the mouse only ("Blocked by" stays editable as a property); moving an item never moves its dependents.
10. Relation pairs: same-named properties are reused (ignoring case and spaces) only when they already are a matching relation to the type itself, else the request is refused naming the property; linking two existing, unlinked properties doesn't backfill old values; reusing a pair announces nothing; basic and read-only types show the buttons disabled with a note. A sub-item given a new parent leaves its old parent's list.
11. Two-way linking now allows one single-valued side ("Parent item"), when its partner is a list that links back; two single sides are still refused.
12. Nested table rows: on only when the view isn't grouped; a row whose parent is filtered out is top-level; a cycle is shown at top level; Shift-click ranges follow the drawn order (rows under a collapsed parent are still inside a range).
13. Chart: the X axis offers every groupable property plus Type; a status groups by option, a number by exact value; a date split uses the X bucket; the Y axis has no date calculations; a new Y property starts at Sum for numbers, else Count not empty; an empty calculation counts as 0.
14. Chart: "Other" (no value) sorts last; Y sorting uses the stack total; with Hide empty groups off, a date axis fills the missing buckets (up to 1,000); stacks show their total only for calculations that add up; the chart is 300 px tall, horizontal bars 26 px a row; the legend shows only for split series and donut slices; past 60 categories a line chart draws only points that have objects.
15. Chart: clicking the same bar again closes its list; the list shows 100 objects then "Show all (N)"; "Show as table" adds a filter for the group and switches to the table, and when no filter keeps exactly that group's objects (or the view offers no table), a message replaces the button.
16. Chart export: PNG at twice the size and SVG, named after the view (the type's plural name, the collection, query or section name), else "Chart"; only same-origin fonts and images are embedded.
17. All labels are our strings ("No date (N)", "Out of range (N)", "+N more", "Turn on sub-items", "Show as table" and the rest).

## Review

One whole-milestone review after the three lanes were merged found one high finding (a timeline drag dropped the end time of a time range that ends on its start day), two medium (a tray item dropped outside the visible axis still wrote a date; a move wrote a new end value where there was none) and several low ones: the chart's table filter could list different objects than the bar, the timeline shifted times in the browser's zone, keyboard and screen reader gaps, three slow paths at 2,000 rows, the week cap, the timeline's fixed window height and the two-way linking display. All were fixed in one pass with a test each (choices 4, 8, 9, 14, 15 and 16).

## Automated results

| Suite | Command | Result |
|---|---|---|
| Baseline before M13 | `uv run pytest backend/tests -q` at `c72567f` | 1603 passed, 1 skipped, 3 xpassed |
| Back end | `uv run pytest backend/tests -q` | 1616 passed, 1 skipped, 3 xpassed (M13 adds 13 in `test_m13_relation_pair.py`) |
| Front end | `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run lint && npm run build` | vitest 2670 passed, 1 skipped; `tsc` clean; lint 0 errors; build ok |
| M13 acceptance | `uv run python scripts/m13_acceptance.py backend/tests/fixtures/<space>` | PASS on `space-sample`, `space-m8`, `space-v1` |
| Earlier acceptance | `m2` (`space-sample`), `m8` (`space-m8`), `m9 --skip-roundtrip` (`space-m8`) | PASS |

`scripts/m13_acceptance.py` runs a git-committed temp copy served on `127.0.0.1` with a test clock: reads change nothing; a view saved with each new layout and its settings reads back the same; the relation pairs are created once and reused on a second call with only the type file changed, and a stale revision is refused; setting "Blocked by" fills "Blocking" on the other object, changing only those lines and `lastUpdated`; a drag's date write changes only its own line; reads after the writes leave `git status` clean.

Not verified here: the Windows run, the app's own window (pywebview), and the three layouts in a real browser (the drags were tested in jsdom only).

## Known gaps

- Bars and calendar chips can't be moved with the keyboard; the timeline's table can't be edited inline.
- The timeline draws dependency arrows and its header for the whole range, not only what is on screen; very long ranges at day zoom draw many header cells.
- Turning on a pair whose two properties already exist but aren't linked doesn't fill in the missing reverse values.

## Hand-checks for Gene

- [ ] On a Task type page, switch to Calendar: tasks sit on their dates; drag one to another day and only its date line (and `lastUpdated`) changes; click an empty day and a new task opens with that date.
- [ ] Switch to Timeline with a start and end date: drag a bar and its edges; Today, zoom, the table columns and the "No date" tray work.
- [ ] Customize > Sub-items and dependencies: turn on sub-items, give a task a parent, and the table and timeline nest it; turn on dependencies and drag from a bar's handle onto another bar to draw an arrow.
- [ ] Switch to Chart: a bar chart of tasks by status; split by priority; a line chart by month, cumulative; click a bar, then "Show as table"; export PNG and SVG.
- [ ] Each layout in Light and Dark, and inside a page as an embedded view.
