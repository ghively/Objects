# Object agents: design

Date: 2026-11-05. Owner: Gene Hively. Status: **approved by Gene, 2026-11-05** (the whole document, our calls included). Plans: `docs/superpowers/plans/2026-11-05-m16-*.md` to `2026-11-05-m21-*.md`.

Builds on M10 (the AI assistant: `backend/objectapp/ai.py`, `api_ai.py`, `aichat.py`, `frontend/src/ai/AiChatPanel.tsx`) and M11 (the local API, tokens and the `objectapp-mcp` server: `backend/objectapp/mcp_server.py`).

## Why

Gene drove the merged app on 2026-11-05. The chat answers, but:

- the assistant can only read (nine MCP read tools; Claude Code's own tools are off; every change is a proposal Gene clicks to apply);
- its model is one text field in Settings;
- it forgets everything between chats and never gets better at the work;
- it can't reach other agents, on this machine or elsewhere;
- its replies are plain text, so Markdown shows as raw `**` and `#`.

Gene wants Object's agent to work like a self-improving personal agent: a soul (standing instructions and personality), memories, a skills library it writes and improves itself, learning reviews and a curator, every tool available and switchable per agent, a model picker, custom agents made the way Notion makes them, an MCP gateway that brings outside MCP servers in, and A2A so he can chat and work with agents that live on other machines.

These are patterns from an open-source agent Gene runs on this machine. We **adopt the patterns into Object's own agent**; we do not fork or copy that project's code (Gene, 2026-11-05). Nothing in the repo names it.

## Goals

1. **Every tool, on by default, switchable per agent.** Object's MCP read and write tools, Claude Code's built-in tools (shell, file read/edit, web search/fetch, subagents), and every tool of every outside MCP server Gene adds. Each agent's settings list them all with a switch each; whole groups (e.g. "Object write", "Shell", a whole MCP server) switch together.
2. **The agent acts directly.** No click-to-apply step for the agent's own tool calls. The M10 entries that propose an edit (Ask AI about this block, Add tags, Fill empty properties, Replace/Insert) keep their Accept step: there the user asked for a suggestion.
3. **A model picker**, per agent (its default) and in the chat header (this chat only).
4. **An Agents section at the top of the sidebar**, listing the default agent and Gene's custom agents, each opening its chat; "New agent" creates one, Notion-style.
5. **Each agent has its own** soul, memory, skills, settings and searchable chat history.
6. **The agent learns**: it saves memories and skills with its own tools; background reviews after replies decide what to save or improve; a curator tidies the skills while Gene is idle; everything it learns is visible and editable in Object, and every skill change can be undone.
7. **MCP gateway (in)**: Gene adds outside MCP servers once in Settings; any agent can use them, switchable per agent and per tool.
8. **A2A (outbound)**: Gene adds remote agents by their Agent Card URL; they appear in the Agents list and he chats with them in the same panel; local agents can call them as tools.
9. **Agents work together**: an agent can hand a task to another agent (local or remote) and get the result back.
10. **The chat renders Markdown properly.**

## Non-goals (for now)

- **Forking or vendoring** the other project's code, or using its name anywhere.
- **MCP "out"** (offering Object's agents to other programs over MCP). Gene: revisit later.
- **A2A inbound** (remote agents calling into Object's agents). The server binds `127.0.0.1` only (ground rule); serving A2A to other machines would break that. Revisit with "out".
- A shared kanban board between agents, messaging-platform gateways (Telegram etc. are a separate, later integration), voice, image generation.
- A second AI backend. Agents run only through the `claude` CLI.

## Anti-goals (a failure even if it works)

- **Using Gene's Claude login outside the `claude` CLI.** Object never reads `~/.claude/.credentials.json` or any Claude Code token, never calls Anthropic's API itself and never sends Claude Code's headers. Every model call, including background reviews and the curator, is a `claude` CLI run under Gene's own login, as M10 does today.
- **An agent's note edits slipping past Object's file safety.** Edits to space objects go through Object's tools, which keep the ground rules (only the changed lines, atomic writes, CRLF/BOM kept, deletes to the Trash). See "Built-in file and shell tools" below for the one honest gap.
- **A gated or upsold feature.** Everything is unlocked (ground rule).
- **Hidden learning.** Nothing an agent learns is invisible to Gene; nothing it learns is lost without a way back.
- **Breaking M10's guarantees** that still stand: "Exclude from AI" pages and templates are never sent to or readable by any agent, local or remote; the server listens on `127.0.0.1` only.

## Constraints

- Object's ground rules (`CLAUDE.md`): never write on read; property edits change only their lines; deletes go to the Trash; CRLF/BOM preserved; atomic writes; no real CPI data in fixtures; one review per milestone; parallel lanes by file ownership.
- Python back end run with `uv`; React/TypeScript/shadcn/Tailwind front end.
- The `claude` CLI is the only model runner (M10's flags in `ai.py` are the starting point). Every CLI flag used must be checked against `claude --help` of the installed version, as M10 did.
- Agents belong to **the machine, not a space** (Gene, 2026-11-05). An agent works on whichever space is open.
- **Every agent is its own folder** (Gene, 2026-11-05): a Claude Code project folder that holds everything the agent is, so it can be shared, backed up or moved like any folder. The agent's runs load settings, instructions, skills, hooks and MCP servers **only from that folder**; Gene's own user-level Claude Code setup (his `~/.claude` CLAUDE.md, hooks, plugins, skills, auto-memory, permission rules) is never loaded into an agent run.
- **"Exclude from AI" keeps its promise** (Gene, 2026-11-05): no agent can read an excluded page or a template by any tool. See section 4, "Fencing the space".
- Secrets (outside MCP servers' keys, A2A bearer tokens) never go into a space, the repo or a log, and are never shown again after entry.

## The design

### 1. Agents

An agent is a folder, laid out as a Claude Code project so the CLI loads it natively:

```
<agent folder>/                     e.g. Documents\Object Agents\Researcher\
  CLAUDE.md                         the agent's soul: standing instructions and personality
  .claude/settings.json             the agent's permissions (its tool switches as allow/deny
                                    rules) and its hooks; shareable
  .claude/settings.local.json       this machine only (not shared; gitignored)
  .claude/skills/<name>/SKILL.md    its skills (+ references/, templates/, scripts/)
  .mcp.json                         MCP servers this agent brings with it (secrets only as
                                    ${VAR} references, never values)
  .object-agent/agent.json          Object's own fields: id, name, icon, colour, description,
                                    model, learning settings, created/updated
  .object-agent/memory/MEMORY.md    what it has learned about its work and environment
  .object-agent/memory/USER.md      what it has learned about the person it works for
  .object-agent/skills-archive/     archived skills (restorable)
  .object-agent/ledger.jsonl        every memory and skill change with before/after content
  .object-agent/usage.json          per-skill use count and last use
  .object-agent/sessions/           chat transcripts, one file per chat
  .object-agent/cache/              sessions.db full-text index (rebuildable; gitignored)
  .gitignore                        written on create: settings.local.json, cache/
```

- **Where agent folders live.** New agents default to `<state>/agents/<name>/` (`appstate.state_dir()`: `OBJECT_STATE_DIR`, else `%LOCALAPPDATA%/object` on Windows); "New agent" offers a folder picker to put it anywhere (our call). Object keeps a registry of agent folders in the state dir (as it does for spaces); **Add agent folder** registers an existing one (a shared or restored agent), **Remove** unregisters without deleting.
- **Moving between machines.** Copying the folder carries the soul, skills, settings, hooks, MCP servers, memory and chats. Secrets never travel: an MCP server's `${VAR}` values come from Object's secrets on each machine, and the agent page shows which are missing.

- **The default agent** ("Assistant", our name) exists from first run, is today's M10 assistant, and can be edited but not deleted. Every M10 entry point (Ctrl+Alt+J, the editor AI entries, the peek header) talks to the default agent unless the user picks another.
- **New agent** opens a form: name, icon, description, instructions (the SOUL), model, and the tool list. A blank start or "Duplicate" of an existing agent (copies its soul, settings and, optionally, its memory and skills).
- **Delete** unregisters the agent and moves its folder to `<state>/agents/.trash/` (restorable from the Agents section; our call, since agents are not space objects and the space Trash is per space). An agent folder outside the state dir is only unregistered, never moved or deleted.
- **Remote agents** (A2A, section 7) are listed with the local ones but have no soul, memory, skills or tool switches of Object's; their card shows what their Agent Card says.

### 2. The Agents section

- At the **top** of the sidebar, above the current navigation (Gene). Each entry: icon and name; click opens that agent's chat in the side panel (as the AI chat opens today); a `…` menu: Open chat, Settings, Memory & skills, Duplicate, Delete. "+ New agent" at the end. Remote agents show a small "remote" mark.
- **Agent page** (Settings for one agent), tabs: **Profile** (name, icon, description, model, the agent's folder with Open folder), **Instructions** (the folder's `CLAUDE.md` in Object's editor), **Tools** (section 4), **Memory** (both files, editable, with their size against the cap), **Skills** (list with state active/stale/archived, pinned, use count, last used; open to read or edit; history from the ledger with Undo per change; Archive/Restore; Pin), **Learning** (the switches and numbers in section 5), **Chats** (searchable list of its chats).
- The section's look follows the existing sidebar sections (behaviour catalog); exact layout is the builder's, checked by Gene hands-on.

### 3. Running a turn

A turn is still one `claude -p` run (M10), now run **in the agent's folder**:

- **Working folder**: the agent folder is the CLI's working directory, so its `CLAUDE.md`, `.claude/settings.json`, `.claude/skills/` and `.mcp.json` load as project settings. (M10's empty temp folder goes away.)
- **Only the folder's settings**: the run loads project and local settings only, never user settings (`--setting-sources project,local` or the installed CLI's equivalent). `--bare` is not usable: it refuses Gene's OAuth login. The builder verifies on the installed CLI that none of Gene's user `CLAUDE.md`, hooks, plugins, user skills, auto-memory or user permission rules reach an agent run, and adds a test that proves it (a fake user setting must not appear). If the CLI can't keep one of them out, that is a stop-and-ask for Gene, not a silent compromise.
- **System prompt**: the soul arrives natively as the folder's `CLAUDE.md`. Object appends MEMORY.md and USER.md as they were **when the chat started** (a frozen snapshot per chat, so a chat's prompt stays stable and cached; the agent's own memory writes take effect in its next chat), then Object's standing guidance (which tools edit notes, "Exclude from AI" rules), with `--append-system-prompt` (builder checks the flag).
- **Skills**: native Claude Code skills in `.claude/skills/`, so the CLI lists them and loads a skill's full text when the agent uses it. The agent changes skills, its soul and its memory only through Object's `skill_manage` and `memory` tools (section 5), so every change is in the ledger; the folder's permission rules deny built-in Write/Edit on `CLAUDE.md`, `.claude/**` and `.object-agent/**`. Gene edits them freely in Object or any editor.
- **Hooks**: the folder's own hooks run (they are part of the agent); Gene's user hooks do not.
- **Model**: `--model <id>` from the chat's pick, else the agent's default, else the CLI's default.
- **Tools**: an MCP config with Object's server (read and write tools, scoped to the open space and the agent), Object's agent tools (section 5, 6, 8), and every enabled outside MCP server (section 6); `--allowedTools` / `--disallowedTools` built from the agent's switches; built-in tools on unless switched off.
- **Permission mode**: the CLI must not stop to ask (there is no terminal). Allowed tools run; switched-off tools are denied (`dontAsk` with full allowed lists, or the mode that allows everything listed; builder checks the installed CLI).
- **Session resume**: as M10 (`--resume <session>`); a model change mid-chat starts the next turn on the new model with the same history (builder checks the CLI resumes across models; if not, it replays history as M10's Retry does).
- **Streaming events** as M10 (`session`, `text`, `tool`, `done`, `error`), plus a `tool` event per tool call with its name and a short result line, shown in the chat as a collapsible step.

### 4. Tools and switches

**Object's tools.** `objectapp-mcp` today has 9 read tools and 9 write tools (`create_object`, `create_task`, `set_properties`, `add_tags`, `add_to_collection`, `append_to_section`, `replace_section`, `rename`, `move_to_trash`). "Read and write and update everything" (Gene) means the MCP server grows to cover what the app can do through its `/api` routes, each tool keeping the route's own safety (version checks, Trash, no write on read). Starting list for the builder to complete from the routes: object body edit (whole body with version), daily notes (create/open by date), types and properties (create, edit, delete to Trash), collections (create, add/remove, delete), saved queries, tags, whiteboards (read; edit as far as the API allows), automations (list, create, run), import (start, status), version history (list, restore), trash (list, restore). Never: permanent delete, empty trash, settings that hide AI or change security.

**Built-in Claude Code tools**: shell, file read/write/edit, glob/grep, web search, web fetch, subagents, notebook edit, todo. All on by default (Gene), except the shell (see "Fencing the space").

**Fencing the space** (Gene: keep the "Exclude from AI" promise). Agents reach a space only through Object's tools, which already hide excluded pages and templates and keep the file-safety rules. The built-in tools are fenced away from it:
- **File tools** (Read, Write, Edit, Glob, Grep, NotebookEdit): every run gets deny rules for every registered space's folder (and the other agents' folders), passed by Object on the command line or in the run's settings so a shared agent folder can't lift them. They work freely in the agent's own folder and anywhere else on the machine.
- **Shell** (Bash, PowerShell): a shell command can read any file, and the CLI can't fence it by path on Windows. So the shell is **off by default** (our call; the one exception to "everything on"), and switching it on for an agent shows: "With the shell on, this agent can read every file on this computer, including pages excluded from AI." Where the installed CLI offers an OS sandbox that can deny the space folders to commands, the builder uses it and the shell may then default on; the builder reports which it found.
- **Web fetch, outside MCP servers, remote agents** can't leak an excluded page an agent never read, so they stay on.
- **Writes**: a space's `.md` files are never written by built-in tools (the fence covers writes too), so every note edit keeps Object's safety: only the changed lines, atomic, CRLF/BOM kept, Trash, version history.
- The M17 acceptance script proves the fence with a fake `claude` and the real permission arguments: an excluded page can't be read by Read, Grep or Glob, and the run's arguments carry the deny rules.

**Switches** (agent page, Tools tab): grouped list — Object read, Object write, Object agent tools (memory, skills, chat search, delegate, remote agents), Claude Code built-ins (one row each), then one group per outside MCP server with its tools listed under it (fetched from the server when Gene opens the tab). Each row and each group has a switch; new tools of a server are on by default. Stored in `agent.json` as the switched-**off** names, so new tools appear on.

### 5. Learning

**Memory tool** (`memory`, Object agent tool): `add`, `replace` (by unique substring), `remove` (by unique substring), on target `memory` or `user`. Entries are separated by a line `§`. Caps: MEMORY.md 2,200 characters, USER.md 1,375 (defaults, settable per agent). A write past the cap fails with the current entries listed so the agent can consolidate. Writes are atomic and logged in the agent's ledger.

**Skills tool** (`skill_manage`): `create`, `patch` (old/new string, in SKILL.md or a support file), `edit` (whole file), `write_file` / `remove_file` (support files), `archive` (with `absorbed_into` when merged). Rules enforced by the tool, not only the prompt: a patch or edit must follow a read of that skill in the same run; names at most 64 characters; the index description at most 60 characters; SKILL.md at most 100,000 characters; support files at most 1 MiB. Every change goes to `.object-agent/ledger.jsonl` with the before and after content; the Skills tab offers Undo per change. Skills the agent creates are marked `created_by: agent`; skills Gene writes are `created_by: user`. Also `skills_list` and `skill_view` (which bumps `usage.json`).

**Background reviews.** Two counters per chat: user turns since the agent last used `memory`, and tool calls since it last used `skill_manage`; using the tool resets its counter. When a counter reaches its interval (default 10 each; 0 switches that review off), then **after the reply has been shown**, Object runs a review: a separate `claude -p` run with the same model, the same system prompt, the chat's messages, and one of three prompts (memory, skills, both). The review may use only `memory` (when the memory counter fired), `skills_list`, `skill_view`, `skill_manage` and read-only Object tools; at most 16 tool steps. The skills prompt asks the agent to prefer, in order: patch a skill it used this chat; patch an existing broader skill; add a reference/template/script file to one; only then create a new broader skill (not one per chat); to turn Gene's corrections into skill rules; never to delete a skill; to skip environment failures and dead ends. The chat shows a small "Learning…" line while a review runs and "Saved 1 memory, updated 1 skill" after (click opens the change). A review never blocks the next turn. "Learn from this chat" in the chat's `…` menu runs a review on demand.

**Curator.** Runs when Object has been idle for at least 2 hours and the last run was at least 7 days ago (both settable; on by default). Deterministic pass (no model): an agent-created skill not used for 14 days becomes **stale**, for 30 days **archived** (moved to `.object-agent/skills-archive/`, restorable); pinned skills, skills Gene wrote, and skills a schedule uses (section 9) are never touched; a skill never used and younger than 14 days is never archived. Optional consolidation pass (off by default, "Tidy up now" on the Skills tab runs it once): a `claude -p` run that finds overlapping skills, merges them into broader ones (archiving the absorbed ones with `absorbed_into`) and writes a short report shown on the Skills tab. Every curator change is in the ledger and undoable.

**Chat search** (`session_search`, agent tool): full-text search over the agent's own transcripts (`.object-agent/cache/sessions.db`, SQLite FTS5, rebuildable from `.object-agent/sessions/`), returning matching chats with snippets, and reading a chat by id. No model call.

**Where chats live.** Every chat is kept as a transcript in the agent's `sessions/` (for search and reviews). Saving the chat as an "AI Chat" object in the open space stays as M10 does it (on by default), now with an Agent property naming the agent. The transcript is the agent's; the AI Chat object is the space's note.

### 6. MCP gateway (in)

- **Settings > Integrations > MCP servers** (next to M11's tokens): add a server by **command** (stdio: command, arguments, environment) or **URL** (HTTP/SSE, optional headers or bearer token; OAuth if the builder's CLI version supports it in `--mcp-config`). Name, enabled switch, "Test" (lists its tools).
- Stored in `<state>/mcp-servers.json`; secret values in a separate `<state>/secrets.json` (our call; Windows Credential Manager is a builder option), never shown again, never logged.
- Every enabled server goes into each turn's `--mcp-config` (with `--strict-mcp-config`, so Gene's other Claude Code MCP servers stay out unless he adds them here), filtered by the agent's switches. Tool names follow the CLI's `mcp__<server>__<tool>`.

### 7. A2A (outbound)

- **Add remote agent** (Agents section): an Agent Card URL (or base URL; Object fetches `/.well-known/agent-card.json`), optional bearer token or header. Object shows the card's name, description and skills and lists the agent.
- **Chatting** with a remote agent uses the same chat panel: Object sends the message with A2A's streaming method when the card offers streaming, else the plain send method, and shows the reply's text and its artifacts (files as attachments, data as a code block). Multi-turn chats keep the A2A context id; a task that asks for input shows the question as the agent's reply. The chat is stored like a local agent's (a remote agent gets a small folder of its own in `<state>/agents/` holding its card URL and transcripts; optional AI Chat object).
- **Context** chips work as for local agents, but what is sent leaves this machine: the first time Gene sends context to a remote agent, a notice says so (once per remote agent). "Exclude from AI" pages and templates are never sent (M10 rule, unchanged).
- **Sends an agent makes itself** (`remote_agent_call`, `delegate` to a remote agent, web fetch, outside MCP servers) get no notice or confirmation (our call, following "no limitations" and the agent acting directly). Gene limits them with the agent's tool switches.
- **Agent tools** for local agents: `remote_agents_list`, `remote_agent_call` (send a message, wait for the result, with a timeout), so a local agent can work with a remote one.
- Object targets the current A2A specification (v1.0 when built: Agent Card, JSON-RPC send and streaming methods, tasks); the builder pins the version it implements.

### 8. Agents working together

- **`delegate`** (agent tool): hand a task to another agent by name (local or remote) with a goal and context; the other agent runs it as its own chat (its own soul, memory, skills, tools), and the caller gets back a summary (at most 24,000 characters). Up to 3 delegations at once per turn; a delegated agent can't delegate further (flat, one level) and can't write the caller's memory. The delegated chat is kept in the other agent's chats, marked as delegated.

### 9. Schedules (last phase)

- An agent can have **schedules**: a prompt that runs on a schedule as a chat of that agent, with its result saved as an AI Chat object and a notification. Built on M14's scheduler (same catch-up rules); created from the agent page or by the agent through a `schedule_manage` tool. Schedule runs skip background reviews.
- **A schedule belongs to one space** (our call): it is made in a space, stored with M14's rules in that space's `.object/automations/` with the agent's id, runs only while that space is open (M14's catch-up offers missed runs on the next open), and saves its result there. The agent itself stays machine-wide.

### 10. The chat panel

- **Markdown rendering** of every agent message: headings, paragraphs, bold/italic/strikethrough, lists and task lists, links (object links open in Object), inline code and code blocks with syntax highlighting (the editor's lazy highlight.js), tables, block quotes, horizontal rules, math (the editor's KaTeX). User messages render the same. Copy still copies the Markdown source. Builder's choice of renderer; it must not run HTML from a reply.
- **Header**: agent picker (switch agent = new chat with that agent), model picker (this chat), New chat.
- **Tool steps** between messages, collapsed to one line each ("Searched notes for 'rack'", "Edited Servers/Alpha.md"), expandable to the call's input and result.
- **Learning line** (section 5).
- Looks: the design is the builder's within the existing shadcn/Tailwind look; Gene checks it hands-on.

### 11. Model picker

- Choices: the CLI's model aliases plus the current Claude model ids (today: Fable 5.1 `claude-fable-5-1`, Opus 5.5 `claude-opus-5-5`, Sonnet 5.5 `claude-sonnet-5-5`, Haiku 5.5 `claude-haiku-5-5`), and "Custom…" for any id. The list lives in one back-end constant so a new model is one line.
- The agent's default is on its Profile tab; the chat header overrides for that chat. Settings > AI Assistant's Model field becomes the default agent's model.
- Background reviews use the chat's model unless the agent's Learning tab names a review model (our call: a cheaper model there saves usage).

## Phases (one milestone each; order is ours, Gene can reorder)

1. **M16: chat polish and model picker** — sections 10 and 11.
2. **M17: agents and full tooling** — sections 1-4 (Agents section, agent pages, agent folders, souls, every tool with switches, the expanded Object MCP tools, direct action).
3. **M18: learning** — section 5.
4. **M19: MCP gateway (in)** — section 6.
5. **M20: A2A and delegation** — sections 7 and 8.
6. **M21: schedules** — section 9.

Each milestone gets its own plan (`docs/superpowers/plans/`), acceptance checklist and `scripts/mN_acceptance.py` with a fake `claude` (M10's `backend/tests/fake_claude.py`) and, for M20, a fake A2A agent.

## Decided by Gene (2026-11-05)

- Adopt the patterns into Object's existing agent; no fork; the other project is not named anywhere.
- Every tool available, on by default, switchable per agent; "no limitations".
- A model picker.
- An Agents section at the top for custom agents, made similarly to Notion's.
- Chat with any agent, including remote A2A agents.
- MCP gateway "in" now; "out" maybe later.
- Agents belong to the machine, not a space.
- Fix the chat's Markdown.
- Every agent is its own Claude Code project folder, shareable and backed up like any folder; its runs load only that folder's settings, never Gene's user-level Claude Code setup.
- "Exclude from AI" keeps its promise: agents can't read excluded pages by any tool.

## Our calls (for Gene to check while reading)

- The agent's own tool calls act directly; the M10 suggestion entries keep their Accept step.
- The shell is off by default (it can't be fenced from the space on Windows); switching it on warns that it can read excluded pages. File tools are on and fenced from every space folder.
- Agent folders default to the state dir, with a folder picker to put one anywhere; Object keeps a registry of them; Delete only moves folders it created.
- The agent's own soul, skills and memory change only through Object's tools (built-in Write/Edit denied on them) so every change is undoable; Gene edits them freely.
- Agent folders carry MCP servers with `${VAR}` references; secret values stay in Object's secrets on each machine.
- Memory is a frozen snapshot per chat; writes show up in the agent's next chat.
- Deleted agents go to an agent trash in the state dir.
- Secrets for MCP servers and remote agents in a state-dir secrets file.
- Every chat also kept as a transcript in the agent's folder; the AI Chat object in the space stays on by default.
- A2A inbound left out (127.0.0.1 rule).
- The numbers (caps 2,200/1,375; review every 10; curator 7 days/2 hours idle; stale 14, archive 30; delegation 3 at once, one level).
- The phase order.

## Left to the builder

Exact CLI flags (checked against the installed `claude --help`), how skills reach the CLI, the Markdown renderer, the agent page and sidebar layout within the existing look, the A2A version pinned, the full list of added Object MCP tools (from the `/api` routes), how the curator's idle time is measured, and test fixtures (synthetic only).
