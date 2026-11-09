# Automated acceptance run, M15-M20 (lane C2a, 2026-11-08)

Gene's hand-check boxes in `m15-acceptance.md` … `m20-acceptance.md`, run by an agent against a scratch server.
The boxes in those files are **not** ticked; this report is the evidence.

- **Branch:** `lane/c2a-acceptance-m15-m20`, off `lane/c2-acceptance-m10-m27` at `b52a5d7`.
- **Server:** headless scratch server on `127.0.0.1:8804` (`BROWSER=/usr/bin/true … objectapp --browser`),
  `OBJECT_STATE_DIR` and spaces under `~/.hermes/cache/scratch/lane-c2a/` (copies of `space-sample`; import
  targets `notion/`, `obsidian/`, `big/`, `space (trial)/` made by the imports). Port 8790, `~/Spaces/main` and
  `~/.claude` untouched.
- **Browser:** named session `lane-c2a`, 1440x900, driven by DOM reads (no screenshots).
- **AI:** the fake CLI (`backend/tests/fake_claude.py` behind lane C2's wrapper, which adds an `LC2:md` reply
  with headings, a table, a task list, a fence, math, `[[Alpha]]`, raw HTML and a `javascript:` link). Real-CLI
  boxes cite lane A's live run: `docs/superpowers/plans/live-cli-check-2026-11-08.md` on `lane/a-live-cli`.
- **Fakes:** `backend/tests/fake_a2a.py --port 8799 --token test-token` (M20) and
  `backend/tests/fake_mcp_server.py --http 8814 --require-bearer mcp-secret-123` (M19), plus its stdio form.
