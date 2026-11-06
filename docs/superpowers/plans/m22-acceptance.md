# Milestone 22 acceptance: the work model

Plan: `2026-11-05-m22-work-model.md`. Design: `specs/2026-11-05-work-dashboard-design.md`, sections 1-4 and "Add work fields". Date: 2026-11-06. Built on Gene's Windows 11 PC on branch `feat/m22-m23` (worktree `C:\Git\object-work`, the second of the two parallel tracks Gene chose on 2026-11-06), commits `822e467..31f4045` plus this integration commit. Gene asked for M16-M24 to be built straight through; his hand checks below come later.

## What was built

- **Rules** (`workrules.py`, ported to `frontend/src/work/stepRules.ts`): the current step, whose turn, the stage, the allowed moves per role and every refusal message, checked row for row on both sides against the shared `frontend/src/work/__fixtures__/step-cases.json` (74 rows).
- **Three property kinds** (`workvalues.py`, through `propvalues.py`): `steps`, `textList` (List) and `floorItems`, YAML lists in front matter. Generic property writes, `/api/v1/object/properties` and automations refuse `steps` ("Steps change with the step actions."); a create may carry only open steps ("New steps start open."); merges never merge steps.
- **Fields** (`workfields.py`, `basicsetup.py`): 11 ticket fields and 15 work fields; the basic Task type gets them in memory (nothing written), new Project types have them, and "Add work fields" (`POST /api/types/{id}/work-fields`) puts them on another type.
- **Body sections and the resolution note** (`workbody.py`, `workresolution.py`): one `## Activity` line per work write, a `## Work notes` line for the cases the Contract names, new sections before `## Wrap-up`; the two copy-ready notes with `[fill in: …]` gaps and redaction.
- **The one write** (`Space.write_work`, `workhook.py`, `workview.py`): one atomic, stamped, version-checked write per action; System inferred from the Ticket ID; `completed` stamped on a done crossing; the virtual Tickets view (`work-tickets`), which can't be deleted.
- **The service** (`workread.py`, `workservice.py`) behind the app routes (`api_work.py`), the agent routes (`api_v1_work.py`) and eight `objectapp-mcp` tools (`work_items`, `work_item`, `step_action`, `edit_steps`, `log_activity`, `add_work_note`, `set_work_fields`, `update_floor_item`). Per-step revisions: a stale step answers 409 "This step changed. Look again."
- **Settings**: the Jira site (`space.json` `jiraSite`) and "Your name in Activity" (`activityName`, default "Gene") in a new Settings > Work section.
- **Front end**: the step list editor (`StepList.tsx`: kind and state chips, drag to reorder, the two-press Approve, Withdraw, Reopen), the List and Floor items editors, work writes on the object page (the body saved first, the returned body loaded), the collapsed "Resolution note" under the property panel, the Work section in type settings, and the Tickets view's note on the query page.

## Integration (Task 13)

- The lanes' code was connected end to end; `scripts/m22_acceptance.py` serves a copy of `space-work` headless and drives every app route, a real stdio `objectapp-mcp` session and the agents' saved-query route.
- `frontend/src/icons/appIcons.ts` regenerated (`node scripts/app-icons.mjs`): T1 added `ph-briefcase` and `ph-clipboard-text` in `src/` without regenerating the icon subset, so `src/icons/appIcons.test.ts` failed (reported by T11).
- `backend/tests/test_m22_contract.py::test_stub_routers` called both routers with `None` for the context, which only T1's empty stubs allowed; once T8 and T9 filled them it failed. It now checks the Contract's signature, `router(ctx, service) -> APIRouter`; the routes themselves are tested in `test_m22_api.py` and `test_m22_mcp.py`.

## How to run the acceptance script

```
uv run python scripts/m22_acceptance.py [SPACE] [--keep]
```

SPACE defaults to `backend/tests/fixtures/space-work` and is never touched: the script copies it to a temporary folder, commits the copy to a throw-away git repo, points `OBJECT_STATE_DIR`, `OBJECT_CACHE_DIR` and `OBJECT_CLOCK_FILE` (2026-11-05T10:00:00Z) at temporary paths, serves the app on a free `127.0.0.1` port and sets the time zone to UTC. It prints `[ok]` or `[FAIL]` per check and `RESULT: PASS` at the end, and exits non-zero on any failure. The MCP check starts `uv run objectapp-mcp` as a child process and stops it; nothing is left running.

