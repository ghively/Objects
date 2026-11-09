# Live CLI check (lane A, 2026-11-08)

The first run of Object's AI features against the real `claude` CLI rather than `fake_claude.py`. It also settles
sweep finding 18 (glob characters in fence rules) and the open `--resume` check.

- **Box:** GH-DT (Linux, Omarchy), Claude Code **2.1.319** (`~/.local/bin/claude`, a mise shim), under Gene's
  login. No token was read or reused, and `~/.claude` was not changed.
- **Branch:** `lane/a-live-cli`, off `master` at `da12f82`.
- **Servers:** scratch servers only, on ports 8801, 8811 and 8812. Each had `OBJECT_STATE_DIR` under
  `~/.hermes/cache/scratch/lane-a/` and ran on copies of fixture spaces. They were started with `--browser` and
  `BROWSER=/usr/bin/true`, because without `--browser` the launcher needs pywebview with GTK or Qt, and this box
  has neither. Port 8790 and `~/Spaces/main` were not touched.
- **Models:** the live pytest files pin `haiku`. App turns used the agent's default model (the transcript records
  `model: null`), apart from one turn that picked `haiku`.
- **Method:** everything went through the HTTP API. The browser was not used.

## Results

| # | Feature | Result | Evidence |
|---|---|---|---|
| 0 | Live pytest files (`OBJECT_LIVE_CLAUDE=1`, m17-m20) | **PASS after test updates** | First run: 14 passed, 2 failed, 1 skipped (Windows only) in 126 s. The 2 failures were stale assertions for 2.1.319 (see "Live test updates"), not product bugs. After the update, `test_m17_live_cli.py` gave 9 passed in 29 s, including the two new finding-18 checks |
| 18 | Fence glob characters | **FAIL on `master` → fixed** (`fix(sweep-18)`) | See "Finding 18" |
| 1 | Assistant chat (M10/M16/M17) | **PASS** | See below |
| 1b | `--resume` (continuing a chat) | **PASS** | Turn 2 sent `sessionId` `9bec37a2-…`. The CLI kept the same session id and the model recalled turn 1's phrase. The resume prompt carries no history, so the recall came from the resumed session. This also answers the sweep's open question: `--resume` works with the `Read(~/.claude/projects/**)` deny rule in place |
| 1c | Model picker (M16) | **PASS** | `model: "haiku"` gave a reply in 2.6 s. The transcript line says `"model":"haiku"` |
| 2 | Custom agent via API, `claudeMdExcludes` | **PASS** (user file: N/A) | See below |
| 3 | Work agent loop (M24) | **PASS**, plus a bug fixed (`fix(work)`) | See below |
| 4 | Import AI filing pass (M27), "Try on a copy" | **PASS** | See below |
| 5 | M18 learning | **PASS** | See below |

### 1. Assistant chat

The space was a copy of `space-sample` named `Notes [2024]`, so the space itself carries the finding-18 name. It
also held an excluded page, `Pages/Vault Secret.md` (`excludeFromAI: true`, body `ZEBRA-EXCL-91`).

- **Turn 1:** "search for 'launch code', list every page".
  - The stream gave `chat, session, ToolSearch, search, query, text×16, done`.
  - `search` answered `{"results": []}`.
  - `query` listed 6 pages, and Vault Secret was not among them.
  - `ZEBRA-EXCL-91` appears nowhere in the stream.
- **Turn 2:** asked to use the **Read tool** on `…/Notes [2024]/Pages/fence-probe.txt`.
  - The tool result was `File is in a directory that is denied by your permission settings.` (`isError: true`).
  - `FENCE-E2E-77` was not in the stream.
  - This ran with the fix. On `master` the same rule leaks; see the probe below.
- **Timings:** turn 2 took 9.1 s and turn 3 took 12.5 s (default model).

### 2. Custom agent

