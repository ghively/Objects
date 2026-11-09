# Git-backed spaces: version control, backup and rollback

2026-11-08. Gene: "I want the entire object workspace gitbacked for backup to github or lab and version control
and rollbacks." Built on branch `lane/f-git-backed-spaces`. Behaviour and labels: `docs/behavior-catalog.md`
section 12. This note records the design, the safety rules and where the build deviates from the decisions it was
given.

## Shape

- **One git repository per space folder** (spaces can live anywhere; the registry is `<state dir>/spaces.json`),
  plus an optional one for the per-user state folder ("Back up agents and settings").
- **Off until turned on**, per space (Settings > Space > Version control) or for every registered space at once
  (Settings > Offline & Sync > Back up all spaces). Opening a space never writes anything.
- **Remote-agnostic**: any git remote address (https or ssh). Auth is the system's git credentials only.
- **Three layers of history**: M8 saved versions (fine-grained, per object, in the state dir), git commits (the
  whole space, debounced), and the remote (backup off the machine).

## Modules

| File | Role |
|---|---|
| `backend/objectapp/vcs.py` | Every git call: `run` (list args, no shell, `cwd` pinned, timeouts, `GIT_TERMINAL_PROMPT=0`, `GIT_SSH_COMMAND` with `BatchMode`, `GIT_OPTIONAL_LOCKS=0` for reads, `GIT_LITERAL_PATHSPECS=1`, `protocol.ext.allow=never`, waits out `index.lock`), status parsing, `commit_paths`, `restore_tree`, log/diff/file reads, remotes, fetch, fast-forward, push. |
| `backend/objectapp/vcsservice.py` | `VcsService` (one per app): settings (`<state dir>/vcs.json`, keyed by the space's stable id), run state (`vcs-status.json`), enabling/adopting, the debounced worker, commit/push/fetch, restore, status. |
| `backend/objectapp/api_vcs.py` | `/api/vcs/*` routes and the index reload after a restore or pull. |
| `backend/objectapp/spaceconfig.py` | `space_id` / `ensure_space_id` (`spaceId` in `.object/space.json`). |
| `backend/objectapp/history.py` | M8 history keyed by the space id (legacy path-keyed folder read, then moved). |
| `backend/objectapp/jsonstore.py`, `typemodel.py`, `space.py` | The version-history hook runs before definition saves (types, collections, queries, views). |
| `frontend/src/api/vcsClient.ts` | The client for `/api/vcs`. |
| `frontend/src/settings/sections/VersionControl.tsx` | Settings > Space > Version control. |
| `frontend/src/settings/sections/OfflineSync.tsx` | Backup rows (all spaces; agents and settings). |
| `frontend/src/vcs/` | Space history page (`spaceHistory` target), sidebar backup line, status store, strings. |
| `frontend/src/history/VersionHistoryDialog.tsx` | "In version control" list with per-file restore. |

## Committing

- The worker ticks every 10 s. For each repository that is on (the open space, other registered spaces that are
  on, the state folder) it reads `git status --porcelain=v1 -z --untracked-files=all` and fingerprints the changed
  paths with their mtime and size. A change to the fingerprint (another program's edit) or an app write (a space
  listener calls `touch`) restarts the wait; after `commitDelaySeconds` (default 120) of quiet it commits.
- The app's stop (space switch, close, quit) commits whatever is pending. It does not push (the next start does).
- **Staging is by explicit path.** Object's paths are the status entries whose index side is clean (unstaged
  edits, deletions, untracked files). An entry another program staged is left staged; Object's commit is
  `git commit --only --pathspec-from-file`, so those entries stay in the index. `.git/object-staged` records the
  paths Object is staging, so an interrupted commit's own entries are recognised next time.
- `git add -A` runs only over the paths whose working copy differs (a path already staged as deleted can't be added).
- The space's write lock (`Space._lock`) is held while staging and committing, so no app write is half done.
- `.git/index.lock`: git calls retry for up to 10 s, then report "Another git program is using this repository";
  the lock is never deleted.
- No commit during a merge, rebase, cherry-pick or revert, or on a detached HEAD (reported as a warning).
- Hooks are skipped and commits unsigned (`--no-verify`, `commit.gpgsign=false`): a background commit must never
  block on a hook or a pinentry prompt.
- Author: the user's `user.name` / `user.email`, else `Object <object@localhost>` (per-command `-c`, never written
  to any config).

