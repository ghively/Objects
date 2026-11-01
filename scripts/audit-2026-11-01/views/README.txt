Views/properties audit repros (2026-11-01). To rerun one, copy it to frontend/src/views/zz_audit_<x>.test.ts(x)
(drop the .txt) and run `cd frontend && npx vitest run src/views/zz_audit_<x>.test.ts`. Not committed.
- audit_pure: A1 tag group id collision, A2 multi-type kanban shared key, A3 500-char text group write,
  A4 "other" id collision, B1 zone filter (sound), C1 CSV percentage, C2 CSV comma split, C3 CSV trim, C4 csvParse stray text
- audit_comp: D1 number cell edit lost after a failed write; E1 filter "Specific date" default is the UTC day
- audit_perf_pipeline / audit_perf_dates_tags / audit_render: timings (see the audit report)
