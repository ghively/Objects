# Milestone 12: computed and new property kinds (Formula, Rollup, ID, Email, Phone, Files)

Expanded 2026-11-05 from `2026-11-04-notion-anytype-features-plan.md`, M12, against `master` at `c72567f`. Built on branch `feat/m12-property-kinds`. Everything here is new schema ("Beyond the catalog"); every label and default is "our string" or "our choice".

## Contract (T1)

### Kinds

`PropertyType` gains `formula`, `rollup`, `uniqueId`, `email`, `phone`, `files`. All six are addable from "+ Add Property" (after the catalogued items, in that order). None is a "Change property type" source or target (`KIND_TRANSFORMS` lists `[]` for each, and no kind lists them).

| Kind | Menu name | Icon | Value in frontmatter | API value (rows, object reads) | Editable |
|---|---|---|---|---|---|
| `formula` | Formula | `ph-function` | never stored | `ComputedValue` | no |
| `rollup` | Rollup | `ph-stack` | never stored | `ComputedValue` | no |
| `uniqueId` | ID | `ph-hash-straight` | `TASK-12` (text) or `12` (int, no prefix) | `string \| null` (`"TASK-12"`, `"12"`) | no (written at create, or by "Number existing objects") |
| `email` | Email | `ph-at` | plain string | `string \| null` | yes (must contain one `@` with text on both sides, no spaces; else 422) |
| `phone` | Phone | `ph-phone` | plain string | `string \| null` | yes (digits, spaces and `+ - ( ) .` only, at least 3 digits; else 422) |
| `files` | Files | `ph-paperclip` | `["[[Attachments/a.pdf]]", …]` (always a list) | `string[]` of space-relative paths (`"Attachments/a.pdf"`) | yes (each path must be under `Attachments/`; else 422) |

### Options (`PropertyDef.options`, our keys)

- `formula`: `expression: string` (at most 2000 characters), `numberFormat?: NumberFormat` (used when the result is a number).
- `rollup`: `relationId: string` (the id of an `entity` property of the same type), `targetId: string` (a property id on the related objects, or `title`), `calc: RollupCalc`, `numberFormat?: NumberFormat`.
- `uniqueId`: `prefix: string` (default `""`, at most 20 characters, letters, digits and `-_`), `nextNumber: number` (default 1). On `PUT /types/{id}` the server keeps `nextNumber = max(stored, sent)`, so a stale editor never moves it back.
- `email`, `phone`, `files`: none. `files` defaults `isArray: true`.

Defaults when a property of the kind is added: formula `{expression: ""}`, rollup `{relationId: "", targetId: "", calc: "showOriginal"}`, uniqueId `{prefix: "", nextNumber: 1}`.

### Computed values

```ts
type ComputedType = 'text' | 'number' | 'boolean' | 'date' | 'list' | 'empty' | 'error'
interface ComputedValue {
  type: ComputedType
  /** text: string; number: finite number; boolean; date: ISO `YYYY-MM-DD` or a full ISO instant;
   *  list: string[]; empty: null; error: null */
  value: string | number | boolean | string[] | null
  /** Only for `error`: what went wrong, shown on hover. */
  error?: string
}
```

Formula and rollup values are computed on the server only, per request (no cache across days for formulas that use `now()`/`today()`), and served wherever other values are: `Row.values[key]` (rows API, type pages, collections, queries, embedded views) and the object read (`frontmatter`-independent `computed` map, see below). They are never written to any file, never in `frontmatter`, and changing only a formula or rollup's settings rewrites no object (no `ConfirmRequired`, no `lastUpdated` change). Deleting one needs no confirm either.

Object read: `GET /api/object` (`ObjectDetail`) gains `computed: Record<string, ComputedValue>`, keyed by property key, for the object's formula and rollup properties (empty `{}` when none). The property panel reads formula and rollup values from there.

### Formula language

