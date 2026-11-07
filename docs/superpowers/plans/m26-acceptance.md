# M26 acceptance: readers and the scan

Status (2026-11-07): built 2026-11-06/07, one review and one fix pass, gated 2026-11-07; on `master`. Gene's 6 hand-checks below are unticked.

Run: `uv run python scripts/m26_acceptance.py` (builds a synthetic mixed folder in a temp dir; prints `RESULT: PASS`). Tests: `uv run pytest backend/tests/test_m26_readers.py backend/tests/test_m26_scan.py -q`; `cd frontend && npx vitest run src/import/scan && npx tsc -b --noEmit`.

## What was built
`objectapp.readers` (`read_file`, `supported_suffixes`, `ReadResult`, `ExtractedImage`, `ocr_engine`), `objectapp.importscan` (`scan_file`, `scan_text`, `scan_tree`, `Finding`, `ScanReport`), `POST /api/import/scan` (`api_importscan.py`, mounted in `server.py`), and the wizard step `frontend/src/import/scan/ScanStep.tsx` (mounted in the import dialog by M27, between the source and the mapping steps; it passes `leaveOut`, `leaveOutFiles` and `excludeFromAi` on as `scan`; see `m27-ui-acceptance.md`).
Libraries: python-docx, pypdf, openpyxl, python-pptx, markdownify, beautifulsoup4, Pillow (all MIT/BSD/HPND; pure Python or wheels).

## Deviations and calls
- Scan line numbers for documents are lines of the *converted* page (blank line between paragraphs), the page the importer writes.
- Unknown suffixes are scanned as text when the first 8 KB hold no NUL byte (`.env`, `.json`, `.yml`); otherwise "unscanned". Files over 50 MB are unscanned.
- Local OCR is detected (`tesseract` on PATH). If found, images embedded in a text-less PDF are OCR'd through the CLI (untested here: no engine installed); otherwise the note is "Needs OCR". Page rendering is not done, so a PDF whose pages are vector scans with no embedded image still reads "Needs OCR".
- Images, audio, video, `.vsdx` and other binaries come back `original_only` with the note "Original only"; the importer decides to make an Image/File object. Image `created` is the EXIF date (naive local time, no zone).
- A sheet over 200 rows or 20 columns is not shown at all (text says "see the original"), per the design; formulas are read as cached values (`data_only`), which are empty in files never opened in Excel.
- Speaker notes use the `<!-- toggle -->` annotation with "Speaker notes" as the first line; check the editor shows it as a toggle.
- pptx charts/embedded objects and HTML images are not carried (noted). `modified` falls back to the file's mtime when the document has none.
- `ScanStep` calls the route with its own `fetch` (`scan/scanApi.ts`) to leave the shared client untouched.

## Hand-checks (Gene)
- [ ] Run the acceptance script and a real folder of Word/Excel/PowerPoint/PDF through `read_file`; the pages read sensibly.
- [ ] A scanned PDF is flagged "Needs OCR"; with Tesseract installed it gets text.
- [ ] Scan a copy of a work export: findings list file, kind and line, no values.
- [ ] A "Credentials" folder in Leave out is never read (and listed as left out).
- [ ] Flagged files default to "Import, excluded from AI"; switching one to "Leave out" is carried in the result.
- [ ] Speaker notes show as a toggle in the editor.
