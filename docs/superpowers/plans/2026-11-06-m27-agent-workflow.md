# M27 plan: the agent workflow (back end)

Design: `specs/2026-11-06-import-migration-design.md` sections 6, 8, 9, 11, 12. The frontend agent owns `frontend/src/**`; this plan is the back end only.

## Pieces
- `importers/proposal.py`: `proposal.json` / `proposal-review.json` in the batch; the rules (10 documents, 30% share, option merging, relations); `apply` (types only, app route only).
- `importers/filing.py`: decisions format, the app's checks (quote in the document, quote contains the value, property kind, label option), trial / bulk / normalise / links-last state machine, Import inbox, report section. No agent code.
- `importfiling.py`: the read-only agent run (`headless.run_chat`, purpose `import-filing`, tool narrowing contributor, write guard). Runs one turn per 40 objects.
- `importers/agentwire.py`, `batches.py` (draft batch, `scan.json`), `source.py` (Leave out), `writer.py` (`excludeFromAI`, left-out counts): the scan wired into the import.
- `api_import_agent.py` (routes), `api_v1_tools.py` + `mcp_server.py` + `toolcatalog.py` (MCP tools), `importskill.py` (the skill; prompt `migrate_a_source` and resource `object://skills/migrate-a-source`).

## Tests
`backend/tests/test_m27_agent.py` (fake claude: `FAKE_CLAUDE_FILING`), `scripts/m27_acceptance.py`.
