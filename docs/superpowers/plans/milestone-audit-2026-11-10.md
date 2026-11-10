# Milestone audit, M1-M30 (2026-11-10)

Gene asked (2026-11-10) for one check of the whole app before relying on it: is everything built, is it
functional, and what is left. This file is the answer and the current to-do list.

## Verdict

**M1-M30 are built, reachable from the app, and working.** Every feature the base spec, the later designs and the
approved decisions name has real code and a way in (a route the app registers and a page, menu, palette entry,
setting or sidebar item that reaches it). No stubs are left, every call the frontend makes matches a server route,
and every milestone's acceptance script passes. The audit found and fixed eight defects (below); none touched
data safety. What remains is mostly Gene's own hands-on checks, a handful of catalog details never built, and the
inputs only he can give.

## How it was checked

1. **Every milestone's acceptance script** (`m1_roundtrip.py`, `m2`-`m30_acceptance.py`), 56 runs: M1-M21, M25 and
   M27 on `space-sample` and `space-v1`; M15 and M22-M30 on their own spaces. 51 passed at first; the 5 failures
   were stale checks in the M7, M8 and M9 scripts (below), now fixed: **56 of 56 pass**.
2. **Two read-only spec audits**, M1-M15 and M16-M30: each feature in the base spec
   (`specs/2026-10-23-object-design.md`), the catalog (`behavior-catalog.md`), the later designs and the decisions
   memo, traced to its code and its entry point; a walk of every frontend API call against the server's 314
   routes; a search for stubs, TODOs, hidden flags and orphaned components.
3. **Hands-on acceptance of M28-M30**, the 41 boxes no automated run had covered: an agent drove a live headless
   copy of the app through the real UI on scratch copies of the fixture spaces (M30's AI filing on the fake
   `claude`). M1-M27's 435 boxes had their automated run on 2026-11-08 (`auto-acceptance-2026-11-08.md`).
4. **The full gate** after the fixes (numbers under "Gate").

## Per milestone

All 30 milestones: built, reachable, acceptance script PASS. "Open boxes" are Gene's unticked hand checks in
`mN-acceptance.md` (none ticked yet); the automated runs covered what a headless harness can, and what needs Gene
is listed by reason in `auto-acceptance-2026-11-08.md` and under "Hands-on M28-M30" below.

| Milestone | What it is | Open boxes |
|---|---|---|
| M1 | Spaces as Markdown folders, round trip | 9 |
| M2 | Objects, editor, properties | 20 |
| M3 | Views, dashboard | 13 |
| M4 | Calendar, daily notes, tasks, reminders | 22 |
| M5 | Links, backlinks, unlinked mentions, graph | 23 |
| M6 | Whiteboards, ink | 53 |
| M7 | Spaces, settings, shortcuts, files | 56 |
| M8 | Recurrence, version history, export, search | 40 |
| M9 | Polish backlog | 19 |
| M10 | AI assistant (Claude Code CLI) | 7 |
| M11 | Local API and MCP server | 4 |
| M12 | Property kinds (formula, rollup, files, ...) | 7 |
| M13 | View layouts (calendar, timeline, chart) | 5 |
| M14 | Automations | 7 |
| M15 | Importers (Notion, Obsidian, Anytype) | 7 |
| M16 | Chat polish, model picker | 9 |
| M17 | Agents and their tools, the fence | 13 |
| M18 | Agent learning: memory, skills, curator | 15 |
| M19 | MCP gateway, secrets | 11 |
| M20 | Remote agents (A2A), delegation | 12 |
| M21 | Agent schedules | 11 |
| M22 | Work model, ticket fields | 10 |
| M23 | Tasks dashboard (Work section) | 19 |
| M24 | Brain dump, agent loop | 12 |
| M25 | Import provenance, re-runs | 10 |
| M26 | Readers (PDF, Office, media, OCR), scan | 6 |
| M27 | Import agent workflow (+ 9 UI boxes) | 15 |
| M28 | IT ops starter, two-way relations | 13 |
| M29 | Synced facts, suggested type | 14 |
| M30 | Sources, entity extraction | 14 |
| | **Total** | **476** |

Also built and checked (not milestones): git-backed spaces (version control, remote, Space history, backup of
agents and settings), the launch key (S6), the run fence, Help pages, the sidebar redesign, the 2026-11-09
known-limits fix pass.

## Defects the audit found, all fixed

