# Object

A local, Markdown-backed notes app with its own object model, stored as a folder of plain `.md` files on your own disk, with no cloud.

- **Objects and types:** every property kind, templates, tags as objects, trash.
- **Views:** list, grid, wall, table, kanban, gallery and embed, with filters, sorts and group-by; collections and saved queries.
- **Calendar and tasks:** daily notes, a calendar (day, three days, week, month), and tasks with recurrence and local reminders.
- **Search and links:** full-text search and the Ctrl+K palette, backlinks and references, global and local graph.
- **Whiteboards:** with pressure-sensitive pen ink.
- **Editor:** a block editor that writes plain Markdown and never rewrites what you didn't edit; light and dark themes; version history.
- **Computed properties, more layouts, automations:** Formula, Rollup, ID, Email, Phone and Files properties; calendar, timeline and chart layouts; local rules (create, property change, schedule and button triggers).
- **AI and agents (run through your own `claude` CLI):** a chat panel with a model picker, agents that are Claude Code project folders (memory, self-written skills, an MCP gateway, A2A remote agents, delegation, schedules), and the local API and MCP server below. Nothing is written without your say, and "Exclude from AI" objects are never sent.
- **Work section:** a ticket dashboard built on Tasks and Projects (Now, Flow, Projects map, queues, Alerts and more), a brain-dump bar that saves Captures, and a Work agent that files them.
- **Import and migration:** import a Notion, Obsidian or Anytype export, a Markdown folder or a Files folder (Word, PDF, Excel, PowerPoint, HTML, images) into a new space, this space or a trial copy; every imported object keeps a Source line (open the original, show the kept file); re-runs update instead of duplicating; a local sensitive-content scan runs first; an agent can propose a schema, which only you approve, then file the pages.

Opening a space never modifies its files, edits change only their own lines, and deletes go to a restorable trash. A space keeps its metadata in `.object/` and its search cache in `.object-cache/`; spaces made before 2026-11-04 are migrated to these folders automatically on open.

## Run it

Requires Python 3.13+ with [uv](https://docs.astral.sh/uv/) and Node 22+.

```sh
uv sync
cd frontend && npm ci && npm run build && cd ..
uv run objectapp --space /path/to/space          # opens its own window
uv run objectapp --space /path/to/space --browser # or in your browser
```

The server listens on `127.0.0.1:8790` only.

## Connect an AI assistant (MCP)

Object has a local API for programs on the same computer, and an MCP server on top of it, so an assistant such as Claude Code or Claude Desktop can search, query and read your notes, and (with a read-write token) make careful edits.

1. Start Object, then open Settings > Integrations and create a token. Pick "Read only" unless the assistant should change notes. The token is shown once.
2. Copy the MCP config shown there into your client (Claude Code: `.mcp.json`; Claude Desktop: `claude_desktop_config.json`). It runs:

```sh
OBJECT_API_TOKEN=obj_... uv run --directory /path/to/objects objectapp-mcp
```

Object must be running: the MCP server talks to it over `http://127.0.0.1:8790/api/v1` and never opens the space itself, so every edit keeps the app's rules (version checks, only the changed lines, the trash, version history). Tokens are stored as hashes in the app's state folder, never in the space. Objects with the tag "Exclude from AI" or the property `excludeFromAI: true` are invisible to every token. Writes made through a token are listed by `GET /api/v1/changes`. The routes are documented in `backend/objectapp/api_v1.py`.

## Develop

```sh
uv run pytest backend/tests -q
cd frontend && npx vitest run && npx tsc -b --noEmit && npm run build
uv run python scripts/m8_acceptance.py backend/tests/fixtures/space-sample
uv run python scripts/m11_acceptance.py backend/tests/fixtures/space-sample
```

Every milestone has an acceptance script (`scripts/m1_roundtrip.py`, `scripts/m2_acceptance.py` to `scripts/m27_acceptance.py`) that runs on a copy of a fixture space; the exact command is in each `docs/superpowers/plans/mN-acceptance.md`.

Rules for contributors (human or agent) are in `CLAUDE.md`. Status is in `docs/superpowers/plans/remaining-work.md`. To pick the work up, read `HANDOFF.md`.

Object's application code is written from scratch. Keep this repository private.
