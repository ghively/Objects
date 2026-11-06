# M17 CLI spike (Task 1)

Run 2026-11-06 on Gene's PC against the installed Claude Code CLI **2.1.317** (`claude --version`),
under Gene's own login, with the plan's `CLI_FLAGS`, `--model haiku`, `--no-session-persistence` and
`--debug-file`. Test file: `backend/tests/test_m17_live_cli.py` (skipped unless `OBJECT_LIVE_CLAUDE=1`).
Each run used a temp agent folder under a temp state dir, an empty `--mcp-config`
(`{"mcpServers": {}}`), a `--settings` file holding `{"autoMemoryEnabled": false, "permissions":
{"deny": [...]}}`, and the environment minus `CLAUDE_CONFIG_DIR` and minus the variables a parent
Claude Code session sets (see "Environment" below).

## Gene's decision (2026-11-06)

Gene's answer to the stop-and-ask below: "Yes, add and continue". **`claudeMdExcludes` is adopted.**
Every agent run's `--settings` file (`run-settings.json`) now holds

```jsonc
{
  "autoMemoryEnabled": false,                       // agentrun.RUN_SETTINGS_BASE
  "claudeMdExcludes": [ ... ],                      // agentrun.claude_md_excludes(own, Path.home())
  "permissions": {"deny": [ ... ]}                  // the fence
}
```

The excludes' form (`claude_md_excludes(own, home)`, plan Contract, Turn runner): absolute paths
from the resolved (long-form, never 8.3) folders, with `/` separators and duplicates removed, in
this order:

1. `<home>/.claude/CLAUDE.md` and `<home>/.claude/rules/**` (Gene's user instructions);
2. for every ancestor folder `a` of the agent folder, from its parent up to the drive root:
   `a/CLAUDE.md`, `a/.claude/CLAUDE.md`, `a/CLAUDE.local.md`.

The agent folder's own `CLAUDE.md` is never in the list, so it is the only instruction file that
loads. A contributor's `parts.settings` can extend the list, never replace it. For example, on the
re-run the list began `C:/Users/genehively/.claude/CLAUDE.md`,
`C:/Users/genehively/.claude/rules/**`, `<tmp>/state/agents/CLAUDE.md`,
`<tmp>/state/agents/.claude/CLAUDE.md`, `<tmp>/state/agents/CLAUDE.local.md`, `<tmp>/state/CLAUDE.md`
and ended `C:/CLAUDE.md`, `C:/.claude/CLAUDE.md`, `C:/CLAUDE.local.md`.

`test_m17_live_cli.py::test_claude_md_excludes_list` and `::test_claude_md_excludes_home_inside_ancestors`
(not live, they always run) pin the list; T4's `test_run_settings_keep_user_instructions_out` pins
that `build_run` writes it. The live test's run environment also drops `agentrun.RUN_ENV_DROP` (plus
`BAGGAGE`).

### The re-run (2026-11-06, CLI 2.1.317, haiku, `--no-session-persistence`)

`OBJECT_LIVE_CLAUDE=1 uv run pytest backend/tests/test_m17_live_cli.py -q -s`: **6 passed** (the four
live tests and the two list tests), with the run settings above. The make-agent setup now plants
four ancestor instruction files carrying the ancestor marker: `<state>/CLAUDE.md`,
`<state>/.claude/CLAUDE.md`, `<state>/agents/CLAUDE.md` and `<state>/agents/CLAUDE.local.md`.

