# Milestone 16: chat polish and model picker

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Written 2026-11-05 against `master` at `0f4fde1`. Build on branch `feat/m16-chat-polish`.

**Goal.** The AI chat shows every message as rendered Markdown (safely), shows each tool call as a collapsed step between messages, and lets Gene pick the model: in the chat header for this chat, and in Settings > AI Assistant as the default agent's model. The model list is one back-end constant.

**Architecture.** The back end gets a new module `aimodels.py` holding the one model list and the model-name rule, served by `GET /api/ai/models`. `POST /api/ai/chat` takes an optional `model` (this chat's pick), resolved before the Settings default. `ai.StreamParser` grows its `tool` event: one at the call (id, name, input) and one with the same id when the result arrives (result text, error flag). The front end gets a pure Markdown renderer (`ai/markdown.ts`, a private `marked` instance; raw HTML is shown as text), a `ChatMarkdown` view that brings object links to life and uses the editor's lazy highlight.js and KaTeX, a `ModelPicker` used in the chat header and in Settings, and a `ToolStep` row. `AiChatPanel` is rewired to use them. No new schema in the space: the AI Chat object is saved exactly as in M10.

**Tech Stack.** Python 3 / FastAPI / pydantic, run with `uv`; React 19, TypeScript, Tailwind, shadcn (`radix-ui` Popover), `marked` 18 (already a dependency), `highlight.js` 11.11.1 and `katex` 0.19.0 through the editor's existing lazy loaders. No new npm or Python packages.

**Spec.** `docs/superpowers/specs/2026-11-05-agents-design.md`, sections **10** (the chat panel: Markdown rendering, header, tool steps) and **11** (model picker), plus the parts of section 3 they lean on ("Model", "Session resume", "Streaming events"). Not in M16: the agent picker in the header and everything about agents (M17, sections 1-4), the "Learning…" line and background reviews' model (M18, section 5).

CLI checked: `claude --version` = **2.1.317 (Claude Code)**. Flags this plan uses, all present in that version's `claude --help`: `--model <model>` ("Provide an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet') or a model's full name"), `--resume <id>`, and M10's existing `CLI_FLAGS` (`-p`, `--output-format stream-json`, `--include-partial-messages`, ...). No new flag.

## Global Constraints

