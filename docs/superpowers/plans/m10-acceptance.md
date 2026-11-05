# Milestone 10 acceptance: the AI assistant

Plan: `2026-11-02-m10-ai-assistant.md`, revised by `2026-11-04-notion-anytype-features-plan.md` ("How this fits with M10") to use M11's MCP read tools. Date: 2026-11-05. Built on a Linux cloud container, not on Gene's Windows PC, on branch `feat/m10-ai-assistant`, which stacks on `feat/m11-local-api-mcp` (PR #5): merge that first.

## What was built

- **Runner** (`backend/objectapp/ai.py`): one `claude -p` per chat turn, prompt on stdin, `--output-format stream-json`, in an empty temp folder (removed afterwards). The CLI gets no built-in tools (`--tools ""`, `--no-chrome`, a disallowed list for the file, shell and web tools) and only Object's MCP read tools: `--strict-mcp-config` with `objectapp-mcp --read-only` and an allowed list of the nine `mcp__object__*` read tools. The MCP server gets a read-only token made for that turn; it lives only in the app's memory and the CLI's environment (the temp MCP config names `${OBJECT_API_TOKEN}`), and is dropped when the turn ends. A turn times out after 300 s; closing the stream or the timeout kills the CLI's whole process tree. `--resume` keeps a chat's session; a session the CLI no longer knows starts fresh from the saved messages.
- **Routes** (`backend/objectapp/api_ai.py`): `GET /api/ai/status`, `POST /api/ai/chat` (server-sent events: `session`, `text`, `tool`, `done`, `error`; 403 while AI is hidden), `GET /api/ai/chat?path=`, `POST /api/ai/chat/save` (version checked, 409 with `currentVersion`).
- **AI Chat objects** (`backend/objectapp/aichat.py`): the "AI Chat" type is made the first time a chat is saved (or an existing type of that name is reused). A chat is ordinary Markdown: `# Title`, then `## You` / `## Claude` sections, each with an `<!-- at: … -->` line; Context (relation) and Session (text) are properties.
- **Exclude from AI**: pages tagged "Exclude from AI" (or `excludeFromAI: true`) and templates are never put in a prompt and are invisible to the MCP tools (M11's rule); a context page that was left out is listed back to the chat ("Left out (Exclude from AI): …").
- **Chat panel** (`frontend/src/ai/AiChatPanel.tsx`): in the side panel, from the Explore "AI Chat" card or Ctrl+Alt+J. Context chips (the open page by default, + to add, × to remove), messages, a "Thinking…" / tool line while a turn runs, Stop, Relevant Content and Find More, a first-use notice, status help when Claude Code is missing. Per message: Copy, Append to page, Append to daily note, Retry, Rephrase, and Replace / Insert below when the chat came from a block. Proposals (tags, property values, text) are shown with Accept and Dismiss: nothing is written without a click, and writes go through the normal object routes with version checks.
- **Entries** (`frontend/src/editor/aiEntries.ts` and the menus): slash menu "Ask AI about this block" and "Add tags to block using AI"; block handle "AI assistant..."; selection toolbar and block selection bar "AI"; object `…` menu "Add tags using AI" and "Fill empty properties using AI"; peek header "AI Chat". All hidden by Settings > AI Assistant > "Hide AI features".
- **Settings > AI Assistant**: Hide AI features, Claude Code path, Model, and a status row with Recheck.
- **Shortcuts** (catalog section 2): copy message Ctrl+Alt+C, append message Ctrl+Alt+A, retry Ctrl+Alt+R, close chat Ctrl+Alt+X, rephrase Ctrl+Alt+U, while focus is in the chat.

## Our choices (for Gene to check)

Answers to the plan's open questions, as its brackets proposed: (1) the assistant reads only through Object's MCP read tools, never the folder; (2) "Exclude from AI" pages are never sent; (3) chats are saved by default.

1. Open AI chat is Ctrl+Alt+J (ours, next to Explore's Ctrl+J). "Replace context" and "Append message to daily note" have no key (the catalog gives none); the chat's buttons do both.
2. The chat window's whole layout (header with New chat, context chips, messages, tool line, notice and input, Relevant Content limited to 6 at the bottom).
3. One AI chat per tab: opening it again shows the existing one. Every entry (`openAiChat`) starts a new chat; switching tabs stops a running turn and drops its partial answer.
4. Stop keeps the partial answer marked "Stopped." and that turn isn't saved; Retry starts a fresh session so the saved history drives it.
5. A chat's title is the first question's first line, cut at a word to 60 characters ("AI chat" when there is none); a changed title renames the file.
6. Messages show as plain text with line breaks (no Markdown rendering).
7. Proposals apply to the first context page; Accept is disabled without one. Tags: at most 5 suggestions, new tags become Tag objects. Fill empty properties offers only empty text, text block, URL, number, date, label, relation and description properties.
8. Context pages are re-sent on every turn (they may have changed), each as its property lines then its body, up to 60,000 characters in all; a page cut by the limit is listed as left out. At most 50 context pages.
9. With no Claude Code, the entries stay and the chat explains "Claude Code not found" with an "Open AI settings" button; "Not signed in" shows on the first turn (status can't tell before).
10. The AI Chat type: "AI Chat" / "AI Chats", icon `ph-chats-circle`, violet; properties Context (key `context`) and Session (key `session`).
11. Editor entries: the slash AI items sit after Group (alias "ai", no description); the colour items, while searching, now also sit after Group. The selection toolbar's AI button follows `@` after a divider. The object menu's AI rows follow "Add to whiteboard". The peek header has the sparkle; the full page header doesn't (it has its focus button).
12. Replace only overwrites text that is still exactly what was sent; otherwise it inserts below. Plain (non-Markdown) answers become one paragraph per line. A selection's Insert below goes after its whole block (a list counts as one). An answer accepted after its page was closed is not applied, with a toast saying so.
13. The first-use notice blocks sending until OK, and is remembered per space.
14. From the review fix pass: a block or selection is sent only when its page may be seen by the assistant; on an excluded page or a template the server answers "This page is excluded from AI, so its text can't be sent." and starts nothing, and the editor hides its AI entries on pages tagged "Exclude from AI" and on templates (the `excludeFromAI: true` property isn't known to the editor, so there the server's refusal is the guard). Rephrase of an answer is allowed because its text is the assistant's own.
15. A chat's title is sent only when it is created, so a rename sticks. If the chat file changed elsewhere, the panel saves only when the file's messages are the start of its own; otherwise it shows "This chat was changed elsewhere. Start a new chat to continue." and saves nothing.
16. Accept writes to the page that was first in Context when that turn was sent. Ctrl+Alt keys that type a character (AltGr on Windows) stay typing in the chat box.
17. Pages left out are listed with a reason: excluded from AI, template, not found, too long. Linked pages that are excluded are left out of a context page's relation values. History sent to the CLI keeps the newest 100 messages; session ids must be UUIDs.

## Review

One whole-milestone review after the three lanes were merged found one high finding (block text from an excluded page could be sent), one medium (chat saves undid renames and could overwrite edits made elsewhere) and seven low ones; all were fixed in one pass (choices 14 to 17) with a test each.

## Automated results

| Suite | Command | Result |
|---|---|---|
| Back end | `uv run pytest backend/tests -q` | 1687 passed, 1 skipped, 3 xpassed (baseline after M11: 1633; M10 adds 49 in `test_m10_ai.py` plus settings cases) |
| Front end | `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run lint && npm run build` | vitest 2607 passed, 1 skipped; `tsc` clean; lint 0 errors (new warnings are the only-export-components kind every `*_TEXT` module has); build ok |
| M10 acceptance | `uv run python scripts/m10_acceptance.py backend/tests/fixtures/<space>` | PASS on `space-sample`, `space-m8`, `space-v1` |
| M11 acceptance | `uv run python scripts/m11_acceptance.py backend/tests/fixtures/<space>` | PASS on `space-m8`, `space-sample` |
| Earlier acceptance | `m2` (`space-sample`), `m8` (`space-m8`), `m9 --skip-roundtrip` (`space-m8`) | PASS |

`scripts/m10_acceptance.py` runs a git-committed temp copy with a fake `claude` (`backend/tests/fake_claude.py`, steered by markers in the prompt): status, a chat turn's events, the CLI's arguments (no built-in tools, only the MCP read tools, an empty working folder, no token in any file), an excluded page left out, save and load of an AI Chat object, a stale save refused, and `git status` clean after reads.

The real CLI (Claude Code 2.1.318) was also run once by hand in the container against a served sample space: it searched and read through the MCP server and streamed an answer; closing the stream killed it within 0.1 s.

Not verified here: the Windows run (the process-tree kill uses `taskkill /F /T` there), the app's own window (pywebview), and the panel against the real CLI in a browser.

## Hand-checks for Gene

- [ ] Settings > AI Assistant shows Claude Code found (with its version); Hide AI features removes every AI entry, and the chat key stops working.
- [ ] Explore > AI Chat on an open page: ask a question about it; the answer streams, the tool line shows a search or read, and an "AI Chat" object appears with the conversation.
- [ ] Reopen that chat object's chat (from the side panel after a reload): a follow-up question continues it.
- [ ] Slash "Ask AI about this block", then Replace: only that block changes; edit the block first and Replace inserts below instead.
- [ ] Object menu > Add tags using AI, Accept: only the tags line and `lastUpdated` change; Fill empty properties fills only empty ones.
- [ ] Tag a page "Exclude from AI" and add it as context: the chat says it was left out and the answer knows nothing of it.
- [ ] The first-use notice shows once per space; Stop ends a long answer at once.
