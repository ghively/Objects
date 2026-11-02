# Object

"Object" is a local, Markdown-backed recreation of Object: the same UI and full object model, stored as a folder of `.md` files, with no cloud. Read `HANDOFF.md` (what to do first), then `CONTINUE.md` for status and how to resume work.

## Ground rules (set by Gene Hively, the owner)

- **Fidelity to Object is the bar.** Match its labels, options, behaviour and CSS values. Don't over-engineer, don't invent schema, keep questions few.
- **Object's own model defines the data model**, not any other project's conventions. Don't design around `C:\Git\wiki`; it gets migrated into Object's format later as a separate project.
- **Never touch `C:\Git\wiki`.**
- **No real CPI data in the repo.** Fixtures are synthetic. Gene tests against a copy of a work export kept outside the repo.
- **Review once, at the end.** No per-task review loops in build workflows: build every task with its own TDD tests, then one whole-milestone review (correctness, file safety, fidelity), one fix pass, then the final test gate.
- **Gene checks each milestone hands-on** before the next one's results are relied on.
- **Parallelize by file ownership.** See `docs/superpowers/build-process.md`.
- Never write on read: opening a space must not modify `.md` files. Property edits change only their own lines. Deletes go to the trash and are restorable. Preserve CRLF/BOM and write atomically.
- **Pro features are unlocked, nothing is gated** (Gene, 2026-11-02; the spec already says "Pro-only features are simply available"): Tasks, Queries, version history, extended search, focus mode, unlinked mentions and the rest are plain features. No Pro badge, upsell, blurred preview or limit anywhere. **AI is in scope** (M10, run through the Claude Code CLI; plan `docs/superpowers/plans/2026-11-02-m10-ai-assistant.md`). Integrations (calendar feeds, Readwise, Kindle, Telegram, WhatsApp, email, Raycast, the API) are wanted later at lower priority. Out for good: accounts, sync, sharing, mobile, telemetry.
- **Unlinked mentions stay**: never remove or hide them, and test any change near references, the object page or search.
- Commits end with a `Co-Authored-By:` trailer for the model that made them.

## Stack and commands

Backend: Python, run with `uv` (`uv run pytest backend/tests -q`). Frontend: TypeScript, React, Vite, shadcn/ui and Tailwind, in `frontend/` (`npx vitest run`, `npx tsc -b --noEmit`, `npm run build`). The server binds 127.0.0.1 only. Acceptance scripts: `scripts/m1_roundtrip.py`, `scripts/m2_acceptance.py`, and each later milestone's `scripts/mN_acceptance.py`, always run on a copy of a fixture space.

## Where things are

- Spec: `docs/superpowers/specs/2026-10-23-object-design.md`
- Plans, acceptance checklists and status: `docs/superpowers/plans/` (`remaining-work.md` is the status page; M1–M9 are built)
- How milestones are built: `docs/superpowers/build-process.md`; the build workflow scripts: `scripts/workflows/` (see `CONTINUE.md` for which is which)
- How Object actually behaves (read live, three spaces): `docs/object-behavior-catalog.md`; the 2026-11-02 differences and backlog: `docs/superpowers/plans/polish-audit-2026-11-02.md`
- Visual reference: `docs/`; design notes: `docs/design-notes`
- Object reference material (behaviour, labels, CSS values; never copy its code): `reference/` in this repo (a trimmed subset: models, English strings, CSS). On Gene's machine the full unpacked app is also in the git-ignored `.reference/`, and older plans and the build script's rules say `.reference/`; in a clone, read `reference/` instead.
