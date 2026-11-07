# Milestone 11 acceptance: local API and MCP server

Status (2026-11-07): built, reviewed and gated (Linux and, after the merge, Windows, 2026-11-05); merged to `master`. Gene's 4 hand-checks below are unticked.

Plan: `2026-11-04-notion-anytype-features-plan.md`, M11 (built first, before M10, Gene's order of 2026-11-04). Date: 2026-11-05. Built on a Linux cloud container, not on Gene's Windows PC, on branch `feat/m11-local-api-mcp` off `master` at `c72567f`.

## What was built

- **Tokens** (`backend/objectapp/tokens.py`): per space folder, named, `read` or `read-write`, revocable. Only a SHA-256 of each secret is stored, in `api-tokens.json` in the per-user state dir, never in the space. The secret (`obj_` + 32 random bytes) is shown once.
- **Local API** (`backend/objectapp/api_v1.py`, mounted at `/api/v1`, Bearer token): `whoami`, `schema`, `search`, `query` (filter-group JSON, sort, paging), `queries/{id}/run`, `object/peek`, `object` (whole body or one heading's section), `object/backlinks`, `daily-note`, `changes`; writes `objects` (create, optional body), `object/properties` (set, add to a list, remove), `object/section` (append or replace), `object/rename`, `object/trash`. Writes go through the same `Space` methods as the app, so version checks (409 `currentVersion`), only-changed-lines, the trash and version history hold. Each write announces its change event with origin `api:<token name>` and is added to `api-activity.jsonl` (state dir), which `changes` returns.
- **Exclude from AI**: an object with the tag "Exclude from AI" or `excludeFromAI: true` is left out of every answer, and a path naming it answers 404. Templates are hidden too.
- **Server-side filters** (`backend/objectapp/apiquery.py`): the text, number, checkbox, list and date operators of `frontend/src/views/filter.ts`, with relative dates (today, yesterday, tomorrow, one week ago or from now, this week, month, year, overdue). Unknown operators pass and are listed in `unsupported`, the app's own rule.
- **MCP server** (`backend/objectapp/mcp_server.py`, console script `objectapp-mcp`): stdio, a thin client of `/api/v1` with `httpx` (it never opens the space). Read tools: `schema`, `search`, `query`, `run_saved_query`, `peek`, `read`, `backlinks`, `daily_note`, `changes_since`. Write tools (only for a `read-write` token, or never with `--read-only`): `create_object`, `create_task`, `set_properties`, `add_tags`, `add_to_collection`, `append_to_section`, `replace_section`, `rename`, `move_to_trash`. `OBJECT_API_URL` must be a loopback `http` address.
- **Settings > Integrations** (`frontend/src/settings/sections/Integrations.tsx`): token list (scope, last used), create (name, Read only or Read and write), the secret and a ready MCP config shown once with copy buttons, revoke with a second click to confirm, and the config template.

## Our choices (for Gene to check)

1. The token routes the window uses (`/api/integrations/tokens`) need no token; the app's local-only guard (loopback host, same-origin writes) protects them, as it does every other route.
2. "Edited by" in version history is not added: the change event's origin and the activity log carry who wrote what. Adding a field to history files would change their format.
3. `neighbours` from the plan is not a separate tool: `peek` returns outgoing links and `backlinks` the incoming ones.
4. `run_saved_query` applies the query's types, its structures' collections, the filter group and the first sort. Search terms, tag filters, excluded types and the in-no/any-collection rules are not applied yet and are listed in `unsupported`.
5. `create_object` with a `body` appends it after the template's body, if the type's template gives one.
6. A space without the Task type answers 404 to `create_task`; `create_object` works there.
7. The MCP server keeps the write tools when it can't reach the app at start-up, so starting the assistant before Object still works; each call then reports what the app says.

## Automated results

| Suite | Command | Result |
|---|---|---|
| Baseline before M11 | `uv run pytest backend/tests -q` at `c72567f` | 1603 passed, 1 skipped, 3 xpassed |
| Back end | `uv run pytest backend/tests -q` | see the PR description (M11 adds 31 tests: `test_m11_api.py`, `test_m11_mcp.py`) |
| Front end | `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run lint && npm run build` | vitest 2532 passed, 1 skipped; `tsc` clean; lint 0 errors (two new only-export-components warnings, the same pattern as every settings section); build ok |
| M11 acceptance | `uv run python scripts/m11_acceptance.py backend/tests/fixtures/<space>` | PASS on `space-sample`, `space-v1`, `space-m8`, `space-calendar`, `space-blocks` |

### `scripts/m11_acceptance.py`

A git-committed temp copy (committed again after one open, which migrates an old space), one Page marked "Exclude from AI", served with `create_app` on a free `127.0.0.1` port; then real stdio MCP sessions with `objectapp-mcp` as a child process, the way an MCP client starts it. Checks: no secret in any file of the space or the state dir; `/api/v1` refuses a missing token; a read token lists only the read tools and every read tool runs with `git status` clean afterwards; the excluded Page is absent from query, search and changes and reading it gives 404; a read-write session creates a task, appends under a heading, adds a tag (only the `tags` and `lastUpdated` lines change), is refused on a stale version with nothing changed, renames and trashes; the activity log lists the five writes under the token's name; a revoked token gets 401.

Not verified here: the Windows run, the app's own window (pywebview), and a live Claude Code or Claude Desktop session against the server (the acceptance script drives the same stdio protocol with the MCP SDK's own client).

## Hand-checks for Gene

- [ ] Settings > Integrations: create a Read only token, copy the MCP config, paste it into Claude Code's `.mcp.json`, and ask Claude Code to find something in the space.
- [ ] Create a Read and write token and ask the assistant to add a line under a heading of a page; the page shows it at once, and version history has the old text.
- [ ] Tag a page "Exclude from AI"; the assistant can't find or read it.
- [ ] Revoke a token; the assistant's next call fails.
