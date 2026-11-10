# Object: remaining work

Status as of 2026-11-09: **M1-M27 and everything built on 2026-11-08 and 2026-11-09 are on `master`**, the only live branch (`integrate/2026-11-08` was merged on 2026-11-09; Gene wants everything on `master`). That day: the sidebar redesign, the Tasks dashboard, git-backed spaces, the decisions memo (`decisions-memo-2026-11-08.md`, approved by Gene) built, live checks of the real CLI, OCR and MCP, and an automated run of all 435 acceptance boxes (`auto-acceptance-2026-11-08.md`). The current list is "What remains" below; the history follows it.

**Gate on `integrate/2026-11-08` (Linux, 2026-11-09, after lanes A-F, G1-G5, H1-H3 and the acceptance fixes; vitest and pytest run one after the other):** back end 3391 passed, 16 skipped, 3 xpassed, 0 failed; front end 4074 passed, 1 skipped (537 files); lint 0 errors; `npm run build` clean. One frontend timing flake under load (`BrainDumpBar` "M23 seam") was fixed by waiting for the refusal text instead of one flush.

Earlier status (2026-11-07): M1-M27 were all built, reviewed, fixed and gated, and all on `master` (the default branch; there is no `main`). The feature branches `feat/m10` to `feat/m15`, `feat/m16-m24`, `feat/m22-m23` and `fix/deleted-type-queries`, and the old `ccr-*` branches, are merged or obsolete. M16-M24 were merged and gated on 2026-11-06 (`78c5785` M16-M21, `a11a5f4` M22-M23, M24 built on `ccr-381ccf85-cjstne`); M25 (provenance and re-runs), M26 (readers and the scan) and M27 (the agent workflow) were built 2026-11-06/07 and gated. M23, M24 and M25-M27 each had one review and one fix pass; M19-M22 were reviewed on their build tracks.

**2026-11-09: sweep round 3** (`bug-audit-2026-11-08.md`, "Round 3"): one review of the whole branch (no HIGH; all findings fixed), the remaining catalogued editor keys bound, and four older review items closed on Gene's decisions (Retry re-approves a failed Approve step; agent runs can't use the app's own `/api` routes, `runfence.py` with `psutil`; a moved import source is matched; a moved remote agent address waits for confirmation). **Gate (Linux):** back end 3287 passed, 0 failed; front end 3984 passed; `tsc`, lint (0 errors), build clean; acceptance 52/52 PASS. Still open: auto-run depth cap; learning and A2A routes rely on CLI tool lists; the live-CLI checks (fence glob characters, `--resume`); a Windows hand-check of the run fence.

**2026-11-08: bug and polish sweep** (`bug-audit-2026-11-08.md`): at `cbfde62` (after PR #13's copy rewrite and `structure` to `type` rename), eight read-only reviewers found 60 bugs and polish gaps; 52 are fixed on `ccr-ad9683a8-vdfntz` with regression tests, seven lanes by file ownership merged `--no-ff`; Gene decided the eight open points the same day and they were built in a second round ("Round 2" in that file: catalog to PR #13's words, week start everywhere, whiteboard plan updated, sentence-case menus, full-sentence API messages, the peek header and version line, four keys bound, "Delete 1 object"); only the fence's glob characters wait for the live CLI. **Gate after round 2 (Linux, 2026-11-08):** back end 3266 passed, 15 skipped, 3 xpassed, 0 failed; front end 3945 passed, 1 skipped; `tsc`, lint (0 errors) and `npm run build` clean; acceptance 52/52 PASS. **Gate after the sweep (Linux, 2026-11-08):** back end 3259 passed, 15 skipped, 3 xpassed, 0 failed; front end 3919 passed, 1 skipped (one timing flake under load, green alone); `tsc`, lint (0 errors) and `npm run build` clean; acceptance 52/52 PASS (`m1`, `m2`-`m21`, `m25`, `m27` on `space-sample` and `space-v1`; `m15`, `m22`-`m25`, `m27` on their default spaces; `m26`).

**2026-11-08: bug audit fixed** (`bug-audit-2026-11-07.md`): 45 of 46 findings fixed on `ccr-3a9c4e35-cqxd9s` with regression tests, reviewed once, one fix pass; finding 24 left by design; ten decisions for Gene listed under "Fix status" there. **Gate after the fixes (Linux, 2026-11-08):** back end 3206 passed, 15 skipped, 3 xpassed, 0 failed; front end 3879 passed; `tsc`, lint (0 errors) and `npm run build` clean; every acceptance script PASS.

**Gate before the audit (Linux, 2026-11-07):** back end 3139 passed, 15 skipped, 3 xpassed (`test_m24_loop.py::test_not_before_and_reorder` failed once under full-suite load and passes alone and with its file: a timing flake); front end 3803 passed; `tsc`, lint and `npm run build` clean; `m1_roundtrip.py` and every `m2`-`m27_acceptance.py` PASS (`m1`-`m21` and `m25`-`m27` on `space-sample` and `space-v1`; `m15` and `m22`-`m27` also on their default spaces). M10-M15 were gated on Windows on 2026-11-05 (see "2026-11-05: Windows gate"), M16-M18 on Windows on 2026-11-06 (their sections below); nothing has been gated on Windows since.

The history below is in the order it was written: the per-milestone sections newest first, then the table of everything built, then older verification tables.

## What remains (after 2026-11-08)

### Done on 2026-11-08

- **Sidebar redesign:** Calendar, Tasks, Graph and Assistant on top; Agents as its own section with a header `+`;
  Trash at the bottom; All notes off the sidebar (palette "Open all notes"). Catalog §4.
- **Tasks dashboard:** the Work page and the task lists merged into one page (Drive row, More views: Plan, Manage,
  Review); the old Tasks page retired; Tasks › Today uses the Calendar Day view's task list (T1). Catalog §4.
- **Git-backed spaces** (`specs/2026-11-08-git-backed-spaces-design.md`, catalog §12): version control per space, off
  until turned on; debounced commits; a remote with push and update; **Space history** with Restore; git versions in
  an object's Version History; backup of agents and settings.
- **Safety (decisions memo §1):** S1 an explicit `--tools` list; S2 every run's token carries the agent tools it may
  call; S3 at most 3 auto-runs in a row per item; S4 fence paths escape `[ ]` (live-checked); S5 `delete_collection`
  refuses a collection with excluded members; S6 a per-launch key for `/api`; S7 `--resume` live PASS; S8 one turn
  per chat for remote agents too. Catalog §10d, §10e.
- **Other decisions:** D1 how-to guides as read-only Help pages; D3 `g i` / `g c` and unbound keys marked; D5;
  Q-1 (query modes Auto and Title only); C9; AC-1 (sub-items on the basic Task type); AC-2 (imported images are Image
  objects); OCR of mixed PDFs, once per page; A-2 documented. A-1 (grey Glob and Grep with the shell on) was not
  built: with an explicit `--tools` list the CLI offers them beside the shell (catalog §10d).
- **Empty spaces:** a new or empty folder asks "Pick a starting point" once (basic setup: Person, Meeting, Project,
  Book; or empty). Catalog §4.
- **Live checks:** the real `claude` CLI 2.1.319 (`live-cli-check-2026-11-08.md`); OCR, MCP under a real
  `claude -p`, Anytype and SharePoint (`ocr-mcp-check-2026-11-08.md`).
- **Acceptance:** all 435 boxes run by agents; 4 FAILs, all fixed; fix passes G and H closed the findings
  (`auto-acceptance-2026-11-08.md`). The catalog gained the approved C1-C11 write-ups.

### Done on 2026-11-09

- **Native window on Linux** (`0916bf5`): Gene uses Object as a desktop app (as on Windows), not a browser tab.
  pywebview's GTK backend needed `pygobject` + `pycairo` (now in `pyproject.toml` with a linux marker), and its
  private mode turns localStorage off, which crashed the main pane ("e.persist.getOptions" undefined). Linux now
  starts non-private with web data in `<state>/webview`; the nav stores tolerate a missing `persist`. Regression
  tests: `test_uikey.py::test_linux_window_keeps_web_storage_in_the_state_dir`, `nav/spaceStorage.test.ts`. On GH-DT
  it starts from the launcher entry "Object" (`~/.local/share/applications/object.desktop`). Gate: front end 4075
  passed; launcher tests pass.
- **Gene's `main` space set up** (data only, no code): the starter gallery's types were added through the app's own
  code, then trimmed on Gene's call. **Day, Week and Month were deleted** (in the Trash for 30 days, with their saved
  queries "This week's days", "This month's weeks", "This year's months"): the Calendar's built-in daily notes already
  give one note per day, and Gene wants periods as an *organisation of the daily notes*, not separate objects. Kept:
  Area, Atomic note, Book, Definition, Film, Meeting, Organization, Person, Podcast, Project, TV series (plus Page,
  Tag, and DailyNote once the first daily note exists).