- Literals: numbers (`12`, `1.5`), strings in double quotes (`\"` and `\\` escapes), `true`, `false`.
- `prop("Name")`: a property of the same object, by its name (exact, then case-insensitive). System names: `Title`, `Description`, `Tags`, `Created at`, `Last updated`, `Aliases`. Renaming a property rewrites `prop("Old")` to `prop("New")` in the type's formulas when the type is saved.
- Operators, lowest first: `or`/`||`; `and`/`&&`; `not`/`!` (prefix); `== != < <= > >=`; `+ -`; `* / %`; unary `-`; postfix `.f(args)` (method form: `x.f(a)` is `f(x, a)`), parentheses. `+` with any text operand joins as text. Comparisons work on two numbers, two texts, two dates or two booleans.
- Functions (case-sensitive names): `if(c, a, b)`, `ifs(c1, v1, …, else)`, `empty(x)`, `length(x)` (text or list), `contains(textOrList, x)`, `concat(a, …)` (texts, or lists), `join(list, sep)`, `lower`, `upper`, `trim`, `replace(text, find, with)` (plain text, every match, no regex), `round(n, digits?)`, `floor`, `ceil`, `abs`, `sqrt`, `min(…)`, `max(…)`, `sum(…)`, `toNumber(x)`, `format(x)` (to text), `now()`, `today()`, `dateAdd(date, n, unit)`, `dateSubtract(date, n, unit)`, `dateBetween(a, b, unit)` (a − b in whole units), `formatDate(date, pattern)` (tokens `YYYY MM DD HH mm`, others copied), `year(d)`, `month(d)`, `day(d)`, `first(list)`, `last(list)`. Units: `years quarters months weeks days hours minutes`.
- Property values in formulas: number → number; checkbox → boolean; date kinds and `Created at`/`Last updated` → date (a range's start); text, url, email, phone, ID, title, description, colour → text (empty → empty); single label → text; multi label, relation (titles), tags, aliases, files (file names) → list; formula/rollup → its value.
- `empty` propagates quietly: arithmetic on an empty number is empty, `"a" + empty` is `"a"`. Errors (wrong argument types, unknown property or function, division by zero, too deep) give `{type: "error", error: "<message>"}`; the cell shows "Formula error" (our string) with the message on hover.
- No loops, no randomness, no I/O. Expressions are parsed by a hand-written parser (no `eval`); nesting depth at most 50; list results at most 1000 items.
- Saving a type refuses (422, naming the property): an expression that doesn't parse; a formula that refers to itself directly or through other formulas or rollups (a cycle).

### Rollups

- `calc` (`RollupCalc`): `showOriginal`, `showUnique` (→ `list` of the values as text, flattened), `countAll` (related objects), `countValues`, `countUnique`, `countEmpty`, `countNotEmpty` (→ `number`), `percentEmpty`, `percentNotEmpty` (→ `number`, a fraction 0–1, shown as a percentage), `sum`, `average`, `median`, `min`, `max`, `range` (number targets → `number`), `earliestDate`, `latestDate` (→ `date`), `dateRange` (→ `number` of days). These are the `views/calc.ts` names.
- A rollup can't target another rollup (422 on save). It can target a formula. `relationId` must be an `entity` property of the same type (422 otherwise); an empty `relationId` or `targetId` gives `{type: "empty"}`.
- The related objects are the relation's resolved links (dangling links are skipped). A related object whose type lacks `targetId` counts as empty.

### ID

- Written into frontmatter when an object of the type is created (any create path: new object, template, daily note, import, API), as the next number, and `nextNumber` is bumped in the type JSON under the type lock, so two creates never share a number. A deleted object's number is never reused.
- `POST /api/types/{typeId}/properties/{pid}/number-existing` with `{baseRevision, clientId}` numbers every object of the type that has no value, oldest `createdAt` first, then bumps `nextNumber`. These rewrites are unstamped (no `lastUpdated` change, like other type-driven rewrites). Answers `{type: TypeDef, numbered: number, rewritten: string[], skipped: string[]}`; 409 `{currentRevision}` on a stale revision, 404, 422 for a non-ID property.
- Read-only in the UI and the property codec (`PATCH` of the key answers 422).

### Formula preview

`POST /api/formula/preview` with `{typeId, expression, path?: string | null, properties?: PropertyDef[]}` answers `{value: ComputedValue | null, error: string | null}`. `properties`, when sent, replaces the type's definitions for the preview (so an unsaved editor previews correctly). Without `path` it parses only (`value: null`). Writes nothing.

### Client

`api.formulaPreview(req)`, `api.numberExistingObjects(typeId, propertyId, baseRevision)`; `ObjectDetail.computed`.

## Lanes

- **Lane B (back end):** `formula.py` (tokenizer, parser to an AST, evaluator, reference listing for cycles and renames), `rollup.py`, computed values in `rows.py` and the object read, `uniqueId` at create and the number-existing route, `email`/`phone`/`files` in `propvalues.py`, type validation and rename rewriting in the type save path, the preview route, tests (`backend/tests/test_m12_*.py`), `scripts/m12_acceptance.py`.
- **Lane P (property settings):** settings for each kind in `PropertySettings` (formula editor with highlighting, function list and live preview against the open object; rollup's relation/property/calculation pickers; ID's prefix and "Number existing objects"; number format for formula and rollup), in new files under `frontend/src/properties/settings/`.
- **Lane C (cells and views):** `FormulaCell`, `RollupCell`, `IdCell`, `EmailCell`, `PhoneCell`, `FilesCell` under `frontend/src/properties/cells/`, wired in `cellFor.ts` and the table; filters, sorts, groups and column calculations for the new kinds (`views/filter.ts`, `sort.ts`, `group.ts`, `calc.ts`), unwrapping `ComputedValue` by its `type`.

## Review focus

Formula and rollup values never reach a file; a formula-only type edit never bumps any object's `lastUpdated` or asks to confirm; two concurrent creates never share an ID; a 5,000-object type page with three formulas and two rollups stays within the M5 row-load budget.
