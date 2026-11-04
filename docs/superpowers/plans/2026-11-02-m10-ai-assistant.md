# Object, Milestone 10: the AI assistant. Plan (not built)

**Decided by Gene, 2026-11-02:** AI is in scope; the other integrations are wanted "eventually" at lower priority (see "Later"). **The AI runs through the Claude Code CLI** installed on his PC, not an API key and not a local model. Pro features are unlocked and nothing is gated (`CLAUDE.md`).

**Goal.** The AI features the behaviour catalog lists, working on the local space through the user's own Claude Code:
1. **Settings > AI Assistant:** a "Hide AI features" switch (hides every AI entry), plus where `claude` is (auto-found on PATH, overridable) and an optional model.
2. **AI Chat:** the Explore side panel's "AI Chat" card opens a chat with **Relevant Content** under it. A chat is saved as an object of the basic **AI Chat** type (Title, Description, Tags, Context = the pages it was about), so chats are ordinary Markdown files, searchable and linkable.
3. **Block and text entries:** "Ask AI about this block" and "Add tags to block using AI" in the slash menu; "AI assistant..." in the block-handle menu; the AI sparkle in the selection toolbar and the block-selection bar.
4. **Object-level:** add tags using AI; auto-fill empty properties from the page.
5. **Chat shortcuts** (catalog section 2): copy message Ctrl+Alt+C, replace context, append message Ctrl+Alt+A, append message to the daily note, retry Ctrl+Alt+R, close chat Ctrl+Alt+X, rephrase Ctrl+Alt+U.

Behaviour, labels and shortcuts: `docs/behavior-catalog.md` (sections 2, 6, 7, 8). The catalog records only the entry points, so the chat window's own look is **ours** and must be marked "our choice" in the acceptance doc.

## Architecture

- **The server runs the agent; the browser never calls out.** A back-end module `ai.py` starts `claude -p` (print mode, `--output-format stream-json`) as a subprocess per chat turn, with the space folder as working directory, and streams the result to the front end over the same-origin `/api/ai/*` endpoints (server-sent events). `frontend/src/noNetwork.m8.test.ts` stays as it is: no front-end code reaches a URL. A new back-end test asserts the only outward path is the `claude` subprocess.
- **The assistant never writes on its own.** The CLI runs read-only (allowed tools `Read`, `Grep`, `Glob`; `Bash`, `Write`, `Edit` and network tools disallowed). Every change comes back as proposed text, tags or property values; the UI shows it and applies it only when the user accepts, through the normal object-write path (so "never write on read", version checks and CRLF/BOM rules hold).
- **Context is explicit.** A chat's Context is a list of pages (default: the open page); the prompt carries those pages' text. Nothing else leaves the machine unless the model reads it with `Read` inside the space folder, which the first-use notice says.
- **Sessions.** The CLI session id is stored in the AI Chat object's frontmatter so a chat continues with `--resume`; a missing or expired session starts fresh from the saved messages.
- **When `claude` is missing or not signed in:** AI entries stay visible but open a short "Claude Code not found / not signed in" explanation (Object has no paywall and no hidden features); "Hide AI features" removes them.
- **First-use notice:** AI sends page content to Anthropic through the user's Claude Code. The notice is shown once per space and states what is sent. Spaces that hold plaintext secrets (Gene's do) need a way to keep pages out: an **"Exclude from AI"** tag or property is a proposed answer (open question 2).

## Tasks (outline; expand with the M8/M9 plan format before building)

- **T1 contract:** shared client types and methods (`api/types.ts`, `api/client.ts`, `test/mockApi.ts`), written once.
- **Lane B (back end, one sequential lane):** `ai.py` runner with a **fake `claude` stub script** for tests (no real model in the test suite); endpoints `POST /api/ai/chat` (SSE), `GET /api/ai/status`; AI Chat type seed and chat save/load; settings keys (`aiHidden`, `claudePath`, `aiModel`); prompt builders for chat, block question, tags, property auto-fill; tool restrictions; timeout and cancel; tests for each, plus the no-write and no-network guarantees.
- **Lane U (UI):** AI Chat panel in the side panel and Explore card; Relevant Content list (uses existing search and graph data); block-menu, slash, toolbar and selection-bar entries; accept/reject UI for proposed text, tags and properties; chat shortcuts via `lib/shortcuts.ts`; Settings > AI Assistant section; hidden-when-switched-off behaviour everywhere.
- **Integrate, one whole-milestone review** (correctness, file safety, no-write and no-network, fidelity), **one fix pass, gate.** Run the full back-end and front-end gate and every acceptance script; add `scripts/m10_acceptance.py` (uses the stub).
- **Parallelize by file ownership** (`build-process.md`): B owns all back-end files; U owns the new `frontend/src/ai/` folder; the entries in the editor menus belong to one lane member.

## Open questions for Gene (small; the plan assumes the answer in brackets)

1. May the assistant read the whole space folder with `Read`, or only the pages in Context? [Only Context pages: the runner passes their text and sets the working directory to an empty temp folder.]
2. Exclude marked pages from AI entirely? [Yes: pages tagged or flagged "Exclude from AI" are never sent, and the runner refuses them.]
3. Is a chat saved as an AI Chat object by default, or only when the user presses Save? [Saved by default.]

## Later (lower priority, after M10): integrations

Wanted eventually (catalog section 1 has each one's UI): calendar feeds (read events into the daily note), task actions (send a task to another app), the local API with scoped tokens (useful for agents), email capture, Readwise, Kindle import, Telegram, WhatsApp, Raycast, the web extension and web highlights. These need a network or an account, so each is its own spec change and plan; order by how much Gene uses it. **Out for good:** accounts, login, billing, sync, sharing and publishing, mobile, telemetry.

## Not decided yet

Whether the chat window follows a fixed Explore layout or our own: the catalog does not describe it, so the plan builds our own and records it as "our choice".
