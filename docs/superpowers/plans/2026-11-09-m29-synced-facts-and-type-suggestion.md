# Milestone 29: synced facts and type suggestion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal.** A property can be marked **synced**: its values are filled only by a script or agent through `/api/v1` (a `read-write` token or the new `sync` scope) or the MCP tool `sync_facts`, matched to objects by title, alias or a stable key; they live in `.object/synced/<typeId>.json`, never in the `.md` file; the app shows them read-only with their source, a "Refreshed {time ago}" line and "Stale" after the property's stale-after days (default 7). The IT ops starter's Host gets five synced facts. Every create row (`[[` / `@`, the palette, "+ New object" without a type, Turn into object, and a relation's picker) shows a **suggested type** first: the context's type, then the type whose **name patterns** match, otherwise the type used last in this space.

**Architecture.** `synced.py` is the store (a `JsonStore` over `.object/synced/`, one file per type, keyed by object id) plus pure helpers (matching, encoding, staleness). `Space` holds one `SyncedStore`, overlays synced values onto the in-memory front matter wherever values are decoded (rows, the object read, computed values, exports), refuses every other write to a synced key, and runs a sync (`Space.sync_facts`) as one atomic store write. `POST /api/v1/synced/{typeId}` (`api_v1_synced.py`) and the MCP tool call it. `typesuggest.py` is the pure suggestion rule and the pattern compiler, ported 1:1 to `frontend/src/create/typeSuggest.ts` with a shared parity fixture; the front end runs the port per keystroke (no round trip, nothing sent anywhere). A per-space "last type" store feeds the fallback.

**Tech Stack.** Python 3 (FastAPI, pydantic, `jsonstore.JsonStore`), `uv`; React, TypeScript, zustand, shadcn/ui, Tailwind, vitest. No new dependencies.

**Spec.** `docs/superpowers/specs/2026-11-09-it-ops-type-model-design.md`, sections **3** (synced facts) and **4** (type suggestion and templates). Built after M28 (`2026-11-09-m28-itops-starter-and-relations.md`), whose names are consumed as given: `basicsetup.ITOPS_TYPE_IDS`, `itops_types() -> list[TypeDefinition]`, `write_itops_types(root)`, the setup value `"itops"`, a relation's counterpart (M28 keeps it in `options.counterpart`), `Space.counterparts(path) -> list[CounterpartRow]`, the IT ops gallery (`Space.create_type(name, plural, template=<an ITOPS_TYPE_IDS id>)`). The ids used here, `host`, `network` and `software`, are M28's. Every label below that the spec does not give is marked "our string".

## Global Constraints

- A sync never writes a `.md` file, a type JSON, the version history or the search cache. It writes only `.object/synced/<typeId>.json`. The one exception is an object that has no `id` yet: its first sync inserts the `id` line (`Space.ensure_id`, one line, unstamped), and later syncs never touch it.
- Never write on read: opening a space, listing rows, reading an object, serving type settings and suggesting a type write nothing; `.object/synced/` is created by the first sync only.
- Synced values are read-only in the app: no editor, no table cell edit, no Kanban drag, no automation `setProperty`/`clearProperty`, no `PUT /api/object/properties`, no `/api/v1/object/properties`. A front-matter value under a synced key is ignored for display, filters and queries, and is never removed from the file.
- The store file is JSON (`jsonstore.dump_json`: `indent=2`, `ensure_ascii=False`, LF, trailing newline) of the shape `{objectId: {"values": {key: value}, "refreshedAt": iso}}`; written atomically under the space lock, checked against its revision; a file that is not valid JSON is never rewritten (423).
- `staleAfterDays` defaults to **7**. A value is stale when `now - refreshedAt > staleAfterDays` days.
- Token scopes are exactly `read`, `read-write`, `sync`. `POST /api/v1/synced/{typeId}` takes `read-write` or `sync`; every other v1 write refuses a `sync` token.
- Type suggestion uses context and name patterns only. No AI, no network, no server round trip per keystroke.
- Choosing a type in a create row applies that type's default template: the create call sends no `templateId`.
- The starter's Host synced facts: Last boot (date and time), Disk free (number, GB), Patch state (label), Reboot pending (checkbox), Last seen (date and time), source "Inventory script".
- The starter sets name patterns for Host, Network (CIDR) and Software (a name with a version number) only.
- Existing spaces' types are never changed automatically (spec non-goal): no top-up of a Host type already written by M28.
- CRLF and BOM are kept on the one-time id insert; the server binds 127.0.0.1 only; `/api` needs the per-launch key (tests built with `create_app` and no `ui_key` skip it).
- Fixtures are synthetic (`APP01`, `SRV-02`, `app01.example.test`, `10.20.0.0/24`); no real host, network or person. Tests set `OBJECT_STATE_DIR` to a temp folder; no agent runs in this milestone; nothing touches `~/.claude`.
- Never name the original notes app or the open-source agent whose patterns the agents design adopts.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

The five failure modes no task's ordinary tests would catch, most likely first. Each has its test in the owning task.

1. **A sync touches the Markdown.** A refresh re-stamps `lastUpdated`, rewrites the front matter, keeps a version, or rewrites CRLF/BOM; or a second sync of an object that got its id on the first one writes the `.md` again. Test: `backend/tests/test_m29_sync_api.py::test_sync_never_touches_md_files` (T6): bytes of every `.md` and every `.object/types/*.json` equal before and after three syncs, except the id-less object's single inserted `id` line on the first sync (CRLF+BOM fixture kept).
2. **A synced value can be edited after all.** `PUT /api/object/properties`, `/api/v1/object/properties`, an automation's `setProperty`, the table cell, a Kanban drag between Patch state columns, the property panel; or a hand-typed `lastBoot:` in the file shows instead of the store's value. Test: `backend/tests/test_m29_space_synced.py::test_synced_keys_refused_on_every_write_path` and `::test_front_matter_value_under_a_synced_key_is_ignored` (T4); `frontend/src/views/table/TableLayout.m29.test.tsx::synced cells are read-only and a drag never writes` (T11).
3. **A fact lands on the wrong object.** Two Hosts with the same title, a title that is another Host's alias, case and surrounding spaces, a Page titled like a Host, a template, an object excluded from AI, match by a key that names a synced or non-text property. Test: `backend/tests/test_m29_synced_store.py::test_match_rules` (T3) and `test_m29_sync_api.py::test_item_results` (T6).
4. **A refresh loses facts.** Two calls for different keys on one object (sequential and in two threads), a call where one item is invalid, `null` for one key, a store file that is not valid JSON. Test: `test_m29_synced_store.py::test_merge_keeps_other_keys` and `::test_unreadable_store_is_never_rewritten` (T3); `test_m29_sync_api.py::test_two_threads_keep_both_keys` (T6).
5. **A bad name pattern breaks creating.** A pattern hand-written into a type JSON as `{foo}`, `*`, a 10 000-character string, a regex-looking `(a+)+$`, or a non-string; a last type that was deleted or is read-only. The create row must still open, never hang, and ignore the bad pattern; saving such a type answers 422. Test: `backend/tests/test_m29_typesuggest.py::test_bad_patterns_are_ignored_and_refused_on_save` (T2) and the parity rows in `suggest-cases.json` run by `frontend/src/create/typeSuggest.test.ts` (T8).

## Contract (T1)

### Storage

| What | Where | Written by |
|---|---|---|
| The synced mark | the property's definition in the type JSON, top-level key `synced: {"source": str, "staleAfterDays": int}` (absent when not synced) | type settings (`PUT /api/types/{id}`), the IT ops starter |
| Name patterns | the type JSON, top-level key `namePatterns: [str]` (absent when empty) | type settings, the IT ops starter |
| Synced values | `.object/synced/<typeId>.json`: `{objectId: {"values": {key: value}, "refreshedAt": "YYYY-MM-DDTHH:MM:SS.sssZ"}}`; `value` is the front-matter form `propvalues.encode_value` gives (a string, number, boolean, or list of strings) | `Space.sync_facts` only |
| The last type used | localStorage `object.lastType:<space root>` (per viewer, per space), `{typeId: string | null}` | the front end's create paths |

`synced` is a different thing from M13's two-way relation sync (`options.propertySyncing`), which keeps its name and place.

### Type model (`backend/objectapp/typemodel.py`)

```python
SYNCABLE_KINDS = frozenset({"text", "url", "number", "boolean", "datetime", "datetimeSimple", "label"})
SYNCED_STALE_DEFAULT = 7
MAX_SYNC_SOURCE = 60
MAX_STALE_DAYS = 365

@dataclass(frozen=True)
class SyncedSpec:
    source: str
    staleAfterDays: int = SYNCED_STALE_DEFAULT
    @classmethod
    def parse(cls, data: Any) -> SyncedSpec | None   # None for anything malformed (kept in `extra`)
    def to_json(self) -> dict[str, Any]              # {"source", "staleAfterDays"}

# PropertyDefinition gains a top-level field (M28's counterpart stays in `options`):
    synced: SyncedSpec | None = None                  # to_json writes "synced" only when set
# TypeDefinition gains:
    namePatterns: list[str] = field(default_factory=list)   # every string entry as read; to_json only when non-empty

def synced_problems(entry: dict[str, Any]) -> list[str]
"""For one property JSON entry of a type save: [] when it has no `synced` or a valid one."""
```

