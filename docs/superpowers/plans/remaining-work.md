# Object: remaining work

Status as of 2026-10-28 (evening, Gene's Windows PC). **All eight milestones are built, reviewed, fixed and gated, the audit bugs are fixed, and the guessed values now follow the full Capacities reference.** What remains:
1. **M9, the completeness gaps:** Gene approved all of them; the plan is `2026-10-28-m9-completeness-gaps.md` (with Gene's answers). **On hold: don't start it until Gene says so.**
2. Gene's hands-on checking (M1–M8 acceptance docs), including whether Capacities' Standard design shows properties in a sidebar or inline (`reference-check-2026-10-28.md` §5), and the fixes it produces.

**Done on 2026-10-28, on Windows:**
- **Audit bugs:** all ~65 in `audit-2026-10-28.md`, plus every "unconfirmed" item that proved real, fixed one per commit with a failing-first test, in six area branches merged into master (whiteboard, backend API, views and properties, shell, backend storage, editor).
- **Guessed values:** checked against the full `.reference/` (`reference-check-2026-10-28.md`) and applied in four merged branches: keyboard shortcuts (one registry in `lib/shortcuts.ts`), side panel, breadcrumbs, pinned tabs, the 768 px breakpoint, dashboard default sections, Tasks tab order, slash and block menus, highlight and formula formats, search highlight colours and graph limits.
- **Windows-only failures** from the baseline are fixed (non-portable tests, the M5 acceptance cache check, an icon first-render flicker).
- **Gate:** pytest 1202 passed; vitest 1829 passed; `tsc` clean; build ok; `m1_roundtrip.py` and `m2`–`m8_acceptance.py` PASS on `space-sample` and `space-v1`.

Spec: `docs/superpowers/specs/2026-10-23-object-design.md`. How to resume: `HANDOFF.md`, `CONTINUE.md`. Rules: `CLAUDE.md`. Process: `docs/superpowers/build-process.md`.

Capacities reference: `reference/` in the repo, a trimmed subset:
- models: `recovered-ts/src/shared-logic/models/`
- English UI strings: `app-unpacked/dist/virtual_intlify-i18n-0366822.js`
- CSS: `app-unpacked/dist/index36682.css`

On Gene's machine the full unpacked app is in the git-ignored `.reference/`.

## Done

Each milestone's plan holds its full scope. Each acceptance doc holds its automated results, its "our choice" list and Gene's unchecked hand-checks.

| Milestone | Plan | Built, reviewed, gated | Hand-checks |
|---|---|---|---|
| **M1** shell, objects on disk, block editor | `2026-10-23-m1-shell-objects-editor.md` | 2026-10-23 | `m1-acceptance.md` (9) |
| **M2** object types and all property kinds | `2026-10-23-m2-types-properties.md` | `32c7fe2..39432ce` | `m2-acceptance.md` (20) |
| **M3** views, collections, queries, pinned, All notes | `2026-10-26-m3-views-collections-queries.md` | `a89c8cb..925b023`, gate 2026-10-26 | `m3-acceptance.md` (13) |
| **M4** calendar, daily notes, tasks (recurrence, reminders), Tasks page | `2026-10-26-m4-calendar-daily-tasks.md` | `c771907..4fc0b85`, gate 2026-10-27 | `m4-acceptance.md` (22) |
| **M5** SQLite FTS5 search, Ctrl+K palette, backlinks and references, global and local graph | `2026-10-26-m5-search-palette-backlinks-graph.md` | `bb9c57b..5193e60`, gate 2026-10-27 (built alongside M6) | `m5-acceptance.md` (23) |
| **M6** whiteboards: shapes, frames, connectors, gates, pressure ink | `2026-10-26-m6-whiteboards-pen.md` | `ebcdcc8..c4a087c`, same gate | `m6-acceptance.md` (53, incl. Wacom) |
| **M7** remaining blocks, light mode, settings, spaces, tabs, side panel | `2026-10-26-m7-blocks-lightmode-polish.md` | `f98e401..338a42f`, gate 2026-10-27; known-issue fixes `fc0bff2..96af06e` | `m7-acceptance.md` (57, incl. the side-by-side pass) |
| **M8** every feature M4–M7 deferred, local only (31 tasks) | `2026-10-27-m8-deferred-features.md` | `61b6fed..0e7c748`, gate 2026-10-28; review-minor fixes `1721a4b..9383a9b` | `m8-acceptance.md` (40) |

M8's "Coverage" section maps every deferred item to a task, or to a spec §2 exclusion: AI, network at runtime, accounts and sharing, mobile, telemetry.

## Latest verification (2026-10-28, at `9383a9b`, Linux)

| Check | Result |
|---|---|
| `uv run pytest backend/tests -q` | 1122 passed, 1 skipped (needs a non-root user) |
| `cd frontend && npx vitest run` | 1678 passed in 279 files, 1 skipped (needs `OBJECT_ROUNDTRIP_SPACE`) |
| `npx tsc -b --noEmit` / `npm run build` | clean / built |
| `scripts/m1_roundtrip.py` on a copy of `space-sample` and of `space-v1` | PASS |
| `scripts/m2_acceptance.py` … `m8_acceptance.py` on `space-sample` and `space-v1` | all PASS (m2 52/52 and 50/50, m3 14/14, m4 24/24, m5 18/18, m6 19/19, m7 23/23, m8 26/26) |
| The app (`uv run objectapp --browser`) driven in headless Chromium | home, Calendar, Tasks, Graph, Ctrl+K, an object page and a new whiteboard render with 0 console errors |

The synthetic fixture spaces are `space-sample`, `space-v1`, `space-calendar`, `space-links`, `space-whiteboard`, `space-blocks` and `space-m8`.

## What is left

0. **Fix the audit list.**
   - The list is `audit-2026-10-28.md`. Start with its "Fix first" section, items 1–17: security, data loss and breakage.
   - One finding per commit, each with a regression test. The repro scripts are in `scripts/audit-2026-10-28/`.
   - Gene decides which completeness gaps are in scope. The M8 Coverage table missed the M2/M3 deferrals, and the audit lists them.
1. **Gene's hands-on checks, M1–M8:** 237 unchecked items. Run them on a copy of the CPI export kept outside the repo, with `git init` there: `npm run build` in `frontend/`, then `uv run objectapp --space <copy>`. These can only be checked on his Windows machine:
   - the pywebview window
   - Windows toast reminders
   - Wacom pressure and tilt
   - microphone and clipboard permissions
   - a type page with 1,000+ real objects
   - the side-by-side look against Capacities in Light, Light Dimmed, Dark and Dark Dimmed
2. **Guessed values to confirm or correct** (the trimmed reference lacks them):
   - the shortcut keys (`frontend/src/lib/shortcuts.ts`, listed in Settings → Shortcuts)
   - the side-panel area layout, breadcrumbs and pinned tabs
   - the slash and block menu looks
   - the search highlight colour and the graph limits
   - the 480/850 px layout switch points
   - the M8 file formats (block ids and references, inline colours, date tokens, indent and list-item annotations, table formulas, collection and query embeds)
   - M3's default dashboard section tabs (`inNoCollection`/`notTagged`), which need the RootEntity file from the full `.reference/`
3. **Check the CPI export for a Task type with no Done-category status option.** Inferred status sets, as in the sample spaces, have none, so those tasks can't be completed until one is added in type settings (M4 finding).
4. **Fix what the hand-checks find.** One finding per commit, each with a regression test, then the full gate.
5. **Deferred by Gene:** TODO handling in the editor. Logseq-style markers were considered and rejected on 2026-10-26.
6. **Later:**
   - an installer (spec §6: "an installer comes later")
   - the in-app Claude Code agent (spec §2)
   - migrating `C:\Git\wiki` into Object's format (a separate project)
   - **Object Team (next version, parked):** a team server, offline desktop sync with merge, user spaces and an MCP agent layer modelled on KiwiFS. Approved 2026-10-28 but not to be started until Gene expands to the team. Spec: `docs/superpowers/specs/2026-10-28-object-team-design.md`; KiwiFS evaluation: `docs/kiwifs-evaluation.md`.

## How we build

- **Plan:** each piece of work gets one plan: a writer, then critics and one resolve pass. Gene cut the critics from M5 on to save time.
- **Build:** one workflow builds it in lanes with disjoint files. Each task commits with its own tests.
- **Finish:** one review, one fix pass, then the gate and a push. No per-task reviews (Gene, 2026-10-26).
- **Gene's checks:** he checks each milestone hands-on. On 2026-10-26 he asked for all milestones to be built first, so his checks of M1–M8 come together.
- **Lessons:** see `build-process.md`: parallel planning, two milestones at once, dependencies up front, the 4-CPU agent cap, resuming after limits.

## Out of scope (by design)

Accounts, login, billing, sync, sharing/publishing, mobile, integrations (Readwise, Kindle, calendar feeds, messaging), AI features (a Claude Code agent comes later), telemetry, importing Capacities data, migrating `C:\Git\wiki` (a separate later project). Accounts, sync, sharing and agent features return in the parked Object Team spec, not in this version.
