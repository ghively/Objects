# Milestone 17: agents, agent folders and full tooling

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

Written 2026-11-05 against `master` at `0f4fde1`. Reconciled 2026-11-06 with the code built on `feat/m16-m24` at `7bee086`: M16 (`2026-11-05-m16-chat-polish-model-picker.md`, results in `m16-acceptance.md`) is built on this branch, not merged to `master`; M17 builds on the same branch. Reconciled again 2026-11-06 at `8099546`: Task 1 is built (`a4f42e9`, with the icon-subset fix `59b9df4`), and its live spike stopped and asked (`m17-cli-spike.md`: Gene's user `CLAUDE.md` and ancestor folders' `CLAUDE.md` files reach a run). Gene's answer, 2026-11-06: "Yes, add and continue", that is, adopt the spike's `claudeMdExcludes` run setting and go on with T2-T11. The changes that follow from it, and from the spike's other findings, are marked "(spike)" below. Every label and default not quoted from the spec is "our string" / "our choice".

**Baseline before T2** (M16's gate re-run at `59b9df4`, after M17's T1, `remaining-work.md`): back end 2094 passed, 17 skipped, 3 xpassed (T1's four live spike tests skip without `OBJECT_LIVE_CLAUDE=1`); front end 410 files passed, 1 skipped (3177 tests passed, 1 skipped); `tsc` clean; lint 0 errors; build ok; `m1_roundtrip.py` and `m2`-`m16_acceptance.py` PASS on `space-sample` and `space-v1` (fixtures in `backend/tests/fixtures/`). The installed CLI is `2.1.317` (`claude --version`, checked 2026-11-06).

**Goal.** Agents are folders. The default agent ("Assistant", M10's assistant) and Gene's own agents are listed at the top of the sidebar. Each one has a soul (`CLAUDE.md`), settings, tool switches and a chat history of its own. A chat turn runs `claude -p` inside the agent's folder and loads only that folder's settings. The agent acts directly through every Object tool and every built-in Claude Code tool. The file tools are fenced away from every space folder, and the shell is off by default.

**Architecture.** The back end gets these modules:

- `agentmodel.py`: the `agent.json` schema and constants.
- `toolcatalog.py`: the Tools tab's groups and the run's allow and deny lists.
- `agents.py` and `agentfiles.py`: the registry in the state dir, and the folder layout and its files.
- `transcripts.py`: one JSONL file per chat in `.object-agent/sessions/`.
- `agentrun.py`: the turn runner. It builds one CLI command from an agent and an ordered list of **contributors**, which is the extension point M18-M20 plug into.
- `api_v1_tools.py`: new `/api/v1` routes behind the expanded `objectapp-mcp`.
- `agent_mcp.py`: the "Object agent tools" MCP server, with one tool in M17.
- `api_agents.py`: the `/api/agents...` routes.

`ai.py` keeps M10's stream handling and M16's tool events. Its `_Attempt` now runs a `RunCommand` from `agentrun`. `/api/ai/chat` takes an `agentId` and answers with the default agent when none is given. The front end gets `frontend/src/agents/` (the sidebar section, the New agent dialog, the agent page and the deleted agents list) and an agent picker in M16's `AiChatHeader` `leading` slot.

**Tech Stack.** Python 3 (FastAPI, pydantic, `mcp` server lib, httpx to loopback only), `uv`; React, TypeScript, zustand, shadcn/ui, Tailwind, vitest; Claude Code CLI **2.1.317** (checked with `claude --version` / `claude --help`).

**Spec.** `docs/superpowers/specs/2026-11-05-agents-design.md`, sections **1** (Agents), **2** (Agents section and agent page: Profile, Instructions, Tools and Chats tabs), **3** (Running a turn), **4** (Tools and switches), plus section **10**'s header agent picker. These parts belong to M16 and are consumed here: `aimodels.resolve_model(chat, default)`, `GET /api/ai/models`, `ai/ModelPicker.tsx`, `ai/AiChatHeader.tsx` (`leading` slot), `ai/toolSteps.ts`, and the paired `tool` events. These parts belong to later milestones: the Memory, Skills and Learning tabs, the "Memory & skills" menu item, and the `memory`/`skill_manage`/`session_search` tools (M18); outside MCP servers and secrets (M19); remote agents and `delegate` (M20); schedules (M21).

**CLI flags (checked against 2.1.317 `claude --help`).**

| Flag | How it was checked |
|---|---|
| `-p` | in `--help` |
| `--output-format stream-json` | in `--help` |
| `--verbose` | in `--help` |
| `--include-partial-messages` | in `--help` |
| `--setting-sources <sources>` | in `--help`; `--setting-sources bogus` answers "Valid options are: user, project, local" |
| `--no-chrome` | in `--help` |
| `--permission-mode` | in `--help`; choices are `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan` |
| `--permission-prompts none` | in `--help` |
| `--strict-mcp-config` | in `--help` |
| `--mcp-config` | in `--help` |
| `--settings <file-or-json>` | in `--help` |
| `--append-system-prompt-file <path>` | not in `--help`, but accepted: run on its own it answers "Append system prompt file not found" for a missing file, while an unknown flag answers "unknown option" |
| `--tools <tools...>` | in `--help` |
| `--allowedTools` / `--disallowedTools` | in `--help`; "comma or space-separated", e.g. `"Bash(git *) Edit"` |
| `--model` | in `--help` |
| `--resume` | in `--help` |
| `--add-dir` | in `--help`; not used, see T1 |
| `--debug-file <path>` | in `--help`; spike only |
| `--no-session-persistence` | in `--help`; spike only, so no session is written to `~/.claude` |

Notes on flags:

- **`--bare` is not used.** It refuses OAuth (spec).
- **`--restricted` is not used.** It ignores project settings.
- **There is no sandbox flag.** The CLI's settings-based sandbox is not offered on native Windows, so the shell stays off by default. T1 records this.

## Global Constraints

- Agents run only through the `claude` CLI under Gene's own login. Object never reads `~/.claude/.credentials.json` or any Claude token, and never calls Anthropic's API. No network client in `agentmodel`, `toolcatalog`, `agents`, `agentfiles`, `transcripts`, `agentrun` or `api_agents`. `agent_mcp.py` uses httpx to the loopback app only, as `mcp_server.py` does.
- The server binds `127.0.0.1` only.
- Agents belong to the machine, not a space. Every agent is a folder.
  - New agents default to `<state>/agents/<name>/` (`appstate.state_dir()`).
  - The registry is `<state>/agents.json`.
  - The agent trash is `<state>/agents/.trash/`.
- Folder layout as spec section 1: `CLAUDE.md`, `.claude/settings.json`, `.claude/settings.local.json`, `.claude/skills/`, `.mcp.json`, `.object-agent/agent.json`, `.object-agent/memory/`, `.object-agent/skills-archive/`, `.object-agent/ledger.jsonl`, `.object-agent/usage.json`, `.object-agent/sessions/`, `.object-agent/cache/`, `.gitignore` (written on create: `settings.local.json`, `cache/`).
- The default agent is named "Assistant". It exists from first run, can be edited and can't be deleted. Every M10 entry point talks to it unless the user picks another agent.
- **Delete** unregisters and moves the folder to `<state>/agents/.trash/` (restorable). This applies only to folders inside `<state>/agents/`. A folder outside the state dir is only unregistered, never moved or deleted.
- A turn is one `claude -p` run with the agent folder as its working directory.
  - It runs with `--setting-sources project,local`.
  - (spike) Its run settings carry `"autoMemoryEnabled": false` and `claudeMdExcludes` naming Gene's user `CLAUDE.md` and every ancestor folder's instruction files (`agentrun.claude_md_excludes`), because `--setting-sources` alone lets them through on CLI 2.1.317. Gene adopted this on 2026-11-06.
  - (spike) Its working folder is the agent folder's resolved (long) path: under an 8.3 path the CLI took `~/.claude/skills` for project skills.
  - (spike) Its environment drops `CLAUDE_CONFIG_DIR` and the variables a parent Claude Code session sets (`agentrun.RUN_ENV_DROP`), so Object started from a Claude Code terminal runs agents as Object started on its own does.
  - It never loads Gene's user `CLAUDE.md`, hooks, plugins, user skills, auto-memory or user permission rules.
  - **Stop-and-ask:** if the CLI can't keep one of these out, the build stops and asks Gene. It does not compromise silently.
- The CLI never stops to ask (`--permission-mode dontAsk`, `--permission-prompts none`). Allowed tools run; switched-off tools are denied.
- Every tool is on by default and switchable per agent, with one exception: the **shell (Bash, PowerShell) is off by default**. Switching it on shows the warning verbatim: "With the shell on, this agent can read every file on this computer, including pages excluded from AI."
- Switches are stored in `agent.json` as the switched-**off** names, so new tools appear switched on.
- **"Exclude from AI" keeps its promise.**
  - Every Object tool hides excluded pages and templates.
  - Every run denies the file tools (Read, Write, Edit, Glob, Grep, NotebookEdit) on every registered space folder and on every other agent's folder. The deny rules are passed by Object, so a shared agent folder can't lift them.
  - A space's `.md` files are written only through Object's tools.
- The agent acts directly: its own tool calls apply with no Accept step. The M10 suggestion entries (Ask AI about this block, Add tags, Fill empty properties, Replace/Insert) keep their Accept step. Their runs get no Object write tools.
- The agent changes its soul, skills and memory only through Object's tools (M18). Built-in Write/Edit is denied on `CLAUDE.md`, `.claude/**` and `.object-agent/**` of its folder. Gene edits them freely in Object or any editor.
- The expanded `objectapp-mcp` keeps each route's safety: version checks, the Trash, history, and no write on read. It never offers permanent delete, emptying the trash, or settings that hide AI or change security.
- Never write on read: listing agents, reading `agent.json` or `CLAUDE.md`, or opening the agent page writes nothing. The default agent's folder is made by its first write (a turn or an edit). Opening a space never writes the state dir.
- File safety for agent files:
  - Every write is atomic (`textfile.atomic_write`).
  - `CLAUDE.md` keeps its BOM and line endings (`textfile.encode_like`).
  - `agent.json` and `.claude/settings.json` keep unknown keys.
- Secrets never go into a space, the repo or a log. Folder `.mcp.json` servers carry only `${VAR}` references; values come in M19.
- Everything is unlocked: no badge, limit or gate.
- Tests write only to temp folders. `OBJECT_STATE_DIR` is a temp folder (conftest's autouse fixture). Nothing writes to `~/.claude` or the real state dir. Fixtures are synthetic.
- Live CLI tests run only with `OBJECT_LIVE_CLAUDE=1`, with `--no-session-persistence` and the `haiku` alias.
- No product or project names other than Object and Claude Code in code, tests or strings.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

These are the inputs and failure modes the spec implies that no single task's happy path exercises, most likely first. Each one's test is listed in its owning task.

1. **Gene's user setup leaking into a run.**
   - Risks: user `CLAUDE.md` (including a `CLAUDE.md` in an ancestor folder of the agent folder), user hooks, plugins, user skills, auto-memory, and user permission rules.
   - The arguments must never name `user` as a setting source or set `CLAUDE_CONFIG_DIR`.
   - The live spike must prove the CLI keeps each of them out.
   - Tests: `test_m17_live_cli.py::test_user_setup_never_reaches_a_run` (T1, live); `test_m17_agentrun.py::test_run_loads_only_project_and_local_settings` (T4).
2. **The fence on awkward paths.**
   - Space folders with spaces, commas, non-ASCII, mixed case or a trailing slash.
   - A space opened from a junction or symlink.
   - An agent folder inside a space folder, or a space inside an agent folder (that deny would also block the agent's own folder).
   - Excluded pages read through Glob and Grep, not only Read.
   - Tests: `test_m17_agentrun.py::test_fence_rules_cover_awkward_paths` and `::test_nested_agent_and_space_refuse_to_run` (T4); `test_m17_agents.py::test_agent_folder_inside_a_space_is_refused` (T2); `scripts/m17_acceptance.py` check 3 (T11).
3. **Indirect leaks of excluded pages through the new Object tools.**
   - The 428 `affected` lists of type and collection deletes.
   - Trash listing and restore.
   - Version history of an excluded page.
   - A merge with an excluded side.
   - Unlinked mentions found in an excluded page.
   - A whiteboard marked excluded.
   - An import preview of a space folder.
   - Tests: `test_m17_mcp_tools.py::test_no_tool_reveals_an_excluded_page` (one parametrised test over every new route) and `::test_import_from_a_space_folder_is_refused` (T5).
4. **Agent folder lifecycle never loses a folder.**
   - Delete of a folder outside the state dir only unregisters it (bytes unchanged).
   - Restore collides with a taken path or a listed id.
   - The default agent can't be deleted or unregistered.
   - "Add agent folder" for a copy whose id is already listed.
   - An unreadable `agents.json` is kept aside, never overwritten.
   - Tests: `test_m17_agents.py::test_delete_outside_state_dir_only_unregisters`, `::test_restore_collisions`, `::test_unreadable_registry_is_kept_aside` (T2).
5. **M10 entry points and saved chats regress.**
   - Ctrl+Alt+J and the editor entries talk to the default agent.
   - Proposal modes still need Accept and run without Object write tools.
   - An M10 AI Chat object (no Agent property) loads and continues with the default agent.
   - `ensure_chat_type` adds "Agent" without rewriting existing chat files.
   - Unlinked mentions still show (never removed or hidden).
   - Tests: `test_m17_chat.py::test_proposal_modes_run_read_only`, `::test_m10_saved_chat_continues_with_default_agent`, `::test_agent_property_added_without_rewriting_chats` (T7); `AiChatPanel.test.tsx` "test Ctrl+Alt+J seed opens the default agent" (T10).

## Contract (T1)

### Storage

| What | Where | Written by |
|---|---|---|
| Agent registry | `<state>/agents.json` `{"agents": [{"id", "path", "kind": "local", "addedAt"}]}`, `dump_json`. M20 adds `kind: "remote"`. | `agents.AgentRegistry` (create, add, unregister, delete, restore). An unreadable file is copied aside as `agents.unreadable-<stamp>.json` before a write (as `spaces.Registry` does). |
| Agent folders | `<state>/agents/<safe_filename(name)>/` by default, or `<location>/<safe_filename(name)>/` | `agents` / `agentfiles` |
| Agent trash | `<state>/agents/.trash/<trashId>/` (the folder, moved) + `<state>/agents/.trash/<trashId>.json` `{"trashId", "agentId", "name", "icon", "originalPath", "deletedAt"}` | `AgentRegistry.delete` / `restore` |
| Object's fields | `<folder>/.object-agent/agent.json` (schema below) | `agentfiles.write_agent_file` |
| Soul | `<folder>/CLAUDE.md` | `AgentRegistry.save_instructions`, create, duplicate |
| Folder permissions | `<folder>/.claude/settings.json` `permissions.deny`, generated entries only (`agentfiles.sync_permissions`) | create, tool-switch saves |
| Chats | `<folder>/.object-agent/sessions/<chatId>.jsonl` | `transcripts` |
| Run files | a temp folder per attempt (outside every space and agent folder), removed after the run: `mcp.json`, `run-settings.json`, `append.md` | `agentrun.build_run` |

These are reserved and **not written in M17**: `.object-agent/memory/`, `skills-archive/`, `ledger.jsonl`, `usage.json` and `cache/` (M18). The default agent's model is M16's `aiModel` device setting (see the Agent schema).

### `agent.json` (`backend/objectapp/agentmodel.py`, pydantic; `Agent*` in `frontend/src/api/types.ts`)

```jsonc
{
  "schemaVersion": 1,            // any other value: read-only ("This agent was made by a newer version of Object.")
  "id": "01JC7ZK3T9Q4M2X8B5N6R1V0WE",  // ULID (ids.new_ulid); the default agent is "assistant"
  "name": "Researcher",          // 1-60 characters, whitespace collapsed
  "icon": "ph-robot",            // a Phosphor name ("ph-...") or one emoji; default "ph-robot", default agent "ph-sparkle"
  "color": "violet",             // a type colour name or null
  "description": "",             // at most 500 characters
  "model": null,                 // aimodels.clean_model rule; for the default agent always null (its model is aiModel)
  "toolsOff": ["Bash"],          // switched-off tool ids (toolcatalog); new agents start with toolcatalog.default_off()
  "learning": null,              // RESERVED for M18 (kept verbatim by M17)
  "createdAt": "2026-11-05T09:00:00.000Z",
  "updatedAt": "2026-11-05T09:00:00.000Z"
}
```

- Unknown top-level keys are kept on every save.
- An unreadable or invalid file lists the agent with `readOnlyReason` "This agent's settings can't be read." It can't run, and `PUT` answers 423.
- **Reserved for M18** (named here so M18 fills them without a schema bump): `learning: {memoryChars: 2200, userChars: 1375, memoryReviewEvery: 10, skillReviewEvery: 10, reviewModel: null, curator: true} | null` (null = these defaults).
- Schedules are not here. They live in the space (M21, `.object/automations/` with the agent's id).

```python
# agentmodel.py
SCHEMA_VERSION = 1
DEFAULT_AGENT_ID = "assistant"; DEFAULT_AGENT_NAME = "Assistant"; DEFAULT_AGENT_ICON = "ph-sparkle"
NEW_AGENT_ICON = "ph-robot"; NAME_MAX = 60; DESCRIPTION_MAX = 500
AGENTS_DIR = "agents"; TRASH_DIR = ".trash"; REGISTRY_FILE = "agents.json"
META = ".object-agent"; AGENT_FILE = ".object-agent/agent.json"; SESSIONS_DIR = ".object-agent/sessions"
PROTECTED = ("CLAUDE.md", ".claude/**", ".object-agent/**")     # built-in Write/Edit denied in the agent's own folder
GITIGNORE = "settings.local.json\ncache/\n"                      # spec section 1, verbatim
AGENT_ID = r"^(?:assistant|[0-9A-HJKMNP-TV-Z]{26})$"
SHELL_WARNING = "With the shell on, this agent can read every file on this computer, including pages excluded from AI."
DEFAULT_SOUL = ("You are Assistant, the assistant inside Object, the user's local Markdown notes app. "
                "Be concise. When you change notes, say what you changed.")  # our string

class AgentFile(BaseModel):          # model_config extra="allow" (unknown keys kept)
    schemaVersion: int; id: str; name: str; icon: str | None; color: str | None
    description: str = ""; model: str | None = None; toolsOff: list[str] = []
    learning: dict[str, Any] | None = None; createdAt: str; updatedAt: str

class AgentInput(BaseModel):         # what create/save accept
    name: str; icon: str | None = None; color: str | None = None; description: str = ""
    model: str | None = None; toolsOff: list[str] | None = None; learning: dict[str, Any] | None = None

def clean_input(inp: AgentInput) -> AgentInput   # collapses whitespace, checks caps and the model rule; raises AgentInvalid(message)
```

### TypeScript (T1, `frontend/src/api/types.ts`)

```ts
export interface Agent {
  id: string; kind: 'local'                 // M20 adds 'remote'
  name: string; icon: string | null; color: string | null; description: string
  model: string | null                      // effective default: the default agent's is Settings' aiModel
  toolsOff: string[]; learning: Record<string, unknown> | null
  createdAt: string | null; updatedAt: string | null
  default: boolean; folder: string; inStateDir: boolean
  exists: boolean                           // false: the default agent before its first use (no folder yet)
  missing: boolean                          // a registered folder that is gone
  readOnlyReason: string | null; revision: string | null
  mcpServers: { name: string; missingVars: string[]; usable: boolean }[]   // the folder's .mcp.json
}
export interface AgentInput { name: string; icon?: string | null; color?: string | null; description?: string; model?: string | null; toolsOff?: string[]; learning?: Record<string, unknown> | null }
export interface CreateAgentRequest { agent: AgentInput; instructions: string; location?: string | null; duplicateOf?: { id: string; memory: boolean; skills: boolean } | null; clientId?: string }
export interface AgentTrashItem { trashId: string; agentId: string; name: string; icon: string | null; originalPath: string; deletedAt: string }
export interface ToolRow { id: string; label: string; on: boolean; warning: string | null }
export interface ToolGroup { id: string; label: string; tools: ToolRow[] }
export interface AgentChatSummary { id: string; title: string; createdAt: string; updatedAt: string; messageCount: number; spaceName: string | null; delegated: boolean }
export type TranscriptItem =
  | { type: 'user'; text: string; at: string; contextPaths: string[] }
  | { type: 'assistant'; text: string; at: string; model: string | null; sessionId: string | null; stopped?: boolean }
  | { type: 'tool'; id: string; name: string; input: Record<string, unknown> | null; result: string | null; isError: boolean; at: string }
  | { type: 'error'; message: string; at: string }
export interface AgentTranscript extends AgentChatSummary { agentId: string; sessionId: string | null; objectPath: string | null; items: TranscriptItem[] }
// M10/M16 types gain:
//   AiChatRequest.agentId?: string | null; AiChatRequest.chatId?: string | null
//   AiEvent | { type: 'chat'; chatId: string; agentId: string }       (first event of every turn)
//   AiChat.agent: string | null; AiChat.agentId: string; AiChat.chatId: string | null
//   SaveAiChatRequest.agentId?: string | null; SaveAiChatRequest.chatId?: string | null
//   ChangeKind gains 'agents' | 'agentChats'
// frontend/src/nav/tabs.ts: Target gains { kind: 'agent'; id: string; tab?: string };
//   SidepanelTarget's aiChat becomes { kind: 'aiChat'; path?: string; agentId?: string; chatId?: string }
```

`api/client.ts` (T1) adds:

- `agents()`, `agent(id)`, `createAgent(req)`, `addAgentFolder(path)`, `saveAgent(id, input, baseRevision)`
- `deleteAgent(id)`, `unregisterAgent(id)`, `agentTrash()`, `restoreAgent(trashId)`
- `agentInstructions(id)`, `saveAgentInstructions(id, text, baseRevision)`
- `agentToolDefaults()`, `agentTools(id)`, `agentChats(id)`, `agentChat(id, chatId)`, `revealAgentFolder(id)`

`agents` and `agentChats` join the client's `RESYNC_EVENTS`.

`test/mockApi.ts` (T1) adds helpers `agent()`, `agentTranscript()` and the mocks for every method above.

`frontend/src/agents/useAgents.ts` (T1) is a zustand store: `{agents: Agent[]; loaded: boolean; load(): Promise<void>; byId(id): Agent | undefined}`. It reloads on `agents` events. Both the sidebar and the chat picker use it.

### Routes (T7 fills `backend/objectapp/api_agents.py`; T1 mounts the stub)

| Route | Body / query | Answer | Errors |
|---|---|---|---|
| `GET /agents` | | `{agents: Agent[]}` (the default agent first, then registry order). Never writes. | |
| `GET /agents/{id}` | | `Agent` | 404 |
| `POST /agents` | `CreateAgentRequest` | 201 `Agent` | 404 (location not a folder, duplicate source unknown); 409 (folder exists at a chosen location); 422 (name, caps, model, an agent folder inside or holding a space folder: "An agent folder can't be inside a space folder or hold one.") |
| `POST /agents/add-folder` | `{path, clientId?}` | 201 `Agent` | 404 (not a folder); 409 (that id is already listed: "An agent with this id is already listed."); 422 (no readable `.object-agent/agent.json`: "This folder isn't an Object agent.", or nesting as above) |
| `PUT /agents/{id}` | `{agent: AgentInput, baseRevision, clientId?}` | `Agent`. The default agent's `model` is written to the `aiModel` device setting. | 404, 409 `{currentRevision}`, 422, 423 |
| `DELETE /agents/{id}?clientId=` | | `{trashId: string \| null}`. `null` means it was only unregistered (outside the state dir). | 404; 422 for the default agent ("The default agent can't be deleted.") |
| `POST /agents/{id}/unregister` | `{clientId?}` | `{ok: true}` | 404; 422 for the default agent |
| `GET /agent-trash` | | `{items: AgentTrashItem[]}` newest first | |
| `POST /agent-trash/{trashId}/restore` | `{clientId?}` | `Agent`. Restored to `originalPath`, or to a free `<name> (2)` beside it when that is taken. | 404; 409 when its id is listed again |
| `GET /agents/{id}/instructions` | | `{text, revision}` (`""` and `null` when there is no `CLAUDE.md`) | 404 |
| `PUT /agents/{id}/instructions` | `{text, baseRevision, clientId?}` | `{revision}` | 404, 409 `{currentRevision}`, 423 |
| `GET /agent-tools` | | `{groups: ToolGroup[]}`: the catalogue with default states (New agent form) | |
| `GET /agents/{id}/tools` | | `{groups: ToolGroup[]}` with this agent's states and one group per folder MCP server | 404 |
| `GET /agents/{id}/chats` | | `{chats: AgentChatSummary[]}` newest first | 404 |
| `GET /agents/{id}/chats/{chatId}` | | `AgentTranscript` | 404 (also for a chat id that isn't a ULID) |
| `POST /agents/{id}/reveal` | | `{ok}` (shows the folder in the OS file manager, as `/api/reveal`: `server.reveal_in_file_manager`, imported inside the route because `server` imports `api_agents`) | 404 |

Events:

- `ChangeEvent("agents", <agentId or "trash">, <revision or None>, origin=clientId)` on create, add, save, instructions save, delete, unregister and restore.
- `ChangeEvent("agentChats", agentId, chatId, origin=None)` when a transcript is written.

`agents` and `agentChats` join `watcher.ChangeEvent.kind` and `server.RESYNC_EVENTS` (T1).

**`/api/ai/chat` and the default agent (T7).**

- `ChatRequest` gains `agentId: str | None = None` (None means `DEFAULT_AGENT_ID`) and `chatId: str | None = None` (not a ULID means a new chat).
- Every stream starts with `{"type":"chat","chatId","agentId"}`, then M10/M16's events.
- An unknown agent answers one `error` event ("That agent isn't listed any more."). So do a missing folder ("This agent's folder is missing: <path>") and a read-only agent (its reason). The CLI isn't started in any of these cases.
- The first turn of the default agent creates its folder (`ensure_default`).
- Model: `aimodels.resolve_model(clean_model(req.model), agents.effective_model(agent, settings))`.
- `mode == "chat"` runs with write tools (`write=True`). The proposal modes `askBlock`, `tagBlock`, `tagObject`, `autofill` and `rephrase` run read-only.
- `GET /api/ai/chat?path=` adds `agent` (the Agent property), `agentId` (the first listed agent with that name, case-insensitive, else the default agent) and `chatId` (`transcripts.find_by_session(folder, sessionId)` or null).
- `POST /api/ai/chat/save` takes `agentId` and `chatId`. It writes the Agent property and appends an `object` line to the transcript.

### Transcript format (`backend/objectapp/transcripts.py`; M18 indexes it)

The file is `<folder>/.object-agent/sessions/<chatId>.jsonl`, UTF-8, one JSON object per line, append-only. A line that doesn't parse (a torn last line) is skipped on read. The first line is the header.

```jsonc
{"type":"chat","v":1,"id":"<chatId>","agentId":"assistant","title":"What do my notes say?","createdAt":"…","space":{"name":"Notes","key":"<appstate.space_key>"},"delegated":false}
{"type":"user","text":"…","at":"…","contextPaths":["Pages/A.md"]}
{"type":"tool","id":"toolu_1","name":"search","input":{"query":"rack"},"result":"[]","isError":false,"at":"…"}
{"type":"assistant","text":"…","at":"…","model":"sonnet","sessionId":"<uuid>"}           // "stopped": true when the stream was closed early
{"type":"error","message":"…","at":"…"}
{"type":"object","path":"AI Chats/What do my notes say.md","at":"…"}                      // the AI Chat object it was saved as
```

- `title` is `aichat.default_title([{"role": "user", "text": <first user message>}])` (it takes a message list) and is never changed.
- `delegated` is reserved for M20 (true plus `"from": <agentId>`). `schedule` is reserved for M21.
- Tool lines join M16's call and result pair by id. Input and result are M16's capped forms.
- The user line is appended when the turn starts. The tool lines and the assistant (or error) line are appended in one write when it ends, or when the client goes away (`stopped: true`, the text shown so far).
- The assistant line's `text` is what the panel shows (M16's fix `b13752e`): when the turn had tool steps, every streamed `text` of the turn joined, since `done.text` is then only the CLI's last message; otherwise `done.text` (or the streamed text when that is empty). A stopped turn with steps and no text still writes its tool lines and an assistant line with `text: ""` and `stopped: true`.

```python
TRANSCRIPT_VERSION = 1
CHAT_ID = r"^[0-9A-HJKMNP-TV-Z]{26}$"
def new_chat_id() -> str
def path_for(folder: Path, chat_id: str) -> Path                       # ValueError for a bad id
def start(folder: Path, chat_id: str, *, agent_id: str, title: str, space_name: str | None,
          space_key: str | None, created_at: str, delegated: bool = False) -> None   # header only if the file is new
def append(folder: Path, chat_id: str, lines: list[dict[str, Any]]) -> None          # one write, a lock per file
def read(folder: Path, chat_id: str) -> dict[str, Any]                 # AgentTranscript shape; FileNotFoundError
def list_chats(folder: Path) -> list[dict[str, Any]]                   # AgentChatSummary, newest updatedAt first
def find_by_session(folder: Path, session_id: str) -> str | None       # newest chat whose assistant lines carry it
```

### Agents and folders (`backend/objectapp/agents.py`, `agentfiles.py`)

As built by T1, the errors live in `agentmodel.py` (so `clean_input` can raise `AgentInvalid` without importing the registry) and `agents.py` re-exports them; `agentmodel` also has `NEWER_VERSION` and `UNREADABLE`, the two read-only reasons, which T2 uses.

```python
class AgentError(Exception): status: int; message: str     # agentmodel; re-exported by agents
class AgentNotFound(AgentError)   # 404
class AgentConflict(AgentError)   # 409; .current_revision
class AgentInvalid(AgentError)    # 422
class AgentReadOnly(AgentError)   # 423

@dataclass
class AgentRecord:
    id: str; folder: Path; data: dict[str, Any]; revision: str | None
    default: bool; exists: bool; missing: bool; in_state_dir: bool; read_only_reason: str | None
    def to_api(self, settings: dict[str, Any]) -> dict[str, Any]       # the Agent shape

class AgentRegistry:
    def __init__(self, state: Path | None = None) -> None              # state_dir() when None
    def list(self) -> list[AgentRecord]                                 # never writes
    def get(self, agent_id: str) -> AgentRecord                         # AgentNotFound
    def ensure_default(self, seed: dict[str, Any] | None = None) -> AgentRecord   # makes its folder on first write
    def create(self, inp: AgentInput, instructions: str, location: Path | None = None) -> AgentRecord
    def duplicate(self, source_id: str, inp: AgentInput, *, memory: bool, skills: bool,
                  location: Path | None = None) -> AgentRecord
    def add_folder(self, path: Path) -> AgentRecord
    def save(self, agent_id: str, inp: AgentInput, base_revision: str) -> AgentRecord
    def unregister(self, agent_id: str) -> None
    def delete(self, agent_id: str) -> str | None                       # trashId, or None (only unregistered)
    def trash(self) -> list[dict[str, Any]]
    def restore(self, trash_id: str) -> AgentRecord
    def read_instructions(self, agent_id: str) -> tuple[str, str | None]
    def save_instructions(self, agent_id: str, text: str, base_revision: str | None) -> str
    def local_folders(self) -> list[Path]                               # every registered local agent folder (for the fence)

def effective_model(agent: AgentRecord, settings: dict[str, Any]) -> str | None   # default: settings["aiModel"]; else data["model"]

# agentfiles.py
def write_skeleton(folder: Path, data: dict[str, Any], instructions: str) -> None   # CLAUDE.md, .claude/settings.json,
                                         # .object-agent/agent.json, .object-agent/sessions/, .gitignore; create_new, never overwrites
def read_agent_file(folder: Path) -> tuple[dict[str, Any], str]        # (data, revision = sha256 of bytes); ValueError when unreadable
def write_agent_file(folder: Path, data: dict[str, Any]) -> str         # atomic, dump_json, keeps unknown keys; new revision
def generated_denies(tools_off: Iterable[str]) -> list[str]            # catalogue CLI names of the off tools + the PROTECTED rules
def sync_permissions(folder: Path, old_off: Iterable[str], new_off: Iterable[str]) -> None
    # .claude/settings.json: permissions.deny = (existing minus generated_denies(old_off)) + generated_denies(new_off);
    # every other key and entry kept; missing file created
def folder_mcp_servers(folder: Path) -> dict[str, dict[str, Any]]      # .mcp.json "mcpServers"; {} when absent or unreadable
def var_refs(server: dict[str, Any]) -> set[str]                       # every ${VAR} (and ${VAR:-default}) in it
```

A folder inside a registered space folder, or one holding a space folder, is refused by `create`, `duplicate` and `add_folder` (`AgentInvalid`, the message in the routes table).

### Tool catalogue (`backend/objectapp/toolcatalog.py`)

```python
OBJECT_SERVER = "object"; AGENT_SERVER = "object-agent"
OBJECT_READ: tuple[str, ...]    # the 20 read tools below (short names); M22 appends 2 (22)
OBJECT_WRITE: tuple[str, ...]   # the 35 write tools below; M22 appends 6 (41)
AGENT_TOOLS: tuple[str, ...] = ("agent_info",)    # M18, M20, M21 and M24 append names here, in build order

@dataclass(frozen=True)
class ToolEntry:
    id: str                      # stored in toolsOff: "mcp__object__read", "Read", "Bash"
    label: str
    cli: tuple[str, ...]         # the CLI names this row switches
    default_on: bool = True
    warning: str | None = None

@dataclass(frozen=True)
class ToolGroup:
    id: str; label: str; tools: tuple[ToolEntry, ...]

BUILTINS: tuple[ToolEntry, ...] = (
    ToolEntry("Bash", "Shell (Bash, PowerShell)", ("Bash", "PowerShell"), default_on=False, warning=SHELL_WARNING),
    ToolEntry("Read", "Read files", ("Read",)), ToolEntry("Write", "Write files", ("Write",)),
    ToolEntry("Edit", "Edit files", ("Edit", "MultiEdit")), ToolEntry("Glob", "Find files", ("Glob",)),
    ToolEntry("Grep", "Search in files", ("Grep",)), ToolEntry("WebSearch", "Web search", ("WebSearch",)),
    ToolEntry("WebFetch", "Web fetch", ("WebFetch",)), ToolEntry("Task", "Subagents", ("Task", "Agent")),
    ToolEntry("NotebookEdit", "Notebook edit", ("NotebookEdit",)),
    ToolEntry("TodoWrite", "To-do list", ("TodoWrite", "TaskCreate", "TaskGet", "TaskList", "TaskUpdate")),
)   # (spike) CLI 2.1.317 has no TodoWrite; its to-do list is TaskCreate/TaskGet/TaskList/TaskUpdate, in some runs only
ALWAYS_ALLOWED: tuple[str, ...] = ("Skill",)  # not a switch; (spike) T11's live check decides whether "ToolSearch" joins it

GROUP_LABELS = {"object-read": "Object read", "object-write": "Object write",
                "object-agent": "Object agent tools", "builtin": "Claude Code built-ins"}
def catalogue(folder_servers: Iterable[str] = ()) -> list[ToolGroup]   # the four groups, then "mcp:<name>" per folder server
def default_off() -> list[str]                                         # ["Bash"]
def groups_out(groups: list[ToolGroup], off: Iterable[str]) -> list[dict[str, Any]]   # the ToolGroup API shape

@dataclass
class ToolLists:
    allowed: list[str]       # --allowedTools
    disallowed: list[str]    # --disallowedTools (bare names, no paths)
def run_tool_lists(off: Iterable[str], *, write: bool, folder_servers: Iterable[str]) -> ToolLists
    # allowed  = on built-ins' cli names + ALWAYS_ALLOWED + "mcp__object__<t>" for each on read tool
    #            (+ write tools when write) + "mcp__object-agent__<t>" + "mcp__<srv>" per on folder server
    # disallowed = off built-ins' cli names + off Object/agent tool names (+ every write tool when not write)
GROUP_PROVIDERS: list[Callable[[AgentRecord], list[ToolGroup]]]        # M19 appends its gateway groups
```

A group's switch writes every member's id. Group ids are never stored, so a server's new tools show switched on (spec).

### Turn runner (`backend/objectapp/agentrun.py`): the extension point

```python
@dataclass(frozen=True)
class RunScope:
    agent: AgentRecord
    space_root: Path; space_name: str
    api_url: str; token: str           # the ephemeral token's secret (goes in env only)
    write: bool                        # False for proposal modes (and M18 reviews' read-only parts)
    chat_id: str
    purpose: str                       # "chat" | "proposal"; M18 "review" / "curator", M20 "delegate", M21 "schedule",
                                       # M24 "work" / "work-read" / "work-file" / "work-sync"
    state: Path                        # appstate.state_dir()

@dataclass
class RunParts:
    append_prompt: list[str]           # joined with blank lines into append.md (--append-system-prompt-file)
    mcp_servers: dict[str, dict[str, Any]]
    allowed: list[str]; disallowed: list[str]
    deny_rules: list[str]              # path-scoped rules -> run-settings.json permissions.deny
    settings: dict[str, Any]           # merged into run-settings.json
    env: dict[str, str]
    notes: list[str]                   # skipped folder servers etc. (logged, shown on the Profile tab)

Contributor = Callable[[RunScope, RunParts], None]
def add_contributor(name: str, order: int, fn: Contributor) -> None    # replaces one of the same name
def contributors() -> list[tuple[int, str, Contributor]]                # sorted by order, then name

# M17's contributors and their orders (later milestones slot between them; see the registry of orders below):
#   10  (M18 "memory-snapshot": MEMORY.md + USER.md frozen at chat start; spec order: before the guidance)
#   20  "folder-mcp":  the folder's .mcp.json servers whose ${VAR}s all resolve via SECRET_LOOKUP,
#                      whose names fullmatch [A-Za-z0-9_-]{1,64} and aren't "object"/"object-agent"; others -> notes
#   30  "object-mcp":  objectapp.mcp_server (args ["-m","objectapp.mcp_server"] + ["--read-only"] when not write)
#   35  (M19 "gateway": the enabled outside servers, filtered by switches)
#   40  "agent-mcp":   objectapp.agent_mcp (M18/M20 tools register inside that server)
#   50  "guidance":    OBJECT_GUIDANCE (or PROPOSAL_GUIDANCE) formatted with the agent and space names
#   60  "tools":       toolcatalog.run_tool_lists(agent toolsOff, write=, folder_servers=)
#   70  "fence":       fence_rules(...) into deny_rules
SECRET_LOOKUP: Callable[[str], str | None] = lambda name: None          # M19 replaces it

OBJECT_GUIDANCE: str   # our text: Object's tools are the only way to read or change notes in "{space}"; the space's folder and
                       # other agents' folders are closed to file tools; pages excluded from AI and templates are hidden and must
                       # stay so; every write needs the version from your last read (on a conflict read again, then retry);
                       # move_to_trash is undoable and nothing deletes for good; your CLAUDE.md, .claude/ and .object-agent/ can't
                       # be edited with file tools.
PROPOSAL_GUIDANCE: str # the same, plus M10's "You can't change any note: the user applies what you suggest."

def fence_folders(scope: RunScope, spaces: list[Path], agents: list[Path]) -> list[Path]
    # every registered space (spaces.Registry(state).list(current=space_root)), every other local agent folder,
    # <state>/agents/.trash; all resolved; duplicates removed (case-insensitively on Windows)
def rule_path(p: Path) -> str           # "//c/Users/x/My Notes" on Windows (drive lower-cased, "/" separators), "//home/x" on POSIX
def fence_rules(folders: list[Path], own: Path, state: Path, home: Path) -> list[str]
    # per fenced folder: Read(<rp>/**) and Edit(<rp>/**); the agent's own PROTECTED paths: Edit(<rp own>/CLAUDE.md),
    # Edit(<rp own>/.claude/**), Edit(<rp own>/.object-agent/**); the state dir's own files: Read(<rp state>/*),
    # Edit(<rp state>/*), Read(<rp state>/automation-logs-*/**); Gene's Claude Code files: Read(<rp home>/.claude/.credentials.json),
    # Edit(<rp home>/.claude/**), Edit(<rp home>/.claude.json). The T1 spike may add Write(...)/NotebookEdit(...)/Grep(...)/Glob(...)
    # forms if Read/Edit rules don't cover those tools; this function is the one place.
def nesting_problem(own: Path, folders: list[Path]) -> str | None       # the 422/run-error message when own is in, or holds, a fenced folder

# (spike, adopted by Gene 2026-11-06)
RUN_SETTINGS_BASE: dict[str, Any] = {"autoMemoryEnabled": False}       # in every run-settings.json
def claude_md_excludes(own: Path, home: Path) -> list[str]
    # resolved, "/"-separated absolute paths (e.g. "C:/Users/x/.claude/CLAUDE.md"), duplicates removed:
    # <home>/.claude/CLAUDE.md and <home>/.claude/rules/**, then for every ancestor folder a of own (own itself
    # excluded) up to the drive root: a/CLAUDE.md, a/.claude/CLAUDE.md, a/CLAUDE.local.md. Never own's CLAUDE.md.
RUN_ENV_DROP: tuple[str, ...] = ("CLAUDE_CONFIG_DIR", "CLAUDECODE", "CLAUDE_CODE_", "CLAUDE_AGENT_SDK_",
                                 "CLAUDE_PLUGIN_ROOT", "CLAUDE_EFFORT", "CLAUDE_PID", "CLAUDE_PREVIEW_", "AI_AGENT")
    # names or name prefixes dropped from a run's environment (the live test's PARENT_SESSION_VARS, minus BAGGAGE)

@dataclass
class RunCommand:
    args: list[str]; cwd: Path; env: dict[str, str]; tmp: Path; mcp_config: dict[str, Any]; run_settings: dict[str, Any]; append: str

CLI_FLAGS = ("-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
             "--setting-sources", "project,local", "--no-chrome",
             "--permission-mode", "dontAsk", "--permission-prompts", "none", "--strict-mcp-config", "--tools", "default")
def build_run(scope: RunScope, *, claude: str, model: str | None, resume: str | None) -> RunCommand
    # args = [claude, *CLI_FLAGS, "--mcp-config", tmp/mcp.json, "--settings", tmp/run-settings.json,
    #         "--append-system-prompt-file", tmp/append.md, "--allowedTools", ",".join(allowed),
    #         "--disallowedTools", ",".join(disallowed)] + ["--model", m] + ["--resume", s];
    # cwd = agent folder, resolved (long path); env = os.environ minus every RUN_ENV_DROP name/prefix,
    # + OBJECT_API_URL/OBJECT_API_TOKEN + parts.env;
    # run_settings = RUN_SETTINGS_BASE + {"claudeMdExcludes": claude_md_excludes(own, Path.home()),
    #   "permissions": {"deny": parts.deny_rules}}, then parts.settings merged in (lists under
    #   "claudeMdExcludes" and "permissions.deny" are extended, never replaced, so no contributor drops them);
    # mcp.json holds "${OBJECT_API_TOKEN}", never the secret. Raises RunRefused(message) for a nesting problem.
```

`ai.Turn` gains `run: Callable[[str | None], RunCommand]` (the resume id in, a fresh command out) and `timeout: float = TURN_TIMEOUT` (`run_turn`'s hard deadline and its "Claude Code took too long (over {n} seconds) and was stopped." message use `turn.timeout`; M10's 300 s stays the default, and M20's `headless.run_chat` passes its own `timeout` here). The default is written `field(default_factory=lambda: TURN_TIMEOUT)` so it reads the module constant when the `Turn` is made: M10's `test_timeout_kills_the_process` monkeypatches `ai.TURN_TIMEOUT` and must keep passing. `_Attempt` uses its `cwd`, `env` and `args` and removes its `tmp` after the run. M10's `cli_args`, `mcp_config` and empty working folder are removed in T7.

Two more `ai.py` changes (T4), from the built code:

- `build_prompt` is called by `api_ai` before the `Turn` exists, so it gains a keyword `intro: bool = True`; T7 passes `intro=False` for agent runs (the guidance carries it). M10's callers and tests keep the default.
- `_short_tool` also strips the `mcp__object-agent__` prefix, so `tool` events name the agent tools by short name (`agent_info`), as `toolSteps.ts` expects; other `mcp__…` names stay whole (M16's `test_other_tools_keep_their_names`).

**Registry of contributor orders (M17-M24).** Every contributor has its own order; no two share one. A later milestone registers only the order listed here for it, and its plan refers to this table.

| Order | Name | Milestone | What it does |
|---|---|---|---|
| 10 | `memory-snapshot` | M18 | the chat's frozen MEMORY.md / USER.md into `append_prompt` |
| 15 | `learning-guidance` | M18 | the learning tools' guidance into `append_prompt` |
| 20 | `folder-mcp` | M17 | the folder's `.mcp.json` servers |
| 30 | `object-mcp` | M17 | `objectapp-mcp` |
| 35 | `gateway` | M19 | the enabled outside MCP servers |
| 40 | `agent-mcp` | M17 | the `object-agent` tools server |
| 50 | `guidance` | M17 | `OBJECT_GUIDANCE` / `PROPOSAL_GUIDANCE` |
| 55 | `schedule-guidance` | M21 | `SCHEDULE_GUIDANCE` for `purpose == "schedule"` |
| 57 | `work-guidance` | M24 | `WORK_GUIDANCE` (and `DESK_SYNC_GUIDANCE` for `"work-sync"`) for the four work purposes |
| 60 | `tools` | M17 | `--allowedTools` / `--disallowedTools` from the switches |
| 62 | `gateway-tools` | M19 | allow/deny entries for the outside and folder servers |
| 64 | `delegation` | M20 | the flat rule for `purpose == "delegate"`; `MCP_TOOL_TIMEOUT` |
| 66 | `work-tools` | M24 | replaces the tool lists (and drops unlisted servers) for the read-only work purposes `"work-read"`, `"work-file"`, `"work-sync"`; `"work"` is left as 60-64 built it |
| 68 | `review-tools` | M18 | replaces the tool lists and servers for `purpose` `"review"` / `"curator"`; last of the tool-list contributors so nothing re-adds a tool after it (it and `work-tools` act on disjoint purposes) |
| 70 | `fence` | M17 | the path deny rules |
| 75 | `fence-remote` | M20 | deny rules for remote agents' folders |

`RunScope.purpose` values: `"chat"`, `"proposal"` (M17), `"review"`, `"curator"` (M18), `"delegate"` (M20), `"schedule"` (M21), `"work"`, `"work-read"`, `"work-file"`, `"work-sync"` (M24). M17 adds no other `RunScope` field for later milestones.

### Tokens and the agent tools server

- `tokens.TokenRecord` gains `agent: str | None = None` and `chat: str | None = None`. Stored tokens never have them.
- `TokenStore.ephemeral(name, scope="read", agent=None, chat=None) -> tuple[TokenRecord, str]` (the record and the secret, as built in M10) stamps them; `TokenStore.drop_ephemeral(secret)` is unchanged.
- A turn's token is `ephemeral(agent.name, "read-write" if write else "read", agent=agent.id, chat=chat_id)`. Writes made with it are announced `api:<agent name>` and logged in the activity log (M11's rules).
- `backend/objectapp/agent_mcp.py` is run as `python -m objectapp.agent_mcp`.
  - Its environment holds `OBJECT_API_URL` (loopback only) and `OBJECT_API_TOKEN`.
  - `TOOL_MODULES = ("objectapp.agent_tools_core",)`. Each module has `register(server: MCPServer, client: ObjectClient) -> None`. M18, M20, M21 and M24 append their modules.
  - `build_server(client) -> MCPServer` (name `object-agent`).
- M17's one tool is `agent_info()`, which calls `GET /api/v1/agent/info` and answers `{agent: {id, name, model, folder}, space: {name}}`.
- `/api/v1/agent/*` routes (`api_agent_v1.py`) need a token whose `agent` is set (403 "This token isn't an agent's.") and act only on that agent. `v1guard.agent_auth(guard, registry, request) -> tuple[TokenRecord, AgentRecord]` (T5) is shared with M18's, M20's and M21's routes.

### Expanded `objectapp-mcp` (T5: `api_v1_tools.py` routes, `mcp_server.py` tools)

Every new tool calls a new `/api/v1` route through `ObjectClient`. Each route uses the same `Space` method as the app's route, plus `v1guard`.

From the built code:

- `api_v1_tools.router(ctx: ApiContext, engine: AutomationEngine, imports: APIRouter) -> APIRouter`. Some app routes keep their state inside their router: the automation engine (`api_automations.router(ctx, engine)`) and M15's import previews and jobs (closures in `api_import.router(ctx)`, which exposes `jobs` as `router.jobs`). `server.py` keeps the import router it mounts in a variable and passes it and the engine in. The v1 import routes call the import router's own endpoints (`route.endpoint` for `/import/preview` and `/import/start`) and read `imports.jobs`; `api_import.py` is not changed. Version history uses a `HistoryStore(space.root, is_whiteboard=…)` built as `api_history` builds it (file-backed).
- M15's start request needs a mapping, so the tool is `start_import(preview_id, target, mapping=None)`: `None` uses the `mapping` that preview answered with (the v1 route remembers each preview id's mapping it served).
- `mcp_server.ObjectClient` has only `get` and `post`. T5 adds `put(route, body)` and `delete(route, **params)` with the same error handling, and `ApiError`'s 409 text also names `currentRevision` when the answer has one (definitions answer `currentRevision`, objects `currentVersion`).

- Auth: `read` scope for reads, `read-write` scope for writes.
- An excluded page or a template answers 404 for every path argument.
- Result lists leave hidden objects out and add `hiddenCount` where a count matters.
- Writes announce `api:<token name>` and go to the activity log.

| Group | Tool (short name) | Route | Route's safety kept |
|---|---|---|---|
| read (M11) | `schema`, `search`, `query`, `run_saved_query`, `peek`, `read`, `backlinks`, `daily_note`, `changes_since` | unchanged | |
| read | `type_definition(type)` | `GET /v1/types/{id}` | full TypeDef + `revision` |
| read | `collection(collection_id)` | `GET /v1/collections/{id}` | definition + `revision` |
| read | `saved_query(query_id)` | `GET /v1/queries/{id}` | definition + `revision` |
| read | `read_whiteboard(path)` | `GET /v1/whiteboard?path=` | board + `revision`; 404 when its `.md` is hidden |
| read | `version_history(path)` | `GET /v1/history?path=` | 404 for a hidden object |
| read | `read_version(path, version_id)` | `GET /v1/history/version` | 404 for a hidden object |
| read | `unlinked_mentions(path)` | `GET /v1/references?path=` | only mentions in visible objects |
| read | `trash()` | `GET /v1/trash` | object entries whose trashed file is excluded or a template are left out |
| read | `automations()` | `GET /v1/automations` | |
| read | `import_preview(path, kind="auto")` | `POST /v1/import/preview` | writes nothing; 422 for a source inside or holding a registered space folder ("Importing from a space folder isn't available to agents.") |
| read | `import_status(job_id)` | `GET /v1/import/jobs/{id}` | |
| write (M11) | `create_object`, `create_task`, `set_properties`, `add_tags`, `add_to_collection`, `append_to_section`, `replace_section`, `rename`, `move_to_trash` | unchanged | |
| write | `write_body(path, version, body)` | `POST /v1/object/body` | `save_body` with the version (409) |
| write | `remove_tags(path, version, tags)`, `remove_from_collection(path, version, collections)` | `POST /v1/object/properties` with new `subtract: {key: [values]}` | only those lines |
| write | `open_daily_note(date)` | `POST /v1/daily-notes` | `create_daily_note` (opens an existing one) |
| write | `duplicate(path)` | `POST /v1/object/duplicate` | |
| write | `change_type(path, version, type, mapping=None)` | `POST /v1/object/change-type` | the suggested mapping when none |
| write | `merge(source, target, source_version, target_version)` | `POST /v1/object/merge` (`confirm: true`) | both sides visible; source to the Trash |
| write | `link_mention(path, version, target, start, end, text)` | `POST /v1/references/link` | 409/422 as the app route |
| write | `create_tag(name)` | `POST /v1/tags/ensure` | |
| write | `create_type(name, plural_name, icon=None, color=None)`, `edit_type(type_id, revision, type, confirm=False)`, `change_property_kind(type_id, property_id, to_kind, revision)`, `delete_type(type_id, confirm=False)` | `POST/PUT/DELETE /v1/types...` | revision (409), 428 `affected` (visible only + `hiddenCount`), to the Trash |
| write | `create_collection(name, type_ids=None)`, `edit_collection(collection_id, revision, collection)`, `delete_collection(collection_id, confirm=False)` | `/v1/collections...` | as above |
| write | `create_query(name, definition)`, `edit_query(query_id, revision, query)`, `delete_query(query_id)` | `/v1/queries...` | revision; to the Trash |
| write | `create_whiteboard(title)`, `edit_whiteboard(path, revision, board)` | `/v1/whiteboards`, `PUT /v1/whiteboard` | revision (409) |
| write | `create_automation(rule)`, `run_automation(rule_id, path)` | `/v1/automations...` | M14 validation (422) |
| write | `start_import(preview_id, target, mapping=None)` | `POST /v1/import/start` | M15's checks |
| write | `restore_from_trash(trash_id)` | `POST /v1/trash/{id}/restore` | 404 for a hidden entry |
| write | `restore_version(path, version_id, version)` | `POST /v1/history/restore` | version check |

Totals: 20 read tools and 35 write tools. Deletes to the Trash use `REPLACE` annotations.

**Left out on purpose** (never offered):

- permanent delete and emptying the trash
- every settings route (Hide AI features and the CLI path among them)
- tokens
- spaces (create, open, switch, delete)
- UI and view state
- attachment upload and open, reveal, export
- search reindex, reminders
- templates and apply-template (templates stay hidden)
- formula preview, number-existing, relation-pair and property sync
- AI and agent routes (M20's `delegate` covers agents)
- test hooks

M16's `toolSteps.ts` gets lines for the new tools (T10).

### Our choices (summary)

The full list is in "Our calls" at the end.

## Tasks

### Task 1: Contract and CLI spike (first, alone)

**Status (2026-11-06).** Built and committed (`a4f42e9`, `59b9df4`); its spike stopped and asked, and Gene adopted `claudeMdExcludes` (his decision, 2026-11-06: every run's `--settings` file excludes `~/.claude/CLAUDE.md` and every ancestor folder's `CLAUDE.md`, `.claude/CLAUDE.md` and `CLAUDE.local.md`, so only the agent's own `CLAUDE.md` loads). The **follow-up** below is done: the live re-run passed all four live tests with the excludes (`m17-cli-spike.md`, "Gene's decision (2026-11-06)"), and `test_m17_live_cli.py::test_claude_md_excludes_list` (not live) pins the list. T2-T10 may start. The Files and Steps after it record what was built.

**T1 follow-up (run first and alone, before T2-T10).**

- Files: `backend/tests/test_m17_live_cli.py` and `docs/superpowers/plans/m17-cli-spike.md` only.
- In `test_m17_live_cli.py`: import `RUN_SETTINGS_BASE`, `claude_md_excludes` and `RUN_ENV_DROP` from `objectapp.agentrun` beside the other T4 names, with local stand-ins (the Contract's definitions) while T4 isn't there; `run_live` writes `{**RUN_SETTINGS_BASE, "claudeMdExcludes": claude_md_excludes(folder, Path.home()), "permissions": {"deny": ...}}` and drops `RUN_ENV_DROP` (plus `BAGGAGE`, locally) from the environment. The four tests' assertions are unchanged.
- Run `OBJECT_LIVE_CLAUDE=1 uv run pytest backend/tests/test_m17_live_cli.py -q -s` (haiku, `--no-session-persistence`). `test_user_setup_never_reaches_a_run` must now pass. If any check still fails for a reason other than the model skipping a tool it was asked to call, stop and report: no later task runs.
- `m17-cli-spike.md` gains a "Gene's decision (2026-11-06)" section: `claudeMdExcludes` adopted, the excludes' form, and the re-run's results.
- `uv run pytest backend/tests/test_m17_contract.py -q` still passes. Commit `test(m17): the live spike keeps user CLAUDE.md files out with claudeMdExcludes`.

**Files (as built):**

- Create:
  - `backend/objectapp/agentmodel.py`, `backend/objectapp/toolcatalog.py`
  - stub routers with no routes: `backend/objectapp/api_agents.py` and `backend/objectapp/api_agent_v1.py` (each `def router(ctx) -> APIRouter`), `backend/objectapp/api_v1_tools.py` (`def router(ctx, engine, imports) -> APIRouter`, see the expanded `objectapp-mcp` section)
  - `frontend/src/agents/useAgents.ts`
  - `backend/tests/test_m17_contract.py`, `backend/tests/test_m17_live_cli.py`
  - `docs/superpowers/plans/m17-cli-spike.md`
- Modify:
  - `backend/objectapp/server.py`: mount the three stubs (keep the `api_import.router(ctx)` it mounts in a variable and pass it and the automation engine to `api_v1_tools.router`); add `agents` and `agentChats` to `RESYNC_EVENTS`.
  - `backend/objectapp/watcher.py`: `"agents"` and `"agentChats"` in `ChangeEvent.kind`.
  - `backend/objectapp/tokens.py`: the `agent`/`chat` fields and `ephemeral(...)` parameters.
  - `backend/tests/fake_claude.py`
  - `frontend/src/api/types.ts`, `frontend/src/api/client.ts` (methods and `RESYNC_EVENTS`), `frontend/src/test/mockApi.ts`
  - `frontend/src/nav/tabs.ts`: the `agent` target, the `sameTarget` case, the `aiChat` fields (`sameTarget` for `aiChat` compares `path`, `agentId` and `chatId`).
  - `frontend/src/nav/sidepanel.ts`: `isAiChatTarget`'s guard type becomes `Extract<SidepanelTarget, { kind: 'aiChat' }>`, so `agentId`/`chatId` survive the narrowing.
  - `frontend/src/shell/TabStrip.tsx`: only a placeholder `case 'agent': return 'Agent'` in `useTargetTitle`'s switch. That callback returns `string`, so a new `Target` kind without a case fails `tsc`. T9 replaces it with the agent's name.

**Interfaces.** Produces everything in the Contract marked T1, plus the fake's new behaviour, which T4, T7 and T11 consume.

**Fake `claude`.** These are added to `fake_claude.py` and documented in its docstring; M10's and M16's markers are unchanged.

- The log line gains:
  - `appendPrompt`: the text of `--append-system-prompt-file`
  - `runSettings`: the JSON of `--settings`
  - `settingSources`
  - `tools`: the value of `--tools`
  - `allowed` / `disallowed`: the lists split on commas
  - `env`: whether `CLAUDE_CONFIG_DIR` is set
- The `init` event's `tools` lists the built-in names `Bash`, `PowerShell`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `NotebookEdit`, `WebFetch`, `WebSearch`, `Task`, `TodoWrite` and `Skill`, minus the disallowed ones, plus each allowed `mcp__…` name.
- Markers that simulate a built-in call: `FAKE:read:<abs path>`, `FAKE:grep:<abs folder>`, `FAKE:glob:<abs folder>`, `FAKE:write:<abs path>`, `FAKE:bash`.
  - Each emits a `tool_use` and its `tool_result`.
  - The fake decides with its **own** matcher, written from the CLI's documented rule form: `Tool(//abs/path/**)`, gitignore-style `**` and `*`, deny before allow, a bare tool name in the disallowed list denies the tool. It checks the run's `--settings` `permissions.deny`, `--disallowedTools` and the cwd's `.claude/settings.json` deny list. It does not import `agentrun`.
  - Denied: `is_error: true`, content "Permission to use Read has been denied." (the tool's name).
  - Allowed: the file's first 200 characters, the matching file names, or "wrote".
  - `FAKE:write` never actually writes.

**Steps.**

- [ ] **Step 1: failing tests** in `test_m17_contract.py`:
  - `test_agent_file_model`:
    - a name of 61 characters raises `AgentInvalid`; `"  A   b "` becomes `"A b"`;
    - an unknown key `{"x": 1}` survives `AgentFile.model_validate(...).model_dump()`;
    - `model="-p"` is refused with `"That isn't a model name."`;
    - `AGENT_ID` matches `"assistant"` and a ULID, not `"../x"`.
  - `test_catalogue_groups`:
    - group ids are `["object-read","object-write","object-agent","builtin"]` with the four labels;
    - `len(OBJECT_READ) == 20`, `len(OBJECT_WRITE) == 35`;
    - M11's 18 names are included; no name contains `delete_forever`, `purge`, `empty_trash` or `settings`;
    - `default_off() == ["Bash"]`; the Bash row's `warning == SHELL_WARNING` (the spec sentence verbatim).
  - `test_run_tool_lists`:
    - `off={"Bash"}, write=True` gives `"Bash"` and `"PowerShell"` in `disallowed`, `"mcp__object__write_body"` and `"Skill"` in `allowed`;
    - `write=False` puts every `mcp__object__<write>` in `disallowed` and none in `allowed`;
    - `off={"mcp__object__move_to_trash"}` puts it in `disallowed` only.
  - `test_ephemeral_agent_token`: `ephemeral("Researcher","read-write",agent="01J…",chat="01K…")` gives a record whose `agent`/`chat` are set; `verify` returns it; `list()` doesn't show it; no file is written in the state dir.
  - `test_stub_routers_mounted`: `create_app` imports the three modules; `server.RESYNC_EVENTS` holds `agents` and `agentChats`.
  - `test_fake_matches_documented_rules`: run the fake directly with `--settings` deny `["Read(//<tmp rp>/space/**)"]` and `FAKE:read:<tmp>/space/a.md`. The `tool_result` is the denial. `FAKE:read:<tmp>/other/b.md` returns its text.
  - Front end: `npx tsc -b --noEmit`; `useAgents.test.ts` "test reloads on an agents event".
- [ ] **Step 2:** run them; they fail.
- [ ] **Step 3:** implement the Contract signatures and the fake.
- [ ] **Step 4: the CLI spike.** `test_m17_live_cli.py` is skipped unless `OBJECT_LIVE_CLAUDE=1`.
  - Setup: each test builds a temp agent folder under a temp `OBJECT_STATE_DIR` with `agentfiles.write_skeleton` (T1 writes a minimal local helper when T2's module isn't there yet). It runs the real `claude` with M17's `CLI_FLAGS`, `--model haiku`, `--no-session-persistence` and `--debug-file <tmp>/debug.log`, and reads the stream.
  - `test_user_setup_never_reaches_a_run`:
    - from the `init` event: `plugins` is empty; no `slash_commands`/`skills` entry is a name found in `~/.claude/skills/` (directory names, listed read-only) or holds `:` (a plugin command); `mcp_servers` names ⊆ `{"object","object-agent"}`;
    - from the debug log: no line names `~/.claude/CLAUDE.md`, `~/.claude/settings.json`, an ancestor folder's `CLAUDE.md`, a user hook, or a `memory` folder under `~/.claude/projects` as loaded;
    - the folder's own `CLAUDE.md` is listed as loaded.
  - `test_folder_hook_runs`: a `SessionStart` hook in the folder's `.claude/settings.json` writes `<tmp>/hook-ran` (a path in the test's temp folder); the file exists afterwards.
  - `test_fence_is_enforced`:
    - a temp "space" folder holding `secret.md` is fenced by `fence_rules`;
    - the prompt asks the model to Read the file, then Grep and Glob the folder;
    - every matching `tool_result` is an error naming permission, and `secret.md`'s marker text appears in no event;
    - a Read of an unfenced temp file succeeds without `--add-dir`;
    - a folder with a space and a comma in its name is denied too.
  - `test_builtin_names`: every `BUILTINS` row has at least one `cli` name in the `init` `tools`. The test prints the full list.
  - If a check fails, the builder may fix it only with a project or run setting, recorded in the spike notes: for example `"autoMemoryEnabled": false` in `run-settings.json`, a `claudeMdExcludes` entry, an added `Write(...)` rule form in `fence_rules`, a changed `cli` tuple, or extra `ALWAYS_ALLOWED` names.
  - **Stop-and-ask (spec section 3):** if any of user `CLAUDE.md`, hooks, plugins, user skills, auto-memory or user permission rules still reaches the run, or the fence can't be enforced for Read, Grep and Glob, the build stops after T1. The builder writes what it found in `m17-cli-spike.md` and asks Gene. No later task runs.
  - `m17-cli-spike.md` records the CLI version, each check's result, the final built-in names, and the sandbox finding (none on native Windows, so the shell stays off by default).
- [ ] **Step 5:** `uv run pytest backend/tests/test_m17_contract.py -q`, `npx vitest run src/agents`, `npx tsc -b --noEmit` pass; the live spike passed once with `OBJECT_LIVE_CLAUDE=1`.
- [ ] **Step 6:** commit `feat(m17): contract, tool catalogue and CLI spike`. The message ends with the trailer.

### Task 2: Agent folders and the registry (Lane A)

**Files:**

- Create: `backend/objectapp/agents.py`, `backend/objectapp/agentfiles.py`, `backend/tests/test_m17_agents.py`

**Interfaces.**

- Consumes: `agentmodel`, `toolcatalog.catalogue`, `spaces.Registry`, `space.safe_filename`, `textfile.atomic_write`/`create_new`/`encode_like`, `jsonstore.dump_json`, `ids.new_ulid`.
- Produces: `AgentRegistry`, `AgentRecord`, `effective_model`, and the `agentfiles` functions (Contract).

**Steps.**

- [ ] **Step 1: failing tests** (state dir = `tmp_path/state`, a fake space registered with `spaces.Registry(state).register(space)`):
  - `test_list_never_writes`: on an empty state dir `list()` gives one record (`id == "assistant"`, `name == "Assistant"`, `exists is False`, `default is True`). The state dir still holds no file.
  - `test_ensure_default_makes_the_skeleton`:
    - `<state>/agents/Assistant/` holds `CLAUDE.md` (`DEFAULT_SOUL`), `.claude/settings.json` (whose `permissions.deny` ⊇ `["Bash","PowerShell"]`, plus the three `PROTECTED` rules in the run's form), `.object-agent/agent.json` (`toolsOff == ["Bash"]`, `model is None`), `.object-agent/sessions/`, and `.gitignore == "settings.local.json\ncache/\n"`;
    - `agents.json` is unchanged (the default agent is implicit);
    - a second call writes nothing (mtimes kept).
  - `test_create_in_state_dir_and_name_clash`: two agents named "Researcher" get `Researcher/` and `Researcher (2)/`; each id is a ULID; `agents.json` lists both in order.
  - `test_create_at_location`: `location=tmp/elsewhere` gives `tmp/elsewhere/Researcher/`, `in_state_dir is False`; a second create there raises `AgentConflict` (409); a location that isn't a folder raises `AgentNotFound`.
  - `test_agent_folder_inside_a_space_is_refused`: `location=<space>/sub` raises `AgentInvalid` with the routes-table message. So does a location whose new folder would hold a registered space, and so does `add_folder` of such a folder.
  - `test_duplicate`: copies `CLAUDE.md`, `.claude/settings.json`, `.claude/settings.local.json` and `.mcp.json`; `.claude/skills/x/SKILL.md` only with `skills=True`; `.object-agent/memory/MEMORY.md` only with `memory=True`; never `sessions/`, `ledger.jsonl`, `usage.json` or `cache/`; a new id and name.
  - `test_add_folder`: a copied folder with a new id registers (no file in it changes, bytes compared); its id already listed raises `AgentConflict` "An agent with this id is already listed."; no `.object-agent/agent.json` raises `AgentInvalid` "This folder isn't an Object agent.".
  - `test_save_keeps_unknown_keys_and_checks_revision`: `agent.json` with `{"extra": [1]}` keeps it after `save`; a stale revision raises `AgentConflict` with `current_revision`; `toolsOff` from `["Bash"]` to `["mcp__object__move_to_trash"]` rewrites `.claude/settings.json` deny to drop `Bash`/`PowerShell`, add `mcp__object__move_to_trash`, keep a user-written `"Read(./private/**)"` and keep a `hooks` key.
  - `test_default_agent_rules`: `delete("assistant")` and `unregister("assistant")` raise `AgentInvalid` "The default agent can't be deleted."; `effective_model(default, {"aiModel": "sonnet"}) == "sonnet"`; for another agent its `model`.
  - `test_delete_moves_to_agent_trash_and_restores`: the folder moves to `<state>/agents/.trash/<trashId>/` with its meta file; `trash()` lists it; `restore` puts it back at `originalPath` and lists it again with the same id.
  - `test_delete_outside_state_dir_only_unregisters`: `delete` returns None; the folder's every file is byte-identical; it is gone from `list()`.
  - `test_restore_collisions`: a taken `originalPath` restores to `"<name> (2)"`; an id listed again raises `AgentConflict`.
  - `test_instructions_keep_bom_and_crlf`: a `CLAUDE.md` with BOM and CRLF, saved with LF text `"a\nb"`, is `b"\xef\xbb\xbfa\r\nb"`; a stale revision is a 409; `read_instructions` on a missing file gives `("", None)` and writes nothing.
  - `test_unreadable_registry_is_kept_aside`: `agents.json` = `"{nope"`. `list()` shows only the default agent; the next `create` copies the bad file to `agents.unreadable-*.json` first.
  - `test_unreadable_agent_file_is_read_only`: bad JSON lists with `read_only_reason == "This agent's settings can't be read."`; `save` raises `AgentReadOnly`; a missing folder lists `missing=True`.
  - `test_folder_mcp_servers_and_var_refs`: `.mcp.json` with `{"mcpServers":{"gh":{"command":"x","env":{"T":"${GH_TOKEN}"}}}}` gives `var_refs == {"GH_TOKEN"}`; an absent or unreadable file gives `{}`.
- [ ] **Step 2:** run; fail.
- [ ] **Step 3:** implement with the Contract signatures. The registry lock is module-level, as `spaces._lock` is. Folder moves use `textfile.move_no_overwrite` for files and `os.replace` for the folder, on the same volume. A move to another volume falls back to `shutil.move` and is checked afterwards.
- [ ] **Step 4:** `uv run pytest backend/tests/test_m17_agents.py -q` passes.
- [ ] **Step 5:** commit `feat(m17): agent folders, registry and agent trash`.

### Task 3: Transcripts (Lane A, after T2)

**Files:**

- Create: `backend/objectapp/transcripts.py`, `backend/tests/test_m17_transcripts.py`

**Interfaces.**

- Consumes: `ids.new_ulid`, `aichat.default_title` (read only).
- Produces: the transcript functions (Contract).

**Steps.**

- [ ] **Step 1: failing tests:**
  - `test_start_writes_the_header_once`: two `start` calls leave one header line equal to the Contract's (with `"v": 1`, `"delegated": false`).
  - `test_append_and_read`: a user line, two tool lines and an assistant line read back as `items` in order; `messageCount == 2`; `sessionId` is the assistant line's; `objectPath` is the last `object` line's.
  - `test_torn_last_line_is_skipped`: a file ending in `{"type":"assist` reads without it.
  - `test_bad_chat_id`: `path_for(folder, "../x")` raises `ValueError`; `read` of an unknown ULID raises `FileNotFoundError`.
  - `test_list_newest_first`: three chats, the one appended last comes first; `spaceName` comes from the header.
  - `test_find_by_session`: gives the chat whose assistant line has the session, else None.
  - `test_concurrent_appends`: 20 threads appending one line each give 21 parsable lines.
  - `test_non_ascii_and_crlf_text`: text with `"é\r\n"` round-trips exactly.
- [ ] **Step 2-4:** fail, implement, pass (`uv run pytest backend/tests/test_m17_transcripts.py -q`).
- [ ] **Step 5:** commit `feat(m17): per-agent chat transcripts`.

### Task 4: The turn runner (Lane B)

**Files:**

- Create: `backend/objectapp/agentrun.py`, `backend/tests/test_m17_agentrun.py`
- Modify: `backend/objectapp/ai.py`
  - `Turn.run`; `_Attempt` runs a `RunCommand` when `turn.run` is set and keeps M10's old path while it is None (T7 removes that path);
  - `Turn.timeout: float = field(default_factory=lambda: TURN_TIMEOUT)`, used by `run_turn`'s deadline and its "took too long" message;
  - `build_prompt(..., intro: bool = True)`: with `intro=False` the stdin prompt leaves out `_INTRO`, since it is in the guidance now (T7 passes `intro=False`);
  - `_short_tool` also strips `mcp__object-agent__`.

**Interfaces.**

- Consumes: `toolcatalog.run_tool_lists`, `agentfiles.folder_mcp_servers`/`var_refs`, `AgentRecord` (T2; a test double is fine until T2 lands), `spaces.Registry`, `appstate`.
- Produces: `RunScope`, `RunParts`, `add_contributor`, `contributors`, `fence_folders`, `rule_path`, `fence_rules`, `nesting_problem`, `build_run`, `RunCommand`, `RunRefused`, `SECRET_LOOKUP`, `OBJECT_GUIDANCE`, `PROPOSAL_GUIDANCE`, `CLI_FLAGS`, and (spike) `RUN_SETTINGS_BASE`, `claude_md_excludes`, `RUN_ENV_DROP` (the T1 follow-up's live test imports them once they exist).

**Steps.**

- [ ] **Step 1: failing tests:**
  - `test_run_loads_only_project_and_local_settings`: `build_run(...).args` contains `["--setting-sources","project,local"]`; no element equals or contains `user`; `env` has no `CLAUDE_CONFIG_DIR` even when the test environment sets one; `cwd == agent.folder.resolve()`.
  - `test_run_settings_keep_user_instructions_out` (spike): `run_settings["autoMemoryEnabled"] is False`; `claudeMdExcludes` holds `<home>/.claude/CLAUDE.md` and, for each ancestor of the agent folder up to the root, its `CLAUDE.md`, `.claude/CLAUDE.md` and `CLAUDE.local.md`, and not the agent's own `CLAUDE.md`; a contributor whose `parts.settings` has its own `permissions.deny` or `claudeMdExcludes` extends them and never drops the fence or the excludes.
  - `test_run_env_drops_parent_session_vars` (spike): with `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_AGENT_SDK_VERSION` and `AI_AGENT` set in the test environment, none is in `env`; `PATH` and `OBJECT_API_URL` are.
  - `test_cli_flags`: every `CLI_FLAGS` element appears in order; `--permission-mode dontAsk` and `--permission-prompts none`; `--strict-mcp-config`; `--tools default`; `--model` and `--resume` only when given.
  - `test_mcp_config`:
    - `object` server args `["-m","objectapp.mcp_server"]` (with `"--read-only"` when `write=False`);
    - `object-agent` args `["-m","objectapp.agent_mcp"]`;
    - both `env.OBJECT_API_TOKEN == "${OBJECT_API_TOKEN}"`;
    - the secret appears in `env` and in no file under `tmp`.
  - `test_folder_servers`: from `.mcp.json`, a server with no `${VAR}` is included; one needing `${GH_TOKEN}` is left out with a note; with `SECRET_LOOKUP` patched to answer, it is included and the value is in `env`, not in `mcp.json`; a server named `object` or `my server` is left out with a note.
  - `test_guidance_appended`: `append` holds `OBJECT_GUIDANCE` with the space name; proposal scopes hold `PROPOSAL_GUIDANCE`; `--append-system-prompt-file` names `tmp/append.md`, whose text equals `append`.
  - `test_contributor_order`: an `add_contributor("memory-snapshot", 10, fn)` that appends `"MEM"` puts `"MEM"` before the guidance; one at 35 that adds a server `gw` puts it in `mcp.json` and keeps `object`; a second add of the same name replaces the first.
  - `test_rule_path_forms`: `rule_path(Path("C:/Users/Gene/My Notes"))` gives `"//c/Users/Gene/My Notes"` (Windows only, `skipif`); a POSIX path `/home/x` gives `"//home/x"`.
  - `test_fence_rules_cover_awkward_paths`:
    - folders named `My Notes`, `a,b`, `Ünïcode`, a mixed-case path given in lower case, a trailing-slash path, and a junction or symlink to a space (resolved to its target, `skipif` without permission) each give `Read(<rp>/**)` and `Edit(<rp>/**)`;
    - the rules sit in `run_settings["permissions"]["deny"]`, not in `--disallowedTools`;
    - the agent's own `PROTECTED` rules, the state-dir rules and the `~/.claude` rules of the Contract are present.
  - `test_fence_folders`: every registered space (the open one included, even when unregistered), every other local agent folder and `<state>/agents/.trash` are present; the agent's own folder is absent; duplicates that differ only in case appear once on Windows.
  - `test_nested_agent_and_space_refuse_to_run`: an agent folder inside a registered space, or one holding a space, makes `build_run` raise `RunRefused` with the routes-table message.
  - `test_tool_switches_reach_the_args`:
    - toolsOff `["Bash"]` gives `Bash` and `PowerShell` in `--disallowedTools`;
    - toolsOff `[]` gives `Bash` and `PowerShell` in `--allowedTools`;
    - toolsOff with all `object-write` ids leaves no `mcp__object__<write>` in `--allowedTools`.
  - `test_turn_timeout_is_per_turn` (with the fake): a `Turn(timeout=1.0)` whose prompt holds `FAKE:wait` ends with the "took too long (over 1 seconds)" error after about 1 s; a `Turn` without `timeout` has `timeout == TURN_TIMEOUT == 300`.
  - `test_prompt_without_intro`: `build_prompt(..., intro=False)` leaves out `_INTRO`; the default keeps it.
  - `test_agent_tools_short_names`: a `StreamParser` call named `mcp__object-agent__agent_info` streams `name == "agent_info"`.
  - `test_attempt_uses_the_run_command` (with the fake): a `Turn` with `run=` set runs in the agent folder (the fake log's `cwd`); the tmp folder is gone afterwards; the M16 `tool` events still pair by id.
- [ ] **Step 2-4:** fail, implement, pass (`uv run pytest backend/tests/test_m17_agentrun.py backend/tests/test_m10_ai.py backend/tests/test_m16_tool_events.py -q`; M10's tests still pass on the old path).
- [ ] **Step 5:** commit `feat(m17): turn runner in the agent folder with fence and contributors`.

### Task 5: Expanded `objectapp-mcp` (Lane C)

**Files:**

- Create: `backend/objectapp/v1guard.py`, `backend/tests/test_m17_mcp_tools.py`
- Fill: `backend/objectapp/api_v1_tools.py`
- Modify:
  - `backend/objectapp/api_v1.py`: use `v1guard`; `PropertiesRequest.subtract`; docstring route list.
  - `backend/objectapp/mcp_server.py`: the new tools, the `INSTRUCTIONS` text naming them, `ObjectClient.put`/`delete`, and `currentRevision` in `ApiError`'s 409 text.
  - `backend/tests/test_m11_mcp.py`: only `test_tool_sets`, which compares the tool lists to M11's 9 + 9 names exactly; it now compares them to `set(toolcatalog.OBJECT_READ)` and `set(OBJECT_READ + OBJECT_WRITE)` (its annotation checks stay).
  - `scripts/m11_acceptance.py`: only the "read token lists only the read tools" check (`names == READ_TOOLS`), which now compares to `set(toolcatalog.OBJECT_READ)`.

**Interfaces.**

- Consumes: the `Space` methods behind each app route; the history store `api_history` builds; `automations`; `api_import`'s job runner; `spaces.Registry` (the import refusal).
- Produces:
  - the routes and tools in the Contract table;
  - `v1guard.WRITE_GUARDS: list[Callable[[TokenRecord, Request], str | None]] = []`: `auth(request, write=True)` answers 403 with the first message a guard returns (M24 appends its read-only guard);
  - `v1guard.V1Guard(ctx, tokens)` with `auth(request, write=False) -> TokenRecord`, `visible_rel(path) -> str` (KeyError: 404), `hidden_paths() -> set[str]`, `visible_only(paths) -> tuple[list[str], int]` (the list and `hiddenCount`), `trash_entry_hidden(item) -> bool`, `announce(kind, path, version, token, **extra)`, `log(token, action, path, **extra)`;
  - `v1guard.agent_auth(guard, registry, request) -> tuple[TokenRecord, AgentRecord]` (403 "This token isn't an agent's.").

**Steps.**

- [ ] **Step 1: failing tests.** The fixture is a synthetic space with `Pages/Open.md`, `Pages/Secret.md` (tagged Exclude from AI, body holds `SECRET-MARKER`), a Task template, a whiteboard, a collection, a saved query and a second type. It uses the app's `TestClient` as `ObjectClient.http`, with a read-write token and a read token.
  - `test_tool_lists`: `build_server(client, write=True)` lists exactly `OBJECT_READ + OBJECT_WRITE`; `write=False` lists `OBJECT_READ` only.
  - `test_write_guards`: `WRITE_GUARDS == []` by default; with a guard appended that answers "No." for one token, that token's write is 403 "No.", its reads pass, and another token's write passes.
  - `test_write_body_version_checked`: `write_body` with the version from `read` replaces the body (only body bytes change; a CRLF/BOM fixture keeps both); a stale version raises `ApiError` starting `"Conflict:"`; one history version is kept.
  - `test_open_daily_note`: the first call creates the note (`created: true`); the second gives the same path with `created: false`.
  - `test_types_collections_queries_round_trip`:
    - `create_type`, `type_definition`, `edit_type` (a property renamed), `change_property_kind`;
    - `delete_type` without confirm on a type with objects answers 428 with `affected` and `hiddenCount`, and with confirm the objects go to the Trash;
    - the same create/edit/delete round trip for queries and collections (deletes to the Trash).
  - `test_remove_tags_and_collections`: only the `tags:` and `collections:` lines change.
  - `test_merge_link_duplicate_change_type`: each answers as its app route; `merge` puts the source in the Trash.
  - `test_whiteboard`: `read_whiteboard` gives a revision; `edit_whiteboard` with a stale revision is a 409.
  - `test_automations_and_import`: `create_automation` (M14 rule JSON) gives 201; `run_automation` on a button rule gives a run; `import_preview` of a synthetic Obsidian folder in `tmp_path` writes nothing; `start_import` into a new space starts a job that `import_status` reports.
  - `test_import_from_a_space_folder_is_refused`: `import_preview(<space root>)` and `import_preview(<space root>/Pages)` give 422 "Importing from a space folder isn't available to agents."
  - `test_trash_and_versions`: `restore_from_trash` and `restore_version` restore.
  - `test_no_tool_reveals_an_excluded_page`, parametrised over every new tool with Secret or the template as argument or in the data:
    - 404 or the item left out: `trash()`, `unlinked_mentions(Open)` when Secret mentions Open, `delete_type` `affected`, `delete_collection` `removedFrom`, `merge` with Secret on either side, `version_history(Secret)`, `read_version(Secret, …)`, an excluded board's `read_whiteboard`, `restore_from_trash` of Secret's entry;
    - `SECRET-MARKER` appears in no answer;
    - Secret's file bytes are unchanged.
  - `test_read_token_cannot_write`: every write route answers 403 to the read token.
  - `test_never_offered`: no tool permanently deletes, empties the trash or touches `/settings`, `/spaces` or `/integrations`. A static check of `api_v1_tools.py` finds no `purge` and no `settings`.
- [ ] **Step 2-4:** fail, implement, pass (`uv run pytest backend/tests/test_m17_mcp_tools.py backend/tests/test_m11_*.py -q`; M11's tests unchanged except `test_tool_sets`' expected sets; `uv run python scripts/m11_acceptance.py backend/tests/fixtures/space-sample` PASS).
- [ ] **Step 5:** commit `feat(m17): objectapp-mcp covers the app's routes with their safety`.

### Task 6: The agent tools MCP server (Lane C, after T5 and T2)

**Files:**

- Create: `backend/objectapp/agent_mcp.py`, `backend/objectapp/agent_tools_core.py`, `backend/tests/test_m17_agent_mcp.py`
- Fill: `backend/objectapp/api_agent_v1.py`

**Interfaces.**

- Consumes: `mcp_server.ObjectClient`/`ApiError`/`_check_url`, `v1guard.agent_auth`, `AgentRegistry.get`.
- Produces: `agent_mcp.TOOL_MODULES`, `build_server(client)`, `main(argv=None)`, `agent_tools_core.register(server, client)`, `GET /api/v1/agent/info`.

**Steps.**

- [ ] **Step 1: failing tests:**
  - `test_agent_info`: an ephemeral token with `agent="assistant"` gives `{agent: {id: "assistant", name: "Assistant", model: None, folder: <path>}, space: {name: <space name>}}`.
  - `test_token_without_agent_is_403`: a stored read-write token gets 403 "This token isn't an agent's."
  - `test_token_for_another_space_is_401`.
  - `test_tool_modules_extend`: a patched `TOOL_MODULES` with a test module adding `ping` lists `agent_info` and `ping`.
  - `test_main_refuses_non_loopback`: `OBJECT_API_URL=http://example.org` raises SystemExit.
- [ ] **Step 2-4:** fail, implement, pass.
- [ ] **Step 5:** commit `feat(m17): Object agent tools MCP server, scoped to one agent and one space`.

### Task 7: Agent routes and the chat route's agents (Lane B, after T2, T3, T4)

**Files:**

- Fill: `backend/objectapp/api_agents.py`
- Modify:
  - `backend/objectapp/api_ai.py`: `agentId`, `chatId`, the `chat` event, the run (`ai.build_prompt(..., intro=False)`), transcripts, Agent property on save and load. The turn token replaces M10's `tokens.ephemeral(ai.TOKEN_NAME, "read")`.
  - `backend/objectapp/aichat.py`: `AGENT_KEY = "agent"`, `agent_key(t)`, `ensure_chat_type` adds the text property "Agent" (description "The agent this chat was with", our string).
  - `backend/objectapp/ai.py`: remove M10's empty-folder path, `cli_args`, `mcp_config`, `ALLOWED_TOOLS`/`DISALLOWED_TOOLS`; `Turn.run` becomes required.
  - `backend/tests/test_m10_ai.py`: the tests pinned to M10's flags, working folder, token or "no event" facts are rewritten to M17's facts; every other M10 test keeps its assertions:
    - `test_cli_flags_config_and_cwd` (M10's flags, the read-only server, the empty working folder) and `test_no_model_or_resume_flags_by_default`;
    - `test_turn_token_works_during_the_turn_only`: a `chat` turn's token is now named "Assistant" with scope `read-write`, so its 403-on-write check runs on a `tagObject` turn (a `read` token, still named "Assistant"); the token still stops working after the turn and is in no file;
    - `test_a_turn_writes_no_file`: the space is still unchanged; `published` now holds only `agentChats` events (the transcripts), no space event.
- Create: `backend/tests/test_m17_routes.py`, `backend/tests/test_m17_chat.py`

**Interfaces.**

- Consumes: T2, T3, T4, `aimodels.resolve_model`/`clean_model`, `settings.read`/`patch`, `TokenStore.ephemeral`.
- Produces: the routes table, the `/api/ai/chat` mapping, the `agents`/`agentChats` events.

**Steps.**

- [ ] **Step 1: failing tests.**
  - `test_m17_routes.py` covers every row of the routes table with its codes, in particular:
    - `test_get_agents_writes_nothing`: the state dir is unchanged.
    - `test_create_announces_and_lists`: 201; `agents` event with `origin` = clientId; the default agent comes first.
    - `test_put_default_model_writes_ai_model`: `model: "sonnet"` sets the device setting `aiModel`; `agent.json` `model` stays null.
    - `test_delete_and_restore_routes`: `trashId` in the state dir, `null` outside it; the default agent 422; restore 200, then 409 when the id is listed again.
    - `test_tools_routes`: `GET /agent-tools` shows the Bash row `on: false` with `SHELL_WARNING`; `GET /agents/{id}/tools` reflects `toolsOff` and adds `mcp:gh` for a folder server.
    - `test_instructions_routes`: 409 on a stale revision; BOM and CRLF kept.
    - `test_chats_routes`: after a turn the chat is listed and readable; `…/chats/nope` 404.
  - `test_m17_chat.py` (fake `claude`):
    - `test_chat_defaults_to_the_assistant`: the first event is `{"type":"chat","agentId":"assistant","chatId":<ULID>}`; the default folder now exists and is the fake's `cwd`.
    - `test_chat_with_a_custom_agent`: `cwd` is Researcher's folder; the token's `agent` is its id; `--model` is its model unless the request picks one.
    - `test_direct_action`: `allowed` holds `mcp__object__write_body`; no `--read-only`; the token is `read-write`.
    - `test_proposal_modes_run_read_only`: for `askBlock`, `tagBlock`, `tagObject`, `autofill`, `rephrase`: `--read-only` is present, no write tool is in `allowed`, the token is `read`; the proposal still arrives in `done`.
    - `test_transcript_written`: the header, the user line with `contextPaths`, an assistant line with `sessionId` and `model`; with `FAKE:tool`, a tool line with `result`; an `agentChats` event.
    - `test_stopped_turn_is_marked`: closing the stream during `FAKE:wait` appends an assistant line with `stopped: true`.
    - `test_unknown_or_missing_agent`: one `error` event with the Contract message and no run.
    - `test_run_refused_for_nested_folder`: one `error` event (the nesting message) and no run.
    - `test_shell_switch`: `toolsOff=[]` puts `Bash` in `allowed`; the default puts it in `disallowed`.
    - `test_m10_saved_chat_continues_with_default_agent`: an M10 chat file loads with `agentId == "assistant"`, `agent is None`, `chatId is None`; the next turn makes a new transcript.
    - `test_agent_property_added_without_rewriting_chats`:
      - the first save adds "Agent" to the `ai-chat` type JSON;
      - other chat files stay byte-identical;
      - the saved chat's `agent:` is the agent's name, and the transcript gains an `object` line;
      - a reload gives the `chatId` back.
    - `test_hidden_ai_still_403`: "Hide AI features" gives 403 on `/ai/chat`; `GET /agents` still answers.
    - `test_a_turn_writes_no_space_file`: M10's check holds.
- [ ] **Step 2-4:** fail, implement, pass (`uv run pytest backend/tests/test_m17_*.py backend/tests/test_m10_ai.py backend/tests/test_m16_*.py -q`).
- [ ] **Step 5:** commit `feat(m17): agent routes; the chat talks to agents`.

### Task 8: Agents section and New agent (Lane D)

**Files:**

- Create:
  - `frontend/src/agents/AgentsSection.tsx`, `frontend/src/agents/NewAgentDialog.tsx`, `frontend/src/agents/AddAgentFolderDialog.tsx`, `frontend/src/agents/AgentTrashDialog.tsx`
  - `frontend/src/agents/ToolSwitches.tsx` (shared by the New agent form and the Tools tab)
  - `frontend/src/agents/agentText.ts` (strings)
  - `*.test.tsx` beside each
- Modify: `frontend/src/shell/Sidebar.tsx`: mount `<AgentsSection>` directly above `<nav aria-label="Main">`; render nothing while `useAiHidden()`.

**Interfaces.**

- Consumes: `useAgents`, the `api` agent methods, `openAiChat` (`ai/store.ts`; its seed takes `agentId`, added in T10; until then the section opens `{kind:'aiChat', agentId}` in the side panel directly), `IconPicker`, `ModelPicker` (M16), `useTabs` (`{kind:'agent', id}`).
- Produces:
  - `AgentsSection(props: { onOpenTarget?: SidebarProps['onOpenTarget'] })`
  - `NewAgentDialog(props: { open: boolean; onOpenChange(o: boolean): void; duplicateOf?: Agent | null })`
  - `ToolSwitches(props: { groups: ToolGroup[]; off: string[]; onChange(off: string[]): void; disabled?: boolean })`
  - `AGENT_TEXT`

**Behaviour and strings** (ours unless quoted from the spec):

- **Section.** Heading "Agents", with a `+` menu: "New agent", "Add agent folder…", "Deleted agents…".
- **Rows.** Icon and name, the default agent first. A click opens that agent's chat in the side panel.
- **Row menu.** The `…` menu holds "Open chat", "Settings", "Duplicate" and "Delete". M18 inserts "Memory & skills" after Settings.
- **Delete.** No confirm (restorable). An agent outside the state dir shows the notice "Removed from the list. Its folder was left where it is."
- **New agent row.** "+ New agent" is the last row.
- **New agent dialog.**
  - Fields: Name, Icon, Description, Instructions, Model, Tools (`ToolSwitches` from `GET /agent-tools`), and Folder ("Inside Object's agents folder" by default, or "Choose a folder" with a typed path field, as Create space has).
  - A "Start from" choice: "Blank" or "Duplicate of…", which shows "Copy memory" and "Copy skills" checkboxes.
  - Buttons "Cancel" and "Create agent". A 422 or 409 shows its `detail`.
- **Shell switch.** Switching the shell on opens a confirm with `SHELL_WARNING` verbatim and the buttons "Turn on" and "Cancel". A group switch sets every row of the group.

**Steps.**

- [ ] **Step 1: failing tests:**
  - "test the section sits above the main navigation and lists the default agent first"
  - "test the section is hidden while AI features are hidden"
  - "test clicking an agent opens its chat" (side panel target `{kind:'aiChat', agentId}`)
  - "test the row menu items" (exactly the four)
  - "test New agent creates with defaults": `createAgent` called with `toolsOff: ['Bash']`, `location: null`
  - "test Duplicate sends duplicateOf with the memory and skills choices"
  - "test turning the shell on asks first and shows the warning"
  - "test a group switch turns every row off"
  - "test Delete of an outside agent shows the left-in-place notice"
  - "test Deleted agents restores"
  - "test Add agent folder shows the server's 422 message"
- [ ] **Step 2-4:** fail, implement, pass (`npx vitest run src/agents src/shell/Sidebar`).
- [ ] **Step 5:** commit `feat(m17): Agents section at the top of the sidebar, New agent`.

### Task 9: The agent page (Lane D, after T8)

**Files:**

- Create:
  - `frontend/src/agents/AgentPage.tsx`, `frontend/src/agents/agentTabs.ts`
  - `frontend/src/agents/ProfileTab.tsx`, `frontend/src/agents/InstructionsTab.tsx`, `frontend/src/agents/ToolsTab.tsx`, `frontend/src/agents/ChatsTab.tsx`
  - tests beside each
- Modify:
  - `frontend/src/App.tsx`: a `case 'agent'` rendering `<AgentPage key={target.id} id={target.id} tab={target.tab} />`.
  - `frontend/src/shell/TabStrip.tsx`: the title is the agent's name, or "Agent" (replacing T1's placeholder case).

**Interfaces.**

- Consumes: `api` agent methods, `useAgents`, `ToolSwitches`, `ModelPicker` (M16), `IconPicker`, `StringEditor` (`editor/StringEditor.tsx`, "Object's editor" for `CLAUDE.md`).
- Produces:
  - `AgentPage(props: { id: string; tab?: string })`
  - `AGENT_TABS: { id: string; label: string; order: number; component: ComponentType<{ agent: Agent }> }[]`, with Profile 10, Instructions 20, Tools 30 and Chats 70; M18 adds Memory 40, Skills 50 and Learning 60 (the spec's tab order)
  - `registerAgentTab(tab)` for M18

**Tabs.**

- **Profile.**
  - Fields: name, icon, description, and model (`ModelPicker`; for the default agent it shows and saves Settings' model through `PUT /agents/assistant`).
  - "Folder" shows the path with an "Open folder" button.
  - Folder MCP servers that are missing secrets show "Needs secrets: GH_TOKEN" (our string; the values come in M19).
  - "Remove from list" is shown for agents that aren't the default.
  - A read-only reason is shown and the fields are disabled.
  - Each field saves on change with the revision. On a 409 the tab reloads and tells the user to apply the change again.
- **Instructions.** `StringEditor` over `GET /agents/{id}/instructions`, autosaving 1,000 ms after the last change and on blur. A 409 shows "Changed elsewhere. Reload?"
- **Tools.** `ToolSwitches` over `GET /agents/{id}/tools`. It saves `toolsOff` through `PUT /agents/{id}`.
- **Chats.**
  - A filter field ("Filter chats") over the titles, then the rows: title, space name, date, message count.
  - A click opens `{kind:'aiChat', agentId, chatId}` in the side panel.
  - The list reloads on `agentChats` events for this agent.
  - Full-text search comes in M18.

**Steps.**

- [ ] **Step 1: failing tests:**
  - "test the four tabs in order and registerAgentTab inserts by order"
  - "test Profile saves the name with the revision and reloads on 409"
  - "test the default agent's model edits the Settings model"
  - "test Instructions autosaves and keeps the text on 409"
  - "test Tools saves toolsOff and the shell asks first"
  - "test Chats filters by title and opens a chat in the side panel"
  - "test Open folder calls revealAgentFolder"
  - "test a read-only agent disables every field"
  - App: "test an agent target renders the agent page with its name as tab title"
- [ ] **Step 2-4:** fail, implement, pass (`npx vitest run src/agents src/App`).
- [ ] **Step 5:** commit `feat(m17): agent page with Profile, Instructions, Tools and Chats`.

### Task 10: The chat panel talks to agents (Lane D, after T9)

**Files:**

- Create: `frontend/src/ai/AgentPicker.tsx`, `frontend/src/ai/AgentPicker.test.tsx`
- Modify:
  - `frontend/src/ai/AiChatPanel.tsx` (as built by M16; `AiChatPanelProps` gains `agentId?` and `chatId?` beside `entryId` and `path`)
  - `frontend/src/ai/AiChatPanel.test.tsx`
  - `frontend/src/ai/store.ts`: `AiSeed.agentId?: string`
  - `frontend/src/shell/SidePanelArea.tsx`: pass `agentId`/`chatId` from the target
  - `frontend/src/ai/toolSteps.ts` and its test: lines for the new tools

**Interfaces.**

- Consumes: `useAgents`, `AiChatHeader` (`leading`), `ModelPicker` defaults, `api.aiChat` (with `agentId`, `chatId`), `api.agentChat`, `toolSteps.applyEvent`.
- Produces: `AgentPicker(props: { value: string; onChange(agentId: string): void; disabled?: boolean })` (aria-label "Agent for this chat").

**Behaviour.**

- **Picker.** The picker sits in the header's `leading` slot. Picking another agent starts a new chat with it (spec).
- **Turns.**
  - Every turn sends `agentId` and the `chatId` from the stream's `chat` event.
  - The model picker's `defaultLabel` names the agent's `model` (M16 shows it on the Default row; the trigger says "Default" with no pick).
  - A seed without `agentId` (Ctrl+Alt+J and every editor entry) uses the default agent.
- **Opening chats.**
  - A target with `chatId` loads the transcript: messages, plus tool steps as M16 `parts`.
  - A saved AI Chat object loads `agentId`/`chatId` from `GET /api/ai/chat`.
  - Saving sends `agentId` and `chatId`.
- **Tool lines** (our strings, added to M16's table):

| Tool | Line |
|---|---|
| `write_body` | `Edited {path}` |
| `remove_tags`, `remove_from_collection`, `link_mention` | `Edited {path}` |
| `open_daily_note` | `Opened the daily note for {date}` |
| `duplicate` | `Duplicated {path}` |
| `change_type` | `Changed the type of {path}` |
| `merge` | `Merged {source} into {target}` |
| `create_tag`, `create_type`, `create_collection`, `create_query`, `create_whiteboard`, `create_automation` | `Created '{name}'` (or `'{title}'`) |
| `edit_type`, `edit_collection`, `edit_query`, `edit_whiteboard`, `change_property_kind` | `Edited a definition` |
| `delete_type`, `delete_collection`, `delete_query` | `Moved a definition to the Trash` |
| `type_definition`, `collection`, `saved_query` | `Read the space's types` |
| `read_whiteboard` | `Read {path}` |
| `version_history`, `read_version` | `Looked at the history of {path}` |
| `restore_version` | `Restored a version of {path}` |
| `unlinked_mentions` | `Found mentions of {path}` |
| `trash` | `Looked in the Trash` |
| `restore_from_trash` | `Restored from the Trash` |
| `automations` | `Listed automations` |
| `run_automation` | `Ran an automation` |
| `import_preview`, `start_import`, `import_status` | `Previewed an import` / `Started an import` / `Checked an import` |
| `agent_info` | `Looked up this agent` |

**Steps.**

- [ ] **Step 1: failing tests:**
  - "test the header shows the agent picker in the leading slot"
  - "test switching agent starts a new chat with that agent"
  - "test turns send agentId and the chatId from the chat event"
  - "test Ctrl+Alt+J seed opens the default agent"
  - "test an editor entry's proposal still waits for Accept"
  - "test a transcript target shows its messages and tool steps"
  - "test a saved M10 chat continues with the default agent"
  - "test the model default label is the agent's model": the picker's Default row reads "Default (<the agent's model label>)"; with no pick the trigger still says "Default" (M16's T7 deviation)
  - `toolSteps.test.ts` "test the new tools' lines"
- [ ] **Step 2-4:** fail, implement, pass (`npx vitest run src/ai src/shell`).
- [ ] **Step 5:** commit `feat(m17): chat header agent picker; chats belong to agents`.

### Task 11: Integrate (alone, last)

**Files:**

- Create: `scripts/m17_acceptance.py`, `docs/superpowers/plans/m17-acceptance.md`
- Modify:
  - `scripts/m10_acceptance.py`: check 2 now expects the default agent's folder as `cwd`, `--setting-sources project,local` and the fence. Its other checks are unchanged.
  - `backend/tests/test_m10_ai.py`: `test_ai_modules_use_no_network_client` gains `agentmodel`, `toolcatalog`, `agents`, `agentfiles`, `transcripts`, `agentrun` and `api_agents`.
  - `docs/superpowers/plans/remaining-work.md`: the M17 status line.
  - `CONTINUE.md`: one line.

**`scripts/m17_acceptance.py SPACE [--keep]`.**

- Setup:
  - It copies `SPACE` to a temp folder and commits the copy to a throw-away git repo, as M10's script does. The original is never touched.
  - It sets `OBJECT_STATE_DIR` and `OBJECT_CACHE_DIR` to temp folders and `FAKE_CLAUDE_LOG`.
  - It serves the copy with `create_app` on a free `127.0.0.1` port. `claudePath` points at the fake.
  - It tags one page of the copy "Exclude from AI" through `PUT /api/object/properties` (committed).
- Checks:
  1. `GET /api/agents` lists Assistant with `exists: false`; the state dir holds no `agents.json` and no `agents/`.
  2. A chat turn:
     - streams `chat`, `session`, `text`, `done`, and creates `<state>/agents/Assistant/` with the skeleton;
     - the fake ran there with `--setting-sources project,local`, `--permission-mode dontAsk`, `--permission-prompts none` and `--strict-mcp-config`;
     - `appendPrompt` holds the guidance; `Bash`/`PowerShell` are disallowed; `mcp__object__write_body` is allowed;
     - no `CLAUDE_CONFIG_DIR`; the MCP config holds no secret.
  3. The fence:
     - `runSettings.permissions.deny` holds `Read(<rp space>/**)` and `Edit(<rp space>/**)`;
     - turns with `FAKE:read:<excluded page>`, `FAKE:grep:<space>`, `FAKE:glob:<space>` and `FAKE:write:<space page>` each get the denial, and the excluded page's text appears in no frame;
     - `FAKE:read` of a file in a temp folder outside every fence succeeds.
  4. `POST /api/agents` "Researcher" (shell on, `object-write` off), then a turn: `cwd` is Researcher's folder; `Bash` is allowed; no `mcp__object__<write>` is in `allowed`; the default agent's folder is in its deny rules; the transcript has header, user and assistant lines; `GET …/chats` lists it.
  5. Expanded tools through `/api/v1` with a read-write token:
     - `write_body`, `open_daily_note`, `create_type` + `delete_type` (to the Trash) and `version_history` work;
     - every new route given the excluded page answers 404 or leaves it out;
     - no answer contains its marker text.
  6. A `tagObject` turn runs read-only (`--read-only`, read token) and answers a tags proposal.
  7. Saving the chat adds the "Agent" property to the AI Chat type and writes one chat file whose `agent:` is "Assistant".
  8. Agent folders:
     - `DELETE /api/agents/<Researcher>` moves it to `<state>/agents/.trash/`, and restore puts it back;
     - an agent added from a folder outside the state dir and then deleted is only unregistered, with its files byte-identical;
     - `DELETE /api/agents/assistant` answers 422.
  9. `git status` of the copy shows only the AI Chat type file, the chat file, the daily note, the type made and deleted (in `.object/trash/`), `write_body`'s object, and the history and trash entries.

  It prints `[ok]`/`[FAIL]` per check and `RESULT: PASS` at the end; it exits non-zero on any failure.

**`m17-acceptance.md`.** Hand checks for Gene on a copy of his export:

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

**Steps.**

- [ ] **Step 1:** write the script and checklist; run `uv run python scripts/m17_acceptance.py backend/tests/fixtures/<space>` on `space-sample` and `space-v1` until `RESULT: PASS`.
- [ ] **Step 2:** run the full gate:
  - `uv run pytest backend/tests -q`
  - `npx vitest run`, `npx tsc -b --noEmit`, `npm run build`
  - every `scripts/mN_acceptance.py`
  - the live spike once more with `OBJECT_LIVE_CLAUDE=1`, now through `agentrun`'s own names
  - (spike) one live turn (haiku, `--no-session-persistence`) built by `build_run` with the real `objectapp-mcp` against a temp copy of `space-sample`, asking for a `search`: if the Object tool is refused or never offered under `dontAsk` because MCP tools are deferred behind `ToolSearch`, add `"ToolSearch"` to `toolcatalog.ALWAYS_ALLOWED`, record it in `m17-cli-spike.md`, and re-run; `test_m17_live_cli.py::test_object_tool_is_callable` holds the check
- [ ] **Step 3:** commit `test(m17): acceptance script and hand-check list`.

Then the one milestone review (correctness, file safety, fidelity, the five Review Focus items first), one fix pass, the final gate.

## Shared files and ordering

| Shared file | Owner | Others |
|---|---|---|
| `backend/objectapp/server.py` | T1 (mounts the three stub routers, `RESYNC_EVENTS`) | none |
| `backend/objectapp/tokens.py` | T1 | none |
| `backend/tests/fake_claude.py` | T1 | T11 may add a marker it needs |
| `backend/tests/test_m17_live_cli.py`, `docs/superpowers/plans/m17-cli-spike.md` | T1 (and its follow-up) | T11 (the `ToolSearch` live check) |
| `backend/objectapp/toolcatalog.py`, `agentmodel.py` | T1 | T11 may add `"ToolSearch"` to `ALWAYS_ALLOWED` (spike); lanes report other needs, they don't edit |
| `frontend/src/api/types.ts`, `api/client.ts`, `test/mockApi.ts` | T1 | lanes report needs; they don't edit |
| `frontend/src/nav/tabs.ts`, `nav/sidepanel.ts` | T1 | none |
| `frontend/src/shell/TabStrip.tsx` | T1 (one placeholder `case 'agent'`), then T9 | T1 runs alone, so no overlap |
| `backend/tests/test_m11_mcp.py`, `scripts/m11_acceptance.py` | T5 (the tool-set checks only) | none |
| `frontend/src/agents/useAgents.ts` | T1 | none |
| `backend/objectapp/ai.py` | T4, then T7 (same lane, in order) | |
| `backend/tests/test_m10_ai.py` | T7, then T11 (one line) | |
| `backend/objectapp/api_v1.py`, `mcp_server.py` | T5 | none |
| `backend/objectapp/api_ai.py`, `aichat.py` | T7 | none |
| `frontend/src/shell/Sidebar.tsx` | T8 | none |
| `frontend/src/App.tsx` | T9 | none |
| `frontend/src/ai/AiChatPanel.tsx`, `ai/store.ts`, `ai/toolSteps.ts`, `shell/SidePanelArea.tsx` | T10 | none |
| `frontend/src/agents/ToolSwitches.tsx`, `agentText.ts` | T8 | T9 consumes |
| `scripts/m10_acceptance.py`, `remaining-work.md`, `CONTINUE.md` | T11 | none |

**Lanes** (counted from the Files lists). T1 (now its follow-up) runs first and alone. Then four lanes run:

| Lane | Tasks | Waits for |
|---|---|---|
| A (back end, agent data) | T2, then T3 | |
| B (back end, runner and routes) | T4, then T7 | T7 starts after T2 and T3 are done |
| C (back end, Object tools) | T5, then T6 | T6 starts after T2 is done |
| D (front end) | T8, then T9, then T10 | only T1's contract (M16 is already built on this branch) |

T11 runs last and alone. No two lanes edit the same file.

## Our calls

1. The default agent's id is `assistant`, its icon is `ph-sparkle`, and its soul is `DEFAULT_SOUL`. It is implicit in the registry and listed with `exists: false` until its first turn or edit creates its folder (never write on read).
2. The default agent's model stays M16's `aiModel` device setting, so Settings and the Profile tab edit one value. Its `agent.json` `model` is always null.
3. A new agent's folder name is `safe_filename(name)`.
   - In the state dir a clash gets ` (2)`.
   - At a chosen location an existing folder is a 409, as Create space does.
   - The location is a typed path, because the app has no native folder dialog.
4. Agent folders inside a space folder, or holding one, are refused at create and add. A run refuses too if one becomes nested later.
5. "Add agent folder" never writes into the folder. A copy whose id is already listed is a 409.
6. Duplicate's "skills" copies `.claude/skills/` only. "Memory" copies `.object-agent/memory/` only. Chats, ledger, usage and cache are never copied.
7. Agent trash entries are a moved folder plus a meta file.
   - Restore goes to the original path, or to ` (2)` beside it.
   - There is no purge in M17. Gene can delete a trashed folder by hand.
8. Remove (unregister) is on the Profile tab. Delete in the menu also only unregisters an agent outside the state dir, and says so.
9. The tool switches are written both in `agent.json` (`toolsOff`, the source of truth) and in `.claude/settings.json` `permissions.deny`, as generated entries only. User entries and hooks are kept.
10. Path-scoped deny rules (the fence) go into the run's `--settings` file, not on the command line. That avoids comma and space quoting in paths. Bare tool names go in `--allowedTools`/`--disallowedTools`. The appended system prompt goes in `--append-system-prompt-file`, which avoids multi-line argv through `.cmd` shims.
11. Built-in tools use `--tools default` with denies, rather than an allow-list of built-ins, so housekeeping tools such as Skill keep working. `ALWAYS_ALLOWED = ("Skill",)` is not a switch.
12. The fence also denies the state dir's own files, Gene's `~/.claude/.credentials.json` (Read) and `~/.claude/**` and `~/.claude.json` (Edit). Defensive; not in the spec's list.
13. The Shell is one row covering Bash and PowerShell, stored as `Bash`.
14. The proposal modes (askBlock, tagBlock, tagObject, autofill, rephrase) run with a read token and no Object write tools, so their Accept step stays meaningful. Only `chat` acts directly.
15. The turn token is named after the agent, so writes are announced `api:<agent name>` and logged like M11's.
16. The agent tools server is `object-agent`. M17's only tool is `agent_info`, so the entry point and the scoping are real and tested.
17. Folder `.mcp.json` servers join a run only when every `${VAR}` resolves. M19 supplies the values; until then they show as "Needs secrets". Names that aren't `[A-Za-z0-9_-]{1,64}`, or that clash with Object's servers, are left out.
18. Transcripts are append-only JSONL. The user line is written at the start of a turn and the rest at the end, with `stopped: true` when the client leaves. The title is fixed at the first message.
19. A saved AI Chat object finds its transcript through its Session id (`find_by_session`). The Agent property holds the agent's name, matched back case-insensitively, else the default agent. No chat id is written in the space.
20. The new `objectapp-mcp` tools number 20 read and 35 write, as listed. Templates, settings, spaces, tokens, UI state, attachments, export, reminders and permanent deletes are left out. 428 answers list only visible objects plus `hiddenCount`. Imports from a space folder are refused.
21. Agent routes stay available while "Hide AI features" is on; only the UI hides them. `/api/ai/chat` keeps M10's 403.
22. The Agents section sits directly above the main navigation (All notes, Calendar, Tasks). Its `+` menu holds New agent, Add agent folder… and Deleted agents…. "+ New agent" is also the last row.
23. The agent page is a main-view target `{kind: 'agent', id, tab}` with a tab registry that M18 extends. The Chats tab filters by title; full-text search is M18's.
24. All strings marked "our string" above, and the tool-step lines for the new tools.
