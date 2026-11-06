# Milestone 16 acceptance: chat polish and model picker

Plan: `2026-11-05-m16-chat-polish-model-picker.md`. Design: `specs/2026-11-05-agents-design.md`, sections 10 and 11. Date: 2026-11-05. Built on Gene's Windows 11 PC on branch `feat/m16-m24` (shared with M17-M24), commits `d4a9d89..6841eab` plus this integration commit. Gene asked for M16-M24 to be built straight through; his hand checks below come later.

## What was built

- **One model list** (`backend/objectapp/aimodels.py`): `MODELS` holds the four aliases (`fable`, `opus`, `sonnet`, `haiku`) and the four pinned ids (`claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`). The model-name rule `MODEL_PATTERN` moved here from `settings.py`, which now validates `aiModel` with it. No front-end file names a model id (a test walks the sources).
- **Routes** (`api_ai.py`): `GET /api/ai/models` serves the list and the pattern (not gated by "Hide AI features"). `POST /api/ai/chat` takes `model`, this chat's pick: empty means none; a bad name is a 422 "That isn't a model name." before the CLI is looked for. The turn runs on the pick, else Settings' `aiModel`, else no `--model`. A pick mid-chat resumes the session with the new `--model`; a refused resume falls back to a fresh run with the history (M10's fallback).
- **Tool events** (`ai.py`): each call streams twice with the same id, at the call (name, input with strings capped at 1,000 characters) and at its result (text capped at 4,000 characters, error flag). A result for an unknown or already answered id is dropped; tool results never reach the answer text.
- **Markdown in the chat** (`frontend/src/ai/markdown.ts`, `ChatMarkdown.tsx`): a private `marked` instance; headings, emphasis, lists and task lists, tables, quotes, rules, code fences with the editor's lazy highlight.js, math with the editor's KaTeX (`trust: false`), wikilinks and relative `.md` links as object chips. Raw HTML shows as text, images as their alt text, links only http/https/mailto/relative. Streaming re-renders at most every 100 ms; past 200,000 characters the text shows plain.
- **Model picker** (`ModelPicker.tsx`, `models.ts`): Default, "Latest", "Versions", a current custom value, "Custom…" (checked against the served pattern). Used in the chat header ("Model for this chat") and in Settings > AI Assistant > Model ("The default agent's model. Default uses Claude Code's own default.").
- **Tool steps** (`toolSteps.ts`, `ToolStep.tsx`): one collapsed line per call between the texts ("Searched notes for 'rack'"), expanding to its input (JSON) and result (plain text); pending shows a spinner, failed and stopped add " (failed)" / " (stopped)".
- **The chat panel** (`AiChatPanel.tsx`, `AiChatHeader.tsx`): header row with M17's leading slot, the model picker and New chat; the context chips below. Messages render Markdown; Copy, Append, Rephrase, Replace, Insert below and the save still use the Markdown source. The pick is panel state only; New chat and loading a saved chat reset it to Default. The "Used:" line is replaced by the steps.

## Our calls

From the plan's "Our calls" list, all kept as written:

- The model list is its own route, `GET /api/ai/models`, with the pattern, not part of `/api/ai/status`.
- The aliases offered are `fable`, `opus`, `sonnet` and `haiku`; labels "Fable (latest)" etc. and "Fable 5.1" etc.
- The model-name rule is M10's `aiModel` rule, moved into `aimodels.py`; an empty pick means Default.
- The chat's pick is not saved with the AI Chat object (no new schema); New chat and loading a chat go back to Default.
- A mid-chat model change keeps `--resume`; M10's resume fallback covers a CLI that won't resume on another model.
- `tool` events come in pairs by id; result text capped at 4,000 characters, input strings at 1,000; tool steps aren't saved.
- Step lines and the "Input" / "Result" labels are the plan's table.
- Renderer: the private-`marked` approach `TextBlockCell` already uses, extended to blocks; single line breaks kept (`breaks: true`); images as alt text; relative `.md` links as object chips.
- Streaming re-render every 100 ms at most; plain text past 200,000 characters.
- The header row: M17's leading slot, the model picker, New chat; the context chips move to the row below.
- The "Suggested text" proposal stays plain text, since it is inserted as written.

Still guesses for Gene's hand checks: that the `haiku` alias exists in the installed CLI (if not, drop its one line from `aimodels.MODELS`), and that the CLI resumes a session under a new `--model` (the fallback covers a refusal).

## Deviations from the plan

