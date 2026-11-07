# Milestone 20 acceptance: A2A (outbound) and delegation

Status (2026-11-07): built, merged to `master` and gated 2026-11-06. Gene's 12 hand-checks below are unticked.

Plan: `2026-11-05-m20-a2a-and-delegation.md`. Design: `specs/2026-11-05-agents-design.md`, sections 7 (A2A outbound) and 8 (Agents working together), with their mentions in sections 1, 2 and 4 and the Constraints line on A2A tokens. Date: 2026-11-06. Built on Gene's Windows 11 PC on branch `feat/m16-m24` (shared with M16-M24), commits `d2554b3..2b26f0b` plus this integration commit. Gene asked for M16-M24 to be built straight through, and on 2026-11-06 for two parallel tracks with one full gate per track; his hand checks below come later.

## What was built

- **Contract and fakes** (T1, `d2554b3`): `remotemodel.py` (the remote `agent.json` schema, the M20 constants, `clean_auth`, `card_url_for`); the stubs the lanes filled; the two routers mounted in `server.py` and `delegation.install()` called after `mcpgateway.install()`; the three tool names and labels in `toolcatalog.py`; `agent_tools_a2a` in `agent_mcp.TOOL_MODULES`; `httpx` moved to the runtime dependencies. `backend/tests/fake_a2a.py` is a synthetic A2A 1.0 agent on `127.0.0.1`; `fake_claude.py` gained `FAKE:long:<n>` and `FAKE:echo-env`. The front end's types, client methods and mocks. The live spike (`m20-spike.md`) showed that Claude Code 2.1.317 honours `MCP_TOOL_TIMEOUT`.
- **A2A client** (T2, `5d5763c`, `a2a.py`, the one M20 network module): card fetch and parse, `SendMessage` with `GetTask` polling, `SendStreamingMessage` with a hand-written SSE reader, `CancelTask`; no redirects; size caps on the card, one answer, one stream and one file; every read inside the caller's deadline, then a best-effort `CancelTask` and a 504; error messages give only `host:port`.
- **Registry, secrets, transcripts** (T3, `eca5919`): remote entries in `agents.json` and their folders under `<state>/agents/`; `remotesecrets.py` over M19's `secrets.json` (key `a2a:<agentId>`); `create_remote`, `save_remote`, `refresh_remote`, `mark_context_notice`, `remote_folders`, `find_by_name`; delegated transcript headers (`from`, `fromChat`), `last_a2a`, `find_by_context`.
- **Remote chat** (T4, `83e0589`, `remotechat.py` plus one hook in `api_ai.py`): chat-only, the 428 context-notice guard, context through `ai.gather_context`, the context id and the input-required task id from the transcript, reply composition, attachments saved under `files/<chatId>/` with safe names, Stop sending `CancelTask`, `call_remote` for the agent tools.
- **Routes** (T5, `c23aec6`, `api_remote_agents.py`): preview, add, save, refresh, context notice and the file reveal; M18's learning routes and the curator refuse or skip remote agents; a remote agent's Tools tab has no groups.
- **Delegation and the agent tools** (T6, `d4a0245`): `headless.run_chat`, `delegation.delegate` with the limiter and the flat rule, the `delegation` (64) and `fence-remote` (75) contributors, the `/api/v1/agent/*` routes and the three MCP tools.
- **Front end** (T7, `8922db5`; T8, `2b26f0b`): "Add remote agent…" with its dialog, the "remote" mark, the remote Profile and Card tabs, "Delegated by …" on the Chats tab; the chat panel's remote header without a model picker, the "This leaves your computer" notice, attachment chips and the A2A tool lines.

## Integration (Task 9)

- The lanes' back end and front end were connected end to end already: the routers were mounted and `delegation.install()` called by T1, and the client's routes match the server's. `scripts/m20_acceptance.py` serves a fixture copy headless, starts two fake A2A agents and drives every new route, the chat route for remote agents and the three `/api/v1/agent/*` routes.
- `backend/tests/test_m10_ai.py`: `test_ai_modules_use_no_network_client` now covers `remotemodel.py`, `remotesecrets.py`, `remotechat.py`, `delegation.py`, `headless.py`, `api_remote_agents.py` and `api_agent_a2a_v1.py` (on an `# M20:` line). `a2a.py` is left out because it is the network module.
- `test_m17_agent_mcp.py::test_tool_modules_extend`, which T1 reported failing until T6 registered the three tools, passes.
- `fake_a2a.py` and `fake_claude.py` needed no new marker.

## Deviations from the plan

From the build lanes' reports, plus T9's own:

- **T1:** `FakeA2A.__init__` also takes `port` (default 0, a free port), so `python backend/tests/fake_a2a.py --port 8799` can serve on a fixed one. `test_m17_agent_mcp.py::test_tool_modules_extend` failed between T1 and T6, as planned (the stub registered nothing); it passes now.
- **T2:** `fake_a2a.py` gained the `A2A:message` marker (the plan allowed it): a `{"message": …}` result reading "Just a message: <first text part>". The client reads the size caps from `remotemodel` at call time, so tests can lower them.
- **T3:** two extra tests (create checks and an unreadable card). An unreadable `card.json` falls back to a card with the agent's name only.
- **T4, T5, T6:** extra edge-case tests beyond the plan's lists; no Contract changes. T6's tests patch `remotechat.call_remote` with a recording double.
- **T8:** the tests were written before the code but not run once to watch them fail, because taking the changes out in a working tree shared with other agents wasn't safe. The panel also remembers agents acknowledged in that panel, so a send right after "Send" doesn't show the notice again before the `agents` reload arrives.
- **Lint:** `ruff` isn't installed in the uv environment, so no Python lint ran in any lane.
- **T9:**
  - `m20_acceptance.py` adds a few checks beyond the plan's list: `agent.json` and `card.json` exist after the add, the visible page's marker comes back in check 7, Fake Planner still answers after the restore (check 10), and the token search runs again at the end.
  - In check 8 the delegated run's own token is taken from the fake `claude`'s log (`OBJECT_API_TOKEN`) while the three `FAKE:wait` runs are waiting.
  - The 504 answer for a 1-second `remote_agent_call` reads "… within 1 seconds …": the plan's string with `{n}` filled in, kept as written.
  - The milestone's own tests, `tsc` and the acceptance script were run here. The full gate (every suite, every `mN_acceptance.py`, `npm run build` and the live spike again with `OBJECT_LIVE_CLAUDE=1`) is left to this track's gate, as the build workflow says.