- **Setup:** `POST /api/agents` with `{"agent": {"name": "Researcher"}, "location": "<scratch>/anc"}` answered
  201 and made the folder `<scratch>/anc/Researcher`. Instruction files with markers were planted in
  `<scratch>/CLAUDE.md`, `<scratch>/anc/CLAUDE.md`, `<scratch>/anc/.claude/CLAUDE.md` and
  `<scratch>/anc/CLAUDE.local.md`.
- **Probe:** asked without tools, the agent answered its soul marker `RESEARCHER-SOUL-42`. It listed only
  `…/anc/Researcher/CLAUDE.md` and found no ancestor markers. The run took 8.6 s.
- **Control:** the same probe with `claudeMdExcludes` emptied shows the ancestor marker. So on 2.1.319 the
  excludes are still needed, and they work.
- **User file:** there is no `~/.claude/CLAUDE.md` or `~/.claude/rules` on this box, and creating one would mean
  changing Gene's `~/.claude`, which is off limits. The rest of the user setup was checked by
  `test_user_setup_never_reaches_a_run` (PASS): 0 user skills loaded, user deny rules replaced with 0 rules, 0
  hooks, no plugin outside `@builtin`, no auto-memory folder.

### 3. Work agent loop

- **Setup:** a copy of `space-work` with `space-work-m23` laid over it, plus a synthetic task "Lane A live check"
  whose only step is an Agent step: "Read this task's Description and record a one-sentence summary".
- **Actions:**
  - `POST /work/agent/create` answered 201 (shell on, `toolsOff: []`).
  - `PUT /work/agent-settings` turned on `acts: true` (with `autoRun: false`).
  - `POST /work/step` with `action: "run"` approved the step, which queued a read-only `work-read` run.
- **Outcome:**
  - The run took 14 s from claim to finish (`03:44:57.84Z` → `03:45:11.82Z`). The entry is `done`.
  - The step is `done`, with result "Summary: The floor-2 coffee machine throws error E42 every Monday morning, …".
  - The file gained `result:` and `doneAt:`, and the Activity log gained "Work completed step 1: …".
- **Bug found:** the queue row's `title` was `null` and the Work agent's chat was titled "Brain dump · run". Fixed;
  see the bugs list.

### 4. Import AI filing pass

- **Source:** 4 made-up files: two standup `.md` files, `Reading list.txt` and `Recipe pancakes.md`.
- **Import into a copy:**
  1. The open space was a copy of `space-sample`. `POST /import/preview` gave a preview.
  2. `POST /import/start` with target `{kind: "spaceCopy", name: "spaceI trial"}` gave job `done`, 4 objects,
     batch `01M6Z6SZ…`.
  3. `POST /spaces/switch` moved the server to the copy.
- **Filing:**
  - `filing/start {trial: true}` reached `trial` after about 20 s: 4 items, all typed `Page` (medium or high
    confidence).
  - Two were marked right, then `filing/continue` gave `done` with `rightShare 1.0`.
  - The batch report says "Trial: 4 objects; marked 2 (2 right, 0 wrong): 100% right".
- **Proposal:** a chat turn on the copy (16.7 s) called `import_report`, `import_proposal` and then
  `save_import_proposal`, which answered `{"revision": …, "items": 1, "checks": []}`. `GET …/proposal` shows the
  group. Review and apply then answered `{"created": [], "extended": [], "skipped": []}`, which is right for a
  `use` item.
- **Originals:** no `.md` in the original space changed (only `.object/types/*.json`, which any first open of
  `space-sample` writes). The source folder was unchanged.

### 5. M18 learning

- **Turn 3:** "my team is called Falcon; I like short bullet lists; save that". The agent called `ToolSearch`,
  then `memory add (user)` twice. `GET /agents/assistant/memory` shows both entries in `USER.md` (63/1375
  characters), and the ledger shows two "Saved a memory about you" lines.
