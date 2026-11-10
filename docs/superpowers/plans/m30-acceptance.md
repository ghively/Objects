# M30 acceptance: entity extraction and distillation

Status (2026-11-10): built 2026-11-10 (T1 the contract; T2-T12 on parallel lanes by file ownership, merged up to `2befd1ad` on top of all of M28 and M29), integrated in T13; the acceptance script passes. The whole-milestone review, its fix pass and the full gate come next. Gene's hand checks below are unticked.

Plan: `2026-11-09-m30-entity-extraction.md`. Design: `specs/2026-11-09-it-ops-type-model-design.md`, sections 5 (entity extraction on import), 5a (Sources and distillation) and 5b (conventions in an IT ops space); `specs/2026-11-06-import-migration-design.md`, sections 5, 8, 9 and 12.

## How to run the acceptance script

```
uv run python scripts/m30_acceptance.py [SPACE] [--keep]
```

(In a container where `uv run` can't sync, the same with the venv's Python: `PYTHONPATH=scripts:backend .venv/bin/python scripts/m30_acceptance.py`.)

SPACE defaults to `backend/tests/fixtures/space-sample` and is never touched (its files are hashed before and after): the script copies it to a temporary folder, applies the IT ops setup, adds your own Host "app01" (`ipAddress: 10.9.9.9`, body "My notes.") and a page outside the import, `Pages/Ops log.md` ("Checked APP01 today."), and writes the synthetic source with `m30_helpers.make_itops_source` (APP01, SRV-DB01, Payroll, Restart Payroll, Rack notes, Old APP01 notes; Rack notes gets one more synthetic sentence, below). `OBJECT_STATE_DIR` and `OBJECT_CACHE_DIR` point at temporary folders; everything runs through `create_app` and the fake `claude` (`FAKE_CLAUDE_FILING` from `m30_helpers.decisions`). No real data, no network, no real agent. It prints `[ok]` or `[FAIL]` per check and `RESULT: PASS` at the end, and exits non-zero on any failure. The checks:

