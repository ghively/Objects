# M25 acceptance: provenance and re-runs

Status (2026-11-07): built 2026-11-06/07, one review and one fix pass, gated 2026-11-07; on `master`. Gene's 10 hand-checks below are unticked.

Design: `specs/2026-11-06-import-migration-design.md` sections 1, 2, 4, 5, 7, 10. Plan: `2026-11-06-m25-provenance-and-reruns.md`. Built 2026-11-07.

## How to run

- Back end: `cd backend && uv run pytest tests/test_m25_provenance.py tests/test_m15_import.py tests/test_m15_fixes.py tests/test_m15_contract.py -q` (the M25 tests use a fake `objectapp.readers`, so they don't depend on M26).
- Front end: `cd frontend && npx vitest run src/import src/object/ImportSourceLine.test.tsx && npx tsc -b --noEmit`.
- Acceptance script (HTTP, on a copy of a fixture space, synthetic data only): `cd backend && uv run python ../scripts/m25_acceptance.py [SPACE] [--keep]` (default `backend/tests/fixtures/space-sample`). Result on 2026-11-07: PASS, with M26's real readers installed (the fake `.docx`/`.pdf` bytes in the script are not valid files, so they become "Original only" pages; the script holds either way).

## What was built

- **`importSource`** (frontmatter map, a system key: `typedefs.SYSTEM_KEYS`): system, url, id, version, author, created, modified, original, contentHash, batch, importedAt, on every imported object. Per source: Obsidian and plain Markdown folders (`file:` url of the source copy, relative path, sha256, file date), Notion (page id, `notion.so` url), Anytype (frontmatter `id`, else path), Files (manifest, else path, hash, reader dates; `sharepoint` / `wiki` only come from a manifest line's `system`).
- **Source line** on the object page under the properties (`object/ImportSourceLine.tsx`): "Imported from X (author, modified, version)", **Open original** (web url, else the kept file), **Show file** (`POST /api/import/original/reveal`). Hidden without a block.
- **Queryable**: rows carry `importedFrom`, `importBatch`, `sourceModified`; filters, sorts and columns offer "Imported from", "Import batch", "Source modified".
- **Originals**: non-Markdown files of a Files source go to `Attachments/Originals/` byte for byte (100 MB limit: not copied, listed in the report, the Source line keeps the url). Option "Keep originals as" Attachments (default) or File objects.
- **Files kind** (`importers/files.py`): auto-detected by a `_manifest.jsonl` or when the source has no Markdown/CSV at all; Markdown pages use the Obsidian rules; every other file is one object; `.txt` is read directly, other formats through `objectapp.readers.read_file` when it exists. No readers, an exception or `original_only` gives an "Original only" page (a media/file block, listed in the report). Manifest `fields` become planned properties; the other keys fill `importSource`.
- **Re-runs**: before planning, the open space is indexed by `(system, id)`; matched objects keep their path. Same `contentHash`: unchanged. Source changed and the object untouched since the import: updated in place, the old content forced into version history. Source changed and object edited: "Changed in both", not written; the file it would have written waits in `pending/`; `POST /api/import/batches/{id}/resolve` `{action: take|keep, paths?}`. Not in the source any more: "Removed at source", never trashed. Attachments with the same bytes are reused. The last finished mapping for a source is reused in the next preview (falls back to defaults when it no longer fits).
- **Batches**: `.object/imports/<batch>/` (below); `GET /api/import/batches[/id]`; `POST .../trash` = **Move batch to Trash** (objects the batch created, not updated ones); **Try on a copy of this space** (target `{kind: "spaceCopy", name, location}`, wizard default on for a first run into this space).
- **Report**: counts that reconcile (source items = imported + updated + unchanged + changed in both + left out + failed), Originals, Conversion notes, Changed in both, Removed at source; an Object page in the space and `report.md` in the batch records. The finish step shows the same counts, Move batch to Trash and Take source / Keep mine.

## Deviations (our calls)

1. **File objects** are linked from the page by a line `Original: [[File object]]` at the end of the body, not by an "Original" relation property (a relation would add a property to every type that can hold an import; "don't invent schema").
2. **Source modified** is a text filter (ISO text, "contains 2026-10"), not a date filter; it is not a date property, so calendars don't offer it.
3. **"Edited in Object"** (call 5) is decided by comparing the file with the bytes the last import wrote there (recorded as `version` in `items.json`); only when there is no record does it use the file's mtime against `importedAt` (2 s tolerance).
4. **Changed in both** counts as its own bucket in the reconciliation (the design's equation has no slot for it); a stopped run's unwritten objects count under failed ("not written").
5. The preview does not show re-run counts (unchanged/updated/...); they appear when the run ends (finish step, report).
6. **Keep mine** records the new source hash and `importedAt` in the object's `importSource` (its only change), so the same source version is not flagged again.
7. A re-run that updates a Files object keeps the old original in `Attachments/Originals` and writes the new one beside it as `name (2).ext`.
8. **Try on a copy** copies the open space folder next to it (without `.object-cache` and `.git`); its name is asked in the wizard, its location is the open space's folder.
9. Images and the wizard's scan step belong to M26; the Files kind calls `objectapp.readers.read_file` only (tolerates its absence).

## For M27 (agent workflow)

- **Batch records**: `.object/imports/<batch id>/` with `batch.json` (`id, startedAt, finishedAt, source{path,kind,system}, target{kind,path}, mapping (effective ImportMapping), keepOriginals, counts{sourceItems, imported, updated, unchanged, changedInBoth, leftOut, failed, notWritten, unreadPages, removed, originals, pending}, stopped, reportPath, types, attachments, tags, trashedAt?}`), `items.json` (`sourcePath, system, id, title, path, action[created|updated|unchanged|conflict|resolvedTake|resolvedKeep|failed|trashed], contentHash, version, original, pending`), `attachments.json`, `removed.json`, `report.md`, `pending/<n>.md`. M26/M27 files (`scan.json`, `proposal.json`, `decisions.json`) go beside them; `importers/batches.py` has `list_batches`, `load_batch`, `load_prior`, `batch_dir`, `write_json`.
- **Mapping format** is the existing `ImportMapping` (`typeSource`, `typeKey`, `types{key: {name, pluralName, skip, existingTypeId}}`, `properties{type key: {prop key: {kind, isArray, name, skip}}}`), stored in `batch.json`.
- **Hooks**: `planner.plan(read, mapping, target, reuse=...)` (`reuse`: source path -> existing object path); `WriteState(keep_originals=..., batch=...)`; `provenance.ident/prov_for/block/index_space/read_block`; `writer._write_one` is where an object is created, updated or held back; `report.build_report(..., extra=...)` takes the new sections. `ReadObject.native` / `.prov` mark Files items and manifest data. Re-run matching is by `(importSource.system, importSource.id)` in the target space.

## Gene's hand-checks (unticked)

- [ ] Import a Markdown/Obsidian folder into a **copy** of the space ("Try on a copy of this space", the default for a first run); open an imported page: the **Source** line shows "Imported from Obsidian", and Open original / Show file behave (a folder source has no web link, so only a kept file would show them).
- [ ] Import a Files folder (a few `.docx`, `.pdf`, `.xlsx`, an image, a `.vsdx`) with a `_manifest.jsonl` giving a SharePoint url: each page opens with its text and images, the `.vsdx` is "Original only", **Open original** opens the SharePoint url, **Show file** shows the kept file in the file manager.
- [ ] "Keep originals as" File objects: each original also appears as a File/PDF/Image object, linked at the end of the page.
- [ ] Run the same import again: everything is unchanged, no duplicate pages or attachments; the report counts add up.
- [ ] Edit a source file, run again: that page updates in place and the old text is in Version history.
- [ ] Edit a page in Object, then change its source and run again: it is listed under **Changed in both** (finish step and report); **Take source** brings the source version (your edit is in Version history); **Keep mine** leaves it and the next run stays quiet.
- [ ] Remove a source file, run again: **Removed at source** lists it; the page stays.
- [ ] **Move batch to Trash** on a batch: the pages it created go to the Trash and can be restored; pages it only updated stay.
- [ ] In a query or a view filter, choose **Imported from**, **Import batch**, **Source modified**.
- [ ] A copy of a work export (outside the repo): the report's counts add up, and nothing in the source folder changed.
