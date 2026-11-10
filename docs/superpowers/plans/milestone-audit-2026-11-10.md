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

Linux, at the tree with every fix above, suites run one after the other:

| Check | Result |
|---|---|
| Back end | 3827 passed, 19 skipped, 0 failed apart from `test_task_stats_fast` (a 0.35 s budget that fails only under the full suite's load; it passed alone 3 times out of 3) |
| Front end | 4275 passed, 1 skipped |
| `tsc`, lint, build | clean |
| Acceptance sweep | 56 of 56 PASS |

## Not built: specified but missing (Gene decides)

None of these blocks daily use. Each is in the catalog or a design but was never built, and nothing records it as
dropped, so each needs a decision: build, or drop on purpose.

**Update, 2026-11-10 (M31):** Gene decided every item the same day (the decisions are at the top of
`2026-11-10-m31-completion.md`) and M31 built them; `m31-acceptance.md` has the script's result and his hand checks.
What is left from this list: only `workseams.py`'s M24-era fallbacks (see Housekeeping) and the hand checks.

1. **Full Export**: **built in M31** (item 1, Gene's decision 6: manual and automated). Settings > Full Export:
   this space or All Spaces, the three options, a folder outside every space, "Export" and "Export All Spaces";
   Automated Full Exports daily or weekly. (Was: only one-object export existed.)
2. **Saved queries over the API and MCP**: **built in M31** (item 2): `run_saved_query` and `POST /api/v1/queries/{id}/run`
   apply every part of the query (search text, tags, excluded types, collection rules) and list what the app lists,
   in its order; nothing is `unsupported`. (Was: types, filters and sorts only; M11 call 4.)
3. **Git provenance for a wiki import**: **built in M31** (item 4): the commit, its web link (GitHub, GitLab,
   Bitbucket, Azure DevOps), the last commit's author and date, and uncommitted files flagged and listed in the report.
4. **Definition history UI**: **built in M31** (item 9): "Version History" for a type, a collection and a saved
   query, with restore. Views keep versions but have no restore page.
5. **Catalog details**: **built in M31**: the inline `#tag` chip (item 10); the Table property kind (item 13); the
   graph's count pill, zoom buttons and zoom presets (item 8); the Explore panel's two cards and "Relevant Content"
   tab (item 6, Gene's decision 8); a collection opening in a peek with its "1 / 3" stepper (item 7, decision 8); the
   "page" link view (item 14); the page shortcuts (item 11); Appearance "App icon", Integrations "Show developer
   information" and "New API token", and the Offline & Sync local rows (item 15); Editor "Hide App Menu" (item 12).
   The interface Language list: **decided by Gene** (decision 7): English only; the list sets date and number formats
   (recorded in the catalog, not built).
6. **Remodelling an existing space**: **built in M31** (item 5): Settings > Import Content > "Remodel this space…"
   imports the open space's folder into a new space; the original is never changed. (Types with no objects are not
   carried over, since the import makes types from objects; see `m31-acceptance.md`.)
7. **Decision A-1**: **decided by Gene** (decision 5): superseded; Find files and Search in files stay ordinary
   switches beside the shell (recorded in the catalog and the decisions memo).

Also decided on 2026-11-10 and built in M31 (item 3): spaces never change behaviour (decision 1: the import's
conventions apply in every space; "IT operations" is only a starting set of types); G1, G2 and G4 kept; G3 an Incident
has one Resolved (decision 3); the 30 seed tags, "Keep pages as Sources" on everywhere and the narrowed categories
kept (decision 4).

## Remaining work

### Needs Gene

1. **Hands-on checks**: 476 boxes in `mN-acceptance.md`. The automated runs covered what a headless harness can;
   what needs him is the look in the four themes and at his window size, the pywebview desktop window, Windows,
   the Wacom pen and touch, toasts, microphone and clipboard prompts, the OS file manager, real data at scale, and a
   real model's wording (try the trial and the Entities step once with the real `claude`).
2. **Decisions from M28-M30**: all decided by Gene on 2026-11-10 (the M31 plan's decisions: G1, G2, G4 kept, G3 one
   Resolved on an Incident; the 30 seed tags, `keepAsSources` on everywhere and the narrowed categories kept; every
   "Not built" item built or decided, above). Nothing waits on him here but the hand checks.
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
- Small leftovers: `workseams.py` keeps M24-era fallbacks (still there after M31); the unreachable 501 branch in
  `server.py` was removed in M31.
