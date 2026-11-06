# Milestone 17 acceptance: agents, agent folders and full tooling

Plan: `2026-11-05-m17-agents-and-tools.md`. Design: `specs/2026-11-05-agents-design.md`, sections 1-4 and section 10's agent picker. Date: 2026-11-06. Built on Gene's Windows 11 PC on branch `feat/m16-m24` (shared with M16-M24), commits `a4f42e9..f67a82b` plus this integration commit. Gene asked for M16-M24 to be built straight through; his hand checks below come later.

## What was built

- **Agents are folders.** `agentmodel.py` (the `agent.json` schema), `agentfiles.py` (the skeleton, `agent.json`, `.claude/settings.json` generated denies, folder `.mcp.json`), `agents.py` (`<state>/agents.json`, the implicit default agent "Assistant", create, duplicate, add folder, save, unregister, delete to `<state>/agents/.trash/`, restore). The default agent is listed with `exists: false` until its first turn or edit makes its folder.
- **Transcripts** (`transcripts.py`): one append-only JSONL file per chat in `.object-agent/sessions/`.
- **The turn runner** (`agentrun.py`): one `claude -p` command per attempt, built from ordered contributors (folder MCP 20, Object MCP 30, agent MCP 40, guidance 50, tools 60, fence 70). It runs in the agent folder's long path with `--setting-sources project,local`, `dontAsk`, no prompts, `--strict-mcp-config`, `--tools default`; run settings carry `autoMemoryEnabled: false`, `claudeMdExcludes` (Gene's decision, 2026-11-06) and the fence's deny rules; the environment drops `RUN_ENV_DROP`.
- **Tools** (`toolcatalog.py`, `api_v1_tools.py`, `mcp_server.py`): `objectapp-mcp` now has 20 read and 35 write tools, each through a `/api/v1` route that runs the app's own route (version checks, the Trash, history, announcements, the activity log) and hides excluded pages and templates. The `object-agent` server (`agent_mcp.py`) has `agent_info`.
- **Routes** (`api_agents.py`): every row of the Contract's routes table. `/api/ai/chat` takes `agentId`/`chatId`, starts every stream with a `chat` event, acts directly in `chat` mode (write tools, read-write token) and runs the five proposal modes read-only.
- **Front end** (`frontend/src/agents/`, `ai/AgentPicker.tsx`): the Agents section above the main navigation, New agent / Add agent folder / Deleted agents, the agent page (Profile, Instructions, Tools, Chats), the tool switches with the shell warning, and the chat header's agent picker.

## Integration (Task 11)

- `scripts/m10_acceptance.py` check 2 now expects M17's facts: the `chat` event first, the default agent's folder as the working folder, `--setting-sources project,local`, the space fenced (`Read`/`Edit` on `<space>/**`), Object's write tools in a chat turn and only its read tools (`--read-only`) in a tag turn, the shell denied. Its other checks are unchanged.
- `backend/tests/test_m10_ai.py::test_ai_modules_use_no_network_client` covers `agentmodel`, `toolcatalog`, `agents`, `agentfiles`, `transcripts`, `agentrun` and `api_agents`.
- `scripts/m17_acceptance.py` (new): the plan's nine checks.
- `backend/tests/test_m17_live_cli.py::test_object_tool_is_callable` (new, live only): the spike's last open question, below.
- Fixes found by the gate: `frontend/src/icons/appIcons.ts` regenerated (`node scripts/app-icons.mjs`), since T8's Agents section uses `ph-chat-circle`; `frontend/src/ai/AiChatPanel.test.tsx` resets `useAiFocus` before each test (an earlier test's Ctrl+Alt+J focus request focused the input on a later mount and closed the model popover, so "the model default label is the agent's model" failed when the whole file ran).

## The ToolSearch question (spike)

One live turn built by `agentrun.build_run` (haiku, `--no-session-persistence`) with the real `objectapp-mcp` against a temp copy of `space-sample`, asked to search for "Ada": `init.tools` listed all 20 Object read tools, `agent_info` and `ToolSearch`; the model called `ToolSearch`, then `mcp__object__search`, which returned 5 results. Nothing was refused under `dontAsk`, so `ToolSearch` did **not** join `toolcatalog.ALWAYS_ALLOWED` (it stays `("Skill",)`). Recorded in `m17-cli-spike.md`.

Seen in the same run, for Gene: under his login the CLI's `init.tools` also lists built-ins outside the Tools tab (`CronCreate`, `SendMessage`, `Workflow`, `RemoteTrigger`, `PushNotification`, `PublishPlugin`, `ShareOnboardingGuide`, `DesignSync` and others). With `--tools default` they are offered and aren't switches; under `dontAsk` one that needs a permission and isn't in `--allowedTools` is refused. Whether any should be denied by default is left to Gene.

## Deviations from the plan

Reported by the build lanes (each in its commit), plus T11's:

- **T1 follow-up:** the decision was also written into the M17 plan and the agents design (docs only). The `claudeMdExcludes` pinning test runs without the live flag, so the module skip became a per-test `@live` marker. The live setup also plants `<state>/.claude/CLAUDE.md` and `<state>/agents/CLAUDE.local.md`. The exclude list follows the Contract (it includes `<home>/.claude/rules/**`); a `.claude/rules` folder inside an ancestor is not excluded.
- **T2:** the generated `PROTECTED` rules in `.claude/settings.json` are folder-relative (`Edit(./CLAUDE.md)` ...), the run's absolute ones come from `fence_rules`. A `toolsOff` id `mcp__<server>` not in the catalogue is written as its own deny entry. A new agent never takes the default agent's folder name (`Assistant` gets `Assistant (2)`), and `.trash` is skipped as a name. `to_api` reads `agentrun.SECRET_LOOKUP` lazily for `mcpServers`. Saving the default agent before its folder exists makes the folder first. Folders move with `os.replace`, falling back to `shutil.move` across volumes.
- **T3:** `start()` takes the title (the caller computes it with `aichat.default_title`). The header's `space` is null when neither name nor key is given. One extra test.
- **T4:** one public constant beyond the Contract, `agentrun.NESTED_MESSAGE`. `Turn.run` was optional until T7. `rule_path` doesn't resolve its argument (callers do). `PROPOSAL_GUIDANCE` is chosen by `purpose == "proposal"`. The tools contributor passes only the folder servers that `folder-mcp` included. Tests were written with the code, not seen failing first.
- **T5:** each `/api/v1` route runs the app's own route function, found by method and path (this walks FastAPI 0.162's `original_router`/`include_context.prefix`, which a FastAPI upgrade could break). A confirmed `delete_collection` changes an excluded member's collections line or trashes it (whether an agent may do that is for Gene). Property and body writes also update `lastUpdated` and may add an `id:` line. `edit_type`'s 428 passes the app's own `affected` count without `hiddenCount`. `V1Guard` takes an optional activity log; `import_preview` accepts an optional `target`; `type_definition`, `collection` and `saved_query` also accept a name.
- **T6:** `/v1/agent/info` answers `model: null` when the device settings can't be read. Five extra tests.
- **T7:** helper changes in `test_m17_agentrun.py` (a bare `run`) and `test_m16_tool_events.py` (drops the leading `chat` event); `test_m10_ai.py`'s `_chat` helper drops it too. `Turn.run` is required through `field(kw_only=True)`. Delete and restore announce the agent's id, not `"trash"`. A repeated save of the same chat appends an `object` line only when the path changes. Proposal turns write transcripts. The default agent's folder creation on its first turn announces no `agents` event.
- **T8:** one-line changes in `shell/Sidebar.m9.test.tsx` and `shell/SidebarSections.test.tsx` (they skip the new "Agents" heading). In "Duplicate of…" the Instructions field is replaced by "The instructions are copied from <name>." (`duplicate` copies `CLAUDE.md`). Our strings: the `+` button's "Add an agent", "<name> actions", "All of <group>", "Turn on the shell?", "Add folder", the trash dialog's texts; Delete is disabled (not removed) for the default agent; the left-in-place notice is an inline status line for 6 s. Tests written right after the components.
- **T9:** the page's strings live in its tab files (`agentText.ts` is T8's). The App test is a new file, `App.m17.test.tsx`. `ProfileTab.tsx` exports `inputOf`, `putAgent`, `reloadAgent` for `ToolsTab`. Our 409 text: "This agent was changed elsewhere. Its latest settings are shown: apply your change again." `InstructionsTab.test` uses a textarea in place of the editor. Four extra tests.
- **T10:** the picker's strings are in `AgentPicker.tsx` ("Agent for this chat", "Assistant" before the list loads, "Agent" for an unlisted id). A transcript's error lines show nothing; a tool line with no result is a stopped step; an opened transcript's context is its last user line's `contextPaths`. `AgentsSection` opens `{kind: 'aiChat', agentId}` in the side panel itself rather than through `openAiChat` (both reach the panel).
- **T11:** `m10_acceptance.py`'s check 2 lines were rewritten beyond the three facts the plan names, because M17 also changed what M10 checked there (the first event, the allowed tools of a chat turn, the shell rather than Read/Write/Edit being denied). `m17_acceptance.py` marks the excluded page with `excludeFromAI: true` through `PUT /api/object/properties` (the plan says "tags"; the frontmatter key is one of the two ways `apiquery.is_excluded` accepts) after writing a marker text into its body; on both fixtures that page is the daily note `DailyNotes/2026-10-23.md`. Check 6 holds the tag turn with `FAKE:wait` to ask `/v1/whoami` for its token's scope. Check 8's outside folder is a copy of Researcher with a new id, added with Add agent folder. Check 9 does not list the history entries: they live in the state dir (`<state>/history/`), not the space. The two front-end test fixes above are in files other lanes owned.

## Review

