# Milestone 24 acceptance: brain dump and the agent loop

Status (2026-11-07): built, merged to `master` and gated 2026-11-06. Gene's 12 hand-checks below are unticked.

Plan: `2026-11-05-m24-brain-dump-and-agent-loop.md`. Design: `specs/2026-11-05-work-dashboard-design.md`. Date: 2026-11-06. Built on `ccr-381ccf85-cjstne` after M22 and M23 (Tasks 1-10 are commits `f348dd8..c45b4ae`).

## What was built

Enter in the brain-dump bar saves a **Capture** object at once (Status New); the work agent files it (a Work notes line, at most one new non-Approve step, a new Task, a fact on a page, or **Needs you** with a question). Gene's approvals, answers, decisions, notes and requests, and Agent steps that become current, queue work for the **Work agent** (an Object agent with the shell on and a `work-follow-through` skill). With **Agent acts on my approvals** on, Object runs due queue entries one at a time per space as headless chats of that agent and writes the outcome back to the queue. Read-only runs get narrowed tool lists enforced in code; only a run for an approved Approve step gets the agent's full set. **Desk sync** is an M21 schedule (off, 07:00 on weekdays) that updates ticket fields only. M23's brain-dump bar, agent pill, Agent queue, Stuck, Now's "Agent is carrying" and "Parked dumps need you", **Ask the agent**, **Ask the agent to break it down** and **Run now** are live; the **Captures** view is new.

## How to run the acceptance script

```
PYTHONPATH=scripts:backend uv run python scripts/m24_acceptance.py [SPACE] [--keep]
```

Default SPACE is `backend/tests/fixtures/space-work` with `space-work-m23` copied over it (as `m23_acceptance.py` does). It copies the space to a temp folder (the original is never touched), points `HOME` at a temp home holding the synthetic `change-reviewer` (so `~/.claude` is never read), sets the state, cache, clock, notify and `FAKE_CLAUDE_LOG` variables to temp paths, serves the app on a free `127.0.0.1` port and sets `claudePath` to the fake `claude`. `FAKE_CLAUDE_WORK_ACTIONS` scripts what each entry kind does. It prints `[ok]`/`[FAIL]` per check and `RESULT: PASS` (exit 0) only when all pass. Checks: (1) Create the Work agent (shell on, skill, copied change-reviewer); (2) a brain dump with the switch off (Capture at once, pending entry, no CLI); (3) switch on and filing (Filed to a new Task, capture kept, no `Bash` allowed, `Bash` disallowed); (4) approve (one run with `Bash`, step Done with "Change review: PASS", entry done); (5) auto-run of an Agent step that becomes current after Gene answers the question before it (switching the setting on scans nothing; `auto`, `work-read`, failed with an ask, a Question inserted before it, shown failed in `GET /work/agent`); (6) approve then reopen with the switch off (withdrawn, never runs); (7) `Question about INC0012345: ...` and `Break down OPS-123 step n: ...` (right items, `question` and `breakDown` entries, a note, three smaller steps); (8) a `work-read` token's property write is 403 "This run is read-only."; (9) restart with `OBJECT_TEST_WORK_TIMEOUT=3` (queue survives; a `FAKE:wait` capture fails `TIMED_OUT`; Retry queues it again and it files); (10) Desk sync (set up off, 07:00 every weekday; the schedule tick runs it as `work-sync`; Desk status changes, Object's status does not); (11) every GET route leaves the space bytes and the state dir unchanged.

Result on 2026-11-06 (Linux): `RESULT: PASS`, all checks `[ok]`.

## Deviations and our calls (from the tasks, their commits and the integration)

- **`captures.save` titles**: a title cut at 80 characters that would end in `...` ends with U+2026 instead, because a plain YAML scalar ending in `...` reads as a document end and breaks `set_keys`.
- **Fake `claude`**: `WORK_LINE` matches `Work queue entry <id>: <kind>.` also after the `# The user's message` header the CLI prompt gets, not only at the very start. `FAKE_CLAUDE_WORK_ACTIONS` fills `{path}`, `{stepId}`, `{stepRev}` and `{capture}` in nested lists and objects too.
- **Ask the agent** sends an M22 `request` note (M23's call), not a `Question about <item>:` capture; the prefix still works when typed into the brain-dump bar.
- **Desk sync is covered by the acceptance script, not a unit test**: the plan's `test_desk_sync_runs_read_only` was skipped in Task 8. Check 10 does it end to end. The fake has no `work-sync` table (a Desk sync run is a schedule, not a queue entry), so the script adds a `FAKE:mcp:object-agent:sync_ticket_fields:{...}` marker to the rule's prompt (through `PUT /api/automations/{id}`) and walks the clock to Friday 2026-11-06 07:00:30 with `_test/tick`. Nothing in the app is changed for this.
- **The acceptance script** uses the M23 overlay (the plan named only `space-work`), runs with auto-run switched off until check 5 so each check sees only its own runs, adds an Approve step before Badge reader audit's first open step for check 6 (Approve acts only on the current step), and touches `<FAKE_CLAUDE_LOG>.go` before Retry so the retried `FAKE:wait` run finishes. The timeout text still says "30 minutes" in a 3-second test run (it is one constant).
- **Auto-run (after the review fix `5bb153f`)** fires only when an Agent step becomes current after Gene's action with **Agent acts on my approvals** on; switching **Agent runs by itself** on scans nothing. Check 5 adds a Question before the Agent step and answers it. That answer also queues an `answer` entry, so two read-only runs follow.
- **Restart quirk seen in check 9**: a capture queued before a restart and failing after it is queued once more by the unqueued-capture scan (the loop's memory of what it queued is lost at restart), so two failed entries exist for it; the script retries the last. Harmless, but not what the code comment promises.
- **Front-end test added at integration**: `WorkPage lists Captures` in `frontend/src/work/page/WorkPage.test.tsx` (it reads the views the page's glob registered at import, because `resetWorkViews` drops them).
- **Gate**: the full back-end and front-end gate (and the single review of M19-M24 with its fix pass) is still to be recorded; the numbers go in `remaining-work.md` ("M24", item 15).

## Hand checks for Gene (on a copy of your work export, kept outside the repo)

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

## Review items closed (2026-11-09, sweep, Gene's decisions)
- **Retry after a timed-out Approve step:** a failed, timed-out, stopped or crashed run of an Approve step sends the step back to "needs approval"; its queue entry is withdrawn with "The run didn't finish; approve the step again to retry." (shown under the step; the Agent queue drops the row), and Retry answers 409 with that reason. Other step kinds keep Retry.
- **A full-tool Work run reaching local app routes:** refused by `runfence.py` (see `m27-acceptance.md`, "Open review items", for the limits).
- **`file_capture` not atomic:** it already was (every capture write goes through `Space._write`: temp file, fsync, one replace); `test_m24_captures.py` now pins it.
- **Still open:** no auto-run depth cap; learning and A2A routes rely on the CLI tool lists.