- The `claude` CLI under Gene's own login is the only model runner. Never read `~/.claude/.credentials.json` or any Claude token; never call Anthropic's API; no network client in `ai.py`, `api_ai.py`, `aichat.py` or `aimodels.py` (M10's `test_ai_modules_use_no_network_client` gains `aimodels`).
- The server binds `127.0.0.1` only (unchanged).
- Model choices: the CLI's aliases plus `claude-fable-5-1` (Fable 5.1), `claude-opus-5-5` (Opus 5.5), `claude-sonnet-5-5` (Sonnet 5.5), `claude-haiku-5-5` (Haiku 5.5), and "Custom…" for any id. **The list lives in one back-end constant** (`aimodels.MODELS`); a new model is one line there. No front-end file names a model id.
- `--model <id>` from the chat's pick, else the default agent's model (Settings > AI Assistant > Model, the `aiModel` device setting), else no `--model` (the CLI's default).
- A model change mid-chat starts the next turn on the new model with the same history: `--resume <session>` plus the new `--model`; when the resume fails, M10's fallback replays the history in a fresh session.
- Markdown rendering covers headings, paragraphs, bold/italic/strikethrough, lists and task lists, links (object links open in Object), inline code and code blocks with syntax highlighting (the editor's lazy highlight.js), tables, block quotes, horizontal rules, math (the editor's KaTeX). User messages render the same.
- **No HTML from a reply ever runs**: raw HTML shows as text, no `on*` attribute, no `<script>`, `<iframe>`, `<style>`, `<img>`, `<form>`; links only `http`, `https`, `mailto` or relative; KaTeX with `trust: false`.
- **Copy still copies the Markdown source**, and the saved AI Chat holds the source, byte for byte as M10 saves it.
- Tool steps sit between messages, collapsed to one line each ("Searched notes for 'rack'", "Edited Servers/Alpha.md"), expandable to the call's input and result.
- No window ever calls out: the renderer shows images as their alt text and fetches nothing (`frontend/src/noNetwork.m8.test.ts` stays green).
- File safety: a turn writes nothing in the space; saving a chat is M10's save, unchanged; tests use `OBJECT_STATE_DIR` in a temp folder and never write to the real state dir or `~/.claude`.
- Everything unlocked: no badge, limit or gate on any model.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

The five inputs or failure modes most likely to slip past the task tests, most likely first. Each one's test is listed in its owning task.

1. **A hostile reply.** A reply (or a pasted user message) holding `<script>`, `<img src=x onerror=…>`, `<a href="javascript:…">`, a Markdown link to `javascript:` or `data:`, an HTML block inside a list, `<style>`, an `<iframe>`, KaTeX `\href{javascript:…}` or `\htmlClass`, a fence whose language is `"><script>`. Nothing may run or fetch. Test: `markdown.test.ts` "test a hostile reply renders inert" (T4), with the generic `assertInert(html)` check; `AiChatPanel.test.tsx` "test a reply's HTML is shown as text" (T7).
2. **Copy and save keep the source.** After rendering, Copy, the save and Rephrase must all use `item.text` (the Markdown source), also for a stopped (partial) answer and for an answer that had tool steps between its texts. Test: `AiChatPanel.test.tsx` "test Copy copies the Markdown source and the save stores it" (T7); `test_m16_models.py::test_saved_chat_keeps_markdown_source` (T2).
3. **A model switch mid-chat.** The next turn must carry both `--resume <session>` and the new `--model`; a CLI that refuses to resume on another model must fall back to a fresh run with the history, once, not loop or lose the turn; switching back to "Default" must drop `--model` (unless Settings names one). Tests: `test_m16_models.py::test_model_change_mid_chat_resumes_with_new_model`, `::test_resume_refused_after_model_change_replays_history`, `::test_default_pick_uses_the_setting_then_nothing` (T2).
4. **Untrusted model names.** A custom id is passed to a subprocess: `-p`, `--dangerously-skip-permissions`, `a b`, `$(x)`, an 81-character id, an empty string. Each must answer 422 (empty: treated as no pick) and never start the CLI; the Settings field must refuse the same names. Tests: `test_m16_models.py::test_bad_model_is_422_and_cli_not_run`, `::test_settings_and_chat_share_the_model_rule` (T2); `ModelPicker.test.tsx` "test Custom… refuses a name the server would refuse" (T5).
5. **Awkward tool traffic.** A tool result that is huge (100,000 characters), a list of blocks with an image, an error result, a result for an id never announced, the same result twice, a tool call repeated in the final `assistant` message, a run stopped while a tool is pending, a 200,000-character streamed reply with many fences (render must stay responsive: re-render at most every `STREAM_RENDER_MS`). Tests: `test_m16_tool_events.py` (T3: caps, joins, dedup, unknown id); `toolSteps.test.ts` (T6: merge by id, unknown id ignored); `ChatMarkdown.test.tsx` "test streaming re-renders at most every STREAM_RENDER_MS" and "test past MAX_RENDER_CHARS the text shows plain" (T4); `AiChatPanel.test.tsx` "test Stop leaves a pending step marked stopped" (T7).

## Contract (T1)

### Storage

Nothing new is stored. The chat's model pick lives in the panel's state only (our call: not saved in the AI Chat object, which keeps M10's schema); it resets to "Default" on New chat and when a saved chat is loaded. The default agent's model is M10's `aiModel` device setting (`<state dir>` settings file, written by `PUT /api/settings` as today). Tool steps are shown for the turns of the open panel only and are not saved (our call; M17's per-agent transcripts may keep them).

### The model list: `backend/objectapp/aimodels.py` (T1)

```python
@dataclass(frozen=True)
class ModelChoice:
    id: str                              # what goes after --model
    label: str                           # what the picker shows (our strings)
    kind: Literal["alias", "id"]         # alias: the CLI's "latest" names; id: a pinned model

MODELS: tuple[ModelChoice, ...] = (
    ModelChoice("fable",  "Fable (latest)",  "alias"),
    ModelChoice("opus",   "Opus (latest)",   "alias"),
    ModelChoice("sonnet", "Sonnet (latest)", "alias"),
    ModelChoice("haiku",  "Haiku (latest)",  "alias"),   # see "Guesses" at the end
    ModelChoice("claude-fable-5-1",  "Fable 5.1",  "id"),
    ModelChoice("claude-opus-5-5",   "Opus 5.5",   "id"),
    ModelChoice("claude-sonnet-5-5", "Sonnet 5.5", "id"),
    ModelChoice("claude-haiku-5-5",  "Haiku 5.5",  "id"),
)
"""The one list of model choices (spec section 11). A new model is one line here."""

MODEL_PATTERN = r"[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,79}"
"""A model name: what settings.py accepted as aiModel since M10 (moved here). A leading
letter or digit means no name can be read as a flag."""

def clean_model(value: object) -> str | None:
    """None for None, "" or whitespace; the stripped name when it fullmatches MODEL_PATTERN;
    raises ValueError("That isn't a model name.") otherwise."""

def resolve_model(chat: str | None, default: str | None) -> str | None:
    """The --model for a turn: the chat's pick, else the default agent's model, else None.
    M17 calls it with the agent's default; M18's reviews call it with the review model first."""

def models_payload() -> dict[str, Any]:
    """GET /api/ai/models: {"models": [asdict(m) for m in MODELS], "pattern": MODEL_PATTERN}."""

BAD_MODEL = "That isn't a model name."  # our string, also the picker's message
```

`settings.py` drops its own `_MODEL_NAME` and validates `aiModel` with `aimodels.MODEL_PATTERN` (same rule as before, one copy).

### TypeScript (T1, `frontend/src/api/types.ts`)

```ts
/** GET /api/ai/models: the back end's one model list (aimodels.MODELS). */
export interface AiModelChoice {
  id: string
  label: string
  kind: 'alias' | 'id'
}
export interface AiModels {
  models: AiModelChoice[]
  /** aimodels.MODEL_PATTERN; the client matches it whole: new RegExp(`^(?:${pattern})$`). */
  pattern: string
}

export interface AiChatRequest {
  // ...M10 fields unchanged...
  /** M16: this chat's model pick; null/absent = the default agent's model (Settings), else the CLI's. */
  model?: string | null
}

export type AiEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'text'; text: string }
  /**
   * A tool step. Sent twice per call with the same `id`: at the call (`input` set, no `result`),
   * then when its result arrives (`input` null, `result` set). `name` is the short name for
   * Object's tools ("search"), the CLI's name otherwise ("Read", "mcp__srv__tool").
   */
  | { type: 'tool'; id: string; name: string; input: Record<string, unknown> | null; result?: string; isError?: boolean }
  | { type: 'done'; text: string; sessionId: string | null; proposal: AiProposal | null; skipped: AiSkipped[] }
  | { type: 'error'; message: string }
```

`frontend/src/api/client.ts` (T1): `api.aiModels(): Promise<AiModels>` (`GET /ai/models`). `frontend/src/test/mockApi.ts` (T1): `aiModels` answering the eight choices above and the pattern, and `aiChat`'s mock tool event updated to the new shape (`{type:'tool', id:'t1', name:'search', input:{query:'rack'}}`).

### Routes (T2, `backend/objectapp/api_ai.py`)

| Route | Body | Answer | Errors |
|---|---|---|---|
| `GET /api/ai/models` | | 200 `AiModels` (`aimodels.models_payload()`) | none; not gated by "Hide AI features" (like `/ai/status`) |
| `POST /api/ai/chat` | M10's `AiChatRequest` + `model: str \| None = None` | M10's event stream | M10's, plus **422** `{"detail": "That isn't a model name."}` when `model` fails `clean_model`, checked before the CLI is looked for or started |

The turn's model: `aimodels.resolve_model(clean_model(req.model), settings.get("aiModel") or None)` replaces M10's `settings.get("aiModel") or None`; `ai.Turn.model` and `ai.cli_args` are unchanged (`--model` only when not None; with a session, both `--resume` and `--model`).

### Stream events (T3, `backend/objectapp/ai.py`)

`StreamParser` emits, in stream order:

- at an `assistant` message's `tool_use` block not seen before (by `id`): `{"type": "tool", "id": <tool_use id>, "name": _short_tool(name), "input": short_input(input)}`;
- at a `user` message's `tool_result` block whose `tool_use_id` was announced and not answered yet: `{"type": "tool", "id": <id>, "name": <the call's short name>, "input": None, "result": short_result(content), "isError": bool(is_error)}`. A result for an unknown or already answered id is dropped.

```python
TOOL_INPUT_STRING_CAP = 1_000   # per string value in a tool's input, recursively (our number)
TOOL_RESULT_CAP = 4_000         # characters of a tool's result text (our number)
ELLIPSIS = "…"

def short_input(value: Any) -> dict[str, Any] | None:
    """The call's input for the chat: a dict (None if it isn't one) whose string values,
    at any depth, are cut to TOOL_INPUT_STRING_CAP characters + ELLIPSIS."""

def short_result(content: Any) -> str:
    """A tool_result's content as text: a string as is; a list of blocks joined with "\n"
    (text blocks' text, any other block as "[image]" or "[<type>]", our strings); cut to
    TOOL_RESULT_CAP + ELLIPSIS."""
```

Tool results never go into `text` events or `done.text`. Both functions are in `ai.__all__`.

### Front-end modules (exact public signatures)

```ts
// frontend/src/ai/markdown.ts (T4) — pure, no React
export const MAX_RENDER_CHARS = 200_000          // longer text renders as escaped plain paragraphs (our number)
export function renderChatMarkdown(source: string): string   // HTML, inert (see Global Constraints)
export function fenceLanguages(source: string): string[]     // the fenced code languages, for loadGrammar
export function assertInert(html: string): void              // test helper, exported for T7: throws on any on*, script, iframe, object, embed, style, img, form, link, meta, or non-disabled input, or an href outside http/https/mailto/relative

// frontend/src/ai/ChatMarkdown.tsx (T4)
export const STREAM_RENDER_MS = 100              // our number
export function ChatMarkdown(props: { source: string; streaming?: boolean; className?: string }): JSX.Element

// frontend/src/ai/models.ts (T5)
export function useAiModels(): AiModels | null   // api.aiModels() once per window, shared; null while loading or after a failure
export function modelLabel(id: string | null, models: AiModels | null, defaultLabel: string): string
export function isModelName(value: string, models: AiModels | null): boolean   // the served pattern; false while the list is not loaded (no front-end copy of the rule), so Custom… waits
export const MODEL_TEXT: { default: string; custom: string; customPlaceholder: string; badName: string; latest: string; versions: string; save: string }

// frontend/src/ai/ModelPicker.tsx (T5)
export interface ModelPickerProps {
  value: string | null
  onChange(next: string | null): void
  /** The "Default" row's text, e.g. "Default" or "Default (Sonnet 5.5)". */
  defaultLabel: string
  ariaLabel: string
  /** Header use: a small borderless trigger. */
  compact?: boolean
  disabled?: boolean
}
export function ModelPicker(props: ModelPickerProps): JSX.Element

// frontend/src/ai/toolSteps.ts (T6) — pure
export interface ToolStepState { id: string; name: string; input: Record<string, unknown> | null; result: string | null; isError: boolean; done: boolean; stopped?: boolean }
export type ChatPart = { kind: 'text'; text: string } | { kind: 'tool'; step: ToolStepState }
export function applyEvent(parts: ChatPart[], e: AiEvent): ChatPart[]   // text: appended to a trailing text part (else a new one); tool with no result: a new step; tool with result: fills the step with that id (unknown id: unchanged)
export function stopSteps(parts: ChatPart[]): ChatPart[]                // pending steps get stopped: true
export function toolStepLine(step: ToolStepState): string
export const TOOL_STEP_TEXT: { input: string; result: string; running: string; failed: string; stopped: string; noResult: string }

// frontend/src/ai/ToolStep.tsx (T6)
export function ToolStep(props: { step: ToolStepState }): JSX.Element

// frontend/src/ai/AiChatHeader.tsx (T7) — M17 puts its agent picker in `leading`
export interface AiChatHeaderProps { leading?: ReactNode; model: string | null; defaultModel: string | null; onModelChange(next: string | null): void; onNewChat(): void; busy?: boolean }
export function AiChatHeader(props: AiChatHeaderProps): JSX.Element
```

`ChatItem` (in `AiChatPanel.tsx`) gains `parts?: ChatPart[]` (assistant turns of this panel: the texts and steps in stream order). `text` stays the whole Markdown source and is what Copy, Append, Rephrase and the save use.

### Tool step lines (T6, our strings)

`{x}` is the input value, cut to 60 characters + "…"; a missing value drops the clause ("Searched notes").

| Tool (`name`) | Line |
|---|---|
| `search` | `Searched notes for '{query}'` |
| `query` | `Queried notes` |
| `run_saved_query` | `Ran a saved query` |
| `peek` | `Looked at {path}` |
| `read` | `Read {path}` |
| `backlinks` | `Found links to {path}` |
| `daily_note` | `Opened the daily note for {date}` |
| `changes_since` | `Checked recent changes` |
| `schema` | `Read the space's types` |
| `create_object` / `create_task` | `Created '{title}'` |
| `set_properties`, `add_tags`, `add_to_collection`, `append_to_section`, `replace_section` | `Edited {path}` |
| `rename` | `Renamed {path} to '{title}'` |
| `move_to_trash` | `Moved {path} to the Trash` |
| `Read` / `Write` / `Edit` / `NotebookEdit` | `Read {file_path}` / `Wrote {file_path}` / `Edited {file_path}` / `Edited {notebook_path}` |
| `Glob` / `Grep` | `Listed files matching '{pattern}'` / `Searched files for '{pattern}'` |
| `WebSearch` / `WebFetch` | `Searched the web for '{query}'` / `Fetched {url}` |
| `Bash` / `PowerShell` | `Ran {command}` (first line) |
| `Task` / `Agent` | `Ran a subagent` |
| `mcp__<server>__<tool>` (not Object's) | `Used {tool} ({server})` |
| anything else | `Used {name}` |

A failed step appends ` (failed)`; a pending one shows a spinner and the same line; a stopped one appends ` (stopped)`. Expanded: "Input" (the input as indented JSON in a `<pre>`) and "Result" (the result as plain text in a `<pre>`, never rendered as Markdown or HTML; "No result" when none). (`TOOL_STEP_TEXT`, our strings.)

### Labels (our strings)

Picker: "Default", "Latest" (alias group heading), "Versions" (id group heading), "Custom…", placeholder "Model id, e.g. claude-opus-5-5" (the example id is read from `models` at runtime: the first `kind: 'id'` entry, so no id is written in the front end), "Save", "That isn't a model name.". Header: the picker's trigger shows the chat's pick label, or `Default` when none (its row says `Default ({label of the setting})` when Settings names a model); aria-label "Model for this chat". Settings > AI Assistant > Model: help becomes "The default agent's model. Default uses Claude Code's own default." and the search keywords gain "model".

### Our choices (summary)

1. One back-end constant `aimodels.MODELS`, served by `GET /api/ai/models` with the name rule's pattern; no front-end copy of any id or of the rule.
2. Eight entries: four aliases (`fable`, `opus`, `sonnet`, `haiku`) then the four ids of section 11.
3. The chat's pick is panel state only; New chat and loading a saved chat go back to Default.
4. An empty `model` means no pick; any other bad name is a 422 before the CLI starts.
5. `tool` events come in pairs by id (call, then result); a result for an unknown or answered id is dropped.
6. Caps: 1,000 characters per input string, 4,000 per result.
7. Tool steps are not saved in the AI Chat object.
8. The renderer is a private `marked` instance (the one `TextBlockCell` uses for inline Markdown); images show as alt text (no fetch); raw HTML as text.
9. Object links: `[[Target]]` / `[[Target|label]]` and relative links ending in `.md` render as wikilink chips (`presentWikilink`), which open in Object.
10. Streaming text re-renders at most every 100 ms; past 200,000 characters it shows as plain text.
11. The header holds (leading slot for M17) · model picker · New chat; the context chips move to the row under it.

## Tasks

Run each task's own tests only; the full suites run in T8.

### Task 1: Contract

**Files:**
- Create: `backend/objectapp/aimodels.py`, `backend/tests/test_m16_contract.py`
- Modify: `backend/objectapp/settings.py` (use `aimodels.MODEL_PATTERN`), `frontend/src/api/types.ts`, `frontend/src/api/client.ts`, `frontend/src/test/mockApi.ts`

**Interfaces:** Produces everything in "Contract (T1)" above except the route and stream changes (T2, T3).

- [ ] **Step 1: failing tests** in `test_m16_contract.py`:
  - `test_models_are_the_spec_list`: `[m.id for m in MODELS]` == `["fable","opus","sonnet","haiku","claude-fable-5-1","claude-opus-5-5","claude-sonnet-5-5","claude-haiku-5-5"]`; labels `"Fable 5.1"`, `"Opus 5.5"`, `"Sonnet 5.5"`, `"Haiku 5.5"` on the ids; every id fullmatches `MODEL_PATTERN`.
  - `test_clean_model`: `None`, `""`, `"  "` -> None; `" opus "` -> `"opus"`; `"claude-opus-5-5[1m]"` kept; `"-p"`, `"--dangerously-skip-permissions"`, `"a b"`, `"$(x)"`, `"x" * 81`, `5` raise `ValueError(BAD_MODEL)`.
  - `test_resolve_model`: `("opus","sonnet")` -> `"opus"`; `(None,"sonnet")` -> `"sonnet"`; `(None,None)` -> None.
  - `test_settings_use_the_shared_rule`: `settings` validates `aiModel` `"claude-opus-5-5[1m]"` true, `"-x"` false; `settings.py` source no longer contains `_MODEL_NAME`.
  - `test_one_model_list`: walks `backend/objectapp` and `frontend/src` (skipping `frontend/src/test/` and `*.test.*` files); the strings `claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` appear only in `aimodels.py`.
- [ ] **Step 2:** `uv run pytest backend/tests/test_m16_contract.py -q`, see them fail (no module).
- [ ] **Step 3:** write `aimodels.py` with the exact signatures; switch `settings.py`; add the TS types, `api.aiModels`, the mock. `npx tsc -b --noEmit` passes (the old `tool` mock shape is updated in the same commit; `AiChatPanel.tsx` still compiles because it only reads `e.name`).
- [ ] **Step 4:** run the test file and `uv run pytest backend/tests/test_m10_ai.py -q`; both pass.
- [ ] **Step 5:** commit `feat(m16): contract: one model list, model pick and tool step types` with the trailer.

### Task 2: Model route and per-chat override (Lane B)

**Files:**
- Modify: `backend/objectapp/api_ai.py`, `backend/tests/fake_claude.py`, `backend/tests/test_m10_ai.py` (only: add `"aimodels"` to the no-network module list)
- Create: `backend/tests/test_m16_models.py`

**Interfaces:** Consumes `aimodels.clean_model`, `resolve_model`, `models_payload`, `BAD_MODEL`. Produces `GET /api/ai/models`, `ChatRequest.model`.

`fake_claude.py` gains two markers (documented in its docstring): `FAKE:modelswitch` (with `--resume` and `--model` both given: answers like an unknown session, exit 1, so the app retries fresh) and `FAKE:toolerror` (like `FAKE:tool`, but the `tool_result` has `"is_error": true` and content `[{"type":"text","text":"Search failed: index busy"}]`). The log line also records `"model": _arg(argv, "--model")`. `FAKE:tool` is unchanged (M10's tests rely on it).

- [ ] **Step 1: failing tests** in `test_m16_models.py` (fixtures copied from `test_m10_ai.py`: `fake`, `api`, `OBJECT_STATE_DIR` in `tmp_path`):
  - `test_models_route_lists_the_constant`: 200; `body["models"] == [asdict(m) for m in MODELS]`; `body["pattern"] == MODEL_PATTERN`; also 200 with `aiHidden` on.
  - `test_chat_pick_passes_model_flag`: `aiModel="sonnet"`, request `model="claude-opus-5-5"` -> the run's argv has `--model claude-opus-5-5` and not `sonnet`.
  - `test_default_pick_uses_the_setting_then_nothing`: no `model`, `aiModel="sonnet"` -> `--model sonnet`; `model=None`, `aiModel=None` -> no `--model`; `model=""` -> no `--model`.
  - `test_custom_model_id_passes_through`: `model="claude-opus-5-5[1m]"` -> argv `--model claude-opus-5-5[1m]`.
  - `test_bad_model_is_422_and_cli_not_run`: for `-p`, `--dangerously-skip-permissions`, `a b`, `$(x)`, `"x"*81`: status 422, `detail == "That isn't a model name."`, the fake's log has no run.
  - `test_model_change_mid_chat_resumes_with_new_model`: turn 1 with `model="sonnet"` -> session S; turn 2 `sessionId=S`, `model="claude-haiku-5-5"` -> one run with `--resume S` and `--model claude-haiku-5-5`.
  - `test_resume_refused_after_model_change_replays_history`: turn 2 prompt `FAKE:modelswitch`, `sessionId=S`, `model="opus"`, history of 2 messages -> two runs: first `--resume S --model opus`, second no `--resume`, `--model opus`, its prompt holds both history texts; the stream ends with `done`.
  - `test_settings_and_chat_share_the_model_rule`: `PUT /api/settings` `aiModel="a b"` refused as M10 refuses a bad value; `"claude-opus-5-5[1m]"` saved.
  - `test_saved_chat_keeps_markdown_source`: save messages whose assistant text is `"# Title\n\n**bold** and `x`\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [ ] task\n\n$x^2$"`; load gives it back exactly; the file body holds it unchanged.
- [ ] **Step 2:** run, see them fail.
- [ ] **Step 3:** implement in `api_ai.py`: `ChatRequest.model: str | None = None`; in `ai_chat`, before `find_claude`: `try: pick = aimodels.clean_model(req.model) except ValueError: return _error(422, aimodels.BAD_MODEL)`; `model = aimodels.resolve_model(pick, settings.get("aiModel") or None)`; `@r.get("/ai/models") def ai_models(): return aimodels.models_payload()`. Update the module docstring's route list. Fake markers as above.
- [ ] **Step 4:** `uv run pytest backend/tests/test_m16_models.py backend/tests/test_m10_ai.py -q` pass.
- [ ] **Step 5:** commit `feat(m16): model list route and a model pick per chat`.

### Task 3: Tool step events (Lane B, after T2)

**Files:**
- Modify: `backend/objectapp/ai.py` (`StreamParser`, `short_input`, `short_result`, caps, `__all__`, docstring)
- Create: `backend/tests/test_m16_tool_events.py`

**Interfaces:** Consumes the fake's `FAKE:tool` / `FAKE:toolerror`. Produces the `tool` event pair of the Contract.

- [ ] **Step 1: failing tests** (unit tests feed dicts to `StreamParser().feed`; route tests use the fake):
  - `test_tool_call_event_has_id_name_input`: an `assistant` message with `tool_use {id:"toolu_1", name:"mcp__object__search", input:{"query":"rack"}}` -> `[{"type":"tool","id":"toolu_1","name":"search","input":{"query":"rack"}}]`.
  - `test_tool_result_event_follows_by_id`: then a `user` message with `tool_result {tool_use_id:"toolu_1", content:"[]"}` -> `[{"type":"tool","id":"toolu_1","name":"search","input":None,"result":"[]","isError":False}]`.
  - `test_result_blocks_are_joined`: content `[{"type":"text","text":"a"},{"type":"image","source":{}},{"type":"text","text":"b"}]` -> result `"a\n[image]\nb"`.
  - `test_error_result_is_flagged`: `is_error: true` -> `isError: True`.
  - `test_caps`: an input string of 5,000 characters (nested in a list in a dict) -> 1,000 characters + `"…"`; a result of 100,000 -> 4,000 + `"…"`.
  - `test_unknown_or_repeated_result_is_dropped`: a result for `toolu_9` (never called) -> `[]`; the same `toolu_1` result twice -> second `[]`; the final `assistant` message repeating `toolu_1` -> no second call event.
  - `test_other_tools_keep_their_names`: `Read` -> `"Read"`; `mcp__srv__lookup` -> `"mcp__srv__lookup"`; a non-dict `input` -> `None`.
  - `test_tool_results_never_reach_text`: route turn with `FAKE:tool`: `done.text == "Hello from the fake claude."`-style final text with no `[]` added; event order is `session`, `text`, `tool` (call), `tool` (result), `text`…, `done`.
  - `test_tool_error_over_http`: `FAKE:toolerror` -> the result event has `isError: True` and `result == "Search failed: index busy"`.
- [ ] **Step 2:** run, see them fail.
- [ ] **Step 3:** implement: `feed` handles `kind == "user"` -> `_user(msg)`; `_assistant` emits the call event with `id`, `input`; keep a `dict[str, str]` id -> short name and a set of answered ids.
- [ ] **Step 4:** `uv run pytest backend/tests/test_m16_tool_events.py backend/tests/test_m10_ai.py -q` pass (M10's `test_tool_use_and_text_are_not_repeated` still passes: it counts `tool` events by name; update its expectation only if it asserts exactly one `tool` event, to "one call event").
- [ ] **Step 5:** commit `feat(m16): tool events carry the call's input and result`.

### Task 4: Markdown renderer (Lane M)

**Files:**
- Create: `frontend/src/ai/markdown.ts`, `frontend/src/ai/markdown.test.ts`, `frontend/src/ai/ChatMarkdown.tsx`, `frontend/src/ai/ChatMarkdown.test.tsx`, `frontend/src/ai/chatMarkdown.css`

**Interfaces:** Consumes (read-only, not edited) `safeHref` from `@/properties/cells/TextBlockCell`, `WIKILINK_RE` from `@/editor/extensions/wikilink`, `findInlineMath` from `@/editor/annotations`, `displayMathRows`/`renderMath`/`renderDisplayMath`/`useMathReady`/`loadMath` from `@/editor/math/renderMath`, `highlightTokens`/`grammarOf`/`loadGrammar` from `@/editor/code/highlight`, `presentWikilink` from `@/links/wikilinkPresenter`, `theme/codeSyntax.css`. Produces `renderChatMarkdown`, `fenceLanguages`, `assertInert`, `MAX_RENDER_CHARS`, `ChatMarkdown`, `STREAM_RENDER_MS`.

Rendering rules (`markdown.ts`): a private `new Marked({ async: false, gfm: true, breaks: true })` (our choice: `breaks` so a single line break in a reply shows, as M10's `pre-wrap` did); renderer overrides: `html` -> escaped text; `link` -> `safeHref` or the inner text, external links `target="_blank" rel="noopener noreferrer"`, a relative `.md` href -> a wikilink chip (`<span class="wikilink" data-wikilink data-target="<decoded href minus .md>" data-label="<text>">`); `image` -> escaped alt text; `code` -> `<pre class="chat-code" data-language="<escaped lang>"><code>` + highlighted runs (`highlightTokens` -> `<span class="hljs-…">` over escaped slices) + `</code></pre>`; `checkbox` -> `<input type="checkbox" disabled>` (checked when ticked). Extensions: `wikilink` (inline, `WIKILINK_RE`, as `TextBlockCell`'s); `inlineMath` (inline, the first `findInlineMath` hit at the start) -> `renderMath(tex, {display:false})`; `mathBlock` (block, a `$$` line to the next line ending `$$`, the editor's rule) -> `renderDisplayMath(tex)`. Text longer than `MAX_RENDER_CHARS` -> escaped paragraphs split on blank lines, `white-space: pre-wrap`.

`ChatMarkdown.tsx`: `useMemo(renderChatMarkdown)`; while `streaming`, the source shown is updated at most every `STREAM_RENDER_MS` (trailing update guaranteed); re-renders when `useMathReady()` turns true and when `loadGrammar` resolves for any of `fenceLanguages(source)`; an effect runs `presentWikilink` on each `[data-wikilink]` (cleanups on change/unmount). Styles in `chatMarkdown.css` under `.chat-md` (headings 18/16/15 px, lists, tables with borders, block quotes, `hr`, code using the `--code-*` tokens and `hljs-*` mappings as `codeBlock.css` does, our choices within the existing look).

- [ ] **Step 1: failing tests** in `markdown.test.ts` (with `await loadMath()` and `await loadGrammar('python')` in `beforeAll`):
  - "test headings, emphasis, strikethrough": `# A` -> `<h1>`; `**b** *i* ~~s~~` -> `<strong>`, `<em>`, `<del>`.
  - "test lists and task lists": `- a\n- b` -> `<ul>` 2 `<li>`; `1. a` -> `<ol>`; `- [x] done\n- [ ] todo` -> two `input[type=checkbox][disabled]`, the first checked.
  - "test tables, quotes and rules": a GFM table -> `<table>` with `<th>`×2, `<td>`×2; `> q` -> `<blockquote>`; `---` -> `<hr>`.
  - "test inline code and highlighted fences": `` `x<y` `` -> `<code>x&lt;y</code>`; a python fence `def f(): pass` -> a `span.hljs-keyword` with text `def`; an unknown language -> plain escaped code.
  - "test math": `$x^2$` -> an element `.katex`; `$$\nx\n$$` -> `.katex-display`; `$5 and $6` stays text (Pandoc dollar rules).
  - "test links": `https://example.org` and `[e](https://example.org)` -> `a[href="https://example.org"][rel="noopener noreferrer"]`; `[[Alpha]]` and `[[Alpha|A]]` -> `span[data-wikilink][data-target="Alpha"]`; `[Alpha](Servers/Alpha.md)` -> `span[data-wikilink][data-target="Servers/Alpha"]`; `mailto:` kept.
  - "test a hostile reply renders inert": each of `<script>alert(1)</script>`, `<img src=x onerror=alert(1)>`, `<a href="javascript:alert(1)">x</a>`, `[x](javascript:alert(1))`, `[x](JaVaScRiPt:alert(1))`, `[x](data:text/html,<b>)`, `- item\n\n  <iframe src="https://example.org"></iframe>`, `<style>body{display:none}</style>`, `$\href{javascript:alert(1)}{x}$`, `$\htmlClass{x}{y}$`, a fence with language `"><script>alert(1)</script>` -> `assertInert(html)` passes; for the raw-HTML ones the escaped source text is visible (`textContent` contains `<script>`).
  - "test images show as alt text": `![a diagram](https://example.org/a.png)` -> no `img`, text `a diagram`.
  - "test past MAX_RENDER_CHARS the text shows plain": a 200,001-character source with `**` -> no `<strong>`, the `**` visible.
  - "test fenceLanguages": `"```python\n```\n```ts\n```"` -> `["python","ts"]`.
- [ ] `ChatMarkdown.test.tsx`: "test renders and presents object links" (a `[[Alpha]]` chip gets `data-resolved-path` from the mock `resolve`, and a click opens it in a tab); "test streaming re-renders at most every STREAM_RENDER_MS" (fake timers: 20 source updates within 100 ms -> `renderChatMarkdown` spy called ≤ 2 times, and the last source is shown after the timer); "test a fence's grammar loading re-renders" (a `yaml` fence shows highlight spans after `loadGrammar('yaml')` resolves).
- [ ] **Step 2:** `npx vitest run src/ai/markdown.test.ts src/ai/ChatMarkdown.test.tsx`, see them fail.
- [ ] **Step 3:** implement with the exact signatures.
- [ ] **Step 4:** the two files pass; `npx vitest run src/noNetwork.m8.test.ts` passes; `npx tsc -b --noEmit`.
- [ ] **Step 5:** commit `feat(m16): safe Markdown rendering for the chat`.

### Task 5: Model picker and Settings (Lane P)

**Files:**
- Create: `frontend/src/ai/models.ts`, `frontend/src/ai/models.test.ts`, `frontend/src/ai/ModelPicker.tsx`, `frontend/src/ai/ModelPicker.test.tsx`
- Modify: `frontend/src/settings/sections/AiAssistant.tsx`, `frontend/src/settings/sections/AiAssistant.test.tsx`

**Interfaces:** Consumes `api.aiModels`, `AiModels`. Produces `useAiModels`, `modelLabel`, `isModelName`, `MODEL_TEXT`, `ModelPicker`, `ModelPickerProps`.

`ModelPicker`: a `Popover` (`@/components/ui/popover`) whose trigger shows `modelLabel(value, models, defaultLabel)` and a caret. The list (`role="listbox"`, rows `role="option"` with `aria-selected`): the Default row (`defaultLabel`), "Latest" (aliases), "Versions" (ids), a current custom value not in the list (its id, selected), then "Custom…". Custom… swaps the list for an input (`aria-label="Model id"`) and "Save"; Enter saves; `isModelName` false -> "That isn't a model name." under it and nothing is saved; Escape goes back. Keyboard: arrows move, Enter picks (our choice, like the app's other menus). While `models` is null: Default and Custom… only (Custom… disabled until the pattern is there).

Settings: the Model `TextSetting` is replaced by `<ModelPicker value={settings.aiModel} onChange={(v) => patch({ aiModel: v })} defaultLabel="Default" ariaLabel="Model" />`; `AI_ASSISTANT_TEXT.modelHelp` becomes "The default agent's model. Default uses Claude Code's own default."; `modelPlaceholder` is removed; `AI_ASSISTANT_SEARCH` gains `'model'`. The Claude Code path field is unchanged.

- [ ] **Step 1: failing tests**:
  - `models.test.ts`: "test useAiModels fetches once" (two hooks, one `api.aiModels` call); "test modelLabel" (`null` -> the default label; `"claude-opus-5-5"` -> `"Opus 5.5"`; `"my-model"` -> `"my-model"`); "test isModelName follows the served pattern" (`"claude-opus-5-5[1m]"` true; `"-p"`, `"a b"`, 81 characters false; with `models` null false).
  - `ModelPicker.test.tsx`: "test lists Default, the aliases, the versions and Custom…" (8 options from the mock + Default + Custom…, the headings "Latest" and "Versions"); "test picking a version and Default" (`onChange('claude-opus-5-5')`, then `onChange(null)`); "test Custom… saves a name" (type `claude-opus-5-5[1m]`, Enter -> `onChange('claude-opus-5-5[1m]')`); "test Custom… refuses a name the server would refuse" (`a b` -> "That isn't a model name.", no `onChange`); "test a custom current value shows as its id, selected"; "test without the list only Default and Custom… show" (`aiModels` rejects).
  - `AiAssistant.test.tsx`: the M10 test "path and model save on blur…" keeps its path half; a new "test the Model picker saves aiModel" (pick "Sonnet 5.5" -> `patch({aiModel:'claude-sonnet-5-5'})`; Default -> `patch({aiModel:null})`; an existing `aiModel: 'my-model'` shows `my-model`).
- [ ] **Step 2:** run the three files, see them fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** the three files pass; `npx tsc -b --noEmit`.
- [ ] **Step 5:** commit `feat(m16): model picker, and Settings' Model field becomes the default agent's model`.

### Task 6: Tool steps (Lane P, after T5)

**Files:**
- Create: `frontend/src/ai/toolSteps.ts`, `frontend/src/ai/toolSteps.test.ts`, `frontend/src/ai/ToolStep.tsx`, `frontend/src/ai/ToolStep.test.tsx`

**Interfaces:** Consumes `AiEvent`. Produces `ToolStepState`, `ChatPart`, `applyEvent`, `stopSteps`, `toolStepLine`, `TOOL_STEP_TEXT`, `ToolStep`.

`ToolStep`: one row button (`aria-expanded`), caret, an icon (`ph-spinner` animated while pending, `ph-warning-circle` when failed, else `ph-check`), the line in 13 px muted text, truncated with the full line as `title`. Expanded: "Input" + `<pre>` of `JSON.stringify(input, null, 2)` and "Result" + `<pre>` of the result (React text, never `innerHTML`).

- [ ] **Step 1: failing tests**:
  - `toolSteps.test.ts`: "test lines for Object's tools" (`search {query:'rack'}` -> `Searched notes for 'rack'`; `set_properties {path:'Servers/Alpha.md'}` -> `Edited Servers/Alpha.md`; `read {path:'A.md'}` -> `Read A.md`; `create_task {title:'Call'}` -> `Created 'Call'`); "test lines for built-ins and other servers" (`Grep {pattern:'rack'}` -> `Searched files for 'rack'`; `WebFetch {url:'https://example.org'}` -> `Fetched https://example.org`; `Bash {command:'ls\nrm x'}` -> `Ran ls`; `mcp__docs__search` -> `Used search (docs)`; `Mystery` -> `Used Mystery`); "test long values are cut at 60 characters"; "test failed and stopped suffixes"; "test applyEvent keeps stream order" (text, tool call, text -> 3 parts in order; two text events in a row -> one text part); "test a result fills the step with its id" (`done: true`, `result`, `isError`); "test an unknown id changes nothing"; "test stopSteps marks only pending steps".
  - `ToolStep.test.tsx`: "test collapsed to one line, expands to input and result"; "test a result's HTML shows as text" (result `<img src=x onerror=alert(1)>` -> no `img` element, the text visible); "test a pending step shows a spinner".
- [ ] **Step 2:** run, see them fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** both files pass; `npx tsc -b --noEmit`.
- [ ] **Step 5:** commit `feat(m16): tool steps as collapsible lines`.

### Task 7: The chat panel (after T3, T4, T6)

**Files:**
- Create: `frontend/src/ai/AiChatHeader.tsx`
- Modify: `frontend/src/ai/AiChatPanel.tsx`, `frontend/src/ai/aiText.ts`, `frontend/src/ai/AiChatPanel.test.tsx`

**Interfaces:** Consumes `ChatMarkdown`, `ModelPicker`, `modelLabel`, `useAiModels`, `ToolStep`, `applyEvent`, `stopSteps`, `ChatPart`, `assertInert`, the new `AiEvent` and `AiChatRequest.model`, `useSettings` (`aiModel`). Produces `AiChatHeader`, `AiChatHeaderProps`, `ChatItem.parts`.

Changes:
- **Header** (`AiChatHeader`): a top row `[leading] [flex spacer] [ModelPicker compact, aria-label "Model for this chat"] [New chat]`; the Context chips row stays below it, without the New chat button. `defaultLabel` = `Default` when `aiModel` is null, else `Default (<modelLabel(aiModel)>)`. Picking a model sets the panel's `model` state (no new chat); New chat resets `model` to null; loading a saved chat resets it too.
- **Turns** send `model` (null for Default). The busy entry keeps `parts` built with `applyEvent` from `text` and `tool` events; the finished assistant item keeps them (`parts`) next to `text` (`finished.text || acc`, as today). Stop: `stopSteps(parts)` on the kept partial item. The `T.usedTools` "Used:" line goes (tool steps replace it); the busy status line (`Thinking…` / `toolLine(...)`) stays.
- **Messages**: user and assistant text render with `<ChatMarkdown source={item.text} />`; an assistant item with `parts` renders them in order (`ChatMarkdown` for text parts, `ToolStep` for tool parts); the streaming entry renders `ChatMarkdown streaming`. Copy, Append to page, Append to daily note, Rephrase, Replace, Insert below and the save keep using `item.text`. The text proposal ("Suggested text") stays plain (it is inserted as is).
- `aiText.ts`: add `modelForChat: 'Model for this chat'`, `defaultModel: 'Default'`, `defaultModelOf: (label) => \`Default (${label})\`` (our strings); remove `usedTools`.

- [ ] **Step 1: failing tests** in `AiChatPanel.test.tsx`:
  - "test assistant and user messages render Markdown" (mock reply `# Plan\n\n**bold**, ~~old~~ and a table…` -> `h1`, `strong`, `del`, `table` inside the assistant item; a user message `**hi**` -> `strong`).
  - "test Copy copies the Markdown source and the save stores it" (Copy -> `navigator.clipboard.writeText` with the exact source; `api.saveAiChat` messages' assistant `text` equal to the source).
  - "test a reply's HTML is shown as text" (`<img src=x onerror=alert(1)><script>x</script>` -> no `img`/`script` in the panel; `assertInert(panel.innerHTML)`).
  - "test tool steps sit between the texts, collapsed" (mock events: text "Let me look.", tool call `search {query:'rack'}`, tool result `"[]"`, text "Found it.", done -> the assistant item shows paragraph, a button `Searched notes for 'rack'` with `aria-expanded="false"`, paragraph, in that DOM order; clicking it shows "Input" and "Result").
  - "test Stop leaves a pending step marked stopped" (tool call without result, Stop -> the step line ends with `(stopped)`; the partial text kept).
  - "test the header's model picker sets this chat's model" (pick "Opus 5.5" -> next `api.aiChat` request `model: 'claude-opus-5-5'` and the same `sessionId` as before; pick Default -> `model: null`; New chat -> the trigger shows `Default` again).
  - "test the Default row names the Settings model" (`aiModel: 'claude-sonnet-5-5'` -> the trigger/row text `Default (Sonnet 5.5)`).
  - "test the header renders the leading slot" (`AiChatHeader` with `leading={<span>Agent</span>}`).
  - Update M10's "streaming shows the tools used, and Stop aborts" to the step row instead of the "Used:" line.
- [ ] **Step 2:** `npx vitest run src/ai/AiChatPanel.test.tsx`, see the new ones fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `npx vitest run src/ai` passes (all M10 panel tests too); `npx tsc -b --noEmit`; `npm run build`.
- [ ] **Step 5:** commit `feat(m16): the chat renders Markdown, shows tool steps and picks a model`.

### Task 8: Integrate: acceptance, review, gate

**Files:**
- Create: `scripts/m16_acceptance.py`, `docs/superpowers/plans/m16-acceptance.md`
- Modify: `docs/superpowers/plans/remaining-work.md` (add the M16 status line only; Gene has uncommitted edits in this file: edit on top of them, never revert or reformat other lines)

**Interfaces:** Consumes everything above; `m2_acceptance.Run/commit/git/remove_tree`, `m8_acceptance.Served`, `fake_claude.install` (as `m10_acceptance.py` does).

`scripts/m16_acceptance.py SPACE [--keep]` copies SPACE to a temporary folder (SPACE is never touched), commits the copy to a throw-away git repo (and again after one open), sets `OBJECT_STATE_DIR` and `OBJECT_CACHE_DIR` outside the copy and `FAKE_CLAUDE_LOG`, points `claudePath` at the fake through `PUT /api/settings`, serves with `create_app` on a free `127.0.0.1` port. Checks, each printing `[ok]` / `[FAIL]`:

1. `GET /api/ai/models` lists exactly `aimodels.MODELS` (ids and labels) and the pattern.
2. A turn with `model: "claude-opus-5-5"` runs the fake with `--model claude-opus-5-5`; with no pick and `aiModel` set to `sonnet` (via `PUT /api/settings`), `--model sonnet`; with `aiModel` null and no pick, no `--model`.
3. A second turn with the first turn's `sessionId` and `model: "haiku"` runs `--resume <id> --model haiku`; with `FAKE:modelswitch` the stream still ends in `done` after a second, fresh run that carries the history.
4. `model: "--dangerously-skip-permissions"` answers 422 `That isn't a model name.` and the fake's log gains no run.
5. A `FAKE:tool` turn streams `tool` (id, `name: "search"`, `input.query`) then `tool` (same id, `result`), before `done`; `done.text` holds no tool result. A `FAKE:toolerror` turn's result event has `isError: true`.
6. Saving a chat whose assistant text is the Markdown sample from T2 stores it byte for byte (loaded back equal; the file body contains it); the turns themselves changed no file (`git status` shows only the saved chat and the AI Chat type file).
7. The fake's log shows no `~/.claude` path in any run's cwd, and no turn token in any file of the copy or the state dir (M10's check, kept).

Ends with `RESULT: PASS` (exit 0) or `RESULT: FAIL` (exit 1).

`m16-acceptance.md`: results of the script and the gate, the "Our calls" list, and hand checks for Gene:

- [ ] A real reply with headings, a table, a task list, a Python fence and `$e^{i\pi}+1=0$` renders properly in the chat, in light and dark themes.
- [ ] A user message with `**bold**` renders bold; Copy on an answer pastes the Markdown source into a plain-text editor.
- [ ] Ask "search my notes for rack": the step line "Searched notes for 'rack'" shows between the texts, collapsed; expanding shows the input and result.
- [ ] A `[[Page]]` in an answer is a chip and opens the page in Object.
- [ ] Ask the assistant to reply with `<img src=x onerror=alert(1)>` and a `javascript:` link: nothing runs, the HTML shows as text.
- [ ] The header's model picker lists Default, Fable/Opus/Sonnet/Haiku (latest), Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5, Custom…; picking Haiku 5.5 mid-chat answers the next turn on Haiku and the chat continues with its history (check in `claude` that the session resumed, or that the fallback replayed it).
- [ ] The `haiku` alias works with the installed CLI (one short turn on "Haiku (latest)").
- [ ] Settings > AI Assistant > Model is a picker; a value set in M10 as text still shows; the chat's Default row names it.
- [ ] New chat resets the chat's model to Default.

- [ ] **Step 1:** write the script and run it on a copy of a fixture space (`uv run python scripts/m16_acceptance.py backend/tests/fixtures/<space>`); see `RESULT: PASS`.
- [ ] **Step 2:** one whole-milestone review (correctness, file safety, fidelity to sections 10 and 11; the Review Focus list first), then one fix pass.
- [ ] **Step 3:** the gate: `uv run pytest backend/tests -q`, `npx vitest run`, `npx tsc -b --noEmit`, `npm run build`, `scripts/m10_acceptance.py` and `scripts/m16_acceptance.py` on fixture copies; rerun on a quiet machine any timing failure before calling it real.
- [ ] **Step 4:** write `m16-acceptance.md` with the results; add the status line to `remaining-work.md`.
- [ ] **Step 5:** commit `test(m16): acceptance script and checklist`.

## Shared files and ordering

| Shared file | Owner | Others |
|---|---|---|
| `backend/objectapp/aimodels.py` | T1 | T2 imports it |
| `backend/objectapp/settings.py` | T1 | none |
| `frontend/src/api/types.ts`, `api/client.ts`, `test/mockApi.ts` | T1 | lanes that need a change say so in their report, they don't edit |
| `backend/objectapp/api_ai.py` | T2 | none |
| `backend/tests/fake_claude.py` | T2 | T3, T8 use its markers |
| `backend/tests/test_m10_ai.py` | T2 (the no-network list) | T3 may change one expectation in `test_tool_use_and_text_are_not_repeated` (same lane, after T2) |
| `backend/objectapp/ai.py` | T3 | none |
| `frontend/src/settings/sections/AiAssistant.tsx` (+ test) | T5 | none |
| `frontend/src/ai/AiChatPanel.tsx`, `aiText.ts`, `AiChatPanel.test.tsx` | T7 | none |
| `docs/superpowers/plans/remaining-work.md` | T8 | none |

New files belong to the task that creates them. Read-only imports (`TextBlockCell.safeHref`, `highlight.ts`, `renderMath.ts`, `annotations.findInlineMath`, `wikilinkPresenter`, `linkIndex`) are not edited by anyone in M16.

**Lanes** (four tracks after T1, counted from the Files lists; no file is in two lanes):

- **T1** first, alone.
- **Lane B** (back end): T2 -> T3.
- **Lane M** (Markdown): T4.
- **Lane P** (picker and steps): T5 -> T6.
- **T7** after Lanes M and P (and T3's event shape, which T1 already fixed in `types.ts`, so T7 needs only T4 and T6 done; it starts once both are in).
- **T8** last, after everything.

No `package.json` change (every package is already a dependency), so no lane edits it; use `npm ci`.

## Our calls

- (ours) The model list is served as its own route, `GET /api/ai/models`, with the name rule's pattern, not folded into `/api/ai/status` (status runs `claude --version`; the list needs no process).
- (ours) The aliases offered are `fable`, `opus`, `sonnet` (named by `claude --help` 2.1.317) and `haiku`; labels "Fable (latest)" etc. and "Fable 5.1" etc.
- (ours) The model-name rule is M10's `aiModel` rule, moved into `aimodels.py`; an empty pick means Default.
- (ours) The chat's pick is not saved with the AI Chat object (no new schema); New chat and loading a chat go back to Default.
- (ours) A mid-chat model change keeps `--resume`; M10's existing resume fallback (fresh run with the history) covers a CLI that won't resume on another model.
- (ours) `tool` events come in pairs by id; result text capped at 4,000 characters, input strings at 1,000; tool steps aren't saved.
- (ours) Step lines and the "Input" / "Result" labels in the table above.
- (ours) Renderer: the private-`marked` approach `TextBlockCell` already uses, extended to blocks; single line breaks kept (`breaks: true`); images as alt text; relative `.md` links as object chips.
- (ours) Streaming re-render every 100 ms at most; plain text past 200,000 characters.
- (ours) The header row: M17's leading slot, the model picker, New chat; the context chips move to the row below.
- (ours) The "Suggested text" proposal stays plain text, since it is inserted as written.

## Guesses (spec points I could not settle without guessing)

- **The `haiku` alias** (guess: it exists). `claude --help` 2.1.317 names only `fable`, `opus` and `sonnet` as alias examples. If Gene's hand check finds `haiku` refused, drop that one line from `aimodels.MODELS`.
- **Resuming across models** (guess: the CLI resumes a session under a new `--model`). Spec section 3 asks the builder to check; that needs a real model run, so it is a hand check for Gene, and the fallback already covers a refusal.
- **"Object links open in Object"** (guess: `[[wikilinks]]` and relative `.md` links). The spec doesn't say which link forms the assistant writes; Object's MCP tools return paths, so a relative `Folder/Name.md` link is covered. That `resolveLink` resolves a path-form target (`Servers/Alpha`) as the editor's links do is checked by T4's chip test against the mock `resolve`, and by Gene's hand check.