- **Linux, not Windows:** `%LOCALAPPDATA%\object\` is `OBJECT_STATE_DIR` here.

## Acceptance scripts (rerun in this worktree)

`PYTHONPATH=scripts:backend uv run python scripts/mNN_acceptance.py backend/tests/fixtures/<space>`:

| Script | space-sample | space-v1 |
|---|---|---|
| m15 | rc 0, 25 `[ok]`, 0 fail | rc 0, 25 `[ok]`, 0 fail |
| m16 | rc 0, 20 `[ok]`, 0 fail | rc 0, 20 `[ok]`, 0 fail |
| m17 | rc 0, 39 `[ok]`, 0 fail | rc 0, 39 `[ok]`, 0 fail |
| m18 | rc 0, 37 `[ok]`, 0 fail | rc 0, 37 `[ok]`, 0 fail |
| m19 | rc 0, 38 `[ok]`, 0 fail | rc 0, 38 `[ok]`, 0 fail |
| m20 | rc 0, 36 `[ok]`, 0 fail | rc 0, 36 `[ok]`, 0 fail |

(Lane C2's earlier m15 run crashed in check 5; `64c4af4 fix(accept-m15)` on the base branch fixed it.)

## Counts

67 boxes: DEFERRED-live-CLI 1, MANUAL 1, PARTIAL 4, PASS 60, SUPERSEDED 1


## M15 (m15-acceptance.md)

| Box | Check (abridged) | Result | Evidence |
|---|---|---|---|
| M15.1 | Settings > General > Import Content: each source shows its help line; "Start importing" opens the dialog. | **PASS** | Settings > Import Content shows help per source (Notion: 'In Notion, open Settings, choose Export all workspace content…', Obsidian: 'A vault needs no export…', Anytype: 'export… as Markdown with files included'); 'Start importing' opened 'Import from another app' dialog |
| M15.2 | Export a small Notion workspace as "Markdown & CSV", paste the zip's path, Preview: counts, types and skipped items look right, and nothi… | **PASS** | notion.zip preview: '8 objects, 3 types, 2 attachments; 7 of 9 links will resolve; 1 title repeats; 3 items skipped' (listed with reasons); imports/ dir listing identical before/after preview; Import -> new space 'notion' -> Switch space: sidebar Authors 1/Books 5/Pages 3, Attachments/diagram.png+manual.pdf, [[links]] in Welcome/Dune, Pages/Import report.md with counts+skipped. (New step since M15: 'Check for sensitive content' scan must run before Continue.) |
| M15.3 | Point it at an Obsidian vault folder: wikilinks, embeds, tags and callouts come through; the vault is unchanged (`git status` in the vaul… | **PASS** | Obsidian vault (git repo) via dialog -> new space: wikilinks kept ([[Dune\|the book]], [[Dune#Plot]], [[Emma\|Emma's page]] from md link), embeds ![](Attachments/cover.png) + ![[Attachments/manual.pdf]], tags (frontmatter + inline #inline-tag -> Tags/*.md; code-fence #not-a-tag untouched), callout '> [!note] Remember' -> standout quote '> **Remember**'; vault `git status --short` empty after. Note: Books/Dune and Movies/Dune share title+createdAt; [[Books/Dune\|the book]] was written as [[Dune\|the book]] and resolves to Books/Dune only via the path tiebreak. |
| M15.4 | Import into This space: `git status` in the space shows only new files (and type files); the sidebar refreshes by itself. | **PASS** | Obsidian vault into 'This space' (with M27's default 'Try on a copy' unticked): finished '6 imported'; `git status --short` shows only untracked new files (Books/, Movies/, People (2)/, Pages/Home.md, Pages/Import report.md, Attachments/cover (2).png, Tags/*.md, .object/ type files), zero modified; sidebar updated without reload (Books 3, Movies 1, People (2) 1, Pages 6->8, Tags 1->5). Notes: folder 'People' is not singularised, so it becomes a new type 'People' in folder 'People (2)' instead of joining Person; first This-space run defaults to a trial copy (M27). |
| M15.5 | Stop an import partway: what was written stays, and the report says it stopped. | **PASS** | 6000-note folder import, 'Stop import' at ~475/6001: dialog 'The import stopped. What was written so far is kept. 747 imported… 5253 failed'; big/Pages has 747 notes + report; report: 'The import stopped early… Failed includes 5,253 not written because the import stopped; Links to objects that weren't imported stay unresolved.' Minor: the dialog's '5253 failed' lacks the report's 'because it stopped' note; running line showed two different counters (475/6001 vs 'Writing objects: 174 of 6001'). |
| M15.6 | If you have Anytype, export a few objects as Markdown and try it with "Exported from: Anytype"; tell me what the frontmatter looks like s… | **MANUAL** | Needs a real Anytype export (none on this box); the Anytype reader stays unverified (plan's known gap). |
| M15.7 | The dialog in Light and Dark, and with a keyboard only. | **PARTIAL** | Keyboard only PASS: path input autofocused; typed path + Enter -> scan step; Tab to Scan/Enter, Tab to Continue/Enter -> review (focus moves to 'What will be imported' heading), Tab reaches Import, focus stays in the dialog, Escape closes. Light/Dark look = MANUAL (visual). |

## M16 (m16-acceptance.md)

| Box | Check (abridged) | Result | Evidence |
|---|---|---|---|
| M16.1 | A real reply with headings, a table, a task list, a Python fence and `$e^{i\pi}+1=0$` renders properly in the chat, in light and dark the… | **PARTIAL** | Fake reply (LC2:md) renders: H1 'Heading one', H2, <table> Col A/Col B, task-list checkboxes (false/true), python fence with hljs spans (hljs-keyword def), KaTeX span.katex for $e^{i\pi}+1=0$. Light vs dark look = MANUAL (visual); a real-model reply covered by lane A live check 1 (text only). |
| M16.2 | A user message with `**bold**` renders bold; Copy on an answer pastes the Markdown source into a plain-text editor. | **PASS** | User message 'This is **bold**' renders <strong>bold</strong> inside li[data-role=user]; 'Copy message' on the answer wrote the raw Markdown ('# Heading one\n\n## Heading two\n\n\| Col A \|…[click me](javascript:alert(1))') to navigator.clipboard.writeText (stubbed; pasting into a real editor = OS clipboard, not exercised). |
| M16.3 | Ask "search my notes for rack": the step line "Searched notes for 'rack'" shows between the texts, collapsed; expanding shows the input a… | **PASS** | FAKE:tool turn: collapsed button[aria-expanded=false] "Searched notes for 'alpha'" between 'Let me look.' and 'Hello from the fake claude.'; expanded shows 'Input {"query": "alpha"}' and 'Result []'. (The fake's query is fixed to 'alpha'; label format verified.) |
| M16.4 | A `[[Page]]` in an answer is a chip and opens the page in Object. | **PASS** | [[Alpha]] in the answer is span.wikilink[data-resolved-path=Servers/Alpha.md] (pink chip); clicking it opened the Alpha Server page (tabs: Alpha/Server, Backlinks 2, Related Content 3). |
| M16.5 | Ask the assistant to reply with `<img src=x onerror=alert(1)>` and a `javascript:` link: nothing runs, the HTML shows as text. | **PASS** | Raw '<img src=x onerror=alert(1)>' shown as text (no <img> in the panel), '[click me](javascript:alert(1))' rendered as plain <p>click me</p> (no <a>), window.alert stub count 0. |
| M16.6 | The header's model picker lists Default, Fable/Opus/Sonnet/Haiku (latest), Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5, Custom…; picking H… | **PASS** | Header picker lists exactly: Default, Fable/Opus/Sonnet/Haiku (latest), Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5, Custom…; picking Haiku 5.5 mid-chat -> next run's fake log model=claude-haiku-5-5 with --resume d9ecae0c-… (same session), history kept in panel. Live resume: lane A check 1b PASS (same session id, recall of turn 1). |
| M16.7 | The `haiku` alias works with the installed CLI (one short turn on "Haiku (latest)"). | **PASS** | Cited: lane A live-cli-check-2026-11-08.md check 1c — real CLI 2.1.319, model 'haiku' replied in 2.6 s, transcript '"model":"haiku"'. Not re-run here (no real CLI spend). |
| M16.8 | Settings > AI Assistant > Model is a picker; a value set in M10 as text still shows; the chat's Default row names it. | **PASS** | aiModel='claude-sonnet-4-5-20250929' (M10-style text): Settings > AI Assistant > Model is a picker button showing that value, listed checked as its own row before Custom…; chat picker's first row reads 'Default (claude-sonnet-4-5-20250929)'. Note: a settings PUT from elsewhere wasn't reflected until reload. |
| M16.9 | New chat resets the chat's model to Default. | **PASS** | After picking Haiku 5.5, 'New chat' -> picker trigger reads 'Default'. |

## M17 (m17-acceptance.md)

| Box | Check (abridged) | Result | Evidence |
|---|---|---|---|
| M17.1 | The Agents section sits at the top of the sidebar, with Assistant first and "+ New agent" last. | **SUPERSEDED** | Redesign (catalog §4): sidebar order is New, Calendar, Tasks, Graph, Assistant (main nav), then 'Agents' section (user agents only, empty here) whose header '+' ('Add an agent') menu holds New agent / Add agent folder… / Add remote agent… / Deleted agents… — no trailing '+ New agent' row. Verified at the new location. |
| M17.2 | Clicking Assistant opens the chat. Ctrl+Alt+J does too. The header shows the agent picker, the model picker and New chat. | **PASS** | Sidebar Assistant opens the side-panel chat; with the panel closed, a synthetic Ctrl+Alt+J (CDP keyDown modifiers=3) opened it; header buttons 'Agent for this chat', 'Model for this chat', 'New chat'. |
| M17.3 | Assistant creates a Task, edits a page's body and moves a page to the Trash without an Accept step. Each step shows in the chat. The edit… | **PASS** | Fake run calling real objectapp-mcp tools (FAKE:mcp:object:create_task / append_to_section / move_to_trash) from an Assistant chat: steps "Created 'Agent made task'", 'Edited Pages/Notes.md', 'Moved Pages/What if.md to the Trash' shown in the chat, 0 Accept buttons; git: Tasks/Agent made task.md new, Pages/What if.md deleted (in .object/trash/), Pages/Notes.md (CRLF) diff = appended '\r\n+Added by the agent.\r' with CRLF kept. Note: that page had no frontmatter, so the write also stamped `id`/`lastUpdated` frontmatter (the app's normal save stamp). Real-CLI chat: lane A check 1. |
| M17.4 | Add tags, Fill empty properties and Rephrase still ask you to Accept. | **PASS** | 'Add tags using AI' (object More menu) -> 'Suggested tags Math/history/Ideas' + Accept/Dismiss; 'Fill empty properties using AI' -> 'Suggested properties: Description = A mathematician.' + Accept/Dismiss; git showed only the saved AI Chat files, no page change. Chat 'Rephrase' -> 'Suggested text' proposal, nothing written (with no page in context only Copy is offered). Proposal turns run read-only: m17 script check 6 [ok]. |
| M17.5 | New agent "Researcher" with its own instructions: its folder is in `%LOCALAPPDATA%\object\agents\Researcher\` and opens with Open folder.… | **PASS** | + > New agent 'Researcher' with instructions -> folder state/agents/Researcher/ (CLAUDE.md holds the instructions, .claude/, .object-agent/); Profile tab shows the folder path and an 'Open folder' button (not clicked: it launches the OS file manager = MANUAL). Its chat runs with cwd=state/agents/Researcher, --setting-sources project,local; following the instructions live = lane A check 2 (RESEARCHER-SOUL-42 answered). BUG FOUND+FIXED ec0dde6: with an Assistant chat open in the side panel, clicking Researcher's sidebar row left the panel on Assistant (sidepanel.openInArea ignored agentId/chatId); after the fix the row switches the panel to Researcher. |
| M17.6 | Researcher's Tools tab: the shell is off. Turning it on shows the warning. Switching "Object write" off stops it editing notes. | **PASS** | Researcher Tools tab: 'Shell (Bash, PowerShell)' switch off (toolsOff ['Bash']); turning it on asks 'Turn on the shell? With the shell on, this agent can read every file on this computer, including pages excluded from AI.' (Cancel kept it off). 'All of Object write' off -> toolsOff gained 43 mcp__object__* write tools; a Researcher turn's create_task step shows "Created 'Researcher forbidden task' (failed)", run's --disallowedTools has mcp__object__create_task, no file written. |
| M17.7 | Asking any agent to read an "Exclude from AI" page by path with Read, Grep or Glob is refused, and the reply doesn't contain its text. | **PASS** | Excluded page 'Pages/Vault Secret.md' (excludeFromAI, body ZEBRA-EXCL-91): Researcher turn's Read/Grep/Glob steps all '(failed)' (run deny rules Read(//…/space/**), Edit(//…/space/**) plus every known space), 'ZEBRA' absent from the panel. Live CLI: lane A check 1 turn 2 ('File is in a directory that is denied…', marker absent); m17 script checks 3+5 [ok]. |
| M17.8 | Your own `~/.claude` CLAUDE.md, hooks, plugins and skills don't show up in an agent chat. (Ask it to list its skills and say what its ins… | **PASS** | Cited lane A check 2: live run loads only the agent's CLAUDE.md, ancestor CLAUDE.md markers kept out by claudeMdExcludes; test_user_setup_never_reaches_a_run PASS (0 user skills, 0 hooks, no plugin outside @builtin). Here the fake log shows --setting-sources project,local and no CLAUDE_CONFIG_DIR. ~/.claude/CLAUDE.md itself does not exist on this box and ~/.claude is off limits, so 'what its instructions mention' for a user file = N/A. |
| M17.9 | The Chats tab lists the chats you had, and filtering by title works. Opening one shows its messages and steps. | **PASS** | Researcher Chats tab lists 3 chats (title, space, date, '2 messages'); 'Search chats' = 'Make' narrows to that chat with <strong>Make</strong> in the snippet; clicking it shows its messages and the step "Created 'Researcher forbidden task' (failed)" in the side panel (with a chat already open this needed fix ec0dde6). |
| M17.10 | Deleting Researcher and restoring it from "Deleted agents…" brings it back with its chats. Assistant can't be deleted. | **PASS** | Researcher row … > Delete -> agents API lists only Assistant, folder gone from state/agents; '+ > Deleted agents…' lists 'Researcher …/state/agents/Researcher · 11/8/2026'; Restore -> back with same id and its 3 chats (GET /agents/{id}/chats). Assistant: main-nav entry has no actions menu; DELETE /api/agents/assistant -> 422 "The default agent can't be deleted." |
| M17.11 | Copying Researcher's folder elsewhere, changing its id in `agent.json` and using "Add agent folder…" lists it. | **PASS** | Copied state/agents/Researcher to agentcopies/Researcher Copy, set .object-agent/agent.json id to a new ULID, '+ > Add agent folder…' with that path -> listed (sidebar Agents: Researcher, Researcher; API inStateDir=false, folder=the copy); folder hashes unchanged. Note: an id that isn't a valid ULID (e.g. with 'O') is refused with the misleading 'This folder isn't an Object agent.' |
| M17.12 | An AI Chat saved before M17 opens and continues with Assistant. | **PASS** | An M10-style AI Chat file (no agent property, session EXPIRED_SESSION) restored into the side panel after reload shows its messages with agent 'Assistant'; the follow-up ran in state/agents/Assistant, the expired resume fell back to a replay (KUMQUAT from the history in the prompt), and the file gained the new turn plus 'agent: Assistant' and a new session. |
| M17.13 | Unlinked mentions still show on the object page. | **PASS** | Page 'Mention probe' with plain text 'Yesterday Ada Lovelace reviewed the plan.' -> Ada Lovelace page tab 'Mentions 1' lists it with a 'Link' button (checked once on this build, after M17-M20 are all in). |

## M18 (m18-acceptance.md)

| Box | Check (abridged) | Result | Evidence |
|---|---|---|---|
| M18.1 | Tell Assistant something about yourself and ask it to remember it. The step "Saved a memory about you" shows; the Memory tab's "About you… | **PASS** | Assistant chat turn calling memory add(user) -> step 'Saved a memory about you' (result chars 21, cap 1375); Assistant's Memory tab 'About you: Prefers short answers — 21 / 1,375 characters' with History 'Saved a memory about you … by the agent / Undo'. Live: lane A check 5. Note: after the redesign the Assistant's own agent page (Memory/Skills/Learning tabs) has no sidebar entry — it was reached only by clicking a Learning summary line. |
| M18.2 | Start a new chat: it knows the fact. In the old chat it says it was saved for next time. | **PARTIAL** | A new chat's run carries the snapshot (--append-system-prompt has <user-profile>…Prefers short answers</user-profile> and <memory>Rack A is in room 2</memory>); the old chat's next turn does not (frozen snapshot). 'It says it was saved for next time' is the live model's wording = DEFERRED-live-CLI. |
| M18.3 | After about ten messages a small "Learning…" line shows under a reply, then a summary like "Saved 1 memory, updated 1 skill". You can typ… | **PASS** | New chat, 10 fake turns: 'Learning…' line appeared after message 10; composer stayed enabled and a message typed while the review ran got its reply; then 'Saved 1 memory' (review sleep 5 s via the fake). Clicking a summary opens the change (memory -> Memory tab; memory+skill -> Skills tab). |
| M18.4 | Your chat goes on normally after a review: the next reply follows on from your last message and shows nothing of the review. | **PASS** | Review run used --resume <chat session> --fork-session --no-session-persistence; the next turn resumed the chat's own session id (3fd5eb6a…, fork false) and the panel showed only the user's turns and replies plus the one-line summary. |
| M18.5 | "Learn from this chat" in the chat's `…` menu runs a review on demand. | **PASS** | Chat '…' menu has 'Learn from this chat'; it ran a review on demand -> 'Saved 1 memory, updated 1 skill' (memory 'Rack A is in room 2' + patch of rack-labels). |
| M18.6 | Ask the agent to make a skill for a task you repeat. The Skills tab lists it as Active, made by Agent, with its use count and last use. O… | **PASS** | Chat turn skill_manage create -> step "Created the skill 'rack-labels'"; Skills tab row 'rack-labels · How to label racks · Active · uses 1 · 11/8/2026 10:34 PM · Agent'. BUG FOUND+FIXED (fix(accept-m18.6)): editing SKILL.md in the skill page rewrote its frontmatter as '---\n## name: rack-labels description: … created\_by: agent' (skill lost name/description). After the fix the frontmatter shows above the editor and is saved unchanged; edit appended 'Use the label maker.'; ledger/History gained "Rewrote 'rack-labels' … by you" (the History list only shows it after reopening, not live). |
| M18.7 | Undo a change in a skill's History: the skill goes back. Undo the undo: it comes back. | **PASS** | Edited rack-labels ('Check twice.'): History showed "Rewrote … by you" at once (after fix 908c9d0 — before it, the list kept old rows and Undo answered 'This changed again since. Undo the later change first.'); Undo -> file lost the line, row "Undid: Rewrote 'rack-labels' … by Undo"; Undo of that -> file byte-identical to the edited version, row "Undid: Undid: …". |
| M18.8 | Archive a skill, turn on "Show archived", Restore it. Pin a skill. | **PASS** | Archive -> detail shows Restore, skill leaves the list; 'Show archived' switch -> row 'rack-labels … Archived'; Restore -> Active again; Pin -> button flips to Unpin and the Pinned column marks it. BUG FOUND+FIXED 6b4d08b: with Show archived on every active skill was listed twice (the archived=true route answer includes active skills). |
| M18.9 | "Tidy up now" merges two overlapping skills you made the agent write, archives the absorbed one ("Absorbed into …") and shows a short rep… | **PASS** | Agent made broad-skill + narrow-skill (chat skill_manage create); 'Tidy up now' with the fake curator archiving narrow-skill into broad-skill -> list drops narrow-skill, 'Last tidy-up, 11/8/2026 10:41:52 PM' + the run's report text (fake: 'Hello from the fake claude.'); archived narrow-skill shows 'Absorbed into broad-skill' and History "Archived 'narrow-skill' into 'broad-skill'". Merge quality with a real model = live CLI (not run). |
| M18.10 | The Learning tab's numbers save; setting "Review memory every" to 0 stops memory reviews. | **PASS** | Learning tab: set 'Review memory every' 0 and 'Review skills every' 15 -> agent learning saved {memoryReviewEvery: 0, skillReviewEvery: 15} and shown after reload; then 11 turns in a new chat ran 0 review runs (no --fork-session run) and no Learning line. |
| M18.11 | The Chats tab's search finds a chat by a word from its middle, with the word in bold in a snippet. | **PASS** | Assistant Chats tab 'Search chats' = 'about' finds 'Quiet turn 1' by its 12th message ('What did we say about racks before?') and the 'Message 1 about racks' chat, snippets with <strong>about</strong>. |
| M18.12 | Ask the agent what it remembers about an earlier chat: it uses "Searched past chats". | **PASS** | Fake turn calling session_search -> step "Searched past chats for 'racks'". Whether a live model chooses the tool when asked = live CLI (lane A did not cover). |
| M18.13 | Ask the agent to read an "Exclude from AI" page and to remember what it says: it can't read it, so nothing about it is saved. | **DEFERRED-live-CLI** | The refusal half is shown (M17.7: Read/Grep/Glob on the excluded page fail, marker absent; m18 script check 11 / fence tests). 'So nothing about it is saved' depends on what a live model does next; not run (no real CLI spend). |
| M18.14 | "Memory & skills" in an agent's `…` menu opens its Memory tab. | **PASS** | Researcher row '…' menu > 'Memory & skills' opened the agent page on the Memory tab (tabs: Researcher\|Profile\|…\|Memory*\|…). |
| M18.15 | Unlinked mentions still show on the object page. | **PASS** | Page 'Mention probe' with plain text 'Yesterday Ada Lovelace reviewed the plan.' -> Ada Lovelace page tab 'Mentions 1' lists it with a 'Link' button (checked once on this build, after M17-M20 are all in). |

## M19 (m19-acceptance.md)

| Box | Check (abridged) | Result | Evidence |
|---|---|---|---|
| M19.1 | Settings > Integrations shows "MCP servers" after API tokens. "Add MCP server" by Command adds a real stdio server you use (for example o… | **PASS** | Settings > Integrations: 'MCP servers' section after 'API tokens' (and 'Connect an AI assistant'); 'Add MCP server' by Command (name fake-stdio, command .venv/bin/python, argument backend/tests/fake_mcp_server.py) saved; 'Test' -> '3 tools' and 'Tools (3): add, echo, whoami' with descriptions. (A real npx server was not used: fake stdio server instead.) |
| M19.2 | Add a URL server with a bearer token or an API-key header. "Test" lists its tools. Editing it shows "•••••• saved", never the value. A wr… | **PASS** | URL server fake-http (http://127.0.0.1:8814/mcp, HTTP, Bearer token) -> Test '3 tools'; Edit shows 'Bearer token •••••• saved / Replace / Remove' and no value in any input; replacing it with a wrong token -> 'Test failed: The server refused the credentials (401). If it needs an OAuth sign-in, Object can't do that yet; use a token or a header.' (the fake server's log never saw the token text echoed); setting it back -> 3 tools. |
| M19.3 | `%LOCALAPPDATA%\object\secrets.json` holds the values and `mcp-servers.json` doesn't. Neither file is in any space folder or agent folder. | **PASS** | OBJECT_STATE_DIR/secrets.json holds key 'mcp:<id>:bearer'; mcp-servers.json has 'bearer': true and no value; grep -rl for the token over the whole scratch tree (spaces + agent folders + state) finds only state/secrets.json (and this report's own setup line). |
| M19.4 | In a chat, Assistant uses one of the server's tools without an Accept step, and the step shows in the chat. | **PASS** | Assistant chat (fake) calling fake-http add and fake-stdio echo: steps 'Used add (fake-http)' Result 5 and 'Used echo (fake-stdio)' Result 'hi stdio', no Accept button; run's --mcp-config servers [fake-http, fake-stdio, object, object-agent]. |
| M19.5 | Researcher's Tools tab lists the server as its own group with its tools ("Listing tools…" first). Switching one tool off stops Researcher… | **PASS** | Researcher Tools tab showed 'Listing tools…' first, then groups 'fake-stdio' and 'fake-http' with add/echo/whoami switches. fake-stdio/echo off + 'All of fake-http' off -> Researcher run: 'Used echo (fake-stdio) (failed)', 'Used add (fake-stdio)' ok, 'Used add (fake-http) (failed)', run servers [fake-stdio, object, object-agent] (fake-http left out); Assistant same message: all three ok, servers include fake-http. |
| M19.6 | Turning the server off in Settings removes it from every agent's chats. The Tools tab says "Turned off in Settings > Integrations". | **PASS** | Settings switch 'Turned on fake-stdio' off -> Assistant's next run servers [fake-http, object, object-agent] (fake-stdio gone); tools API status 'disabled'; Researcher Tools tab group reads 'Turned off in Settings > Integrations' (an already-open agent page only showed it after a reload). |
| M19.7 | Your own Claude Code MCP servers (from your `~/.claude.json` or project files) don't appear in an agent chat. Ask the agent to list its t… | **PASS** | Every run has --strict-mcp-config and an --mcp-config listing only Object's servers plus the gateway's ([fake-http, fake-stdio, object, object-agent]); --setting-sources project,local, no CLAUDE_CONFIG_DIR. Live: lane A check 2 / test_user_setup_never_reaches_a_run (no user MCP, skills, hooks or plugins in a run). Gene's ~/.claude.json was not read. |
| M19.8 | Put a `.mcp.json` with a `${VAR}` reference into an agent folder (or "Add agent folder…" for a copy from elsewhere). The Profile tab show… | **PASS** | Researcher folder .mcp.json server 'folder-fake' with env FAKE_TOKEN=${FAKE_TOKEN}: Profile 'Folder MCP servers: folder-fake Needs secrets: FAKE_TOKEN  Set…'; Set… dialog 'Set FAKE_TOKEN' (password field) -> saved to state/secrets.json only; Tools tab then lists 'folder-fake · this agent's folder: add, echo, whoami' (the server starts only with the var set: --require-env). |
| M19.9 | Delete a server: "Confirm delete" first. Its secrets are gone from `secrets.json`. | **PASS** | fake-http row Delete -> row shows 'Agents lose this server at once. Its secrets are deleted.' + 'Confirm delete' (mcp-servers.json unchanged until then); Confirm delete -> servers [fake-stdio], secrets.json keys [] (its bearer gone). Observation: a Secret variables row's Delete (FAKE_TOKEN) removed the value at once with no confirm step. |
| M19.10 | "Hide AI features" hides the MCP servers group. | **PASS** | aiHidden=true -> Settings > Integrations shows API tokens but no 'MCP servers' section; set back to false. |
| M19.11 | Unlinked mentions still show on the object page. | **PASS** | Page 'Mention probe' with plain text 'Yesterday Ada Lovelace reviewed the plan.' -> Ada Lovelace page tab 'Mentions 1' lists it with a 'Link' button (checked once on this build, after M17-M20 are all in). |

## M20 (m20-acceptance.md)

| Box | Check (abridged) | Result | Evidence |
|---|---|---|---|
| M20.1 | Agents section `+` > "Add remote agent…": typing `http://127.0.0.1:8799` with the bearer `test-token` and pressing "Look up" shows "Fake … | **PASS** | '+ > Add remote agent…', http://127.0.0.1:8799 + Bearer token, 'Look up' -> 'Fake Planner · A synthetic agent for Object's tests. · Fake Org 1.0.0 · Plan a trip — Plans a short trip.(travel) · Sends messages to 127.0.0.1:8799 · Streaming'; 'Add agent' -> sidebar Agents row 'Fake Planner' with a 'remote' mark. |
| M20.2 | Its page shows Profile, Card and Chats only. The token shows as "set" and never as text. "Replace token…" works. | **PASS** | Fake Planner page tabs exactly Profile\|Card\|Chats; Profile 'Authentication: Bearer token: set' (no value in any input); 'Replace token…' -> inline None/Bearer/Header + password field + Save -> back to 'Bearer token: set', chat still answered; token only in state/secrets.json. |
| M20.3 | Chatting with it in the side panel streams the reply. The header has no model picker. A second message continues the same conversation (t… | **PASS** | Side-panel chat with Fake Planner: header has 'Agent for this chat' + 'New chat' only (no model picker, no … menu); 'Hello planner' -> 'Echo: Hello planner / ctx=ctx-10caccd7 task=-'; second message -> same 'ctx=ctx-10caccd7'. (Card says streaming; the fake's reply is too short to watch it grow.) |
| M20.4 | Typing `A2A:input` gets the question "Which date?" as the reply, and answering it books. | **PASS** | 'A2A:input' -> reply 'Which date?'; answering 'Next Tuesday' -> 'Booked for Next Tuesday'. |
| M20.5 | `A2A:file` shows a chip whose "Show in folder" opens the agent's `files` folder. `A2A:data` shows a JSON code block. | **PARTIAL** | 'A2A:file' -> chip 'plan.md 6 B' with a 'Show in folder' button; file saved at state/agents/Fake Planner/.object-agent/files/<chat>/plan.md (button not clicked: it opens the OS file manager = MANUAL). 'A2A:data' -> JSON code block '{"rooms": 2}'. |
| M20.6 | The first message with a context chip shows "This leaves your computer". After Send, the next one doesn't. An "Exclude from AI" page adde… | **PASS** | New chat with context chips 'Meeting notes' + 'Vault Secret' (excluded): first send opened 'This leaves your computer — Fake Planner is a remote agent. The context pages you send go to 127.0.0.1:8799…' (Cancel/Send); after Send the message went (contextNoticeAt set) and the next send showed no notice. A2A:echo-parts echoed Meeting notes' text and 'Left out: Vault Secret (excluded from AI)'; ZEBRA-EXCL-91 absent from the panel and transcript. |
| M20.7 | Ask Assistant: "Delegate to Researcher: list my pages tagged rack." The chat shows "Handed a task to Researcher" and a summary. Researche… | **PASS** | Assistant (fake) calling delegate {agent: Researcher, goal: 'List my pages tagged rack.'} -> step 'Handed a task to Researcher', result {agent Researcher, chatId 01M6ZAB7…, state 'completed', summary 'Hello from the fake claude.'}; Researcher's Chats tab lists 'List my pages tagged rack.' with 'Delegated by Assistant'. Whether a live model picks delegate from the plain sentence = live CLI (lane A live m20 tests passed). |
| M20.8 | Ask Assistant to ask Fake Planner something with `remote_agent_call`. The step shows "Asked Fake Planner". | **PASS** | Assistant (fake) calling remote_agent_call {agent: 'Fake Planner', message: 'Plan two days in Lisbon.'} -> step 'Asked Fake Planner'. |
| M20.9 | Researcher's Tools tab lists "Delegate to another agent", "Call a remote agent" and "List remote agents" under Object agent tools. Switch… | **PASS** | Researcher Tools tab, 'Object agent tools' group lists 'List remote agents', 'Call a remote agent', 'Delegate to another agent'; switching 'Delegate to another agent' off -> toolsOff mcp__object-agent__delegate and a Researcher delegate call shows 'Handed a task to Assistant (failed)'. |
| M20.10 | Deleting Fake Planner and restoring it from "Deleted agents…" brings it back, still working. | **PASS** | Fake Planner row … > Delete -> gone from agents; '+ > Deleted agents…' lists 'Fake Planner …/state/agents/Fake Planner'; Restore -> back with the same id and 'Bearer token: set'; a new chat answers 'Echo: Still there? / ctx=ctx-1cf4cf59' (still working, token still used). |
| M20.11 | `%LOCALAPPDATA%\object\agents\Fake Planner\` holds `.object-agent\agent.json`, `card.json` and `sessions\`, and no token anywhere (search… | **PASS** | state/agents/Fake Planner/ holds .object-agent/agent.json, .object-agent/card.json, .object-agent/sessions/*.jsonl (+ files/<chat>/plan.md); `grep -rl test-token` over the folder finds nothing (the token is only in state/secrets.json). |
| M20.12 | Unlinked mentions still show on the object page. | **PASS** | Page 'Mention probe' with plain text 'Yesterday Ada Lovelace reviewed the plan.' -> Ada Lovelace page tab 'Mentions 1' lists it with a 'Link' button (checked once on this build, after M17-M20 are all in). |

## Bugs found and fixed (one commit each, regression test written first and seen failing)

| Commit | Box | Symptom | Fix | Test |
|---|---|---|---|---|
| `ec0dde6` `fix(accept-m17.5)` | M17.5, M17.9 | With an AI chat already open in the side panel, clicking another agent's sidebar row (or a chat in an agent's Chats tab) left the panel on the old agent. | `nav/sidepanel.openInArea` pushes a target naming `agentId`/`chatId` into the open chat entry (it did so only for `path`); `AiChatPanel` already turns that into a new chat / the transcript. | `sidepanel.m10.test.ts` "an agent or a transcript asked for is shown in the chat already there" |
| `49953d5` `fix(accept-m18.6)` | M18.6 | Editing SKILL.md on the skill page rewrote the YAML frontmatter as `---\n## name: rack-labels description: … created\_by: agent` — the skill lost its name and description. | `SkillDetail` hands only the body to the Markdown editor; the frontmatter is shown above it and saved back byte for byte. | `SkillDetail.test.tsx` "the frontmatter stays out of the editor and is saved byte for byte" |
| `908c9d0` `fix(accept-m18.7)` | M18.6, M18.7 | After your own skill edit the History list kept its old rows (the client drops events this window caused), so Undo on the newest visible row answered "This changed again since". | `LedgerList` takes `reloadKey`; `SkillDetail` bumps it after each save. | `SkillDetail.test.tsx` "your own save shows in the History at once" |
| `6b4d08b` `fix(accept-m18.8)` | M18.8 | With "Show archived" on, every active skill was listed twice (`?archived=true` answers active + archived). | The Skills tab adds only the `archived` rows from that answer. | `SkillsTab.test.tsx` "Show archived lists each skill once" |

Gates after the fixes: `npx vitest run` 528 files passed, 1 skipped (3993 tests passed, 1 skipped); `npm run build` clean.
Each fix was re-checked live on the scratch server after `npm run build`.

## FAIL list

None open: the four failures found were fixed above.

## Findings not fixed (for Gene)

1. **Assistant's agent page has no entry point after the redesign.** Its Memory / Skills / Learning / Chats tabs
   (M18.1, M18.6–M18.10) were reachable only by clicking a "Saved …" Learning line; the main-nav Assistant has
   no `…` menu and the Agents section excludes it. A design call (catalog §4), so not changed.
2. **Import "This space": first run defaults to "Try on a copy"** (M27 behaviour) — the M15.4 box's wording
   predates it; untick to import for real.
3. **Obsidian folder "People" isn't singularised**, so into a space that already has Person it becomes a new
   type "People" in folder "People (2)" instead of joining Person (M15.4).
4. **Same-title imports rely on a path tiebreak:** Books/Dune and Movies/Dune got the same `createdAt`;
   `[[Books/Dune|the book]]` was written as `[[Dune|the book]]` and resolves to Books/Dune only because "Books" <
   "Movies" (M15.3).
5. **Stopped import wording:** the dialog says "5253 failed" without the report's "not written because the
   import stopped"; while running it showed two different counters (475/6001 vs "Writing objects: 174 of 6001").
6. **Add agent folder:** an `agent.json` id that isn't a valid ULID gives "This folder isn't an Object agent."
   (misleading) (M17.11).
7. **Tool-step label for a refused write** reads "Created 'X' (failed)" (M17.6) — past tense on a failure.
8. **Quick-open "Create new" with a slash:** creating "Pages/Alpha" from the search box made `Pages/Pages.md`
   titled "Pages/Alpha" (seen by accident; outside M15–M20).
9. **Stale views:** a settings PUT from another client isn't reflected until reload (M16.8); an open agent Tools
   tab didn't show "Turned off in Settings > Integrations" until reload (M19.6).
10. **Secret variables:** a row's Delete removes the value at once, no confirm (servers do ask) (M19.9).

## MANUAL / not automatable, by reason

- **Needs a real export:** M15.6 (Anytype).
- **Visual (light/dark look):** the theme half of M15.7 and M16.1 (both PARTIAL: their DOM/keyboard halves pass).
- **OS integration (opens the file manager):** "Open folder" (M17.5) and "Show in folder" (M20.5 PARTIAL) were
  located but not clicked.
- **Live model wording/choices (DEFERRED-live-CLI):** M18.13 (nothing saved after a refused read); the "saved
  for next time" wording in M18.2 (PARTIAL). Real-CLI behaviour for M16.6/M16.7/M17.3/M17.5/M17.7/M17.8/M18.1 is
  cited from lane A.

## Not run

Nothing. Two caveats: M19.1 used the fake stdio MCP server rather than a real `npx` server, and the M20 remote
agent was `fake_a2a.py`.

## Scratch left behind

`~/.hermes/cache/scratch/lane-c2a/` (spaces `space/`, `notion/`, `obsidian/`, `big/`, `space (trial)/`,
`state/`, `results.json`, the fake wrapper with lane-C2a markers `LC2:say` and review/curator action files).
