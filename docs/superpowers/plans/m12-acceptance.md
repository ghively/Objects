# Milestone 12 acceptance: computed and new property kinds

Plan: `2026-11-05-m12-property-kinds.md` (expanded from `2026-11-04-notion-anytype-features-plan.md`, M12). Date: 2026-11-05. Built on a Linux cloud container, not on Gene's Windows PC, on branch `feat/m12-property-kinds` off `master` at `c72567f` (it does not need M10 or M11).

## What was built

- **Six new property kinds**, addable from "+ Add Property": Formula (`ph-function`), Rollup (`ph-stack`), ID (`ph-hash-straight`), Email (`ph-at`), Phone (`ph-phone`) and Files (`ph-paperclip`).
- **Formulas** (`backend/objectapp/formula.py`): a hand-written tokenizer, parser and evaluator (no `eval`), with the operators and the 40 functions the plan lists, `prop("Name")` over every property kind and the system properties, quiet empties, errors as values ("Formula error" in the cell, the message on hover), depth 50, lists up to 1,000 items, text up to 100,000 characters. Saving a type refuses an expression that doesn't parse and any cycle through formulas and rollups. Renaming a property rewrites `prop("Old")` in the type's formulas.
- **Rollups** (`backend/objectapp/rollup.py`): over any relation of the type, to any property of the related objects (or their title), with the 19 calculations of the column calculations.
- **Computed values** (`backend/objectapp/computed.py`) are worked out per request and served in rows (type pages, collections, queries, embedded views) and in `ObjectDetail.computed`. They are never written to a file, and changing a formula or rollup's settings rewrites no object and asks for no confirm.
- **IDs**: written when an object is created (any create path), numbered under the type lock so two creates never share a number; "Number existing objects" numbers the rest, oldest first. Read-only everywhere.
- **Email, Phone, Files**: checked on the server (422) and in the cells; Email and Phone link with `mailto:` and `tel:`; Files are `[[Attachments/…]]` links in a list, with upload by button or drop, open, remove and reorder.
- **Settings** (`frontend/src/properties/settings/`): a formula editor with highlighting, property and function lists that insert at the cursor and a live preview against the open object (`POST /api/formula/preview`); rollup relation, property and calculation pickers; ID prefix, next number and "Number existing objects"; number formats for formula and rollup results.
- **Views**: filters, sorts, groups and column calculations understand every new kind; formula and rollup filters pick their operators from the value's type.

## Our choices (for Gene to check)

