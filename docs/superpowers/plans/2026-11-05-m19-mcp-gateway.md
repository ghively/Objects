# Milestone 19: MCP gateway (in)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Written 2026-11-05 against `master` at `0f4fde1`; reconciled 2026-11-06 with the built M16-M18 code on branch `feat/m16-m24` at `745a2a5` (see "Reconciled with the built code" below). It is built after M17 (`2026-11-05-m17-agents-and-tools.md`) and M18, on the same branch `feat/m16-m24` (Gene builds M16-M24 straight through). It consumes M16's and M17's Contract names exactly and redefines none of them. Every label and default not quoted from the spec is "our string" / "our choice".

**Reconciled with the built code (2026-11-06).** What M16-M18 built changed these points; the sections below already say it:

1. `mcp` 2.3's `streamable_http_client(url, *, http_client=None, ...)` takes no `headers`. Headers go in an `httpx2.AsyncClient` made with `mcp.shared._httpx_utils.create_mcp_http_client(headers=...)` and passed as `http_client`. `sse_client(url, headers=...)` takes them directly. The `mcp` server library's class is `mcp.server.mcpserver.MCPServer` (as `mcp_server.py` uses it), not `FastMCP`. `mcp`'s HTTP client module is `httpx2`, not `httpx`.
2. M18 already gave the fake `claude` a `FAKE:mcp:<server>:<tool>:<json args>` marker (stdio servers only, `${VAR}` filled from the fake's environment, the `dontAsk` denial "Permission to use <name> has been denied."), and its `init` event already lists every `--mcp-config` server as `{"name", "status": "connected"}` without connecting. T1 adds only what is missing: HTTP and SSE entries in that marker, `${VAR:-default}` in the fake's `_fill`, and `mcpServers` in the log line. The init event keeps M18's form (no "pending" status).
3. M17's folder group `mcp:<name>` is not empty: it holds one whole-server row `mcp__<name>` (label `<name>`), and M17's `test_m17_routes.py::test_tools_routes` asserts that row is off after toolsOff `["Read", "mcp__gh"]`. The provider's folder group therefore keeps that row while the server's tools aren't known, or while `mcp__<name>` is in the agent's toolsOff (see "The Tools tab").
4. M17's `toolcatalog.run_tool_lists` puts a folder server's `mcp__<name>` in `disallowed` when that id is in toolsOff. `gateway_tools_contributor` never adds `mcp__<name>` to `allowed` when it is already in `parts.disallowed`.
5. M17's `agentfiles.sync_permissions` / `generated_denies` already write every switched-off `mcp__…` id into the agent folder's `.claude/settings.json` `permissions.deny` when the agent is saved, so off tools of folder and gateway servers are also denied through the project settings. `gateway-tools` still puts them in `--disallowedTools` (both lists, as M17 does for its own ids).
6. The client drops a 409's text (`ConflictError('conflict')`, and a `RevisionConflictError` whenever the body has a `currentRevision` key, even `null`). So the name-clash 409 omits `currentRevision`, and `createMcpServer` passes `request`'s `on409` hook to throw `ApiError(409, detail)` so the dialog can show "Another server already has this name.". `api.agentTools(id)` answers `ToolGroup[]`, so `refreshAgentTools(agentId)` answers `Promise<ToolGroup[]>` too.
7. Adding `mcpServers` to the resync kinds breaks two tests that pin the list: `backend/tests/test_audit2_api.py::test_event_hub_bounds_a_slow_subscriber` (9 kinds, then 10) and `frontend/src/api/client.test.ts` "test agentLearning is a resync event". T1 owns both edits.
8. `GET /agents/{id}/tools`'s merge is inline in `api_agents.agent_tools`. T5 moves it into a module-level `api_agents.agent_tool_groups(rec: AgentRecord) -> list[dict[str, Any]]` (the `groups_out` list), which the route and T6's refresh both call, so their answers are equal.
9. `useAiHidden` is in `frontend/src/ai/store.ts`. Settings > Integrations (M11) has three groups: "API tokens", "New token" and "Connect an AI assistant" (shown once the MCP template loads). "MCP servers" goes after all three so the token groups stay together. `INTEGRATIONS_SEARCH` already holds `'MCP'`.
10. `agentrun.SECRET_LOOKUP` is read at call time already: `agentrun._folder_mcp` calls the module global, and `agents._secret_lookup` reads `getattr(agentrun, "SECRET_LOOKUP")` on each call (M17 T2's deviation). No `agentrun` change is needed.
11. M10's `test_ai_modules_use_no_network_client` bans `httpx` but not `httpx2`. T9 adds `httpx2` to its banned set when it adds M19's modules.

**Goal.** Gene adds outside MCP servers once, in Settings > Integrations > MCP servers, by command (stdio) or by URL (HTTP or SSE). Each one has a name, an enabled switch and a "Test" button that lists its tools. Its secrets go into a state-dir secrets file and are never shown again or logged. Every enabled server joins each agent turn's `--mcp-config` (with `--strict-mcp-config`, already in M17's flags), filtered by that agent's switches. An agent folder's own `.mcp.json` servers get their `${VAR}` values from the same secrets on each machine, and the agent page shows which ones are missing, with a way to set them. The agent page's Tools tab shows one group per outside server, with that server's tools listed under it.

**Architecture.** The back end gets these modules:

- `mcpmodel.py`: the schemas and constants.
- `secretstore.py`: `<state>/secrets.json`, plus `redact`.
- `mcpstore.py`: `<state>/mcp-servers.json` (create, save, delete, validation) and each server's CLI entry.
- `mcpprobe.py`: the only module here that opens a connection. It lists a server's tools with the `mcp` client library already in `pyproject.toml` (`mcp>=2.3,<3`).
- `mcpgateway.py`: M17's extension points.
  - the run contributors `gateway` (order 35, the slot M17 reserved) and `gateway-tools` (order 62, after M17's `tools` and before M18's `review-tools`; M17's registry of contributor orders);
  - the Tools tab group provider (`toolcatalog.GROUP_PROVIDERS`);
  - `agentrun.SECRET_LOOKUP`;
  - an in-memory tool cache.
- `api_mcp.py`: the `/api/mcp-servers…`, `/api/mcp-secrets…` and `/api/agents/{id}/tools/refresh` routes.

The front end gets `frontend/src/mcp/` (the MCP servers group of Settings > Integrations, the server dialog, the secret variables list, the set-a-secret dialog). Small explicit hooks go into M17's `ProfileTab`, `ToolsTab` and `ToolSwitches`.

**Tech Stack.** Python 3 (FastAPI, pydantic, the `mcp` 2.3 client: `mcp.client.stdio`, `mcp.client.streamable_http`, `mcp.client.sse`, `mcp.shared._httpx_utils.create_mcp_http_client`, `ClientSession`; the server side `mcp.server.mcpserver.MCPServer`), `uv`; React, TypeScript, zustand, shadcn/ui, Tailwind, vitest; Claude Code CLI **2.1.317** (checked with `claude --version`, `claude --help`, `claude mcp --help`, `claude mcp add --help`, `claude mcp add-json --help`, `claude mcp login --help`, all read-only).

**Spec.** `docs/superpowers/specs/2026-11-05-agents-design.md`:

- section **6** (MCP gateway (in)), in full;
- from section **1**, "Moving between machines" (folder `.mcp.json` `${VAR}` values from Object's secrets; the agent page shows which are missing) and the `.mcp.json` row of the folder layout;
- from section **3**, the "Tools" bullet's outside servers;
- from section **4**, the Switches paragraph's "one group per outside MCP server with its tools listed under it (fetched from the server when Gene opens the tab)" and "new tools of a server are on by default";
- the Constraints line on secrets.

Not in M19: MCP "out" (a non-goal), A2A bearer tokens (M20 stores them in this milestone's `SecretStore` under its own key prefix), schedules (M21).

**CLI facts (2.1.317).**

| Fact | How it was checked |
|---|---|
| `--mcp-config <configs...>` "Load MCP servers from JSON files or strings (space-separated)" | `claude --help` |
| `--strict-mcp-config` "Only use MCP servers from --mcp-config, ignoring all other MCP configurations" | `claude --help`; already in M17's `CLI_FLAGS` |
| Transports `stdio`, `sse`, `http` (`-t, --transport`), headers (`-H`), env (`-e`) | `claude mcp add --help` |
| `add-json` takes "stdio, SSE, HTTP, or WebSocket" JSON | `claude mcp add-json --help`. WebSocket is not offered (the spec names HTTP/SSE). |
| OAuth only through `claude mcp login <name>` for a server configured in Claude Code's own config, plus `--client-id`/`--callback-port` on `claude mcp add` | `claude mcp login --help`, `claude mcp add --help` |
| An unapproved project `.mcp.json` server is "⏸ Pending approval and not connected to" | `claude mcp list --help`. M17 never relies on it: `--strict-mcp-config` ignores the folder's `.mcp.json`, and M17's `folder-mcp` contributor passes those servers in `--mcp-config` itself. |

The help text gives no JSON schema for `--mcp-config` entries. This plan uses Claude Code's documented config shapes:

- `{"type":"stdio","command","args","env"}`
- `{"type":"http","url","headers"}`
- `{"type":"sse","url","headers"}`
- `${VAR}` expanded from the CLI's environment in `command`, `args`, `env`, `url` and `headers`. M17 already relies on this for `${OBJECT_API_TOKEN}`.

The T1 live spike proves each shape and the expansion on the installed CLI before anything is built on them.

**OAuth (spec: "OAuth if the builder's CLI version supports it in `--mcp-config`").** It isn't supported. OAuth works only through `claude mcp login`, which needs the server in Gene's user or local Claude Code config. It also stores its tokens in Claude Code's credential store, which Object must never write or read (anti-goals). So M19 offers headers and a bearer token, and no OAuth. A URL server that answers 401 fails "Test" with a message saying so (below). T1 records this finding in `m19-cli-spike.md`.

## Global Constraints

- Agents run only through the `claude` CLI under Gene's own login. Object never reads `~/.claude/.credentials.json` or any Claude token, never calls Anthropic's API, and never writes `~/.claude` or `~/.claude.json`. `claude mcp add`/`add-json`/`login`/`remove` are never run, because they write Gene's user config.
- The server binds `127.0.0.1` only. The only outbound connections are `mcpprobe`'s to the servers Gene added (or an agent folder's servers), on his "Test" or the Tools tab. `mcpmodel`, `secretstore`, `mcpstore`, `mcpgateway` and `api_mcp` import no network client (M10's `test_ai_modules_use_no_network_client` gains them).
- Settings > Integrations > MCP servers sits next to M11's tokens. A server is added by **command** (stdio: command, arguments, environment) or by **URL** (HTTP/SSE, optional headers or bearer token). It has a **Name**, an **enabled** switch and **"Test"**, which lists its tools.
- Servers are stored in `<state>/mcp-servers.json`. Secret values go in a separate `<state>/secrets.json` (`appstate.state_dir()`). They are **never shown again and never logged**, and never go into a space, the repo, an agent folder, a run's temp files, argv, an API answer, an event or a transcript.
- Every enabled server goes into each turn's `--mcp-config`, with `--strict-mcp-config`, so Gene's other Claude Code MCP servers stay out. The servers are filtered by the agent's switches. Tool names follow the CLI's `mcp__<server>__<tool>`.
- Folder `.mcp.json` servers carry only `${VAR}` references. Their values come from Object's secrets on each machine, and the agent page shows which are missing.
- The Tools tab has one group per outside MCP server (the gateway's and the folder's), with its tools listed under it, fetched from the server when Gene opens the tab. Each row and group has a switch. New tools of a server are on by default. Switches are stored in `agent.json` `toolsOff` as switched-off ids (M17); group ids are never stored.
- Never write on read: listing servers or secrets, "Test", opening the Tools tab or the agent page, and every probe write nothing to the state dir, an agent folder or a space. The tool cache is in memory only.
- File safety for the state files: atomic writes (`textfile.atomic_write`), `jsonstore.dump_json`, unknown keys kept, and an unreadable file copied aside as `<name>.unreadable-<stamp>.json` before the next write (as `spaces.Registry` does). On POSIX, `secrets.json` is mode `0600`.
- Everything is unlocked: no badge, limit or gate.
- Tests write only to temp folders (`OBJECT_STATE_DIR` is conftest's temp folder). Nothing writes to `~/.claude` or the real state dir. Fixtures (the fake MCP server, server names, secrets such as `s3cret-…`) are synthetic.
- Live CLI tests run only with `OBJECT_LIVE_CLAUDE=1`, with `--no-session-persistence` and the `haiku` alias.
- No product or project names other than Object and Claude Code in code, tests or strings.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

These are the inputs and failure modes the spec implies that no single task's happy path exercises, most likely first. Each one's test is listed in its owning task.

1. **A secret value leaking.**
   - Places it could leak: a run's `mcp.json`, `run-settings.json` or `append.md`; argv (the fake's log); M17's `notes`; an API answer (`GET /mcp-servers`, `GET /mcp-secrets`, a 422 echoing the input, a Test error); a `ChangeEvent`; a server log line (`caplog`); a transcript; an agent folder; the space.
   - Sources of an echo: a stdio server that prints its environment to stderr and exits, and an HTTP server whose 401 body echoes the `Authorization` header.
   - Tests: `test_m19_gateway_run.py::test_secret_values_never_in_files_args_or_logs` (T5), `test_m19_probe.py::test_errors_are_redacted` (T4), `test_m19_routes.py::test_no_answer_holds_a_secret` (T6), and `scripts/m19_acceptance.py` check 10 (T9).
2. **Untrusted names and values reaching a subprocess or the CLI's environment.**
   - Server names: `object`, `object-agent`, `my server`, `a/b`, 65 characters, and `GitHub` beside `github`.
   - Variable names: `PATH`, `CLAUDE_CONFIG_DIR`, `ANTHROPIC_API_KEY`, `OBJECT_API_TOKEN`, `a-b`, `X=Y`, NUL.
   - Values: a plain (non-secret) value holding `${OBJECT_API_TOKEN}`, which the CLI would expand; a header name or value with CR/LF; URLs `file:///`, `javascript:` and `ftp://`; an empty command.
   - Tests: `test_m19_store.py::test_validation_table` (T3), `test_m19_secrets.py::test_var_names` (T2).
3. **Switches not reaching the run.**
   - An off tool must be in `--disallowedTools`. A server with every known tool off must be left out of `mcp.json`. A tool the server adds later must be on.
   - A folder server's off tools must be denied too. M17's `run_tool_lists` only denies Object and built-in ids, so M19 covers them.
   - A disabled server, or a gateway server whose name clashes with the agent's folder server, must be left out.
   - Proposal, review and curator runs get no gateway server.
   - The live spike proves that `--allowedTools mcp__<srv>` plus `--disallowedTools mcp__<srv>__<tool>` behaves under `dontAsk`.
   - Tests: `test_m19_gateway_run.py::test_switches_filter_the_run`, `::test_disabled_and_clashing_servers_left_out`, `::test_purposes_without_gateway` (T5); `test_m19_live_cli.py::test_server_allow_and_tool_deny` (T1).
4. **Only the listed servers reach a run.**
   - With `--strict-mcp-config`, the `init` event's `mcp_servers` names must be exactly `object`, `object-agent`, the enabled and switched-on gateway servers and the usable folder servers. None of Gene's own servers may appear.
   - Each listed server must connect with its `${VAR}`s expanded from the environment, for stdio env, args and HTTP headers. On Windows, a `.cmd` shim command must start.
   - Tests: `test_m19_live_cli.py::test_only_listed_servers_reach_a_run`, `::test_mcp_config_shapes_and_expansion`, `::test_windows_cmd_shim` (T1).
5. **Probes that misbehave, and reads that write.**
   - Misbehaving probes: a command that doesn't exist; a command that hangs (`PROBE_TIMEOUT_S` = 20, its process tree killed); one that prints junk on stdout; one that exits at once; a URL that refuses the connection; HTTP 401, 404 and 500; a server with 0 tools; a server with 500 tools; two refreshes at once.
   - Writes on read: listing, Test and opening the Tools tab must leave the state dir, the agent folders and the space byte-identical.
   - Tests: `test_m19_probe.py::test_failure_modes` (T4), `test_m19_routes.py::test_reads_and_probes_write_nothing` (T6).

## Contract (T1)

### Storage

| What | Where | Written by |
|---|---|---|
| Outside servers | `<state>/mcp-servers.json` (schema below), `dump_json` | `mcpstore.McpStore` (create, save, delete) |
| Secret values | `<state>/secrets.json` `{"version": 1, "secrets": {"<key>": "<value>"}}`, `dump_json`, `0600` on POSIX | `secretstore.SecretStore` (set, delete) |
| Tools last listed per server | memory only (`mcpgateway.TOOL_CACHE`), lost on restart | the Test route and the Tools tab refresh |
| A run's server entries | M17's run temp folder `mcp.json`. It holds only `${OBJECT_MCP_…}` / `${VAR}` references; the values go only into the CLI's environment (`RunParts.env`). | `mcpgateway` contributors via `agentrun.build_run` |

Neither file is written by any read. M17's fence already denies `Read(<rp state>/*)` and `Edit(<rp state>/*)` to every run's file tools, which covers both files. T5 asserts that the two paths match those rules.

**Secret keys** (`secretstore.KEY_PATTERN` = `^[a-z0-9]+:[^\x00-\x1f]{1,200}$`):

| Key | Holds |
|---|---|
| `mcp:<serverId>:env:<KEY>` | a stdio server's secret environment value |
| `mcp:<serverId>:header:<name, lower-cased>` | a URL server's secret header value |
| `mcp:<serverId>:bearer` | a URL server's bearer token (sent as `Authorization: Bearer <token>`) |
| `var:<NAME>` | a secret variable for agent folders' `.mcp.json` `${NAME}` references, machine-wide (our call) |
| `a2a:…` | reserved for M20 (remote agents' bearer tokens and headers) |

### `mcp-servers.json` (`backend/objectapp/mcpmodel.py`, pydantic; `McpServer*` in `frontend/src/api/types.ts`)

```jsonc
{
  "schemaVersion": 1,                 // any other value: read-only list ("These MCP servers were saved by a newer version of Object."), PUT/POST/DELETE 423
  "servers": [
    {
      "id": "01JC7ZK3T9Q4M2X8B5N6R1V0WE",   // ULID (ids.new_ulid)
      "name": "github",                // fullmatch [A-Za-z0-9_-]{1,64}; unique case-insensitively; not "object"/"object-agent"; fixed after create
      "enabled": true,
      "kind": "command",               // "command" (stdio) | "url"
      "command": "npx", "args": ["-y", "some-mcp-server"],              // kind command only
      "env": [{"key": "LOG_LEVEL", "value": "info"}, {"key": "API_KEY", "secret": true}],  // a secret row has no value here
      "transport": null, "url": null, "headers": [], "bearer": false,   // kind url: transport "http" | "sse", url http(s), headers rows like env, bearer true = a token in secrets
      "createdAt": "2026-11-05T09:00:00.000Z", "updatedAt": "2026-11-05T09:00:00.000Z"
    }
  ]
}
```

- Unknown keys, top-level and per server, are kept on every save.
- An unreadable file lists no servers, and the section shows "The MCP servers file can't be read." (our string). The next write copies the file aside first.
- **A server's revision** is the sha256 of its entry's `dump_json` bytes. `PUT` checks it (409 `{currentRevision}`).

```python
# mcpmodel.py
SCHEMA_VERSION = 1
SERVERS_FILE = "mcp-servers.json"; SECRETS_FILE = "secrets.json"
NAME_PATTERN = r"[A-Za-z0-9_-]{1,64}"                     # M17's folder-server rule, shared
RESERVED_NAMES = ("object", "object-agent")              # toolcatalog.OBJECT_SERVER / AGENT_SERVER
ENV_KEY_PATTERN = r"[A-Za-z_][A-Za-z0-9_]{0,127}"        # a stdio env key
HEADER_NAME_PATTERN = r"[A-Za-z0-9!#$%&*+.^_|~-]{1,128}" # an HTTP header token (backtick and quote left out)
VAR_PATTERN = r"[A-Za-z_][A-Za-z0-9_]{0,63}"             # a secret variable name
RESERVED_VAR_PREFIXES = ("CLAUDE", "ANTHROPIC", "OBJECT_")   # compared case-insensitively
RESERVED_VARS = ("PATH", "PATHEXT", "COMSPEC", "SYSTEMROOT", "PYTHONPATH", "PYTHONHOME", "NODE_OPTIONS")
ENV_PASSTHROUGH = ("HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP")
    # folder ${VAR}s that resolve from Object's own environment (not secrets; can't be set in Object)
ENV_PREFIX = "OBJECT_MCP_"                               # env names of gateway secrets in a run
MAX_SERVERS = 50; MAX_ROWS = 50; MAX_ARGS = 50; MAX_VALUE_CHARS = 4000; MAX_SECRET_CHARS = 16384
PROBE_TIMEOUT_S = 20; PROBE_STDERR_CHARS = 2000; TOOL_DESCRIPTION_MAX = 300
GATEWAY_PURPOSES = ("chat", "delegate", "schedule")      # RunScope.purpose values that get gateway servers;
                                                         # M24 appends "work", "work-read", "work-file", "work-sync"

class EnvRow(BaseModel):        # stored; extra="allow"
    key: str; value: str | None = None; secret: bool = False
class HeaderRow(BaseModel):     # stored; extra="allow"
    name: str; value: str | None = None; secret: bool = False
class McpServerFile(BaseModel): # one stored server; extra="allow"
    id: str; name: str; enabled: bool = True; kind: Literal["command", "url"]
    command: str | None = None; args: list[str] = []; env: list[EnvRow] = []
    transport: Literal["http", "sse"] | None = None; url: str | None = None
    headers: list[HeaderRow] = []; bearer: bool = False; createdAt: str; updatedAt: str

class EnvRowInput(BaseModel):    key: str; value: str | None = None; secret: bool = False
class HeaderRowInput(BaseModel): name: str; value: str | None = None; secret: bool = False
class McpServerInput(BaseModel):
    name: str; enabled: bool = True; kind: Literal["command", "url"]
    command: str | None = None; args: list[str] = []; env: list[EnvRowInput] = []
    transport: Literal["http", "sse"] | None = None; url: str | None = None
    headers: list[HeaderRowInput] = []
    bearer: str | None = None
    bearerAction: Literal["keep", "set", "remove"] = "keep"
    # A secret row's value of None means "keep the stored value". On create, or for a row that
    # wasn't secret before, it is a 422 "Enter a value for API_KEY." (our string). bearer: with
    # bearerAction "set" the new token; "remove" drops it; "keep" keeps it.
```

**Validation** (`mcpstore.clean_input`; each failure is a 422 with one message, our strings, and **no message ever repeats a value**):

| Input | Rule | Message |
|---|---|---|
| name | `NAME_PATTERN`, not reserved, unique (casefold) | "Use 1-64 letters, digits, - or _." / "That name is taken by Object." / "Another server already has this name." (409) |
| name on `PUT` | unchanged | "A server's name can't be changed." |
| kind `command` | `command` non-empty, no NUL, doesn't start with `-`; at most `MAX_ARGS` args, each at most `MAX_VALUE_CHARS` and without NUL; `url`/`headers`/`bearer` empty | "Enter the command." / "That command can't be run." |
| kind `url` | `url` parses with scheme `http` or `https` and a host; `transport` given (default `http`); `command`/`args`/`env` empty | "Use an http:// or https:// address." |
| env rows | `ENV_KEY_PATTERN`, unique keys | "TOKEN isn't a valid variable name." (the key is not secret, so it may be named) |
| header rows | `HEADER_NAME_PATTERN`, unique (casefold); value without CR, LF or NUL; `Authorization` together with `bearer` is refused | "That header name isn't valid." / "Use either a bearer token or an Authorization header." |
| plain values (args, non-secret env and header values, url, command) | must not contain `${` (the CLI would expand it) | "Use a secret for values with ${…}." |
| secret values | 1..`MAX_SECRET_CHARS` characters, without NUL | "That secret is too long." |
| rows | at most `MAX_ROWS` env rows and `MAX_ROWS` header rows; at most `MAX_SERVERS` servers | "Up to 50 …" |

### Secret variables

- A folder `.mcp.json` `${NAME}` resolves through `agentrun.SECRET_LOOKUP`, which M19 sets to `secretstore.lookup_var`:
  - the `var:<NAME>` secret when it is set;
  - else, for a name in `ENV_PASSTHROUGH`, Object's own environment value;
  - else `None` (missing).
- Names must fullmatch `VAR_PATTERN`. A name in `RESERVED_VARS`, starting with a `RESERVED_VAR_PREFIXES` entry (case-insensitively) or in `ENV_PASSTHROUGH` can't be set: 422 "Object can't set this variable." (our string).
- M17's `Agent.mcpServers[].missingVars`/`usable` and the `folder-mcp` contributor already read `SECRET_LOOKUP`. **Check:** they must read the module attribute at call time (`agentrun.SECRET_LOOKUP(name)`), not a copy bound at import. T5 tests this.

### The run (`backend/objectapp/mcpgateway.py`)

```python
def install() -> None
    # idempotent, called once by server.create_app (T1 wires the call; T5 fills it):
    #   agentrun.add_contributor("gateway", 35, gateway_contributor)
    #   agentrun.add_contributor("gateway-tools", 62, gateway_tools_contributor)
    #   toolcatalog.GROUP_PROVIDERS.append(server_groups)   (once)
    #   agentrun.SECRET_LOOKUP = secretstore.lookup_var

def tool_id(server: str, tool: str) -> str         # "mcp__<server>__<tool>" plus the CLI's normalisation as the T1 spike finds it
secret_env_name                                    # re-exported from mcpstore (below)

def gateway_contributor(scope: RunScope, parts: RunParts) -> None
    # nothing unless scope.purpose in GATEWAY_PURPOSES;
    # for each enabled server in file order:
    #   skip (a note) when parts.mcp_servers already has its name
    #     (the agent's folder server wins: "Skipped the MCP server 'gh': this agent's folder has one with the same name.");
    #   skip (no note) when TOOL_CACHE knows its tools and every tool_id is in the agent's toolsOff;
    #   skip (a note) when one of its secrets is missing ("Skipped the MCP server 'gh': a secret is missing. Set it again in Settings.");
    #   else parts.mcp_servers[name] = entry and parts.env |= {secret_env_name(k): value}
def gateway_tools_contributor(scope: RunScope, parts: RunParts) -> None
    # for every name in parts.mcp_servers except "object"/"object-agent" (gateway and folder servers):
    #   "mcp__<name>" in parts.allowed (once), unless it is already in parts.disallowed
    #     (M17's whole-server switch of a folder server, put there by M17's "tools" contributor);
    #   every toolsOff id starting "mcp__<name>__" in parts.disallowed (once)
```

`cli_entry` (below) lives in `mcpstore` (T3), and `mcpgateway` (T5) re-exports it. Entry shapes:

- command: `{"type":"stdio","command":c,"args":[...],"env":{"LOG_LEVEL":"info","API_KEY":"${OBJECT_MCP_…}"}}`
- url: `{"type":"http"|"sse","url":u,"headers":{"X-Api-Key":"${OBJECT_MCP_…}","Authorization":"Bearer ${OBJECT_MCP_…}"}}`
- On Windows, a command that `shutil.which` resolves to `.cmd`/`.bat` becomes command `"cmd"`, args `["/c", c, *args]`, but only if the T1 spike shows the CLI needs it.

### The Tools tab (M17's `ToolGroup`, extended)

- `toolcatalog.ToolGroup` gains `server: dict[str, Any] | None = None` (an explicit T1 change to an M17 file). `groups_out` passes it through as `server` (absent means `null`). The shape is `McpGroupStatus` below.
- `mcpgateway.server_groups(agent: AgentRecord) -> list[ToolGroup]` is appended to `GROUP_PROVIDERS`. It returns:
  - first, one group per folder server (`id` `mcp:<name>`, label `"<name> · this agent's folder"`, our string);
  - then one group per gateway server, enabled or not (`id` `mcp:<name>`, label `<name>`). A folder server's name wins on a clash, and the gateway group is then left out.
  - Each group's tools come from `TOOL_CACHE`, as `ToolEntry(tool_id(name, t), t, (tool_id(name, t),))`.
  - A folder group also keeps M17's whole-server row `ToolEntry("mcp__<name>", name, ("mcp__<name>",))` as its first row while `TOOL_CACHE` has no tools for it, or while `mcp__<name>` is in the agent's toolsOff, so a whole server switched off in M17 still shows (and can be switched back on through its group switch).
- **An explicit change to M17's `api_agents.py`.** `GET /agents/{id}/tools` puts each provider group in place of a catalogue group with the same `id`. M17's `mcp:<name>` folder groups (each holding only the whole-server row `mcp__<name>`) are then the provider's, with tools. The merge moves into `api_agents.agent_tool_groups(rec)` (the route's `groups` list), which T6's refresh route calls too. M17's `test_tools_routes` (its last group is `mcp:gh`, and its `mcp__gh` row is off) still holds unchanged.
- `POST /agents/{id}/tools/refresh` (M19, `api_mcp.py`) probes the agent's folder servers and its enabled gateway servers in parallel, puts each result in `TOOL_CACHE`, and answers the same `{groups}` as the GET.
- Cache keys:
  - `gw:<serverId>:<revision>`, so an edited server is listed again;
  - `folder:<agentId>:<name>:<sha256 of its .mcp.json entry>`.

```python
@dataclass(frozen=True)
class ProbeResult:                  # mcpprobe
    ok: bool; tools: tuple[tuple[str, str], ...]   # (name, description capped at TOOL_DESCRIPTION_MAX)
    error: str | None; elapsed_ms: int; at: str    # error already redacted
    read_only: tuple[str, ...] = ()                # names of the listed tools whose annotations.readOnlyHint is true
                                                   # (a hint only: M19 never acts on it; M24 shows it in Settings > Work)
class ToolCache:                    # mcpgateway, thread-safe, memory only
    def get(self, key: str) -> ProbeResult | None
    def put(self, key: str, result: ProbeResult) -> None
TOOL_CACHE: ToolCache
def probe_targets(agent: AgentRecord) -> dict[str, tuple[dict[str, Any], dict[str, str], Path | None]]
    # cache key -> (entry, env, cwd) for the agent's usable folder servers (cwd = its folder)
    # and its enabled gateway servers (cwd None); servers with missing secrets are not probed
```

### Probing (`backend/objectapp/mcpprobe.py`, the one network module)

```python
async def probe(entry: dict[str, Any], env: dict[str, str], *, cwd: Path | None = None,
                timeout: float = PROBE_TIMEOUT_S, redact_values: Iterable[str] = ()) -> ProbeResult
def probe_sync(entry, env, **kw) -> ProbeResult                       # runs probe in a fresh event loop (route threads)
def probe_many(targets: dict[str, tuple[dict[str, Any], dict[str, str], Path | None]], *,
               timeout: float = PROBE_TIMEOUT_S, redact_values: Iterable[str] = ()) -> dict[str, ProbeResult]   # in parallel
def expand_refs(value: Any, env: Mapping[str, str]) -> Any            # ${VAR} and ${VAR:-default}, the CLI's rule, recursively
```

- `stdio`: `mcp.client.stdio.stdio_client(StdioServerParameters(command, args, env=get_default_environment() | expanded env, cwd))`, with stderr captured to a temp file and its last `PROBE_STDERR_CHARS` characters kept.
- `http`: `mcp.client.streamable_http.streamable_http_client(url, http_client=create_mcp_http_client(headers=…))` (2.3's `streamable_http_client` takes no `headers`; the `httpx2` client from `mcp.shared._httpx_utils` carries them, and the probe closes it). `sse`: `mcp.client.sse.sse_client(url, headers=…)`.
- Then `ClientSession.initialize()` and `list_tools()`, following pagination.
- The T4 builder checks each signature against the installed `mcp` 2.3 and adapts the calls, not the Contract.
- Errors (our strings; the details are redacted):
  - the timeout: "The server didn't answer within 20 seconds.";
  - a missing command: "Couldn't start <command>: not found.";
  - an exit before it answered: "The server stopped before it answered." plus its stderr;
  - HTTP 401/403: "The server refused the credentials (401). If it needs an OAuth sign-in, Object can't do that yet; use a token or a header.";
  - other HTTP errors: "The server answered <status>.";
  - a refused connection: "Couldn't connect to <host>.".
- On timeout or failure the stdio process tree is killed.
- `redact_values` is every secret value the probe used. `secretstore.redact` replaces each one (at least 4 characters long) with `••••••` in the error text.

### `backend/objectapp/secretstore.py`

```python
KEY_PATTERN = r"^[a-z0-9]+:[^\x00-\x1f]{1,200}$"
class SecretStore:
    def __init__(self, state: Path | None = None) -> None   # state_dir() when None
    def get(self, key: str) -> str | None                    # never writes; an unreadable file reads as empty
    def has(self, key: str) -> bool
    def keys(self, prefix: str = "") -> list[str]
    def set(self, key: str, value: str) -> None              # ValueError for a bad key or value (never naming the value)
    def set_many(self, values: dict[str, str], remove: Iterable[str] = ()) -> None   # one atomic write
    def delete(self, key: str) -> bool
    def delete_prefix(self, prefix: str) -> int
    def values(self) -> list[str]                            # for redaction only
    def __repr__(self) -> str                                # never shows a value
def redact(text: str, values: Iterable[str]) -> str
def var_key(name: str) -> str                                # "var:" + name
def check_var_name(name: str) -> None                        # ValueError("Object can't set this variable.") / ("That isn't a valid variable name.")
def lookup_var(name: str) -> str | None                      # agentrun.SECRET_LOOKUP (above)
```

The module-level lock is held around every read-modify-write, as `spaces._lock` is.

### `backend/objectapp/mcpstore.py`

```python
class McpError(Exception): status: int; message: str
class McpNotFound(McpError)    # 404
class McpConflict(McpError)    # 409; .current_revision (None for a name clash)
class McpInvalid(McpError)     # 422
class McpReadOnly(McpError)    # 423
class MissingSecret(Exception): keys: list[str]

@dataclass
class McpServerRecord:
    data: dict[str, Any]; revision: str
    def to_api(self, secrets: SecretStore, last_test: ProbeResult | None) -> dict[str, Any]   # the McpServer shape

class McpStore:
    def __init__(self, state: Path | None = None, secrets: SecretStore | None = None) -> None
    def list(self) -> list[McpServerRecord]                  # file order; never writes
    def read_only_reason(self) -> str | None
    def get(self, server_id: str) -> McpServerRecord         # McpNotFound
    def create(self, inp: McpServerInput) -> McpServerRecord
    def save(self, server_id: str, inp: McpServerInput, base_revision: str) -> McpServerRecord
    def delete(self, server_id: str) -> None                 # also delete_prefix("mcp:<id>:")
def clean_input(inp: McpServerInput, existing: McpServerRecord | None,
                others: list[McpServerRecord], secrets: SecretStore) -> tuple[dict[str, Any], dict[str, str], list[str]]
    # (stored entry, secret values to set, secret keys to remove). Raises McpInvalid / McpConflict.
def cli_entry(server: dict[str, Any], secrets: SecretStore) -> tuple[dict[str, Any], dict[str, str]]
    # (entry with ${OBJECT_MCP_…} references, {env name: value}). Raises MissingSecret (key names only).
def secret_env_name(secret_key: str) -> str        # ENV_PREFIX + sha256(secret_key)[:12].upper(), e.g. "OBJECT_MCP_3FA9C01B22D4"
```

- `mcpgateway` re-exports `cli_entry` and `secret_env_name`.
- **Save order:** `secrets.set_many` first, then the servers file. If the servers write fails, the secrets just set are removed again and the old values put back. A row turned from secret to plain, or removed, has its secret removed. A server's secrets and its entry change together or not at all.

### TypeScript (T1, `frontend/src/api/types.ts`)

```ts
export type McpServerKind = 'command' | 'url'
export type McpTransport = 'http' | 'sse'
export interface McpEnvRow { key: string; value: string | null; secret: boolean; set: boolean }      // a secret row: value null; set = stored
export interface McpHeaderRow { name: string; value: string | null; secret: boolean; set: boolean }
export interface McpToolInfo { name: string; description: string }
export interface McpTestResult { ok: boolean; tools: McpToolInfo[]; error: string | null; elapsedMs: number; at: string }
export interface McpServer {
  id: string; name: string; enabled: boolean; kind: McpServerKind
  command: string | null; args: string[]; env: McpEnvRow[]
  transport: McpTransport | null; url: string | null; headers: McpHeaderRow[]; bearer: boolean
  createdAt: string; updatedAt: string; revision: string
  missingSecrets: string[]                 // row keys/header names whose secret is gone (secrets.json lost); usable = []
  lastTest: McpTestResult | null           // from TOOL_CACHE (this run of Object only)
}
export interface McpServerInput {
  name: string; enabled: boolean; kind: McpServerKind
  command?: string | null; args?: string[]; env?: { key: string; value?: string | null; secret: boolean }[]
  transport?: McpTransport | null; url?: string | null; headers?: { name: string; value?: string | null; secret: boolean }[]
  bearer?: string | null; bearerAction?: 'keep' | 'set' | 'remove'
}
export interface McpServersAnswer { servers: McpServer[]; readOnlyReason: string | null }
export interface SecretVarUse { agentId: string; agentName: string; server: string }
export interface SecretVar { name: string; set: boolean; settable: boolean; usedBy: SecretVarUse[] }
export interface McpGroupStatus {
  source: 'gateway' | 'folder'; serverId: string | null; name: string
  status: 'ok' | 'error' | 'unknown' | 'disabled' | 'needsSecrets'
  error: string | null; fetchedAt: string | null; missingVars: string[]
}
// M17 types gain: ToolGroup.server?: McpGroupStatus | null
// ChangeKind gains 'mcpServers'
```

`api/client.ts` (T1) adds:

- `mcpServers()`, `createMcpServer(input)`, `saveMcpServer(id, input, baseRevision)`, `deleteMcpServer(id)`, `testMcpServer(id)`
- `mcpSecrets()`, `setMcpSecret(name, value)`, `deleteMcpSecret(name)`
- `refreshAgentTools(agentId): Promise<ToolGroup[]>` (the `groups` of the answer, as M17's `agentTools(id)`)

`createMcpServer` passes `request`'s `on409` hook, throwing `ApiError(409, detail)`, so the name clash's message reaches the dialog (the client otherwise drops a 409's text). `saveMcpServer`'s stale-revision 409 is the usual `RevisionConflictError`. The back end's name-clash 409 body is `{detail}` with no `currentRevision` key; the stale-revision 409 is `{detail, currentRevision}` (M17's `api_agents._fail` shape).

`mcpServers` joins the client's `RESYNC_EVENTS`. `test/mockApi.ts` (T1) adds the helpers `mcpServer()`, `mcpTestResult()`, `secretVar()` and the mocks for every method above.

`frontend/src/mcp/mcpText.ts` (T1) holds every string below as `MCP_TEXT`, so the two front-end lanes share one table.

### Routes (T6 fills `backend/objectapp/api_mcp.py`; T1 mounts the stub)

| Route | Body / query | Answer | Errors |
|---|---|---|---|
| `GET /mcp-servers` | | `McpServersAnswer` (file order). Never writes. | |
| `POST /mcp-servers` | `{server: McpServerInput, clientId?}` | 201 `McpServer` | 409 (name taken), 422, 423 |
| `PUT /mcp-servers/{id}` | `{server, baseRevision, clientId?}` | `McpServer` | 404, 409 `{currentRevision}`, 422, 423 |
| `DELETE /mcp-servers/{id}?clientId=` | | `{ok: true}` (its secrets are deleted too) | 404, 423 |
| `POST /mcp-servers/{id}/test` | | `McpTestResult` (also for a disabled server; result put in `TOOL_CACHE`) | 404; 422 "A secret is missing. Set it again." |
| `GET /mcp-secrets` | | `{vars: SecretVar[]}`: every `var:` secret plus every `${NAME}` an agent folder's `.mcp.json` uses, by name. `usedBy` comes from each listed local agent's folder (read only). Never writes. | |
| `PUT /mcp-secrets/{name}` | `{value, clientId?}` | `{name, set: true}` | 422 (name rule, empty, too long) |
| `DELETE /mcp-secrets/{name}?clientId=` | | `{ok: true}` | 404 |
| `POST /agents/{id}/tools/refresh` | | `{groups: ToolGroup[]}` (as `GET /agents/{id}/tools`) | 404 |

- Every route stays available while "Hide AI features" is on (as M17's agent routes do); only the UI hides the section.
- A 422 message never holds a submitted value.

Events:

- `ChangeEvent("mcpServers", <serverId or "secrets">, <revision or None>, origin=clientId)` on create, save, delete, secret set and secret delete. Also, because a missing var changes `Agent.mcpServers`, `ChangeEvent("agents", "secrets", None, origin=clientId)` on a secret set or delete.
- `mcpServers` joins `watcher.ChangeEvent.kind` and `server.RESYNC_EVENTS` (T1).

### Labels (our strings, in `MCP_TEXT`)

Settings > Integrations, a new group after M11's token groups ("API tokens", "New token", "Connect an AI assistant"):

- Heading "MCP servers". Help: "Outside MCP servers every agent on this computer can use. Each agent can switch them, or single tools, off on its Tools tab."
- Empty list: "No MCP servers yet." Button: "Add MCP server".
- Row: the switch (enabled), name, summary ("npx -y some-mcp-server" / "https://host/path · HTTP" / "· SSE"), the last test ("12 tools" / "Test failed: <error>" / nothing), and the buttons "Test", "Edit" and "Delete". Delete turns into "Confirm delete" (as Revoke does), with the help line "Agents lose this server at once. Its secrets are deleted."
- Dialog: titles "Add MCP server" / "Edit MCP server". Fields:
  - "Name"; when editing, read-only with the hint "A server's name can't be changed.";
  - "Connect by": "Command" or "URL";
  - for Command: "Command", "Arguments" (one per line), "Environment" (rows: Name, Value, "Secret" checkbox, on by default for new rows);
  - for URL: "URL", "Transport" ("HTTP", "SSE"), "Headers" (rows: Name, Value, "Secret", on by default), "Bearer token" (a password field);
  - "Turned on".
  Buttons "Cancel" and "Save". A stored secret shows as "•••••• saved" with "Replace". An empty replacement keeps it.
- Test result, under the row: "Tools (12)", then one line each with the name and the description. On failure, the error. While it runs, "Testing…".
- "Secret variables" (below the servers), with the help "Values for ${NAME} in agent folders' .mcp.json files, kept on this computer only." Each row shows the name, "Set" or "Missing", "Used by Researcher (github)", and the buttons "Set…" or "Replace…" and "Delete". A name Object can't set shows "Comes from this computer's environment".
- Set dialog: title "Set NAME", a password field "Value", and the buttons "Cancel" and "Save". The value is never shown again.

On the agent page:

- Profile: M17's "Needs secrets: GH_TOKEN" gains a "Set…" button per variable, which opens the Set dialog.
- Tools tab group lines: "Listing tools…"; "Couldn't list tools: <error>"; "Turned off in Settings > Integrations" (its switches disabled); "Needs secrets: GH_TOKEN"; "No tools".

### Our choices (summary)

The full list is in "Our calls" at the end.

## Tasks

### Task 1: Contract, fakes and CLI spike (first, alone)

**Files:**

- Create:
  - `backend/objectapp/mcpmodel.py`
  - stubs with the Contract signatures that raise `NotImplementedError`: `backend/objectapp/secretstore.py`, `mcpstore.py`, `mcpprobe.py`, `mcpgateway.py` (its `install()` a no-op until T5)
  - `backend/objectapp/api_mcp.py`, a stub `def router(ctx) -> APIRouter` with no routes
  - `backend/tests/fake_mcp_server.py`
  - `backend/tests/test_m19_contract.py`, `backend/tests/test_m19_live_cli.py`
  - `frontend/src/mcp/mcpText.ts`
  - `docs/superpowers/plans/m19-cli-spike.md`
- Modify:
  - `backend/objectapp/server.py`: mount `api_mcp.router(ctx)` (beside `api_agents.router(ctx)`, before it); call `mcpgateway.install()` in `create_app` next to M18's `learnhooks.install()`; add `"mcpServers"` to `RESYNC_EVENTS` (after `"agentLearning"`).
  - `backend/objectapp/watcher.py`: `"mcpServers"` in `ChangeEvent.kind` (and its docstring: the server id, or `secrets`).
  - `backend/objectapp/toolcatalog.py` (M17): `ToolGroup.server` and its pass-through in `groups_out`. Nothing else changes.
  - `backend/tests/fake_claude.py` (the M18 version)
  - `backend/tests/test_audit2_api.py`: `test_event_hub_bounds_a_slow_subscriber`'s resync kinds gain `"mcpServers"` (9 events become 10, and its slice and comment follow).
  - `frontend/src/api/types.ts`, `frontend/src/api/client.ts` (methods and `RESYNC_EVENTS`), `frontend/src/test/mockApi.ts`
  - `frontend/src/api/client.test.ts`: "test agentLearning is a resync event"'s kind list gains `'mcpServers'`.

**Interfaces.** Produces everything in the Contract marked T1, plus the two fakes, which T4, T5, T6 and T9 consume.

**Fake MCP server** (`backend/tests/fake_mcp_server.py`, built on the `mcp` server library's `MCPServer` as `mcp_server.py` is; synthetic only; documented in its docstring):

- Tools:
  - `echo(text)` answers `text` (annotated `readOnlyHint: true`);
  - `add(a, b)` answers the sum;
  - `whoami()` answers the value of the env var named by `--require-env`, so a test can prove the secret arrived (tests compare it and never print it);
  - with `--many N`, `t0…t<N-1>`;
  - with `--odd-name`, a tool named `get-item.v2`.
- Modes:
  - stdio (default);
  - `--http PORT` and `--sse PORT` on `127.0.0.1` only;
  - `--require-bearer TOKEN`: 401 without it;
  - `--require-env NAME`: exits 3 at start with `missing NAME` on stderr when the variable is unset;
  - `--print-env-and-exit`: prints every environment variable to stderr and exits 1 (a redaction test);
  - `--hang`: never answers `initialize`;
  - `--junk`: writes non-JSON lines on stdout first.
- `serve_in_thread(mode, **kw) -> (url, stop)` starts the HTTP or SSE modes for tests on a free port.

**Fake `claude` additions** (M10/M16/M17/M18 markers unchanged). M18 already built most of what M19 needs:

- Already there (M18), kept as it is: the `init` event's `mcp_servers` lists `{"name", "status": "connected"}` for each server in `--mcp-config` (without connecting), and its `tools` adds each allowed `mcp__…` name. `FAKE:mcp:<server>:<tool>[:<json args>]` (one per line) fills the stdio entry's `command`, `args` and `env` with the fake's own `${VAR}` rule (`_fill`, written from the CLI's documented form, not imported from `mcpprobe`) against its environment, connects with the `mcp` client library, calls the tool, and emits a `tool_use` named `mcp__<server>__<tool>` and its `tool_result`. It is denied ("Permission to use mcp__<server>__<tool> has been denied.") when that name or `mcp__<server>` is in `--disallowedTools` or the `--settings` deny list, or when `--allowedTools` is given and holds neither. That is `dontAsk`'s rule.
- M19 adds:
  - `FAKE:mcp` on a `{"type": "http"}` or `{"type": "sse"}` entry: `url` and `headers` filled with `_fill`, then `streamable_http_client` (headers through `create_mcp_http_client`) or `sse_client`. Today such an entry answers "No such tool available".
  - `_fill` also takes `${VAR:-default}`.
  - The log line gains `mcpServers`: the names in the config.

**Steps.**

- [ ] **Step 1: failing tests** in `test_m19_contract.py`:
  - `test_model_constants`:
    - `NAME_PATTERN` matches `github` and `a_b-1` but not `my server`, `a/b`, `""` or 65 characters;
    - `RESERVED_NAMES == ("object", "object-agent")` equals `(toolcatalog.OBJECT_SERVER, toolcatalog.AGENT_SERVER)`;
    - `GATEWAY_PURPOSES[:3] == ("chat", "delegate", "schedule")` (M24 appends after them, so the test doesn't assume they are last);
    - `PROBE_TIMEOUT_S == 20`.
  - `test_server_file_keeps_unknown_keys`: `McpServerFile.model_validate({... , "extra": [1]}).model_dump()` keeps `extra`.
  - `test_tool_group_server_field`: `toolcatalog.groups_out([ToolGroup("mcp:x", "x", (), server={"status": "ok"})], [])[0]["server"] == {"status": "ok"}`. A group without it gives `server: None`. M17's `test_m17_contract.py` still passes.
  - `test_stub_router_mounted_and_resync`: `create_app` imports `api_mcp` and calls `mcpgateway.install` (patched to count, once); `"mcpServers" in server.RESYNC_EVENTS`.
  - `test_fake_mcp_server_modes`: stdio lists `echo`, `add` and `whoami` through `mcp.client.stdio`. `--http` with `--require-bearer s3cret-http` lists them with the header and answers 401 without it.
  - `test_fake_claude_mcp_marker`: run the fake with a `--mcp-config` naming the stdio fake (`env: {"FAKE_KEY": "${OBJECT_MCP_TEST}"}`), `OBJECT_MCP_TEST=s3cret-stdio` in its environment, `--allowedTools mcp__fake` and the prompt `FAKE:mcp:fake:whoami`. The `tool_result` is the secret. With `--disallowedTools mcp__fake__whoami` it is the denial. The same call on an `{"type": "http"}` entry for the `--http` fake with `headers: {"Authorization": "Bearer ${OBJECT_MCP_TEST}"}` and `--require-bearer` answers too, and the log line's `mcpServers` names the config's servers.
  - The resync tests: `test_audit2_api.py::test_event_hub_bounds_a_slow_subscriber` and `client.test.ts` "test agentLearning is a resync event" expect `mcpServers` last.
  - Front end: `npx tsc -b --noEmit`; `mcpText.test.ts` "test every label is a non-empty string".
- [ ] **Step 2:** run them; they fail.
- [ ] **Step 3:** implement the Contract signatures, the stubs and the fakes.
- [ ] **Step 4: the CLI spike.** `test_m19_live_cli.py` is skipped unless `OBJECT_LIVE_CLAUDE=1`.
  - Setup: each test builds a temp agent folder under a temp `OBJECT_STATE_DIR` with M17's `agentfiles.write_skeleton`. It runs the real `claude` with M17's `CLI_FLAGS`, `--model haiku`, `--no-session-persistence` and a hand-built `--mcp-config` temp file naming the fake MCP server, and reads the stream.
  - `test_mcp_config_shapes_and_expansion`:
    - a `{"type":"stdio"}` entry whose `env` is `{"FAKE_KEY":"${OBJECT_MCP_T1}"}` and whose args include `--require-env FAKE_KEY`;
    - a `{"type":"http"}` entry on the fake's `--http` port with `headers: {"Authorization": "Bearer ${OBJECT_MCP_T2}"}` and `--require-bearer`;
    - a `{"type":"sse"}` entry likewise;
    - the values are only in the CLI's environment. The `init` event shows each server connected, and its `tools` include `mcp__<name>__echo`. A prompt asking the model to call `whoami` on each gets the secret back in the `tool_result` (compared, not printed).
  - `test_only_listed_servers_reach_a_run`: with `--strict-mcp-config`, the `init` `mcp_servers` names are exactly the config's names. The test lists no file in `~/.claude`; the exact equality is the proof.
  - `test_server_allow_and_tool_deny`: `--allowedTools mcp__fake` and `--disallowedTools mcp__fake__add`, with a prompt to call `echo`, then `add`. `echo` succeeds; `add`'s `tool_result` is a permission error.
  - `test_windows_cmd_shim` (Windows only): a stdio command that is a synthetic `fake-mcp.cmd` in a temp folder (it runs the fake server with `sys.executable`). The spike records whether the CLI starts it as given. If it doesn't, the spike records that `cli_entry` wraps `.cmd`/`.bat` commands in `cmd /c`.
  - `test_tool_name_normalisation`: with `--odd-name`, the spike records the CLI's name for `get-item.v2`; `mcpgateway.tool_id` uses that rule.
  - **Stop-and-ask:** if `--strict-mcp-config` lets any other server in, or if `${VAR}` isn't expanded in any of `env`, `args` or `headers` (so a secret would have to be written into `mcp.json`), the build stops after T1. The builder writes the finding in `m19-cli-spike.md` and asks Gene. No later task runs.
  - `m19-cli-spike.md` records: the CLI version; each check's result; the three entry shapes as accepted; the tool-name rule; the `.cmd` finding; and the OAuth finding (no OAuth for `--mcp-config` servers without `claude mcp login`, which writes Gene's Claude Code config, so it is not offered).
- [ ] **Step 5:** `uv run pytest backend/tests/test_m19_contract.py backend/tests/test_m17_contract.py backend/tests/test_m18_contract.py backend/tests/test_audit2_api.py backend/tests/test_m17_routes.py backend/tests/test_m17_agentrun.py -q`, `npx vitest run src/mcp src/api` and `npx tsc -b --noEmit` pass. The live spike passed once with `OBJECT_LIVE_CLAUDE=1`.
- [ ] **Step 6:** commit `feat(m19): contract, fake MCP server and CLI spike`. The message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Task 2: The secrets file (Lane A)

**Files:**

- Fill: `backend/objectapp/secretstore.py`
- Create: `backend/tests/test_m19_secrets.py`

**Interfaces.**

- Consumes: `appstate.state_dir`, `textfile.atomic_write`, `jsonstore.dump_json`, `mcpmodel`.
- Produces: `SecretStore`, `redact`, `var_key`, `check_var_name`, `lookup_var` (Contract).

**Steps.**

- [ ] **Step 1: failing tests** (state dir = `tmp_path/state`):
  - `test_reads_never_write`: on an empty state dir, `get`, `has`, `keys` and `values` answer empty, and the state dir still holds no file.
  - `test_set_get_delete`:
    - `set("mcp:01J…:bearer", "s3cret-a")` writes `secrets.json` = `{"version": 1, "secrets": {…}}` with a trailing LF;
    - `get` gives the value back;
    - `delete_prefix("mcp:01J…:")` removes it and answers 1;
    - on POSIX the file mode is `0o600` (`skipif` on Windows).
  - `test_set_many_is_one_write`: `set_many({"a:1": "x", "a:2": "y"}, remove=["a:3"])` replaces the file once (patched `atomic_write` called once).
  - `test_bad_keys_and_values`: the key `"no-colon"` raises `ValueError`. So do a value of 16,385 characters and a value with NUL. No exception text contains the value.
  - `test_repr_hides_values`: `repr(store)` and `str(store)` hold no value after a `set`.
  - `test_unreadable_file_is_kept_aside`: `secrets.json` = `"{nope"`. `get` gives None and writes nothing. The next `set` copies the bad file to `secrets.unreadable-*.json` first.
  - `test_var_names`:
    - `check_var_name` accepts `GH_TOKEN` and `api_key`;
    - it refuses with "Object can't set this variable.": `PATH`, `path`, `CLAUDE_CONFIG_DIR`, `ANTHROPIC_API_KEY`, `OBJECT_API_TOKEN`, `HOME`, `NODE_OPTIONS`;
    - it refuses with "That isn't a valid variable name.": `a-b`, `X=Y`, `1A`, `""`, NUL, 65 characters.
  - `test_lookup_var`:
    - `lookup_var("GH_TOKEN")` is None, then the value after `set(var_key("GH_TOKEN"), …)`;
    - `lookup_var("USERPROFILE")` (or `HOME`) is Object's environment value;
    - `lookup_var("PATH")` is None.
  - `test_redact`: `redact("Bearer s3cret-abc failed", ["s3cret-abc"]) == "Bearer •••••• failed"`. Values shorter than 4 characters are left alone. The longest value is replaced first when one value contains another.
  - `test_concurrent_sets`: 20 threads setting distinct keys leave 20 keys.
- [ ] **Step 2-4:** fail, implement, pass (`uv run pytest backend/tests/test_m19_secrets.py -q`).
- [ ] **Step 5:** commit `feat(m19): state-dir secrets file`.

### Task 3: The MCP servers file (Lane A, after T2)

**Files:**

- Fill: `backend/objectapp/mcpstore.py`
- Create: `backend/tests/test_m19_store.py`

**Interfaces.**

- Consumes: `SecretStore` (T2), `mcpmodel`, `ids.new_ulid`, `textfile.atomic_write`, `jsonstore.dump_json`.
- Produces: `McpStore`, `McpServerRecord`, `clean_input`, `cli_entry`, `secret_env_name`, `MissingSecret` and the `Mcp*` errors (Contract).

**Steps.**

- [ ] **Step 1: failing tests:**
  - `test_list_never_writes`: an empty state dir lists `[]` and holds no file afterwards.
  - `test_create_command_server`:
    - `create(McpServerInput(name="fake", kind="command", command="python", args=["x.py"], env=[{"key":"LOG","value":"info"},{"key":"FAKE_KEY","value":"s3cret-1","secret":True}]))` writes `mcp-servers.json`;
    - its `env` rows are `{"key":"LOG","value":"info","secret":false}` and `{"key":"FAKE_KEY","secret":true}`;
    - `s3cret-1` is in `secrets.json` under `mcp:<id>:env:FAKE_KEY`, and not in `mcp-servers.json`;
    - `to_api` gives the secret row `value: None, set: True`.
  - `test_create_url_server_with_bearer_and_header`: the bearer goes under `mcp:<id>:bearer` and the header under `mcp:<id>:header:x-api-key`; `bearer: true` is stored; neither value is in the servers file.
  - `test_validation_table`: one parametrised test over every row of the Contract's validation table:
    - names `object`, `object-agent`, `Object`, `my server`, `a/b`, 65 characters, and `GitHub` after `github` (409);
    - env keys `a-b` and `X=Y`; header names with a space or a colon; header values with `\r\n`;
    - URLs `file:///c:/x`, `javascript:alert(1)`, `ftp://h` and `http://` (no host);
    - commands `""` and `"-p"`;
    - a plain arg `${OBJECT_API_TOKEN}`, a plain env value `${HOME}`, a plain header value `${X}`;
    - `bearer` together with an `Authorization` header; a 16,385-character secret; 51 args; the 51st server.
    - Each is a 422 (or 409) with the table's message. No message contains the submitted value (checked for the secret and the `${…}` cases).
  - `test_save_keeps_secrets_and_checks_revision`:
    - a `PUT`-style `save` with the secret row's `value=None` keeps the stored secret;
    - `bearerAction="remove"` deletes `mcp:<id>:bearer`;
    - turning a secret row plain (with a value) deletes its secret;
    - removing a row deletes its secret;
    - a stale `base_revision` raises `McpConflict` with `current_revision`;
    - a changed name raises `McpInvalid` "A server's name can't be changed.";
    - a new secret row with `value=None` raises "Enter a value for TOKEN.".
  - `test_save_rolls_back_secrets_when_the_file_write_fails`: with `atomic_write` patched to raise on `mcp-servers.json`, the old secret value is back and no new key is left.
  - `test_unknown_keys_kept`: a file with a top-level `"note": 1` and a server-level `"x": [1]` keeps both after a save of another server.
  - `test_newer_schema_is_read_only`: `schemaVersion: 2` lists with `read_only_reason()` "These MCP servers were saved by a newer version of Object."; `create`, `save` and `delete` raise `McpReadOnly`.
  - `test_unreadable_file_is_kept_aside`: as in T2.
  - `test_delete_removes_its_secrets`: after `delete`, `secrets.keys("mcp:<id>:")` is empty and other servers' secrets remain.
  - `test_cli_entry_shapes`:
    - command: `{"type":"stdio","command":"python","args":["x.py"],"env":{"LOG":"info","FAKE_KEY":"${OBJECT_MCP_<12 hex>}"}}`, with env `{"OBJECT_MCP_<12 hex>": "s3cret-1"}`;
    - url http: `{"type":"http","url":…,"headers":{"X-Api-Key":"${…}","Authorization":"Bearer ${…}"}}`; `transport="sse"` gives `"type":"sse"`;
    - `secret_env_name` is stable and starts with `OBJECT_MCP_`;
    - with `secrets.json` deleted, `cli_entry` raises `MissingSecret(["FAKE_KEY"])`, and `to_api` gives `missingSecrets == ["FAKE_KEY"]`;
    - the `.cmd` wrap, if T1 found it needed: a `.cmd` command on Windows gives `command "cmd"`, `args ["/c", …]`.
- [ ] **Step 2-4:** fail, implement, pass (`uv run pytest backend/tests/test_m19_store.py backend/tests/test_m19_secrets.py -q`).
- [ ] **Step 5:** commit `feat(m19): MCP servers file with secrets kept apart`.

### Task 4: Listing a server's tools (Lane B)

**Files:**

- Fill: `backend/objectapp/mcpprobe.py`
- Create: `backend/tests/test_m19_probe.py`

**Interfaces.**

- Consumes: the `mcp` client library, `secretstore.redact`, `mcpmodel`, `fake_mcp_server` (T1).
- Produces: `probe`, `probe_sync`, `probe_many`, `expand_refs`, `ProbeResult` (Contract).

**Steps.**

- [ ] **Step 1: failing tests** (entries in `cli_entry`'s shapes, written by hand so this lane doesn't wait for T3):
  - `test_expand_refs`:
    - `${A}` gives the value; `${A:-d}` gives `d` when A is unset; an unset `${A}` stays as written (the CLI's behaviour as the T1 spike found it);
    - lists and dicts are expanded recursively, keys left alone.
  - `test_stdio_lists_tools`: the stdio fake with `--require-env FAKE_KEY` and env `{"FAKE_KEY": "${OBJECT_MCP_X}"}`, `OBJECT_MCP_X=s3cret-p` gives `ok`, the tools `add`, `echo` and `whoami` with descriptions, `elapsed_ms > 0` and `error is None`.
  - `test_http_and_sse_list_tools`: `--http` with `--require-bearer` and the header `Authorization: Bearer ${OBJECT_MCP_Y}` lists the tools. `--sse` likewise.
  - `test_failure_modes`, parametrised (each `ok is False` with the Contract's message):
    - a command that doesn't exist: "Couldn't start … not found.";
    - `--hang`, with the timeout patched to 1 s: the timeout message, and the child's pid gone afterwards (checked with `psutil` if available, else `os.kill(pid, 0)`);
    - `--junk`: tools still listed, or a clear error, never an exception;
    - `--require-env` without the env: "The server stopped before it answered." plus `missing FAKE_KEY`;
    - a refused port: "Couldn't connect to 127.0.0.1.";
    - 401 without the bearer: the OAuth message; 404 (a wrong path) gives "The server answered 404.";
    - `--many 0` gives `ok` with no tools; `--many 500` gives 500 tools (pagination followed).
  - `test_descriptions_capped`: a 1,000-character description comes back as 300 characters.
  - `test_read_only_hints`: the stdio fake gives `read_only == ("echo",)`; a server with no annotations gives `()`.
  - `test_errors_are_redacted`:
    - `--print-env-and-exit` with `FAKE_KEY=s3cret-redact-me`: the error holds its stderr tail, and `s3cret-redact-me` appears in neither the error nor `caplog`;
    - an HTTP server answering 401 with a body echoing the header gives no bearer value in the error.
  - `test_probe_many_runs_in_parallel`: three `--hang` targets with a 1 s timeout finish in under 2.5 s, each with the timeout error.
  - `test_probe_writes_nothing`: the state dir, `cwd` and the test's temp folders hold the same files before and after (the stderr temp file is removed).
- [ ] **Step 2-4:** fail, implement, pass (`uv run pytest backend/tests/test_m19_probe.py -q`).
- [ ] **Step 5:** commit `feat(m19): list an MCP server's tools over stdio, HTTP and SSE`.

### Task 5: Gateway servers in every run, and the Tools tab groups (Lane A, after T3)

**Files:**

- Fill: `backend/objectapp/mcpgateway.py`
- Modify: `backend/objectapp/api_agents.py` (M17): in `GET /agents/{id}/tools`, a provider group replaces a catalogue group with the same `id`, and the route's merge moves into the module-level `agent_tool_groups(rec: AgentRecord) -> list[dict[str, Any]]` that T6 calls. This is the one change to that file.
- Create: `backend/tests/test_m19_gateway_run.py`

**Interfaces.**

- Consumes:
  - `McpStore`, `cli_entry`, `secret_env_name`, `MissingSecret` (T3); `SecretStore`, `lookup_var` (T2);
  - M17's `agentrun.add_contributor`, `RunScope`, `RunParts`, `build_run`, `SECRET_LOOKUP`;
  - `toolcatalog.ToolGroup`/`ToolEntry`/`GROUP_PROVIDERS`;
  - `agentfiles.folder_mcp_servers`/`var_refs`, `AgentRecord`.
- Produces: `install`, `gateway_contributor`, `gateway_tools_contributor`, `server_groups`, `probe_targets`, `tool_id`, `ToolCache`, `TOOL_CACHE` (Contract).

**Steps.**

- [ ] **Step 1: failing tests.** Use M17's `build_run` with a temp agent folder and a temp state dir, and call `install()` in a fixture. The fixture also undoes it: it restores M17's contributors, `GROUP_PROVIDERS` and `SECRET_LOOKUP`.
  - `test_install_is_idempotent`: two calls leave `contributors()` holding `gateway` at 35 and `gateway-tools` at 62 once each (and `gateway-tools` before M18's `review-tools` at 68), and `GROUP_PROVIDERS` holding `server_groups` once. `agentrun.SECRET_LOOKUP is secretstore.lookup_var`.
  - `test_enabled_servers_join_the_run`:
    - two enabled servers and one disabled;
    - `RunCommand.mcp_config["mcpServers"]` holds both enabled ones (with `object` and `object-agent` kept) and not the disabled one;
    - `--strict-mcp-config` is still in `args`;
    - `allowed` holds `mcp__<name>` for each;
    - `env` holds each `OBJECT_MCP_…` value.
  - `test_secret_values_never_in_files_args_or_logs`: servers with an env secret, a header secret and a bearer token, plus a folder `.mcp.json` server with `${GH_TOKEN}` set as a `var:` secret. None of the three values, nor `GH_TOKEN`'s, appears in:
    - any file under `RunCommand.tmp` (`mcp.json`, `run-settings.json`, `append.md`);
    - `args`;
    - `RunParts.notes`;
    - `caplog` at DEBUG;
    - the agent folder;
    - `agent.json`.
    They appear only in `env`.
  - `test_switches_filter_the_run`:
    - with `TOOL_CACHE` holding `echo` and `add` for server `fake`, toolsOff `["mcp__fake__add"]` puts `mcp__fake__add` in `disallowed` and keeps `fake` in the config;
    - toolsOff with both left `fake` out of the config;
    - with the cache empty (after a restart), toolsOff with both keeps `fake` in the config and both in `disallowed`;
    - a tool the cache doesn't know is in neither list, so it runs (new tools on).
  - `test_folder_server_off_tools_are_denied`: a folder `.mcp.json` server `gh` and toolsOff `["mcp__gh__create_issue"]` give `mcp__gh__create_issue` in `disallowed` and `mcp__gh` in `allowed` once. This covers the gap in M17's `run_tool_lists`. With toolsOff `["mcp__gh"]` (M17's whole-server switch), `mcp__gh` is in `disallowed` and not in `allowed`.
  - `test_disabled_and_clashing_servers_left_out`:
    - a gateway server named `gh` and a folder server `gh`: the folder's entry is in the config, plus the note "Skipped the MCP server 'gh': this agent's folder has one with the same name.";
    - a gateway server whose secret was deleted from `secrets.json` is left out, with the missing-secret note;
    - other servers are unaffected.
  - `test_purposes_without_gateway`: `purpose` `"proposal"`, `"review"` and `"curator"` get no gateway server and no `OBJECT_MCP_` env; `"chat"`, `"delegate"` and `"schedule"` do.
  - `test_folder_vars_resolve_from_secrets`:
    - M17's `Agent.mcpServers` for a folder needing `${GH_TOKEN}` is `missingVars: ["GH_TOKEN"], usable: False`, then `[]`/`True` after `SecretStore().set("var:GH_TOKEN", …)`, with no restart. This is the call-time read of `SECRET_LOOKUP`;
    - the next run includes `gh`, with the value in `env["GH_TOKEN"]` only;
    - a folder needing `${USERPROFILE}` (or `${HOME}`) is usable without a secret.
  - `test_server_groups`:
    - for an agent with folder server `gh` and gateway servers `fake` (enabled, cache `echo`/`add`) and `off` (disabled), the groups are, in order, `mcp:gh` (label `"gh · this agent's folder"`, `server.source "folder"`), `mcp:fake` and `mcp:off` (`server.status "disabled"`);
    - `fake`'s rows are `mcp__fake__add` and `mcp__fake__echo`, with `on` reflecting toolsOff;
    - with no cache, `status "unknown"`; a gateway group then has no rows, and a folder group only M17's whole-server row `mcp__gh`;
    - with the cache filled and toolsOff `["mcp__gh"]`, the folder group keeps the `mcp__gh` row (off) before its tool rows;
    - a folder server missing a var gives `status "needsSecrets"` and `missingVars`.
  - `test_tools_route_uses_provider_groups`: M17's `GET /agents/{id}/tools` answers `mcp:gh` once, with the provider's rows, and M17's `test_tools_routes` still passes.
  - `test_probe_targets`: the folder servers have `cwd` = the agent folder and the gateway ones `None`; a server with missing secrets isn't a target; the keys follow the Contract's cache keys (an edited server gets a new key).
  - `test_fence_covers_the_state_files`: M17's `fence_rules` output holds a `Read(...)` rule that matches `<state>/secrets.json` and `<state>/mcp-servers.json` under the CLI's documented matching (the M17 fake's matcher, used directly).
- [ ] **Step 2-4:** fail, implement, pass (`uv run pytest backend/tests/test_m19_gateway_run.py backend/tests/test_m17_agentrun.py backend/tests/test_m17_routes.py -q`; M17's tests unchanged).
- [ ] **Step 5:** commit `feat(m19): outside MCP servers join every agent run, filtered by its switches`.

### Task 6: Routes (Lane B, after T4 and T5)

**Files:**

- Fill: `backend/objectapp/api_mcp.py`
- Create: `backend/tests/test_m19_routes.py`

**Interfaces.**

- Consumes: `McpStore` (T3), `SecretStore` (T2), `mcpprobe.probe_sync`/`probe_many` (T4), `mcpgateway.TOOL_CACHE`/`probe_targets`/`server_groups` (T5), M17's `AgentRegistry` (`list()`, `get(id)`, `local_folders()`), `toolcatalog.groups_out`, and `api_agents.agent_tool_groups` (T5), so the refresh answer equals the GET.
- Produces: the routes table and the `mcpServers` events.

**Steps.**

- [ ] **Step 1: failing tests** (the app's `TestClient`, a temp state dir, a fixture space, and the fake MCP server):
  - `test_crud_routes`: every row of the routes table with its codes:
    - `POST` 201, then `GET` lists it with the secret rows `value: null, set: true`;
    - a second `POST` with the same name (any case) is a 409;
    - `PUT` with a stale revision is a 409 `{currentRevision}`;
    - `PUT` with `enabled: false` flips only that;
    - `DELETE` gives `{ok: true}`, and its `mcp:<id>:` secrets are gone;
    - an unknown id is a 404;
    - a newer-schema file gives 423 on writes and `readOnlyReason` on `GET`.
  - `test_events`: create, save, delete, secret set and secret delete each announce `mcpServers` with `origin` = clientId. A secret set or delete also announces `agents`.
  - `test_test_route`:
    - for the stdio fake with `--require-env`: `ok`, three tools, and `GET /mcp-servers` now shows `lastTest`;
    - for a disabled server: it still tests;
    - for an HTTP server with a wrong bearer: `ok: false` with the 401 message;
    - for a server whose secret file was removed: 422 "A secret is missing. Set it again.".
  - `test_secret_routes`:
    - `PUT /mcp-secrets/GH_TOKEN` gives `{name, set: true}`;
    - `GET /mcp-secrets` lists `GH_TOKEN` as `set: true`, and `FAKE_FOLDER_KEY` (used by a listed agent's `.mcp.json`) as `set: false`, with `usedBy` naming the agent and server;
    - `USERPROFILE`/`HOME` used by a folder is `settable: false`;
    - `PUT` of `PATH`, `CLAUDE_CONFIG_DIR` or an empty value is a 422;
    - `DELETE` gives `{ok: true}`, then a 404.
  - `test_refresh_agent_tools`: an agent with a folder server (the stdio fake) and a gateway server (the HTTP fake). `POST /agents/{id}/tools/refresh` answers both groups with rows and `status: "ok"`. A following `GET /agents/{id}/tools` gives the same groups from the cache. A hanging server (timeout patched to 1 s) gives `status: "error"` while the others are listed.
  - `test_no_answer_holds_a_secret`: every answer body of this file's requests, every announced event, and `caplog` hold none of the test's secret values. That covers `GET /mcp-servers`, the 422s that refuse a bad secret, the Test errors from `--print-env-and-exit`, and `GET /mcp-secrets`.
  - `test_reads_and_probes_write_nothing`: `GET /mcp-servers`, `GET /mcp-secrets`, `POST …/test`, `POST /agents/{id}/tools/refresh` and `GET /agents/{id}/tools` leave the state dir, the agent folders and the space byte-identical (a hash of every file before and after).
  - `test_routes_answer_while_ai_is_hidden`: with "Hide AI features" on, `GET /mcp-servers` still answers 200.
- [ ] **Step 2-4:** fail, implement, pass (`uv run pytest backend/tests/test_m19_routes.py backend/tests/test_m19_*.py -q`).
- [ ] **Step 5:** commit `feat(m19): MCP server, secret and tool-refresh routes`.

### Task 7: Settings > Integrations > MCP servers (Lane C)

**Files:**

- Create:
  - `frontend/src/mcp/McpServersGroup.tsx`, `frontend/src/mcp/McpServerDialog.tsx`, `frontend/src/mcp/McpTestResult.tsx`, `frontend/src/mcp/SecretVariables.tsx`
  - tests beside each
- Modify: `frontend/src/settings/sections/Integrations.tsx` (+ `Integrations.test.tsx`):
  - render `<McpServersGroup />` after M11's token groups ("API tokens", "New token" and, once loaded, "Connect an AI assistant"), and nothing while `useAiHidden()`;
  - add `MCP_TEXT`'s "MCP servers" and "Secret variables" strings to `INTEGRATIONS_SEARCH` (it already holds `'MCP'`).

**Interfaces.**

- Consumes: `MCP_TEXT` (T1), the `api` MCP methods (T1, mocked), `SettingGroup`/`SaveError`/`errorText` from `settings/controls`, `useAiHidden` from `@/ai/store`.
- Produces:
  - `McpServersGroup()`
  - `McpServerDialog(props: { open: boolean; onOpenChange(o: boolean): void; server?: McpServer | null; onSaved(s: McpServer): void })`
  - `McpTestResult(props: { result: McpTestResult | null; testing: boolean })`
  - `SecretVariables()`, which uses T8's `SetSecretDialog`. Until T8 lands, it uses a local password field with the same props. T9 swaps it in if the lanes finish apart.

**Behaviour** (strings from the Contract's Labels):

- The list reloads on `mcpServers` events.
- The switch saves `enabled` with the revision. On a 409 it reloads and retries once.
- Delete asks for "Confirm delete" first.
- **The dialog.**
  - "Connect by" switches between the command fields and the URL fields.
  - Arguments are one per line.
  - Environment and header rows can be added and removed. A new row's "Secret" checkbox is on.
  - A stored secret row shows "•••••• saved" and "Replace". It sends `value: null` unless it was replaced.
  - The bearer field sends `bearerAction` `keep`, `set` or `remove` (a "Remove" link beside "•••••• saved").
  - Name is read-only when editing.
  - A 422 or 409 shows its `detail` above the buttons. The dialog never keeps a typed secret after it closes.
- **Test** shows "Testing…", then `McpTestResult` under the row.
- The secret variables list reloads on `mcpServers` and `agents` events.

**Steps.**

- [ ] **Step 1: failing tests:**
  - "test the group sits after the API token groups and is hidden while AI features are hidden"
  - "test Add MCP server by command sends the rows with secret flags"
  - "test Add by URL sends transport, headers and a bearer with bearerAction set"
  - "test editing shows saved secrets masked and keeps them unless replaced": `saveMcpServer` gets `value: null` for an untouched secret row, and the DOM never holds the mocked value. The mock answers with no values, and the test also seeds a typed value then closes the dialog; the reopened dialog's inputs are empty.
  - "test the name is read-only when editing"
  - "test the switch saves enabled and retries once on 409"
  - "test Test lists the tools and shows a failure's message"
  - "test Delete asks to confirm"
  - "test a 422 shows its detail"
  - "test secret variables list Missing ones with who uses them and Set… saves"
  - "test a variable Object can't set shows the environment note and no Set…"
  - `Integrations.test.tsx`: "test the search terms include MCP servers"
- [ ] **Step 2-4:** fail, implement, pass (`npx vitest run src/mcp src/settings`).
- [ ] **Step 5:** commit `feat(m19): Settings > Integrations > MCP servers and secret variables`.

### Task 8: The agent page: missing secrets and server tool groups (Lane D)

**Files:**

- Create: `frontend/src/mcp/SetSecretDialog.tsx`, `frontend/src/mcp/ServerGroupStatus.tsx`, tests beside each
- Modify (M17 files; these are the only M19 edits in them):
  - `frontend/src/agents/ProfileTab.tsx`: each name in "Needs secrets: …" gets a "Set…" button that opens `SetSecretDialog`. After saving, the agent reloads (the `agents` event).
  - `frontend/src/agents/ToolsTab.tsx`: on mount, after the GET, call `api.refreshAgentTools(id)` once and replace the groups. While it runs, the server groups show "Listing tools…".
  - `frontend/src/agents/ToolSwitches.tsx`: a group with `server` renders `<ServerGroupStatus status={group.server} />` under its header. Its switches are disabled when the status is `disabled` or `needsSecrets`. A group with no rows has no group switch.
  - their tests: `ProfileTab.test.tsx`, `ToolsTab.test.tsx`, `ToolSwitches.test.tsx`

**Interfaces.**

- Consumes: `MCP_TEXT`, `api.setMcpSecret`, `api.refreshAgentTools`, `McpGroupStatus` (T1), and M17's `ToolSwitches` props (unchanged).
- Produces:
  - `SetSecretDialog(props: { name: string | null; onOpenChange(o: boolean): void; onSaved?(): void })`, a password input `autoComplete="off"`, cleared on close;
  - `ServerGroupStatus(props: { status: McpGroupStatus; loading?: boolean })`.

**Steps.**

- [ ] **Step 1: failing tests:**
  - "test Needs secrets shows Set… per variable and saving calls setMcpSecret"
  - "test the secret value is cleared when the dialog closes"
  - "test the Tools tab refreshes server tools on open and shows Listing tools… meanwhile"
  - "test a server group lists its tools with switches and a group switch"
  - "test a disabled server's group says Turned off in Settings > Integrations and its switches are disabled"
  - "test a failed listing shows Couldn't list tools with the error"
  - "test a new tool from the refresh shows switched on"
  - "test switching one server tool off saves its mcp__server__tool id in toolsOff"
- [ ] **Step 2-4:** fail, implement, pass (`npx vitest run src/mcp src/agents`).
- [ ] **Step 5:** commit `feat(m19): agent page sets missing secrets and lists each server's tools`.

### Task 9: Integrate (alone, last)

**Files:**

- Create: `scripts/m19_acceptance.py`, `docs/superpowers/plans/m19-acceptance.md`
- Modify:
  - `backend/tests/test_m10_ai.py`: `test_ai_modules_use_no_network_client` gains `mcpmodel.py`, `secretstore.py`, `mcpstore.py`, `mcpgateway.py` and `api_mcp.py`, and its banned set gains `httpx2` (the `mcp` library's HTTP client). `mcpprobe.py` is not added; it is the one network module.
  - `frontend/src/mcp/SecretVariables.tsx`: use `SetSecretDialog`, if T7 shipped its local field.
  - `docs/superpowers/plans/remaining-work.md`: the M19 status line.
  - `CONTINUE.md`: one line.
  - `backend/tests/fake_claude.py`: only if a check needs a marker.

**`scripts/m19_acceptance.py SPACE [--keep]`.**

- Setup:
  - It copies `SPACE` to a temp folder and commits the copy to a throw-away git repo, as M10's and M17's scripts do. The original is never touched.
  - It sets `OBJECT_STATE_DIR`, `OBJECT_CACHE_DIR` and `FAKE_CLAUDE_LOG` to temp paths.
  - It serves the copy with `create_app` on a free `127.0.0.1` port, with `claudePath` pointing at the fake `claude`.
  - It starts the fake MCP server's `--http` mode with `--require-bearer s3cret-accept-http`.
  - It captures the app's log to a temp file.
- Checks:
  1. `GET /api/mcp-servers` and `GET /api/mcp-secrets` are empty, and the state dir holds no `mcp-servers.json` and no `secrets.json`.
  2. `POST` the stdio server "fake-stdio" (`sys.executable`, args the fake server with `--require-env FAKE_KEY`, env `FAKE_KEY` = `s3cret-accept-stdio`, secret). The answer shows `set: true` and no value. `secrets.json` holds the value; `mcp-servers.json` doesn't.
  3. `POST` the URL server "fake-http" (HTTP, the bearer `s3cret-accept-http`). `POST …/test` on each lists `echo`, `add` and `whoami`. A `PUT` that replaces fake-http's bearer with a wrong one makes Test fail with the 401 message. It is then set back.
  4. A chat turn with the default agent and `FAKE:mcp:fake-stdio:whoami`:
     - the fake's log has `--strict-mcp-config`, and `mcpServers` ⊇ {fake-stdio, fake-http, object, object-agent};
     - `allowed` holds `mcp__fake-stdio` and `mcp__fake-http`;
     - the logged MCP config holds `${OBJECT_MCP_…}` references and no secret;
     - the `tool_result` equals the stdio secret (compared, not printed). That proves the value reached the server through the environment only.
  5. `FAKE:mcp:fake-http:add:{"a":2,"b":3}` answers `5`.
  6. Switches. Create "Researcher" (`POST /api/agents`) and run `POST /api/agents/<id>/tools/refresh`. Both gateway groups list three tools. Then `PUT` toolsOff `["mcp__fake-http__add", "mcp__fake-stdio__echo", "mcp__fake-stdio__add", "mcp__fake-stdio__whoami"]`, and run a turn with `FAKE:mcp:fake-http:add`:
     - the fake answers the denial;
     - `mcp__fake-http__add` is in `disallowed`;
     - fake-stdio is not in the config (all of its tools are off);
     - the default agent's next turn still has both servers.
  7. `PUT` fake-http `enabled: false`: the next turn's config has no fake-http.
  8. A folder server: write Researcher's `.mcp.json` with `{"mcpServers": {"folder-fake": {"command": <python>, "args": [<fake>, "--require-env", "FOLDER_KEY"], "env": {"FOLDER_KEY": "${FOLDER_KEY}"}}}}`. Then:
     - `GET /api/agents/<id>` shows `missingVars: ["FOLDER_KEY"]`, `usable: false`, and `GET /api/mcp-secrets` lists it as missing and used by Researcher;
     - `PUT /api/mcp-secrets/FOLDER_KEY` makes it `usable: true`;
     - the refresh lists `folder-fake`'s tools;
     - a turn with `FAKE:mcp:folder-fake:whoami` answers the value.
  9. A `tagObject` turn (proposal mode) has no `OBJECT_MCP_` server in its config. Only `object` and `object-agent` are there, plus `folder-fake`, which is M17's folder rule.
  10. No secret leaked. None of the three secret strings appears in:
      - any file in the state dir other than `secrets.json`;
      - either agent folder;
      - the space copy;
      - the app log;
      - the fake's log;
      - any recorded API answer or SSE frame.
  11. `DELETE /api/mcp-servers/<fake-stdio>`: its `mcp:<id>:` keys are gone from `secrets.json`, and the next turn has no fake-stdio.
  12. `git status` of the space copy is clean (no turn saved a chat). Reads, tests and refreshes changed nothing in the state dir. This is checked by hashing the state dir before and after checks 1, 3's Test calls and 6's refresh, with the writes the script made itself excluded.

  It prints `[ok]`/`[FAIL]` per check and `RESULT: PASS` at the end; it exits non-zero on any failure.

**`m19-acceptance.md`.** Hand checks for Gene on a copy of his export:

- [ ] Settings > Integrations shows "MCP servers" after API tokens. "Add MCP server" by Command adds a real stdio server you use (for example one started with `npx`). "Test" lists its tools.
- [ ] Add a URL server with a bearer token or an API-key header. "Test" lists its tools. Editing it shows "•••••• saved", never the value. A wrong token makes "Test" say the credentials were refused.
- [ ] `%LOCALAPPDATA%\object\secrets.json` holds the values and `mcp-servers.json` doesn't. Neither file is in any space folder or agent folder.
- [ ] In a chat, Assistant uses one of the server's tools without an Accept step, and the step shows in the chat.
- [ ] Researcher's Tools tab lists the server as its own group with its tools ("Listing tools…" first). Switching one tool off stops Researcher from using it. Switching the whole group off leaves the server out. Assistant still has it.
- [ ] Turning the server off in Settings removes it from every agent's chats. The Tools tab says "Turned off in Settings > Integrations".
- [ ] Your own Claude Code MCP servers (from your `~/.claude.json` or project files) don't appear in an agent chat. Ask the agent to list its tools.
- [ ] Put a `.mcp.json` with a `${VAR}` reference into an agent folder (or "Add agent folder…" for a copy from elsewhere). The Profile tab shows "Needs secrets: VAR". "Set…" fixes it, and the Tools tab then lists that server's tools.
- [ ] Delete a server: "Confirm delete" first. Its secrets are gone from `secrets.json`.
- [ ] "Hide AI features" hides the MCP servers group.
- [ ] Unlinked mentions still show on the object page.

**Steps.**

- [ ] **Step 1:** write the script and checklist; run `uv run python scripts/m19_acceptance.py <fixture space>` until `RESULT: PASS`.
- [ ] **Step 2:** run the full gate:
  - `uv run pytest backend/tests -q`
  - `npx vitest run`, `npx tsc -b --noEmit`, `npm run build`
  - every `scripts/mN_acceptance.py`
  - the live spike once more with `OBJECT_LIVE_CLAUDE=1`
- [ ] **Step 3:** commit `test(m19): acceptance script and hand-check list`.

Then the one milestone review (correctness, file safety, fidelity, the five Review Focus items first), one fix pass, the final gate.

## Shared files and ordering

| Shared file | Owner | Others |
|---|---|---|
| `backend/objectapp/server.py` | T1 (mount `api_mcp`, call `mcpgateway.install()`, `RESYNC_EVENTS`) | none |
| `backend/objectapp/toolcatalog.py` (M17) | T1 (`ToolGroup.server`, `groups_out`) | none |
| `backend/objectapp/api_agents.py` (M17) | T5 (provider groups replace same-id catalogue groups) | none |
| `backend/objectapp/agentrun.py` (M17) | not edited. T5 registers contributors and sets `SECRET_LOOKUP` from `mcpgateway.install()`. | |
| `backend/objectapp/mcpmodel.py` | T1 | lanes report needs; they don't edit |
| `backend/objectapp/secretstore.py`, `mcpstore.py`, `mcpprobe.py`, `mcpgateway.py`, `api_mcp.py` | T1 writes the stubs; then T2, T3, T4, T5 and T6 respectively fill each | none |
| `backend/tests/fake_claude.py`, `backend/tests/fake_mcp_server.py` | T1 | T9 may add a marker it needs |
| `backend/tests/test_audit2_api.py`, `frontend/src/api/client.test.ts` (resync lists) | T1 | none |
| `frontend/src/api/types.ts`, `api/client.ts`, `test/mockApi.ts`, `frontend/src/mcp/mcpText.ts` | T1 | lanes report needs; they don't edit |
| `frontend/src/settings/sections/Integrations.tsx` (+ test) | T7 | none |
| `frontend/src/agents/ProfileTab.tsx`, `ToolsTab.tsx`, `ToolSwitches.tsx` (M17, + tests) | T8 | none |
| `frontend/src/mcp/SetSecretDialog.tsx` | T8 | T7 consumes it; T9 wires it into `SecretVariables.tsx` if needed |
| `frontend/src/mcp/SecretVariables.tsx` | T7 | T9 (the dialog swap only) |
| `backend/tests/test_m10_ai.py`, `remaining-work.md`, `CONTINUE.md` | T9 | none |

**Lanes** (counted from the Files lists). T1 runs first and alone. Then four lanes run:

| Lane | Tasks | Waits for |
|---|---|---|
| A (back end: secrets, servers, runs) | T2, then T3, then T5 | |
| B (back end: probe, routes) | T4, then T6 | T6 starts after T5 is done |
| C (front end: Settings) | T7 | only T1's contract |
| D (front end: agent page) | T8 | only T1's contract |

T9 runs last and alone. No two lanes edit the same file. M17 and M18 must be built before T1 (they are, on `feat/m16-m24`): T1 edits M17's `toolcatalog.py` and M18's `fake_claude.py`, and T5 and T8 edit M17 files.

## Our calls

1. **No OAuth.** The installed CLI does OAuth only through `claude mcp login` for servers in Gene's own Claude Code config, which Object must not write or read. URL servers take headers or a bearer token. A 401 in "Test" says that OAuth sign-in isn't available.
2. Secrets go in `<state>/secrets.json` (the spec's call), not Windows Credential Manager. The file is `0600` on POSIX. On Windows it is protected by `%LOCALAPPDATA%`'s per-user ACL, and M17's fence denies agent file tools on the state dir's files.
3. Each environment and header row has a "Secret" checkbox, on by default. A bearer token is always secret. Arguments, the command and the URL are never secret; they are shown and stored plainly.
4. Plain values may not contain `${`, because the CLI would expand them, for example to Object's own token. Use a secret instead.
5. Secret values reach the CLI only through its environment, under `OBJECT_MCP_<hash>` names, with `${…}` references in `mcp.json`, as M17 does for `OBJECT_API_TOKEN`. That environment is also visible to the run's other stdio servers and, with the shell on, to the shell. M17's shell warning already says the shell can read everything.
6. A server's name is fixed after it is added, because tool ids (`mcp__<name>__<tool>`) and every agent's `toolsOff` hang on it. Names follow M17's folder rule `[A-Za-z0-9_-]{1,64}`, are unique case-insensitively, and exclude `object`/`object-agent`.
7. On a clash between a gateway server's name and an agent's folder server, the folder server wins for that agent (with a note).
8. Servers are deleted at once after a "Confirm delete", with their secrets. There is no trash: they are machine settings, not space objects or agent folders. Agents' stale `toolsOff` entries are left alone; they are harmless.
9. Proposal runs (M17's suggestion modes) and M18's review and curator runs get no gateway servers. Chat, delegate (M20) and schedule (M21) runs do. M17's folder servers keep M17's own rule.
10. A server whose every known tool is switched off for an agent is left out of that agent's runs. Off tools of any outside server (gateway or folder) go in `--disallowedTools`, and the server is allowed as `mcp__<name>`, so tools it adds later are on.
11. Tool lists live in memory only, so "Test", the Tools tab and the agent page write nothing (never write on read). After a restart they are listed again when the tab opens. Until then, the run-time "all off" skip doesn't apply.
12. "Test" works on saved servers (the row's button), not on an unsaved form. It also works for a disabled server. The timeout is 20 s, the stderr shown is capped at 2,000 characters, and tool descriptions at 300.
13. Folder `${VAR}` values are machine-wide **secret variables** (`var:<NAME>`), shared by every agent that names them. They are set from the agent page ("Set…") or Settings. `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP` and `TMP` resolve from Object's environment. `PATH`, `CLAUDE*`, `ANTHROPIC*`, `OBJECT_*` and a few loader variables can't be set.
14. Opening the Tools tab also starts the agent's folder servers to list their tools. M17's runs already start them on every turn, so this adds no new trust.
15. Caps: 50 servers, 50 environment rows, 50 header rows, 50 args, 4,000 characters per plain value, 16 KiB per secret.
16. The MCP servers group sits in Settings > Integrations (a Space-group section) but applies to the whole machine, and its help line says so. It is hidden while "Hide AI features" is on; its routes still answer.
17. WebSocket servers (offered by `claude mcp add-json`) are not offered, because the spec names HTTP/SSE.
18. All strings marked "our string" above.

## Guesses (spec points I could not settle without guessing)

- **The `--mcp-config` entry shapes and `${VAR}` expansion** aren't printed by `--help`. The plan uses Claude Code's documented shapes and makes the T1 live spike prove them, with a stop-and-ask if expansion fails anywhere a secret goes.
- **Whether native Windows needs `cmd /c` for `.cmd` commands** in the CLI's stdio servers. T1 finds out, and `cli_entry` wraps only if needed.
- **The CLI's name for odd tool names** (dots, dashes). T1 records it, and `tool_id` follows it.
- **Whether M17's `Agent.mcpServers`/`folder-mcp` read `SECRET_LOOKUP` at call time.** Settled by the built code: both do (`agentrun._folder_mcp` and `agents._secret_lookup`). T5's test keeps it so.
