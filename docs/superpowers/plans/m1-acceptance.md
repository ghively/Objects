# Milestone 1 acceptance

Plan: `2026-10-23-m1-shell-objects-editor.md`, Task 11. Date: 2026-10-23.

## Automated results

### Test suites

| Suite | Command | Result |
|---|---|---|
| Back end | `uv run pytest -q` | 86 passed |
| Front end | `cd frontend && npx vitest run` | 7 files, 56 tests passed |
| Type check | `cd frontend && npx tsc -b --noEmit` | clean |
| Build | `cd frontend && npm run build` | built (`dist/`, icon set is a lazy ~4.5 MB chunk) |

### Launcher smoke test

`uv run objectapp --space backend/tests/fixtures/space-sample --browser --port 8791`:

- `GET /api/space` returned 200 with the 5 inferred types (DailyNote, Page, Person, Server, Task).
- `GET /api/objects` returned the 11 fixture objects.
- `GET /` returned 200 `text/html` with `<title>Object</title>`: the built front end is served from `frontend/dist` on the same origin as `/api`.
- The process tree was stopped afterwards.

On first open, `Space` writes `.object/types/*.json` into a space that has none (by design, see `typedefs.load_types`). The smoke test therefore created that folder inside the fixture, and it was deleted again. Point the launcher at a copy, not at `backend/tests/fixtures/space-sample`, so the fixture stays pristine.

### Server write-path round trip (Steps 1–2)

`uv run python scripts/m1_roundtrip.py backend/tests/fixtures/space-sample` (runs against a temporary copy, which is committed to a scratch git repo):

```
No-edit pass: 11 objects, PUT statuses {200: 9, 423: 2} (423 = read-only, not written)
  0 files changed (byte compare); git diff --stat: (empty)

Edit pass (up to 10 objects):
  [ok] DailyNotes/2026-10-23.md   [ok] Pages/Alpha.md        [ok] Pages/Notes.md
  [ok] Pages/Untitled stem.md     [ok] Pages/What if.md      [ok] People/Ada Lovelace.md
  [ok] Servers/Alpha.md           [ok] Tasks/Fix printer.md  [ok] Tasks/Write docs.md

9 objects edited. git diff --stat:
 DailyNotes/2026-10-23.md | 5 +++--
 Pages/Alpha.md           | 5 +++--
 Pages/Notes.md           | 6 +++++-
 Pages/Untitled stem.md   | 4 +++-
 Pages/What if.md         | 4 +++-
 People/Ada Lovelace.md   | 5 +++--
 Servers/Alpha.md         | 5 +++--
 Tasks/Fix printer.md     | 5 +++--
 Tasks/Write docs.md      | 5 +++--
 9 files changed, 29 insertions(+), 15 deletions(-)

RESULT: PASS
```

What the numbers show:

- **No-edit pass:** 0 files changed. The two `423` responses are `Pages/Broken.md` (unterminated fence) and `Pages/Bad yaml.md` (invalid YAML). Both are read-only and were not written.
- **Edit pass:** the fixture has only 9 writable objects, so 9 were edited, not 10. For each one the script checks that the diff contains only these lines:
  - the edited body line
  - `lastUpdated` (replaced in place, or added if it was absent)
  - a new `id` line where none existed
  - for a file with no frontmatter, the new `---` fences around those keys

  It also checks that the BOM, the trailing newline and the line endings are unchanged. The `+3 -2` files had a `lastUpdated` to replace. The `+3 -1` files had none, so it was added.
- **`Tasks/Fix printer.md` (CRLF):** every changed line, the inserted `id` included, keeps `\r\n`.
- **`Pages/Notes.md` (no frontmatter):** gains a new `---` / `id` / `lastUpdated` / `---` block above the untouched body (`+5 -1`).

**Spec inconsistency found:** the plan's Review Focus #2 says an object with no frontmatter at all opens read-only and is never written. Task 3, however, defines `test_no_frontmatter_is_page_readonly_false`, and Task 4's `test_save_without_frontmatter_adds_id_and_lastUpdated` adds a frontmatter block on save. The implementation follows the task-level tests: an object with *malformed* frontmatter is read-only, but one with *missing* frontmatter is editable. Decide which behaviour you want before M2.

## Manual checks (Steps 3–4, for Gene)

- [ ] Copy `Object (2026-10-23 16-27-39).zip` and extract it **outside the repo**, e.g. `C:\Users\genehively\Object Spaces\CPI\`.
- [ ] Run `git init`, then `git add -A`, then `git commit -m base` in that folder so diffs are visible.
- [ ] (Optional) Run `uv run python scripts/m1_roundtrip.py "<that folder>"` from the repo. It works on its own temporary copy.
- [ ] Run `uv run objectapp --space "<that folder>"`. A 1440x900 window opens.
- [ ] The sidebar shows the 13 CPI types.
- [ ] An object opens in the peek, and the pager works.
- [ ] Editing a paragraph changes only that line in `git diff` (plus `lastUpdated`, and `id` if it was missing).
- [ ] An edit in VS Code while the app is open reloads in the app.
- [ ] Side by side with `docs/01-*.png` and `05-*.png`, the shell and peek look right.

Notes from the manual run:

-
