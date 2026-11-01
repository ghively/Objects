Editor audit repros (2026-11-01). Each `*.repro.tsx` was a vitest scratch file run as
`frontend/src/editor/zz_audit_*.test.tsx` with `cd frontend && npx vitest run <file>`; copy one
back there to re-run. They print load/save results; they do not assert. Not committed.