- **T1:** `settings.py` compiles `aimodels.MODEL_PATTERN` into its own private regex `_AI_MODEL`; one copy of the rule, no extra public helper. The mock's pattern string is written with escaped backslashes so at run time it equals the back end's.
- **T2:** the fake checks `FAKE:modelswitch` next to its expired-session check, before the `init` line, so the attempt fails with nothing shown and is retried fresh. `FAKE:toolerror` is handled inside the `FAKE:tool` branch (the marker contains that substring).
- **T3:** one test beyond the plan (`test_short_helpers_are_public`). `short_result` also handles `None` (empty), other non-list values (`str()`), plain strings inside a list (kept) and a block with no type (`[block]`).
- **T4:** the editor's `$$` block rule and its delimiter stripping are copied into `markdown.ts` (the editor's `matchMath` is not exported and importing `mathBlock.ts` would pull in the tiptap node view). A small `dollarEscape` extension keeps `\$` a literal dollar, as the Pandoc rule says. `assertInert` also refuses frame/base/video/audio/source/picture, URL attributes other than `href`, and `url(` in a style (KaTeX's own inline styles allowed). One extra test shows `assertInert` failing on live HTML.
- **T5:** the picker tests reset modules to get a fresh per-window cache (no test-only export). The M10 Settings test was renamed and the "M10 text value still shows" check is its own test. The Custom… placeholder takes the first served pinned id at run time, so it reads `claude-fable-5-1`, not the plan's example `claude-opus-5-5`.
- **T6:** the pending spinner is `ph-spinner-gap` (the app's built-in set has no `ph-spinner`, which would load the full icon set); a stopped step shows `ph-warning-circle`, not a check. `applyEvent` also ignores a repeated call id and an empty text chunk.
- **T7:** with no pick, `ModelPicker`'s trigger shows "Default" (the Labels section) rather than `modelLabel(value, models, defaultLabel)`; only the Default row says "Default (Sonnet 5.5)" when Settings names a model (review fix). M10's "Enter sends, Shift+Enter is a newline" now checks the user message's `<p>` holds `First line<br>second` (`breaks: true`). An answer keeps `parts` only when it had a tool step; a turn stopped before any text is still not kept, as in M10.
- **T8:** `scripts/m10_acceptance.py`'s check "the MCP tool use is reported by short name" compared the exact old event `{"type": "tool", "name": "search"}`; it now looks for a `tool` event named `search` (the only change to that script). `scripts/m16_acceptance.py` reuses `m10_acceptance`'s `sse`, `runs`, `clean` and `first_page` helpers.

## Review

One whole-milestone review after integration, Review Focus first: hostile replies (raw HTML escaped, `safeHref` on every link, KaTeX `trust: false`, fence language escaped, images as alt text; covered by `markdown.test.ts` and the panel's "a reply's HTML is shown as text"); Copy and save on `item.text`, also for stopped answers and answers with steps; a mid-chat model switch (`--resume` plus the new `--model`, one fresh fallback, Default drops `--model`); untrusted model names (422 before the CLI, the same rule in Settings and the picker); awkward tool traffic (caps, unknown or repeated ids, stop while pending, throttled streaming). File safety: a turn writes nothing in the space (acceptance check 6), the server binds 127.0.0.1, tests use a temp `OBJECT_STATE_DIR`. Fidelity: names, signatures and labels match the Contract except the deviations above. The review found nothing beyond the stale M10 acceptance check, fixed in this commit.

## Automated results

| Suite | Command | Result |
|---|---|---|
| Back end | `uv run pytest backend/tests -q` | 2082 passed, 13 skipped, 3 xpassed (M16 adds `test_m16_contract.py`, `test_m16_models.py`, `test_m16_tool_events.py`); 1 warning: a test's background uvicorn thread exited at startup (an unhandled-thread warning, the test itself passed) |
| Front end | `cd frontend && npx vitest run` | 409 files passed, 1 skipped; 3172 tests passed, 1 skipped |
| Types, lint, build | `npx tsc -b --noEmit`, `npm run lint`, `npm run build` | `tsc` clean; lint 0 errors (warnings only, of kinds the code base already has); build ok |
| M16 acceptance | `uv run python scripts/m16_acceptance.py backend/tests/fixtures/<space>` | PASS on `space-sample` and `space-m8` (all 7 checks) |
| M10 acceptance | `uv run python scripts/m10_acceptance.py backend/tests/fixtures/<space>` | PASS on `space-sample` and `space-m8` |

`scripts/m16_acceptance.py` copies a space to a temp folder, commits it to a throw-away git repo, points `claudePath` at the fake `claude` and serves on `127.0.0.1`. It checks the model list route; which `--model` a turn runs on (pick, Settings, none); a mid-chat switch (`--resume <id> --model haiku`) and the `FAKE:modelswitch` fallback (two runs, the second fresh with the history, ending in `done`); a 422 for `--dangerously-skip-permissions` with no run; the tool event pair and a failed tool; the saved chat keeping the Markdown source byte for byte with `git status` showing only the chat and the AI Chat type file; no run under `~/.claude` and no turn token in any file.

Not verified here: the real `claude` CLI (no live spike in M16), the app's own window (pywebview), and the chat in a real browser (jsdom only).

## Hand checks for Gene

- [ ] A real reply with headings, a table, a task list, a Python fence and `$e^{i\pi}+1=0$` renders properly in the chat, in light and dark themes.
- [ ] A user message with `**bold**` renders bold; Copy on an answer pastes the Markdown source into a plain-text editor.
- [ ] Ask "search my notes for rack": the step line "Searched notes for 'rack'" shows between the texts, collapsed; expanding shows the input and result.
- [ ] A `[[Page]]` in an answer is a chip and opens the page in Object.
- [ ] Ask the assistant to reply with `<img src=x onerror=alert(1)>` and a `javascript:` link: nothing runs, the HTML shows as text.
- [ ] The header's model picker lists Default, Fable/Opus/Sonnet/Haiku (latest), Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5, Custom…; picking Haiku 5.5 mid-chat answers the next turn on Haiku and the chat continues with its history (check in `claude` that the session resumed, or that the fallback replayed it).
- [ ] The `haiku` alias works with the installed CLI (one short turn on "Haiku (latest)").
- [ ] Settings > AI Assistant > Model is a picker; a value set in M10 as text still shows; the chat's Default row names it.
- [ ] New chat resets the chat's model to Default.