1. **The option.** A plain import sent with `keepAsSources: false` into a scratch copy files the six pages into their mapped types (`batch.json` records `false`, no Source); a start that leaves the field out, into a second scratch copy, keeps every page as a Source (the default is on, plan Our calls 25).
2. **The proposal.** `POST /api/import/batches` makes a draft batch and its scan (nothing flagged). The agent saves the proposal over `/api/v1/import/proposal` (a read-write token): use Host, Application, Software and Runbook, and create "Server" with Host's properties. `GET .../proposal`: "Server" shows "It has the same properties as Host." and the offer "Use Host, with a category"; the four uses raise nothing. Every item accepted; Apply creates and extends nothing, skips "Server" and leaves every type file as it was.
3. **The import kept as Sources** (adopting the draft batch, `keepAsSources: true`): six Sources in `Sources/`, each `readOnly` with "Imported source", each file's version as the batch recorded it; the CRLF + BOM page keeps both.
4. **Trial and the bulk pass.** The trial covers the six pages; APP01's result is about Host APP01 and mentions HQ and Payroll; Rack notes is about nothing. Every result marked right, Continue: the batch waits in `entities`. Nothing outside the batch's records changed (every file hashed).
5. **The Entities view.** `GET` of the app's route and of `/api/v1/import/entities` answer the same view and write nothing. It is in `review` with `sources: 6`; "SQL 2019" and "SQL Server 2019" are one entity, merged by the agent; "Server" and "VM" are left out as categories and "Rack 4" as text; APP01 is distilled from four Sources (APP01, Payroll, Restart Payroll, Old APP01 notes) with 10.0.0.5 kept over 10.0.0.6 and your app01 as the object already here; SRV-DB01 and SRV DB01 are suggested as the same thing.
6. **The review and Write.** One review merges the suggested pair (SRV DB01 joins SRV-DB01, three Sources), splits "SQL 2019" off (it goes to "Not made into objects") and accepts APP01; Write is 409 "5 entities are still to decide."; a second review renames SQL Server 2019 to "Microsoft SQL Server 2019", turns down HQ and accepts the rest, and reads back the same after a reopen. Write while another import runs is 409 "Another import is running." (the batch stays in `entities`). Write: 202, `done`, 4 entities created and 1 already here.
7. **After Write.** Every Source is byte-identical to its recorded version and `PUT /api/object/properties` on one is 423 "Imported source". The four created entities (Payroll, SRV-DB01, Restart Payroll, Microsoft SQL Server 2019) carry `importSource` (`entity:<typeId>:…`, this batch) and their `created` items; HQ and SQL 2019 are no objects. Your app01 was reused: IP still 10.9.9.9, FQDN filled, no `importSource`, its body the "From sources" section and then "My notes." untouched; the section's links resolve to Sources and its "Sources disagree:" line lists 10.0.0.5 and 10.0.0.6 with `[[Old APP01 notes]]`. Each entity's `sources` lists exactly the Sources the view gave it, and each Source's "Distilled into" row lists exactly the entities built from it. Payroll stores "Runs on" app01 (nothing written in app01) and app01's computed "Runs" row lists Payroll. Payroll's section has `Also linked: [[Hosts/SRV-DB01|SRV-DB01]] (backs up to)`, resolving to the entity, not the Source. app01's unlinked mentions list the Restart Payroll Source (its "Restart Payroll on APP01:" text untouched) and `Pages/Ops log.md`. Only Restart Payroll (the low-confidence link's subject) is in the Import inbox; no Source has a collection. The report and the report page list the conflict under "### Sources disagree".
8. **A re-run with one changed page** ("Old APP01 notes" gains "Retired in 2025.", still the older page): its Source is updated (the old text in version history, still read-only), the others unchanged; the pass waits in `entities`; with the same merge and split the view finds every entity the first Write placed (the renamed one included); accepting those and turning down the rest, Write creates nothing, writes one section, and changes only app01's file: the new line in its section, the frontmatter the same but `lastUpdated`, "My notes." untouched.
9. **Move batch to Trash** (the first batch): the six Sources and the four created entities go to the Trash, your app01 stays. Restore brings a Source back byte-identical and read-only, and an entity back.
10. **The fixture** folder is unchanged.

## Automated results

Run on 2026-11-10 for this integration (Linux, the shared venv's Python with the worktree's `backend` first; `objectapp-mcp` through the `uv` shim where a script starts it):

| What | Command | Result |
|---|---|---|
| M30 acceptance | `PYTHONPATH=scripts:backend .venv/bin/python scripts/m30_acceptance.py` | RESULT: PASS (46 checks) |
| M29 acceptance | `... scripts/m29_acceptance.py` | RESULT: PASS |
| M28 acceptance | `... scripts/m28_acceptance.py` | RESULT: PASS |
| M27 acceptance (the agent workflow) | `... scripts/m27_acceptance.py` | RESULT: PASS (it already sends `keepAsSources: false`) |
| M15 acceptance (importers) | `... scripts/m15_acceptance.py` | "All checks passed." (it prints no RESULT line), after its preview and start send `keepAsSources: false` |
| M25 acceptance (provenance and re-runs) | `... scripts/m25_acceptance.py` | one FAIL, "a first import only adds files": the People folder joins Person and extends `.object/types/person.json`. It fails the same at the M29 gate commit `8a2724e3`, before M30; not an M30 change. Its preview and start now send `keepAsSources: false` (without it the re-run checks hit a read-only Source, 423) |

The full back-end and front-end suites and the build run in the gate after the review.

## How it behaves (from the build)

- **Keep pages as Sources** is ticked for every import in the wizard and is on when a request leaves `keepAsSources` out (the API, `/api/v1`, MCP `start_import`'s `keep_as_sources`). The batch records it. A preview with it on plans one type, Source.
- **A Source** keeps its text byte-identical to the import (CRLF and BOM included), its Category and System, its other fields as undeclared frontmatter keys and its `importSource`. It is read-only, "Imported source", on every write path; Move to Trash and Restore work. Only a re-run of the same source updates it, the old text in version history, and it stays a Source whatever the re-run's option.
- **The Entities step** comes after the bulk pass, before Normalise. The list is computed on every read from the filing results and your review (never stored). An entity needs a page about it, two pages mentioning it, or a value of its own; categories (a label option of a type, Source's own Category and System included, or a tag) never become entities. Write needs every entity decided and is refused while another import runs.
- **Distillation**: values with their Sources and quotes in `.object/distilled/<entity id>.json`; the newest Source wins and the conflict is listed in the report and the section; a value you set is never replaced, synced properties are never filled. Entities with no lines, conflicts or plain links get no "From sources" section. A plain link reads `Also linked: [[path|Title]] (relation)`. The report page is written at the Write's finish on a Source batch.

## Hand checks (Gene)

On a copy of a space with the IT ops starter (synthetic pages only):

- [ ] The import wizard's options show "Keep pages as Sources", ticked for every import; with it unticked an import files pages into their mapped types as before.
- [ ] Import a synthetic folder of server, application and runbook pages with "Keep pages as Sources" on: every page is a Source, read-only ("Imported source"), with its text exactly as in the folder and its Category and System.
- [ ] Run the agent workflow and the trial; each trial result shows "About:" and "Mentions:" lines, and no page changed.
- [ ] In the proposal, a new type with Host's properties is refused and offers "Use Host, with a category"; taking the offer adds the category to Host instead of a type.
- [ ] After Continue with the rest, the Entities step lists entities by type with source counts, aliases and badges ("Sources disagree" on a host with two IPs); categories and one-off mentions are under "Not made into objects".
- [ ] Accept, Rename, Turn down, Merge N selected, a suggested Merge and Split each change the list as expected, and survive closing and reopening the dialog.
- [ ] Write stays disabled until everything is decided; Accept the rest decides the remainder.
- [ ] After Write: a server's Host has a "From sources" section on top citing its Sources as links, the IP conflict listed with both values and Sources, and its Sources row; your own notes below it are untouched; each Source's "Distilled into" row lists what was built from it, and its text is still exactly as imported (no links added).
- [ ] An application shows "Runs on" the host and the host shows "Runs" the application.
- [ ] Low-confidence links put their entity in the Import inbox with the reason; the report lists the conflict.
- [ ] Mentions of an entity in Sources and in pages outside the import still show under its unlinked mentions.
- [ ] Edit a line in a "From sources" section, change the source page and re-run: the section is left as you edited it and the report says so; the Source shows the new text and version history the old.
- [ ] Move batch to Trash moves the Sources and the created entities to the Trash, and Restore brings them back.
- [ ] An outside agent over MCP can read the list with `import_entities` and cannot accept or write it, nor edit a Source; its `start_import` keeps pages as Sources unless told not to (`keep_as_sources: false`).

Deviations (from the build):

- The plan's draft hand check said the option is "off for a plain import"; Gene's decision (Our calls 25) is that it is ticked for every import, so the check above says so. The script's "plain import without the option" sends `keepAsSources: false`, and a second scratch import checks that leaving the field out keeps Sources.
- The six synthetic pages hold no near-duplicate names, so the script adds one synthetic sentence to Rack notes ("SRV DB01 sits in it too.") and the matching mention to its decision; that gives the suggested pair to merge. The Sources count stays six.
- The proposal is saved over `/api/v1/import/proposal` with a read-write token, as an outside agent saves it.
- "Write is refused while another import runs" holds an import running by stubbing `Jobs.running`, as T9's test does.
- The re-run's review repeats the first review's merge and split, accepts the entities already in the space and turns down the rest (HQ, turned down the first time), so it checks that nothing new is created and only the section citing the changed Source is rewritten.
- `scripts/m15_acceptance.py` and `scripts/m25_acceptance.py` now send `keepAsSources: false` with their previews and starts (they test plain mapped imports); no other change to them.
