# M27 UI acceptance: the agent workflow in the import wizard

Tests: `cd frontend && npx vitest run src/import && npx tsc -b --noEmit && node scripts/app-icons.mjs --check`.

## What was built (frontend)
- Wizard order: source, **Check for sensitive content** (M26 `ScanStep`), review/mapping, running, finished. Scan choices go to the import request as `scan: {leaveOut, leaveOutFiles, excludeFromAi}` (omitted when all three are empty).
- After an import into the open space that has a batch, the finish step offers "Review proposed schema", which runs `frontend/src/import/agent/`: Proposed schema, Trial, Normalise, Import inbox.
- API client: `importProposal`, `saveProposalReview`, `applyProposal`, `startFiling`, `filingStatus`, `markFiling`, `continueFiling`, `normaliseFiling`. Strings in `agent/text.ts`.
- The Import inbox is found as the collection named "Import inbox"; its count is the rows of that collection.

## Hand-checks (Gene)
- [ ] Preview a source: the scan step comes before the mapping step; Back returns to the source.
- [ ] A flagged file set to "Leave out" is not imported; one left as "Import, excluded from AI" is written with `excludeFromAI`.
- [ ] Finish an import into this space: "Review proposed schema" shows each group as use / extend / create with counts, examples, fill rates, options and merges.
- [ ] Apply stays disabled until every item is accepted, edited or turned down; reloading the dialog restores the decisions.
- [ ] Edit renames a type and drops a property; Apply creates only what was accepted.
- [ ] Trial shows 50 objects with each value and its quote; Right/Wrong marks stick and the accuracy line updates.
- [ ] "Continue with the rest" starts the bulk pass only then.
- [ ] Normalise lists near-duplicate tags and options; merging changes them everywhere.
- [ ] The last step shows the Import inbox count and "Open Import inbox" opens that collection.
