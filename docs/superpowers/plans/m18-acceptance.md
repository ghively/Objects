# Milestone 18 acceptance: learning

Status (2026-11-07): built and gated 2026-11-06 (Windows); merged to `master` 2026-11-06. Gene's 15 hand-checks below are unticked.

Plan: `2026-11-05-m18-learning.md`. Design: `specs/2026-11-05-agents-design.md`, section 5 (Learning), with the agent page tabs (section 2), the memory snapshot (section 3), the chat's Learning line (section 10) and the review model (section 11). Date: 2026-11-06. Built on Gene's Windows 11 PC on branch `feat/m16-m24` (shared with M16-M24), commits `bcc01de..e80afac` plus this integration commit. Gene asked for M16-M24 to be built straight through; his hand checks below come later.

## What was built

- **Memory** (`agentmemory.py`, `ledger.py`): the `memory` tool (add, replace, remove) on `MEMORY.md` (cap 2,200 characters) and `USER.md` (1,375), entries split by a `§` line, BOM and CRLF kept, atomic writes, every change in `.object-agent/ledger.jsonl` with its before and after text. Each chat carries a frozen snapshot of both files (a `memory` line in its transcript), appended to every turn's prompt before Object's guidance; the learning guidance (order 15) says how to use the tools.
- **Skills** (`agentskills.py`, `learnundo.py`): `skills_list`, `skill_view` (bumps `usage.json`) and `skill_manage` (create, patch, edit, write_file, remove_file, archive) with the enforced rules (read first in the same run, name 64, description 60, SKILL.md 100,000 characters, support files 1 MiB under `references/`, `templates/`, `scripts/`, no write through a link). Archive moves the folder to `.object-agent/skills-archive/`; nothing deletes a skill. Undo for every ledger entry, refused (409) when the file changed since.
- **Chat search** (`chatsearch.py`): SQLite FTS5 over the agent's own transcripts in `.object-agent/cache/sessions.db`, rebuilt when missing or stale; `session_search` searches or reads a chat.
- **Background reviews** (`reviews.py`): the two counters per chat, the three prompts, a `claude -p` run that resumes the chat's session with `--fork-session --no-session-persistence`, read-only Object tools and only the learning tools of its kinds, a read token with a 16-step budget (the 17th call answers 429). "Learn from this chat" runs one on demand.
- **Curator** (`curator.py`): the idle clock (an ASGI middleware), the deterministic pass (stale after 14 days, archived after 30; pinned, Gene's and schedule skills never touched), the optional consolidation run ("Tidy up now", 40 steps, only the three skill tools) and its report.
- **Routes**: `api_learning_v1.py` (the tools' `/api/v1/agent/...` routes) and `api_learning.py` (the agent page's and chat's routes); `agentLearning` change events.
- **Front end**: the agent page's Memory, Skills and Learning tabs, the "Memory & skills" menu item, the chat's Learning line and `…` menu with "Learn from this chat", "Search chats" on the Chats tab, and tool-step lines for the five new tools.

## Integration (Task 12)

- Every lane's code was already connected end to end; the integration found nothing left unwired. `scripts/m18_acceptance.py` serves a fixture copy headless and drives every route the plan lists through the real `object-agent` MCP server (the fake `claude`'s `FAKE:mcp` markers).
- `backend/tests/test_m10_ai.py`: `test_ai_modules_use_no_network_client` covers `learningmodel`, `ledger`, `agentmemory`, `agentskills`, `learnundo`, `chatsearch`, `reviews`, `curator`, `api_learning`, `api_learning_v1` and `learnhooks`. `test_cli_flags_config_and_cwd` now checks that Object's guidance is in `appendPrompt` rather than at its start, since the learning guidance (order 15) comes first by the plan's order.
- `backend/tests/test_m17_chat.py::test_transcript_written` expects the chat's `memory` snapshot line (`chat, user, memory, tool, assistant`). This file is not in the plan's Files lists; T2 and T7 reported the failure and left it to T12.

## Deviations from the plan

Reported by the build lanes (each in its commit), plus T12's:

- **T1:** `test_routers_mounted_and_events` adds a probe route on top of the then-empty `api_learning` router to prove the mount order; `test_activity_middleware` drives the middleware with ASGI scopes for `GET /api/events` (a TestClient stream never ends). Three M17 test files were updated where they pinned M17's state (`test_m17_agent_mcp.py::test_default_tool_modules`, `test_m17_agentrun.py::test_contributor_order` saving and restoring the whole registry, `test_audit2_api.py::test_event_hub_bounds_a_slow_subscriber` expecting 9 resync events). `mockApi.ts` has a private `memoryFile()` helper; `createAgentSkill`'s request is typed inline. The live CLI check (CLI 2.1.317) found nothing that differs from the plan (`m18-cli-notes.md`).
- **T2:** `ledger.append` stores an extra `undoneLine` key on undo entries so `ledger.line` can say "Undid: …". `snapshot_for` writes nothing while the chat has no transcript yet (`api_ai` builds the run once as a check before the header exists); the first real run writes the `memory` line. `MemoryError` carries `current_revision` for the 409. Our strings: "The memory tool's actions are add, replace and remove.", "The target is memory or user.", "This file changed since you opened it."; a missing `old_text` reuses "Give the entry's text.". Code was written before its tests.
- **T3:** `view` also returns `binary` (and `text: null` for a file that isn't UTF-8); `revision` is the viewed file's sha256. `list_skills(archived=True)` returns active, stale and archived together; an archived skill is named by its archive folder (`rack-labels (2)`). `archive`, `restore`, `set_pinned` and `set_state` return `{ok, entryId, skill}`; pin and state changes that change nothing write no ledger line. Ledger entries carry extra keys (`archivedAs`, `effect`, `afterEncoding`). `usage.json` keys an archived skill by its archive folder name. Undoing the first memory `add` leaves an empty `MEMORY.md` (no M18 code deletes a memory file); undoing a support-file `write_file` that created the file removes it (its text stays in the ledger). The curator guard applies to `manage` and `archive`, not to `set_state`. Our strings for the new error cases (no archived skill, no such file, not text, stale save, no content, link out of the folder, unreadable `usage.json`). `RunMemo` counts a use once per run per skill.
- **T4:** a search writes nothing while the agent has no sessions folder and no index (it answers `[]`), so a search never creates the default agent's folder. When the newest message alone is over the 40,000-character cap, `read_chat` keeps its last 40,000 characters.
- **T5:** the learning v1 routes don't require a read-write token: review and curator tokens are `read` but must call `memory` and `skill_manage` (these routes write only the agent's own folder). `session_search` clamps `limit` to 1-25; a missing or invalid chat id answers 404 "That chat isn't there.". `test_m17_agent_mcp.py::test_tool_modules_extend` expects `{"ping", *toolcatalog.AGENT_TOOLS}`.
- **T6:** saving Learning settings also sends `ChangeEvent("agents", …)` (`agent.json`'s revision changes). The Learning PUT merges the cleaned body onto the stored `learning` dict. Every write route answers 423 for an agent whose `agent.json` can't be read. Our 404 "That change isn't there."; the ledger limit is capped at 500 and search at 25. The skill create answer drops `entryId` (SkillDetail's shape). `PUT …/memory/{target}` reads the newest ledger entry for its event's entry id (two writes at the same instant could name the wrong one).
- **T7:** `test_native_skill_tool_bumps_usage` checks the use count and the read mark through a real turn, then the patch-after-`Skill` through `reviews.watch` and `agentskills.manage` (the fake runs `FAKE:mcp` before `FAKE:skilltool`). `test_concurrency_cap` counts overlapping runs by wrapping `ai.run_turn`. The review contributor reads a review's kinds from its token's `tools`. A start line with no end that isn't running here reads as failed ("The review was stopped."), and a review cancelled at shutdown writes that end line. `learn_now` from a worker thread runs the review in its own thread.
- **T8:** `deterministic_pass` takes an optional keyword `agent_id`. `curator.py` uses `agentskills`' private `usage.json` helpers under its lock (no public writer exists for the curator keys). Added `Curator.wait_tidy`, `CURATOR_TOOLS` and `REPORT_MAX = 4000`; `CuratorBusy`'s default message is the route's 409 text.
- **T9:** `LedgerList` accepts `target: "memory,user"` and merges one page per target (the route filters by one target). Its 409 shows `LEARNING_TEXT.undoConflict` (the client's `ConflictError` drops the server's text). The Learning tab sends the whole settings object with the changed key; number fields save on blur or Enter. `learningText.ts` also holds T10's and T11's strings. A learning save reloads the agent for the Profile tab.
- **T10:** the three 409 texts are copied into the components (the client drops 409 details). "Close", "Files" and "Cancel" are local strings. `SkillDetail` looks up the agent's `readOnlyReason` to disable editing. The description field counts past 60 and leaves the 422 to the server.
- **T11:** `ChatMenu` takes an optional `onNotice`. A done Learning line opens the Memory tab when the review's kinds are only memory or its summary mentions only memories. A done line with no entry ids is plain text. A Learning line sits after the last reply at or before the review's `startedAt` plus 1 second. Two lines in `AgentPage.test.tsx` / the M17 `ChatsTab` test follow the field's new name "Search chats".
- **T12:** `test_m17_chat.py` (no task's Files list) and `test_m10_ai.py::test_cli_flags_config_and_cwd` updated as above. `scripts/m17_acceptance.py` (not in T12's Files list) check 4 now expects the transcript `chat, user, memory, assistant`. In `m18_acceptance.py`:
  - check 3's `write_file` to `../x.md` is refused with 422 "Support files go in references/, templates/ or scripts/." (the path check fires before the escape check);
  - check 6 holds the first review with `FAKE_CLAUDE_REVIEW_SLEEP=3` so the second call meets it running;
  - check 7's tick also archives `rack-labels` (agent-made, last used 31 days before the moved clock), which the check accepts as long as every archive is a curator ledger entry;
  - check 9's turn searches for "labels" (a word of the chat's turns);
  - check 10 reads the review's tool results by wrapping `ai.run_turn` in the script's own process, as `test_m18_reviews.py` does;
  - check 11 expects a clean `git status`: no M18 turn or route writes in the space, and the script saves no chat.

## Review

One whole-milestone review after integration, Review Focus first:

1. **A review that reaches past its scope:** `test_m18_reviews.py` (tool lists by kind, the token refusing tools outside its set, the 17th step, the fork leaving the chat's session and transcript alone, the next turn running during a review, only chat turns triggering reviews); acceptance checks 4 and 10.
2. **Undo that loses or overwrites something:** `test_m18_skills.py` (refused when changed since, undo of undo and of create, archive name taken), `test_m18_memory.py` (concurrent adds, a torn ledger line); acceptance checks 5 and 7.
3. **Skill paths and names that escape or collide:** `test_m18_skills.py` (bad paths and names, no write through a link, which ran with a real junction on this PC, archive and restore collisions); acceptance check 3.
4. **The curator touching what it must not:** `test_m18_curator.py` (never touched, native skill use counts, the idle clock ignoring the events stream and test routes, busy while a turn runs); acceptance check 7.
5. **The frozen snapshot and the caps:** `test_m18_memory.py` (caps in characters, an over-cap file can shrink, a `§` line refused), `test_m18_reviews.py::test_snapshot_frozen_per_chat`; acceptance checks 1 and 2.

File safety: no M18 route or turn writes in the space (acceptance check 11); agent files are written atomically with BOM and line endings kept, no `*.tmp` left; searches write only `.object-agent/cache/`; the server binds 127.0.0.1; tests use a temp `OBJECT_STATE_DIR`.

## Automated results

| Suite | Command | Result |
|---|---|---|
| Back end | `uv run pytest backend/tests -q` | 2359 passed, 19 skipped, 3 xpassed (the live tests skip without `OBJECT_LIVE_CLAUDE=1`); 1 warning: a test's background uvicorn thread exited at startup, as in M16 and M17 |
| Front end | `cd frontend && npx vitest run` | 434 files passed, 1 skipped; 3284 tests passed, 1 skipped |
| Types, lint, build | `npx tsc -b --noEmit`, `npm run lint`, `npm run build` | `tsc` clean; lint 0 errors (563 warnings, of kinds the code base already has); build ok |
| M18 acceptance | `uv run python scripts/m18_acceptance.py backend/tests/fixtures/<space>` | PASS on `space-sample` and `space-v1` (all 11 checks) |
| Earlier acceptance | `scripts/m1_roundtrip.py`, `m2`-`m17_acceptance.py` on `space-sample` and `space-v1`, plus `m4` on `space-calendar`, `m5` on `space-links`, `m6` on `space-whiteboard`, `m7` on `space-blocks`, `m14` on `space-m8` | all PASS (34 + 5 runs; `m15` prints "All checks passed"). The first run of `m17_acceptance.py` failed its check 4 on both spaces: it expected the transcript `chat, user, assistant`, and M18 adds the `memory` snapshot line; the expectation was updated and both re-ran PASS |
| Live checks | `OBJECT_LIVE_CLAUDE=1 uv run pytest backend/tests/test_m17_live_cli.py backend/tests/test_m18_live_cli.py -q` (CLI 2.1.317, haiku, `--no-session-persistence`) | 8 passed |

Not verified here: the app's own window (pywebview) and the new tabs and Learning line in a real browser (jsdom only); a real review or curator run with the real CLI (only the M18 live check, which stops at the CLI's unknown-session answer, and M17's live spike ran).

## Hand checks for Gene

On a copy of his export:

- [ ] Tell Assistant something about yourself and ask it to remember it. The step "Saved a memory about you" shows; the Memory tab's "About you" shows it with its size against 1,375.
- [ ] Start a new chat: it knows the fact. In the old chat it says it was saved for next time.
- [ ] After about ten messages a small "Learning…" line shows under a reply, then a summary like "Saved 1 memory, updated 1 skill". You can type the next message while it runs. Clicking the summary opens the change.
- [ ] Your chat goes on normally after a review: the next reply follows on from your last message and shows nothing of the review.
- [ ] "Learn from this chat" in the chat's `…` menu runs a review on demand.
- [ ] Ask the agent to make a skill for a task you repeat. The Skills tab lists it as Active, made by Agent, with its use count and last use. Open it, edit SKILL.md, and see your edit in its History.
- [ ] Undo a change in a skill's History: the skill goes back. Undo the undo: it comes back.
- [ ] Archive a skill, turn on "Show archived", Restore it. Pin a skill.
- [ ] "Tidy up now" merges two overlapping skills you made the agent write, archives the absorbed one ("Absorbed into …") and shows a short report.
- [ ] The Learning tab's numbers save; setting "Review memory every" to 0 stops memory reviews.
- [ ] The Chats tab's search finds a chat by a word from its middle, with the word in bold in a snippet.
- [ ] Ask the agent what it remembers about an earlier chat: it uses "Searched past chats".
- [ ] Ask the agent to read an "Exclude from AI" page and to remember what it says: it can't read it, so nothing about it is saved.
- [ ] "Memory & skills" in an agent's `…` menu opens its Memory tab.
- [ ] Unlinked mentions still show on the object page.
