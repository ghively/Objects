# Milestone 2 acceptance

Plan: `2026-10-23-m2-types-properties.md`, Task 20. Date: 2026-10-26.

## Automated results

### Test suites

| Suite | Command | Result |
|---|---|---|
| Back end | `uv run pytest backend/tests -q` | 349 passed |
| Front end | `cd frontend && npx vitest run` | 33 files, 233 tests passed |
| Type check | `cd frontend && npx tsc -b --noEmit` | clean |
| Build | `cd frontend && npm run build` | built (`dist/`) |

One flaky front-end test: `editor/preserve.test.ts > 1MB body splits under 300ms` failed once while the back-end suite had just loaded the machine. It passed alone and in the next full run. It is a timing budget, not a logic failure.

### Fixtures added

- `space-sample/Projects/Object app.md`: every Project property form, plus the alias link and the inline-code link in the body.
- `space-sample/Tags/Docs.md`: a tag with `color: bg-blue`.
- `space-sample/Templates/Tasks/Bug report.md`: a Task template with a `{date:…}` title.
- `space-sample/Attachments/cover.png`: a generated 4x4 PNG.
- `space-v1/`: the M1 sample space plus the `.object/types/*.json` that M1 wrote. It was produced by running M1's `load_types` from commit `9214781` in a temporary worktree.

**Deviation: tests were not adjusted by counts.** The new folders broke 24 unit tests. Most of those tests assert that `Tags/` or `Templates/` don't exist yet, or they create their own `Projects/` type. Changing counts would not have fixed them. Instead, `conftest.space_dir` now copies `space-sample` without the four M2 folders, so it is still the M1 sample the tests were written against. A new `full_space_dir` fixture copies everything. `test_fixtures_m2.py` checks the full sample: the Project kinds are inferred, the tag colour is read, the template is discovered and kept out of the object list, `kickoff` in the export's form decodes as a day, and opening writes no `.md` file.

### `scripts/m2_acceptance.py`

The script works on a temporary copy that is committed to git before the first open. On `space-v1`, which has no Project type, Bug report template or cover image, it creates those over the API first. The same applies to any real export.

`uv run python scripts/m2_acceptance.py backend/tests/fixtures/space-sample`: **PASS** (52 checks).
`uv run python scripts/m2_acceptance.py backend/tests/fixtures/space-v1`: **PASS** (50 checks).

| # | Check | space-sample | space-v1 |
|---|---|---|---|
| 1 | Migration, objects untouched, a second open writes nothing | 7 v2 type files, 0 `.md` changed | 6 v2 type files, 5 exact v1 backups, 0 `.md` changed |
| 2 | One property of each kind (22 edits, by `git diff -U0` hunk → key) | all [ok]; `kickoff` stays `2026-04-01T00:00:00.000Z -> 2026-04-02T00:00:00.000Z` | all [ok]; absent keys add only their own lines |
| 3 | Rename Ada Lovelace → Ada King | relinked = link-only files = `Projects/Object app.md`, `Servers/Alpha.md`, `Tasks/Write docs.md`; `members: ['[[Ada King]]', '[[Alpha]]']`; `[[Ada King\|Ada L]]` kept; inline code untouched | same 3 files |
| 4 | `Pages/Notes.md` → Task | `Tasks/Meeting notes.md` with a new `id`; `[[Meeting notes]]` resolves | same |
| 5 | Default template, then create, delete, restore and empty Trash | `Tasks/Bug 2026-10-26.md` from Bug report; the restore is byte-identical | same, with a template made over the API |
| 6 | Tag Math, ensured and renamed | `People/Ada King.md: tags: [Mathematics]` | same |
| 7 | Status option rename with no confirm; delete of an in-use option | 200; 428 (`affected: 1`), then 200 | same |
| 8 | Server → Machine; delete and restore Project | `type: 'Machine'` with the quotes kept, `formerNames` has Server; the restore is byte-identical | same |
| 9 | M1 no-edit pass | 14 objects, `{200: 12, 423: 2}`, 0 files changed | 13 objects, 0 files changed |
| 10 | Stems ≠ `safe_filename(title)`; unbundled icon prefixes | both empty | both empty |

