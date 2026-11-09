# Milestone 30: entity extraction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal.** The import's AI filing pass also returns, per page, its **main entity**, the **entity candidates** it mentions and the **relations** between them, each with its quote. The app checks them, resolves duplicates into one entity per thing (names and aliases, plus the agent's merges), and shows Gene a new **Entities** step in the import wizard where each entity can be accepted, renamed, merged, split or turned down. On **Write**, the app creates the accepted entities (or makes a page its main entity's notes, or reuses an object already in the space), sets the stored side of each relation, and links every mention in the batch's pages. Low-confidence links go to the Import inbox.

**Architecture.** Three new modules under `backend/objectapp/importers/`, each with one job: `entitycheck.py` checks one decision's candidates against its page (the same quote rules as M27's `filing._check_quote`); `entities.py` does resolution, the entity rule, Gene's review and the wizard's view (reads only); `entitywrite.py` writes what Gene accepted, using M28's relation counterparts to pick the stored side and M5's `link_mention` for mentions. `importers/filing.py` (M27) calls the checker from `apply_decision`, stops the bulk pass in a new `entities` state, and runs the write in its worker thread before its existing links pass, inbox and report. Routes go on M27's `api_import_agent.py`; an outside agent reads the list through a new read tool `import_entities` (there is no tool to accept or write entities, as there is none to apply a proposal). The front end adds `EntitiesStep.tsx` between Trial and Normalise in M27's `AgentFlow`.

**Tech Stack.** Python 3 (FastAPI, pydantic), `uv`; React, TypeScript, shadcn/ui, Tailwind, vitest. No new dependencies. Agent runs only through the `claude` CLI as M27 runs them; tests use the fake `claude` (`backend/tests/fake_claude.py`, whose `FAKE_CLAUDE_FILING` decisions pass the new fields through unchanged).

**Spec.** `docs/superpowers/specs/2026-11-09-it-ops-type-model-design.md`, **section 5** (entity extraction on import), extending sections **8** (the schema proposal), **9** (the AI filing pass) and **12** (MCP tools) of `docs/superpowers/specs/2026-11-06-import-migration-design.md`. Built after M28 (IT ops starter and two-way relations) and M29 (synced facts and type suggestion); their names are consumed as given in the M28-M30 brief.

## Global Constraints