- **Daily notes by period, decided: a grouped query, not collections.** Gene suggested rolling daily notes into
  collections by week/month/year. Collections are filled by hand, so every note would need adding (or an automation
  kept up); a query grouped by the note's date (Group by → By Week / By Month / By Year, catalog §8) files every new
  note on its own and stores nothing twice, and the Calendar's Month and Week views already browse by period. The
  space has a saved query **"Daily notes"** (`.object/queries/daily-notes.json`: type DailyNote, grouped By Month,
  newest first); pin it from its `…` menu ("Pin to Sidebar"). Creating it needed today's daily note
  (`DailyNotes/2026-11-09.md`), because a query can only name a type the space has, and DailyNote exists once the
  first daily note does.
- **Today's note pop-out** (`4482c11`): the top bar's "Today's note", the palette's "Pop out today's daily note" and
  Ctrl+Shift+D open today's daily note in the peek (created when missing), like an object clicked on the timeline.
- **"Show properties by default"** (Settings > Editor, `adf830a`): off opens notes with the properties panel hidden
  (Gene's setting: off). Also added "Show the sidebar when Object opens" (Appearance > Layout, `4482c11`); that was
  a misreading of Gene's ask (he meant the notes' properties panel), so his value is back on; the switch stays.

- **Readiness gate before daily use (2026-11-09, Linux, `82359e2`):** back end 3388 passed, 19 skipped (one
  wall-clock budget test, `test_task_stats_fast.py`, failed only while the front-end suite and build ran beside it
  and passed alone); front end 4083 passed, 1 skipped; `tsc`, lint and build clean. A headless launch on a copy of
  `space-sample` through the `/_open` link: bare `/api` answers 401, the shell, today's note (Ctrl+Shift+D),
  editing a page (only that file changed), search, Tasks, Calendar, Graph, Assistant and Trash all open with no
  console, page or HTTP errors. Opening the space changed no `.md` file (only M1's first-open type files, since the
  fixture has no `.object/types/`).

- **Known-limits fix pass (2026-11-09, four lanes by file ownership, one review, one gate):** object change events
  carry `linked` and the Tasks dashboard refreshes only those rows (a window's own saves too, through the save
  response); Gene's property or body edit of a work item restarts its S3 auto-run count (`workloop.on_change`,
  called by the body and property save routes only, so a rename's relinked objects or a relation sync don't count); the import preview lists images under an Image row (AC-2); the gallery's Day
  template is gone and Week/Month say they are for reviews; OCR reads every installed Tesseract language or the
  `ocrLanguages` setting (Settings > Import Content); `--browser` prints the one-time link only when no browser
  opened or with `--print-link`; agents warn about a folder a backslash keeps unfenced (A-2); `GET /v1/types` and
  `GET /v1/queries` list definitions on the token API; chart Export SVG writes the chart's own SVG. Catalog updated
  in each section. Not done: the Anytype reader (waits for a real export). Review found two regressions, both
  fixed before the gate (a newly qualifying row never appeared on the dashboard; renames and relation sync reset
  other items' S3 counts). **Gate (Linux):** back end 3437 passed, 19 skipped (two budget tests, a 0.35 s compute
  and a 20 s import wait, failed only with the front-end suite running beside them and pass alone); front end 4095
  passed, 1 skipped (one 100 ms budget test likewise); `tsc`, lint and build clean; headless launch smoke run clean.

- **M28-M30**, the IT ops type model (design approved by Gene 2026-11-09, `specs/2026-11-09-it-ops-type-model-design.md`;
  plans `2026-11-09-m28-itops-starter-and-relations.md`, `2026-11-09-m29-synced-facts-and-type-suggestion.md`,
  `2026-11-09-m30-entity-extraction.md`), built in that order.

### Done on 2026-11-10