No lane reported a task partial or blocked.

## Review

The one milestone review comes after integration. Where each Review Focus item is covered:

1. **Excluded pages reaching a remote agent:** `test_m20_remote_chat.py::test_excluded_context_never_sent`, `::test_proposal_modes_refused_for_remote`, `::test_context_without_notice_is_428`; `test_m20_delegation.py::test_remote_folders_are_fenced`; acceptance check 7.
2. **A secret leaking or travelling:** `test_m20_remote_agents.py::test_secret_never_stored_or_shown`, `test_m20_a2a_client.py::test_redirects_not_followed_and_auth_not_forwarded`, `test_m20_remote_routes.py::test_url_change_drops_the_secret`; acceptance checks 2 and 11 (the token in no state file but `secrets.json`, no API answer and no app log line).
3. **A hostile or broken remote agent:** `test_m20_a2a_client.py::test_card_refusals`, `::test_hostile_answers`; `test_m20_remote_chat.py::test_attachment_names_and_caps`.
4. **Delegation limits under concurrency and failure:** `test_m20_delegation.py` (`test_fourth_delegation_at_once_is_refused`, `test_delegated_run_cannot_delegate`, `test_self_and_unknown_targets`, `test_summary_capped_at_24000`, `test_timeout_stops_the_delegated_run`, `test_caller_going_away_stops_delegations`, `test_caller_memory_untouched`); acceptance check 8.
5. **Multi-turn state of a remote chat:** `test_m20_remote_chat.py::test_context_id_kept_and_input_required_continues`, `::test_stop_cancels_the_task`, `::test_terminal_states`; `AiChatPanel.test.tsx` "test New chat with a remote agent starts a fresh context"; acceptance checks 4 and 9.

## Automated results (Task 9, 2026-11-06)

| Suite | Command | Result |
|---|---|---|
| M20 back end | `uv run pytest backend/tests/test_m20_contract.py test_m20_live_cli.py test_m20_a2a_client.py test_m20_remote_agents.py test_m20_remote_chat.py test_m20_remote_routes.py test_m20_delegation.py test_m20_agent_tools.py test_m17_agent_mcp.py test_m10_ai.py -q` | 238 passed, 1 skipped (the live spike skips without `OBJECT_LIVE_CLAUDE=1`) |
| M20 front end | `npx vitest run src/agents src/ai src/api` | 49 files, 311 tests passed |
| Types | `npx tsc -b --noEmit` | clean |
| M20 acceptance | `uv run python scripts/m20_acceptance.py backend/tests/fixtures/<space>` | PASS on `space-sample` and `space-v1` (all 11 checks, 36 `[ok]` lines each) |
| Full gate | every suite, every `mN_acceptance.py`, `npm run build`, the live spike | left to this track's gate |

Not verified here: the app's own window (pywebview), the new dialog, tabs and chat panel parts in a real browser (jsdom only), a real A2A agent, and a real delegated run with the real CLI.

## Hand checks for Gene

On a copy of his export. Run a fake remote agent first with `uv run python backend/tests/fake_a2a.py --port 8799 --token test-token`, or use a real A2A 1.0 agent you have.

- [ ] Agents section `+` > "Add remote agent…": typing `http://127.0.0.1:8799` with the bearer `test-token` and pressing "Look up" shows "Fake Planner", its skills and "Sends messages to 127.0.0.1". "Add agent" lists it with a small "remote" mark.
- [ ] Its page shows Profile, Card and Chats only. The token shows as "set" and never as text. "Replace token…" works.
- [ ] Chatting with it in the side panel streams the reply. The header has no model picker. A second message continues the same conversation (the reply's `ctx=` line is the same).
- [ ] Typing `A2A:input` gets the question "Which date?" as the reply, and answering it books.
- [ ] `A2A:file` shows a chip whose "Show in folder" opens the agent's `files` folder. `A2A:data` shows a JSON code block.
- [ ] The first message with a context chip shows "This leaves your computer". After Send, the next one doesn't. An "Exclude from AI" page added as a chip is listed as left out, and `A2A:echo-parts` shows that its text didn't arrive.
- [ ] Ask Assistant: "Delegate to Researcher: list my pages tagged rack." The chat shows "Handed a task to Researcher" and a summary. Researcher's Chats tab shows that chat with "Delegated by Assistant".
- [ ] Ask Assistant to ask Fake Planner something with `remote_agent_call`. The step shows "Asked Fake Planner".
- [ ] Researcher's Tools tab lists "Delegate to another agent", "Call a remote agent" and "List remote agents" under Object agent tools. Switching "Delegate to another agent" off stops it delegating.
- [ ] Deleting Fake Planner and restoring it from "Deleted agents…" brings it back, still working.
- [ ] `%LOCALAPPDATA%\object\agents\Fake Planner\` holds `.object-agent\agent.json`, `card.json` and `sessions\`, and no token anywhere (search the folder for `test-token`).
- [ ] Unlinked mentions still show on the object page.