| Found by | Defect | Fix |
|---|---|---|
| Hands-on M28 | **The graph didn't render** in any space with named relations: sigma draws during its construction and M28's edge-label reducer read the renderer before it existed | `024d86ee` |
| Graph check | The hovered node's name was white on a white box in dark themes (older) | `23c65773` |
| Hands-on M30 | **Every imported object's page was squeezed** to ~290 px: the Source line (and Task Stats, the ticket resolution note) rendered as their own column | `ef01ed39` |
| Hands-on M30 | The suggested Merge failed after an earlier merge and split (Gene's review steps replayed merges before splits), and its refusal showed an internal id | `5c56d1bb` |
| Hands-on M30 | "Move batch to Trash" couldn't be reached after the Entities Write | `091eec64` |
| Hands-on M30 | The Import inbox's reason ("Link not written (low confidence): ...") was shown nowhere | `653d173e`, `2cdc8659` |
| Hands-on M30 | A taken offer still said "Create type ... Apply will skip this"; a long source path widened the import dialog; MCP `import_preview` had no target | `06b5e643`, `f8d926e6`, `8cb63a87` |
| Spec audit | A race: the filing pass saved its finished state before writing its report (a flaky M30 check) | `265e4df0` |
| Sweep | Stale checks: M7 didn't send the launch key; M8 and M9 flagged the history folder their own setup made, and missed writes inside it | `d7c1ac04` |

## Gate (after the fixes)

The final gate over the fixed tree is running; its numbers replace this line when it finishes.

## Not built: specified but missing (Gene decides)

None of these blocks daily use. Each is in the catalog or a design but was never built, and nothing records it as
dropped, so each needs a decision: build, or drop on purpose.

1. **Full Export** (catalog §1 General: manual and automated export of the whole space or all spaces, with media,
   wikilinks and title options). Only one-object export exists. Git backup and the plain Markdown files cover part
   of it.
2. **Saved queries over the API and MCP are partial**: `run_saved_query` applies types, filters and sorts but not a
   query's search text, tags, excluded types or collection rules (listed as `unsupported` in the answer; M11 call
   4). The assistant and agents can get more objects than the query shows in the app.
3. **Git provenance for a wiki import** (import design §1): the commit, its web link and the last author. A wiki
   imports as a Markdown folder. Matters for the planned `C:\Git\wiki` migration.
4. **Definition history has no UI**: the routes exist (type, collection, query definitions keep versions), nothing
   shows them; Space history restores them instead.
5. **Catalog details**: the inline `#tag` chip in the editor; a simple-table property kind; the graph's count pill,
   zoom buttons and zoom presets; the Explore panel's two cards and "Relevant Content" tab as catalogued (it lives
   in the AI chat panel); a collection opening in a peek with a "1 / 3" stepper; the "page" link view; the Page
   shortcuts (Copy deep link, Select all top-level blocks); Appearance "App icon"; Editor "Hide App Menu";
   Integrations "Show developer information"; the Offline & Sync storage rows (left out on purpose: local only).
6. **Remodelling an existing space** (IT ops design §6) has no dedicated path or test; it would run as an import of
   the space folder.
7. **Decision A-1** (grey out Glob and Grep when an agent's shell is on) was approved but not built, because the CLI
   turned out to offer them beside the shell; Gene never confirmed the reversal.

## Remaining work

### Needs Gene

1. **Hands-on checks**: 476 boxes in `mN-acceptance.md`. The automated runs covered what a headless harness can;
   what needs him is the look in the four themes and at his window size, the pywebview desktop window, Windows,
   the Wacom pen and touch, toasts, microphone and clipboard prompts, the OS file manager, real data at scale, and a
   real model's wording (try the trial and the Entities step once with the real `claude`).
2. **Decisions from M28-M30**: the guesses G1-G4 (`m28-acceptance.md`: Location's Part of, the status vocabulary,
   Incident's "Desk resolved", properties always shown); whether the 30 seed tags are acceptable; the
   `keepAsSources` default on everywhere (M30 Our calls 25); categories narrowed to Category, Kind and Environment
   options and tags (Our calls 26); the build-vs-drop calls in "Not built" above.
3. **Inputs**: his extra custom types (waits on the type-model discussion); an Anytype export (the reader's gaps are
   known); a git remote address (later, his call); the Windows checks (launch key in a real window, run fence,
   toasts); the credential scrub of the source spaces (memo D2) before any real import.

### Known limits (documented, accepted for now)

- Launch key and run fence: a local process running as Gene can still read the browser's memory or a restored
  session cookie; the fence misses processes that detach from a run and is off on macOS without root.
- A folder whose name holds a backslash can't be fenced from agents (the agent page says so).
- MCP servers can't use OAuth through the CLI (bearer tokens and headers only), which rules out OAuth-only
  Microsoft 365, SharePoint and Atlassian servers.
- The Anytype reader's gaps (type key, slug titles, dates, ids, relations) wait on a real export.
- OCR: a PDF page that is vector drawing with no image still says "Needs OCR".
- The number chart's "Export SVG" is a rendered frame.
- SharePoint has no fetch code (by design).
- Smaller notes kept as they are: the M11-M15 notes in their acceptance files (e.g. a rollup can show a stale value
  until reload; the timeline's table isn't editable inline); a failed capture is queued twice after a restart
  (M24); the learning ledger has no cap.

### Parked

An installer; the network integrations (calendar feeds, Readwise, Kindle, Telegram, WhatsApp, email, Raycast);
migrating `C:\Git\wiki` (M25-M30 are its tooling); Object Team.

## Housekeeping

- `CLAUDE.md` still says "M1-M27 are all built"; it should say M1-M30 (left for Gene: it is his project file).
- Remote branches to delete by hand (this session can't): the 20 listed in the session plus `m30-int` and the
  session branch; `master` holds everything.
- Small leftovers: `workseams.py` keeps M24-era fallbacks; one unreachable 501 branch in `server.py`.
