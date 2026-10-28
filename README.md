# Object

A local, Markdown-backed recreation of [Object](https://object.io): the same UI and object model, stored as a folder of plain `.md` files on your own disk, with no cloud.

- **Objects and types:** every property kind, templates, tags as objects, trash.
- **Views:** list, grid, wall, table, kanban, gallery and embed, with filters, sorts and group-by; collections and saved queries.
- **Calendar and tasks:** daily notes, a calendar (day, three days, week, month), and tasks with recurrence and local reminders.
- **Search and links:** full-text search and the Ctrl+K palette, backlinks and references, global and local graph.
- **Whiteboards:** with pressure-sensitive pen ink.
- **Editor:** a block editor that writes plain Markdown and never rewrites what you didn't edit; light and dark themes; version history.

Opening a space never modifies its files, edits change only their own lines, and deletes go to a restorable trash.

## Run it

Requires Python 3.13+ with [uv](https://docs.astral.sh/uv/) and Node 22+.

```sh
uv sync
cd frontend && npm ci && npm run build && cd ..
uv run objectapp --space /path/to/space          # opens its own window
uv run objectapp --space /path/to/space --browser # or in your browser
```

The server listens on `127.0.0.1:8790` only.

## Develop

```sh
uv run pytest backend/tests -q
cd frontend && npx vitest run && npx tsc -b --noEmit && npm run build
uv run python scripts/m8_acceptance.py backend/tests/fixtures/space-sample
```

Rules for contributors (human or agent) are in `CLAUDE.md`. Status is in `docs/superpowers/plans/remaining-work.md`. To pick the work up, read `HANDOFF.md`.

Object is a trademark of its owners. Object is an independent, local-only reimplementation, and its application code is written from scratch. `reference/` holds a trimmed copy of Object's English strings, CSS and design notes. It is used only to match labels, values and behaviour, and none of its code is shipped. Keep this repository private.
