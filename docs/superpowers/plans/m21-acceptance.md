# Milestone 21 acceptance: agent schedules

Status (2026-11-07): built, merged to `master` and gated 2026-11-06. Gene's 11 hand-checks below are unticked.

Plan: `2026-11-05-m21-schedules.md`. Design: `specs/2026-11-05-agents-design.md`, section 9 (Schedules), with the curator line of section 5, the agent page of section 2 and "Where chats live". Date: 2026-11-06. Built on Gene's Windows 11 PC on branch `feat/m16-m24` (shared with M16-M24), commits `02c584d..40e8cec` plus this integration commit. Gene asked for M16-M24 to be built straight through, and on 2026-11-06 for two parallel tracks with one full gate per track; his hand checks below come later.

## What was built

- **Contract** (T1, `02c584d`): `RunAgentAction`, `MAX_PROMPT`, `AGENT_ACTION_KINDS`, `agent_action` and the five shape rules in `automations_model.py` (`runAgent` last in `ACTION_KINDS`, so `OBJECT_ACTION_KINDS` is unchanged); the stubs of `agentschedules.py` and `api_schedules_v1.py` (mounted on `/api` after M18's `api_learning_v1`); `schedule_manage` in `toolcatalog.AGENT_TOOLS` with the label "Schedules"; the front end's `RunAgentAction`, `AgentChatSummary.schedule`, `isAgentSchedule`, `agentScheduleInput`, `schedulesOf`, `RULE_TEXT.runsAgent`/`runsMissingAgent` and the mock `agentSchedule`.
- **Validation and the index** (T2, `d93c50b`): `_check_against_space` refuses an unlisted agent (`agents.NOT_LISTED`) and a remote one; `agentschedules.py` holds `ScheduleIndex` (`<state>/agent-schedules.json`, atomic, written only on change, an unreadable file copied aside), `skills_in_use` (used skills plus whole-name prompt mentions; `IndexUnreadable` when the index can't be read), `schedule_v1`, `default_start`, `rule_payload`; `agentskills.SCHEDULE_SKILLS = skills_in_use` at import.
- **Running schedules** (T3, `40e8cec`): `schedulerun.py` (`AgentJobs`, one worker per open space, one job at a time; `run_schedule` through M20's `headless.run_chat` with `purpose="schedule"`; the AI Chat object through the new `aichat.create_chat_object`; the notification while "Activate notifications" is on; the `schedule-guidance` contributor at order 55 from `install()`). The engine hands `runAgent` occurrences to the jobs, `execute_agent_job` logs them, `AutomationScheduler.owe` and `answer_counted` give the catch-up its `queued` count, and closing the space kills a running run and owes it and the queued ones. `create_app(..., base_url=)`, `__main__` passing the loopback URL, the transcript header's `schedule`, and the two test hooks.
- **`schedule_manage`** (T4, `d9f3cd6`): the four `/api/v1/agent/schedules` routes, `agent_tools_schedules.py`, `agent_mcp.TOOL_MODULES`, and `POST /api/v1/automations` refusing `runAgent` rules.
- **Front end** (T5, `d33e9d6`; T6, `814b0cd`): the agent page's Schedules tab (order 80) and `ScheduleDialog`; agent schedule rows in Settings > Automations whose Edit opens the dialog; the "Scheduled" mark on the Chats tab; the `schedule_manage` tool step lines.

## Integration (Task 7)

- The lanes' back end and front end were already connected end to end: T1 mounted the router, T3 called `schedulerun.install()` and passed `base_url` from `__main__`, T4 filled the router and registered the tool module, and the front end uses only M14's and M17's existing client methods against unchanged routes. Nothing needed wiring. `scripts/m21_acceptance.py` serves a fixture copy headless with `create_app(..., base_url=...)` and drives the new action through M14's routes, the two test hooks, the catch-up's `queued` answer, the `schedule_manage` tool through real chat turns (`FAKE:mcp` markers reaching the real `object-agent` server) and the `create_automation` refusal through M11's tools server.
- `backend/tests/test_m10_ai.py`: `test_ai_modules_use_no_network_client` now covers `agentschedules.py`, `schedulerun.py` and `api_schedules_v1.py` (on an `# M21` line).
- `fake_claude.py` needed no new marker.
- No lane reported a task partial or blocked.

## Deviations from the plan

From the build lanes' reports, plus T7's own:

- **T1:** `ScheduleFields` was already exported from `RuleEditor.tsx` (since M14's `5d87eeb`), so T1 didn't touch that file. `ChatsTab.test.tsx` gained `schedule: null` in one fixture so the type check passes. The optional live spike to confirm the `Skill` tool's input key (`skill`) was not run; the code reads `skill`, then `name`, then `command`, as the plan says. Between T1 and T4 one M17 test failed as planned (the stub registered no tool); it passes now.
- **T2:** none beyond the plan.
- **T3:** `test_m17_transcripts.py::test_list_newest_first` gained `"schedule": None` in its expected summary (the Contract adds the key to every summary). `test_m21_runner.py` has one extra test, that `schedulerun.install()` can run twice.
- **T4:** two extra tests (list order; unknown keys and the description kept on update).
- **T5:** `AgentPage.test.tsx` and `agentTabs.test.ts` (outside T5's file list) were updated for the eighth tab, "Schedules". The dialog has a few strings beyond the plan's: "Schedules" (the list's label), "Schedule menu" (the row menu's label), "CLI default", "Saving…" and "A schedule needs a prompt." (shown before saving an empty prompt; the same text as the server's 422).
- **T6:** none beyond the plan. One unrelated `NewSkillDialog.test.tsx` timeout during T6's run passed on its own.
- **Lint:** `ruff` isn't installed in the uv environment, so no Python lint ran in any lane.
- **T7:**
  - The script moves the clock to each due time in steps of at most 5 minutes with a tick each (`walk_to`), as a running app would see it; one jump from 08:50 to 09:00:30 is more than M14's 10-minute sleep gap and would owe the occurrence instead of running it.
  - The three skills are written as synthetic `SKILL.md` folders with `created_by: agent`, so the curator would archive them if they weren't protected. Check 5 adds a third, unprotected skill, `old-notes`, which is archived. The curator's deterministic pass is called in-process twice (now, which stamps `createdAt` on skills it first sees, then 40 days on) instead of moving the app's clock 40 days, which would have owed the schedules' occurrences and changed checks 6 and 7.
  - The second schedule of check 5 ("Notes digest", every day at 10:00) and the waiting one of check 6 ("Long job", every day at 11:00) are turned off after their checks, so the three-week jump of check 7 owes only "Weekly review". Check 5 also checks that a turned-off schedule still protects its skills.
  - Check 4 runs `schedule_manage` through three real chat turns (Researcher's, the default agent's, Researcher's again) and sends the `runAgent` rule to `POST /api/v1/automations` through the Object tools server's `create_automation` in a turn; the default agent's `update` of Researcher's schedule answers 404 as well as its `list` being empty.
  - A few checks beyond the plan's list: the fake's pid is gone after the stop (check 6), the catch-up answer took under 2 s (check 7), and the AI Chat type file is the only `.object/types/` change (check 9).
  - The milestone's own tests, `tsc` and the acceptance script were run here. The full gate (every suite, every `mN_acceptance.py`, `npm run build`) is left to this track's gate, as the build workflow says.

## Review

The one milestone review comes after integration. Where each Review Focus item is covered:

1. **A run interrupted or queued when the space closes:** `test_m21_runner.py::test_stop_reowes_queued_and_running`, `::test_off_or_deleted_rule_is_skipped`, `::test_jobs_never_block_tick_or_answer`, `::test_sleep_gap_owes`, `::test_duplicate_submit_is_ignored`; acceptance check 6.
2. **No learning review after a schedule run:** `test_m21_runner.py::test_schedule_run_skips_reviews`; acceptance check 3.
3. **The curator's protection across spaces:** `test_m21_index.py::test_skills_in_use_across_spaces`, `::test_prompt_mentions_are_whole_names`, `::test_deleted_rule_unprotects`, `::test_other_agents_not_counted`, `::test_unreadable_index`; acceptance checks 5 and 8.
4. **An agent schedules only itself, only in the open space:** `test_m21_schedule_tool.py::test_other_agents_schedules_are_404`, `::test_create_automation_refuses_run_agent`, `::test_read_token_cannot_write`, `::test_review_token_is_403`, `::test_stored_token_is_403`; `test_m21_model.py::test_remote_agent_refused`; acceptance check 4.
5. **No write on read, old versions safe:** `test_m21_runner.py::test_open_writes_nothing`; `test_m21_model.py::test_unknown_action_kind_stays_read_only`, `::test_unknown_keys_kept`; `test_m21_index.py::test_sync_writes_only_on_change`; acceptance check 9.

## Automated results (Task 7, 2026-11-06)

| Suite | Command | Result |
|---|---|---|
| M21 back end | `uv run pytest backend/tests/test_m21_contract.py test_m21_model.py test_m21_index.py test_m21_runner.py test_m21_schedule_tool.py test_m10_ai.py -q` | 146 passed |
| M21 front end | `npx vitest run src/agents src/automations src/settings/sections/Automations src/ai/toolSteps` | 32 files, 189 tests passed |
| Types | `npx tsc -b --noEmit` | clean |
| M21 acceptance | `uv run python scripts/m21_acceptance.py backend/tests/fixtures/<space>` | PASS on `space-sample` and `space-v1` (all 9 checks, 36 `[ok]` lines each) |
| Full gate | every suite, every `mN_acceptance.py`, `npm run build` | left to this track's gate |

Not verified here: the app's own window (pywebview), the Schedules tab, the dialog and the Settings rows in a real browser (jsdom only), a real OS notification, and a real schedule run with the real CLI.

## Hand checks for Gene

On a copy of his export.

- [ ] Researcher's agent page has a Schedules tab, last. It names the open space and says runs are saved as AI Chats.
- [ ] "New schedule": a name, a prompt, "Every day" at a time two minutes from now, and the default model. Within about a minute of that time an AI Chat appears in the space (named after the schedule and the date) with Researcher's answer, and a notification shows.
- [ ] Researcher's Chats tab lists that chat with the "Scheduled" mark. Opening it shows the prompt and the reply.
- [ ] Settings > Automations lists the schedule as "Runs “Researcher” · Every day at …". Edit opens the schedule dialog, and Run log shows the run with a link to the chat.
- [ ] Asking Researcher in a chat to "schedule a weekly summary every Friday at 16:00" makes a schedule that shows in the tab. Asking it to delete it moves it to the Trash, and Restore brings it back.
- [ ] After a schedule run, no "Learning…" line appears and no memory or skill change is logged from it.
- [ ] Close Object over a schedule's time and open it later: the "Missed automations" dialog offers the missed run. "Skip" runs nothing.
- [ ] Switch to another space: Researcher's schedules from the first space don't run there, and its Schedules tab shows only that space's schedules.
- [ ] Turning a schedule off stops it running. Turning "Activate notifications" off still saves the AI Chat but shows no notification.
- [ ] A skill that a schedule's prompt names stays active after "Tidy up now" or the curator's run.
- [ ] Unlinked mentions still show on the object page.
