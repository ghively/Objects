# Milestone 23 acceptance: the Work section

Plan: `2026-11-05-m23-work-section.md`. Design: `specs/2026-11-05-work-dashboard-design.md`, sections 5 and 6 and "Design language". Date: 2026-11-06. Built on `feat/m22-m23`, merged to `master` with M16-M21 on 2026-11-06.

## What was built

A **Work** entry in the sidebar below Agents opens the work page: top bar, brain-dump bar, focus rail and the views (Now, Flow, Projects map, Today, On the floor, Your queues, Agent queue, Stuck, Wins, Alerts, Everything, plus Tickets). The front end computes every view from one `GET /api/work/board`. New back-end pieces: focus lines in the daily note, today's meetings, wins from steps and version history, the Alert type with the monitoring-folder watch, the general floor list (`.object/work/floor.json`), the M24 seams, and the keep-on-top window. Every write to a work item still goes through M22's routes.

## Integration (Task 18)

- The integrate task never ran on the build track; it was done after the merge. `scripts/m23_acceptance.py` drives the routes over HTTP on a copy of `space-work` with `space-work-m23` over it and the monitoring fixtures; it passes, and so does `m22_acceptance.py`.
- Open item from Task 10: `NowSide.tsx` keeps three strings (`No more meetings today`, `Steps done today`, `Focus`) as local constants instead of in `WORK_TEXT`.
- The milestone review and fix pass were run after the merge, with M19-M22; see `remaining-work.md`.

## How to run the acceptance script

```
uv run python scripts/m23_acceptance.py [SPACE] [--keep]
```

It copies the space and the monitoring folder to a temp folder (originals untouched), serves the app on a free port with the clock fixed at 2026-11-05T10:00:00Z, and prints `[ok]`/`[FAIL]` per check and `RESULT: PASS`. It checks: reads write nothing; the board; focus saves (only the Focus list lines change; stale version 409; a new day creates its note); today's meetings; a step action and its Undo; the folder watch (two Alert objects, `[redacted]`, stale and error sources, no duplicates, Cleared at); the general floor; wins; the M24 seams; and that only the intended files changed.

## Hand checks for Gene (on a copy of your space)

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