- Nothing is written before Gene's approval of the schema (M27's Apply) and of the entity list (this milestone's **Write**). Reading the Entities step, saving the review and the MCP read write no `.md` file.
- Never write on read; property edits change only their own lines; one `update_properties` per object for all its values, aliases and relation links; CRLF and BOM kept; atomic writes through `Space._write`.
- Deletes go to the Trash: Move batch to Trash moves the entities the batch **created** (not pages it converted, not objects it only linked to), restorable.
- One side of a relation is stored (M28's "Stored on" side, in that object's frontmatter); the counterpart is computed by M28's index and never written.
- Every value, alias and relation needs a quote copied from the page; the app checks it (M27's rules: the quote is in the document, has at least `MIN_QUOTE = 3` characters, and says the value).
- **The entity rule** (spec section 5): a candidate becomes an object when it exists on its own (it is a page's main entity), or more than one page mentions it (`MIN_PAGES = 2`), or it has properties of its own (a value that passed its check). Otherwise it stays text. Categories (Server, VM, Production: a label option of a type in the space, or a tag) become property values or tags, never entities.
- Trial pass: `TRIAL_SIZE = 50` objects; agent batches of `BATCH_SIZE = 40`; confidence levels `high | medium | low`; quotes and the scan run as in M27.
- Links from low-confidence candidates (the relation's confidence, or either side's, is `low`) are not written: the page goes to the "Import inbox" collection with the reason.
- Synced properties (M29 `PropertyDefinition.synced`) are never filled by the import.
- Unlinked mentions stay: linking mentions changes only the batch's pages; every other object's unlinked mentions are still listed.
- Document text is untrusted: the decisions block is the only thing taken from a run; the run stays read-only (M27's `filing_write_guard`).
- Fixtures are synthetic (hosts `APP01`, `SRV-DB01`; software "SQL Server 2019"; application "Payroll"; location "HQ"). No real CPI data. Tests use `OBJECT_STATE_DIR` in a temp folder and the fake `claude`; never `~/.claude`.
- The server binds 127.0.0.1 only; `/api` needs the per-launch key (tests built with `create_app` and no `ui_key` skip it).
- Never name the original notes app nor the open-source agent whose patterns the agents design adopts.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

The five failure modes no task's ordinary tests would catch, most likely first. Each has its test in the owning task.

1. **Mention linking breaks text or over-reaches.** A name inside a code span, an existing `[[link]]` or a Markdown link; a partial word (`APP01` inside `APP010`); offsets that shift after the first link in a page; a page outside the batch, or the entity's own page, getting links. Test: `backend/tests/test_m30_write.py::test_mentions_linked_in_batch_pages_only_whole_words` (T4): every occurrence in the batch pages becomes a link, last to first; the code span, the existing link and `APP010` are untouched; a non-batch page still lists APP01 under unlinked mentions.
2. **Duplicates.** An entity that already exists in the space (Gene's own Host "app01", or one an earlier batch of the same source made) gets a second object; a double press of Write, or a retry after a failed write, places entities twice. Test: `test_m30_write.py::test_existing_object_is_reused_and_write_is_resumable` (T4) and `backend/tests/test_m30_filing.py::test_rerun_and_second_write_create_nothing_new` (T5).
3. **Invented facts pass.** An alias the page never says, an entity name not in the page, a relation whose quote names only one side, a value for a synced property, a category ("Server") as an entity. Test: `backend/tests/test_m30_check.py::test_invented_aliases_names_relations_and_synced_values_refused` (T2) and `backend/tests/test_m30_resolve.py::test_categories_and_single_mentions_are_left_out` (T3).
4. **Converting a page loses something.** The main page's body, its `importSource` block, CRLF/BOM, or Gene's later edits; a page filed as a Runbook turned into a Host. Test: `test_m30_write.py::test_main_page_becomes_entity_keeps_body_and_provenance` (T4, on a CRLF+BOM page) and `test_m30_check.py::test_main_entity_needs_matching_type` (T2).
5. **Move batch to Trash takes too much or too little.** Created entities left behind; an object that existed before the import, or a converted page's second copy, trashed. Test: `test_m30_filing.py::test_trash_batch_takes_created_entities_only` (T5).

---

## Contract (T1)

### Storage

| What | Where | Written by |
|---|---|---|
| Checked candidates per page | M27's `filing.json` (`.object/imports/<batch>/`), in each result: `mainEntity`, `entities`, `relations`, `merges` | `Filing` (T5), from `entitycheck.check_candidates` |
| Gene's review | `.object/imports/<batch>/entities-review.json`: `EntitiesReview` | `Filing.save_entity_review` (T5) |
| What Write placed and did | `.object/imports/<batch>/entities-written.json`: `{placed: {entityId: path}, outcome: EntitiesWritten \| null}` (written after each entity is placed, so a retry resumes) | `entitywrite.write_entities` (T4) |
| Created entities | new `.md` objects in their type's folder, with an `importSource` block `{system: <batch source system>, id: "entity:<typeId>:<key>", batch, importedAt}`, and a `created` entry in `items.json`: `{sourcePath: "entity:<typeId>:<key>", system, id, title, path, action: "created", entity: true}` | `entitywrite` (T4) |
| Relations | the stored side's relation property in its frontmatter, value `{target: <title>, path}` as M27's links pass writes | `entitywrite` (T4) |
| Mention links | `[[...]]` in the batch's page bodies, through `references.link_mention` | `entitywrite` (T4) |
| Low-confidence links | M27's `inbox.json` rows `{path, title, reason, suggestedType: null}` and the page in the "Import inbox" collection | `Filing` (T5) |
| Report | a `## Entities` section in the batch's `report.md` and report page (beside M27's `## AI filing`) | `Filing` (T5) |

The resolved entity list is **computed** from `filing.json` and `entities-review.json` on every read (never stored), so a read writes nothing and the list can't go stale.

### The decision, extended (what the agent returns; spec section 5)

```jsonc
{ "path": "...", "type": "Host", "confidence": "high",
  "values": [...], "tags": [...], "collections": [...], "links": [...],          // M27, unchanged
  "mainEntity": {"type": "Host", "name": "APP01", "aliases": ["app01.corp.example"],
                 "values": [{"key": "fqdn", "value": "app01.corp.example", "quote": "..."}]},   // or null
  "entities": [{"type": "Software", "name": "SQL Server 2019", "aliases": ["SQL 2019"],
                "values": [{"key": "version", "value": "2019", "quote": "..."}], "confidence": "medium"}],
  "relations": [{"subject": "Payroll", "relation": "Runs on", "object": "APP01", "quote": "...", "confidence": "high"}],
  "merges": [{"type": "Software", "names": ["SQL 2019", "SQL Server 2019"]}] }
```

A candidate's `confidence` defaults to its decision's. `subject` / `object` are entity names or aliases, the page's own title, or the title of an object already in the space. `relation` is a relation property's name on the subject's type, or (M28) a counterpart's name, in which case the link is stored on the other side.

### Python names (`backend/objectapp/importers/`; T1 writes them as stubs raising `NotImplementedError`, the owning task fills them)

```python
# entitycheck.py (T2)
MIN_PAGES = 2
def check_candidates(space: Space, decision: dict, doc: str, page_path: str, page_title: str,
                     page_type: str | None) -> dict
    # -> {"mainEntity": CheckedEntity | None, "entities": [CheckedEntity], "relations": [CheckedRelation],
    #     "merges": [{"typeId", "names": [str], "ok": bool, "reason"?: str}]}
# CheckedEntity = {"typeId", "type", "name", "aliases": [str], "values": [{"key","value","quote","ok","reason"?}],
#                  "confidence", "main": bool, "ok": bool, "reason"?: str}
# CheckedRelation = {"subject","relation","object","quote","confidence","ok": bool, "reason"?: str}

# entities.py (T3)
REVIEW_FILE = "entities-review.json"
STATUSES = ("accepted", "renamed", "rejected")
class ReviewInvalid(ValueError): ...                     # 422, the message says why
@dataclass
class Entity:
    id: str                 # "<typeId>:<smallest member key>"
    typeId: str; type: str
    name: str               # the most-used spelling (first seen on a tie)
    aliases: list[str]      # every other spelling seen
    keys: set[str]          # norm_name of every member
    pages: list[str]        # mentioning pages (provenance), sorted
    mainPages: list[str]
    values: dict[str, dict] # key -> {"value","quote","page"}: the first passing value, main pages first, then by path
    confidence: str         # the highest of its candidates
    joinedByAgent: bool     # an agent merge joined it (offered as a split)
    rule: str | None        # "own" | "pages" | "properties" | None (stays text)
    category: bool
    existing: str | None    # path of an object of this type already in the space with that name or alias
def norm_name(text: str) -> str
def resolve(space: Space, results: dict[str, dict], review: dict | None = None) -> Resolution
@dataclass
class Resolution:
    entities: list[Entity]                     # rule met, not a category
    leftOut: list[Entity]                      # rule None or category
    suggestedMerges: list[dict]                # [{"ids": [...], "names": [...]}], near-duplicates within a type
    relations: list[dict]                      # every ok CheckedRelation, with "page"
def load_review(root: Path | str, batch: str) -> dict                 # EntitiesReview, empty when absent
def save_review(space: Space, batch: str, review: dict, results: dict[str, dict]) -> dict   # ReviewInvalid
def accepted(res: Resolution, review: dict) -> list[tuple[Entity, str]]  # (entity, final name), accepted or renamed
def undecided(res: Resolution, review: dict) -> list[str]                # ids of entities with no decision
def view(space: Space, batch: str, results: dict[str, dict], state: str) -> dict   # EntitiesView

# entitywrite.py (T4)
WRITTEN_FILE = "entities-written.json"
def write_entities(space: Space, batch: str, system: str, imported_at: str,
                   chosen: list[tuple[Entity, str]], res: Resolution, items: list[dict]) -> dict
    # -> EntitiesWritten plus "inboxLinks": [{"path","title","reason"}]; appends created items to `items`

# filing.py (T5), new Filing methods
def entities_view(self, batch: str) -> dict                   # KeyError: no such batch
def save_entity_review(self, batch: str, review: dict) -> dict  # ReviewInvalid, NotAllowed (written already)
def write_entities(self, batch: str) -> None                  # starts the worker; Busy, NotAllowed
```

### Filing states

M27's states `idle | running | trial | done | failed` gain `entities` (the bulk pass finished with at least one ok candidate; waiting for Gene) and `writing` (Write is running). The bulk pass (`_pass`, and `apply_external` after its trial) ends in `entities` when `any ok mainEntity or entity` in the results, else finishes as M27 does. Write ends in `done` (or `failed`, which Write can be run again from).

### Routes (`backend/objectapp/api_import_agent.py`, T6)

| Route | Request | Response | Errors |
|---|---|---|---|
| `GET /api/import/batches/{id}/entities` | | `EntitiesView` | 404 no batch |
| `PUT /api/import/batches/{id}/entities/review` | `EntitiesReview` (without `revision`) | `{ok: true, view: EntitiesView}` | 404; 409 written already; 422 `ReviewInvalid` (unknown id or status, empty rename, a merge across types, a split of names the entity doesn't have) |
| `POST /api/import/batches/{id}/entities/write` | `{}` | `202 {ok: true}` | 404; 409 another import running, a pass running, state not `entities`/`failed`-after-write, or undecided entities ("N entities are still to decide.") |
| `GET /api/v1/import/entities?batch=` | | `EntitiesView` | 401/403 token; 404 |

### Pydantic (`api_import_agent.py`) and TypeScript (`frontend/src/api/types.ts`)

```python
class EntityDecision(BaseModel): status: str; name: str | None = None
class SplitOp(BaseModel): id: str; names: list[str]
class EntitiesReviewRequest(BaseModel):
    decisions: dict[str, EntityDecision] = Field(default_factory=dict)
    merges: list[list[str]] = Field(default_factory=list)
    splits: list[SplitOp] = Field(default_factory=list)
```

```ts
export type FilingState = 'idle' | 'running' | 'trial' | 'entities' | 'writing' | 'done' | 'failed'
export type EntityStatus = 'accepted' | 'renamed' | 'rejected'
export interface EntityDecision { status: EntityStatus; name?: string }
export interface EntitiesReview {
  decisions: Record<string, EntityDecision>
  merges: string[][]
  splits: { id: string; names: string[] }[]
}
export interface EntityValue { key: string; value: unknown; quote: string; page: string }
export interface ImportEntity {
  id: string; typeId: string; type: string; name: string; aliases: string[]
  pages: { path: string; title: string }[]
  mainPages: string[]
  values: EntityValue[]
  confidence: FilingConfidence
  joinedByAgent: boolean
  existing: { path: string; title: string } | null
  rule: 'own' | 'pages' | 'properties'
  decision: EntityDecision | null
}
export interface EntityLeftOut { id: string; type: string; name: string; pages: number; reason: 'text' | 'category' }
export interface EntitiesWritten {
  created: number; fromPages: number; existing: number
  relations: number; relationsInbox: number; mentions: number
  failed: { name: string; reason: string }[]
}
export interface EntitiesView {
  state: 'collecting' | 'review' | 'writing' | 'written'
  entities: ImportEntity[]          // by type name, then name
  leftOut: EntityLeftOut[]
  suggestedMerges: { ids: string[]; names: string[] }[]
  relations: { total: number; lowConfidence: number }
  review: EntitiesReview
  undecided: number
  written: EntitiesWritten | null
}
// FilingTrialItem gains:
//   mainEntity?: { type: string; name: string } | null
//   entities?: { type: string; name: string; ok: boolean }[]
```

`EntitiesView.state`: `collecting` while the filing state is `idle | running | trial`, `review` in `entities`, `writing` in `writing`, `written` in `done` after a write.

### Client (`frontend/src/api/client.ts`) and mock (`frontend/src/test/mockApi.ts`)

```ts
importEntities(batchId: string): Promise<EntitiesView>                                  // GET .../entities
saveEntitiesReview(batchId: string, review: EntitiesReview): Promise<{ ok?: boolean; view: EntitiesView }>  // PUT .../entities/review
writeEntities(batchId: string): Promise<{ ok?: boolean }>                               // POST .../entities/write
```

The mock answers an empty `EntitiesView` (`state: 'collecting'`, empty lists, `undecided: 0`, `written: null`).

### MCP (spec section 12, extended)

| Tool | Does |
|---|---|
| `import_entities(batch)` (read, new) | the batch's entity list with Gene's decisions (`EntitiesView`). Only the user accepts and writes entities, in Object. |
| `save_import_decisions(batch, decisions)` (exists) | decisions may carry `mainEntity`, `entities`, `relations` and `merges`, checked the same way |

There is no tool to accept, merge, split or write entities.

### Strings (`frontend/src/import/agent/text.ts`, added to `AGENT_TEXT` by T1; our strings: the catalog has no import wizard text)

```ts
entitiesHeading: 'Entities',
entitiesIntro: 'The things these pages talk about. Accept, rename, merge, split or turn down each one. Links and mentions are written for the ones you accept.',
entitiesNone: 'No entities were found.',
typeGroup: (type: string, n: number) => `${type} (${n})`,
pagesCount: (n: number) => pl(n, 'page', 'pages'),
alsoCalled: (names: string[]) => `Also called ${names.join(', ')}`,
fromOwnPage: 'From its own page',
alreadyHere: 'Already in this space',
joinedByAgent: 'Merged by the agent',
rename: 'Rename',
renameLabel: 'New name',
selectLabel: (name: string) => `Select ${name}`,
mergeSelected: (n: number) => `Merge ${n} selected`,
split: 'Split',
splitIntro: 'Move these names to a new entity:',
suggestedHeading: 'These look like the same thing',
mergeSuggestion: 'Merge',
leftOutHeading: 'Not made into objects',
leftOutReason: { text: 'Stays text: one page, no properties of its own', category: 'A category: kept as a tag or property value' },
entityStatus: { accepted: 'Accepted', renamed: 'Renamed', rejected: 'Turned down' },
undecidedEntities: (n: number) => `${pl(n, 'entity', 'entities')} still to decide`,
acceptRest: 'Accept the rest',
write: 'Write',
writing: 'Writing…',
written: (w: { created: number; fromPages: number; existing: number; relations: number; mentions: number }) =>
  `${pl(w.created, 'object', 'objects')} created, ${w.fromPages} from their own page, ${w.existing} already here. ${pl(w.relations, 'link', 'links')} and ${pl(w.mentions, 'mention', 'mentions')} written.`,
relationsInbox: (n: number) => `${pl(n, 'low-confidence link', 'low-confidence links')} went to the Import inbox.`,
writeFailed: 'Writing stopped. What was written stays; Write again to finish.',
mainEntity: (type: string, name: string) => `About: ${type} ${name}`,
mentions: (names: string[]) => `Mentions: ${names.join(', ')}`,
```

### Prompt additions (`filing.build_prompt`, T5; our strings)

After M27's "Types you may choose" list: an "Entity types" list (every importable type of the space: `- Host: category (label: Server | ...), ..., runs (shown from Application "Runs on")`, each relation property as `key → Target types`), then:

```
Also list what each page is about and what it mentions (the user reviews the list before anything is written):
- "mainEntity": the one thing the page is about, when it is about one (a server page is about that Host); else null.
  Writing such as a runbook, script or meeting is not about one thing: leave mainEntity null and list what it covers.
- "entities": things the page names that exist on their own (hosts, software per version, applications, locations,
  networks, people, vendors...): {"type", "name", "aliases", "values": [{"key", "value", "quote"}], "confidence"}.
  A category (Server, VM, Production) is a property value or a tag, never an entity. Every name and alias must be
  written in the page.
- "relations": {"subject", "relation", "object", "quote", "confidence"}, relation being a relation property's name
  from the lists above; the quote must name both sides (the page's own subject may be left unnamed).
- "merges": names you know are the same thing, {"type", "names": [...]}.
```

### The skill (`importskill.TEXT`, T6)

Stage 5 gains the four fields with the entity rule verbatim from the Global Constraints, and a new stage line after 6: "**Entities** (gate: the user reviews the entity list in Object): the user accepts, renames, merges, splits or turns down each entity and writes them; read it back with `import_entities(batch)`. Links from low-confidence candidates go to the Import inbox."

---

## Tasks

### Task 1: Contract, stubs and fixtures

**Files:**
- Create: `backend/objectapp/importers/entitycheck.py`, `entities.py`, `entitywrite.py` (stubs: the Contract's names, docstrings, constants, dataclasses; functions raise `NotImplementedError`); `backend/tests/m30_helpers.py`; `backend/tests/test_m30_contract.py`
- Modify: `frontend/src/api/types.ts`, `frontend/src/api/client.ts`, `frontend/src/test/mockApi.ts`, `frontend/src/import/agent/text.ts`

**Interfaces:**
- Consumes: M28 `Space.apply_setup("itops")` (the IT ops types, with counterparts: Application "Runs on" → Host shown as "Runs"; Application "Uses" → Software "Used by"; Script/Command/Runbook "Covers" → "Documented in"; "Located at" → Location "Contains").
- Produces: everything in the Contract; `m30_helpers.itops_space(tmp_path) -> Path` (a copy of `space-sample` with `apply_setup("itops")`), `m30_helpers.make_itops_source(tmp_path) -> Path`, `m30_helpers.decisions(paths: dict[str, str]) -> dict` (the `FAKE_CLAUDE_FILING` JSON keyed by imported path), `m30_helpers.result(path, **checked) -> dict` (a filing result with checked candidates, for T3/T4 tests that skip the agent).

The synthetic source (`make_itops_source`): `Hosts/APP01.md` ("APP01 is the Payroll server at HQ. It runs Windows Server 2019. FQDN: app01.corp.example."), `Hosts/SRV-DB01.md` (CRLF with a BOM: "SRV-DB01 holds the Payroll database on SQL Server 2019."), `Apps/Payroll.md` ("Payroll runs on APP01 and uses SQL 2019."), `Runbooks/Restart Payroll.md` ("Restart Payroll on APP01: stop the service, check SQL Server 2019, start it. Not APP010. `APP01` in code. See [[APP01]]."), `Notes/Rack notes.md` ("Rack 4 at HQ holds a Server and a VM.").

- [ ] **Step 1: Write the failing test** `test_m30_contract.py::test_contract_names`: the three modules import; `entitycheck.MIN_PAGES == 2`; `entities.STATUSES == ("accepted", "renamed", "rejected")`; `entities.REVIEW_FILE == "entities-review.json"`; `entitywrite.WRITTEN_FILE == "entities-written.json"`; `Entity` has the Contract's fields; `make_itops_source` writes 5 files and `itops_space` has types named Host, Software, Application, Location, Runbook.
- [ ] **Step 2: Run** `uv run pytest backend/tests/test_m30_contract.py -q`. Expected: FAIL (no module).
- [ ] **Step 3: Implement** the stubs, helpers, TS types, client methods, mock entries and strings exactly as in the Contract.
- [ ] **Step 4: Run** `uv run pytest backend/tests/test_m30_contract.py -q` and `cd frontend && npx tsc -b --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** `git add <the files above>` and `git commit -m "feat(m30): entity extraction contract, stubs and fixtures" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`.

### Task 2: Checking a decision's candidates

**Files:**
- Modify: `backend/objectapp/importers/entitycheck.py`
- Test: `backend/tests/test_m30_check.py`

**Interfaces:**
- Consumes: `filing._check_quote(doc, value, quote, kind)`, `filing._norm`, `filing._label_value`, `kinds.convert`, `planner.importable_type`, `Space._type_id`, `TypeDefinition.prop`, M29 `PropertyDefinition.synced`, M28 `options["counterpart"]` on relation definitions and `counterparts.find_relation` (imported from `filing` at module level; `filing` imports `entitycheck` only inside functions, so there is no cycle).
- Produces: `check_candidates(...)` as in the Contract.

Rules (each failing item keeps `ok: False` and a `reason`; our texts):
- type: an importable type of the space, by name → `"no such type"`.
- name: non-empty, and `filing._norm(name)` in `doc` → `"the name is not in the page"`.
- aliases: kept only when in `doc`; others dropped silently from `aliases` (not invented).
- values: as M27's `apply_decision` values loop against the entity's type; an `entity` kind → `"relations go in relations"`; a synced property → `"synced; not filled by the import"`.
- `mainEntity`: kept as main only when `page_type` is None or equals its type (by id); otherwise it becomes an ordinary candidate with `main: False` and the note `"the page is filed as <type>; it links to it instead"`.
- relations: `relation` names a relation property on some importable type, or an M28 counterpart name → else `"not a relation of these types"`; the quote passes `_check_quote(doc, object, quote, "text")` and also contains the subject's name or one alias unless the subject is the page itself or its main entity → `"the quote does not name both sides"`.
- merges: at least two names, the type importable → else not ok.
- confidence: a candidate's own when in `CONFIDENCE`, else the decision's.

- [ ] **Step 1: Write the failing tests** in `test_m30_check.py` (space from `itops_space`, doc from `filing._doc_text` of the imported APP01 and Payroll pages):
  - `test_valid_candidates_pass`: APP01's decision → `mainEntity` ok, `main: True`, type Host, value `fqdn = "app01.corp.example"` ok; Payroll's relation `Payroll "Runs on" APP01` ok; `"Uses"` with object "SQL 2019" ok.
  - `test_invented_aliases_names_relations_and_synced_values_refused` (Review Focus 3): alias "MSSQL 2019" (not in the page) is dropped; entity "Billing" (not in the page) has reason `"the name is not in the page"`; relation `SRV-DB01 "Runs on" APP01` quoted "Payroll runs on APP01" has `"the quote does not name both sides"`; a value for Host's synced "Last boot" has `"synced; not filled by the import"`; relation `"Hosts"` has `"not a relation of these types"`.
  - `test_main_entity_needs_matching_type` (Review Focus 4): Restart Payroll's decision with `type: "Runbook"` and `mainEntity` Host APP01 → `mainEntity` is None, and APP01 is in `entities` with `main: False` and the note.
  - `test_counterpart_name_accepted`: relation `APP01 "Runs" Payroll` is ok (M28 counterpart name).
  - `test_confidence_defaults_to_decision`: a candidate without `confidence` in a `low` decision is `low`.
- [ ] **Step 2: Run** `uv run pytest backend/tests/test_m30_check.py -q`. Expected: FAIL (`NotImplementedError`).
- [ ] **Step 3: Implement** `check_candidates(space, decision, doc, page_path, page_title, page_type) -> dict` by the rules above.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(m30): check entity candidates against their page` (with the trailer).

### Task 3: Resolution, the entity rule and the review

**Files:**
- Modify: `backend/objectapp/importers/entities.py`
- Test: `backend/tests/test_m30_resolve.py`

**Interfaces:**
- Consumes: results shaped as T1's `m30_helpers.result` (T2's checked candidates); `proposal.near_duplicates`, `proposal._squash`; `Space.list(type_id)` (titles, aliases); `batches.batch_dir`, `batches.write_json`; label options of every type's label properties; `Space.list("tag")` titles.
- Produces: `norm_name`, `resolve`, `Resolution`, `load_review`, `save_review`, `accepted`, `undecided`, `view`.

Algorithm (the order decides ids; the rest the tests pin):
1. `norm_name`: NFKC, casefold, whitespace collapsed, surrounding `.,;:()[]"'` stripped.
2. Collect every ok candidate (main and mentioned) from every non-rejected result, keyed `(typeId, norm_name)` for its name and each alias; union-find joins keys that share a candidate (a name and its aliases), then each ok agent merge's names within its type (`joinedByAgent = True` when a merge joined two groups that no name had joined).
3. Apply the review's `merges` (ids, in order), then its `splits` (the named spellings, with their candidates, leave to form a new entity). Ids are `"<typeId>:<min(keys)>"`, computed after each step; a decision keyed by an id that no longer exists is ignored (the merged entity keeps the decision of the id that survives; a split-off entity starts undecided).
4. Per entity: `name` the most-used spelling, `aliases` the rest; `pages` and `mainPages` sorted; `values` first passing per key (main pages first, then path); `confidence` the highest; `existing` an object of the type in the space whose `norm_name(title)` or an alias's is in `keys` (an object this batch created through a main page counts as the page, not existing).
5. `rule`: `"own"` when `mainPages`, else `"pages"` when `len(pages) >= MIN_PAGES`, else `"properties"` when `values`, else None. `category`: a key equals `norm_name` of a label option of any type in the space or of a tag's title. `rule is None or category` → `leftOut`.
6. `suggestedMerges`: within a type, `proposal.near_duplicates` over entity names (squashed form), never already joined.

- [ ] **Step 1: Write the failing tests** in `test_m30_resolve.py`:
  - `test_names_and_aliases_merge_within_a_type`: "SQL Server 2019" (alias "SQL 2019") on SRV-DB01 and "SQL 2019" on Payroll → one Software entity, name "SQL Server 2019", aliases `["SQL 2019"]`, pages both, rule `"pages"`; a Host "Payroll" and an Application "Payroll" stay two entities.
  - `test_agent_merge_is_applied_and_offered_as_split`: merge `["MSSQL 2019", "SQL Server 2019"]` joins a third candidate; `joinedByAgent is True`.
  - `test_categories_and_single_mentions_are_left_out` (Review Focus 3): "Server" and "VM" (Host Category option, seed tag) → `leftOut` with `category`; "Rack 4" (one page, no values) → `leftOut`, rule None; "HQ" (two pages) is an entity.
  - `test_main_page_meets_the_rule`: APP01 (main of one page, no other mention) has rule `"own"`.
  - `test_existing_object_found`: a Host "app01" already in the space → `existing` is its path.
  - `test_review_ops_and_ids`: `save_review` with a merge of two Software ids, a split of "SQL 2019" out, a rename and a turn-down → `resolve` reflects each; `accepted` returns `(entity, "New name")` for the rename; `undecided` lists the split-off id; `save_review` raises `ReviewInvalid` for an unknown id, status `"maybe"`, an empty rename and a merge across types; nothing but `entities-review.json` changes on disk.
  - `test_view_shape_and_reads_write_nothing`: `view(...)` matches `EntitiesView` (sorted by type then name, `undecided` count, `relations.lowConfidence` counting low relations or low sides) and the space's files and `.object/` are byte-identical after it.
- [ ] **Step 2: Run** `uv run pytest backend/tests/test_m30_resolve.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the functions in `entities.py` by the algorithm.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(m30): resolve entities, the entity rule and Gene's review` (with the trailer).

### Task 4: Writing entities, relations and mentions

**Files:**
- Modify: `backend/objectapp/importers/entitywrite.py`
- Test: `backend/tests/test_m30_write.py`

**Interfaces:**
- Consumes: T1's `Entity`/`Resolution` (tests build them by hand or through `m30_helpers`); `Space.create_object(type_id, title, values=...)` (applies the type's default template, M28's IT ops templates), `Space._write(..., stamp=False, history=False)` with `frontmatter.set_keys` for the `importSource` block (as `writer._file_object` does), `Space.change_type`, `Space.rename_object`, `Space.update_properties`, `Space.resolve`, `references.unlinked_mentions(space, None, path)`, `references.link_mention(space, path, target, start, end, text, version)`; M28 `options["counterpart"]`, `counterparts.find_relation(types, subject_type_id, object_type_id, name) -> RelationMatch(source_type_id, property_key, reversed)` and `options["allowedTypes"]`; M28's `counterparts(path)` for the assertion.
- Produces: `write_entities(...)` as in the Contract.

Order, one entity at a time, each placement recorded in `entities-written.json` before the next (a retry reuses `placed`):
1. **Place.** `existing` → that path. Else a main page (the first of `mainPages` whose result is not in the inbox) → `change_type` when its type differs, then `rename_object` when its title differs (the old title becomes an alias). Else `create_object` with the final name, then the `importSource` block and the `items.json` entry of the Contract.
2. **Values and aliases.** Per placed path, one `update_properties`: the entity's values only where the property is empty; `aliases` the union (old first) of the entity's spellings and a rename's old name, minus the title.
3. **Relations.** For each relation in `res.relations`: resolve each side to a placed entity (by `(type, norm_name)`, else by name across types where exactly one fits), else the page itself (its title), else `space.resolve(name, page)`. Skip with a reason when a side is turned down, unknown, or the same object. Low confidence (the relation's or a side's) → `inboxLinks` (`"Link not written (low confidence): <subject> <relation> <object>"`), not written. Stored side: the subject's type has a relation property named `relation` (casefolded) whose `allowedTypes` is empty or holds the object's type → store on the subject; else the object's type has a relation whose M28 `options["counterpart"]["name"]` is `relation` and allows the subject's type → store on the object; else skip `"no relation fits"`. (Use M28's `find_relation`, which does exactly this lookup from either name.) Values append `{target: title, path}` when not there; grouped per stored object into the step 2 write when it is the same object, else one write per object.
4. **Mentions.** For each placed entity path `E`, `unlinked_mentions(space, None, E)` filtered to the entity's `pages` (current paths) minus `E`; each page's occurrences linked from last to first with `link_mention`, carrying the returned version forward. A `TEXT_CHANGED` / `Conflict` skips that page and counts a failure.

- [ ] **Step 1: Write the failing tests** in `test_m30_write.py` (an `itops_space` with the five pages imported by M27's import, hand-built resolution):
  - `test_creates_accepted_entity_with_provenance_and_template`: Software "SQL Server 2019" → a new object in the Software folder with aliases `["SQL 2019"]`, an `importSource` block `{system: "markdown", id: "entity:software:sql server 2019", batch}`, the M28 template's sections in its body, and an `items.json` entry `action: "created", entity: true`.
  - `test_main_page_becomes_entity_keeps_body_and_provenance` (Review Focus 4): SRV-DB01's page (CRLF+BOM) becomes Host "SRV-DB01": body bytes and `importSource` unchanged, BOM and CRLF kept, only the `type`, `title`, alias and value lines and `lastUpdated` differ (diff of the bytes).
  - `test_relation_stored_on_one_side_and_counterpart_computed`: `Payroll "Runs on" APP01` writes `runsOn` on Payroll only; APP01's file has no new line; M28's `counterparts(APP01)` holds a row named "Runs" listing Payroll. `APP01 "Runs" Payroll` gives the same single stored line.
  - `test_low_confidence_link_goes_to_inbox`: a `low` relation is not written and is in `inboxLinks` with the reason text.
  - `test_mentions_linked_in_batch_pages_only_whole_words` (Review Focus 1): in Restart Payroll, every "APP01" outside code and outside the existing link becomes `[[APP01]]`; `APP010`, the code span and `[[APP01]]` are untouched; a non-batch page of `space-sample` mentioning APP01 is unchanged and still listed by `unlinked_mentions`.
  - `test_existing_object_is_reused_and_write_is_resumable` (Review Focus 2): with Gene's own Host "app01" in the space, the entity APP01 links to it, fills only its empty FQDN and adds no object; a write interrupted after the first placement (monkeypatched failure) and run again places nothing twice (object counts per type unchanged on the rerun).
  - `test_turned_down_side_skips_relation`: a relation to a turned-down entity is skipped with `"turned down"`, and its name stays text in the pages.
- [ ] **Step 2: Run** `uv run pytest backend/tests/test_m30_write.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** `write_entities(space, batch, system, imported_at, chosen, res, items) -> dict` by the order above.
- [ ] **Step 4: Run** the same command and `uv run pytest backend/tests/test_references.py backend/tests/test_references_m8.py -q` (unlinked mentions unchanged). Expected: PASS.
- [ ] **Step 5: Commit** `feat(m30): write entities, stored-side relations and mention links` (with the trailer).

### Task 5: The filing pass collects, waits and writes

**Files:**
- Modify: `backend/objectapp/importers/filing.py`
- Test: `backend/tests/test_m30_filing.py`

**Interfaces:**
- Consumes: T2 `check_candidates`, T3 `resolve` / `load_review` / `save_review` / `accepted` / `undecided` / `view`, T4 `write_entities`; M27's `Filing`, `apply_decision`, `_links_pass`, `_inbox_items`, `_to_inbox`, `record_accuracy`, `_swap`.
- Produces: the Contract's states and `Filing.entities_view`, `save_entity_review`, `write_entities`; `status()` trial items gain `mainEntity` and `entities`.

Changes (M27's behaviour is otherwise unchanged; `test_m27_agent.py` and `test_m27_fixes.py` keep passing):
- `build_prompt` gains the Contract's prompt additions; `_types_for_prompt` also answers the entity types list.
- `apply_decision` stores `check_candidates(...)` in the result for every allowed page it reads, including inbox (low-confidence) pages; never for a rejected one. A value for a synced property is refused `"synced; not filled by the import"` in the page's own values too.
- `eligible` skips `items.json` entries with `entity: true`.
- The end of `_pass` (bulk) and of `apply_external` (after the trial): state `entities` when any ok candidate exists, else `_finish` (M27's normalise suggestions, links pass, inbox items, `done`, accuracy), the same code moved into one method.
- `write_entities(batch)`: `Busy` when a pass runs; `NotAllowed` unless state is `entities` (or `failed` with `mode == "entities"`) and `undecided` is empty (`"N entities are still to decide."`); state `writing`, mode `entities`, a worker thread runs T4's `write_entities` with the batch's `source.system` and the batch's `importedAt`, saves `items.json`, adds the inbox links (`_to_inbox` per page plus `inbox.json` rows) and then `_finish`; a failure records `failed` with the error and keeps what was written.
- `record_accuracy` (or a sibling called by `_finish`) writes `## Entities` with the outcome: `- Entities: A accepted (C created, P from their own page, E already in the space), T turned down, L not made into objects`, `- Links written: R; to the Import inbox: I`, `- Mentions linked: M`.

- [ ] **Step 1: Write the failing tests** in `test_m30_filing.py` (fake `claude` with `FAKE_CLAUDE_FILING` from `m30_helpers.decisions`, through `create_app` and the M27 routes as `test_m27_agent.py` does):
  - `test_bulk_pass_waits_in_entities_state`: proposal (use Host, Application, Software, Runbook) applied, import, trial (all five pages), marks, continue → `GET .../filing` state `entities`; trial items carry `mainEntity {type: "Host", name: "APP01"}` and `entities`; no object was created, no page body changed.
  - `test_write_needs_every_entity_decided`: `fil.write_entities` raises `NotAllowed` with `"3 entities are still to decide."` (the fixture's count); after decisions it runs to `done`, with the report's `## Entities` lines and the `## AI filing` section intact.
  - `test_rerun_and_second_write_create_nothing_new` (Review Focus 2): a second `write_entities` is `NotAllowed`; importing the same source again and running its pass and write adds no Host, Software or Application object (entities are `existing`).
  - `test_trash_batch_takes_created_entities_only` (Review Focus 5): `batches.trash_batch` trashes the created Software and Location, plus the batch's pages as M27 does; Gene's pre-existing Host "app01" is not trashed; restoring the Trash item brings the Software back.
  - `test_low_confidence_page_keeps_candidates_out_of_main`: a `low` decision for APP01's page puts the page in the Import inbox; APP01 is created as a new object (not from the page) when accepted.
  - `test_no_candidates_finishes_as_before`: decisions without the new fields end the bulk pass in `done` exactly as M27 (state, inbox, report).
- [ ] **Step 2: Run** `uv run pytest backend/tests/test_m30_filing.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the changes above in `filing.py`.
- [ ] **Step 4: Run** `uv run pytest backend/tests/test_m30_filing.py backend/tests/test_m27_agent.py backend/tests/test_m27_fixes.py -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(m30): the filing pass collects entities and writes them after review` (with the trailer).

### Task 6: Routes, the MCP read tool and the skill

**Files:**
- Modify: `backend/objectapp/api_import_agent.py`, `backend/objectapp/api_v1_tools.py`, `backend/objectapp/mcp_server.py`, `backend/objectapp/toolcatalog.py`, `backend/objectapp/importfiling.py` (`_IMPORT_TOOLS` gains `"import_entities"`), `backend/objectapp/importskill.py`, the catalogue count tests that list `OBJECT_READ` (`backend/tests/test_m17_contract.py`, `test_m17_mcp_tools.py`, and any other the full run names)
- Test: `backend/tests/test_m30_api.py`

**Interfaces:**
- Consumes: T5's `Filing` methods; `filing.Busy`, `filing.NotAllowed`, `entities.ReviewInvalid`; `Jobs.running()`.
- Produces: the Contract's routes, `import_entities` tool, docstring of `save_import_decisions` listing the four new fields, the skill text.

- [ ] **Step 1: Write the failing tests** in `test_m30_api.py`:
  - `test_entities_routes`: `GET .../entities` answers `EntitiesView` with `state: "review"`; `PUT .../entities/review` with an unknown id → 422; with valid decisions → `{ok: true, view}` with `undecided: 0`; `POST .../entities/write` → 202, then polling `GET .../filing` reaches `done` and `GET .../entities` has `state: "written"` and `written.created >= 1`; a second POST → 409; an unknown batch → 404 on all three.
  - `test_write_refused_while_import_runs`: with `jobs.running()` true → 409 `"Another import is running."`.
  - `test_reads_write_nothing`: the space's `.md` files and `.object/imports/<batch>/` are byte-identical after `GET .../entities`, `GET /api/v1/import/entities` and `GET .../filing`.
  - `test_mcp_import_entities_is_read_only`: `"import_entities"` is in `toolcatalog.OBJECT_READ`, not in `OBJECT_WRITE`; the MCP server lists it; there is no tool whose name contains `entit` among write tools; a filing run's allowed tools exclude it (`importfiling.filing_tools`).
  - `test_skill_states_the_entity_rule`: `importskill.TEXT` contains "exists on its own", "more than one page", "properties of its own", "never entities" and "import_entities(batch)".
- [ ] **Step 2: Run** `uv run pytest backend/tests/test_m30_api.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the routes (the Contract's status codes and texts), the v1 route (read token), the MCP tool (`annotations=READ`), the catalogue entries and the skill text.
- [ ] **Step 4: Run** `uv run pytest backend/tests/test_m30_api.py backend/tests/test_m17_contract.py backend/tests/test_m17_mcp_tools.py backend/tests/test_m27_agent.py -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(m30): entities routes, the import_entities tool and the skill` (with the trailer).

### Task 7: The Entities step

**Files:**
- Create: `frontend/src/import/agent/EntitiesStep.tsx`, `frontend/src/import/agent/entities.test.tsx`

**Interfaces:**
- Consumes: T1's `api.importEntities`, `saveEntitiesReview`, `writeEntities`, `api.filingStatus`; `AGENT_TEXT`; `agentTiming.pollMs` from `TrialStep`.
- Produces: `export function EntitiesStep({ batch, onDone }: { batch: string; onDone: (status: FilingStatus) => void })`.

Layout, in ProposalStep's style: heading `entitiesHeading` (`id="entities-heading"`, `tabIndex={-1}`), intro; **These look like the same thing** rows with **Merge**; one group per type (`typeGroup`), each row a checkbox (`selectLabel`), the name, `pagesCount`, `alsoCalled`, the badges (`fromOwnPage`, `alreadyHere`, `joinedByAgent`, Low confidence), the first value with its quote, the status, and **Accept** / **Rename** (an inline `renameLabel` field) / **Turn down** / **Split** (when it has aliases: the spellings as checkboxes under `splitIntro`); **Merge N selected** per type when two or more are selected; **Not made into objects** collapsed, each with its `leftOutReason`; footer `undecidedEntities`, **Accept the rest**, **Write** (disabled while anything is undecided). Every change saves the whole review and shows the view the server answers. Write polls `filingStatus` every `agentTiming.pollMs` until `done` (then the `written` and `relationsInbox` lines and **Continue**, which calls `onDone(status)`) or `failed` (`writeFailed`, Write enabled again).

- [ ] **Step 1: Write the failing tests** in `entities.test.tsx` (mock API, `agentTiming.pollMs = 10`):
  - `groups entities by type with counts and badges`: two Software, one Host → headings "Software (2)", "Host (1)", "2 pages", "Also called SQL 2019", "From its own page", "Already in this space".
  - `accept, rename and turn down save the review`: each click calls `saveEntitiesReview` with the decision (`{status: 'renamed', name: 'SQL Server 2019 Std'}` after Rename and Enter).
  - `merge selected and split send their ops`: selecting two rows and **Merge 2 selected** sends `merges: [[id1, id2]]`; **Split** with "SQL 2019" checked sends `splits: [{id, names: ['SQL 2019']}]`; the suggested merge's **Merge** sends its ids.
  - `write waits for every decision`: Write is disabled with "1 entity still to decide"; **Accept the rest** accepts it; Write calls `writeEntities`, shows "Writing…", and on `done` shows the written line and **Continue**, which calls `onDone`.
  - `a failed write can be run again`: status `failed` shows `writeFailed` and enables Write.
  - `left-out entities are listed with their reason`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/import/agent/entities.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** `EntitiesStep`.
- [ ] **Step 4: Run** the same command and `npx tsc -b --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** `feat(m30): the import wizard's Entities step` (with the trailer).

### Task 8: The Entities step in the agent flow, and the trial's entity lines

**Files:**
- Modify: `frontend/src/import/agent/AgentFlow.tsx`, `frontend/src/import/agent/TrialStep.tsx`, `frontend/src/import/agent/agent.test.tsx`

**Interfaces:**
- Consumes: T7's `EntitiesStep` (until T7 lands, the test mocks `./EntitiesStep` with a stub rendering the heading "Entities" and a Continue button); T1's `FilingStatus` states.
- Produces: `Stage = 'proposal' | 'trial' | 'entities' | 'normalise' | 'done'`.

- [ ] **Step 1: Write the failing tests** in `agent.test.tsx`:
  - `trial status entities goes to the Entities step`: a filing status `entities` after Continue with the rest → the Entities heading shows; its Continue (status `done` with normalise suggestions) → Normalise with those suggestions.
  - `done without entities skips the step`: status `done` → Normalise directly (M27's path).
  - `a reopened dialog in entities state resumes there`: TrialStep's first load answering `entities` calls `onDone`.
  - `trial items show main entity and mentions`: an item with `mainEntity {type: 'Host', name: 'APP01'}` and two entities shows "About: Host APP01" and "Mentions: SQL Server 2019, HQ" (only `ok` ones).
  - `polling continues while writing`: TrialStep polls in `running`, not in `entities` or `writing` (EntitiesStep owns that).
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/import/agent/agent.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement**: `AgentFlow` routes `onDone(s)` to `entities` when `s.state === 'entities'`, else `normalise`; `TrialStep` treats `entities` like `done` for `onDone` and stops polling; the item lines.
- [ ] **Step 4: Run** `npx vitest run src/import` and `npx tsc -b --noEmit`. Expected: PASS, clean.
- [ ] **Step 5: Commit** `feat(m30): Entities between Trial and Normalise` (with the trailer).

### Task 9: Integrate: acceptance and docs

**Files:**
- Create: `scripts/m30_acceptance.py`, `docs/superpowers/plans/m30-acceptance.md`
- Modify: `docs/behavior-catalog.md` (the import section's agent steps: an **Entities** bullet after Trial, the `import_entities` tool in the MCP bullet), `docs/superpowers/plans/remaining-work.md`, `CONTINUE.md`

**Interfaces:**
- Consumes: everything above; M27's `scripts/m27_acceptance.py` structure (temp `OBJECT_STATE_DIR` / `OBJECT_CACHE_DIR`, fake `claude`, `check(name, ok)`, `RESULT: PASS`).

`m30_acceptance.py` copies `space-sample` into a temp folder itself, applies the IT ops setup, writes the synthetic source (`m30_helpers.make_itops_source`), and runs, through `create_app` and the fake `claude`: draft batch and scan → proposal (use Host, Application, Software, Runbook) → review → Apply → import → trial (5 pages) → marks → continue → `entities` state → checks the view (SQL 2019 and SQL Server 2019 one entity; "Server" and "VM" categories left out; "Rack 4" stays text; APP01 from its own page) → review (accept, rename one, turn down one, merge a suggested pair, split one) → Write → `done`. It then checks: the created objects and their provenance; SRV-DB01's page is a Host with its body bytes unchanged; Payroll stores "Runs on" APP01 and APP01's counterpart row "Runs" lists Payroll; mentions in Restart Payroll are links and `APP010` is not; the low-confidence link's page is in the Import inbox; a non-batch page's unlinked mention of APP01 is still listed; `GET` of the entities view wrote nothing; Move batch to Trash trashes the created entities and not Gene's pre-existing object; the fixture folder is unchanged (hash before and after). Ends with `RESULT: PASS`.

- [ ] **Step 1: Write** `scripts/m30_acceptance.py` and run `uv run python scripts/m30_acceptance.py`. Expected: `RESULT: PASS`.
- [ ] **Step 2: Write** `m30-acceptance.md` with Gene's hand-checks:
  - [ ] On a copy of a space with the IT ops starter, import a synthetic folder of server, application and runbook pages and run the trial; each trial result shows "About:" and "Mentions:" lines.
  - [ ] After Continue with the rest, the Entities step lists entities by type with page counts, aliases and badges; categories and one-off mentions are under "Not made into objects".
  - [ ] Accept, Rename, Turn down, Merge N selected, a suggested Merge and Split each change the list as expected, and survive closing and reopening the dialog.
  - [ ] Write stays disabled until everything is decided; Accept the rest decides the remainder.
  - [ ] After Write: a server page is now its Host, with its text as the notes; an application shows "Runs on" the host and the host shows "Runs" the application; mentions in the runbook are links.
  - [ ] Low-confidence links are in the Import inbox with their reason.
  - [ ] Unlinked mentions on pages outside the import are still shown on the entity's page.
  - [ ] Move batch to Trash moves the created entities to the Trash, and Restore brings them back.
  - [ ] An outside agent over MCP can read the list with `import_entities` and cannot accept or write it.
  - Deviations: (filled in by the build).
- [ ] **Step 3: Run the gate**: `uv run pytest backend/tests -q`, `cd frontend && npx vitest run && npx tsc -b --noEmit && npm run build`, and `uv run python scripts/m27_acceptance.py` and `scripts/m30_acceptance.py`. Expected: all pass.
- [ ] **Step 4: Update** the catalog, `remaining-work.md` (M30 built; Gene's checks) and `CONTINUE.md`.
- [ ] **Step 5: Commit** `test(m30): acceptance, hand-checks and docs` (with the trailer).

---

## Shared files and ordering

| Shared file | Owner | Others needing a change say so in their report |
|---|---|---|
| `frontend/src/api/types.ts`, `api/client.ts`, `test/mockApi.ts`, `import/agent/text.ts` | T1 | T7, T8 |
| `backend/tests/m30_helpers.py` | T1 | T2-T6, T9 read it |
| `backend/objectapp/importers/entitycheck.py` | T1 (stub), then T2 | |
| `backend/objectapp/importers/entities.py` | T1 (stub), then T3 | |
| `backend/objectapp/importers/entitywrite.py` | T1 (stub), then T4 | |
| `backend/objectapp/importers/filing.py` | T5 | T2 reads its helpers, never edits it |
| `backend/objectapp/api_import_agent.py`, `api_v1_tools.py`, `mcp_server.py`, `toolcatalog.py`, `importfiling.py`, `importskill.py`, the catalogue count tests | T6 | |
| `frontend/src/import/agent/AgentFlow.tsx`, `TrialStep.tsx`, `agent.test.tsx` | T8 | |
| `docs/behavior-catalog.md`, `remaining-work.md`, `CONTINUE.md` | T9 | |

`batches.py`, `writer.py`, `references.py`, `space.py`, `proposal.py` and every M28/M29 file are used, not edited. If a task finds it must edit one, it stops and reports.

## Lanes

T1 runs first, alone. Then five tracks (counted from the Files lists; no file is in two tracks):

| Track | Tasks, in order | Waits for |
|---|---|---|
| B1 (checks and the pass) | T2, T5 | T5 waits for T3 (B2) and T4 (B3) |
| B2 (resolution and routes) | T3, T6 | T6 waits for T5 (B1) |
| B3 (writing) | T4 | |
| F1 (the step) | T7 | |
| F2 (the flow) | T8 | nothing: its test stubs `EntitiesStep` until T7 lands |

On a 4-CPU box this runs as about three parallel agents. T9 integrates after all tracks. Then one whole-milestone review (correctness, file safety, fidelity to the spec), one fix pass, the final gate (T9 step 3), and Gene's hands-on check.

## Our calls

1. **Candidates come from the filing pass**, so the Entities step sits **after the bulk pass, before Normalise** (the spec puts it "after the schema step"; it can't come earlier, because the candidates don't exist until the pages are read). The trial shows each page's main entity and mentions, so Gene can mark those right or wrong too.
2. **Aliases must be written in the page**; an alias the agent knows but the page doesn't say is dropped (the import design's "no invented values").
3. **Merging**: names and aliases that normalise the same (case, spacing, surrounding punctuation) merge by themselves, within a type; the agent's merges are applied and marked "Merged by the agent", which offers Split; near-duplicate names (the proposal's comparison form) are only suggested.
4. **The entity rule is enforced**: an entity that fails it, or is a category (a label option of a type in the space, or a tag), is listed under "Not made into objects" and can't be accepted; Gene can still merge it into an entity. This means a Software named exactly like a tag (Docker) stays a tag; "Docker 24" is Software.
5. **Every entity must be decided before Write**, as every proposal item must be before Apply; **Accept the rest** makes that one click.
6. **Main-entity notes**: the main page (the first by path, not in the inbox) becomes the entity: its type changes to the entity's, its title to the entity's name (the old title kept as an alias), and its body is the notes, unchanged. Other pages about the same entity stay their own pages and get mention links. When the entity already exists in the space, the page stays its own and links to it; only the existing object's empty properties are filled. A page filed as another type (a Runbook) never becomes an entity.
7. **Entity types don't need a proposal item**: any importable type of the space can hold entities; the entity list's review is the approval.
8. **Created entities carry an `importSource` block** (`id: entity:<typeId>:<key>`) and a `created` entry in `items.json`, so Move batch to Trash takes them and a re-run finds them instead of making twins (as M27's File objects do).
9. **Relations by name**: the relation is a relation property's name on the subject's type, or an M28 counterpart name, which stores the link on the other side. A quote must name both sides, except the page's own subject.
10. **Low-confidence links** (the relation's confidence or either side's) aren't written; the page goes to the Import inbox with "Link not written (low confidence): …".
11. **Every mention** in the batch's pages is linked (the spec's "each mention"), last to first; pages outside the batch keep their unlinked mentions.
12. **Write runs in the filing worker** (states `entities`, then `writing`), records each placement as it goes, and can be run again after a failure without placing anything twice.
13. **Values**: the first passing value per property wins, main page first, then by path; the import fills only empty properties and never a synced one (M29).
14. **The entity list is computed on read** from the filing results and Gene's review, never stored, so reading it writes nothing.
15. **MCP**: one new read tool, `import_entities`; accepting and writing stay app-only, like Apply.

**Consumed from M28/M29 (names as the brief gives them; marked where the plan had to guess a detail):** `Space.apply_setup("itops")`; relation counterparts at `options["counterpart"] = {"name", "key"} | None` (confirmed against the M28 plan, its "Our calls" #5), found with `counterparts.find_relation`; `space.links.counterparts(path) -> list[CounterpartRow]` (confirmed against the M28 plan); M28's IT ops property keys `runsOn`, `uses`, `fqdn`, `operatingSystem`, `locatedAt`, `covers` (confirmed against the M28 plan); M29 `PropertyDefinition.synced: SyncedSpec | None` (confirmed against the M29 plan: a top-level field).