- **M30 built: entity extraction and distillation** (T1 contract; T2-T12 on parallel lanes by file ownership, merged
  up to `2befd1ad` on top of all of M28 and M29; T13 integration). Every import has the option **Keep pages as
  Sources**, ticked for every import and on when a request leaves it out (API, `/api/v1`, MCP `start_import`'s
  `keep_as_sources`; Gene's decision, plan Our calls 25), so the M15/M25/M27 tests and acceptance scripts that test a
  plain mapped import send `keepAsSources: false`. On, every page is a read-only **Source** ("Imported source"; its
  text byte-identical to the import; only a re-run of the same source updates it, the old text in version history).
  On a Source batch the AI filing pass returns each page's main entity, its mentions, summary lines and relations,
  each quoted and checked; it writes nothing but the batch's records and stops in a new **Entities** step (after the
  bulk pass, before Normalise): accept, rename, merge, split or turn down each entity (the entity rule: a page is about
  it, two pages mention it, or it has a value of its own; categories never), then **Write** (refused while another
  import runs). Each entity is distilled from all its Sources: values with their Sources (`.object/distilled/<id>.json`;
  the newest Source wins, conflicts listed; Gene's values never replaced), the Sources relation ("Distilled into" on
  each Source), relations on their stored side, plain links (`Also linked: [[path|Title]] (relation)`), and a "From
  sources" section on top of the body that only the import rewrites (an entity with no lines, conflicts or plain links
  gets none). Low-confidence links put their subject entity in the Import inbox; existing objects (Gene's own) are
  reused; Move batch to Trash takes the Sources and the created entities. In an IT ops space the proposal refuses
  look-alike types and offers "Use <type>, with a category". New read tool `import_entities`. Catalog §10c.
  `scripts/m30_acceptance.py` RESULT: PASS; `m27`, `m28`, `m29` RESULT: PASS; `m15` "All checks passed." (it prints
  no RESULT line); `m25` fails one check that already failed at the M29 gate commit `8a2724e3` ("a first import only
  adds files": the People folder now joins Person and extends `.object/types/person.json`), not an M30 change. Next:
  the whole-milestone review, one fix pass and the full gate, then Gene's hand checks (`m30-acceptance.md`).

- **M29 built: synced facts and the suggested type** (T1-T11 on parallel lanes by file ownership, merged up to
  `8ca54c02`; T12, the settings for the synced mark, name patterns and the sync token, on its own lane; T13
  integration). A property can be marked synced (text, URL, number, checkbox, date, label): its values come only
  from `POST /api/v1/synced/{type}` (a `read-write` token or the new `sync` scope, "Synced facts only", which reads
  like `read` and writes only synced facts) or the new MCP write tool `sync_facts` (69 tools for a read-write token),
  matched by title, alias or a key property; they live in `.object/synced/<typeId>.json`, never in the `.md` (an
  id-less object gets its `id` line once), are refused on every other write path (UI, API, automations, create with
  values, work writes), and show read-only with "<source> · Refreshed <time ago>" and "Stale" after 7 days. The
  starter Host has five synced facts (Last boot, Disk free, Patch state, Reboot pending, Last seen; "Inventory
  script"); Host, Network and Software carry name patterns. Every create row offers a suggested type first
  (context, then name patterns, then the last type per space): `[[` / `@` gain "New '<q>'" and "Other types",
  relation pickers "Create '<q>'" per allowed type. Glob patterns use a linear state-set matcher, not a regex
  (plan "Our calls" 21). Catalog §1, §10f. `scripts/m29_acceptance.py` PASS (nine checks); `m28` and `m22`
  acceptance PASS. Next: T12's merge, the whole-milestone review, one fix pass and the full gate, then Gene's hand
  checks (`m29-acceptance.md`).
- **M28 gate (Linux, 2026-11-10, after one review and one fix pass):** back end 3644 passed, 19 skipped, 0 failed;
  front end 4146 passed, 1 skipped (the icon subset was regenerated for M28's new icon); `tsc`, lint and build clean;
  `m28_acceptance.py`, `m8`, `m22` and `m2` acceptance RESULT: PASS. The review found 11 issues (the worst: a type save
  refused after a target type gained a clashing key; a board grouped by a counterpart offering drops and a "+" that
  failed; automations offering counterparts the server ignores; an index walk racing a writer); all fixed with tests.

- **M28 built: the IT ops starter and two-way relations** (T1-T10 on parallel lanes by file ownership, merged on
  `ccr-9c93c0c4-ssxqz7` up to `78a2f8af`; T11 integration). "IT operations" is the third starting point (17 types,
  16 default templates, 30 seed tags; nothing already there is replaced); the gallery's IT operations group adds the
  13 types the other groups lack, each with its default template; a relation can name its computed other side
  (`options.counterpart`), shown as an editable row on the target (Host "Runs", "Documented in", "Contains", …;
  never stored, an edit writes the other object's relation only), filterable, sortable and groupable in views
  (read-only table column, a board refuses drops); the graph labels relation edges on the hovered node. Catalog §3,
  §4, §5, §7. `scripts/m28_acceptance.py` PASS (ten checks); `m8` and `m22` acceptance PASS. Next: the
  whole-milestone review, one fix pass and the full gate, then Gene's hand checks (`m28-acceptance.md`).
- **Next: M30** (entity extraction), after M29's review and gate.

- **M29 gate (Linux, 2026-11-10, after one review and one fix pass):** back end 3720 passed, 19 skipped, 0 failed;
  front end 4242 passed, 1 skipped (one whiteboard test needed the last-type reset other create tests use); `tsc`,
  lint and build clean; `m29`, `m28`, `m22` and `m8` acceptance RESULT: PASS. The review found 13 items (the worst: two
  syncs of an id-less object lost one's facts; a view filtered or grouped by a synced property couldn't create; a
  hand-typed value under a synced key showed in the calendar and search; change type and merge could write a synced
  key); all fixed with tests. Name patterns use a linear matcher, not a regex (plan Our calls 21).

- **M30 gate (Linux, 2026-11-10, after one review and one fix pass; the final gate for M28-M30):** back end 3819
  passed, 19 skipped (the 2 message-style failures were fixed after the run: the Source label allow-listed, one repr
  quote removed; one speed-budget test passes alone); front end 4267 passed, 1 skipped; `tsc`, lint and build
  clean; acceptance `m30`, `m29`, `m28`, `m27`, `m25`, `m22`, `m8` RESULT: PASS and `m15` "All checks passed.". The
  review found 18 items (the worst: a Source re-run took the old file's line endings and BOM; merge could trash a
  Source; a second import's older Source could overwrite a newer value and drop earlier citations; restoring a
  Source answered 500; preview and start defaulted differently); all fixed with tests. The M25 acceptance check
  "a first import only adds files" was stale since before M28 (an import into an existing type extends it, by
  design); the check now allows exactly those type files. Categories are now only Category, Kind and Environment
  options and tags (plan Our calls 26); the keepAsSources default is on everywhere (Our calls 25).

### Needs Gene

1. **Hand-checks:** the list in `auto-acceptance-2026-11-08.md`, "What needs Gene by hand" (Windows and pywebview,
   Wacom, look and themes, real data and scale, live model wording, the file manager, decisions). Re-read the "Box
   texts that are out of date" table there before ticking. Boxes stay unticked in `mN-acceptance.md` until he does.
2. **Your extra custom object types:** the list of types beyond the starter types now in `main` (see "Done on
   2026-11-09") that your spaces should start with, so they can be added through the app's own code. Gene,
   2026-11-09: not a list yet. The current types "seem a little wonky"; first a deeper discussion of how objects are
   created and which types exist.
3. **An Anytype export** (a few objects, Markdown with files), to confirm and fix the reader's gaps (below).
4. **A git remote address**, when you want backup off this machine (Settings > Space > Version control > Remote;
   any https or ssh remote; the system's git credentials are used). Gene, 2026-11-09: later; version control stays
   local for now.
5. **Windows checks:** the S6 launch key in a real pywebview window (the window and the keep-on-top window open at
   `/_open`, every request carries the cookie, a `curl` without it gets 401), the run fence, reminder toasts, Wacom,
   microphone and clipboard prompts. Nothing has been gated on Windows since 2026-11-06.
6. **Fix pass H, "For Gene"** (`lane-h2-for-gene-2026-11-08.md`): **decided 2026-11-09, Gene kept all four as
   recommended** (closed; M9#14 still to be re-run on a type page's query tab during the hand-checks).
   - Item 5: "Pages/Alpha" from the search box makes `Pages/Pages.md` (the title is kept; the file name rule matches
     the export). Keep.
   - Item 6: Wide layout looks unchanged with the properties panel open at 1440 px (the column never reaches the
     Normal max width). Keep.
   - Item 7: block colour from the selection bar works (a harness issue; now pinned by a test). Nothing to do.
   - Item 8: "Release type constraint" lives on a type page's query tab. Keep; re-run M9#14 there.
7. **Credentials in the Work and Personal source spaces:** scrub them with the approved procedure (memo D2) before
   any import, and review the 10 "possible secrets" wiki pages (`ai-pass/review.md`). Gene, 2026-11-09: later, but
   before any real import; no real import runs until it is done.

### Known limits

- **Launch key (S6)** (`backend/objectapp/uikey.py:23-30`): a local process running as Gene can still read the
  browser's memory or, with `--browser`, a session cookie that session restore wrote to disk (the one-time link is
  printed only when no browser opened, with `--print-link`, or on Enter; 2026-11-09). `/api/v1` with a token is
  open by design. The run fence behind it
  (`runfence.py:22-37`) misses processes that detach from the run's tree and is off where `psutil` can't see
  connection owners (macOS without root).
- **Backslash fence (A-2):** a folder whose name contains `\` can't be fenced from an agent's file tools; rename it
  (catalog §10d). Since 2026-11-09 Object names the folder on the agent page and in the log instead of staying silent.
- **Chart "Export SVG"**: fixed 2026-11-09 (the chart's own SVG, styles on the shapes, legend below); the number
  chart, which draws no SVG, still exports its rendered frame through `html-to-image`.
- **Tasks dashboard refresh** (fixed 2026-11-09): change events carry `linked`; the dashboard refreshes only those
  rows. One conservative full reload remains when the link index is first built with a write already pending (a
  write through the token API before any link read on a fresh server); the next event is exact again.
- **Anytype reader** (`ocr-mcp-check-2026-11-08.md`, "Anytype reader"): against the exporter's source, the type
  sits under `Object type`, titles come out as slugs, `Creation date` is not `createdAt`, the `id` is an ordinary
  property, relations come out as file-name labels, and the `schemas/*.schema.json` formats are ignored. Medium risk;
  waiting on a real export.
- **OCR languages**: every installed Tesseract language, or the `ocrLanguages` setting (2026-11-09). Codes like
  `script/Latin` are left out of the installed list; an uninstalled code in the setting makes a page keep "Needs OCR".
- **Maintenance on a running space:** the window's own `/api` stays closed to other processes (S6), but type and
  saved-query definitions are maintainable while Object runs through `/api/v1/types` and `/api/v1/queries` with a
  `read-write` token or the MCP tools (catalog §10e; `GET` lists added 2026-11-09). `Space(...)` with the window
  closed remains the offline fallback. Never hand-write `.object/*.json`.
- **SharePoint:** no fetch code (by design); a Microsoft 365 MCP server would download into a Files folder first.
- Closed on the same day, listed so nobody reopens them: the `settings` event is in `RESYNC_EVENTS`
  (`api/client.ts:540`, `d79f60f`), so a reconnect reloads device settings.

### Parked

- An installer (spec §6).
- Migrating `C:\Git\wiki` into Object's format (a separate project; M25-M27 are its tooling).
- The network integrations: calendar feeds, Readwise, Kindle, Telegram, WhatsApp, email, Raycast.
- Object Team (`specs/2026-10-28-object-team-design.md`), parked until Gene expands to the team.

Done and closed (details in the sections below): the polish backlog (2026-11-03/04), both audits (2026-10-28 and 2026-11-01, merged: PR #4 `84f3c16`), the Windows-only gzip and M15 test failures, M10-M15 (PRs #5-#11), the agents milestones M16-M21 (design `specs/2026-11-05-agents-design.md`), the work dashboard M22-M24 (design `specs/2026-11-05-work-dashboard-design.md`) and import and migration M25-M27 (design `specs/2026-11-06-import-migration-design.md`).

## 2026-11-06/07: M25-M27, import and migration

Plans `2026-11-06-m25-provenance-and-reruns.md`, `2026-11-06-m26-readers-and-scan.md`, `2026-11-06-m27-agent-workflow.md`; results, deviations and hand-checks in `m25-acceptance.md` (10), `m26-acceptance.md` (6), `m27-acceptance.md` (6) and `m27-ui-acceptance.md` (9). **M25**: the `importSource` provenance block and the object page's Source line (Open original, Show file), the Files source kind with `_manifest.jsonl`, originals kept in `Attachments/Originals/` (or as File objects), re-runs that update in place and flag "Changed in both" and "Removed at source", batches with Move batch to Trash, "Try on a copy of this space", a reconciling Import report, and the queryable fields Imported from, Import batch and Source modified. **M26**: file readers (docx, pdf, xlsx/csv, pptx, html, images, original-only) and the local sensitive-content scan with the "Leave out" list (`POST /api/import/scan`, the wizard's "Check for sensitive content" step). **M27**: the schema proposal (only the app applies it), the AI filing pass with a 50-object trial, normalise and the Import inbox collection, five new MCP tools (`import_scan`, `import_proposal`, `import_report`, `save_import_proposal`, `save_import_decisions`; tool counts are now 25 read and 43 write), the "Migrate a source" skill and the wizard's agent steps. One review and one fix pass (the `fix(m27)` commits, `e75e3ac..65553fe`); the open items are in the list above. Built on Linux; gated 2026-11-07 (numbers at the top).

## 2026-11-06: M19-M24, merged and gated

**M19** (the MCP gateway (in): outside MCP servers by command or URL in Settings > Integrations, their secrets in `<state>/secrets.json`, every enabled server in each chat turn's `--mcp-config` filtered by the agent's switches, secret variables for agent folders' `.mcp.json`, server groups on the Tools tab; `m19-acceptance.md`, 11 hand-checks; the review fix added `McpServersAnswer.unreadable`, a Contract addition for Gene to approve; spike in `m19-cli-spike.md`). **M20** (A2A (outbound) and delegation: remote agents added by their Agent Card URL with an optional bearer token or header, listed with a "remote" mark and chatted with over A2A 1.0 JSON-RPC, the once-per-agent context notice, and the `remote_agents_list`, `remote_agent_call` and `delegate` agent tools, flat, at most 3 at once per turn; `m20-acceptance.md`, 12 hand-checks; spike in `m20-spike.md`). **M21** (agent schedules: an M14 rule with a `schedule` trigger and one `runAgent` action, made on the agent page's Schedules tab, in Settings > Automations or by the agent with `schedule_manage`; each run is a new chat saved as an AI Chat; no learning review for schedule runs; a machine-wide `agent-schedules.json` keeps the curator off skills a schedule uses; runs cut off by closing the space go back to the catch-up; `m21-acceptance.md`, 11 hand-checks). **M22** (the work model: ticket and work fields on Tasks and Projects, the step list with whose turn and the approval gate, List and Floor items, `## Activity` and `## Work notes`, the resolution note, the Tickets view, "Add work fields", the work routes and eight `objectapp-mcp` work tools; built on `feat/m22-m23`, cut after M18; `m22-acceptance.md`, 10 hand-checks). **M23** (the Work section: top bar, brain-dump bar, focus rail and the views, focus lines, today's meetings, wins, the Alert type and the monitoring-folder watch, the floor list, keep on top; review fixes are the `fix(m23)` commits; `m23-acceptance.md`, 19 hand-checks). **M24** (the brain dump and the agent loop: Captures, the Work agent, the work loop that queues Gene's approvals, answers, notes, requests and current Agent steps and, with **Agent acts on my approvals** on, runs them one at a time as headless chats with read-only runs narrowed in code; Desk sync; the Captures view; Settings > Work; review fixes `5bb153f`; `m24-acceptance.md`, 12 hand-checks). M16-M21 were merged as `78c5785` and M22-M23 as `a11a5f4` on 2026-11-06; M24 followed on `ccr-381ccf85-cjstne`, which is now `master`. Each milestone passes its own `scripts/mNN_acceptance.py`; the 2026-11-06 merge gate and the 2026-11-07 final gate (numbers at the top) are green.

## 2026-11-06: M18, learning

Each agent saves memories (`MEMORY.md`, `USER.md`, with caps and a frozen per-chat snapshot) and writes and improves its own skills through Object's `memory` and `skill_manage` tools; every change goes to `.object-agent/ledger.jsonl` with its before and after content and the Skills tab can undo it. Background reviews run after a reply (and on demand from "Learn from this chat") and the chat shows "Learning…" then a summary; the curator marks unused agent-made skills stale and archives them while Object is idle, and "Tidy up now" runs the consolidation pass; `session_search` and the Chats tab search the agent's own chats. Built on `feat/m16-m24` (shared with M16-M24; merged to `master` 2026-11-06), commits `bcc01de..5fb14d2` (the review fixes are `8cdc7f9`, `4cf20f5`, `774a339`, `6fa763b` and `5fb14d2`). Plan `2026-11-05-m18-learning.md`; results, deviations and hand-checks in `m18-acceptance.md`; CLI notes in `m18-cli-notes.md`. Gate on Windows (re-run 2026-11-06 at `5fb14d2`): back end 2364 passed, 19 skipped, 3 xpassed (the live tests skip without `OBJECT_LIVE_CLAUDE=1`; 1 warning: a test's background server thread exiting at startup, as in M16 and M17); front end 434 files passed, 1 skipped, 3285 tests passed, 1 skipped; `tsc` clean; lint 0 errors (567 warnings, of kinds the code base already has); build ok; `m1_roundtrip.py` PASS; `m2`-`m18_acceptance.py` PASS on `space-sample` and `space-v1` (34 runs; `m18_acceptance.py` 37 checks on each), plus `m4` on `space-calendar`, `m5` on `space-links`, `m6` on `space-whiteboard`, `m7` on `space-blocks` and `m14` on `space-m8`. Left for Gene by hand: the 15 checks in `m18-acceptance.md` (a memory about him saved and seen in a new chat but not the old one, the "Learning…" line and its summary after about ten messages, the chat going on normally after a review, "Learn from this chat", an agent-made skill on the Skills tab, Undo and undo of the undo in a skill's History, archive, restore and pin, "Tidy up now" merging two skills, the Learning tab's numbers and a 0 interval, the Chats tab search, "Searched past chats", an "Exclude from AI" page staying unread and unremembered, "Memory & skills" opening the Memory tab, unlinked mentions), plus real agent chats with the installed CLI and the app's own window.

## 2026-11-06: M17, agents, agent folders and full tooling

Every agent is its own folder under `<state>/agents/` (the default agent Assistant made on first use), each turn runs the `claude` CLI there with only that folder's settings and a fence that keeps the file tools out of every space, Object's MCP server has 20 read and 35 write tools, and the sidebar has an Agents section, an agent page (Profile, Instructions, Tools, Chats) and a chat agent picker. Built on `feat/m16-m24` (shared with M16-M24; merged to `master` 2026-11-06), commits `a4f42e9..3c1857f` (the review fixes are `9af040b`, `c1edd04` and `3c1857f`). Plan `2026-11-05-m17-agents-and-tools.md`; results, deviations and hand-checks in `m17-acceptance.md`; the live spike in `m17-cli-spike.md`. Gate on Windows (re-run 2026-11-06 at `3c1857f`): back end 2227 passed, 18 skipped, 3 xpassed (the live spike tests skip without `OBJECT_LIVE_CLAUDE=1`; 1 warning: a test's background server thread exiting at startup, as in M16); front end 423 files passed, 1 skipped, 3234 tests passed, 1 skipped; `tsc` clean; lint 0 errors (549 warnings, of kinds the code base already has); build ok; `m1_roundtrip.py` PASS; `m2`-`m17_acceptance.py` PASS on `space-sample` and `space-v1` (32 runs), plus `m4` on `space-calendar`, `m5` on `space-links`, `m6` on `space-whiteboard`, `m7` on `space-blocks` and `m14` on `space-m8`. Left for Gene by hand: the 13 checks in `m17-acceptance.md` (the Agents section, the chat from Assistant and Ctrl+Alt+J, direct writes without Accept and the proposal modes still asking, a new agent's folder and instructions, the Tools tab and the shell warning, the fence on an "Exclude from AI" page, none of his `~/.claude` setup reaching an agent, the Chats tab, delete and restore, "Add agent folder…", an M10 AI Chat continuing with Assistant, unlinked mentions), plus real agent chats beyond the live spike and the app's own window. Also for Gene: whether any CLI built-in outside the Tools tab should be denied by default, and whether an agent may change an excluded member's collections through `delete_collection`.

## 2026-11-06: M16, chat Markdown, tool steps and the model picker

The chat renders every message as safe Markdown (raw HTML shown as text), shows each tool call as a collapsed step between messages, and has a model picker in the chat header and in Settings > AI Assistant; the model list is one back-end constant (`aimodels.MODELS`, served by `GET /api/ai/models`). Built on `feat/m16-m24` (shared with M17-M24; merged to `master` 2026-11-06), commits `d4a9d89..ff60aea`. Plan `2026-11-05-m16-chat-polish-model-picker.md`; results, our calls and hand-checks in `m16-acceptance.md`. Gate on Windows (re-run 2026-11-06 at `59b9df4`, after the review fixes `b13752e`, `9017f92` and M17's contract `a4f42e9`): back end 2094 passed, 17 skipped, 3 xpassed (1 warning: a test's background server thread exiting at startup); front end 410 files passed, 1 skipped, 3177 tests passed, 1 skipped (the first run failed `appIcons.test.ts` twice: M17's contract added `ph-robot` in `src/` without regenerating the icon subset; fixed in `59b9df4` and the file re-run green); `tsc` clean; lint 0 errors (526 warnings, of kinds the code base already has); build ok; `m1_roundtrip.py` PASS; `m2`-`m16_acceptance.py` PASS on `space-sample` and `space-v1` (30 runs), plus `m4` on `space-calendar`, `m5` on `space-links`, `m6` on `space-whiteboard`, `m7` on `space-blocks` and `m14` on `space-m8`. M11's run logs four "Tool ... failed" lines: its deliberate error-reply checks. Left for Gene by hand: the 9 checks in `m16-acceptance.md` (a real reply's rendering in both themes, Copy pasting the source, tool steps, object-link chips, a hostile reply staying inert, the picker's list and a mid-chat switch, the `haiku` alias with the installed CLI, the Settings picker, New chat resetting to Default), plus the real `claude` CLI and the app's own window.

## 2026-11-05: Windows gate (M10-M15, after the merge)

Local master (the 2026-11-04 decisions and review fixes) merged with origin (M10-M15, PR #9) at `2fc84bb`. The two builds of "a type delete takes its saved queries along" were reconciled on PR #9's, with the local behaviours it lacked ported onto it (a query listing the type twice, a delete or restore that fails partway). Gate on Windows: back end 2053 passed, 13 skipped, 3 xpassed; front end 3123 passed, 1 skipped; `tsc` clean; lint 0 errors; build ok; `m1_roundtrip.py` PASS; `m2`-`m15_acceptance.py` PASS on `space-sample` and `space-v1` (28 runs). M11's run logs four "Tool ... failed" lines: its deliberate error-reply checks.

## 2026-11-05: M15, importers

Import a Notion "Markdown & CSV" export, an Obsidian vault or an Anytype Markdown export (zip or folder, read in place by path) into a new space or, when picked, this space: a preview that writes nothing, editable type and property mappings, a polled job with Stop, new files only, and an "Import report" page. Built on `feat/m15-importers` off `master` in two lanes (back end; dialog), one review, one fix pass in two parts (`b16bc66`, `90af287`) and the gate. Plan `2026-11-05-m15-importers.md`; results, our choices and hand-checks in `m15-acceptance.md`. Built on Linux; gated on Windows 2026-11-05 after the merge (see "2026-11-05: Windows gate"). The Anytype reader is unverified until a real export is checked.

## 2026-11-05: M14, local automations

Rules that run on this machine: triggers on create, property change, schedule and button; conditions from the view filters; actions that set properties, tag, file into collections, create from templates, append to the daily note and notify; a template "Repeat"; a Button block and a Button property; Settings > Automations with each rule's run log; and a catch-up dialog for missed schedule runs. Built on `feat/m14-automations` off `master` in two lanes (back end; editor and screens), one review, one fix pass (`a4544c5`, `cc2c407`) and the gate. Plan `2026-11-05-m14-automations.md`; results, our choices and hand-checks in `m14-acceptance.md`. Built on Linux; gated on Windows 2026-11-05 after the merge (see "2026-11-05: Windows gate").

## 2026-11-05: M13, calendar, timeline and chart layouts

Three new view layouts plus sub-items and dependencies, built on `feat/m13-view-layouts` off `master` in three lanes (calendar; timeline, relation pairs and nested rows; chart), one review, one fix pass (`d6b2d45`) and the gate. Plan `2026-11-05-m13-view-layouts.md`; results, our choices and hand-checks in `m13-acceptance.md`. Built on Linux; gated on Windows 2026-11-05 after the merge (see "2026-11-05: Windows gate").

## 2026-11-05: M12, computed and new property kinds

Formula, Rollup, ID, Email, Phone and Files, built on `feat/m12-property-kinds` off `master` in three lanes (back end, property settings, cells and views), one review, one fix pass (`4a81fe2`, `881faf6`) and the gate. Plan `2026-11-05-m12-property-kinds.md`; results, our choices and hand-checks in `m12-acceptance.md`. Built on Linux; gated on Windows 2026-11-05 after the merge (see "2026-11-05: Windows gate").

## 2026-11-05: M10, the AI assistant (branch `feat/m10-ai-assistant`, on top of M11, merged to `master`)

Built in three lanes (back end; chat panel and settings; editor and object entries), reviewed once, fixed once, gated on Linux. The assistant runs `claude -p` with only Object's MCP read tools, in an empty folder, with a read-only token that lives only in memory; "Exclude from AI" pages and templates are never sent; nothing the assistant proposes is written without a click. Results and our choices: `m10-acceptance.md`.

## 2026-11-05: M11, the local API and MCP server (branch `feat/m11-local-api-mcp`, merged 2026-11-05, PR #5)

Next plan: `2026-11-04-notion-anytype-features-plan.md` (Notion and Anytype comparison; order M11, M10, M12, M13, M14, M15, one branch and PR each, Gene merges). M11 is built and gated on Linux: tokens in the state dir, `/api/v1`, `objectapp-mcp`, Settings > Integrations, "Exclude from AI". Results and our choices: `m11-acceptance.md`.
## 2026-11-04 (later): Gene's six decisions, built

From the walkthrough and the hands-on checklist (`hands-on-checklist.md`, "Decisions"): the slash menu opens only at a block's start or after whitespace; a failed lazy chunk after an update flushes and reloads once (toast if the flush fails, hangs 5 s, or it recurs within 60 s); icon button names and tooltips checked; deleting a type trashes its saved queries and restore brings them back; role values renamed to Object's own names; the page title commits on Escape. Three lanes, one review, one fix pass, gate below.

## 2026-11-04: folder names, roles and the rest of the polish backlog

**Names** (`28d55b1`): space metadata is `.object/` and `.object-cache/`. The behaviour catalog is `docs/behavior-catalog.md`. The backend role values were renamed (`page`, `dailyNote`, ...) the same day.

**Polish** in five worktree lanes, merged `--no-ff`, one review, one fix pass (backend `002306a`, `4b81aea`, `44ecf14`; frontend `3de8d7b`, `38d3d48`, `34f0860`). Our choices to check by hand: Help sits below Graph and Trash; placeholders are Day view only (Week and Three days keep "+ Daily Note", as the catalog says); the type setting is stored as `defaultDataViewLayout`; the 14 template queries (e.g. Books "Currently reading", Projects "Active projects", Films "Top rated films") are in `typetemplates.py` `TEMPLATE_QUERIES`; wall cards show the description under the title and one labelled row per card property with "Empty".

Gate (Windows, at `cf90118`): back end 1592 passed, 12 skipped, 3 xpassed; front end 2528 passed, 1 skipped; `tsc` clean; lint 0 errors; build ok; `m1_roundtrip.py` and `m2`-`m9_acceptance.py` PASS (16 runs).

## 2026-11-03: the polish backlog

Built in nine lanes, one background agent each in its own git worktree, split by file ownership (Gene: work everything in parallel, test once at the end). Merged into `master` with `--no-ff` (one conflict, the shortcut registry, resolved by keeping both lists). Then one two-half review, one fix pass (`8b66d59`, `76401a4`, `0dacbad`, `f4a227a`, `13e7972`, `4052227`, `28e2ce7`) and the gate. Item by item, with the lanes' "our choice" notes: `polish-audit-2026-11-02.md`, "2026-11-03: the parallel pass".

Gate (Windows, at `4052227`; the api-mock fix `28e2ce7` came after, with its tests rerun): back end 1557 passed, 12 skipped, 3 xpassed (the 5,000-object month timing test passes on a quiet machine; it failed once under the nine-lane load); front end 2466 passed, 1 skipped; the one failure, the api-mock contract test, is fixed in `28e2ce7`; `tsc` clean; lint 0 errors; build ok; `m1_roundtrip.py` and `m2`-`m9_acceptance.py` PASS on `space-sample` and `space-v1`.

For Gene's hands-on check: `@` or `[[` in an empty block now inserts an object block (the default; Settings > Editor > Always create inline links keeps the inline form); the root font is 15.5px so the whole app is about 3% smaller; the properties-pane toggle writes `hideProperties` to the object; the types gallery's property kinds are our choice; PDF export prints from a hidden frame, untried inside the pywebview window; Enter in the tag picker picks the closest tag before Create.

## 2026-11-02: the behaviour catalog

Behaviour reference: `docs/behavior-catalog.md` (sections 1-11). Differences, fixes and backlog: `plans/polish-audit-2026-11-02.md`. **Unlinked mentions must stay** (ground rule in `CLAUDE.md`; built in M5).

Fixed and committed on `master` (since pushed): daily-note header pill and the calendar section toolbars; Three days view; nested collections in the sidebar and the type context menu (with Pin to Sidebar); how-to guides imported into the wiki space; PDF, Image, Weblink and Audio get their extra fields; the keyboard-hint footer under the slash menu, New menu, link picker and search palette; slash "In a week" and "A week ago"; Find/Present/Delete key hints in the object menu; a Search field in the space switcher; Graph moved beside Trash; the New menu as a popover under the New button (picking a type creates at once); the `@` and `[[` picker as a popover at the caret with recents and a row per type.

Gate at the end of 2026-11-02 (Windows): front end `npx vitest run` 2326 passed, 1 skipped; `tsc -b --noEmit` clean; lint 0 errors; `npm run build` ok. Back end 1463 passed, 12 skipped, 3 xpassed, plus the one pre-existing failure in item 5 (run before the last front-end-only commits; no back-end change since).

**Done on 2026-10-28, on Windows:**
- **Audit bugs:** all ~65 in `audit-2026-10-28.md`, plus every "unconfirmed" item that proved real, fixed one per commit with a failing-first test, in six area branches merged into master (whiteboard, backend API, views and properties, shell, backend storage, editor).
- **Guessed values:** settled on 2026-10-28 and applied in four merged branches: keyboard shortcuts (one registry in `lib/shortcuts.ts`), side panel, breadcrumbs, pinned tabs, the 768 px breakpoint, dashboard default sections, Tasks tab order, slash and block menus, highlight and formula formats, search highlight colours and graph limits.
- **Windows-only failures** from the baseline are fixed (non-portable tests, the M5 acceptance cache check, an icon first-render flicker).
- **Gate:** pytest 1202 passed; vitest 1829 passed; `tsc` clean; build ok; `m1_roundtrip.py` and `m2`–`m8_acceptance.py` PASS on `space-sample` and `space-v1`.

**2026-11-02: the polish audit.** The behaviour catalog was written out in full (`docs/behavior-catalog.md`: Settings, shortcuts, menus, editor chrome, views, graph, export; sections 1-10) and Object was checked against it (`plans/polish-audit-2026-11-02.md`: what differed, what is fixed, and a consolidated backlog A-H). Fixed and committed on `master` (since pushed): daily-note header pill, calendar toolbars, three-days view, nested collections in the sidebar, the type context menu, the how-to guides import. **Unlinked mentions must stay** (Gene's requirement; already built in M5). Backlog progress (media-type fields, the keyboard-hint footer, week date links, the `@` trigger) is tabled in the audit doc's "Progress on the backlog"; next: the rest of the backlog from the top, with tests. (Gene decided on 2026-11-02 to unlock them all.)

Spec: `docs/superpowers/specs/2026-10-23-object-design.md`. How to resume: `HANDOFF.md`, `CONTINUE.md`. Rules: `CLAUDE.md`. Process: `docs/superpowers/build-process.md`.

Behaviour reference: `docs/behavior-catalog.md` and the spec.

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
| **M9** the audit's completeness gaps (Tasks 1–23; 13 skipped by Gene) | `2026-10-28-m9-completeness-gaps.md` | `19a8167..c138f1d`, review fixes `3d46450..d17bd90`, gate 2026-10-28 | `m9-acceptance.md` (19) |
| **M10** AI assistant through the Claude Code CLI and M11's MCP read tools | `2026-11-02-m10-ai-assistant.md` | `feat/m10-ai-assistant`, merged to `master`; gate 2026-11-05 (Linux, then Windows) | `m10-acceptance.md` (7) |
| **M11** local API, tokens, MCP server, Settings > Integrations | `2026-11-04-notion-anytype-features-plan.md` | `feat/m11-local-api-mcp`, merged (PR #5); gate 2026-11-05 (Linux, then Windows) | `m11-acceptance.md` (4) |
| **M12** computed and new property kinds (Formula, Rollup, ID, Email, Phone, Files) | `2026-11-05-m12-property-kinds.md` | `01289a8..` on `feat/m12-property-kinds`, merged to `master`; gate 2026-11-05 (Linux, then Windows) | `m12-acceptance.md` (7) |
| **M13** calendar, timeline and chart layouts; sub-items and dependencies | `2026-11-05-m13-view-layouts.md` | `0d9b7db..` on `feat/m13-view-layouts`, merged to `master`; gate 2026-11-05 (Linux, then Windows) | `m13-acceptance.md` (5) |
| **M14** local automations: rules, schedules and catch-up, template repeat, buttons | `2026-11-05-m14-automations.md` | `dbb09d9..` on `feat/m14-automations`, merged to `master`; gate 2026-11-05 (Linux, then Windows) | `m14-acceptance.md` (7) |
| **M15** importers: Notion, Obsidian and Anytype exports | `2026-11-05-m15-importers.md` | `80973d0..` on `feat/m15-importers`, merged to `master`; gate 2026-11-05 (Linux, then Windows) | `m15-acceptance.md` (7) |
| **M16** chat Markdown, tool steps and the model picker | `2026-11-05-m16-chat-polish-model-picker.md` | `d4a9d89..ff60aea` on `feat/m16-m24`, merged to `master` 2026-11-06; gate 2026-11-06 (Windows) | `m16-acceptance.md` (9) |
| **M17** agents, agent folders and full tooling | `2026-11-05-m17-agents-and-tools.md` | `a4f42e9..3c1857f` on `feat/m16-m24`, merged to `master` 2026-11-06; gate 2026-11-06 (Windows) | `m17-acceptance.md` (13) |
| **M18** learning: memory, skills, ledger and Undo, reviews, curator, chat search | `2026-11-05-m18-learning.md` | `bcc01de..5fb14d2` on `feat/m16-m24`, merged to `master` 2026-11-06; gate 2026-11-06 (Windows) | `m18-acceptance.md` (15) |
| **M19** the MCP gateway (in): outside MCP servers, secrets, secret variables, server tool groups | `2026-11-05-m19-mcp-gateway.md` | `0ced74b..bf6efce` plus the integration commit on `feat/m16-m24`, merged and gated 2026-11-06 (`78c5785`) | `m19-acceptance.md` (11) |
| **M20** A2A (outbound) and delegation: remote agents, `remote_agents_list`, `remote_agent_call`, `delegate` | `2026-11-05-m20-a2a-and-delegation.md` | `d2554b3..2b26f0b` plus the integration commit, merged and gated 2026-11-06 | `m20-acceptance.md` (12) |
| **M21** agent schedules: the Schedules tab, `runAgent` rules, `schedule_manage`, catch-up | `2026-11-05-m21-schedules.md` | `02c584d..40e8cec` plus the integration commit, merged and gated 2026-11-06 | `m21-acceptance.md` (11) |
| **M22** the work model: work and ticket fields, steps and the approval gate, Activity, the Tickets view | `2026-11-05-m22-work-model.md` | `822e467..` on `feat/m22-m23`, merged 2026-11-06 (`a11a5f4`); gate 2026-11-06 (Linux) | `m22-acceptance.md` (10) |
| **M23** the Work section: views, focus lines, wins, alerts, floor, seams | `2026-11-05-m23-work-section.md` | merged 2026-11-06; review fixes `fix(m23)`; gate 2026-11-06 (Linux) | `m23-acceptance.md` (19) |
| **M24** brain dump and the agent loop: Captures, the Work agent, the work loop, Desk sync | `2026-11-05-m24-brain-dump-and-agent-loop.md` | `f348dd8..c45b4ae` plus the integration commit, one review fix pass (`5bb153f`); on `master`; gate 2026-11-06 (Linux) | `m24-acceptance.md` (12) |
| **M25** provenance and re-runs: `importSource`, the Source line, the Files kind, originals, batches, Move batch to Trash | `2026-11-06-m25-provenance-and-reruns.md` | `b7cecad..d691f51`, built 2026-11-06/07; gate 2026-11-07 (Linux) | `m25-acceptance.md` (10) |
| **M26** readers (docx, pdf, xlsx/csv, pptx, html, images) and the sensitive-content scan | `2026-11-06-m26-readers-and-scan.md` | `803e4d8..cb5c06d`, 2026-11-06/07; gate 2026-11-07 (Linux) | `m26-acceptance.md` (6) |
| **M27** the agent workflow: proposal, trial, normalise, Import inbox, MCP tools, the Migrate a source skill | `2026-11-06-m27-agent-workflow.md` | `371ff1d..9f0687a`, review fixes `e75e3ac..65553fe`; gate 2026-11-07 (Linux) | `m27-acceptance.md` (6) and `m27-ui-acceptance.md` (9) |

M8's "Coverage" section maps every deferred item to a task, or to a spec §2 exclusion: AI, network at runtime, accounts and sharing, mobile, telemetry.

## Linux verification (2026-11-02, after both audit fix passes, at `71ef3b6`)

| Check | Result |
|---|---|
| `uv run pytest backend/tests -q` | 1469 passed, 1 skipped (needs a non-root user), 3 xpassed |
| `cd frontend && npx vitest run` | 2284 passed, 1 skipped (needs `OBJECT_ROUNDTRIP_SPACE`) |
| `npx tsc -b --noEmit` / `npm run lint` / `npm run build` | clean / 0 errors / built |
| `scripts/m1_roundtrip.py`, `m2`–`m9_acceptance.py` on `space-sample` and `space-v1`; `m9` on `space-m8`, `space-blocks`, `space-whiteboard` | all PASS |

## Linux verification (2026-11-01, after the first audit fix pass, at `b7e8761`)

| Check | Result |
|---|---|
| `uv run pytest backend/tests -q` | 1381 passed, 1 skipped (needs a non-root user), 3 xpassed (at `4c4b726`; the two tests added after it pass) |
| `cd frontend && npx vitest run` | 2138 passed, 1 skipped (needs `OBJECT_ROUNDTRIP_SPACE`) |
| `npx tsc -b --noEmit` / `npm run lint` / `npm run build` | clean / 0 errors / built; the entry chunk is 273 KB (76 KB gzip), down from 3.4 MB |
| `scripts/m1_roundtrip.py`, `m2`–`m9_acceptance.py` on `space-sample` and `space-v1`; `m9` on `space-m8`, `space-blocks`, `space-whiteboard` | all PASS (m2 52/52 and 50/50, m3 14/14, m4 24/24, m5 18/18, m6 19/19, m7 23/23, m8 26/26, m9 23/23 on each of the five spaces) |
| Performance after the fixes (synthetic 5,001-object space, headless Chromium) | see `audit-2026-11-01.md`, "Measured after the fixes" |

## Windows verification (2026-10-29, after merging M9 into master as PR #3, at `6ef3df8`)

| Check | Result |
|---|---|
| `uv run pytest backend/tests -q` | 1238 passed, 2 skipped |
| `cd frontend && npx vitest run` | 1965 passed, 1 skipped; 1 timed out under load (`ObjectView.writes.test.tsx` "a renamed event retargets the tabs", 5 s limit), which passed 3 of 3 runs alone |
| `npx tsc -b --noEmit` / `npm run lint` / `npm run build` | clean / 0 errors (warnings only) / built |
| `scripts/m9_acceptance.py` on `space-m8`, `space-blocks`, `space-sample`, `space-v1`, `space-whiteboard` | all PASS, after fixing a Windows path bug in the script (check 6 built the sidecar path with `\`) |
| `scripts/m1_roundtrip.py` and `m2`–`m8_acceptance.py` on `space-sample` and `space-v1` | all PASS |

## Linux verification (2026-10-28, after M9 and Gene's answers, at `35bbd88`)

| Check | Result |
|---|---|
| `uv run pytest backend/tests -q` | 1239 passed, 1 skipped (needs a non-root user) |
| `cd frontend && npx vitest run` | 1966 passed in 308 files, 1 skipped (needs `OBJECT_ROUNDTRIP_SPACE`) |
| `npx tsc -b --noEmit` / `npm run lint` / `npm run build` | clean / 0 errors / built |
| `scripts/m9_acceptance.py` on `space-m8`, `space-blocks`, `space-sample`, `space-v1`, `space-whiteboard` | all PASS (23/23 each) |
| `scripts/m1_roundtrip.py` on a copy of `space-sample` and of `space-v1` | PASS |
| `scripts/m2_acceptance.py` … `m8_acceptance.py` on `space-sample` and `space-v1` | all PASS (m2 52/52 and 50/50, m3 14/14, m4 24/24, m5 18/18, m6 19/19, m7 23/23, m8 26/26) |
| The app (`uv run objectapp --browser`) driven in headless Chromium | every M9 feature used once with 0 console errors and 0 requests leaving 127.0.0.1 (see `m9-acceptance.md`) |

The synthetic fixture spaces are `space-sample`, `space-v1`, `space-calendar`, `space-links`, `space-whiteboard`, `space-blocks` and `space-m8`.

## What is left (older detail; the current list is at the top)

0. **Both audit lists are done and merged:** 2026-10-28 (bugs fixed, completeness gaps built as M9) and 2026-11-01 (bugs and optimization, PR #4). The object page title commits on Escape (Gene's decision of 2026-11-04).
1. **Gene's hands-on checks, M1–M9:** 255 unchecked items (M10-M27 are in the list at the top). Run them on a copy of the CPI export kept outside the repo, with `git init` there: `npm run build` in `frontend/`, then `uv run objectapp --space <copy>`. These can only be checked on his Windows machine:
   - the pywebview window
   - Windows toast reminders
   - Wacom pressure and tilt
   - microphone and clipboard permissions
   - a type page with 1,000+ real objects
   - the look against the behaviour catalog in Light, Light Dimmed, Dark and Dark Dimmed
2. **Guessed values to confirm or correct** (nothing specifies them):
   - the shortcut keys (`frontend/src/lib/shortcuts.ts`, listed in Settings → Shortcuts)
   - the side-panel area layout, breadcrumbs and pinned tabs
   - the slash and block menu looks
   - the search highlight colour and the graph limits
   - the 480/850 px layout switch points
   - the M8 file formats (block ids and references, inline colours, date tokens, indent and list-item annotations, table formulas, collection and query embeds)
   - M3's default dashboard section tabs (`inNoCollection`/`notTagged`), still to confirm
3. **Check the CPI export for a Task type with no Done-category status option.** Inferred status sets, as in the sample spaces, have none, so those tasks can't be completed until one is added in type settings (M4 finding).
4. **Fix what the hand-checks find.** One finding per commit, each with a regression test, then the full gate.
5. **Not in M9 (Gene's call):** the sidebar types block's Sort Alphabetically / Manually (needs a key kept in each type's default collection); bulk Edit property / Edit tags / Export; export to PDF, Word or LaTeX; duplicating whiteboards; the "name contains status" group ordering (Gene: no).
6. **Deferred by Gene:** TODO handling in the editor. Logseq-style markers were considered and rejected on 2026-10-26.
7. **Later:**
   - an installer (spec §6: "an installer comes later")
   - the in-app Claude Code agent (spec §2)
   - migrating `C:\Git\wiki` into Object's format (a separate project)
   - **Object Team (next version, parked):** a team server, offline desktop sync with merge, user spaces and an MCP agent layer modelled on KiwiFS. Approved 2026-10-28 but not to be started until Gene expands to the team. Spec: `docs/superpowers/specs/2026-10-28-object-team-design.md`; KiwiFS evaluation: `docs/kiwifs-evaluation.md`.

## How we build

- **Plan:** each piece of work gets one plan: a writer, then critics and one resolve pass. Gene cut the critics from M5 on to save time.
- **Build:** one workflow builds it in lanes with disjoint files. Each task commits with its own tests.
- **Finish:** one review, one fix pass, then the gate and a push. No per-task reviews (Gene, 2026-10-26).
- **Gene's checks:** he checks each milestone hands-on. On 2026-10-26 he asked for all milestones to be built first, and on 2026-11-05 for M16-M24 to be built straight through (and M25-M27 after), so his checks of M1-M27 come together.
- **Lessons:** see `build-process.md`: parallel planning, two milestones at once, dependencies up front, the 4-CPU agent cap, resuming after limits.

## Out of scope (by design)

Accounts, login, billing, sync, sharing/publishing, mobile, telemetry, migrating `C:\Git\wiki` (a separate later project; M25-M27 are its tooling). The network integrations (Readwise, Kindle, calendar feeds, messaging, email, Raycast) are wanted later at lower priority. AI (M10, M16-M21), the local API and MCP server (M11), the Work section (M22-M24) and importing from other apps (M15, M25-M27) are built. Accounts, sync and sharing return only in the parked Object Team spec (`specs/2026-10-28-object-team-design.md`), not in this version.