- **Review:** `POST …/chats/{id}/learn` answered 202 and the review ran. The `learning` line reads `state: done`,
  "Nothing new to learn", because the memory was already saved. This used `--fork-session` live, and the chat's
  own session id stayed the same.

## Finding 18: glob characters in fence rules

Checked with one-turn probes (Read tool, `haiku`) that use the real `fence_rules`. Each special folder had a
"twin" folder that the unescaped glob would match, to tell literal matching from glob matching.

| Folder | Raw rule (as on `master`) | Backslash-escaped rule |
|---|---|---|
| `Alpha [2024]` | **secret readable; twin `Alpha 2` denied: a character class, so the fence is broken** | secret denied, twin readable |
| `Bravo {a,b}` | secret denied, twin readable (braces are literal) | secret denied, twin readable |
| `Charlie*` | secret denied, twin `Charliexyz` denied too (a wildcard, too broad but safe) | same as raw |
| `Delta?` | secret denied, twin `Deltax` denied too (a wildcard, too broad but safe) | **secret readable: escaping `?` breaks the fence** |
| `claudeMdExcludes` on ancestors `Alpha [1]/Bravo {x,y}/Charlie*/Delta?` | **all kept out (matched literally)** | **all four leaked** |

So the audit's suggested fix (escape `[ ] { } * ?` in both places) would have broken the fence for `?` and broken
the excludes entirely. What was built (`fix(sweep-18)`):

- **`rule_path`** escapes only `[` and `]`.
- **`claude_md_excludes`** is never escaped; its docstring now says why.
- **The fake's matcher** now treats `[...]` as a class and `\[`/`\]` as literal brackets, so the new contract test
  `test_fence_holds_on_glob_characters_in_a_folder_name` failed before the fix (`[False, …]`, secret readable) and
  passes after it. `test_claude_md_excludes_stay_literal` pins the excludes.
- **Live regression checks:** `test_fence_holds_on_brackets` and `test_claude_md_excludes_on_brackets` in
  `test_m17_live_cli.py` (both PASS).
- **End to end:** see check 1, turn 2, through the app.

