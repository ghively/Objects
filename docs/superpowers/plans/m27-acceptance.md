# M27 acceptance: the agent workflow (back end)

Run: `cd backend && uv run python ../scripts/m27_acceptance.py` (copy of `space-sample`, synthetic mixed folder, fake claude; prints `RESULT: PASS`). Tests: `uv run pytest tests/test_m27_agent.py tests/test_m17_contract.py tests/test_m22_mcp.py tests/test_m11_mcp.py tests/test_m17_mcp_tools.py tests/test_m18_routes.py tests/test_m20_delegation.py`.

## Routes (as the frontend uses them)
`GET /api/import/batches/{id}/proposal` -> `{proposal: {groups}|null, review: {items, applied}|null}` (groups = the wizard's `ProposalGroup`; extra keys `group`, `problems`, `dropped`, `revision`, `summary`); `PUT .../proposal/review` `{items:[{id,status,edited?:{name?,plural?,dropProperties?}}]}`; `POST .../proposal/apply` -> `{created, extended, skipped}`; `POST .../filing/start` `{trial}`; `GET .../filing` -> `{state, trial:{items, rightShare}, normalise, error}` (normalise is in the same response, also in `done`); `.../filing/mark`, `/continue`, `/normalise`.
Additions: `POST /api/import/batches` `{path, leaveOut}` -> `{batch, scan}` (a draft batch for agents/the wizard; the import adopts it with `StartImportRequest.batch`); `PreviewRequest.leaveOut`; `StartImportRequest.scan {leaveOut, leaveOutFiles, excludeFromAi}`, `.batch`, `.requireApproved`.

## Deviations and calls
1. The wizard imports first and files after, so a proposal normally attaches to the finished batch; agents get a draft batch from `import_scan` (read-write token) and save the proposal before the import. Both work.
2. `start_import` (MCP) refuses unapproved new types only for targets in the open space or a copy; a brand-new space has none of Gene's data and is not checked.
3. The scan runs inside the import job when the batch has no `scan.json` (folder sources only; zips are not scanned). Flagged files are excluded from AI unless the scan choices say otherwise.
4. "Leave out" patterns apply at preview (files are never listed or read); `leaveOutFiles` (flagged files chosen after the scan) are dropped at start, after the preview has read them.
5. The trial applies decisions to 50 objects at once; a "wrong" mark does not undo them (version history does). The trial gate for a source is satisfied once any earlier batch of that source finished a trial.
6. External agents (`save_import_decisions`): the first hand-over of a source is its trial (at most 50); `continue` then runs Object's own agent for the rest.
7. Normalise merges tags and option values on the batch's filed objects; it leaves the unused option on the property.
8. Links are applied only for relation properties (`links[].key`) whose target title resolves; links without a key are listed as refused.
9. Inbox suggestions: objects whose decision names a type no approved proposal makes are added to the proposal as an open `create` item (it fails the 10-document rule until enough pile up).
10. New tools: `import_scan`, `import_proposal`, `import_report` (read), `save_import_proposal`, `save_import_decisions` (write). `import_scan` with a read-write token also keeps a draft batch. Tool counts are now 25 read + 43 write (tests updated).
11. The skill is added to the default agent and to new agents (`AgentRegistry`), not to `write_skeleton`; M18 route tests were adjusted for the extra skill.
12. SharePoint: only the skill text and M25's manifest; no fetch code.
13. Contributor orders 58 (guidance) and 69 (tools) are used by `import-filing`.

## Hand-checks (Gene)
- [ ] Run the acceptance script, then a real trial on a copy of a work export: mark the trial in the wizard, see the accuracy in the report.
- [ ] Apply a proposal in the wizard: the types and properties look right; a group under 10 documents is not made.
- [ ] A flagged file is imported excluded from AI and is not in the trial.
- [ ] Low-confidence pages land in the Import inbox collection.
- [ ] An outside agent (Claude Desktop) reads the `migrate_a_source` prompt and calls `import_scan`, `save_import_proposal`.
- [ ] Normalise merges "Prod / prod / Production" tags.

## Open review items
Left for a design decision (from the review of 2026-11-07); the other findings were fixed in the `fix(m27)` commits.
- 7, 10, 12 (design-level, not touched in the fix pass; see the review notes).
- Held back on purpose: a "changed in both" re-run still keeps the new original and images it needs for a later "Take source" (the held-back page links them); identical bytes are reused, so repeated re-runs add nothing. Deferring them to "Take source" would need the source read again then.
- Matching across moved sources: an id that is a path (Obsidian, folders, Files without a manifest id) belongs to the source folder or zip it came from, so moving or renaming the source folder makes the next run create new objects. Notion and Anytype ids and manifest ids with a url are matched across locations. Blocks written before this fix have no source and match as before.
- `leaveOutFiles`/`excludeFromAi`: a flagged file can only be left out or imported excluded from AI; there is no choice to import it plain (the scan choices cannot turn the protection off).
