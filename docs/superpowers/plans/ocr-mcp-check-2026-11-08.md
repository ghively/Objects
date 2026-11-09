# OCR, MCP under Claude Code, Anytype and SharePoint: a live check (2026-11-08)

Lane B of the 2026-11-08 check. Branch `lane/b-ocr-mcp` off `master` `da12f82`. Everything ran on a scratch copy of
`backend/tests/fixtures/space-sample`, served on `127.0.0.1:8802` with `OBJECT_STATE_DIR` in a scratch folder. All
input files are synthetic (made up text drawn into images); no real data.

## Results

| Check | Result | Evidence |
|---|---|---|
| OCR of scanned PDFs through a Files import | PASS | 5 PDFs (Flate, JPEG/DCT, CCITT G4, JPEG 2000, Pillow's DCT), 1 and 2 pages: every page's text in the object, report says `Needs OCR: read with the local OCR engine` |
| OCR text is searchable | PASS | `/api/search?q=Zebrafish` answers all 5 scans; `Marmalade` (page 2) answers the two 2-page scans |
| OCR text goes through the sensitive scan | PASS | `POST /api/import/scan` on a scanned PDF holding `password: …` and `api_key = …` flags 2 `password` findings |
| OCR test that skips without tesseract | ADDED | there was none; `backend/tests/test_ocr_import.py::test_scanned_pdf_is_ocrd_and_searchable` (skips without `tesseract` + `eng`) |
| MCP tools listed under a real `claude -p` (read token) | PASS | 25 read tools listed, no write tools; whoami over HTTP answers `scope: read` |
| MCP search / query / peek / read correct | PASS | search `Wombatpublic` -> `Pages/Lane B Public.md`; query `title contains "Lane B"` -> 1 row; read body verbatim (trailing spaces kept) |
| "Exclude from AI" never returned | PASS | frontmatter `excludeFromAI: true` and tag `[[Exclude from AI]]` objects: absent from search (auto/title/fullText), query, tag query, peek links, backlinks, unlinked mentions, changes, trash; `read` answers 404 |
| MCP read-write: one careful edit lands only its own lines | PASS (after fix 2) | `append_to_section` under `Checklist`: diff is the new line + `lastUpdated` (+ `id` on the first write of a file that had none, by design: `Space.ensure_id`); CRLF and trailing spaces kept; stale version answers 409; activity log lists the write under `lane-b-rw` |
| Token secrets kept out of the state folder | PASS | grep of the scratch state dir for `obj_` finds nothing |
| Anytype reader against the current export format | NOT VERIFIED (gap found) | no real export; compared with Anytype's exporter source, see below |
| SharePoint fetching | NOT BUILT (by design) | no fetch code exists, see below |

## Bugs found and fixed

1. **`fix(import)`: "Original only" reported three times per file** (`importers/writer.py`). An image in a Files import
   listed `Original only: no readable page could be made`, `Original only` and `Original only` in the report (the
   reader's note, the Files page's appended note, the writer's line). The writer now drops the bare note when it
   writes its own line and lists each note once. Regression test: `test_ocr_import.py::test_image_original_only_is_reported_once`.
2. **`fix(api)`: a list item appended to a section started a loose list** (`apiquery.append_to_section`). Found by
   Claude Code itself during the live session: appending `- third item` under a Checklist put a blank line before it.
   When the section's last line and the appended text start items of the same list kind, the item now follows
   directly; paragraphs and another list kind still get their blank line. Applies to MCP `append_to_section`, the
   `/v1/object/section` route and capture "fact" filing (same function). Regression test:
   `test_m11_api.py::test_append_joins_the_list_it_follows`. Re-checked live on the restarted scratch server.

## OCR notes

- Engine: `tesseract 5.5.3`, leptonica 1.87.0, language data `eng` and `osd` only (`/usr/share/tessdata`). The reader
  calls `tesseract <image> stdout` with no `-l`, so it is always English; a scan in another language needs its
  traineddata installed and the reader has no language setting (not in the spec; noted only).
- Only PDFs with **no text layer at all** are OCR'd (`if not text`). A mixed PDF (some text pages, some scanned pages)
  keeps only the text layer; the scanned pages' text is missing and no note says so. The spec only asks for "scanned
  PDFs (no text layer)", so this is a gap, not a bug.
- Pages that are vector drawings with no embedded image still read "Needs OCR" (already listed in `m26-acceptance.md`).
- Images (`.jpg`, `.png`, …) are not OCR'd: they get an "Original only" page with the image, as the M25 plan says. The
  design (`specs/2026-11-06-import-migration-design.md`, the readers table) says images become "an Image (or File)
  object"; with "Keep originals as: Attachments" they are a Page holding the image. The M25 plan chose that; Gene's call
  whether it stands.
- OCR runs twice for a scanned PDF when the wizard's scan step runs (once for the scan, once for the import), each image
  with a 120 s timeout. Fine for a handful of scans; a large scanned library will be slow.
- `m26-acceptance.md` box "A scanned PDF is flagged Needs OCR; with Tesseract installed it gets text" can now be
  checked by hand; it held here.

## MCP session details

- Server: `objectapp-mcp` (`objectapp.mcp_server:main`), started by Claude Code from the config the app's token route
  hands out (`uv run --directory <repo> objectapp-mcp`, `OBJECT_API_URL=http://127.0.0.1:8802`). Config files in the
  scratch folder only; `claude -p --mcp-config <file> --strict-mcp-config --allowedTools mcp__object`, Claude Code
  2.1.319, two sessions (12 and 6 turns). No change to `~/.claude`.
- Read token: 25 tools (`automations, backlinks, changes_since, collection, daily_note, import_preview, import_proposal,
  import_report, import_scan, import_status, peek, query, read, read_version, read_whiteboard, run_saved_query,
  saved_query, schema, search, trash, type_definition, unlinked_mentions, version_history, work_item, work_items`).
  Read-write token: 68 tools.
- There is no `whoami` MCP tool (the route exists at `/v1/whoami`). The server instructions name write tools a read
  session doesn't have; Claude noticed but it caused no error. Neither is a bug.
- The public page's body still holds `[[Lane B Hidden]]`: a link's text in a visible page is that page's text, so an
  excluded object's title can show through a link to it. Peek's `links` and backlinks leave the excluded objects out.

## Anytype reader (M15): gap and risk

Anytype's public docs (`doc.anytype.io/anytype/data/import-and-export`) only list the export options (Markdown or
Any-Block, include linked objects, files, archived objects); the Markdown layout is not documented. The exporter's
source is public (`anyproto/anytype-heart`, `core/converter/md/md.go`, `pkg/lib/schema/yaml/exporter.go`,
`core/block/export/export.go`, branch `develop`, read 2026-11-08), and since mid-2025 Markdown export writes properties
and types as YAML frontmatter. What the source writes, against what `importers/anytype.py` expects:

| Anytype export (from source) | Object's reader | Effect |
|---|---|---|
| Type under the key **`Object type`** (the relation's name), e.g. `Object type: Book` | default `typeKey: 'type'` | every object becomes a Page unless the user picks `Object type` in the mapping step (checked: picking it gives Book and Human) |
| Keys are relation **names** (`Tag`, `Creation date`, `Author`) | Obsidian rules; `tag` -> tags | Tags map; `Creation date` becomes a datetime property, not `createdAt` |
| File names are **slugs** of the title (`frank-herbert.md`, max 48 chars, `_<rand>` on clashes); the title is the body's first `# ` line | title = frontmatter `title`, else the file stem | objects are titled `dune`, `frank-herbert` instead of `Dune`, `Frank Herbert` |
| `id: bafy…` appended to every frontmatter | an ordinary key | a text property `Id` on every type; not used as `importSource.id` |
| Object relations as a list of exported file names (`Author: [frank-herbert.md]`), titles when not exported | values as text | a label property with `frank-herbert.md` values, not a relation |
| `# yaml-language-server: $schema=schemas/<type>.schema.json` comment and `schemas/*.schema.json` files (property formats) | comment ignored; files skipped as "Not linked from any page" | the type schema Anytype gives is not used |
| Files under `files/`, body links `[t](slug.md)`, images `![t](files/x.png)` | relative links resolve | works |

Tested with a synthetic export written to that shape (scratch only, not committed): preview gave 1 type (Page), 7
properties including `Object type` and `Id`, slug titles. Risk: medium. Nothing is lost (the reader warns that it is
unverified), but a real export imports with wrong titles and no types unless the user fixes the mapping by hand.
Suggested follow-up, needing a real export first to confirm: default the type key to `Object type` when present,
take the title from the first H1 (or `Name`) when the file stem is a slug, map `Creation date` to `createdAt`, put
`id` into `importSource.id`, read `Object`-format values naming exported files as relations, and read the
`schemas/*.schema.json` formats. Nothing was changed in the reader.

## SharePoint

No fetch code exists: a grep of `backend/objectapp` for SharePoint, Microsoft Graph, MSAL, OneDrive and HTTP clients in
the importers finds only the provenance value `system: sharepoint`, the `_manifest.jsonl` format (`importers/files.py`)
and the Migrate a source skill text (`importskill.py`). That is the design (`specs/2026-11-06-import-migration-design.md`
section 4 and non-goals): Object has no Microsoft 365 account or OAuth flow; an agent with a Microsoft 365 MCP server
(added through M19) lists the library, downloads each file into a staging folder (each download a step Gene approves)
and writes `_manifest.jsonl` (item web URL, item id, version label, author, dates, library columns as `fields`); Object
then imports that folder as a Files source. What is needed to make it real: a Microsoft 365 / SharePoint MCP server
configured in M19 with read-only Graph scopes (`Sites.Read.All` or `Files.Read.All`, delegated, Gene's tenant
consent), a tested prompt or skill step that pages through a library (including nested folders and >5,000-item
libraries) and writes the manifest with the field names above, and one dry run on a test library to confirm the
manifest's `path` values match the staged files. A OneDrive-synced library already works as a Files source without a
manifest (paths and dates only).

## Gates

Run in the worktree at the fix commits (before this report's commit):

- Back end, full: `uv run pytest -q backend/tests`: **3291 passed, 14 skipped, 3 xpassed, 0 failed** (566 s).
- Front end: `npx vitest run`: **3989 passed, 1 skipped, 0 failed** on the last two runs. One earlier run had 1 failed
  test (name not captured) with no front-end change on the branch; it did not come back on the two runs after it, so
  it is counted as a flake. `npm run build`: clean.