`_V2_PROP_KEYS` gains `"synced"`; `_TYPE_KEYS` gains `"namePatterns"`. A malformed `synced` read from disk leaves `synced=None` and keeps the raw value in `extra` (written back as it was). `synced_problems` messages (our strings):
- `'"{name}" can\'t be synced: only text, URL, number, checkbox, date and label properties can.'`
- `'The source of "{name}" must be 1-60 characters on one line.'`
- `'"Stale after" of "{name}" must be a whole number of days from 1 to 365.'`

### Synced store and helpers (`backend/objectapp/synced.py`)

```python
FOLDER = "synced"
MAX_ITEMS = 1000
MAX_MATCH_VALUE = 300
MatchBy = Literal["title", "alias", "key"]
ItemStatus = Literal["updated", "notFound", "ambiguous", "invalid"]

@dataclass(frozen=True)
class SyncedEntry:
    values: dict[str, Any]
    refreshedAt: str

@dataclass(frozen=True)
class Candidate:                       # one object of the type, as matching sees it
    path: str
    objectId: str | None
    title: str
    aliases: tuple[str, ...]
    keys: dict[str, str]               # text/url property key -> its decoded value

@dataclass
class ItemResult:
    index: int
    status: ItemStatus
    path: str | None = None
    objectId: str | None = None
    paths: list[str] | None = None     # ambiguous only
    detail: str | None = None
    def to_api(self) -> dict[str, Any] # None fields left out

@dataclass
class SyncOutcome:
    typeId: str
    refreshedAt: str
    revision: str
    results: list[ItemResult]
    idWrites: list[tuple[str, str]]    # (path, new version) of objects that got their id

def synced_props(t: TypeDefinition | None) -> list[PropertyDefinition]
def is_stale(refreshed_at: str | None, stale_after_days: int, now: datetime) -> bool
def norm(text: str) -> str            # strip, collapse inner whitespace, casefold
def find_matches(candidates: Sequence[Candidate], by: MatchBy, value: str, key: str | None) -> list[Candidate]
def check_match(t: TypeDefinition, by: str, value: Any, key: Any) -> str | None   # the "invalid" detail, or None
def encode_facts(t: TypeDefinition, values: dict[str, Any]) -> dict[str, Any]     # raises InvalidValue

class SyncedStore:
    def __init__(self, store: JsonStore) -> None
    def data(self, type_id: str) -> dict[str, Any]                       # {} when no file; cached by (mtime_ns, size)
    def entry(self, type_id: str, object_id: str | None) -> SyncedEntry | None
    def overlay(self, t: TypeDefinition | None, fm: dict) -> dict        # fm itself when t has no synced props
    def apply(self, type_id: str, updates: dict[str, dict[str, Any]], refreshed_at: str) -> str
```

- `overlay` returns a shallow copy of `fm` in which each synced key holds the store's value, and a synced key the store has no value for is removed (so a hand-typed front-matter value never shows). Without an `id` in `fm`, every synced key is removed.
- `apply` merges per object and per key: `updates[objectId][key] = value` sets, `None` removes that key; keys not sent are kept; each object in `updates` gets `refreshedAt`. One `JsonStore.write` at the revision just read, under the space lock. Raises `ReadOnly` (unreadable file) and `RevisionConflict`.
- Matching (`find_matches`): `title` compares `norm(title)`; `alias` compares `norm` of each alias; `key` compares `norm(keys[key])`. Candidates are the type's objects only (the caller excludes templates and objects hidden from the API).
- `check_match` details (our strings): `'"by" must be title, alias or key.'`; `'"value" must be 1-300 characters.'`; `'Matching by key needs "key": a text or URL property of {type}.'`; `'"{key}" is synced: match by a property the script doesn't fill.'`.
- `encode_facts` refuses (InvalidValue, our strings): `'"{key}" isn\'t a synced property of {type}.'`; a label text that is not an option: `'"{text}" isn\'t an option of {name}.'`; otherwise `propvalues.encode_value`'s own messages.

### Type suggestion (`backend/objectapp/typesuggest.py`; TS port `frontend/src/create/typeSuggest.ts`)

```python
MAX_PATTERNS = 20
MAX_PATTERN = 100
TOKENS = ("{ip}", "{cidr}", "{fqdn}", "{version}")

@dataclass(frozen=True)
class SuggestContext:
    types: Sequence[TypeDefinition]          # the types this create row offers, in its order
    allowed: Sequence[str] = ()              # a relation property's allowed type ids (empty: any)
    scope: Sequence[str] = ()                # the collection's or query's type ids
    last: str | None = None                  # the type used last in this space

def compile_pattern(pattern: str) -> re.Pattern[str] | None    # None when invalid
def pattern_problems(patterns: Any) -> list[str]                # for a type save
def matches(name: str, patterns: Sequence[str]) -> bool
def suggest_type(name: str, context: SuggestContext) -> list[str]
```

```ts
export interface SuggestContext { types: readonly TypeDef[]; allowed?: readonly string[]; scope?: readonly string[]; last?: string | null }
export function compilePattern(pattern: string): RegExp | null
export function matches(name: string, patterns: readonly unknown[]): boolean
export function suggestType(name: string, ctx: SuggestContext): string[]
export const SUGGEST_TEXT = { suggested: 'Suggested' }   // our string
```

**Pattern syntax** (our call; the whole name must match, case-insensitive, after `strip`):
- A pattern that is exactly one token: `{ip}` an IPv4 address (`^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$`) or an IPv6 address (`^(?=.*:.*:)[0-9a-f:]+$`); `{cidr}` an IPv4 address with `/0`-`/32` or an IPv6 one with `/0`-`/128`; `{fqdn}` three or more dot-separated labels (`[a-z0-9]`, inner `-`, 1-63 characters) whose last label is 2-63 letters; `{version}` a name, whitespace, then a version token at the end (`^\S.*\s+v?\d+(\.\d+)*[a-z]?$`).
- Anything else is a glob: `*` any run of non-space characters (or none), `?` one non-space character, `#` one digit, `@` one letter `a-z`, `\` makes the next character literal; every other character is literal. It compiles to a regex with no nested quantifiers (`*` → `\S*`), so matching is linear.
- Invalid (ignored by `matches`, refused by `pattern_problems`): not a string, empty, over 100 characters, containing `{` or `}` without being exactly a token, a trailing `\`. More than 20 patterns is refused on save.
- `pattern_problems` messages (our strings): `'"{p}" isn\'t a name pattern. Use *, ?, #, @ or one of {ip}, {cidr}, {fqdn}, {version}.'`; `'A type can have at most 20 name patterns.'`; `'A name pattern is at most 100 characters.'`.

**The rule** (`suggest_type`, ids only of types in `context.types`):

```python
pattern_ids = [t.id for t in context.types if matches(name, t.namePatterns)]
ctx_ids = [i for i in (context.allowed or context.scope) if i in offered]   # a relation's types win over a scope
if ctx_ids:
    return [i for i in ctx_ids if i in pattern_ids] + [i for i in ctx_ids if i not in pattern_ids]
return pattern_ids + ([context.last] if context.last in offered and context.last not in pattern_ids else [])
```

The first id is the suggestion; the create row lists it first (with "Suggested") and every other offered type below in its usual order. An empty list means no suggestion: the row keeps today's default (Page in the palette and Turn into object; the type list as before elsewhere).

**Parity fixture** `frontend/src/create/__fixtures__/suggest-cases.json`: `{"types": [{id, namePatterns}], "cases": [{name, ctx: {allowed?, scope?, last?}, expect: [ids]}], "patterns": [{pattern, valid, matches: [str], misses: [str]}]}`, at least 40 cases. Both `test_m29_typesuggest.py` and `typeSuggest.test.ts` run every row.

### The starter's patterns and synced facts (T5, in `itops_types()`)

| Type | `namePatterns` |
|---|---|
| Host (`host`) | `{ip}`, `{fqdn}`, `SRV-*`, `@@##`, `@@@##`, `@@@@##`, `@*-##` |
| Network (`network`) | `{cidr}` |
| Software (`software`) | `{version}` |

Host's synced properties (id = key; `synced: {"source": "Inventory script", "staleAfterDays": 7}`; visibility `alwaysShow`; in this order after M28's Host properties):

| Key | Name | Kind | Options |
|---|---|---|---|
| `lastBoot` | Last boot | `datetime` | `constraints: {resolutionPreference: "time", endTimeSettings: "notAllowed"}` |
| `diskFree` | Disk free | `number` | description "Free disk space, in GB" (our string) |
| `patchState` | Patch state | `label` single | Current (green), Pending (amber), Failed (red), Unknown (gray) (our options) |
| `rebootPending` | Reboot pending | `boolean` | |
| `lastSeen` | Last seen | `datetime` | as Last boot |

### Tokens (`backend/objectapp/tokens.py`, `v1guard.py`)