- `test_user_setup_never_reaches_a_run`: **pass.** Asked without tools to list the instruction files in
  its context, the model answered its soul marker and only
  `<tmp>\state\agents\Spike\CLAUDE.md`. Neither Gene's user `CLAUDE.md` nor any planted ancestor file
  was listed, and the ancestor marker was not in the answer. The debug log shows one
  `InstructionsLoaded` dispatch (four before the excludes). The other checks still hold: no plugin
  outside `@builtin`, no user skill (`init.skills` holds only the CLI's bundled skills), `mcp_servers`
  empty, user deny rules replaced with 0 rules, 0 hooks registered, no auto-memory folder in the log.
- `test_folder_hook_runs`: pass.
- `test_fence_is_enforced`: pass. Read was refused ("File is in a directory that is denied by your
  permission settings."), Grep and Glob were refused ("Permission to read <folder> has been denied."),
  and the secret text appeared in no event. The unfenced Read worked.
- `test_builtin_names`: pass. `init.tools` was the same list as below; the To-do list row was absent
  from this run, as the spike allows.

The stop-and-ask is answered: the build goes on with T2-T11.

## Result of the first run: stop-and-ask (answered above)

**Gene's user `CLAUDE.md` reaches an agent run.** With `--setting-sources project,local`, the CLI
still gives the model `C:\Users\genehively\.claude\CLAUDE.md` (Gene's user instructions: his name,
email, role and preferences), plus every `CLAUDE.md` in an ancestor folder of the agent folder. The
model, asked without tools to list the instruction files in its context, answered:

```
C:\Users\genehively\.claude\CLAUDE.md
<tmp>\state\CLAUDE.md               (planted ancestor file)
<tmp>\state\agents\CLAUDE.md        (planted ancestor file)
<tmp>\state\agents\Spike\CLAUDE.md  (the agent's own soul)
```

and it obeyed the planted ancestor files ("ANCESTOR-MARKER-5K9" in its answer). The debug log names
no `CLAUDE.md` file, but shows four `InstructionsLoaded` hook dispatches, which matches the four files.
Reproduced three times: with this session's environment, with the parent-session variables removed,
and through pytest (`test_user_setup_never_reaches_a_run` fails on the `~/.claude/CLAUDE.md` check).

Per the spec (section 3) and the plan (Global Constraints, Task 1 Step 4), the build stops after T1
and asks Gene. Nothing was worked around: the run settings Object uses are unchanged.

### A setting that keeps them out (tested, not adopted)

Adding to the run's `--settings` file

```json
"claudeMdExcludes": ["C:/Users/genehively/.claude/CLAUDE.md", "<state>/CLAUDE.md", "<state>/agents/CLAUDE.md"]
```

left only the agent's own `CLAUDE.md` in the model's context (one run, same probe). The plan lists a
`claudeMdExcludes` entry as an allowed fix, but this task's instructions say not to work around a
leak of Gene's user setup, so it is recorded here for Gene to decide. If he takes it, the open points
are: the excludes must name the user file and every ancestor folder's `CLAUDE.md` (and
`.claude/CLAUDE.md`, `CLAUDE.local.md`) up to the drive root, or use a glob that spares only the
agent's own folder; and the live test should then pass unchanged.

## Each check

| Check | Result |
|---|---|
| User `CLAUDE.md` (`~/.claude/CLAUDE.md`) | **Reaches the run** with `--setting-sources` alone (above). Kept out by `claudeMdExcludes` (Gene's decision, re-run passed). |
| An ancestor folder's `CLAUDE.md` | **Reaches the run** with `--setting-sources` alone (above). Kept out by `claudeMdExcludes`, as are an ancestor's `.claude/CLAUDE.md` and `CLAUDE.local.md` (re-run passed). |
| User skills (`~/.claude/skills/`) | Kept out when the agent folder's path is a long path: debug log "Loading skills from: ... user=C:\Users\genehively\.claude\skills, project=[]" and "Loaded 0 unique skills (... user: 0, project: 0 ...)"; `init.skills` holds only the CLI's bundled skills. **But** with the folder under the 8.3 form of `%TEMP%` (`C:\Users\GENEHI~1\...`), the CLI walked up to `C:\Users\GENEHI~1\.claude\skills`, did not see it as the user folder, and loaded all 7 of Gene's skills as *project* skills. The real state dir (`%LOCALAPPDATA%`) is a long path, so `agentrun` must run in the resolved (long) folder path; the live test resolves its temp folder. |
| Plugins | None of Gene's 30 installed plugins load ("Found 6 plugins (5 enabled, 1 disabled)"; "Total plugin skills loaded: 0"). `init.plugins` is not empty: it lists five `cc-plugin-*@builtin` plugins the CLI binary carries, which are not Gene's setup. The live test checks that no plugin outside `@builtin` loads (the plan's "plugins is empty" can't hold on this CLI). |
| User hooks | None run: "Registered 0 hooks from 5 plugins"; no command hook from `~/.claude/settings.json` in the log. |
| The folder's own hook | Runs: a `SessionStart` command hook in the folder's `.claude/settings.json` wrote its marker file (`test_folder_hook_runs` passes). |
| User permission rules | Not loaded: "Replacing all deny rules for destination 'userSettings' with 0 rule(s)"; the folder's rules load as `projectSettings`. |
| Auto-memory | Off with `"autoMemoryEnabled": false` in the run settings: no `~/.claude/projects/.../memory` path in the log. `agentrun`'s run settings must carry it. |
| MCP servers | `init.mcp_servers` is `[]` with `--strict-mcp-config` and an empty config: no claude.ai connector and no user server joins. |
| The fence (Read, Grep, Glob) | **Holds.** `Read(//c/Users/.../My Notes, space/**)` and `Edit(...)` in the `--settings` file's `permissions.deny` (a folder name with a space and a comma) denied Read ("File is in a directory that is denied by your permission settings."), Grep and Glob ("Permission to read <folder> has been denied."); the secret text appeared in no event. A Read of an unfenced temp file worked without `--add-dir`. The `//c/...` rule form (drive lower-cased, `/` separators) is right; no `Write(...)`, `Grep(...)` or `Glob(...)` forms are needed (`test_fence_is_enforced` passes). |
| Sandbox | None usable: `--help` has no sandbox flag and the debug log mentions none on native Windows, so the shell stays off by default. |

## Built-in tool names (2.1.317 `init.tools`)

With the shell allowed and nothing denied by name:

```
Task, Bash, CronCreate, CronDelete, CronList, DesignSync, Edit, EnterWorktree, ExitWorktree, Glob,
Grep, ListAgents, Monitor, NotebookEdit, PowerShell, PublishPlugin, PushNotification, Read,
RemoteTrigger, ReportFindings, ScheduleWakeup, SendMessage, ShareOnboardingGuide, Skill, TaskStop,
ToolSearch, WebFetch, WebSearch, Workflow, Write
```

Other runs also listed `TaskCreate`, `TaskGet`, `TaskList` and `TaskUpdate`.

- Every `BUILTINS` row except the to-do list has at least one name present (`Bash`/`PowerShell`,
  `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebSearch`, `WebFetch`, `Task`, `NotebookEdit`). `MultiEdit`
  and `Agent` are not offered by this CLI; they stay in their rows for other versions.
- **`TodoWrite` does not exist in 2.1.317.** Its to-do list is `TaskCreate`/`TaskGet`/`TaskList`/
  `TaskUpdate`, offered only in some runs. The To-do list row's `cli` is now
  `("TodoWrite", "TaskCreate", "TaskGet", "TaskList", "TaskUpdate")` (a changed `cli` tuple, which the
  plan allows); `test_builtin_names` lets that one row be absent from a run.
- `Bash` and `PowerShell` drop out of `init.tools` when the folder's `.claude/settings.json` denies
  them, so a switched-off shell isn't even offered.
- `ALWAYS_ALLOWED` stays `("Skill",)`. Open for T4/T11 to check with the real `objectapp-mcp`
  connected: the CLI defers MCP tools behind `ToolSearch` ("ToolSearch ... result=true" in the log),
  so `ToolSearch` may need to join `ALWAYS_ALLOWED` for the Object tools to be callable under
  `dontAsk`.
- The other names (`CronCreate`, `SendMessage`, `Workflow`, `RemoteTrigger`, `PublishPlugin` and the
  rest) are on with `--tools default` and aren't switches. Under `--permission-mode dontAsk` a tool
  not in `--allowedTools` is refused if it needs a permission; whether each of these needs one was
  not checked here.

## Environment

The spike ran inside a Claude Code session, whose variables (`CLAUDECODE`, `CLAUDE_CODE_*`,
`CLAUDE_AGENT_SDK_*`, `CLAUDE_PLUGIN_ROOT`, `AI_AGENT`, ...) a child `claude` inherits: with them the
child reported `entrypoint: claude-desktop` and offered the desktop host's own tools (`Artifact`...).
The live test removes them, as Object started on its own would have none. If Object is ever started
from inside a Claude Code terminal, `build_run`'s environment (today `os.environ` minus
`CLAUDE_CONFIG_DIR`) would pass them on; that is for Gene or T4 to decide, not changed here.

## Live test status (first run; for the re-run see "Gene's decision" above)

`OBJECT_LIVE_CLAUDE=1 uv run pytest backend/tests/test_m17_live_cli.py -q -s`:

- `test_folder_hook_runs`: pass
- `test_fence_is_enforced`: pass in 2 of 3 runs; in the third, haiku skipped the Grep call it was
  asked to make, so the test failed on "Grep wasn't tried" (the model's choice, not the fence: every
  call it did make on the space was denied)
- `test_builtin_names`: pass (with the To-do list row allowed to be absent)
- `test_user_setup_never_reaches_a_run`: **fails** on Gene's user `CLAUDE.md` (the stop-and-ask above)

## The Object tool under `dontAsk` (T11, 2026-11-06)

`OBJECT_LIVE_CLAUDE=1 uv run pytest backend/tests/test_m17_live_cli.py -q -s -k object_tool` (CLI
2.1.317, `haiku`, `--no-session-persistence`): one turn built by `agentrun.build_run` (the default
agent, `write=False`, a `read` token) with the real `objectapp-mcp` against a temp copy of
`space-sample` served on `127.0.0.1`, asked to search the notes for "Ada".

- `init.tools` lists all 20 Object read tools and `mcp__object-agent__agent_info`, and `ToolSearch`.
- The model called `ToolSearch` first (its result was empty text, not an error), then
  `mcp__object__search`, which ran and answered 5 results. Nothing was refused.
- So `ToolSearch` is offered under `--tools default` and isn't refused under `dontAsk` without being
  in `--allowedTools`: `toolcatalog.ALWAYS_ALLOWED` stays `("Skill",)`.
  `test_object_tool_is_callable` holds the check.

The whole live file then passed once through `agentrun`'s own names (7 passed in 96 s).
