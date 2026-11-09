# Automated acceptance, M1-M27: consolidated report (2026-11-08)

One report over the five automated acceptance lanes of 2026-11-08. Agents drove Gene's hand-check boxes
(`mN-acceptance.md`, `m27-ui-acceptance.md`) against headless scratch servers on copies of the fixture spaces.
**No box in Gene's files is ticked**; this file and the per-lane reports are the evidence. Commit hashes are the
ones on `integrate/2026-11-08`.

## Per-lane reports and raw results

| Milestones | Lane | Report |
|---|---|---|
| M1-M3 | C1 | no report file; results in lane C1's scratch `results.json` (24 boxes recorded; the other 19 are classified here from their text, see "M1-M3 notes") |
| M4-M6 | C1a | `auto-acceptance-m4-m6-2026-11-08.md` |
| M7-M9 | C1b | `auto-acceptance-m7-m9-2026-11-08.md` |
| M10-M14 | C2 | no report file; results in lane C2's scratch `results.json` (all 30 boxes recorded) |
| M15-M20 | C2a | `auto-acceptance-m15-m20-2026-11-08.md` |
| M21-M27, M27-UI | C2b, C2c | `auto-acceptance-m21-m27-2026-11-08.md` |

Related live checks: `live-cli-check-2026-11-08.md` (lane A, the real `claude` CLI 2.1.319),
`ocr-mcp-check-2026-11-08.md` (lane B: OCR, MCP under a real `claude -p`, Anytype, SharePoint),
`lane-h2-for-gene-2026-11-08.md` (fix pass H items that need Gene's call).

Result key: **PASS**; **PARTIAL** (the part a harness can drive passes, the rest is listed); **FAIL** (at run time;
every FAIL is fixed now, see below); **MANUAL** (needs Gene: Windows, hardware, look, real data, a decision);
**SUPERSEDED** (the box describes a layout that changed; the feature was checked where it lives now);
**DEFERRED** (needs the live CLI and a model's own choices); **NOT-RUN**.

## Summary

| Milestone | Boxes | PASS | PARTIAL | FAIL | MANUAL | SUPERSEDED | DEFERRED | NOT-RUN |
|---|---|---|---|---|---|---|---|---|
| M1 | 9 | 3 | 0 | 0 | 6 | 0 | 0 | 0 |
| M2 | 20 | 9 | 0 | 2 | 9 | 0 | 0 | 0 |
| M3 | 13 | 8 | 1 | 0 | 4 | 0 | 0 | 0 |
| M4 | 22 | 5 | 1 | 0 | 15 | 1 | 0 | 0 |
| M5 | 23 | 11 | 3 | 0 | 8 | 1 | 0 | 0 |
| M6 | 53 | 21 | 9 | 0 | 21 | 1 | 0 | 1 |
| M7 | 56 | 16 | 8 | 0 | 31 | 1 | 0 | 0 |
| M8 | 40 | 9 | 5 | 0 | 26 | 0 | 0 | 0 |
| M9 | 19 | 6 | 9 | 0 | 2 | 0 | 0 | 2 |
| M10 | 7 | 7 | 0 | 0 | 0 | 0 | 0 | 0 |
| M11 | 4 | 4 | 0 | 0 | 0 | 0 | 0 | 0 |
| M12 | 7 | 6 | 1 | 0 | 0 | 0 | 0 | 0 |
| M13 | 5 | 3 | 1 | 0 | 1 | 0 | 0 | 0 |
| M14 | 7 | 5 | 1 | 0 | 1 | 0 | 0 | 0 |
| M15 | 7 | 5 | 1 | 0 | 1 | 0 | 0 | 0 |
| M16 | 9 | 8 | 1 | 0 | 0 | 0 | 0 | 0 |
| M17 | 13 | 12 | 0 | 0 | 0 | 1 | 0 | 0 |
| M18 | 15 | 13 | 1 | 0 | 0 | 0 | 1 | 0 |
| M19 | 11 | 11 | 0 | 0 | 0 | 0 | 0 | 0 |
| M20 | 12 | 11 | 1 | 0 | 0 | 0 | 0 | 0 |
| M21 | 11 | 8 | 2 | 0 | 0 | 0 | 1 | 0 |
| M22 | 10 | 10 | 0 | 0 | 0 | 0 | 0 | 0 |
| M23 | 19 | 16 | 0 | 0 | 2 | 1 | 0 | 0 |
| M24 | 12 | 10 | 0 | 1 | 0 | 0 | 1 | 0 |
| M25 | 10 | 8 | 1 | 0 | 1 | 0 | 0 | 0 |
| M26 | 6 | 4 | 2 | 0 | 0 | 0 | 0 | 0 |
| M27 | 6 | 4 | 2 | 0 | 0 | 0 | 0 | 0 |
| M27-UI | 9 | 6 | 2 | 1 | 0 | 0 | 0 | 0 |
| **Total** | **435** | **239** | **52** | **4** | **128** | **6** | **3** | **3** |

435 is every box in Gene's files (255 for M1-M9, 37 for M10-M15, 134 for M16-M27, 9 in `m27-ui-acceptance.md`).
Boxes a lane fixed in-lane and re-checked live are counted as PASS (see the second table below).

Every milestone's acceptance script was re-run in the lanes and passed (`m1_roundtrip.py`, `m2`-`m27_acceptance.py`
on their fixtures; counts in the per-lane reports).

## FAILs and what fixed them

The four boxes that were FAIL at run time. Each fix has a regression test; the boxes were not re-run live after it.

| Box | What failed | Fixed by |
|---|---|---|
| M2#3 | "+ New" → Task opened the peek with focus on the dialog, not the title | `2c75e9d fix(object): focus the title of a freshly created object and the revealed description (M2#3)` |
| M2#8 | A rename relinked the referring files but showed no count | `1383c51 feat(object): say how many objects a rename relinked (M2#8)` |
| M24-11 | No "Run now" for a schedule, so Desk sync could not be run once by hand | `950b394 feat(schedules): Run now for schedules and an Off marker` |
| M27UI-9 | "Open Import inbox" said "Unknown collection" until a reload | `c50eaf3 fix(collections): learn of collections made server side (Import inbox)` |

Failures a lane found, fixed in-lane and re-checked live (counted PASS):

| Box | What failed | Fixed by |
|---|---|---|
| M2#7 | Add icon / Add cover image popovers opened off screen | `23fc1f7 fix(accept-M2-7)` |
| M3#9 | All notes was unreachable after the sidebar redesign | `f650f52 fix(accept-M3-9)` (palette "Open all notes") |
| M10.1 | Settings > AI Assistant showed a wrapper's version line | `c93ddce fix(ai): Claude Code's version line, not a wrapper's` |
| M15 script | `m15_acceptance.py` crashed in check 5 | `36c9b45 fix(accept-m15)` |
| M17.5, M17.9 | An agent row or a Chats tab row left the open chat panel on the old agent | `1535f06 fix(accept-m17.5)` |
| M18.6 | Editing a skill turned its frontmatter into a heading | `55f6758 fix(accept-m18.6)` |
| M18.6, M18.7 | A skill's History missed your own edit until a reload | `dd3ee16 fix(accept-m18.7)` |
| M18.8 | "Show archived" listed each active skill twice | `cc2b60c fix(accept-m18.8)` |
| M23-11 | Hand-typed steps crashed the Steps cell | `1133593 fix(accept-m23-11)` |

Findings on PASS or PARTIAL boxes, fixed in fix passes G and H:

| Finding (box) | Fixed by |
|---|---|
| Backlinks chips and Context grouping stale after a link elsewhere (M5#5) | `1759266 fix(backlinks)` |
| A daily-note template swallowed the first typed text (M4#3) | `2f8773c fix(calendar)` |
| "Changed elsewhere. Reloaded." never showed on a whiteboard (M6#17) | `f19cc49 fix(whiteboard)` |
| Shift+click on an inline wikilink opened the peek (M7#32) | `856e716 fix(links)` |
| `+` handle then Escape left a "/" (M7#20) | `7752857 fix(editor)` |
| Block colour from the selection bar (M7#5) | harness issue, now pinned by `e4cda6d test(editor)` (H2 item 7) |
| The Assistant's own page had no way in (M18) | `3b39d5d feat(sidebar)` (hover `…` menu) |
| An Obsidian "People" folder made a new type (M15.4) | `1db7e54 fix(import)` |
| Same-title links relied on a path tiebreak (M15.3) | `2937fb6 fix(import)` (nearest page wins) |
| A stopped import's dialog did not say why items failed (M15.5) | `2316c2e fix(import)` |
| Bad agent id, refused step label, secret Delete without confirm (M17.11, M17.6, M19.9) | `5d09576 fix(agents)` |
| Settings and MCP server changes from elsewhere needed a reload (M16.8, M19.6) | `d9dfceb fix(settings)` |
| Queue entries from steps had no title (M24) | `f9dba0f fix(work)` (lane A) |
| Wins and Alerts stale until a reload (M23) | `d79f60f fix(work)` |
| Today timeline missed evening meetings (M23) | `809cc2f fix(work)` |
| A step list that can't be read still offered Done (M24) | `f65dc80 fix(work)` |
| Parked dumps on Now opened a page with no reply box (M24) | `69bc107 fix(work)` |
| Withdraw logged "reopened" (M24) | `f38f473 fix(work)` |
| The agent import flow was reachable only from the finish step (M27UI-4) | `41c6698 feat(import)` (Import history), `f33b5ee fix(import)` (trial copy) |
| Proposed schema hid skipped items and dropped properties (M27-UI) | `fd623d5 fix(import)` |
| Trial rows did not show the tags and collections added (M27-UI) | `04b0337 fix(import)` |

Not fixed, by decision or still open: "Pages/Alpha" from the search box makes `Pages/Pages.md` and Wide layout
looks unchanged with the properties panel open (H2 items 5 and 6, both recommended "keep"); brain-dump queue
entries without a title and the re-queue of failed captures after a restart (M24 observations, not confirmed fixed).

## Box texts that are out of date

Re-read these before ticking; the app moved on, not the other way round.

| Box | Why |
|---|---|
| M4#13 | Completing a recurring task also writes an `occurrenceLog` block, not only status, date and completed |
| M6#45 | "Board edits don't bump lastUpdated" was reversed by `806934c feat(whiteboard): board edits bump lastUpdated` |
| M5#12 | Mentions an action-palette switch button; actions share the one palette list now |
| M4#6, M5#20, M7#51 | The old Tasks page and its tabs are gone; the views live on the Tasks dashboard (catalog §4) |
| M9#14 | "Release type constraint" lives on a query tab of a type page, not on the query's own page; re-run it there (H2 item 8) |
| M4#5 | Asks whether Three days should hide empty sections; Three days now shows only the daily-note slots (catalog §10, C9) |
| M15.4 | A first import into this space defaults to "Try on a copy of this space"; untick it to import for real |
| M17.1 | Sidebar order changed with the redesign (main navigation, then the Agents section with a header `+`) |
| M23-18 | Expects "comes with M24" text; M24 is built |
| M3#9 | The All notes sidebar entry is gone; All notes opens from the palette |
| M27UI-4 | "Reloading the dialog restores the decisions" is now reached through Settings > Import Content > Import history |

## What needs Gene by hand

Grouped by reason. PARTIAL boxes appear where their remaining half belongs.

- **Setup steps, not checks:** M1#1-4, M2#1-2 (copy the export outside the repo, `git init`, build, start the
  native window).
- **Windows, pywebview, toasts, OS hand-offs:** M2#2 (Ctrl+N in the native window), M4#8 and M4#22 (reminder
  toasts), M7#27 (open a file with the OS), M8#30 (microphone), M8#31 (clipboard permission), M8#32 (Recycle Bin),
  M21-9 (notification half), M23-13 (keep on top). Not a box: the S6 launch key in a real pywebview window
  (the window must open at `/_open` and every request must carry the cookie; HANDOFF "Run").
- **Wacom pen and touch:** M6#1-8, M6#12, M8#29.
- **Look and feel, themes:** M1#9, M2#18-20, M3#13, M4#15-21, M5#13, M6#32-41, M7#10-17, M7#24 (theme half),
  M7#34-50, M7#52-56, M8#40, M9#19, M13.5, M14.7, M15.7 (theme half), M16.1 (theme half), M23-17.
- **Real data and scale** (a copy of the CPI or work export, 1,000+ objects): M1#5, M2#14-17, M3#10-12, M4#10-14,
  M5#7-11, M6#13, M25-10, the real-folder halves of M26-1, M26-3 and M27-1. **Anytype:** M15.6 needs a real export
  (lane B found the reader's gaps against Anytype's exporter source).
- **Live model wording and choices** (DEFERRED): M18.13, M21-5, M24-6, and the wording half of M18.2. The rest of
  the real-CLI behaviour is covered by lane A's live run.
- **OS file manager:** M17.5 ("Open folder"), M20.5 ("Show in folder"); the Source line's "Show file" was not clicked either.
- **Interactions a headless harness can't drive:** M6#18 (two windows), M6#24 (connector handles), M6#51 (palette
  drag onto a board, NOT-RUN), M7#7 and M7#29 (file drop), M7#20 (block drag), M7#21 (Shift+click extend), M9#12
  (bulk actions), and the pointer half of M9#15 (sidebar sections; the keyboard reorder passes).
- **Can be re-run by an agent:** M9#7 and M9#8 (NOT-RUN: need a custom type with a Content / Text property),
  M9#14 (via the type-page query tab).
- **Decisions and "our choice" reviews:** M5#14, M5#21, M6#53, M7#18, M8#8, M8#9-28, M9#18; and from fix pass H,
  items 5 and 6 of `lane-h2-for-gene-2026-11-08.md` (recommendation: keep both).

## Headless limits

- **No native window.** The box has no GTK or Qt, so every server ran with `--browser` and `BROWSER=/usr/bin/true`,
  driven by Chromium over CDP at 1440x900. pywebview, its cookie handling and keep-on-top were never exercised.
- **HTML5 drag and drop** (ProseMirror block drag, file drop, palette or Pinned onto a board, sidebar sections),
  Shift/Ctrl multi-select, connector handle drags and clicks on the sigma graph canvas don't respond to CDP mouse
  events here. dnd-kit pointer drags (kanban, columns, timeline) do.
- **OS surfaces**: notifications, the file manager, the Recycle Bin, microphone and clipboard prompts, two windows at
  once, and downloads (an export's file was not captured).
- **Look**: DOM reads, no screenshots; nothing judged light against dark.
- **AI**: the fake CLI (`backend/tests/fake_claude.py`) everywhere except lane A's live run; no real Atlassian MCP,
  no Claude Desktop. The M20 remote agent was `fake_a2a.py`; M19 used `fake_mcp_server.py`.
- **Clock and time zone**: the Today timeline boxes ran with the browser and the space set to Asia/Tokyo, so the run
  time fell inside the day.
- **Linux only.** Nothing was run on Windows today; `%LOCALAPPDATA%\object\` was `OBJECT_STATE_DIR`.

## M1-M3 notes

Lane C1 recorded 24 of the 42 M1-M3 boxes (plus M7#3 and M9#2, which the M7-M9 report cites). The 19 it left
unrecorded are all Gene's: the setup steps M1#1-4 and M2#1-2, the CPI-copy boxes M1#5, M2#14-17 and M3#10-12, and the
look boxes M1#9, M2#18-20 and M3#13. They are counted MANUAL above. M3#3 (Overview sections) is PARTIAL in its
evidence.