```python
SCOPES = ("read", "read-write", "sync")
SCOPE_MESSAGE = "scope must be read, read-write or sync."
SYNC_ONLY = "This token can only write synced facts."        # our string: any other v1 write with a sync token
CANT_SYNC = "This token can't write synced facts."          # our string: a read token on the sync route
# V1Guard gains:
def auth_sync(self, request: Request) -> TokenRecord          # read-write or sync, then WRITE_GUARDS; raises Denied
```

`V1Guard.auth(write=True)` answers 403 `SYNC_ONLY` for a `sync` token (instead of "This token can only read."). A `sync` token reads like a `read` token. Ephemeral (agent) tokens are unchanged.

### Routes

- `POST /api/v1/synced/{typeId}` (`api_v1_synced.py`, mounted in `server.py`). `typeId` is a type id or name (`Space._type_id`). Body:

```python
class SyncMatch(BaseModel): by: str; value: Any; key: str | None = None
class SyncItem(BaseModel): match: SyncMatch; values: dict[str, Any]
class SyncRequest(BaseModel): items: list[SyncItem]
```

  - `200 {"type": str, "refreshedAt": str, "revision": str, "updated": int, "results": [ItemResult.to_api()]}`, one result per item in order. Item statuses: `updated` (with `path`, `objectId`); `notFound` (`'No {type} has the {by} "{value}".'`); `ambiguous` (`paths`, `'{n} {plural} have the {by} "{value}".'`); `invalid` (the `check_match`/`encode_facts` detail). Failed items never stop the others.
  - `401`/`403`/`429` from `V1Guard.auth_sync`; `404 'There is no object type "{x}".'`; `422 '{type} has no synced properties.'`, `422 'At most 1000 items per call.'`, `422` for a body that does not parse; `423 {reason}` when the store file is unreadable.
  - Announces `ChangeEvent("synced", typeId, revision, origin="api:<token name>")` when anything was updated, and `changed` for each object that got its id. Logs one activity entry per call: `guard.log(token, "sync", ".object/synced/<typeId>.json", count=updated)`.
