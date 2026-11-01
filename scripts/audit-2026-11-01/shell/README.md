Shell audit repros (2026-11-01). Each `*.test.ts(x).txt` is a vitest file that reproduced a finding;
copy one back to `frontend/src/<name>` (drop the `.txt`) and run `cd frontend && npx vitest run src/<name>`.
Measurements (jsdom, mocked api): startup calls GET /api/space 3x; one body-only `changed` SSE event
re-renders Sidebar (+2) and the open page (+2) and refetches /api/space + /api/objects; 10 saves = 10
summary refetches; useGraphData refetches the whole graph per save; SSE has no open/error handler.
