# Milestone 20: A2A (outbound) and delegation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Written 2026-11-05 against `master` at `0f4fde1`, to be built after M17 (`2026-11-05-m17-agents-and-tools.md`), M18 (`2026-11-05-m18-learning.md`) and M19 (MCP gateway) are merged. Before the build, one reconcile pass checks every M17/M18/M19 name this plan consumes against the code actually built. Every label and number not quoted from the spec is "our string" / "our number".

**Goal.** Gene adds remote agents by their Agent Card URL (or base URL), with an optional bearer token or header. They are listed in the Agents section with a small "remote" mark, and he chats with them in the same chat panel. Object uses A2A's streaming method when the card offers streaming, else the plain send method. It shows text, file artifacts as attachments and data artifacts as code blocks, keeps the A2A context id across turns, and shows an input-required question as the agent's reply. Local agents get three tools: `remote_agents_list`, `remote_agent_call` (with a timeout) and `delegate`. `delegate` hands a task to a local or remote agent and gets back a summary of at most 24,000 characters. Delegation is flat (one level), at most 3 run at once per turn, the delegated agent never writes the caller's memory, and the delegated chat is kept in the other agent's chats, marked as delegated.

**Architecture.**

- `a2a.py` is the A2A v1.0 JSON-RPC client: fetch and parse the Agent Card, `SendMessage`, `SendStreamingMessage`, `GetTask` and `CancelTask`, with size caps, timeouts and no redirects. It is the only M20 module with a network client.
- `remotemodel.py` holds the remote agent's `agent.json` schema and the M20 constants.
- `remotesecrets.py` is a thin adapter over M19's secrets store (`<state>/secrets.json`).
- `agents.py` (M17) learns `kind: "remote"` registry entries. A remote agent's folder is `<state>/agents/<name>/`. It holds `.object-agent/agent.json`, `card.json`, `sessions/` (the M17 transcript format) and `files/`.
- `remotechat.py` turns one chat turn into A2A calls. It yields M10/M16/M17 stream events plus a new `attachment` event, and writes the transcript. `api_ai.py` (M17) sends a remote `agentId` there.
- `delegation.py` runs a delegated turn:
  - a local target runs headless through `headless.run_chat` (new in M20, below; M21's schedules call it too), which uses M17's `agentrun.build_run` and `ai.run_turn`;
  - a remote target goes through `remotechat.call_remote`;
  - it enforces the limits and registers two `agentrun` contributors, "delegation" and "fence-remote".
- `api_remote_agents.py` holds the app's remote-agent routes. `api_agent_a2a_v1.py` holds the `/api/v1/agent/*` routes behind the three tools. `agent_tools_a2a.py` registers the tools in M17's `object-agent` MCP server.
- Front end:
  - `agents/AddRemoteAgentDialog.tsx`, the remote Profile and Card tabs, and a `RemoteMark` badge;
  - the chat panel gains the context notice, attachment chips, and a remote header without a model picker.

**Tech Stack.** Python 3.13, FastAPI, pydantic, `httpx` (moved from the dev group to the runtime dependencies; already present through `mcp`), `sse-starlette`, `uv`. React 19, TypeScript, zustand, shadcn/ui, Tailwind, vitest. Claude Code CLI **2.1.317** (`claude --version`, checked 2026-11-05). M20 adds **no CLI flag**. It runs local agents only through M17's `agentrun.CLI_FLAGS`. The one CLI behaviour it leans on is the MCP tool-call timeout (environment variable `MCP_TOOL_TIMEOUT`, in milliseconds). It isn't listed in `claude --help`, so the T1 spike checks it.

**A2A version pinned: A2A Protocol Specification v1.0** (a2a-protocol.org, "latest", read 2026-11-05), JSON-RPC 2.0 binding only (`protocolBinding: "JSONRPC"`). Object sends the header `A2A-Version: 1.0`. Agents that offer only 0.3 or only gRPC/HTTP+JSON are refused with a message (see Contract). The exact methods and shapes are in "A2A wire format" below.

**Spec.** `docs/superpowers/specs/2026-11-05-agents-design.md`, sections **7** (A2A outbound) and **8** (Agents working together), plus their mentions in sections 1 ("Remote agents… have no soul, memory, skills or tool switches of Object's; their card shows what their Agent Card says"), 2 ("Remote agents show a small 'remote' mark"), 4 ("remote agents… stay on"; the "Object agent tools" group names "delegate, remote agents") and Constraints ("A2A bearer tokens never go into a space, the repo or a log, and are never shown again after entry"). **Out of scope:** A2A inbound (spec Non-goals; the server binds `127.0.0.1` only). Push notifications, `ListTasks`, `SubscribeToTask`, the extended agent card and card signatures are not used either.

## Global Constraints

- **The server binds `127.0.0.1` only.** M20 makes outbound calls only. It adds no listener and no inbound A2A.
- **Agents run only through the `claude` CLI under Gene's own login.** Object never reads `~/.claude/.credentials.json` or any Claude token and never calls Anthropic's API. A delegated local turn is a `claude -p` run built by M17's `agentrun.build_run`. Remote agents are reached only over A2A, at the URL Gene entered (or the endpoint its card names, which is shown to him before adding).
- **Network client.** `a2a.py` is the only M20 module that imports `httpx`. `agent_tools_a2a.py` uses httpx to the loopback app only, as `agent_mcp.py` does. Every other M20 module joins M10's `test_ai_modules_use_no_network_client`.
- **"Exclude from AI" keeps its promise.**
  - Pages excluded from AI and templates are never sent to a remote agent. Context chips go through `ai.gather_context`, which leaves them out and reports them in `skipped`.
  - A `block` from the editor is never sent: remote agents take `mode: "chat"` only.
  - Remote agents' folders are fenced from every local agent's file tools, like other agents' folders.
- **Context notice, once per remote agent.** The first time Gene sends context to a remote agent, a notice says it leaves this machine. Once he sends, `contextNoticeAt` is recorded in that agent's `agent.json` and the notice never shows again for that agent.
- **No notice or confirmation for sends an agent makes itself** (`remote_agent_call`, `delegate` to a remote agent). Gene limits them with the tool switches.
- **Secrets.**
  - A2A bearer tokens and header values live only in M19's `<state>/secrets.json`, under the key `a2a:<agentId>`.
  - They never go into a space, the repo, `agents.json`, `agent.json`, `card.json`, a transcript, a log line, an error message or an API answer.
  - After entry they are shown only as "set".
  - They are sent only to the agent's endpoint URL. Redirects are never followed.
- **Delegation** (spec section 8, verbatim values):
  - The summary is at most **24,000** characters (`DELEGATE_SUMMARY_CAP`).
  - At most **3** delegations run at once per turn (`DELEGATE_MAX_AT_ONCE`).
  - Delegation is flat, one level: a delegated agent can't delegate further.
  - A delegated agent can't write the caller's memory.
  - The delegated chat is kept in the other agent's chats and marked as delegated.
- **Remote agents have no soul, memory, skills, model or tool switches of Object's.** Their page shows what their Agent Card says.
- **File safety.**
  - Never write on read: listing agents, previewing a card and opening a remote agent's page write nothing.
  - Every write in a remote folder is atomic (`textfile.atomic_write`, or `create_new` for new files).
  - A remote turn or a delegation writes nothing in the space. Saving the AI Chat object is M10/M17's save, unchanged.
  - Deleting a remote agent moves its folder to `<state>/agents/.trash/` (M17's agent trash; restorable).
- **Untrusted remote content.** Replies render through M16's inert Markdown renderer. Attachment names are made safe before saving. Only `http`/`https` file URLs are shown. Every remote response is capped in size and time.
- **Everything is unlocked.** No badge, limit or gate beyond the spec's delegation limits.
- **Tests.**
  - Tests write only to temp folders. `OBJECT_STATE_DIR` is a temp folder (conftest's autouse fixture). Nothing writes to `~/.claude` or the real state dir. Fixtures are synthetic.
  - The only A2A server tests talk to is `backend/tests/fake_a2a.py` on `127.0.0.1`. No test reaches the internet.
- **No names** other than Object, Claude Code and A2A in code, tests or strings.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

These are the inputs and failure modes the spec implies that no task's happy path exercises, most likely first. Each one's test is listed in its owning task.

1. **Excluded pages reaching a remote agent.**
   - An excluded page or a template in the context chips.
   - A proposal mode (`askBlock`, `tagBlock`, `tagObject`, `autofill`, `rephrase`) aimed at a remote agent with a `block`.
   - A context chip of a page that became excluded after the chip was added.
   - The context notice skipped by a client that never asked (428 guard).
   - A local agent reading a remote agent's transcript with Read/Grep.
   - Tests:
     - `test_m20_remote_chat.py::test_excluded_context_never_sent` (the fake A2A server's log holds no marker text; `done.skipped` lists the page), `::test_proposal_modes_refused_for_remote` and `::test_context_without_notice_is_428` (T4);
     - `test_m20_delegation.py::test_remote_folders_are_fenced` (T6).
2. **A secret leaking or travelling.**
   - Where it must never appear: `agents.json`, `agent.json`, `card.json`, a transcript, a log record (`caplog` at DEBUG, httpx's logger included), an API answer, a `ChangeEvent`, an error message from a failed fetch.
   - Where it must never be sent: across a 3xx redirect to another host, to a card's endpoint after the URL is edited without re-entering the token, or to the card URL's host when the endpoint is elsewhere (only the endpoint gets it).
   - Tests:
     - `test_m20_remote_agents.py::test_secret_never_stored_or_shown` (T3);
     - `test_m20_a2a_client.py::test_redirects_not_followed_and_auth_not_forwarded` (T2);
     - `test_m20_remote_routes.py::test_url_change_drops_the_secret` (T5).
3. **A hostile or broken remote agent.**
   - The card:
     - 0.3-only, gRPC-only, no `supportedInterfaces`, or an interface URL with a `file:`/`javascript:` scheme;
     - a card over 1 MiB, or not JSON.
   - JSON-RPC answers:
     - an `error` (`-32001` and others), a `result` with neither `task` nor `message`;
     - an HTML 502 page, a 401.
   - The stream:
     - malformed SSE lines;
     - a stream that never ends (the timeout, then a best-effort `CancelTask`);
     - a stream past 50 MiB.
   - Artifacts:
     - a file named `../../evil.md`, `CON`, `a:b` or 300 characters long;
     - a raw file over 25 MiB, bad base64;
     - a `url` part with `javascript:`;
     - a data part of 1 MB.
   - Tests: `test_m20_a2a_client.py::test_card_refusals`, `::test_hostile_answers` (parametrised) (T2); `test_m20_remote_chat.py::test_attachment_names_and_caps` (T4).
4. **Delegation limits under concurrency and failure.**
   - A 4th delegation while 3 run (429; the 3 finish).
   - A delegated run calling `delegate` or `remote_agent_call` (the tools are disallowed in its args, and the route answers 403 to its token).
   - Delegating to itself, or to an unknown, missing or read-only agent.
   - A summary of 30,000 characters (cut to 24,000).
   - A delegated run past `DELEGATE_TIMEOUT` (its process tree is stopped and its chat is kept with `stopped: true`).
   - The caller's turn ending mid-delegation (the request disconnects, the delegated run stops).
   - The caller's memory files and folder byte-identical after a delegated run that used `memory`.
   - Tests: `test_m20_delegation.py::test_fourth_delegation_at_once_is_refused`, `::test_delegated_run_cannot_delegate`, `::test_self_and_unknown_targets`, `::test_summary_capped_at_24000`, `::test_timeout_stops_the_delegated_run`, `::test_caller_going_away_stops_delegations`, `::test_caller_memory_untouched` (T6).
5. **Multi-turn state of a remote chat.**
   - The context id is kept across turns of one chat. A new chat (New chat, or switching agent) starts a fresh context.
   - An input-required task: the next message carries its `taskId`. After it completes, the `taskId` is dropped.
   - A reopened transcript continues its context.
   - A saved AI Chat reopened without its transcript starts a new context.
   - Stop mid-stream sends `CancelTask` and keeps the partial reply with `stopped: true`.
   - `TASK_STATE_AUTH_REQUIRED`, `TASK_STATE_FAILED`, `TASK_STATE_REJECTED` and `TASK_STATE_CANCELED` each answer an `error` with our message.
   - Tests: `test_m20_remote_chat.py::test_context_id_kept_and_input_required_continues`, `::test_stop_cancels_the_task`, `::test_terminal_states` (T4); `AiChatPanel.test.tsx` "test New chat with a remote agent starts a fresh context" (T8).

## Contract (T1)

### Storage

| What | Where | Written by |
|---|---|---|
| Registry entry | `<state>/agents.json` `{"id", "path", "kind": "remote", "addedAt"}` (M17's file; `kind: "remote"` is reserved there) | `AgentRegistry.create_remote` / `unregister` / `delete` / `restore` |
| Remote agent folder | `<state>/agents/<safe_filename(name)>/` (always in the state dir; a clash gets ` (2)`, as M17) | `AgentRegistry.create_remote` |
| Object's fields | `<folder>/.object-agent/agent.json` (remote schema below), `dump_json`, unknown keys kept | `remotemodel` via `agentfiles.write_agent_file` |
| The card as fetched | `<folder>/.object-agent/card.json` (the card JSON re-dumped with `dump_json`, at most `CARD_MAX_BYTES` fetched) | create, `refresh` |
| Chats | `<folder>/.object-agent/sessions/<chatId>.jsonl` (M17's transcript format, additions below) | `remotechat`, `delegation` |
| File artifacts | `<folder>/.object-agent/files/<chatId>/<safe name>` (raw bytes; `create_new`, a clash gets ` (2)`) | `remotechat` |
| The secret | M19's `<state>/secrets.json`, key `a2a:<agentId>`, value the token or the header value | `remotesecrets` |
| Delegated local chats | the target agent's own `sessions/` (M17), header marked delegated | `delegation` |

- Nothing is written in a space except M10/M17's AI Chat save (unchanged).
- A remote folder has no `CLAUDE.md`, no `.claude/`, no `.mcp.json`, no `memory/` and no `skills-archive/`. M17's `write_skeleton` is not used for it.
- **Delete** uses M17's agent trash (`<state>/agents/.trash/<trashId>/` plus its meta file). The secret stays in `secrets.json` while the folder is in the trash, so Restore brings back a working agent (our call; M17 has no purge).

### Remote `agent.json` (`backend/objectapp/remotemodel.py`, pydantic; `RemoteInfo` in `frontend/src/api/types.ts`)

```jsonc
{
  "schemaVersion": 1,
  "kind": "remote",                          // absent or "local": M17's local schema
  "id": "01JC7ZK3T9Q4M2X8B5N6R1V0WE",        // ULID (ids.new_ulid)
  "name": "Travel Planner",                  // the card's name by default; 1-60 characters (M17's NAME_MAX)
  "icon": "ph-globe",                        // our default for remote agents; a Phosphor name or one emoji
  "color": null,
  "cardUrl": "https://agents.example.com/.well-known/agent-card.json",
  "endpoint": {"url": "https://agents.example.com/a2a/v1", "protocolVersion": "1.0", "binding": "JSONRPC"},
  "streaming": true,                         // the card's capabilities.streaming
  "auth": {"kind": "bearer", "headerName": null},   // "none" | "bearer" | "header"; headerName only for "header"
  "contextNoticeAt": null,                   // set when Gene first sends context (once per remote agent)
  "cardFetchedAt": "2026-11-05T09:00:00.000Z",
  "createdAt": "2026-11-05T09:00:00.000Z",
  "updatedAt": "2026-11-05T09:00:00.000Z"
}
```

```python
# remotemodel.py
REMOTE_KIND = "remote"; REMOTE_ICON = "ph-globe"
A2A_VERSION = "1.0"; A2A_BINDING = "JSONRPC"
CARD_PATH = "/.well-known/agent-card.json"
CARD_MAX_BYTES = 1_048_576            # our number
RESPONSE_MAX_BYTES = 10_485_760       # one JSON-RPC answer (our number)
STREAM_MAX_BYTES = 52_428_800         # one stream in total (our number)
FILE_MAX_BYTES = 26_214_400           # one raw file artifact (our number)
DATA_BLOCK_MAX_CHARS = 20_000         # one data part's JSON in the reply text (our number)
CONNECT_TIMEOUT = 10.0; CARD_TIMEOUT = 15.0; POLL_INTERVAL = 1.0   # seconds (our numbers)
REMOTE_TEXT_CAP = 100_000             # remote_agent_call's text (our number)
REMOTE_CALL_TIMEOUT = 120.0; REMOTE_CALL_TIMEOUT_MAX = 240.0       # remote_agent_call (our numbers)
DELEGATE_SUMMARY_CAP = 24_000         # spec section 8
DELEGATE_MAX_AT_ONCE = 3              # spec section 8
DELEGATE_TIMEOUT = 240.0              # our number; < ai.TURN_TIMEOUT (300), so the caller's turn outlives it
SECRET_KEY = "a2a:{agent_id}"
HEADER_NAME = r"^[A-Za-z0-9-]{1,64}$" # and not one of FORBIDDEN_HEADERS
FORBIDDEN_HEADERS = frozenset({"host", "content-length", "content-type", "accept", "a2a-version",
                               "connection", "transfer-encoding", "cookie"})
OUTPUT_MODES = ("text/plain", "text/markdown", "application/json")

class RemoteAuth(BaseModel):       kind: Literal["none", "bearer", "header"] = "none"; headerName: str | None = None
class RemoteEndpoint(BaseModel):   url: str; protocolVersion: str; binding: Literal["JSONRPC"] = "JSONRPC"
class RemoteAgentFile(BaseModel):  # extra="allow"
    schemaVersion: int; kind: Literal["remote"]; id: str; name: str; icon: str | None; color: str | None
    cardUrl: str; endpoint: RemoteEndpoint; streaming: bool; auth: RemoteAuth
    contextNoticeAt: str | None = None; cardFetchedAt: str; createdAt: str; updatedAt: str
class AuthInput(BaseModel):        kind: Literal["none", "bearer", "header"]; headerName: str | None = None; value: str | None = None
def clean_auth(inp: AuthInput) -> AuthInput      # header rule; "bearer"/"header" need a value 1-4096 chars, no CR/LF; raises AgentInvalid
def card_url_for(url: str) -> str                # ".json" path -> as is; else <scheme>://<host[:port]>/.well-known/agent-card.json;
                                                 # only http/https; raises AgentInvalid("That isn't an http or https address.")
```

### A2A wire format (`backend/objectapp/a2a.py`, T2; pinned to v1.0, JSON-RPC binding)

**Every request:**

- `POST <endpoint.url>` with `Content-Type: application/json`, `A2A-Version: 1.0` and `User-Agent: Object`.
- Auth: `Authorization: Bearer <secret>` for `bearer`, or `<headerName>: <secret>` for `header`.
- `follow_redirects=False`, so a 3xx is an error.
- The body is `{"jsonrpc": "2.0", "id": "<uuid4>", "method": <M>, "params": <P>}`.

| `method` | `params` | `result` |
|---|---|---|
| `SendMessage` | `SendMessageRequest` `{"message": Message, "configuration": {"acceptedOutputModes": OUTPUT_MODES, "returnImmediately": false}}` | `{"task": Task}` or `{"message": Message}` (exactly one) |
| `SendStreamingMessage` | the same | `Accept: text/event-stream`; each SSE `data:` is `{"jsonrpc","id","result": StreamResponse}` |
| `GetTask` | `{"id": "<taskId>", "historyLength": 0}` | `Task` |
| `CancelTask` | `{"id": "<taskId>"}` | `Task` (best effort; errors ignored) |

**The objects** (camelCase JSON; enums as ProtoJSON strings):

- `Message`: `{"messageId": "<uuid4>", "role": "ROLE_USER" | "ROLE_AGENT", "parts": [Part], "contextId"?: str, "taskId"?: str}`. Object sends `contextId` from the chat's last answer, and `taskId` only while that task is input-required.
- `Part`: exactly one of `text` (str), `raw` (base64 str), `url` (str) or `data` (any JSON). Optional `mediaType`, `filename` and `metadata`. There is **no `kind` field** (v1.0 removed it). Object never sends one and ignores one if it arrives.
- `Task`: `{"id", "contextId", "status": {"state", "message"?: Message, "timestamp"?}, "artifacts"?: [Artifact], "history"?: [Message]}`.
- `Artifact`: `{"artifactId", "name"?, "description"?, "parts": [Part]}`.
- `StreamResponse`: exactly one of `task`, `message`, `statusUpdate` (`{"taskId","contextId","status"}`) or `artifactUpdate` (`{"taskId","contextId","artifact","append"?: bool,"lastChunk"?: bool}`).

**Task states and what Object does:**

| State | Kind | Object |
|---|---|---|
| `TASK_STATE_SUBMITTED`, `TASK_STATE_WORKING` | running | keep reading (stream) or poll `GetTask` every `POLL_INTERVAL` (plain send) |
| `TASK_STATE_COMPLETED` | terminal | `done` |
| `TASK_STATE_INPUT_REQUIRED` | interrupted | `done`; the status message's text is the reply; the task id is kept for the next turn |
| `TASK_STATE_AUTH_REQUIRED` | interrupted | `error` "{name} needs a sign-in that Object can't do." |
| `TASK_STATE_FAILED` | terminal | `error` "{name} couldn't do it: {status text}" (or "{name} couldn't do it.") |
| `TASK_STATE_REJECTED` | terminal | `error` "{name} turned the task down: {status text}" |
| `TASK_STATE_CANCELED` | terminal | `error` "{name} canceled the task." |
| anything else | | treated as running until the timeout |

The stream ends at a `message` result, a terminal or interrupted state, or the end of the response.

**JSON-RPC errors.** The answer's `error.message`, cut to 300 characters, becomes `"{name} answered with an error: {message} ({code})"`. A `-32001` (TaskNotFound) on a turn that sent a `taskId` drops the `taskId` and retries once without it (our call).

**Card selection** (`parse_card`), with our strings:

- The interface is the first `supportedInterfaces[]` entry whose `protocolBinding == "JSONRPC"` and whose `protocolVersion` is `"1.0"` or starts with `"1."`, with an `http`/`https` `url`.
- A card with no `supportedInterfaces` but a top-level `protocolVersion` starting `"0."` is refused: "This agent speaks A2A {version}; Object speaks A2A 1.0."
- Any other card without a usable interface is refused: "This agent doesn't offer A2A 1.0 over JSON-RPC."
- A card that isn't a JSON object with a string `name` is refused: "That address didn't answer with an Agent Card."
- `streaming = capabilities.streaming is True`.

```python
@dataclass(frozen=True)
class Card:
    name: str; description: str; version: str | None; provider: str | None; documentation_url: str | None
    endpoint_url: str; protocol_version: str; streaming: bool
    skills: tuple[dict[str, Any], ...]     # {id, name, description, tags: [..], examples: [..]} (strings cut to 500 chars)
    input_modes: tuple[str, ...]; output_modes: tuple[str, ...]
    raw: dict[str, Any]

@dataclass
class Auth:                                # never logged; repr hides value
    kind: Literal["none", "bearer", "header"]; header_name: str | None = None; value: str | None = None
    def headers(self) -> dict[str, str]

@dataclass
class Update:                              # one piece of an answer, in arrival order
    kind: Literal["text", "file", "data", "state"]
    text: str = ""                         # kind text (agent message, artifact text part, final status message)
    artifact_id: str | None = None; name: str | None = None; media_type: str | None = None
    data: Any = None                       # kind data
    raw: bytes | None = None; url: str | None = None   # kind file (exactly one)
    state: str | None = None; context_id: str | None = None; task_id: str | None = None   # kind state
    status_text: str = ""                  # kind state: the status message's text

class A2AError(Exception): message: str; status: int    # 502 remote/protocol trouble, 504 timeout, 422 a refused card

async def fetch_card(card_url: str, auth: Auth, *, client: httpx.AsyncClient | None = None) -> Card
def parse_card(data: Any) -> Card                                         # A2AError(422) with the messages above
def user_message(parts: list[dict[str, Any]], *, context_id: str | None, task_id: str | None) -> dict[str, Any]
async def send(card: Card, auth: Auth, message: dict[str, Any], *, deadline: float,
               client: httpx.AsyncClient | None = None) -> AsyncIterator[Update]
    # SendStreamingMessage when card.streaming, else SendMessage (+ GetTask polling while running).
    # Raises A2AError(504) at the deadline (loop.time()) after a best-effort CancelTask.
async def cancel(card: Card, auth: Auth, task_id: str, *, client: httpx.AsyncClient | None = None) -> None   # 5 s, errors swallowed
STATE_TERMINAL: frozenset[str]; STATE_INTERRUPTED: frozenset[str]
```

`a2a.py` reads nothing from the disk and writes nothing. A `client` argument exists for tests: an `httpx.AsyncClient` with `follow_redirects=False` and `timeout=httpx.Timeout(CONNECT_TIMEOUT, read=…)`. Without it, the function makes and closes its own.

### Registry and folders (M17's `backend/objectapp/agents.py`, extended in T3)

```python
@dataclass
class AgentRecord:                         # M17 fields unchanged, plus:
    kind: Literal["local", "remote"] = "local"
    # to_api(settings) adds "kind" and, for a remote record, "remote": RemoteInfo (below);
    # a remote record answers model None, toolsOff [], learning None, mcpServers []

class AgentRegistry:                       # M17 methods unchanged, plus:
    def create_remote(self, card: a2a.Card, card_raw: dict[str, Any], card_url: str, auth: AuthInput,
                      name: str | None = None, icon: str | None = None) -> AgentRecord
        # folder, agent.json, card.json; then remotesecrets.put(id, auth.value) when auth.kind != "none";
        # on a failure after the folder is made, the folder is removed and nothing is registered
    def save_remote(self, agent_id: str, *, name: str, icon: str | None, color: str | None,
                    auth: AuthInput | None, base_revision: str) -> AgentRecord
        # auth None = unchanged; a new auth replaces (or, kind "none", removes) the secret
    def refresh_remote(self, agent_id: str, card: a2a.Card, card_raw: dict[str, Any], card_url: str) -> AgentRecord
        # card.json, endpoint, streaming, cardFetchedAt; name kept; an endpoint whose host changed removes the secret
    def mark_context_notice(self, agent_id: str) -> str                    # contextNoticeAt (kept when already set)
    def remote_folders(self) -> list[Path]                                 # for the fence
    def find_by_name(self, name_or_id: str) -> AgentRecord                 # id, else case-insensitive name; AgentNotFound
    # local_folders() stays local only. save/read_instructions/save_instructions/duplicate on a remote id raise
    # AgentInvalid("This is a remote agent; it has no {what} in Object.") with what = "settings here" / "instructions".
    # delete/restore/unregister/trash work for both kinds; add_folder accepts a remote folder (auth set: false).

def remote_auth(record: AgentRecord) -> a2a.Auth                         # kind/headerName from agent.json, value from remotesecrets
def remote_card(record: AgentRecord) -> a2a.Card                         # parse_card(card.json) with agent.json's endpoint and streaming
```

```python
# backend/objectapp/remotesecrets.py (T3): the one place that knows M19's secrets store
def put(agent_id: str, value: str) -> None      # secretstore.SecretStore(state_dir()).set(f"a2a:{agent_id}", value)
def get(agent_id: str) -> str | None            # SecretStore.get(key)
def remove(agent_id: str) -> None               # SecretStore.delete(key)
def is_set(agent_id: str) -> bool               # SecretStore.has(key)
```

M19's `secretstore.SecretStore` (M19 plan, Contract) is consumed only through these four functions. The key `a2a:<agentId>` fits M19's `KEY_PATTERN` (`^[a-z0-9]+:…`), and M19 reserves the `a2a:` prefix for M20. Every error message `a2a`, `remotechat` and the routes produce passes through M19's `secretstore.redact(text, [value])` before it is raised or logged.

### TypeScript (T1, `frontend/src/api/types.ts`)

```ts
// M17's Agent: kind: 'local' | 'remote'; remote: RemoteInfo | null (null for local agents)
export interface RemoteSkill { id: string; name: string; description: string; tags: string[]; examples: string[] }
export interface RemoteCard {
  name: string; description: string; version: string | null; provider: string | null
  documentationUrl: string | null; skills: RemoteSkill[]; streaming: boolean
  inputModes: string[]; outputModes: string[]
}
export interface RemoteInfo {
  cardUrl: string; endpointUrl: string; endpointHost: string; protocolVersion: string; streaming: boolean
  auth: { kind: 'none' | 'bearer' | 'header'; headerName: string | null; set: boolean }
  card: RemoteCard; cardFetchedAt: string; contextNoticeAt: string | null
}
export interface RemoteAuthInput { kind: 'none' | 'bearer' | 'header'; headerName?: string | null; value?: string | null }
export interface RemotePreview { cardUrl: string; card: RemoteCard; endpointUrl: string; endpointHost: string; warnings: string[] }
export interface AddRemoteAgentRequest { url: string; auth: RemoteAuthInput; name?: string | null; icon?: string | null; clientId?: string }
export interface SaveRemoteAgentRequest { name: string; icon?: string | null; color?: string | null; auth?: RemoteAuthInput | null; baseRevision: string; clientId?: string }
export interface RemoteAttachment {
  name: string; mediaType: string | null; size: number | null
  kind: 'file' | 'url'; file: string | null          // "<chatId>/<safe name>" under the agent's files/ (kind file)
  url: string | null                                  // http/https only (kind url)
}
// AiEvent gains: | { type: 'attachment'; agentId: string; chatId: string; attachment: RemoteAttachment }
// TranscriptItem 'assistant' gains: attachments?: RemoteAttachment[]; a2a?: { contextId: string | null; taskId: string | null; state: string | null }
// AgentChatSummary gains: from: string | null       (the delegating agent's id; with delegated: true)
// AiChatRequest gains nothing: a remote agent is an agentId (M17)
```

`api/client.ts` (T1) adds:

- `previewRemoteAgent(url, auth)`, `addRemoteAgent(req)`, `saveRemoteAgent(id, req)`
- `refreshRemoteAgent(id)`, `ackRemoteContext(id)`, `revealAgentFile(id, file)`

`test/mockApi.ts` (T1) adds `remoteAgent()`, `remotePreview()` and the mocks for those methods.

### Routes (T5 fills `backend/objectapp/api_remote_agents.py`; T1 mounts the stub)

| Route | Body | Answer | Errors |
|---|---|---|---|
| `POST /remote-agents/preview` | `{url, auth: RemoteAuthInput}` | `RemotePreview`. Writes nothing. | 422 (bad URL, header rule, the card refusals); 502 `{detail}` "Couldn't reach {host}: {reason}" / "{host} answered {status}." (401/403: "{host} refused the token.") |
| `POST /remote-agents` | `AddRemoteAgentRequest` | 201 `Agent` (`kind: "remote"`). The card is fetched again. | as preview; 409 "This agent is already listed as {name}." (same `cardUrl` and endpoint) |
| `PUT /remote-agents/{id}` | `SaveRemoteAgentRequest` | `Agent` | 404; 409 `{currentRevision}`; 422 (name, header rule; not a remote agent) |
| `POST /remote-agents/{id}/refresh` | `{clientId?}` | `Agent` (the card fetched again) | 404; 422; 502 |
| `POST /remote-agents/{id}/context-notice` | `{clientId?}` | `{contextNoticeAt}` | 404; 422 (not remote) |
| `POST /agents/{id}/files/reveal` | `{file}` (`"<chatId>/<name>"`) | `{ok: true}` (shows it in the OS file manager, as `/api/reveal`) | 404 (unknown agent or file; a `file` that resolves outside `files/`) |

- **Warnings** (`RemotePreview.warnings`, our strings):
  - "This agent's card sends messages to {endpointHost}, not {cardHost}." when the hosts differ.
  - "This address isn't encrypted (http), so the token can be read on the network." for an `http` endpoint that isn't loopback, when a token is given.
- **Events:** `ChangeEvent("agents", <agentId>, <revision>, origin=clientId)` on add, save, refresh, notice; `agentChats` as M17 when a transcript is written.
- **M17 routes on a remote id:**
  - These work: `GET /agents`, `GET /agents/{id}`, `DELETE /agents/{id}`, `POST /agents/{id}/unregister`, restore, `GET /agents/{id}/chats[/{chatId}]` and `POST /agents/{id}/reveal`.
  - These answer 422 with the registry messages: `PUT /agents/{id}` and `/instructions`.
  - `GET /agents/{id}/tools` answers `{groups: []}`.
- **M18 routes and the curator on a remote id** (T5): every `api_learning` route (`/agents/{id}/memory…`, `/skills…`, `/ledger…`, `/learning`, `/curator/tidy`, `/chats/{chatId}/learn`) answers 422 "This is a remote agent; it has no memory or skills in Object." (our string); `/chats/search` works on its transcripts and `/chats/{chatId}/reviews` answers `{reviews: []}`. M18's `Curator.tick` skips records whose `kind` is `"remote"`.

### The chat route and remote agents (T4, one hook in M17's `api_ai.py`)

After M17's agent lookup in `POST /api/ai/chat`, a record with `kind == "remote"` returns `remotechat.respond(...)`. This happens before the CLI is looked for, so a remote chat works without Claude Code installed (our call).

- `mode != "chat"`: one `error` event, "Remote agents can only chat." No call is made.
- `contextPaths` non-empty and `contextNoticeAt` null: **428** `{"detail": "Confirm that context leaves this computer first.", "agentId", "host"}`. No call is made.
- The remote's `auth.kind != "none"` with no secret: one `error`, "This remote agent needs its token again (its page > Replace token)."
- Otherwise the stream is:
  1. `{"type":"chat","chatId","agentId"}`
  2. then `text`, `attachment` and `tool` (none from remote agents) events
  3. then `done` (`sessionId: null`, `proposal: null`, `skipped` from `gather_context`) or `error`.

```python
# backend/objectapp/remotechat.py (T4)
def build_parts(prompt: str, pack: ai.ContextPack) -> list[dict[str, Any]]
    # [{"text": prompt}] + one {"text": "# {title}\n\n{page text}", "mediaType": "text/markdown",
    #   "filename": "{safe title}.md"} per pack page (excluded pages and templates are never in pack.pages)
def respond(ctx: ApiContext, registry: AgentRegistry, record: AgentRecord, req: Any) -> Response
async def stream_turn(record: AgentRecord, *, chat_id: str, prompt: str, pack: ai.ContextPack,
                      space_name: str | None, space_key: str | None, deadline: float) -> AsyncIterator[dict[str, Any]]
@dataclass
class RemoteResult:
    chat_id: str; state: str; text: str; context_id: str | None; task_id: str | None
    attachments: list[dict[str, Any]]; cut: bool
async def call_remote(record: AgentRecord, text: str, *, context_id: str | None, task_id: str | None,
                      timeout: float, delegated_from: str | None, from_chat: str | None,
                      space_name: str | None, space_key: str | None, cap: int) -> RemoteResult
    # one turn, no stream to a client; a chat in the remote folder (continuing the chat whose last a2a.contextId
    # is context_id, else a new one, header delegated: true, from: delegated_from); text cut to `cap` + "…"
def save_attachment(folder: Path, chat_id: str, update: a2a.Update) -> dict[str, Any] | None   # RemoteAttachment
def safe_attachment_name(name: str | None, media_type: str | None) -> str
    # space.safe_filename, no path parts, Windows reserved names prefixed "_", at most 120 characters,
    # "attachment" + an extension from the media type when empty (our rules)
```

- **Reply text.** In arrival order:
  - agent `message` text parts;
  - artifact `text` parts (an artifact with a `name` is preceded by a line `**{name}**` the first time it appears);
  - each `data` part as a fenced block: three backticks and `json`, then `json.dumps(data, indent=2, ensure_ascii=False)` cut to `DATA_BLOCK_MAX_CHARS` + "…", then three backticks;
  - at an interrupted or terminal state, the status message's text when nothing else was shown.
- **Files.** A file part is saved to `files/` (raw) or kept as a link (`url`, http/https only; any other scheme is dropped with the text "(A file link that isn't http or https was left out.)", our string). Each one is announced as an `attachment` event.
- **Context id.** A turn's `contextId` and `taskId` come from the chat's transcript: the last assistant line's `a2a`, with the `taskId` only when its `state` is `TASK_STATE_INPUT_REQUIRED`. A new `chatId` means a fresh context.
- **Stop.** Closing the stream sends `a2a.cancel` for a running task and appends the assistant line with `stopped: true`.
- **Timeout.** The deadline is M10's `ai.TURN_TIMEOUT` (300 s). Past it: `CancelTask` and the `error` "{name} took too long (over 300 seconds) and was stopped." (M10's wording).

### Transcript additions (T3, M17's `transcripts.py`)

```jsonc
{"type":"chat","v":1,"id":"…","agentId":"<target>","title":"…","createdAt":"…","space":{…},"delegated":true,"from":"<caller agentId>","fromChat":"<caller chatId>"}
{"type":"assistant","text":"…","at":"…","model":null,"sessionId":null,
 "a2a":{"contextId":"ctx-1","taskId":"task-9","state":"TASK_STATE_INPUT_REQUIRED"},
 "attachments":[{"name":"plan.pdf","mediaType":"application/pdf","size":1234,"kind":"file","file":"<chatId>/plan.pdf","url":null}]}
```

```python
def start(folder, chat_id, *, agent_id, title, space_name, space_key, created_at,
          delegated: bool = False, delegated_from: str | None = None, from_chat: str | None = None) -> None   # M17 + two kwargs
def find_by_context(folder: Path, context_id: str) -> str | None   # newest chat whose last assistant a2a.contextId equals it
def last_a2a(folder: Path, chat_id: str) -> dict[str, Any] | None   # the last assistant line's a2a, or None
# list_chats/read: AgentChatSummary gains "from" (header "from" or None); read keeps a2a and attachments on items
```

### Agent tools (T6: `agent_tools_a2a.py` in M17's `object-agent` server; routes in `api_agent_a2a_v1.py`)

T1 appends `"remote_agents_list"`, `"remote_agent_call"` and `"delegate"` to `toolcatalog.AGENT_TOOLS`, with these labels (our strings): "List remote agents", "Call a remote agent" and "Delegate to another agent". All are on by default. T1 also appends `"objectapp.agent_tools_a2a"` to `agent_mcp.TOOL_MODULES`.

| Tool | Route (token: the turn's agent token, `v1guard.agent_auth`) | Answer |
|---|---|---|
| `remote_agents_list()` | `GET /api/v1/agent/remote-agents` | `{agents: [{id, name, description, skills: [{id, name, description}], streaming, usable}]}` (`usable`: auth `none` or its secret set) |
| `remote_agent_call(agent, message, context_id=None, task_id=None, timeout_seconds=None)` | `POST /api/v1/agent/remote-call` `{agent, message, contextId?, taskId?, timeoutSeconds?}` | `{agent: {id, name}, chatId, state, text, contextId, taskId, artifacts: RemoteAttachment[], cut}` |
| `delegate(agent, goal, context="")` | `POST /api/v1/agent/delegate` `{agent, goal, context?}` | `{agent: {id, name, kind}, chatId, state, summary, cut}` |

- **Inputs.**
  - `agent` is an id or a name (case-insensitive) of any listed agent.
  - `timeoutSeconds` is clamped to 1…`REMOTE_CALL_TIMEOUT_MAX`; the default is `REMOTE_CALL_TIMEOUT`.
  - `message`, `goal` and `context` are 1…200,000, 1…20,000 and 0…200,000 characters (our numbers; 422 past them).
- **`state`** is `completed`, `input-required`, `failed`, `rejected`, `canceled` or `timeout`: the A2A state without its prefix, lower case with hyphens. A local delegation answers `completed` or `failed`.
- **Errors**, which surface to the agent as `ApiError` text (our strings):
  - 404 "No agent named {agent}."
  - 422 "That isn't a remote agent." (`remote_agent_call` on a local agent)
  - 422 "An agent can't delegate to itself."
  - 403 "A delegated agent can't delegate further." (both `delegate` and `remote_agent_call`, for a delegated run's token)
  - 429 "At most 3 delegations at once per turn."
  - 504 "{name} didn't finish within {n} seconds; its chat so far is kept."
  - 502 with the remote's message
  - 409 "{name} can't run: {reason}" (missing folder, read-only, nesting)
- **The httpx client.** `agent_tools_a2a` makes its own `ObjectClient` with `httpx.Client(timeout=DELEGATE_TIMEOUT + 30)`, because M11's client times out at 30 s.

### Delegation (`backend/objectapp/delegation.py`, T6)

```python
DELEGATE_PROMPT: str   # our text, formatted with caller, goal, context, cap:
    # "{caller}, another agent working for the same person, has handed you this task.\n\nGoal: {goal}\n\n"
    # "Context from {caller}:\n{context}\n\nDo it with your own tools. When you are done, reply with a summary for "
    # "{caller} of what you did and found, at most {cap:,} characters."   (the Context paragraph only when context)

@dataclass
class DelegationResult:
    agent: AgentRecord; chat_id: str; state: str; summary: str; cut: bool

class Limiter:                                          # module-level LIMITER
    def enter(self, turn_token_id: str) -> None         # raises Busy at DELEGATE_MAX_AT_ONCE in flight for that token
    def leave(self, turn_token_id: str) -> None
DELEGATED_CHATS: set[str]                               # chat ids of delegated runs in flight (guarded by a lock)
def is_delegated_chat(chat_id: str | None) -> bool

async def delegate(ctx: ApiContext, registry: AgentRegistry, caller: AgentRecord, caller_token: TokenRecord,
                   target: AgentRecord, goal: str, context: str, *, api_url: str,
                   disconnected: Callable[[], Awaitable[bool]]) -> DelegationResult
    # local target: headless.run_chat(target, prompt=DELEGATE_PROMPT…, purpose="delegate",
    #   header={"delegated": True, "delegated_from": caller.id, "from_chat": caller_token.chat},
    #   model=agents.effective_model(target, settings), timeout=DELEGATE_TIMEOUT, stop=disconnected);
    #   the reply cut to DELEGATE_SUMMARY_CAP + "…" (cut=True)
    # remote target: remotechat.call_remote(..., timeout=DELEGATE_TIMEOUT, delegated_from=caller.id, cap=DELEGATE_SUMMARY_CAP)
    # always: the token dropped, the chat id removed from DELEGATED_CHATS, LIMITER.leave
```

**Contributors registered at import** (orders from M17's registry of contributor orders):

- `"delegation"` at **64** (after M17's `"tools"` 60 and M19's `"gateway-tools"` 62, before M18's `"review-tools"` 68).
  - When `scope.purpose == "delegate"`: `mcp__object-agent__delegate` and `mcp__object-agent__remote_agent_call` are removed from `allowed` and added to `disallowed`.
  - For every purpose: `env["MCP_TOOL_TIMEOUT"] = str(int((DELEGATE_TIMEOUT + 60) * 1000))`, so a long `delegate` call isn't cut by the CLI (the T1 spike checks the variable).
- `"fence-remote"` at **75** (after M17's `"fence"` 70). `Read(<rp>/**)` and `Edit(<rp>/**)` go into `deny_rules` for every `registry.remote_folders()` path (via `agentrun.rule_path`), deduplicated.

**The caller's memory** (spec: "can't write the caller's memory"):

- The delegated run is a turn of the **target**. Its token's `agent` is the target's id, and M17's `/api/v1/agent/*` routes act only on the token's agent. So M18's `memory` and `skill_manage` tools, called in a delegated run, change only the target's own files.
- The caller's folder is in the run's fence (M17: other agents' folders). A delegated run is also never run *as* the caller, since self-delegation is refused.
- Delegated runs don't go through `/api/ai/chat`, and `"delegate"` is not in M18's `reviews.REVIEW_PURPOSES`, so M18's background reviews never fire for them (our call, like schedule runs).

M20 relies on M18 for the tool names `memory` and `skill_manage` (M18's `memory(action, target, content=None, old_text=None)`), `reviews.watch` and `agentskills.MEMO` (used by `headless.run_chat`, below), and the token's `purpose` field (M18's `run`, `budget`, `used` and `tools` stay at their defaults).

### The headless agent chat (`backend/objectapp/headless.py`, T6)

One local agent turn with no client stream. `delegation` uses it; M21's schedules call it too, so these transcripts are written in one place.

```python
@dataclass
class HeadlessResult:
    chat_id: str
    state: Literal["done", "error", "stopped"]   # "stopped": the timeout or stop() closed the run
    text: str                                    # the whole reply, or the text shown so far
    session_id: str | None; model: str | None
    error: str | None                            # the error event's message
    tool_lines: list[dict[str, Any]]             # this turn's transcript tool lines (M16's paired events)

async def run_chat(target: AgentRecord, *, settings: dict[str, Any], space_root: Path, space_name: str,
                   space_key: str | None, api_url: str, prompt: str, title: str, purpose: str, model: str | None,
                   timeout: float, header: dict[str, Any] | None = None,
                   stop: Callable[[], Awaitable[bool]] | None = None,
                   announce: Callable[[ChangeEvent], None] | None = None) -> HeadlessResult
    # 1. the default agent's folder via AgentRegistry.ensure_default (its first write); a nesting problem raises
    #    agentrun.RunRefused before anything is written (callers map it to their own message)
    # 2. chat_id = transcripts.new_chat_id(); transcripts.start(..., title=title, **(header or {})); the user line
    # 3. token = TokenStore.ephemeral(target.name, "read-write", agent=target.id, chat=chat_id, purpose=purpose)
    # 4. RunScope(target, space_root, space_name, api_url, secret, write=True, chat_id=chat_id, purpose=purpose,
    #             state=appstate.state_dir())
    # 5. ai.Turn(mode="chat", prompt_fresh=ai.build_prompt("chat", prompt, ai.ContextPack(), None, []), session_id=None,
    #            timeout=timeout,   # M17's Turn.timeout: run_turn's own deadline is this run's, not M10's 300 s
    #            run=lambda resume: agentrun.build_run(scope, claude=<ai.find_claude(settings)>, model=model, resume=resume))
    # 6. ai.run_turn (its deadline is `timeout`; reaching it ends the result "stopped"); every event also goes to
    #    M18's reviews.watch(event, folder=, memo_key=<token id>);
    #    stop() polled every 0.5 s: True closes the run (kills its process tree)
    # 7. the tool lines and the assistant line (stopped: true when cut short) or the error line appended in one write,
    #    as M17's chat route does; ChangeEvent("agentChats", target.id, chat_id) announced
    # 8. finally: the token dropped and agentskills.MEMO.forget(<token id>)
```

`header` goes to `transcripts.start` as keyword arguments: M20's `delegated`, `delegated_from` and `from_chat`; M21 adds `schedule`. No review is started: the purposes callers pass (`"delegate"`, `"schedule"`) are never in `REVIEW_PURPOSES`, and `run_chat` never calls `ReviewRunner.after_turn`.

**The flat rule, twice.**

1. In the run's arguments: the "delegation" contributor.
2. At the route: a request whose token's `chat` is in `DELEGATED_CHATS` answers 403.

### Fakes (T1)

**`backend/tests/fake_a2a.py`** is a synthetic A2A v1.0 agent on the stdlib `http.server.ThreadingHTTPServer`, bound to `127.0.0.1` only, with no new dependency.

```python
class FakeA2A:
    def __init__(self, *, streaming: bool = True, token: str | None = None, header: tuple[str, str] | None = None,
                 name: str = "Fake Planner", card_version: str = "1.0", log: Path | None = None) -> None
    def start(self) -> str                 # base URL "http://127.0.0.1:<port>"; serves CARD_PATH and POST /a2a
    def stop(self) -> None
    requests: list[dict[str, Any]]         # every request: method, path, headers (Authorization kept so tests can
                                           # assert it), JSON-RPC method, params; also appended to `log` as JSONL
    card_override: dict[str, Any] | None   # serve this card instead (refusal tests)
    raw_override: Callable[[str], tuple[int, dict[str, str], bytes]] | None   # hostile answers per JSON-RPC method
# python backend/tests/fake_a2a.py --port 8799 [--no-streaming] [--token T]   (for Gene's hand checks)
```

- Without the right `Authorization` (or header), it answers 401.
- The reply is steered by markers in the user message's text parts:
  - none: "Echo: <first text part>", plus a `contextId` it keeps per context, and `ctx=<contextId> task=<taskId or ->` on a second line;
  - `A2A:input`: `TASK_STATE_INPUT_REQUIRED` with the status message "Which date?". The next message carrying that `taskId` completes with "Booked for <its text>".
  - `A2A:file`: an artifact with a `raw` part (`filename` "plan.md", `text/markdown`, base64 of "# Plan").
  - `A2A:url`: a `url` part `https://example.org/x.pdf`.
  - `A2A:data`: a `data` part `{"rooms": 2}`.
  - `A2A:fail`, `A2A:reject`, `A2A:auth`: the matching state.
  - `A2A:slow:<s>`: `TASK_STATE_WORKING`, then waits `<s>` seconds before completing.
  - `A2A:long:<n>`: a text of `n` characters.
  - `A2A:echo-parts`: replies with every received text part joined, so tests can see what was sent.
- Streaming answers send `task` (working), then `artifactUpdate`s (text in two chunks, `append: true`), then `statusUpdate` (completed). `CancelTask` answers the task as `TASK_STATE_CANCELED` and is logged.

**`fake_claude.py`** gains `FAKE:long:<n>` (a reply of `n` characters) and `FAKE:echo-env` (the reply names `MCP_TOOL_TIMEOUT`'s value). M10/M16/M17 markers are unchanged.

### Our choices (summary)

The full list is in "Our calls" at the end.

## Tasks

Each task runs only its own tests and those of the modules it touched. The full suites run in T9.
Every commit message below ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Task 1: Contract, fakes and the timeout spike (first, alone)

**Files:**

- Create:
  - `backend/objectapp/remotemodel.py`
  - stubs:
    - `backend/objectapp/a2a.py` (the dataclasses, `A2AError`, the state sets and `parse_card`'s signature raising `NotImplementedError`);
    - `backend/objectapp/api_remote_agents.py` and `backend/objectapp/api_agent_a2a_v1.py` (`def router(ctx) -> APIRouter`, no routes);
    - `backend/objectapp/agent_tools_a2a.py` (`register(server, client)` that registers nothing).
  - `backend/tests/fake_a2a.py`, `backend/tests/test_m20_contract.py`, `backend/tests/test_m20_live_cli.py`
  - `docs/superpowers/plans/m20-spike.md`
- Modify:
  - `pyproject.toml` and `uv.lock`: `httpx>=0.28.1` moves to `[project] dependencies` (`uv add httpx`; the dev entry is removed).
  - `backend/objectapp/server.py`: mount the two stub routers.
  - `backend/objectapp/toolcatalog.py`: the three `AGENT_TOOLS` names and labels.
  - `backend/objectapp/agent_mcp.py`: `TOOL_MODULES` gains `"objectapp.agent_tools_a2a"`.
  - `backend/tests/fake_claude.py`: `FAKE:long:<n>`, `FAKE:echo-env`.
  - `frontend/src/api/types.ts`, `frontend/src/api/client.ts`, `frontend/src/test/mockApi.ts`.

**Interfaces.**

- Consumes: M17's `toolcatalog`, `agent_mcp`, `server.create_app`.
- Produces: everything in the Contract marked T1, the two fakes and the spike's finding.

**Steps.**

- [ ] **Step 1: failing tests** in `test_m20_contract.py`:
  - `test_constants`: `DELEGATE_SUMMARY_CAP == 24_000`, `DELEGATE_MAX_AT_ONCE == 3`, `DELEGATE_TIMEOUT < ai.TURN_TIMEOUT`, `REMOTE_CALL_TIMEOUT <= REMOTE_CALL_TIMEOUT_MAX < ai.TURN_TIMEOUT`, `A2A_VERSION == "1.0"`, `CARD_PATH == "/.well-known/agent-card.json"`.
  - `test_card_url_for`:
    - `"https://h.example/a/agent-card.json"` stays as is;
    - `"https://h.example:8443/a2a"` gives `"https://h.example:8443/.well-known/agent-card.json"`;
    - `"ftp://h"`, `"javascript:alert(1)"`, `""` and `"h.example"` raise `AgentInvalid("That isn't an http or https address.")`.
  - `test_clean_auth`:
    - `header` with name `"X-Api-Key"` passes;
    - `"Host"`, `"a b"`, a 65-character name and a value with `"\r\n"` are refused;
    - `bearer` without a value is refused;
    - `none` drops any value.
  - `test_remote_agent_file_keeps_unknown_keys`: `RemoteAgentFile.model_validate({... , "x": 1}).model_dump()["x"] == 1`.
  - `test_agent_tools_registered`:
    - `toolcatalog.AGENT_TOOLS` holds the three names in order, right after M18's `session_search` (M21 appends `schedule_manage` after them, so the test doesn't assume they are last);
    - the "object-agent" group lists them with the three labels, all `default_on`;
    - `"objectapp.agent_tools_a2a" in agent_mcp.TOOL_MODULES`.
  - `test_stub_routers_mounted`: `create_app` imports both new routers.
  - `test_fake_a2a_card_and_echo`:
    - `FakeA2A(token="t").start()` serves the card at `CARD_PATH`: `supportedInterfaces[0]` is `{"url": ".../a2a", "protocolBinding": "JSONRPC", "protocolVersion": "1.0"}`, and `capabilities.streaming` is true;
    - a `SendMessage` without the token is 401; with it, the result is `{"task": {... "status": {"state": "TASK_STATE_COMPLETED"}}}` with "Echo: hi";
    - no part in any answer has a `kind` key.
  - `test_fake_claude_long`: `FAKE:long:30000` gives a `done.text` of 30,000 characters.
  - `test_ai_modules_use_no_network_client_m20`: a static check that none of `remotemodel`, `remotesecrets`, `remotechat`, `delegation`, `headless`, `api_remote_agents` or `api_agent_a2a_v1` imports `httpx`, `requests`, `urllib.request`, `socket` or `http.client`. `a2a` is the only one allowed.
  - Front end: `npx tsc -b --noEmit`; `client.m20.test.ts` "test the remote agent methods call their routes".
- [ ] **Step 2:** run them; they fail.
- [ ] **Step 3:** implement the Contract signatures and both fakes.
- [ ] **Step 4: the timeout spike.** `test_m20_live_cli.py` is skipped unless `OBJECT_LIVE_CLAUDE=1`. It runs the real `claude` with M17's `CLI_FLAGS`, `--model haiku` and `--no-session-persistence`, and a test MCP server (stdio, in the test's temp folder) whose tool `slow` sleeps 45 s and answers "slow done".
  - `test_mcp_tool_timeout_is_honoured`:
    - with `MCP_TOOL_TIMEOUT=20000` in the run's environment, the `slow` tool's `tool_result` is a timeout error;
    - with `MCP_TOOL_TIMEOUT=120000`, it answers "slow done".
  - `m20-spike.md` records the CLI version and both results.
  - **Stop-and-ask:** if the variable has no effect, and the CLI's default MCP timeout is shorter than `DELEGATE_TIMEOUT`, the build stops after T1 and asks Gene. The fallback (a shorter `DELEGATE_TIMEOUT`) changes a number he sees.
- [ ] **Step 5:** `uv run pytest backend/tests/test_m20_contract.py -q`, `npx vitest run src/api`, `npx tsc -b --noEmit` pass; the live spike passed once.
- [ ] **Step 6:** commit `feat(m20): contract, fake A2A agent and MCP timeout spike`. The message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Task 2: The A2A client (Lane A)

**Files:**

- Fill: `backend/objectapp/a2a.py`
- Create: `backend/tests/test_m20_a2a_client.py`

**Interfaces.**

- Consumes: `remotemodel` constants; `FakeA2A`.
- Produces: `fetch_card`, `parse_card`, `user_message`, `send`, `cancel`, `Card`, `Auth`, `Update`, `A2AError`, `STATE_TERMINAL`, `STATE_INTERRUPTED` (Contract).

**Steps.**

- [ ] **Step 1: failing tests** (each against a `FakeA2A` on `127.0.0.1`; async tests with `asyncio.run`):
  - `test_fetch_and_parse_card`: `name`, `endpoint_url` (the interface URL), `protocol_version == "1.0"`, `streaming is True` and `skills` (id, name, description, tags, examples) come from the fake's card. The request carried `A2A-Version: 1.0` and the bearer.
  - `test_card_refusals`, parametrised, each raising `A2AError` with `status == 422` and the Contract message:
    - a 0.3 card (`url` and `protocolVersion: "0.3.0"` at the top level) gives "This agent speaks A2A 0.3.0; Object speaks A2A 1.0.";
    - a gRPC-only card, and an interface URL `file:///etc/passwd`, give "This agent doesn't offer A2A 1.0 over JSON-RPC.";
    - `[]`, `"x"` and `{}` give "That address didn't answer with an Agent Card.";
    - a card of 1 MiB + 1 byte is refused without reading past the cap (`status == 502`, "The Agent Card is too large.", our string).
  - `test_send_streaming`:
    - the fake's log shows `SendStreamingMessage` with `Accept: text/event-stream`;
    - the params' `message` has a `messageId`, `role == "ROLE_USER"` and `parts == [{"text": "hi"}]`, with no `kind` anywhere;
    - `configuration == {"acceptedOutputModes": [...OUTPUT_MODES], "returnImmediately": False}`;
    - the updates are text "Ech", text "o: hi…" (the two appended chunks), then state `TASK_STATE_COMPLETED` with the fake's `context_id` and `task_id`.
  - `test_send_plain_polls`: with `FakeA2A(streaming=False)` and `A2A:slow:2`, `SendMessage` answers a working task. `GetTask` is called about every second until the task completes. The updates end with `TASK_STATE_COMPLETED`.
  - `test_message_result`: a `{"message": …}` result (fake marker `A2A:message`, added to the fake in this task if missing) gives its text and a state update with `state is None`.
  - `test_context_and_task_ids_sent`: `user_message(parts, context_id="c1", task_id="t1")` carries both; with `None`, neither key is present.
  - `test_input_required`: `A2A:input` ends with state `TASK_STATE_INPUT_REQUIRED` and `status_text == "Which date?"`.
  - `test_artifacts`:
    - `A2A:file` gives a `file` update with `raw == b"# Plan"`, `name == "plan.md"` and `media_type == "text/markdown"`;
    - `A2A:url` gives `url == "https://example.org/x.pdf"`;
    - `A2A:data` gives `data == {"rooms": 2}`.
  - `test_deadline_cancels`: `A2A:slow:30` with a deadline 1 s away raises `A2AError(504)`, and the fake's log shows `CancelTask` with the task id.
  - `test_hostile_answers`, parametrised over `raw_override`:
    - an HTML 502 gives `A2AError(502)` "{host} answered 502.";
    - a JSON-RPC `error` `{"code": -32001, "message": "nope"}` gives "Fake Planner answered with an error: nope (-32001)";
    - a `result` with neither `task` nor `message` gives `A2AError(502)` "Fake Planner sent an answer Object can't read." (our string);
    - an SSE stream with a non-JSON `data:` line skips it and keeps reading;
    - a stream past `STREAM_MAX_BYTES`, and a raw part whose decoded size passes `FILE_MAX_BYTES`, are stopped with `A2AError(502)` "… sent more than Object accepts." (our string);
    - bad base64 gives one text update "(A file that couldn't be read was left out.)" (our string) and the stream continues;
    - a `kind: "text"` key on a part is ignored.
  - `test_redirects_not_followed_and_auth_not_forwarded`:
    - a 302 from the card URL to `http://localhost:<other fake>/…` gives `A2AError(502)` "{host} answered 302.";
    - the other fake logged no request;
    - the bearer is in no log record (`caplog` at DEBUG, every logger) and in no `A2AError.message`.
  - `test_auth_header_kind`: `Auth("header", "X-Api-Key", "k")` sends `X-Api-Key: k` and no `Authorization`. `repr(auth)` doesn't contain `"k"`.
- [ ] **Step 2:** run; fail.
- [ ] **Step 3:** implement with httpx's `AsyncClient.stream`, reading bodies in chunks against the caps. Use `follow_redirects=False`. SSE is parsed by hand: `data:` lines joined until a blank line. Polling sleeps with `asyncio.sleep(POLL_INTERVAL)`, bounded by the deadline.
- [ ] **Step 4:** `uv run pytest backend/tests/test_m20_a2a_client.py -q` passes.
- [ ] **Step 5:** commit `feat(m20): A2A 1.0 JSON-RPC client`.

### Task 3: Remote agents in the registry, secrets, transcripts (Lane B)

**Files:**

- Create: `backend/objectapp/remotesecrets.py`, `backend/tests/test_m20_remote_agents.py`
- Modify:
  - `backend/objectapp/agents.py` (M17): `AgentRecord.kind`, the remote methods, `remote_auth`, `remote_card`, `find_by_name`, and the remote refusals in the M17 methods.
  - `backend/objectapp/transcripts.py` (M17): `start` kwargs, `find_by_context`, `last_a2a`, `from` in summaries.

**Interfaces.**

- Consumes:
  - `remotemodel`; `a2a.Card` and `a2a.parse_card` (the T1 dataclass; tests build `Card` values directly and use a stub `parse_card` until T2 lands);
  - M19's `secretstore.SecretStore` and `redact`;
  - M17's `agentfiles.read_agent_file`/`write_agent_file`, `textfile`, `jsonstore.dump_json`, `ids.new_ulid`.
- Produces: the registry and transcript additions in the Contract, and `remotesecrets`.

**Steps.**

- [ ] **Step 1: failing tests** (state dir = `tmp_path/state`):
  - `test_create_remote_folder_and_entry`:
    - `<state>/agents/Fake Planner/.object-agent/agent.json` validates as `RemoteAgentFile` (`kind: "remote"`, `icon: "ph-globe"`, `auth.kind: "bearer"`, `contextNoticeAt: None`);
    - `card.json` holds the card;
    - there is no `CLAUDE.md` and no `.claude/`;
    - `agents.json` gains `{"kind": "remote", ...}`;
    - `list()` shows it after the default agent, with `to_api(...)["kind"] == "remote"`, `remote.auth.set is True`, `model is None` and `toolsOff == []`.
  - `test_secret_never_stored_or_shown`, with the token `"tok-SECRET-123"`:
    - its bytes appear in no file under `<state>` except M19's `secrets.json`;
    - it appears in no `to_api` answer, no `repr(record)` and no log record (`caplog` at DEBUG);
    - `remote_auth(record).value == "tok-SECRET-123"`.
  - `test_name_clash_and_failure_cleanup`:
    - a second remote "Fake Planner" gets `Fake Planner (2)/`;
    - when `remotesecrets.put` raises, no folder is left and `agents.json` is unchanged.
  - `test_save_remote`:
    - a new name is saved with the revision; a stale revision raises `AgentConflict`;
    - `auth=None` keeps the secret; `auth` kind `none` removes it (`is_set` False);
    - a new bearer replaces it;
    - unknown keys in `agent.json` survive.
  - `test_refresh_keeps_name_and_drops_secret_on_host_change`:
    - a refresh with the same endpoint host keeps the secret and Gene's name, and updates `card.json` and `cardFetchedAt`;
    - a refresh whose endpoint host changed removes the secret.
  - `test_mark_context_notice_once`: the first call sets `contextNoticeAt`; a second call keeps the first time (mtime unchanged).
  - `test_m17_methods_refuse_remote`: `save`, `read_instructions`, `save_instructions` and `duplicate` on a remote id raise `AgentInvalid` with the Contract message.
  - `test_delete_and_restore_remote`:
    - delete moves the folder to `<state>/agents/.trash/` and returns a `trashId`; the secret is kept;
    - restore lists it again with `kind == "remote"` and the secret set;
    - `unregister` leaves the folder and removes the entry.
  - `test_add_folder_of_a_remote_copy`: a copied remote folder with a new id registers as remote, with `auth.set is False`. No file in it changes.
  - `test_find_by_name`: by id; by `"fake planner"` (case-insensitive); an unknown name raises `AgentNotFound`.
  - `test_remote_folders_and_local_folders`: `remote_folders()` lists only remote folders; `local_folders()` (M17) lists no remote one.
  - `test_list_never_writes_with_remote`: `list()` with a remote entry writes nothing (the state dir's mtimes are kept).
  - `test_transcript_delegated_header`: `start(..., delegated=True, delegated_from="assistant", from_chat="01K…")` writes `"delegated": true, "from": "assistant", "fromChat": "01K…"`; `list_chats` shows `delegated: True, from: "assistant"`; a non-delegated chat shows `from: None`.
  - `test_last_a2a_and_find_by_context`:
    - after two assistant lines with `a2a.contextId` `"c1"`, `last_a2a` is the second line's;
    - `find_by_context(folder, "c1")` gives the chat; an unknown context gives None;
    - `read` keeps `a2a` and `attachments` on the items.
- [ ] **Step 2:** run; fail.
- [ ] **Step 3:** implement. A remote record's `revision` is the sha256 of `agent.json` (M17's rule). `find_by_name` takes the first listed match in registry order (default agent first).
- [ ] **Step 4:** `uv run pytest backend/tests/test_m20_remote_agents.py backend/tests/test_m17_agents.py backend/tests/test_m17_transcripts.py -q` passes, with M17's tests unchanged.
- [ ] **Step 5:** commit `feat(m20): remote agents in the registry, their secrets and transcripts`.

### Task 4: Chatting with a remote agent (Lane A, after T2 and T3)

**Files:**

- Create: `backend/objectapp/remotechat.py`, `backend/tests/test_m20_remote_chat.py`
- Modify: `backend/objectapp/api_ai.py` (M17): the remote hook after the agent lookup in `POST /ai/chat`. Nothing else changes.

**Interfaces.**

- Consumes:
  - `a2a` (T2); the registry and transcript additions (T3);
  - `ai.gather_context`, `ai.TURN_TIMEOUT`, `ai.valid_session`;
  - M17's chat route (the agent lookup and its `chat` event), `transcripts.start`/`append`/`new_chat_id`;
  - `space.safe_filename`, `textfile.create_new`, `ChangeEvent`.
- Produces: `build_parts`, `respond`, `stream_turn`, `call_remote`, `RemoteResult`, `save_attachment`, `safe_attachment_name`, and the `attachment` event.

**Steps.**

- [ ] **Step 1: failing tests.** The app comes from `create_app` over a synthetic space (`Pages/Open.md` with the marker `OPEN-TEXT`; `Pages/Secret.md` tagged Exclude from AI, holding `SECRET-MARKER`; a Task template with `TEMPLATE-MARKER`), a `FakeA2A(token="t")`, and a remote agent added with `AgentRegistry.create_remote`.
  - `test_remote_turn_streams`:
    - `POST /api/ai/chat {mode:"chat", prompt:"hi", agentId:<remote>}` gives the frames `chat`, then `text`, then `done` with `sessionId: None` and `proposal: None`;
    - the joined `text` equals `done.text == "Echo: hi\nctx=<c> task=-"`;
    - the fake's log shows `SendStreamingMessage`;
    - no `claude` was started (the `FAKE_CLAUDE_LOG` file is absent), even with `claudePath` unset.
  - `test_plain_send_when_card_has_no_streaming`: with `streaming=False`, the log shows `SendMessage`.
  - `test_transcript_written`:
    - `<remote folder>/.object-agent/sessions/<chatId>.jsonl` holds the header (`delegated: false`), a user line and an assistant line with `a2a.contextId`, `a2a.state == "TASK_STATE_COMPLETED"` and `model: None`;
    - an `agentChats` event was announced.
  - `test_context_id_kept_and_input_required_continues`:
    - turn 2 with the same `chatId` sends `contextId == <c>` and no `taskId`;
    - a turn with `A2A:input` answers `done.text == "Which date?"`;
    - the next turn, "June 3", sends its `taskId` and answers "Booked for June 3";
    - the turn after that sends no `taskId`;
    - a turn with a new `chatId` sends no `contextId`.
  - `test_task_not_found_retries_without_task_id`: when the fake answers `-32001` to the `taskId`, the turn is sent again once without it and answers.
  - `test_excluded_context_never_sent`:
    - after `POST /remote-agents/{id}/context-notice` (or `mark_context_notice` before T5), a turn with `contextPaths [Open, Secret, the template]` and `A2A:echo-parts` answers text containing `OPEN-TEXT`;
    - every request body in the fake's log is free of `SECRET-MARKER` and `TEMPLATE-MARKER`;
    - `done.skipped` lists Secret (`excluded`) and the template (`template`).
  - `test_context_without_notice_is_428`: the same request before the notice answers 428 with `detail`, `agentId` and `host`. The fake logged no request.
  - `test_proposal_modes_refused_for_remote`: for each of `askBlock`, `tagBlock`, `tagObject`, `autofill` and `rephrase` (with a `block`), the answer is one `error` "Remote agents can only chat.", and the fake logged nothing.
  - `test_missing_secret`: after `remotesecrets.remove`, one `error` with the Contract message, and no request.
  - `test_artifacts_and_attachments`:
    - `A2A:file` gives an `attachment` event `{kind: "file", name: "plan.md", file: "<chatId>/plan.md", size: 6}`;
    - the file's bytes are `b"# Plan"`;
    - the assistant line's `attachments` match;
    - `A2A:data` gives text containing a fenced `json` block with `"rooms": 2`;
    - `A2A:url` gives `kind: "url"` with the https URL.
  - `test_attachment_names_and_caps`, parametrised:
    - file names `../../evil.md`, `CON`, `a:b`, `""` (with `application/pdf`) and a 300-character name each give a safe name inside `files/<chatId>/` (`resolve()` stays under it), of at most 120 characters, `attachment.pdf` for the empty one;
    - a second `plan.md` in one chat gives `plan (2).md`;
    - a `url` part `javascript:alert(1)` gives no attachment and the "left out" line in the text;
    - a 1 MB data part is cut to `DATA_BLOCK_MAX_CHARS` + "…".
  - `test_terminal_states`: `A2A:fail`, `A2A:reject`, `A2A:auth` and a canceled task each give one `error` with the Contract message (with "Fake Planner"), and an `error` line in the transcript.
  - `test_stop_cancels_the_task`:
    - closing the response during `A2A:slow:30` makes the fake log `CancelTask`;
    - the transcript's assistant line has `stopped: true` and the text so far.
  - `test_timeout`: with `ai.TURN_TIMEOUT` patched to 1 and `A2A:slow:5`, the answer is the `error` "Fake Planner took too long (over 1 seconds) and was stopped." and `CancelTask` is logged.
  - `test_hidden_ai_still_403`: with "Hide AI features" on, a remote turn answers 403.
  - `test_a_remote_turn_writes_no_space_file`: the space's files are byte-identical after every turn above.
  - `test_call_remote_marks_delegated`:
    - `call_remote(..., delegated_from="assistant", cap=10)` with `A2A:long:50` gives `cut is True` and text of 10 characters + "…";
    - the chat's header has `delegated: true, from: "assistant"`;
    - a second call with the returned `context_id` appends to the same chat.
- [ ] **Step 2:** run; fail.
- [ ] **Step 3:** implement. `respond` builds the pack with `ai.gather_context(space, req.contextPaths)`. It starts the transcript with `aichat.default_title([{role:"user", text:prompt}])`, and appends the user line (with the sent `contextPaths`) at the start and the assistant or error line at the end, as M17 does. Attachments are saved as they arrive.
- [ ] **Step 4:** `uv run pytest backend/tests/test_m20_remote_chat.py backend/tests/test_m17_chat.py backend/tests/test_m10_ai.py -q` passes, with M17's and M10's tests unchanged.
- [ ] **Step 5:** commit `feat(m20): chat with remote agents over A2A in the same panel`.

### Task 5: Remote agent routes (Lane B, after T2 and T3)

**Files:**

- Fill: `backend/objectapp/api_remote_agents.py`
- Create: `backend/tests/test_m20_remote_routes.py`
- Modify (M18's files, for remote ids only): `backend/objectapp/api_learning.py` (its routes answer 422 for a remote agent) and `backend/objectapp/curator.py` (`tick` skips remote records)

**Interfaces.**

- Consumes:
  - `a2a.fetch_card`/`parse_card`;
  - the T3 registry methods; `remotemodel.card_url_for`/`clean_auth`;
  - `server.reveal_in_file_manager` (M10's helper; patched in tests);
  - `ChangeEvent`.
- Produces: the routes table rows of T5 and their events.

**Steps.**

- [ ] **Step 1: failing tests** (`TestClient` over `create_app`, with a `FakeA2A(token="t")`):
  - `test_preview_writes_nothing`:
    - `POST /api/remote-agents/preview {url: <base>, auth: {kind: "bearer", value: "t"}}` answers the card, the `endpointUrl`/`endpointHost` and `warnings: []`;
    - the state dir is unchanged (no file, no `agents.json`).
  - `test_preview_errors`:
    - no token gives 502 "127.0.0.1 refused the token.";
    - a closed port gives 502 starting "Couldn't reach 127.0.0.1";
    - a 0.3 card gives 422 with its message;
    - `url: "ftp://x"` gives 422.
  - `test_preview_warnings`:
    - a card whose interface URL is on `localhost` while the card is on `127.0.0.1` warns "This agent's card sends messages to localhost, not 127.0.0.1.";
    - the http warning isn't shown for loopback (its rule is unit-tested with a non-loopback URL in `remotemodel`).
  - `test_add_lists_and_announces`:
    - 201 with `kind: "remote"` and `remote.auth == {kind: "bearer", headerName: None, set: True}`;
    - an `agents` event whose `origin` is the clientId;
    - `GET /api/agents` lists it;
    - a second add of the same card answers 409 "This agent is already listed as Fake Planner.".
  - `test_secret_absent_from_answers`: no answer of any route in this file, nor `GET /api/agents`, contains `"t"` as a token value. The fake uses a long distinctive token for this test.
  - `test_put_remote`:
    - a name change is saved with the revision; a stale revision answers 409 `{currentRevision}`;
    - `auth: null` keeps the token;
    - `auth: {kind: "header", headerName: "Host", value: "x"}` answers 422.
  - `test_url_change_drops_the_secret`: a refresh after the fake's card moves its interface to another host gives `remote.auth.set False`, and the new host's fake logged no request with the token. (The chat's "needs its token again" error is T4's `test_missing_secret`.)
  - `test_context_notice_route`: it sets `contextNoticeAt`, and a second call answers the same value.
  - `test_m17_routes_on_a_remote_id`:
    - `PUT /api/agents/{id}` and `PUT /api/agents/{id}/instructions` answer 422;
    - `GET /api/agents/{id}/tools` answers `{groups: []}`;
    - `DELETE` answers a `trashId`; restore answers it again.
  - `test_m18_routes_on_a_remote_id`: `GET /api/agents/{id}/memory`, `GET …/skills` and `POST …/chats/<chat>/learn` answer 422 with the message above; `Curator.tick()` with the remote agent's curator due returns no remote id and writes nothing in its folder.
  - `test_reveal_file`:
    - with a file written by the test at `<remote folder>/.object-agent/files/<chatId>/plan.md` (T4 isn't needed), `POST /api/agents/{id}/files/reveal {file: "<chatId>/plan.md"}` calls the patched reveal with that path;
    - `{file: "../../agents.json"}` and an unknown file answer 404.
- [ ] **Step 2:** run; fail.
- [ ] **Step 3:** implement. The card is fetched with `asyncio`, inside the route. Error messages never include header values.
- [ ] **Step 4:** `uv run pytest backend/tests/test_m20_remote_routes.py backend/tests/test_m17_routes.py -q` passes.
- [ ] **Step 5:** commit `feat(m20): add, edit, refresh and remove remote agents`.

### Task 6: Delegation and the agent tools (Lane C, after T3)

**Files:**

- Create: `backend/objectapp/headless.py`, `backend/objectapp/delegation.py`, `backend/tests/test_m20_delegation.py`, `backend/tests/test_m20_agent_tools.py`
- Fill: `backend/objectapp/api_agent_a2a_v1.py`, `backend/objectapp/agent_tools_a2a.py`

**Interfaces.**

- Consumes:
  - M17's `agentrun` (`RunScope`, `build_run`, `add_contributor`, `rule_path`, `RunRefused`), `ai.Turn`/`ai.run_turn`, `TokenStore.ephemeral`/`drop_ephemeral`, `v1guard.agent_auth`, `transcripts`, `agents.effective_model`, `settings.read`;
  - M18's `reviews.watch`, `agentskills.MEMO` and the token's `purpose` field;
  - `mcp_server.ObjectClient`/`ApiError`;
  - T3's `find_by_name`, `remote_folders` and `transcripts.start` kwargs;
  - `remotechat.call_remote` (T4's signature from the Contract; until T4 lands, the tests patch it with a double that records its arguments).
- Produces:
  - `delegate`, `DelegationResult`, `LIMITER`, `DELEGATED_CHATS`, `is_delegated_chat`, `DELEGATE_PROMPT`;
  - the contributors `"delegation"` (64) and `"fence-remote"` (75);
  - `headless.run_chat` and `HeadlessResult` (M21 consumes them);
  - the three `/api/v1/agent/*` routes and the three MCP tools.

**Steps.**

- [ ] **Step 1: failing tests.** The setup is the synthetic space, the fake `claude` (`claudePath`), a local agent "Researcher" (`AgentRegistry.create`), and the caller's turn token minted as M17's chat route does: `TokenStore.ephemeral("Assistant", "read-write", agent="assistant", chat=<caller chat ULID>)`. Requests go to `/api/v1/agent/*` with that token, as the MCP tool would send them.
  - `test_m20_delegation.py`:
    - `test_delegate_to_a_local_agent`:
      - `POST /api/v1/agent/delegate {agent: "researcher", goal: "Find rack notes", context: "Gene asked"}` answers `{agent: {id, name: "Researcher", kind: "local"}, chatId, state: "completed", summary, cut: false}`;
      - the fake's log shows the run's `cwd` is Researcher's folder;
      - its prompt holds `DELEGATE_PROMPT` with "Assistant", the goal and the context;
      - the run's token is a `read-write` token whose `agent` is Researcher's id and whose `purpose` is `"delegate"`;
      - no M18 review started: Researcher's transcript has no `review` line.
    - `test_delegated_chat_is_kept_and_marked`:
      - Researcher's `sessions/<chatId>.jsonl` header has `delegated: true`, `from: "assistant"` and `fromChat: <caller chat>`;
      - `GET /api/agents/<Researcher>/chats` lists it with `delegated: true, from: "assistant"`;
      - an `agentChats` event was announced;
      - no AI Chat object was written in the space.
    - `test_summary_capped_at_24000`: `goal: "FAKE:long:30000"` gives a `summary` of 24,000 characters + "…" with `cut: true`. The transcript's assistant line keeps the full 30,000.
    - `test_delegated_run_cannot_delegate`:
      - the delegated run's `--disallowedTools` holds `mcp__object-agent__delegate` and `mcp__object-agent__remote_agent_call`, and its `--allowedTools` holds neither;
      - a request to `/delegate` or `/remote-call` with the delegated run's token, taken from the fake's log env while it waits on `FAKE:wait`, answers 403 "A delegated agent can't delegate further.".
    - `test_non_delegated_runs_keep_the_tools`: a normal chat turn's `--allowedTools` holds `mcp__object-agent__delegate`, `…__remote_agent_call` and `…__remote_agents_list`. Its env holds `MCP_TOOL_TIMEOUT == "300000"`.
    - `test_fourth_delegation_at_once_is_refused`:
      - three `/delegate` requests with `FAKE:wait` run at once (threads) on one caller token;
      - a fourth answers 429 "At most 3 delegations at once per turn.";
      - once `<log>.go` exists, the three answer `completed`;
      - a request after them is accepted;
      - a different turn token isn't limited by the first one's three.
    - `test_self_and_unknown_targets`:
      - `agent: "Assistant"` from Assistant answers 422 "An agent can't delegate to itself.";
      - `"nobody"` answers 404 "No agent named nobody.";
      - a target whose folder is missing, one that is read-only, and one nested in a space each answer 409 "Researcher can't run: …" with M17's reason;
      - no run was started in any of these cases.
    - `test_timeout_stops_the_delegated_run`:
      - with `DELEGATE_TIMEOUT` patched to 1 and `FAKE:sleep`, the answer is 504 "Researcher didn't finish within 1 seconds; its chat so far is kept.";
      - the fake's pid is gone;
      - the transcript ends with an assistant line with `stopped: true`.
    - `test_run_chat_timeout_is_its_own`: with `ai.TURN_TIMEOUT` patched to 1 and `FAKE:wait`, `run_chat(..., timeout=3)` runs past 1 s and ends `stopped` at about 3 s (the `timeout` argument governs, through `ai.Turn(timeout=)`).
    - `test_caller_going_away_stops_delegations`: an `httpx` request to the served app (a uvicorn thread, as M8's `Served`) with `FAKE:wait` is closed by the client. The delegated run's pid is gone within 3 s, and its transcript line is `stopped: true`.
    - `test_delegate_to_a_remote_agent`: with `call_remote` patched, `agent: "Fake Planner"` calls it with `timeout=DELEGATE_TIMEOUT`, `delegated_from="assistant"`, `from_chat=<caller chat>` and `cap=DELEGATE_SUMMARY_CAP`. The answer's `kind` is `"remote"`. After T4, `scripts/m20_acceptance.py` check 8 runs this end to end against the fake.
    - `test_caller_memory_untouched`:
      - the caller's folder (Assistant's, made by `ensure_default`) is hashed file by file before and after a delegated run;
      - the run's `runSettings.permissions.deny` holds `Read(<rp caller>/**)` and `Edit(<rp caller>/**)`;
      - the run's token `agent` is Researcher's id;
      - the test calls M18's `memory` tool through `agent_mcp.build_server(ObjectClient(<url>, <delegated token>, http=TestClient))` with M18's signature `memory(action="add", target="memory", content="delegated note")`. Researcher's `MEMORY.md` changes and the caller's hashes are unchanged.
    - `test_remote_folders_are_fenced`: any agent's run has `Read(<rp remote folder>/**)` and `Edit(<rp remote folder>/**)` in `deny_rules`, each once. With the fake's `FAKE:read:<remote folder>/.object-agent/sessions/<chat>.jsonl`, the result is the denial.
    - `test_contributor_orders`: in `agentrun.contributors()`, "delegation" is at 64 (after "tools" and "gateway-tools", before "review-tools") and "fence-remote" at 75 (after "fence"); no two contributors share an order.
  - `test_m20_agent_tools.py` (MCP server built with `agent_mcp.build_server` over a `TestClient`):
    - `test_tools_listed`: the server lists `agent_info` (M17), M18's tools when present, and `remote_agents_list`, `remote_agent_call` and `delegate`, with these descriptions:
      - `remote_agents_list`: "List the remote (A2A) agents you can call, with what their cards say they do."
      - `remote_agent_call`: "Send a message to a remote agent and wait for its answer. Pass context_id (and task_id when it asked for input) to continue."
      - `delegate`: "Hand a task to another agent (local or remote) by name, with a goal and context; it runs as that agent's own chat and you get back its summary."
      (our strings)
    - `test_remote_agents_list`: it gives the remote agent with `skills` from its card and `usable: true`. After `remotesecrets.remove`, `usable` is false. Local agents aren't listed.
    - `test_remote_agent_call_shape`: with `call_remote` patched to answer a `RemoteResult`, the tool answers the Contract shape. `timeout_seconds=9999` is passed as `REMOTE_CALL_TIMEOUT_MAX`; none is passed as `REMOTE_CALL_TIMEOUT`. A local agent's name gives the `ApiError` "That isn't a remote agent.".
    - `test_long_calls_outlive_the_default_client`: the module's client timeout is at least `DELEGATE_TIMEOUT + 30`.
    - `test_token_without_agent_is_403`: a stored token gets M17's 403 on all three routes.
    - `test_inputs_capped`: a `goal` of 20,001 characters gives 422.
- [ ] **Step 2:** run; fail.
- [ ] **Step 3:** implement.
  - The routes are `async`. `disconnected` is `request.is_disconnected`.
  - The local run is `headless.run_chat` (Contract), without an SSE response:
    - the prompt is `DELEGATE_PROMPT.format(...)`;
    - the space is the open one;
    - the model is `agents.effective_model(target, settings)`;
    - `purpose="delegate"`.
  - The token is always dropped in `finally` (inside `run_chat`).
- [ ] **Step 4:** `uv run pytest backend/tests/test_m20_delegation.py backend/tests/test_m20_agent_tools.py backend/tests/test_m17_agentrun.py backend/tests/test_m17_agent_mcp.py -q` passes.
- [ ] **Step 5:** commit `feat(m20): delegate, remote_agents_list and remote_agent_call agent tools`.

### Task 7: Remote agents in the Agents section and the agent page (Lane D)

**Files:**

- Create:
  - `frontend/src/agents/AddRemoteAgentDialog.tsx`, `frontend/src/agents/RemoteMark.tsx`
  - `frontend/src/agents/RemoteProfileTab.tsx`, `frontend/src/agents/RemoteCardTab.tsx`
  - `*.test.tsx` beside each
- Modify (M17 files):
  - `frontend/src/agents/AgentsSection.tsx` (and its test)
  - `frontend/src/agents/agentTabs.ts`, `frontend/src/agents/AgentPage.tsx`
  - `frontend/src/agents/ChatsTab.tsx`, `frontend/src/agents/agentText.ts`
  - `frontend/src/ai/AgentPicker.tsx` (and its test)

**Interfaces.**

- Consumes:
  - `useAgents`; the T1 client methods (`previewRemoteAgent`, `addRemoteAgent`, `saveRemoteAgent`, `refreshRemoteAgent`) and M17's (`deleteAgent`, `unregisterAgent`, `agentChats`);
  - `IconPicker`; `ChatMarkdown` is **not** used for card text (plain text only).
- Produces:
  - `AddRemoteAgentDialog(props: { open: boolean; onOpenChange(o: boolean): void })`
  - `RemoteMark(props: { className?: string })`: the text "remote", aria-label "Remote agent"
  - `AgentTab.kinds?: ('local' | 'remote')[]` (default `['local']`)
  - `RemoteProfileTab` (order 10, `kinds: ['remote']`), `RemoteCardTab` (order 15, `kinds: ['remote']`); M17's Chats tab gets `kinds: ['local', 'remote']`
  - `REMOTE_TEXT` in `agentText.ts`

**Behaviour and strings** (ours unless quoted from the spec):

- **Section.**
  - The `+` menu gains "Add remote agent…" after "Add agent folder…".
  - A remote row shows its icon, its name and `RemoteMark` (spec: a small "remote" mark).
  - A remote row's `…` menu holds "Open chat", "Settings" and "Delete". There is no Duplicate, and no "Memory & skills" (M18's item is hidden for remote agents).
  - Delete moves it to the agent trash like a local agent in the state dir, with no confirm.
- **Agent picker** (chat header): remote agents carry `RemoteMark` too.
- **Add remote agent dialog.**
  - Title "Add remote agent".
  - Field "Agent Card URL or address" (placeholder "https://agents.example.com").
  - "Authentication": "None", "Bearer token" or "Header". "Header" shows "Header name". "Token" or "Value" is a password input.
  - "Look up" calls `previewRemoteAgent` and shows:
    - the card's name, description, version and provider;
    - its skills (name and description, with tags);
    - "Sends messages to {endpointHost}";
    - "Streaming" or "No streaming";
    - each warning, in an amber line.
  - "Add agent" calls `addRemoteAgent`, using the card's name unless "Name" was edited, and opens the new agent's page. "Cancel" closes.
  - A 422 or 502 shows its `detail` under the field. The value field is cleared when the dialog closes, and the value is never put in the zustand store or `localStorage`.
- **Remote Profile tab.**
  - Name and icon each save on change with the revision. On a 409 the tab reloads, as M17's Profile does.
  - "Agent Card" shows the card URL (read-only), with "Refresh card", plus "Sends messages to {endpointHost}" and "A2A {protocolVersion}".
  - "Authentication":
    - "None", "Bearer token: set" or "Header {name}: set". When the token is missing: "Token: needed".
    - "Replace token…" opens the auth fields in place, with "Save" and "Cancel". The saved value is never shown again.
  - "Context sent": "Not yet", or "First sent {date}" (from `contextNoticeAt`).
  - "Folder", with "Open folder" (M17's reveal) and "Remove from list".
- **Card tab.** What the Agent Card says (spec section 1), all as plain text:
  - description;
  - provider and version;
  - "Documentation" (an `http`/`https` link only);
  - input and output modes;
  - skills (name, description, tags, examples);
  - "Card fetched {date}".
- **Chats tab.** A delegated chat shows "Delegated by {agent name}" ("Delegated by another agent" when the id isn't listed) under its title.

**Steps.**

- [ ] **Step 1: failing tests:**
  - "test a remote agent row shows the remote mark and its three menu items"
  - "test Add remote agent looks up the card and shows its skills and endpoint"
  - "test Add remote agent shows the server's 502 message"
  - "test Add remote agent sends the bearer and clears it on close"
  - "test the warnings are shown"
  - "test a remote agent page shows Profile, Card and Chats only"
  - "test Replace token saves the auth and shows set without the value"
  - "test Refresh card calls refreshRemoteAgent"
  - "test the Card tab renders a description with HTML as text": `<img src=x onerror=…>` shows as text, and the DOM has no `img`
  - "test a documentation link that isn't http is not a link"
  - "test registerAgentTab without kinds is local only"
  - "test a delegated chat shows who delegated it"
  - "test the agent picker marks remote agents"
- [ ] **Step 2-4:** fail, implement, pass (`npx vitest run src/agents src/ai/AgentPicker`).
- [ ] **Step 5:** commit `feat(m20): add remote agents; remote mark, profile and card pages`.

### Task 8: The chat panel talks to remote agents (Lane D, after T7)

**Files:**

- Create: `frontend/src/ai/RemoteContextNotice.tsx`, `frontend/src/ai/AttachmentChip.tsx`, tests beside each
- Modify:
  - `frontend/src/ai/AiChatPanel.tsx` and `AiChatPanel.test.tsx` (as merged by M16 to M18)
  - `frontend/src/ai/AiChatHeader.tsx` (M16): `modelHidden?: boolean`
  - `frontend/src/ai/toolSteps.ts` and its test: the three new tools' lines
  - `frontend/src/ai/aiText.ts`: the strings below

**Interfaces.**

- Consumes:
  - `useAgents` (`agent.kind`, `agent.remote.contextNoticeAt`, `agent.remote.endpointHost`);
  - `api.aiChat` (the `attachment` event, the 428 answer), `api.ackRemoteContext`, `api.revealAgentFile`, `api.agentChat` (transcript `attachments`);
  - `ChatMarkdown` (M16).
- Produces:
  - `RemoteContextNotice(props: { open: boolean; agentName: string; host: string; onSend(): void; onCancel(): void })`
  - `AttachmentChip(props: { agentId: string; attachment: RemoteAttachment })`
  - `ChatItem.attachments?: RemoteAttachment[]`

**Behaviour and strings** (ours unless quoted from the spec):

- **Header.** With a remote agent, the model picker is hidden (`modelHidden`), since a remote agent has no model of Object's. The agent picker shows the remote mark. There is no "Learning…" line, and M18's `…` menu has no "Learn from this chat".
- **Context notice** (spec: "the first time Gene sends context to a remote agent, a notice says so (once per remote agent)").
  - When the agent is remote, the turn has context chips and `contextNoticeAt` is null, Send first opens `RemoteContextNotice`:
    - title "This leaves your computer";
    - body "{name} is a remote agent. The context pages you send go to {host}, outside this computer. Pages excluded from AI are never sent.";
    - buttons "Send" and "Cancel".
  - "Send" calls `ackRemoteContext`, then sends. "Cancel" keeps the draft.
  - A 428 from the server opens the same notice.
  - Turns without context, and every later send to that agent, show nothing.
- **Attachments.** An `attachment` event adds a chip under the streaming reply. A chip shows its name and size ("12 KB"); a loaded transcript shows its chips.
  - A `file` chip has "Show in folder" (`revealAgentFile`).
  - A `url` chip is an `http`/`https` link with M16's link rules (`rel="noopener noreferrer"`, opened by the OS browser as other chat links are).
- **Reply.** Rendered by `ChatMarkdown` (inert).
  - Data artifacts arrive as fenced `json` blocks in the text, so they show as code blocks and Copy and the save keep them.
  - An input-required question is just the reply.
- **Proposal seeds.** An editor entry's seed has no `agentId` and goes to the default agent (M17), even when the panel showed a remote agent.
- **Saving.** Saving the chat as an AI Chat object works as for local agents: the spec's "optional AI Chat object", on by default as M10. The Agent property is the remote agent's name. Attachments are not written into the object (our call); they stay in the transcript.
- **Tool lines** (added to M16/M17's table):

| Tool | Line |
|---|---|
| `remote_agents_list` | `Listed remote agents` |
| `remote_agent_call` | `Asked {agent}` |
| `delegate` | `Handed a task to {agent}` |

**Steps.**

- [ ] **Step 1: failing tests:**
  - "test a remote agent's header has no model picker"
  - "test the first send with context to a remote agent shows the notice, then sends after Send"
  - "test Cancel on the notice sends nothing and keeps the draft"
  - "test the notice is not shown again for that agent" (the agent's `contextNoticeAt` is set after the ack, through an `agents` event reload)
  - "test a send without context to a remote agent shows no notice"
  - "test a 428 answer opens the notice"
  - "test attachment events show chips and Show in folder reveals the file"
  - "test a url attachment that isn't http is not shown as a link"
  - "test New chat with a remote agent starts a fresh context" (the next request carries no `chatId`)
  - "test a loaded remote transcript shows its attachments"
  - "test an editor entry while a remote agent is shown goes to the default agent"
  - `toolSteps.test.ts` "test the A2A tools' lines"
- [ ] **Step 2-4:** fail, implement, pass (`npx vitest run src/ai`).
- [ ] **Step 5:** commit `feat(m20): chat panel for remote agents: notice, attachments`.

### Task 9: Integrate (alone, last)

**Files:**

- Create: `scripts/m20_acceptance.py`, `docs/superpowers/plans/m20-acceptance.md`
- Modify:
  - `backend/tests/test_m10_ai.py`: `test_ai_modules_use_no_network_client` gains `remotemodel`, `remotesecrets`, `remotechat`, `delegation`, `api_remote_agents` and `api_agent_a2a_v1`. It doesn't gain `a2a`.
  - `docs/superpowers/plans/remaining-work.md`: the M20 status line.
  - `CONTINUE.md`: one line.
  - `backend/tests/fake_a2a.py` and `fake_claude.py`: only a marker the script needs.

**`scripts/m20_acceptance.py SPACE [--keep]`.**

- Setup:
  - It copies `SPACE` to a temp folder and commits the copy to a throw-away git repo, as M10's script does. The original is never touched.
  - It sets `OBJECT_STATE_DIR` and `OBJECT_CACHE_DIR` to temp folders and `FAKE_CLAUDE_LOG`. It serves the copy with M8's `Served` on a free `127.0.0.1` port. `claudePath` points at the fake `claude`.
  - It starts two `FakeA2A` agents on `127.0.0.1`: "Fake Planner" (streaming, bearer `acc-TOKEN-7f3a`) and "Fake Notes" (no streaming, no auth).
  - It tags one page of the copy "Exclude from AI" through `PUT /api/object/properties` (committed). That page's body holds a marker line, and a visible page holds another.
- Checks:
  1. `POST /api/remote-agents/preview` with Fake Planner's base URL and the bearer answers its card. The state dir is unchanged.
  2. Adding both:
     - `GET /api/agents` lists them with `kind: "remote"`;
     - the token's bytes appear in no file under the state dir except `secrets.json`, in no API answer of this script, and in no log line the server printed.
  3. A chat turn with Fake Planner:
     - streams `chat`, `text` and `done`;
     - the fake logged `SendStreamingMessage` with `A2A-Version: 1.0` and the bearer;
     - the transcript is in `<state>/agents/Fake Planner/.object-agent/sessions/`.
  4. Multi-turn:
     - turn 2 carries turn 1's `contextId`;
     - `A2A:input` answers "Which date?";
     - the next turn carries its `taskId` and answers "Booked for …".
  5. Fake Notes: a turn uses `SendMessage`.
  6. Artifacts: `A2A:file` saves `files/<chatId>/plan.md` and sends an `attachment` event; `A2A:data` gives a `json` code block.
  7. Context:
     - a turn with context chips answers 428 before the notice;
     - after `POST …/context-notice`, `A2A:echo-parts` with the visible and the excluded page answers the visible page's marker;
     - the excluded page's marker is in no request the fake logged; `done.skipped` lists it.
  8. Delegation, through `/api/v1/agent/*` with the caller's turn token minted in-process (`TokenStore.ephemeral`, as the chat route does):
     - a local "Researcher" (`POST /api/agents`) runs a `delegate` call: the fake `claude` ran in Researcher's folder, and the chat is listed with `delegated: true, from: "assistant"`;
     - `FAKE:long:30000` gives a 24,000-character summary + "…";
     - three `FAKE:wait` delegations at once plus a fourth answer 429 for the fourth;
     - the delegated run's own token answers 403 on `/delegate`;
     - `delegate` to Fake Planner answers its text, and Fake Planner's chat is marked delegated.
  9. `remote_agents_list` and `remote_agent_call` through the routes. `remote_agent_call` with `A2A:slow:5` and `timeoutSeconds: 1` answers 504, and the fake logged `CancelTask`.
  10. `DELETE /api/agents/<Fake Planner>` moves its folder to `<state>/agents/.trash/`; restore puts it back with `remote.auth.set` true.
  11. Saving the Fake Planner chat (`POST /api/ai/chat/save`) writes one AI Chat whose `agent:` is "Fake Planner". `git status` of the copy shows only that file and the AI Chat type file.

  It prints `[ok]`/`[FAIL]` per check and `RESULT: PASS` at the end, and exits non-zero on any failure. It stops both fakes and the server in `finally`.

**`m20-acceptance.md`.** Hand checks for Gene on a copy of his export. Run a fake remote agent first with `uv run python backend/tests/fake_a2a.py --port 8799 --token test-token`, or use a real A2A 1.0 agent you have.

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

**Steps.**

- [ ] **Step 1:** write the script and the checklist; run `uv run python scripts/m20_acceptance.py <fixture space>` until `RESULT: PASS`.
- [ ] **Step 2:** run the full gate:
  - `uv run pytest backend/tests -q`
  - `npx vitest run`, `npx tsc -b --noEmit`, `npm run build`
  - every `scripts/mN_acceptance.py`
  - the M20 spike once more with `OBJECT_LIVE_CLAUDE=1`
- [ ] **Step 3:** commit `test(m20): acceptance script and hand-check list`.

Then comes the one milestone review (correctness, file safety, fidelity, the five Review Focus items first), one fix pass and the final gate.

## Shared files and ordering

| Shared file | Owner | Others |
|---|---|---|
| `pyproject.toml`, `uv.lock` | T1 | none |
| `backend/objectapp/server.py` (mounts the two routers) | T1 | none |
| `backend/objectapp/toolcatalog.py` (M17; `AGENT_TOOLS` and labels) | T1 | none |
| `backend/objectapp/agent_mcp.py` (M17; `TOOL_MODULES`) | T1 | none |
| `backend/objectapp/remotemodel.py` | T1 | T2-T6 consume |
| `backend/objectapp/a2a.py` | T1 (stub), then T2 | T3 uses the T1 dataclasses; T4, T5 consume |
| `backend/tests/fake_a2a.py`, `fake_claude.py` | T1 | T2 may add `A2A:message`; T9 may add a marker |
| `frontend/src/api/types.ts`, `api/client.ts`, `test/mockApi.ts` | T1 | lanes report needs; they don't edit |
| `backend/objectapp/agents.py` (M17) | T3 | none |
| `backend/objectapp/transcripts.py` (M17) | T3 | none |
| `backend/objectapp/remotesecrets.py` | T3 | T4-T6 consume |
| `backend/objectapp/api_ai.py` (M17; the one remote hook) | T4 | none |
| `backend/objectapp/remotechat.py` | T4 | T6 consumes (patched in its tests) |
| `backend/objectapp/api_remote_agents.py` | T1 (stub), then T5 | none |
| `backend/objectapp/api_learning.py`, `curator.py` (M18; remote ids refused / skipped) | T5 | none |
| `backend/objectapp/api_agent_a2a_v1.py`, `agent_tools_a2a.py`, `delegation.py` | T1 (stubs), then T6 | none |
| `backend/objectapp/headless.py` | T6 | none (M21 consumes `run_chat`) |
| `frontend/src/agents/AgentsSection.tsx`, `agentTabs.ts`, `AgentPage.tsx`, `ChatsTab.tsx`, `agentText.ts`; `frontend/src/ai/AgentPicker.tsx` (M17) | T7 | none |
| `frontend/src/ai/AiChatPanel.tsx`, `AiChatHeader.tsx`, `toolSteps.ts`, `aiText.ts` (M16/M17) | T8 | none |
| `backend/tests/test_m10_ai.py`, `remaining-work.md`, `CONTINUE.md` | T9 | none |

`agentrun.py` (M17) is **not** edited: M20 plugs in through `add_contributor` from `delegation.py`.

**Lanes** (counted from the Files lists). T1 runs first and alone. Then four lanes run:

| Lane | Tasks | Waits for |
|---|---|---|
| A (A2A client, remote chat) | T2, then T4 | T4 also needs T3 |
| B (registry, routes) | T3, then T5 | T5 also needs T2 |
| C (delegation, agent tools) | T6 | T3 (it patches `remotechat.call_remote` until T4 lands) |
| D (front end) | T7, then T8 | only T1's contract |

T9 runs last and alone. No two lanes edit the same file.

## Our calls

1. **A2A v1.0, JSON-RPC binding only**, with the `A2A-Version: 1.0` header. 0.3-only, gRPC-only and HTTP+JSON-only agents are refused with a message saying why.
2. A typed URL ending in `.json` is the card. Any other URL gets `/.well-known/agent-card.json` at its host's root (RFC 8615's place).
3. Remote agents are always in the state dir (`<state>/agents/<name>/`), and their default icon is `ph-globe`. Delete uses M17's agent trash. The secret is kept while trashed, so Restore works.
4. Secrets live under the key `a2a:<agentId>` in M19's `SecretStore` (M19 reserves the prefix), through the four-function adapter `remotesecrets`. When the endpoint's host changes on Refresh, the secret is removed, so a token never follows a card to a new host.
5. Redirects are never followed. The token goes only to the card URL and the endpoint. The add dialog shows the endpoint's host, and warns when it differs from the card's or is plain http with a token.
6. Remote agents take only `mode: "chat"`. Editor entries stay with the default agent, so no `block` ever goes out.
7. Context pages go out as one `text` part each (Markdown, with the page title as heading), after the message's own text part. They come from `ai.gather_context`, so excluded pages and templates never go.
8. The context notice is a dialog with "Send"/"Cancel" before the first send with context. It is recorded in the agent's `agent.json` (`contextNoticeAt`) and enforced by the server with 428.
9. The context id and the pending input-required task id are read from the chat's transcript, so the front end needs no new field. A saved AI Chat reopened without its transcript starts a new A2A context.
10. Reply composition: agent message text, artifact text (with the artifact's name in bold the first time), data parts as fenced `json` blocks (cut at 20,000 characters), and the status message's text only when nothing else came.
11. File artifacts are saved under the remote agent's `files/<chatId>/` with safe names, and shown as chips with "Show in folder". They are never opened by Object. `url` files show only for http/https. Attachments are not written into the AI Chat object.
12. Caps and timeouts:
    - card 1 MiB, one answer 10 MiB, one stream 50 MiB, one file 25 MiB;
    - connect 10 s, card 15 s, poll every 1 s;
    - a panel turn has M10's 300 s;
    - `remote_agent_call` defaults to 120 s (at most 240 s);
    - `delegate` has 240 s, so it ends inside the caller's 300 s turn.
    A timeout sends a best-effort `CancelTask`.
13. A `-32001` on a turn that sent an input-required `taskId` is retried once without it.
14. Stop and close send `CancelTask`, and the partial reply is kept with `stopped: true`.
15. A remote chat works without Claude Code installed.
16. The three agent tools are on by default, in the "Object agent tools" group, labelled "List remote agents", "Call a remote agent" and "Delegate to another agent".
17. `remote_agent_call` conversations are kept as chats in the remote agent's folder, marked delegated from the caller, like `delegate` to a remote. Its text is capped at 100,000 characters.
18. **"At most 3 at once per turn"** counts `delegate` calls in flight per turn token. A 4th is refused with 429, not queued, so the agent sees why. `remote_agent_call` doesn't count toward it.
19. **Flat, one level.** A delegated run has neither `delegate` nor `remote_agent_call` (both hand work to another agent), and the routes refuse its token too. `remote_agents_list` stays.
20. Self-delegation is refused. A delegated local run acts directly (write tools as its own switches allow), on the open space, with its own default model.
21. The summary is the delegated agent's final reply, asked for in `DELEGATE_PROMPT`, and cut by Object at 24,000 characters + "…". No extra model call. The transcript keeps the full reply.
22. **The caller's memory** is safe by scoping: the delegated run's token belongs to the target, and the caller's folder is fenced. Delegated runs don't trigger M18's background reviews (`"delegate"` is not in `REVIEW_PURPOSES`).
23. Delegated chats are transcripts only (no AI Chat object). They are marked `delegated`, `from` and `fromChat`, and shown as "Delegated by {name}" on the Chats tab.
24. `MCP_TOOL_TIMEOUT` is set on every agent run to `DELEGATE_TIMEOUT + 60` seconds, so the CLI doesn't cut a long `delegate` call. The T1 spike checks it.
25. Remote agents' folders are fenced from every local agent's file tools (the "fence-remote" contributor), like other agents' folders.
26. All strings marked "our string" above.

## Guesses (spec points I could not settle without guessing)

1. **M19's secrets store.** Checked against M19's Contract: `secretstore.SecretStore(state)` with `get`/`has`/`set`/`delete`, `redact(text, values)`, `KEY_PATTERN`, and the `a2a:` prefix reserved for M20. M20 uses exactly those, behind `remotesecrets`. If the built names differ, only `remotesecrets.py` changes.
2. **"Up to 3 delegations at once per turn".** Read as concurrency (in flight at once), refused past 3, not queued and not a per-turn total. **Guess.**
3. **Whether `remote_agent_call` is "delegating further"** for a delegated run. **Guess:** yes, it is refused (call 19). The spec names only `delegate`.
4. **`MCP_TOOL_TIMEOUT`.** It is a documented Claude Code environment variable, but not shown in `claude --help` of 2.1.317. **Guess:** it is honoured. The T1 spike proves it or stops for Gene.
5. **M18's `memory` tool** signature `memory(action, target, content=None, old_text=None)`, checked against M18's Contract, is used only in `test_caller_memory_untouched`. M18 is merged before M20, so the test doesn't skip.
6. **The notice's form.** The spec says "a notice says so". **Guess:** a dialog with Send/Cancel before the first context send (call 8), rather than a passive banner after it.