- `GET /api/object` gains `synced: {"refreshedAt": str | null, "values": {key: decoded value}}` when the object's type has synced properties (absent otherwise). `frontmatter` stays the file's own. `computed` is computed from the overlaid front matter.
- `POST /api/rows` rows (and every v1 route built on `Space.rows`) carry synced values in `values` and `syncedAt: str | null` when the type has synced properties.
- `PUT /api/types/{id}` answers `422` with the first `synced_problems` or `pattern_problems` message (checked next to M28's `check_type`).
- `PUT /api/object/properties`, `/api/v1/object/properties` and automations refuse a synced key: `422 '"{name}" is filled by {source} and can\'t be edited.'` (`SYNCED_READ_ONLY`, our string, in `synced.py`).
- `POST /api/integrations/tokens` accepts `scope: "sync"`; `GET /api/v1/whoami` answers it.

### MCP (`mcp_server.py`, `toolcatalog.py`)

```python
@server.tool(annotations=WRITE)
def sync_facts(type: str, items: list[dict]) -> dict:
    """Fill synced properties (read-only in Object) of objects of a type, matched by title, alias
    or a key property: items = [{"match": {"by": "title"|"alias"|"key", "value": "...", "key"?: "fqdn"},
    "values": {"lastBoot": "...", ...}}]. Never changes the objects' files."""
    # POST /synced/{_seg(type)} {"items": items}
def build_server(client: ObjectClient, write: bool = True, sync: bool | None = None) -> MCPServer
# sync None means `write`. main(): scope = whoami scope; write = scope == "read-write"; sync = scope in ("read-write", "sync")
```

`toolcatalog.OBJECT_WRITE` gains `"sync_facts"` (after M27's names, comment `# M29`).

### Events

`ChangeEvent.kind` (and the TS `ChangeKind`) gains `"synced"`: `path` the type id, `version` the store revision. The front end reloads that type's rows and the open object's `synced` block.

### API types (`frontend/src/api/types.ts`)

```ts
export interface SyncedSpec { source: string; staleAfterDays: number }
export const SYNCED_STALE_DEFAULT = 7
export const SYNCABLE_KINDS: ReadonlySet<PropertyType>   // text, url, number, boolean, datetime, datetimeSimple, label
// PropertyDef gains:   synced?: SyncedSpec | null
// TypeDef gains:       namePatterns?: string[]
export interface ObjectSynced { refreshedAt: string | null; values: Record<string, unknown> }
// ObjectDetail gains:  synced?: ObjectSynced
// Row gains:           syncedAt?: string | null
export type ApiTokenScope = 'read' | 'read-write' | 'sync'
// ChangeKind gains:    | 'synced'
```

### Front-end modules (exact names)

```ts
// frontend/src/properties/synced.tsx
export const SYNCED_TEXT = {
  refreshed: (source: string, ago: string) => `${source} · Refreshed ${ago}`,
  never: (source: string) => `${source} · Not refreshed yet`,
  stale: 'Stale',
  readOnly: (name: string, source: string) => `"${name}" is filled by ${source} and can't be edited.`,
}                                                   // our strings
export function isSynced(def: PropertyDef | undefined | null): boolean
export function isStale(refreshedAt: string | null | undefined, staleAfterDays: number, now: Date): boolean
export function SyncedLine(props: { def: PropertyDef; refreshedAt: string | null; now?: Date }): JSX.Element
// frontend/src/create/lastType.ts
export const useLastType: UseBoundStore<{ typeId: string | null; set(typeId: string): void }>
export function setLastTypeSpace(root: string | null): Promise<void>
// frontend/src/create/suggestContext.ts
export function scopeTypesOfActiveTab(): string[]   // collection: its typeIds; query: its definition's type ids; type page: [id]; else []
export function suggestFor(name: string, types: readonly TypeDef[], extra?: { allowed?: readonly string[]; scope?: readonly string[] }): string[]
// (= suggestType(name, { types, allowed, scope: extra.scope ?? scopeTypesOfActiveTab(), last: useLastType.getState().typeId }))
```

`ago` is `automations/ruleModel.ts`' `ago(at, now)` ("5 minutes ago").

---

## Tasks

### Task 1: Contract, stubs and fixtures

**Files**
- Create: `backend/objectapp/synced.py` and `backend/objectapp/typesuggest.py` (constants, dataclasses and signatures; bodies `raise NotImplementedError`), `backend/objectapp/api_v1_synced.py` (`def router(ctx: ApiContext) -> APIRouter` with no routes), `frontend/src/create/__fixtures__/suggest-cases.json`, `backend/tests/fixtures/space-synced/` (below), `backend/tests/test_m29_contract.py`, `frontend/src/create/contract.m29.test.ts`
- Modify: `backend/objectapp/typemodel.py` (`SyncedSpec`, the two fields, `SYNCABLE_KINDS`, the constants, `synced_problems`, `_V2_PROP_KEYS`, `_TYPE_KEYS`), `backend/objectapp/tokens.py` (`SCOPES`, `SCOPE_MESSAGE` used by `create` and `ephemeral`), `backend/objectapp/watcher.py` (`"synced"` in `ChangeEvent.kind`), `frontend/src/api/types.ts`, `frontend/src/test/mockApi.ts` (`synced`/`syncedAt` passed through in object and row helpers)

**Interfaces**
- Consumes: M28's `typemodel.py` as built (`valid_counterpart`, `_API_ONLY_KEYS` with `"counterparts"`); nothing of it changes.
- Produces: the Contract's type model, `synced.py` and `typesuggest.py` signatures, tokens constants, API types.

**Fixture space** `backend/tests/fixtures/space-synced/` (synthetic):
- `.object/types/host.json`: Host with `fqdn` (text), `ipAddress` (text), the five synced properties of the Contract table, and Host's `namePatterns`. `.object/types/network.json` (`namePatterns: ["{cidr}"]`), `.object/types/software.json` (`["{version}"]`).
- `Hosts/APP01.md`: `id`, `fqdn: app01.example.test`, `aliases: [app01-old]`.
- `Hosts/SRV-02.md`: CRLF and a UTF-8 BOM, `id`, and a hand-typed `lastBoot: 2020-01-01T00:00:00.000Z` line (to be ignored).
- `Hosts/Print box.md`: no `id`, `aliases: [PRN-TEST-01]`.
- `Hosts/WEB01.md` and `Hosts/Lab/WEB01.md`: two Hosts titled WEB01 (ambiguous).
- `Hosts/Gateway.md`: `excludeFromAI: true` (hidden from the API).
- `Pages/APP01.md`: a Page titled APP01 (another type).
- `Hosts/Templates/Host template.md`: a Host template (`template: Host template`).

**Steps**
- [ ] 1. Failing tests. `test_m29_contract.py`: `::test_synced_spec_roundtrip` (`PropertyDefinition.from_json({... "synced": {"source": "Inventory script"}}).synced == SyncedSpec("Inventory script", 7)`; `to_json()["synced"] == {"source": "Inventory script", "staleAfterDays": 7}`; a definition without `synced` has no `"synced"` key in `to_json()`; `{"synced": "yes"}` reads as `None` and is written back as `"yes"`), `::test_name_patterns_roundtrip` (absent when empty; `["{ip}", 5]` keeps both entries as read), `::test_synced_problems` (each of the three messages; a `relation` kind is refused; `staleAfterDays: 0` and `366` refused, `1` and `365` accepted), `::test_scopes` (`SCOPES == ("read", "read-write", "sync")`; `TokenStore.create("Inventory", "sync")` works; `"admin"` raises `SCOPE_MESSAGE`), `::test_fixture_space_is_synthetic` (no file names a real host or person; `SRV-02.md` starts with the BOM and has `\r\n`; `Print box.md` has no `id`). `contract.m29.test.ts`: `SYNCABLE_KINDS.has('label') && !SYNCABLE_KINDS.has('entity')`, `SYNCED_STALE_DEFAULT === 7`, the fixture parses and has at least 40 cases.
- [ ] 2. Run: `uv run pytest backend/tests/test_m29_contract.py -q`; `cd frontend && npx vitest run src/create/contract.m29.test.ts && npx tsc -b --noEmit`. They fail.
- [ ] 3. Implement the contract files and stubs as above.
- [ ] 4. Run again: pass; `tsc` clean; `uv run pytest backend/tests/test_typemodel*.py backend/tests/test_tokens*.py -q` still pass.
- [ ] 5. Commit: `feat(m29): contract: synced mark, name patterns, sync scope, fixtures` (with the trailer).

### Task 2: Type suggestion and name patterns (Python)

**Files**
- Modify: `backend/objectapp/typesuggest.py`
- Create: `backend/tests/test_m29_typesuggest.py`

**Interfaces**
- Consumes: `TypeDefinition.namePatterns` (T1), the parity fixture (T1).
- Produces: `compile_pattern`, `pattern_problems`, `matches`, `suggest_type`, `SuggestContext` (Contract).

- [ ] 1. Failing tests:
  - `test_parity_cases`: every `cases` row gives its `expect`; every `patterns` row's `valid`, `matches` and `misses` hold.
  - `test_starter_patterns`: with Host, Network, Software patterns of the Contract: `"APP01"`, `"SRV-02"`, `"SRV-web"`, `"10.20.0.5"`, `"fe80::1"`, `"app01.example.test"`, `"PRN-TEST-01"` → `["host"]`; `"10.20.0.0/24"` → `["network"]`; `"SQL Server 2019"`, `"Python 3.12"`, `"7-Zip 23.01"` → `["software"]`; `"Line 3 printer"`, `"README.md"`, `"example.test"`, `"Office365"`, `"Meeting 2026-11-09"` → `[]`.
  - `test_context_first`: `allowed=["software"]` and name `"APP01"` → `["software"]`; `allowed=["host", "application"]` and `"APP01"` → `["host", "application"]`; `allowed=["host", "application"]` and `"Payroll"` → `["host", "application"]`; `scope=["network"]` and `"APP01"` → `["network"]`; allowed beats scope; an allowed id not offered is dropped.
  - `test_last_type_fallback`: no match, `last="runbook"` → `["runbook"]`; a match plus `last` → `[match, "runbook"]`; `last` not offered (deleted, read-only, so not in `types`) → `[]`.
  - `test_bad_patterns_are_ignored_and_refused_on_save`: `compile_pattern` is `None` for `"{foo}"`, `"a{ip}"`, `""`, `"x" * 101`, `"abc\\"`; `matches("APP01", ["{foo}", 5, None, "@@@##"])` is True; `matches("a" * 5000 + "!", ["*@*@*@*@*@*#"])` returns False in under 50 ms; `pattern_problems(["{foo}"])` gives the first message, 21 patterns the second, a 101-character pattern the third; `pattern_problems("x")` and `pattern_problems([1])` give a problem; `[]` and `None` give none.
  - `test_case_and_spaces`: `"  app01 "` → `["host"]`; `"srv-02"` → `["host"]`.
- [ ] 2. Run: `uv run pytest backend/tests/test_m29_typesuggest.py -q`. Fails.
- [ ] 3. Implement `typesuggest.py` (no I/O; compiled patterns cached with `functools.lru_cache(maxsize=512)`).
- [ ] 4. Run: pass.
- [ ] 5. Commit: `feat(m29): type suggestion and name patterns`.

### Task 3: The synced store and its helpers

**Files**
- Modify: `backend/objectapp/synced.py`
- Create: `backend/tests/test_m29_synced_store.py`

**Interfaces**
- Consumes: `jsonstore.JsonStore`, `propvalues.encode_value`, `decode_value`, `label_lookup`; `typemodel.SyncedSpec` (T1).
- Produces: everything in the Contract's `synced.py` block except what `Space` does.

- [ ] 1. Failing tests (a `JsonStore(tmp, "synced", {}, lock=RLock())` over a temp root):
  - `test_overlay`: a Host `fm` with `id: h1` and `lastBoot: 2020-…` overlays to the store's `lastBoot`; a synced key the store lacks is removed; `fm` without `id` loses every synced key; a type without synced props returns the same `fm` object (`is`); the input `fm` is never mutated.
  - `test_merge_keeps_other_keys`: `apply("host", {"h1": {"lastBoot": A}}, T1)` then `apply("host", {"h1": {"diskFree": 41.5}}, T2)` → `h1.values == {"lastBoot": A, "diskFree": 41.5}`, `refreshedAt == T2`; `{"h1": {"diskFree": None}}` removes only `diskFree`; another object's entry is untouched; the file is `dump_json` of `{h1: {values, refreshedAt}}`.
  - `test_unreadable_store_is_never_rewritten`: `.object/synced/host.json` holding `{not json` → `apply` raises `ReadOnly` and the bytes are unchanged; `data("host")` is `{}`.
  - `test_cache_follows_the_file`: `data` after an outside rewrite of the file returns the new content (mtime/size change); a second `data` without changes does not re-parse (patched `parse_json_object` called once).
  - `test_match_rules`: candidates APP01 (alias `app01-old`, `fqdn app01.example.test`), two WEB01: `find_matches(c, "title", " app01 ", None)` → APP01; `("alias", "APP01-OLD", None)` → APP01; `("title", "app01-old", None)` → none (an alias is not a title); `("key", "APP01.example.test", "fqdn")` → APP01; `("title", "WEB01", None)` → both.
  - `test_check_match`: `by="name"`, an empty value, a 301-character value, `by="key"` without `key`, `key="lastBoot"` (synced) and `key="patchState"` (not text/url) each give their Contract message; a valid one gives `None`.
  - `test_encode_facts`: `{"lastBoot": {"start": "2026-11-08T07:12:00.000Z", "resolution": "time"}, "diskFree": 41.5, "patchState": "Current", "rebootPending": False}` encodes to JSON-safe front-matter values; `"patchState": "Reboot required"` raises `'"Reboot required" isn\'t an option of Patch state.'`; `"fqdn"` raises `'"fqdn" isn\'t a synced property of Host.'`; `"diskFree": "lots"` raises `encode_value`'s message.
  - `test_is_stale`: refreshed exactly 7 days ago → False; 7 days and 1 second → True; `None` → False; `stale_after_days=1` and 25 hours → True.
- [ ] 2. Run: `uv run pytest backend/tests/test_m29_synced_store.py -q`. Fails.
- [ ] 3. Implement `synced.py` (values stored as plain JSON: `encode_value`'s ruamel scalars converted with `str`/`float`/`int`/`bool`/`list`).
- [ ] 4. Run: pass.
- [ ] 5. Commit: `feat(m29): synced facts store`.

### Task 4: Space: overlay, read-only keys, the sync, exports

**Files**
- Modify: `backend/objectapp/space.py` (`Space.synced: SyncedStore`, built in `__init__` over `self.store("synced")` with `before_write=None`; `Space.synced_fm(summary, fm) -> dict`; the refusal in `update_properties` and the second refusal block near line 2654; `Space.sync_facts`), `backend/objectapp/rows.py` (`_row` overlays before decoding and before `Obj(...)`; `Row.syncedAt`), `backend/objectapp/automations.py` (the two `setProperty`/`clearProperty` checks refuse `pdef.synced`), `backend/objectapp/export.py` (`build_doc` and `export_properties` read the overlaid front matter; `_markdown` appends the synced values as front-matter lines to the exported copy only)
- Create: `backend/tests/test_m29_space_synced.py`

**Interfaces**
- Consumes: `SyncedStore`, `find_matches`, `check_match`, `encode_facts`, `Candidate`, `ItemResult`, `SyncOutcome`, `SYNCED_READ_ONLY` (T3).
- Produces:

```python
def synced_fm(self, summary: ObjectSummary, fm: dict) -> dict      # overlay by the summary's type
def sync_facts(self, type_id: str, items: list[dict[str, Any]], hidden: set[str], now: datetime | None = None) -> SyncOutcome
# raises KeyError (no such type), InvalidValue (no synced props; > MAX_ITEMS), ReadOnly (store unreadable)
```

`sync_facts`: checks every item (`check_match`, `encode_facts`), matches among the type's non-template objects not in `hidden`, ensures an id for each matched id-less object (`ensure_id(path, history=False)`), then one `synced.apply` with every updated object at one `refreshedAt` (`self.clock()`, ISO with milliseconds and `Z`). Two items that resolve to the same object merge in item order.

- [ ] 1. Failing tests (fixture `space-synced` copied to `tmp_path`, `OBJECT_STATE_DIR` in `tmp_path`):
  - `test_opening_and_reading_write_nothing`: open the space, `rows()`, `read` every object, `synced_fm` for each → no `.object/synced/` folder, every file's bytes unchanged.
  - `test_front_matter_value_under_a_synced_key_is_ignored`: SRV-02's row has `values["lastBoot"] is None` before any sync, and the store's value after one; the file's own line stays.
  - `test_rows_and_computed_use_synced_values`: after a sync of APP01 (`diskFree: 12`), its row has `values["diskFree"] == 12` and `syncedAt` equal to the outcome's `refreshedAt`; a formula `prop("Disk free") * 2` on Host gives 24; a Page row has no `syncedAt`.
  - `test_synced_keys_refused_on_every_write_path`: `update_properties(APP01, {"diskFree": 5})` and `remove=["lastBoot"]` raise `'"Disk free" is filled by Inventory script and can\'t be edited.'`; an automation `setProperty` on `patchState` is refused like a read-only kind; nothing is written.
  - `test_sync_facts_outcomes`: seven items, in order: title `APP01` (`diskFree: 12`) → `updated` with path `Hosts/APP01.md` (never `Pages/APP01.md`); alias `PRN-TEST-01` → `updated` (`Hosts/Print box.md`); key `fqdn` = `app01.example.test` (`patchState: "Current"`) → `updated` (APP01 again, merged with the first item); title `WEB01` → `ambiguous` with both paths; title `Gateway` (hidden) → `notFound`; title `Host template` (a template) → `notFound`; title `SRV-02` with `diskFree: "lots"` → `invalid`. The store then holds APP01 `{diskFree: 12, patchState: "Current"}` and Print box; `Print box.md` gains exactly one `id` line and nothing else; a second sync of it writes no `.md`.
  - `test_sync_limits`: a type with no synced properties → `InvalidValue('Page has no synced properties.')`; 1001 items → `InvalidValue('At most 1000 items per call.')`; an unknown type → `KeyError`.
  - `test_exports_include_synced_values`: the HTML export of APP01 lists "Disk free" with `12`; the Markdown export's front matter has `diskFree: 12` while `APP01.md` on disk does not; SRV-02's Markdown export keeps CRLF and the BOM.
- [ ] 2. Run: `uv run pytest backend/tests/test_m29_space_synced.py -q`. Fails.
- [ ] 3. Implement the signatures above.
- [ ] 4. Run: pass; also `uv run pytest backend/tests/test_rows*.py backend/tests/test_export*.py backend/tests/test_automations*.py backend/tests/test_space*.py -q`.
- [ ] 5. Commit: `feat(m29): synced facts in the space (overlay, read-only, sync, exports)`.

### Task 5: The IT ops starter's synced facts and patterns

**Files**
- Modify: `backend/objectapp/basicsetup.py` (`itops_types()`: Host's five synced properties and the three types' `namePatterns`), `backend/objectapp/typetemplates.py` (only if M28's gallery entries for Host, Network and Software are not built from `itops_types()`: the same additions there)
- Create: `backend/tests/test_m29_starter.py`

**Interfaces**
- Consumes: M28's `itops_types()`, `write_itops_types(root)`, `ITOPS_TYPE_IDS`, the gallery entries; `SyncedSpec` (T1); `typesuggest.pattern_problems` (T2, in the test only).
- Produces: the Contract's starter tables, in the starter and the gallery.

- [ ] 1. Failing tests:
  - `test_host_synced_facts`: `itops_types()`'s Host has, in this order at the end, `lastBoot` (Last boot, datetime), `diskFree` (Disk free, number), `patchState` (Patch state, single label Current/Pending/Failed/Unknown), `rebootPending` (Reboot pending, boolean), `lastSeen` (Last seen, datetime), each `synced == SyncedSpec("Inventory script", 7)`; no other starter type has a synced property.
  - `test_starter_patterns`: Host, Network and Software have the Contract's `namePatterns`; every other starter type has none; `pattern_problems` of each list is `[]`.
  - `test_written_types_roundtrip`: `write_itops_types(tmp)` then `load_types(tmp)` gives the same `synced` and `namePatterns`; `synced_problems` is `[]` for every written property.
  - `test_gallery_host_has_synced_facts_and_patterns`: creating Host from the gallery (`POST /api/types {name: "Host", pluralName: "Hosts", template: "host"}`) gives the same five synced properties and patterns.
  - `test_existing_host_type_is_not_topped_up`: a space whose `.object/types/host.json` was written without them opens with no change to that file.
- [ ] 2. Run: `uv run pytest backend/tests/test_m29_starter.py -q`. Fails.
- [ ] 3. Implement. If M28 already added these keys as plain properties, set `synced` on them instead of adding new ones (the test pins the end state).
- [ ] 4. Run: pass; `uv run pytest backend/tests/test_basicsetup.py backend/tests/test_m28*.py -q`.
- [ ] 5. Commit: `feat(m29): starter Host synced facts and name patterns`.

### Task 6: The sync route, the scope and type-save checks

**Files**
- Modify: `backend/objectapp/api_v1_synced.py` (the route), `backend/objectapp/v1guard.py` (`auth_sync`, `SYNC_ONLY` in `auth`), `backend/objectapp/server.py` (mount `api_v1_synced.router(ctx)`; `GET /api/object`'s `synced` and overlaid `computed`; `save_type`'s `synced_problems` and `pattern_problems` checks; the module docstring's route list), `backend/objectapp/api_v1.py` (the docstring's scope list; `create_token` passes `sync` through, nothing else)
- Create: `backend/tests/test_m29_sync_api.py`

**Interfaces**
- Consumes: `Space.sync_facts`, `Space.synced_fm` (T4), `SyncOutcome`, `ItemResult.to_api` (T3), `synced_problems` (T1), `pattern_problems` (T2), `V1Guard.hidden_paths`.
- Produces: the Contract's routes, status codes and events.

- [ ] 1. Failing tests (`create_app` over a copy of `space-synced`, no `ui_key`; tokens made through `TokenStore`):
  - `test_scope_rules`: a `sync` token: `POST /api/v1/synced/host` → 200; `GET /api/v1/whoami` → `scope: "sync"`; a v1 read → 200; `POST /api/v1/object/properties` → 403 `"This token can only write synced facts."`. A `read` token on the sync route → 403 `"This token can't write synced facts."`; a `read-write` token → 200; no token → 401.
  - `test_item_results`: the body of T4's outcome test answers 200 with `results` in item order, `updated` counted, `notFound` detail `'No Host has the title "Gateway".'`, ambiguous detail `'2 Hosts have the title "WEB01".'` with both paths; a match by type name `/api/v1/synced/Host` works; `/api/v1/synced/nope` → 404 `'There is no object type "nope".'`; `/api/v1/synced/page` → 422 `'Page has no synced properties.'`; 1001 items → 422; `{"items": "x"}` → 422.
  - `test_sync_never_touches_md_files`: three syncs (all hosts, then one key, then `null` for one key) → every `.md` and `.object/types/*.json` byte-identical to before except `Print box.md`'s single added `id` line on the first; no version-history entry for any object; `SRV-02.md` keeps CRLF and its BOM.
  - `test_two_threads_keep_both_keys`: two threads sync APP01 `lastBoot` and `diskFree` at once → the store has both.
  - `test_events_and_activity`: one `synced` event with `path == "host"` and the new revision, `origin == "api:<token name>"`; one `changed` event for `Print box.md` on its first sync only; one activity entry per call with `action == "sync"`.
  - `test_object_read_and_rows`: `GET /api/object?path=Hosts/APP01.md` has `synced.values.diskFree == 12`, `synced.refreshedAt`, and `frontmatter` without `diskFree`; `POST /api/rows {typeIds:["host"]}` rows carry `syncedAt`; a Page read has no `synced`.
  - `test_unreadable_store_is_423`: a broken `.object/synced/host.json` → 423, the file unchanged.
  - `test_type_save_checks`: `PUT /api/types/host` with `namePatterns: ["{foo}"]` → 422 with the pattern message; with `synced` on a relation property → 422 with the kind message; with valid ones → 200 and the file holds them.
- [ ] 2. Run: `uv run pytest backend/tests/test_m29_sync_api.py -q`. Fails.
- [ ] 3. Implement the route (`guarded`, `auth_sync`, `space.sync_facts(type_id, items, guard.hidden_paths())`), the guard changes and the `server.py` changes.
- [ ] 4. Run: pass; `uv run pytest backend/tests/test_m11*.py backend/tests/test_v1*.py backend/tests/test_server*.py -q`.
- [ ] 5. Commit: `feat(m29): POST /api/v1/synced and the sync scope`.

### Task 7: The MCP tool

**Files**
- Modify: `backend/objectapp/mcp_server.py` (`sync_facts`, `build_server(..., sync=None)`, `main()`), `backend/objectapp/toolcatalog.py` (`"sync_facts"` in `OBJECT_WRITE`), the M17 catalogue count test (`backend/tests/test_m17_toolcatalog.py` or the file that counts `OBJECT_WRITE`: its expected count + 1)
- Create: `backend/tests/test_m29_mcp.py`

**Interfaces**
- Consumes: the route shape (Contract); `ObjectClient.post`.
- Produces: the MCP tool `sync_facts(type: str, items: list[dict]) -> dict`.

- [ ] 1. Failing tests (a fake `ObjectClient` recording calls):
  - `test_sync_facts_posts`: `sync_facts("Host", [{"match": {"by": "title", "value": "APP01"}, "values": {"diskFree": 12}}])` posts to `/synced/Host` with `{"items": [...]}`; a type name with `/` is quoted (`_seg`).
  - `test_tools_by_scope`: `build_server(client, write=True)` lists `sync_facts` and every write tool; `build_server(client, write=False, sync=True)` lists the read tools and `sync_facts` only; `write=False, sync=False` has no `sync_facts`.
  - `test_main_reads_the_scope`: with `whoami` answering `sync`, `main` builds with `write=False, sync=True`; `read-write` → `True, True`; `read` → `False, False`.
  - `test_catalogue_lists_sync_facts`: `"mcp__object__sync_facts"` is in the agent catalogue's Object write group, on by default.
- [ ] 2. Run: `uv run pytest backend/tests/test_m29_mcp.py -q`. Fails.
- [ ] 3. Implement.
- [ ] 4. Run: pass; `uv run pytest backend/tests/test_m11_mcp*.py backend/tests/test_m17*.py -q`.
- [ ] 5. Commit: `feat(m29): sync_facts MCP tool`.

### Task 8: Type suggestion in TypeScript, the last type, the context

**Files**
- Create: `frontend/src/create/typeSuggest.ts`, `frontend/src/create/typeSuggest.test.ts`, `frontend/src/create/lastType.ts`, `frontend/src/create/lastType.test.ts`, `frontend/src/create/suggestContext.ts`, `frontend/src/create/suggestContext.test.ts`

**Interfaces**
- Consumes: the parity fixture (T1); `TypeDef.namePatterns`; `nav/spaceStorage.switchStoreSpace`; `nav/tabs.useTabs` (the active tab), the collection and query stores the tabs read.
- Produces: `compilePattern`, `matches`, `suggestType`, `SUGGEST_TEXT`; `useLastType`, `setLastTypeSpace`; `scopeTypesOfActiveTab`, `suggestFor` (Contract).

- [ ] 1. Failing tests:
  - `typeSuggest.test.ts`: `parity cases` (every fixture row, as T2); `a pathological name returns quickly` (`'a'.repeat(5000) + '!'` against `['*@*@*@*@*@*#']` in under 50 ms); `ignores non-string patterns`.
  - `lastType.test.ts`: `set('host')` persists under `object.lastType:<root>`; switching space gives that space's value; a missing or garbled stored value reads as `null`; localStorage throwing leaves `typeId` `null` and `set` still updates memory.
  - `suggestContext.test.ts`: a collection tab with `typeIds ['host','application']` → `scopeTypesOfActiveTab()` is that list; a query tab gives its definition's type ids; a type page gives `[id]`; an object tab gives `[]`; `suggestFor('APP01', types)` with last `runbook` → `['host', 'runbook']`; with `{ allowed: ['software'] }` → `['software']`.
- [ ] 2. Run: `npx vitest run src/create/typeSuggest.test.ts src/create/lastType.test.ts src/create/suggestContext.test.ts`. Fails.
- [ ] 3. Implement (regex flags `i`, compiled patterns memoised in a `Map` capped at 512).
- [ ] 4. Run: pass.
- [ ] 5. Commit: `feat(m29): type suggestion port, last type and create context`.

### Task 9: Create rows in `[[` / `@` and relation pickers

**Files**
- Modify: `frontend/src/links/LinkPicker.tsx`, `frontend/src/properties/RelationPicker.tsx`
- Create: `frontend/src/links/LinkPicker.m29.test.tsx`, `frontend/src/properties/RelationPicker.m29.test.tsx`

**Interfaces**
- Consumes: `suggestFor`, `useLastType`, `SUGGEST_TEXT` (T8); `api.createObject(typeId, { title })`; `NEW_OBJECT_TEXT.newNamed` (`New '<q>'`, from `create/NewObjectMenu.tsx`, imported only).
- Produces: the create rows below.

The `[[` / `@` picker today has no create row. With a query typed, after the matching objects it gains a create row `New '<q>'` with the suggested type's chip and "Suggested" (our string) on the right, then a row "Other types" (our string, with `ph-caret-right`) that lists every other writable type (not read-only, not DailyNote; Whiteboard excluded in `embed` mode as today); picking a type creates `<q>` of it (no `templateId`, so the default template applies), inserts the link (or embed) as picking an existing object does, and sets the last type. With no suggestion the create row uses the Page type. An exact title match among the shown objects still lists the create rows below it.

A relation picker (`RelationPicker`, not the Tag-only "Create 'x'" path, which stays) with a query that matches no candidate exactly gains `Create '<q>'` rows: one per allowed type (all writable types when `allowedTypes` is empty), the suggested one first with "Suggested" (`suggestFor(q, offered, { allowed })`). Picking one creates the object, adds it to the value (`onChange`), and sets the last type.

- [ ] 1. Failing tests:
  - `LinkPicker.m29.test.tsx`: `typing APP01 offers New 'APP01' as Host, suggested` (Host has the starter patterns, mock API); `Other types lists the rest and creates with the picked type`; `Enter on the create row calls createObject('host', { title: 'APP01' }) with no templateId and inserts [[APP01]]`; `no suggestion falls back to Page`; `the last type is set to host`; `an empty query shows recents and types as before` (no create row).
  - `RelationPicker.m29.test.tsx`: `a relation to Software offers Create 'SQL Server 2019' as Software only`; `a relation allowing Host and Application puts Host first for 10.20.0.5`; `picking creates and adds the ref`; `the Tag relation keeps its own Create row` (M5's test still passes).
- [ ] 2. Run: `npx vitest run src/links/LinkPicker.m29.test.tsx src/properties/RelationPicker.m29.test.tsx src/links src/properties/RelationPicker.test.tsx`. Fails.
- [ ] 3. Implement.
- [ ] 4. Run: pass.
- [ ] 5. Commit: `feat(m29): suggested type in the link and relation create rows`.

### Task 10: Suggested type in "+ New", the palette and Turn into object

**Files**
- Modify: `frontend/src/create/NewObjectMenu.tsx`, `frontend/src/palette/searchOptions.ts`, `frontend/src/palette/SearchView.tsx`, `frontend/src/editor/handles/BlockMenu.tsx` (`TurnIntoObjectItems`), `frontend/src/editor/turnInto.ts` (`turnIntoObject` without a type uses the suggestion), `frontend/src/create/createAndOpen.ts` (sets the last type), `frontend/src/App.tsx` (`setLastTypeSpace(s.root)` beside `setRecentSpace`)
- Create: `frontend/src/create/NewObjectMenu.m29.test.tsx`, `frontend/src/palette/searchOptions.m29.test.ts`, `frontend/src/editor/turnInto.m29.test.ts`

**Interfaces**
- Consumes: `suggestFor`, `scopeTypesOfActiveTab`, `useLastType`, `SUGGEST_TEXT` (T8).
- Produces: `buildSearchOptions(query, types, tags, filters, suggested?: string | null)` (new last parameter; the create row's type is the type filter's, else `suggested`, else Page).

- "+ New object" without a type (`NewObjectMenu` step 1, nothing typed yet): the suggested type (context, else last) is the first row with "Suggested"; the others follow in today's order. Step 2 and a given `typeId` are unchanged.
- The palette: with no type filter, the one create row "Create new {type} with title "{q}"" uses `suggestFor(q, types)[0]`, else Page; the other types stay reachable through the type filter rows as today.
- Turn into object: `TurnIntoObjectItems` lists the suggested type (for the block's title) first with "Suggested"; the `I` shortcut (`turnIntoObject(editor)` without a type) uses the suggestion, else Page as today.
- Every create through `createAndOpen` and these rows sets the last type; none passes a `templateId` unless it did before.

- [ ] 1. Failing tests:
  - `NewObjectMenu.m29.test.tsx`: `on a collection of Hosts, Host is first and marked Suggested`; `elsewhere the last type is first`; `no last type keeps the order as before`; `picking the suggested type creates with no templateId`.
  - `searchOptions.m29.test.ts`: `buildSearchOptions('SRV-02', types, [], NO_FILTERS, 'host')[0]` is `{kind: 'create', typeId: 'host', label: 'Create new Host with title "SRV-02"'}`; a type filter beats the suggestion; `suggested` null → Page.
  - `turnInto.m29.test.ts`: `I on a block "10.20.0.0/24" creates a Network`; `I on "Shopping list" with no last type creates a Page`; `TurnIntoObjectItems puts Software first for "Python 3.12"`; `createAndOpen sets the last type`.
- [ ] 2. Run: `npx vitest run src/create src/palette src/editor/turnInto.m29.test.ts src/editor/handles`. Fails.
- [ ] 3. Implement.
- [ ] 4. Run: pass (existing palette, NewObjectMenu and turnInto tests still pass).
- [ ] 5. Commit: `feat(m29): suggested type in New, the palette and Turn into object`.

### Task 11: Synced facts in the object page and views

**Files**
- Create: `frontend/src/properties/synced.tsx` (the Contract's module, including `SyncedLine`), `frontend/src/properties/synced.test.tsx`, `frontend/src/object/PropertyPanel.m29.test.tsx`, `frontend/src/views/table/TableLayout.m29.test.tsx`
- Modify: `frontend/src/object/PropertyPanel.tsx` (`synced?: ObjectSynced` prop; `cellValue` takes the synced value for a synced def; the row read-only with `SyncedLine` under it; muted with "Stale"), `frontend/src/object/ObjectView.tsx` (passes `detail.synced`; on a `synced` event for its type, refetches the object and replaces only `synced`), `frontend/src/views/table/TableLayout.tsx` (a synced cell is read-only and muted when stale), `frontend/src/views/rowWrites.ts` (a write to a synced key is refused with `SYNCED_TEXT.readOnly`, nothing sent), `frontend/src/views/useRows.ts` (a `synced` event reloads the rows of that type)

**Interfaces**
- Consumes: `ObjectDetail.synced`, `Row.syncedAt`, `PropertyDef.synced`, `ChangeKind 'synced'` (T1); `ago` from `automations/ruleModel.ts`.
- Produces: `isSynced`, `isStale`, `SyncedLine`, `SYNCED_TEXT`.

- [ ] 1. Failing tests:
  - `synced.test.tsx`: `isStale` as T3's `test_is_stale` (7 days exactly false, plus one second true, null false); `SyncedLine` reads `Inventory script · Refreshed 5 minutes ago`, `Inventory script · Not refreshed yet` without a time, and shows `Stale` muted after 8 days.
  - `PropertyPanel.m29.test.tsx`: `a synced row shows the store value, not the front matter`; `it offers no editor` (click opens nothing, no `onChange`); `the source line and Stale`; `hideWhenEmpty` still hides an empty synced row; `a non-synced row is unchanged`.
  - `TableLayout.m29.test.tsx`: `synced cells are read-only and a drag never writes` (a Kanban drag of a row from Patch state Current to Failed calls no API and shows the refusal toast); `a stale row's synced cell is muted`; `a synced event for host reloads host rows only`.
- [ ] 2. Run: `npx vitest run src/properties/synced.test.tsx src/object/PropertyPanel.m29.test.tsx src/views/table/TableLayout.m29.test.tsx`. Fails.
- [ ] 3. Implement.
- [ ] 4. Run: pass; `npx vitest run src/object src/views`.
- [ ] 5. Commit: `feat(m29): synced facts shown read-only with source and stale marking`.

### Task 12: Settings: the synced mark, name patterns, the sync token

**Files**
- Create: `frontend/src/properties/settings/SyncedSection.tsx`, `frontend/src/properties/settings/SyncedSection.test.tsx`, `frontend/src/types/NamePatternsSection.tsx`, `frontend/src/types/NamePatternsSection.test.tsx`, `frontend/src/settings/sections/Integrations.m29.test.tsx`
- Modify: `frontend/src/properties/PropertySettings.tsx` (mounts `SyncedSection` for `SYNCABLE_KINDS`), `frontend/src/types/TypeSettings.tsx` (mounts `NamePatternsSection`), `frontend/src/settings/sections/Integrations.tsx` (the third scope choice and its label in the token list)

**Interfaces**
- Consumes: `SyncedSpec`, `SYNCABLE_KINDS`, `SYNCED_STALE_DEFAULT`, `ApiTokenScope` (T1); `compilePattern` (T8, to flag a bad line before saving).
- Produces: the strings below (all our strings).

```ts
export const SYNCED_SETTINGS_TEXT = {
  title: 'Synced',
  description: 'Filled only by a script or agent through the API. Read-only in Object, and never written to the file.',
  toggle: 'Synced from a script or agent',
  source: 'Source', sourcePlaceholder: 'Inventory script',
  staleAfter: 'Stale after', days: (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`,
  hidesFileValues: 'Values typed into the file for this property stop showing.',
}
export const NAME_PATTERNS_TEXT = {
  title: 'Name patterns',
  description: 'New objects whose name matches one of these suggest this type. One per line: * any characters, ? one character, # a digit, @ a letter, or {ip}, {cidr}, {fqdn}, {version}.',
  invalid: (line: string) => `"${line}" isn't a name pattern.`,
}
// INTEGRATIONS_TEXT gains: sync: 'Synced facts only', syncHelp: 'Read, and fill synced properties (POST /api/v1/synced).'
```

- [ ] 1. Failing tests:
  - `SyncedSection.test.tsx`: `the toggle needs a source` (on with an empty source saves nothing and flags the field); `source and stale after are saved` (typing "Inventory script" saves `synced: { source: 'Inventory script', staleAfterDays: 7 }`; setting 3 days saves `staleAfterDays: 3`); `turning it off saves synced null`; `not shown for a relation or formula property`.
  - `NamePatternsSection.test.tsx`: `one pattern per line saves namePatterns`; `a bad line is flagged and not saved`; `an empty box saves []`; `a 422 from the server shows its detail`.
  - `Integrations.m29.test.tsx`: `the scope choice offers Synced facts only`; `creating it posts scope 'sync'`; `the token list labels it Synced facts only`.
- [ ] 2. Run: `npx vitest run src/properties/settings/SyncedSection.test.tsx src/types/NamePatternsSection.test.tsx src/settings/sections/Integrations.m29.test.tsx`. Fails.
- [ ] 3. Implement.
- [ ] 4. Run: pass; `npx vitest run src/properties src/types src/settings`.
- [ ] 5. Commit: `feat(m29): synced, name pattern and sync token settings`.

### Task 13: Integrate: acceptance and docs

**Files**
- Create: `scripts/m29_acceptance.py`, `docs/superpowers/plans/m29-acceptance.md`
- Modify: `docs/behavior-catalog.md` (a "Synced facts" and a "Suggested type" entry, marked beyond the catalog), `docs/superpowers/plans/remaining-work.md` (M29 status line), `CONTINUE.md` (M29 built; M30 next)

**Interfaces**
- Consumes: everything above; `scripts/m2_acceptance.py` helpers (`Http`, `Run`, `commit`, `git`, `changed_paths`, `hunk_keys`, `free_port`) as `m22_acceptance.py` uses them; the stdio `objectapp-mcp` session as `m11_acceptance.py` starts it.

- [ ] 1. Write `scripts/m29_acceptance.py SPACE [--keep]` (default `backend/tests/fixtures/space-synced`). It copies SPACE to a temp folder (SPACE is never touched), commits the copy to a throw-away git repo, sets `OBJECT_STATE_DIR`, `OBJECT_CACHE_DIR` and `OBJECT_CLOCK_FILE` (2026-11-09T10:00:00Z) to temp paths outside the copy, serves `create_app` on a free `127.0.0.1` port, and checks over HTTP, printing `[ok]`/`[FAIL]` per check and `RESULT: PASS` at the end (non-zero exit on any failure). No agent runs, so no `claude` (real or fake) is started.
  1. Reads write nothing: `GET /api/types`, `POST /api/rows`, `GET /api/object` of every Host → `git status` clean, no `.object/synced/`.
  2. A `sync` token made through `POST /api/integrations/tokens {scope: "sync"}`; `POST /api/v1/synced/host` with the fixture's items → the statuses of T6's `test_item_results`.
  3. `git status` after the sync lists only `Hosts/Print box.md` (its `id` line, by `hunk_keys`) and `.object/synced/host.json`; a second sync changes only `.object/synced/host.json`; `SRV-02.md` still has CRLF and the BOM.
  4. `GET /api/object` of SRV-02 shows the store's `lastBoot`, not the file's 2020 value; `PUT /api/object/properties {diskFree}` → 422 with `"Disk free" is filled by Inventory script and can't be edited.`
  5. The sync token on `POST /api/v1/object/properties` → 403 `"This token can only write synced facts."`.
  6. Over a stdio `objectapp-mcp` session with the sync token: the tool list has the read tools and `sync_facts` and no other write tool; `sync_facts("Host", …)` updates APP01's `diskFree`.
  7. The clock moves to 2026-11-17 (8 days on): APP01's row `syncedAt` is unchanged and older than 7 days (the UI marks it Stale).
  8. `PUT /api/types/host` with `namePatterns: ["{foo}"]` → 422; the type file unchanged.
  9. `git status` lists nothing else; the state dir holds the token file and the activity log only.
- [ ] 2. Write `docs/superpowers/plans/m29-acceptance.md`: how to run the script, then hand checks for Gene (`- [ ]`), on a copy of his space:
  - [ ] Create a space with "IT operations": Host shows Last boot, Disk free, Patch state, Reboot pending and Last seen, each with "Inventory script · Not refreshed yet".
  - [ ] Make a "Synced facts only" token in Settings > Integrations and send one host's facts with `curl` (the example in this file); the Host page shows them with "Refreshed just now", and nothing in the `.md` changed (`git status` shows only `.object/synced/`).
  - [ ] The synced rows offer no editor in the page, the table or a Kanban board grouped by Patch state.
  - [ ] Set the clock or wait: after 7 days the values show muted with "Stale".
  - [ ] Filter a Hosts table by Patch state is Failed, and sort by Disk free: synced values work as any property.
  - [ ] Type `[[APP03` in a page: "New 'APP03'" offers Host first, marked Suggested; "Other types" lists the rest.
  - [ ] Type `10.30.0.0/24` in the palette: the create row is "Create new Network with title …"; `SQL Server 2022` suggests Software.
  - [ ] On a collection of Applications, "+ New" lists Application first.
  - [ ] In a Host's Operating system relation, typing a new name offers "Create 'Windows Server 2022'" as Software.
  - [ ] Turn a line "PRN-TEST-02" into an object with `I`: it becomes a Host with the Host template's sections.
  - [ ] Add a name pattern of your own in a type's settings; a bad one (`{foo}`) is refused.
- [ ] 3. Run the gate: `uv run pytest backend/tests -q`; `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run lint && npm run build`; `uv run python scripts/m29_acceptance.py` (prints `RESULT: PASS`); `uv run python scripts/m11_acceptance.py` and `scripts/m22_acceptance.py` (modules touched: tokens, MCP, `space.py`); M28's `scripts/m28_acceptance.py`.
- [ ] 4. Commit: `test(m29): acceptance script and hand checks; docs status`.

## Shared files and ordering

| Shared file | Owner | Others needing a change say so in their report |
|---|---|---|
| `backend/objectapp/typemodel.py`, `tokens.py`, `watcher.py` | T1 | |
| `frontend/src/api/types.ts`, `frontend/src/test/mockApi.ts` | T1 | T8-T12 |
| fixtures `backend/tests/fixtures/space-synced/`, `frontend/src/create/__fixtures__/suggest-cases.json` | T1 | T2, T4, T6, T8, T13 read them |
| `backend/objectapp/typesuggest.py` | T1 creates; T2 fills | T5, T6 import |
| `backend/objectapp/synced.py` | T1 creates; T3 fills | T4, T6 import |
| `backend/objectapp/space.py`, `rows.py`, `automations.py`, `export.py` | T4 | |
| `backend/objectapp/basicsetup.py`, `typetemplates.py` | T5 | |
| `backend/objectapp/api_v1_synced.py` | T1 creates; T6 fills | |
| `backend/objectapp/server.py`, `v1guard.py`, `api_v1.py` | T6 | |
| `backend/objectapp/mcp_server.py`, `toolcatalog.py`, the M17 catalogue count test | T7 | |
| `frontend/src/create/typeSuggest.ts`, `lastType.ts`, `suggestContext.ts` | T8 | T9, T10, T12 import |
| `frontend/src/links/LinkPicker.tsx`, `properties/RelationPicker.tsx` | T9 | |
| `frontend/src/create/NewObjectMenu.tsx`, `createAndOpen.ts`, `palette/searchOptions.ts`, `palette/SearchView.tsx`, `editor/handles/BlockMenu.tsx`, `editor/turnInto.ts`, `App.tsx` | T10 | |
| `frontend/src/object/PropertyPanel.tsx`, `object/ObjectView.tsx`, `views/table/TableLayout.tsx`, `views/rowWrites.ts`, `views/useRows.ts`, `properties/synced.tsx` | T11 | T12 imports `synced.tsx` only through types |
| `frontend/src/properties/PropertySettings.tsx`, `types/TypeSettings.tsx`, `settings/sections/Integrations.tsx` | T12 | |
| `docs/behavior-catalog.md`, `docs/superpowers/plans/remaining-work.md`, `CONTINUE.md` | T13 | |

## Lanes

T1 runs first, alone. Then four tracks (counted from the Files lists; no file is in two tracks):

| Track | Tasks, in order | Waits for |
|---|---|---|
| B1 (back end, store and routes) | T3, T4, T6 | T6 waits for T2 (B2): `server.py` imports `pattern_problems` |
| B2 (back end, suggestion, starter, MCP) | T2, T5, T7 | T5's gallery test uses the app; nothing else |
| F1 (front end, create rows) | T8, T9, T10 | |
| F2 (front end, synced display and settings) | T11, T12 | T12 waits for T8 (F1) for `compilePattern` |

T13 integrates after all tracks. Then one whole-milestone review (correctness, file safety, fidelity to the spec), one fix pass, the final gate (T13 step 3), and Gene's hands-on check.

## Our calls

1. **Synced values are stored in front-matter form** (`encode_value`'s output) so every reader decodes them as it decodes the file; the store's shape is the spec's `{objectId: {values, refreshedAt}}`. (ours)
2. **The store wins outright**: a front-matter value under a synced key is ignored everywhere and never removed from the file; before the first sync the property is empty, shown as "Not refreshed yet". This is how "a hand-edit to the file is overwritten on the next refresh" reads once the values live outside the file. (ours)
3. **An object without an `id` gets one on its first sync** (`ensure_id`, one line, no version kept); the store is keyed by id as the spec says, and later refreshes never touch the file. **Decided by Gene, 2026-11-09: add the id line** (not the "notFound: no id yet" alternative).
4. **One refreshed time per object per type file**, set on every sync of that object even when values are unchanged, so "Stale" means "not confirmed lately". (spec: "a refreshed time per object")
5. **A refresh merges per key**: keys not sent are kept; `null` removes one. (ours)
6. **Matching** is exact after trimming, collapsing spaces and case folding; within the type only; templates and objects excluded from AI are not found (the v1 rule for every route); two or more matches write nothing for that item ("ambiguous"). `key` matching needs a text or URL property that is not itself synced. (ours)
7. **Item failures never fail the call**: one result per item, and the call is 200 with the counts. Caps: 1000 items per call, 300-character match values. (ours)
8. **The `sync` scope reads like `read`** and writes only synced facts; `read-write` tokens (and agent runs) may also sync. The MCP server registers `sync_facts` for both and no other write tool for `sync`. (ours; spec: "a read-write token, and a new sync scope")
9. **Syncable kinds**: text, URL, number, checkbox, date (both kinds) and label. A label value must be one of the property's options (a sync never edits the type). (ours)
10. **Stale after**: 1-365 whole days, default 7 (spec's value); stale strictly after that many days. (ours)
11. **Exports include synced values**: HTML, Word and LaTeX list them among the properties; the Markdown export adds them to the exported copy's front matter. The file on disk is untouched. (ours; spec: "Exports include them")
12. **One activity-log entry and one `synced` event per call**, not per object, so an hourly inventory of hundreds of hosts doesn't flood the log or the windows. (ours)
13. **The starter's Patch state options** Current, Pending, Failed, Unknown; Disk free is a plain number described "in GB"; the five facts are always shown (so "Not refreshed yet" is visible). (ours)
14. **Name pattern syntax**: globs with `*` (no spaces), `?`, `#` digit, `@` letter, `\` escape, or one whole token `{ip}`, `{cidr}`, `{fqdn}` (three or more labels), `{version}` (a name, a space, a version number). Host's patterns beyond the spec's `APP01`, `SRV-*`, IP and FQDN examples (`@@##`, `@@@@##`, `@*-##`) are ours. (spec: "the name-pattern syntax" left to the builder)
15. **Suggestion order**: a relation's allowed types beat a collection's or query's types; within the context, a pattern match comes first; without context, pattern matches in the row's type order, then the last type. (ours)
16. **The last type** is the type of the last object created through any create path, per viewer and per space, in localStorage, never sent to the server. (ours)
17. **New create rows**: `[[` / `@` had no create row, so it gains "New '<q>'" (suggested type) plus "Other types"; a relation picker gains "Create '<q>'" per allowed type (the Tag-only row stays); the palette keeps one create row, now of the suggested type; Turn into object's `I` uses the suggestion instead of always Page. (ours, to give the spec's create rows somewhere to be)
18. **The front end runs the TypeScript port**; the Python module is the reference both test against the same fixture, checks patterns on type save, and is there for agents and M30. No suggestion route. (ours; spec: "fast, predictable, nothing sent anywhere")
19. **No top-up**: a Host type written by M28 before this milestone keeps its file; Gene adds the facts in type settings or makes a fresh space (spec non-goal: existing spaces' types never change automatically). (ours)
20. **M28's names** are used as given (checked against the M28 plan: ids `host`, `network`, `software`; counterpart in `options.counterpart`; M28 leaves the synced facts and `namePatterns` of `itops_types()` to this plan). The synced mark is a top-level property field rather than an option, because it is a property's behaviour, not a kind option, and must survive `normalize_options`. (ours)