1. The six kinds, their menu names and icons, and their place at the end of "+ Add Property". None of them can be a "Change property type" source or target.
2. The formula language: its operators, function names, units (`years quarters months weeks days hours minutes`) and `formatDate` tokens (`YYYY MM DD HH mm`). `+` with any text joins as text.
3. An unknown function, a wrong argument count and `prop(...)` without a quoted name are refused when the type is saved, not only shown as errors.
4. `==` between two different kinds is an error; an empty value equals only an empty value; `if`, `and`, `or` and `not` read an empty as false; `length(empty)` is 0; `toNumber` of text that isn't a number is empty; `toNumber(date)` is milliseconds since 1970.
5. Limits: a formula list over 1,000 items is an error, a rollup's list is cut at 1,000; text over 100,000 characters is "Text too long"; integers over 1,023 bits are "Number too large".
6. Rollups count a related object once even when it is linked twice, never count templates, give `dateRange` in days, and show the percentages as percentages.
7. A rollup can't use another rollup; it can use a formula. A rollup whose relation was later changed to another kind (the old relation is kept, so the type still saves) shows as empty, not as an error. Deleting a relation that a working rollup uses is refused.
8. IDs: templates are never numbered; objects without a readable creation date are numbered last; a number taken by a create that then fails is not reused; changing an object's type into one with an ID gives it no number (it isn't a create); templates and merges never copy an ID, formula or rollup.
9. Formula and rollup properties are deleted without typing "delete" (their values aren't in any file); deleting an ID property still asks (its values are).
10. The formula editor saves on blur, Ctrl/Cmd+Enter or "Save formula"; the preview waits for a pause in typing and only parses when no object is open.
11. Filters for formula and rollup properties offer the text, number, date and checkbox operators and apply the one that fits each value's type; Files can't be grouped and sort by their first file name; IDs sort by their trailing number.
12. The kanban can't be grouped into a computed property's columns by dragging (it can't set one).
13. Email and Phone open a small dialog to edit; Files reorder with up and down buttons; CSV import fills Email and Phone and skips cells that fail the check.
14. Column widths for the new kinds (12, 12, 8, 16, 11 and 16 rem) and "hide when empty" never hiding a formula error.
15. Computed values on the object page refresh a moment after a property write and when a related object changes; a type page with a rollup reloads its rows when a related object changes.

## Review

One whole-milestone review after the three lanes were merged found one high finding (formula text could grow without bound and exhaust memory), three medium (the object page's computed values never refreshed, rollups went stale when a related object changed, number overflow answered 500) and three low or trivial (a relation's kind change, the delete confirm for computed kinds, a tab in phone numbers). All were fixed in one pass with a test each (choices 5, 7, 9 and 15).

## Automated results

| Suite | Command | Result |
|---|---|---|
| Baseline before M12 | `uv run pytest backend/tests -q` at `c72567f` | 1603 passed, 1 skipped, 3 xpassed |
| Back end | `uv run pytest backend/tests -q` | 1687 passed, 1 skipped, 3 xpassed (M12 adds 84 in `test_m12_*.py`) |
| Front end | `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run lint && npm run build` | vitest 2633 passed, 1 skipped, 1 failed: the 1 MB split timing test (4 s against 300 ms) while three other builds ran on the 4-core box; it passes when run alone (25 of 25). `tsc` clean; lint 0 errors; build ok |
| M12 acceptance | `uv run python scripts/m12_acceptance.py backend/tests/fixtures/<space>` | PASS on `space-sample`, `space-m8`, `space-v1`; with `--timing` on `space-sample` (lane run) |
| Earlier acceptance | `m2` (`space-sample`), `m8` (`space-m8`), `m9 --skip-roundtrip` (`space-m8`) | PASS |

`scripts/m12_acceptance.py` runs a git-committed temp copy served on `127.0.0.1` with a test clock: it makes two types and four objects, adds two formulas and two rollups (only the type files change), reads the computed values from rows and object reads (nothing changes), adds an ID, Email, Phone and Files (no object rewritten), checks that two creates get `M12-1` and `M12-2` and "Number existing objects" numbers the rest oldest first with one added line each, writes and reads Email, Phone and Files values and refuses bad ones, runs the formula preview, refuses a cycle and a rollup of a rollup, and checks a rename rewrites `prop("Budget")`. With `--timing` it loads 5,000 objects with three formulas and two rollups.

Not verified here: the Windows run, the app's own window (pywebview), and the settings and cells in a real browser.

## Known gaps

- A rollup over objects of its own type (for example a "Sub-items" relation) can show an old value on the type page until the page reloads, because a change to one of its own rows refreshes only that row.
- A create that waits more than 10 s for a type save answers 500 instead of retrying; every create of a type with an ID bumps the type's revision, so a type settings editor left open may see a conflict and reload.
- A rollup's error reads "Formula error"; a table cell's files can only be opened and added (remove and reorder are in the property panel); a progress number format on a formula shows as text.
- The 5,000-row page with three formulas and two rollups loads in about 500 ms against 165 ms without them (in process); fast enough for the M5 budget here, worth watching on a type with more rollups.

## Hand-checks for Gene

- [ ] Add a Formula `prop("Price") * prop("Quantity")` to a type: the table and the object page show the product; the files don't change (`git status`).
- [ ] Rename "Price": the formula now reads `prop("New name")` and still works.
- [ ] Type a broken formula: the editor shows the error and Save refuses it.
- [ ] Add a Rollup over a relation with Sum of a number property; change a related object's number and the rollup updates.
- [ ] Add an ID with prefix `TASK-` and click "Number existing objects": each object gets a number, oldest first; a new object gets the next one.
- [ ] Email and Phone refuse bad values; Files uploads, opens, reorders and removes attachments.
- [ ] Filter, sort, group and calculate on each new kind in a table.
