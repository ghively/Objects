# M26: readers and the scan (plan)

Design: `specs/2026-11-06-import-migration-design.md` sections 3 and 6. Built on its own file ownership: `backend/objectapp/readers/`, `importscan.py`, `api_importscan.py`, `frontend/src/import/scan/`.

## Libraries (all pure Python or wheels for Windows and Linux, permissive licences)
python-docx (MIT), pypdf (BSD), openpyxl (MIT), python-pptx (MIT), markdownify + beautifulsoup4 (MIT), Pillow (HPND, EXIF dates). Local OCR is only *detected* (`tesseract` on PATH); when found, embedded page images of a text-less PDF are OCR'd by the CLI, otherwise the PDF gets the note "Needs OCR".

## Contract
- `readers.read_file(path) -> ReadResult(title, markdown, images, notes, original_only, created, modified, author)`; `ExtractedImage(name, data, content_type)`; `readers.supported_suffixes()`.
- `importscan.scan_file(path) -> list[Finding(kind, line)]`; `scan_tree(root, leave_out) -> ScanReport`; `POST /api/import/scan {path, leaveOut}`. Findings never carry the value. Reads only.

## Tasks (TDD each)
1. Dependencies. 2. docx/html/text readers. 3. pdf/xlsx/csv/pptx/images/media/original-only. 4. scan + route. 5. wizard step `ScanStep` + tests. 6. `scripts/m26_acceptance.py`, `m26-acceptance.md`.
