Whiteboard audit repros (2026-11-01). Not committed.

- `test_wb_backend_repro.py`: `cd backend && uv run pytest ../scripts/audit-2026-11-01/whiteboard/test_wb_backend_repro.py -q -s -p no:cacheprovider`
  (runs on a copy of `backend/tests/fixtures/space-whiteboard`). Failing cases are the findings:
  sidecar BOM/CRLF dropped, a board whose `.md` has malformed frontmatter answers "isn't a whiteboard".
- `zz_audit_*.test.tsx`: copy into `frontend/src/whiteboard/` and run `cd frontend && npx vitest run src/whiteboard/zz_audit_<name>.test.tsx`.
  Each test's `expect` states the desired behaviour, so a failing test is the reproduced finding.