### End-to-end API check (the built app on port 8791)

The built app ran on `127.0.0.1:8791`, started with `build_server_config(Space(copy of space-sample), port=8791)` with `frontend/dist` served. Each new route was called with curl:

- `GET /`, `/api/space`, `/api/objects?type=project` and `/api/object` (with `links`) each returned 200.
- `PUT /api/object/properties` returned 200. A stale `baseVersion` returned 409 `{currentVersion}`.
- `ensure-id`, `GET change-type`, `GET /types/task/templates`, `POST /objects` (201), `DELETE /object`, `GET /trash`, `restore`, `POST /types` (201), `DELETE /types/meeting` (428, then 200 with `confirm=true`), `DELETE /trash`, `tags/ensure`, `GET /images`, `GET /file` and `POST /images` (201) all behaved as specified.
- `change-kind`, `sync` and `PUT /types/{id}` returned 409 `{currentRevision}` on a stale revision, and 200 on the current one.
- `apply-template` returned 200, and `rename` returned 200 with `relinked`.
- `/api/events` carried the `types`, `changed` and `renamed` (with `oldPath`) events, each with the request's `clientId` as `origin`. The watcher added nothing for the app's own writes.
- Afterwards the server was stopped. Nothing listens on 8791, and no stray Python processes are left.

The front-end client (`frontend/src/api/client.ts`) and the server routes matched for every route in the contract: paths, methods, body fields, query parameters and response shapes. No wiring change was needed.

**Bug found and fixed (`backend/objectapp/watcher.py`).** Emptying a Trash that holds a type entry deletes `.object/trash/types/<id>/` while watchdog is still reporting the files inside it. On Windows, `Path.resolve()` then raises `OSError` (WinError 1168). That error killed the watcher thread, so external edits were no longer noticed until a restart. The watcher now falls back to the plain absolute path. The regression test is `test_watcher.py::test_relpath_survives_vanished_parent`.

## Hand-run checks (Steps 4–5, for Gene)

### On a copy of the sample (Step 4)

- [ ] Run `cd frontend && npm run build`, then copy `backend/tests/fixtures/space-sample` outside the repo and run `git init`, then `git add -A`, then `git commit -m base` in the copy.
- [ ] Run `uv run objectapp --space "<copy>"` for the native window, where Ctrl+N reaches the page.
- [ ] "+ New" → Task → type a title. The object opens with the title focused.
- [ ] Ctrl+N creates an object of the current type.
- [ ] Ctrl+Backspace while typing in the title deletes a word, not the object.
- [ ] Edit every property kind on `Projects/Object app.md`: number, progress, boolean, url, date range, day-form `kickoff`, entity single and multi, label, text. Each `git diff` shows only that key (plus `lastUpdated`, and `id` the first time).
- [ ] Add an icon, a description and a cover image (`Attachments/cover.png`).
- [ ] Rename a title (for example "Ada Lovelace"). The count of relinked files is shown, and the referring files' `git diff` shows only link text.
- [ ] Project settings: a Number in EUR with "Separator comma".
- [ ] Project settings: a Label set with options and colours.
- [ ] Project settings: "Two-way linking" with 'Create property'. The counterpart appears on the target type.
- [ ] Each page layout (profile, index card, encyclopedia), with wide mode and cover crop on and off.
- [ ] Create a type "Meeting", delete it, then restore it from the Trash. Its settings come back.

### On the CPI copy (Step 5)

Use a copy outside the repo, with `git init` and a base commit done there.

- [ ] Run `uv run python scripts/m2_acceptance.py "<CPI copy>"` and paste the step-10 lists below.
- [ ] All 13 types migrate (Weblinks and Files as basic types), and each type's settings open.
- [ ] A property edit gives a one-line `git diff` (plus `lastUpdated`).
- [ ] A rename relinks and shows the count.
- [ ] Side by side with Object: Object Type Settings look and read the same.
- [ ] Side by side with Object: the property menus (add property, kind change, number format, label options) look and read the same.
- [ ] Side by side with Object: the page layouts look and read the same.

Step-10 lists from the CPI copy, and what was done about them:

-

Notes from the manual run:

-