## Remote

- The address lives in git's own config (`git remote add/set-url`); Object's settings keep only the remote name,
  branch and "push automatically". Clearing the address in Object stops using it and leaves git's remote alone (an
  adopted repository's `origin` is never touched). Addresses starting with `-` or using `ext::` are refused.
- Push: after a commit, once `pushDelaySeconds` (default 600) has passed since the first unpushed commit; "Push
  now" commits first. Every push fetches first; when the remote has commits this repository hasn't, nothing is
  pushed ("Remote has diverged …" or "The remote has N new commits"). Never `--force`.
- On start (off the request path): fetch; fast-forward (`merge --ff-only`) only when Object has nothing uncommitted
  and the remote is strictly ahead; the space's index reloads for the changed paths. Diverged: reported, left alone.
- Ahead/behind come from the remote-tracking ref (updated by fetch and push), so status needs no network.

## Rollback

- **Restore space to this point** (`POST /api/vcs/restore`): commit pending changes, refuse if another program has
  staged changes, `git restore --source=<sha> --staged --worktree -- .` (tracked files only; paths added since are
  removed; untracked and ignored files are untouched), put the space id and the managed `.gitignore` block back,
  commit as "Object: restore to <short> (<date>)". Never `reset`, never rewrites history. The index reloads
  (`rescan_file` per changed object, types refreshed, collections reloaded) and the clients get resync events.
- **One object** (`POST /api/vcs/file-restore`): checks the object's version (409 when it changed), commits pending
  changes, writes the commit's bytes through `Space._write_exact` (so M8 keeps the current state as a version and
  the object keeps its id and title, as an M8 restore does), commits that one path.

## M8 history fixes

- (a) The history folder is `<state dir>/history/<space id>`. The id is generated when version control is turned on
  or on the next app save in a space that already has `.object/space.json` (an ordinary edit never adds a file to
  the space). Until a space has an id its old `sha1(path)` folder is read; the first write after the id exists
  moves that folder. Reading never writes.
- (b) Definitions: `JsonStore.write` (collections, queries, views) and `write_type_json` (types, via
  `Space._write_type_json`) call the same version-history hook with the file's bytes before each save.
  `GET /api/history/definition?path=.object/<kind>/<id>.json` lists them, `.../definition/version` reads one.

## Agents and settings

- The state folder's repository's managed `.gitignore`: `secrets.json`, `*secret*`, `*token*`, `*credential*`,
  `*.pem`, `*.key`, `.env*`, `.mcp.json`, `settings.local.json`, `history/`, caches, logs, `*.jsonl` (ledgers and
  activity logs), automation logs and schedule state, reminder ledgers, work queues and alert state, agent chat
  sessions and usage, the agents' trash and `vcs-status.json`.
- `is_secret_path` drops any secret-looking path (and `history/`) from staging even when the `.gitignore` block is
  edited away (tested).

## Safety summary

- No shell; list args; `cwd` pinned; a timeout on every call (30 s local, 120 s network).
- Never `reset --hard`, `push --force`, `rebase`, `clean`, or deleting `index.lock`.
- Git missing: the status says so, enabling answers 422 "Git isn't installed on this device, so version control
  stays off.", nothing else changes.
- Agent runs can't reach `/api/vcs` (the run fence covers every `/api` route except `/api/v1` with a token); no MCP
  tool was added.

## Deviations from the decisions

- **A folder inside another repository**: adopted only when the space folder is that repository's top. When a
  repository in a parent folder already tracks files in the space folder, enabling is refused (a nested repository
  would hide those files from it); an unrelated parent repository (one that tracks nothing in the folder) doesn't
  stop a new repository in the space folder.
- **Space id on an app save** is written only when `.object/space.json` exists, so an ordinary edit never creates a
  file in a space that has none (an existing test pins that); such spaces get the id when version control is
  turned on.
- **Definition versions** are kept and listed (API) but restored through git (Space history or the object's git
  versions), not through the M8 restore route, and there is no definition-history UI yet.
- **Delays** (`commitDelaySeconds`, `pushDelaySeconds`) are app-wide, not per space.
- **Hooks and signing** are skipped for Object's commits (see Committing).
- The push timer counts from the first unpushed commit (a throttle), not from the last commit, so a long editing
  session still gets backed up.
