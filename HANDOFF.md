# Handoff: pick up Object

Updated 2026-11-11 (**the bar changed: `CLAUDE.md`'s "Notes first" rule**, Gene's direction of 2026-11-11. M32, notes first, is built, reviewed, fixed and gated (`GATE_HEAD`) on top of M1-M31: the analysis is `docs/superpowers/plans/notes-first-analysis-2026-11-11.md`, the plan `2026-11-11-m32-notes-first.md`, the record and the hand checks `m32-acceptance.md`; what comes first is Gene's M32 hand checks and the choices left for him. M1-M32 are built, gated and on `master`, the only live branch; M31 built everything the 2026-11-10 milestone audit listed as not built: `docs/superpowers/plans/milestone-audit-2026-11-10.md`). You are continuing "Object", a local, Markdown-backed notes app with its own object model. A space keeps its metadata in `.object/` and its cache in `.object-cache/`. Read this file, then `CLAUDE.md` (rules), then `CONTINUE.md` (process). The long history and every gate's numbers live in `docs/superpowers/plans/remaining-work.md`; its "What remains" section is the current to-do list.

## Where things stand

- **M1-M27 are all built and on `master`** (2026-11-07). `master` is the default branch (no `main`) and the only live line: the 2026-11-08 work (`integrate/2026-11-08`, every lane merged `--no-ff`) and the 2026-11-09 commits are on it (Gene, 2026-11-09: everything goes on `master`). Base new work on `master`. Last full gates (Linux): sweep round 3 on `master`, back end 3287 passed, front end 3984 passed, `tsc`, lint and build clean, acceptance 52/52 PASS; the readiness gate of 2026-11-09 at `82359e2`, back end 3388 passed, front end 4083 passed, lint and build clean, plus a headless launch smoke run (details in `remaining-work.md`).
- **2026-11-08, what changed** (details in `remaining-work.md`, "What remains", and the catalog sections named):
  - **Sidebar redesign** (catalog §4): Calendar, Tasks, Graph and Assistant on top; Agents as its own section with a header `+`; Trash at the bottom; All notes off the sidebar (the palette's "Open all notes"). The Assistant's hover `…` menu opens its own page.
  - **Tasks dashboard** (catalog §4): the Work page and the task lists are one page; views grouped as a Drive row and More views (Plan, Manage, Review); the old Tasks page is retired; Tasks › Today shows the Calendar Day view's task list (decision T1).
  - **Git-backed spaces** (catalog §12, `specs/2026-11-08-git-backed-spaces-design.md`): version control per space, off until turned on, debounced commits, a remote with push and update, the **Space history** page with Restore, git versions in an object's Version History, and backup of agents and settings.
  - **Security** (decisions memo §1, catalog §10d and §10e): S1 runs get an explicit `--tools` list; S2 every run's token carries the agent tools it may call; S3 at most 3 auto-runs in a row per work item; S5 `delete_collection` refuses a collection with excluded members; S6 a per-launch key for `/api` (see "Run"); S8 one turn per chat for remote agents too. S4 (fence glob characters, sweep finding 18) and S7 (`--resume`) were settled by the live-CLI run.
  - **Empty spaces:** a new or empty folder asks "Pick a starting point" once (basic setup: Person, Meeting, Project, Book; or empty).
  - **Help:** how-to guides as read-only Help pages (decision D1), never seeded into a space.
  - **Live checks:** the real `claude` CLI 2.1.319 (`live-cli-check-2026-11-08.md`); OCR, MCP under a real `claude -p`, Anytype and SharePoint (`ocr-mcp-check-2026-11-08.md`).
  - **Automated acceptance** of all 435 boxes: `docs/superpowers/plans/auto-acceptance-2026-11-08.md` (4 FAILs, all fixed; the per-lane reports are linked there). Fix passes G and H closed the findings.
  - **Decisions:** `decisions-memo-2026-11-08.md`, every recommendation approved by Gene; the catalog carries the approved write-ups C1-C11.
- **PR #13 (2026-11-08):** every UI string in Object's own words, and `structure` renamed to `type` across the data model with a compatibility layer (`backend/objectapp/keycompat.py`, `KeyCompatMiddleware`, `frontend/src/lib/keyCompat.ts`), so older spaces keep loading; a file gets the new keys the next time it is saved.
- **Open:** Gene's hand-checks (the list in the consolidated acceptance report), his inputs and the known limits, all in `remaining-work.md`, "What remains". The 2026-11-07 and 2026-11-08 audit histories are in `bug-audit-2026-11-07.md` and `bug-audit-2026-11-08.md`.

Milestones and plans (`docs/superpowers/plans/`): M1-M9 the base app; M10 AI assistant, M11 local API and MCP server, M12 property kinds, M13 view layouts, M14 automations, M15 importers; M16 chat polish and model picker, M17 agents and tools, M18 learning, M19 MCP gateway, M20 A2A and delegation, M21 schedules (design: `specs/2026-11-05-agents-design.md`); M22 work model, M23 Work section, M24 brain dump and agent loop (design: `specs/2026-11-05-work-dashboard-design.md`); M25 provenance and re-runs, M26 readers and the scan, M27 the agent workflow (design: `specs/2026-11-06-import-migration-design.md`; plans `2026-11-06-m25-provenance-and-reruns.md`, `2026-11-06-m26-readers-and-scan.md`, `2026-11-06-m27-agent-workflow.md`). Each built milestone has `mN-acceptance.md` (Gene's hand-checks, unticked, plus deviations; M27 also `m27-ui-acceptance.md`) and `scripts/mN_acceptance.py`. The feature branches (`feat/m10` to `feat/m15`, `feat/m16-m24`, `feat/m22-m23`, `fix/deleted-type-queries`) and the old `ccr-*` branches are merged or obsolete; `master` is the only live line (`integrate/2026-11-08` reached it on 2026-11-09).

## Run

```sh
uv sync && (cd frontend && npm ci && npm run build)
uv run objectapp --space <folder>                      # pywebview window
uv run objectapp --space <folder> --browser            # the browser instead
BROWSER=/usr/bin/true uv run objectapp --space <folder> --port 88xx --browser --print-link   # headless (no display)
```

- **Gene runs Object as a desktop app, not a browser tab.** On GH-DT (Omarchy/Hyprland) it starts from the launcher entry `~/.local/share/applications/object.desktop` ("Object"), logging to `~/.local/state/objectapp/app.log`. Linux window facts (`0916bf5`): pywebview's GTK backend needs `pygobject` + `pycairo` (pyproject, linux marker); GTK **private mode turns localStorage off**, which left the zustand stores without their `persist` API and crashed the main pane ("e.persist.getOptions" undefined), so Linux starts non-private with web data in `<state>/webview` (`__main__._webview_start_options`) and `nav/spaceStorage.ts` tolerates a missing `persist`. A process started without the session's environment needs `XDG_RUNTIME_DIR=/run/user/$UID WAYLAND_DISPLAY=wayland-1 GDK_BACKEND=wayland`, or GTK says "cannot open display".
- **The server needs its per-launch key** (decision S6, `backend/objectapp/uikey.py`). Without it `/api` answers 401 and `/` shows "This page isn't connected to Object". The window opens at a one-time `/_open?code=…` link that sets the key as a session cookie. With `--browser` the browser gets the one-time link alone; the terminal prints it only when no browser could be opened, with `--print-link`, or on Enter (which prints and opens a new one; it works once, for 5 minutes). Open the printed link, not the bare URL.
- **Scripts against a launched server** send the key as the `X-Object-Key` header (`SpaceHost.ui_key.secret`), or call `host.ui_key.open_url(url)` for a fresh link. `/api/v1` with a token keeps its own auth (MCP, agent runs).
- **Tests and acceptance scripts** that build the app with `create_app(...)` and no `ui_key` have no key check.
- Use a scratch `OBJECT_STATE_DIR` and a copy of a fixture space for anything automated; port 8790 is Gene's.

## What to do next, in order

0. **Gene's M32 hand checks and his choices** (`docs/superpowers/plans/m32-acceptance.md`, "Hand checks (Gene)" and "Choices left for Gene"), with the notes-first analysis `docs/superpowers/plans/notes-first-analysis-2026-11-11.md` and the M32 plan `2026-11-11-m32-notes-first.md` read first. Gene's direction of 2026-11-11 is the bar now (`CLAUDE.md`, "Notes first"): Object is a go-to notes app, the manual note-taking and task-tracking path comes first, AI is a helper, and the work dashboard and the IT types are things you turn on. M32 rebuilt the default path around that (Home, All notes in the sidebar, a save you can trust, keys that work while you type, a plain Tasks page, Work as an optional page per space, a new space that just starts, everyday words) and is built, reviewed (three reviewers), fixed in one pass, gated and on `master`; **Gene's hand checks of it, and the twelve choices left for him, are the next step**. Judge new work by what the default path feels like to someone writing notes, not only by whether a feature exists.

   The 2026-11-10 audit, `docs/superpowers/plans/milestone-audit-2026-11-10.md`, still holds for what it checked: M1-M31 (the IT ops type model, M28-M30, and M31, completion, built and gated 2026-11-10) are built and reachable; its "Remaining work" section is the to-do list behind M32, ahead of the items below.

1. **Set up** (fresh clone): install `uv` and Node 22+; `uv sync`; `cd frontend && npm ci` (not `npm install`).
2. **Gene's hands-on checks**, M1-M27 (435 boxes, none ticked: 255 for M1-M9, 37 for M10-M15, 134 for M16-M27 and 9 in `m27-ui-acceptance.md`). The automated run covered what a headless harness can; what is left for him is listed by reason in `auto-acceptance-2026-11-08.md`. Run them on a copy of his space (never his real data first), and fix what they find, one finding per commit with a regression test.
3. **Gene's inputs** (`remaining-work.md`, "Needs Gene"): his extra custom object types, an Anytype export, a git remote address, the Windows checks (the S6 launch key in a real pywebview window first), the four H2 items.

How Gene wants it built (2026-11-06): **parallel tracks by file ownership, a quick check per milestone, and one full gate per track plus one at the end, not a full gate after every milestone.** A workflow must record task results sorted by task number, so a resumed run hits its cache. The previous script ordered them by finish time, which broke resumes and rebuilt finished milestones. The two-track script is at `~/.claude/projects/C--Git-object/412d563a-525c-462f-98d8-9a68624a5e84/workflows/scripts/object-build-two-tracks-wf_9e539a30-330.js`; it can only be resumed from the same session, so copy its structure instead.

## Decisions Gene made (2026-11-05 / 06)

- Agents run only through the `claude` CLI under Gene's login. Never read `~/.claude/.credentials.json` or reuse a Claude token. Each agent is its own Claude Code project folder, loading only that folder's settings. **Agent runs get a `claudeMdExcludes` skip list** (Gene's `~/.claude/CLAUDE.md` and every ancestor folder's `CLAUDE.md`, `.claude/CLAUDE.md` and `CLAUDE.local.md`), because the M17 spike found those leaking in (`m17-cli-spike.md`).
- Patterns from an open-source agent are adopted, but it is never named in the repo.
- The Work agent has shell on (Gene's choice, warned); other agents have shell off and file tools fenced from space folders.
- Editor: a page link can switch between a card and an inline link (`3bc8925`): the card's `…` menu has **Turn into inline link**, and the block menu has **Turn into card** on a line holding only a link. "Always create inline links" (Settings > Editor) already existed.
- Import and migration design approved 2026-11-06 and built as M25-M27 (`specs/2026-11-06-import-migration-design.md`).

## Open review items to look at during the final review

- The known limits in `remaining-work.md`, "What remains" (launch-key and run-fence limits, the backslash fence, the chart SVG export, the Tasks dashboard's row reloads, the Anytype reader, OCR English only).
- Every milestone's deviations are listed in its `mNN-acceptance.md`.

## Rules that bite

- Fidelity to the behaviour catalog (`docs/behavior-catalog.md`), the design specs and the plans is the bar. Don't over-engineer, and don't invent schema.
- Review once per milestone, fix once; no per-task review loops.
- No real CPI data in the repo; fixtures are synthetic. Never touch `C:\Git\wiki`. `C:\Git\ticket-dashboard` may be read, never changed.
- Opening a space never writes `.md` files. Edits change only their own lines. Deletes go to the Trash. Preserve CRLF/BOM. Write atomically. The server binds 127.0.0.1 only.
- Tests use the fake `claude` (`backend/tests/fake_claude.py`) and `OBJECT_STATE_DIR` pointing at a temp folder; never write to `~/.claude`.
- Commit only your own files, by explicit path. Commits end with a `Co-Authored-By:` trailer for the model that made them (and the `Claude-Session:` trailer when the session gives one). The untracked `.claude/` folder stays untracked.
- Windows: timing tests and acceptance scripts can flake under load (file-in-use on cleanup). Rerun one alone before calling it a failure.