**Not settled, for Gene (new):** a backslash in a POSIX folder name (`Echo\x`, legal on Linux) can't be fenced.
The current `rule_path` form (`\` → `/`), the backslash kept as-is and the backslash doubled all left the file
readable (one probe, three rule forms). A possible approach (untested): put `?` in place of `\`, which would close
the folder plus any look-alike names. It is rare and was not changed. `*` and `?` in a space name also close
same-length look-alike sibling folders; that errs on the safe side.

## Bugs found and fixed (one commit each, each with a regression test that failed first)

1. **`05720f8` `fix(sweep-18)`:** fence rule paths escape `[ ]`, and the excludes stay literal (above).
2. **`f9dba0f` `fix(work)`:**
   - **Symptom:** queue entries made by step actions, answers and notes had no `title`. The Agent queue row's
     item link (`AgentQueueView` `{row.title}`) was empty, and every such run's Work-agent chat was titled
     "Brain dump · run".
   - **Fix:** `WorkLoop.on_notice` now fills the item's title.
   - **Test:** `test_step_entries_carry_the_item_title`.
   - **Checked live** on a restarted scratch server: a new Approved step row shows "Printer jams on line 3".
     Entries made before the fix keep `null`; the store keeps the last 20 finished, so they age out.
3. **`c93ddce` `fix(ai)`:**
   - **Symptom:** `GET /api/ai/status` reported the mise shim's line
     (`mise ~/.config/mise/config.toml tools: claude@2.1.319`) as the version.
   - **Fix:** it now takes the line naming Claude Code, else the last line.
   - **Test:** `test_status_version_skips_a_wrapper_line`.

**Live test updates (`52ff038`, `test(live-cli)`):**

- 2.1.319 bundles a skill named `deep-research`, the same name as one of Gene's user skills. The skill-leak check
  now counts a name match only when the debug log doesn't show `user: 0`. Here the log says "Loaded 0 unique
  skills (… user: 0 …)" and "30 bundled skills", so it was not a leak.
- 2.1.319 offers no `Glob` or `Grep` when the shell is on, because search goes through `Bash`. `test_builtin_names`
  now allows those two rows to be missing in that case.

## Observations (not changed)

- **No Glob or Grep with the shell on:** on 2.1.319 a shell-on agent (the Work agent) gets no Glob or Grep, so the
  "Find files" and "Search in files" switches do nothing for it. The Work agent's shell already reaches files
  outside the fence by Gene's decision.
- **Import progress count:** a finished import job reports `done: 4, total: 5` (the report page is counted in
  `total`). This is cosmetic.
- **Launcher:** it needs a GUI toolkit unless `--browser` is given. A headless "serve only" flag would help scripted
  checks.

## Usage

About 25 real CLI turns in all:

- 17 live pytest runs, plus the 9-test rerun;
- 6 finding-18 probes and 1 control;
- 7 app chat turns;
- 1 Work run;
- 1 filing pass;
- 1 learning review.

## Gates (after the fixes, in the worktree)

| Gate | Result |
|---|---|
| `uv run pytest -q backend/tests` | 3292 passed, 16 skipped, 3 xpassed, 0 failed (exit 0) |
| `OBJECT_LIVE_CLAUDE=1 uv run pytest backend/tests/test_m17_live_cli.py` | 9 passed (29 s) |
| `OBJECT_LIVE_CLAUDE=1` m18, m19, m20 live files | 8 passed, 1 skipped (Windows only), in the first run |
| `npx vitest run` | 3989 passed, 1 skipped (529 files) |
| `npm run build` | clean |

The front end is unchanged on this branch. The acceptance scripts were not rerun.

## Lane G1 follow-up: the explicit `--tools` list (decisions memo S1)

Same box and CLI (2.1.319), branch `lane/g1-agent-tools`. Four short `haiku` turns, `--no-session-persistence`.

- **`--tools default` vs an explicit list.** Two direct probes in an empty scratch folder with the run's fixed flags,
  "Say hi.":
  - `--tools default`: `Task, Bash, CronCreate, CronDelete, CronList, DesignSync, Edit, EnterWorktree, ExitWorktree,
    ListAgents, Monitor, NotebookEdit, PushNotification, Read, RemoteTrigger, ReportFindings, ScheduleWakeup,
    SendMessage, Skill, TaskStop, ToolSearch, WebFetch, WebSearch, Workflow, Write` (no `Glob`, no `Grep`).
  - Every `BUILTINS` CLI name plus `Skill,ToolSearch`: `Task, Bash, Edit, Glob, Grep, NotebookEdit, Read, Skill,
    TaskCreate, TaskGet, TaskList, TaskUpdate, ToolSearch, WebFetch, WebSearch, Write`. Names this CLI doesn't have
    (`PowerShell` on Linux, `MultiEdit`, `Agent`, `TodoWrite`) are ignored without an error.
- **So the "No Glob or Grep with the shell on" observation above was a property of `--tools default`.** With the
  explicit list a shell-on run gets `Glob` and `Grep` beside `Bash`, and their switches work. A-1 (grey the two
  switches when the shell is on) is therefore not built; see the lane's report.
- `test_object_tool_is_callable` (one turn through `agentrun.build_run`, real `objectapp-mcp`): **PASS**. `init.tools`
  held the on built-ins, `Skill`, `ToolSearch`, the 25 Object read tools and the `object-agent` tools, and none of
  `CronCreate`, `RemoteTrigger`, `SendMessage`, `ScheduleWakeup`, `Workflow`, `Monitor`. The model called
  `ToolSearch`, then `mcp__object__search` (5 results), nothing refused.
- `test_builtin_names` (shell on, the explicit list): **PASS**, every row present, nothing offered outside the rows.