## Automated results

Run on 2026-11-06 for this integration (the track's full gate runs after the review and fix pass):

| What | Command | Result |
|---|---|---|
| M22 back end | `uv run pytest backend/tests/test_m22_*.py backend/tests/test_m14_filter_parity.py backend/tests/test_m17_contract.py -q` | 250 passed (one failure on the first run, `test_stub_routers`, fixed as above) |
| M22 front end | `npx vitest run src/work src/properties/cells src/icons src/types/WorkFieldsSection.test.tsx src/settings/sections src/queries/QueryPage.tickets.test.tsx src/object/ObjectView.work.test.tsx src/views` | 65 files, 710 tests passed |
| Types | `npx tsc -b --noEmit` | clean |
| Acceptance | `uv run python scripts/m22_acceptance.py` | PASS, every check below |

The script's checks, all `[ok]`:

1. Reads write nothing: both scopes of `GET /api/work/items`, `GET /api/work/item` for all 8 items, `GET /api/queries`, `GET /api/space`; `git status` clean and the state dir unchanged. Opening the copy wrote no `.md` file.
2. 7 active items and Old cleanup only in `scope=all`; Printer turn approve on step 2, stage doing; Parked thing parked; Desk closed it close, desk says Resolved, status still In Progress; Order toner none; Badge you, not started; Printer's Moderate read as Medium, System ServiceNow; Badge's System Jira for display while its file has none; the Tickets view lists Printer, Badge and Desk closed it.
3. Gene answers Parked thing's question: one Activity line and one Work notes line (with their two new headings); the diff's keys are `steps`, `lastUpdated` and the body only.
4. Gene approves Printer step 2; a second approve with the old rev is 409 "This step changed. Look again." and writes nothing; one APPROVED line.
5. Over `objectapp-mcp` with the read-write token "Work": all eight work tools listed (63 tools); `step_action(complete)` writes `Work completed step 2: Spooler restarted, queue flowing`; Gene's reopen of that done Approve step is 422 "A done Approve step never reopens."; the agent's approve of step 3 fails with "Only you can do this to a step." and writes nothing; `--read-only` lists only `work_items` and `work_item` of the work tools.
6. Badge reader (CRLF + BOM): `done` on its Do step keeps the BOM and every CRLF; `ticketId` set to `OPS-124` through `PUT /api/object/properties` writes `system: Jira`; CRLF and BOM still kept.
7. `PUT /api/object/properties` with `steps` is 422 "Steps change with the step actions." and writes nothing.
8. Add work fields on Project: 200, 26 fields added; Scanner rollout becomes a work item (turn approve); the Tickets view's structures are `project` and `task`.
9. Close Printer: status Done, `completed` 2026-11-05T10:00:00.000Z, the close notes hold "Verification: Spooler restarted, 20 test prints clean".
10. Clock at 2026-11-20: Printer leaves the active list and stays in `scope=all`.
11. Changed files: `.object/types/project.json`, `Tasks/Badge reader audit.md`, `Tasks/Parked thing.md`, `Tasks/Printer jams on line 3.md`; nothing under `.object/queries`; no work file in the state dir.

Not verified here: the editors and the object page in a real browser (jsdom only) and the app's own window (pywebview); no agent run (M22 starts none).

## Deviations from the plan

Reported by the build lanes, plus T13's:

- **T1:** the back-end contract was written before its test, so that test was never seen failing; the front-end test was. `step-cases.json` rows may carry optional `notBefore` and `ask`; `expect.current`, `stage`, `turn` and `actions` describe the steps before the action. The fixture space holds `page.json`, `tag.json` and `task.json` (copied from `space-m8`) beside `project.json`, because without them opening the space would write them. Rule calls the fixture fixes, which T2 and T10 follow: an action of another role's on a kind the user may act on gives the role message ("Only you can do this to a step."), an action nobody may take on that kind gives the wrong-kind message; "Finish the steps before this one first." only for a step after the current one (a forward action on an earlier finished step gives "This step is already done."); an unknown status text with no category reads as notStarted.
- **T2:** extra exports beyond the Contract: `ACTIONS` (the order `allowed_actions` uses), `iso_instant` and `step_ref` (a step's id or `@n`). The refusal order: role never takes the action, then not the current step, then wrong kind, then role not allowed for the kind, then wrong state, then missing text, then Not before on another kind.
- **T3:** an id-less step is served as `@n` with n its position in the raw list (unreadable entries counted); its rev also hashes `"@": "@n"`. Timestamps inside steps and floor items are written unquoted, through a str subclass `_Stamp` with a ruamel representer registered on import. `encode_steps`/`encode_floor` don't change their input; new ids appear only in the returned mappings.
- **T4:** option ids are slugs (`not-found`, `n-a`, `waiting-response`); `topup_work_fields` returns early for anything but the basic Task type. Extra test `test_topup_after_task_fields`.
- **T5:** `ActivityLine` and `WorkNoteLine` are TypedDicts (plain dicts at runtime). Five tests beyond the plan's.
- **T6:** `STEPS_GATED` lives in `workhook.py`; `update_properties`' hook moved into a shared `_value_hook`. `ruff format` was not applied (its 88-column default would rewrap the work modules, written at about 100).
- **T7:** the test file was written first but not run before the code, so it was never seen failing. Extra `test_item_reads`; the gate test is split into service, approved-step edit and generic-path parts. Writes without a base version retry up to 3 times on a `Conflict` from a concurrent write, and the retry then meets the stale rev (`StepChanged`).
- **T8:** none beyond the Contract. `GET /api/space` serves `jiraSite`.
- **T9:** objects marked "Exclude from AI" and templates are left out of `GET /v1/work/items` and 404 elsewhere; a `projectPath` pointing at a hidden object is served as null. The activity log actions are `work-step`, `work-steps`, `work-fields`, `work-note`, `work-activity` and `work-floor` (our names). T9 reported further deviations in a separate list that was not passed on to the integration step; the review should read `31f4045` against the plan's Task 9.
- **T10:** the user marking an Approve step done gets its own text, "Only the agent marks an Approve step done."; a done Approve step's reopen gets "A done Approve step never reopens." `stageOf` falls back to the option's status category, then to the text-to-category map.
- **T11:** the StepsCell leaves the 409 toast to the writer (`writes.work`) and reloads with `api.workItem`. One oxlint purity warning (`new Date()` in an event handler), of a kind the code base already has.
- **T12:** a plain `ConflictError` from a work write (a stale object version) is handled as a property conflict; a refused move or `StepChangedError` goes to a toast and doesn't block the write queue. Edits typed while a work write is in flight hold autosave and show the existing conflict dialog.
- **T13:**
  - `test_m22_contract.py::test_stub_routers` and `frontend/src/icons/appIcons.ts` changed as described under Integration (neither in T13's Files list).
  - Check 1 reads the types through `GET /api/space`: the app has no `GET /api/types`.
  - Check 2 reads the Tickets view's rows through the agents' `POST /api/v1/queries/work-tickets/run` with the "Work" token (the app's rows are filtered in the front end, so no app route runs a saved query's filter). The token is made before check 1; it writes only the state dir.
  - Check 3 accepts the two new section headings with the two lines: Parked thing has no `## Activity` or `## Work notes` yet.
  - Only this milestone's tests, `tsc` and the acceptance script were run, as the build instructions say; the full suites, `npm run lint`, `npm run build`, `m14_acceptance.py` and `m11_acceptance.py` run in the track's gate.

## Hand checks for Gene

On a copy of his space:

- [ ] A Task page shows an empty Steps row and no other new rows until a field is set.
- [ ] Add a Question, a Do, an Approve and an Agent step; drag to reorder; the current step is highlighted.
- [ ] Approve needs two presses ("Press again to approve"); Withdraw puts it back to Open; a done Approve step offers no Reopen.
- [ ] Each action adds one `## Activity` line (newest last in the file) and, with text, one `## Work notes` line; nothing else in the file changes (check with git or the version history).
- [ ] Type `OPS-123` in Ticket ID: System becomes Jira; set the Jira site in Settings > Work and the ticket's link opens the browse page.
- [ ] "Moderate" desk priority shows as Medium.
- [ ] On a ticket with `Result::` and `Prevention::` in `## Wrap-up`, the Resolution note's two Copy buttons copy clean text.
- [ ] Add work fields to one of your own types; the Tickets view under Queries lists its objects that have a Ticket ID; switch the view to Kanban: columns by Desk status.
- [ ] A CRLF file you edited elsewhere keeps its line endings after a step action.
- [ ] Opening the space and browsing work items changes no file (git status clean).
