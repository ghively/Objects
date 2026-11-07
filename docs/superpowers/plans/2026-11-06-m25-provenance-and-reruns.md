# M25: provenance and re-runs (plan)

Design: `specs/2026-11-06-import-migration-design.md` sections 1, 2, 4, 5, 7, 10 (and the provenance of the four existing sources). Built on M15's importer (`backend/objectapp/importers/`, `api_import.py`, `frontend/src/import/`). M26 (readers, scan) is built in parallel in other files; M25 only calls `objectapp.readers.read_file` when it exists.

## Shape (smallest change to the M15 pipeline)

- **Provenance** (`importers/provenance.py`): `importSource` is one nested frontmatter block (system field, not a type property), written by the writer for every object. `contentHash` is the sha256 of the source file's bytes. Per source: Notion (page id + `notion.so` url), Obsidian/Markdown folder (`file:` url of the source copy, relative path, hash, file date), Anytype (object id), Files (manifest, else path/hash/dates).
- **Files kind** (`importers/files.py`): Markdown pages use the Obsidian reader; every other file (except `_manifest.jsonl`) is an object with `native="file"`. `_manifest.jsonl` fills `importSource` and `fields` (planned properties, like frontmatter). Body and images come from `objectapp.readers` at write time; no readers, a reader error or `original_only` gives an "Original only" page (media block).
- **Originals**: non-Markdown sources are kept in `Attachments/Originals/` (over 100 MB: not copied, listed). Option `keepOriginals`: `attachments` (default) or `fileObjects` (File/PDF/Image object per original, linked from the page).
- **Re-runs**: before planning, the target space is indexed by `(system, id)`; the planner reuses a matched object's path (no `(2)` names). The writer classifies each: unchanged (same hash), updated (source changed, object untouched since the import: written through the history snapshot), changed in both (not written; the new bytes wait in the batch records), new. Removed at source (earlier batch of the same source, not seen now) is listed, never trashed. `POST /import/batches/{id}/resolve` applies Take source / Keep mine.
- **Batches** (`importers/batches.py`): `.object/imports/<batch>/` holds `batch.json`, `items.json`, `attachments.json`, `report.md`, `pending/`. `POST /import/batches/{id}/trash` moves what the batch created to the Trash. `GET /import/batches`. The last mapping for a source is reused in the preview.
- **Try on a copy**: target `{kind: "spaceCopy", name, location}` copies the open space to a new folder, imports there, registers it.
- **Report** (`importers/report.py`): counts that reconcile (source items = imported + updated + unchanged + changed in both + left out + failed), originals, conversion losses, Changed in both, Removed at source.
- **Queries**: rows carry `importedFrom`, `importBatch`, `sourceModified` (labelled "Imported from", "Import batch", "Source modified" in filters).
- **UI**: Source line on the object page; "Keep originals as" and "Try on a copy of this space" in the wizard's review step; reconciled counts, Move batch to Trash and Take source/Keep mine on the finish step; Files in the kind list.

## Tasks (TDD, each with its own tests)

1. Provenance module + writer block + Markdown/Obsidian/Notion/Anytype provenance. 2. Originals + Files kind + manifest. 3. Re-runs + planner reuse + resolve. 4. Batches, trash, copy, mapping reuse, report, API. 5. Queryable fields. 6. Frontend (types, api, Source line, wizard options, finish step). 7. `scripts/m25_acceptance.py`, `m25-acceptance.md`.