One whole-milestone review after integration, Review Focus first:

1. **User setup leaking into a run:** the arguments never name `user` and no run has `CLAUDE_CONFIG_DIR` (`test_run_loads_only_project_and_local_settings`, acceptance check 2); live, only the agent's own `CLAUDE.md` loaded and no user hook, plugin, skill, MCP server, deny rule or auto-memory reached the run (`test_user_setup_never_reaches_a_run`, re-run passed).
2. **The fence on awkward paths:** `test_fence_rules_cover_awkward_paths` (a junction ran on this PC), nesting refused at create, add and run; acceptance check 3 denies Read, Grep, Glob and Write on the space and lets a file outside every fence be read; live `test_fence_is_enforced` passed.
3. **Indirect leaks through the new tools:** `test_no_tool_reveals_an_excluded_page` (eight grouped cases) and acceptance check 5 (13 routes given the excluded page answer 404; search, trash, backlinks and mentions don't hold its marker).
4. **Agent folder lifecycle:** delete to the agent trash and restore with chats; an outside folder only unregistered, bytes identical; the default agent can't be deleted (acceptance check 8, `test_m17_agents.py`).
5. **M10 entry points and saved chats:** proposal modes run read-only with a `read` token (acceptance check 6, `test_proposal_modes_run_read_only`); Ctrl+Alt+J opens the default agent; an M10 AI Chat continues with Assistant; `ensure_chat_type` adds "Agent" without rewriting chats; `m10_acceptance.py` passes.

File safety: turns write nothing in the space (acceptance check 9 and M10's check 3); agent files are written atomically with BOM and line endings kept; the server binds 127.0.0.1; tests use a temp `OBJECT_STATE_DIR`. The review found the two front-end gate failures fixed above and nothing else.

## Automated results

| Suite | Command | Result |
|---|---|---|
| Back end | `uv run pytest backend/tests -q` | 2218 passed, 18 skipped, 3 xpassed (the 5 live spike tests skip without `OBJECT_LIVE_CLAUDE=1`); 1 warning: a test's background uvicorn thread exited at startup, as in M16 |
| Front end | `cd frontend && npx vitest run` | 423 files passed, 1 skipped; 3234 tests passed, 1 skipped (the first run failed `appIcons.test.ts` twice and `AiChatPanel.test.tsx` once; fixed as above) |
| Types, lint, build | `npx tsc -b --noEmit`, `npm run lint`, `npm run build` | `tsc` clean; lint 0 errors (warnings only, of kinds the code base already has); build ok |
| M17 acceptance | `uv run python scripts/m17_acceptance.py backend/tests/fixtures/<space>` | PASS on `space-sample` and `space-v1` (all 9 checks) |
| Earlier acceptance | `scripts/m1_roundtrip.py`, `m2`-`m16_acceptance.py` on `space-sample` and `space-v1` | all PASS (32 runs; `m15` prints "All checks passed") |
| Live spike | `OBJECT_LIVE_CLAUDE=1 uv run pytest backend/tests/test_m17_live_cli.py -q` (CLI 2.1.317, haiku, `--no-session-persistence`) | 7 passed, through `agentrun`'s own names, `test_object_tool_is_callable` included |

Not verified here: the app's own window (pywebview) and the agent UI in a real browser (jsdom only); real agent chats beyond the two live spike runs.

## Hand checks for Gene

On a copy of his export:

- [ ] The Agents section sits at the top of the sidebar, with Assistant first and "+ New agent" last.
- [ ] Clicking Assistant opens the chat. Ctrl+Alt+J does too. The header shows the agent picker, the model picker and New chat.
- [ ] Assistant creates a Task, edits a page's body and moves a page to the Trash without an Accept step. Each step shows in the chat. The edited file changed only where asked and kept its line endings.
- [ ] Add tags, Fill empty properties and Rephrase still ask you to Accept.
- [ ] New agent "Researcher" with its own instructions: its folder is in `%LOCALAPPDATA%\object\agents\Researcher\` and opens with Open folder. Its chat follows the instructions.
- [ ] Researcher's Tools tab: the shell is off. Turning it on shows the warning. Switching "Object write" off stops it editing notes.
- [ ] Asking any agent to read an "Exclude from AI" page by path with Read, Grep or Glob is refused, and the reply doesn't contain its text.
- [ ] Your own `~/.claude` CLAUDE.md, hooks, plugins and skills don't show up in an agent chat. (Ask it to list its skills and say what its instructions mention.)
- [ ] The Chats tab lists the chats you had, and filtering by title works. Opening one shows its messages and steps.
- [ ] Deleting Researcher and restoring it from "Deleted agents…" brings it back with its chats. Assistant can't be deleted.
- [ ] Copying Researcher's folder elsewhere, changing its id in `agent.json` and using "Add agent folder…" lists it.
- [ ] An AI Chat saved before M17 opens and continues with Assistant.
- [ ] Unlinked mentions still show on the object page.
