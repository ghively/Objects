# Object

"Object" is a local, Markdown-backed notes app with its own object model (types, properties, collections, queries, daily notes, tasks, whiteboards), stored as a folder of `.md` files, with no cloud. A space keeps its metadata in `.object/` and its rebuildable cache in `.object-cache/`. M1-M27 are all built and on `master` (2026-11-07). Read `HANDOFF.md` (where things stand and what to do first), then `CONTINUE.md` (how to resume work); the detailed status page is `docs/superpowers/plans/remaining-work.md`.

## Ground rules (set by Gene Hively, the owner)

- **Fidelity to the behaviour catalog and design spec is the bar.** Match their labels, options, behaviour and values. Don't over-engineer, don't invent schema, keep questions few.
- **Object's own model (the design spec) defines the data model**, not any other project's conventions. Don't design around `C:\Git\wiki`; it gets migrated into Object's format later as a separate project.
- **Never touch `C:\Git\wiki`.**
- **No real CPI data in the repo.** Fixtures are synthetic. Gene tests against a copy of a work export kept outside the repo.
- **Review once, at the end.** No per-task review loops in build workflows: build every task with its own TDD tests, then one whole-milestone review (correctness, file safety, fidelity), one fix pass, then the final test gate.
- **Gene checks each milestone hands-on** before the next one's results are relied on.
- **Parallelize by file ownership.** See `docs/superpowers/build-process.md`.
- Never write on read: opening a space must not modify `.md` files. Property edits change only their own lines. Deletes go to the trash and are restorable. Preserve CRLF/BOM and write atomically.
- **Every feature is unlocked, nothing is gated** (Gene, 2026-11-02; the spec already says "Every feature is simply available"): Tasks, Queries, version history, extended search, focus mode, unlinked mentions and the rest are plain features. No paid-tier badge, upsell, blurred preview or limit anywhere. **AI is in scope** (M10, run through the Claude Code CLI; plan `docs/superpowers/plans/2026-11-02-m10-ai-assistant.md`). Integrations (calendar feeds, Readwise, Kindle, Telegram, WhatsApp, email, Raycast, the API) are wanted later at lower priority. Out for good: accounts, sync, sharing, mobile, telemetry.
- **Unlinked mentions stay**: never remove or hide them, and test any change near references, the object page or search.
- Commits end with a `Co-Authored-By:` trailer for the model that made them (for example `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`), plus the `Claude-Session:` trailer when the session's attribution instructions give one. Commit only your own files, by explicit path.

## Stack and commands

Backend: Python, run with `uv` (`uv run pytest backend/tests -q`). Frontend: TypeScript, React, Vite, shadcn/ui and Tailwind, in `frontend/` (`npx vitest run`, `npx tsc -b --noEmit`, `npm run build`). The server binds 127.0.0.1 only. Acceptance scripts: `scripts/m1_roundtrip.py`, `scripts/m2_acceptance.py`, and each later milestone's `scripts/mN_acceptance.py` (M3 to M27; the exact command is in each `mN-acceptance.md`), always run on a copy of a fixture space. Agent features run through the `claude` CLI; tests use the fake one (`backend/tests/fake_claude.py`). `objectapp-mcp` is the MCP server (README).

## Where things are

- Spec: `docs/superpowers/specs/2026-10-23-object-design.md`; later designs in the same folder: agents (`2026-11-05-agents-design.md`, M16-M21), the work dashboard (`2026-11-05-work-dashboard-design.md`, M22-M24), import and migration (`2026-11-06-import-migration-design.md`, M25-M27); `2026-10-28-object-team-design.md` is parked (not built)
- Where things stand: `HANDOFF.md`, then `CONTINUE.md`
- Plans, acceptance checklists and status: `docs/superpowers/plans/` (`remaining-work.md` is the status page; M1-M27 are built and on `master`; each has `mN-acceptance.md` with Gene's unticked hand-checks)
- How milestones are built: `docs/superpowers/build-process.md`; the build workflow scripts: `scripts/workflows/` (see `CONTINUE.md` for which is which)
- How Object behaves (labels, menus, shortcuts, order): `docs/behavior-catalog.md`; the 2026-11-02 differences and backlog: `docs/superpowers/plans/polish-audit-2026-11-02.md`
